// test/bridge-decoders-mayan-swift.test.ts — Phase 39 Plan 39-02 (BRIDGE-T1-02).
//
// Unit tests for src/protocols/bridge-decoders/mayan-swift.ts.
//
// All fixtures are SYNTHETIC (no direct createOrderWithEth mainnet tx found in
// contract history — RESEARCH.md §Open Q3). ABI confirmed from Etherscan;
// fixtures are ABI-encoded programmatically from known inputs.
//
// Three fixtures:
//   1. SYNTHETIC createOrderWithEth — Solana dest, destAddr = known Solana bytes32
//      → bs58 of full 32 bytes = "2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5"
//   2. SYNTHETIC createOrderWithToken — same OrderParams at args[2] (RESEARCH §Pitfall 6)
//      → same finalRecipient (proves correct tuple-index extraction)
//   3. SYNTHETIC createOrderWithEth — EVM dest (12 leading zero bytes in destAddr)
//      → getAddress(last-20-bytes) = 0x15528a195C4b9353D7645eBA48357a85324bb365
//
// CRITICAL: base58 is CASE-SENSITIVE. The Solana test pins an EXACT mixed-case literal.
//   A naive .toLowerCase() or last-20-bytes extraction fails this test.
//
// WR-02: decodeMayanSwiftOrder returns { kind: "ok" | "error" } — NEVER throws.
//
// NO beforeAll-snapshot per CLAUDE.md fixture discipline — all assertions use
// hardcoded literals.

import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  decodeMayanSwiftOrder,
  MAYAN_SWIFT_SELECTORS,
  _mayanSwiftHelpers,
} from "../src/protocols/bridge-decoders/mayan-swift.js";

// ─── Fixture 1: SYNTHETIC createOrderWithEth — Solana dest ───────────────────
//
// SYNTHETIC — no direct createOrderWithEth mainnet tx found in contract history.
// ABI confirmed from Etherscan; fixture is programmatically encoded.
//
// OrderParams tuple at args[0]:
//   [7] destAddr  = 0x1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a
//       (Solana pubkey bytes32 — confirmed from LiFi routing tx, RESEARCH §Mayan)
//   [8] destChainId = 99 (non-zero-padded Mayan chain ID — structural test: not 12 leading zeros → Solana path)
//
// bs58.encode(full 32 bytes) = "2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5"
// VERIFIED: bs58.encode in research session 2026-05-28.

// SYNTHETIC
const MAYAN_ETH_SOLANA_CALLDATA =
  "0xb866e173" +
  "1234567890123456789012345678901234567890123456789012345678901234" +  // [0] trader
  "0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f" +  // [1] tokenOut
  "00000000000000000000000000000000000000000000000000000000000186a0" +  // [2] minAmountOut
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [3] gasDrop
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [4] cancelFee
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [5] refundFee
  "000000000000000000000000000000000000000000000000000000006553f100" +  // [6] deadline
  "1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a" +  // [7] destAddr (Solana bytes32)
  "0000000000000000000000000000000000000000000000000000000000000063" +  // [8] destChainId = 99
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [9] referrerAddr
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [10] referrerBps
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [11] auctionMode
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`; // [12] random

// CRITICAL: EXACT mixed-case base58 string — case-sensitive, no truncation.
const EXPECTED_SOLANA_RECIPIENT = "2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5";

// ─── Fixture 2: SYNTHETIC createOrderWithToken — same Solana OrderParams ──────
//
// SYNTHETIC — same OrderParams as above but tuple at args[2] (not args[0]).
// Function: createOrderWithToken(address tokenIn, uint256 amountIn, OrderParams params)
// RESEARCH §Pitfall 6: extracting from the wrong index (args[0]) yields garbage.

// SYNTHETIC
const MAYAN_TOKEN_SOLANA_CALLDATA =
  "0x8e8d142b" +
  "000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7" +  // tokenIn (USDT)
  "00000000000000000000000000000000000000000000000000000000000f4240" +  // amountIn = 1_000_000
  "1234567890123456789012345678901234567890123456789012345678901234" +  // [0] trader
  "0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f" +  // [1] tokenOut
  "00000000000000000000000000000000000000000000000000000000000186a0" +  // [2] minAmountOut
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [3] gasDrop
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [4] cancelFee
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [5] refundFee
  "000000000000000000000000000000000000000000000000000000006553f100" +  // [6] deadline
  "1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a" +  // [7] destAddr (Solana bytes32)
  "0000000000000000000000000000000000000000000000000000000000000063" +  // [8] destChainId = 99
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [9] referrerAddr
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [10] referrerBps
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [11] auctionMode
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`; // [12] random

// ─── Fixture 3: SYNTHETIC createOrderWithEth — EVM dest ──────────────────────
//
// SYNTHETIC — destAddr has 12 leading zero bytes (EVM-padded address).
// destChainId = 2 (Ethereum), but structural test (12 leading zeros) determines EVM path.
// destAddr = 0x00000000000000000000000015528a195c4b9353d7645eba48357a85324bb365

// SYNTHETIC
const MAYAN_ETH_EVM_CALLDATA =
  "0xb866e173" +
  "1234567890123456789012345678901234567890123456789012345678901234" +  // [0] trader
  "0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f" +  // [1] tokenOut
  "00000000000000000000000000000000000000000000000000000000000186a0" +  // [2] minAmountOut
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [3] gasDrop
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [4] cancelFee
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [5] refundFee
  "000000000000000000000000000000000000000000000000000000006553f100" +  // [6] deadline
  "00000000000000000000000015528a195c4b9353d7645eba48357a85324bb365" +  // [7] destAddr (EVM — 12 zero bytes + address)
  "0000000000000000000000000000000000000000000000000000000000000002" +  // [8] destChainId = 2 (Ethereum)
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [9] referrerAddr
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [10] referrerBps
  "0000000000000000000000000000000000000000000000000000000000000000" +  // [11] auctionMode
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`; // [12] random

const EXPECTED_EVM_RECIPIENT = getAddress("0x15528a195c4b9353d7645eba48357a85324bb365");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("decodeMayanSwiftOrder — createOrderWithEth — Solana dest (bytes32 pubkey)", () => {
  it("returns EXACT mixed-case base58 pubkey (full 32 bytes) for Solana dest — regression guard for T-39-02-SOLANA-NORM", () => {
    // CRITICAL: base58 is CASE-SENSITIVE. This assertion pins the exact mixed-case literal.
    // Naive last-20-bytes OR .toLowerCase() produces a wrong value and fails this test.
    const result = decodeMayanSwiftOrder(MAYAN_ETH_SOLANA_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.finalRecipient).toBe(EXPECTED_SOLANA_RECIPIENT);
    }
  });

  it("returns destinationType 'solana' for Solana dest", () => {
    const result = decodeMayanSwiftOrder(MAYAN_ETH_SOLANA_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.destinationType).toBe("solana");
    }
  });
});

describe("decodeMayanSwiftOrder — createOrderWithToken — Solana dest (tuple at args[2])", () => {
  it("extracts destAddr from args[2] tuple (not args[0]) — proves RESEARCH §Pitfall 6 is handled", () => {
    // If decoder incorrectly reads from args[0] (the tokenIn address slot), it would
    // extract a garbage value instead of the correct Solana pubkey.
    const result = decodeMayanSwiftOrder(MAYAN_TOKEN_SOLANA_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.finalRecipient).toBe(EXPECTED_SOLANA_RECIPIENT);
    }
  });

  it("createOrderWithToken yields same finalRecipient as createOrderWithEth for same OrderParams", () => {
    const ethResult = decodeMayanSwiftOrder(MAYAN_ETH_SOLANA_CALLDATA);
    const tokenResult = decodeMayanSwiftOrder(MAYAN_TOKEN_SOLANA_CALLDATA);
    expect(ethResult.kind).toBe("ok");
    expect(tokenResult.kind).toBe("ok");
    if (ethResult.kind === "ok" && tokenResult.kind === "ok") {
      expect(ethResult.summary.finalRecipient).toBe(tokenResult.summary.finalRecipient);
    }
  });
});

describe("decodeMayanSwiftOrder — createOrderWithEth — EVM dest (leading-12-zero-bytes)", () => {
  it("returns EIP-55 checksummed EVM address for EVM dest (leading 12 zero bytes in destAddr)", () => {
    const result = decodeMayanSwiftOrder(MAYAN_ETH_EVM_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.finalRecipient).toBe(EXPECTED_EVM_RECIPIENT);
    }
  });

  it("returns destinationType 'evm' for EVM dest", () => {
    const result = decodeMayanSwiftOrder(MAYAN_ETH_EVM_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.summary.destinationType).toBe("evm");
    }
  });
});

describe("decodeMayanSwiftOrder — error paths (WR-02: NEVER-throws)", () => {
  it("returns { kind: 'error' } on selector mismatch (not a Mayan createOrder call)", () => {
    const result = decodeMayanSwiftOrder("0xdeadbeef" as `0x${string}`);
    expect(result.kind).toBe("error");
  });

  it("returns { kind: 'error' } on truncated createOrderWithEth calldata", () => {
    const result = decodeMayanSwiftOrder("0xb866e173" as `0x${string}`);
    expect(result.kind).toBe("error");
  });

  it("returns { kind: 'error' } on truncated createOrderWithToken calldata", () => {
    const result = decodeMayanSwiftOrder("0x8e8d142b" as `0x${string}`);
    expect(result.kind).toBe("error");
  });

  it("MAYAN_SWIFT_SELECTORS.createOrderWithEth is 0xb866e173", () => {
    expect(MAYAN_SWIFT_SELECTORS.createOrderWithEth).toBe("0xb866e173");
  });

  it("MAYAN_SWIFT_SELECTORS.createOrderWithToken is 0x8e8d142b", () => {
    expect(MAYAN_SWIFT_SELECTORS.createOrderWithToken).toBe("0x8e8d142b");
  });
});

describe("_mayanSwiftHelpers ESM seam", () => {
  it("exports _mayanSwiftHelpers with decodeWithEth and decodeWithToken methods", () => {
    expect(typeof _mayanSwiftHelpers.decodeWithEth).toBe("function");
    expect(typeof _mayanSwiftHelpers.decodeWithToken).toBe("function");
  });
});
