// simulate_position_change tests — PREP-25 (Plan 07-03).
//
// READ-ONLY position-change projection. Anchors:
//   - Schema gates: missing asset, invalid action enum → INVALID_INPUT
//   - 4-action enum: supply / withdraw / borrow / repay projections compile
//     and produce well-shaped responses
//   - warning surfacing: would-liquidate (transitions non-danger → danger),
//     near-liquidation (transitions safe → warning)
//   - noDebt → noDebt invariant (supply does not introduce debt)
//   - READ-ONLY invariant (T-SIMULATE-MUTATES-STATE-1): spy on createHandle
//     returns ZERO calls across the full simulation flow + module-load grep
//     guard via direct file read
//   - rpcDegraded surfacing
//   - register-all wiring smoke

import type { Address, PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let publicNodeFallback = false;
// Phase 8 — Plan 08-02: tool migrated to per-chain registry.
// Phase 28 Plan 28-04: extended mock returns USDC decimals (6) for the base-
// asset ERC-20 decimals() read used by the Compound dispatcher arm; other
// reads return undefined and the production code's try/catch handles them.
vi.mock("../src/chains/registry.js", () => {
  return {
    getChainClient: () =>
      ({
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === "decimals") return 6;
          if (functionName === "symbol") return "USDC";
          return undefined;
        }),
      }) as unknown as PublicClient,
    isPublicNodeFallback: () => publicNodeFallback,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
  };
});

import { _aaveChains } from "../src/chains/aave-v3.js";
import { _compoundChains } from "../src/chains/compound-v3.js";
import { getCompoundCometAddress } from "../src/config/contracts.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting, setActivePersona } from "../src/demo/state.js";
import * as handleStoreModule from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const DAI: Address = "0x6B175474E89094C44Da98b954EedeAC495271d0F";

const A_USDC: Address = "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c";
const V_USDC: Address = "0x72E95b8931767C79bA4EeE721354d6E99a61D004";
const A_WETH: Address = "0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8";
const V_WETH: Address = "0xeA51d7853EEFb32b6ee06b1C12E6dcCA88Be0fFE";
const A_DAI: Address = "0x018008bfb33d285247A21d44E50697654f754e63";
const V_DAI: Address = "0xcF8d0c70c850859266f5C338b38F9D663181C314";

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

const ALL_RESERVES = [
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
];

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("simulate_position_change");
  if (!tool) throw new Error("simulate_position_change not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
}

beforeEach(() => {
  publicNodeFallback = false;
  process.env.VAULTPILOT_DEMO = "true";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  setActivePersona("whale");
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.VAULTPILOT_DEMO;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

describe("simulate_position_change — schema gates", () => {
  it("missing 'asset' → INVALID_INPUT", async () => {
    const result = await callTool({ action: "supply", amount: "100" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("invalid 'action' (e.g. 'swap') → INVALID_INPUT", async () => {
    const result = await callTool({ asset: USDC, action: "swap", amount: "100" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("malformed 'asset' → INVALID_INPUT (before reserves read)", async () => {
    const readSpy = vi.spyOn(_aaveChains, "getReservesData");
    const result = await callTool({ asset: "0xnotanaddress", action: "supply", amount: "100" });
    expect(result.isError).toBe(true);
    expect(readSpy).not.toHaveBeenCalled();
  });
});

describe("simulate_position_change — supply projection (HF improves)", () => {
  it("supply 1000 USDC on a 3-asset position → HF strictly increases; risk stays safe", async () => {
    // Baseline: 1000 USDC supplied + 0.5 WETH supplied + 500 DAI borrowed.
    // HF = 5.0 (research § Topic 3 anchor). Supplying more USDC widens
    // collateral; HF strictly increases.
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: ALL_RESERVES,
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
        mkUserReserve({ underlyingAsset: DAI, scaledVariableDebt: 500n * 10n ** 18n }),
      ],
      userEModeCategoryId: 0,
    });

    const result = await callTool({ asset: USDC, action: "supply", amount: "1000" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      healthFactorBefore: string;
      healthFactorAfter: string;
      liquidationRiskBefore: string;
      liquidationRiskAfter: string;
      warning?: string;
    };
    expect(sc.liquidationRiskBefore).toBe("safe");
    expect(sc.liquidationRiskAfter).toBe("safe");
    // HF strictly increases.
    expect(Number(sc.healthFactorAfter)).toBeGreaterThan(Number(sc.healthFactorBefore));
    expect(sc.warning).toBeUndefined();
  });
});

describe("simulate_position_change — withdraw projection (HF degrades → would-liquidate warning)", () => {
  it("withdraw most of the USDC collateral → projected HF in danger band; warning: would-liquidate", async () => {
    // Tight starting position: small WETH collateral + significant DAI debt
    // gives HF ~just above warning. Withdrawing all USDC tips into danger.
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: ALL_RESERVES,
      baseCurrency: BASE_CURRENCY,
    });
    vi.spyOn(_aaveChains, "getUserReservesData").mockResolvedValue({
      userReserves: [
        // 5000 USDC collateral
        mkUserReserve({
          underlyingAsset: USDC,
          scaledATokenBalance: 5000n * 10n ** 6n,
          usageAsCollateralEnabledOnUser: true,
        }),
        // 4500 DAI debt — HF before ~ 5000 * 0.85 / 4500 = 0.944... wait
        // we want before to be SAFE so the transition fires. Use 2500 DAI:
        // before HF = 5000 * 0.85 / 2500 = 1.7 (safe).
        mkUserReserve({ underlyingAsset: DAI, scaledVariableDebt: 2500n * 10n ** 18n }),
      ],
      userEModeCategoryId: 0,
    });

    const result = await callTool({ asset: USDC, action: "withdraw", amount: "4500" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      healthFactorBefore: string;
      healthFactorAfter: string;
      liquidationRiskBefore: string;
      liquidationRiskAfter: string;
      warning?: string;
    };
    // before = 5000 * 0.85 / 2500 = 1.7 → safe
    // after = 500 * 0.85 / 2500 = 0.17 → danger
    expect(sc.liquidationRiskBefore).toBe("safe");
    expect(sc.liquidationRiskAfter).toBe("danger");
    expect(sc.warning).toBe("would-liquidate");
    expect(Number(sc.healthFactorAfter)).toBeLessThan(Number(sc.healthFactorBefore));
  });
});

describe("simulate_position_change — borrow projection (forward-compat; no prepare tool yet)", () => {
  it("borrow USDC against an existing collateral position → projection compiles + structuredContent shape", async () => {
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: ALL_RESERVES,
      baseCurrency: BASE_CURRENCY,
    });
    vi.spyOn(_aaveChains, "getUserReservesData").mockResolvedValue({
      userReserves: [
        // 1000 USDC + 0.5 WETH supplied = $3000 collateral
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
        // 500 DAI debt
        mkUserReserve({ underlyingAsset: DAI, scaledVariableDebt: 500n * 10n ** 18n }),
      ],
      userEModeCategoryId: 0,
    });

    const result = await callTool({ asset: USDC, action: "borrow", amount: "500" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      action: string;
      healthFactorAfter: string;
      liquidationRiskAfter: string;
    };
    expect(sc.action).toBe("borrow");
    // Borrowing more debt → projected HF strictly lower than before.
    expect(typeof sc.healthFactorAfter).toBe("string");
    expect(["safe", "warning", "danger"]).toContain(sc.liquidationRiskAfter);
  });
});

describe("simulate_position_change — repay projection (HF improves)", () => {
  it("repay half the DAI debt → HF strictly increases; risk stays safe or improves", async () => {
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: ALL_RESERVES,
      baseCurrency: BASE_CURRENCY,
    });
    vi.spyOn(_aaveChains, "getUserReservesData").mockResolvedValue({
      userReserves: [
        mkUserReserve({
          underlyingAsset: USDC,
          scaledATokenBalance: 1000n * 10n ** 6n,
          usageAsCollateralEnabledOnUser: true,
        }),
        mkUserReserve({ underlyingAsset: DAI, scaledVariableDebt: 1000n * 10n ** 18n }),
      ],
      userEModeCategoryId: 0,
    });

    const result = await callTool({ asset: DAI, action: "repay", amount: "500" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      healthFactorBefore: string;
      healthFactorAfter: string;
    };
    expect(Number(sc.healthFactorAfter)).toBeGreaterThan(Number(sc.healthFactorBefore));
  });
});

describe("simulate_position_change — noDebt → noDebt invariant", () => {
  it("supply on a no-debt position → before.noDebt true, after.noDebt true, no warning", async () => {
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: ALL_RESERVES,
      baseCurrency: BASE_CURRENCY,
    });
    vi.spyOn(_aaveChains, "getUserReservesData").mockResolvedValue({
      userReserves: [
        mkUserReserve({
          underlyingAsset: USDC,
          scaledATokenBalance: 1000n * 10n ** 6n,
          usageAsCollateralEnabledOnUser: true,
        }),
        // No debt anywhere.
      ],
      userEModeCategoryId: 0,
    });

    const result = await callTool({ asset: USDC, action: "supply", amount: "100" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      healthFactorBefore: string | null;
      healthFactorAfter: string | null;
      liquidationRiskBefore: string;
      liquidationRiskAfter: string;
      warning?: string;
    };
    expect(sc.healthFactorBefore).toBeNull();
    expect(sc.healthFactorAfter).toBeNull();
    expect(sc.liquidationRiskBefore).toBe("noDebt");
    expect(sc.liquidationRiskAfter).toBe("noDebt");
    expect(sc.warning).toBeUndefined();
  });
});

describe("simulate_position_change — READ-ONLY invariant (T-SIMULATE-MUTATES-STATE-1)", () => {
  it("createHandle is NEVER called across the full simulate flow (handle-store spy)", async () => {
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: ALL_RESERVES,
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

    const createHandleSpy = vi.spyOn(handleStoreModule, "createHandle");

    await callTool({ asset: USDC, action: "supply", amount: "100" });

    // Load-bearing assertion: simulate NEVER stages a transaction.
    expect(createHandleSpy).toHaveBeenCalledTimes(0);
  });

  it("module source does NOT import createHandle or any prepare_* tool (import-graph grep)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = url.fileURLToPath(new URL(".", import.meta.url));
    const target = path.resolve(here, "..", "src", "tools", "simulate_position_change.ts");
    const source = await fs.readFile(target, "utf8");
    expect(source).not.toMatch(/import .*createHandle/);
    expect(source).not.toMatch(/from "\.\/prepare_aave/);
    expect(source).not.toMatch(/from "\.\/prepare_token/);
    expect(source).not.toMatch(/from "\.\/prepare_native/);
    expect(source).not.toMatch(/from "\.\/prepare_revoke/);
    expect(source).not.toMatch(/from "\.\/prepare_weth/);
  });
});

describe("simulate_position_change — rpcDegraded surfacing", () => {
  it("isPublicNodeFallback() → true → response.rpcDegraded === true", async () => {
    publicNodeFallback = true;
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: ALL_RESERVES,
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

    const result = await callTool({ asset: USDC, action: "supply", amount: "100" });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { rpcDegraded?: boolean };
    expect(sc.rpcDegraded).toBe(true);
  });
});

describe("simulate_position_change — register-all wiring (smoke)", () => {
  it("simulate_position_change is registered after register-all import", () => {
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("simulate_position_change");
  });

  it("inputSchema requires chain + asset + action + amount; action enum is the locked 4-arm set (Plan 08-02 adds chain)", () => {
    const tool = getRegisteredTool("simulate_position_change");
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.inputSchema.required).toEqual(["chain", "asset", "action", "amount"]);
    const props = tool.inputSchema.properties as {
      action: { enum: readonly string[] };
      chain: { type: string; enum: readonly string[] };
    };
    expect([...props.action.enum].sort()).toEqual(["borrow", "repay", "supply", "withdraw"]);
    expect(props.chain).toMatchObject({
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
    });
  });

  it("register-all.ts contains the side-effect import line for ./simulate_position_change.js", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = url.fileURLToPath(new URL(".", import.meta.url));
    const target = path.resolve(here, "..", "src", "tools", "register-all.ts");
    const source = await fs.readFile(target, "utf8");
    expect(source).toContain('import "./simulate_position_change.js";');
  });
});

describe("simulate_position_change — asset must be a listed reserve", () => {
  it("asset address not in reserve set → INVALID_INPUT", async () => {
    vi.spyOn(_aaveChains, "getReservesData").mockResolvedValue({
      reserves: ALL_RESERVES,
      baseCurrency: BASE_CURRENCY,
    });
    vi.spyOn(_aaveChains, "getUserReservesData").mockResolvedValue({
      userReserves: [],
      userEModeCategoryId: 0,
    });

    // A random ERC-20 not in ALL_RESERVES.
    const FAKE: Address = "0x1111111111111111111111111111111111111111";
    const result = await callTool({ asset: FAKE, action: "supply", amount: "100" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 28 Plan 28-04 — Compound V3 dispatcher arm. Aave-only tests above
// remain BYTE-IDENTICAL — default `protocol: "aave-v3"` for back-compat.
// ---------------------------------------------------------------------------

const cUSDCv3 = getCompoundCometAddress(1, "USDC")!;
const WBTC: Address = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const PRICE_FEED = "0xfeed00000000000000000000000000000000feed" as Address;

function mockCompoundState(overrides?: Parameters<typeof _compoundChains.getCometState>[0] extends never ? never : Partial<Awaited<ReturnType<typeof _compoundChains.getCometState>>>) {
  // Default state: WBTC collateral wallet on cUSDCv3.
  const base = {
    comet: cUSDCv3,
    baseToken: USDC,
    baseSupplied: 0n,
    baseBorrowed: 0n,
    isBorrowCollateralized: true,
    isLiquidatable: false,
    supplyRate: 0n,
    borrowRate: 0n,
    utilization: 0n,
    totalSupply: 0n,
    totalBorrow: 0n,
    numAssets: 1,
    baseTokenPriceFeed: PRICE_FEED,
    baseTokenPriceUsd: 10n ** 8n,
    collateral: [],
  };
  return { ...base, ...overrides };
}

describe("simulate_position_change — Compound V3 dispatcher arm (Plan 28-04)", () => {
  it("protocol: \"compound-v3\" without cometAddress → INVALID_INPUT", async () => {
    const result = await callTool({
      protocol: "compound-v3",
      asset: USDC,
      action: "supply",
      amount: "100",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(result.content[0]?.text).toMatch(/cometAddress/);
  });

  it("protocol: \"compound-v3\" with non-canonical cometAddress → INVALID_INPUT", async () => {
    const result = await callTool({
      protocol: "compound-v3",
      cometAddress: "0xdEaDBeefDEaDbeefdEAdbEEFdEadbeeFDeAdbEEf",
      asset: USDC,
      action: "supply",
      amount: "100",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/not in the canonical/);
  });

  it("protocol: \"compound-v3\" on non-mainnet → INVALID_INPUT (Phase 28 mainnet-only)", async () => {
    const result = await callTool({
      chain: "arbitrum",
      protocol: "compound-v3",
      cometAddress: cUSDCv3,
      asset: USDC,
      action: "supply",
      amount: "100",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Ethereum mainnet only/);
  });

  it("supply action: with WBTC collateral on cUSDCv3 → adds collateral; ratio improves", async () => {
    // Wallet: 1 WBTC supplied, $20k USDC debt. ratio = 24000/20000 = 1.2.
    // After supply: +1 WBTC → ratio = 48000/20000 = 2.4.
    vi.spyOn(_compoundChains, "getCometState").mockResolvedValueOnce(
      mockCompoundState({
        baseBorrowed: 20_000n * 10n ** 6n,
        numAssets: 1,
      }),
    );
    vi.spyOn(_compoundChains, "getCometCollateralPositions").mockResolvedValueOnce([
      {
        asset: WBTC,
        balance: 1n * 10n ** 8n,
        priceUsd: 30_000n * 10n ** 8n,
        priceFeed: PRICE_FEED,
        scale: 10n ** 8n,
        decimals: 8,
        borrowCollateralFactor: 80n * 10n ** 16n,
        liquidateCollateralFactor: 85n * 10n ** 16n,
        liquidationFactor: 95n * 10n ** 16n,
        supplyCap: 1_000n * 10n ** 8n,
      },
    ]);

    const result = await callTool({
      protocol: "compound-v3",
      cometAddress: cUSDCv3,
      asset: WBTC,
      action: "supply",
      amount: "1.0",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      protocol: string;
      currentRatio: string;
      projectedRatio: string;
      isBorrowCollateralizedCurrent: boolean;
      isBorrowCollateralizedProjected: boolean;
      liquidationRiskCurrent: string;
      liquidationRiskProjected: string;
    };
    expect(sc.protocol).toBe("compound-v3");
    expect(sc.currentRatio).toBe("1.2");
    expect(sc.projectedRatio).toBe("2.4");
    expect(sc.isBorrowCollateralizedCurrent).toBe(true);
    expect(sc.isBorrowCollateralizedProjected).toBe(true);
    expect(sc.liquidationRiskCurrent).toBe("warning");
    expect(sc.liquidationRiskProjected).toBe("safe");
  });

  it("borrow action: adds debt; ratio degrades; would-liquidate warning emitted on safe→danger transition", async () => {
    // Wallet: 1 WBTC supplied, $10k debt. ratio = 24000/10000 = 2.4 (safe).
    // After borrowing $15k more → debt $25k → ratio = 24000/25000 = 0.96 (danger);
    // 85%-weighted = $25500; debt $25k → NOT yet liquidatable (within grace band).
    vi.spyOn(_compoundChains, "getCometState").mockResolvedValueOnce(
      mockCompoundState({
        baseBorrowed: 10_000n * 10n ** 6n,
        numAssets: 1,
      }),
    );
    vi.spyOn(_compoundChains, "getCometCollateralPositions").mockResolvedValueOnce([
      {
        asset: WBTC,
        balance: 1n * 10n ** 8n,
        priceUsd: 30_000n * 10n ** 8n,
        priceFeed: PRICE_FEED,
        scale: 10n ** 8n,
        decimals: 8,
        borrowCollateralFactor: 80n * 10n ** 16n,
        liquidateCollateralFactor: 85n * 10n ** 16n,
        liquidationFactor: 95n * 10n ** 16n,
        supplyCap: 1_000n * 10n ** 8n,
      },
    ]);

    const result = await callTool({
      protocol: "compound-v3",
      cometAddress: cUSDCv3,
      asset: USDC,
      action: "borrow",
      amount: "15000",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      currentRatio: string;
      projectedRatio: string;
      liquidationRiskCurrent: string;
      liquidationRiskProjected: string;
      warning?: string;
    };
    expect(sc.currentRatio).toBe("2.4");
    expect(sc.liquidationRiskCurrent).toBe("safe");
    expect(sc.liquidationRiskProjected).toBe("danger");
    expect(sc.warning).toBe("would-liquidate");
  });

  it("repay action: reduces debt; ratio improves", async () => {
    // Wallet: 1 WBTC supplied, $20k debt. ratio = 24000/20000 = 1.2 (warning).
    // After repaying $10k → debt $10k → ratio = 24000/10000 = 2.4 (safe).
    vi.spyOn(_compoundChains, "getCometState").mockResolvedValueOnce(
      mockCompoundState({
        baseBorrowed: 20_000n * 10n ** 6n,
        numAssets: 1,
      }),
    );
    vi.spyOn(_compoundChains, "getCometCollateralPositions").mockResolvedValueOnce([
      {
        asset: WBTC,
        balance: 1n * 10n ** 8n,
        priceUsd: 30_000n * 10n ** 8n,
        priceFeed: PRICE_FEED,
        scale: 10n ** 8n,
        decimals: 8,
        borrowCollateralFactor: 80n * 10n ** 16n,
        liquidateCollateralFactor: 85n * 10n ** 16n,
        liquidationFactor: 95n * 10n ** 16n,
        supplyCap: 1_000n * 10n ** 8n,
      },
    ]);

    const result = await callTool({
      protocol: "compound-v3",
      cometAddress: cUSDCv3,
      asset: USDC,
      action: "repay",
      amount: "10000",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      currentRatio: string;
      projectedRatio: string;
      liquidationRiskCurrent: string;
      liquidationRiskProjected: string;
    };
    expect(sc.currentRatio).toBe("1.2");
    expect(sc.projectedRatio).toBe("2.4");
    expect(sc.liquidationRiskCurrent).toBe("warning");
    expect(sc.liquidationRiskProjected).toBe("safe");
  });

  it("withdraw action on collateral: reduces collateral; ratio degrades", async () => {
    // Wallet: 1 WBTC supplied, $10k debt. ratio = 2.4 (safe).
    // After withdrawing 0.5 WBTC → collateral $15k × 0.80 = $12k → ratio 1.2 (warning).
    vi.spyOn(_compoundChains, "getCometState").mockResolvedValueOnce(
      mockCompoundState({
        baseBorrowed: 10_000n * 10n ** 6n,
        numAssets: 1,
      }),
    );
    vi.spyOn(_compoundChains, "getCometCollateralPositions").mockResolvedValueOnce([
      {
        asset: WBTC,
        balance: 1n * 10n ** 8n,
        priceUsd: 30_000n * 10n ** 8n,
        priceFeed: PRICE_FEED,
        scale: 10n ** 8n,
        decimals: 8,
        borrowCollateralFactor: 80n * 10n ** 16n,
        liquidateCollateralFactor: 85n * 10n ** 16n,
        liquidationFactor: 95n * 10n ** 16n,
        supplyCap: 1_000n * 10n ** 8n,
      },
    ]);

    const result = await callTool({
      protocol: "compound-v3",
      cometAddress: cUSDCv3,
      asset: WBTC,
      action: "withdraw",
      amount: "0.5",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      currentRatio: string;
      projectedRatio: string;
      warning?: string;
    };
    expect(sc.currentRatio).toBe("2.4");
    expect(sc.projectedRatio).toBe("1.2");
    expect(sc.warning).toBe("near-liquidation");
  });

  it("borrow projection requires base token (refuses on non-base asset)", async () => {
    vi.spyOn(_compoundChains, "getCometState").mockResolvedValueOnce(
      mockCompoundState({ numAssets: 1 }),
    );
    vi.spyOn(_compoundChains, "getCometCollateralPositions").mockResolvedValueOnce([
      {
        asset: WBTC,
        balance: 1n * 10n ** 8n,
        priceUsd: 30_000n * 10n ** 8n,
        priceFeed: PRICE_FEED,
        scale: 10n ** 8n,
        decimals: 8,
        borrowCollateralFactor: 80n * 10n ** 16n,
        liquidateCollateralFactor: 85n * 10n ** 16n,
        liquidationFactor: 95n * 10n ** 16n,
        supplyCap: 1_000n * 10n ** 8n,
      },
    ]);

    const result = await callTool({
      protocol: "compound-v3",
      cometAddress: cUSDCv3,
      asset: WBTC,
      action: "borrow",
      amount: "1.0",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/borrow projection requires the base token/);
  });
});
