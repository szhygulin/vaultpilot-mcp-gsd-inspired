// test/security-canonical-dispatch-tron.test.ts — Phase 20 Plan 20-01.
//
// Tests for the NEW TRON smartcontract dispatch allowlist sibling set added in
// Plan 20-01: `TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST`, `checkTronSmartContractDispatchTarget`,
// and `SUNSWAP_V2_ROUTER_TRON_ADDRESS`.
//
// Open Question #2 design decision = option (a) — sibling set + sibling function.
// Existing `TRON_TRC20_DISPATCH_ALLOWLIST` size === 4 is anchored here as a regression
// (Test 12 — BYTE-IDENTICAL check: existing Phase 18 tests in canonical-dispatch-tron.test.ts
// are BYTE-UNTOUCHED; Phase 20 adds NEW tests in THIS file only).
//
// T-SOT-DRIFT-1 cross-import assertion (Test 12b): `SUNSWAP_V2_ROUTER_TRON_ADDRESS`
// MUST be byte-identical to `KNOWN_SPENDERS_TRON[0].address` (both are the SunSwap V2
// Router). Any drift between the two SOTs would allow a mismatch between the security
// gate (this allowlist) and the user-facing label (contracts.ts).

import { describe, expect, it, vi } from "vitest";

import {
  SUNSWAP_V2_ROUTER_TRON_ADDRESS,
  TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST,
  TRON_TRC20_DISPATCH_ALLOWLIST,
  _canonicalDispatchTron,
  checkTronSmartContractDispatchTarget,
} from "../src/security/canonical-dispatch-tron.js";

import { KNOWN_SPENDERS_TRON } from "../src/config/contracts.js";

const SUNSWAP_V2_ROUTER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";
const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

describe("TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST — Phase 20 sibling set", () => {
  it("Test 11a: contains exactly 1 entry (SunSwap V2 Router)", () => {
    expect(TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST.size).toBe(1);
  });

  it("Test 11b: contains SunSwap V2 Router (TKzx...Ax)", () => {
    expect(TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST.has(SUNSWAP_V2_ROUTER)).toBe(true);
  });

  it("Test 11c: does NOT contain USDT (token, not router)", () => {
    expect(TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST.has(USDT_TRC20)).toBe(false);
  });
});

describe("checkTronSmartContractDispatchTarget — allowed paths", () => {
  it("Test 11d: SunSwap V2 Router → allowed", () => {
    const result = checkTronSmartContractDispatchTarget([SUNSWAP_V2_ROUTER]);
    expect(result.kind).toBe("allowed");
  });

  it("Test 11e: empty array → allowed (no offenders by construction)", () => {
    const result = checkTronSmartContractDispatchTarget([]);
    expect(result.kind).toBe("allowed");
  });
});

describe("checkTronSmartContractDispatchTarget — refused paths", () => {
  it("Test 11f: USDT address (TRC-20 token, NOT router) → refused", () => {
    const result = checkTronSmartContractDispatchTarget([USDT_TRC20]);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.offenders).toContain(USDT_TRC20);
      expect(result.offenders).toHaveLength(1);
      // allowlist should be [SunSwap V2 Router]
      expect(result.allowlist).toHaveLength(1);
      expect(result.allowlist).toContain(SUNSWAP_V2_ROUTER);
    }
  });

  it("Test 11g: unknown contract → refused with offenders list", () => {
    const unknownContract = "TLyqzVGLV6srDMvCnSf5DLD6qMz3qAh1Vp";
    const result = checkTronSmartContractDispatchTarget([unknownContract]);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.offenders).toContain(unknownContract);
      expect(result.allowlist).toContain(SUNSWAP_V2_ROUTER);
    }
  });

  it("Test 11h: mixed (router allowed + USDT refused) → refused (allowed entries do NOT rescue)", () => {
    const result = checkTronSmartContractDispatchTarget([SUNSWAP_V2_ROUTER, USDT_TRC20]);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.offenders).toContain(USDT_TRC20);
      expect(result.offenders).not.toContain(SUNSWAP_V2_ROUTER);
    }
  });
});

describe("Test 12 — Existing TRC-20 allowlist regression (BYTE-IDENTICAL)", () => {
  it("TRON_TRC20_DISPATCH_ALLOWLIST.size is still 4 (unchanged by Phase 20)", () => {
    // This is the load-bearing assertion: Plan 20-01 MUST NOT change the 4-stablecoin
    // allowlist size. The sibling set design (option (a)) keeps this BYTE-IDENTICAL.
    expect(TRON_TRC20_DISPATCH_ALLOWLIST.size).toBe(4);
  });

  it("Test 12b: T-SOT-DRIFT-1 — SUNSWAP_V2_ROUTER_TRON_ADDRESS === KNOWN_SPENDERS_TRON[0].address", () => {
    // Cross-import assertion: the security gate SOT (canonical-dispatch-tron.ts) and the
    // user-facing SOT (contracts.ts KNOWN_SPENDERS_TRON[0]) must be byte-identical.
    // Drift between these two would allow a mismatch at the Layer 0.5 security gate.
    expect(SUNSWAP_V2_ROUTER_TRON_ADDRESS).toBe(KNOWN_SPENDERS_TRON[0].address);
  });
});

describe("Test 13 — _canonicalDispatchTron ESM spy-affordance (widened for Phase 20)", () => {
  it("vi.spyOn(_canonicalDispatchTron, 'checkTronSmartContractDispatchTarget') intercepts the call", () => {
    const spy = vi
      .spyOn(_canonicalDispatchTron, "checkTronSmartContractDispatchTarget")
      .mockReturnValueOnce({ kind: "allowed" });

    // Even a non-allowlisted address returns "allowed" when the spy intercepts.
    const result = _canonicalDispatchTron.checkTronSmartContractDispatchTarget([USDT_TRC20]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith([USDT_TRC20]);
    expect(result.kind).toBe("allowed");

    spy.mockRestore();
  });

  it("after spy.mockRestore() the real implementation is back", () => {
    const spy = vi
      .spyOn(_canonicalDispatchTron, "checkTronSmartContractDispatchTarget")
      .mockReturnValueOnce({ kind: "allowed" });
    spy.mockRestore();

    // Real implementation should refuse USDT (not a router).
    const result = _canonicalDispatchTron.checkTronSmartContractDispatchTarget([USDT_TRC20]);
    expect(result.kind).toBe("refused");
  });

  it("existing checkTronDispatchTarget spy entry still works (Phase 18 ESM spy-affordance regression)", () => {
    // Verify the Phase 18 spy seam is still present and functional after the Phase 20
    // additive widening of _canonicalDispatchTron. BYTE-IDENTICAL check.
    const spy = vi
      .spyOn(_canonicalDispatchTron, "checkTronDispatchTarget")
      .mockReturnValueOnce({ kind: "allowed" });

    const result = _canonicalDispatchTron.checkTronDispatchTarget([USDT_TRC20]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("allowed");

    spy.mockRestore();
  });
});
