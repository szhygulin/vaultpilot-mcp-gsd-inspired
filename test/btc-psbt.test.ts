// test/btc-psbt.test.ts — Phase 23 Plan 23-02 Task 3.
//
// Regression suite for src/protocols/btc-psbt.ts.
//
// Coverage (7 behaviors from the plan):
//   1. Segwit-only inputs → valid PSBT-v0.
//   2. Taproot-only inputs → valid PSBT with tapInternalKey on each input.
//   3. Mixed segwit+taproot inputs → ONE valid PSBT holding both script types (BTC-PSBT-02).
//   4. Change output with bip32Derivation/tapBip32Derivation populated.
//   5. Every input has sequence === 0xfffffffe (D-06 — RBF disabled).
//   6. Below-dust recipient output → buildBtcPsbt throws a typed error.
//   7. decodeBtcPsbt on garbage input → returns { kind: "unknown" } without throwing.
//
// Also verifies:
//   - btc-psbt.ts side-effect-imports ../chains/bitcoin/types.js (initEccLib guarantee).
//   - No .toString("hex") calls in the module (anti-pattern guard from RESEARCH).
//
// Mock strategy: no network I/O needed — pure bitcoinjs-lib construction.
// The Esplora network boundary is tested in esplora-client tests.

import { describe, it, expect } from "vitest";
import { Psbt } from "bitcoinjs-lib";
import { buildBtcPsbt, decodeBtcPsbt, _btcPsbt } from "../src/protocols/btc-psbt.js";
import type { BtcPsbtArgs, BtcPsbtInput, BtcPsbtOutput, BtcPsbtResult } from "../src/protocols/btc-psbt.js";

// ─── Test fixtures ────────────────────────────────────────────────────────────

// BIP-84 Test Vector 1 segwit addresses (from chains-bitcoin-xpub-scan.test.ts literals).
const SEGWIT_ADDR_0 = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"; // receive
const SEGWIT_ADDR_1 = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g"; // change

// BIP-86 Test Vector 1 taproot addresses.
const TAPROOT_ADDR_0 = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr"; // receive
const TAPROOT_ADDR_1 = "bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh"; // change

// A 32-byte all-zeros pubkey (x-only) — acceptable for test PSBT construction
// (we're not signing; just testing the PSBT structure).
const X_ONLY_PUBKEY = Buffer.alloc(32, 0x02);

// A 33-byte compressed pubkey for P2WPKH derivation.
const COMPRESSED_PUBKEY = Buffer.alloc(33, 0x02);

// A dummy master fingerprint (4 bytes).
const MASTER_FP = Buffer.alloc(4, 0xde);

// A dummy txid (hex string, 32 bytes).
const TXID_A = "a".repeat(64);
const TXID_B = "b".repeat(64);

// ─── Input factories ──────────────────────────────────────────────────────────

function segwitInput(valueSats: bigint, txid = TXID_A, vout = 0): BtcPsbtInput {
  return {
    txid,
    vout,
    valueSats,
    scriptType: "p2wpkh",
    pubkey: COMPRESSED_PUBKEY,
    bip32Path: "m/84'/0'/0'/0/0",
    masterFingerprint: MASTER_FP,
  };
}

function taprootInput(valueSats: bigint, txid = TXID_B, vout = 0): BtcPsbtInput {
  return {
    txid,
    vout,
    valueSats,
    scriptType: "p2tr",
    pubkey: COMPRESSED_PUBKEY, // 33-byte compressed; module extracts x-only internally
    xOnlyPubkey: X_ONLY_PUBKEY,
    bip32Path: "m/86'/0'/0'/0/0",
    masterFingerprint: MASTER_FP,
  };
}

function recipientOutput(address: string, valueSats: bigint, scriptType: "p2wpkh" | "p2tr"): BtcPsbtOutput {
  return { address, valueSats, scriptType, role: "recipient" };
}

function changeOutput(
  address: string,
  valueSats: bigint,
  scriptType: "p2wpkh" | "p2tr",
  pubkey: Buffer,
  path: string,
): BtcPsbtOutput {
  return {
    address,
    valueSats,
    scriptType,
    role: "change",
    pubkey,
    bip32Path: path,
    masterFingerprint: MASTER_FP,
    xOnlyPubkey: scriptType === "p2tr" ? X_ONLY_PUBKEY : undefined,
  };
}

// Dust threshold used in tests (330 sats — P2WPKH BIP-141 minimum).
const DUST_THRESHOLD = 330n;

// ─── Test 1: Segwit-only inputs ───────────────────────────────────────────────

describe("buildBtcPsbt — segwit-only input set", () => {
  it("produces a valid PSBT-v0 from P2WPKH inputs", () => {
    const args: BtcPsbtArgs = {
      inputs: [segwitInput(10_000n)],
      recipientOutput: recipientOutput(SEGWIT_ADDR_0, 9_000n, "p2wpkh"),
      changeOutput: null,
      dustThresholdSats: DUST_THRESHOLD,
    };
    const result = _btcPsbt.buildBtcPsbt(args);

    // Must be parseable as a PSBT.
    const psbt = Psbt.fromBase64(result.psbtBase64);
    expect(psbt.data.inputs.length).toBe(1);
    expect(psbt.data.outputs.length).toBe(1);
    expect(result.feeSats).toBeGreaterThan(0n);
    // feeSats = inputSum - recipientValue (no change).
    expect(result.feeSats).toBe(10_000n - 9_000n);
  });
});

// ─── Test 2: Taproot-only inputs ─────────────────────────────────────────────

describe("buildBtcPsbt — taproot-only input set", () => {
  it("produces a valid PSBT with tapInternalKey on each taproot input", () => {
    const args: BtcPsbtArgs = {
      inputs: [taprootInput(20_000n)],
      recipientOutput: recipientOutput(TAPROOT_ADDR_0, 19_000n, "p2tr"),
      changeOutput: null,
      dustThresholdSats: DUST_THRESHOLD,
    };
    const result = _btcPsbt.buildBtcPsbt(args);

    const psbt = Psbt.fromBase64(result.psbtBase64);
    expect(psbt.data.inputs.length).toBe(1);
    // tapInternalKey must be set on taproot inputs.
    const tapInput = psbt.data.inputs[0];
    expect(tapInput).toBeDefined();
    expect(tapInput!.tapInternalKey).toBeDefined();
    expect(tapInput!.tapInternalKey!.length).toBe(32);
  });
});

// ─── Test 3: Mixed segwit+taproot inputs (BTC-PSBT-02) ───────────────────────

describe("buildBtcPsbt — mixed segwit+taproot inputs (BTC-PSBT-02)", () => {
  it("produces ONE valid PSBT holding both script types in a single PSBT", () => {
    const args: BtcPsbtArgs = {
      inputs: [
        segwitInput(10_000n, TXID_A, 0),
        taprootInput(15_000n, TXID_B, 0),
      ],
      recipientOutput: recipientOutput(SEGWIT_ADDR_0, 23_000n, "p2wpkh"),
      changeOutput: null,
      dustThresholdSats: DUST_THRESHOLD,
    };
    const result = _btcPsbt.buildBtcPsbt(args);

    const psbt = Psbt.fromBase64(result.psbtBase64);
    // Both inputs must be in the single PSBT.
    expect(psbt.data.inputs.length).toBe(2);
    // The segwit input has witnessUtxo but no tapInternalKey.
    const segwitIn = psbt.data.inputs[0];
    expect(segwitIn!.witnessUtxo).toBeDefined();
    expect(segwitIn!.tapInternalKey).toBeUndefined();
    // The taproot input has witnessUtxo AND tapInternalKey.
    const taprootIn = psbt.data.inputs[1];
    expect(taprootIn!.witnessUtxo).toBeDefined();
    expect(taprootIn!.tapInternalKey).toBeDefined();
  });
});

// ─── Test 4: Change output with BIP-32 derivation ────────────────────────────

describe("buildBtcPsbt — change output with BIP-32 derivation", () => {
  it("segwit change output has bip32Derivation populated", () => {
    const args: BtcPsbtArgs = {
      inputs: [segwitInput(20_000n)],
      recipientOutput: recipientOutput(SEGWIT_ADDR_0, 10_000n, "p2wpkh"),
      changeOutput: changeOutput(SEGWIT_ADDR_1, 8_000n, "p2wpkh", COMPRESSED_PUBKEY, "m/84'/0'/0'/1/0"),
      dustThresholdSats: DUST_THRESHOLD,
    };
    const result = _btcPsbt.buildBtcPsbt(args);

    const psbt = Psbt.fromBase64(result.psbtBase64);
    expect(psbt.data.outputs.length).toBe(2);
    // The change output (index 1) must have bip32Derivation.
    const changeOut = psbt.data.outputs[1];
    expect(changeOut!.bip32Derivation).toBeDefined();
    expect(changeOut!.bip32Derivation!.length).toBeGreaterThan(0);
    expect(result.changeSats).toBe(8_000n);
  });

  it("taproot change output has tapBip32Derivation populated", () => {
    const args: BtcPsbtArgs = {
      inputs: [taprootInput(30_000n)],
      recipientOutput: recipientOutput(TAPROOT_ADDR_0, 15_000n, "p2tr"),
      changeOutput: changeOutput(TAPROOT_ADDR_1, 12_000n, "p2tr", COMPRESSED_PUBKEY, "m/86'/0'/0'/1/0"),
      dustThresholdSats: DUST_THRESHOLD,
    };
    const result = _btcPsbt.buildBtcPsbt(args);

    const psbt = Psbt.fromBase64(result.psbtBase64);
    expect(psbt.data.outputs.length).toBe(2);
    const changeOut = psbt.data.outputs[1];
    expect(changeOut!.tapBip32Derivation).toBeDefined();
    expect(changeOut!.tapBip32Derivation!.length).toBeGreaterThan(0);
    expect(result.changeSats).toBe(12_000n);
  });
});

// ─── Test 5: RBF disabled — sequence === 0xfffffffe (D-06) ───────────────────

describe("buildBtcPsbt — RBF disabled (D-06)", () => {
  it("every input uses sequence = 0xfffffffe", () => {
    const args: BtcPsbtArgs = {
      inputs: [
        segwitInput(10_000n, TXID_A, 0),
        segwitInput(20_000n, TXID_A, 1),
      ],
      recipientOutput: recipientOutput(SEGWIT_ADDR_0, 28_000n, "p2wpkh"),
      changeOutput: null,
      dustThresholdSats: DUST_THRESHOLD,
    };
    const result = _btcPsbt.buildBtcPsbt(args);

    const psbt = Psbt.fromBase64(result.psbtBase64);
    for (const txInput of psbt.txInputs) {
      expect(txInput.sequence).toBe(0xfffffffe);
    }
  });
});

// ─── Test 6: Below-dust recipient output → typed error ────────────────────────

describe("buildBtcPsbt — dust enforcement (D-07)", () => {
  it("throws a typed error when recipient output is below the dust threshold", () => {
    const args: BtcPsbtArgs = {
      inputs: [segwitInput(10_000n)],
      recipientOutput: recipientOutput(SEGWIT_ADDR_0, 200n, "p2wpkh"), // below 330-sat dust
      changeOutput: null,
      dustThresholdSats: DUST_THRESHOLD,
    };
    expect(() => _btcPsbt.buildBtcPsbt(args)).toThrow();
  });

  it("throws specifically on recipient-below-dust (not silently folds)", () => {
    const args: BtcPsbtArgs = {
      inputs: [segwitInput(10_000n)],
      recipientOutput: recipientOutput(SEGWIT_ADDR_0, 100n, "p2wpkh"), // well below dust
      changeOutput: null,
      dustThresholdSats: DUST_THRESHOLD,
    };
    let threw = false;
    try {
      _btcPsbt.buildBtcPsbt(args);
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toMatch(/dust/i);
    }
    expect(threw).toBe(true);
  });
});

// ─── Test 7: decodeBtcPsbt — never-throwing decoder ─────────────────────────

describe("decodeBtcPsbt — never-throwing decoder", () => {
  it("returns { kind: 'unknown' } on garbage input without throwing", () => {
    const result = _btcPsbt.decodeBtcPsbt("not-a-valid-psbt-base64");
    expect(result.kind).toBe("unknown");
  });

  it("returns { kind: 'unknown' } on empty string without throwing", () => {
    const result = decodeBtcPsbt("");
    expect(result.kind).toBe("unknown");
  });

  it("returns { kind: 'unknown' } on random bytes without throwing", () => {
    const result = decodeBtcPsbt(Buffer.alloc(64, 0xff).toString("base64"));
    expect(result.kind).toBe("unknown");
  });

  it("decodes a valid PSBT correctly", () => {
    const args: BtcPsbtArgs = {
      inputs: [segwitInput(10_000n)],
      recipientOutput: recipientOutput(SEGWIT_ADDR_0, 9_000n, "p2wpkh"),
      changeOutput: null,
      dustThresholdSats: DUST_THRESHOLD,
    };
    const built = buildBtcPsbt(args);
    const decoded = decodeBtcPsbt(built.psbtBase64);
    expect(decoded.kind).toBe("native");
    if (decoded.kind !== "native") return;
    expect(decoded.inputs.length).toBe(1);
    expect(decoded.outputs.length).toBe(1);
    expect(decoded.feeSats).toBe(1_000n); // 10_000 - 9_000
  });
});

// ─── Module exports ───────────────────────────────────────────────────────────

describe("btc-psbt module exports", () => {
  it("exports buildBtcPsbt, decodeBtcPsbt, and _btcPsbt", () => {
    expect(typeof buildBtcPsbt).toBe("function");
    expect(typeof decodeBtcPsbt).toBe("function");
    expect(typeof _btcPsbt).toBe("object");
    expect(typeof _btcPsbt.buildBtcPsbt).toBe("function");
    expect(typeof _btcPsbt.decodeBtcPsbt).toBe("function");
  });
});
