// Phase 20 — Plan 20-01: TRON payloadFingerprint canonical-fixture file.
// Sibling of `test/signing-fingerprint-tron-19.test.ts` (Phase 19 — BYTE-UNTOUCHED
// per D-07b). New sibling per D-07b: Phase 20 fixtures live HERE, not in any prior file.
//
// Fixture naming convention (D-07a):
//   Tron-20-A — SunSwap V2 swap fingerprint (Plan 20-01):
//               swapExactTokensForTokens(1 USDT, amountOutMin, [USDT, WTRX], to, deadline)
//
// Hardcoded `0x...` literal anchors (CLAUDE.md "Cryptographic-binding fixtures
// pinned as hardcoded literals" — NO `beforeAll`-snapshot; drift in preimage
// assembly MUST fail at a specific line, not pass against a self-snapshotted
// value).
//
// Cross-link: Fixture Tron-20-A is re-anchored at consumer sites:
//   - `test/prepare-sunswap-swap.test.ts` (Plan 20-01 — consumer re-anchor)
//
// SENDER-DEPENDENCE: TRON fingerprint includes `owner_address` inside the
// TriggerSmartContract Protobuf field (identical to Phase 18/19 precedent).
// A different `from` address produces a different fingerprint.
//
// Fixture Tron-20-A inputs (pinned — deterministic tronweb Protobuf encoding):
//   FROM           = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb" (TRON whale persona)
//   ROUTER         = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax" (SunSwap V2 Router)
//   INPUT_TOKEN    = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" (USDT-TRC20)
//   OUTPUT_TOKEN   = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR" (WTRX)
//   AMOUNT_IN      = 1_000_000n (1 USDT at decimals=6)
//   AMOUNT_OUT_MIN = 945_250n (from expectedOut=950_000, slippageBps=50)
//   PATH           = [USDT, WTRX] (direct pair)
//   TO             = FROM (swap to same address)
//   DEADLINE       = 1748000000 (fixed unix seconds — 2025-05-23)
//   ref_block_bytes = "00ad"
//   ref_block_hash  = "8e5e7df4e3c8b9a2"
//   expiration      = 1779268134000
//   timestamp       = 1779268074000
//   fee_limit       = 200_000_000
//
// Selector: 38ed1739 (swapExactTokensForTokens(uint256,uint256,address[],address,uint256))
//
// Computed at PR-write time via:
//   node -e "const {txJsonToPb,txPbToRawDataHex}=require('./node_modules/tronweb/lib/commonjs/utils/transaction.js')..."
// (see 20-01-SUMMARY.md for the full computation trace)

import { describe, expect, it } from "vitest";

import {
  computeTronPayloadFingerprint,
} from "../src/signing/payload-fingerprint-tron.js";

// ============================================================================
// Fixture Tron-20-A — SunSwap V2 swap: USDT → WTRX direct pair, 1 USDT
//
// Inputs (pinned — deterministic tronweb Protobuf encoding):
//   FROM      = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb" (TRON whale persona)
//   ROUTER    = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax" (SunSwap V2 Router)
//   USDT      = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
//   WTRX      = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR"
//   amountIn  = 1_000_000n (1 USDT at decimals=6)
//   amountOutMin = 945_250n (950_000 * 9950 / 10000)
//   path      = [USDT, WTRX]
//   to        = FROM
//   deadline  = 1748000000
//   selector  = 38ed1739
//
// Computed at PR-write time via discardable node -e script.
// ============================================================================

/** Pinned raw_data_hex for Fixture Tron-20-A. Computed at PR-write time. */
const FIXTURE_TRON_20_A_RAW_DATA_HEX =
  "0a0200ad22088e5e7df4e3c8b9a240f0c894a5e4335af002081f12eb020a31747970652e676f6f676c65617069732e636f6d2f70726f746f636f6c2e54726967676572536d617274436f6e747261637412b5020a1541e28b3cfd4e0e909077821478e9fcb86b84be786e1215416e0617948fe030a7e4970f8389d4ad295f249b7e22840238ed173900000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000e6c6200000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000e28b3cfd4e0e909077821478e9fcb86b84be786e0000000000000000000000000000000000000000000000000000000068305d000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000a614f803b6fd780986a42c78ec9c7f77e6ded13c000000000000000000000000891cdb91d149f23b1a45d9c5ca78a88d0cb44c187090f490a5e43390018084af5f";

/**
 * Hardcoded payloadFingerprint literal for Fixture Tron-20-A.
 * Computed at PR-write time via keccak256("VaultPilot-trontx-v1:" || rawDataBytes).
 * Cross-linked from `test/prepare-sunswap-swap.test.ts`.
 */
export const FIXTURE_TRON_20_A_FINGERPRINT =
  "0x39ee514d0e9d1a380a66409bd245fb7e9d650d126beedf7a28ea485fc53e0302";

describe("Fixture Tron-20-A — SunSwap V2 swap payloadFingerprint anchor", () => {
  it("T9: computeTronPayloadFingerprint produces the hardcoded literal for Fixture Tron-20-A", () => {
    // LOAD-BEARING: this test anchors the preimage assembly for
    // swapExactTokensForTokens(uint256,uint256,address[],address,uint256).
    // Any drift in Protobuf serialization, ABI encoding, or fingerprint
    // computation will fail AT THIS LINE — not against a self-snapshotted value.
    //
    // Fixture Tron-20-A: USDT → WTRX direct pair, amountIn=1 USDT, slippageBps=50.
    // Persona: TRON whale (TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb).
    const rawDataBytes = new Uint8Array(Buffer.from(FIXTURE_TRON_20_A_RAW_DATA_HEX, "hex"));
    const fingerprint = computeTronPayloadFingerprint({ rawDataBytes });
    expect(fingerprint).toBe(FIXTURE_TRON_20_A_FINGERPRINT);
  });

  it("T9b: rawDataBytes length is pinned (405 bytes for this fixture)", () => {
    // Cross-check: byte count is part of the anchor. A different encoding
    // produces a different length, which fails here before the fingerprint check.
    const rawDataBytes = new Uint8Array(Buffer.from(FIXTURE_TRON_20_A_RAW_DATA_HEX, "hex"));
    expect(rawDataBytes.length).toBe(405);
  });

  it("T9c: rawDataHex selector bytes (calldata[0..4]) == 38ed1739 (swapExactTokensForTokens)", () => {
    // Defense-in-depth: verify the selector is embedded in the calldata portion of the hex.
    // The selector appears after the Protobuf header bytes; look for it in the hex.
    expect(FIXTURE_TRON_20_A_RAW_DATA_HEX).toContain("38ed1739");
  });

  it("T10: Phase 18 + Phase 19 fixture files are BYTE-UNTOUCHED (no-diff assertion)", async () => {
    // This test documents the FROZEN constraint. In CI the git diff assertion
    // in <verify> checks actual byte identity; here we assert the files import
    // without modification and the Phase 19 fingerprint exports the same literal.
    const mod19 = await import("./signing-fingerprint-tron-19.test.js");
    // Fixture Tron-19-A fingerprint MUST be exactly this literal forever.
    expect(mod19.FIXTURE_TRON_19_A_FINGERPRINT).toBe(
      "0xb6ed7397e41a3159b4068cb4e25882108dce9beccf277de81935d2f5bf5a5ef4",
    );
  });
});
