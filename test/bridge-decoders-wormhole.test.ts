// test/bridge-decoders-wormhole.test.ts — Phase 39 Plan 39-02 (BRIDGE-T1-01).
//
// Unit tests for src/protocols/bridge-decoders/wormhole.ts.
//
// Two calldata fixtures:
//   1. REAL (EVM dest): tx 0x778c95195c314ac1800910715e30da85d8d9e2355781b30e9f927428e67ad886
//      recipientChain = 16 (Moonbeam, EVM), recipient bytes32 → last-20-bytes getAddress()
//   2. CONSTRUCTED (Solana dest): same function, recipientChain = 1 (Solana),
//      recipient bytes32 = 0x1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a
//      → bs58.encode(full 32 bytes) = "2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5"
//
// CRITICAL CORRECTNESS TEST (T-39-02-SOLANA-NORM):
//   The Solana test pins an EXACT mixed-case base58 literal.
//   A naive last-20-bytes extraction would yield "0x3b52691cfee5568a3922dc31a..." (nonsense).
//   A naive .toLowerCase() of the base58 would fail the exact assertion.
//   The test proves the encoding-aware path: bs58.encode over the FULL 32 bytes.
//
// WR-02: decodeWormholeTransferWithPayload returns { kind: "ok" | "error" } — NEVER throws.
//
// NO beforeAll-snapshot per CLAUDE.md fixture discipline — all assertions use
// hardcoded literals.

import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  decodeWormholeTransferWithPayload,
  WORMHOLE_SELECTORS,
  _wormholeHelpers,
} from "../src/protocols/bridge-decoders/wormhole.js";

// ─── Fixture 1: Real mainnet calldata — EVM dest (Moonbeam chain 16) ──────────
//
// Source: Ethereum mainnet tx 0x778c95195c314ac1800910715e30da85d8d9e2355781b30e9f927428e67ad886
// VERIFIED: viem.decodeFunctionData in research session 2026-05-28.
// Function: transferTokensWithPayload(address,uint256,uint16,bytes32,uint32,bytes)
//
// Decoded fields:
//   token          = 0xdAC17F958D2ee523a2206206994597C13D831ec7 (USDT)
//   amount         = 50_021_600_000n
//   recipientChain = 16 (Wormhole chain 16 = Moonbeam — EVM chain)
//   recipient      = 0x0000000000000000000000000000000000000000000000000000000000000816 (bytes32)
//   → EVM address  = 0x0000000000000000000000000000000000000816 (last 20 bytes)

const WORMHOLE_EVM_CALLDATA =
  "0xc5a5ebda" +
  "000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7" +
  "0000000000000000000000000000000000000000000000000000000ba5850b00" +
  "0000000000000000000000000000000000000000000000000000000000000010" +
  "0000000000000000000000000000000000000000000000000000000000000816" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000c0" +
  "0000000000000000000000000000000000000000000000000000000000000029" +
  "0005010200c91f010045544800e139dd7fc2a49ff20d5c8436ea1bf3301cc979" +
  "f900000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

// EVM recipient: getAddress of last-20-bytes of 0x...0816
const EXPECTED_EVM_RECIPIENT = getAddress("0x0000000000000000000000000000000000000816");

// ─── Fixture 2: Constructed calldata — Solana dest (chain 1) ─────────────────
//
// CONSTRUCTED: encoded with viem.encodeFunctionData using:
//   recipientChain = 1 (Wormhole chain 1 = Solana)
//   recipient bytes32 = 0x1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a
//   (from LiFi→Mayan routing tx — confirmed Solana pubkey bytes32, RESEARCH §Mayan)
//
// Base58 of the full 32 bytes = "2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5"
// VERIFIED: bs58.encode in research session 2026-05-28.
//
// CRITICAL: This test asserts the EXACT mixed-case base58 string.
//   - A naive last-20-bytes extraction: would yield garbage EVM-looking value.
//   - A naive .toLowerCase(): "2hh484nljrmskxrfxnf3e3yd2cimko33tr2jidy7j6w5" ≠ correct.
//   Both wrong implementations fail this test — the test IS the regression guard.

const WORMHOLE_SOLANA_CALLDATA =
  "0xc5a5ebda" +
  "000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7" +
  "0000000000000000000000000000000000000000000000000000000ba5850b00" +
  "0000000000000000000000000000000000000000000000000000000000000001" +
  "1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000000000000000c0" +
  "0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

// EXACT base58 encoding of the full 32-byte Solana pubkey (case-sensitive).
// bs58.encode(Buffer.from("1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a", "hex"))
const EXPECTED_SOLANA_RECIPIENT = "2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("decodeWormholeTransferWithPayload — EVM destination (recipientChain 16 Moonbeam)", () => {
  it("returns correct finalRecipient (EIP-55 EVM address from last-20-bytes of bytes32)", () => {
    const result = decodeWormholeTransferWithPayload(WORMHOLE_EVM_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.finalRecipient).toBe(EXPECTED_EVM_RECIPIENT);
    }
  });

  it("returns destinationType 'evm' for EVM dest chain", () => {
    const result = decodeWormholeTransferWithPayload(WORMHOLE_EVM_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.destinationType).toBe("evm");
    }
  });

  it("returns recipientChain 16 (Moonbeam) for the EVM fixture", () => {
    const result = decodeWormholeTransferWithPayload(WORMHOLE_EVM_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.recipientChain).toBe(16);
    }
  });
});

describe("decodeWormholeTransferWithPayload — Solana destination (recipientChain 1)", () => {
  it("returns EXACT mixed-case base58 pubkey (full 32 bytes) for Solana dest — regression guard for T-39-02-SOLANA-NORM", () => {
    // CRITICAL: base58 is CASE-SENSITIVE. This assertion pins the exact mixed-case literal.
    // A naive last-20-bytes extraction OR a .toLowerCase() would produce a different value
    // and fail this test — proving the encoding-aware path is required.
    const result = decodeWormholeTransferWithPayload(WORMHOLE_SOLANA_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.finalRecipient).toBe(EXPECTED_SOLANA_RECIPIENT);
    }
  });

  it("does NOT lowercase the base58 Solana recipient (case-sensitive encoding)", () => {
    const result = decodeWormholeTransferWithPayload(WORMHOLE_SOLANA_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      // If lowercased, this test would fail — proving case-sensitivity is preserved
      expect(result.summary.finalRecipient).not.toBe(
        result.summary.finalRecipient.toLowerCase(),
      );
    }
  });

  it("returns destinationType 'solana' for Solana dest chain", () => {
    const result = decodeWormholeTransferWithPayload(WORMHOLE_SOLANA_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.destinationType).toBe("solana");
    }
  });

  it("returns recipientChain 1 (Solana) for the Solana fixture", () => {
    const result = decodeWormholeTransferWithPayload(WORMHOLE_SOLANA_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.recipientChain).toBe(1);
    }
  });
});

describe("decodeWormholeTransferWithPayload — unsupported destination chain", () => {
  it("returns { kind: 'error' } with message containing 'unsupported' for an unrecognized chain ID", () => {
    // Use recipientChain = 18 which is not in the EVM set and not Solana.
    // Constructed: same as WORMHOLE_EVM_CALLDATA but recipientChain changed to 18 (0x12).
    const unsupportedCalldata =
      "0xc5a5ebda" +
      "000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7" +
      "0000000000000000000000000000000000000000000000000000000ba5850b00" +
      "0000000000000000000000000000000000000000000000000000000000000012" +  // recipientChain = 18
      "0000000000000000000000000000000000000000000000000000000000000816" +
      "0000000000000000000000000000000000000000000000000000000000000000" +
      "00000000000000000000000000000000000000000000000000000000000000c0" +
      "0000000000000000000000000000000000000000000000000000000000000029" +
      "0005010200c91f010045544800e139dd7fc2a49ff20d5c8436ea1bf3301cc979" +
      "f900000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;
    const result = decodeWormholeTransferWithPayload(unsupportedCalldata);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/unsupported/i);
    }
  });
});

describe("decodeWormholeTransferWithPayload — error paths (WR-02: NEVER-throws)", () => {
  it("returns { kind: 'error' } on selector mismatch", () => {
    const result = decodeWormholeTransferWithPayload("0xdeadbeef" as `0x${string}`);
    expect(result.kind).toBe("error");
  });

  it("returns { kind: 'error' } on truncated calldata matching selector", () => {
    const result = decodeWormholeTransferWithPayload("0xc5a5ebda" as `0x${string}`);
    expect(result.kind).toBe("error");
  });

  it("WORMHOLE_SELECTORS.transferTokensWithPayload is the 4-byte selector 0xc5a5ebda", () => {
    expect(WORMHOLE_SELECTORS.transferTokensWithPayload).toBe("0xc5a5ebda");
  });
});

describe("_wormholeHelpers ESM seam", () => {
  it("exports _wormholeHelpers with a decodeFunctionData method", () => {
    expect(typeof _wormholeHelpers.decodeFunctionData).toBe("function");
  });
});
