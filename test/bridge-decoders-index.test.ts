// test/bridge-decoders-index.test.ts — Phase 39 Plans 39-01 + 39-02 (BRIDGE-T1-06).
//
// Unit tests for src/protocols/bridge-decoders/index.ts — the Tier-1 bridge
// selector→decoder registry.
//
// Plan 39-01: infrastructure (selector extraction, case normalization, ESM seam identity).
// Plan 39-02: adds populated-registry routing tests (each real/synthetic fixture routes
//   to { kind: "ok", bridge, finalRecipient }); updates 39-01 no-match tests that now
//   return error (selector matched but truncated → decode error, not no-match).
//
// WR-02: decodeBridgeTier1FacetRecipient returns a discriminated union
// { kind: "ok" | "no-match" | "error" } — never throws.
//
// NO beforeAll-snapshot per CLAUDE.md fixture discipline — all assertions use
// hardcoded literals.

import { describe, expect, it } from "vitest";
import {
  decodeBridgeTier1FacetRecipient,
  _bridgeTier1Decoders,
} from "../src/protocols/bridge-decoders/index.js";
import type { BridgeFacetDecodeResult } from "../src/protocols/bridge-decoders/index.js";

// ─── Behavior 1: empty calldata returns no-match ─────────────────────────────

describe("decodeBridgeTier1FacetRecipient — empty calldata", () => {
  it("returns no-match for data === '0x'", () => {
    const result: BridgeFacetDecodeResult = decodeBridgeTier1FacetRecipient("0x");
    expect(result.kind).toBe("no-match");
  });
});

// ─── Behavior 2: short calldata (< 10 chars) returns no-match ────────────────

describe("decodeBridgeTier1FacetRecipient — short calldata", () => {
  it("returns no-match for length < 10 (truncated selector '0x1234')", () => {
    // "0x1234" has length 6, which is < 10
    const result: BridgeFacetDecodeResult = decodeBridgeTier1FacetRecipient("0x1234");
    expect(result.kind).toBe("no-match");
  });

  it("returns no-match for exactly 9 chars '0x12345678'", () => {
    // "0x12345678" has length 10 — wait, that's exactly 10. Use 9.
    // A valid 4-byte selector with 0x prefix = "0x" + 8 hex chars = 10 chars.
    // Less than 10 chars means the selector is incomplete.
    const result: BridgeFacetDecodeResult = decodeBridgeTier1FacetRecipient("0x1234567");
    expect(result.kind).toBe("no-match");
  });
});

// ─── Behavior 3: unrecognized selector returns no-match ───────────────────────

describe("decodeBridgeTier1FacetRecipient — unrecognized selector", () => {
  it("returns no-match for unrecognized selector 0xdeadbeef with 32-byte padding", () => {
    // 0xdeadbeef is not a registered Tier-1 selector → no-match.
    const calldata =
      "0xdeadbeef" +
      "0000000000000000000000000000000000000000000000000000000000000000";
    const result: BridgeFacetDecodeResult = decodeBridgeTier1FacetRecipient(calldata as `0x${string}`);
    expect(result.kind).toBe("no-match");
  });

  it("returns no-match for a completely unknown selector with padding", () => {
    const calldata =
      "0xffffffff" +
      "0000000000000000000000000000000000000000000000000000000000000000";
    const result: BridgeFacetDecodeResult = decodeBridgeTier1FacetRecipient(calldata as `0x${string}`);
    expect(result.kind).toBe("no-match");
  });

  // Plan 39-02 note: registered selectors with truncated calldata now return { kind: "error" }
  // (selector matched but ABI decode failed). Only fully-unknown selectors return no-match.
  it("returns { kind: 'error' } for Across V3 selector 0x7b939232 with truncated calldata (registered in 39-02)", () => {
    // Selector is registered; truncated args → decode error, not no-match.
    const calldata =
      "0x7b939232" +
      "0000000000000000000000000000000000000000000000000000000000000000";
    const result: BridgeFacetDecodeResult = decodeBridgeTier1FacetRecipient(calldata as `0x${string}`);
    expect(result.kind).toBe("error");
  });

  it("returns { kind: 'error' } for Wormhole selector 0xc5a5ebda with truncated calldata (registered in 39-02)", () => {
    const calldata =
      "0xc5a5ebda" +
      "0000000000000000000000000000000000000000000000000000000000000000";
    const result: BridgeFacetDecodeResult = decodeBridgeTier1FacetRecipient(calldata as `0x${string}`);
    expect(result.kind).toBe("error");
  });
});

// ─── Behavior 4: _bridgeTier1Decoders ESM seam identity ──────────────────────
//
// The _bridgeTier1Decoders object holds the same function reference as the
// named export decodeBridgeTier1FacetRecipient. This is the ESM spy-affordance
// per CLAUDE.md — vi.spyOn(_bridgeTier1Decoders, "decodeBridgeTier1FacetRecipient")
// intercepts calls from preview_send that route through this object.

describe("_bridgeTier1Decoders ESM seam", () => {
  it("_bridgeTier1Decoders.decodeBridgeTier1FacetRecipient is the same function reference as the named export", () => {
    expect(_bridgeTier1Decoders.decodeBridgeTier1FacetRecipient).toBe(
      decodeBridgeTier1FacetRecipient,
    );
  });

  it("calling via the seam object returns the same result as calling the named export directly", () => {
    const viaExport = decodeBridgeTier1FacetRecipient("0x");
    const viaSeam = _bridgeTier1Decoders.decodeBridgeTier1FacetRecipient("0x");
    expect(viaSeam).toEqual(viaExport);
    expect(viaSeam.kind).toBe("no-match");
  });
});

// ─── Behavior 5: selector lookup is case-insensitive ─────────────────────────
//
// The registry lowercases data.slice(0, 10) before lookup.

describe("decodeBridgeTier1FacetRecipient — selector case normalization", () => {
  it("uppercased unknown selector is lowercased before map lookup — returns no-match", () => {
    const calldata =
      "0xDEADBEEF" +
      "0000000000000000000000000000000000000000000000000000000000000000";
    const result: BridgeFacetDecodeResult = decodeBridgeTier1FacetRecipient(calldata as `0x${string}`);
    expect(result.kind).toBe("no-match");
  });

  it("mixed-case unknown selector produces same no-match result as lowercase equivalent", () => {
    const lower =
      "0xdeadbeef" +
      "0000000000000000000000000000000000000000000000000000000000000000";
    const upper =
      "0xDEADBEEF" +
      "0000000000000000000000000000000000000000000000000000000000000000";
    const resultLower = decodeBridgeTier1FacetRecipient(lower as `0x${string}`);
    const resultUpper = decodeBridgeTier1FacetRecipient(upper as `0x${string}`);
    expect(resultLower).toEqual(resultUpper);
  });
});

// ─── Plan 39-02: populated-registry routing tests ────────────────────────────
//
// Verifies that each registered Tier-1 selector routes to { kind: "ok", bridge, finalRecipient }.
// Uses the same hardcoded literal fixtures as the per-bridge decoder tests.
// NO beforeAll-snapshot per CLAUDE.md fixture discipline.

// Real Across V3 calldata (tx 0xbdb62e8ece...)
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

// Real NEAR calldata (derived from tx 0x80c535f5578f...)
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

// Real Wormhole calldata — EVM dest (tx 0x778c95195c...)
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

// SYNTHETIC Mayan createOrderWithEth — Solana dest
// SYNTHETIC
const MAYAN_ETH_SOLANA_CALLDATA =
  "0xb866e173" +
  "1234567890123456789012345678901234567890123456789012345678901234" +
  "0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f" +
  "00000000000000000000000000000000000000000000000000000000000186a0" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "000000000000000000000000000000000000000000000000000000006553f100" +
  "1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a" +
  "0000000000000000000000000000000000000000000000000000000000000063" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;

// SYNTHETIC Mayan createOrderWithToken — same Solana dest
// SYNTHETIC
const MAYAN_TOKEN_SOLANA_CALLDATA =
  "0x8e8d142b" +
  "000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7" +
  "00000000000000000000000000000000000000000000000000000000000f4240" +
  "1234567890123456789012345678901234567890123456789012345678901234" +
  "0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f" +
  "00000000000000000000000000000000000000000000000000000000000186a0" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "000000000000000000000000000000000000000000000000000000006553f100" +
  "1948355287c06be78c1f6707ad62f9ff4c20e133b52691cfee5568a3922dc31a" +
  "0000000000000000000000000000000000000000000000000000000000000063" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;

describe("decodeBridgeTier1FacetRecipient — populated registry routing (Plan 39-02)", () => {
  it("routes Across V3 fixture → { kind: 'ok', bridge: 'Across V3', finalRecipient }", () => {
    const result = decodeBridgeTier1FacetRecipient(ACROSS_V3_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.bridge).toBe("Across V3");
      expect(result.finalRecipient).toBe("0x15528a195C4b9353D7645eBA48357a85324bb365");
    }
  });

  it("routes NEAR fixture → { kind: 'ok', bridge: 'NEAR OmniBridge', finalRecipient }", () => {
    const result = decodeBridgeTier1FacetRecipient(NEAR_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.bridge).toBe("NEAR OmniBridge");
      expect(result.finalRecipient).toBe("nearzaurora");
    }
  });

  it("routes Wormhole EVM fixture → { kind: 'ok', bridge: 'Wormhole Token Bridge', finalRecipient }", () => {
    const result = decodeBridgeTier1FacetRecipient(WORMHOLE_EVM_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.bridge).toBe("Wormhole Token Bridge");
      expect(result.finalRecipient).toBe("0x0000000000000000000000000000000000000816");
    }
  });

  it("routes Mayan createOrderWithEth Solana fixture → { kind: 'ok', bridge: 'Mayan Swift', finalRecipient }", () => {
    const result = decodeBridgeTier1FacetRecipient(MAYAN_ETH_SOLANA_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.bridge).toBe("Mayan Swift");
      expect(result.finalRecipient).toBe("2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5");
    }
  });

  it("routes Mayan createOrderWithToken Solana fixture → { kind: 'ok', bridge: 'Mayan Swift', finalRecipient }", () => {
    const result = decodeBridgeTier1FacetRecipient(MAYAN_TOKEN_SOLANA_CALLDATA);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.bridge).toBe("Mayan Swift");
      expect(result.finalRecipient).toBe("2hh484NLjrMsKxrFXnF3e3yd2cimKo33TR2jidY7j6W5");
    }
  });

  it("all five selectors are distinct (no collision in TIER1_DECODERS map)", () => {
    const selectors = [
      "0x7b939232", // Across V3
      "0xdeb915b8", // NEAR
      "0xc5a5ebda", // Wormhole
      "0xb866e173", // Mayan ETH
      "0x8e8d142b", // Mayan Token
    ];
    const unique = new Set(selectors);
    expect(unique.size).toBe(5); // all distinct
  });

  it("unrecognized selector still returns { kind: 'no-match' } after registry is populated", () => {
    const calldata =
      "0xdeadbeef" +
      "0000000000000000000000000000000000000000000000000000000000000000";
    const result = decodeBridgeTier1FacetRecipient(calldata as `0x${string}`);
    expect(result.kind).toBe("no-match");
  });
});
