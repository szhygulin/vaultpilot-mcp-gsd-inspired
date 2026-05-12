// Best-effort selector → human-readable signature lookup against
// 4byte.directory's public HTTP API. This is PREP-06's selector-decode
// surface for the trust-pipeline cross-check block.
//
// Per the "no silent fallbacks" CLAUDE.md rule + research § Q9:
//   - error / not-applicable / not-found / found are FOUR DISTINCT
//     members of the discriminated union; `error` is structurally
//     different from `not-found`. A future contributor cannot
//     accidentally mask a 5xx / timeout / network failure as
//     `not-found` — the type system would catch it.
//   - HTTP 5xx, AbortController timeout, network unreachable, JSON
//     parse failure all return `{ kind: "error", message: <verbatim> }`.
//     The upstream error message ships through to the cross-check
//     block; the user sees the failure mode, not a fake "no match".
//
// Multi-selector-collision case (research § Q9):
//   4byte.directory contains intentional spam in some entries
//   (selector `0x00000000` returns dozens of entries). Phase 4
//   returns the FIRST entry's `text_signature`. v1.3 SEC-35
//   dispatch-target allowlist narrows further via a known-good
//   ABI cross-check.
//
// The function NEVER throws — callers (Plan 04-03 `preview_send`,
// Plan 04-05 `get_tx_verification`) treat it as best-effort.
//
// All diagnostic logs go through `src/diagnostics/logger.ts` →
// `process.stderr`. NEVER `console.*` — stdout carries the MCP
// protocol; crossing the wires breaks the client.

import type { Hex } from "viem";

import { log } from "../diagnostics/logger.js";

const FOURBYTE_API_URL = "https://www.4byte.directory/api/v1/signatures/";
const FOURBYTE_TIMEOUT_MS = 1500;
const CACHE_MAX_ENTRIES = 256;

export type FourbyteResult =
  | { kind: "not-applicable" }
  | { kind: "found"; textSignature: string }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

interface FourbyteApiResponse {
  count?: number;
  results?: Array<{ text_signature?: string; hex_signature?: string }>;
}

// Module-scope LRU cache. Process-local; dies with the process by design
// (Pitfall 5 — no persistence). Insertion-order iteration on `Map` is
// equivalent to LRU when we never touch entries after insertion.
const cache = new Map<Hex, FourbyteResult>();

/**
 * Best-effort selector → text_signature lookup. Never throws; returns
 * a `FourbyteResult` discriminated union with four kinds.
 *
 * - `null` selector → `not-applicable` (no network call; native sends
 *   have `data === "0x"` and pass `null`).
 * - 200 OK + non-empty results → `found` (first entry's text_signature).
 * - 200 OK + empty results → `not-found`.
 * - HTTP 5xx / 4xx / AbortController timeout / network unreachable /
 *   JSON-parse failure → `error` with verbatim upstream message.
 *
 * Caches all four kinds for the rest of the process (LRU with
 * `CACHE_MAX_ENTRIES = 256`). Error caching prevents hammering a down
 * API.
 */
export async function lookupSelector(selector: Hex | null): Promise<FourbyteResult> {
  if (selector === null) return { kind: "not-applicable" };

  const cached = cache.get(selector);
  if (cached) return cached;

  const url = `${FOURBYTE_API_URL}?hex_signature=${selector}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FOURBYTE_TIMEOUT_MS);

  let result: FourbyteResult;
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      result = {
        kind: "error",
        message: `4byte.directory returned HTTP ${resp.status}`,
      };
      log("warn", `4byte.directory lookup failed for ${selector}: ${result.message}`);
    } else {
      let body: FourbyteApiResponse;
      try {
        body = (await resp.json()) as FourbyteApiResponse;
      } catch (parseErr) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        result = {
          kind: "error",
          message: `4byte.directory invalid response shape: ${msg}`,
        };
        log("warn", `4byte.directory lookup failed for ${selector}: ${result.message}`);
        cacheInsert(selector, result);
        return result;
      }
      const results = body.results;
      if (!results || results.length === 0) {
        result = { kind: "not-found" };
      } else {
        // Multi-collision case — Phase 4 returns the first entry's
        // text_signature (research § Q9). v1.3 SEC-35 narrows further
        // via dispatch-target allowlist. Verbatim surface per PREP-06.
        const first = results[0];
        const text = first?.text_signature;
        if (typeof text !== "string") {
          result = {
            kind: "error",
            message: "4byte.directory invalid response shape: missing text_signature",
          };
          log(
            "warn",
            `4byte.directory lookup failed for ${selector}: ${result.message}`,
          );
        } else {
          result = { kind: "found", textSignature: text };
        }
      }
    }
  } catch (err) {
    const errorObj = err as Error;
    if (errorObj?.name === "AbortError") {
      result = {
        kind: "error",
        message: "4byte.directory unreachable (timeout 1.5s)",
      };
    } else {
      result = {
        kind: "error",
        message: `4byte.directory unreachable: ${errorObj?.message ?? String(err)}`,
      };
    }
    log("warn", `4byte.directory lookup failed for ${selector}: ${result.message}`);
  } finally {
    // ALWAYS clear the timer to prevent a timer leak on the happy path
    // (otherwise `setTimeout` keeps the event loop alive for ~1.5s after
    // a fast response).
    clearTimeout(timer);
  }

  cacheInsert(selector, result);
  return result;
}

function cacheInsert(selector: Hex, result: FourbyteResult): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Insertion-order iteration → first key is the oldest. Evict one
    // entry to make room.
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(selector, result);
}

/**
 * Clear the module-scope cache. Test-only — production code never
 * calls this. Underscore-prefix convention matches Phase 2's
 * `_resetPriceCacheForTesting` + Phase 4's `_resetHandleStoreForTesting`.
 */
export function _resetFourbyteCacheForTesting(): void {
  cache.clear();
}
