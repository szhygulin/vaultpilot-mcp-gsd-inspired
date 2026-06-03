// src/chains/bittensor/registry.ts — Phase 46 Plan 46-01.
//
// Lazy-singleton `ApiPromise` factory for the Bittensor subtensor chain.
// Mirror of `src/chains/solana/registry.ts` with one load-bearing
// divergence: `ApiPromise.create` is ASYNC (it opens the WS socket on
// construction), unlike Solana's synchronous `new Connection`. So:
//
//   - `getApi(): Promise<ApiPromise>` is async — every read awaits it.
//   - `getResolvedRpcUrl(): string` resolves the env-or-fallback URL
//     STRING WITHOUT calling `getApi()` (Pitfall 5). `get_bittensor_status`
//     (46-02) reads this to surface `rpcEndpoint` and MUST never hang on
//     an unreachable RPC. Resolution is pure string math — no socket.
//
// Resolution priority (mirror of the Solana / TRON / BTC sibling registries):
//   (1) `BITTENSOR_RPC_URL` env override wins unconditionally
//   (2) Public RPC fallback (`wss://entrypoint-finney.opentensor.ai:443`)
//       with a once-per-process stderr `warn` latch (`warnedFallback`).
//
// No `RPC_PROVIDER` shorthand fan-out — Bittensor is URL-config-only.
//
// ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
// convention. `tao-rpc-client.ts` imports `_bittensorRegistry` and calls
// `_bittensorRegistry.getApi()` so tests can `vi.spyOn` to intercept the
// live `ApiPromise` construction. Direct `vi.spyOn(module, "getApi")` is a
// silent no-op for the cross-export internal call — ESM named-export
// bindings are immutable (CLAUDE.md convention non-negotiable). Mirror of
// `_solanaRegistry` at `src/chains/solana/registry.ts`.

import { ApiPromise, WsProvider } from "@polkadot/api";

import { getBittensorRpcUrl } from "../../config/env.js";
import { log } from "../../diagnostics/logger.js";

/**
 * Default public subtensor RPC. The Opentensor Foundation's free Finney
 * entrypoint — reachable without an API key. Probed live at 2026-06-03
 * (node-subtensor spec 413): `system.account`, the `stakeInfoRuntimeApi`,
 * `swapRuntimeApi`, `subnetInfoRuntimeApi`, and `neuronInfoRuntimeApi`
 * runtime APIs all resolve. Operators with rate-limit pressure set
 * `BITTENSOR_RPC_URL` to a dedicated endpoint.
 */
const PUBLIC_RPC_FALLBACK = "wss://entrypoint-finney.opentensor.ai:443";

let cachedApi: ApiPromise | null = null;
let cachedUrl: string | null = null;
let warnedFallback = false;

/**
 * Resolve the subtensor RPC URL. Env override wins; otherwise return the
 * public fallback with `isFallback: true` so the warn-latch can fire.
 *
 * Pure — no side effects, NO socket. The warn-latch lives in `getApi()`.
 * `getResolvedRpcUrl()` calls this directly so it can surface the URL
 * without opening a WS connection (Pitfall 5).
 */
function resolveBittensorRpcUrl(): { url: string; isFallback: boolean } {
  const override = getBittensorRpcUrl();
  if (override !== null) return { url: override, isFallback: false };
  return { url: PUBLIC_RPC_FALLBACK, isFallback: true };
}

/**
 * Lazy-singleton `ApiPromise` factory. First call resolves the URL,
 * constructs `await ApiPromise.create({ provider, noInitWarn: true })`,
 * caches the instance. Subsequent calls return the cached singleton.
 *
 * `ApiPromise` holds an open WebSocket for the lifetime of the process —
 * the singleton is correct for a long-lived MCP process (mirrors the
 * Solana `Connection` singleton). Do NOT open a new `ApiPromise` per read.
 *
 * `noInitWarn: true` suppresses the expected "RPC methods not decorated" /
 * "Unknown signed extensions" console noise — subtensor declares custom
 * signed extensions (SubtensorTransactionExtension, DrandPriority) +
 * custom RPCs the generic registry doesn't know (Pitfall 4 — SDK warnings
 * must never reach the MCP stdout channel; `@polkadot`'s internal logger
 * uses `console.*`, and `noInitWarn` is the documented suppression knob).
 *
 * Once-per-process fallback warn: when the env URL is unset AND this is
 * the first call to construct the fallback, emit a stderr `warn` naming
 * the fallback URL. The `warnedFallback` latch prevents re-warn.
 */
async function getApi(): Promise<ApiPromise> {
  if (cachedApi) return cachedApi;

  const { url, isFallback } = resolveBittensorRpcUrl();
  cachedUrl = url;

  if (isFallback && !warnedFallback) {
    log(
      "warn",
      `Using public subtensor RPC fallback (${url}); set BITTENSOR_RPC_URL for production reliability`,
    );
    warnedFallback = true;
  }

  cachedApi = await ApiPromise.create({
    provider: new WsProvider(url),
    noInitWarn: true,
  });
  return cachedApi;
}

/**
 * Returns the RPC URL the registry resolves to, WITHOUT opening a WS
 * socket (Pitfall 5). Unlike the Solana sibling — where `getResolvedRpcUrl`
 * lazily calls `getConnection()` because `new Connection` is cheap and
 * does NOT connect eagerly — here `getApi()` opens a live socket, so
 * status MUST resolve the URL from the env-or-fallback STRING only.
 *
 * If `getApi()` has already cached a URL, return it; otherwise resolve the
 * URL purely (no socket) and also prime the fallback warn-latch so the
 * operator sees the warning once even on a status-only call path. We do
 * NOT call `getApi()` — `get_bittensor_status` reads this and must never
 * hang on an unreachable RPC.
 */
function getResolvedRpcUrl(): string {
  if (cachedUrl !== null) return cachedUrl;
  const { url, isFallback } = resolveBittensorRpcUrl();
  cachedUrl = url;
  if (isFallback && !warnedFallback) {
    log(
      "warn",
      `Using public subtensor RPC fallback (${url}); set BITTENSOR_RPC_URL for production reliability`,
    );
    warnedFallback = true;
  }
  return cachedUrl;
}

/**
 * Test-only — clears the cached `ApiPromise` + URL + warn-latch so each
 * test starts from a clean process state. Production code MUST NOT call
 * this; the resolution is intentionally memoized so a runtime
 * `delete process.env.BITTENSOR_RPC_URL` between tool calls does NOT flip
 * RPC targets silently. Mirror of `_resetSolanaRegistryForTesting`.
 *
 * Does NOT disconnect the cached api — tests that construct a real api
 * are responsible for their own teardown; unit tests spy `getApi` and
 * never construct a live socket.
 */
export function _resetBittensorRegistryForTesting(): void {
  cachedApi = null;
  cachedUrl = null;
  warnedFallback = false;
}

/**
 * ESM spy-affordance per CLAUDE.md. `tao-rpc-client.ts` calls
 * `_bittensorRegistry.getApi()` so tests can `vi.spyOn` to intercept the
 * live `ApiPromise` construction. Also re-exports `getResolvedRpcUrl`
 * (consumed by `get_bittensor_status`) + `getBittensorRpcUrl` so tests
 * have a single object to mock.
 */
export const _bittensorRegistry = {
  getApi,
  getResolvedRpcUrl,
  getBittensorRpcUrl,
};

// Public surface — `getApi` + `getResolvedRpcUrl` are the only production
// exports. Internal callers (`tao-rpc-client.ts`) MUST route through
// `_bittensorRegistry.getApi` to preserve the test seam.
export { PUBLIC_RPC_FALLBACK, getApi, getResolvedRpcUrl };
