// test/btc-sighash.test.ts — Phase 23 Plan 23-01 Task 1.
//
// Wave 0 dependency: validates the per-input BIP-143 / BIP-341 sighash
// compute in `src/signing/btc-sighash.ts`. Covers four behaviors from the
// plan's <behavior> block:
//
//   1. Single P2WPKH (segwit) input → one 32-byte Uint8Array; deterministic.
//   2. Single P2TR (taproot) input → one 32-byte Uint8Array via hashForWitnessV1.
//   3. Mixed segwit+taproot set → taproot sighash changes when the unrelated
//      input's data changes (BIP-341 whole-prevout-set commitment); segwit
//      sighash does NOT change (BIP-143 per-input scope). Both assertions
//      present — REGRESSION ANCHOR for the critical asymmetry.
//   4. Empty input array → returns empty array (no throw).
//
// bytesToHex from @noble/hashes/utils is used for all Uint8Array→hex
// conversions — bitcoinjs-lib@7 is Buffer-free; `.toString("hex")` on a
// Uint8Array is PROHIBITED (Phase 22 Pitfall 6 / RESEARCH Anti-Patterns).
//
// The `initEccLib` side-effect fires via `btc-sighash.ts`'s side-effect
// import of `../chains/bitcoin/types.js` — taproot `hashForWitnessV1`
// throws "No ECC Library provided" without it.

import { Transaction, networks, payments } from "bitcoinjs-lib";
import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";

import {
  _btcSighash,
  computeAllSighashes,
} from "../src/signing/btc-sighash.js";

// ============================================================================
// Test fixtures — hardcoded to zero network I/O and zero randomness.
//
// Public key: compressed secp256k1 generator point G (well-known constant).
// x-only key: G[1..33] (drop the 02 prefix, 32-byte x-only).
// P2WPKH script: OP_0 <20-byte HASH160(G)>
// P2TR script:   OP_1 <32-byte taptweak(G.x)>
// ============================================================================
const PUBKEY = Buffer.from(
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  "hex",
);
const X_ONLY = PUBKEY.slice(1); // 32-byte x-only pubkey

const p2wpkhPayment = payments.p2wpkh({
  pubkey: PUBKEY,
  network: networks.bitcoin,
});
const p2trPayment = payments.p2tr({
  internalPubkey: X_ONLY,
  network: networks.bitcoin,
});

// These scripts are stable constants derived from the fixed public key above.
const SEGWIT_SCRIPT = p2wpkhPayment.output as Uint8Array;
const TAPROOT_SCRIPT = p2trPayment.output as Uint8Array;

// Sat values — arbitrary but fixed for regression purposes.
const SEGWIT_VALUE_SATS = BigInt(100_000);
const TAPROOT_VALUE_SATS = BigInt(200_000);
const UNRELATED_VALUE_A = BigInt(300_000); // variant A for the mixed test
const UNRELATED_VALUE_B = BigInt(400_000); // variant B (different) for the mixed test

// Reusable 32-byte txid buffers — each input gets a distinct byte fill so
// the tx structure is unambiguous.
const TXID_AA = Buffer.alloc(32, 0xaa);
const TXID_BB = Buffer.alloc(32, 0xbb);
const TXID_CC = Buffer.alloc(32, 0xcc);

describe("computeAllSighashes — BIP-143/341 per-input sighash compute", () => {
  // --------------------------------------------------------------------------
  // Behavior 1: Single P2WPKH (segwit) input — hashForWitnessV0 path.
  // --------------------------------------------------------------------------
  it("single P2WPKH input → returns one 32-byte Uint8Array; byte-for-byte deterministic", () => {
    const tx = new Transaction();
    tx.addInput(TXID_AA, 0, 0xfffffffe); // RBF-disabled sequence (D-06)
    tx.addOutput(SEGWIT_SCRIPT, BigInt(40_000));

    const inputs = [
      {
        scriptType: "p2wpkh" as const,
        prevOutScript: SEGWIT_SCRIPT,
        valueSats: SEGWIT_VALUE_SATS,
      },
    ];

    const sighashes = computeAllSighashes(tx, inputs);
    expect(sighashes).toHaveLength(1);
    expect(sighashes[0]).toBeInstanceOf(Uint8Array);
    expect(sighashes[0].length).toBe(32);

    // Deterministic: identical input bytes produce byte-identical output run-to-run.
    const sighashes2 = computeAllSighashes(tx, inputs);
    expect(bytesToHex(sighashes[0])).toBe(bytesToHex(sighashes2[0]));

    // Exact value anchor — computed once at write time via bitcoinjs-lib@7.0.1.
    expect(bytesToHex(sighashes[0])).toBe(
      "8aecd8ba078bd64e13aa372efaa3be5b8ac06b5c77f4055e48f1d2b7c1cb8af0",
    );
  });

  // --------------------------------------------------------------------------
  // Behavior 2: Single P2TR (taproot) input — hashForWitnessV1 path.
  // --------------------------------------------------------------------------
  it("single P2TR input → returns one 32-byte Uint8Array via hashForWitnessV1; byte-for-byte deterministic", () => {
    const tx = new Transaction();
    tx.addInput(TXID_BB, 0, 0xfffffffe);
    tx.addOutput(TAPROOT_SCRIPT, BigInt(50_000));

    const inputs = [
      {
        scriptType: "p2tr" as const,
        prevOutScript: TAPROOT_SCRIPT,
        valueSats: TAPROOT_VALUE_SATS,
      },
    ];

    const sighashes = computeAllSighashes(tx, inputs);
    expect(sighashes).toHaveLength(1);
    expect(sighashes[0]).toBeInstanceOf(Uint8Array);
    expect(sighashes[0].length).toBe(32);

    // Deterministic run-to-run.
    const sighashes2 = computeAllSighashes(tx, inputs);
    expect(bytesToHex(sighashes[0])).toBe(bytesToHex(sighashes2[0]));

    // Exact value anchor — computed once at write time via bitcoinjs-lib@7.0.1.
    expect(bytesToHex(sighashes[0])).toBe(
      "e864c348009b19a80266af0a0f8c8a9d4798a1545e368a5159d665f7f2cc8d06",
    );
  });

  // --------------------------------------------------------------------------
  // Behavior 3: Mixed segwit + taproot — REGRESSION ANCHOR for BIP-343/341 asymmetry.
  //
  // Tx has 3 inputs (segwit[0], taproot[1], unrelated taproot[2]).
  // We compute `computeAllSighashes` twice with the SAME tx but different
  // `inputs[2].valueSats` (variant A vs variant B).
  //
  // Expected:
  //   - segwit sighash[0] is UNCHANGED — hashForWitnessV0 only commits to
  //     `inp.prevOutScript` + `inp.valueSats` (this input's own prevout data).
  //     BIP-143 does not include the unrelated input's value.
  //   - taproot sighash[1] CHANGES — hashForWitnessV1 commits to allValues[]
  //     (the whole prevout-value set, BIP-341 sha_amounts). Changing ANY
  //     input's value changes EVERY taproot sighash in the transaction.
  //
  // Both assertions MUST be present — removing either is a regression that
  // hides half of the segwit/taproot asymmetry (Threat T-23-01).
  // --------------------------------------------------------------------------
  it("mixed P2WPKH+P2TR set — taproot sighash changes when unrelated input value changes; segwit sighash does NOT change (BIP-341 whole-prevout-set commitment vs BIP-143 per-input scope)", () => {
    // Build a tx with 3 inputs so hashForWitnessV1 receives consistent array lengths.
    const tx = new Transaction();
    tx.addInput(TXID_AA, 0, 0xfffffffe); // segwit input at index 0
    tx.addInput(TXID_BB, 0, 0xfffffffe); // taproot input at index 1
    tx.addInput(TXID_CC, 0, 0xfffffffe); // unrelated taproot input at index 2
    tx.addOutput(SEGWIT_SCRIPT, BigInt(150_000));

    const inputsA = [
      {
        scriptType: "p2wpkh" as const,
        prevOutScript: SEGWIT_SCRIPT,
        valueSats: SEGWIT_VALUE_SATS,
      },
      {
        scriptType: "p2tr" as const,
        prevOutScript: TAPROOT_SCRIPT,
        valueSats: TAPROOT_VALUE_SATS,
      },
      {
        scriptType: "p2tr" as const,
        prevOutScript: TAPROOT_SCRIPT,
        valueSats: UNRELATED_VALUE_A, // variant A
      },
    ];

    const inputsB = [
      {
        scriptType: "p2wpkh" as const,
        prevOutScript: SEGWIT_SCRIPT,
        valueSats: SEGWIT_VALUE_SATS,
      },
      {
        scriptType: "p2tr" as const,
        prevOutScript: TAPROOT_SCRIPT,
        valueSats: TAPROOT_VALUE_SATS,
      },
      {
        scriptType: "p2tr" as const,
        prevOutScript: TAPROOT_SCRIPT,
        valueSats: UNRELATED_VALUE_B, // variant B — different value for unrelated input
      },
    ];

    const hashesA = computeAllSighashes(tx, inputsA);
    const hashesB = computeAllSighashes(tx, inputsB);

    // ASSERTION 1: Taproot sighash CHANGES when the unrelated input's value
    // changes — BIP-341 sha_amounts covers the ENTIRE prevout-value set.
    // Failing this assertion means `computeAllSighashes` is passing only the
    // current input's value to hashForWitnessV1 instead of allValues[] —
    // that produces a wrong-but-plausible hash the Ledger device will reject.
    expect(bytesToHex(hashesA[1])).not.toBe(bytesToHex(hashesB[1]));

    // Exact anchors — both taproot hashes differ, and both are valid 32-byte hashes.
    expect(bytesToHex(hashesA[1])).toBe(
      "33cac3c885ddb77161de8b59fc1b64c815703b087304bf747ae6d2d2a0a07a77",
    );
    expect(bytesToHex(hashesB[1])).toBe(
      "1ad3f129ebfab6c4dfcc8ac3ce5b6a6980e0e55d68f23bb509e799505e201ab6",
    );

    // ASSERTION 2: Segwit sighash does NOT change — hashForWitnessV0 only
    // uses `inp.prevOutScript` + `inp.valueSats` (this input's own prevout).
    // The unrelated input's value change is invisible to the segwit API.
    expect(bytesToHex(hashesA[0])).toBe(bytesToHex(hashesB[0]));

    // Exact anchor for the stable segwit hash.
    expect(bytesToHex(hashesA[0])).toBe(
      "97ad374214ca47286653d634c1a8a8ae2048bc97a4480a3c076988402e6595b9",
    );
  });

  // --------------------------------------------------------------------------
  // Behavior 4: Empty input array → returns empty array (no throw).
  // --------------------------------------------------------------------------
  it("empty input array → returns empty array without throwing", () => {
    const tx = new Transaction();
    tx.addOutput(SEGWIT_SCRIPT, BigInt(40_000));

    const sighashes = computeAllSighashes(tx, []);
    expect(sighashes).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // ESM spy-affordance: _btcSighash object exposes computeAllSighashes.
  // --------------------------------------------------------------------------
  it("_btcSighash spy-affordance object exports computeAllSighashes", () => {
    expect(typeof _btcSighash.computeAllSighashes).toBe("function");
    expect(_btcSighash.computeAllSighashes).toBe(computeAllSighashes);
  });
});
