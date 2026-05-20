// test/canonical-dispatch-tron.test.ts — Phase 18 Plan 18-01.
// Mirrors the shape of `test/canonical-dispatch-solana.test.ts`.
//
// Coverage:
//   1. Allowlist contents — 4 entries: USDT, USDC, USDD, TUSD base58check addresses.
//   2. checkTronDispatchTarget — allowed path (single allowlist hit).
//   3. checkTronDispatchTarget — refused path (non-allowlist contract).
//   4. checkTronDispatchTarget — empty array path (allowed by construction).
//   5. Mixed path — one allowed + one refused → refused (no rescue).
//   6. _canonicalDispatchTron spy-intercept regression.

import { describe, expect, it, vi } from "vitest";

import {
  TRON_TRC20_DISPATCH_ALLOWLIST,
  _canonicalDispatchTron,
  checkTronDispatchTarget,
} from "../src/security/canonical-dispatch-tron.js";

// Phase 18 scope — 4 TRC-20 stablecoin contract addresses per CONTEXT D-11a.
// These are the values filtered from `src/tokens/tron-top-25.json` by symbol.
// Note: USDD address is "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn" (18 decimals,
// from the JSON SOT) — NOT "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR" (which is WTRX
// in the JSON). This test anchors the correct USDD address per the SOT.
const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDC_TRC20 = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const USDD = "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn";
const TUSD = "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4";

// A known non-allowlisted TRC-20 contract (SunSwap — out of Phase 18 scope).
const NON_ALLOWLISTED = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";

describe("TRON_TRC20_DISPATCH_ALLOWLIST", () => {
  it("contains exactly 4 entries (Phase 18 v1.x scope)", () => {
    expect(TRON_TRC20_DISPATCH_ALLOWLIST.size).toBe(4);
  });

  it("contains USDT-TRC20 (TR7N...j6t)", () => {
    expect(TRON_TRC20_DISPATCH_ALLOWLIST.has(USDT_TRC20)).toBe(true);
  });

  it("contains USDC-TRC20 (TEkx...8)", () => {
    expect(TRON_TRC20_DISPATCH_ALLOWLIST.has(USDC_TRC20)).toBe(true);
  });

  it("contains USDD (TPYm...Dn) — sourced from JSON SOT, NOT the WTRX address TNUC...", () => {
    // CRITICAL: USDD in tron-top-25.json has address "TPYm..." (18 decimals).
    // The plan had a wrong address for USDD ("TNUC..." = WTRX). JSON SOT takes
    // precedence per the plan's own instruction. This test anchors the correct value.
    expect(TRON_TRC20_DISPATCH_ALLOWLIST.has(USDD)).toBe(true);
    // The WTRX address should NOT be in the allowlist.
    expect(
      TRON_TRC20_DISPATCH_ALLOWLIST.has("TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR"),
    ).toBe(false);
  });

  it("contains TUSD (TUpM...F4)", () => {
    expect(TRON_TRC20_DISPATCH_ALLOWLIST.has(TUSD)).toBe(true);
  });

  it("is a ReadonlySet (no `.add` method)", () => {
    // TypeScript typing ensures this at compile time; at runtime a
    // ReadonlySet is still a Set, but the interface doesn't expose add.
    // This test confirms the exported type is indeed a Set<string>.
    expect(TRON_TRC20_DISPATCH_ALLOWLIST).toBeInstanceOf(Set);
  });
});

describe("checkTronDispatchTarget — allowed paths", () => {
  it("USDT address → allowed", () => {
    const result = checkTronDispatchTarget([USDT_TRC20]);
    expect(result.kind).toBe("allowed");
  });

  it("USDC address → allowed", () => {
    const result = checkTronDispatchTarget([USDC_TRC20]);
    expect(result.kind).toBe("allowed");
  });

  it("USDD address → allowed", () => {
    const result = checkTronDispatchTarget([USDD]);
    expect(result.kind).toBe("allowed");
  });

  it("TUSD address → allowed", () => {
    const result = checkTronDispatchTarget([TUSD]);
    expect(result.kind).toBe("allowed");
  });

  it("all 4 allowlisted addresses → allowed", () => {
    const result = checkTronDispatchTarget([USDT_TRC20, USDC_TRC20, USDD, TUSD]);
    expect(result.kind).toBe("allowed");
  });

  it("empty array → allowed (no offenders by construction)", () => {
    const result = checkTronDispatchTarget([]);
    expect(result.kind).toBe("allowed");
  });
});

describe("checkTronDispatchTarget — refused paths", () => {
  it("non-allowlisted contract → refused with offenders list", () => {
    const result = checkTronDispatchTarget([NON_ALLOWLISTED]);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.offenders).toContain(NON_ALLOWLISTED);
      expect(result.offenders).toHaveLength(1);
      expect(result.allowlist).toHaveLength(4);
    }
  });

  it("refused envelope carries full allowlist verbatim", () => {
    const result = checkTronDispatchTarget([NON_ALLOWLISTED]);
    if (result.kind === "refused") {
      expect(result.allowlist).toContain(USDT_TRC20);
      expect(result.allowlist).toContain(USDC_TRC20);
      expect(result.allowlist).toContain(USDD);
      expect(result.allowlist).toContain(TUSD);
    }
  });

  it("mixed (one allowed + one refused) → refused (allowed entries do NOT rescue)", () => {
    const result = checkTronDispatchTarget([USDT_TRC20, NON_ALLOWLISTED]);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.offenders).toContain(NON_ALLOWLISTED);
      expect(result.offenders).not.toContain(USDT_TRC20);
    }
  });

  it("two non-allowlisted → both in offenders list", () => {
    const fakeAddr2 = "TLyqzVGLV6srDMvCnSf5DLD6qMz3qAh1Vp";
    const result = checkTronDispatchTarget([NON_ALLOWLISTED, fakeAddr2]);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.offenders).toHaveLength(2);
    }
  });
});

describe("_canonicalDispatchTron ESM spy-affordance regression", () => {
  it("vi.spyOn(_canonicalDispatchTron, 'checkTronDispatchTarget') intercepts the call", () => {
    const spy = vi
      .spyOn(_canonicalDispatchTron, "checkTronDispatchTarget")
      .mockReturnValueOnce({ kind: "allowed" });

    // Even a non-allowlisted address returns "allowed" when the spy intercepts.
    const result = _canonicalDispatchTron.checkTronDispatchTarget([NON_ALLOWLISTED]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith([NON_ALLOWLISTED]);
    expect(result.kind).toBe("allowed");

    spy.mockRestore();
  });

  it("after spy.mockRestore() the real implementation is back", () => {
    const spy = vi
      .spyOn(_canonicalDispatchTron, "checkTronDispatchTarget")
      .mockReturnValueOnce({ kind: "allowed" });
    spy.mockRestore();

    // Real implementation should refuse the non-allowlisted address.
    const result = _canonicalDispatchTron.checkTronDispatchTarget([NON_ALLOWLISTED]);
    expect(result.kind).toBe("refused");
  });
});
