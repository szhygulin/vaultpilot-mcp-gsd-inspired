// BIP-137 message signing cryptographic-binding fixtures — Litecoin. Phase 26 Plan 26-02.
//
// Purpose: pin the LTC BIP-137 double-SHA256 message hash against a hardcoded literal
// (Fixture Z) so drift in the LTC magic-prefix preimage assembly fails at a specific
// assertion line — NOT via a self-snapshotted `beforeAll`.
//
// IMPORTANT: These are double-SHA256 fixtures (BIP-137 message hash), NOT keccak256
// payloadFingerprint fixtures. Do NOT confuse Fixture Z with Fixture Y:
//   - Fixture Y (test/signing-fingerprint.test.ts): keccak256 payloadFingerprint over
//     LTC BIP-143 per-input sighashes, domain tag "VaultPilot-ltctx-v1:".
//   - Fixture Z (this file): double-SHA256 of the LTC BIP-137 preimage
//     (varint(25) ‖ "Litecoin Signed Message:\n" ‖ varint(len) ‖ message).
//     This is what the Ledger LTC app signs; it is NOT a prepare/preview/send handle.
//
// KEY DISTINCTION from BTC (Fixture W in test/signing-bip137.test.ts):
//   - BTC magic: "Bitcoin Signed Message:\n"  (24 bytes, varint 0x18)
//   - LTC magic: "Litecoin Signed Message:\n" (25 bytes, varint 0x19)
// The 1-byte difference (0x18 vs 0x19 varint prefix) is the cross-chain tamper-detection
// mechanism for signed messages (T-26-05 signing variant).
//
// Cross-link: consumed by test/tools-sign-message-ltc.test.ts (LTC-W-02 tool-level
// coverage — demo refusal, pairing check, response shape, Fixture Z re-anchor for
// the `messageHash` field).

import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

// ─── LTC magic bytes exported constant (mirrors sign_message_ltc.ts export) ──
//
// Used as Fixture Z anchor: the test asserts this hex matches the UTF-8 encoding
// of the LTC magic varint prefix + magic string.
//
// Breakdown:
//   19  = varint(25) — the length of "Litecoin Signed Message:\n" in UTF-8
//   4c697465636f696e205369676e6564204d6573736167653a0a
//       = UTF-8 of "Litecoin Signed Message:\n"
//         ('L'=0x4c 'i'=0x69 't'=0x74 'e'=0x65 'c'=0x63 'o'=0x6f 'i'=0x69
//          'n'=0x6e ' '=0x20 'S'=0x53 'i'=0x69 'g'=0x67 'n'=0x6e 'e'=0x65
//          'd'=0x64 ' '=0x20 'M'=0x4d 'e'=0x65 's'=0x73 's'=0x73 'a'=0x61
//          'g'=0x67 'e'=0x65 ':'=0x3a '\n'=0x0a)
//
// PINNED FOREVER per CLAUDE.md convention.
export const LTC_MAGIC_BYTES_HEX =
  "194c697465636f696e205369676e6564204d6573736167653a0a";

// ─── Helpers (local — mirrors sign_message_ltc.ts helpers) ───────────────────
//
// These helpers are defined here to let the fixture test be self-contained and
// independently verify the LTC preimage assembly. The production module
// (`sign_message_ltc.ts`) exports the same logic; this test file does NOT import
// from it so that the fixture is an independent oracle.

function encodeVarint(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    new DataView(buf.buffer).setUint16(1, n, true); // little-endian
    return buf;
  }
  throw new Error("varint: value too large for BIP-137 message");
}

function computeLtcBip137MessageHash(message: string): string {
  const MAGIC = "Litecoin Signed Message:\n";
  const magicBuf = Buffer.from(MAGIC, "utf8"); // exactly 25 bytes
  const msgBuf = Buffer.from(message, "utf8");
  const preimage = Buffer.concat([
    encodeVarint(magicBuf.length), // 0x19 = 25
    magicBuf,
    encodeVarint(msgBuf.length),
    msgBuf,
  ]);
  const h1 = sha256(preimage);
  const h2 = sha256(h1);
  return `0x${bytesToHex(h2)}`;
}

function computeBtcBip137MessageHash(message: string): string {
  const MAGIC = "Bitcoin Signed Message:\n";
  const magicBuf = Buffer.from(MAGIC, "utf8"); // exactly 24 bytes
  const msgBuf = Buffer.from(message, "utf8");
  const preimage = Buffer.concat([
    encodeVarint(magicBuf.length), // 0x18 = 24
    magicBuf,
    encodeVarint(msgBuf.length),
    msgBuf,
  ]);
  const h1 = sha256(preimage);
  const h2 = sha256(h1);
  return `0x${bytesToHex(h2)}`;
}

// ─── BIP-137 Fixture Z ────────────────────────────────────────────────────────

describe("LTC BIP-137 message signing cryptographic-binding fixtures — Fixture Z", () => {
  // --------------------------------------------------------------------------
  // Fixture Z — LTC BIP-137 double-SHA256 message hash for "Hello VaultPilot".
  //
  // Test message: "Hello VaultPilot" (16 UTF-8 bytes).
  // Preimage: varint(25) ‖ "Litecoin Signed Message:\n" ‖ varint(16) ‖ message
  //         = [0x19] ‖ [25 magic bytes] ‖ [0x10] ‖ [16 message bytes]
  //         = 43 bytes total (vs BTC's 42 — the magic is 1 byte longer).
  // Hash: SHA-256(SHA-256(preimage)) — double-SHA256, NOT single-SHA256.
  //
  // This is the SAME hash the Ledger LTC app computes before signing
  // (the device applies the magic prefix internally; the server computes it
  // independently for the LEDGER BLIND-SIGN HASH block).
  //
  // Fixture computed once at research time via:
  //   node --input-type=module -e "
  //     import { sha256 } from '@noble/hashes/sha256';
  //     import { bytesToHex } from '@noble/hashes/utils';
  //     const MAGIC = 'Litecoin Signed Message:\n';
  //     const magicBuf = Buffer.from(MAGIC, 'utf8');
  //     const msgBuf = Buffer.from('Hello VaultPilot', 'utf8');
  //     const preimage = Buffer.concat([
  //       new Uint8Array([0x19]), magicBuf, new Uint8Array([0x10]), msgBuf
  //     ]);
  //     const h1 = sha256(preimage);
  //     const h2 = sha256(h1);
  //     console.log('0x' + bytesToHex(h2));
  //   "
  //   Output: 0xa36092f90d13deb6c7c45317bfdefd101325fc919e40d46cf0532f7e99e4b676
  //
  // PINNED FOREVER: do NOT replace with a beforeAll-snapshot. Drift in preimage
  // assembly MUST fail at THIS specific assertion line.
  //
  // Cross-link: re-anchored in test/tools-sign-message-ltc.test.ts (plan
  // 26-02 LTC-W-02 tool-level coverage — `messageHash` field assertion).
  // --------------------------------------------------------------------------
  it("Fixture Z — LTC BIP-137 double-SHA256 message hash for 'Hello VaultPilot' → 0xa36092... byte-for-byte", () => {
    const hash = computeLtcBip137MessageHash("Hello VaultPilot");

    // Hardcoded literal anchor (Plan 26-02 — research-time computation pinned
    // forever). Drift in the LTC BIP-137 preimage assembly (magic length,
    // varint encoding, double-SHA256 application) breaks THIS exact assertion.
    //
    // NOTE: This is a double-SHA256 hash, NOT a keccak256 payloadFingerprint.
    // The bit pattern is sha256(sha256(preimage)) — standard Bitcoin/Litecoin hash.
    expect(hash).toBe(
      "0xa36092f90d13deb6c7c45317bfdefd101325fc919e40d46cf0532f7e99e4b676",
    );
  });

  // --------------------------------------------------------------------------
  // Cross-chain distinctness — Fixture Z MUST differ from Fixture W.
  //
  // The same message "Hello VaultPilot" under LTC magic MUST produce a different
  // hash than under BTC magic. This is the cross-chain tamper-detection property
  // for signed messages (T-26-05 signing variant): an LTC sig cannot be replayed
  // as a BTC sig or vice versa, because the preimage magic prefixes differ.
  // --------------------------------------------------------------------------
  it("cross-chain distinctness — Fixture Z (LTC) differs from Fixture W (BTC) for same message", () => {
    const ltcHash = computeLtcBip137MessageHash("Hello VaultPilot");
    const btcHash = computeBtcBip137MessageHash("Hello VaultPilot");

    // LTC: "0xa36092f90d13deb6c7c45317bfdefd101325fc919e40d46cf0532f7e99e4b676"
    // BTC: "0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e" (Fixture W)
    expect(ltcHash).not.toBe(btcHash);

    // Also cross-assert Fixture W is what it was (catch accidental BTC regressions)
    expect(btcHash).toBe(
      "0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e",
    );
  });

  // --------------------------------------------------------------------------
  // LTC magic prefix length invariant.
  // "Litecoin Signed Message:\n" is exactly 25 UTF-8 bytes — varint(25) = 0x19.
  // A wrong magic string (e.g. trailing space, wrong newline, BTC magic) would
  // produce a different hash and a non-standard LTC BIP-137 signature.
  // --------------------------------------------------------------------------
  it("LTC magic prefix is exactly 25 UTF-8 bytes (varint 0x19 — vs BTC's 24 bytes / 0x18)", () => {
    const LTC_MAGIC = "Litecoin Signed Message:\n";
    const BTC_MAGIC = "Bitcoin Signed Message:\n";
    expect(Buffer.byteLength(LTC_MAGIC, "utf8")).toBe(25);
    expect(Buffer.byteLength(BTC_MAGIC, "utf8")).toBe(24);
    expect(encodeVarint(25)).toEqual(new Uint8Array([0x19]));
    expect(encodeVarint(24)).toEqual(new Uint8Array([0x18]));
  });

  // --------------------------------------------------------------------------
  // LTC_MAGIC_BYTES_HEX constant — varint(25) ‖ UTF-8 magic string.
  // This is the binary anchor for the blocks-btc.ts LEDGER BLIND-SIGN HASH
  // display in sign_message_ltc.ts.
  //
  // Breakdown:
  //   "19" (1 byte)  = varint(25) = 0x19
  //   "4c697465636f696e205369676e6564204d6573736167653a0a" (25 bytes)
  //                  = UTF-8 "Litecoin Signed Message:\n"
  //   Total: 26 bytes = 52 hex chars.
  // --------------------------------------------------------------------------
  it("LTC_MAGIC_BYTES_HEX is 52 hex chars (26 bytes = varint + magic string)", () => {
    expect(LTC_MAGIC_BYTES_HEX).toBe(
      "194c697465636f696e205369676e6564204d6573736167653a0a",
    );
    expect(LTC_MAGIC_BYTES_HEX.length).toBe(52); // 26 bytes × 2 hex chars
    // First byte is varint(25) = 0x19
    expect(LTC_MAGIC_BYTES_HEX.slice(0, 2)).toBe("19");
    // Remaining 25 bytes decode to the magic string
    const magicHex = LTC_MAGIC_BYTES_HEX.slice(2);
    const decoded = Buffer.from(magicHex, "hex").toString("utf8");
    expect(decoded).toBe("Litecoin Signed Message:\n");
  });

  // --------------------------------------------------------------------------
  // Varint encoding invariants (shared with BTC fixture W for completeness).
  // --------------------------------------------------------------------------
  it("encodeVarint(25) = [0x19] single byte (LTC magic length)", () => {
    expect(encodeVarint(25)).toEqual(new Uint8Array([0x19]));
  });

  it("encodeVarint encodes values < 0xfd as single-byte", () => {
    expect(encodeVarint(0)).toEqual(new Uint8Array([0x00]));
    expect(encodeVarint(16)).toEqual(new Uint8Array([0x10])); // "Hello VaultPilot"
    expect(encodeVarint(252)).toEqual(new Uint8Array([0xfc]));
  });
});
