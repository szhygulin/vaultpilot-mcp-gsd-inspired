// test/signing-uniswap-tick.test.ts
//
// Phase 33 Plan 33-01 — pure-bigint Q64.96 tick math regression. Anchored
// against canonical v3-core TickMath.sol reference values computed at probe
// time (npm-installed @uniswap/v3-sdk in /tmp; verified 2026-05-24). NO
// `beforeAll`-snapshot — every literal is hardcoded per CLAUDE.md.

import { describe, expect, it } from "vitest";

import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  TICK_SPACINGS,
  _uniswapV3Tick,
  priceToSqrtPriceX96,
  priceToTick,
  snapPriceToTick,
  sqrtPriceX96ToPrice,
  sqrtPriceX96ToTick,
  tickToPrice,
  tickToSqrtPriceX96,
} from "../src/signing/uniswap-tick.js";

// USDC/WETH conventional decimals (token0 = USDC = 6, token1 = WETH = 18).
const USDC_DECIMALS = 6;
const WETH_DECIMALS = 18;

describe("uniswap-tick — constants", () => {
  it("MIN_TICK / MAX_TICK / MIN_SQRT_RATIO / MAX_SQRT_RATIO match canonical Solidity values", () => {
    expect(MIN_TICK).toBe(-887272);
    expect(MAX_TICK).toBe(887272);
    expect(MIN_SQRT_RATIO).toBe(4295128739n);
    expect(MAX_SQRT_RATIO).toBe(1461446703485210103287273052203988822378723970342n);
  });

  it("TICK_SPACINGS table matches the canonical 4 Ethereum tiers", () => {
    expect(TICK_SPACINGS[100]).toBe(1);
    expect(TICK_SPACINGS[500]).toBe(10);
    expect(TICK_SPACINGS[3000]).toBe(60);
    expect(TICK_SPACINGS[10000]).toBe(200);
  });
});

describe("uniswap-tick — tickToSqrtPriceX96 (hardcoded canonical reference vectors)", () => {
  // All values computed from @uniswap/v3-sdk TickMath.getSqrtRatioAtTick at
  // probe-install time. Anchors the bigint port against the SDK reference.
  it("tick=0 → 2^96 = 79228162514264337593543950336n", () => {
    expect(tickToSqrtPriceX96(0)).toBe(79228162514264337593543950336n);
  });
  it("tick=1 → 79232123823359799118286999568n (canonical)", () => {
    expect(tickToSqrtPriceX96(1)).toBe(79232123823359799118286999568n);
  });
  it("tick=-1 → 79224201403219477170569942574n (canonical)", () => {
    expect(tickToSqrtPriceX96(-1)).toBe(79224201403219477170569942574n);
  });
  it("tick=60 → 79466191966197645195421774833n (canonical 0.30% spacing edge)", () => {
    expect(tickToSqrtPriceX96(60)).toBe(79466191966197645195421774833n);
  });
  it("tick=-60 → 78990846045029531151608375686n", () => {
    expect(tickToSqrtPriceX96(-60)).toBe(78990846045029531151608375686n);
  });
  it("tick=10 → 79267784519130042428790663799n (0.05% spacing edge)", () => {
    expect(tickToSqrtPriceX96(10)).toBe(79267784519130042428790663799n);
  });
  it("tick=200 → 80024378775772204256025656563n (1.00% spacing edge)", () => {
    expect(tickToSqrtPriceX96(200)).toBe(80024378775772204256025656563n);
  });
  it("tick=-200000 → 3598751819609688046946419n (USDC/WETH-style range)", () => {
    expect(tickToSqrtPriceX96(-200000)).toBe(3598751819609688046946419n);
  });
  it("tick=MIN_TICK → MIN_SQRT_RATIO (boundary)", () => {
    expect(tickToSqrtPriceX96(MIN_TICK)).toBe(MIN_SQRT_RATIO);
  });
  it("tick=MAX_TICK → MAX_SQRT_RATIO (boundary)", () => {
    expect(tickToSqrtPriceX96(MAX_TICK)).toBe(MAX_SQRT_RATIO);
  });
  it("throws on |tick| > MAX_TICK", () => {
    expect(() => tickToSqrtPriceX96(MAX_TICK + 1)).toThrow(/out of range/);
    expect(() => tickToSqrtPriceX96(MIN_TICK - 1)).toThrow(/out of range/);
  });
  it("throws on non-integer tick", () => {
    expect(() => tickToSqrtPriceX96(1.5)).toThrow(/integer/);
  });
});

describe("uniswap-tick — sqrtPriceX96ToTick (hardcoded canonical reference vectors)", () => {
  it("sqrtPriceX96=2^96 → tick=0", () => {
    expect(sqrtPriceX96ToTick(79228162514264337593543950336n)).toBe(0);
  });
  it("sqrtPriceX96=MIN_SQRT_RATIO → tick=MIN_TICK", () => {
    expect(sqrtPriceX96ToTick(MIN_SQRT_RATIO)).toBe(MIN_TICK);
  });
  it("sqrtPriceX96=MAX_SQRT_RATIO-1 → tick=MAX_TICK-1 (canonical reference)", () => {
    expect(sqrtPriceX96ToTick(MAX_SQRT_RATIO - 1n)).toBe(MAX_TICK - 1);
  });
  it("throws on sqrtPriceX96 < MIN_SQRT_RATIO", () => {
    expect(() => sqrtPriceX96ToTick(MIN_SQRT_RATIO - 1n)).toThrow(/out of range/);
  });
  it("throws on sqrtPriceX96 >= MAX_SQRT_RATIO", () => {
    expect(() => sqrtPriceX96ToTick(MAX_SQRT_RATIO)).toThrow(/out of range/);
  });
});

describe("uniswap-tick — round-trip property", () => {
  it("sqrtPriceX96ToTick(tickToSqrtPriceX96(t)) === t for representative ticks", () => {
    const ticks = [0, 1, -1, 60, -60, 200, -200, 10, -10, 1000, -1000, 100000, -100000, 887271, -887271];
    for (const t of ticks) {
      expect(sqrtPriceX96ToTick(tickToSqrtPriceX96(t))).toBe(t);
    }
  });
});

describe("uniswap-tick — priceToSqrtPriceX96 + sqrtPriceX96ToPrice (decimal-string interface)", () => {
  it("price=1.0 with matched decimals → sqrtPriceX96 = 2^96 (canonical baseline)", () => {
    // price = token1/token0; matched decimals → no decimal adjustment.
    // sqrt(1.0) = 1.0, encoded as 2^96 in Q64.96.
    const sqrt = priceToSqrtPriceX96("1.0", 18, 18);
    expect(sqrt).toBe(79228162514264337593543950336n);
    const back = sqrtPriceX96ToPrice(sqrt, 18, 18);
    expect(back).toBe("1");
  });

  it("priceToSqrtPriceX96('1900', WETH, USDC) — WETH as token0 (decimals 18→6)", () => {
    // Convention: token0=WETH(18), token1=USDC(6) → price = USDC/WETH = 1900.
    // Round-trip via the inverse should land close to "1900".
    const sqrt = priceToSqrtPriceX96("1900", WETH_DECIMALS, USDC_DECIMALS);
    expect(sqrt).toBeGreaterThan(0n);
    const back = sqrtPriceX96ToPrice(sqrt, WETH_DECIMALS, USDC_DECIMALS);
    // Within 0.1% — bigintSqrt is integer-rounded so round-trip is approximate.
    const backNum = Number(back);
    expect(backNum).toBeGreaterThan(1899);
    expect(backNum).toBeLessThan(1901);
  });

  it("throws on malformed price", () => {
    expect(() => priceToSqrtPriceX96("abc", 18, 18)).toThrow(/malformed/);
    expect(() => priceToSqrtPriceX96("", 18, 18)).toThrow();
  });

  it("throws on zero price", () => {
    expect(() => priceToSqrtPriceX96("0", 18, 18)).toThrow();
    expect(() => priceToSqrtPriceX96("0.0", 18, 18)).toThrow();
  });
});

describe("uniswap-tick — priceToTick + tickToPrice", () => {
  it("priceToTick + tickToPrice round-trip stays close to input for typical price (1900 with WETH=token0, USDC=token1)", () => {
    // price = token1/token0 (canonical Uniswap convention). With token0=WETH(18)
    // and token1=USDC(6), price="1900" means raw token1/token0 = 1900*1e6/1e18 =
    // 1.9e-9 — tick is large NEGATIVE.
    const tick = priceToTick("1900", WETH_DECIMALS, USDC_DECIMALS);
    expect(tick).toBeLessThan(0);
    expect(tick).toBeGreaterThan(MIN_TICK);
    const priceBack = tickToPrice(tick, WETH_DECIMALS, USDC_DECIMALS);
    // Within 0.1% of input.
    const back = Number(priceBack);
    expect(back).toBeGreaterThan(1898);
    expect(back).toBeLessThan(1902);
  });

  it("priceToTick + tickToPrice for canonical USDC/WETH pool (USDC=token0, WETH=token1) — small price (~0.000526) returns POSITIVE tick", () => {
    // USDC/WETH 0.05% canonical pool: token0=USDC(6), token1=WETH(18).
    // price = WETH/USDC (token1/token0) = 1/1900 ≈ 0.000526 in human units.
    // raw token1/token0 = 0.000526 * 1e18/1e6 = 5.26e8 — tick is large POSITIVE.
    const tick = priceToTick("0.000526", USDC_DECIMALS, WETH_DECIMALS);
    expect(tick).toBeGreaterThan(0);
    expect(tick).toBeLessThan(MAX_TICK);
  });

  it("tickToPrice(0) returns 1 for matched decimals", () => {
    expect(tickToPrice(0, 18, 18)).toBe("1");
  });
});

describe("uniswap-tick — snapPriceToTick (D-03 — snap delta surfacing)", () => {
  // Use the canonical USDC/WETH 0.05% orientation (token0=WETH, token1=USDC,
  // price="1900" in USDC/WETH form). Snap discipline is decimals-orientation-
  // independent. JS `%` returns -0 for negative-and-divisible inputs; use
  // Math.abs to normalize the zero-comparison.
  it("snaps to a multiple of TICK_SPACINGS[fee] for typical 0.05% pool", () => {
    const { tick } = snapPriceToTick("1900", 500, WETH_DECIMALS, USDC_DECIMALS);
    expect(Math.abs(tick % TICK_SPACINGS[500])).toBe(0);
  });

  it("snaps to a multiple of 60 for 0.30% pool", () => {
    const { tick } = snapPriceToTick("1900", 3000, WETH_DECIMALS, USDC_DECIMALS);
    expect(Math.abs(tick % TICK_SPACINGS[3000])).toBe(0);
  });

  it("snaps to a multiple of 200 for 1.00% pool", () => {
    const { tick } = snapPriceToTick("1900", 10000, WETH_DECIMALS, USDC_DECIMALS);
    expect(Math.abs(tick % TICK_SPACINGS[10000])).toBe(0);
  });

  it("snaps to a multiple of 1 for 0.01% pool (no-op snap)", () => {
    const { tick } = snapPriceToTick("1900", 100, WETH_DECIMALS, USDC_DECIMALS);
    expect(Math.abs(tick % TICK_SPACINGS[100])).toBe(0);
  });

  it("returns snapDeltaBps proportional to snap distance", () => {
    // For a snap to a near-by tick, delta should be small (within tens of bps).
    const { snapDeltaBps } = snapPriceToTick("1900", 500, WETH_DECIMALS, USDC_DECIMALS);
    expect(snapDeltaBps).toBeGreaterThanOrEqual(0);
    expect(snapDeltaBps).toBeLessThan(100);
  });

  it("returns snappedPrice as a non-empty decimal string", () => {
    const { snappedPrice } = snapPriceToTick("1900", 500, WETH_DECIMALS, USDC_DECIMALS);
    expect(typeof snappedPrice).toBe("string");
    expect(snappedPrice.length).toBeGreaterThan(0);
  });
});

describe("uniswap-tick — _uniswapV3Tick ESM spy-affordance", () => {
  it("the indirection object exports all 7 functions", () => {
    expect(typeof _uniswapV3Tick.priceToSqrtPriceX96).toBe("function");
    expect(typeof _uniswapV3Tick.sqrtPriceX96ToPrice).toBe("function");
    expect(typeof _uniswapV3Tick.tickToSqrtPriceX96).toBe("function");
    expect(typeof _uniswapV3Tick.sqrtPriceX96ToTick).toBe("function");
    expect(typeof _uniswapV3Tick.priceToTick).toBe("function");
    expect(typeof _uniswapV3Tick.tickToPrice).toBe("function");
    expect(typeof _uniswapV3Tick.snapPriceToTick).toBe("function");
  });
});
