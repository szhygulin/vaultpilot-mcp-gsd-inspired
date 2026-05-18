// Phase 9 — Plan 09-04. `src/security/canonical-dispatch.ts` unit tests
// (SEC-35). Mirror of `test/config-contracts.test.ts` curated-table assertion
// pattern.
//
// Coverage:
//   - T-CANONICAL-DISPATCH-COVERAGE-1 anchor (Test 1): per-chain Set size
//     lower bounds. Ethereum >= 15 (4 canonical + 17 BRIDGED_VARIANTS, less
//     overlap = 20); L2s >= 8 (Base has the smallest BRIDGED_VARIANTS row
//     count at 5).
//   - Per-chain × per-canonical-entry membership (Aave Pool + WETH9 +
//     1inch V6 + LiFi Diamond across 5 chains = 20 assertions).
//   - checkDispatchTarget 2-arm coverage (`ok` happy path + `refused` with
//     verbatim allowlist surfacing).
//   - EIP-55 round-trip (lowercase input → ok via `getAddress` normalization).
//   - ESM spy round-trip via `_canonicalDispatch` indirection.
//   - Cross-chain 1inch + LiFi consistency (same address on all 5 chains).

import { describe, expect, it, vi } from "vitest";
import { getAddress, type Address } from "viem";

import {
  getAaveV3PoolAddress,
  getWethAddress,
  type ChainId,
} from "../src/config/contracts.js";
import {
  CANONICAL_DISPATCH_TARGETS,
  _canonicalDispatch,
  checkDispatchTarget,
} from "../src/security/canonical-dispatch.js";

const CHAIN_IDS: readonly ChainId[] = [1, 42161, 137, 8453, 10] as const;

// Cross-chain canonicals (kept private inside the module — re-declared here
// for membership assertions). Per RESEARCH § A3, both addresses are
// identical across the 5 supported chains.
const ONEINCH_V6_ROUTER: Address = getAddress(
  "0x111111125421cA6dc452d289314280a0f8842A65",
);
const LIFI_DIAMOND: Address = getAddress(
  "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
);

// ---------------------------------------------------------------------------
// Test 1 — T-CANONICAL-DISPATCH-COVERAGE-1 anchor: per-chain Set size
// lower bounds (option (b) PARTIAL — CANONICAL_DISPATCH_TARGETS consumes
// BRIDGED_VARIANTS).
// ---------------------------------------------------------------------------
describe("CANONICAL_DISPATCH_TARGETS — per-chain Set size lower bounds (T-CANONICAL-DISPATCH-COVERAGE-1)", () => {
  it("Ethereum (1) Set has >= 15 entries (4 canonical + BRIDGED_VARIANTS Ethereum rows)", () => {
    expect(CANONICAL_DISPATCH_TARGETS[1].size).toBeGreaterThanOrEqual(15);
  });

  it("Arbitrum (42161) Set has >= 8 entries", () => {
    expect(CANONICAL_DISPATCH_TARGETS[42161].size).toBeGreaterThanOrEqual(8);
  });

  it("Polygon (137) Set has >= 8 entries", () => {
    expect(CANONICAL_DISPATCH_TARGETS[137].size).toBeGreaterThanOrEqual(8);
  });

  it("Base (8453) Set has >= 8 entries (smallest BRIDGED_VARIANTS coverage)", () => {
    expect(CANONICAL_DISPATCH_TARGETS[8453].size).toBeGreaterThanOrEqual(8);
  });

  it("Optimism (10) Set has >= 8 entries", () => {
    expect(CANONICAL_DISPATCH_TARGETS[10].size).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Test 2-5 — Per-chain × per-canonical-entry membership (4 entries × 5 chains
// = 20 assertions).
// ---------------------------------------------------------------------------
describe("CANONICAL_DISPATCH_TARGETS — per-chain × per-canonical-entry membership", () => {
  it("Aave V3 Pool present in every chain's Set (5 assertions)", () => {
    for (const chainId of CHAIN_IDS) {
      expect(
        CANONICAL_DISPATCH_TARGETS[chainId].has(getAaveV3PoolAddress(chainId)),
      ).toBe(true);
    }
  });

  it("WETH9 present in every chain's Set (5 assertions)", () => {
    for (const chainId of CHAIN_IDS) {
      expect(
        CANONICAL_DISPATCH_TARGETS[chainId].has(getWethAddress(chainId)),
      ).toBe(true);
    }
  });

  it("1inch V6 Router (cross-chain canonical) present in every chain's Set (5 assertions)", () => {
    for (const chainId of CHAIN_IDS) {
      expect(CANONICAL_DISPATCH_TARGETS[chainId].has(ONEINCH_V6_ROUTER)).toBe(
        true,
      );
    }
  });

  it("LiFi Diamond (cross-chain canonical) present in every chain's Set (5 assertions)", () => {
    for (const chainId of CHAIN_IDS) {
      expect(CANONICAL_DISPATCH_TARGETS[chainId].has(LIFI_DIAMOND)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 6 — checkDispatchTarget happy path (Ethereum Aave Pool).
// ---------------------------------------------------------------------------
describe("checkDispatchTarget — happy path", () => {
  it("Ethereum Aave V3 Pool → { kind: \"ok\" }", () => {
    const result = checkDispatchTarget(1, getAaveV3PoolAddress(1));
    expect(result).toEqual({ kind: "ok" });
  });

  it("Polygon WETH9 → { kind: \"ok\" }", () => {
    const result = checkDispatchTarget(137, getWethAddress(137));
    expect(result).toEqual({ kind: "ok" });
  });
});

// ---------------------------------------------------------------------------
// Test 8 — checkDispatchTarget refusal with verbatim allowlist surfacing.
// ---------------------------------------------------------------------------
describe("checkDispatchTarget — refusal", () => {
  it("random EOA on Ethereum → { kind: \"refused\", chain: 1, to: checksummed, allowlist: [...4+ entries] }", () => {
    const eoa = getAddress("0x0000000000000000000000000000000000000001");
    const result = checkDispatchTarget(1, eoa);
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.chain).toBe(1);
    expect(result.to).toBe(eoa);
    // Allowlist surfaces the verbatim per-chain entries — the agent /
    // user can see what was expected for self-correction.
    expect(result.allowlist.length).toBeGreaterThanOrEqual(15);
    expect(result.allowlist).toContain(getAaveV3PoolAddress(1));
    expect(result.allowlist).toContain(getWethAddress(1));
    expect(result.allowlist).toContain(ONEINCH_V6_ROUTER);
    expect(result.allowlist).toContain(LIFI_DIAMOND);
  });
});

// ---------------------------------------------------------------------------
// Test 9 — EIP-55 round-trip: lowercase input → ok via getAddress normalization.
// ---------------------------------------------------------------------------
describe("checkDispatchTarget — EIP-55 case-insensitive match (T-SPENDER-CASE-1 analog)", () => {
  it("lowercase Aave Pool address still resolves to { kind: \"ok\" }", () => {
    const checksummed = getAaveV3PoolAddress(1);
    const lowercased = checksummed.toLowerCase() as Address;
    const result = checkDispatchTarget(1, lowercased);
    expect(result).toEqual({ kind: "ok" });
  });

  it("mixed-case WETH9 address still resolves to { kind: \"ok\" }", () => {
    const checksummed = getWethAddress(1);
    // Mix-flip half the characters to a different case.
    const mixed =
      ("0x" +
        checksummed
          .slice(2)
          .split("")
          .map((c, i) => (i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()))
          .join("")) as Address;
    const result = checkDispatchTarget(1, mixed);
    expect(result).toEqual({ kind: "ok" });
  });
});

// ---------------------------------------------------------------------------
// Test 10 — ESM spy round-trip via _canonicalDispatch indirection.
// ---------------------------------------------------------------------------
describe("_canonicalDispatch — ESM spy-affordance round-trip", () => {
  it("vi.spyOn(_canonicalDispatch, \"checkDispatchTarget\") intercepts production callsite", () => {
    const spy = vi
      .spyOn(_canonicalDispatch, "checkDispatchTarget")
      .mockReturnValue({ kind: "ok" });
    try {
      const result = _canonicalDispatch.checkDispatchTarget(
        1,
        getAddress("0x0000000000000000000000000000000000000001"),
      );
      // The spy returns ok even though the address is NOT in the real
      // allowlist — proves the indirection seam works.
      expect(result).toEqual({ kind: "ok" });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 11 — Cross-chain 1inch + LiFi consistency: same address on all 5 chains.
// ---------------------------------------------------------------------------
describe("Cross-chain canonical addresses — 1inch V6 + LiFi consistency", () => {
  it("1inch V6 Router resolves to ok on every chain via checkDispatchTarget", () => {
    for (const chainId of CHAIN_IDS) {
      const result = checkDispatchTarget(chainId, ONEINCH_V6_ROUTER);
      expect(result).toEqual({ kind: "ok" });
    }
  });

  it("LiFi Diamond resolves to ok on every chain via checkDispatchTarget", () => {
    for (const chainId of CHAIN_IDS) {
      const result = checkDispatchTarget(chainId, LIFI_DIAMOND);
      expect(result).toEqual({ kind: "ok" });
    }
  });
});

// ---------------------------------------------------------------------------
// Test 12 — T-ERC20-TOKEN-COMPATIBILITY-1 anchor: per-chain BRIDGED_VARIANTS
// consumption. Asserts that the locked option (b) PARTIAL extension is wired
// — USDC (Circle-native) and WETH on each chain pass checkDispatchTarget.
// Phase 6 ERC-20 lifecycle compatibility lock.
// ---------------------------------------------------------------------------
describe("BRIDGED_VARIANTS consumption — Phase 6 ERC-20 compatibility (T-ERC20-TOKEN-COMPATIBILITY-1)", () => {
  it("Ethereum USDC (Circle-native) reaches { kind: \"ok\" } via BRIDGED_VARIANTS coverage", () => {
    const usdcEth = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    expect(checkDispatchTarget(1, usdcEth)).toEqual({ kind: "ok" });
  });

  it("Polygon USDT reaches { kind: \"ok\" } via BRIDGED_VARIANTS coverage", () => {
    const usdtPoly = getAddress("0xc2132D05D31c914a87C6611C10748AEb04B58e8F");
    expect(checkDispatchTarget(137, usdtPoly)).toEqual({ kind: "ok" });
  });

  it("Arbitrum WETH (canonical) reaches { kind: \"ok\" } (canonical SOT path)", () => {
    expect(checkDispatchTarget(42161, getWethAddress(42161))).toEqual({
      kind: "ok",
    });
  });

  it("Long-tail token (NOT in BRIDGED_VARIANTS) hits { kind: \"refused\" }", () => {
    const longTail = getAddress("0xfedcba9876543210fedcba9876543210fedcba98");
    const result = checkDispatchTarget(1, longTail);
    expect(result.kind).toBe("refused");
  });
});
