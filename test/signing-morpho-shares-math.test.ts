// test/signing-morpho-shares-math.test.ts — Phase 29 Plan 29-02.
//
// Pure-bigint SharesMathLib regression anchors. Mirror of
// `test/signing-aave-health.test.ts` shape: hardcoded input → expected-output
// literals for each function + constants byte-identity.
//
// Threat anchors:
//   - T-29-02-T-SHARES-MATH-DRIFT: VIRTUAL_SHARES / VIRTUAL_ASSETS drift =
//     misalignment with on-chain accounting (research § Topic 4 + § Don't
//     Hand-Roll). Tests 1 + 6 (empty-market anti-inflation guard) anchor.
//   - Rounding direction (Up >= Down): borrow-side over-reporting is the safe
//     direction for debt display; supply-side under-reporting is the safe
//     direction for withdrawable amount. Test 3 + 7 cross-check.

import { describe, expect, it } from "vitest";

import {
  VIRTUAL_ASSETS,
  VIRTUAL_SHARES,
  toAssetsDown,
  toAssetsUp,
  toSharesDown,
  toSharesUp,
} from "../src/signing/morpho-shares-math.js";

describe("signing/morpho-shares-math — VIRTUAL constants byte-identity (T-29-02-T-SHARES-MATH-DRIFT)", () => {
  it("VIRTUAL_SHARES === 1_000_000n (1e6 anti-inflation guard — research § Topic 4)", () => {
    expect(VIRTUAL_SHARES).toBe(1_000_000n);
  });

  it("VIRTUAL_ASSETS === 1n (research § Topic 4)", () => {
    expect(VIRTUAL_ASSETS).toBe(1n);
  });
});

describe("signing/morpho-shares-math::toAssetsDown — regression anchor", () => {
  // shares = 1e9, totalAssets = 1e12, totalShares = 1e9.
  // assets = (1e9 * (1e12 + 1)) / (1e9 + 1e6) = 999000999001n (floor).
  it("toAssetsDown(1e9, 1e12, 1e9) === 999000999001n (pinned literal)", () => {
    expect(toAssetsDown(1_000_000_000n, 1_000_000_000_000n, 1_000_000_000n)).toBe(
      999_000_999_001n,
    );
  });
});

describe("signing/morpho-shares-math::toAssetsUp — regression anchor + rounding direction", () => {
  // Same inputs as Down — Up uses `+ denom - 1` ceiling-division idiom.
  // result = 999000999002n. Off by 1 from Down (the only valid spread for
  // bigint floor/ceil on the same operands).
  it("toAssetsUp(1e9, 1e12, 1e9) === 999000999002n (pinned literal)", () => {
    expect(toAssetsUp(1_000_000_000n, 1_000_000_000_000n, 1_000_000_000n)).toBe(
      999_000_999_002n,
    );
  });

  it("toAssetsUp >= toAssetsDown for the same operands (Up rounds toward +infinity)", () => {
    const down = toAssetsDown(1_000_000_000n, 1_000_000_000_000n, 1_000_000_000n);
    const up = toAssetsUp(1_000_000_000n, 1_000_000_000_000n, 1_000_000_000n);
    expect(up).toBeGreaterThanOrEqual(down);
    // The spread is at most 1n — bigint ceiling-vs-floor of the same exact
    // rational is either equal (when the division is exact) or differs by 1.
    expect(up - down).toBeLessThanOrEqual(1n);
  });
});

describe("signing/morpho-shares-math::toSharesDown — regression anchor (inverse direction)", () => {
  // assets = 1e9, totalAssets = 1e12, totalShares = 1e9.
  // shares = (1e9 * (1e9 + 1e6)) / (1e12 + 1) = 1000999n (floor).
  it("toSharesDown(1e9, 1e12, 1e9) === 1000999n (pinned literal)", () => {
    expect(toSharesDown(1_000_000_000n, 1_000_000_000_000n, 1_000_000_000n)).toBe(
      1_000_999n,
    );
  });
});

describe("signing/morpho-shares-math::toSharesUp — regression anchor + rounding direction", () => {
  it("toSharesUp(1e9, 1e12, 1e9) === 1001000n (pinned literal)", () => {
    expect(toSharesUp(1_000_000_000n, 1_000_000_000_000n, 1_000_000_000n)).toBe(
      1_001_000n,
    );
  });

  it("toSharesUp >= toSharesDown for the same operands", () => {
    const down = toSharesDown(1_000_000_000n, 1_000_000_000_000n, 1_000_000_000n);
    const up = toSharesUp(1_000_000_000n, 1_000_000_000_000n, 1_000_000_000n);
    expect(up).toBeGreaterThanOrEqual(down);
    expect(up - down).toBeLessThanOrEqual(1n);
  });
});

describe("signing/morpho-shares-math — zero-shares edge case", () => {
  it("toAssetsDown(0n, 1e12, 1e9) === 0n (zero shares → zero assets)", () => {
    expect(toAssetsDown(0n, 1_000_000_000_000n, 1_000_000_000n)).toBe(0n);
  });

  it("toAssetsUp(0n, 1e12, 1e9) === 0n (numerator (denom - 1) divides cleanly)", () => {
    // numerator = 0 * (1e12 + 1) + (1e9 + 1e6) - 1 = 1001000000 - 1 = 1000999999
    // denom     = 1e9 + 1e6 = 1001000000
    // 1000999999 / 1001000000 = 0 (bigint floor)
    expect(toAssetsUp(0n, 1_000_000_000_000n, 1_000_000_000n)).toBe(0n);
  });
});

describe("signing/morpho-shares-math — empty-market anti-inflation guard (T-VIRTUAL-INFLATION-1)", () => {
  // On an empty market (totalAssets = 0n, totalShares = 0n), the SharesMathLib
  // virtual offsets prevent the inflation attack — a first depositor of 1e6
  // shares does NOT see 1 share = N assets. Result rate stays near 1e6 shares
  // per asset (the inverse of VIRTUAL_SHARES).
  it("toAssetsDown(1e6, 0n, 0n) === 1n (1e6 shares on empty market = 1 asset)", () => {
    // (1e6 * (0 + 1)) / (0 + 1e6) = 1e6 / 1e6 = 1n
    expect(toAssetsDown(1_000_000n, 0n, 0n)).toBe(1n);
  });

  it("toAssetsUp(1e6, 0n, 0n) === 1n (same — division is exact)", () => {
    expect(toAssetsUp(1_000_000n, 0n, 0n)).toBe(1n);
  });

  it("toSharesDown(1n, 0n, 0n) === 1_000_000n (1 asset = 1e6 shares on empty market)", () => {
    // (1 * (0 + 1e6)) / (0 + 1) = 1e6 / 1 = 1_000_000n
    expect(toSharesDown(1n, 0n, 0n)).toBe(1_000_000n);
  });
});
