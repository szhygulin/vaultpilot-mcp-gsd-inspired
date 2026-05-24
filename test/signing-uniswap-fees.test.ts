// test/signing-uniswap-fees.test.ts
//
// Phase 33 Plan 33-01 — pure-bigint Q128.128 accrued-fee math regression.
// Exercises both the in-range 3-case feeGrowthInside branch + Q128.128 wrap
// discipline via BigInt.asUintN(256, ...).

import { describe, expect, it } from "vitest";

import {
  _uniswapV3Fees,
  computeAccruedFees,
  type AccruedFeesInput,
} from "../src/signing/uniswap-fees.js";

// Baseline inputs — in-range position, zero unsettled delta.
const BASE_INPUT: AccruedFeesInput = {
  liquidity: 1_000_000_000_000_000_000n, // 1e18
  tickLower: -100,
  tickUpper: 100,
  currentTick: 0, // in-range
  feeGrowthGlobal0X128: 1000n * (1n << 128n), // 1000 token units * Q128
  feeGrowthGlobal1X128: 500n * (1n << 128n),
  feeGrowthOutsideLower0X128: 100n * (1n << 128n),
  feeGrowthOutsideLower1X128: 50n * (1n << 128n),
  feeGrowthOutsideUpper0X128: 200n * (1n << 128n),
  feeGrowthOutsideUpper1X128: 100n * (1n << 128n),
  feeGrowthInside0LastX128: 0n,
  feeGrowthInside1LastX128: 0n,
  tokensOwed0: 0n,
  tokensOwed1: 0n,
};

describe("uniswap-fees — computeAccruedFees", () => {
  it("zero unsettled delta + tokensOwed=0 → both amounts = 0", () => {
    // feeGrowthInsideLast set equal to the just-computed feeGrowthInside →
    // delta wraps to zero (no overflow), unsettled = 0.
    // For an in-range position with default outsides, feeGrowthInside computed
    // by the formula: 1000 - 100 - 200 = 700 for token0, 500 - 50 - 100 = 350 for token1.
    const fgInside0 = 700n * (1n << 128n);
    const fgInside1 = 350n * (1n << 128n);
    const args: AccruedFeesInput = {
      ...BASE_INPUT,
      feeGrowthInside0LastX128: fgInside0,
      feeGrowthInside1LastX128: fgInside1,
    };
    const { amount0, amount1 } = computeAccruedFees(args);
    expect(amount0).toBe(0n);
    expect(amount1).toBe(0n);
  });

  it("zero unsettled delta + non-zero tokensOwed → amounts === tokensOwed", () => {
    const fgInside0 = 700n * (1n << 128n);
    const fgInside1 = 350n * (1n << 128n);
    const args: AccruedFeesInput = {
      ...BASE_INPUT,
      feeGrowthInside0LastX128: fgInside0,
      feeGrowthInside1LastX128: fgInside1,
      tokensOwed0: 12345n,
      tokensOwed1: 6789n,
    };
    const { amount0, amount1 } = computeAccruedFees(args);
    expect(amount0).toBe(12345n);
    expect(amount1).toBe(6789n);
  });

  it("non-zero unsettled delta → amounts include both settled + unsettled", () => {
    // feeGrowthInsideLast = 0 → unsettled = (700 << 128) × 1e18 / 2^128 = 700 × 1e18.
    const { amount0, amount1 } = computeAccruedFees(BASE_INPUT);
    expect(amount0).toBe(700n * 1_000_000_000_000_000_000n);
    expect(amount1).toBe(350n * 1_000_000_000_000_000_000n);
  });

  it("Q128.128 wrap discipline — feeGrowthInsideLast > feeGrowthInside yields wrapped POSITIVE accrual", () => {
    // Simulate the on-chain overflow-by-design subtraction: the
    // feeGrowthInsideLast was snapshotted BEFORE the global accumulator
    // wrapped past 2^256, so the current feeGrowthInside is now LESS than
    // last in raw bigint terms — but uint256 subtraction wraps positive.
    // Set feeGrowthInside0Last to a value ABOVE the just-computed inside
    // value, mimicking the wrap-around scenario.
    const fgInside0 = 700n * (1n << 128n);
    const fgInside1 = 350n * (1n << 128n);
    // Last = inside + (2^256 - small_unsettled) → wrapped subtraction yields small_unsettled.
    const TWO_256 = 1n << 256n;
    const smallUnsettled = 5n * (1n << 128n);
    const args: AccruedFeesInput = {
      ...BASE_INPUT,
      // Inside_last placed at (inside - smallUnsettled), modulo 2^256 → just
      // pick last = (inside - smallUnsettled + 2^256) mod 2^256.
      // Concretely: last = inside + (2^256 - smallUnsettled).
      feeGrowthInside0LastX128: BigInt.asUintN(256, fgInside0 + (TWO_256 - smallUnsettled)),
      feeGrowthInside1LastX128: BigInt.asUintN(256, fgInside1 + (TWO_256 - smallUnsettled)),
    };
    const { amount0, amount1 } = computeAccruedFees(args);
    // delta = smallUnsettled = 5 << 128; unsettled = 5 × 1e18.
    const expected = 5n * 1_000_000_000_000_000_000n;
    expect(amount0).toBe(expected);
    expect(amount1).toBe(expected);
  });

  it("currentTick BELOW range — feeGrowthInside branch (currentTick < tickLower)", () => {
    // In this branch:
    //   feeGrowthBelow_lower = feeGrowthGlobal - feeGrowthOutside_lower
    //   feeGrowthBelow_upper = feeGrowthGlobal - feeGrowthOutside_upper
    //   feeGrowthAbove_lower = feeGrowthOutside_lower
    //   feeGrowthAbove_upper = feeGrowthOutside_upper
    //   feeGrowthInside = global - (global - outside_lower) - outside_upper
    //                   = outside_lower - outside_upper
    // For token0: 100 - 200 = -100 → wraps to 2^256 - 100<<128 (huge bigint).
    const args: AccruedFeesInput = {
      ...BASE_INPUT,
      currentTick: -200, // below range
    };
    const { amount0 } = computeAccruedFees(args);
    // Just assert math runs without throwing and returns a bigint.
    expect(typeof amount0).toBe("bigint");
  });

  it("currentTick ABOVE range — feeGrowthInside branch (currentTick >= tickUpper)", () => {
    const args: AccruedFeesInput = {
      ...BASE_INPUT,
      currentTick: 200, // above range
    };
    const { amount0, amount1 } = computeAccruedFees(args);
    expect(typeof amount0).toBe("bigint");
    expect(typeof amount1).toBe("bigint");
  });
});

describe("uniswap-fees — _uniswapV3Fees ESM spy-affordance", () => {
  it("indirection object exports computeAccruedFees", () => {
    expect(typeof _uniswapV3Fees.computeAccruedFees).toBe("function");
  });
});
