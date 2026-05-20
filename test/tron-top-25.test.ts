// test/tron-top-25.test.ts — Phase 17 Plan 17-04 (filled-registry).
//
// Sibling of test/solana-top-50.test.ts. Replaces the 17-01-era
// `tron-top-25-stub.test.ts` once the JSON is filled in this plan.
//
// Coverage:
//   1. Registry has at least the floor of curated entries (curation over padding).
//   2. Required entries present with correct decimals (research Pitfall 5
//      REGRESSION ANCHOR — USDD = 18, USDT/USDC/WTRX = 6).
//   3. Per-entry decimals invariant: integer ≥ 0 ≤ 18 on every row.
//   4. No duplicate contractAddress.
//   5. findByAddress: hit on curated entry; miss on unknown.
//   6. Case-sensitive lookup: TRON base58check is case-sensitive — lowercased
//      version of a T-prefixed address returns undefined.
//   7. Entry shape contract (defense in depth — the loader validates at module
//      load, but re-assert per-entry here so a future schema drift fails loud).

import { describe, expect, it } from "vitest";
import { utils as tronUtils } from "tronweb";

import {
  findByAddress,
  listTronTokens,
} from "../src/tokens/tron-top-25.js";

describe("tron-top-25 curated TRC-20 registry (Phase 17 Plan 17-04)", () => {
  it("Test 1 — ships at least 10 curated entries (curation over padding; DefiLlama-coverage gate)", () => {
    const entries = listTronTokens();
    // Plan target: 20-25. Floor: 10 — curation lock binds harder than count floor
    // (research § Topic 6 — drop any entry without DefiLlama price coverage).
    expect(entries.length).toBeGreaterThanOrEqual(10);
    expect(entries.length).toBeLessThanOrEqual(25);
  });

  it("Test 2a — required entry USDT (TR7N...j6t) present with decimals=6", () => {
    const e = findByAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
    expect(e).toBeDefined();
    expect(e?.symbol).toBe("USDT");
    expect(e?.decimals).toBe(6);
  });

  it("Test 2b — required entry USDC (TEkx...8) present with decimals=6", () => {
    const e = findByAddress("TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8");
    expect(e).toBeDefined();
    expect(e?.symbol).toBe("USDC");
    expect(e?.decimals).toBe(6);
  });

  it("Test 2c — required entry USDD (TPYm...Dn) present with decimals=18 (REGRESSION ANCHOR per research Pitfall 5 — defaulting to 6 silently corrupts balances by 1e12)", () => {
    const e = findByAddress("TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn");
    expect(e).toBeDefined();
    expect(e?.symbol).toBe("USDD");
    // Hard-coded literal — failure here means USDD got the 6-decimal cluster default.
    expect(e?.decimals).toBe(18);
  });

  it("Test 2d — required entry WTRX (TNUC...FR) present with decimals=6 (also serves as NATIVE_PRICING_PROXY.tron)", () => {
    const e = findByAddress("TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR");
    expect(e).toBeDefined();
    expect(e?.symbol).toBe("WTRX");
    expect(e?.decimals).toBe(6);
  });

  it("Test 2e — required entry TUSD-TRC20 (TUpM...F4) present with decimals=18", () => {
    const e = findByAddress("TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4");
    expect(e).toBeDefined();
    expect(e?.symbol).toBe("TUSD");
    expect(e?.decimals).toBe(18);
  });

  it("Test 3 — per-entry decimals invariant: every entry has integer 0 ≤ decimals ≤ 18 (defense-in-depth against accidental defaults)", () => {
    for (const e of listTronTokens()) {
      expect(typeof e.decimals).toBe("number");
      expect(Number.isInteger(e.decimals)).toBe(true);
      expect(e.decimals).toBeGreaterThanOrEqual(0);
      expect(e.decimals).toBeLessThanOrEqual(18);
    }
  });

  it("Test 4 — no duplicate contractAddress", () => {
    const entries = listTronTokens();
    const addrs = new Set(entries.map((e) => e.contractAddress));
    expect(addrs.size).toBe(entries.length);
  });

  it("Test 5a — findByAddress hits curated entry", () => {
    const usdt = findByAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
    expect(usdt).toBeDefined();
    expect(usdt?.symbol).toBe("USDT");
  });

  it("Test 5b — findByAddress returns undefined on unknown address (no throw)", () => {
    // Valid base58check but not in our registry.
    const unknown = findByAddress("TLyqzVGLV6srDMvCnSf5DLD6qMz3qAh1Vp");
    expect(unknown).toBeUndefined();
  });

  it("Test 6 — case-sensitive lookup: lowercased TRON base58check returns undefined (NOT a normalized match)", () => {
    const addr = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    expect(findByAddress(addr)).toBeDefined();
    // Lowercased version corrupts the base58check encoding — DOA validation
    // for that string would fail, but findByAddress just returns undefined.
    expect(findByAddress(addr.toLowerCase())).toBeUndefined();
  });

  it("Test 7 — every entry passes the full { contractAddress, symbol, decimals, displayName } contract + base58check via tronWeb.utils.address.isAddress", () => {
    for (const e of listTronTokens()) {
      expect(typeof e.contractAddress).toBe("string");
      expect(e.contractAddress.length).toBeGreaterThan(0);
      expect(tronUtils.address.isAddress(e.contractAddress)).toBe(true);
      expect(typeof e.symbol).toBe("string");
      expect(e.symbol.length).toBeGreaterThan(0);
      expect(typeof e.displayName).toBe("string");
      expect(e.displayName.length).toBeGreaterThan(0);
    }
  });
});
