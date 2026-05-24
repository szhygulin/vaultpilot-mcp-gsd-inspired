// test/signing-uniswap-il.test.ts
//
// Phase 33 Plan 33-01 — pure-bigint IL estimate regression. Covers in-range
// HIGH confidence branch + out-of-range LOW confidence fallback + extreme
// asymmetric range refusal (empty strings + low confidence per RESEARCH §
// Topic 5 ASSUMED threshold).

import { describe, expect, it } from "vitest";

import { _uniswapV3Il, computeIlEstimate } from "../src/signing/uniswap-il.js";
import { tickToSqrtPriceX96 } from "../src/signing/uniswap-tick.js";

describe("uniswap-il — computeIlEstimate (in-range HIGH confidence)", () => {
  it("in-range position with zero fees → ilRaw === '0' (matches hodl baseline at current price)", () => {
    // In-range case: entrySqrtPrice = currentSqrtPrice, so position-value ===
    // hodl-value by construction. ilRaw must be exactly 0.
    const sqrtCurrent = tickToSqrtPriceX96(0);
    const result = computeIlEstimate({
      liquidity: 1_000_000_000_000_000_000n,
      tickLower: -100,
      tickUpper: 100,
      currentSqrtPriceX96: sqrtCurrent,
      accruedFees: { amount0: 0n, amount1: 0n },
      decimals0: 18,
      decimals1: 18,
    });
    expect(result.ilRaw).toBe("0");
    expect(result.ilNetOfFees).toBe("0");
    expect(result.ilEstimateConfidence).toBe("high");
  });

  it("in-range position with positive fees → ilNetOfFees > 0", () => {
    const sqrtCurrent = tickToSqrtPriceX96(0);
    const result = computeIlEstimate({
      liquidity: 1_000_000_000_000_000_000n,
      tickLower: -100,
      tickUpper: 100,
      currentSqrtPriceX96: sqrtCurrent,
      accruedFees: { amount0: 1000n, amount1: 2000n },
      decimals0: 18,
      decimals1: 18,
    });
    expect(result.ilRaw).toBe("0");
    // Fee value in token1 = amount0 × price + amount1; price ≈ 1.0 at tick 0
    // and decimals match → amount0 ≈ amount0_in_token1 units. Net IL > 0.
    expect(result.ilNetOfFees).not.toBe("0");
    expect(result.ilEstimateConfidence).toBe("high");
  });
});

describe("uniswap-il — computeIlEstimate (out-of-range LOW confidence)", () => {
  it("out-of-range BELOW → confidence 'low'", () => {
    // currentTick (-200) is below tickLower (-100) → out-of-range, geometric
    // midpoint fallback fires, confidence is low.
    const sqrtCurrent = tickToSqrtPriceX96(-200);
    const result = computeIlEstimate({
      liquidity: 1_000_000_000_000_000_000n,
      tickLower: -100,
      tickUpper: 100,
      currentSqrtPriceX96: sqrtCurrent,
      accruedFees: { amount0: 0n, amount1: 0n },
      decimals0: 18,
      decimals1: 18,
    });
    expect(result.ilEstimateConfidence).toBe("low");
    expect(typeof result.ilRaw).toBe("string");
  });

  it("out-of-range ABOVE → confidence 'low'", () => {
    const sqrtCurrent = tickToSqrtPriceX96(200);
    const result = computeIlEstimate({
      liquidity: 1_000_000_000_000_000_000n,
      tickLower: -100,
      tickUpper: 100,
      currentSqrtPriceX96: sqrtCurrent,
      accruedFees: { amount0: 0n, amount1: 0n },
      decimals0: 18,
      decimals1: 18,
    });
    expect(result.ilEstimateConfidence).toBe("low");
  });
});

describe("uniswap-il — computeIlEstimate (extreme asymmetric range refusal)", () => {
  it("sqrtUpper/sqrtLower > 10 → empty IL strings + 'low' confidence", () => {
    // sqrtUpper/sqrtLower > 10 happens when the range spans roughly more than
    // tickUpper - tickLower > 2 * 23028 (since 1.0001^46056 ≈ 100, and we want
    // sqrt ratio > 10 → ratio > 100 → tick range > 46055). Pick a very wide
    // range to trigger the refusal.
    const sqrtCurrent = tickToSqrtPriceX96(0);
    const result = computeIlEstimate({
      liquidity: 1_000_000_000_000_000_000n,
      tickLower: -100000,
      tickUpper: 100000,
      currentSqrtPriceX96: sqrtCurrent,
      accruedFees: { amount0: 1000n, amount1: 1000n },
      decimals0: 18,
      decimals1: 18,
    });
    expect(result.ilRaw).toBe("");
    expect(result.ilNetOfFees).toBe("");
    expect(result.ilEstimateConfidence).toBe("low");
  });
});

describe("uniswap-il — _uniswapV3Il ESM spy-affordance", () => {
  it("indirection object exports computeIlEstimate", () => {
    expect(typeof _uniswapV3Il.computeIlEstimate).toBe("function");
  });
});
