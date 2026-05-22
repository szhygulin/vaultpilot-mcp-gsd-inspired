// src/chains/bitcoin/esplora-client.ts — Phase 22 Plans 22-01 + 22-03.
//
// Esplora HTTP client. NEVER-throws — every fetch helper returns a
// 5-arm discriminated union: `{ kind: "ok" | "not-found" |
// "rate-limited" | "error" | "not-applicable" }`. Tool handlers
// pattern-match on `kind` rather than try/catch.
//
// Lives in `src/chains/bitcoin/` (NOT `src/clients/`) because Esplora
// is BTC's primary read backend, not a cross-chain service. PATTERNS
// §Meta-Decision 5 + mirror of Solana's `sol-rpc-client.ts` placement.
//
// Test seam: `vi.stubGlobal("fetch", ...)` at the OUTER network
// boundary — NOT an internal indirection (CLAUDE.md fetch-stub
// convention for external HTTP). DO NOT introduce a `_esploraClient`
// wrapper; the seam is the global `fetch`.
//
// Four fetch helpers:
//   - fetchAddressInfo(addr): /address/{addr} → confirmed +
//     unconfirmed balance + txCount
//   - fetchAddressUtxos(addr): /address/{addr}/utxo → UTXO array (load-
//     bearing for Phase 23 coin-selection inheritance)
//   - fetchAddressTxs(addr, opts): /address/{addr}/txs[/chain/<cursor>]
//     → stripped-down per-row shape (NOT full vin/vout — defer to
//     Phase 23/24)
//   - fetchFeeEstimates(): /fee-estimates → 24-key object verbatim
//     (projection to 5 keys happens in the tool layer)
//
// Per-call timeout 5s (Esplora is slower than 4byte selector lookups,
// faster than Etherscan contract-source fetch). LRU cache 256 entries
// per helper. Mirror of `src/clients/etherscan.ts` shape adapted to
// single-endpoint Esplora calls.
//
// Anti-pattern guard: do NOT hit mempool.space's
// `/v1/fees/recommended` even when `BTC_ESPLORA_URL` points at
// mempool.space — both endpoints expose `/api/fee-estimates` with the
// standard Esplora shape (RESEARCH § Anti-Patterns + § Plan 22-03
// risks).
//
// Pitfall 6 anchor: no Buffer interop. JSON in / JSON out / bigint at
// the boundary. `valueSats` + balances are bigint to handle whale
// wallet values exceeding Number.MAX_SAFE_INTEGER.

import { log } from "../../diagnostics/logger.js";
import { _bitcoinRegistry } from "./registry.js";
import type { UtxoRow } from "./types.js";

const ESPLORA_TIMEOUT_MS = 5000;
const CACHE_MAX_ENTRIES = 256;

// TTLs for time-sensitive caches (WR-05):
//   UTXOs change frequently — a confirmed spend or incoming tx can appear
//   within seconds. 30s TTL keeps coin-selection fresh without hammering Esplora.
//   Fee estimates change every block (~10 min) but outlier spikes happen at any
//   time — 60s provides a usable balance between freshness and rate limits.
const UTXOS_CACHE_TTL_MS = 30_000;  // 30 s
const FEE_ESTIMATES_CACHE_TTL_MS = 60_000; // 60 s

// Internal literal cache key for /fee-estimates (single endpoint, no
// per-input variation).
const FEE_ESTIMATES_CACHE_KEY = "::fee-estimates::";

// ───────────────────────── 5-arm union types ─────────────────────────

export type EsploraAddressResult =
  | { kind: "not-applicable" }
  | {
      kind: "ok";
      address: string;
      confirmedBalanceSats: bigint;
      unconfirmedBalanceSats: bigint;
      txCount: number;
    }
  | { kind: "not-found"; address: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

export type EsploraUtxosResult =
  | { kind: "not-applicable" }
  | { kind: "ok"; address: string; utxos: readonly UtxoRow[] }
  | { kind: "not-found"; address: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

export interface EsploraTxRow {
  readonly txid: string;
  readonly blockHeight?: number;
  readonly confirmedAt?: number;
  readonly fee: bigint;
}

export type EsploraTxsResult =
  | { kind: "not-applicable" }
  | { kind: "ok"; address: string; txs: readonly EsploraTxRow[] }
  | { kind: "not-found"; address: string }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

export type EsploraFeeEstimatesResult =
  | { kind: "not-applicable" }
  | { kind: "ok"; estimates: Record<string, number> }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string }
  | { kind: "error"; message: string };

// ───────────────────────── Module-scope LRU caches ─────────────────────

const addressInfoCache = new Map<string, EsploraAddressResult>();
const addressUtxosCache = new Map<string, EsploraUtxosResult>();
// Per-entry TTL tracking for UTXOs (WR-05). Separate map avoids changing the
// cache value type which would require updates at every read site.
const addressUtxosCacheTs = new Map<string, number>();
const addressTxsCache = new Map<string, EsploraTxsResult>();
const feeEstimatesCache = new Map<string, EsploraFeeEstimatesResult>();
// Per-entry TTL tracking for fee-estimates (WR-05).
const feeEstimatesCacheTs = new Map<string, number>();

function cacheInsert<T>(cache: Map<string, T>, key: string, result: T): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Insertion-order iteration → first key is the oldest.
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, result);
}

// ───────────────────────── Esplora endpoint typings ──────────────────

interface EsploraAddressBody {
  address?: string;
  chain_stats?: {
    funded_txo_sum?: number;
    spent_txo_sum?: number;
    tx_count?: number;
  };
  mempool_stats?: {
    funded_txo_sum?: number;
    spent_txo_sum?: number;
    tx_count?: number;
  };
}

interface EsploraUtxoBody {
  txid?: string;
  vout?: number;
  value?: number;
  status?: { confirmed?: boolean; block_height?: number };
}

interface EsploraTxBody {
  txid?: string;
  status?: { confirmed?: boolean; block_height?: number; block_time?: number };
  fee?: number;
}

// ───────────────────────── Internal helper: fetch + decode ──────────

interface FetchOutcome<T> {
  status: number;
  ok: boolean;
  body?: T;
  parseError?: string;
  networkError?: string;
  timeout?: boolean;
}

async function doFetch<T>(url: string): Promise<FetchOutcome<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ESPLORA_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      return { status: resp.status, ok: false };
    }
    let body: T;
    try {
      body = (await resp.json()) as T;
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return { status: resp.status, ok: false, parseError: msg };
    }
    return { status: resp.status, ok: true, body };
  } catch (err) {
    const e = err as Error;
    if (e?.name === "AbortError") {
      return { status: 0, ok: false, timeout: true };
    }
    return { status: 0, ok: false, networkError: e?.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── fetchAddressInfo ──────────────────────────

/**
 * GET /address/{addr}. Computes `confirmedBalanceSats = funded_txo_sum
 * - spent_txo_sum` (NOT raw funded — RESEARCH § Pitfall 3). bigint at
 * the boundary so whale wallets exceeding Number.MAX_SAFE_INTEGER
 * survive without precision loss.
 *
 * `txCount = chain_stats.tx_count + mempool_stats.tx_count` (combined —
 * Phase 23 gap-limit scan checks against the COMBINED count so a
 * freshly-derived address with a pending receive is correctly
 * classified as "in use").
 */
export async function fetchAddressInfo(
  address: string,
): Promise<EsploraAddressResult> {
  const cached = addressInfoCache.get(address);
  if (cached) return cached;

  const url = `${_bitcoinRegistry.getEsploraBaseUrl()}/address/${address}`;
  const outcome = await doFetch<EsploraAddressBody>(url);

  let result: EsploraAddressResult;
  if (outcome.timeout) {
    result = {
      kind: "error",
      message: `Esplora unreachable (timeout ${ESPLORA_TIMEOUT_MS}ms)`,
    };
    log("warn", `Esplora /address/${address} failed: ${result.message}`);
  } else if (outcome.networkError !== undefined) {
    result = {
      kind: "error",
      message: `Esplora unreachable: ${outcome.networkError}`,
    };
    log("warn", `Esplora /address/${address} failed: ${result.message}`);
  } else if (!outcome.ok) {
    if (outcome.status === 404) {
      result = { kind: "not-found", address };
    } else if (outcome.status === 429) {
      result = {
        kind: "rate-limited",
        message: `Esplora 429 from ${url}`,
      };
    } else if (outcome.parseError !== undefined) {
      result = {
        kind: "error",
        message: `Esplora invalid JSON: ${outcome.parseError}`,
      };
      log(
        "warn",
        `Esplora /address/${address} parse failed: ${result.message}`,
      );
    } else {
      result = {
        kind: "error",
        message: `Esplora returned HTTP ${outcome.status}`,
      };
      log("warn", `Esplora /address/${address} failed: ${result.message}`);
    }
  } else if (outcome.parseError !== undefined) {
    result = {
      kind: "error",
      message: `Esplora invalid JSON: ${outcome.parseError}`,
    };
    log("warn", `Esplora /address/${address} parse failed: ${result.message}`);
  } else {
    const body = outcome.body;
    if (!body?.chain_stats) {
      result = { kind: "error", message: "Esplora missing chain_stats" };
      log(
        "warn",
        `Esplora /address/${address} response missing chain_stats`,
      );
    } else {
      const confirmedFunded = BigInt(body.chain_stats.funded_txo_sum ?? 0);
      const confirmedSpent = BigInt(body.chain_stats.spent_txo_sum ?? 0);
      const mempoolFunded = BigInt(body.mempool_stats?.funded_txo_sum ?? 0);
      const mempoolSpent = BigInt(body.mempool_stats?.spent_txo_sum ?? 0);
      result = {
        kind: "ok",
        address,
        confirmedBalanceSats: confirmedFunded - confirmedSpent,
        unconfirmedBalanceSats: mempoolFunded - mempoolSpent,
        txCount:
          (body.chain_stats.tx_count ?? 0) +
          (body.mempool_stats?.tx_count ?? 0),
      };
    }
  }

  cacheInsert(addressInfoCache, address, result);
  return result;
}

// ───────────────────────── fetchAddressUtxos ─────────────────────────

/**
 * GET /address/{addr}/utxo. Returns `UtxoRow[]` with each row carrying
 * `txid`, `vout`, `valueSats: bigint`, `confirmed: boolean`, optional
 * `blockHeight: number`, and `address` (RESEARCH § Plan 22-03 risks —
 * Phase 23 coin-selection infers script type from address prefix
 * without re-fetch).
 */
export async function fetchAddressUtxos(
  address: string,
): Promise<EsploraUtxosResult> {
  const cached = addressUtxosCache.get(address);
  const cachedTs = addressUtxosCacheTs.get(address);
  if (cached && cachedTs !== undefined && Date.now() - cachedTs < UTXOS_CACHE_TTL_MS) {
    return cached;
  }

  const url = `${_bitcoinRegistry.getEsploraBaseUrl()}/address/${address}/utxo`;
  const outcome = await doFetch<EsploraUtxoBody[]>(url);

  let result: EsploraUtxosResult;
  if (outcome.timeout) {
    result = {
      kind: "error",
      message: `Esplora unreachable (timeout ${ESPLORA_TIMEOUT_MS}ms)`,
    };
    log("warn", `Esplora /address/${address}/utxo failed: ${result.message}`);
  } else if (outcome.networkError !== undefined) {
    result = {
      kind: "error",
      message: `Esplora unreachable: ${outcome.networkError}`,
    };
    log("warn", `Esplora /address/${address}/utxo failed: ${result.message}`);
  } else if (!outcome.ok) {
    if (outcome.status === 404) {
      result = { kind: "not-found", address };
    } else if (outcome.status === 429) {
      result = { kind: "rate-limited", message: `Esplora 429 from ${url}` };
    } else if (outcome.parseError !== undefined) {
      result = {
        kind: "error",
        message: `Esplora invalid JSON: ${outcome.parseError}`,
      };
      log(
        "warn",
        `Esplora /address/${address}/utxo parse failed: ${result.message}`,
      );
    } else {
      result = {
        kind: "error",
        message: `Esplora returned HTTP ${outcome.status}`,
      };
      log(
        "warn",
        `Esplora /address/${address}/utxo failed: ${result.message}`,
      );
    }
  } else if (outcome.parseError !== undefined) {
    result = {
      kind: "error",
      message: `Esplora invalid JSON: ${outcome.parseError}`,
    };
    log(
      "warn",
      `Esplora /address/${address}/utxo parse failed: ${result.message}`,
    );
  } else {
    const body = outcome.body;
    if (!Array.isArray(body)) {
      result = { kind: "error", message: "Esplora utxo response is not an array" };
      log(
        "warn",
        `Esplora /address/${address}/utxo response is not an array`,
      );
    } else {
      const utxos: UtxoRow[] = body.map((entry) => {
        const row: UtxoRow = {
          txid: typeof entry.txid === "string" ? entry.txid : "",
          vout: typeof entry.vout === "number" ? entry.vout : 0,
          valueSats: BigInt(entry.value ?? 0),
          confirmed: entry.status?.confirmed === true,
          ...(entry.status?.confirmed === true &&
          typeof entry.status.block_height === "number"
            ? { blockHeight: entry.status.block_height }
            : {}),
          address,
        };
        return row;
      });
      result = { kind: "ok", address, utxos };
    }
  }

  cacheInsert(addressUtxosCache, address, result);
  addressUtxosCacheTs.set(address, Date.now()); // WR-05: record cache timestamp
  return result;
}

// ───────────────────────── fetchAddressTxs ──────────────────────────

/**
 * GET /address/{addr}/txs[/chain/{afterTxid}]. Returns stripped-down
 * per-row shape — `{ txid, blockHeight?, confirmedAt?, fee }`. NOT full
 * vin/vout (defer to Phase 23/24 per RESEARCH § Plan 22-03 #5).
 *
 * Pagination via Esplora's `:last_seen_txid` cursor (the
 * `/chain/<txid>` segment); the caller passes the txid of the last row
 * from the previous page.
 *
 * Cache key includes the optional `afterTxid` so distinct pages cache
 * independently. Tx history changes over time (new tx confirmations);
 * Phase 22 caches per-request for the process lifetime — Phase 23/24
 * can introduce a TTL if needed.
 */
export async function fetchAddressTxs(
  address: string,
  opts?: { afterTxid?: string },
): Promise<EsploraTxsResult> {
  const cacheKey = opts?.afterTxid
    ? `${address}::${opts.afterTxid}`
    : address;
  const cached = addressTxsCache.get(cacheKey);
  if (cached) return cached;

  const base = `${_bitcoinRegistry.getEsploraBaseUrl()}/address/${address}/txs`;
  const url = opts?.afterTxid ? `${base}/chain/${opts.afterTxid}` : base;
  const outcome = await doFetch<EsploraTxBody[]>(url);

  let result: EsploraTxsResult;
  if (outcome.timeout) {
    result = {
      kind: "error",
      message: `Esplora unreachable (timeout ${ESPLORA_TIMEOUT_MS}ms)`,
    };
    log("warn", `Esplora /address/${address}/txs failed: ${result.message}`);
  } else if (outcome.networkError !== undefined) {
    result = {
      kind: "error",
      message: `Esplora unreachable: ${outcome.networkError}`,
    };
    log("warn", `Esplora /address/${address}/txs failed: ${result.message}`);
  } else if (!outcome.ok) {
    if (outcome.status === 404) {
      result = { kind: "not-found", address };
    } else if (outcome.status === 429) {
      result = { kind: "rate-limited", message: `Esplora 429 from ${url}` };
    } else if (outcome.parseError !== undefined) {
      result = {
        kind: "error",
        message: `Esplora invalid JSON: ${outcome.parseError}`,
      };
      log(
        "warn",
        `Esplora /address/${address}/txs parse failed: ${result.message}`,
      );
    } else {
      result = {
        kind: "error",
        message: `Esplora returned HTTP ${outcome.status}`,
      };
      log(
        "warn",
        `Esplora /address/${address}/txs failed: ${result.message}`,
      );
    }
  } else if (outcome.parseError !== undefined) {
    result = {
      kind: "error",
      message: `Esplora invalid JSON: ${outcome.parseError}`,
    };
    log(
      "warn",
      `Esplora /address/${address}/txs parse failed: ${result.message}`,
    );
  } else {
    const body = outcome.body;
    if (!Array.isArray(body)) {
      result = { kind: "error", message: "Esplora txs response is not an array" };
      log(
        "warn",
        `Esplora /address/${address}/txs response is not an array`,
      );
    } else {
      const txs: EsploraTxRow[] = body.map((entry) => {
        const isConfirmed = entry.status?.confirmed === true;
        const row: EsploraTxRow = {
          txid: typeof entry.txid === "string" ? entry.txid : "",
          fee: BigInt(entry.fee ?? 0),
          ...(isConfirmed && typeof entry.status?.block_height === "number"
            ? { blockHeight: entry.status.block_height }
            : {}),
          ...(isConfirmed && typeof entry.status?.block_time === "number"
            ? { confirmedAt: entry.status.block_time }
            : {}),
        };
        return row;
      });
      result = { kind: "ok", address, txs };
    }
  }

  cacheInsert(addressTxsCache, cacheKey, result);
  return result;
}

// ───────────────────────── fetchFeeEstimates ─────────────────────────

/**
 * GET /fee-estimates. Returns the 24-key `Record<string, number>`
 * verbatim; projection to the standard 5-target shape (`"1"`, `"2"`,
 * `"3"`, `"6"`, `"144"`) happens in the tool layer (`get_btc_fee_estimates`
 * — Plan 22-03) per RESEARCH § Plan 22-03 #6 + ROADMAP SC #7.
 *
 * Single-endpoint cache key (`FEE_ESTIMATES_CACHE_KEY` literal); fee
 * estimates change every ~block (~10 min) but spike at any time.
 * WR-05: 60s TTL prevents stale fee rates from propagating across
 * multiple prepare calls within a busy session.
 */
export async function fetchFeeEstimates(): Promise<EsploraFeeEstimatesResult> {
  const cached = feeEstimatesCache.get(FEE_ESTIMATES_CACHE_KEY);
  const cachedTs = feeEstimatesCacheTs.get(FEE_ESTIMATES_CACHE_KEY);
  if (cached && cachedTs !== undefined && Date.now() - cachedTs < FEE_ESTIMATES_CACHE_TTL_MS) {
    return cached;
  }

  const url = `${_bitcoinRegistry.getEsploraBaseUrl()}/fee-estimates`;
  const outcome = await doFetch<Record<string, number>>(url);

  let result: EsploraFeeEstimatesResult;
  if (outcome.timeout) {
    result = {
      kind: "error",
      message: `Esplora unreachable (timeout ${ESPLORA_TIMEOUT_MS}ms)`,
    };
    log("warn", `Esplora /fee-estimates failed: ${result.message}`);
  } else if (outcome.networkError !== undefined) {
    result = {
      kind: "error",
      message: `Esplora unreachable: ${outcome.networkError}`,
    };
    log("warn", `Esplora /fee-estimates failed: ${result.message}`);
  } else if (!outcome.ok) {
    if (outcome.status === 404) {
      result = { kind: "not-found" };
    } else if (outcome.status === 429) {
      result = { kind: "rate-limited", message: `Esplora 429 from ${url}` };
    } else if (outcome.parseError !== undefined) {
      result = {
        kind: "error",
        message: `Esplora invalid JSON: ${outcome.parseError}`,
      };
      log(
        "warn",
        `Esplora /fee-estimates parse failed: ${result.message}`,
      );
    } else {
      result = {
        kind: "error",
        message: `Esplora returned HTTP ${outcome.status}`,
      };
      log("warn", `Esplora /fee-estimates failed: ${result.message}`);
    }
  } else if (outcome.parseError !== undefined) {
    result = {
      kind: "error",
      message: `Esplora invalid JSON: ${outcome.parseError}`,
    };
    log("warn", `Esplora /fee-estimates parse failed: ${result.message}`);
  } else {
    const body = outcome.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      result = {
        kind: "error",
        message: "Esplora /fee-estimates response is not an object",
      };
      log(
        "warn",
        "Esplora /fee-estimates response shape unexpected",
      );
    } else {
      // Surface verbatim — projection lives in the tool layer.
      const estimates: Record<string, number> = {};
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === "number") estimates[k] = v;
      }
      result = { kind: "ok", estimates };
    }
  }

  cacheInsert(feeEstimatesCache, FEE_ESTIMATES_CACHE_KEY, result);
  feeEstimatesCacheTs.set(FEE_ESTIMATES_CACHE_KEY, Date.now()); // WR-05: record cache timestamp
  return result;
}

// ───────────────────────── broadcastTx ──────────────────────────────
//
// Phase 23 Plan 23-04 — POST /tx to Esplora.
// RESEARCH § Code Examples "Esplora broadcast". Never-throws discriminated
// union: { kind: "ok"; txid } | { kind: "rejected"; message } |
// { kind: "error"; message }.
//
// Esplora broadcast semantics (RESEARCH Assumption A2):
//   - 200 OK → plain-text txid in body.
//   - 400 Bad Request → mempool rejection reason in body (min-relay-fee,
//     double-spend, etc.).
//   - Other error / network failure → { kind: "error" }.
//
// The POST body is the raw tx hex as plain text (no JSON envelope).
// AbortController timeout mirrors the existing fetch helpers.

export type EsploraBroadcastResult =
  | { kind: "ok"; txid: string }
  | { kind: "rejected"; message: string }
  | { kind: "error"; message: string };

/**
 * Broadcast a finalized raw transaction hex via Esplora `POST /tx`.
 *
 * Returns a discriminated union — NEVER throws.
 *   - `{ kind: "ok"; txid }` — Esplora accepted the tx; `txid` is the
 *     plain-text txid returned in the response body.
 *   - `{ kind: "rejected"; message }` — Esplora returned HTTP 400
 *     (mempool rejection, e.g. min-relay-fee, double-spend).
 *   - `{ kind: "error"; message }` — network error, timeout, or any
 *     non-200/400 HTTP status.
 */
export async function broadcastTx(
  rawTxHex: string,
): Promise<EsploraBroadcastResult> {
  const url = `${_bitcoinRegistry.getEsploraBaseUrl()}/tx`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ESPLORA_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      body: rawTxHex,
      signal: controller.signal,
    });
    const text = await resp.text();
    if (resp.ok) {
      return { kind: "ok", txid: text.trim() };
    }
    if (resp.status === 400) {
      // Mempool rejection (e.g. "min relay fee not met", "txn-mempool-conflict").
      return { kind: "rejected", message: text };
    }
    return {
      kind: "error",
      message: `Esplora POST /tx HTTP ${resp.status}: ${text}`,
    };
  } catch (err) {
    const e = err as Error;
    if (e?.name === "AbortError") {
      return { kind: "error", message: `Esplora broadcast timeout (${ESPLORA_TIMEOUT_MS}ms)` };
    }
    return { kind: "error", message: `Esplora unreachable: ${e?.message ?? String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── Test-only cache reset ─────────────────────

/**
 * Clear ALL four module-scope caches. Test-only — production code
 * never calls this. Underscore-prefix convention matches Phase 4's
 * `_resetFourbyteCacheForTesting` + Phase 7's
 * `_resetEtherscanCacheForTesting`.
 */
export function _resetEsploraCacheForTesting(): void {
  addressInfoCache.clear();
  addressUtxosCache.clear();
  addressUtxosCacheTs.clear(); // WR-05
  addressTxsCache.clear();
  feeEstimatesCache.clear();
  feeEstimatesCacheTs.clear(); // WR-05
}
