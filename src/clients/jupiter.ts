// src/clients/jupiter.ts — never-throws Jupiter v6 Swap API HTTP client.
//
// Phase 14 Plan 14-01 (SOL-W-11/12). Structural clone of `src/clients/fourbyte.ts`:
// module-scope LRU cache, AbortController per-call timeout with clearTimeout in
// `finally`, `log("warn", …)` to stderr (NEVER console.* — stdout carries the MCP
// protocol). 3-arm discriminated union — fewer than etherscan's 5 (no
// not-applicable / not-verified concepts for a quote):
//
//   { kind: "ok", … } | { kind: "rate-limited" } | { kind: "error"; message }
//
// HTTP 429 → rate-limited; everything else non-2xx / timeout / network-throw /
// JSON-parse-fail → error. The function NEVER throws — callers
// (get_jupiter_quote / prepare_jupiter_swap) treat it as best-effort and map the
// non-ok arms to the project structured-error envelope.
//
// ★ FROZEN-COMPAT INVARIANT (NON-NEGOTIABLE): `asLegacyTransaction: true` is
// ALWAYS sent on BOTH `/quote` (query param) and `/swap` (body field). The FROZEN
// Solana binding accepts only legacy `Transaction.serializeMessage()` bytes; a v0
// VersionedTransaction's message bytes do NOT match (RESEARCH Q2). Passing it on
// `/quote` ALSO constrains the router to legacy-fittable routes (Pitfall 1).
//
// HOST ENV SEAM (RESEARCH A2 — de-risk the 2026-06-30 portal grandfather expiry):
//   - default keyless host:  https://lite-api.jup.ag/swap/v1
//   - JUPITER_API_KEY set →  https://api.jup.ag/swap/v1  + `x-api-key` header
// The env var is read at CALL TIME (not module load) so tests mutate it freely —
// mirror of the SOLANA_RPC_URL + getSandwichThresholds lazy-read patterns. The
// key is a rate-limit token (not a funds-authority secret — T-14-03 accept); its
// value is NEVER logged. NO SDK, NO new dependency — native `fetch` only.

import { log } from "../diagnostics/logger.js";

const JUPITER_TIMEOUT_MS = 8000;
const CACHE_MAX_ENTRIES = 128;

const KEYLESS_HOST = "https://lite-api.jup.ag/swap/v1";
const KEYED_HOST = "https://api.jup.ag/swap/v1";

// ---------------------------------------------------------------------------
// Quote envelope shape (v6 — VERIFIED against the Jupiter OpenAPI swagger.yaml).
// ---------------------------------------------------------------------------

export interface JupiterRoutePlanStep {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  /** STRING FRACTION (e.g. "0.0001" = 0.01%) — NOT bps. Multiply by 100 for percent (Pitfall 2). */
  priceImpactPct: string;
  routePlan: JupiterRoutePlanStep[];
  contextSlot?: number;
  [key: string]: unknown; // verbatim passthrough — the /swap body takes the WHOLE object (Pitfall 4)
}

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  /** Raw base-unit amount as a decimal string (e.g. "100000000"). */
  amount: string;
  slippageBps: number;
}

export type JupiterQuoteResult =
  | { kind: "ok"; quote: JupiterQuote }
  | { kind: "rate-limited" }
  | { kind: "error"; message: string };

export type JupiterSwapResult =
  | { kind: "ok"; swapTransaction: string }
  | { kind: "rate-limited" }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Host + header resolution (call-time read of JUPITER_API_KEY).
// ---------------------------------------------------------------------------

function resolveHostAndHeaders(): { host: string; headers: Record<string, string> } {
  const key = process.env.JUPITER_API_KEY;
  if (key !== undefined && key.trim().length > 0) {
    return { host: KEYED_HOST, headers: { "x-api-key": key } };
  }
  return { host: KEYLESS_HOST, headers: {} };
}

// ---------------------------------------------------------------------------
// Quote cache (LRU; insertion-order eviction). Keyed on the full quote params +
// host selection so a keyed/keyless flip does not serve a stale cross-host entry.
// ---------------------------------------------------------------------------

const quoteCache = new Map<string, JupiterQuoteResult>();

function quoteCacheKey(params: JupiterQuoteParams, host: string): string {
  return `${host}|${params.inputMint}|${params.outputMint}|${params.amount}|${params.slippageBps}`;
}

function quoteCacheInsert(key: string, result: JupiterQuoteResult): void {
  if (quoteCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = quoteCache.keys().next().value;
    if (oldest !== undefined) quoteCache.delete(oldest);
  }
  quoteCache.set(key, result);
}

// ---------------------------------------------------------------------------
// getQuote — GET {host}/quote?…&asLegacyTransaction=true. Never throws.
// ---------------------------------------------------------------------------

export async function getQuote(params: JupiterQuoteParams): Promise<JupiterQuoteResult> {
  const { host, headers } = resolveHostAndHeaders();
  const cacheKey = quoteCacheKey(params, host);
  const cached = quoteCache.get(cacheKey);
  if (cached) return cached;

  const query = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    slippageBps: String(params.slippageBps),
    // ★ FROZEN-COMPAT — ALWAYS legacy (forces a legacy-fittable route too).
    asLegacyTransaction: "true",
  });
  const url = `${host}/quote?${query.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUPITER_TIMEOUT_MS);

  let result: JupiterQuoteResult;
  try {
    const resp = await fetch(url, { signal: controller.signal, headers });
    if (resp.status === 429) {
      result = { kind: "rate-limited" };
      log("warn", "Jupiter /quote rate-limited (HTTP 429)");
    } else if (!resp.ok) {
      result = { kind: "error", message: `Jupiter /quote returned HTTP ${resp.status}` };
      log("warn", `Jupiter /quote failed: ${result.message}`);
    } else {
      try {
        const body = (await resp.json()) as JupiterQuote;
        result = { kind: "ok", quote: body };
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        result = { kind: "error", message: `Jupiter /quote invalid response shape: ${msg}` };
        log("warn", `Jupiter /quote failed: ${result.message}`);
      }
    }
  } catch (err) {
    const errorObj = err as Error;
    if (errorObj?.name === "AbortError") {
      result = { kind: "error", message: `Jupiter /quote unreachable (timeout ${JUPITER_TIMEOUT_MS}ms)` };
    } else {
      result = { kind: "error", message: `Jupiter /quote unreachable: ${errorObj?.message ?? String(err)}` };
    }
    log("warn", `Jupiter /quote failed: ${result.message}`);
  } finally {
    clearTimeout(timer);
  }

  // Cache ok + rate-limited + error (error caching prevents hammering a down API;
  // a fresh process / _resetJupiter_ForTesting clears it).
  quoteCacheInsert(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// getSwapTransaction — POST {host}/swap {quoteResponse, userPublicKey,
//   asLegacyTransaction:true, wrapAndUnwrapSol:true}. Never throws. NOT cached
//   (the swap tx is one-shot per quote+blockhash; caching would serve a stale
//   blockhash).
// ---------------------------------------------------------------------------

export async function getSwapTransaction(
  quoteResponse: JupiterQuote,
  userPublicKey: string,
): Promise<JupiterSwapResult> {
  const { host, headers } = resolveHostAndHeaders();
  const url = `${host}/swap`;

  // Pitfall 4 — POST the VERBATIM quoteResponse object back; never rebuild it.
  const body = JSON.stringify({
    quoteResponse,
    userPublicKey,
    // ★ FROZEN-COMPAT — legacy + auto wrap/unwrap SOL.
    asLegacyTransaction: true,
    wrapAndUnwrapSol: true,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUPITER_TIMEOUT_MS);

  let result: JupiterSwapResult;
  try {
    const resp = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
    if (resp.status === 429) {
      result = { kind: "rate-limited" };
      log("warn", "Jupiter /swap rate-limited (HTTP 429)");
    } else if (!resp.ok) {
      result = { kind: "error", message: `Jupiter /swap returned HTTP ${resp.status}` };
      log("warn", `Jupiter /swap failed: ${result.message}`);
    } else {
      try {
        const json = (await resp.json()) as { swapTransaction?: string };
        if (typeof json.swapTransaction !== "string") {
          result = { kind: "error", message: "Jupiter /swap invalid response shape: missing swapTransaction" };
          log("warn", `Jupiter /swap failed: ${result.message}`);
        } else {
          result = { kind: "ok", swapTransaction: json.swapTransaction };
        }
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        result = { kind: "error", message: `Jupiter /swap invalid response shape: ${msg}` };
        log("warn", `Jupiter /swap failed: ${result.message}`);
      }
    }
  } catch (err) {
    const errorObj = err as Error;
    if (errorObj?.name === "AbortError") {
      result = { kind: "error", message: `Jupiter /swap unreachable (timeout ${JUPITER_TIMEOUT_MS}ms)` };
    } else {
      result = { kind: "error", message: `Jupiter /swap unreachable: ${errorObj?.message ?? String(err)}` };
    }
    log("warn", `Jupiter /swap failed: ${result.message}`);
  } finally {
    clearTimeout(timer);
  }

  return result;
}

/**
 * Clear the module-scope quote cache. Test-only — production never calls this.
 * Underscore-prefix convention mirrors `_resetFourbyteCacheForTesting`.
 */
export function _resetJupiter_ForTesting(): void {
  quoteCache.clear();
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. The prepare/read tools import
 * `_jupiter` and call through the indirection so tests can spy on `getQuote` /
 * `getSwapTransaction` without monkey-patching the named exports (ESM bindings
 * are immutable; direct spies on named exports are no-ops for cross-export
 * internal calls). The tool tests decouple from HTTP by spying THIS object.
 */
export const _jupiter = { getQuote, getSwapTransaction };
