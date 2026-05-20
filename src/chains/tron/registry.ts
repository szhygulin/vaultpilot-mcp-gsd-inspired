// src/chains/tron/registry.ts — Phase 17 Plan 17-01.
//
// Lazy-singleton `TronWeb` factory for TRON mainnet. Mirror of
// `src/chains/solana/registry.ts` shape — single cluster (mainnet); no
// shorthand fan-out (TronGrid / GetBlock / NowNodes are URL-only, per
// research § Topic 5 lock). Resolution priority:
//
//   (1) `TRON_RPC_URL` env override wins unconditionally
//   (2) Public RPC fallback (`https://api.trongrid.io`) with once-per-
//       process stderr `warn` (mirrors `warnedFallback` latch at
//       `chains/solana/registry.ts:55`)
//
// Locked SDK decision (DF-1, research § Topic 1): `tronweb@6.3.0` (TF
// official, TS-rewritten). `@tronprotocol/sdk` REJECTED — npm 404
// (hallucinated by an earlier phase-context anchor).
//
// ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
// convention. The internal `getTronWeb()` call site is routed through
// `_tronRegistry.getTronWeb` so `vi.spyOn(_tronRegistry, ...)` intercepts
// — `tron-rpc-client.ts` MUST call through this indirection, never
// bare-import `getTronWeb` from this file. Mirror of `_solanaRegistry`
// at `chains/solana/registry.ts:140-144`.

import { TronWeb } from "tronweb";

import { getTronRpcUrl } from "../../config/env.js";
import { log } from "../../diagnostics/logger.js";

/**
 * Default public TRON RPC. TronGrid (mainnet) is the official TF-hosted
 * endpoint and requires no API key for the read methods Phase 17 uses
 * (`getBalance`, `getCurrentBlock`, contract `view` calls). Verified
 * live in research § Topic 5.
 *
 * Operators with rate-limit pressure or private-node policies set
 * `TRON_RPC_URL` to override.
 */
const PUBLIC_RPC_FALLBACK = "https://api.trongrid.io";

let cachedTronWeb: TronWeb | null = null;
let cachedUrl: string | null = null;
let warnedFallback = false;

/**
 * Resolve the TRON RPC URL. Env override wins; otherwise return the
 * public fallback with `isFallback: true` so the warn-latch can fire.
 *
 * Pure — no side effects. The warn-latch lives in `getTronWeb()`.
 */
function resolveTronRpcUrl(): { url: string; isFallback: boolean } {
  const override = getTronRpcUrl();
  if (override !== null) return { url: override, isFallback: false };
  return { url: PUBLIC_RPC_FALLBACK, isFallback: true };
}

/**
 * Lazy-singleton `TronWeb` factory. First call resolves the URL,
 * constructs `new TronWeb({ fullHost: url })`, caches both. Subsequent
 * calls return the cached instance.
 *
 * Once-per-process fallback warn: when the env URL is unset AND this is
 * the first call to construct the fallback, emit a stderr `warn` naming
 * the fallback URL. The warn-latch (`warnedFallback`) prevents re-warn on
 * subsequent calls — mirrors `warnedFallback` at
 * `chains/solana/registry.ts:86-92`.
 */
function getTronWeb(): TronWeb {
  if (cachedTronWeb) return cachedTronWeb;

  const { url, isFallback } = resolveTronRpcUrl();
  cachedUrl = url;

  if (isFallback && !warnedFallback) {
    log(
      "warn",
      `Using public TRON RPC fallback (${url}); set TRON_RPC_URL for production reliability`,
    );
    warnedFallback = true;
  }

  cachedTronWeb = new TronWeb({ fullHost: url });
  return cachedTronWeb;
}

/**
 * Returns the RPC URL the current cached `TronWeb` was constructed
 * against. Lazy: if no `TronWeb` has been constructed yet, calls
 * `getTronWeb()` first so the URL resolution + warn-once side effects
 * fire deterministically.
 *
 * Surfaced in `get_vaultpilot_config_status` (Plan 17-03) as a
 * `tronRpcUrl` diagnostic — the operator sees which URL is in flight
 * without having to read the env or guess.
 */
function getResolvedRpcUrl(): string {
  if (cachedUrl === null) getTronWeb();
  return cachedUrl as unknown as string;
}

/**
 * Test-only — clears the cached `TronWeb` + URL + warn-latch so each
 * test starts from a clean process state. Production code MUST NOT call
 * this; the resolution is intentionally memoized so a runtime
 * `delete process.env.TRON_RPC_URL` between tool calls does NOT flip
 * RPC targets silently. Mirror of `_resetSolanaRegistryForTesting` at
 * `chains/solana/registry.ts:122-126`.
 */
export function _resetTronRegistryForTesting(): void {
  cachedTronWeb = null;
  cachedUrl = null;
  warnedFallback = false;
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
 * convention. `tron-rpc-client.ts` imports `_tronRegistry` and calls
 * `_tronRegistry.getTronWeb()` so tests can `vi.spyOn` to intercept
 * the live `TronWeb` construction. Direct `vi.spyOn(module, "getTronWeb")`
 * is a silent no-op for cross-export internal calls — ESM named-export
 * bindings are immutable (CLAUDE.md convention non-negotiable).
 *
 * Re-exports `getTronRpcUrl` so tests that need to intercept the env
 * resolution at the registry level have a single object to mock.
 */
export const _tronRegistry = {
  getTronWeb,
  getResolvedRpcUrl,
  getTronRpcUrl,
};

// Public surface — `getTronWeb` + `getResolvedRpcUrl` are the only
// production exports. Internal callers (`tron-rpc-client.ts`) MUST route
// through `_tronRegistry.getTronWeb` to preserve the test seam.
export { PUBLIC_RPC_FALLBACK, getTronWeb, getResolvedRpcUrl };
