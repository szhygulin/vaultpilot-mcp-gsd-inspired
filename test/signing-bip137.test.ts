// BIP-137 message signing cryptographic-binding fixtures. Phase 24 — Plan 24-02.
//
// Purpose: pin the BIP-137 double-SHA256 message hash and header-byte assembly
// against hardcoded literals so drift in preimage assembly fails at a specific
// assertion line — NOT via a self-snapshotted `beforeAll`.
//
// IMPORTANT: These are SHA-256 fixtures (BIP-137 message hash), NOT keccak256
// payloadFingerprint fixtures. Do NOT confuse Fixture W with the EVM/BTC PSBT
// fixtures in test/signing-fingerprint.test.ts:
//   - Fixtures A–V (signing-fingerprint.test.ts): keccak256 payloadFingerprint
//     over EVM calldata, Solana, TRON, or BTC PSBT per-input sighashes.
//   - Fixture W (this file): double-SHA256 of the BIP-137 preimage
//     (varint(24) ‖ "Bitcoin Signed Message:\n" ‖ varint(len) ‖ message).
//     This is what the Ledger device signs; it is NOT a prepare/preview/send handle.
//
// Cross-link: consumed by test/tools-sign-message-btc.test.ts (BTC-W-03
// tool-level coverage — demo refusal, pairing check, response shape,
// Fixture W re-anchor for the `messageHash` field).

import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

// ─── Helpers (local — mirrors sign_message_btc.ts helpers) ───────────────────
//
// These helpers are defined here to let the fixture test be self-contained and
// independently verify the preimage assembly. The production module
// (`sign_message_btc.ts`) exports the same logic; this test file does NOT import
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

function computeBip137MessageHash(message: string): string {
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

// ─── BIP-137 Fixture W ────────────────────────────────────────────────────────

describe("BIP-137 message signing cryptographic-binding fixtures", () => {
  // --------------------------------------------------------------------------
  // Fixture W — BIP-137 double-SHA256 message hash for "Hello VaultPilot".
  //
  // Test message: "Hello VaultPilot" (16 UTF-8 bytes).
  // Preimage: varint(24) ‖ "Bitcoin Signed Message:\n" ‖ varint(16) ‖ message
  //         = [0x18] ‖ [24 magic bytes] ‖ [0x10] ‖ [16 message bytes]
  //         = 42 bytes total.
  // Hash: SHA-256(SHA-256(preimage)) — double-SHA256, NOT single-SHA256.
  //
  // This is the SAME hash the Ledger BTC app computes before signing
  // (the device applies the magic prefix internally; the server computes it
  // independently for the LEDGER BLIND-SIGN HASH block).
  //
  // Fixture computed once at research time via:
  //   node -e "
  //     import { sha256 } from '@noble/hashes/sha256';
  //     import { bytesToHex } from '@noble/hashes/utils';
  //     const MAGIC = 'Bitcoin Signed Message:\n';
  //     const magicBuf = Buffer.from(MAGIC, 'utf8');
  //     const msgBuf = Buffer.from('Hello VaultPilot', 'utf8');
  //     const preimage = Buffer.concat([
  //       new Uint8Array([0x18]), magicBuf, new Uint8Array([0x10]), msgBuf
  //     ]);
  //     const h1 = sha256(preimage);
  //     const h2 = sha256(h1);
  //     console.log('0x' + bytesToHex(h2));
  //   "
  //
  // PINNED FOREVER: do NOT replace with a beforeAll-snapshot. Drift in preimage
  // assembly MUST fail at THIS specific assertion line.
  //
  // Cross-link: re-anchored in test/tools-sign-message-btc.test.ts (plan
  // 24-02 BTC-W-03 tool-level coverage — `messageHash` field assertion).
  // --------------------------------------------------------------------------
  it("Fixture W — BIP-137 double-SHA256 message hash for 'Hello VaultPilot' → 0xca329b... byte-for-byte", () => {
    const hash = computeBip137MessageHash("Hello VaultPilot");

    // Hardcoded literal anchor (Plan 24-02 — research-time computation pinned
    // forever). Drift in the BIP-137 preimage assembly (magic length, varint
    // encoding, double-SHA256 application) breaks THIS exact assertion.
    //
    // NOTE: This is a double-SHA256 hash, NOT a keccak256 payloadFingerprint.
    // The bit pattern is sha256(sha256(preimage)) — standard Bitcoin hash.
    expect(hash).toBe(
      "0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e",
    );
  });

  // --------------------------------------------------------------------------
  // Magic prefix length invariant.
  // "Bitcoin Signed Message:\n" is exactly 24 UTF-8 bytes — varint(24) = 0x18.
  // A wrong magic string (e.g. trailing space, wrong newline) would produce a
  // different hash and a non-standard BIP-137 signature.
  // --------------------------------------------------------------------------
  it("magic prefix is exactly 24 UTF-8 bytes", () => {
    const MAGIC = "Bitcoin Signed Message:\n";
    expect(Buffer.byteLength(MAGIC, "utf8")).toBe(24);
    expect(encodeVarint(24)).toEqual(new Uint8Array([0x18]));
  });

  // --------------------------------------------------------------------------
  // Varint encoding — Bitcoin compact integer.
  // Values < 0xfd encode as a single byte.
  // --------------------------------------------------------------------------
  it("encodeVarint encodes values < 0xfd as single-byte little-endian", () => {
    expect(encodeVarint(0)).toEqual(new Uint8Array([0x00]));
    expect(encodeVarint(24)).toEqual(new Uint8Array([0x18]));
    expect(encodeVarint(252)).toEqual(new Uint8Array([0xfc]));
  });

  it("encodeVarint encodes values in [0xfd, 0xffff] as 3 bytes (0xfd prefix + LE uint16)", () => {
    const result = encodeVarint(0xfd);
    expect(result[0]).toBe(0xfd);
    expect(result.length).toBe(3);
    // 0xfd in little-endian uint16: [0xfd, 0x00]
    expect(result[1]).toBe(0xfd);
    expect(result[2]).toBe(0x00);
  });

  it("encodeVarint throws for values > 0xffff", () => {
    expect(() => encodeVarint(0x10000)).toThrow("varint: value too large");
  });

  // --------------------------------------------------------------------------
  // BIP-137 header-byte assembly — P2WPKH bech32 (native segwit).
  //
  // Per BIP-137 §Header Byte Values:
  //   P2WPKH bech32 (native segwit): base 39 + recovery_id (0 or 1)
  //   → header = v + 39 for v ∈ {0, 1}
  //
  // The Ledger SDK (BtcNew.js line 294) strips the 27+4 offset BEFORE
  // returning v — so v is already the raw recovery_id (0 or 1), NOT
  // the device byte (31 or 32 for BtcOld; 35/36 for wrapped segwit;
  // 39/40 for bech32 native segwit).
  // --------------------------------------------------------------------------
  it("header byte for P2WPKH bech32: v=0 → header=39", () => {
    const v = 0; // raw recovery_id from BtcNew SDK
    const header = v + 39; // P2WPKH bech32 base per BIP-137
    expect(header).toBe(39);
  });

  it("header byte for P2WPKH bech32: v=1 → header=40", () => {
    const v = 1;
    const header = v + 39;
    expect(header).toBe(40);
  });

  // --------------------------------------------------------------------------
  // 65-byte compact signature shape: [1 header][32 r][32 s].
  // The base64-encoded form is exactly 88 chars (ceil(65/3)*4 = 88).
  // --------------------------------------------------------------------------
  it("assembles a 65-byte compact signature from { v, r, s } with P2WPKH header", () => {
    const v = 0;
    const r = "aa".repeat(32); // 32 bytes
    const s = "bb".repeat(32); // 32 bytes

    const header = v + 39; // 39
    const sig65 = Buffer.concat([
      Buffer.from([header]),
      Buffer.from(r, "hex"),
      Buffer.from(s, "hex"),
    ]);

    expect(sig65.length).toBe(65);
    expect(sig65[0]).toBe(39);
    expect(sig65.slice(1, 33).toString("hex")).toBe("aa".repeat(32));
    expect(sig65.slice(33, 65).toString("hex")).toBe("bb".repeat(32));

    // Base64-encoded form
    const base64 = sig65.toString("base64");
    expect(Buffer.from(base64, "base64").length).toBe(65);
  });

  it("base64-encoded 65-byte signature is exactly 88 characters", () => {
    const sig65 = Buffer.alloc(65, 0x42);
    expect(sig65.toString("base64").length).toBe(88);
  });
});
