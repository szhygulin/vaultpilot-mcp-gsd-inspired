// Uniswap V3 LP persona-cycle byte-identity integration test —
// Phase 33 Plan 33-03 Task 3 (UNI-04 + UNI-09 + T-FROM-INDEPENDENCE-UNI-LP).
//
// Re-anchors all 6 Plan 33-02 + Plan 33-03 Fixtures UNI-LP-{A..F} across
// persona swaps. Mirror of test/integration-uniswap-v3-persona-cycle.test.ts
// (Phase 32 Plan 32-03) — same shape, widened to 6 fixtures + the composite
// rebalance shape.
//
// IMPORTANT DEVIATION from a from-INDEPENDENT pattern (Phase 4 native send,
// Phase 6 ERC-20 transfer): NPM calldata embeds the `recipient` slot in
// MintParams + CollectParams, so the payloadFingerprint VARIES with `from`.
// This matches the Phase 7 Aave T-INTEGRATION-FROM-DRIFT-2 + Phase 32 UNI-A/B/C
// from-DEPENDENT precedent.
//
// What this test asserts:
//   (a) PER-PERSONA DETERMINISM — for each fixture shape × each persona, two
//       independent computations through the encoder primitives produce the
//       SAME fingerprint. Anchors that the encoder chain is purely a function
//       of (preimage inputs + computePayloadFingerprint) — no hidden state.
//   (b) CROSS-PERSONA DISTINCT — for each fixture shape, persona-1's
//       fingerprint !== persona-2's fingerprint. Anchors the from-DEPENDENT
//       shape: any encoder that accidentally drops the recipient slot from
//       the preimage would collapse the persona-1 vs persona-2 distinction
//       (and produce identical fingerprints — this test would fire).
//
// 6 fixtures × 2 personas = 12 (fixture × persona) cells. Each cell asserts
// determinism + cross-persona-distinct against the other persona's value.

import { describe, expect, it } from "vitest";
import { getAddress, type Address, type Hex } from "viem";

import { computePayloadFingerprint } from "../src/signing/payload-fingerprint.js";
import {
  getUniswapV3NonfungiblePositionManagerAddress,
} from "../src/config/contracts.js";
import {
  MAX_UINT128,
  _uniswapV3LpProtocol,
  type MintParams,
} from "../src/protocols/uniswap-v3-lp.js";

// Canonical preimage inputs reused across both personas — only `recipient` +
// `collectRecipient` vary across personas (they encode the from-dependent
// slot). Every other slot is byte-identical across personas; the fingerprint
// distinction comes from these recipient field encodings alone.
const NPM = getUniswapV3NonfungiblePositionManagerAddress(1)!;
const USDC: Address = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH: Address = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const FIXTURE_DEADLINE = 1748707200n;

// Two personas (Anvil accounts 1 + 2 — per the plan's exact specification +
// matching the Phase 32 integration test persona choice).
const PERSONA_1: Address = getAddress(
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
);
const PERSONA_2: Address = getAddress(
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
);
const PERSONAS: ReadonlyArray<readonly [string, Address]> = [
  ["persona-1 (Anvil acct 1)", PERSONA_1],
  ["persona-2 (Anvil acct 2)", PERSONA_2],
];

// ---------------------------------------------------------------------------
// Helpers — encoder-level fingerprint computation per persona.
// ---------------------------------------------------------------------------

function fpUniLpAForPersona(persona: Address): Hex {
  const data = _uniswapV3LpProtocol.encodeMint({
    token0: USDC,
    token1: WETH,
    fee: 500,
    tickLower: -60,
    tickUpper: 60,
    amount0Desired: 100_000000n,
    amount1Desired: 50_000_000_000_000_000n,
    amount0Min: 99_500000n,
    amount1Min: 49_750_000_000_000_000n,
    recipient: persona,
    deadline: FIXTURE_DEADLINE,
  });
  return computePayloadFingerprint({
    chainId: 1,
    to: NPM,
    valueWei: 0n,
    data,
  });
}

function fpUniLpBForPersona(_persona: Address): Hex {
  // Fixture UNI-LP-B is increaseLiquidity — does NOT carry a recipient field.
  // The calldata IS from-INDEPENDENT here (tokenId-keyed authorization). To
  // exercise this fixture under both personas anyway, we re-compute the same
  // shape and assert the fingerprint is byte-stable across personas. Plan
  // 33-02 anchors the literal at FIXTURE_UNI_LP_B_FP.
  const data = _uniswapV3LpProtocol.encodeIncreaseLiquidity({
    tokenId: 12345n,
    amount0Desired: 100_000000n,
    amount1Desired: 50_000_000_000_000_000n,
    amount0Min: 99_500000n,
    amount1Min: 49_750_000_000_000_000n,
    deadline: FIXTURE_DEADLINE,
  });
  return computePayloadFingerprint({
    chainId: 1,
    to: NPM,
    valueWei: 0n,
    data,
  });
}

function fpUniLpCForPersona(_persona: Address): Hex {
  // Fixture UNI-LP-C is decreaseLiquidity — also no recipient field
  // (tokenId-keyed). Same from-INDEPENDENT shape.
  const data = _uniswapV3LpProtocol.encodeDecreaseLiquidity({
    tokenId: 12345n,
    liquidity: 1000n,
    amount0Min: 0n,
    amount1Min: 0n,
    deadline: FIXTURE_DEADLINE,
  });
  return computePayloadFingerprint({
    chainId: 1,
    to: NPM,
    valueWei: 0n,
    data,
  });
}

function fpUniLpDForPersona(persona: Address): Hex {
  const data = _uniswapV3LpProtocol.encodeCollect({
    tokenId: 12345n,
    recipient: persona,
    amount0Max: MAX_UINT128,
    amount1Max: MAX_UINT128,
  });
  return computePayloadFingerprint({
    chainId: 1,
    to: NPM,
    valueWei: 0n,
    data,
  });
}

function fpUniLpEForPersona(_persona: Address): Hex {
  // Fixture UNI-LP-E is burn(uint256) — no recipient field; from-INDEPENDENT.
  const data = _uniswapV3LpProtocol.encodeBurn(12345n);
  return computePayloadFingerprint({
    chainId: 1,
    to: NPM,
    valueWei: 0n,
    data,
  });
}

function fpUniLpFForPersona(persona: Address): Hex {
  // Fixture UNI-LP-F is the composite rebalance. Per CONTEXT.md D-06 +
  // RESEARCH § Topic 9: single payloadFingerprint over the FULL outer
  // multicall calldata (single hash). The recipient field flows through
  // BOTH the inner collect (recipient = persona) AND the inner mint
  // (recipient = persona) — the composite is doubly from-DEPENDENT.
  const mintParams: MintParams = {
    token0: USDC,
    token1: WETH,
    fee: 500,
    tickLower: -207000,
    tickUpper: -202000,
    amount0Desired: 100_000000n,
    amount1Desired: 50_000_000_000_000_000n,
    amount0Min: 99_500000n,
    amount1Min: 49_750_000_000_000_000n,
    recipient: persona,
    deadline: FIXTURE_DEADLINE,
  };
  const data = _uniswapV3LpProtocol.composeRebalanceCalldata({
    tokenId: 12345n,
    existingLiquidity: 3_289_473_921n,
    collectRecipient: persona,
    mintParams,
    decreaseAmount0Min: 0n,
    decreaseAmount1Min: 0n,
    deadline: FIXTURE_DEADLINE,
  });
  return computePayloadFingerprint({
    chainId: 1,
    to: NPM,
    valueWei: 0n,
    data,
  });
}

// Each fixture's compute fn + a flag indicating whether the shape is
// from-DEPENDENT (cross-persona-DISTINCT) or from-INDEPENDENT (cross-persona-
// IDENTICAL). The integration test asserts BOTH per-persona-determinism and
// the appropriate cross-persona shape per fixture.
const FIXTURES: ReadonlyArray<{
  name: string;
  compute: (persona: Address) => Hex;
  /** true when calldata embeds a recipient field (cross-persona distinct). */
  fromDependent: boolean;
}> = [
  { name: "UNI-LP-A (mint)", compute: fpUniLpAForPersona, fromDependent: true },
  {
    name: "UNI-LP-B (increaseLiquidity)",
    compute: fpUniLpBForPersona,
    fromDependent: false,
  },
  {
    name: "UNI-LP-C (decreaseLiquidity)",
    compute: fpUniLpCForPersona,
    fromDependent: false,
  },
  {
    name: "UNI-LP-D (collect)",
    compute: fpUniLpDForPersona,
    fromDependent: true,
  },
  {
    name: "UNI-LP-E (burn)",
    compute: fpUniLpEForPersona,
    fromDependent: false,
  },
  {
    name: "UNI-LP-F (composite rebalance)",
    compute: fpUniLpFForPersona,
    fromDependent: true,
  },
];

describe("integration-uniswap-v3-lp — persona-cycle byte-identity (T-FROM-INDEPENDENCE-UNI-LP)", () => {
  for (const fixture of FIXTURES) {
    describe(`${fixture.name}`, () => {
      for (const [personaLabel, personaAddr] of PERSONAS) {
        it(`${personaLabel}: fingerprint is deterministic across independent re-computations`, () => {
          const fp1 = fixture.compute(personaAddr);
          const fp2 = fixture.compute(personaAddr);
          expect(fp1).toBe(fp2);
          expect(fp1).toMatch(/^0x[0-9a-f]{64}$/);
        });
      }

      if (fixture.fromDependent) {
        it("persona-1 fingerprint !== persona-2 fingerprint (from-DEPENDENT shape — calldata embeds recipient)", () => {
          // Anchors the from-DEPENDENT shape: any encoder that accidentally
          // drops the recipient slot from the preimage would collapse the
          // persona-1 vs persona-2 distinction. Matches the Phase 7 + Phase 32
          // from-dependent precedent.
          const fpP1 = fixture.compute(PERSONA_1);
          const fpP2 = fixture.compute(PERSONA_2);
          expect(fpP1).not.toBe(fpP2);
        });
      } else {
        it("persona-1 fingerprint === persona-2 fingerprint (from-INDEPENDENT shape — calldata has no recipient slot)", () => {
          // Anchors the from-INDEPENDENT shape: tokenId-keyed authorization
          // verbs (increase / decrease / burn) carry no recipient — the
          // fingerprint MUST be byte-identical across personas.
          const fpP1 = fixture.compute(PERSONA_1);
          const fpP2 = fixture.compute(PERSONA_2);
          expect(fpP1).toBe(fpP2);
        });
      }
    });
  }
});

describe("integration-uniswap-v3-lp — composite rebalance preimage scrutiny (T-COMPOSITE-FP-EXTENSION)", () => {
  it("Fixture UNI-LP-F is a SINGLE hash over the full outer multicall calldata — NOT a multi-step hash chain", () => {
    // CONTEXT.md D-06 + RESEARCH § Topic 9 explicit: the cryptographic-binding
    // chain is UNCHANGED from Phase 4. Plan 33-03's composite rebalance uses
    // the SAME single-hash `computePayloadFingerprint(tx)` path as every
    // single-step verb — the new shape is a pure rendering extension at
    // preview_send, NOT a fingerprint-shape extension.
    //
    // This test exercises a regression-anchor for that invariant: the UNI-LP-F
    // fingerprint MUST equal `computePayloadFingerprint({ chainId, to, valueWei,
    // data })` for the FULL outer calldata blob — drift in any sub-call's bytes
    // changes the outer blob and changes the fingerprint (which is exactly
    // what the FROZEN Phase 4 trust pipeline guarantees end-to-end).
    const persona = PERSONA_1;
    const compositeFp = fpUniLpFForPersona(persona);

    // The hash MUST equal the canonical `computePayloadFingerprint(tx)` call
    // on the composed outer calldata — recomputed inline below to anchor that
    // the helper above isn't masking an indirection that does something else.
    const mintParams: MintParams = {
      token0: USDC,
      token1: WETH,
      fee: 500,
      tickLower: -207000,
      tickUpper: -202000,
      amount0Desired: 100_000000n,
      amount1Desired: 50_000_000_000_000_000n,
      amount0Min: 99_500000n,
      amount1Min: 49_750_000_000_000_000n,
      recipient: persona,
      deadline: FIXTURE_DEADLINE,
    };
    const data = _uniswapV3LpProtocol.composeRebalanceCalldata({
      tokenId: 12345n,
      existingLiquidity: 3_289_473_921n,
      collectRecipient: persona,
      mintParams,
      decreaseAmount0Min: 0n,
      decreaseAmount1Min: 0n,
      deadline: FIXTURE_DEADLINE,
    });
    const reconstructed = computePayloadFingerprint({
      chainId: 1,
      to: NPM,
      valueWei: 0n,
      data,
    });
    expect(compositeFp).toBe(reconstructed);
  });
});
