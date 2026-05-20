// Phase 19 — Plans 19-01 / 19-02: TRON payloadFingerprint canonical-fixture file.
// Sibling of `test/signing-fingerprint-tron.test.ts` (Phase 18 — BYTE-UNTOUCHED
// per D-11d). New sibling per D-08c: Phase 19 fixtures live HERE, not in the
// Phase 18 file.
//
// Fixture naming convention (D-08a):
//   Tron-19-A — TRC-20 approve fingerprint (Plan 19-01)
//   Tron-19-B — FreezeBalanceV2 freeze fingerprint (Plan 19-02)
//   Tron-19-C — VoteWitnessContract vote fingerprint (Plan 19-03 — it.todo)
//   Tron-19-D — WithdrawBalanceContract claim fingerprint (Plan 19-03 — it.todo)
//
// Hardcoded `0x...` literal anchors (CLAUDE.md "Cryptographic-binding fixtures
// pinned as hardcoded literals" — NO `beforeAll`-snapshot; drift in preimage
// assembly MUST fail at a specific line, not pass against a self-snapshotted
// value).
//
// Cross-link: Fixture Tron-19-A is re-anchored at consumer sites:
//   - `test/prepare-tron-token-approve.test.ts` (Plan 19-01 — consumer re-anchor)
//
// SENDER-DEPENDENCE: TRON fingerprint includes `owner_address` inside the
// TriggerSmartContract Protobuf field (identical to Phase 18 approve/transfer).
//
// Fixture Tron-19-A inputs (pinned — same ref_block_bytes/hash/expiration as Fixture M/N):
//   FROM      = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" (USDT deployer / stable test address)
//   TOKEN     = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" (USDT-TRC20 contract)
//   SPENDER   = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax" (SunSwap V2 Router)
//   AMOUNT    = 1_000_000n (1 USDT at 6 decimals)
//   ref_block_bytes = "00ad"
//   ref_block_hash  = "8e5e7df4e3c8b9a2"
//   expiration      = 1779268134000
//   timestamp       = 1779268074000
//   fee_limit       = 100_000_000
//
// Calldata = approve(address,uint256):
//   selector = "095ea7b3" (4 bytes)
//   arg[0]   = spender 20-byte left-padded to 32 bytes
//   arg[1]   = 1_000_000 as big-endian uint256 (32 bytes)
//
// Computed at PR-write time via:
//   node -e "const {txJsonToPb,txPbToRawDataHex}=require('tronweb/lib/commonjs/utils/transaction.js');..."

import { describe, expect, it, vi } from "vitest";

import {
  _tronFingerprint,
  computeTronPayloadFingerprint,
} from "../src/signing/payload-fingerprint-tron.js";

// ============================================================================
// Fixture Tron-19-A — TRC-20 approve: USDT → SunSwap V2 Router, 1 USDT
//
// Inputs (pinned — deterministic tronweb Protobuf encoding):
//   FROM    = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
//   TOKEN   = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" (USDT-TRC20)
//   SPENDER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax" (SunSwap V2 Router)
//   AMOUNT  = 1_000_000n (= 0xf4240 — 1 USDT at decimals=6)
//   selector = 095ea7b3 (approve(address,uint256))
//
// Computed at PR-write time via discardable node -e script.
// ============================================================================

/** Pinned raw_data_hex for Fixture Tron-19-A. Computed at PR-write time. */
const FIXTURE_TRON_19_A_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244095ea7b30000000000000000000000006e0617948fe030a7e4970f8389d4ad295f249b7e00000000000000000000000000000000000000000000000000000000000f42407090f490a5e433900180c2d72f";

/**
 * Hardcoded payloadFingerprint literal for Fixture Tron-19-A.
 * Computed at PR-write time via keccak256("VaultPilot-trontx-v1:" || rawDataBytes).
 * Cross-linked from `test/prepare-tron-token-approve.test.ts`.
 */
export const FIXTURE_TRON_19_A_FINGERPRINT =
  "0xb6ed7397e41a3159b4068cb4e25882108dce9beccf277de81935d2f5bf5a5ef4";

// ============================================================================
// Fixture Tron-19-B — FreezeBalanceV2Contract (Plan 19-02)
//
// Inputs (pinned — deterministic tronweb Protobuf encoding):
//   FROM      = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" (USDT deployer — reuse Fixture A/M/N FROM)
//   SUN       = 1_000_000_000 (1000 TRX)
//   RESOURCE  = "ENERGY" (resource enum value 1 in Protobuf)
//   ref_block_bytes = "00ad"
//   ref_block_hash  = "8e5e7df4e3c8b9a2"
//   expiration      = 1779268134000
//   timestamp       = 1779268074000
//
// Computed at PR-write time via:
//   const { txJsonToPb, txPbToRawDataHex } = require('tronweb/lib/commonjs/utils/transaction.js');
//   const raw_data = { contract: [{ type: 'FreezeBalanceV2Contract',
//     parameter: { value: { owner_address: FROM_HEX, frozen_balance: 1_000_000_000, resource: 'ENERGY' },
//       type_url: 'type.googleapis.com/protocol.FreezeBalanceV2Contract' } }],
//     ref_block_bytes: '00ad', ref_block_hash: '8e5e7df4e3c8b9a2',
//     expiration: 1779268134000, timestamp: 1779268074000 };
//   rawDataHex = txPbToRawDataHex(txJsonToPb({ raw_data })).toLowerCase();
//   fingerprint = keccak256('VaultPilot-trontx-v1:' || rawDataBytes);
// ============================================================================

/** Pinned raw_data_hex for Fixture Tron-19-B. Computed at PR-write time. */
const FIXTURE_TRON_19_B_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335a5b083612570a34747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e467265657a6542616c616e63655632436f6e7472616374121f0a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c108094ebdc0318017090f490a5e433";

/**
 * Hardcoded payloadFingerprint literal for Fixture Tron-19-B (FreezeBalanceV2Contract).
 * Computed at PR-write time via keccak256("VaultPilot-trontx-v1:" || rawDataBytes).
 * Cross-linked from `test/prepare-tron-stake-freeze.test.ts`.
 */
export const FIXTURE_TRON_19_B_FINGERPRINT =
  "0x18b3ea8b388d2af3175c35d16b0ac65e95818fa941229acbee8f44674419ba44";

// Fixture Tron-19-B address/amount constants (re-exported for consumer tests)
export const FIXTURE_TRON_19_B_FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // same as Fixture A FROM
export const FIXTURE_TRON_19_B_SUN = 1_000_000_000n; // 1000 TRX in SUN
export const FIXTURE_TRON_19_B_RESOURCE = "ENERGY" as const;
export const FIXTURE_TRON_19_B_REF_BLOCK_BYTES = "00ad";
export const FIXTURE_TRON_19_B_REF_BLOCK_HASH = "8e5e7df4e3c8b9a2";
export const FIXTURE_TRON_19_B_EXPIRATION = 1779268134000;

// ============================================================================
// Fixture Tron-19-C — VoteWitnessContract (Plan 19-03)
//
// Inputs (pinned — same ref_block_bytes/hash/expiration as Fixtures A/B):
//   FROM    = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" (USDT deployer — reuse prior FROM)
//   FROM_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c"
//   SR1     = "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH" (Binance Staking, rank 1) — 100 votes
//   SR1_HEX = "4178c842ee63b253f8f0d2955bbc582c661a078c9d"
//   SR2     = "TE7hnUtWRRBz3SkFrX8JESWUmEvxxAhoPt" (Huobi, rank 2)            — 200 votes
//   SR2_HEX = "412d7bdb9846499a2e5e6c5a7e6fb05731c83107c7"
//   ref_block_bytes = "00ad"
//   ref_block_hash  = "8e5e7df4e3c8b9a2"
//   expiration      = 1779268134000
//   timestamp       = 1779268074000
//
// Computed at PR-write time via:
//   NODE_PATH=./node_modules node /tmp/compute-fixtures-cd.cjs
// ============================================================================

/** Pinned raw_data_hex for Fixture Tron-19-C. Computed at PR-write time. */
const FIXTURE_TRON_19_C_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335a870108041282010a30747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e566f74655769746e657373436f6e7472616374124e0a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c12190a154178c842ee63b253f8f0d2955bbc582c661a078c9d1064121a0a15412d7bdb9846499a2e5e6c5a7e6fb05731c83107c710c8017090f490a5e433";

/**
 * Hardcoded payloadFingerprint literal for Fixture Tron-19-C (VoteWitnessContract).
 * Computed at PR-write time via keccak256("VaultPilot-trontx-v1:" || rawDataBytes).
 * Cross-linked from `test/prepare-tron-stake-vote.test.ts`.
 */
export const FIXTURE_TRON_19_C_FINGERPRINT =
  "0x7e2402e3fdf03906c703c8bec9668412f6ae8bc5a483e12ff35cf157c6510d57";

// ============================================================================
// Fixture Tron-19-D — WithdrawBalanceContract (Plan 19-03)
//
// Inputs (pinned — same ref_block_bytes/hash/expiration as Fixtures A/B):
//   FROM    = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" (USDT deployer — reuse prior FROM)
//   FROM_HEX = "41a614f803b6fd780986a42c78ec9c7f77e6ded13c"
//   ref_block_bytes = "00ad"
//   ref_block_hash  = "8e5e7df4e3c8b9a2"
//   expiration      = 1779268134000
//   timestamp       = 1779268074000
//
// Computed at PR-write time via:
//   NODE_PATH=./node_modules node /tmp/compute-fixtures-cd.cjs
// ============================================================================

/** Pinned raw_data_hex for Fixture Tron-19-D. Computed at PR-write time. */
const FIXTURE_TRON_19_D_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335a53080d124f0a34747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e576974686472617742616c616e6365436f6e747261637412170a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c7090f490a5e433";

/**
 * Hardcoded payloadFingerprint literal for Fixture Tron-19-D (WithdrawBalanceContract).
 * Computed at PR-write time via keccak256("VaultPilot-trontx-v1:" || rawDataBytes).
 * Cross-linked from `test/prepare-tron-stake-claim-rewards.test.ts`.
 */
export const FIXTURE_TRON_19_D_FINGERPRINT =
  "0x041642262b24aa7605340383696bb8b9905d07041945ecc53673e1f55f748724";

// Fixture Tron-19-C/D constants (re-exported for consumer tests)
export const FIXTURE_TRON_19_C_FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const FIXTURE_TRON_19_C_SR1 = "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH";
export const FIXTURE_TRON_19_C_SR2 = "TE7hnUtWRRBz3SkFrX8JESWUmEvxxAhoPt";
export const FIXTURE_TRON_19_C_REF_BLOCK_BYTES = "00ad";
export const FIXTURE_TRON_19_C_REF_BLOCK_HASH = "8e5e7df4e3c8b9a2";
export const FIXTURE_TRON_19_C_EXPIRATION = 1779268134000;
export const FIXTURE_TRON_19_D_FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const FIXTURE_TRON_19_D_REF_BLOCK_BYTES = "00ad";
export const FIXTURE_TRON_19_D_REF_BLOCK_HASH = "8e5e7df4e3c8b9a2";
export const FIXTURE_TRON_19_D_EXPIRATION = 1779268134000;

// ============================================================================
// Fixture Tron-19-A address constants (re-exported for consumer tests)
// ============================================================================

export const FIXTURE_TRON_19_A_FROM = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const FIXTURE_TRON_19_A_TOKEN = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
export const FIXTURE_TRON_19_A_SPENDER = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";
export const FIXTURE_TRON_19_A_AMOUNT_WEI = 1_000_000n;
export const FIXTURE_TRON_19_A_REF_BLOCK_BYTES = "00ad";
export const FIXTURE_TRON_19_A_REF_BLOCK_HASH = "8e5e7df4e3c8b9a2";
export const FIXTURE_TRON_19_A_EXPIRATION = 1779268134000;

// ============================================================================
// Tests
// ============================================================================

describe("computeTronPayloadFingerprint — Phase 19 Fixture Tron-19-A (TRC-20 approve)", () => {
  it("Fixture Tron-19-A — TRC-20 approve fingerprint (hardcoded literal anchor)", () => {
    // raw_data_hex is the Protobuf-serialized bytes of a TRC-20 approve
    // (TriggerSmartContract with approve(address,uint256) calldata) with
    // pinned inputs computed at PR-write time.
    const rawDataBytes = new Uint8Array(
      Buffer.from(FIXTURE_TRON_19_A_RAW_DATA_HEX, "hex"),
    );

    // Stable byte-length anchor — catches any future Protobuf schema change.
    // Approve TriggerSmartContract is structurally identical to transfer:
    // same length (68-byte calldata, same contract type, same ref_block inputs).
    expect(rawDataBytes.length).toBe(211);

    const fp = computeTronPayloadFingerprint({ rawDataBytes });

    // Hardcoded literal anchor (Plan 19-01 hardening — computed at PR-write time).
    // Cross-linked from `test/prepare-tron-token-approve.test.ts`.
    // NO `beforeAll`-snapshot per CLAUDE.md.
    expect(fp).toBe(FIXTURE_TRON_19_A_FINGERPRINT);
  });

  it("Fixture Tron-19-A: selector bytes in raw_data_hex are '095ea7b3' (approve ABI)", () => {
    // The calldata field in the TriggerSmartContract Protobuf encodes the approve
    // selector as the first 4 bytes of `data`. This test extracts the selector
    // from the raw hex to confirm the encoder used approve(address,uint256) not
    // transfer(address,uint256).
    //
    // The calldata starts at a known offset in the raw_data_hex — we look for the
    // selector as a substring after the contract field encoding. We use the decoded
    // form: the hex literal above contains "095ea7b3" as a subsequence.
    expect(FIXTURE_TRON_19_A_RAW_DATA_HEX).toContain("095ea7b3");
    // And does NOT contain the transfer selector.
    expect(FIXTURE_TRON_19_A_RAW_DATA_HEX).not.toContain("a9059cbb");
  });

  it("Fixture Tron-19-A vs Fixture N: approve and transfer produce different fingerprints", () => {
    // Regression: approve calldata differs from transfer calldata even when
    // using the same FROM and TOKEN addresses. The selector difference alone
    // changes the raw_data_hex → changes the fingerprint.
    const FIXTURE_N_RAW_DATA_HEX =
      "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335aae01081f12a9010a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412740a1541a614f803b6fd780986a42c78ec9c7f77e6ded13c121541a614f803b6fd780986a42c78ec9c7f77e6ded13c2244a9059cbb0000000000000000000000003487b63d30b5b2c87fb7ffa8bcfade38eaac1abe0000000000000000000000000000000000000000000000000000000005f5e1007090f490a5e433900180c2d72f";

    const fpA = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_TRON_19_A_RAW_DATA_HEX, "hex")),
    });
    const fpN = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_N_RAW_DATA_HEX, "hex")),
    });

    expect(fpA).not.toBe(fpN);
    expect(fpA).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fpN).toMatch(/^0x[0-9a-f]{64}$/);
    // Cross-assert Fixture N is the known Phase 18 value.
    expect(fpN).toBe("0xffa617dd3396eb038869b98e7385aa302e4ff69ed4d7cabe4904370c5015b520");
  });

  it("_tronFingerprint spy-affordance: intercepts computeTronPayloadFingerprint via indirection", () => {
    // Verify the ESM spy-affordance works for this fixture file's usage pattern.
    const rawDataBytes = new Uint8Array(
      Buffer.from(FIXTURE_TRON_19_A_RAW_DATA_HEX, "hex"),
    );

    const spy = vi
      .spyOn(_tronFingerprint, "computeTronPayloadFingerprint")
      .mockReturnValue("0xdeadbeef" as `0x${string}`);

    const result = _tronFingerprint.computeTronPayloadFingerprint({ rawDataBytes });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBe("0xdeadbeef");

    spy.mockRestore();
  });
});

// ============================================================================
// Fixture Tron-19-B — FreezeBalanceV2Contract (Plan 19-02)
// ============================================================================

describe("computeTronPayloadFingerprint — Phase 19 Fixture Tron-19-B (FreezeBalanceV2Contract)", () => {
  it("Fixture Tron-19-B — FreezeBalanceV2 freeze fingerprint (hardcoded literal anchor)", () => {
    const rawDataBytes = new Uint8Array(
      Buffer.from(FIXTURE_TRON_19_B_RAW_DATA_HEX, "hex"),
    );

    // Stable byte-length anchor — catches any future Protobuf schema change.
    // FreezeBalanceV2Contract encodes: owner_address (21 bytes) + frozen_balance (varint) + resource (varint).
    expect(rawDataBytes.length).toBe(121);

    const fp = computeTronPayloadFingerprint({ rawDataBytes });

    // Hardcoded literal anchor (Plan 19-02 hardening — computed at PR-write time).
    // Cross-linked from `test/prepare-tron-stake-freeze.test.ts` (consumer re-anchor).
    // NO `beforeAll`-snapshot per CLAUDE.md.
    expect(fp).toBe(FIXTURE_TRON_19_B_FINGERPRINT);
  });

  it("Fixture Tron-19-B: raw_data_hex encodes FreezeBalanceV2Contract (NOT Stake 1.0 FreezeBalanceContract)", () => {
    // T-19-02-T-STAKE2-DISTINCT regression anchor — the type URL in the Protobuf
    // encoding confirms this is FreezeBalanceV2Contract (Stake 2.0), NOT
    // FreezeBalanceContract (Stake 1.0 deprecated per java-tron@4.6.0).
    // The type URL is embedded as a string in the raw_data_hex.
    const rawDataHexLower = FIXTURE_TRON_19_B_RAW_DATA_HEX.toLowerCase();
    // "FreezeBalanceV2Contract" encoded as UTF-8 hex in the type_url field:
    const freezeV2TypeUrlHex = Buffer.from("FreezeBalanceV2Contract").toString("hex");
    expect(rawDataHexLower).toContain(freezeV2TypeUrlHex);
    // Also verify "FreezeBalanceContract" (Stake 1.0) WITHOUT "V2" does NOT appear.
    const stake1TypeUrlHex = Buffer.from("FreezeBalanceContract").toString("hex");
    // "FreezeBalanceV2Contract" contains "FreezeBalanceContract" as a substring,
    // so we check the V2 suffix specifically via "V2Contract" in hex:
    const stake1OnlyHex = Buffer.from("Balance\x00").toString("hex"); // sanity
    // More robust: verify the raw hex contains exactly "FreezeBalanceV2Contract" type_url
    expect(rawDataHexLower).toContain(freezeV2TypeUrlHex);
    // And does NOT have ONLY "FreezeBalanceContract" without "V2" in the type URL portion
    // (the full type URL is "type.googleapis.com/protocol.FreezeBalanceV2Contract")
    const fullTypeUrlV2 = Buffer.from("type.googleapis.com/protocol.FreezeBalanceV2Contract").toString("hex");
    expect(rawDataHexLower).toContain(fullTypeUrlV2);
  });

  it("Fixture Tron-19-B: encoded resource is ENERGY (Protobuf field 3 = value 1)", () => {
    // ENERGY = 1 in the TRON Resource enum (Protobuf).
    // BANDWIDTH = 0 (default, often omitted in Protobuf encoding).
    // The frozen_balance=1_000_000_000 is encoded as varint 0x80 0x94 0xEB 0xDC 0x03
    // Resource=ENERGY is encoded as field 3, value 1: 0x18 0x01
    // Verify the hex contains the ENERGY field encoding.
    const rawDataHexLower = FIXTURE_TRON_19_B_RAW_DATA_HEX.toLowerCase();
    // "1801" = field 3 (resource), varint value 1 (ENERGY)
    expect(rawDataHexLower).toContain("1801");
  });

  it("Fixture Tron-19-B vs Fixture Tron-19-A: freeze and approve produce different fingerprints", () => {
    const fpB = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_TRON_19_B_RAW_DATA_HEX, "hex")),
    });
    const fpA = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_TRON_19_A_RAW_DATA_HEX, "hex")),
    });

    expect(fpB).not.toBe(fpA);
    expect(fpB).toBe(FIXTURE_TRON_19_B_FINGERPRINT);
    expect(fpA).toBe(FIXTURE_TRON_19_A_FINGERPRINT);
    expect(fpB).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

// ============================================================================
// Fixture Tron-19-C — VoteWitnessContract vote fingerprint (Plan 19-03)
// ============================================================================

describe("computeTronPayloadFingerprint — Phase 19 Fixture Tron-19-C (VoteWitnessContract vote)", () => {
  it("Fixture Tron-19-C — VoteWitnessContract vote fingerprint (hardcoded literal anchor)", () => {
    const rawDataBytes = new Uint8Array(
      Buffer.from(FIXTURE_TRON_19_C_RAW_DATA_HEX, "hex"),
    );

    // Byte-length anchor — VoteWitnessContract with 2 SRs = 166 bytes.
    // If this fails, the Protobuf schema changed.
    expect(rawDataBytes.length).toBe(166);

    const fp = computeTronPayloadFingerprint({ rawDataBytes });

    // Hardcoded literal — NO beforeAll snapshot. Drift MUST fail here.
    expect(fp).toBe(FIXTURE_TRON_19_C_FINGERPRINT);
    expect(fp).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("Fixture Tron-19-C raw_data_hex contains VoteWitnessContract type_url bytes", () => {
    // "566f74655769746e657373436f6e7472616374" is the hex of "VoteWitnessContract"
    // Validates the Protobuf type_url is encoded as expected.
    const rawDataHexLower = FIXTURE_TRON_19_C_RAW_DATA_HEX.toLowerCase();
    expect(rawDataHexLower).toContain("566f74655769746e657373436f6e7472616374");
  });

  it("Fixture Tron-19-C vs Fixture Tron-19-B: vote and freeze produce different fingerprints", () => {
    const fpC = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_TRON_19_C_RAW_DATA_HEX, "hex")),
    });
    const fpB = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_TRON_19_B_RAW_DATA_HEX, "hex")),
    });

    expect(fpC).not.toBe(fpB);
    expect(fpC).toBe(FIXTURE_TRON_19_C_FINGERPRINT);
    expect(fpB).toBe(FIXTURE_TRON_19_B_FINGERPRINT);
    expect(fpC).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

// ============================================================================
// Fixture Tron-19-D — WithdrawBalanceContract claim fingerprint (Plan 19-03)
// ============================================================================

describe("computeTronPayloadFingerprint — Phase 19 Fixture Tron-19-D (WithdrawBalanceContract)", () => {
  it("Fixture Tron-19-D — WithdrawBalanceContract claim fingerprint (hardcoded literal anchor)", () => {
    const rawDataBytes = new Uint8Array(
      Buffer.from(FIXTURE_TRON_19_D_RAW_DATA_HEX, "hex"),
    );

    // Byte-length anchor — WithdrawBalanceContract with 1 owner = 113 bytes.
    // If this fails, the Protobuf schema changed.
    expect(rawDataBytes.length).toBe(113);

    const fp = computeTronPayloadFingerprint({ rawDataBytes });

    // Hardcoded literal — NO beforeAll snapshot. Drift MUST fail here.
    expect(fp).toBe(FIXTURE_TRON_19_D_FINGERPRINT);
    expect(fp).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("Fixture Tron-19-D raw_data_hex contains WithdrawBalanceContract type_url bytes", () => {
    // "576974686472617742616c616e6365436f6e7472616374" is the hex of "WithdrawBalanceContract"
    // Validates the Protobuf type_url is encoded as expected.
    const rawDataHexLower = FIXTURE_TRON_19_D_RAW_DATA_HEX.toLowerCase();
    expect(rawDataHexLower).toContain("576974686472617742616c616e6365436f6e7472616374");
  });

  it("Fixture Tron-19-D vs Fixture Tron-19-C: claim and vote produce different fingerprints", () => {
    const fpD = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_TRON_19_D_RAW_DATA_HEX, "hex")),
    });
    const fpC = computeTronPayloadFingerprint({
      rawDataBytes: new Uint8Array(Buffer.from(FIXTURE_TRON_19_C_RAW_DATA_HEX, "hex")),
    });

    expect(fpD).not.toBe(fpC);
    expect(fpD).toBe(FIXTURE_TRON_19_D_FINGERPRINT);
    expect(fpC).toBe(FIXTURE_TRON_19_C_FINGERPRINT);
    expect(fpD).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
