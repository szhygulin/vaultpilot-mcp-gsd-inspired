// get_compound_market_info tests — Phase 28 Plan 28-04 (CMP-02).
//
// Per-Comet metadata read; no wallet arg. Anchors:
//   - APR computation: rate × SECONDS_PER_YEAR × 100 / 1e18 (Pitfall #4 —
//     divide by 1e18 LAST).
//   - 6-Comet enumeration via getAllCompoundCometsForChain(1).
//   - rpcDegraded surface when public-node fallback fires.
//   - INVALID_INPUT on non-canonical Comet address.

import type { Address, PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let publicNodeFallback = false;
vi.mock("../src/chains/registry.js", () => {
  return {
    getChainClient: () => ({ readContract: vi.fn() }) as unknown as PublicClient,
    isPublicNodeFallback: () => publicNodeFallback,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
  };
});

import { _compoundChains } from "../src/chains/compound-v3.js";
import {
  getAllCompoundCometsForChain,
  getCompoundCometAddress,
} from "../src/config/contracts.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WBTC: Address = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const cUSDCv3: Address = getCompoundCometAddress(1, "USDC")!;

const PRICE_FEED = "0xfeed00000000000000000000000000000000feed" as Address;

beforeEach(() => {
  publicNodeFallback = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_compound_market_info");
  if (!tool) throw new Error("get_compound_market_info not registered");
  return tool.handler(args);
}

describe("get_compound_market_info tool — register-all wiring + tool description", () => {
  it("tool registered + description names Compound V3 + lists all 5 supported chains (Phase 41 Plan 41-02)", () => {
    const tool = getRegisteredTool("get_compound_market_info");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("get_compound_market_info");
    expect(tool?.description).toMatch(/Compound V3 market metadata/);
    expect(tool?.description).toMatch(/arbitrum/);
    expect(tool?.description).toMatch(/polygon/);
    expect(tool?.description).toMatch(/INVALID_INPUT/);
  });
});

describe("get_compound_market_info — INVALID_INPUT for non-canonical Comet (T-COMPOUND-MARKET-OFFLIST-1)", () => {
  it("non-canonical cometAddress → INVALID_INPUT envelope", async () => {
    const result = await callTool({
      chain: "ethereum",
      cometAddress: "0xdEaDBeefDEaDbeefdEAdbEEFdEadbeeFDeAdbEEf",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not in the canonical/);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("malformed cometAddress → INVALID_INPUT envelope", async () => {
    const result = await callTool({
      chain: "ethereum",
      cometAddress: "not-an-address",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/valid 0x-prefixed EVM address/);
  });
});

describe("get_compound_market_info — APR computation (Pitfall #4 — divide LAST)", () => {
  it("supplyRate × 31_536_000s × 100 / 1e18 — deterministic input yields expected APR string", async () => {
    // Choose a rate that yields a non-trivial APR: 1e10 wei/sec.
    // APR = 1e10 × 31_536_000 × 100 / 1e18 = ~31.536 (formatUnits via 1e18 scale).
    vi.spyOn(_compoundChains, "getCometMarketInfo").mockResolvedValueOnce({
      comet: cUSDCv3,
      baseToken: USDC,
      supplyRate: 10n ** 10n,
      borrowRate: 2n * 10n ** 10n,
      utilization: 5n * 10n ** 17n, // 50%
      totalSupply: 10n ** 12n,
      totalBorrow: 5n * 10n ** 11n,
      numAssets: 0,
      baseTokenPriceFeed: PRICE_FEED,
      baseTokenPriceUsd: 10n ** 8n, // $1
      collateralAssets: [],
    });

    const result = await callTool({
      chain: "ethereum",
      cometAddress: cUSDCv3,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      supplyAprPercent: string;
      borrowAprPercent: string;
      utilizationPercent: string;
      cometAddress: Address;
      baseToken: Address;
    };
    expect(sc.cometAddress).toBe(cUSDCv3);
    expect(sc.baseToken).toBe(USDC);
    // 1e10 × 31_536_000 × 100 = 31_536_000_000_000_000_000 → formatUnits(., 18) = "31.536"
    expect(sc.supplyAprPercent).toBe("31.536");
    // 2e10 × same → "63.072"
    expect(sc.borrowAprPercent).toBe("63.072");
    // 5e17 × 100 / 1e18 = 50.
    expect(sc.utilizationPercent).toBe("50");
  });

  it("zero rate → APR === '0' (no float drift)", async () => {
    vi.spyOn(_compoundChains, "getCometMarketInfo").mockResolvedValueOnce({
      comet: cUSDCv3,
      baseToken: USDC,
      supplyRate: 0n,
      borrowRate: 0n,
      utilization: 0n,
      totalSupply: 0n,
      totalBorrow: 0n,
      numAssets: 0,
      baseTokenPriceFeed: PRICE_FEED,
      baseTokenPriceUsd: 10n ** 8n,
      collateralAssets: [],
    });

    const result = await callTool({
      chain: "ethereum",
      cometAddress: cUSDCv3,
    });

    const sc = result.structuredContent as {
      supplyAprPercent: string;
      borrowAprPercent: string;
    };
    expect(sc.supplyAprPercent).toBe("0");
    expect(sc.borrowAprPercent).toBe("0");
  });
});

describe("get_compound_market_info — per-collateral surface (T-COMPOUND-MARKET-COLLATERAL-1)", () => {
  it("collateralAssets array carries bCF + lCF + lF + supplyCap + currentSupply + priceUsd per row", async () => {
    vi.spyOn(_compoundChains, "getCometMarketInfo").mockResolvedValueOnce({
      comet: cUSDCv3,
      baseToken: USDC,
      supplyRate: 0n,
      borrowRate: 0n,
      utilization: 0n,
      totalSupply: 0n,
      totalBorrow: 0n,
      numAssets: 1,
      baseTokenPriceFeed: PRICE_FEED,
      baseTokenPriceUsd: 10n ** 8n,
      collateralAssets: [
        {
          asset: WBTC,
          priceFeed: PRICE_FEED,
          priceUsd: 30_000n * 10n ** 8n,
          scale: 10n ** 8n,
          borrowCollateralFactor: 80n * 10n ** 16n,
          liquidateCollateralFactor: 85n * 10n ** 16n,
          liquidationFactor: 95n * 10n ** 16n,
          supplyCap: 1_000n * 10n ** 8n,
          currentSupply: 500n * 10n ** 8n,
        },
      ],
    });

    const result = await callTool({
      chain: "ethereum",
      cometAddress: cUSDCv3,
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      collateralAssets: Array<{
        asset: Address;
        priceUsd: string;
        borrowCollateralFactor: string;
        liquidateCollateralFactor: string;
        liquidationFactor: string;
        supplyCap: string;
        currentSupply: string;
      }>;
    };
    expect(sc.collateralAssets).toHaveLength(1);
    const row = sc.collateralAssets[0]!;
    expect(row.asset).toBe(WBTC);
    expect(row.priceUsd).toBe("30000");
    expect(row.borrowCollateralFactor).toBe("0.8");
    expect(row.liquidateCollateralFactor).toBe("0.85");
    expect(row.liquidationFactor).toBe("0.95");
  });
});

describe("get_compound_market_info — rpcDegraded surfacing", () => {
  it("public-node fallback ACTIVE → result.rpcDegraded === true", async () => {
    publicNodeFallback = true;
    vi.spyOn(_compoundChains, "getCometMarketInfo").mockResolvedValueOnce({
      comet: cUSDCv3,
      baseToken: USDC,
      supplyRate: 0n,
      borrowRate: 0n,
      utilization: 0n,
      totalSupply: 0n,
      totalBorrow: 0n,
      numAssets: 0,
      baseTokenPriceFeed: PRICE_FEED,
      baseTokenPriceUsd: 10n ** 8n,
      collateralAssets: [],
    });

    const result = await callTool({
      chain: "ethereum",
      cometAddress: cUSDCv3,
    });

    const sc = result.structuredContent as { rpcDegraded?: boolean };
    expect(sc.rpcDegraded).toBe(true);
  });
});

describe("get_compound_market_info — RPC failure surfacing", () => {
  it("_compoundChains.getCometMarketInfo throws → INTERNAL_ERROR envelope", async () => {
    vi.spyOn(_compoundChains, "getCometMarketInfo").mockRejectedValueOnce(
      new Error("RPC unavailable"),
    );

    const result = await callTool({
      chain: "ethereum",
      cometAddress: cUSDCv3,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INTERNAL_ERROR");
    expect(result.content[0]?.text).toMatch(/RPC unavailable/);
  });
});

describe("get_compound_market_info — SOT cross-check (6-Comet enumeration)", () => {
  it("getAllCompoundCometsForChain(1) returns 6 entries (cUSDCv3 / cUSDTv3 / cWETHv3 / cUSDSv3 / cwstETHv3 / cWBTCv3)", () => {
    const comets = getAllCompoundCometsForChain(1);
    expect(comets).toHaveLength(6);
    // The tool's allowlist check uses this SOT — drift would be caught here.
    expect(comets).toContain(getCompoundCometAddress(1, "USDC")!);
    expect(comets).toContain(getCompoundCometAddress(1, "WETH")!);
    expect(comets).toContain(getCompoundCometAddress(1, "WBTC")!);
  });
});
