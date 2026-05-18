import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 8 — Plan 08-03: cross-chain `get_portfolio_summary` fan-out.
//
// When `chain` is OMITTED, the tool fans out across all 5 chains via
// `Promise.allSettled` with a per-chain 10s `AbortController` timeout. This
// test file mocks the per-chainId factory at src/chains/registry.js to
// surface different behaviours per chain (happy path, throw, hang). The
// single-chain happy-path coverage lives in
// `test/get-portfolio-summary.test.ts` (Phase 2 baseline + 2 L2 cases
// pinned via `chain:` arg).

type ChainId = 1 | 42161 | 137 | 8453 | 10;

interface PerChainState {
  /** Native balance bigint returned by getBalance(). Default 0n. */
  nativeBalance: bigint;
  /** When set, getBalance throws this error. */
  nativeBalanceError?: Error;
  /** When true, getBalance returns a never-resolving promise (hangs forever, triggers timeout). */
  nativeBalanceHangs?: boolean;
  /** ERC-20 multicall results returned by scanErc20Balances(). Default []. */
  erc20: Array<{ token: { address: Address; symbol: string; decimals: number; name: string }; balance: bigint; error?: string }>;
  /** When true, isPublicNodeFallback() returns true for this chain. */
  rpcDegraded?: boolean;
}

const state: Record<ChainId, PerChainState> = {
  1: { nativeBalance: 0n, erc20: [] },
  42161: { nativeBalance: 0n, erc20: [] },
  137: { nativeBalance: 0n, erc20: [] },
  8453: { nativeBalance: 0n, erc20: [] },
  10: { nativeBalance: 0n, erc20: [] },
};

vi.mock("../src/chains/registry.js", () => {
  return {
    getChainClient: (chainId: ChainId) => ({
      getBalance: vi.fn(async () => {
        const s = state[chainId];
        if (s.nativeBalanceError) throw s.nativeBalanceError;
        if (s.nativeBalanceHangs) {
          return new Promise<bigint>(() => {
            /* never resolves — triggers timeout race */
          });
        }
        return s.nativeBalance;
      }),
    }),
    isPublicNodeFallback: (chainId: ChainId) => state[chainId].rpcDegraded ?? false,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
  };
});

vi.mock("../src/chains/erc20-scanner.js", async () => {
  const real = await vi.importActual<typeof import("../src/chains/erc20-scanner.js")>(
    "../src/chains/erc20-scanner.js",
  );
  return {
    ...real,
    scanErc20Balances: vi.fn(async (_wallet: Address, _tokens, chainId?: ChainId) => {
      const id = (chainId ?? 1) as ChainId;
      const s = state[id];
      if (s.nativeBalanceHangs) {
        return new Promise(() => {
          /* never resolves */
        });
      }
      return s.erc20;
    }),
  };
});

import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";
import { _resetPriceCacheForTesting } from "../src/pricing/defillama.js";
import type { ChainName } from "../src/config/contracts.js";

const WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

// WETH per-chain pricing proxies (Plan 08-03: getWethAddress(chainId) drives
// per-chain native-asset pricing). The test mocks DefiLlama by chain:address
// key so the per-chain getPrices call hits the right entry.
const WETH_BY_CHAIN: Record<ChainName, Address> = {
  ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  polygon: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC
  base: "0x4200000000000000000000000000000000000006",
  optimism: "0x4200000000000000000000000000000000000006",
};

const USDC_BY_CHAIN: Record<ChainName, Address> = {
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
};

/**
 * Builds a `fetch` mock keyed by `<chain>:<address-lower>`. Caller passes
 * keys in the form `<chain>:<address>` (any address casing).
 */
function makeChainPricedFetch(prices: Record<string, number>): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      coins: Object.fromEntries(
        Object.entries(prices).map(([key, price]) => {
          const [chain, addr] = key.split(":");
          return [`${chain}:${addr!.toLowerCase()}`, { price }];
        }),
      ),
    }),
  }));
}

/** Helper: native pricing for every chain at $1 native and $1 stable. */
function defaultAllChainPrices(nativeUsd: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const chain of ["ethereum", "arbitrum", "polygon", "base", "optimism"] as ChainName[]) {
    out[`${chain}:${WETH_BY_CHAIN[chain]}`] = nativeUsd;
    out[`${chain}:${USDC_BY_CHAIN[chain]}`] = 1.0;
  }
  return out;
}

function resetAllChainState(): void {
  for (const id of [1, 42161, 137, 8453, 10] as ChainId[]) {
    state[id] = { nativeBalance: 0n, erc20: [] };
  }
}

beforeEach(() => {
  resetAllChainState();
  _resetPriceCacheForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_portfolio_summary");
  if (!tool) throw new Error("get_portfolio_summary not registered");
  return tool.handler(args);
}

describe("get_portfolio_summary cross-chain fan-out (chain OMITTED, Plan 08-03 READ-41)", () => {
  it("Test 1: 5-chain happy path — perChain has all 5; chainErrors empty; totalUsd is the sum", async () => {
    // Give each chain a small native balance to verify per-chain summation.
    state[1].nativeBalance = 1_000_000_000_000_000_000n; // 1 ETH @ $3000 = $3000
    state[42161].nativeBalance = 2_000_000_000_000_000_000n; // 2 ETH @ $3000 = $6000
    state[137].nativeBalance = 100_000_000_000_000_000_000n; // 100 MATIC @ $3000 = $300000 (we'll use $0.50 below)
    state[8453].nativeBalance = 500_000_000_000_000_000n; // 0.5 ETH @ $3000 = $1500
    state[10].nativeBalance = 250_000_000_000_000_000n; // 0.25 ETH @ $3000 = $750

    const prices: Record<string, number> = {
      [`ethereum:${WETH_BY_CHAIN.ethereum}`]: 3000,
      [`arbitrum:${WETH_BY_CHAIN.arbitrum}`]: 3000,
      [`polygon:${WETH_BY_CHAIN.polygon}`]: 0.5, // MATIC
      [`base:${WETH_BY_CHAIN.base}`]: 3000,
      [`optimism:${WETH_BY_CHAIN.optimism}`]: 3000,
    };
    vi.stubGlobal("fetch", makeChainPricedFetch(prices));

    const result = await callTool({ wallet: WALLET });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      perChain: Record<string, { chain: string; totalUsd: string }>;
      chainErrors: Array<{ chain: string; reason: string }>;
      totalUsd: string;
    };
    expect(Object.keys(out.perChain).sort()).toEqual(["arbitrum", "base", "ethereum", "optimism", "polygon"]);
    expect(out.chainErrors).toEqual([]);
    // 3000 + 6000 + 50 + 1500 + 750 = 11300
    expect(out.totalUsd).toBe("11300.00");
    expect(out.perChain.ethereum?.chain).toBe("ethereum");
    expect(out.perChain.arbitrum?.chain).toBe("arbitrum");
  });

  it("Test 2: 1-chain failure (Polygon throws) surfaces in chainErrors; other 4 succeed", async () => {
    state[1].nativeBalance = 1_000_000_000_000_000_000n;
    state[42161].nativeBalance = 1_000_000_000_000_000_000n;
    state[137].nativeBalanceError = new Error("polygon RPC down");
    state[8453].nativeBalance = 1_000_000_000_000_000_000n;
    state[10].nativeBalance = 1_000_000_000_000_000_000n;
    vi.stubGlobal("fetch", makeChainPricedFetch(defaultAllChainPrices(3000)));

    const result = await callTool({ wallet: WALLET });
    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      perChain: Record<string, unknown>;
      chainErrors: Array<{ chain: string; reason: string }>;
      totalUsd: string;
    };
    expect(Object.keys(out.perChain).sort()).toEqual(["arbitrum", "base", "ethereum", "optimism"]);
    expect(out.chainErrors).toHaveLength(1);
    expect(out.chainErrors[0]?.chain).toBe("polygon");
    expect(out.chainErrors[0]?.reason).toMatch(/polygon RPC down/);
    // 4 chains * 1 ETH * $3000 = $12000
    expect(out.totalUsd).toBe("12000.00");
  });

  it("Test 3: per-chain timeout (Optimism hangs > 10s) surfaces as chainErrors row", async () => {
    vi.useFakeTimers();
    state[1].nativeBalance = 1_000_000_000_000_000_000n;
    state[42161].nativeBalance = 1_000_000_000_000_000_000n;
    state[137].nativeBalance = 1_000_000_000_000_000_000n;
    state[8453].nativeBalance = 1_000_000_000_000_000_000n;
    state[10].nativeBalanceHangs = true;
    vi.stubGlobal("fetch", makeChainPricedFetch(defaultAllChainPrices(3000)));

    const handlerPromise = callTool({ wallet: WALLET });
    // Advance past the 10s timeout window.
    await vi.advanceTimersByTimeAsync(10_001);
    const result = await handlerPromise;
    vi.useRealTimers();

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      perChain: Record<string, unknown>;
      chainErrors: Array<{ chain: string; reason: string }>;
      totalUsd: string;
    };
    expect(Object.keys(out.perChain).sort()).toEqual(["arbitrum", "base", "ethereum", "polygon"]);
    expect(out.chainErrors).toHaveLength(1);
    expect(out.chainErrors[0]?.chain).toBe("optimism");
    expect(out.chainErrors[0]?.reason).toMatch(/timeout after 10000ms/);
  });

  it("Test 4: per-row `chain` field on every nativeBalance + erc20Balance row", async () => {
    const usdcByChain = USDC_BY_CHAIN;
    state[1].nativeBalance = 1_000_000_000_000_000_000n;
    state[1].erc20 = [{ token: { address: usdcByChain.ethereum, symbol: "USDC", decimals: 6, name: "USD Coin" }, balance: 100_000_000n }];
    state[42161].nativeBalance = 1_000_000_000_000_000_000n;
    state[42161].erc20 = [{ token: { address: usdcByChain.arbitrum, symbol: "USDC", decimals: 6, name: "USD Coin" }, balance: 100_000_000n }];
    state[137].nativeBalance = 1_000_000_000_000_000_000n;
    state[8453].nativeBalance = 1_000_000_000_000_000_000n;
    state[10].nativeBalance = 1_000_000_000_000_000_000n;
    vi.stubGlobal("fetch", makeChainPricedFetch(defaultAllChainPrices(3000)));

    const result = await callTool({ wallet: WALLET });
    const out = result.structuredContent as {
      perChain: Record<string, { chain: string; nativeBalance: { chain: string }; erc20Balances: Array<{ chain: string }> }>;
    };
    for (const chain of ["ethereum", "arbitrum", "polygon", "base", "optimism"]) {
      const c = out.perChain[chain]!;
      expect(c.chain).toBe(chain);
      expect(c.nativeBalance.chain).toBe(chain);
      for (const row of c.erc20Balances) {
        expect(row.chain).toBe(chain);
      }
    }
  });

  it("Test 5: per-chain rpcDegraded bubbles up from isPublicNodeFallback(chainId)", async () => {
    state[42161].rpcDegraded = true; // Arbitrum on PublicNode
    state[1].rpcDegraded = false;
    state[1].nativeBalance = 1_000_000_000_000_000_000n;
    state[42161].nativeBalance = 1_000_000_000_000_000_000n;
    state[137].nativeBalance = 1_000_000_000_000_000_000n;
    state[8453].nativeBalance = 1_000_000_000_000_000_000n;
    state[10].nativeBalance = 1_000_000_000_000_000_000n;
    vi.stubGlobal("fetch", makeChainPricedFetch(defaultAllChainPrices(3000)));

    const result = await callTool({ wallet: WALLET });
    const out = result.structuredContent as {
      perChain: Record<string, { rpcDegraded?: boolean }>;
    };
    expect(out.perChain.arbitrum?.rpcDegraded).toBe(true);
    expect(out.perChain.ethereum?.rpcDegraded).toBeUndefined();
  });

  it("Test 6: single-chain branch backward-compat — `chain:\"polygon\"` returns single-chain shape (not perChain wrapper)", async () => {
    state[137].nativeBalance = 50_000_000_000_000_000_000n;
    vi.stubGlobal("fetch", makeChainPricedFetch({
      [`polygon:${WETH_BY_CHAIN.polygon}`]: 0.5,
    }));

    const result = await callTool({ wallet: WALLET, chain: "polygon" });
    const out = result.structuredContent as {
      chain?: string;
      perChain?: unknown;
      nativeBalance?: { chain: string; balance: string };
      totalUsd?: string;
    };
    expect(out.perChain).toBeUndefined();
    expect(out.chain).toBe("polygon");
    expect(out.nativeBalance?.chain).toBe("polygon");
    expect(out.nativeBalance?.balance).toBe("50");
    expect(out.totalUsd).toBe("25.00");
  });

  it("Test 7: wallet validation — malformed wallet returns INVALID_INPUT envelope on the cross-chain path too", async () => {
    const result = await callTool({ wallet: "not-an-address" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/wallet/);
  });

  it("Test 8: Promise.allSettled semantics — 2 chains reject + 3 fulfill", async () => {
    state[1].nativeBalanceError = new Error("ethereum RPC error");
    state[42161].nativeBalance = 1_000_000_000_000_000_000n;
    state[137].nativeBalanceError = new Error("polygon RPC error");
    state[8453].nativeBalance = 1_000_000_000_000_000_000n;
    state[10].nativeBalance = 1_000_000_000_000_000_000n;
    vi.stubGlobal("fetch", makeChainPricedFetch(defaultAllChainPrices(3000)));

    const result = await callTool({ wallet: WALLET });
    const out = result.structuredContent as {
      perChain: Record<string, unknown>;
      chainErrors: Array<{ chain: string; reason: string }>;
      totalUsd: string;
    };
    expect(Object.keys(out.perChain).sort()).toEqual(["arbitrum", "base", "optimism"]);
    expect(out.chainErrors.map((e) => e.chain).sort()).toEqual(["ethereum", "polygon"]);
    // 3 chains * 1 ETH * $3000 = $9000
    expect(out.totalUsd).toBe("9000.00");
  });

  it("Test 9: empty chainErrors when all succeed — explicit empty array (not undefined)", async () => {
    for (const id of [1, 42161, 137, 8453, 10] as ChainId[]) {
      state[id].nativeBalance = 0n;
    }
    vi.stubGlobal("fetch", makeChainPricedFetch(defaultAllChainPrices(3000)));

    const result = await callTool({ wallet: WALLET });
    const out = result.structuredContent as {
      chainErrors: Array<{ chain: string; reason: string }>;
    };
    expect(Array.isArray(out.chainErrors)).toBe(true);
    expect(out.chainErrors).toEqual([]);
  });

  it("Test 10: chat-friendly render — content text names 5 chains + per-chain rows", async () => {
    state[1].nativeBalance = 1_000_000_000_000_000_000n;
    state[42161].nativeBalance = 1_000_000_000_000_000_000n;
    vi.stubGlobal("fetch", makeChainPricedFetch(defaultAllChainPrices(3000)));

    const result = await callTool({ wallet: WALLET });
    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/across 5 chains/);
    expect(text).toMatch(/ethereum:/);
    expect(text).toMatch(/arbitrum:/);
    expect(text).toMatch(/polygon:/);
    expect(text).toMatch(/base:/);
    expect(text).toMatch(/optimism:/);
  });
});
