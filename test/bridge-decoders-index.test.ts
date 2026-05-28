// test/bridge-decoders-index.test.ts — Phase 39 Plan 39-01 (BRIDGE-T1-06 skeleton).
//
// Unit tests for src/protocols/bridge-decoders/index.ts — the Tier-1 bridge
// selector→decoder registry skeleton.
//
// In Plan 39-01, the TIER1_DECODERS map is empty — no decoders are registered
// until Plan 39-02 populates it. All inputs return { kind: "no-match" }.
//
// Plan 39-02 will add per-bridge tests; these tests cover the registry
// dispatch infrastructure itself (selector extraction, case normalization,
// ESM seam identity, and the no-match skeleton behavior).
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
//
// The TIER1_DECODERS map is empty in Plan 39-01. Any selector — even one that
// would be a real Tier-1 bridge selector in Plan 39-02 — returns no-match here.

describe("decodeBridgeTier1FacetRecipient — unrecognized selector (empty registry)", () => {
  it("returns no-match for unrecognized selector 0xdeadbeef with 32-byte padding", () => {
    // Selector 0xdeadbeef + 32 zero bytes of ABI padding (not a known Tier-1 selector in 39-01)
    const calldata =
      "0xdeadbeef" +
      "0000000000000000000000000000000000000000000000000000000000000000";
    const result: BridgeFacetDecodeResult = decodeBridgeTier1FacetRecipient(calldata as `0x${string}`);
    expect(result.kind).toBe("no-match");
  });

  it("returns no-match for Across V3 selector 0x7b939232 (not yet registered in 39-01)", () => {
    // This selector will be registered in Plan 39-02. In 39-01 it returns no-match.
    const calldata =
      "0x7b939232" +
      "0000000000000000000000000000000000000000000000000000000000000000";
    const result: BridgeFacetDecodeResult = decodeBridgeTier1FacetRecipient(calldata as `0x${string}`);
    expect(result.kind).toBe("no-match");
  });

  it("returns no-match for Wormhole selector 0xc5a5ebda (not yet registered in 39-01)", () => {
    const calldata =
      "0xc5a5ebda" +
      "0000000000000000000000000000000000000000000000000000000000000000";
    const result: BridgeFacetDecodeResult = decodeBridgeTier1FacetRecipient(calldata as `0x${string}`);
    expect(result.kind).toBe("no-match");
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
// The registry lowercases data.slice(0, 10) before lookup. This means
// uppercase selectors also return no-match (not an error) — they're looked up
// in the (empty) map and not found.

describe("decodeBridgeTier1FacetRecipient — selector case normalization", () => {
  it("uppercased selector is lowercased before map lookup — returns no-match (not error)", () => {
    // "0xDEADBEEF" uppercased — after toLowerCase → "0xdeadbeef" → not in empty map → no-match
    const calldata =
      "0xDEADBEEF" +
      "0000000000000000000000000000000000000000000000000000000000000000";
    const result: BridgeFacetDecodeResult = decodeBridgeTier1FacetRecipient(calldata as `0x${string}`);
    expect(result.kind).toBe("no-match");
  });

  it("mixed-case selector produces same no-match result as lowercase equivalent", () => {
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
