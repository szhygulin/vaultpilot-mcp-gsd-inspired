// src/signing/marginfi-health.ts — pure-bigint risk-weighted health (D-07).
// Phase 13 — Plan 13-02 Task 1. Sibling of test/signing-aave-health.test.ts.
//
// MarginFi health math (13-RESEARCH § Health Math):
//   assets       = Σ (bankAssetQuantity_i × oraclePrice_i × assetWeightMaint_i)
//   liabilities  = Σ (bankLiabQuantity_j × oraclePrice_j × liabilityWeightMaint_j)
//   Solvent at maintenance when assets ≥ liabilities.
//   health-factor-equivalent (SOL-W-03 display) = assets / liabilities.
//   Isolated-tier assets contribute 0 to assets (riskTier branch).
//
// Fixed-point: weights + oracle prices are WrappedI80F48 (signed 80.48,
// 2^48 fractional). The module replicates the I80F48 scale deterministically;
// the scale constant is PINNED here as a hardcoded literal (Pitfall 4 — a wrong
// scale silently mis-displays liquidation risk, a trust surface). NO
// beforeAll-snapshot — drift in the preimage assembly MUST fail at a specific
// line, not pass against a self-snapshotted value (CLAUDE.md fixture discipline
// applied to health anchors).

import { describe, expect, it } from "vitest";

import {
  I80F48_SCALE,
  MARGINFI_HF_SCALE,
  computeMarginfiHealth,
  classifyMarginfiRisk,
  type MarginfiHealthInput,
} from "../src/signing/marginfi-health.js";

// Pinned scale constant (Pitfall 4) — 2^48 = 281474976710656. A drift in this
// literal would silently mis-band every MarginFi liquidation-risk surface.
describe("marginfi-health — pinned fixed-point scale (Pitfall 4)", () => {
  it("I80F48_SCALE === 2^48 (281474976710656)", () => {
    expect(I80F48_SCALE).toBe(281474976710656n);
    expect(I80F48_SCALE).toBe(1n << 48n);
  });

  it("MARGINFI_HF_SCALE === 1e18 (cross-protocol display consistency with aave-health)", () => {
    expect(MARGINFI_HF_SCALE).toBe(10n ** 18n);
  });
});

// Deterministic input → expected-output anchor. Independently computed at
// PR-write time via a discardable `node -e` script (see commit message);
// pinned here as hardcoded bigint literals.
//
//   Collateral A (Collateral tier): qty=1000, price=1.00, weightMaint=0.90
//   Collateral B (Isolated tier):   qty=500,  price=2.00, weightMaint=0.50  → contributes 0
//   Liability C:                     qty=400,  price=1.00, weightMaint=1.10
//
//   assetsScaled       = 1000 × (1.00·2^48) × (0.90·2^48)          (scale 2^96)
//   liabilitiesScaled  = 400  × (1.00·2^48) × (1.10·2^48)          (scale 2^96)
//   healthRatioScaled  = assetsScaled × 1e18 / liabilitiesScaled   ≈ 2.0454…e18
const PRICE_1_00 = (I80F48_SCALE * 100n) / 100n;
const PRICE_2_00 = (I80F48_SCALE * 200n) / 100n;
const W_0_90 = (I80F48_SCALE * 90n) / 100n;
const W_0_50 = (I80F48_SCALE * 50n) / 100n;
const W_1_10 = (I80F48_SCALE * 110n) / 100n;

const ANCHOR_INPUT: MarginfiHealthInput = {
  assets: [
    {
      bank: "BankA1111111111111111111111111111111111111",
      quantity: 1000n,
      oraclePrice: PRICE_1_00,
      assetWeightMaint: W_0_90,
      riskTier: "Collateral",
      oracleStale: false,
    },
    {
      bank: "BankB2222222222222222222222222222222222222",
      quantity: 500n,
      oraclePrice: PRICE_2_00,
      assetWeightMaint: W_0_50,
      riskTier: "Isolated",
      oracleStale: false,
    },
  ],
  liabilities: [
    {
      bank: "BankC3333333333333333333333333333333333333",
      quantity: 400n,
      oraclePrice: PRICE_1_00,
      liabilityWeightMaint: W_1_10,
      oracleStale: false,
    },
  ],
};

describe("computeMarginfiHealth — deterministic anchor (D-07)", () => {
  it("assetsScaled hardcoded literal (Isolated-tier B contributes 0)", () => {
    const out = computeMarginfiHealth(ANCHOR_INPUT);
    expect(out.assetsScaled).toBe(71305346262837791244198871040000n);
  });

  it("liabilitiesScaled hardcoded literal", () => {
    const out = computeMarginfiHealth(ANCHOR_INPUT);
    expect(out.liabilitiesScaled).toBe(34860391506276240987164927590400n);
  });

  it("healthRatioScaled hardcoded literal (≈ 2.0454e18)", () => {
    const out = computeMarginfiHealth(ANCHOR_INPUT);
    expect(out.healthRatioScaled).toBe(2045454545454546188n);
    expect(out.noDebt).toBe(false);
  });

  it("Isolated-tier asset contributes 0 to assets (riskTier branch)", () => {
    // Drop the Collateral A position — only Isolated B remains → assets = 0.
    const isolatedOnly: MarginfiHealthInput = {
      assets: [ANCHOR_INPUT.assets[1]!],
      liabilities: ANCHOR_INPUT.liabilities,
    };
    const out = computeMarginfiHealth(isolatedOnly);
    expect(out.assetsScaled).toBe(0n);
    // assets 0 with positive liabilities → healthRatio 0, NOT noDebt.
    expect(out.noDebt).toBe(false);
    expect(out.healthRatioScaled).toBe(0n);
  });

  it("noDebt arm: zero liabilities → healthRatioScaled null + noDebt true (aave-health null lock)", () => {
    const noDebtInput: MarginfiHealthInput = {
      assets: ANCHOR_INPUT.assets,
      liabilities: [],
    };
    const out = computeMarginfiHealth(noDebtInput);
    expect(out.noDebt).toBe(true);
    expect(out.healthRatioScaled).toBeNull();
    // assets still accumulate (Collateral A only; Isolated B = 0).
    expect(out.assetsScaled).toBe(71305346262837791244198871040000n);
    expect(out.liabilitiesScaled).toBe(0n);
  });

  it("oracleStale surfaces verbatim when ANY position carries a stale oracle", () => {
    const staleInput: MarginfiHealthInput = {
      assets: [{ ...ANCHOR_INPUT.assets[0]!, oracleStale: true }],
      liabilities: ANCHOR_INPUT.liabilities,
    };
    const out = computeMarginfiHealth(staleInput);
    expect(out.oracleStale).toBe(true);
  });

  it("oracleStale false when no position carries a stale oracle", () => {
    const out = computeMarginfiHealth(ANCHOR_INPUT);
    expect(out.oracleStale).toBe(false);
  });

  it("all outputs are bigint | null — no Number/float leak", () => {
    const out = computeMarginfiHealth(ANCHOR_INPUT);
    expect(typeof out.assetsScaled).toBe("bigint");
    expect(typeof out.liabilitiesScaled).toBe("bigint");
    expect(typeof out.healthRatioScaled).toBe("bigint"); // non-null arm
  });
});

describe("classifyMarginfiRisk — bands (safe/warning/danger/noDebt)", () => {
  // HF_SCALE = 1e18. Thresholds mirror aave-health: safe ≥ 1.50, warning ≥ 1.10,
  // danger < 1.10.
  it("noDebt → noDebt", () => {
    expect(classifyMarginfiRisk(null, true)).toBe("noDebt");
  });

  it("ratio ≥ 1.50e18 → safe", () => {
    expect(classifyMarginfiRisk(15n * 10n ** 17n, false)).toBe("safe");
    expect(classifyMarginfiRisk(2n * 10n ** 18n, false)).toBe("safe");
  });

  it("1.10e18 ≤ ratio < 1.50e18 → warning", () => {
    expect(classifyMarginfiRisk(11n * 10n ** 17n, false)).toBe("warning");
    expect(classifyMarginfiRisk(149n * 10n ** 16n, false)).toBe("warning");
  });

  it("ratio < 1.10e18 → danger", () => {
    expect(classifyMarginfiRisk(109n * 10n ** 16n, false)).toBe("danger");
    expect(classifyMarginfiRisk(0n, false)).toBe("danger");
  });

  it("anchor ratio (≈2.045e18) → safe", () => {
    const out = computeMarginfiHealth(ANCHOR_INPUT);
    expect(classifyMarginfiRisk(out.healthRatioScaled, out.noDebt)).toBe("safe");
  });
});
