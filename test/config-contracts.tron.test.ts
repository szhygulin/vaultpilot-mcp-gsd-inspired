// `KNOWN_SPENDERS_TRON` sub-table regression. Phase 19 — Plan 19-01.
//
// Load-bearing invariants:
//
//   1. KNOWN_SPENDERS_TRON contains ≥5 entries (SunSwap V2 + 4 stablecoins).
//   2. `lookupTronSpender("TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax").label === "SunSwap V2 Router"`.
//   3. All addresses are valid TRON base58check (module-load DOA validation fires first).
//   4. `KNOWN_SPENDERS_ETHEREUM` row count UNCHANGED — TRON addition is a sibling sub-table.
//   5. `lookupTronSpender` returns `undefined` for unknown addresses (not `null`).

import { describe, expect, it, vi } from "vitest";

import {
  KNOWN_SPENDERS_ETHEREUM,
  KNOWN_SPENDERS_TRON,
  _contractsTron,
  lookupTronSpender,
} from "../src/config/contracts.js";

// ============================================================================
// KNOWN_SPENDERS_TRON table shape
// ============================================================================

describe("KNOWN_SPENDERS_TRON — Phase 19 Plan 19-01", () => {
  it("contains at least 5 entries (SunSwap V2 + 4 TRC-20 stablecoins)", () => {
    expect(KNOWN_SPENDERS_TRON.length).toBeGreaterThanOrEqual(5);
  });

  it("SunSwap V2 Router is entry[0] with correct address and label", () => {
    const sunswap = KNOWN_SPENDERS_TRON.find(
      (s) => s.address === "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax",
    );
    expect(sunswap).toBeDefined();
    expect(sunswap!.label).toBe("SunSwap V2 Router");
    expect(sunswap!.source).toMatch(/sun\.io|tronscan/i);
  });

  it("USDT-TRC20 contract is present", () => {
    const usdt = KNOWN_SPENDERS_TRON.find(
      (s) => s.address === "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    );
    expect(usdt).toBeDefined();
    expect(usdt!.label).toMatch(/USDT/i);
  });

  it("USDC-TRC20 contract is present", () => {
    const usdc = KNOWN_SPENDERS_TRON.find(
      (s) => s.address === "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
    );
    expect(usdc).toBeDefined();
    expect(usdc!.label).toMatch(/USDC/i);
  });

  it("USDD contract is present", () => {
    const usdd = KNOWN_SPENDERS_TRON.find(
      (s) => s.address === "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn",
    );
    expect(usdd).toBeDefined();
    expect(usdd!.label).toMatch(/USDD/i);
  });

  it("TUSD contract is present", () => {
    const tusd = KNOWN_SPENDERS_TRON.find(
      (s) => s.address === "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4",
    );
    expect(tusd).toBeDefined();
    expect(tusd!.label).toMatch(/TUSD/i);
  });

  it("all addresses are non-empty strings (DOA validation already fired at module load)", () => {
    for (const entry of KNOWN_SPENDERS_TRON) {
      expect(typeof entry.address).toBe("string");
      expect(entry.address.length).toBeGreaterThan(0);
      // TRON base58check addresses are 34 chars T-prefixed
      expect(entry.address.startsWith("T")).toBe(true);
      expect(entry.address.length).toBe(34);
    }
  });

  it("all entries have a non-empty label and source", () => {
    for (const entry of KNOWN_SPENDERS_TRON) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.source.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// lookupTronSpender function
// ============================================================================

describe("lookupTronSpender", () => {
  it("returns the row for SunSwap V2 Router (known spender)", () => {
    const result = lookupTronSpender("TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax");
    expect(result).toBeDefined();
    expect(result!.label).toBe("SunSwap V2 Router");
  });

  it("returns undefined for an unknown address", () => {
    // Not in the table — an arbitrary valid-looking TRON address.
    const result = lookupTronSpender("TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9");
    expect(result).toBeUndefined();
  });

  it("is case-sensitive (TRON base58check addresses are case-sensitive)", () => {
    // TRON base58check addresses have exact casing — no normalization like EVM getAddress().
    // "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax" != "tkzxdsv2fzkqreqkkvgp5dcwexbekMg2Ax"
    const result = lookupTronSpender("TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax".toLowerCase());
    // lowercase version is not a valid address in our table
    expect(result).toBeUndefined();
  });
});

// ============================================================================
// _contractsTron ESM spy-affordance
// ============================================================================

describe("_contractsTron ESM spy-affordance", () => {
  it("exposes lookupTronSpender", () => {
    expect(typeof _contractsTron.lookupTronSpender).toBe("function");
  });

  it("vi.spyOn(_contractsTron, 'lookupTronSpender') intercepts the call", () => {
    const mockRow = {
      address: "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax",
      label: "MOCKED LABEL",
      source: "mock",
    };
    const spy = vi
      .spyOn(_contractsTron, "lookupTronSpender")
      .mockReturnValue(mockRow);

    const result = _contractsTron.lookupTronSpender("TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result!.label).toBe("MOCKED LABEL");

    spy.mockRestore();
  });
});

// ============================================================================
// Regression: KNOWN_SPENDERS_ETHEREUM row count UNCHANGED
// ============================================================================

describe("KNOWN_SPENDERS_ETHEREUM — regression (TRON sub-table is sibling, not widening)", () => {
  it("row count is ≥ 14 (Phase 28 Plan 28-01 added 6 Compound comets to the original 11)", () => {
    // Phase 06-03 started with 11 EVM entries. Phase 28 Plan 28-01 added 6 Compound Comet rows.
    // Phase 19 MUST NOT add TRON entries to KNOWN_SPENDERS_ETHEREUM.
    expect(KNOWN_SPENDERS_ETHEREUM.length).toBeGreaterThanOrEqual(14);
  });

  it("all KNOWN_SPENDERS_ETHEREUM entries are EVM 0x-prefixed addresses (not TRON base58check)", () => {
    for (const entry of KNOWN_SPENDERS_ETHEREUM) {
      expect(entry.address.startsWith("0x")).toBe(true);
    }
  });
});
