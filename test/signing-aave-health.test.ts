import { describe, expect, it } from "vitest";

import {
  BPS_SCALE,
  HF_SCALE,
  RAY,
  classifyLiquidationRisk,
  computeHealthFactor,
} from "../src/signing/aave-health.js";

describe("signing/aave-health constants (research § Topic 3 lock; T-AAVE-HF-MATH-DRIFT-1)", () => {
  it("RAY === 10n ** 27n byte-identical", () => {
    expect(RAY).toBe(10n ** 27n);
    expect(RAY).toBe(1000000000000000000000000000n);
  });

  it("BPS_SCALE === 10000n byte-identical", () => {
    expect(BPS_SCALE).toBe(10000n);
  });

  it("HF_SCALE === 10n ** 18n byte-identical (Aave protocol-canonical scale)", () => {
    expect(HF_SCALE).toBe(10n ** 18n);
    expect(HF_SCALE).toBe(1000000000000000000n);
  });
});

describe("signing/aave-health::computeHealthFactor", () => {
  it("deterministic anchor: 1000 USDC collateral @85% LT + 500 USDC debt → healthFactorScaled === 1700000000000000000n", () => {
    // Hardcoded literal anchor (T-AAVE-HF-MATH-DRIFT-1) — any RAY / BPS_SCALE
    // / HF_SCALE drift OR formula reordering breaks THIS line at PR review.
    // Computed once via dist/ build + pinned (research § Topic 3 verbatim).
    //
    // collateralBase = (1000e6 * 1e27 / RAY) * 1e8 / 1e6 = 1000e8
    // weightedLT     = 1000e8 * 8500 / 10000           = 850e8
    // debtBase       = (500e6  * 1e27 / RAY) * 1e8 / 1e6 = 500e8
    // HF             = 850e8 * 1e18 / 500e8            = 1.7e18
    const result = computeHealthFactor({
      collateralPositions: [
        {
          scaledBalance: 1000n * 10n ** 6n,
          index: 10n ** 27n,
          price: 10n ** 8n,
          decimals: 6,
          liquidationThresholdBps: 8500n,
        },
      ],
      debtPositions: [
        {
          scaledDebt: 500n * 10n ** 6n,
          index: 10n ** 27n,
          price: 10n ** 8n,
          decimals: 6,
        },
      ],
    });

    expect(result.healthFactorScaled).toBe(1700000000000000000n);
    expect(result.noDebt).toBe(false);
    expect(result.totalCollateralBase).toBe(100000000000n); // 1000e8
    expect(result.totalDebtBase).toBe(50000000000n); // 500e8
    expect(result.weightedLiquidationThresholdBase).toBe(85000000000n); // 850e8
  });

  it("noDebt arm: 1 collateral + 0 debt → healthFactorScaled === null, noDebt === true", () => {
    // T-AAVE-HF-INFINITY-1 mitigation: null (not MAX_UINT256), so the agent
    // reads `noDebt: true` first and `healthFactorScaled` second.
    const result = computeHealthFactor({
      collateralPositions: [
        {
          scaledBalance: 1000n * 10n ** 6n,
          index: 10n ** 27n,
          price: 10n ** 8n,
          decimals: 6,
          liquidationThresholdBps: 8500n,
        },
      ],
      debtPositions: [],
    });
    expect(result.healthFactorScaled).toBeNull();
    expect(result.noDebt).toBe(true);
    expect(result.totalCollateralBase).toBe(100000000000n);
    expect(result.totalDebtBase).toBe(0n);
  });

  it("empty arms: 0 collateral + 0 debt → null + noDebt + zero totals", () => {
    const result = computeHealthFactor({
      collateralPositions: [],
      debtPositions: [],
    });
    expect(result.healthFactorScaled).toBeNull();
    expect(result.noDebt).toBe(true);
    expect(result.totalCollateralBase).toBe(0n);
    expect(result.totalDebtBase).toBe(0n);
    expect(result.weightedLiquidationThresholdBase).toBe(0n);
  });

  it("multi-asset: 1000 USDC + 0.5 WETH@$4000 LT 82.5% + 500 DAI debt → HF === 5e18", () => {
    // Independent anchor reused by test/get-lending-positions.test.ts happy-path.
    // collateralBase = 1000e8 (USDC) + (5e17 * 1e27/RAY) * 4000e8 / 1e18
    //                = 1000e8 + 2000e8 = 3000e8
    // weightedLT     = 1000e8 * 8500/10000 + 2000e8 * 8250/10000
    //                = 850e8 + 1650e8    = 2500e8
    // debtBase       = (500e18 * 1e27/RAY) * 1e8 / 1e18 = 500e8
    // HF             = 2500e8 * 1e18 / 500e8 = 5e18
    const result = computeHealthFactor({
      collateralPositions: [
        {
          scaledBalance: 1000n * 10n ** 6n,
          index: 10n ** 27n,
          price: 10n ** 8n,
          decimals: 6,
          liquidationThresholdBps: 8500n,
        },
        {
          scaledBalance: 500_000_000_000_000_000n, // 0.5 WETH
          index: 10n ** 27n,
          price: 4000n * 10n ** 8n,
          decimals: 18,
          liquidationThresholdBps: 8250n,
        },
      ],
      debtPositions: [
        {
          scaledDebt: 500n * 10n ** 18n,
          index: 10n ** 27n,
          price: 10n ** 8n,
          decimals: 18,
        },
      ],
    });
    expect(result.healthFactorScaled).toBe(5000000000000000000n); // 5e18
    expect(result.totalCollateralBase).toBe(300000000000n);
    expect(result.totalDebtBase).toBe(50000000000n);
    expect(result.weightedLiquidationThresholdBase).toBe(250000000000n);
  });

  it("non-RAY index path: liquidityIndex=1.5e27 inflates scaled balance by 1.5x", () => {
    // The RAY scaling on indices is load-bearing; this anchor catches a regression
    // where someone removes the `/RAY` step (effectively multiplying by 1e27).
    const result = computeHealthFactor({
      collateralPositions: [
        {
          scaledBalance: 1000n * 10n ** 6n, // 1000 USDC scaled
          index: 15n * 10n ** 26n, // 1.5e27 — index has accrued
          price: 10n ** 8n,
          decimals: 6,
          liquidationThresholdBps: 8500n,
        },
      ],
      debtPositions: [
        {
          scaledDebt: 500n * 10n ** 6n,
          index: 10n ** 27n,
          price: 10n ** 8n,
          decimals: 6,
        },
      ],
    });
    // collateralBase = (1000e6 * 1.5e27 / 1e27) * 1e8 / 1e6 = 1500e8
    // weightedLT     = 1500e8 * 8500 / 10000               = 1275e8
    // debtBase       = 500e8
    // HF             = 1275e8 * 1e18 / 500e8               = 2.55e18
    expect(result.healthFactorScaled).toBe(2550000000000000000n);
    expect(result.totalCollateralBase).toBe(150000000000n);
  });
});

describe("signing/aave-health::classifyLiquidationRisk", () => {
  it("HF=2.0e18 → safe", () => {
    expect(classifyLiquidationRisk(2n * 10n ** 18n, false)).toBe("safe");
  });

  it("HF=1.2e18 → warning", () => {
    expect(classifyLiquidationRisk(12n * 10n ** 17n, false)).toBe("warning");
  });

  it("HF=0.9e18 → danger", () => {
    expect(classifyLiquidationRisk(9n * 10n ** 17n, false)).toBe("danger");
  });

  it("noDebt=true → noDebt (regardless of HF input)", () => {
    expect(classifyLiquidationRisk(null, true)).toBe("noDebt");
    // Defensive: even a non-null HF with noDebt=true returns "noDebt"
    expect(classifyLiquidationRisk(2n * 10n ** 18n, true)).toBe("noDebt");
  });

  it("boundary at safe threshold (1.50e18)", () => {
    expect(classifyLiquidationRisk(15n * 10n ** 17n, false)).toBe("safe"); // exactly 1.50
    expect(classifyLiquidationRisk(15n * 10n ** 17n - 1n, false)).toBe("warning"); // 1.499...
  });

  it("boundary at warning threshold (1.10e18)", () => {
    expect(classifyLiquidationRisk(11n * 10n ** 17n, false)).toBe("warning"); // exactly 1.10
    expect(classifyLiquidationRisk(11n * 10n ** 17n - 1n, false)).toBe("danger"); // 1.099...
  });

  it("defensive: healthFactorScaled=null + noDebt=false → noDebt (unreachable arm)", () => {
    // The defensive fall-through proves the classifier never throws on a
    // malformed upstream input (the unreachable contract is "noDebt=false
    // implies healthFactorScaled !== null"; we want a graceful classification
    // not a crash).
    expect(classifyLiquidationRisk(null, false)).toBe("noDebt");
  });
});
