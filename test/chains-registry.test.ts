// src/chains/registry.ts — Phase 8 Plan 08-01 per-chain memoized
// PublicClient registry. Mirrors the Phase 2 `chains-ethereum.test.ts`
// shape widened to Record<ChainId, PublicClient>.
//
// Coverage:
//   1.  getChainClient(1) memoization (same instance across calls)
//   2.  Per-chain isolation — 5 chains, 5 distinct memoized clients
//   3.  Chain-specific env var wins (ARBITRUM_RPC_URL → arbitrum override)
//   4.  Provider shorthand wins over PublicNode (alchemy + key → polygon)
//   5.  PublicNode fallback fires when neither override nor shorthand set
//   6.  PublicNode warning is once-per-chain (no re-warn on second call)
//   7.  Unknown provider name (`quicknode`) → falls through to PublicNode;
//       stderr warning fires once-per-process naming `supported: infura, alchemy`
//   8.  Provider name case-insensitive (`Infura` → `infura` template)
//   9.  _resetChainRegistryForTesting clears caches + warning state
//   10. isPublicNodeFallback lazy-evaluates (calls getChainClient if not memoized)
//   11. URL template substitution — `{key}` replaced verbatim
//   12. PUBLICNODE_RPC_URLS exposes 5 verified URLs
//   13. VIEM_CHAINS binding (Etherscan vs Arbiscan etc.) — proves correct viem/chains import
//   14. _registry ESM spy-affordance — vi.spyOn intercepts the internal call
//   15. hasRpcConfiguredForChain — diagnostic helper used by get_vaultpilot_config_status

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PUBLICNODE_RPC_URLS,
  _registry,
  _resetChainRegistryForTesting,
  getChainClient,
  hasRpcConfiguredForChain,
  isPublicNodeFallback,
} from "../src/chains/registry.js";

const ENV_KEYS = [
  "ETHEREUM_RPC_URL",
  "ARBITRUM_RPC_URL",
  "POLYGON_RPC_URL",
  "BASE_RPC_URL",
  "OPTIMISM_RPC_URL",
  "RPC_PROVIDER",
  "RPC_API_KEY",
] as const;

const saved: Record<string, string | undefined> = {};
let stderrBuf: string;
let originalStderrWrite: typeof process.stderr.write;

function captureStderr(): void {
  stderrBuf = "";
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown): boolean => {
    stderrBuf += typeof chunk === "string" ? chunk : String(chunk);
    return true;
  }) as typeof process.stderr.write;
}

function restoreStderr(): void {
  process.stderr.write = originalStderrWrite;
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  _resetChainRegistryForTesting();
  captureStderr();
});

afterEach(() => {
  restoreStderr();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetChainRegistryForTesting();
  vi.restoreAllMocks();
});

describe("src/chains/registry.ts — memoization", () => {
  it("Test 1 — getChainClient(1) returns memoized PublicClient (same instance across calls)", () => {
    const a = getChainClient(1);
    const b = getChainClient(1);
    expect(a).toBe(b);
    expect(a).toBeDefined();
  });

  it("Test 2 — per-chain isolation: 5 chains return 5 distinct memoized PublicClients", () => {
    const eth = getChainClient(1);
    const arb = getChainClient(42161);
    const pol = getChainClient(137);
    const bas = getChainClient(8453);
    const opt = getChainClient(10);

    // All distinct identities.
    const set = new Set([eth, arb, pol, bas, opt]);
    expect(set.size).toBe(5);

    // Each is memoized independently.
    expect(getChainClient(1)).toBe(eth);
    expect(getChainClient(42161)).toBe(arb);
    expect(getChainClient(137)).toBe(pol);
    expect(getChainClient(8453)).toBe(bas);
    expect(getChainClient(10)).toBe(opt);
  });
});

describe("src/chains/registry.ts — resolution priority", () => {
  it("Test 3 — chain-specific env var wins: ARBITRUM_RPC_URL → that URL is used; isPublicNodeFallback(42161) === false", () => {
    process.env.ARBITRUM_RPC_URL = "https://custom-rpc.example/arb";
    const client = getChainClient(42161);
    expect(client.transport.url).toBe("https://custom-rpc.example/arb");
    expect(isPublicNodeFallback(42161)).toBe(false);
  });

  it("Test 4 — shorthand wins over PublicNode: RPC_PROVIDER=alchemy + RPC_API_KEY=key → polygon uses Alchemy URL; isPublicNodeFallback(137) === false", () => {
    process.env.RPC_PROVIDER = "alchemy";
    process.env.RPC_API_KEY = "secret-key";
    const client = getChainClient(137);
    expect(client.transport.url).toBe(
      "https://polygon-mainnet.g.alchemy.com/v2/secret-key",
    );
    expect(isPublicNodeFallback(137)).toBe(false);
  });

  it("Test 5 — PublicNode fallback: no env, no shorthand → getChainClient(8453) uses PublicNode Base URL; isPublicNodeFallback(8453) === true; stderr warning fires", () => {
    const client = getChainClient(8453);
    expect(client.transport.url).toBe(PUBLICNODE_RPC_URLS[8453]);
    expect(isPublicNodeFallback(8453)).toBe(true);
    expect(stderrBuf).toMatch(/No RPC URL set for chain 8453/);
    expect(stderrBuf).toMatch(/PublicNode public RPC/);
  });

  it("Test 6 — once-per-chain warning: second call to fallback chain does NOT re-warn", () => {
    getChainClient(10);
    const after1 = stderrBuf;
    getChainClient(10);
    getChainClient(10);
    expect(stderrBuf).toBe(after1);
    const matches = (stderrBuf.match(/No RPC URL set for chain 10/g) ?? [])
      .length;
    expect(matches).toBe(1);
  });
});

describe("src/chains/registry.ts — provider shorthand (INST-40)", () => {
  it("Test 7 — unknown provider (`quicknode`) falls through to PublicNode for all 5 chains; warning fires once-per-process naming `supported: infura, alchemy`", () => {
    process.env.RPC_PROVIDER = "quicknode";
    process.env.RPC_API_KEY = "k";

    const eth = getChainClient(1);
    const arb = getChainClient(42161);
    const pol = getChainClient(137);
    const bas = getChainClient(8453);
    const opt = getChainClient(10);

    expect(eth.transport.url).toBe(PUBLICNODE_RPC_URLS[1]);
    expect(arb.transport.url).toBe(PUBLICNODE_RPC_URLS[42161]);
    expect(pol.transport.url).toBe(PUBLICNODE_RPC_URLS[137]);
    expect(bas.transport.url).toBe(PUBLICNODE_RPC_URLS[8453]);
    expect(opt.transport.url).toBe(PUBLICNODE_RPC_URLS[10]);

    const matches =
      (stderrBuf.match(/RPC_PROVIDER="quicknode" not recognized/g) ?? [])
        .length;
    expect(matches).toBe(1);
    expect(stderrBuf).toMatch(/supported: infura, alchemy/);
  });

  it("Test 8 — provider name case-insensitive: RPC_PROVIDER=Infura resolves to the infura template", () => {
    process.env.RPC_PROVIDER = "Infura";
    process.env.RPC_API_KEY = "MY_KEY";

    const client = getChainClient(1);
    expect(client.transport.url).toBe(
      "https://mainnet.infura.io/v3/MY_KEY",
    );
  });

  it("Test 11 — URL template substitution: RPC_PROVIDER=infura RPC_API_KEY=mykey → eth URL is https://mainnet.infura.io/v3/mykey", () => {
    process.env.RPC_PROVIDER = "infura";
    process.env.RPC_API_KEY = "mykey";
    const client = getChainClient(1);
    expect(client.transport.url).toBe(
      "https://mainnet.infura.io/v3/mykey",
    );
  });
});

describe("src/chains/registry.ts — reset + lazy evaluation", () => {
  it("Test 9 — _resetChainRegistryForTesting clears caches AND warning state (re-warns after reset)", () => {
    getChainClient(1);
    expect(stderrBuf).toMatch(/No RPC URL set for chain 1/);
    _resetChainRegistryForTesting();
    stderrBuf = "";
    getChainClient(1);
    expect(stderrBuf).toMatch(/No RPC URL set for chain 1/);
  });

  it("Test 10 — isPublicNodeFallback lazy-evaluates: calls getChainClient(chainId) if not memoized", () => {
    // No prior getChainClient call — first read of isPublicNodeFallback
    // must trigger the resolution + cache the result.
    const result = isPublicNodeFallback(42161);
    expect(result).toBe(true);
    expect(stderrBuf).toMatch(/No RPC URL set for chain 42161/);
  });
});

describe("src/chains/registry.ts — static tables", () => {
  it("Test 12 — PUBLICNODE_RPC_URLS exposes the verified URLs for all 5 chains", () => {
    expect(PUBLICNODE_RPC_URLS[1]).toBe("https://ethereum-rpc.publicnode.com");
    expect(PUBLICNODE_RPC_URLS[42161]).toBe(
      "https://arbitrum-one-rpc.publicnode.com",
    );
    expect(PUBLICNODE_RPC_URLS[137]).toBe(
      "https://polygon-bor-rpc.publicnode.com",
    );
    expect(PUBLICNODE_RPC_URLS[8453]).toBe("https://base-rpc.publicnode.com");
    expect(PUBLICNODE_RPC_URLS[10]).toBe(
      "https://optimism-rpc.publicnode.com",
    );
  });

  it("Test 13 — VIEM_CHAINS binding correctness: each PublicClient's chain.id matches the ChainId key (proves viem/chains import)", () => {
    expect(getChainClient(1).chain?.id).toBe(1);
    expect(getChainClient(42161).chain?.id).toBe(42161);
    expect(getChainClient(137).chain?.id).toBe(137);
    expect(getChainClient(8453).chain?.id).toBe(8453);
    expect(getChainClient(10).chain?.id).toBe(10);
  });
});

describe("src/chains/registry.ts — ESM spy-affordance (_registry)", () => {
  it("Test 14 — vi.spyOn(_registry, 'getProviderShorthandUrl') intercepts the internal call from getChainClient (proves ESM spy seam)", () => {
    const spy = vi
      .spyOn(_registry, "getProviderShorthandUrl")
      .mockReturnValue("https://spy-url.example/chain");

    const client = getChainClient(42161);
    expect(spy).toHaveBeenCalledWith(42161);
    expect(client.transport.url).toBe("https://spy-url.example/chain");
    expect(isPublicNodeFallback(42161)).toBe(false);
  });
});

describe("src/chains/registry.ts — hasRpcConfiguredForChain", () => {
  it("Test 15a — chain-specific env var → hasRpcConfiguredForChain returns true; other chains false", () => {
    process.env.BASE_RPC_URL = "https://custom-base.example";
    expect(hasRpcConfiguredForChain(8453)).toBe(true);
    expect(hasRpcConfiguredForChain(1)).toBe(false);
    expect(hasRpcConfiguredForChain(42161)).toBe(false);
    expect(hasRpcConfiguredForChain(137)).toBe(false);
    expect(hasRpcConfiguredForChain(10)).toBe(false);
  });

  it("Test 15b — RPC_PROVIDER=infura + RPC_API_KEY=k → all 5 chains true", () => {
    process.env.RPC_PROVIDER = "infura";
    process.env.RPC_API_KEY = "k";
    expect(hasRpcConfiguredForChain(1)).toBe(true);
    expect(hasRpcConfiguredForChain(42161)).toBe(true);
    expect(hasRpcConfiguredForChain(137)).toBe(true);
    expect(hasRpcConfiguredForChain(8453)).toBe(true);
    expect(hasRpcConfiguredForChain(10)).toBe(true);
  });

  it("Test 15c — RPC_PROVIDER=quicknode (unknown) + RPC_API_KEY=k → all 5 chains false (would fall through to PublicNode)", () => {
    process.env.RPC_PROVIDER = "quicknode";
    process.env.RPC_API_KEY = "k";
    expect(hasRpcConfiguredForChain(1)).toBe(false);
    expect(hasRpcConfiguredForChain(42161)).toBe(false);
    expect(hasRpcConfiguredForChain(137)).toBe(false);
    expect(hasRpcConfiguredForChain(8453)).toBe(false);
    expect(hasRpcConfiguredForChain(10)).toBe(false);
  });

  it("Test 15d — no env, no shorthand → all 5 chains false (pure PublicNode setup)", () => {
    expect(hasRpcConfiguredForChain(1)).toBe(false);
    expect(hasRpcConfiguredForChain(42161)).toBe(false);
    expect(hasRpcConfiguredForChain(137)).toBe(false);
    expect(hasRpcConfiguredForChain(8453)).toBe(false);
    expect(hasRpcConfiguredForChain(10)).toBe(false);
  });
});

// Tier-2.5 inferred-provider fan-out. If a user sets only one chain's RPC
// URL to an Infura / Alchemy URL, the same key resolves the other 4 chains
// via PROVIDER_TEMPLATES — eliminating the silent PublicNode fallback on
// the unconfigured chains.
describe("src/chains/registry.ts — inferred-provider fan-out (tier 2.5)", () => {
  it("Test 16 — only ETHEREUM_RPC_URL=<infura> set → all 5 chains resolve to Infura URLs with the same key; ethereum uses its own override; other 4 use templates", () => {
    process.env.ETHEREUM_RPC_URL = "https://mainnet.infura.io/v3/INFURA_KEY";

    expect(getChainClient(1).transport.url).toBe(
      "https://mainnet.infura.io/v3/INFURA_KEY",
    );
    expect(getChainClient(42161).transport.url).toBe(
      "https://arbitrum-mainnet.infura.io/v3/INFURA_KEY",
    );
    expect(getChainClient(137).transport.url).toBe(
      "https://polygon-mainnet.infura.io/v3/INFURA_KEY",
    );
    expect(getChainClient(8453).transport.url).toBe(
      "https://base-mainnet.infura.io/v3/INFURA_KEY",
    );
    expect(getChainClient(10).transport.url).toBe(
      "https://optimism-mainnet.infura.io/v3/INFURA_KEY",
    );

    // No chain is in PublicNode-fallback state — rpcDegraded source is
    // false for every chain.
    expect(isPublicNodeFallback(1)).toBe(false);
    expect(isPublicNodeFallback(42161)).toBe(false);
    expect(isPublicNodeFallback(137)).toBe(false);
    expect(isPublicNodeFallback(8453)).toBe(false);
    expect(isPublicNodeFallback(10)).toBe(false);

    // hasRpcConfiguredForChain reports true for the inferred chains too —
    // get_vaultpilot_config_status's configuredChains map is correct.
    expect(hasRpcConfiguredForChain(1)).toBe(true);
    expect(hasRpcConfiguredForChain(42161)).toBe(true);
    expect(hasRpcConfiguredForChain(137)).toBe(true);
    expect(hasRpcConfiguredForChain(8453)).toBe(true);
    expect(hasRpcConfiguredForChain(10)).toBe(true);

    // Once-per-process stderr info log naming source + destinations (in
    // chain-id ascending scan order: 10/137/8453/42161 = optimism, polygon,
    // base, arbitrum — ethereum is the source so excluded).
    expect(stderrBuf).toMatch(
      /Inferred infura key from ETHEREUM_RPC_URL and fanned out to: optimism, polygon, base, arbitrum/,
    );
    // Key value MUST NOT appear in the log.
    expect(stderrBuf).not.toMatch(/INFURA_KEY/);

    // Once-per-process: a second resolution does NOT re-log.
    const after1 = stderrBuf;
    getChainClient(42161);
    getChainClient(137);
    expect(stderrBuf).toBe(after1);
  });

  it("Test 17 — only ARBITRUM_RPC_URL=<alchemy> set → all 5 chains resolve to Alchemy URLs", () => {
    process.env.ARBITRUM_RPC_URL =
      "https://arb-mainnet.g.alchemy.com/v2/ALCHEMY_KEY";

    expect(getChainClient(42161).transport.url).toBe(
      "https://arb-mainnet.g.alchemy.com/v2/ALCHEMY_KEY",
    );
    expect(getChainClient(1).transport.url).toBe(
      "https://eth-mainnet.g.alchemy.com/v2/ALCHEMY_KEY",
    );
    expect(getChainClient(137).transport.url).toBe(
      "https://polygon-mainnet.g.alchemy.com/v2/ALCHEMY_KEY",
    );
    expect(getChainClient(8453).transport.url).toBe(
      "https://base-mainnet.g.alchemy.com/v2/ALCHEMY_KEY",
    );
    expect(getChainClient(10).transport.url).toBe(
      "https://opt-mainnet.g.alchemy.com/v2/ALCHEMY_KEY",
    );

    expect(stderrBuf).toMatch(
      /Inferred alchemy key from ARBITRUM_RPC_URL and fanned out to/,
    );
  });

  it("Test 18 — self-hosted URL (no provider pattern match) → only that chain is configured; others on PublicNode", () => {
    process.env.ETHEREUM_RPC_URL = "https://my-self-hosted-node.example/rpc";

    expect(getChainClient(1).transport.url).toBe(
      "https://my-self-hosted-node.example/rpc",
    );
    // No inference → other 4 fall through to PublicNode.
    expect(getChainClient(42161).transport.url).toBe(PUBLICNODE_RPC_URLS[42161]);
    expect(getChainClient(137).transport.url).toBe(PUBLICNODE_RPC_URLS[137]);
    expect(getChainClient(8453).transport.url).toBe(PUBLICNODE_RPC_URLS[8453]);
    expect(getChainClient(10).transport.url).toBe(PUBLICNODE_RPC_URLS[10]);

    expect(isPublicNodeFallback(1)).toBe(false);
    expect(isPublicNodeFallback(42161)).toBe(true);

    // No inference info log fires when no URL matches a provider pattern.
    expect(stderrBuf).not.toMatch(/Inferred .* key from/);
  });

  it("Test 19 — explicit per-chain override wins over inference: ETHEREUM=<infura> + ARBITRUM=<custom-self-hosted> → arbitrum keeps custom; others get Infura via fan-out", () => {
    process.env.ETHEREUM_RPC_URL = "https://mainnet.infura.io/v3/KEY_A";
    process.env.ARBITRUM_RPC_URL = "https://my-arb-node.example/rpc";

    expect(getChainClient(1).transport.url).toBe(
      "https://mainnet.infura.io/v3/KEY_A",
    );
    expect(getChainClient(42161).transport.url).toBe(
      "https://my-arb-node.example/rpc",
    );
    expect(getChainClient(137).transport.url).toBe(
      "https://polygon-mainnet.infura.io/v3/KEY_A",
    );
    expect(getChainClient(8453).transport.url).toBe(
      "https://base-mainnet.infura.io/v3/KEY_A",
    );
    expect(getChainClient(10).transport.url).toBe(
      "https://optimism-mainnet.infura.io/v3/KEY_A",
    );

    // Log lists ONLY the chains without their own override (arbitrum
    // excluded — it has a per-chain URL). Scan order: 10/137/8453 =
    // optimism, polygon, base.
    expect(stderrBuf).toMatch(
      /Inferred infura key from ETHEREUM_RPC_URL and fanned out to: optimism, polygon, base/,
    );
    expect(stderrBuf).not.toMatch(
      /fanned out to: .*arbitrum/,
    );
  });

  it("Test 20 — RPC_PROVIDER+RPC_API_KEY shorthand wins over inference for non-overridden chains; per-chain override still wins over shorthand", () => {
    process.env.RPC_PROVIDER = "alchemy";
    process.env.RPC_API_KEY = "SHORTHAND_KEY";
    process.env.ETHEREUM_RPC_URL = "https://mainnet.infura.io/v3/INFURA_Y";

    // Per-chain override wins on ethereum.
    expect(getChainClient(1).transport.url).toBe(
      "https://mainnet.infura.io/v3/INFURA_Y",
    );
    // Other 4 use the explicit Alchemy shorthand (NOT inferred Infura).
    expect(getChainClient(42161).transport.url).toBe(
      "https://arb-mainnet.g.alchemy.com/v2/SHORTHAND_KEY",
    );
    expect(getChainClient(137).transport.url).toBe(
      "https://polygon-mainnet.g.alchemy.com/v2/SHORTHAND_KEY",
    );
    expect(getChainClient(8453).transport.url).toBe(
      "https://base-mainnet.g.alchemy.com/v2/SHORTHAND_KEY",
    );
    expect(getChainClient(10).transport.url).toBe(
      "https://opt-mainnet.g.alchemy.com/v2/SHORTHAND_KEY",
    );

    // Inference was preempted — no info log.
    expect(stderrBuf).not.toMatch(/Inferred .* key from/);
  });

  it("Test 21 — first-match wins (chain-id ascending): ETHEREUM=<infura-A> + ARBITRUM=<alchemy-B> → ethereum's Infura wins; arbitrum keeps its own URL; polygon/base/optimism use Infura-A", () => {
    process.env.ETHEREUM_RPC_URL = "https://mainnet.infura.io/v3/KEY_A";
    process.env.ARBITRUM_RPC_URL =
      "https://arb-mainnet.g.alchemy.com/v2/KEY_B";

    // Source-chain overrides still win for themselves.
    expect(getChainClient(1).transport.url).toBe(
      "https://mainnet.infura.io/v3/KEY_A",
    );
    expect(getChainClient(42161).transport.url).toBe(
      "https://arb-mainnet.g.alchemy.com/v2/KEY_B",
    );
    // Polygon/Base/Optimism use the FIRST-match (ethereum, chain id 1).
    expect(getChainClient(137).transport.url).toBe(
      "https://polygon-mainnet.infura.io/v3/KEY_A",
    );
    expect(getChainClient(8453).transport.url).toBe(
      "https://base-mainnet.infura.io/v3/KEY_A",
    );
    expect(getChainClient(10).transport.url).toBe(
      "https://optimism-mainnet.infura.io/v3/KEY_A",
    );

    expect(stderrBuf).toMatch(
      /Inferred infura key from ETHEREUM_RPC_URL/,
    );
  });

  it("Test 22 — single chain set + that chain is also the source: fan-out log fires only when at least one destination chain receives a URL (no destination → no log spam)", () => {
    // All 5 chains have an explicit per-chain override → inference scans
    // first match (ethereum-infura) but no destination chains exist (all
    // have their own override). No log should fire.
    process.env.ETHEREUM_RPC_URL = "https://mainnet.infura.io/v3/KA";
    process.env.ARBITRUM_RPC_URL = "https://arb-node.example/rpc";
    process.env.POLYGON_RPC_URL = "https://pol-node.example/rpc";
    process.env.BASE_RPC_URL = "https://base-node.example/rpc";
    process.env.OPTIMISM_RPC_URL = "https://opt-node.example/rpc";

    getChainClient(1);
    getChainClient(42161);
    getChainClient(137);
    getChainClient(8453);
    getChainClient(10);

    expect(stderrBuf).not.toMatch(/Inferred .* key from/);
  });
});
