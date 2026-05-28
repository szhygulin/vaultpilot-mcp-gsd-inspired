// test/bridge-decoders-near-omnibridge.test.ts — Phase 39 Plan 39-02 (BRIDGE-T1-03).
//
// Unit tests for src/protocols/bridge-decoders/near-omnibridge.ts.
//
// Uses a real mainnet calldata fixture derived from tx
//   0x80c535f5578f4c4e556b7d4831d46234aa11692c7a339fb07a957d3a8cb16b61
// (NEAR OmniBridge initTransfer — confirmed by viem.decodeFunctionData in
// research session 2026-05-28). Calldata re-encoded with viem.encodeFunctionData
// from the verified decoded values (amount=50_961_261_400_000_000n, nativeFee=10_000_000_000_000n,
// recipient="nearzaurora", message="2Be3DF6C50Fb1b11d8189C2d4DE5c16F6712FAc4").
//
// WR-02: decodeNearOmniBridgeTransfer returns { kind: "ok" | "error" } — NEVER throws.
//
// NO beforeAll-snapshot per CLAUDE.md fixture discipline — all assertions use
// hardcoded literals.

import { describe, expect, it } from "vitest";
import {
  decodeNearOmniBridgeTransfer,
  NEAR_SELECTORS,
  _nearHelpers,
} from "../src/protocols/bridge-decoders/near-omnibridge.js";

// ─── Fixture: Real mainnet calldata (re-encoded from verified decode) ─────────
//
// Source: Ethereum mainnet tx 0x80c535f5578f4c4e556b7d4831d46234aa11692c7a339fb07a957d3a8cb16b61
// VERIFIED: viem.decodeFunctionData in research session 2026-05-28.
// Function: initTransfer(address,uint128,uint128,uint128,string,string)
//
// Decoded fields:
//   tokenAddress (args[0]) = 0x0000...0000 (native ETH)
//   amount       (args[1]) = 50_961_261_400_000_000n
//   fee          (args[2]) = 0n
//   nativeFee    (args[3]) = 10_000_000_000_000n
//   recipient    (args[4]) = "nearzaurora"   <-- THE FIELD TO EXTRACT
//   message      (args[5]) = "2Be3DF6C50Fb1b11d8189C2d4DE5c16F6712FAc4"
//
// Note: NEAR account IDs are always lowercase; RESEARCH §Pitfall 3.

const NEAR_CALLDATA =
  "0xdeb915b8" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000000000000000000000000000000000000b50cff4b0d8600" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000009184e72a00000" +
  "00000000000000000000000000000000000000000000000000000000000000c0" +
  "0000000000000000000000000000000000000000000000000000000000000100" +
  "000000000000000000000000000000000000000000000000000000000000000b" +
  "6e6561727a6175726f7261000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000028" +
  "3242653344463643353046623162313164383138394332643444453563313646" +
  "3637313246416334000000000000000000000000000000000000000000000000" as `0x${string}`;

const EXPECTED_RECIPIENT = "nearzaurora"; // lowercase trimmed NEAR account ID
const EXPECTED_MESSAGE = "2Be3DF6C50Fb1b11d8189C2d4DE5c16F6712FAc4";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("decodeNearOmniBridgeTransfer — initTransfer calldata extraction", () => {
  it("returns correct finalRecipient (lowercased NEAR account ID) from real calldata", () => {
    const result = decodeNearOmniBridgeTransfer(NEAR_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.finalRecipient).toBe(EXPECTED_RECIPIENT);
    }
  });

  it("finalRecipient is all-lowercase (NEAR account IDs are case-insensitive; normalized)", () => {
    const result = decodeNearOmniBridgeTransfer(NEAR_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      // NEAR normalization: toLowerCase().trim() — a user-supplied "NearZaurora" would
      // match after the same normalization at preview_send time.
      expect(result.summary.finalRecipient).toBe(
        result.summary.finalRecipient.toLowerCase().trim(),
      );
    }
  });

  it("returns correct message (args[5] — advisory EVM destination, NOT the final recipient)", () => {
    const result = decodeNearOmniBridgeTransfer(NEAR_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.message).toBe(EXPECTED_MESSAGE);
    }
  });

  it("returns { kind: 'error' } on selector mismatch (WR-02: NEVER-throws)", () => {
    const result = decodeNearOmniBridgeTransfer("0xdeadbeef" as `0x${string}`);
    expect(result.kind).toBe("error");
    // Must NOT throw — WR-02
  });

  it("returns { kind: 'error' } on truncated calldata matching selector (WR-02: NEVER-throws)", () => {
    // Selector alone without ABI-encoded args — decodeFunctionData will throw internally
    const result = decodeNearOmniBridgeTransfer("0xdeb915b8" as `0x${string}`);
    expect(result.kind).toBe("error");
    // Must NOT throw — WR-02
  });

  it("NEAR_SELECTORS.initTransfer is the 4-byte selector 0xdeb915b8", () => {
    expect(NEAR_SELECTORS.initTransfer).toBe("0xdeb915b8");
  });
});

describe("_nearHelpers ESM seam", () => {
  it("exports _nearHelpers with a decodeFunctionData method", () => {
    expect(typeof _nearHelpers.decodeFunctionData).toBe("function");
  });
});
