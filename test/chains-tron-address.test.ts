// src/chains/tron/address.ts — Phase 17 Plan 17-01.
//
// Coverage:
//   1-3. `accountIndex` — extracts segments[2] from a 5-level BIP-44
//        path. Test 2 is the **REGRESSION ANCHOR per research Pitfall 6**:
//        a reuse of `lastHardenedIndex` from `pair_solana_ledger.ts:109`
//        returns `"0"` here (the address index — last segment) instead
//        of `"3"` (the account slot — segments[2]).
//   4-5. `parseTronAddress` / `formatTronAddress` round-trip via tronweb
//        utils. Hardcoded literal anchor: USDT-TRC20 contract address
//        verified live in research § Topic 4.
//   6-7. `assertTronAddress` two-gate check. Test 6 rejects an EVM-shape
//        address (regex fails first). Test 7 is the
//        **REGRESSION ANCHOR per research Pitfall 4**: a corrupted-
//        last-char of a valid address PASSES the regex; ONLY the
//        `TronWeb.utils.address.isAddress` gate catches the bad
//        checksum. Asserting this throws proves the two-gate check
//        actually invokes the second gate.

import { describe, expect, it } from "vitest";

import {
  accountIndex,
  formatTronAddress,
  parseTronAddress,
} from "../src/chains/tron/address.js";
import { assertTronAddress } from "../src/chains/tron/types.js";

// Known-valid base58check fixture — USDT-TRC20 contract, verified live
// in research § Topic 4. Hardcoded literal anchor: the round-trip
// `parseTronAddress(addr).hex` MUST be exactly the 21-byte hex below.
const FIXTURE_TRC20_USDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const FIXTURE_TRC20_USDT_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c";

describe("src/chains/tron/address.ts — accountIndex (5-level BIP-44 path)", () => {
  it("Test 1 — accountIndex(\"44'/195'/0'/0/0\") returns \"0\" (account slot = segments[2])", () => {
    expect(accountIndex("44'/195'/0'/0/0")).toBe("0");
  });

  it("Test 2 — REGRESSION ANCHOR (research Pitfall 6): accountIndex(\"44'/195'/3'/0/0\") returns \"3\", NOT \"0\". A regression to `segments[segments.length - 1]` (the address index — last segment) would return \"0\" here.", () => {
    expect(accountIndex("44'/195'/3'/0/0")).toBe("3");
    // Belt-and-braces — explicitly assert the regression value is NOT
    // what we got back. If the implementation regresses to segments-last,
    // this assertion fires with a clear "you regressed to lastHardenedIndex"
    // signal.
    expect(accountIndex("44'/195'/3'/0/0")).not.toBe("0");
  });

  it("Test 3 — leading m/ prefix is stripped; account slot still returned", () => {
    expect(accountIndex("m/44'/195'/7'/0/0")).toBe("7");
  });

  it("Test 3b — multi-digit account slot", () => {
    expect(accountIndex("44'/195'/42'/0/0")).toBe("42");
    expect(accountIndex("m/44'/195'/123'/0/0")).toBe("123");
  });

  it("Test 3c — defensive on malformed (returns raw input on short shape; no throw)", () => {
    // Fewer than 3 segments — defensive raw return.
    expect(accountIndex("garbage")).toBe("garbage");
    expect(accountIndex("44'/195'")).toBe("44'/195'");
  });
});

describe("src/chains/tron/address.ts — parseTronAddress / formatTronAddress (round-trip via tronweb utils)", () => {
  it("Test 4 — parseTronAddress(FIXTURE) hex matches hardcoded literal anchor (research § Topic 4 live probe)", () => {
    const { hex, bytes } = parseTronAddress(FIXTURE_TRC20_USDT);
    expect(hex).toBe(FIXTURE_TRC20_USDT_HEX);
    // 21-byte payload: 0x41 prefix + 20-byte address.
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(21);
    expect(bytes[0]).toBe(0x41);
  });

  it("Test 5 — formatTronAddress(hex) is the round-trip inverse of parseTronAddress", () => {
    expect(formatTronAddress(FIXTURE_TRC20_USDT_HEX)).toBe(FIXTURE_TRC20_USDT);
    // Compose: parse then format returns the original.
    const round = formatTronAddress(parseTronAddress(FIXTURE_TRC20_USDT).hex);
    expect(round).toBe(FIXTURE_TRC20_USDT);
  });
});

describe("src/chains/tron/types.ts — assertTronAddress (two-gate check)", () => {
  it("Test 6 — EVM-shape `0x...` address rejected (regex gate fails first; defense-in-depth)", () => {
    expect(() =>
      assertTronAddress("0x1234567890123456789012345678901234567890"),
    ).toThrow(/Not a valid TRON address/);
    // Other obviously-wrong shapes.
    expect(() => assertTronAddress("not-a-tron-address")).toThrow();
    expect(() => assertTronAddress(123)).toThrow();
    expect(() => assertTronAddress(null)).toThrow();
    expect(() => assertTronAddress(undefined)).toThrow();
  });

  it("Test 7 — REGRESSION ANCHOR (research Pitfall 4): corrupted-last-char passes regex but fails base58check/checksum gate", () => {
    // Flip the final `t` to `X` — same shape (T + 33 chars from the
    // base58 alphabet), so the regex PASSES. ONLY the second gate
    // (`TronWeb.utils.address.isAddress` — full base58check + checksum)
    // catches the bad checksum. If this test passes (the throw fires),
    // the two-gate check is actually invoking the second gate.
    expect(() =>
      assertTronAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6X"),
    ).toThrow(/Not a valid TRON address/);
  });

  it("Test 8 — valid TRON address narrows the type (no throw)", () => {
    // Type-narrows on success; no return value to assert. Just no throw.
    expect(() => assertTronAddress(FIXTURE_TRC20_USDT)).not.toThrow();
  });
});
