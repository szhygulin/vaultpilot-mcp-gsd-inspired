// Pure selector + decoder + predicate tests for src/protocols/safe.ts.
//
// Phase 38 — Plan 38-01 (SAFE-09). Anchors:
//   - ENABLE_MODULE_SELECTOR === 0x610b5925 byte-identical (universal —
//     drift here breaks Inv #12.5 trigger coupling across every emission
//     site).
//   - decodeEnableModuleCalldata round-trip against Fixture SAFE-G —
//     the hardcoded 0x... literal IS the regression anchor; NO
//     `beforeAll`-snapshot per CLAUDE.md cryptographic-binding-fixture
//     discipline.
//   - isEnableModuleCalldata lowercase-normalization positive case
//     (Tx Service can ship mixed-case calldata).
//   - Truncated-calldata decode throws → INVALID_INPUT refusal surface
//     upstream.
//
// Consumers cross-link header (Inv #12.5 trigger emission sites):
//   - src/tools/prepare_safe_tx_propose.ts
//   - src/tools/prepare_safe_tx_approve.ts
//   - src/tools/prepare_safe_tx_execute.ts
//   - src/tools/preview_send.ts

import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import {
  ENABLE_MODULE_SELECTOR,
  decodeEnableModuleCalldata,
  isEnableModuleCalldata,
} from "../src/protocols/safe.js";

// Fixture SAFE-G — hardcoded literal regression anchor. NO `beforeAll`-snapshot
// per CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals"
// — drift in either the selector or the argument-padding shape MUST fail at
// a specific line, not pass against a self-snapshotted value.
//
// Module address embedded at the 32-byte left-padded slot: the last 40 hex
// chars of the calldata after the selector. Lowercased to bypass viem's
// EIP-55 checksum validation at decode time (same as Phase 37 Fixture SAFE-B
// Rule 1 deviation).
export const FIXTURE_SAFE_G_CALLDATA: Hex =
  "0x610b5925000000000000000000000000cafe0000000000000000000000000000cafe0001";
export const FIXTURE_SAFE_G_MODULE_ADDRESS: Address =
  "0xcafe0000000000000000000000000000cafe0001";

describe("ENABLE_MODULE_SELECTOR — universal selector regression anchor", () => {
  it("equals 0x610b5925 byte-identical (canonical Safe enableModule selector)", () => {
    expect(ENABLE_MODULE_SELECTOR).toBe("0x610b5925");
  });
});

describe("isEnableModuleCalldata — predicate positive cases", () => {
  it("returns true for Fixture SAFE-G calldata (selector match)", () => {
    expect(isEnableModuleCalldata(FIXTURE_SAFE_G_CALLDATA)).toBe(true);
  });

  it("returns true for mixed-case selector (lowercase normalization — Tx Service can ship mixed case)", () => {
    // Hand-craft a mixed-case version of the SAFE-G calldata; selector prefix
    // is uppercased.
    const mixedCase =
      "0x610B5925000000000000000000000000cafe0000000000000000000000000000cafe0001" as Hex;
    expect(isEnableModuleCalldata(mixedCase)).toBe(true);
  });
});

describe("isEnableModuleCalldata — predicate negative cases", () => {
  it("returns false for empty data ('0x')", () => {
    expect(isEnableModuleCalldata("0x")).toBe(false);
  });

  it("returns false for wrong selector (any non-0x610b5925 prefix)", () => {
    expect(
      isEnableModuleCalldata("0x12345678abcdef" as Hex),
    ).toBe(false);
  });

  it("returns false for too-short data (< 10 chars)", () => {
    expect(isEnableModuleCalldata("0x610b59" as Hex)).toBe(false);
  });
});

describe("decodeEnableModuleCalldata — Fixture SAFE-G round-trip", () => {
  it("decodes Fixture SAFE-G to the embedded module address (case-insensitive compare)", () => {
    const { module } = decodeEnableModuleCalldata(FIXTURE_SAFE_G_CALLDATA);
    expect(module.toLowerCase()).toBe(FIXTURE_SAFE_G_MODULE_ADDRESS);
  });
});

describe("decodeEnableModuleCalldata — refusal paths", () => {
  it("throws on truncated calldata (selector match but argument decode fails)", () => {
    expect(() =>
      decodeEnableModuleCalldata("0x610b5925cafe" as Hex),
    ).toThrow();
  });

  it("throws on calldata whose decoded functionName != 'enableModule' (defensive guard against selector mismatch caller didn't pre-check)", () => {
    // The decoder's `parseAbi(["function enableModule(address module)"])`
    // ABI matches by selector. A calldata whose 4-byte prefix doesn't match
    // 0x610b5925 makes viem's decodeFunctionData throw
    // AbiFunctionSignatureNotFoundError (NOT a functionName-mismatch). Both
    // surface as a thrown error → INVALID_INPUT at the caller site.
    expect(() =>
      decodeEnableModuleCalldata(
        "0xa9059cbb000000000000000000000000cafe0000000000000000000000000000cafe0001" as Hex,
      ),
    ).toThrow();
  });
});
