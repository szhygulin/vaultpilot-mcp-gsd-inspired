import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 8 — Plan 08-03: tool migrated from `getEthereumClient()` (compat
// shim) to `getChainClient(chainId)` (per-chain factory). Mocking the
// per-chain factory at src/chains/registry.js is the correct test seam —
// the singleton wrappers in src/chains/ethereum.ts no longer flow into the
// tool's code path.
//
// The mock collapses the per-chain dispatch to one stub for single-chain
// tests (every test in this file pins `chain: "ethereum"` via the callTool
// wrapper); the cross-chain fan-out is exercised in
// `test/get-portfolio-summary.cross-chain.test.ts` with a per-chainId mock.
let nativeBalance: bigint = 0n;
let nativeBalanceShouldThrow: Error | undefined;
let publicNodeFallback = true;

vi.mock("../src/chains/registry.js", () => {
  return {
    getChainClient: () => ({
      getBalance: vi.fn(async () => {
        if (nativeBalanceShouldThrow) throw nativeBalanceShouldThrow;
        return nativeBalance;
      }),
    }),
    isPublicNodeFallback: () => publicNodeFallback,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
  };
});

// Mock the ERC-20 scanner — bypass multicall plumbing entirely.
let erc20Result: Array<{ token: { address: Address; symbol: string; decimals: number; name: string }; balance: bigint; error?: string }> = [];

vi.mock("../src/chains/erc20-scanner.js", async () => {
  const real = await vi.importActual<typeof import("../src/chains/erc20-scanner.js")>(
    "../src/chains/erc20-scanner.js",
  );
  return {
    ...real,
    scanErc20Balances: vi.fn(async () => erc20Result),
  };
});

import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";
import { _resetPriceCacheForTesting } from "../src/pricing/defillama.js";

const WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const DAI: Address = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const WETH_ETHEREUM: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WETH_ARBITRUM: Address = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const WMATIC: Address = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270";
const USDC_ARBITRUM: Address = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDC_POLYGON: Address = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const PEPE: Address = "0x6982508145454Ce325dDbE47a25d4ec3d2311933";

/**
 * Builds a DefiLlama `fetch` mock that returns the given per-chain prices.
 * Keys may be `"<chain>:<address>"` (preferred) or bare addresses (assumes
 * ethereum). The mock matches DefiLlama's wire format
 * (`coins=<chain>:<lowercase-address>`) regardless of input casing.
 */
function makeFetchReturning(
  prices: Record<string, number>,
  defaultChain: string = "ethereum",
): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      coins: Object.fromEntries(
        Object.entries(prices).map(([key, price]) => {
          if (key.includes(":")) {
            const [chain, addr] = key.split(":");
            return [`${chain}:${addr!.toLowerCase()}`, { price }];
          }
          return [`${defaultChain}:${key.toLowerCase()}`, { price }];
        }),
      ),
    }),
  }));
}

beforeEach(() => {
  nativeBalance = 0n;
  nativeBalanceShouldThrow = undefined;
  erc20Result = [];
  publicNodeFallback = true;
  _resetPriceCacheForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  void _resetRegistryForTesting; // re-export reference; tool registry persists across tests by design
});

/**
 * Default test wrapper: pins `chain: "ethereum"` so the existing Phase 2
 * single-chain test suite continues to assert the single-chain shape (NOT
 * the cross-chain `perChain`-wrapper shape that the chain-OMITTED branch
 * returns). Tests that want to exercise the cross-chain branch live in
 * `test/get-portfolio-summary.cross-chain.test.ts`.
 */
async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_portfolio_summary");
  if (!tool) throw new Error("get_portfolio_summary not registered");
  const withDefaultChain = "chain" in args ? args : { ...args, chain: "ethereum" };
  return tool.handler(withDefaultChain);
}

describe("get_portfolio_summary tool — single-chain branch (chain provided)", () => {
  it("returns totalUsd = 0 for an empty wallet on ethereum", async () => {
    nativeBalance = 0n;
    erc20Result = [];
    vi.stubGlobal("fetch", makeFetchReturning({ [WETH_ETHEREUM]: 3000 }));

    const result = await callTool({ wallet: WALLET });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      chain: string;
      nativeBalance: { chain: string; balance: string; balanceUsd?: string; priceUnknown?: true };
      erc20Balances: unknown[];
      totalUsd: string;
      rpcDegraded?: boolean;
    };
    expect(out.chain).toBe("ethereum");
    expect(out.nativeBalance.chain).toBe("ethereum");
    expect(out.nativeBalance.balance).toBe("0");
    expect(out.erc20Balances).toEqual([]);
    expect(out.totalUsd).toBe("0.00");
    expect(out.rpcDegraded).toBe(true);
  });

  it("aggregates native ETH + ERC-20 holdings into totalUsd", async () => {
    nativeBalance = 1_500_000_000_000_000_000n; // 1.5 ETH
    erc20Result = [
      {
        token: { address: USDC, symbol: "USDC", decimals: 6, name: "USD Coin" },
        balance: 1_000_000_000n, // 1000 USDC (6 decimals)
      },
      {
        token: { address: DAI, symbol: "DAI", decimals: 18, name: "Dai Stablecoin" },
        balance: 500_000_000_000_000_000_000n, // 500 DAI (18 decimals)
      },
    ];
    vi.stubGlobal(
      "fetch",
      makeFetchReturning({
        [WETH_ETHEREUM]: 3000, // ETH = $3000
        [USDC]: 1.0,
        [DAI]: 1.0,
      }),
    );

    const result = await callTool({ wallet: WALLET });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      chain: string;
      nativeBalance: { chain: string; balance: string; balanceUsd?: string };
      erc20Balances: Array<{ chain: string; symbol: string; balance: string; balanceUsd?: string }>;
      totalUsd: string;
    };
    expect(out.chain).toBe("ethereum");
    expect(out.nativeBalance.balance).toBe("1.5");
    expect(out.nativeBalance.balanceUsd).toBe("4500.00");
    expect(out.nativeBalance.chain).toBe("ethereum");
    const bySymbol = Object.fromEntries(out.erc20Balances.map((r) => [r.symbol, r]));
    expect(bySymbol.USDC?.balance).toBe("1000");
    expect(bySymbol.USDC?.balanceUsd).toBe("1000.00");
    expect(bySymbol.USDC?.chain).toBe("ethereum");
    expect(bySymbol.DAI?.balance).toBe("500");
    expect(bySymbol.DAI?.balanceUsd).toBe("500.00");
    expect(bySymbol.DAI?.chain).toBe("ethereum");
    expect(out.totalUsd).toBe("6000.00");
  });

  it("applies the default $0.01 dust filter", async () => {
    nativeBalance = 0n;
    erc20Result = [
      {
        token: { address: USDC, symbol: "USDC", decimals: 6, name: "USD Coin" },
        balance: 1_000_000n, // 1.0 USDC = $1.00 → above dust
      },
      {
        token: { address: DAI, symbol: "DAI", decimals: 18, name: "Dai Stablecoin" },
        balance: 1_000_000_000_000n, // 0.000001 DAI = $0.000001 → dust
      },
    ];
    vi.stubGlobal(
      "fetch",
      makeFetchReturning({
        [WETH_ETHEREUM]: 3000,
        [USDC]: 1.0,
        [DAI]: 1.0,
      }),
    );

    const result = await callTool({ wallet: WALLET });
    const out = result.structuredContent as {
      erc20Balances: Array<{ symbol: string }>;
    };
    expect(out.erc20Balances.map((r) => r.symbol)).toEqual(["USDC"]);
  });

  it("dustThreshold=0 disables the filter and includes all non-zero rows", async () => {
    nativeBalance = 0n;
    erc20Result = [
      {
        token: { address: USDC, symbol: "USDC", decimals: 6, name: "USD Coin" },
        balance: 1n, // 0.000001 USDC — sub-cent, kept when threshold disabled
      },
    ];
    vi.stubGlobal(
      "fetch",
      makeFetchReturning({
        [WETH_ETHEREUM]: 3000,
        [USDC]: 1.0,
      }),
    );

    const result = await callTool({ wallet: WALLET, dustThreshold: 0 });
    const out = result.structuredContent as {
      erc20Balances: Array<{ symbol: string }>;
    };
    expect(out.erc20Balances.map((r) => r.symbol)).toEqual(["USDC"]);
  });

  it("surfaces priceUnknown rows even when balanceUsd is undefined", async () => {
    nativeBalance = 0n;
    erc20Result = [
      {
        token: { address: PEPE, symbol: "PEPE", decimals: 18, name: "Pepe" },
        balance: 1_000_000_000_000_000_000_000n, // 1000 PEPE
      },
    ];
    // DefiLlama returns no entry for PEPE → priceUnknown.
    vi.stubGlobal("fetch", makeFetchReturning({ [WETH_ETHEREUM]: 3000 }));

    const result = await callTool({ wallet: WALLET });
    const out = result.structuredContent as {
      erc20Balances: Array<{ chain: string; symbol: string; balance: string; balanceUsd?: string; priceUnknown?: true }>;
      totalUsd: string;
    };
    expect(out.erc20Balances).toHaveLength(1);
    const row = out.erc20Balances[0]!;
    expect(row.symbol).toBe("PEPE");
    expect(row.balance).toBe("1000");
    expect(row.balanceUsd).toBeUndefined();
    expect(row.priceUnknown).toBe(true);
    expect(row.chain).toBe("ethereum");
    expect(out.totalUsd).toBe("0.00");
  });

  it("never dust-filters priceUnknown rows even on a high threshold", async () => {
    nativeBalance = 0n;
    erc20Result = [
      {
        token: { address: PEPE, symbol: "PEPE", decimals: 18, name: "Pepe" },
        balance: 1_000_000_000_000_000_000n, // 1 PEPE — small, no price
      },
    ];
    vi.stubGlobal("fetch", makeFetchReturning({ [WETH_ETHEREUM]: 3000 }));

    const result = await callTool({ wallet: WALLET, dustThreshold: 100 });
    const out = result.structuredContent as {
      erc20Balances: Array<{ symbol: string; priceUnknown?: true }>;
    };
    expect(out.erc20Balances).toHaveLength(1);
    expect(out.erc20Balances[0]?.priceUnknown).toBe(true);
  });

  it("rejects malformed wallet input", async () => {
    const result = await callTool({ wallet: "not-an-address" });
    expect(result.isError).toBe(true);
  });

  it("rejects negative dustThreshold", async () => {
    const result = await callTool({ wallet: WALLET, dustThreshold: -1 });
    expect(result.isError).toBe(true);
  });

  it("returns isError when the native balance read throws", async () => {
    nativeBalanceShouldThrow = new Error("RPC down");
    vi.stubGlobal("fetch", makeFetchReturning({ [WETH_ETHEREUM]: 3000 }));

    const result = await callTool({ wallet: WALLET });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/RPC down/);
  });
});

describe("get_portfolio_summary tool — single-chain branch on L2 chains (Plan 08-03)", () => {
  it("chain=\"arbitrum\" returns single-chain shape with arbitrum-tagged rows", async () => {
    nativeBalance = 2_000_000_000_000_000_000n; // 2 ETH on Arbitrum
    erc20Result = [
      {
        token: { address: USDC_ARBITRUM, symbol: "USDC", decimals: 6, name: "USD Coin" },
        balance: 500_000_000n, // 500 USDC
      },
    ];
    vi.stubGlobal(
      "fetch",
      makeFetchReturning({
        [`arbitrum:${WETH_ARBITRUM}`]: 3000,
        [`arbitrum:${USDC_ARBITRUM}`]: 1.0,
      }),
    );

    const result = await callTool({ wallet: WALLET, chain: "arbitrum" });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      chain: string;
      nativeBalance: { chain: string; balance: string; balanceUsd?: string };
      erc20Balances: Array<{ chain: string; symbol: string; balance: string; balanceUsd?: string }>;
      totalUsd: string;
      perChain?: unknown;
    };
    // Single-chain shape — NOT wrapped in perChain
    expect(out.perChain).toBeUndefined();
    expect(out.chain).toBe("arbitrum");
    expect(out.nativeBalance.chain).toBe("arbitrum");
    expect(out.nativeBalance.balance).toBe("2");
    expect(out.nativeBalance.balanceUsd).toBe("6000.00");
    expect(out.erc20Balances).toHaveLength(1);
    expect(out.erc20Balances[0]?.chain).toBe("arbitrum");
    expect(out.erc20Balances[0]?.symbol).toBe("USDC");
    expect(out.erc20Balances[0]?.balanceUsd).toBe("500.00");
    expect(out.totalUsd).toBe("6500.00");
  });

  it("chain=\"polygon\" returns single-chain shape with polygon-tagged rows + WMATIC native proxy", async () => {
    nativeBalance = 100_000_000_000_000_000_000n; // 100 MATIC (18 decimals)
    erc20Result = [
      {
        token: { address: USDC_POLYGON, symbol: "USDC", decimals: 6, name: "USD Coin" },
        balance: 250_000_000n, // 250 USDC
      },
    ];
    vi.stubGlobal(
      "fetch",
      makeFetchReturning({
        [`polygon:${WMATIC}`]: 0.5, // MATIC = $0.50
        [`polygon:${USDC_POLYGON}`]: 1.0,
      }),
    );

    const result = await callTool({ wallet: WALLET, chain: "polygon" });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      chain: string;
      nativeBalance: { chain: string; balance: string; balanceUsd?: string };
      erc20Balances: Array<{ chain: string; symbol: string }>;
      totalUsd: string;
    };
    expect(out.chain).toBe("polygon");
    expect(out.nativeBalance.chain).toBe("polygon");
    expect(out.nativeBalance.balance).toBe("100");
    expect(out.nativeBalance.balanceUsd).toBe("50.00");
    expect(out.erc20Balances).toHaveLength(1);
    expect(out.erc20Balances[0]?.chain).toBe("polygon");
    // 100 MATIC @ $0.50 + 250 USDC @ $1 = $50 + $250 = $300
    expect(out.totalUsd).toBe("300.00");
  });

  it("rejects invalid chain values", async () => {
    const tool = getRegisteredTool("get_portfolio_summary")!;
    const result = await tool.handler({ wallet: WALLET, chain: "solana" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/chain/);
  });
});
