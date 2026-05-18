// Environment-variable + config-file resolution surface.
//
// Plan 05-01 evolves `isDemoMode()` from a one-liner env check (Phase 3
// minimum-viable) to the `env > config > auto-detect` resolution chain
// DEMO-01 / DEMO-02 / DEMO-07 / INST-05 require. The signature stays stable
// so Phase 3+4 callers (`pair_ledger_live`, `prepare_native_send`,
// `preview_send`, `get_tx_verification`, `send_transaction`) need ZERO
// modification.
//
// Q-STRICT lock (research § STRIDE T-DEMO-PREDICATE-1):
//   `VAULTPILOT_DEMO` accepts ONLY the literal strings `"true"` and
//   `"false"`. Any other value (`"True"`, `"1"`, `"yes"`, etc.) triggers
//   `process.exit(1)`. Loud boot refusal beats silent wrong-mode.
//
// Q-AUTO-DEMO-PERSONA-DEFAULT lock (research § A6):
//   When the resolution chain picks the auto-demo arm (no env, no config
//   file), the resolver seeds `whale` as the active persona — guarded by
//   `getActivePersona() === null` so tests that pre-seed a different
//   persona before triggering auto-demo keep their value.
//
// Q-CONFIG-NO-KEY lock (research § A2):
//   A config file that exists but has NO `demo` key → real-mode. The user
//   took the trouble to write a config; we respect their implicit opt-out
//   of auto-demo.

import type { ChainId } from "./contracts.js";
import { log } from "../diagnostics/logger.js";
import { getActivePersona, setActivePersona } from "../demo/state.js";
import { _paths, readConfigFile } from "./config-file.js";

function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function getEthereumRpcUrl(): string | undefined {
  return read("ETHEREUM_RPC_URL");
}

// Phase 8 Plan 08-01 — chain-specific RPC URL readers. Each mirrors
// `getEthereumRpcUrl` verbatim via the in-tree `read(name)` helper
// (trims whitespace, returns undefined for empty/missing). The resolution
// priority lives in `src/chains/registry.ts::getChainClient(chainId)`:
//   (1) chain-specific override (these helpers) wins unconditionally
//   (2) `RPC_PROVIDER` + `RPC_API_KEY` shorthand expanded per chain
//   (3) PublicNode public RPC per chain — final fallback, once-per-chain warn
export function getArbitrumRpcUrl(): string | undefined {
  return read("ARBITRUM_RPC_URL");
}

export function getPolygonRpcUrl(): string | undefined {
  return read("POLYGON_RPC_URL");
}

export function getBaseRpcUrl(): string | undefined {
  return read("BASE_RPC_URL");
}

export function getOptimismRpcUrl(): string | undefined {
  return read("OPTIMISM_RPC_URL");
}

// Plan 08-05 — multi-chain WalletConnect pairing.
//
// Returns the list of EVM chains this v1.2 build supports. Drives
// `REQUIRED_NAMESPACES.eip155.chains` in `src/wallet/session-manager.ts`
// so the WC pairing proposal asks Ledger Live for accounts on every
// configured chain (not just Ethereum). The same list also drives the
// `partiallyPaired` detection in `sessionToStatus` — when Ledger Live
// approves fewer chains than this returns, the user has L2 networks
// disabled in Manage Accounts.
//
// For v1.2 the list is STATIC: every chain in `ChainId` is supported
// because the PublicNode fallback covers all 5 (per Plan 08-01's
// `getChainClient`). Future v1.3+ may filter to chains with an EXPLICIT
// custom RPC URL if a "fail-fast on unconfigured chain" mode becomes
// desirable; v1.2 is permissive.
//
// Order matters: the FIRST chain (Ethereum) is the default
// `activeChainId` when `sessionToStatus` resolves a pair (research §
// Topic 8 — "first configured chain in the session"). The
// T-WC-MULTI-CHAIN-PAIRING-REGRESSION-1 anchor pins this in tests.
const CONFIGURED_CHAIN_IDS: readonly ChainId[] = [1, 42161, 137, 8453, 10];

/**
 * Returns the list of EVM chains this v1.2 build supports. Static list:
 * every chain in `ChainId` (Plan 08-01) is supported via PublicNode
 * fallback. v1.3+ may filter to chains with explicit RPC config if a
 * strict "fail-fast on unconfigured chain" mode becomes desirable; for
 * v1.2 the list is permissive.
 *
 * Ethereum (chainId 1) is ALWAYS the first entry — `sessionToStatus`
 * picks it as the default `activeChainId` when a fresh pair resolves
 * (research § Topic 8 line 717).
 */
export function getConfiguredChainIds(): readonly ChainId[] {
  return CONFIGURED_CHAIN_IDS;
}

export function getRpcProvider(): string | undefined {
  return read("RPC_PROVIDER");
}

export function getRpcApiKey(): string | undefined {
  return read("RPC_API_KEY");
}

export function getWalletConnectProjectId(): string | undefined {
  return read("WALLETCONNECT_PROJECT_ID");
}

export function getEtherscanApiKey(): string | undefined {
  return read("ETHERSCAN_API_KEY");
}

/**
 * Resolution result discriminant. Five arms cover every distinguishable
 * path through the env > config > auto-detect chain — Plan 05-03's NOTICE
 * gate reads `auto-demo` specifically (NOT the umbrella `isDemoMode()`)
 * to differentiate explicit-opt-in from first-run-default.
 */
export interface ResolutionResult {
  mode:
    | "env-on"
    | "env-off"
    | "config-on"
    | "config-off"
    | "config-no-demo-key"
    | "auto-demo";
}

let cached: ResolutionResult | undefined;

/**
 * Lazy-singleton resolver. Mirrors the pattern at
 * `src/chains/ethereum.ts::getEthereumClient()` (Phase 2): first call does
 * the work, subsequent calls return cached. `_resetDemoModeForTesting()`
 * clears the cache between tests so each scenario starts clean.
 *
 * Process-exit cases:
 *   - `VAULTPILOT_DEMO` is set to anything other than `"true"` / `"false"`.
 *   - `~/.vaultpilot-mcp/config.json` exists but fails `JSON.parse`.
 * Both call `log("error", ...)` to stderr THEN `process.exit(1)`. TS sees
 * `process.exit` as `never`, so the function's return type is satisfied.
 */
export function resolveDemoMode(): ResolutionResult {
  if (cached) return cached;

  // Q-STRICT: literal `"true"` or `"false"` — anything else refuses to
  // boot. The Phase 3 implementation accepted-and-ignored anything that
  // wasn't literally `"true"`; the new contract tightens that to "refuse
  // to boot on any unrecognized value." Loud failure beats silent
  // wrong-mode. T-DEMO-PREDICATE-1 mitigation.
  const envRaw = process.env.VAULTPILOT_DEMO;
  if (envRaw !== undefined) {
    if (envRaw === "true") {
      cached = { mode: "env-on" };
      return cached;
    }
    if (envRaw === "false") {
      cached = { mode: "env-off" };
      return cached;
    }
    log(
      "error",
      `VAULTPILOT_DEMO must be literal "true" or "false"; got "${envRaw}". Refusing to boot.`,
    );
    process.exit(1);
  }

  // Env unset → consult `~/.vaultpilot-mcp/config.json`.
  const result = readConfigFile();
  if (result.ok) {
    if (result.parsed.demo === true) {
      cached = { mode: "config-on" };
      return cached;
    }
    if (result.parsed.demo === false) {
      cached = { mode: "config-off" };
      return cached;
    }
    // Q-CONFIG-NO-KEY: file exists, no `demo` key → real-mode. The user
    // configured something (likely `rpcUrl` for Phase 10's wizard) but
    // didn't opt in to demo; respect that.
    cached = { mode: "config-no-demo-key" };
    return cached;
  }

  if (result.reason === "malformed") {
    // T-CONFIG-MALFORMED-1: refuse to boot rather than silently
    // fall through to auto-demo. The operator sees the parse error in
    // stderr and can fix / delete the file.
    const path = _paths.getConfigPath();
    log(
      "error",
      `${path} is malformed: ${result.cause}. Refusing to boot. Delete or fix the file, or set VAULTPILOT_DEMO=true|false to bypass the config arm.`,
    );
    process.exit(1);
  }

  // result.reason === "missing" → auto-demo arm.
  cached = { mode: "auto-demo" };
  // Q-AUTO-DEMO-PERSONA-DEFAULT: seed `whale` so the first read tool
  // call works without requiring a separate `set_demo_wallet`
  // prerequisite. The guard preserves test pre-seeds — a test that
  // calls `setActivePersona("stable-saver")` before triggering
  // auto-demo keeps stable-saver active. Production code never seeds
  // before resolving the first time, so the guard is a defensive
  // no-op in prod.
  if (getActivePersona() === null) {
    setActivePersona("whale");
  }
  return cached;
}

/**
 * Demo-mode predicate. Returns `true` when the resolved mode is any of:
 *   - `env-on`     (explicit `VAULTPILOT_DEMO=true`)
 *   - `config-on`  (config file `{ "demo": true }`)
 *   - `auto-demo`  (no env, no config file — first-run default)
 *
 * Signature byte-identical to Phase 3's body; Phase 3+4 callers
 * (`pair_ledger_live`, `prepare_native_send`, `preview_send`,
 * `get_tx_verification`, `send_transaction`) need ZERO modification.
 */
export function isDemoMode(): boolean {
  const r = resolveDemoMode();
  return r.mode === "env-on" || r.mode === "config-on" || r.mode === "auto-demo";
}

/**
 * True ONLY when the resolution chain picked the auto-detect arm.
 * Plan 05-03 reads this to gate the first-response NOTICE — explicit
 * opt-in via env or config does NOT trigger the NOTICE because the user
 * already knows they're in demo mode.
 */
export function isAutoDemo(): boolean {
  return resolveDemoMode().mode === "auto-demo";
}

/**
 * Test-only helper. Production code MUST NOT call this — the resolution
 * is intentionally cached at first call so a runtime
 * `delete process.env.VAULTPILOT_DEMO` between tool calls does NOT flip
 * mode silently. Tests use this to restart the resolver from scratch
 * between scenarios.
 *
 * Note: this does NOT reset the active-persona side effect from the
 * auto-demo arm. Tests exercising auto-demo MUST ALSO call
 * `_resetActivePersonaForTesting()` from `src/demo/state.ts`.
 */
export function _resetDemoModeForTesting(): void {
  cached = undefined;
}
