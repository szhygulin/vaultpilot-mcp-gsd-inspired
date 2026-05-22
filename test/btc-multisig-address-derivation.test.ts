// test/btc-multisig-address-derivation.test.ts — Phase 25 Plan 25-01 Task 1
//
// Descriptor parsing accept/reject tests + BIP-67-sorted P2WSH address
// derivation determinism.
//
// Test xpubs: account-level xpubs derived from BIP-32 test vector 1
// seed (000102030405060708090a0b0c0d0e0f) at paths:
//   m/84'/0'/0' → xpub6C1HVMz946r433QEjZGpYYWYcspxXXBPys5PBGkmQboRXE6RLfFiStEkKbWKCZaPgDrzZh9nUEunxuiuy6MNdw23du2Ek7GoKYMJVH8eK5E
//   m/84'/0'/1' → xpub6C1HVMz946r45SLqXksZWuaVdbpznU1s5peogGPTXqkHcXChkh7TN9vC2mgcSFkdA5YpX94xfAPWZTPoDJhGbUdVwF13RfkY9ioGHSLEuUE
//   m/84'/0'/2' → xpub6C1HVMz946r488Vd17BsrsybenwSabqNkg5b42wvkZKnru8Wzgp56AaLERXpDastZzbDMWFpcEh9TJy64YHEnfRg2Se6Zj4W88srAcemued
//
// BIP-67 P2WSH address at change=0, index=0:
//   bc1q89z49nyykvr86hpyw3h34097336s095suwa2hflyvelsmnvp4xvsfw4cnj
// BIP-67 P2WSH address at change=0, index=1:
//   bc1qkc9ehz2vq23757a4hzv2gt86n708eq8s6vhcq95stsv6xlw4sjmqza7crd
//
// These literals were computed once (2026-05-22) by running BIP32Factory +
// bitcoinjs-lib payments.p2ms + p2wsh and are hardcoded per CLAUDE.md
// cryptographic-binding fixture discipline — no beforeAll-snapshot.

import { describe, expect, it } from "vitest";

import {
  deriveMultisigAddress,
  extractXpubFromKeyExpr,
  parseWshSortedMulti,
} from "../src/wallet/btc-multisig-store.js";

// --------------------------------------------------------------------------
// BIP-32 test vector xpubs (account-level, from seed 000102030405060708090a0b0c0d0e0f)
// These are neutered xpubs — no private key material.
// --------------------------------------------------------------------------
const TEST_XPUB_0 = "xpub6C1HVMz946r433QEjZGpYYWYcspxXXBPys5PBGkmQboRXE6RLfFiStEkKbWKCZaPgDrzZh9nUEunxuiuy6MNdw23du2Ek7GoKYMJVH8eK5E";
const TEST_XPUB_1 = "xpub6C1HVMz946r45SLqXksZWuaVdbpznU1s5peogGPTXqkHcXChkh7TN9vC2mgcSFkdA5YpX94xfAPWZTPoDJhGbUdVwF13RfkY9ioGHSLEuUE";
const TEST_XPUB_2 = "xpub6C1HVMz946r488Vd17BsrsybenwSabqNkg5b42wvkZKnru8Wzgp56AaLERXpDastZzbDMWFpcEh9TJy64YHEnfRg2Se6Zj4W88srAcemued";

// Fake fingerprints used in key expressions (8-hex-char; not real for test fixtures)
const FP0 = "deadbeef";
const FP1 = "cafebabe";
const FP2 = "12345678";

const VALID_2_OF_3_DESCRIPTOR = `wsh(sortedmulti(2,[${FP0}/84'/0'/0']${TEST_XPUB_0}/**,[${FP1}/84'/0'/0']${TEST_XPUB_1}/**,[${FP2}/84'/0'/0']${TEST_XPUB_2}/**))`;

describe("parseWshSortedMulti — accepts valid descriptors", () => {
  it("parses a 2-of-3 wsh(sortedmulti(...)) descriptor", () => {
    const result = parseWshSortedMulti(VALID_2_OF_3_DESCRIPTOR);
    expect(result).not.toBeNull();
    expect(result?.m).toBe(2);
    expect(result?.keys).toHaveLength(3);
  });

  it("parses a 1-of-2 descriptor", () => {
    const desc = `wsh(sortedmulti(1,[${FP0}/84'/0'/0']${TEST_XPUB_0}/**,[${FP1}/84'/0'/0']${TEST_XPUB_1}/**))`;
    const result = parseWshSortedMulti(desc);
    expect(result).not.toBeNull();
    expect(result?.m).toBe(1);
    expect(result?.keys).toHaveLength(2);
  });

  it("parses a 3-of-3 descriptor", () => {
    const desc = `wsh(sortedmulti(3,[${FP0}/84'/0'/0']${TEST_XPUB_0}/**,[${FP1}/84'/0'/0']${TEST_XPUB_1}/**,[${FP2}/84'/0'/0']${TEST_XPUB_2}/**))`;
    const result = parseWshSortedMulti(desc);
    expect(result).not.toBeNull();
    expect(result?.m).toBe(3);
  });

  it("accepts bare xpub keys (no fingerprint prefix) with /** suffix", () => {
    const desc = `wsh(sortedmulti(2,${TEST_XPUB_0}/**,${TEST_XPUB_1}/**,${TEST_XPUB_2}/**))`;
    const result = parseWshSortedMulti(desc);
    expect(result).not.toBeNull();
    expect(result?.m).toBe(2);
  });
});

describe("parseWshSortedMulti — rejects invalid descriptors", () => {
  it("returns null for M > N (threshold exceeds signer count)", () => {
    // 3-of-2 — M > N
    const desc = `wsh(sortedmulti(3,[${FP0}/84'/0'/0']${TEST_XPUB_0}/**,[${FP1}/84'/0'/0']${TEST_XPUB_1}/**))`;
    expect(parseWshSortedMulti(desc)).toBeNull();
  });

  it("returns null for M < 1 (zero threshold is insecure and invalid)", () => {
    const desc = `wsh(sortedmulti(0,[${FP0}/84'/0'/0']${TEST_XPUB_0}/**,[${FP1}/84'/0'/0']${TEST_XPUB_1}/**))`;
    expect(parseWshSortedMulti(desc)).toBeNull();
  });

  it("returns null for a /0/* key expression suffix (single-level wildcard)", () => {
    // Pitfall 6: /0/* should be refused; only /** (double-wildcard) is accepted
    const desc = `wsh(sortedmulti(2,[${FP0}/84'/0'/0']${TEST_XPUB_0}/0/*,[${FP1}/84'/0'/0']${TEST_XPUB_1}/**))`;
    expect(parseWshSortedMulti(desc)).toBeNull();
  });

  it("returns null for a /* key expression suffix (no change level)", () => {
    // Pitfall 6: /* should be refused; only /** is accepted
    const desc = `wsh(sortedmulti(2,[${FP0}/84'/0'/0']${TEST_XPUB_0}/*,[${FP1}/84'/0'/0']${TEST_XPUB_1}/**))`;
    expect(parseWshSortedMulti(desc)).toBeNull();
  });

  it("returns null for a key expression with no derivation suffix", () => {
    const desc = `wsh(sortedmulti(2,[${FP0}/84'/0'/0']${TEST_XPUB_0},[${FP1}/84'/0'/0']${TEST_XPUB_1}/**))`;
    expect(parseWshSortedMulti(desc)).toBeNull();
  });

  it("returns null for non-wsh descriptor (p2sh)", () => {
    const desc = `sh(sortedmulti(2,[${FP0}/84'/0'/0']${TEST_XPUB_0}/**,[${FP1}/84'/0'/0']${TEST_XPUB_1}/**))`;
    expect(parseWshSortedMulti(desc)).toBeNull();
  });

  it("returns null for a plain string", () => {
    expect(parseWshSortedMulti("not-a-descriptor")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseWshSortedMulti("")).toBeNull();
  });
});

describe("extractXpubFromKeyExpr", () => {
  it("extracts fingerprint and xpub from bracketed key expression", () => {
    const keyExpr = `[${FP0}/84'/0'/0']${TEST_XPUB_0}/**`;
    const result = extractXpubFromKeyExpr(keyExpr);
    expect(result.masterFingerprint).toBe(FP0);
    expect(result.xpub).toBe(TEST_XPUB_0);
  });

  it("extracts xpub with null fingerprint from bare key expression", () => {
    const keyExpr = `${TEST_XPUB_0}/**`;
    const result = extractXpubFromKeyExpr(keyExpr);
    expect(result.masterFingerprint).toBeNull();
    expect(result.xpub).toBe(TEST_XPUB_0);
  });

  it("throws on unrecognized key expression format", () => {
    expect(() => extractXpubFromKeyExpr("notanxpub/path")).toThrow();
  });
});

describe("deriveMultisigAddress — BIP-67 P2WSH determinism", () => {
  it("derives stable address for index 0 — hardcoded literal (Fixture: 2-of-3 test vectors)", () => {
    // CRITICAL: This is the hardcoded literal computed from BIP-32 test vector 1 seed
    // at m/84'/0'/0', m/84'/0'/1', m/84'/0'/2' with BIP-67 child pubkey sort.
    // Computed 2026-05-22. Any drift in BIP-67 sort, p2ms, or p2wsh assembly will
    // fail at this specific assertion — per CLAUDE.md cryptographic-binding discipline.
    const address = deriveMultisigAddress(
      [TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2],
      2,
      0, // index 0
    );
    expect(address).toBe("bc1q89z49nyykvr86hpyw3h34097336s095suwa2hflyvelsmnvp4xvsfw4cnj");
  });

  it("derives stable address for index 1 — hardcoded literal", () => {
    const address = deriveMultisigAddress(
      [TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2],
      2,
      1, // index 1
    );
    expect(address).toBe("bc1qkc9ehz2vq23757a4hzv2gt86n708eq8s6vhcq95stsv6xlw4sjmqza7crd");
  });

  it("produces bc1q... (bech32 P2WSH) addresses", () => {
    const address = deriveMultisigAddress(
      [TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2],
      2,
      0,
    );
    // P2WSH mainnet addresses are bech32 starting with bc1q (not bc1p taproot)
    expect(address).toMatch(/^bc1q/);
  });

  it("produces different addresses at different indices (derivation is index-dependent)", () => {
    const addr0 = deriveMultisigAddress([TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2], 2, 0);
    const addr1 = deriveMultisigAddress([TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2], 2, 1);
    const addr4 = deriveMultisigAddress([TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2], 2, 4);
    expect(addr0).not.toBe(addr1);
    expect(addr0).not.toBe(addr4);
    expect(addr1).not.toBe(addr4);
  });

  it("is deterministic — same inputs produce same address", () => {
    const addr1 = deriveMultisigAddress([TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2], 2, 0);
    const addr2 = deriveMultisigAddress([TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2], 2, 0);
    expect(addr1).toBe(addr2);
  });

  it("xpub order in input array is irrelevant — BIP-67 sort produces same address", () => {
    // BIP-67: child pubkeys are sorted AFTER derivation, so input xpub order should NOT matter
    const addrForward = deriveMultisigAddress([TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2], 2, 0);
    const addrReverse = deriveMultisigAddress([TEST_XPUB_2, TEST_XPUB_1, TEST_XPUB_0], 2, 0);
    expect(addrForward).toBe(addrReverse);
  });
});
