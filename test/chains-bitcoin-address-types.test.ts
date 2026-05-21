// src/chains/bitcoin/types.ts — branded BTC address types (Phase 22
// Plan 22-01). Mirror of `test/chains-tron-address.test.ts` shape, but
// adapted to two distinct address brands (segwit BIP-173 bech32 +
// taproot BIP-350 bech32m) and the two-gate `regex + bitcoinjs-lib`
// validator.
//
// Coverage:
//   1. Valid segwit (`bc1q…`) passes
//   2. Valid taproot (`bc1p…`) passes
//   3. Mixed case rejected (BIP-173 forbids mixed case)
//   4. Cross-encoding rejected (segwit-shaped string in taproot slot, vice versa)
//   5. Empty / non-string rejected with TypeError
//   6. Truncated / oversized lengths rejected by regex
//   7. Regex first-line gate runs BEFORE the bitcoinjs-lib library
//      call (verified via spy on `address.toOutputScript`)

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BTC_SEGWIT_RE,
  BTC_TAPROOT_RE,
  assertBtcSegwitAddress,
  assertBtcTaprootAddress,
} from "../src/chains/bitcoin/types.js";

// Known-valid bech32 P2WPKH segwit (BIP-173 reference, length 42).
const VALID_SEGWIT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

// Known-valid bech32m P2TR taproot (BIP-350 reference, length 62).
// This is the BIP-86 test vector address — bc1p + 58 data chars.
const VALID_TAPROOT =
  "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("src/chains/bitcoin/types.ts — assertBtcSegwitAddress two-gate validation", () => {
  it("Test 1 — VALID segwit address passes (regex + bitcoinjs-lib checksum)", () => {
    expect(() => assertBtcSegwitAddress(VALID_SEGWIT)).not.toThrow();
  });

  it("Test 2 — cross-encoding REJECTED: taproot (bc1p…) in segwit slot throws TypeError on regex first-line gate", () => {
    expect(() => assertBtcSegwitAddress(VALID_TAPROOT)).toThrowError(TypeError);
    // Confirm the error message names the regex gate, not the lib gate —
    // the regex MUST catch this BEFORE the library call.
    try {
      assertBtcSegwitAddress(VALID_TAPROOT);
    } catch (err) {
      expect((err as Error).message).toMatch(/does not match bc1q/);
    }
  });

  it("Test 3 — mixed case REJECTED: uppercase BC1Q… fails regex first-line gate", () => {
    expect(() =>
      assertBtcSegwitAddress("BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ"),
    ).toThrowError(TypeError);
  });

  it("Test 4 — corrupted checksum REJECTED: regex passes, lib gate fails (catches bech32 checksum error)", () => {
    // Flip the last character of VALID_SEGWIT: regex still matches (still
    // bc1q + 38 lowercase base32 chars), but the bech32 checksum will fail.
    const corrupted =
      VALID_SEGWIT.slice(0, -1) +
      (VALID_SEGWIT.slice(-1) === "a" ? "z" : "a");
    expect(() => assertBtcSegwitAddress(corrupted)).toThrowError(TypeError);
    try {
      assertBtcSegwitAddress(corrupted);
    } catch (err) {
      // Either rejected by regex (if the flipped char isn't in alphabet)
      // or by the bech32 checksum check (lib gate). Both are valid
      // failure modes; the test asserts SOMETHING throws.
      expect((err as Error).message).toMatch(/Not a valid BTC segwit address/);
    }
  });

  it("Test 5 — non-string REJECTED with TypeError", () => {
    expect(() => assertBtcSegwitAddress(null)).toThrowError(TypeError);
    expect(() => assertBtcSegwitAddress(undefined)).toThrowError(TypeError);
    expect(() => assertBtcSegwitAddress(42)).toThrowError(TypeError);
    expect(() => assertBtcSegwitAddress({})).toThrowError(TypeError);
  });

  it("Test 6 — truncated length REJECTED by regex", () => {
    expect(() => assertBtcSegwitAddress("bc1q")).toThrowError(TypeError);
    expect(() =>
      assertBtcSegwitAddress(VALID_SEGWIT.slice(0, -1)),
    ).toThrowError(TypeError);
  });

  it("Test 7 — empty string REJECTED with TypeError", () => {
    expect(() => assertBtcSegwitAddress("")).toThrowError(TypeError);
  });
});

describe("src/chains/bitcoin/types.ts — assertBtcTaprootAddress two-gate validation", () => {
  it("Test 8 — VALID taproot address passes (regex + bitcoinjs-lib checksum)", () => {
    expect(() => assertBtcTaprootAddress(VALID_TAPROOT)).not.toThrow();
  });

  it("Test 9 — cross-encoding REJECTED: segwit (bc1q…) in taproot slot throws TypeError on regex first-line gate", () => {
    expect(() => assertBtcTaprootAddress(VALID_SEGWIT)).toThrowError(TypeError);
    try {
      assertBtcTaprootAddress(VALID_SEGWIT);
    } catch (err) {
      expect((err as Error).message).toMatch(/does not match bc1p/);
    }
  });

  it("Test 10 — mixed case REJECTED: uppercase BC1P… fails regex first-line gate", () => {
    expect(() =>
      assertBtcTaprootAddress(VALID_TAPROOT.toUpperCase()),
    ).toThrowError(TypeError);
  });

  it("Test 11 — non-string REJECTED with TypeError", () => {
    expect(() => assertBtcTaprootAddress(null)).toThrowError(TypeError);
    expect(() => assertBtcTaprootAddress(undefined)).toThrowError(TypeError);
    expect(() => assertBtcTaprootAddress(false)).toThrowError(TypeError);
  });

  it("Test 12 — truncated length REJECTED by regex", () => {
    expect(() => assertBtcTaprootAddress("bc1p")).toThrowError(TypeError);
    expect(() =>
      assertBtcTaprootAddress(VALID_TAPROOT.slice(0, -1)),
    ).toThrowError(TypeError);
  });
});

describe("src/chains/bitcoin/types.ts — regex first-line gate runs BEFORE bitcoinjs-lib call", () => {
  // ESM-immutability note: `bitcoinjs-lib.address.toOutputScript` is a
  // non-configurable namespace export — `vi.spyOn(btcAddress, ...)` is a
  // silent no-op (and in newer V8 throws "Cannot redefine property").
  // The two-gate ordering is asserted indirectly via error-message
  // shape: regex-only failures name the regex shape ("does not match
  // bc1q..." / "does not match bc1p..."), while lib-only failures name
  // "failed bech32 checksum" / "failed bech32m checksum".

  it("Test 13 — regex-failing segwit input fails with the regex-shape message (NOT the lib-checksum message)", () => {
    try {
      assertBtcSegwitAddress("not-a-bech32-address");
      throw new Error("expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/does not match bc1q/);
      expect(msg).not.toMatch(/failed bech32 checksum/);
    }
  });

  it("Test 13b — regex-failing taproot input fails with the regex-shape message (NOT the lib-checksum message)", () => {
    try {
      assertBtcTaprootAddress("garbage");
      throw new Error("expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/does not match bc1p/);
      expect(msg).not.toMatch(/failed bech32m checksum/);
    }
  });
});

describe("src/chains/bitcoin/types.ts — regex shape anchors", () => {
  it("Test 14 — BTC_SEGWIT_RE: bc1q + 38 data chars (total 42)", () => {
    expect(BTC_SEGWIT_RE.test(VALID_SEGWIT)).toBe(true);
    expect(VALID_SEGWIT.length).toBe(42);
    // 1-char short fails.
    expect(BTC_SEGWIT_RE.test(VALID_SEGWIT.slice(0, -1))).toBe(false);
    // 1-char over fails.
    expect(BTC_SEGWIT_RE.test(VALID_SEGWIT + "q")).toBe(false);
  });

  it("Test 15 — BTC_TAPROOT_RE: bc1p + 58 data chars (total 62)", () => {
    expect(BTC_TAPROOT_RE.test(VALID_TAPROOT)).toBe(true);
    expect(VALID_TAPROOT.length).toBe(62);
    expect(BTC_TAPROOT_RE.test(VALID_TAPROOT.slice(0, -1))).toBe(false);
    expect(BTC_TAPROOT_RE.test(VALID_TAPROOT + "q")).toBe(false);
  });

  it("Test 16 — segwit regex rejects bc1p… (taproot prefix)", () => {
    expect(BTC_SEGWIT_RE.test(VALID_TAPROOT)).toBe(false);
  });

  it("Test 17 — taproot regex rejects bc1q… (segwit prefix)", () => {
    expect(BTC_TAPROOT_RE.test(VALID_SEGWIT)).toBe(false);
  });
});
