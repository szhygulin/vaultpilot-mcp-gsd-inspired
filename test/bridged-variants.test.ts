// src/tokens/bridged-variants.ts — curated bridged-token disambiguation
// table. Phase 8 — Plan 08-04 (READ-42 supporting data layer).
//
// Test discipline mirrors `test/config-contracts.test.ts` (Plan 06-03
// KNOWN_SPENDERS_ETHEREUM):
//   - Coverage anchor: table size + unique-symbol count.
//   - Curated-table integrity (T-BRIDGED-TABLE-SCAM-1 anchor): every row
//     has non-empty variantNote + EIP-55 round-trip on address.
//   - Bridged variants ALWAYS have originChain populated; canonicals do
//     NOT.
//   - lookupBridgedVariant case-insensitivity.
//   - Match on EITHER canonicalSymbol OR variantSymbol.
//   - ESM spy-affordance: vi.spyOn(_bridgedVariants, "lookupBridgedVariant").

import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  BRIDGED_VARIANTS,
  _bridgedVariants,
  lookupBridgedVariant,
} from "../src/tokens/bridged-variants.js";
import { type ChainId } from "../src/config/contracts.js";

describe("src/tokens/bridged-variants.ts — table coverage anchor", () => {
  it("Test 1 — BRIDGED_VARIANTS ships at least 70 rows (curation coverage; ~15 symbols × 5 chains)", () => {
    expect(BRIDGED_VARIANTS.length).toBeGreaterThanOrEqual(70);
  });

  it("covers at least 15 unique canonical symbols", () => {
    const symbols = new Set(BRIDGED_VARIANTS.map((v) => v.canonicalSymbol));
    expect(symbols.size).toBeGreaterThanOrEqual(15);
  });
});

describe("src/tokens/bridged-variants.ts — lookupBridgedVariant chain-narrowed", () => {
  it("Test 2 — lookupBridgedVariant('USDC', 1) returns exactly 1 row (Ethereum canonical only)", () => {
    const rows = lookupBridgedVariant("USDC", 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.variant).toBe("canonical");
    expect(rows[0]?.chainId).toBe(1);
    expect(rows[0]?.address).toBe(
      getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
    );
  });

  it("Test 3 — lookupBridgedVariant('USDC', 137) returns exactly 2 rows (canonical + USDC.e bridged)", () => {
    const rows = lookupBridgedVariant("USDC", 137);
    expect(rows).toHaveLength(2);
    const variants = rows.map((r) => r.variant).sort();
    expect(variants).toEqual(["bridged", "canonical"]);
    const bridgedRow = rows.find((r) => r.variant === "bridged");
    expect(bridgedRow?.variantSymbol).toBe("USDC.e");
    expect(bridgedRow?.originChain).toBe("ethereum");
  });
});

describe("src/tokens/bridged-variants.ts — lookupBridgedVariant chain-omitted (DF-1 Option A)", () => {
  it("Test 4 — lookupBridgedVariant('USDC') (no chainId) returns ALL chains' rows (5+ with bridged variants)", () => {
    const rows = lookupBridgedVariant("USDC");
    // 5 canonical USDC + bridged variants on arbitrum/polygon/optimism + USDbC on base = 9
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const chainIds = new Set(rows.map((r) => r.chainId));
    // At minimum should hit all 5 chains
    expect(chainIds.size).toBeGreaterThanOrEqual(5);
  });
});

describe("src/tokens/bridged-variants.ts — Test 5 curated-table integrity (T-BRIDGED-TABLE-SCAM-1 anchor)", () => {
  it("every row has a non-empty variantNote", () => {
    for (const row of BRIDGED_VARIANTS) {
      expect(row.variantNote.length).toBeGreaterThan(0);
    }
  });

  it("every row's address is EIP-55 checksummed (corrupted-snapshot guard)", () => {
    for (const row of BRIDGED_VARIANTS) {
      expect(row.address).toBe(getAddress(row.address));
    }
  });

  it("every row's chainId is in the ChainId union (1 | 42161 | 137 | 8453 | 10)", () => {
    const validChainIds: ChainId[] = [1, 42161, 137, 8453, 10];
    for (const row of BRIDGED_VARIANTS) {
      expect(validChainIds).toContain(row.chainId);
    }
  });

  it("every row has a non-empty canonicalSymbol and variantSymbol", () => {
    for (const row of BRIDGED_VARIANTS) {
      expect(row.canonicalSymbol.length).toBeGreaterThan(0);
      expect(row.variantSymbol.length).toBeGreaterThan(0);
    }
  });
});

describe("src/tokens/bridged-variants.ts — Test 6 variant + originChain semantic invariant", () => {
  it("bridged variants ALWAYS have originChain populated", () => {
    const bridged = BRIDGED_VARIANTS.filter((v) => v.variant === "bridged");
    expect(bridged.length).toBeGreaterThan(0);
    for (const row of bridged) {
      expect(row.originChain).toBeDefined();
      expect(typeof row.originChain).toBe("string");
    }
  });

  it("canonical variants do NOT have originChain", () => {
    const canonical = BRIDGED_VARIANTS.filter((v) => v.variant === "canonical");
    expect(canonical.length).toBeGreaterThan(0);
    for (const row of canonical) {
      expect(row.originChain).toBeUndefined();
    }
  });
});

describe("src/tokens/bridged-variants.ts — Test 7 unrecognized symbol returns empty", () => {
  it("lookupBridgedVariant('foo') returns []", () => {
    expect(lookupBridgedVariant("foo")).toEqual([]);
  });

  it("lookupBridgedVariant('USDC', 999 as any) returns [] for unsupported chain", () => {
    // chainId narrowing is enforced at TS, but runtime invocation with a
    // numeric value not in the union returns no matches.
    expect(lookupBridgedVariant("USDC", 999 as unknown as ChainId)).toEqual([]);
  });
});

describe("src/tokens/bridged-variants.ts — Test 8 case-insensitivity", () => {
  it("lookupBridgedVariant('usdc') equals lookupBridgedVariant('USDC') equals lookupBridgedVariant('UsDc')", () => {
    const a = lookupBridgedVariant("usdc");
    const b = lookupBridgedVariant("USDC");
    const c = lookupBridgedVariant("UsDc");
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("src/tokens/bridged-variants.ts — Test 9 match on EITHER canonicalSymbol OR variantSymbol", () => {
  it("lookupBridgedVariant('USDC.e', 137) returns 1 row (the bridged variant matched on variantSymbol)", () => {
    const rows = lookupBridgedVariant("USDC.e", 137);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.variantSymbol).toBe("USDC.e");
    expect(rows[0]?.variant).toBe("bridged");
    expect(rows[0]?.canonicalSymbol).toBe("USDC");
  });

  it("lookupBridgedVariant('USDbC', 8453) returns 1 row (the Base bridged variant matched on variantSymbol)", () => {
    const rows = lookupBridgedVariant("USDbC", 8453);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.variantSymbol).toBe("USDbC");
    expect(rows[0]?.variant).toBe("bridged");
  });
});

describe("src/tokens/bridged-variants.ts — Test 10 _bridgedVariants ESM spy-affordance", () => {
  it("vi.spyOn(_bridgedVariants, 'lookupBridgedVariant') intercepts calls", () => {
    const sentinel = [
      {
        canonicalSymbol: "SPY",
        variantSymbol: "SPY",
        address: getAddress("0x0000000000000000000000000000000000000001"),
        chainId: 1 as ChainId,
        variant: "canonical" as const,
        variantNote: "sentinel — should never appear in production",
      },
    ];
    const spy = vi
      .spyOn(_bridgedVariants, "lookupBridgedVariant")
      .mockReturnValue(sentinel);
    try {
      const out = _bridgedVariants.lookupBridgedVariant("anything");
      expect(out).toBe(sentinel);
      expect(spy).toHaveBeenCalledWith("anything");
    } finally {
      spy.mockRestore();
    }
  });
});
