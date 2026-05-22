// src/chains/litecoin/registry.ts — Phase 26 Plan 26-01 (LTC-READ-01 / LTC-READ-02).
//
// Lazy-singleton Esplora endpoint factory for LTC mainnet. Mirror of
// `src/chains/bitcoin/registry.ts` shape — single endpoint family; no
// shorthand fan-out. Resolution priority:
//
//   (1) `LITECOIN_ESPLORA_URL` env override wins unconditionally
//   (2) Public litecoinspace.org fallback with once-per-process stderr
//       `warn` (mirrors `warnedFallback` latch at `chains/bitcoin/registry.ts:44`)
//
// litecoinspace.org is the canonical LTC Esplora API equivalent.
// It is a mempool.space fork — address/UTXO/txs endpoints ARE
// Esplora-compatible; the fee-estimates endpoint is NOT (it uses
// `/api/v1/fees/recommended`, not `/fee-estimates` — RESEARCH Pitfall 1).
// The distinction is handled in `esplora-client.ts`.
//
// ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
// convention. The LTC Esplora HTTP client (`esplora-client.ts`) calls
// `_litecoinRegistry.getEsploraBaseUrl()` rather than bare-importing
// `getEsploraBaseUrl` so `vi.spyOn(_litecoinRegistry, ...)` intercepts.
// Direct `vi.spyOn(module, "getEsploraBaseUrl")` is a silent no-op for
// cross-export internal calls — ESM named-export bindings are immutable.

import { getLitecoinEsploraUrl } from "../../config/env.js";
import { log } from "../../diagnostics/logger.js";

/**
 * Default public litecoinspace.org Esplora endpoint.
 * litecoinspace.org is Esplora-compatible for address/UTXO/txs paths; the
 * fee-estimates endpoint differs (mempool.space shape — handled in
 * esplora-client.ts). No API key required for read-only paths.
 *
 * Operators with rate-limit pressure or self-hosted-Esplora policies
 * set `LITECOIN_ESPLORA_URL` to override.
 */
export const PUBLIC_LITECOIN_ESPLORA_FALLBACK = "https://litecoinspace.org/api";

let cachedUrl: string | null = null;
let warnedFallback = false;

/**
 * Resolve the LTC Esplora base URL. Env override wins; otherwise return
 * the public fallback with `isFallback: true` so the warn-latch can fire.
 *
 * Pure — no side effects. The warn-latch lives in `getEsploraBaseUrl()`.
 */
function resolveEsploraUrl(): { url: string; isFallback: boolean } {
  const override = getLitecoinEsploraUrl();
  if (override !== null) return { url: override, isFallback: false };
  return { url: PUBLIC_LITECOIN_ESPLORA_FALLBACK, isFallback: true };
}

/**
 * Lazy-singleton Esplora-base-URL accessor. First call resolves the URL
 * and caches it; subsequent calls return the cached value.
 *
 * Once-per-process fallback warn: when the env URL is unset AND this is
 * the first call to construct the fallback, emit a stderr `warn` naming
 * the fallback URL. The warn-latch (`warnedFallback`) prevents re-warn
 * on subsequent calls — mirror of `warnedFallback` at
 * `chains/bitcoin/registry.ts:44`.
 */
function getEsploraBaseUrl(): string {
  if (cachedUrl) return cachedUrl;

  const { url, isFallback } = resolveEsploraUrl();
  cachedUrl = url;

  if (isFallback && !warnedFallback) {
    log(
      "warn",
      `Using public LTC Esplora fallback (${url}); set LITECOIN_ESPLORA_URL for production reliability`,
    );
    warnedFallback = true;
  }

  return cachedUrl;
}

/**
 * Test-only — clears the cached URL + warn-latch so each test starts
 * from a clean process state. Production code MUST NOT call this; the
 * resolution is intentionally memoized so a runtime
 * `delete process.env.LITECOIN_ESPLORA_URL` between tool calls does NOT
 * flip endpoints silently. Mirror of `_resetBitcoinRegistryForTesting` at
 * `chains/bitcoin/registry.ts:94-97`.
 */
export function _resetLitecoinRegistryForTesting(): void {
  cachedUrl = null;
  warnedFallback = false;
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
 * convention. `esplora-client.ts` imports `_litecoinRegistry` and calls
 * `_litecoinRegistry.getEsploraBaseUrl()` so tests can `vi.spyOn` to
 * intercept the live URL resolution. Direct
 * `vi.spyOn(module, "getEsploraBaseUrl")` is a silent no-op for
 * cross-export internal calls — ESM named-export bindings are immutable
 * (CLAUDE.md convention non-negotiable).
 *
 * Re-exports `getLitecoinEsploraUrl` so tests that need to intercept the env
 * resolution at the registry level have a single object to mock.
 *
 * `getResolvedEsploraUrl` is an alias for `getEsploraBaseUrl` — diagnostic
 * surface expects this name. Same shape as BTC's `_bitcoinRegistry.getResolvedEsploraUrl`.
 */
export const _litecoinRegistry = {
  getEsploraBaseUrl,
  getResolvedEsploraUrl: getEsploraBaseUrl, // alias for diagnostics surface
  getLitecoinEsploraUrl,
};

// Public surface — `getEsploraBaseUrl` is the only production export.
// Internal callers (`esplora-client.ts`) MUST route through
// `_litecoinRegistry.getEsploraBaseUrl` to preserve the test seam.
export { getEsploraBaseUrl };
