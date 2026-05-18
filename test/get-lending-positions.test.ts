import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Address, PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the ethereum client BEFORE importing anything that resolves it (mirror
// of test/get-portfolio-summary.test.ts setup).
let publicNodeFallback = false;

// Phase 8 — Plan 08-02: tool migrated to src/chains/registry.js per-chain
// factory. `getChainClient(chainId)` + `isPublicNodeFallback(chainId)` are
// the new shapes — the test mock collapses the per-chain dispatch back to
// a single stub since these tests only exercise chainId=1.
vi.mock("../src/chains/registry.js", () => {
  return {
    getChainClient: () => ({ readContract: vi.fn() }) as unknown as PublicClient,
    isPublicNodeFallback: () => publicNodeFallback,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
  };
});

import { _aaveChains } from "../src/chains/aave-v3.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const DAI: Address = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const FRAX: Address = "0x853d955aCEf822Db058eb8505911ED77F175b99e";

const A_USDC: Address = "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c";
const V_USDC: Address = "0x72E95b8931767C79bA4EeE721354d6E99a61D004";
const A_WETH: Address = "0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8";
const V_WETH: Address = "0xeA51d7853EEFb32b6ee06b1C12E6dcCA88Be0fFE";
const A_DAI: Address = "0x018008bfb33d285247A21d44E50697654f754e63";
const V_DAI: Address = "0xcF8d0c70c850859266f5C338b38F9D663181C314";
const A_FRAX: Address = "0xd4e245848d6E1220DBE62e155d89fa327E43CB06";
const V_FRAX: Address = "0xfEcEd83B62cF50Ef96A02b1ec1D3ce19F6F2A47A";

interface ReserveFixture {
  underlyingAsset: Address;
  name: string;
  symbol: string;
  decimals: bigint;
  baseLTVasCollateral: bigint;
  reserveLiquidationThreshold: bigint;
  reserveLiquidationBonus: bigint;
  reserveFactor: bigint;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
  liquidityIndex: bigint;
  variableBorrowIndex: bigint;
  liquidityRate: bigint;
  variableBorrowRate: bigint;
  lastUpdateTimestamp: number;
  aTokenAddress: Address;
  variableDebtTokenAddress: Address;
  priceInMarketReferenceCurrency: bigint;
}

interface UserReserveFixture {
  underlyingAsset: Address;
  scaledATokenBalance: bigint;
  usageAsCollateralEnabledOnUser: boolean;
  scaledVariableDebt: bigint;
}

function mkReserve(overrides: Partial<ReserveFixture>): ReserveFixture {
  return {
    underlyingAsset: USDC,
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6n,
    baseLTVasCollateral: 7700n,
    reserveLiquidationThreshold: 8500n,
    reserveLiquidationBonus: 10500n,
    reserveFactor: 1000n,
    usageAsCollateralEnabled: true,
    borrowingEnabled: true,
    isActive: true,
    isFrozen: false,
    liquidityIndex: 10n ** 27n,
    variableBorrowIndex: 10n ** 27n,
    liquidityRate: 10n ** 25n,
    variableBorrowRate: 5n * 10n ** 25n,
    lastUpdateTimestamp: 1700000000,
    aTokenAddress: A_USDC,
    variableDebtTokenAddress: V_USDC,
    priceInMarketReferenceCurrency: 10n ** 8n,
    ...overrides,
  };
}

function mkUserReserve(overrides: Partial<UserReserveFixture>): UserReserveFixture {
  return {
    underlyingAsset: USDC,
    scaledATokenBalance: 0n,
    usageAsCollateralEnabledOnUser: false,
    scaledVariableDebt: 0n,
    ...overrides,
  };
}

const BASE_CURRENCY = {
  marketReferenceCurrencyUnit: 10n ** 8n,
  marketReferenceCurrencyPriceInUsd: 10n ** 8n,
  networkBaseTokenPriceInUsd: 4000n * 10n ** 8n,
  networkBaseTokenPriceDecimals: 8,
};

beforeEach(() => {
  publicNodeFallback = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_lending_positions");
  if (!tool) throw new Error("get_lending_positions not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
}

describe("get_lending_positions tool (READ-20)", () => {
  it("rejects missing wallet → INVALID_INPUT", async () => {
    const result = await callTool({});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/wallet/);
  });

  it("rejects malformed wallet (not 40-hex) → INVALID_INPUT", async () => {
    const result = await callTool({ wallet: "not-an-address" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/valid 0x-prefixed/);
  });

  it("happy path: 3-position user (2 collateral + 1 debt) → HF=5.0 + liquidationRisk: safe", async () => {
    // Anchor reused from test/signing-aave-health.test.ts: HF === 5e18.
    // Collateral: 1000 USDC + 0.5 WETH @ $4000 = $3000 base.
    // Debt: 500 DAI = $500 base.
    // weightedLT = 850e8 (USDC@85%) + 1650e8 (WETH@82.5%) = 2500e8.
    // HF = 2500e8 * 1e18 / 500e8 = 5e18.
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: [
        mkReserve({ underlyingAsset: USDC, symbol: "USDC", decimals: 6n, reserveLiquidationThreshold: 8500n }),
        mkReserve({
          underlyingAsset: WETH,
          symbol: "WETH",
          decimals: 18n,
          reserveLiquidationThreshold: 8250n,
          priceInMarketReferenceCurrency: 4000n * 10n ** 8n,
          aTokenAddress: A_WETH,
          variableDebtTokenAddress: V_WETH,
        }),
        mkReserve({
          underlyingAsset: DAI,
          symbol: "DAI",
          decimals: 18n,
          reserveLiquidationThreshold: 7700n,
          aTokenAddress: A_DAI,
          variableDebtTokenAddress: V_DAI,
        }),
      ],
      baseCurrency: BASE_CURRENCY,
    });
    vi.spyOn(_aaveChains, "getUserReservesData").mockResolvedValue({
      userReserves: [
        mkUserReserve({
          underlyingAsset: USDC,
          scaledATokenBalance: 1000n * 10n ** 6n,
          usageAsCollateralEnabledOnUser: true,
        }),
        mkUserReserve({
          underlyingAsset: WETH,
          scaledATokenBalance: 500_000_000_000_000_000n,
          usageAsCollateralEnabledOnUser: true,
        }),
        mkUserReserve({
          underlyingAsset: DAI,
          scaledVariableDebt: 500n * 10n ** 18n,
        }),
      ],
      userEModeCategoryId: 0,
    });

    const result = await callTool({ wallet: WALLET });
    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      chain: string;
      wallet: Address;
      positions: Array<{
        symbol: string;
        suppliedHuman: string;
        borrowedHuman: string;
        suppliedUsd: string;
        borrowedUsd: string;
        liquidationThresholdBps: number;
        isFrozen: boolean;
        isActive: boolean;
      }>;
      totalCollateralUsd: string;
      totalDebtUsd: string;
      healthFactor: string | null;
      noDebt: boolean;
      liquidationRisk: string;
      userEModeCategoryId: number;
      rpcDegraded?: boolean;
    };

    expect(out.chain).toBe("ethereum");
    expect(out.wallet).toBe(WALLET);
    expect(out.positions).toHaveLength(3);
    const bySym = Object.fromEntries(out.positions.map((p) => [p.symbol, p]));
    expect(bySym.USDC?.suppliedHuman).toBe("1000");
    expect(bySym.USDC?.suppliedUsd).toBe("1000.00");
    expect(bySym.USDC?.liquidationThresholdBps).toBe(8500);
    expect(bySym.WETH?.suppliedHuman).toBe("0.5");
    expect(bySym.WETH?.suppliedUsd).toBe("2000.00");
    expect(bySym.WETH?.liquidationThresholdBps).toBe(8250);
    expect(bySym.DAI?.borrowedHuman).toBe("500");
    expect(bySym.DAI?.borrowedUsd).toBe("500.00");

    expect(out.totalCollateralUsd).toBe("3000.00");
    expect(out.totalDebtUsd).toBe("500.00");
    // HF=5e18 → "5" via formatUnits(5e18, 18)
    expect(out.healthFactor).toBe("5");
    expect(out.noDebt).toBe(false);
    expect(out.liquidationRisk).toBe("safe");
    expect(out.userEModeCategoryId).toBe(0);
    expect(out.rpcDegraded).toBeUndefined();
  });

  it("noDebt: collateral-only user → healthFactor=null + noDebt=true + liquidationRisk='noDebt'", async () => {
    // T-AAVE-HF-INFINITY-1 anchor: response surfaces healthFactor: null
    // (NOT MAX_UINT256), agent reads noDebt FIRST.
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: [mkReserve({})],
      baseCurrency: BASE_CURRENCY,
    });
    vi.spyOn(_aaveChains, "getUserReservesData").mockResolvedValue({
      userReserves: [
        mkUserReserve({
          underlyingAsset: USDC,
          scaledATokenBalance: 1000n * 10n ** 6n,
          usageAsCollateralEnabledOnUser: true,
        }),
      ],
      userEModeCategoryId: 0,
    });

    const result = await callTool({ wallet: WALLET });
    const out = result.structuredContent as {
      healthFactor: string | null;
      noDebt: boolean;
      liquidationRisk: string;
      totalCollateralUsd: string;
      totalDebtUsd: string;
    };
    expect(out.healthFactor).toBeNull();
    expect(out.noDebt).toBe(true);
    expect(out.liquidationRisk).toBe("noDebt");
    expect(out.totalCollateralUsd).toBe("1000.00");
    expect(out.totalDebtUsd).toBe("0.00");
  });

  it("frozen reserve surfaces with isFrozen: true (NOT filtered out — T-AAVE-FROZEN-RESERVE-SILENT-OMIT-1)", async () => {
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: [
        mkReserve({
          underlyingAsset: FRAX,
          symbol: "FRAX",
          decimals: 18n,
          isFrozen: true,
          isActive: true,
          aTokenAddress: A_FRAX,
          variableDebtTokenAddress: V_FRAX,
        }),
      ],
      baseCurrency: BASE_CURRENCY,
    });
    vi.spyOn(_aaveChains, "getUserReservesData").mockResolvedValue({
      userReserves: [
        mkUserReserve({
          underlyingAsset: FRAX,
          scaledATokenBalance: 100n * 10n ** 18n,
          usageAsCollateralEnabledOnUser: true,
        }),
      ],
      userEModeCategoryId: 0,
    });

    const result = await callTool({ wallet: WALLET });
    const out = result.structuredContent as {
      positions: Array<{ symbol: string; isFrozen: boolean; isActive: boolean }>;
    };
    // The row MUST be present — no silent filtering.
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0]?.symbol).toBe("FRAX");
    expect(out.positions[0]?.isFrozen).toBe(true);
    expect(out.positions[0]?.isActive).toBe(true);
  });

  it("eMode: userEModeCategoryId !== 0 surfaces verbatim (v1.1 A3 documented caveat)", async () => {
    // T-AAVE-EMODE-WRONG-HF-1 anchor: v1.1 surfaces the category verbatim; the
    // per-category LT override is v2.3 scope. The math correctness is NOT
    // asserted here — only that the agent SEES the category.
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: [mkReserve({})],
      baseCurrency: BASE_CURRENCY,
    });
    vi.spyOn(_aaveChains, "getUserReservesData").mockResolvedValue({
      userReserves: [
        mkUserReserve({
          underlyingAsset: USDC,
          scaledATokenBalance: 100n * 10n ** 6n,
          usageAsCollateralEnabledOnUser: true,
        }),
      ],
      userEModeCategoryId: 1, // ETH-correlated eMode
    });

    const result = await callTool({ wallet: WALLET });
    const out = result.structuredContent as { userEModeCategoryId: number };
    expect(out.userEModeCategoryId).toBe(1);
    expect(result.content[0]?.text).toMatch(/eMode category 1/);
  });

  it("rpcDegraded: isPublicNodeFallback()===true → rpcDegraded: true on response", async () => {
    // T-AAVE-RPC-DEGRADED-NO-SURFACE-1 anchor.
    publicNodeFallback = true;
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: [],
      baseCurrency: BASE_CURRENCY,
    });
    vi.spyOn(_aaveChains, "getUserReservesData").mockResolvedValue({
      userReserves: [],
      userEModeCategoryId: 0,
    });

    const result = await callTool({ wallet: WALLET });
    const out = result.structuredContent as { rpcDegraded?: boolean };
    expect(out.rpcDegraded).toBe(true);
  });

  it("RPC error: _aaveChains.getReservesData throws → isError + INTERNAL_ERROR envelope with message", async () => {
    vi.spyOn(_aaveChains, "getReservesData").mockRejectedValue(new Error("RPC down"));
    vi.spyOn(_aaveChains, "getUserReservesData").mockResolvedValue({
      userReserves: [],
      userEModeCategoryId: 0,
    });

    const result = await callTool({ wallet: WALLET });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/RPC down/);
    expect(result.content[0]?.text).toMatch(/failed to read Aave V3 positions/);
  });

  it("zero-balance reserves dropped (one userReserve entry per system reserve; majority are 0/0)", async () => {
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: [
        mkReserve({ underlyingAsset: USDC, symbol: "USDC" }),
        mkReserve({ underlyingAsset: WETH, symbol: "WETH", decimals: 18n, aTokenAddress: A_WETH, variableDebtTokenAddress: V_WETH }),
        mkReserve({ underlyingAsset: DAI, symbol: "DAI", decimals: 18n, aTokenAddress: A_DAI, variableDebtTokenAddress: V_DAI }),
      ],
      baseCurrency: BASE_CURRENCY,
    });
    vi.spyOn(_aaveChains, "getUserReservesData").mockResolvedValue({
      userReserves: [
        mkUserReserve({
          underlyingAsset: USDC,
          scaledATokenBalance: 100n * 10n ** 6n,
          usageAsCollateralEnabledOnUser: true,
        }),
        mkUserReserve({ underlyingAsset: WETH }), // 0 / 0 — should be dropped
        mkUserReserve({ underlyingAsset: DAI }), // 0 / 0 — should be dropped
      ],
      userEModeCategoryId: 0,
    });

    const result = await callTool({ wallet: WALLET });
    const out = result.structuredContent as { positions: Array<{ symbol: string }> };
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0]?.symbol).toBe("USDC");
  });

  it("register-all wiring: get_lending_positions registered after import", () => {
    const tool = getRegisteredTool("get_lending_positions");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("get_lending_positions");
    expect(tool?.description).toMatch(/Aave V3 lending positions/);
  });

  it("SOT bypass guard: UiPoolDataProviderV3 address literal lives ONLY in src/config/contracts.ts (NOT inlined in tool / chains / signing)", () => {
    // Shell out to assert the literal does not appear in consumer files.
    // The SOT in src/config/contracts.ts is the ONLY occurrence allowed.
    const root = resolve(__dirname, "..");
    const stdout = execSync(
      `grep -ril 0x56b7A1012765C285afAC8b8F25C69Bf10ccfE978 src/tools/ src/chains/ src/signing/ || true`,
      { cwd: root, encoding: "utf8" },
    );
    expect(stdout.trim()).toBe("");

    // Defence in depth: read the canonical SOT file and assert the literal IS there.
    const contractsSrc = readFileSync(resolve(root, "src/config/contracts.ts"), "utf8");
    expect(contractsSrc).toContain("0x56b7A1012765C285afAC8b8F25C69Bf10ccfE978");
  });
});
