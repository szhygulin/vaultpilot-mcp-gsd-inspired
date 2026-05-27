// Phase 36 Plan 36-01 — Safe Tx Service HTTP client (SAFE-03).
//
// Per-chain Safe Transaction Service API client. Read-only — Phase 36 ships
// the read foundation; Phase 37 adds the signature-submission write surface
// on top.
//
// URL pattern (RESEARCH § Topic 1 — supersedes CONTEXT.md):
//   https://api.safe.global/tx-service/{shortname}/api
// The old `https://safe-transaction-{chain}.safe.global` hosts issue 308
// redirects to this endpoint family. The new endpoints require an
// `Authorization: Bearer ${key}` header for any non-trivial usage
// (unauthenticated tier is 2 req/s + 5k/month total).
//
// Per-chain shortname mapping (RESEARCH § lines 601-615 — verbatim from
// `@safe-global/api-kit@main/utils/config.ts`):
//   1 (Ethereum)  → "eth"
//   10 (Optimism) → "oeth"
//   137 (Polygon) → "pol"
//   8453 (Base)   → "base"
//   42161 (Arb)   → "arb1"
//
// Endpoint path mix (RESEARCH § lines 621-629 — verbatim from
// `safe-core-sdk@main/api-kit/src/SafeApiKit.ts`):
//   GET {base}/v1/owners/{owner}/safes/                                 — owners enumeration
//   GET {base}/v1/safes/{safe}/                                         — Safe metadata
//   GET {base}/v2/safes/{safe}/multisig-transactions/?…&ordering=nonce  — pending tx list
//   GET {base}/v2/multisig-transactions/{safeTxHash}/                   — single SafeTx detail
// NOTE the v1 vs v2 mix: owners + safe-info live on /v1/; multisig-transactions
// list + single detail live on /v2/.
//
// Never-throws contract (CLAUDE.md `<deviation_rules>` + mirror of
// `src/clients/etherscan.ts`): every code path surfaces one of FIVE arms:
//   - ok                 — verified shape, payload preserved verbatim
//   - not-found          — HTTP 404 (treated as "not registered in Tx Service")
//   - rate-limited       — HTTP 429 (with retry-after parsed) OR per-session ceiling
//   - error              — HTTP 5xx / 4xx-non-404-non-429 / timeout / parse failure
//   - unsupported-chain  — chainId not in SAFE_TX_SERVICE_ENDPOINTS (short-circuit
//                          BEFORE any network call; counter NOT consumed)
//
// Cache scheme:
//   - safeInfoCache (LRU max 32) — keyed `${chainId}:${safe}` for getSafeInfo,
//     ALSO consumed by getSafesByOwner via the `owner:${chainId}:${owner}` key
//     (shared cache space, distinct keyspace).
//   - safeTxCache (LRU max 64) — keyed `${chainId}:${safeTxHash}` for
//     getMultisigTransaction.
//   - getPendingTransactions results are NOT cached — they change frequently
//     and the per-Safe query carries a `nonce__gte` window; pinning one entry
//     would surface stale data. Per-session counter still increments.
// Cache covers ALL arms (not just `ok`) — mirrors etherscan.ts:365-366. Repeat
// lookup of a 404 / 429 / 503 returns the cached arm without re-fetching.
//
// Per-session counter (mirror of etherscan.ts:99 discipline):
//   - Increments BEFORE the network call (cached hits do NOT consume budget).
//   - Soft ceiling 30 — exceeded → rate-limited arm without fetch.
//   - Resets at MCP server restart (in-memory state).
//   - Failure paths (5xx, timeout) still consume a slot — matches
//     etherscan.ts:209-217.
//
// Lazy bearer-token auth (T-SAFE-KEY-LEAK-1 — mirror of T-ETHERSCAN-KEY-LEAK-1
// at etherscan.ts:222-223):
//   - `getSafeTxServiceApiKey()` probed at fetch time (NEVER at module load).
//   - When defined, `Authorization: Bearer ${key}` threaded into fetch headers.
//   - The key value NEVER appears in `log()` output or error messages.
//   - Diagnostic logs include `chainId + safe-or-owner-address + status code`
//     ONLY — NEVER the URL or the Authorization header.
//
// Test seam: `vi.stubGlobal("fetch", …)` at the OUTER network boundary per
// CLAUDE.md "external network clients" convention. NO `_<scope>` ESM
// indirection inside this module — the seam is one layer further out at the
// global fetch boundary.

import { type Address, type Hex } from "viem";

import { type ChainId } from "../config/contracts.js";
import { getSafeTxServiceApiKey } from "../config/env.js";
import { log } from "../diagnostics/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAFE_TX_SERVICE_BASE = "https://api.safe.global/tx-service";

/**
 * Per-chain shortname mapping (RESEARCH § Topic 1). Verbatim from
 * `@safe-global/api-kit@main/utils/config.ts`. Adding a new chain is a 2-step
 * ritual: extend `ChainId` in `src/config/contracts.ts`, populate this record.
 */
const SAFE_TX_SERVICE_ENDPOINTS: Record<ChainId, string> = {
  1: `${SAFE_TX_SERVICE_BASE}/eth/api`,
  10: `${SAFE_TX_SERVICE_BASE}/oeth/api`,
  137: `${SAFE_TX_SERVICE_BASE}/pol/api`,
  8453: `${SAFE_TX_SERVICE_BASE}/base/api`,
  42161: `${SAFE_TX_SERVICE_BASE}/arb1/api`,
};

const SAFE_INFO_CACHE_MAX = 32;
const SAFE_TX_CACHE_MAX = 64;
const PER_SESSION_CALL_LIMIT = 30;
// 2× etherscan's 3000ms — Safe Tx Service has higher latency than Etherscan V2
// (especially the v2 multisig-transactions endpoint with pagination + count).
const SAFE_TX_SERVICE_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Wire types (RESEARCH § lines 639-700 — verbatim from
// `safe-core-sdk@main/api-kit/src/types/safeTransactionServiceTypes.ts`).
// Numeric fields are JSON STRINGS over the wire (Pitfall 3); the decoder
// preserves them verbatim.
// ---------------------------------------------------------------------------

export interface SafeInfoResponseDecoded {
  address: Address;
  nonce: string;
  threshold: number;
  owners: Address[];
  singleton: Address;
  modules: Address[];
  fallbackHandler: Address;
  guard: Address;
  version: string;
}

export interface SafeMultisigConfirmationResponse {
  owner: Address;
  signature: string;
  signatureType: "EOA" | "ETH_SIGN" | "CONTRACT_SIGNATURE" | "APPROVED_HASH";
}

export interface SafeMultisigTransactionResponse {
  safe: Address;
  to: Address;
  value: string;
  data?: string | null;
  operation: number; // 0=Call, 1=DelegateCall — Plan 36-02 maps to "call"|"delegatecall"
  gasToken: Address;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  refundReceiver?: Address;
  nonce: string;
  safeTxHash: string;
  confirmationsRequired: number;
  // Pitfall 6 anchor — OPTIONAL field; `undefined` for un-signed pending txs.
  // Consumers do `tx.confirmations ?? []` at use site.
  confirmations?: SafeMultisigConfirmationResponse[];
  signatures: string | null;
  isExecuted: boolean;
}

// ---------------------------------------------------------------------------
// Result types — 5-arm discriminated union per method (CLAUDE.md
// never-throws contract).
// ---------------------------------------------------------------------------

export type SafesByOwnerResult =
  | { kind: "ok"; safes: Address[] }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string; retryAfterMs?: number }
  | { kind: "error"; message: string }
  | { kind: "unsupported-chain"; chainId: ChainId };

export type SafeInfoResult =
  | { kind: "ok"; safe: SafeInfoResponseDecoded }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string; retryAfterMs?: number }
  | { kind: "error"; message: string }
  | { kind: "unsupported-chain"; chainId: ChainId };

export type PendingListResult =
  | { kind: "ok"; pending: SafeMultisigTransactionResponse[]; totalCount: number }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string; retryAfterMs?: number }
  | { kind: "error"; message: string }
  | { kind: "unsupported-chain"; chainId: ChainId };

export type SafeTxResult =
  | { kind: "ok"; tx: SafeMultisigTransactionResponse }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string; retryAfterMs?: number }
  | { kind: "error"; message: string }
  | { kind: "unsupported-chain"; chainId: ChainId };

// ---------------------------------------------------------------------------
// Module-scope state (process-local; resets at MCP server restart).
// ---------------------------------------------------------------------------

// Shared cache space: getSafeInfo keys are `${chainId}:${safe}`;
// getSafesByOwner keys are `owner:${chainId}:${owner}`. Distinct keyspace, one
// LRU eviction policy.
const safeInfoCache = new Map<string, SafeInfoResult | SafesByOwnerResult>();
const safeTxCache = new Map<string, SafeTxResult>();
let agentSessionCallCount = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generic LRU insertion. Insertion-order iteration on `Map` is equivalent to
 * LRU when we never touch entries after insertion. Mirrors etherscan.ts:369-377.
 */
function cacheInsert<T>(cache: Map<string, T>, max: number, key: string, value: T): void {
  if (cache.size >= max) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, value);
}

/**
 * Build the fetch headers. Lazy env-key probe — the key value is read
 * fresh on every call so a runtime env mutation (e.g. setup-skill setting
 * SAFE_TX_SERVICE_API_KEY mid-session) is picked up automatically.
 * T-SAFE-KEY-LEAK-1: the key VALUE is NEVER logged — diagnostics carry the
 * chainId + address + status only.
 */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = getSafeTxServiceApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * Map an HTTP response to a tagged outcome (independent of the per-endpoint
 * decoder). Returns either a terminal DU arm OR `{ kind: "decode", body }`
 * which the caller json-decodes.
 */
type HttpOutcome<E> =
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string; retryAfterMs?: number }
  | { kind: "error"; message: string }
  | { kind: "decode"; body: unknown }
  | E;

async function readResponse(resp: Response): Promise<HttpOutcome<never>> {
  if (resp.status === 404) {
    return { kind: "not-found" };
  }
  if (resp.status === 429) {
    const retryAfter = resp.headers.get("retry-after");
    return {
      kind: "rate-limited",
      message: `Safe Tx Service returned HTTP 429${retryAfter ? ` (retry-after: ${retryAfter})` : ""}`,
      retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : undefined,
    };
  }
  if (!resp.ok) {
    return {
      kind: "error",
      message: `Safe Tx Service returned HTTP ${resp.status}`,
    };
  }
  let body: unknown;
  try {
    body = await resp.json();
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    return {
      kind: "error",
      message: `Safe Tx Service invalid JSON response: ${msg}`,
    };
  }
  return { kind: "decode", body };
}

/**
 * Wrap a network error into the `error` DU arm. AbortError (timeout) gets a
 * distinct message verbatim — easier to triage in logs.
 */
function networkErrorToArm(err: unknown): { kind: "error"; message: string } {
  const errorObj = err as Error;
  if (errorObj?.name === "AbortError") {
    return {
      kind: "error",
      message: `Safe Tx Service unreachable (timeout ${SAFE_TX_SERVICE_TIMEOUT_MS}ms)`,
    };
  }
  return {
    kind: "error",
    message: `Safe Tx Service unreachable: ${errorObj?.message ?? String(err)}`,
  };
}

/**
 * Per-session-ceiling check. Returns the rate-limited arm pre-fetch when
 * exceeded; caller short-circuits without consuming the budget further.
 */
function ceilingExceededArm(): { kind: "rate-limited"; message: string } {
  return {
    kind: "rate-limited",
    message: `Safe Tx Service per-session limit (${PER_SESSION_CALL_LIMIT} calls) exceeded; resets at MCP server restart.`,
  };
}

// ---------------------------------------------------------------------------
// Public API — getSafesByOwner
// ---------------------------------------------------------------------------

/**
 * Enumerate Safes where `owner` is a current owner. Returns the verbatim
 * Tx Service list (Plan 36-02 cross-checks each entry against on-chain
 * `getOwners()`).
 *
 * URL: GET {endpoint}/v1/owners/{owner}/safes/
 *
 * Pitfall 7: HTTP 404 surfaces as the `not-found` arm. Plan 36-02 maps this
 * to `{ safes: [] }` at the consumer layer (Tx Service indexer lag for very
 * fresh wallets is indistinguishable from "no Safes" without on-chain probe).
 */
export async function getSafesByOwner(
  chainId: ChainId,
  owner: Address,
): Promise<SafesByOwnerResult> {
  const endpoint = SAFE_TX_SERVICE_ENDPOINTS[chainId];
  if (!endpoint) return { kind: "unsupported-chain", chainId };

  const cacheKey = `owner:${chainId}:${owner}`;
  const cached = safeInfoCache.get(cacheKey) as SafesByOwnerResult | undefined;
  if (cached) return cached;

  if (agentSessionCallCount >= PER_SESSION_CALL_LIMIT) {
    return ceilingExceededArm();
  }
  agentSessionCallCount += 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAFE_TX_SERVICE_TIMEOUT_MS);

  let result: SafesByOwnerResult;
  try {
    const url = `${endpoint}/v1/owners/${owner}/safes/`;
    const resp = await fetch(url, {
      headers: buildHeaders(),
      signal: controller.signal,
    });
    const outcome = await readResponse(resp);
    if (outcome.kind === "decode") {
      const body = outcome.body as { safes?: unknown } | null | undefined;
      const safes = body && Array.isArray(body.safes) ? (body.safes as Address[]) : null;
      if (safes === null) {
        result = {
          kind: "error",
          message: "Safe Tx Service getSafesByOwner: malformed response shape",
        };
        log("warn", `Safe Tx Service getSafesByOwner failed for chain=${chainId} owner=${owner}: ${result.message}`);
      } else {
        result = { kind: "ok", safes };
      }
    } else {
      result = outcome;
      if (outcome.kind === "error") {
        log("warn", `Safe Tx Service getSafesByOwner failed for chain=${chainId} owner=${owner}: ${outcome.message}`);
      }
    }
  } catch (err) {
    result = networkErrorToArm(err);
    log("warn", `Safe Tx Service getSafesByOwner failed for chain=${chainId} owner=${owner}: ${result.kind === "error" ? result.message : ""}`);
  } finally {
    clearTimeout(timer);
  }

  cacheInsert(safeInfoCache, SAFE_INFO_CACHE_MAX, cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Public API — getSafeInfo
// ---------------------------------------------------------------------------

/**
 * Fetch Safe metadata (owners, threshold, nonce, modules, version) from
 * the Tx Service. Plan 36-02 cross-checks these values against on-chain
 * reads to populate `txServiceDrift`.
 *
 * URL: GET {endpoint}/v1/safes/{safe}/
 */
export async function getSafeInfo(
  chainId: ChainId,
  safe: Address,
): Promise<SafeInfoResult> {
  const endpoint = SAFE_TX_SERVICE_ENDPOINTS[chainId];
  if (!endpoint) return { kind: "unsupported-chain", chainId };

  const cacheKey = `${chainId}:${safe}`;
  const cached = safeInfoCache.get(cacheKey) as SafeInfoResult | undefined;
  if (cached) return cached;

  if (agentSessionCallCount >= PER_SESSION_CALL_LIMIT) {
    return ceilingExceededArm();
  }
  agentSessionCallCount += 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAFE_TX_SERVICE_TIMEOUT_MS);

  let result: SafeInfoResult;
  try {
    const url = `${endpoint}/v1/safes/${safe}/`;
    const resp = await fetch(url, {
      headers: buildHeaders(),
      signal: controller.signal,
    });
    const outcome = await readResponse(resp);
    if (outcome.kind === "decode") {
      const body = outcome.body as Partial<SafeInfoResponseDecoded> | null | undefined;
      if (
        !body ||
        typeof body.address !== "string" ||
        typeof body.nonce !== "string" ||
        typeof body.threshold !== "number" ||
        !Array.isArray(body.owners) ||
        typeof body.singleton !== "string" ||
        !Array.isArray(body.modules) ||
        typeof body.version !== "string"
      ) {
        result = {
          kind: "error",
          message: "Safe Tx Service getSafeInfo: malformed response shape",
        };
        log("warn", `Safe Tx Service getSafeInfo failed for chain=${chainId} safe=${safe}: ${result.message}`);
      } else {
        result = {
          kind: "ok",
          safe: {
            address: body.address as Address,
            nonce: body.nonce,
            threshold: body.threshold,
            owners: body.owners as Address[],
            singleton: body.singleton as Address,
            modules: body.modules as Address[],
            fallbackHandler: (body.fallbackHandler ?? "0x0000000000000000000000000000000000000000") as Address,
            guard: (body.guard ?? "0x0000000000000000000000000000000000000000") as Address,
            version: body.version,
          },
        };
      }
    } else {
      result = outcome;
      if (outcome.kind === "error") {
        log("warn", `Safe Tx Service getSafeInfo failed for chain=${chainId} safe=${safe}: ${outcome.message}`);
      }
    }
  } catch (err) {
    result = networkErrorToArm(err);
    log("warn", `Safe Tx Service getSafeInfo failed for chain=${chainId} safe=${safe}: ${result.kind === "error" ? result.message : ""}`);
  } finally {
    clearTimeout(timer);
  }

  cacheInsert(safeInfoCache, SAFE_INFO_CACHE_MAX, cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Public API — getPendingTransactions
// ---------------------------------------------------------------------------

/**
 * List pending multisig transactions for a Safe, ordered by nonce ascending
 * (Pitfall 8 anchor — default ordering is `-created` which would hide the
 * actionable queue head). Scoped to non-executed txs (`executed=false`) at
 * nonce >= currentNonce (`nonce__gte`).
 *
 * URL: GET {endpoint}/v2/safes/{safe}/multisig-transactions/?executed=false&nonce__gte=N&ordering=nonce&limit=20
 *
 * Results are NOT cached — the nonce window changes frequently and a single
 * cache entry would surface stale data. Per-session counter still increments.
 */
export async function getPendingTransactions(
  chainId: ChainId,
  safe: Address,
  opts: { currentNonce: bigint; limit?: number },
): Promise<PendingListResult> {
  const endpoint = SAFE_TX_SERVICE_ENDPOINTS[chainId];
  if (!endpoint) return { kind: "unsupported-chain", chainId };

  if (agentSessionCallCount >= PER_SESSION_CALL_LIMIT) {
    return ceilingExceededArm();
  }
  agentSessionCallCount += 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAFE_TX_SERVICE_TIMEOUT_MS);

  const limit = opts.limit ?? 20;
  // Pitfall 8 — `ordering=nonce` EXPLICIT; without it the default `-created`
  // surfaces newest-proposals first, hiding the actionable queue head.
  const url = `${endpoint}/v2/safes/${safe}/multisig-transactions/?executed=false&nonce__gte=${opts.currentNonce.toString()}&ordering=nonce&limit=${limit}`;

  let result: PendingListResult;
  try {
    const resp = await fetch(url, {
      headers: buildHeaders(),
      signal: controller.signal,
    });
    const outcome = await readResponse(resp);
    if (outcome.kind === "decode") {
      const body = outcome.body as
        | { count?: unknown; results?: unknown }
        | null
        | undefined;
      if (
        !body ||
        typeof body.count !== "number" ||
        !Array.isArray(body.results)
      ) {
        result = {
          kind: "error",
          message: "Safe Tx Service getPendingTransactions: malformed response shape",
        };
        log("warn", `Safe Tx Service getPendingTransactions failed for chain=${chainId} safe=${safe}: ${result.message}`);
      } else {
        result = {
          kind: "ok",
          pending: body.results as SafeMultisigTransactionResponse[],
          totalCount: body.count,
        };
      }
    } else {
      result = outcome;
      if (outcome.kind === "error") {
        log("warn", `Safe Tx Service getPendingTransactions failed for chain=${chainId} safe=${safe}: ${outcome.message}`);
      }
    }
  } catch (err) {
    result = networkErrorToArm(err);
    log("warn", `Safe Tx Service getPendingTransactions failed for chain=${chainId} safe=${safe}: ${result.kind === "error" ? result.message : ""}`);
  } finally {
    clearTimeout(timer);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API — getMultisigTransaction
// ---------------------------------------------------------------------------

/**
 * Fetch the full SafeTx record by `safeTxHash`. Plan 36-02 `get_safe_transaction`
 * is the primary consumer (best-effort calldata decode via Phase 35 ABI cache
 * happens at the orchestration tier).
 *
 * URL: GET {endpoint}/v2/multisig-transactions/{safeTxHash}/
 *
 * Pitfall 6 — `confirmations` field may be undefined for un-signed pending
 * txs; preserved verbatim, consumers do `tx.confirmations ?? []` at use site.
 */
export async function getMultisigTransaction(
  chainId: ChainId,
  safeTxHash: Hex,
): Promise<SafeTxResult> {
  const endpoint = SAFE_TX_SERVICE_ENDPOINTS[chainId];
  if (!endpoint) return { kind: "unsupported-chain", chainId };

  const cacheKey = `${chainId}:${safeTxHash}`;
  const cached = safeTxCache.get(cacheKey);
  if (cached) return cached;

  if (agentSessionCallCount >= PER_SESSION_CALL_LIMIT) {
    return ceilingExceededArm();
  }
  agentSessionCallCount += 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAFE_TX_SERVICE_TIMEOUT_MS);

  let result: SafeTxResult;
  try {
    const url = `${endpoint}/v2/multisig-transactions/${safeTxHash}/`;
    const resp = await fetch(url, {
      headers: buildHeaders(),
      signal: controller.signal,
    });
    const outcome = await readResponse(resp);
    if (outcome.kind === "decode") {
      const body = outcome.body as
        | Partial<SafeMultisigTransactionResponse>
        | null
        | undefined;
      if (
        !body ||
        typeof body.safe !== "string" ||
        typeof body.to !== "string" ||
        typeof body.value !== "string" ||
        typeof body.operation !== "number" ||
        typeof body.nonce !== "string" ||
        typeof body.safeTxHash !== "string"
      ) {
        result = {
          kind: "error",
          message: "Safe Tx Service getMultisigTransaction: malformed response shape",
        };
        log("warn", `Safe Tx Service getMultisigTransaction failed for chain=${chainId} txHash=${safeTxHash}: ${result.message}`);
      } else {
        // Preserve the entire body verbatim — including the OPTIONAL
        // `confirmations` field (Pitfall 6 — undefined ≠ empty array).
        result = {
          kind: "ok",
          tx: body as SafeMultisigTransactionResponse,
        };
      }
    } else {
      result = outcome;
      if (outcome.kind === "error") {
        log("warn", `Safe Tx Service getMultisigTransaction failed for chain=${chainId} txHash=${safeTxHash}: ${outcome.message}`);
      }
    }
  } catch (err) {
    result = networkErrorToArm(err);
    log("warn", `Safe Tx Service getMultisigTransaction failed for chain=${chainId} txHash=${safeTxHash}: ${result.kind === "error" ? result.message : ""}`);
  } finally {
    clearTimeout(timer);
  }

  cacheInsert(safeTxCache, SAFE_TX_CACHE_MAX, cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Test-only resets (mirror etherscan.ts:383-395 shape). Production code
// NEVER calls these — both caches and the counter reset at MCP server
// restart by design.
// ---------------------------------------------------------------------------

/** Clear both LRU caches. Test-only. */
export function _resetSafeTxServiceCachesForTesting(): void {
  safeInfoCache.clear();
  safeTxCache.clear();
}

/** Reset the per-session call counter to 0. Test-only. */
export function _resetSafeTxServiceRateCounterForTesting(): void {
  agentSessionCallCount = 0;
}
