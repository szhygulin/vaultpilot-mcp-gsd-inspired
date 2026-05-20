// src/chains/solana/registry.ts — Phase 11 Plan 11-02.
//
// Lazy-singleton `Connection` factory for Solana mainnet-beta. Narrower
// than the EVM `src/chains/registry.ts` — single cluster (mainnet-beta);
// devnet / testnet deferred to a post-v2.x phase. Resolution priority:
//
//   (1) `SOLANA_RPC_URL` env override wins unconditionally
//   (2) Public RPC fallback (`https://api.mainnet-beta.solana.com`) with
//       once-per-process stderr `warn` (mirrors `warnedFallbackByChain`
//       latch at `chains/registry.ts:122`)
//
// No `RPC_PROVIDER` shorthand fan-out — Solana is URL-config-only in v2.0
// (Helius / QuickNode / Triton are URL-only, no shared key fan-out
// pattern; § Topic 5 lock).
//
// Locked SDK decision (DF-1, § Topic 1): `@solana/web3.js@1.98.4`. The
// `new Connection(url, commitment)` API mirrors viem's
// `createPublicClient({ chain, transport: http(url) })` cognitively —
// one-hop. The fluent `@solana/kit` ergonomics are deferred to a v2.x
// migration once the EVM call sites no longer dominate the codebase's
// cognitive model.
//
// ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
// convention. The internal `getConnection()` call site is routed through
// `_solanaRegistry.getConnection` so `vi.spyOn(_solanaRegistry, ...)`
// intercepts — `sol-rpc-client.ts` MUST call through this indirection,
// never bare-import `getConnection` from this file. Mirror of `_registry`
// at `chains/registry.ts:385-392`, `_aaveChains` at `chains/aave-v3.ts:148`.

import { Connection } from "@solana/web3.js";

import { getSolanaRpcUrl } from "../../config/env.js";
import { log } from "../../diagnostics/logger.js";

/**
 * Default public Solana RPC. Reaches mainnet-beta via the Solana
 * Foundation's free public endpoint. Probed at 2026-05-20: `getBalance`
 * works; parsed-RPC methods (`getParsedTokenAccountsByOwner`) return
 * `-32601 Method not found`. The UNPARSED path in `sol-rpc-client.ts` is
 * load-bearing for this fallback (research § Topic 5 D-7 lock).
 */
const PUBLIC_RPC_FALLBACK = "https://api.mainnet-beta.solana.com";

/**
 * Connection commitment level. `"confirmed"` is the Solana ecosystem
 * default for read flows — waits for cluster confirmation (~400ms slot
 * time) without paying the `"finalized"` ~12-second cost. v1.x EVM reads
 * use the same trade-off via viem's default (latest-block reads, not
 * finalized).
 */
const CONNECTION_COMMITMENT = "confirmed" as const;

let cachedConnection: Connection | null = null;
let cachedUrl: string | null = null;
let warnedFallback = false;

/**
 * Resolve the Solana RPC URL. Env override wins; otherwise return the
 * public fallback with `isFallback: true` so the warn-latch can fire.
 *
 * Pure — no side effects. The warn-latch lives in `getConnection()`.
 */
function resolveSolanaRpcUrl(): { url: string; isFallback: boolean } {
  const override = getSolanaRpcUrl();
  if (override !== null) return { url: override, isFallback: false };
  return { url: PUBLIC_RPC_FALLBACK, isFallback: true };
}

/**
 * Lazy-singleton `Connection` factory. First call resolves the URL,
 * constructs `new Connection(url, "confirmed")`, caches both. Subsequent
 * calls return the cached instance.
 *
 * Once-per-process fallback warn: when the env URL is unset AND this is
 * the first call to construct the fallback, emit a stderr `warn` naming
 * the fallback URL. The warn-latch (`warnedFallback`) prevents re-warn on
 * subsequent calls — mirrors `warnedFallbackByChain` at
 * `chains/registry.ts:122`.
 */
function getConnection(): Connection {
  if (cachedConnection) return cachedConnection;

  const { url, isFallback } = resolveSolanaRpcUrl();
  cachedUrl = url;

  if (isFallback && !warnedFallback) {
    log(
      "warn",
      `Using public Solana RPC fallback (${url}); set SOLANA_RPC_URL for production reliability`,
    );
    warnedFallback = true;
  }

  cachedConnection = new Connection(url, CONNECTION_COMMITMENT);
  return cachedConnection;
}

/**
 * Returns the RPC URL the current cached `Connection` was constructed
 * against. Lazy: if no `Connection` has been constructed yet, calls
 * `getConnection()` first so the URL resolution + warn-once side effects
 * fire deterministically.
 *
 * Surfaced in `get_vaultpilot_config_status` (Plan 11-05) as a
 * `solanaRpcUrl` diagnostic — the operator sees which URL is in flight
 * without having to read the env or guess.
 */
function getResolvedRpcUrl(): string {
  if (cachedUrl === null) getConnection();
  // cachedUrl set inside getConnection() — narrow via assertion.
  return cachedUrl as unknown as string;
}

/**
 * Test-only — clears the cached `Connection` + URL + warn-latch so each
 * test starts from a clean process state. Production code MUST NOT call
 * this; the resolution is intentionally memoized so a runtime
 * `delete process.env.SOLANA_RPC_URL` between tool calls does NOT flip
 * RPC targets silently. Mirror of `_resetChainRegistryForTesting` at
 * `chains/registry.ts:342`.
 */
export function _resetSolanaRegistryForTesting(): void {
  cachedConnection = null;
  cachedUrl = null;
  warnedFallback = false;
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
 * convention. `sol-rpc-client.ts` imports `_solanaRegistry` and calls
 * `_solanaRegistry.getConnection()` so tests can `vi.spyOn` to intercept
 * the live `Connection` construction. Direct
 * `vi.spyOn(module, "getConnection")` is a silent no-op for the
 * cross-export internal call — ESM named-export bindings are immutable
 * (CLAUDE.md convention non-negotiable; D-5 lock).
 *
 * Also re-exports `getSolanaRpcUrl` so tests that need to intercept the
 * env resolution at the registry level have a single object to mock.
 */
export const _solanaRegistry = {
  getConnection,
  getResolvedRpcUrl,
  getSolanaRpcUrl,
};

// Public surface — `getConnection` + `getResolvedRpcUrl` are the only
// production exports. Internal callers (`sol-rpc-client.ts`) MUST route
// through `_solanaRegistry.getConnection` to preserve the test seam.
export { PUBLIC_RPC_FALLBACK, getConnection, getResolvedRpcUrl };
