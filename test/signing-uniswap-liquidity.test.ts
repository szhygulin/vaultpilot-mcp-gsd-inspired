// test/signing-uniswap-liquidity.test.ts
//
// Phase 33 Plan 33-01 — pure-bigint Q64.96 liquidity math regression.
// Anchored against the v3-periphery LiquidityAmounts.sol reference; the
// 3-case branch on `sqrtC <=> [sqrtA, sqrtB]` is exercised explicitly.

import { describe, expect, it } from "vitest";

import {
  _uniswapV3Liquidity,
  getAmount0ForLiquidity,
  getAmount1ForLiquidity,
  getAmountsForLiquidity,
  getLiquidityForAmount0,
  getLiquidityForAmount1,
  getLiquidityForAmounts,
} from "../src/signing/uniswap-liquidity.js";
import { tickToSqrtPriceX96 } from "../src/signing/uniswap-tick.js";

// Representative range — 1.0001^tick brackets surrounding tick=0 (clean math).
const SQRT_LOWER = tickToSqrtPriceX96(-100); // sqrt of 1.0001^{-100}
const SQRT_UPPER = tickToSqrtPriceX96(100);  // sqrt of 1.0001^{+100}
const SQRT_CURRENT_IN_RANGE = tickToSqrtPriceX96(0);
const SQRT_CURRENT_BELOW = tickToSqrtPriceX96(-200);
const SQRT_CURRENT_ABOVE = tickToSqrtPriceX96(200);
const L = 1_000_000_000_000_000_000n; // 1e18 liquidity units

describe("uniswap-liquidity — getAmountsForLiquidity 3-case branch", () => {
  it("sqrtC < sqrtA → all-token0 branch (amount1 = 0)", () => {
    const [a0, a1] = getAmountsForLiquidity(SQRT_CURRENT_BELOW, SQRT_LOWER, SQRT_UPPER, L);
    expect(a0).toBeGreaterThan(0n);
    expect(a1).toBe(0n);
  });

  it("sqrtC > sqrtB → all-token1 branch (amount0 = 0)", () => {
    const [a0, a1] = getAmountsForLiquidity(SQRT_CURRENT_ABOVE, SQRT_LOWER, SQRT_UPPER, L);
    expect(a0).toBe(0n);
    expect(a1).toBeGreaterThan(0n);
  });

  it("sqrtA < sqrtC < sqrtB → mixed branch (both amounts > 0)", () => {
    const [a0, a1] = getAmountsForLiquidity(SQRT_CURRENT_IN_RANGE, SQRT_LOWER, SQRT_UPPER, L);
    expect(a0).toBeGreaterThan(0n);
    expect(a1).toBeGreaterThan(0n);
  });

  it("sqrtC === sqrtA → all-token0 branch (boundary inclusive)", () => {
    const [a0, a1] = getAmountsForLiquidity(SQRT_LOWER, SQRT_LOWER, SQRT_UPPER, L);
    expect(a0).toBeGreaterThan(0n);
    expect(a1).toBe(0n);
  });

  it("sqrtC === sqrtB → all-token1 branch (boundary inclusive)", () => {
    const [a0, a1] = getAmountsForLiquidity(SQRT_UPPER, SQRT_LOWER, SQRT_UPPER, L);
    expect(a0).toBe(0n);
    expect(a1).toBeGreaterThan(0n);
  });

  it("range sort is invariant under (sqrtA, sqrtB) swap", () => {
    const [a0a, a1a] = getAmountsForLiquidity(SQRT_CURRENT_IN_RANGE, SQRT_LOWER, SQRT_UPPER, L);
    const [a0b, a1b] = getAmountsForLiquidity(SQRT_CURRENT_IN_RANGE, SQRT_UPPER, SQRT_LOWER, L);
    expect(a0a).toBe(a0b);
    expect(a1a).toBe(a1b);
  });
});

describe("uniswap-liquidity — round-trip property", () => {
  // Round-trip via Solidity-style integer mulDiv accumulates a few units of
  // rounding error per nested divide. Bound: 1e6 = 0.0001% of L=1e18 — far
  // below any meaningful price impact, anchors algorithmic shape correctness.
  const ROUND_TRIP_TOLERANCE = 1_000_000n;

  it("getLiquidityForAmounts(getAmountsForLiquidity(L)) returns L within tolerance (in-range)", () => {
    const [a0, a1] = getAmountsForLiquidity(SQRT_CURRENT_IN_RANGE, SQRT_LOWER, SQRT_UPPER, L);
    const Lback = getLiquidityForAmounts(SQRT_CURRENT_IN_RANGE, SQRT_LOWER, SQRT_UPPER, a0, a1);
    const diff = L > Lback ? L - Lback : Lback - L;
    expect(diff).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
  });

  it("round-trip for all-token0 (below-range) branch", () => {
    const [a0, a1] = getAmountsForLiquidity(SQRT_CURRENT_BELOW, SQRT_LOWER, SQRT_UPPER, L);
    const Lback = getLiquidityForAmounts(SQRT_CURRENT_BELOW, SQRT_LOWER, SQRT_UPPER, a0, a1);
    const diff = L > Lback ? L - Lback : Lback - L;
    expect(diff).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
  });

  it("round-trip for all-token1 (above-range) branch", () => {
    const [a0, a1] = getAmountsForLiquidity(SQRT_CURRENT_ABOVE, SQRT_LOWER, SQRT_UPPER, L);
    const Lback = getLiquidityForAmounts(SQRT_CURRENT_ABOVE, SQRT_LOWER, SQRT_UPPER, a0, a1);
    const diff = L > Lback ? L - Lback : Lback - L;
    expect(diff).toBeLessThanOrEqual(ROUND_TRIP_TOLERANCE);
  });
});

describe("uniswap-liquidity — getAmount0ForLiquidity / getAmount1ForLiquidity", () => {
  it("getAmount0ForLiquidity returns non-zero for typical inputs", () => {
    const a0 = getAmount0ForLiquidity(SQRT_LOWER, SQRT_UPPER, L);
    expect(a0).toBeGreaterThan(0n);
  });

  it("getAmount1ForLiquidity returns non-zero for typical inputs", () => {
    const a1 = getAmount1ForLiquidity(SQRT_LOWER, SQRT_UPPER, L);
    expect(a1).toBeGreaterThan(0n);
  });

  it("getAmount0ForLiquidity throws on sqrtA == 0 (degenerate)", () => {
    expect(() => getAmount0ForLiquidity(0n, SQRT_UPPER, L)).toThrow();
  });
});

describe("uniswap-liquidity — getLiquidityForAmount0 / getLiquidityForAmount1", () => {
  it("getLiquidityForAmount0 throws on degenerate range (sqrtA === sqrtB)", () => {
    expect(() => getLiquidityForAmount0(SQRT_LOWER, SQRT_LOWER, 1000n)).toThrow(
      /degenerate range/,
    );
  });

  it("getLiquidityForAmount1 throws on degenerate range (sqrtA === sqrtB)", () => {
    expect(() => getLiquidityForAmount1(SQRT_LOWER, SQRT_LOWER, 1000n)).toThrow(
      /degenerate range/,
    );
  });
});

describe("uniswap-liquidity — _uniswapV3Liquidity ESM spy-affordance", () => {
  it("indirection object exports all 6 functions", () => {
    expect(typeof _uniswapV3Liquidity.getAmount0ForLiquidity).toBe("function");
    expect(typeof _uniswapV3Liquidity.getAmount1ForLiquidity).toBe("function");
    expect(typeof _uniswapV3Liquidity.getAmountsForLiquidity).toBe("function");
    expect(typeof _uniswapV3Liquidity.getLiquidityForAmount0).toBe("function");
    expect(typeof _uniswapV3Liquidity.getLiquidityForAmount1).toBe("function");
    expect(typeof _uniswapV3Liquidity.getLiquidityForAmounts).toBe("function");
  });
});
