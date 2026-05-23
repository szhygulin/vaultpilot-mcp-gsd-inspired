// test/signing-rocketpool-rate.test.ts
//
// Pure-math regressions for src/signing/rocketpool-rate.ts — Phase 31 Plan 31-03.
//
// Pins:
//   - RETH_SCALE === 10n ** 18n (bigint literal byte-identity)
//   - RETH_DECIMALS === 18n
//   - computeEthEquivalent({0n, 0n}) === { ethEquivalent: 0n } (degenerate path)
//   - computeEthEquivalent({1e18, 1.1e18}) === { ethEquivalent: 1.1e18 }
//     (1 rETH × 1.1 ETH/rETH = 1.1 ETH)
//   - Output shape is STRICTLY { ethEquivalent: bigint } — NO `approx` flag.
//     Contrast with Lido's LidoRebaseOutput (rebase model → approx:true).
//     Rocket Pool rETH is non-rebasing — the rate from getExchangeRate() is
//     canonical at the read block.

import { describe, expect, it } from "vitest";

import {
  RETH_SCALE,
  RETH_DECIMALS,
  computeEthEquivalent,
  _rocketPoolRate,
} from "../src/signing/rocketpool-rate.js";

describe("RETH_SCALE + RETH_DECIMALS constants", () => {
  it("RETH_SCALE === 10n ** 18n (bigint literal byte-identity)", () => {
    expect(RETH_SCALE).toBe(10n ** 18n);
    expect(RETH_SCALE).toBe(1_000_000_000_000_000_000n);
  });

  it("RETH_DECIMALS === 18n", () => {
    expect(RETH_DECIMALS).toBe(18n);
  });
});

describe("computeEthEquivalent — deterministic + degenerate-zero", () => {
  it("degenerate-zero: {rethBalance: 0n, exchangeRate: 0n} → {ethEquivalent: 0n}", () => {
    expect(computeEthEquivalent({ rethBalance: 0n, exchangeRate: 0n })).toEqual({
      ethEquivalent: 0n,
    });
  });

  it("1 rETH × 1.1 ETH/rETH = 1.1 ETH (canonical case)", () => {
    expect(
      computeEthEquivalent({
        rethBalance: 1_000_000_000_000_000_000n, // 1 rETH
        exchangeRate: 1_100_000_000_000_000_000n, // 1.1e18 (1.1 ETH per rETH)
      }),
    ).toEqual({ ethEquivalent: 1_100_000_000_000_000_000n });
  });

  it("0.5 rETH × 1.2 ETH/rETH = 0.6 ETH", () => {
    expect(
      computeEthEquivalent({
        rethBalance: 500_000_000_000_000_000n, // 0.5 rETH
        exchangeRate: 1_200_000_000_000_000_000n, // 1.2e18
      }),
    ).toEqual({ ethEquivalent: 600_000_000_000_000_000n });
  });

  it("zero rate (degenerate; e.g. fresh contract pre-rebase) → ethEquivalent = 0n", () => {
    expect(
      computeEthEquivalent({
        rethBalance: 10_000_000_000_000_000_000n,
        exchangeRate: 0n,
      }),
    ).toEqual({ ethEquivalent: 0n });
  });
});

describe("RocketPoolRateOutput shape — NO `approx` flag (contrast with LidoRebaseOutput)", () => {
  it("result has exactly one key — `ethEquivalent` (no approx flag)", () => {
    const result = computeEthEquivalent({
      rethBalance: 1_000_000_000_000_000_000n,
      exchangeRate: 1_100_000_000_000_000_000n,
    });
    expect(Object.keys(result).sort()).toEqual(["ethEquivalent"]);
    // T-ROCKETPOOL-RATE-PURE-MATH: rETH is non-rebasing — the rate is the
    // canonical contract-level conversion at the read block. NO `approx`
    // flag is needed (unlike Lido's `LidoRebaseOutput`, which surfaces
    // approx:true for the rebase-based earned-rewards approximation).
    expect((result as Record<string, unknown>).approx).toBeUndefined();
  });
});

describe("ESM spy-affordance — _rocketPoolRate", () => {
  it("exposes computeEthEquivalent for vi.spyOn interception", () => {
    expect(typeof _rocketPoolRate.computeEthEquivalent).toBe("function");
    expect(_rocketPoolRate.computeEthEquivalent).toBe(computeEthEquivalent);
  });
});
