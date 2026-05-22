// src/chains/litecoin/esplora-client.ts — Phase 26 Plan 26-01 (LTC-READ-01 / LTC-READ-02).
//
// LTC Esplora HTTP client. NEVER-throws — every fetch helper returns a
// 5-arm discriminated union: `{ kind: "ok" | "not-found" |
// "rate-limited" | "error" | "not-applicable" }`. Tool handlers
// pattern-match on `kind` rather than try/catch.
//
// Clone of `src/chains/bitcoin/esplora-client.ts` with TWO divergences:
//
//   1. `_litecoinRegistry` instead of `_bitcoinRegistry` — routes to
//      litecoinspace.org (or `LITECOIN_ESPLORA_URL` override).
//
//   2. `fetchFeeEstimates` calls `/v1/fees/recommended` (mempool.space
//      shape) instead of `/fee-estimates` (Esplora standard). The BTC
//      endpoint returns HTTP 404 on litecoinspace.org (RESEARCH Pitfall 1
//      REGRESSION ANCHOR). The response is mapped from the mempool.space
//      `{ fastestFee, halfHourFee, hourFee, economyFee, minimumFee }` shape
//      to the standard 5-key object `{ "1", "2", "3", "6", "144" }` INSIDE
//      this client (NOT in the tool layer). The tool layer's
//      `for (const key of TARGET_KEYS)` projection loop works unchanged.
//
// Anti-pattern guard: NEVER call `/fee-estimates` against litecoinspace.org —
// it 404s. The canonical endpoint is `/api/v1/fees/recommended` (RESEARCH
// Pitfall 1 + PATTERNS § esplora-client.ts).
//
// Test seam: `vi.stubGlobal("fetch", ...)` at the OUTER network boundary —
// NOT an internal indirection (CLAUDE.md fetch-stub convention for external
// HTTP clients). DO NOT introduce a `_esploraClient` wrapper.
//
// Four fetch helpers:
//   - fetchAddressInfo(addr): /address/{addr} → confirmed + unconfirmed balance + txCount
//   - fetchAddressUtxos(addr): /address/{addr}/utxo → UTXO array
//   - fetchAddressTxs(addr, opts): /address/{addr}/txs[/chain/<cursor>]
//     → stripped-down per-row shape (txid, blockHeight?, confirmedAt?, fee)
//   - fetchFeeEstimates(): /v1/fees/recommended → 5-key sat/vB object
//     (mapped from mempool.space shape inside this client)
//
// Per-call timeout 5s. LRU cache 256 entries per helper. WR-05 TTLs:
//   UTXOs: 30s (change frequently), fee estimates: 60s (change per block).

import { log } from "../../diagnostics/logger.js";
import { _litecoinRegistry } from "./registry.js";
import type { UtxoRow } from "./types.js";

const ESPLORA_TIMEOUT_MS = 5000;
const CACHE_MAX_ENTRIES = 256;

// TTLs for time-sensitive caches (WR-05):
const UTXOS_CACHE_TTL_MS = 30_000;      // 30 s
const FEE_ESTIMATES_CACHE_TTL_MS = 60_000; // 60 s

// Internal literal cache key for fee estimates (single endpoint, no
// per-input variation).
const FEE_ESTIMATES_CACHE_KEY = "::ltc-fee-estimates::";

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
const addressUtxosCacheTs = new Map<string, number>(); // WR-05 TTL tracking
const addressTxsCache = new Map<string, EsploraTxsResult>();
const feeEstimatesCache = new Map<string, EsploraFeeEstimatesResult>();
const feeEstimatesCacheTs = new Map<string, number>(); // WR-05 TTL tracking

function cacheInsert<T>(cache: Map<string, T>, key: string, result: T): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
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

// mempool.space-style fee-estimates response shape
// (distinct from Esplora's 24-key /fee-estimates).
// Source: Live litecoinspace.org API test 2026-05-22 (RESEARCH Pattern 1)
interface LtcFeesBody {
  fastestFee?: number;
  halfHourFee?: number;
  hourFee?: number;
  economyFee?: number;
  minimumFee?: number;
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
 * - spent_txo_sum`. bigint at the boundary (litoshis for LTC).
 *
 * `txCount = chain_stats.tx_count + mempool_stats.tx_count` (combined).
 */
export async function fetchAddressInfo(
  address: string,
): Promise<EsploraAddressResult> {
  const cached = addressInfoCache.get(address);
  if (cached) return cached;

  const url = `${_litecoinRegistry.getEsploraBaseUrl()}/address/${address}`;
  const outcome = await doFetch<EsploraAddressBody>(url);

  let result: EsploraAddressResult;
  if (outcome.timeout) {
    result = {
      kind: "error",
      message: `LTC Esplora unreachable (timeout ${ESPLORA_TIMEOUT_MS}ms)`,
    };
    log("warn", `LTC Esplora /address/${address} failed: ${result.message}`);
  } else if (outcome.networkError !== undefined) {
    result = {
      kind: "error",
      message: `LTC Esplora unreachable: ${outcome.networkError}`,
    };
    log("warn", `LTC Esplora /address/${address} failed: ${result.message}`);
  } else if (!outcome.ok) {
    if (outcome.status === 404) {
      result = { kind: "not-found", address };
    } else if (outcome.status === 429) {
      result = { kind: "rate-limited", message: `LTC Esplora 429 from ${url}` };
    } else if (outcome.parseError !== undefined) {
      result = {
        kind: "error",
        message: `LTC Esplora invalid JSON: ${outcome.parseError}`,
      };
      log("warn", `LTC Esplora /address/${address} parse failed: ${result.message}`);
    } else {
      result = {
        kind: "error",
        message: `LTC Esplora returned HTTP ${outcome.status}`,
      };
      log("warn", `LTC Esplora /address/${address} failed: ${result.message}`);
    }
  } else if (outcome.parseError !== undefined) {
    result = {
      kind: "error",
      message: `LTC Esplora invalid JSON: ${outcome.parseError}`,
    };
    log("warn", `LTC Esplora /address/${address} parse failed: ${result.message}`);
  } else {
    const body = outcome.body;
    if (!body?.chain_stats) {
      result = { kind: "error", message: "LTC Esplora missing chain_stats" };
      log("warn", `LTC Esplora /address/${address} response missing chain_stats`);
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
 * `txid`, `vout`, `valueSats: bigint` (litoshis), `confirmed: boolean`,
 * optional `blockHeight: number`, and `address`.
 */
export async function fetchAddressUtxos(
  address: string,
): Promise<EsploraUtxosResult> {
  const cached = addressUtxosCache.get(address);
  const cachedTs = addressUtxosCacheTs.get(address);
  if (cached && cachedTs !== undefined && Date.now() - cachedTs < UTXOS_CACHE_TTL_MS) {
    return cached;
  }

  const url = `${_litecoinRegistry.getEsploraBaseUrl()}/address/${address}/utxo`;
  const outcome = await doFetch<EsploraUtxoBody[]>(url);

  let result: EsploraUtxosResult;
  if (outcome.timeout) {
    result = {
      kind: "error",
      message: `LTC Esplora unreachable (timeout ${ESPLORA_TIMEOUT_MS}ms)`,
    };
    log("warn", `LTC Esplora /address/${address}/utxo failed: ${result.message}`);
  } else if (outcome.networkError !== undefined) {
    result = {
      kind: "error",
      message: `LTC Esplora unreachable: ${outcome.networkError}`,
    };
    log("warn", `LTC Esplora /address/${address}/utxo failed: ${result.message}`);
  } else if (!outcome.ok) {
    if (outcome.status === 404) {
      result = { kind: "not-found", address };
    } else if (outcome.status === 429) {
      result = { kind: "rate-limited", message: `LTC Esplora 429 from ${url}` };
    } else if (outcome.parseError !== undefined) {
      result = {
        kind: "error",
        message: `LTC Esplora invalid JSON: ${outcome.parseError}`,
      };
      log("warn", `LTC Esplora /address/${address}/utxo parse failed: ${result.message}`);
    } else {
      result = {
        kind: "error",
        message: `LTC Esplora returned HTTP ${outcome.status}`,
      };
      log("warn", `LTC Esplora /address/${address}/utxo failed: ${result.message}`);
    }
  } else if (outcome.parseError !== undefined) {
    result = {
      kind: "error",
      message: `LTC Esplora invalid JSON: ${outcome.parseError}`,
    };
    log("warn", `LTC Esplora /address/${address}/utxo parse failed: ${result.message}`);
  } else {
    const body = outcome.body;
    if (!Array.isArray(body)) {
      result = { kind: "error", message: "LTC Esplora utxo response is not an array" };
      log("warn", `LTC Esplora /address/${address}/utxo response is not an array`);
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
  addressUtxosCacheTs.set(address, Date.now()); // WR-05
  return result;
}

// ───────────────────────── fetchAddressTxs ──────────────────────────

/**
 * GET /address/{addr}/txs[/chain/{afterTxid}]. Returns stripped-down
 * per-row shape — `{ txid, blockHeight?, confirmedAt?, fee }`.
 *
 * Pagination via litecoinspace.org's `:last_seen_txid` cursor (the
 * `/chain/<txid>` segment); caller passes the txid of the last row from
 * the previous page.
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

  const base = `${_litecoinRegistry.getEsploraBaseUrl()}/address/${address}/txs`;
  const url = opts?.afterTxid ? `${base}/chain/${opts.afterTxid}` : base;
  const outcome = await doFetch<EsploraTxBody[]>(url);

  let result: EsploraTxsResult;
  if (outcome.timeout) {
    result = {
      kind: "error",
      message: `LTC Esplora unreachable (timeout ${ESPLORA_TIMEOUT_MS}ms)`,
    };
    log("warn", `LTC Esplora /address/${address}/txs failed: ${result.message}`);
  } else if (outcome.networkError !== undefined) {
    result = {
      kind: "error",
      message: `LTC Esplora unreachable: ${outcome.networkError}`,
    };
    log("warn", `LTC Esplora /address/${address}/txs failed: ${result.message}`);
  } else if (!outcome.ok) {
    if (outcome.status === 404) {
      result = { kind: "not-found", address };
    } else if (outcome.status === 429) {
      result = { kind: "rate-limited", message: `LTC Esplora 429 from ${url}` };
    } else if (outcome.parseError !== undefined) {
      result = {
        kind: "error",
        message: `LTC Esplora invalid JSON: ${outcome.parseError}`,
      };
      log("warn", `LTC Esplora /address/${address}/txs parse failed: ${result.message}`);
    } else {
      result = {
        kind: "error",
        message: `LTC Esplora returned HTTP ${outcome.status}`,
      };
      log("warn", `LTC Esplora /address/${address}/txs failed: ${result.message}`);
    }
  } else if (outcome.parseError !== undefined) {
    result = {
      kind: "error",
      message: `LTC Esplora invalid JSON: ${outcome.parseError}`,
    };
    log("warn", `LTC Esplora /address/${address}/txs parse failed: ${result.message}`);
  } else {
    const body = outcome.body;
    if (!Array.isArray(body)) {
      result = { kind: "error", message: "LTC Esplora txs response is not an array" };
      log("warn", `LTC Esplora /address/${address}/txs response is not an array`);
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
//
// KEY DIVERGENCE FROM BTC ANALOG:
//
// BTC client calls `/fee-estimates` (Esplora standard 24-key shape).
// LTC client calls `/v1/fees/recommended` (mempool.space shape).
//
// litecoinspace.org is a mempool.space fork — `/fee-estimates` RETURNS
// HTTP 404 ("endpoint does not exist '/fee-estimates'") per RESEARCH
// Pitfall 1 [VERIFIED live 2026-05-22].
//
// REGRESSION ANCHOR: grep for "/v1/fees/recommended" in this file
// asserts the correct endpoint is used. grep for "/fee-estimates" (NOT
// commented) MUST return 0 — acceptance-criteria assertion.
//
// The mempool.space `{ fastestFee, halfHourFee, hourFee, economyFee,
// minimumFee }` response is mapped to the standard 5-key object INSIDE
// this client (not in the tool layer). The tool layer's projection loop
// `for (const key of TARGET_KEYS)` works unchanged because the mapping
// produces exactly { "1", "2", "3", "6", "144" }.
//
// Source: Live litecoinspace.org API test 2026-05-22 (RESEARCH Pattern 1):
// GET /api/v1/fees/recommended
// → {"fastestFee":1,"halfHourFee":1,"hourFee":1,"economyFee":1,"minimumFee":1}

/**
 * GET /v1/fees/recommended. Maps the mempool.space response shape to
 * the standard 5-target sat/vB object `{ "1", "2", "3", "6", "144" }`.
 *
 * NEVER calls the BTC-only endpoint — that returns HTTP 404 on
// litecoinspace.org (RESEARCH Pitfall 1 REGRESSION ANCHOR).
 *
 * WR-05: 60s TTL prevents stale fee rates within a busy session.
 */
export async function fetchFeeEstimates(): Promise<EsploraFeeEstimatesResult> {
  const cached = feeEstimatesCache.get(FEE_ESTIMATES_CACHE_KEY);
  const cachedTs = feeEstimatesCacheTs.get(FEE_ESTIMATES_CACHE_KEY);
  if (cached && cachedTs !== undefined && Date.now() - cachedTs < FEE_ESTIMATES_CACHE_TTL_MS) {
    return cached;
  }

  // CORRECT endpoint for litecoinspace.org (mempool.space fork):
  // /v1/fees/recommended (mempool.space shape — Pitfall 1 REGRESSION ANCHOR)
  const url = `${_litecoinRegistry.getEsploraBaseUrl()}/v1/fees/recommended`;
  const outcome = await doFetch<LtcFeesBody>(url);

  let result: EsploraFeeEstimatesResult;
  if (outcome.timeout) {
    result = {
      kind: "error",
      message: `LTC Esplora unreachable (timeout ${ESPLORA_TIMEOUT_MS}ms)`,
    };
    log("warn", `LTC Esplora /v1/fees/recommended failed: ${result.message}`);
  } else if (outcome.networkError !== undefined) {
    result = {
      kind: "error",
      message: `LTC Esplora unreachable: ${outcome.networkError}`,
    };
    log("warn", `LTC Esplora /v1/fees/recommended failed: ${result.message}`);
  } else if (!outcome.ok) {
    if (outcome.status === 404) {
      result = { kind: "not-found" };
    } else if (outcome.status === 429) {
      result = { kind: "rate-limited", message: `LTC Esplora 429 from ${url}` };
    } else if (outcome.parseError !== undefined) {
      result = {
        kind: "error",
        message: `LTC Esplora invalid JSON: ${outcome.parseError}`,
      };
      log("warn", `LTC Esplora /v1/fees/recommended parse failed: ${result.message}`);
    } else {
      result = {
        kind: "error",
        message: `LTC Esplora returned HTTP ${outcome.status}`,
      };
      log("warn", `LTC Esplora /v1/fees/recommended failed: ${result.message}`);
    }
  } else if (outcome.parseError !== undefined) {
    result = {
      kind: "error",
      message: `LTC Esplora invalid JSON: ${outcome.parseError}`,
    };
    log("warn", `LTC Esplora /v1/fees/recommended parse failed: ${result.message}`);
  } else {
    const body = outcome.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      result = {
        kind: "error",
        message: "LTC Esplora /v1/fees/recommended response is not an object",
      };
      log("warn", "LTC Esplora /v1/fees/recommended response shape unexpected");
    } else {
      // Map mempool.space shape → standard 5-key fee-estimates shape.
      // Source: RESEARCH Pattern 1 — live litecoinspace.org API 2026-05-22.
      const estimates: Record<string, number> = {
        "1": typeof body.fastestFee === "number" ? body.fastestFee : 1,
        "2": typeof body.halfHourFee === "number" ? body.halfHourFee : 1,
        "3": typeof body.hourFee === "number" ? body.hourFee : 1,
        "6": typeof body.economyFee === "number" ? body.economyFee : 1,
        "144": typeof body.minimumFee === "number" ? body.minimumFee : 1,
      };
      result = { kind: "ok", estimates };
    }
  }

  cacheInsert(feeEstimatesCache, FEE_ESTIMATES_CACHE_KEY, result);
  feeEstimatesCacheTs.set(FEE_ESTIMATES_CACHE_KEY, Date.now()); // WR-05
  return result;
}

// ───────────────────────── broadcastTx ──────────────────────────────
//
// POST /tx to Esplora. NEVER-throws discriminated union:
// { kind: "ok"; txid } | { kind: "rejected"; message } | { kind: "error"; message }.
//
// Esplora broadcast semantics: 200 OK → plain-text txid.
// 400 Bad Request → mempool rejection reason. Other → error.

export type EsploraBroadcastResult =
  | { kind: "ok"; txid: string }
  | { kind: "rejected"; message: string }
  | { kind: "error"; message: string };

/**
 * Broadcast a finalized raw transaction hex via Esplora `POST /tx`.
 * NEVER throws — returns a discriminated union.
 */
export async function broadcastTx(
  rawTxHex: string,
): Promise<EsploraBroadcastResult> {
  const url = `${_litecoinRegistry.getEsploraBaseUrl()}/tx`;
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
      return { kind: "rejected", message: text };
    }
    return {
      kind: "error",
      message: `LTC Esplora POST /tx HTTP ${resp.status}: ${text}`,
    };
  } catch (err) {
    const e = err as Error;
    if (e?.name === "AbortError") {
      return { kind: "error", message: `LTC Esplora broadcast timeout (${ESPLORA_TIMEOUT_MS}ms)` };
    }
    return { kind: "error", message: `LTC Esplora unreachable: ${e?.message ?? String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────────── Test-only cache reset ─────────────────────

/**
 * Clear ALL module-scope caches. Test-only — production code never
 * calls this. Mirror of `_resetEsploraCacheForTesting` in the BTC client.
 */
export function _resetEsploraCacheForTesting(): void {
  addressInfoCache.clear();
  addressUtxosCache.clear();
  addressUtxosCacheTs.clear(); // WR-05
  addressTxsCache.clear();
  feeEstimatesCache.clear();
  feeEstimatesCacheTs.clear(); // WR-05
}
