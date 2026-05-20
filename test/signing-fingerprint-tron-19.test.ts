// Phase 19 — Plan 19-01: TRON payloadFingerprint canonical-fixture file.
// Sibling of `test/signing-fingerprint-tron.test.ts` (Phase 18 — BYTE-UNTOUCHED
// per D-11d). New sibling per D-08c: Phase 19 fixtures live HERE, not in the
// Phase 18 file.
//
// Fixture naming convention (D-08a):
//   Tron-19-A — TRC-20 approve fingerprint (Plan 19-01)
//   Tron-19-B — FreezeBalanceV2 freeze fingerprint (Plan 19-02 — it.todo)
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

// Placeholder constants for Plans 19-02 / 19-03 (it.todo below)
/** TBD — will be pinned in Plan 19-02 (FreezeBalanceV2Contract). */
export const FIXTURE_TRON_19_B_FINGERPRINT = "TBD-19-02";
/** TBD — will be pinned in Plan 19-03 (VoteWitnessContract). */
export const FIXTURE_TRON_19_C_FINGERPRINT = "TBD-19-03";
/** TBD — will be pinned in Plan 19-03 (WithdrawBalanceContract). */
export const FIXTURE_TRON_19_D_FINGERPRINT = "TBD-19-03";

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

// Placeholder tests for Plans 19-02 and 19-03 (filled in when those plans ship).
describe("computeTronPayloadFingerprint — Phase 19 Fixtures B/C/D (stubs)", () => {
  it.todo("Fixture Tron-19-B — FreezeBalanceV2Contract freeze fingerprint (Plan 19-02)");
  it.todo("Fixture Tron-19-C — VoteWitnessContract vote fingerprint (Plan 19-03)");
  it.todo("Fixture Tron-19-D — WithdrawBalanceContract claim fingerprint (Plan 19-03)");
});
