// TRON-PREP-02 — TRON presign hash canonical-fixture regression file.
// Sibling of `test/signing-presign-hash-solana.test.ts` (Solana). Phase 18 —
// Plan 18-01.
//
// Single Fixture-M-presign literal pin: same raw_data bytes as Fixture M in
// `test/signing-fingerprint-tron.test.ts`, but SHA-256 instead of keccak256.
// The SHA-256 hash equals `"0x" + transaction.txID` — the TRON consensus tx-id
// IS the SHA-256 of raw_data (DF-2 lock per D-02 + research §Topic 4).
//
// The Ledger TRX app displays this hash in blind-sign mode under the label
// "Transaction ID". The user matches it against the `LEDGER BLIND-SIGN HASH
// (TRON)` block emitted by preview_send (Plan 18-04).

import { describe, expect, it, vi } from "vitest";

import {
  _tronPresign,
  computeTronPresignHash,
} from "../src/signing/presign-hash-tron.js";

// Fixture M raw_data_hex — same pinned literal as in signing-fingerprint-tron.test.ts.
// (native TRX transfer: FROM=USDT deployer, TO=USDC addr, 1 TRX, pinned ref-block).
const FIXTURE_M_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c1215413487b63d30b5b2c87fb7ffa8bcfade38eaac1abe18c0843d7090f490a5e433";

// Fixture M txID (computed: SHA-256(raw_data) = tronweb's transaction.txID).
// Independently verified at PR-write time:
//   SHA-256(Buffer.from(FIXTURE_M_RAW_DATA_HEX, "hex")).toString("hex")
//   = "a056782c3943d1a0c94c6eb30c6175b34c47cf8f42a2e88f95bbadcb22fbf400"
const FIXTURE_M_TX_ID =
  "a056782c3943d1a0c94c6eb30c6175b34c47cf8f42a2e88f95bbadcb22fbf400";

describe("computeTronPresignHash — TRON-PREP-02 (DF-2 LOCKED)", () => {
  it("Fixture M — presign hash hardcoded literal pin (0x-prefixed SHA-256 of raw_data_bytes)", () => {
    // Same raw_data bytes as Fixture M in signing-fingerprint-tron.test.ts.
    const rawDataBytes = new Uint8Array(
      Buffer.from(FIXTURE_M_RAW_DATA_HEX, "hex"),
    );

    const { presignHash, rawDataBytes: echoed } = computeTronPresignHash({
      rawDataBytes,
    });

    // Hardcoded literal anchor — computed at PR-write time.
    // Cross-linked from `test/prepare-tron-native-send.test.ts` (Plan 18-02)
    // and `test/trust-pipeline-tron.integration.test.ts` (Plan 18-04).
    expect(presignHash).toBe(`0x${FIXTURE_M_TX_ID}`);

    // Confirm SHA-256 equivalence with tronweb's txID convention:
    // txID is the hex string WITHOUT the "0x" prefix (tronweb convention).
    // presignHash = "0x" + txID.
    expect(presignHash.slice(2)).toBe(FIXTURE_M_TX_ID);
  });

  it("computeTronPresignHash echoes rawDataBytes verbatim (no mutation)", () => {
    const rawDataBytes = new Uint8Array(
      Buffer.from(FIXTURE_M_RAW_DATA_HEX, "hex"),
    );
    const original = new Uint8Array(rawDataBytes); // copy

    const { rawDataBytes: echoed } = computeTronPresignHash({ rawDataBytes });

    // Same reference — not a copy (echoed back verbatim per the return spec).
    expect(echoed).toBe(rawDataBytes);
    // Content unchanged.
    expect(Buffer.from(echoed).toString("hex")).toBe(
      Buffer.from(original).toString("hex"),
    );
  });

  it("presignHash is well-formed 0x-prefixed 64-char hex (32 bytes SHA-256)", () => {
    const rawDataBytes = new Uint8Array(
      Buffer.from(FIXTURE_M_RAW_DATA_HEX, "hex"),
    );
    const { presignHash } = computeTronPresignHash({ rawDataBytes });
    // 0x + 64 hex chars = 66 total characters.
    expect(presignHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("different raw_data_bytes produce different presignHash (no static preimage)", () => {
    const rawBytesA = new Uint8Array(Buffer.from(FIXTURE_M_RAW_DATA_HEX, "hex"));
    const rawBytesB = new Uint8Array(rawBytesA);
    rawBytesB[rawBytesB.length - 1] ^= 0x01; // flip last byte

    const { presignHash: hashA } = computeTronPresignHash({ rawDataBytes: rawBytesA });
    const { presignHash: hashB } = computeTronPresignHash({ rawDataBytes: rawBytesB });

    expect(hashA).not.toBe(hashB);
  });

  it("_tronPresign spy-affordance regression — ESM indirection intercepts", () => {
    // CLAUDE.md ESM spy-affordance non-negotiable.
    const spy = vi
      .spyOn(_tronPresign, "computeTronPresignHash")
      .mockReturnValue({
        rawDataBytes: new Uint8Array(0),
        presignHash: "0xdeadbeef" as `0x${string}`,
      });

    const fakeBytes = new Uint8Array([1, 2, 3]);
    const result = _tronPresign.computeTronPresignHash({ rawDataBytes: fakeBytes });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.presignHash).toBe("0xdeadbeef");

    spy.mockRestore();
  });
});
