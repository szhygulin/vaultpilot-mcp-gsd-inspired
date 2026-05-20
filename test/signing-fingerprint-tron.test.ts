// TRON-PREP-01 — TRON payloadFingerprint canonical-fixture regression file.
// Sibling of `test/signing-fingerprint-solana.test.ts` (Solana — FROZEN) and
// `test/signing-fingerprint.test.ts` (EVM — FROZEN). Phase 18 — Plan 18-01.
//
// Fixture taxonomy (CLAUDE.md "Cryptographic-binding fixtures pinned as
// hardcoded literals" — NO `beforeAll`-snapshot; drift in preimage assembly
// MUST fail at a specific line, not pass against a self-snapshotted value):
//
//   Fixture M — native TRX transfer fingerprint (consumed by
//               `test/prepare-tron-native-send.test.ts` Plan 18-02 +
//               `test/trust-pipeline-tron.integration.test.ts` Plan 18-04).
//   Fixture N — TRC-20 USDT-TRC20 transfer fingerprint (consumed by
//               `test/prepare-tron-trc20-send.test.ts` Plan 18-03 +
//               `test/trust-pipeline-tron.integration.test.ts` Plan 18-04).
//
// Phase 8 Fixture J at `test/signing-fingerprint.test.ts:182` (EVM
// chain-distinctness anchors) is FROZEN. Phase 12 Fixtures K + L at
// `test/signing-fingerprint-solana.test.ts` are FROZEN — TRON Protobuf
// preimage is structurally distinct from Solana serialized-message bytes;
// separate sibling file is correct.
//
// SENDER-DEPENDENCE: the TRON fingerprint includes `owner_address` inside the
// TransferContract / TriggerSmartContract Protobuf field, so swapping the
// owner_address DOES change the fingerprint. The persona-cycle byte-identity
// assertion lands in Plan 18-04.
//
// Cross-link: "Consumed by `test/prepare-tron-native-send.test.ts` (Plan 18-02
// — Fixture M re-anchor) + `test/prepare-tron-trc20-send.test.ts` (Plan 18-03
// — Fixture N re-anchor) + `test/trust-pipeline-tron.integration.test.ts`
// (Plan 18-04 — persona-cycle byte-identity assertions)."
//
// PREIMAGE CONSTRUCTION:
// raw_data_hex values are the Protobuf-serialized `transaction.raw_data` bytes
// computed by tronweb's internal `txJsonToPb` + `txPbToRawDataHex` utilities
// with pinned inputs (see below). They are hardcoded as hex literals here so
// the tests have ZERO network dependency and ZERO call to internal tronweb
// CJS paths. The Protobuf encoding is deterministic for a given input JSON;
// the "computed at PR-write time" comment marks each literal.
//
// DEVIATION: The plan's suggested TO address "TQrZ8tQyZ8eaQ8wKy3qYWxTrL2eBhTPBJ4"
// is not a valid TRON base58check address (TronWeb.isAddress returns false).
// [Rule 1 - Bug] Replaced with "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8" (USDC
// contract — a stable, known valid TRON base58check address).

import { describe, expect, it, vi } from "vitest";

import {
  FINGERPRINT_DOMAIN_TAG_TRON,
  _tronFingerprint,
  computeTronPayloadFingerprint,
} from "../src/signing/payload-fingerprint-tron.js";

// ============================================================================
// Fixture M — native TRX transfer
//
// Inputs (all pinned — deterministic Protobuf encoding):
//   FROM            = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" (USDT deployer)
//   TO              = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8" (USDC addr, valid TRON addr)
//   amount          = 1_000_000 sun (1 TRX)
//   ref_block_bytes = "00ad"
//   ref_block_hash  = "8e5e7df4e3c8b9a2"
//   expiration      = 1779268134000
//   timestamp       = 1779268074000
//
// Computed at PR-write time via:
//   const { txJsonToPb, txPbToRawDataHex } = require('tronweb/lib/commonjs/utils/transaction.js');
//   const pb = txJsonToPb({ raw_data: { contract: [...], ref_block_bytes, ... } });
//   const rawDataHex = txPbToRawDataHex(pb).toLowerCase();
// ============================================================================
const FIXTURE_M_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335a67080112630a2d747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e5472616e73666572436f6e747261637412320a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c1215413487b63d30b5b2c87fb7ffa8bcfade38eaac1abe18c0843d7090f490a5e433";

// ============================================================================
// Fixture N — TRC-20 USDT transfer
//
// Inputs (all pinned):
//   FROM              = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
//   USDT_TRC20        = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" (contract_address)
//   TO                = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8"
//   amount            = 100_000_000 (100 USDT at 6 decimals)
//   fee_limit         = 100_000_000
//   ref_block_bytes, ref_block_hash, expiration, timestamp — same as Fixture M
//
// calldata = transfer(address,uint256) selector + padded TO + padded amount
// ============================================================================
const FIXTURE_N_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244a9059cbb0000000000000000000000003487b63d30b5b2c87fb7ffa8bcfade38eaac1abe0000000000000000000000000000000000000000000000000000000005f5e1007090f490a5e433900180c2d72f";

describe("computeTronPayloadFingerprint — TRON-PREP-01 (DF-1 LOCKED)", () => {
  it("domain-tag length invariant: 21 UTF-8 bytes (distinct from EVM 23-byte and Solana 20-byte tags)", () => {
    // String-length invariant.
    expect(FINGERPRINT_DOMAIN_TAG_TRON.length).toBe(21);
    // UTF-8 byte-length invariant — load-bearing: cross-chain reuse impossible
    // by construction (EVM tag is 23 bytes; Solana tag is 20 bytes; all-ASCII
    // so .length === byteLength).
    expect(Buffer.byteLength(FINGERPRINT_DOMAIN_TAG_TRON, "utf8")).toBe(21);
    // Exact tag value pinned — prevents accidental rename / version bump
    // without explicit intent. v2 fingerprint format would change "v1:" → "v2:".
    expect(FINGERPRINT_DOMAIN_TAG_TRON).toBe("VaultPilot-trontx-v1:");
  });

  it("Fixture M — native TRX transfer fingerprint (hardcoded literal anchor)", () => {
    // raw_data_hex is the Protobuf-serialized bytes of a native TRX transfer
    // (TransferContract) with pinned inputs computed at PR-write time.
    const rawDataBytes = new Uint8Array(
      Buffer.from(FIXTURE_M_RAW_DATA_HEX, "hex"),
    );

    // Stable byte-length anchor — catches any future Protobuf schema change.
    expect(rawDataBytes.length).toBe(133);

    const fp = computeTronPayloadFingerprint({ rawDataBytes });

    // Hardcoded literal anchor (Plan 18-01 hardening — computed at PR-write
    // time via discardable node script). Cross-linked from
    // `test/prepare-tron-native-send.test.ts` (Plan 18-02) and
    // `test/trust-pipeline-tron.integration.test.ts` (Plan 18-04).
    expect(fp).toBe(
      "0xaa8305509481b97e50acb9e4d582bb53a1db1c99f9c357febe1fbf7389ffd4fa",
    );
  });

  it("Fixture N — TRC-20 USDT transfer fingerprint (hardcoded literal anchor)", () => {
    // raw_data_hex is the Protobuf-serialized bytes of a TRC-20 transfer
    // (TriggerSmartContract) with pinned inputs computed at PR-write time.
    const rawDataBytes = new Uint8Array(
      Buffer.from(FIXTURE_N_RAW_DATA_HEX, "hex"),
    );

    // Stable byte-length anchor.
    expect(rawDataBytes.length).toBe(211);

    const fp = computeTronPayloadFingerprint({ rawDataBytes });

    // Hardcoded literal anchor. Cross-linked from
    // `test/prepare-tron-trc20-send.test.ts` (Plan 18-03) and
    // `test/trust-pipeline-tron.integration.test.ts` (Plan 18-04).
    expect(fp).toBe(
      "0xffa617dd3396eb038869b98e7385aa302e4ff69ed4d7cabe4904370c5015b520",
    );
  });

  it("Fixture M vs Fixture N: different tx types produce different fingerprints", () => {
    // Regression: the two fixture types (TransferContract vs TriggerSmartContract)
    // produce structurally different Protobuf bytes and must yield different
    // fingerprints. Catches any accidentally-identical preimage assembly.
    const fpM = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_M_RAW_DATA_HEX, "hex")),
    });
    const fpN = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_N_RAW_DATA_HEX, "hex")),
    });

    expect(fpM).not.toBe(fpN);
    expect(fpM).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fpN).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("single-byte mutation changes fingerprint (preimage completeness regression)", () => {
    // Flipping one byte in the raw_data MUST change the fingerprint.
    // Regression against a static preimage that ignores the content.
    const rawBytesA = new Uint8Array(Buffer.from(FIXTURE_M_RAW_DATA_HEX, "hex"));
    const rawBytesB = new Uint8Array(rawBytesA);
    rawBytesB[rawBytesB.length - 1] ^= 0x01; // flip last byte

    const fpA = computeTronPayloadFingerprint({ rawDataBytes: rawBytesA });
    const fpB = computeTronPayloadFingerprint({ rawDataBytes: rawBytesB });
    expect(fpA).not.toBe(fpB);
  });

  it("_tronFingerprint spy-affordance regression — ESM indirection intercepts", () => {
    // CLAUDE.md ESM spy-affordance non-negotiable: the indirection object is
    // present. A direct `vi.spyOn(*, "computeTronPayloadFingerprint")` on the
    // named export would silently no-op due to immutable ESM bindings; the
    // indirection is the test seam. Plans 18-02 / 18-04 will rely on it.
    const spy = vi
      .spyOn(_tronFingerprint, "computeTronPayloadFingerprint")
      .mockReturnValue("0xdeadbeef" as `0x${string}`);

    const fakeBytes = new Uint8Array([1, 2, 3, 4]);
    const result = _tronFingerprint.computeTronPayloadFingerprint({
      rawDataBytes: fakeBytes,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ rawDataBytes: fakeBytes });
    expect(result).toBe("0xdeadbeef");

    spy.mockRestore();
  });
});
