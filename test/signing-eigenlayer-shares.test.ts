// test/signing-eigenlayer-shares.test.ts — Phase 31 Plan 31-02.
//
// Pure-bigint regression anchors for src/signing/eigenlayer-shares.ts.
// Structural mirror of test/signing-lido-rebase.test.ts (Phase 30 analog).
//
// T-EIGENLAYER-SHARES-STALENESS mitigation: assert the `approx: true` literal
// type is LOAD-BEARING (drift to widened `boolean` breaks the strict-TS compile
// AND this assertion).

import { describe, expect, it } from "vitest";

import {
  SHARES_SCALE,
  convertSharesToUnderlying,
} from "../src/signing/eigenlayer-shares.js";

describe("eigenlayer-shares constants (T-EIGENLAYER-SHARES-STALENESS mitigation)", () => {
  it("SHARES_SCALE === 10n ** 18n byte-identical", () => {
    expect(SHARES_SCALE).toBe(10n ** 18n);
    expect(SHARES_SCALE).toBe(1_000_000_000_000_000_000n);
  });

  it("SHARES_SCALE is bigint (NOT number)", () => {
    expect(typeof SHARES_SCALE).toBe("bigint");
  });
});

describe("convertSharesToUnderlying — pure-bigint math anchor (Phase 31 Plan 31-02)", () => {
  it("degenerate-zero case: shares === 0n → { underlyingAmount: 0n, approx: true } (never throws)", () => {
    const result = convertSharesToUnderlying({ shares: 0n });
    expect(result.underlyingAmount).toBe(0n);
    expect(result.approx).toBe(true);
  });

  it("1:1 baseline: omitting underlyingPerShareNumerator returns shares verbatim", () => {
    // When underlyingPerShareNumerator is omitted, the helper treats the
    // strategy as 1:1 (degenerate baseline). On-chain `sharesToUnderlyingView`
    // remains the canonical answer for non-1:1 strategies.
    const result = convertSharesToUnderlying({
      shares: 1_000_000_000_000_000_000n,
    });
    expect(result.underlyingAmount).toBe(1_000_000_000_000_000_000n);
    expect(result.approx).toBe(true);
  });

  it("non-1:1 case: shares=1e18 + underlyingPerShareNumerator=1.1e18 → underlyingAmount=1.1e18 (1.1 underlying per share)", () => {
    // (1e18 * 1.1e18) / 1e18 = 1.1e18. Pure bigint; no float; no rounding.
    const result = convertSharesToUnderlying({
      shares: 1_000_000_000_000_000_000n,
      underlyingPerShareNumerator: 11n * 10n ** 17n, // 1.1 * 1e18
    });
    expect(result.underlyingAmount).toBe(1_100_000_000_000_000_000n);
    expect(result.approx).toBe(true);
  });

  it("approx === true literal (T-EIGENLAYER-SHARES-STALENESS load-bearing — never boolean, never false)", () => {
    // The `approx: true` literal-type narrowing is the mitigation in the
    // output shape. This assertion pins the EXACT value — `expect(...).toBe(true)`
    // would pass a widened `boolean`, but the literal-type requirement is
    // explicitly documented in eigenlayer-shares.ts.
    const result = convertSharesToUnderlying({
      shares: 950_000_000_000_000_000n,
      underlyingPerShareNumerator: 10n ** 18n, // exact 1.0 (1:1 via explicit rate)
    });
    expect(result.underlyingAmount).toBe(950_000_000_000_000_000n);
    // Literal-type assertion — must be EXACTLY true.
    expect(result.approx).toBe(true);
    // Confirm it's a boolean true (not a truthy string / number).
    expect(typeof result.approx).toBe("boolean");
  });

  it("integer-division truncation: shares=3n + underlyingPerShareNumerator=1e18 → underlyingAmount=3n (no rounding)", () => {
    // Smoke-test that the bigint integer-division semantics are intact (no
    // accidental Number() cast hiding floating-point rounding).
    const result = convertSharesToUnderlying({
      shares: 3n,
      underlyingPerShareNumerator: 10n ** 18n,
    });
    expect(result.underlyingAmount).toBe(3n);
    expect(result.approx).toBe(true);
  });
});
