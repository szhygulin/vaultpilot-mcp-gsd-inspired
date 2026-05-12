import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the ethereum client BEFORE importing anything that resolves it.
// Holders for the per-test mock implementations — re-bound in each test.
let nativeBalance: bigint = 0n;
let nativeBalanceShouldThrow: Error | undefined;

vi.mock("../src/chains/ethereum.js", () => {
  return {
    getEthereumClient: () => ({
      getBalance: vi.fn(async () => {
        if (nativeBalanceShouldThrow) throw nativeBalanceShouldThrow;
        return nativeBalance;
      }),
    }),
    isPublicNodeFallback: () => true,
    _resetEthereumClientForTesting: () => {},
    PUBLICNODE_ETHEREUM_RPC_URL: "https://test.invalid",
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
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const PEPE: Address = "0x6982508145454Ce325dDbE47a25d4ec3d2311933";

function makeFetchReturning(prices: Record<string, number>): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      coins: Object.fromEntries(
        Object.entries(prices).map(([addr, price]) => [
          `ethereum:${addr.toLowerCase()}`,
          { price },
        ]),
      ),
    }),
  }));
}

beforeEach(() => {
  nativeBalance = 0n;
  nativeBalanceShouldThrow = undefined;
  erc20Result = [];
  _resetPriceCacheForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  void _resetRegistryForTesting; // re-export reference; tool registry persists across tests by design
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_portfolio_summary");
  if (!tool) throw new Error("get_portfolio_summary not registered");
  return tool.handler(args);
}

describe("get_portfolio_summary tool", () => {
  it("returns totalUsd = 0 for an empty wallet", async () => {
    nativeBalance = 0n;
    erc20Result = [];
    vi.stubGlobal("fetch", makeFetchReturning({ [WETH]: 3000 }));

    const result = await callTool({ wallet: WALLET });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      chain: string;
      nativeBalance: { balance: string; balanceUsd?: string; priceUnknown?: true };
      erc20Balances: unknown[];
      totalUsd: string;
      rpcDegraded?: boolean;
    };
    expect(out.chain).toBe("ethereum");
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
        [WETH]: 3000, // ETH = $3000
        [USDC]: 1.0,
        [DAI]: 1.0,
      }),
    );

    const result = await callTool({ wallet: WALLET });

    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      nativeBalance: { balance: string; balanceUsd?: string };
      erc20Balances: Array<{ symbol: string; balance: string; balanceUsd?: string }>;
      totalUsd: string;
    };
    expect(out.nativeBalance.balance).toBe("1.5");
    expect(out.nativeBalance.balanceUsd).toBe("4500.00");
    // Order preserved from registry order — not asserted strictly, but both must appear.
    const bySymbol = Object.fromEntries(out.erc20Balances.map((r) => [r.symbol, r]));
    expect(bySymbol.USDC?.balance).toBe("1000");
    expect(bySymbol.USDC?.balanceUsd).toBe("1000.00");
    expect(bySymbol.DAI?.balance).toBe("500");
    expect(bySymbol.DAI?.balanceUsd).toBe("500.00");
    // Total: 4500 ETH + 1000 USDC + 500 DAI = 6000
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
        [WETH]: 3000,
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
        [WETH]: 3000,
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
    vi.stubGlobal("fetch", makeFetchReturning({ [WETH]: 3000 }));

    const result = await callTool({ wallet: WALLET });
    const out = result.structuredContent as {
      erc20Balances: Array<{ symbol: string; balance: string; balanceUsd?: string; priceUnknown?: true }>;
      totalUsd: string;
    };
    expect(out.erc20Balances).toHaveLength(1);
    const row = out.erc20Balances[0]!;
    expect(row.symbol).toBe("PEPE");
    expect(row.balance).toBe("1000");
    expect(row.balanceUsd).toBeUndefined();
    expect(row.priceUnknown).toBe(true);
    // priceUnknown contributes 0 to totalUsd; native ETH is also 0 here.
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
    vi.stubGlobal("fetch", makeFetchReturning({ [WETH]: 3000 }));

    const result = await callTool({ wallet: WALLET, dustThreshold: 100 });
    const out = result.structuredContent as {
      erc20Balances: Array<{ symbol: string; priceUnknown?: true }>;
    };
    // Above dust threshold = $100; PEPE has no price → can't measure → kept.
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
    vi.stubGlobal("fetch", makeFetchReturning({ [WETH]: 3000 }));

    const result = await callTool({ wallet: WALLET });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/RPC down/);
  });
});
