// test/bridge-decoders-across-v3.test.ts — Phase 39 Plan 39-02 (BRIDGE-T1-04).
//
// Unit tests for src/protocols/bridge-decoders/across-v3.ts.
//
// Uses a real mainnet calldata fixture from tx
//   0xbdb62e8ece1ac5b8e0d16bd82f3c145d6b8ce8b840b8d5a8b59ea78997308560
// (Across V3 depositV3 — confirmed by viem.decodeFunctionData in research session 2026-05-28).
//
// WR-02: decodeAcrossV3Deposit returns { kind: "ok" | "error" } — NEVER throws.
//
// NO beforeAll-snapshot per CLAUDE.md fixture discipline — all assertions use
// hardcoded literals.

import { describe, expect, it } from "vitest";
import {
  decodeAcrossV3Deposit,
  ACROSS_V3_SELECTORS,
  _acrossV3Helpers,
} from "../src/protocols/bridge-decoders/across-v3.js";

// ─── Fixture: Real mainnet calldata ──────────────────────────────────────────
//
// Source: Ethereum mainnet tx 0xbdb62e8ece1ac5b8e0d16bd82f3c145d6b8ce8b840b8d5a8b59ea78997308560
// VERIFIED: viem.decodeFunctionData in research session 2026-05-28.
// Function: depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)
//
// Decoded fields:
//   depositor            = 0x15528a195C4b9353D7645eBA48357a85324bb365
//   recipient  (args[1]) = 0x15528a195C4b9353D7645eBA48357a85324bb365
//   inputToken (args[2]) = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 (WETH)
//   outputToken (args[3])= 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 (ARB WETH)
//   destinationChainId   = 42161 (Arbitrum One)

const ACROSS_V3_CALLDATA =
  "0x7b939232" +
  "00000000000000000000000015528a195c4b9353d7645eba48357a85324bb365" +
  "00000000000000000000000015528a195c4b9353d7645eba48357a85324bb365" +
  "000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" +
  "00000000000000000000000082af49447d8a07e3bd95bd0d56f35241523fbab1" +
  "00000000000000000000000000000000000000000000000001118f178fb48000" +
  "000000000000000000000000000000000000000000000000011184362742503a" +
  "000000000000000000000000000000000000000000000000000000000000a4b1" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "000000000000000000000000000000000000000000000000000000006a1861b7" +
  "000000000000000000000000000000000000000000000000000000006a187dd7" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000180" +
  "0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

const EXPECTED_RECIPIENT = "0x15528a195C4b9353D7645eBA48357a85324bb365"; // EIP-55 checksummed
const EXPECTED_DEST_CHAIN_ID = 42161n; // Arbitrum One
const EXPECTED_INPUT_TOKEN = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH EIP-55
const EXPECTED_OUTPUT_TOKEN = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"; // ARB WETH EIP-55

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("decodeAcrossV3Deposit — depositV3 calldata extraction", () => {
  it("returns correct finalRecipient (EIP-55 checksummed) from real mainnet calldata", () => {
    const result = decodeAcrossV3Deposit(ACROSS_V3_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.finalRecipient).toBe(EXPECTED_RECIPIENT);
    }
  });

  it("returns correct destinationChainId (42161n Arbitrum) from real mainnet calldata", () => {
    const result = decodeAcrossV3Deposit(ACROSS_V3_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.destinationChainId).toBe(EXPECTED_DEST_CHAIN_ID);
    }
  });

  it("returns correct inputToken (WETH EIP-55) from real mainnet calldata", () => {
    const result = decodeAcrossV3Deposit(ACROSS_V3_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.inputToken).toBe(EXPECTED_INPUT_TOKEN);
    }
  });

  it("returns correct outputToken (ARB WETH EIP-55) from real mainnet calldata", () => {
    const result = decodeAcrossV3Deposit(ACROSS_V3_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.outputToken).toBe(EXPECTED_OUTPUT_TOKEN);
    }
  });

  it("returns { kind: 'error' } on selector mismatch (WR-02: NEVER-throws)", () => {
    const result = decodeAcrossV3Deposit("0xdeadbeef" as `0x${string}`);
    expect(result.kind).toBe("error");
    // Must NOT throw — WR-02
  });

  it("returns { kind: 'error' } on truncated calldata matching selector (WR-02: NEVER-throws)", () => {
    // Selector alone without ABI-encoded args — decodeFunctionData will throw internally
    const result = decodeAcrossV3Deposit("0x7b939232" as `0x${string}`);
    expect(result.kind).toBe("error");
    // Must NOT throw — WR-02
  });

  it("ACROSS_V3_SELECTORS.depositV3 is the 4-byte selector 0x7b939232", () => {
    expect(ACROSS_V3_SELECTORS.depositV3).toBe("0x7b939232");
  });
});

describe("_acrossV3Helpers ESM seam", () => {
  it("exports _acrossV3Helpers with a decodeFunctionData method", () => {
    expect(typeof _acrossV3Helpers.decodeFunctionData).toBe("function");
  });
});
