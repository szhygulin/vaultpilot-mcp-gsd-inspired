// Phase 41 — Plan 41-02 (SEC-L2-DISPATCH-1).
//
// Per-chain dispatch-coverage tests for Compound V3 L2 Comets added in
// Plan 41-01. For each chainId in [42161, 137, 8453, 10], every address in
// getAllCompoundCometsForChain(chainId) must resolve to true in
// CANONICAL_DISPATCH_TARGETS[chainId] (the per-chain allowlist).
//
// This test file mirrors the Phase 28 dispatch-coverage pattern in
// test/canonical-dispatch-compound-mainnet.test.ts (or equivalent) and
// directly validates Phase 41 SC-4 + SC-7:
//   SC-4: "canonical-dispatch arms extended for L2 Comets (auto via SOT getter)"
//   SC-7: "checkDispatchTarget resolves all new Comet addresses on their chain"
//
// Negative assertions (T-DISPATCH-CROSS-CHAIN-COINCIDENCE-1):
//   - The Base USDbC Comet proxy `0x9c4ec768...` IS expected in the Arbitrum
//     set (it is the Arbitrum USDC Comet) but MUST be absent from the Base set.
//     The per-chain dispatch set by design disambiguates this cross-chain
//     address coincidence (Phase 41 RESEARCH § Gotcha 2).

import { describe, expect, it } from "vitest";
import { getAddress } from "viem";

import { CANONICAL_DISPATCH_TARGETS } from "../src/security/canonical-dispatch.js";
import { getAllCompoundCometsForChain } from "../src/config/contracts.js";

// Phase 41 Plan 41-01 counts: Arbitrum=4, Polygon=2, Base=4, Optimism=3.
const EXPECTED_COUNTS: Record<number, number> = {
  42161: 4, // Arbitrum: USDC / USDC.e / USDT / WETH
  137:   2, // Polygon:  USDC.e / USDT
  8453:  4, // Base:     USDC / WETH / USDS / AERO
  10:    3, // Optimism: USDC / USDT / WETH
};

describe("Compound L2 Comet dispatch coverage (Phase 41 SC-4 / SC-7)", () => {
  for (const chainId of [42161, 137, 8453, 10] as const) {
    const comets = getAllCompoundCometsForChain(chainId);
    const allowlist = CANONICAL_DISPATCH_TARGETS[chainId];

    it(`chainId ${chainId} — Comet list is non-empty (length === ${EXPECTED_COUNTS[chainId]})`, () => {
      // Vacuous-pass guard: if the SOT is empty, the loop below cannot fail.
      // Assert the expected count matches the 41-01 Phase SOT additions.
      expect(comets).toHaveLength(EXPECTED_COUNTS[chainId]);
    });

    for (const comet of comets) {
      it(`chainId ${chainId} Comet ${comet} resolves through CANONICAL_DISPATCH_TARGETS[${chainId}]`, () => {
        expect(allowlist.has(comet)).toBe(true);
      });
    }
  }

  // -------------------------------------------------------------------------
  // T-DISPATCH-CROSS-CHAIN-COINCIDENCE-1
  // The Arbitrum USDC Comet and the (deprecated, excluded) Base USDbC Comet
  // share the same proxy address: 0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf.
  // Verify per-chain disambiguation:
  //   - The address IS in the Arbitrum set (it is the legitimate Arb USDC Comet).
  //   - The address is NOT in the Base set (Base USDbC was deliberately excluded
  //     in 41-01; its address must not bleed into Base dispatch via Arb SOT row).
  // -------------------------------------------------------------------------
  const COINCIDENCE_ADDR = getAddress("0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf");

  it("Cross-chain coincidence addr 0x9c4ec768... IS in Arbitrum (42161) dispatch set — it is the Arb USDC Comet", () => {
    expect(CANONICAL_DISPATCH_TARGETS[42161].has(COINCIDENCE_ADDR)).toBe(true);
  });

  it("Cross-chain coincidence addr 0x9c4ec768... is NOT in Base (8453) dispatch set — Base USDbC excluded per 41-01", () => {
    expect(CANONICAL_DISPATCH_TARGETS[8453].has(COINCIDENCE_ADDR)).toBe(false);
  });
});
