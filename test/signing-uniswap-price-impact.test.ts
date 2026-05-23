// test/signing-uniswap-price-impact.test.ts — Phase 32 Plan 32-02 (UNI-01).
//
// Pure-bigint regression anchors for src/signing/uniswap-price-impact.ts.
// Structural mirror of test/signing-eigenlayer-shares.test.ts (Phase 31 analog).
//
// T-32-PRICE-IMPACT-UNDERSTATEMENT mitigation: the algorithm UNDERSTATES
// impact on pools with concentrated liquidity at the spot tick; this test
// file does NOT exercise that property (it is a documented residual risk
// mitigated at the D-08 2% refusal-threshold layer, not at the helper layer).
// This test pins the deterministic edge-case behavior of the formula itself.

import { describe, expect, it } from "vitest";

import {
  _uniswapV3PriceImpact,
  computePriceImpactBps,
} from "../src/signing/uniswap-price-impact.js";

describe("computePriceImpactBps — Phase 32 Plan 32-02 (D-04b Quoter-midpoint method)", () => {
  it("Edge case 1 — fairOut === 0n returns 10000 (degenerate; conservative max impact)", () => {
    // No fair-price reference available → conservative: treat as 100% impact
    // so the D-08 sandwich-MEV gate trips.
    expect(computePriceImpactBps({ fairOut: 0n, actualOut: 0n })).toBe(10000);
  });

  it("Equal-out (actualOut === fairOut) returns 0 (no impact)", () => {
    // Tiny-amount quote scaled back equals full quote → no price impact.
    expect(
      computePriceImpactBps({
        fairOut: 1_000_000n,
        actualOut: 1_000_000n,
      }),
    ).toBe(0);
  });

  it("Edge case 2 — actualOut > fairOut (RPC noise) returns 0 (drop clamped at 0n; cannot emit negative impact)", () => {
    // Tick-math rounding artifacts can produce actualOut slightly above
    // fairOut; floor drop at 0n.
    expect(
      computePriceImpactBps({
        fairOut: 1_000_000n,
        actualOut: 1_001_000n,
      }),
    ).toBe(0);
  });

  it("Happy-path 1% drop: 10000 bps base → 100 bps (1.00%)", () => {
    // fairOut=1_000_000; actualOut=990_000 → drop=10_000; bps=10_000*10_000/1_000_000=100
    expect(
      computePriceImpactBps({
        fairOut: 1_000_000n,
        actualOut: 990_000n,
      }),
    ).toBe(100);
  });

  it("Happy-path 0.5% drop: 50 bps", () => {
    // fairOut=1_000_000; actualOut=995_000 → drop=5_000; bps=5_000*10_000/1_000_000=50
    expect(
      computePriceImpactBps({
        fairOut: 1_000_000n,
        actualOut: 995_000n,
      }),
    ).toBe(50);
  });

  it("Happy-path 2.5% drop: 250 bps (above the D-08 2% threshold)", () => {
    // fairOut=1_000_000; actualOut=975_000 → drop=25_000; bps=250
    // This case would trip the sandwich-MEV gate at quote time (warning) +
    // prepare time (refusal if slippage not explicit) — Plan 32-03 wires
    // the prepare-time refusal.
    expect(
      computePriceImpactBps({
        fairOut: 1_000_000n,
        actualOut: 975_000n,
      }),
    ).toBe(250);
  });

  it("Mid-range 50% drop: 5000 bps", () => {
    // fairOut=1_000_000; actualOut=500_000 → drop=500_000; bps=5000
    expect(
      computePriceImpactBps({
        fairOut: 1_000_000n,
        actualOut: 500_000n,
      }),
    ).toBe(5000);
  });

  it("Edge case 3 boundary — drop = fairOut (actualOut === 0n) yields 10000 bps (structural max)", () => {
    // fairOut=1_000_000; actualOut=0 → drop=1_000_000; bps=10_000*10_000/1_000_000=10000.
    // Returned 10000; this is the natural maximum (not the cap). The cap
    // (`bps > 10000n` branch) is a safety net for RPC-bug arithmetic.
    expect(
      computePriceImpactBps({
        fairOut: 1_000_000n,
        actualOut: 0n,
      }),
    ).toBe(10000);
  });

  it("Larger-scale numeric sanity: realistic wei values (1e18-class fairOut)", () => {
    // fairOut=1_000_000_000_000_000_000n (1e18); actualOut=999_500_000_000_000_000n
    // → drop=500_000_000_000_000n; bps=(5e14 * 1e4) / 1e18 = 5
    expect(
      computePriceImpactBps({
        fairOut: 1_000_000_000_000_000_000n,
        actualOut: 999_500_000_000_000_000n,
      }),
    ).toBe(5);
  });

  it("Returned value is a JS Number (NOT a bigint) — agent-boundary contract", () => {
    // The structured-content envelope ships priceImpactBps as a number per
    // CLAUDE.md decimal-aware-at-boundary rule + Phase 20 SunSwap precedent.
    const result = computePriceImpactBps({
      fairOut: 1_000_000n,
      actualOut: 990_000n,
    });
    expect(typeof result).toBe("number");
    expect(Number.isInteger(result)).toBe(true);
  });

  it("ESM spy-affordance — _uniswapV3PriceImpact.computePriceImpactBps is the same function reference", () => {
    // CLAUDE.md § Conventions — indirection object exposes the same function
    // so vi.spyOn() can intercept module-internal calls from downstream
    // consumers (src/tools/get_uniswap_quote.ts).
    expect(_uniswapV3PriceImpact.computePriceImpactBps).toBe(
      computePriceImpactBps,
    );
  });
});
