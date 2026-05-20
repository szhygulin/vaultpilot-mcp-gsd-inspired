// src/tokens/tron-top-25.ts — empty-stub loader scaffold (Phase 17
// Plan 17-01 — plan-check FLAG 4 fix Option A). Plan 17-04 ships the
// filled-registry test (`test/tron-top-25.test.ts`); this file proves
// the stub-+-loader contract is sound when the JSON is `[]`.
//
// Coverage:
//   1. `listTronTokens()` returns `[]` against the empty stub.
//   2. `findByAddress(<any>)` returns `undefined` against the empty stub
//      (no entries to match).
//   3. Module-load DOA validator is a no-op when the JSON is empty
//      (importing the module side-effect-free with `[]` produces a
//      validated array of length 0). The validator BODY ships in 17-01
//      so Plan 17-04's filled-registry entries land against an
//      already-implemented validator.
//   4. Surface-export contract for downstream plans — `findByAddress`,
//      `listTronTokens`, `validateEntry`, `TronTokenRegistryEntry` are
//      all exported.

import { describe, expect, it } from "vitest";

import {
  findByAddress,
  listTronTokens,
  validateEntry,
} from "../src/tokens/tron-top-25.js";
import type { TronTokenRegistryEntry } from "../src/tokens/tron-top-25.js";

describe("src/tokens/tron-top-25.ts — empty-stub loader scaffold (Phase 17 Plan 17-01)", () => {
  it("Test 1 — listTronTokens() returns [] against the empty `[]` JSON stub", () => {
    const entries = listTronTokens();
    expect(entries).toEqual([]);
    expect(entries.length).toBe(0);
  });

  it("Test 2 — findByAddress(<any>) returns undefined against the empty stub (no entries)", () => {
    expect(findByAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBeUndefined();
    expect(findByAddress("TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8")).toBeUndefined();
    expect(findByAddress("anything")).toBeUndefined();
  });

  it("Test 3 — module-load DOA validator is a no-op when JSON is empty (`.map` over [] returns [] without throwing)", () => {
    // The import at the top of this file SUCCEEDED — that's the
    // assertion. With an empty JSON, the validator never runs against
    // any entry, so there's no throw at module load. The validator BODY
    // (shipped in 17-01) is exercised by Plan 17-04's filled-registry
    // test against real entries.
    expect(listTronTokens()).toEqual([]);
  });

  it("Test 4 — validateEntry is exported and exercises the validator body against an inline entry (proves shape for Plan 17-04)", () => {
    // Sanity-check the validator body against a known-good entry. Plan
    // 17-04's filled-registry test re-runs this against the curated
    // 20-25 entries; here we prove the validator surface itself works
    // so Plan 17-04 can rely on it.
    const goodEntry: TronTokenRegistryEntry = validateEntry({
      contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      symbol: "USDT",
      decimals: 6,
      displayName: "Tether (TRC-20)",
    });
    expect(goodEntry).toEqual({
      contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      symbol: "USDT",
      decimals: 6,
      displayName: "Tether (TRC-20)",
    });
  });

  it("Test 4b — validateEntry rejects missing `decimals` (Plan 17-04 REGRESSION ANCHOR per research Pitfall 5)", () => {
    expect(() =>
      validateEntry({
        contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        symbol: "USDT",
        // decimals deliberately omitted — must throw, NOT default.
        displayName: "Tether (TRC-20)",
      }),
    ).toThrow(/missing required `decimals`/);
  });

  it("Test 4c — validateEntry rejects invalid base58check (Pitfall 4 REGRESSION ANCHOR)", () => {
    expect(() =>
      validateEntry({
        // Corrupted last char — passes regex shape but fails checksum.
        contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6X",
        symbol: "USDT",
        decimals: 6,
        displayName: "Tether (TRC-20)",
      }),
    ).toThrow(/invalid base58check/);
    expect(() =>
      validateEntry({
        contractAddress: "0x1234567890123456789012345678901234567890",
        symbol: "USDT",
        decimals: 6,
        displayName: "Tether (TRC-20)",
      }),
    ).toThrow(/invalid base58check/);
  });

  it("Test 4d — validateEntry rejects USDD-style decimals=18 only when accompanied by other invalid fields; valid USDD passes (Pitfall 5 anchor — decimals are per-entry, NOT defaulted)", () => {
    // Sanity: 18-decimal entries are VALID. The validator must not
    // reject them — that's the point of per-entry decimals. Plan
    // 17-04's filled registry includes USDD with decimals=18.
    const usdd: TronTokenRegistryEntry = validateEntry({
      contractAddress: "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn",
      symbol: "USDD",
      decimals: 18,
      displayName: "Decentralized USD",
    });
    expect(usdd.decimals).toBe(18);
  });
});
