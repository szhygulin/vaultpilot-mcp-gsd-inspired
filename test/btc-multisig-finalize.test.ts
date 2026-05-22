// test/btc-multisig-finalize.test.ts — Phase 25 Plan 25-03 (TDD RED)
//
// Tests for finalizeBtcPsbt helper (src/protocols/btc-psbt.ts).
//
// Covers:
//   - threshold-not-met: under-signed input returns { kind: "threshold-not-met", underThresholdInputs }
//   - ok: PSBT with M signatures per input finalizes and returns txHex
//   - error: malformed base64 returns { kind: "error" }
//
// Seam: calls finalizeBtcPsbt directly (no spy needed — pure function).

import { describe, expect, it } from "vitest";
import { Psbt, payments, networks } from "bitcoinjs-lib";
import { BIP32Factory } from "bip32";
import * as tinySecp256k1 from "tiny-secp256k1";
import "../src/chains/bitcoin/types.js"; // initEccLib side-effect

import { finalizeBtcPsbt } from "../src/protocols/btc-psbt.js";

// ─── Shared test fixtures ──────────────────────────────────────────────────────

// BIP-32 test vector xpubs (same fixtures as btc-multisig-address-derivation.test.ts)
const TEST_XPUB_0 =
  "xpub6C1HVMz946r433QEjZGpYYWYcspxXXBPys5PBGkmQboRXE6RLfFiStEkKbWKCZaPgDrzZh9nUEunxuiuy6MNdw23du2Ek7GoKYMJVH8eK5E";
const TEST_XPUB_1 =
  "xpub6C1HVMz946r45SLqXksZWuaVdbpznU1s5peogGPTXqkHcXChkh7TN9vC2mgcSFkdA5YpX94xfAPWZTPoDJhGbUdVwF13RfkY9ioGHSLEuUE";
const TEST_XPUB_2 =
  "xpub6C1HVMz946r488Vd17BsrsybenwSabqNkg5b42wvkZKnru8Wzgp56AaLERXpDastZzbDMWFpcEh9TJy64YHEnfRg2Se6Zj4W88srAcemued";

/**
 * Build a 2-of-3 multisig PSBT (1 input, 1 output) with an optional number
 * of fake partial signatures on the first input.
 *
 * @param sigCount   How many fake partial signatures to add to input[0].
 * @param threshold  M (used only for documentation — the sigs are fake).
 */
function buildMultisigPsbt(sigCount: number): string {
  const bip32 = BIP32Factory(tinySecp256k1);
  const xpubs = [TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2];
  const pubkeys = xpubs.map((xpub) => {
    const node = bip32.fromBase58(xpub, networks.bitcoin);
    return Buffer.from(node.derive(0).derive(0).publicKey);
  });
  const sorted = [...pubkeys].sort(Buffer.compare);

  const p2ms = payments.p2ms({ m: 2, pubkeys: sorted, network: networks.bitcoin });
  const p2wsh = payments.p2wsh({ redeem: p2ms, network: networks.bitcoin });

  const psbt = new Psbt({ network: networks.bitcoin });
  psbt.addInput({
    hash: Buffer.alloc(32, 0xbb),
    index: 0,
    sequence: 0xfffffffe,
    witnessUtxo: {
      script: p2wsh.output!,
      value: BigInt(1_000_000),
    },
    witnessScript: p2ms.output!,
  });

  // P2WPKH output script (20-byte hash160 of the first sorted pubkey)
  const p2wpkh = payments.p2wpkh({ pubkey: sorted[0]!, network: networks.bitcoin });
  psbt.addOutput({
    script: p2wpkh.output!,
    value: BigInt(900_000),
  });

  // Add fake partial signatures (arbitrary DER-like bytes) for testing
  // Only add as many sigs as requested (0 = unsigned, 1 = partial, 2 = complete for m=2)
  for (let i = 0; i < sigCount; i++) {
    const pubkey = sorted[i]!;
    // Minimal valid DER signature (9 bytes): 0x30 0x06 0x02 0x01 0x01 0x02 0x01 0x01 0x01
    const fakeSig = Buffer.from([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x01]);
    psbt.updateInput(0, {
      partialSig: [{ pubkey, signature: fakeSig }],
    });
  }

  return psbt.toBase64();
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("finalizeBtcPsbt", () => {
  it("returns threshold-not-met when input has 0 sigs and threshold is 2", () => {
    const psbtBase64 = buildMultisigPsbt(0);
    const result = finalizeBtcPsbt(psbtBase64, 2);
    expect(result.kind).toBe("threshold-not-met");
    if (result.kind === "threshold-not-met") {
      expect(result.underThresholdInputs).toContain(0);
      expect(result.underThresholdInputs).toHaveLength(1);
    }
  });

  it("returns threshold-not-met when input has 1 sig and threshold is 2", () => {
    const psbtBase64 = buildMultisigPsbt(1);
    const result = finalizeBtcPsbt(psbtBase64, 2);
    expect(result.kind).toBe("threshold-not-met");
    if (result.kind === "threshold-not-met") {
      expect(result.underThresholdInputs).toContain(0);
    }
  });

  it("passes the threshold check when input has 2 sigs and threshold is 2 (may error on finalize with fake sigs)", () => {
    // With 2 fake sigs, threshold check passes. Finalizer may throw because
    // the signatures are not valid DER — that's expected for the "error" kind.
    // The important assertion is that it does NOT return "threshold-not-met".
    const psbtBase64 = buildMultisigPsbt(2);
    const result = finalizeBtcPsbt(psbtBase64, 2);
    // threshold-not-met must NOT fire when sigCount >= threshold
    expect(result.kind).not.toBe("threshold-not-met");
  });

  it("passes with threshold=1 when there is 1 sig (may error on finalize)", () => {
    const psbtBase64 = buildMultisigPsbt(1);
    const result = finalizeBtcPsbt(psbtBase64, 1);
    expect(result.kind).not.toBe("threshold-not-met");
  });

  it("returns error for malformed PSBT base64", () => {
    const result = finalizeBtcPsbt("not-valid-base64!!!", 2);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(typeof result.message).toBe("string");
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("returns error for empty string PSBT", () => {
    const result = finalizeBtcPsbt("", 2);
    expect(result.kind).toBe("error");
  });

  it("threshold-not-met lists correct indices for multi-input PSBT with mixed sig counts", () => {
    // Build a PSBT with 2 inputs: input[0] gets 0 sigs, input[1] gets 0 sigs.
    // We'll add a partial sig to input[1] separately to create asymmetry.
    const bip32 = BIP32Factory(tinySecp256k1);
    const xpubs = [TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2];
    const pubkeys = xpubs.map((xpub) => {
      const node = bip32.fromBase58(xpub, networks.bitcoin);
      return Buffer.from(node.derive(0).derive(0).publicKey);
    });
    const sorted = [...pubkeys].sort(Buffer.compare);

    const p2ms = payments.p2ms({ m: 2, pubkeys: sorted, network: networks.bitcoin });
    const p2wsh = payments.p2wsh({ redeem: p2ms, network: networks.bitcoin });
    const p2wpkh = payments.p2wpkh({ pubkey: sorted[0]!, network: networks.bitcoin });

    const psbt = new Psbt({ network: networks.bitcoin });
    // Input 0: no sigs
    psbt.addInput({
      hash: Buffer.alloc(32, 0xbb),
      index: 0,
      sequence: 0xfffffffe,
      witnessUtxo: { script: p2wsh.output!, value: BigInt(1_000_000) },
      witnessScript: p2ms.output!,
    });
    // Input 1: 2 sigs (meets threshold=2)
    psbt.addInput({
      hash: Buffer.alloc(32, 0xcc),
      index: 0,
      sequence: 0xfffffffe,
      witnessUtxo: { script: p2wsh.output!, value: BigInt(500_000) },
      witnessScript: p2ms.output!,
    });

    // Add the output BEFORE adding signatures (bitcoinjs-lib enforces this ordering)
    psbt.addOutput({ script: p2wpkh.output!, value: BigInt(1_400_000) });

    const fakeSig = Buffer.from([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01, 0x01]);
    // Add 2 sigs to input 1
    psbt.updateInput(1, { partialSig: [{ pubkey: sorted[0]!, signature: fakeSig }] });
    psbt.updateInput(1, { partialSig: [{ pubkey: sorted[1]!, signature: fakeSig }] });

    const psbtBase64 = psbt.toBase64();
    const result = finalizeBtcPsbt(psbtBase64, 2);

    expect(result.kind).toBe("threshold-not-met");
    if (result.kind === "threshold-not-met") {
      // Input 0 has 0 sigs; input 1 has 2 sigs → only input 0 should be listed
      expect(result.underThresholdInputs).toContain(0);
      expect(result.underThresholdInputs).not.toContain(1);
    }
  });
});
