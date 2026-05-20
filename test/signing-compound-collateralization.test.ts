// signing/compound-collateralization tests — Phase 28 Plan 28-04 (CMP-01).
//
// Pure-bigint math; no RPC; no mocks. Mirror of test/signing-aave-health.test.ts.
//
// Anchors:
//   - PRICE_FEED_SCALE / COLLATERAL_FACTOR_SCALE / RATIO_SCALE literal anchors
//     (T-COMPOUND-RATIO-DRIFT-1)
//   - 4-arm classifier: zero-debt / safe / warning / danger / liquidatable
//   - LiquidationRisk + classifyLiquidationRisk REUSED from aave-health.ts
//     (referential equality)
//   - On-chain bool replication: `isBorrowCollateralized` /
//     `isLiquidatable` computed from CF-weighted collateral vs debt.

import { describe, expect, it } from "vitest";

import {
  classifyLiquidationRisk as classifyAaveRisk,
  type LiquidationRisk,
} from "../src/signing/aave-health.js";
import {
  COLLATERAL_FACTOR_SCALE,
  PRICE_FEED_SCALE,
  RATIO_SCALE,
  classifyLiquidationRisk,
  computeCompoundCollateralization,
  type CompoundCollateralPosition,
} from "../src/signing/compound-collateralization.js";

describe("Compound collateralization — constants (T-COMPOUND-RATIO-DRIFT-1)", () => {
  it("PRICE_FEED_SCALE === 10n ** 8n (Chainlink 8-decimal scale)", () => {
    expect(PRICE_FEED_SCALE).toBe(10n ** 8n);
  });
  it("COLLATERAL_FACTOR_SCALE === 10n ** 18n", () => {
    expect(COLLATERAL_FACTOR_SCALE).toBe(10n ** 18n);
  });
  it("RATIO_SCALE === 10n ** 18n (parity with Aave HF_SCALE)", () => {
    expect(RATIO_SCALE).toBe(10n ** 18n);
  });
});

describe("Compound collateralization — classifyLiquidationRisk REUSED from aave-health.ts", () => {
  it("classifyLiquidationRisk re-exported from compound-collateralization === aave-health.ts version", () => {
    // Referential equality — guards against accidental duplication.
    expect(classifyLiquidationRisk).toBe(classifyAaveRisk);
  });
});

// 1 WBTC @ $30,000 (priceUsd = 30_000 * 1e8); WBTC is 8-decimal.
const ONE_WBTC: CompoundCollateralPosition = {
  balance: 1n * 10n ** 8n, // 1 WBTC in wei
  priceUsd: 30_000n * 10n ** 8n,
  decimals: 8,
  borrowCollateralFactor: 80n * 10n ** 16n, // 0.80 (80%) — 18-decimal scaled
  liquidateCollateralFactor: 85n * 10n ** 16n, // 0.85 (85%)
};

// 1 WETH @ $2000 (priceUsd = 2000 * 1e8); WETH is 18-decimal.
const ONE_WETH: CompoundCollateralPosition = {
  balance: 1n * 10n ** 18n,
  priceUsd: 2_000n * 10n ** 8n,
  decimals: 18,
  borrowCollateralFactor: 85n * 10n ** 16n,
  liquidateCollateralFactor: 90n * 10n ** 16n,
};

describe("Compound collateralization — zero-debt arm (noDebt: true)", () => {
  it("baseBorrowed === 0n → noDebt: true, ratioScaled: null, isBorrowCollateralized: true, isLiquidatable: false, risk: 'noDebt'", () => {
    const result = computeCompoundCollateralization({
      collateral: [ONE_WBTC],
      base: {
        baseBorrowed: 0n,
        basePriceUsd: 10n ** 8n, // $1 (USDC)
        baseDecimals: 6,
      },
    });
    expect(result.noDebt).toBe(true);
    expect(result.ratioScaled).toBeNull();
    expect(result.isBorrowCollateralized).toBe(true);
    expect(result.isLiquidatable).toBe(false);
    expect(result.liquidationRisk).toBe<LiquidationRisk>("noDebt");
    expect(result.debtValueUsd).toBe(0n);
    // Total collateral value: 1 WBTC × $30000 = $30000 (PRICE_FEED_SCALE).
    expect(result.totalCollateralValueUsd).toBe(30_000n * 10n ** 8n);
  });
});

describe("Compound collateralization — safe band (ratio >= 1.50)", () => {
  it("1 WBTC ($30k @ 80% bCF) + $10k USDC debt → ratio = 2.40 → risk: 'safe'", () => {
    // Collateral USD: $30000.
    // borrowCollateralized USD: $30000 × 0.80 = $24000.
    // Debt USD: $10000.
    // ratioScaled = 24000e8 × 1e18 / 10000e8 = 2.4e18.
    const result = computeCompoundCollateralization({
      collateral: [ONE_WBTC],
      base: {
        baseBorrowed: 10_000n * 10n ** 6n, // 10000 USDC
        basePriceUsd: 10n ** 8n,
        baseDecimals: 6,
      },
    });
    expect(result.noDebt).toBe(false);
    expect(result.ratioScaled).toBe(24n * 10n ** 17n); // 2.4e18
    expect(result.isBorrowCollateralized).toBe(true);
    expect(result.isLiquidatable).toBe(false);
    expect(result.liquidationRisk).toBe<LiquidationRisk>("safe");
  });
});

describe("Compound collateralization — warning band (1.10 <= ratio < 1.50)", () => {
  it("1 WBTC ($30k @ 80% bCF) + $20k USDC debt → ratio = 1.20 → risk: 'warning'", () => {
    // borrowCollateralized = $24000. Debt = $20000. Ratio = 1.20e18.
    const result = computeCompoundCollateralization({
      collateral: [ONE_WBTC],
      base: {
        baseBorrowed: 20_000n * 10n ** 6n,
        basePriceUsd: 10n ** 8n,
        baseDecimals: 6,
      },
    });
    expect(result.ratioScaled).toBe(12n * 10n ** 17n); // 1.2e18
    expect(result.liquidationRisk).toBe<LiquidationRisk>("warning");
    // 85%-weighted = $25500; debt $20000 → still collateralized AND not liquidatable.
    expect(result.isBorrowCollateralized).toBe(true);
    expect(result.isLiquidatable).toBe(false);
  });
});

describe("Compound collateralization — danger band (ratio < 1.10)", () => {
  it("1 WBTC ($30k @ 80% bCF) + $23k USDC debt → ratio = ~1.04 → risk: 'danger'", () => {
    // borrowCollateralized = $24000. Debt = $23000. Ratio = ~1.043e18.
    const result = computeCompoundCollateralization({
      collateral: [ONE_WBTC],
      base: {
        baseBorrowed: 23_000n * 10n ** 6n,
        basePriceUsd: 10n ** 8n,
        baseDecimals: 6,
      },
    });
    expect(result.ratioScaled).toBeLessThan(11n * 10n ** 17n); // < 1.10e18
    expect(result.liquidationRisk).toBe<LiquidationRisk>("danger");
    // borrow-CF still >= debt → isBorrowCollateralized: true.
    expect(result.isBorrowCollateralized).toBe(true);
    // 85%-weighted = $25500 > $23000 → NOT liquidatable yet.
    expect(result.isLiquidatable).toBe(false);
  });
});

describe("Compound collateralization — liquidatable (debt > liquidate-weighted collateral)", () => {
  it("1 WBTC ($30k @ 85% lCF) + $30k USDC debt → isLiquidatable: true", () => {
    // liquidateCollateralized = $30000 × 0.85 = $25500.
    // Debt = $30000.
    // Debt > liquidate-weighted → isLiquidatable: true.
    const result = computeCompoundCollateralization({
      collateral: [ONE_WBTC],
      base: {
        baseBorrowed: 30_000n * 10n ** 6n,
        basePriceUsd: 10n ** 8n,
        baseDecimals: 6,
      },
    });
    expect(result.isLiquidatable).toBe(true);
    // Borrow-CF-weighted ($24000) < debt ($30000) → NOT borrow-collateralized.
    expect(result.isBorrowCollateralized).toBe(false);
    expect(result.liquidationRisk).toBe<LiquidationRisk>("danger");
  });
});

describe("Compound collateralization — multi-collateral aggregation", () => {
  it("1 WBTC ($30k @ 80%) + 1 WETH ($2k @ 85%) collateral; $20k debt → ratio = (24000 + 1700) / 20000 = 1.285", () => {
    // WBTC borrow-CF-weighted: $30000 × 0.80 = $24000.
    // WETH borrow-CF-weighted: $2000 × 0.85 = $1700.
    // Total: $25700. Debt: $20000. Ratio = 25700/20000 = 1.285e18.
    const result = computeCompoundCollateralization({
      collateral: [ONE_WBTC, ONE_WETH],
      base: {
        baseBorrowed: 20_000n * 10n ** 6n,
        basePriceUsd: 10n ** 8n,
        baseDecimals: 6,
      },
    });
    expect(result.ratioScaled).toBe(1_285n * 10n ** 15n); // 1.285e18
    // 1.285 is in the warning band (1.10 <= ratio < 1.50).
    expect(result.liquidationRisk).toBe<LiquidationRisk>("warning");
    expect(result.totalCollateralValueUsd).toBe(32_000n * 10n ** 8n);
  });
});

describe("Compound collateralization — zero collateral, non-zero debt (undercollateralized)", () => {
  it("zero collateral + $1000 debt → isBorrowCollateralized: false + isLiquidatable: true", () => {
    const result = computeCompoundCollateralization({
      collateral: [],
      base: {
        baseBorrowed: 1_000n * 10n ** 6n,
        basePriceUsd: 10n ** 8n,
        baseDecimals: 6,
      },
    });
    expect(result.noDebt).toBe(false);
    expect(result.isBorrowCollateralized).toBe(false);
    expect(result.isLiquidatable).toBe(true);
    expect(result.ratioScaled).toBe(0n);
  });
});
