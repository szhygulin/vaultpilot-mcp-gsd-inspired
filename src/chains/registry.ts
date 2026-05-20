// src/chains/registry.ts — per-chain memoized PublicClient registry.
//
// Phase 8 Plan 08-01. Widens the Phase 2 singleton at src/chains/ethereum.ts
// (single PublicClient) into a per-chain Map<ChainId, PublicClient>. The
// resolution priority for each chain mirrors the Ethereum singleton:
//
//   (1) Chain-specific env var override (`ETHEREUM_RPC_URL`,
//       `ARBITRUM_RPC_URL`, `POLYGON_RPC_URL`, `BASE_RPC_URL`,
//       `OPTIMISM_RPC_URL`) wins unconditionally.
//   (2) `RPC_PROVIDER` + `RPC_API_KEY` shorthand (one env-var pair
//       configures all 5 chains in one shot — INST-40). Supports `infura`
//       and `alchemy`; provider name is `.toLowerCase()`-normalized.
//       Unknown provider names log once-per-process to stderr and fall
//       through to PublicNode.
//   (2.5) Inferred-provider fan-out: if neither (1) for THIS chain nor (2)
//       is set, scan the per-chain overrides that ARE set in chain-id
//       ascending order [1, 10, 137, 8453, 42161]; if any matches a known
//       provider URL shape (Infura / Alchemy), extract the key and use
//       `PROVIDER_TEMPLATES[provider][chainId]` for chains without their
//       own per-chain override. First match wins; inference runs once per
//       process. Source chain still resolves via its (1) override. Logs
//       once-per-process to stderr naming the source chain + fan-out set
//       (key value never logged).
//   (3) PublicNode public RPC per chain — final fallback. Once-per-chain
//       stderr warning instructs the operator to configure the chain-
//       specific env var or the `RPC_PROVIDER` shorthand for production.
//
// `src/chains/ethereum.ts` becomes a one-wave compat shim delegating to
// `getChainClient(1)`; Plan 08-02 deletes the shim after threading the
// `chain` arg through all callers (Phase 2-7 callsites).
//
// ESM spy-affordance per CLAUDE.md Convention: `getChainClient` calls
// `getProviderShorthandUrl` internally. Without the `_registry` indirection
// (re-export object), tests that `vi.spyOn(_registry, "…")` would silently
// no-op because ESM named-export bindings are immutable. The indirection
// is the test seam.

import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";

import {
  getArbitrumRpcUrl,
  getBaseRpcUrl,
  getEthereumRpcUrl,
  getOptimismRpcUrl,
  getPolygonRpcUrl,
  getRpcApiKey,
  getRpcProvider,
} from "../config/env.js";
import type { ChainId } from "../config/contracts.js";
import { log } from "../diagnostics/logger.js";

/**
 * PublicNode public RPC URLs per chain. Free-tier defaults; users with
 * paid plans configure via chain-specific env vars or the
 * `infura`/`alchemy` shorthand. Verified at research § Topic 1 — re-verify
 * if PublicNode renames a path.
 */
export const PUBLICNODE_RPC_URLS: Record<ChainId, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  42161: "https://arbitrum-one-rpc.publicnode.com",
  137: "https://polygon-bor-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
  10: "https://optimism-rpc.publicnode.com",
};

/**
 * `viem/chains` named-export mapping. Sourced from the viem package itself
 * (verified at runtime: `c.mainnet.id === 1`, etc.). The PublicClient
 * `chain:` arg drives transport defaults + multicall + tx-formatter — using
 * the wrong viem chain object would silently send the wrong serialization.
 */
const VIEM_CHAINS: Record<ChainId, Chain> = {
  1: mainnet,
  42161: arbitrum,
  137: polygon,
  8453: base,
  10: optimism,
};

/**
 * Chain-specific env-var resolvers. Each helper trims whitespace and
 * returns `undefined` for empty/unset values.
 */
const RPC_URL_RESOLVERS: Record<ChainId, () => string | undefined> = {
  1: getEthereumRpcUrl,
  42161: getArbitrumRpcUrl,
  137: getPolygonRpcUrl,
  8453: getBaseRpcUrl,
  10: getOptimismRpcUrl,
};

/**
 * Provider-shorthand URL templates. The `{key}` token is replaced with
 * the value of `RPC_API_KEY` at resolve time. Provider name lookup is
 * case-insensitive via `.toLowerCase()` normalization at the call site.
 *
 * Locked at v1.2 to `infura` + `alchemy`. Self-hosted nodes set the
 * chain-specific env var directly; arbitrary URL templates (e.g.
 * `RPC_URL_TEMPLATE=https://my-rpc-{chain}/v3/{key}`) are post-v1.x scope
 * per the plan's `deferred` section.
 */
const PROVIDER_TEMPLATES: Record<string, Record<ChainId, string>> = {
  infura: {
    1: "https://mainnet.infura.io/v3/{key}",
    42161: "https://arbitrum-mainnet.infura.io/v3/{key}",
    137: "https://polygon-mainnet.infura.io/v3/{key}",
    8453: "https://base-mainnet.infura.io/v3/{key}",
    10: "https://optimism-mainnet.infura.io/v3/{key}",
  },
  alchemy: {
    1: "https://eth-mainnet.g.alchemy.com/v2/{key}",
    42161: "https://arb-mainnet.g.alchemy.com/v2/{key}",
    137: "https://polygon-mainnet.g.alchemy.com/v2/{key}",
    8453: "https://base-mainnet.g.alchemy.com/v2/{key}",
    10: "https://opt-mainnet.g.alchemy.com/v2/{key}",
  },
};

const cachedClients = new Map<ChainId, PublicClient>();
const cachedFallbackByChain = new Map<ChainId, boolean>();
const warnedFallbackByChain = new Set<ChainId>();
const warnedUnknownProvider = new Set<string>();

/**
 * Inferred-provider memo (tier 2.5). Computed once per process on first
 * call to `getInferredProviderFanOut()`; subsequent calls return the
 * cached result. `null` ⇒ inference attempted and produced nothing (no
 * per-chain URL matched Infura / Alchemy shape, OR `RPC_PROVIDER`+key
 * shorthand is set so inference is preempted).
 */
let cachedInferredProvider:
  | { provider: "infura" | "alchemy"; key: string; sourceChainId: ChainId }
  | null
  | undefined;

/**
 * Chain-id ascending iteration order for inference scanning. Deterministic
 * "first-match wins" tiebreaker when two per-chain URLs carry different
 * keys (documented invariant — see file header tier 2.5).
 */
const INFERENCE_SCAN_ORDER: ChainId[] = [1, 10, 137, 8453, 42161];

const CHAIN_NAMES: Record<ChainId, string> = {
  1: "ethereum",
  42161: "arbitrum",
  137: "polygon",
  8453: "base",
  10: "optimism",
};

const CHAIN_ENV_VAR_NAMES: Record<ChainId, string> = {
  1: "ETHEREUM_RPC_URL",
  42161: "ARBITRUM_RPC_URL",
  137: "POLYGON_RPC_URL",
  8453: "BASE_RPC_URL",
  10: "OPTIMISM_RPC_URL",
};

/**
 * Provider URL-shape patterns for tier-2.5 inference. The capture group
 * extracts the API key verbatim from a per-chain RPC URL. Self-hosted /
 * custom URLs do not match either pattern → inference returns undefined
 * for them and those chains fall through to PublicNode.
 *
 * Patterns are intentionally narrow: subdomain segment `[a-z-]+` rejects
 * anything that isn't a lower-case provider subdomain; the key segment
 * `[A-Za-z0-9_-]+` accepts the alphanumeric+`_`+`-` keys both providers
 * issue.
 */
const PROVIDER_URL_PATTERNS: { provider: "infura" | "alchemy"; re: RegExp }[] = [
  { provider: "infura", re: /^https:\/\/[a-z-]+\.infura\.io\/v3\/([A-Za-z0-9_-]+)\/?$/ },
  { provider: "alchemy", re: /^https:\/\/[a-z-]+\.g\.alchemy\.com\/v2\/([A-Za-z0-9_-]+)\/?$/ },
];

/**
 * Internal helper. Tier-2.5 inference: scans per-chain RPC URL env vars
 * in chain-id ascending order; the first URL that matches a known provider
 * shape (Infura / Alchemy) wins. Returns `{provider, key, sourceChainId}`
 * or `null`. Memoized once-per-process — `_resetChainRegistryForTesting`
 * clears the memo.
 *
 * Preempted by `RPC_PROVIDER` + `RPC_API_KEY` shorthand: if both are set,
 * inference is skipped and returns `null` (the explicit shorthand is
 * tier 2 and wins over inference).
 *
 * Spyable via `_registry.getInferredProviderFanOut` for tests.
 */
function getInferredProviderFanOut():
  | { provider: "infura" | "alchemy"; key: string; sourceChainId: ChainId }
  | null {
  if (cachedInferredProvider !== undefined) return cachedInferredProvider;

  // Tier-2 shorthand preempts inference. If RPC_PROVIDER + RPC_API_KEY are
  // both set, `getProviderShorthandUrl` covers every chain that has no
  // per-chain override; inference would be redundant.
  if (getRpcProvider() && getRpcApiKey()) {
    cachedInferredProvider = null;
    return null;
  }

  for (const chainId of INFERENCE_SCAN_ORDER) {
    const resolver = RPC_URL_RESOLVERS[chainId];
    const url = resolver();
    if (!url) continue;
    for (const { provider, re } of PROVIDER_URL_PATTERNS) {
      const m = url.match(re);
      const key = m?.[1];
      if (key) {
        const result = { provider, key, sourceChainId: chainId };
        cachedInferredProvider = result;
        const destChains = INFERENCE_SCAN_ORDER
          .filter(
            (id) => id !== chainId && RPC_URL_RESOLVERS[id]() === undefined,
          )
          .map((id) => CHAIN_NAMES[id]);
        if (destChains.length > 0) {
          log(
            "info",
            `Inferred ${provider} key from ${CHAIN_ENV_VAR_NAMES[chainId]} and fanned out to: ${destChains.join(", ")} (key value not logged)`,
          );
        }
        return result;
      }
    }
  }

  cachedInferredProvider = null;
  return null;
}

/**
 * Internal helper. Returns the tier-2.5 inferred URL for `chainId` if
 * inference produced a provider AND `chainId` is NOT the source chain
 * (the source chain already has its own per-chain override and resolves
 * via tier 1). Otherwise returns `undefined`.
 *
 * Spyable via `_registry.getInferredProviderUrl` for tests.
 */
function getInferredProviderUrl(chainId: ChainId): string | undefined {
  const inferred = _registry.getInferredProviderFanOut();
  if (!inferred) return undefined;
  if (inferred.sourceChainId === chainId) return undefined;
  const template = PROVIDER_TEMPLATES[inferred.provider]?.[chainId];
  if (!template) return undefined;
  return template.replace("{key}", inferred.key);
}

/**
 * Internal helper. Resolves `RPC_PROVIDER` + `RPC_API_KEY` into a
 * per-chain URL via `PROVIDER_TEMPLATES[provider.toLowerCase()][chainId]`.
 * Returns `undefined` when either env var is unset, or when the provider
 * name is not in the lock-list — in the unrecognized case, logs a
 * once-per-process stderr warning naming the supported providers.
 *
 * Spyable via the `_registry` indirection below — `getChainClient` calls
 * this through `_registry.getProviderShorthandUrl` so tests can intercept.
 */
function getProviderShorthandUrl(chainId: ChainId): string | undefined {
  const provider = getRpcProvider();
  const key = getRpcApiKey();
  if (!provider || !key) return undefined;
  const normalized = provider.toLowerCase();
  const templates = PROVIDER_TEMPLATES[normalized];
  if (!templates) {
    if (!warnedUnknownProvider.has(normalized)) {
      log(
        "warn",
        `RPC_PROVIDER="${provider}" not recognized (supported: infura, alchemy); falling back to PublicNode for all chains`,
      );
      warnedUnknownProvider.add(normalized);
    }
    return undefined;
  }
  return templates[chainId].replace("{key}", key);
}

/**
 * Per-chain memoized PublicClient factory. Resolution priority (env-var
 * override → provider shorthand → PublicNode fallback) is computed once
 * per chain at first call; subsequent calls return the cached client.
 *
 * The PublicNode-fallback case logs a once-per-chain stderr warning so the
 * operator sees a misconfigured chain on first read rather than discovering
 * it via rate-limit failures in production.
 */
export function getChainClient(chainId: ChainId): PublicClient {
  const cached = cachedClients.get(chainId);
  if (cached) return cached;

  const override = RPC_URL_RESOLVERS[chainId]();
  const providerShorthand = _registry.getProviderShorthandUrl(chainId);
  const inferred =
    override === undefined && providerShorthand === undefined
      ? _registry.getInferredProviderUrl(chainId)
      : undefined;
  const url =
    override ?? providerShorthand ?? inferred ?? PUBLICNODE_RPC_URLS[chainId];
  const usedFallback =
    override === undefined &&
    providerShorthand === undefined &&
    inferred === undefined;
  cachedFallbackByChain.set(chainId, usedFallback);

  if (usedFallback && !warnedFallbackByChain.has(chainId)) {
    log(
      "warn",
      `No RPC URL set for chain ${chainId} — using PublicNode public RPC (${PUBLICNODE_RPC_URLS[chainId]}); set the chain-specific env var (e.g. ETHEREUM_RPC_URL) or RPC_PROVIDER + RPC_API_KEY for production traffic`,
    );
    warnedFallbackByChain.add(chainId);
  }

  const client = createPublicClient({
    chain: VIEM_CHAINS[chainId],
    transport: http(url),
  });
  cachedClients.set(chainId, client);
  return client;
}

/**
 * Reports whether the cached client for `chainId` is the PublicNode
 * fallback (vs an explicit override / provider shorthand). Lazy: if the
 * client has not yet been resolved, calls `getChainClient(chainId)` first
 * so the resolution + warn-once side effects fire deterministically.
 *
 * Plan 08-01 + downstream consumers surface this in `get_vaultpilot_config_status`
 * (per-chain `configuredChains` map) and in read-tool `rpcDegraded` envelopes.
 */
export function isPublicNodeFallback(chainId: ChainId): boolean {
  if (!cachedClients.has(chainId)) getChainClient(chainId);
  return cachedFallbackByChain.get(chainId) ?? false;
}

/**
 * Test-only — clears every per-chain cache + warning-state set so each
 * test starts from a clean process state. Production code must NOT call
 * this; the resolution is intentionally memoized so a runtime
 * `delete process.env.X` between tool calls does NOT flip RPC targets
 * silently.
 */
export function _resetChainRegistryForTesting(): void {
  cachedClients.clear();
  cachedFallbackByChain.clear();
  warnedFallbackByChain.clear();
  warnedUnknownProvider.clear();
  cachedInferredProvider = undefined;
}

/**
 * Helper for diagnostic surfacing (`get_vaultpilot_config_status`). Returns
 * true if the chain has EITHER a chain-specific env-var override OR a valid
 * `RPC_PROVIDER + RPC_API_KEY` shorthand that resolves to a known provider.
 * False when only the PublicNode fallback would fire.
 *
 * Implementation note: this re-runs the resolution check WITHOUT priming
 * the client cache, so calling it from the diagnostic tool doesn't lock in
 * a transport that the operator might later configure via env-var changes
 * (in test scenarios; production has a single resolution at boot).
 */
export function hasRpcConfiguredForChain(chainId: ChainId): boolean {
  if (RPC_URL_RESOLVERS[chainId]() !== undefined) return true;
  const provider = getRpcProvider();
  const key = getRpcApiKey();
  if (provider && key) {
    const normalized = provider.toLowerCase();
    if (PROVIDER_TEMPLATES[normalized] !== undefined) return true;
  }
  // Tier 2.5 — inferred-provider fan-out covers chains without their own
  // per-chain override when ANOTHER chain's override URL matches a known
  // provider shape.
  if (_registry.getInferredProviderUrl(chainId) !== undefined) return true;
  return false;
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
 * convention. ESM named-export bindings are immutable — a direct
 * `vi.spyOn(registry, "getProviderShorthandUrl")` is a no-op for the
 * `getChainClient` internal call. Routing the internal call through this
 * object lets tests intercept it. Same pattern as `_paths` in
 * `src/config/config-file.ts`, `_contracts` in `src/config/contracts.ts`,
 * `_aaveChains` in `src/chains/aave-v3.ts`.
 */
export const _registry = {
  getProviderShorthandUrl,
  getInferredProviderFanOut,
  getInferredProviderUrl,
  getChainClient,
  isPublicNodeFallback,
  hasRpcConfiguredForChain,
};
