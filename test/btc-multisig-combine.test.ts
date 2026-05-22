// test/btc-multisig-combine.test.ts — Phase 25 Plan 25-02 Task 1 (TDD RED)
//
// Tests for combineBtcPsbts — the pre-combine conflict scan (BTC-PSBT-05).
//
// Security guarantee being tested:
//   bip174 keyPusher silently drops duplicate keys (self wins).
//   combineBtcPsbts MUST detect same-key same-input signature conflicts
//   BEFORE any Psbt.combine() call, returning { kind: "conflict" } instead
//   of silently discarding a co-signer's signature.
//
// Test PSBTs are constructed inline from the 2-of-3 test descriptor xpubs
// already established in Plan 25-01:
//   TEST_XPUB_0/1/2 derived from BIP-32 test vector 1 seed at m/84'/0'/0..2'
//
// Fixture PSBTs are assembled programmatically so the test is deterministic
// and self-contained.  The "conflict" case injects two different DER-encoded
// signatures for the same pubkey on the same input.

import { describe, expect, it } from "vitest";

import {
  Psbt,
  networks,
  payments,
} from "bitcoinjs-lib";
import { BIP32Factory } from "bip32";
import * as tinySecp256k1 from "tiny-secp256k1";

import { combineBtcPsbts } from "../src/protocols/btc-psbt.js";
import "../src/chains/bitcoin/types.js"; // initEccLib side-effect

// --------------------------------------------------------------------------
// BIP-32 test vector xpubs (same as btc-multisig-address-derivation.test.ts)
// --------------------------------------------------------------------------
const TEST_XPUB_0 = "xpub6C1HVMz946r433QEjZGpYYWYcspxXXBPys5PBGkmQboRXE6RLfFiStEkKbWKCZaPgDrzZh9nUEunxuiuy6MNdw23du2Ek7GoKYMJVH8eK5E";
const TEST_XPUB_1 = "xpub6C1HVMz946r45SLqXksZWuaVdbpznU1s5peogGPTXqkHcXChkh7TN9vC2mgcSFkdA5YpX94xfAPWZTPoDJhGbUdVwF13RfkY9ioGHSLEuUE";
const TEST_XPUB_2 = "xpub6C1HVMz946r488Vd17BsrsybenwSabqNkg5b42wvkZKnru8Wzgp56AaLERXpDastZzbDMWFpcEh9TJy64YHEnfRg2Se6Zj4W88srAcemued";

// --------------------------------------------------------------------------
// Helpers to build a minimal P2WSH 2-of-3 multisig PSBT for testing.
//
// We derive 3 child pubkeys from the test xpubs at index 0, sort them BIP-67,
// build a p2wsh(p2ms) witnessUtxo, then build a PSBT with one input and one
// output.  No signatures are added initially — the "signer" tests inject
// artificial partial-sig entries manually.
// --------------------------------------------------------------------------

const bip32 = BIP32Factory(tinySecp256k1 as Parameters<typeof BIP32Factory>[0]);

function derivePubkeys(index: number): Buffer[] {
  return [TEST_XPUB_0, TEST_XPUB_1, TEST_XPUB_2].map((xpub) => {
    const node = bip32.fromBase58(xpub, networks.bitcoin);
    return Buffer.from(node.derive(0).derive(index).publicKey);
  });
}

function buildBaseMultisigPsbt(index: number = 0): Psbt {
  const pubkeys = derivePubkeys(index);
  const sorted = [...pubkeys].sort(Buffer.compare);

  const p2ms = payments.p2ms({ m: 2, pubkeys: sorted, network: networks.bitcoin });
  const p2wsh = payments.p2wsh({ redeem: p2ms, network: networks.bitcoin });
  if (!p2wsh.output) throw new Error("p2wsh.output is undefined");

  const psbt = new Psbt({ network: networks.bitcoin });
  psbt.addInput({
    hash: Buffer.alloc(32, 0xaa),
    index: 0,
    sequence: 0xfffffffe,
    witnessUtxo: {
      script: Buffer.from(p2wsh.output),
      value: BigInt(1_000_000),
    },
    witnessScript: Buffer.from(p2ms.output!),
  });
  // Recipient output: send back to same P2WSH address for simplicity
  psbt.addOutput({
    script: Buffer.from(p2wsh.output),
    value: BigInt(900_000),
  });
  return psbt;
}

/**
 * Build a PSBT with a partial signature injected at inputIndex for the given pubkey.
 * sigBytes must be a valid DER-looking buffer (any non-empty buffer works for
 * conflict detection — we only compare bytes, not validate signatures).
 */
function buildPsbtWithSig(pubkey: Buffer, sigBytes: Buffer, index: number = 0): Psbt {
  const psbt = buildBaseMultisigPsbt(index);
  psbt.data.inputs[0]!.partialSig = [{ pubkey, signature: sigBytes }];
  return psbt;
}

// Two distinct synthetic DER-encoded signatures (not cryptographically valid —
// used only for byte-comparison in conflict detection).
const SIG_A = Buffer.from(
  "3044022001" + "a".repeat(62) + "022001" + "b".repeat(62),
  "hex",
);
const SIG_B = Buffer.from(
  "3044022001" + "c".repeat(62) + "022001" + "d".repeat(62),
  "hex",
);

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("combineBtcPsbts — error on bad input", () => {
  it("returns { kind: 'error' } when any element is not a parseable PSBT base64", () => {
    const result = combineBtcPsbts(["not-a-psbt", "also-not-a-psbt"]);
    expect(result.kind).toBe("error");
  });

  it("returns { kind: 'error' } on a single malformed string mixed with a valid PSBT", () => {
    const validPsbt = buildBaseMultisigPsbt().toBase64();
    const result = combineBtcPsbts([validPsbt, "garbage"]);
    expect(result.kind).toBe("error");
  });

  it("returns { kind: 'error' } when called with 0 PSBTs (IN-01 self-guard)", () => {
    const result = combineBtcPsbts([]);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toMatch(/at least 2/i);
  });

  it("returns { kind: 'error' } when called with exactly 1 PSBT (IN-01 self-guard)", () => {
    const validPsbt = buildBaseMultisigPsbt().toBase64();
    const result = combineBtcPsbts([validPsbt]);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toMatch(/at least 2/i);
  });
});

describe("combineBtcPsbts — conflict detection (load-bearing security test)", () => {
  it("returns { kind: 'conflict' } when same pubkey has different signatures on same input (T-25-06)", () => {
    const pubkeys = derivePubkeys(0);
    const sorted = [...pubkeys].sort(Buffer.compare);
    const pubkey = sorted[0]!;

    const psbtA = buildPsbtWithSig(pubkey, SIG_A);
    const psbtB = buildPsbtWithSig(pubkey, SIG_B);

    const result = combineBtcPsbts([psbtA.toBase64(), psbtB.toBase64()]);

    expect(result.kind).toBe("conflict");
    if (result.kind !== "conflict") return; // type narrowing

    expect(result.conflicts.length).toBeGreaterThan(0);
    const conflict = result.conflicts[0]!;
    expect(conflict.inputIndex).toBe(0);
    expect(conflict.pubkeyHex).toBe(pubkey.toString("hex"));
    expect(conflict.sigHex0).toBe(SIG_A.toString("hex"));
    expect(conflict.sigHex1).toBe(SIG_B.toString("hex"));
  });

  it("Psbt.combine is NOT called when a conflict is detected (psbt has no co-signer sig merged in)", () => {
    // If combine were called, the combined PSBT would only have SIG_A (self wins).
    // We verify this by checking the result is kind:"conflict", never kind:"ok".
    const pubkeys = derivePubkeys(0);
    const sorted = [...pubkeys].sort(Buffer.compare);
    const pubkey = sorted[0]!;

    const psbtA = buildPsbtWithSig(pubkey, SIG_A);
    const psbtB = buildPsbtWithSig(pubkey, SIG_B);

    const result = combineBtcPsbts([psbtA.toBase64(), psbtB.toBase64()]);
    // If combine had been called, result would be kind:"ok" (or would not be conflict).
    // The security property is: conflict → never "ok".
    expect(result.kind).toBe("conflict");
    expect(result.kind).not.toBe("ok");
  });

  it("collects conflicts across all pairs, not just adjacent ones", () => {
    // PSBTs: A(sig_a), B(no sig), C(sig_b) where A and C conflict.
    const pubkeys = derivePubkeys(0);
    const sorted = [...pubkeys].sort(Buffer.compare);
    const pubkey = sorted[0]!;

    const psbtA = buildPsbtWithSig(pubkey, SIG_A);
    const psbtB = buildBaseMultisigPsbt(); // no sig
    const psbtC = buildPsbtWithSig(pubkey, SIG_B);

    const result = combineBtcPsbts([psbtA.toBase64(), psbtB.toBase64(), psbtC.toBase64()]);
    expect(result.kind).toBe("conflict");
    if (result.kind !== "conflict") return;
    expect(result.conflicts.length).toBeGreaterThan(0);
  });
});

describe("combineBtcPsbts — idempotent re-submission (identical sigs)", () => {
  it("returns { kind: 'ok' } when both PSBTs have identical signature bytes for the same pubkey on the same input", () => {
    const pubkeys = derivePubkeys(0);
    const sorted = [...pubkeys].sort(Buffer.compare);
    const pubkey = sorted[0]!;

    const psbtA = buildPsbtWithSig(pubkey, SIG_A);
    const psbtB = buildPsbtWithSig(pubkey, SIG_A); // identical — NOT a conflict

    const result = combineBtcPsbts([psbtA.toBase64(), psbtB.toBase64()]);
    expect(result.kind).toBe("ok");
  });
});

describe("combineBtcPsbts — successful merge", () => {
  it("returns { kind: 'ok', psbtBase64 } when PSBTs have no overlapping signatures", () => {
    const pubkeys = derivePubkeys(0);
    const sorted = [...pubkeys].sort(Buffer.compare);
    const pubkey0 = sorted[0]!;
    const pubkey1 = sorted[1]!;

    // psbtA has sig from pubkey0, psbtB has sig from pubkey1 — no overlap
    const psbtA = buildPsbtWithSig(pubkey0, SIG_A);
    const psbtB = buildPsbtWithSig(pubkey1, SIG_B);

    const result = combineBtcPsbts([psbtA.toBase64(), psbtB.toBase64()]);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return; // type narrowing

    // Verify the combined PSBT contains both signatures.
    const combined = Psbt.fromBase64(result.psbtBase64);
    const partialSigs = combined.data.inputs[0]!.partialSig ?? [];
    expect(partialSigs.length).toBe(2);

    const pubkeyHexes = partialSigs.map((ps) => Buffer.from(ps.pubkey).toString("hex"));
    expect(pubkeyHexes).toContain(pubkey0.toString("hex"));
    expect(pubkeyHexes).toContain(pubkey1.toString("hex"));
  });

  it("returns a non-empty psbtBase64 string on successful merge", () => {
    const pubkeys = derivePubkeys(0);
    const sorted = [...pubkeys].sort(Buffer.compare);

    const psbtA = buildPsbtWithSig(sorted[0]!, SIG_A);
    const psbtB = buildPsbtWithSig(sorted[1]!, SIG_B);

    const result = combineBtcPsbts([psbtA.toBase64(), psbtB.toBase64()]);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.psbtBase64.length).toBeGreaterThan(0);
  });
});
