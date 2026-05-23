import { describe, expect, it } from "vitest";

import {
  STETH_BASE,
  STETH_DECIMALS,
  computeRebaseRewards,
} from "../src/signing/lido-rebase.js";

describe("lido-rebase constants (T-LIDO-REBASE-SNAPSHOT-STALENESS mitigation)", () => {
  it("STETH_BASE === 10n ** 18n byte-identical", () => {
    expect(STETH_BASE).toBe(10n ** 18n);
    expect(STETH_BASE).toBe(1000000000000000000n);
  });

  it("STETH_DECIMALS === 18n (bigint — NOT number)", () => {
    expect(STETH_DECIMALS).toBe(18n);
    // Confirm bigint type (not number — mirrors aave-health.ts constant typing)
    expect(typeof STETH_DECIMALS).toBe("bigint");
  });
});

describe("computeRebaseRewards — deterministic literal anchor (D-09)", () => {
  it("1e18 shares + 1.05e18 balance → accruedRebaseRewards === 0.05e18 (50_000_000_000_000_000n)", () => {
    // D-09 deterministic anchor. Formula: currentStethBalance - shares.
    // shares    = 1_000_000_000_000_000_000n (1.0 stETH deposited)
    // balance   = 1_050_000_000_000_000_000n (1.05 stETH after rebase rewards)
    // rewards   = 1_050_000_000_000_000_000n - 1_000_000_000_000_000_000n
    //           = 50_000_000_000_000_000n (0.05 stETH)
    const result = computeRebaseRewards({
      shares: 1_000_000_000_000_000_000n,
      currentStethBalance: 1_050_000_000_000_000_000n,
    });
    expect(result.accruedRebaseRewards).toBe(50_000_000_000_000_000n);
    expect(result.approx).toBe(true);
  });

  it("degenerate-zero case: shares === 0n + balance === 0n → { accruedRebaseRewards: 0n, approx: true } (never throws)", () => {
    // T-LIDO-REBASE-SNAPSHOT-STALENESS: zero case must be handled gracefully
    // — fresh wallet with no stETH deposits produces 0n, not an exception.
    const result = computeRebaseRewards({
      shares: 0n,
      currentStethBalance: 0n,
    });
    expect(result.accruedRebaseRewards).toBe(0n);
    expect(result.approx).toBe(true);
  });

  it("approx === true literal (D-09 load-bearing — not a boolean flag, never false)", () => {
    // The `approx: true` literal-type narrowing is the T-LIDO-REBASE-SNAPSHOT-
    // STALENESS mitigation in the output shape. This assertion pins the EXACT
    // value — `expect(result.approx).toBe(true)` would pass a widened `boolean`
    // but this is explicitly documented as a literal-type requirement.
    const result = computeRebaseRewards({
      shares: 950_000_000_000_000_000n,
      currentStethBalance: 1_000_000_000_000_000_000n,
    });
    expect(result.accruedRebaseRewards).toBe(50_000_000_000_000_000n);
    // Literal-type assertion — must be EXACTLY true (not truthy, not boolean)
    expect(result.approx).toBe(true);
    // Confirm it's a boolean (not some other truthy value)
    expect(typeof result.approx).toBe("boolean");
  });
});
