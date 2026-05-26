// Phase 35 Plan 35-03 (CUSTOM-01). Unit tests for the selector → tool routing
// table. Mirror of `test/security-canonical-dispatch.test.ts` (lines 1-80) —
// same "curated security table + 1 helper + ESM spy-affordance" shape.
//
// Coverage:
//   - lookupCanonicalAlternative: happy path + case-insensitive + no-match.
//   - Table collision audit: a SHARED selector maps to a SINGLE row (first
//     wins). Where collisions are documented (e.g. 0xd0e30db0 = WETH9.deposit
//     = RocketDepositPool.deposit; 0x42966c68 = rETH.burn = NPM.burn), the
//     table holds exactly one row per selector — the first matching tool.
//   - Anchor coverage: the 5 RESEARCH-listed selectors are all present.
//   - ESM spy-affordance round-trip via `_canonicalAlternatives`.

import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";

import {
  CANONICAL_ALTERNATIVES,
  _canonicalAlternatives,
  lookupCanonicalAlternative,
} from "../src/security/canonical-alternatives.js";

describe("lookupCanonicalAlternative", () => {
  it("returns the row for ERC-20 transfer (0xa9059cbb)", () => {
    const row = lookupCanonicalAlternative("0xa9059cbb");
    expect(row).not.toBeNull();
    expect(row?.tool).toBe("prepare_token_send");
    expect(row?.reason).toContain("ERC-20 transfer");
  });

  it("returns the row for ERC-20 approve (0x095ea7b3)", () => {
    const row = lookupCanonicalAlternative("0x095ea7b3");
    expect(row).not.toBeNull();
    expect(row?.tool).toBe("prepare_token_approve");
  });

  it("normalizes case — uppercase selector matches the same row", () => {
    const lower = lookupCanonicalAlternative("0xa9059cbb");
    const upper = lookupCanonicalAlternative("0xA9059CBB" as Hex);
    expect(upper).not.toBeNull();
    expect(upper?.tool).toBe(lower?.tool);
    expect(upper?.selector.toLowerCase()).toBe(
      lower?.selector.toLowerCase(),
    );
  });

  it("normalizes case — mixed case selector matches", () => {
    const row = lookupCanonicalAlternative("0xA9059Cbb" as Hex);
    expect(row).not.toBeNull();
    expect(row?.tool).toBe("prepare_token_send");
  });

  it("returns null for an unrecognized selector (0xdeadbeef)", () => {
    expect(lookupCanonicalAlternative("0xdeadbeef")).toBeNull();
  });

  it("returns null for an empty-looking selector (0x00000000)", () => {
    expect(lookupCanonicalAlternative("0x00000000")).toBeNull();
  });
});

describe("CANONICAL_ALTERNATIVES — table integrity", () => {
  it("contains entries for the 5 RESEARCH-listed anchor selectors", () => {
    const anchors: Hex[] = [
      "0xa9059cbb", // ERC-20 transfer → prepare_token_send
      "0x095ea7b3", // ERC-20 approve → prepare_token_approve
      "0x2e1a7d4d", // WETH9.withdraw → prepare_weth_unwrap
      "0x617ba037", // Aave V3 supply → prepare_aave_supply
      "0x69328dec", // Aave V3 withdraw → prepare_aave_withdraw
    ];
    for (const sel of anchors) {
      const row = lookupCanonicalAlternative(sel);
      expect(row, `expected entry for ${sel}`).not.toBeNull();
      expect(row?.selector.toLowerCase()).toBe(sel.toLowerCase());
    }
  });

  it("includes Aave V3 supply (0x617ba037) mapped to prepare_aave_supply", () => {
    const row = lookupCanonicalAlternative("0x617ba037");
    expect(row?.tool).toBe("prepare_aave_supply");
    expect(row?.reason).toContain("Aave V3");
  });

  it("includes WETH9.withdraw (0x2e1a7d4d) mapped to prepare_weth_unwrap", () => {
    const row = lookupCanonicalAlternative("0x2e1a7d4d");
    expect(row?.tool).toBe("prepare_weth_unwrap");
    expect(row?.reason).toContain("WETH9.withdraw");
  });

  it("every row has a non-empty selector, tool, and reason", () => {
    for (const row of CANONICAL_ALTERNATIVES) {
      expect(row.selector).toMatch(/^0x[0-9a-fA-F]{8}$/);
      expect(row.tool.length).toBeGreaterThan(0);
      expect(row.tool.startsWith("prepare_")).toBe(true);
      expect(row.reason.length).toBeGreaterThan(0);
    }
  });

  it("no duplicate selectors — first row wins for documented collisions", () => {
    // Collisions are documented in the table source (0xd0e30db0,
    // 0x42966c68). The table itself holds exactly one row per selector
    // (the FIRST matching tool surfaced in refusal text).
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const row of CANONICAL_ALTERNATIVES) {
      const key = row.selector.toLowerCase();
      if (seen.has(key)) {
        duplicates.push(key);
      }
      seen.add(key);
    }
    expect(duplicates).toEqual([]);
    expect(seen.size).toBe(CANONICAL_ALTERNATIVES.length);
  });

  it("table size is at least the 5 RESEARCH anchors + audit additions", () => {
    // Anchor 5 + Aave/Compound/Morpho/Lido/EigenLayer/RocketPool/UniswapV3/
    // UniswapV3-LP/Curve audit → at least 20. Lower bound is loose so future
    // additions don't break this test.
    expect(CANONICAL_ALTERNATIVES.length).toBeGreaterThanOrEqual(20);
  });
});

describe("_canonicalAlternatives — ESM spy-affordance round-trip", () => {
  it("vi.spyOn intercepts subsequent lookupCanonicalAlternative calls", () => {
    const spy = vi.spyOn(_canonicalAlternatives, "lookupCanonicalAlternative");
    try {
      _canonicalAlternatives.lookupCanonicalAlternative("0xa9059cbb");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("0xa9059cbb");
    } finally {
      spy.mockRestore();
    }
  });

  it("exposes the same function reference as the named export", () => {
    expect(_canonicalAlternatives.lookupCanonicalAlternative).toBe(
      lookupCanonicalAlternative,
    );
  });
});
