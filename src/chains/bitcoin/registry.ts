// src/chains/bitcoin/registry.ts — Phase 22 Plan 22-01.
//
// Lazy-singleton Esplora endpoint factory for BTC mainnet. Mirror of
// `src/chains/tron/registry.ts` shape — single endpoint family; no
// shorthand fan-out. Resolution priority:
//
//   (1) `BTC_ESPLORA_URL` env override wins unconditionally
//   (2) Public Esplora fallback (`https://blockstream.info/api`) with
//       once-per-process stderr `warn` (mirrors `warnedFallback` latch at
//       `chains/tron/registry.ts:42`)
//
// Locked endpoint decision (RESEARCH § Plan 22-01 #4 + § Standard Stack
// alternatives): blockstream.info as the default; mempool.space supported
// via `BTC_ESPLORA_URL` override. Both expose the canonical Esplora
// `/api/...` paths; the `get_btc_fee_estimates` shape standardizes on
// Esplora's `/api/fee-estimates` (24-key object) — mempool.space mirrors
// this path under `/api/fee-estimates`, NOT its proprietary
// `/v1/fees/recommended` shape (RESEARCH § Anti-Patterns).
//
// ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
// convention. The Esplora HTTP client (`esplora-client.ts`) calls
// `_bitcoinRegistry.getEsploraBaseUrl()` rather than bare-importing
// `getEsploraBaseUrl` so `vi.spyOn(_bitcoinRegistry, ...)` intercepts.
// Direct `vi.spyOn(module, "getEsploraBaseUrl")` is a silent no-op for
// cross-export internal calls — ESM named-export bindings are immutable.

import { getBtcEsploraUrl } from "../../config/env.js";
import { log } from "../../diagnostics/logger.js";

/**
 * Default public Esplora endpoint. blockstream.info is the canonical
 * read-only Esplora API and requires no API key for the address /
 * UTXO / tx-history / fee-estimate paths Phase 22 uses (verified live
 * 2026-05-21 against RESEARCH § Plan 22-01 #4). Gentler rate-limits
 * than mempool.space for read-heavy workloads (xpub-scan).
 *
 * Operators with rate-limit pressure or self-hosted-Esplora policies
 * set `BTC_ESPLORA_URL` to override (mempool.space is one common
 * alternative; both expose the standard `/api/...` paths).
 */
const PUBLIC_ESPLORA_FALLBACK = "https://blockstream.info/api";

let cachedUrl: string | null = null;
let warnedFallback = false;

/**
 * Resolve the Esplora base URL. Env override wins; otherwise return
 * the public fallback with `isFallback: true` so the warn-latch can
 * fire.
 *
 * Pure — no side effects. The warn-latch lives in `getEsploraBaseUrl()`.
 */
function resolveEsploraUrl(): { url: string; isFallback: boolean } {
  const override = getBtcEsploraUrl();
  if (override !== null) return { url: override, isFallback: false };
  return { url: PUBLIC_ESPLORA_FALLBACK, isFallback: true };
}

/**
 * Lazy-singleton Esplora-base-URL accessor. First call resolves the URL
 * and caches it; subsequent calls return the cached value.
 *
 * Once-per-process fallback warn: when the env URL is unset AND this is
 * the first call to construct the fallback, emit a stderr `warn` naming
 * the fallback URL. The warn-latch (`warnedFallback`) prevents re-warn
 * on subsequent calls — mirror of `warnedFallback` at
 * `chains/tron/registry.ts:42`.
 */
function getEsploraBaseUrl(): string {
  if (cachedUrl) return cachedUrl;

  const { url, isFallback } = resolveEsploraUrl();
  cachedUrl = url;

  if (isFallback && !warnedFallback) {
    log(
      "warn",
      `Using public Esplora fallback (${url}); set BTC_ESPLORA_URL for production reliability`,
    );
    warnedFallback = true;
  }

  return cachedUrl;
}

/**
 * Test-only — clears the cached URL + warn-latch so each test starts
 * from a clean process state. Production code MUST NOT call this; the
 * resolution is intentionally memoized so a runtime
 * `delete process.env.BTC_ESPLORA_URL` between tool calls does NOT
 * flip endpoints silently. Mirror of `_resetTronRegistryForTesting` at
 * `chains/tron/registry.ts:108-112`.
 */
export function _resetBitcoinRegistryForTesting(): void {
  cachedUrl = null;
  warnedFallback = false;
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
 * convention. `esplora-client.ts` imports `_bitcoinRegistry` and calls
 * `_bitcoinRegistry.getEsploraBaseUrl()` so tests can `vi.spyOn` to
 * intercept the live URL resolution. Direct
 * `vi.spyOn(module, "getEsploraBaseUrl")` is a silent no-op for
 * cross-export internal calls — ESM named-export bindings are immutable
 * (CLAUDE.md convention non-negotiable).
 *
 * Re-exports `getBtcEsploraUrl` so tests that need to intercept the env
 * resolution at the registry level have a single object to mock.
 *
 * `getResolvedEsploraUrl` is an alias for `getEsploraBaseUrl` — Plan
 * 22-04's `get_btc_status` diagnostic surface expects this name. Same
 * shape as TRON's `_tronRegistry.getResolvedRpcUrl`.
 */
export const _bitcoinRegistry = {
  getEsploraBaseUrl,
  getResolvedEsploraUrl: getEsploraBaseUrl, // alias for diagnostics surface
  getBtcEsploraUrl,
};

// Public surface — `getEsploraBaseUrl` is the only production export.
// Internal callers (`esplora-client.ts`) MUST route through
// `_bitcoinRegistry.getEsploraBaseUrl` to preserve the test seam.
export { PUBLIC_ESPLORA_FALLBACK, getEsploraBaseUrl };
