// test/signing-kamino-health.test.ts — Phase 13 Plan 13-04 Task 1 (D-07).
//
// Pure-bigint Kamino per-reserve-LTV health math. Sibling of
// test/signing-marginfi-health.test.ts — pinned scale constant + a
// deterministic input → expected-output anchor (NO beforeAll-snapshot; drift in
// the math MUST fail at a specific line, not pass against a self-snapshot).
//
// Threat anchors:
//   - T-13-10 (Tampering): bps scale-constant drift mis-bands risk → KAMINO_BPS
//     pinned as a hardcoded literal below.
//   - T-13-09 (Information disclosure): a stale oracle invalidates a "safe"
//     claim → `oracleStale` surfaced verbatim.

import { describe, expect, it } from "vitest";

import {
  KAMINO_BPS,
  KAMINO_HF_SCALE,
  classifyKaminoRisk,
  computeKaminoHealth,
  type KaminoHealthInput,
} from "../src/signing/kamino-health.js";

describe("Kamino health — bps scale constant (Pitfall 4 / T-13-10)", () => {
  it("KAMINO_BPS is pinned to 10_000 (Solend-lineage percent-of-bps scale)", () => {
    // A wrong scale silently mis-displays liquidation risk — pinned literal.
    expect(KAMINO_BPS).toBe(10_000n);
  });

  it("KAMINO_HF_SCALE is pinned to 1e18 (cross-protocol display consistency with Aave/MarginFi)", () => {
    expect(KAMINO_HF_SCALE).toBe(10n ** 18n);
  });
});

describe("computeKaminoHealth — deterministic anchor (D-07)", () => {
  // Two collateral reserves + one borrow, fixed values. Per-reserve LTV /
  // liquidation-threshold in bps (loanToValue 75% = 7500bps; liqThreshold
  // 80% = 8000bps; second reserve 50%/60%).
  const input: KaminoHealthInput = {
    deposits: [
      {
        reserve: "ReserveA1111111111111111111111111111111111",
        depositValue: 1_000_000n, // priced deposit value (scope-priced units)
        loanToValueBps: 7_500n,
        liquidationThresholdBps: 8_000n,
      },
      {
        reserve: "ReserveB2222222222222222222222222222222222",
        depositValue: 500_000n,
        loanToValueBps: 5_000n,
        liquidationThresholdBps: 6_000n,
      },
    ],
    borrows: [
      {
        reserve: "ReserveC3333333333333333333333333333333333",
        borrowedValue: 400_000n,
      },
    ],
    elevationGroup: 0,
    oracleStale: false,
  };

  it("borrowPower / liquidationLine / borrowedValue are computed per-reserve (bigint, no float)", () => {
    const out = computeKaminoHealth(input);
    // borrowPower = Σ depositValue_i × ltvBps_i / 10000
    //   = 1_000_000×7500/10000 + 500_000×5000/10000 = 750_000 + 250_000 = 1_000_000
    expect(out.borrowPowerScaled).toBe(1_000_000n);
    // liquidationLine = Σ depositValue_i × liqThresholdBps_i / 10000
    //   = 1_000_000×8000/10000 + 500_000×6000/10000 = 800_000 + 300_000 = 1_100_000
    expect(out.liquidationLineScaled).toBe(1_100_000n);
    expect(out.borrowedValueScaled).toBe(400_000n);
  });

  it("healthFactorScaled = liquidationLine / borrowed, rescaled to 1e18 (HARDCODED anchor)", () => {
    const out = computeKaminoHealth(input);
    // hf = liquidationLine / borrowed = 1_100_000 / 400_000 = 2.75 → 2.75e18
    expect(out.healthFactorScaled).toBe(2_750_000_000_000_000_000n);
    expect(out.noDebt).toBe(false);
    expect(out.elevationGroup).toBe(0);
    expect(out.oracleStale).toBe(false);
  });

  it("noDebt arm: zero borrowed → healthFactorScaled null + noDebt true (mirror aave null-not-MAX)", () => {
    const out = computeKaminoHealth({ ...input, borrows: [] });
    expect(out.healthFactorScaled).toBeNull();
    expect(out.noDebt).toBe(true);
    expect(out.borrowedValueScaled).toBe(0n);
  });

  it("debt with zero deposits → healthFactorScaled 0n (NOT null — there IS debt)", () => {
    const out = computeKaminoHealth({
      deposits: [],
      borrows: [{ reserve: "ReserveC3333333333333333333333333333333333", borrowedValue: 100n }],
      elevationGroup: 0,
      oracleStale: false,
    });
    expect(out.healthFactorScaled).toBe(0n);
    expect(out.noDebt).toBe(false);
  });

  it("elevationGroup id surfaced verbatim (A5 — no group-LTV substitution)", () => {
    const out = computeKaminoHealth({ ...input, elevationGroup: 3 });
    expect(out.elevationGroup).toBe(3);
  });

  it("oracleStale propagates verbatim (T-13-09 — surface, do not throw)", () => {
    const out = computeKaminoHealth({ ...input, oracleStale: true });
    expect(out.oracleStale).toBe(true);
    // staleness does not zero the math — the figure is still computed + flagged.
    expect(out.healthFactorScaled).toBe(2_750_000_000_000_000_000n);
  });
});

describe("classifyKaminoRisk — bands at fixed thresholds", () => {
  it("hf ≥ 1.50e18 → safe", () => {
    expect(classifyKaminoRisk(15n * 10n ** 17n, false)).toBe("safe");
    expect(classifyKaminoRisk(2n * 10n ** 18n, false)).toBe("safe");
  });
  it("1.10e18 ≤ hf < 1.50e18 → warning", () => {
    expect(classifyKaminoRisk(11n * 10n ** 17n, false)).toBe("warning");
    expect(classifyKaminoRisk(149n * 10n ** 16n, false)).toBe("warning");
  });
  it("hf < 1.10e18 → danger", () => {
    expect(classifyKaminoRisk(109n * 10n ** 16n, false)).toBe("danger");
    expect(classifyKaminoRisk(0n, false)).toBe("danger");
  });
  it("noDebt → noDebt", () => {
    expect(classifyKaminoRisk(null, true)).toBe("noDebt");
  });
});
