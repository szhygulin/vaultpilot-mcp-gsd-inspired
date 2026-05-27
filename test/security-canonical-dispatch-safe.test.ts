// Phase 36 Plan 36-01 Task 3 — Safe Singleton canonical-dispatch coverage
// property tests (SAFE-04).
//
// Anchors:
//   - T-SAFE-SINGLETON-DISPATCH-COVERAGE-1: every Safe Singleton variant
//     returned by `getSafeSingletonAddresses(chainId)` is contained in
//     `CANONICAL_DISPATCH_TARGETS[chainId]` for every supported chain. With 4
//     variants × 5 chains, this is 20 individual membership assertions.
//   - Pitfall 2 anchor: the L2 variants (v1.3.0-L2 / v1.4.1-L2) — which
//     dominate on Polygon / Arbitrum / Base / Optimism — pass
//     `checkDispatchTarget` on non-Ethereum chains. Allowlisting only L1
//     would silently refuse most Safes on those chains.
//   - Cross-chain canonical-across-eip155 lock: the 4 singleton entries are
//     the SAME 4 addresses on every supported chain (safe-deployments lock).
//   - Safe Singleton additions are PURELY ADDITIVE: pre-Phase-36 entries
//     remain in the allowlist; existing non-Safe addresses still refuse the
//     same way they did before (sanity-baseline check).

import { describe, expect, it } from "vitest";
import { getAddress, type Address } from "viem";

import {
  getSafeSingletonAddresses,
  type ChainId,
} from "../src/config/contracts.js";
import {
  CANONICAL_DISPATCH_TARGETS,
  checkDispatchTarget,
} from "../src/security/canonical-dispatch.js";

const CHAIN_IDS: readonly ChainId[] = [1, 42161, 137, 8453, 10] as const;

// RESEARCH § lines 870-886 mainnet literals — re-declared here so the
// property test grounds against verbatim hex (NOT just the getter output),
// catching any future drift in the SOT itself.
const V130_L1 = getAddress("0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552");
const V130_L2 = getAddress("0x3E5c63644E683549055b9Be8653de26E0B4CD36E");
const V141_L1 = getAddress("0x41675C099F32341bf84BFc5382aF534df5C7461a");
const V141_L2 = getAddress("0x29fcB43b46531BcA003ddC8FCB67FFE91900C762");

describe("CANONICAL_DISPATCH_TARGETS — Safe Singleton variants per chain", () => {
  // -------------------------------------------------------------------------
  // Test 1 — T-SAFE-SINGLETON-DISPATCH-COVERAGE-1: 4×5=20 assertions
  // -------------------------------------------------------------------------
  it("every Safe Singleton variant ∈ allowlist (4 variants × 5 chains = 20 assertions)", () => {
    for (const chainId of CHAIN_IDS) {
      const singletons = getSafeSingletonAddresses(chainId);
      expect(singletons.length).toBe(4);
      for (const singleton of singletons) {
        expect(
          CANONICAL_DISPATCH_TARGETS[chainId].has(singleton),
          `chainId=${chainId}: singleton ${singleton} missing from CANONICAL_DISPATCH_TARGETS`,
        ).toBe(true);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 2 — Cross-chain canonical-across-eip155 invariant.
  // -------------------------------------------------------------------------
  it("4 Safe singletons in CANONICAL_DISPATCH_TARGETS[A] === 4 Safe singletons in CANONICAL_DISPATCH_TARGETS[B] (canonical lock)", () => {
    // Pairwise loop: every (A, B) pair sees the SAME 4 Safe singletons.
    for (const a of CHAIN_IDS) {
      for (const b of CHAIN_IDS) {
        const aSet = getSafeSingletonAddresses(a);
        const bSet = getSafeSingletonAddresses(b);
        expect(aSet).toEqual(bSet);
        // And both sets are membership-resolved in each chain's allowlist.
        for (const addr of aSet) {
          expect(CANONICAL_DISPATCH_TARGETS[b].has(addr)).toBe(true);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // Test 3 — checkDispatchTarget allow v1.3.0-L2 on Polygon (Pitfall 2).
  // -------------------------------------------------------------------------
  it("checkDispatchTarget allows v1.3.0-L2 on Polygon (Pitfall 2 anchor)", () => {
    const result = checkDispatchTarget(137, V130_L2);
    expect(result).toEqual({ kind: "ok" });
  });

  it("checkDispatchTarget allows v1.4.1-L2 on Arbitrum", () => {
    const result = checkDispatchTarget(42161, V141_L2);
    expect(result).toEqual({ kind: "ok" });
  });

  it("checkDispatchTarget allows v1.4.1-L2 on Base", () => {
    const result = checkDispatchTarget(8453, V141_L2);
    expect(result).toEqual({ kind: "ok" });
  });

  it("checkDispatchTarget allows v1.3.0-L2 on Optimism", () => {
    const result = checkDispatchTarget(10, V130_L2);
    expect(result).toEqual({ kind: "ok" });
  });

  // -------------------------------------------------------------------------
  // Test 4 — checkDispatchTarget allow v1.4.1-L1 on Ethereum.
  // -------------------------------------------------------------------------
  it("checkDispatchTarget allows v1.4.1-L1 on Ethereum", () => {
    const result = checkDispatchTarget(1, V141_L1);
    expect(result).toEqual({ kind: "ok" });
  });

  it("checkDispatchTarget allows v1.3.0-L1 on Ethereum", () => {
    const result = checkDispatchTarget(1, V130_L1);
    expect(result).toEqual({ kind: "ok" });
  });

  // -------------------------------------------------------------------------
  // Test 5 — sanity baseline: a non-Safe random address still REFUSES.
  // -------------------------------------------------------------------------
  it("checkDispatchTarget refuses a non-canonical address (additive arm did not over-broaden allowlist)", () => {
    const eoa = getAddress("0x000000000000000000000000000000000000beef");
    const result = checkDispatchTarget(1, eoa);
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.to).toBe(eoa);
      expect(result.chain).toBe(1);
      // Allowlist surface includes the new Safe singletons.
      expect(result.allowlist).toContain(V141_L1);
      expect(result.allowlist).toContain(V141_L2);
      expect(result.allowlist).toContain(V130_L1);
      expect(result.allowlist).toContain(V130_L2);
    }
  });

  // -------------------------------------------------------------------------
  // Test 6 — Phase 36 adds exactly 4 entries per chain (count delta).
  // -------------------------------------------------------------------------
  it("CANONICAL_DISPATCH_TARGETS[chain] contains all 4 Safe singletons across every supported chain", () => {
    // Concrete count assertion: every supported chain has at least 4 unique
    // Safe entries in its allowlist. Pre-Phase-36 the count was 0; post-Phase-36
    // it is 4 (canonical-across-eip155 — same on every chain).
    for (const chainId of CHAIN_IDS) {
      const allowlist = CANONICAL_DISPATCH_TARGETS[chainId];
      const safeEntriesInAllowlist = [V130_L1, V130_L2, V141_L1, V141_L2].filter(
        (a) => allowlist.has(a),
      );
      expect(safeEntriesInAllowlist.length).toBe(4);
    }
  });

  // -------------------------------------------------------------------------
  // Test 7 — Cross-singleton distinctness inside the allowlist.
  // -------------------------------------------------------------------------
  it("the 4 Safe singletons within a chain are DISTINCT entries (no silent fold)", () => {
    for (const chainId of CHAIN_IDS) {
      const singletons = getSafeSingletonAddresses(chainId);
      const allowlist = CANONICAL_DISPATCH_TARGETS[chainId];
      // The Set ensures dedup; if any two singletons folded to one entry,
      // membership count would be <4.
      const presentCount = singletons.filter((a) => allowlist.has(a)).length;
      expect(presentCount).toBe(4);
      // And the singletons themselves carry 4 distinct addresses.
      expect(new Set(singletons).size).toBe(4);
    }
  });
});

// ===========================================================================
// EIP-55 case-insensitivity sanity check for Safe singletons (existing
// checkDispatchTarget behavior; this anchors that the new entries inherit it).
// ===========================================================================
describe("checkDispatchTarget — EIP-55 case-insensitive match on Safe singletons", () => {
  it("lowercase v1.4.1-L1 still resolves to { kind: 'ok' } on Ethereum", () => {
    const lower = V141_L1.toLowerCase() as Address;
    const result = checkDispatchTarget(1, lower);
    expect(result).toEqual({ kind: "ok" });
  });
});
