// src/protocols/btc-psbt.ts — Phase 23 Plan 23-02 Task 3.
//
// PSBT-v0 (BIP-174) assembly + decoder for BTC trust pipeline.
// Protocol-encoder sibling of tron-native.ts / solana-system.ts.
//
// Consumed by:
//   - src/tools/prepare_btc_send.ts   (buildBtcPsbt via _btcPsbt)
//   - src/tools/preview_send.ts BTC branch (decodeBtcPsbt — Plan 23-04)
//
// Format-fanout-sentinel rule (CLAUDE.md): PSBT assembly is done ONLY here
// via _btcPsbt.buildBtcPsbt. Tools NEVER call bitcoinjs-lib.Psbt directly —
// they route through this indirection so the test seam stays uniform.
//
// Design decisions honored:
//   - D-06: RBF disabled — every input sequence === RBF_DISABLED_SEQUENCE (0xfffffffe).
//   - D-07: Dust check on EVERY output (recipient + change):
//       • Recipient below dust → throws BtcDustError.
//       • Change below dust MUST have been folded by selectCoinsBnb before
//         calling this function (selectCoinsBnb sets changeSats=0n when dust).
//         Defense-in-depth: assert changeSats > dustThreshold OR changeSats === 0n.
//   - BTC-PSBT-02: mixed segwit + taproot inputs in ONE PSBT (construction handles both;
//     only the SIGNING step in ledger-btc-transport.ts splits by script type).
//   - Pitfall 5 mitigation: return `perInputPrevouts` (ordered prevout scripts + values)
//     as the stored canonical artifact for fingerprint recompute — NOT the re-parsed PSBT.
//
// initEccLib guarantee: this module side-effect-imports
// ../chains/bitcoin/types.js which calls initEccLib(tinySecp256k1) at module
// scope — taproot payments.p2tr throws "No ECC Library provided" without it.
//
// ESM spy-affordance per CLAUDE.md: export _btcPsbt for vi.spyOn().
// Never .toString("hex") on bitcoinjs-lib v7 returns — use @noble/hashes/utils.bytesToHex.

// ─── Side-effect import: guarantee initEccLib fires ──────────────────────────
import "../chains/bitcoin/types.js";

import { Psbt, networks, payments, address as btcAddress } from "bitcoinjs-lib";
import { bytesToHex } from "@noble/hashes/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

/** D-06: RBF disabled — every input sequence must be ≥ 0xfffffffe. */
const RBF_DISABLED_SEQUENCE = 0xfffffffe;

// ─── Public types ─────────────────────────────────────────────────────────────

/** A selected input for PSBT assembly. */
export interface BtcPsbtInput {
  readonly txid: string;
  readonly vout: number;
  readonly valueSats: bigint;
  readonly scriptType: "p2wpkh" | "p2tr";
  /** 33-byte compressed public key. Used for bip32Derivation and p2wpkh witnessUtxo. */
  readonly pubkey: Uint8Array;
  /** 32-byte x-only public key. Required for taproot inputs (p2tr). */
  readonly xOnlyPubkey?: Uint8Array;
  /** BIP-32 derivation path, e.g. "m/84'/0'/0'/0/0". */
  readonly bip32Path: string;
  /** 4-byte master fingerprint. */
  readonly masterFingerprint: Uint8Array;
}

/** An output for PSBT assembly. */
export interface BtcPsbtOutput {
  readonly address: string;
  readonly valueSats: bigint;
  readonly scriptType: "p2wpkh" | "p2tr";
  /** "recipient" | "change" — change outputs MUST carry BIP-32 derivation (D-02). */
  readonly role: "recipient" | "change";
  /** For change outputs: the change pubkey (33-byte compressed). */
  readonly pubkey?: Uint8Array;
  /** For taproot change outputs: the x-only pubkey (32-byte). */
  readonly xOnlyPubkey?: Uint8Array;
  /** For change outputs: the BIP-32 path, e.g. "m/84'/0'/0'/1/0". */
  readonly bip32Path?: string;
  /** For change outputs: the 4-byte master fingerprint. */
  readonly masterFingerprint?: Uint8Array;
}

/** Arguments to buildBtcPsbt. */
export interface BtcPsbtArgs {
  /** Selected UTXO inputs from selectCoinsBnb. */
  readonly inputs: readonly BtcPsbtInput[];
  /** The recipient output. */
  readonly recipientOutput: BtcPsbtOutput;
  /** The change output, or null if no change (changeSats === 0n). */
  readonly changeOutput: BtcPsbtOutput | null;
  /** Dust threshold in sats (D-07). */
  readonly dustThresholdSats: bigint;
}

/** Per-input prevout descriptor for fingerprint recompute (Pitfall 5 canonical artifact). */
export interface BtcPrevout {
  readonly script: Uint8Array;
  readonly valueSats: bigint;
  readonly scriptType: "p2wpkh" | "p2tr";
}

/** Decoded PSBT input summary. */
export interface BtcDecodedInput {
  readonly txid: string;
  readonly vout: number;
  readonly valueSats: bigint;
  readonly scriptType: "p2wpkh" | "p2tr";
}

/** Decoded PSBT output summary. */
export interface BtcDecodedOutput {
  readonly address: string;
  readonly valueSats: bigint;
  readonly role: "recipient" | "change";
}

/** Rich result from buildBtcPsbt. Mirrors TronNativeEncodeResult shape. */
export interface BtcPsbtResult {
  /** PSBT-v0 in base64. The payload relayed in the prepare response. */
  readonly psbtBase64: string;
  /** Unsigned tx hex — stored canonical artifact for fingerprint recompute (Pitfall 5). */
  readonly unsignedTxHex: string;
  /** Ordered per-input prevout scripts + values — stored canonical artifact (Pitfall 5). */
  readonly perInputPrevouts: readonly BtcPrevout[];
  /** Decoded input summary (for PREPARE RECEIPT + DECODED block in preview). */
  readonly inputs: readonly BtcDecodedInput[];
  /** Decoded output summary (for PREPARE RECEIPT + DECODED block in preview). */
  readonly outputs: readonly BtcDecodedOutput[];
  /** Total miner fee in sats. */
  readonly feeSats: bigint;
  /** Change amount in sats (0n if no change output). */
  readonly changeSats: bigint;
}

/** Discriminated union from decodeBtcPsbt — NEVER throws. */
export type BtcPsbtDecoded =
  | {
      readonly kind: "native";
      readonly inputs: readonly BtcDecodedInput[];
      readonly outputs: readonly BtcDecodedOutput[];
      readonly feeSats: bigint;
    }
  | { readonly kind: "unknown" };

// ─── Error types ──────────────────────────────────────────────────────────────

/** Thrown when a recipient output is below the dust threshold (D-07). */
export class BtcDustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BtcDustError";
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Derive the witnessUtxo script for a given address.
 * Uses bitcoinjs-lib.address.toOutputScript for correct bech32/bech32m
 * checksum handling (Phase 22 Pitfall 1 — never use regex alone).
 */
function addressToScript(addr: string): Uint8Array {
  return btcAddress.toOutputScript(addr, networks.bitcoin);
}

/**
 * Build the witnessUtxo script for a PSBT input given the input's address.
 * For p2wpkh: derive the address from the pubkey then get the script.
 * For p2tr: derive the address from the x-only internal pubkey then get the script.
 */
function inputWitnessScript(input: BtcPsbtInput): Uint8Array {
  if (input.scriptType === "p2wpkh") {
    const payment = payments.p2wpkh({
      pubkey: Buffer.from(input.pubkey),
      network: networks.bitcoin,
    });
    if (!payment.output) throw new Error(`btc-psbt: p2wpkh payment has no output for input ${input.txid}:${input.vout}`);
    return payment.output;
  }
  // p2tr: use x-only pubkey (32 bytes).
  const xOnly = input.xOnlyPubkey ?? input.pubkey.slice(1, 33);
  const payment = payments.p2tr({
    internalPubkey: Buffer.from(xOnly),
    network: networks.bitcoin,
  });
  if (!payment.output) throw new Error(`btc-psbt: p2tr payment has no output for input ${input.txid}:${input.vout}`);
  return payment.output;
}

// ─── PSBT assembly ────────────────────────────────────────────────────────────

/**
 * Build an unsigned PSBT-v0 (BIP-174) for a BTC transaction.
 *
 * Assembles both segwit and taproot inputs in a single PSBT (BTC-PSBT-02).
 * Sets RBF_DISABLED_SEQUENCE on every input (D-06).
 * Enforces dust threshold on all outputs (D-07):
 *   - recipient below dust → throws BtcDustError
 *   - change output presence asserts changeSats > dustThresholdSats
 *     (selectCoinsBnb guarantees this; we assert for defense-in-depth)
 *
 * Returns a rich struct carrying:
 *   - psbtBase64: the PSBT for relaying to the Ledger transport
 *   - unsignedTxHex + perInputPrevouts: the canonical recompute artifact (Pitfall 5)
 *   - inputs[]/outputs[]: decoded summaries for PREPARE RECEIPT
 *   - feeSats / changeSats
 */
export function buildBtcPsbt(args: BtcPsbtArgs): BtcPsbtResult {
  const { inputs, recipientOutput, changeOutput, dustThresholdSats } = args;

  if (inputs.length === 0) {
    throw new Error("btc-psbt: at least one input required");
  }

  // ── D-07: dust check on recipient output ─────────────────────────────────
  if (recipientOutput.valueSats < dustThresholdSats) {
    throw new BtcDustError(
      `recipient output of ${recipientOutput.valueSats} sats is below dust threshold (${dustThresholdSats} sats)`,
    );
  }

  // ── Defense-in-depth: change output dust check ────────────────────────────
  // selectCoinsBnb folds below-dust change into fee (changeSats = 0n).
  // If somehow a non-zero below-dust change output was passed, refuse.
  if (changeOutput !== null && changeOutput.valueSats < dustThresholdSats) {
    throw new BtcDustError(
      `change output of ${changeOutput.valueSats} sats is below dust threshold (${dustThresholdSats} sats); ` +
        "selectCoinsBnb should have folded this into the fee",
    );
  }

  // ── Build the PSBT ────────────────────────────────────────────────────────
  const psbt = new Psbt({ network: networks.bitcoin });

  const perInputPrevouts: BtcPrevout[] = [];
  const decodedInputs: BtcDecodedInput[] = [];

  for (const inp of inputs) {
    const witnessScript = inputWitnessScript(inp);
    perInputPrevouts.push({
      script: witnessScript,
      valueSats: inp.valueSats,
      scriptType: inp.scriptType,
    });

    if (inp.scriptType === "p2wpkh") {
      psbt.addInput({
        hash: inp.txid,
        index: inp.vout,
        sequence: RBF_DISABLED_SEQUENCE,
        witnessUtxo: {
          script: Buffer.from(witnessScript),
          value: inp.valueSats,
        },
        bip32Derivation: [
          {
            masterFingerprint: Buffer.from(inp.masterFingerprint),
            pubkey: Buffer.from(inp.pubkey),
            path: inp.bip32Path,
          },
        ],
      });
    } else {
      // p2tr: x-only pubkey (32 bytes) for tapInternalKey and tapBip32Derivation.
      const xOnly = inp.xOnlyPubkey
        ? Buffer.from(inp.xOnlyPubkey)
        : Buffer.from(inp.pubkey.slice(1, 33));

      psbt.addInput({
        hash: inp.txid,
        index: inp.vout,
        sequence: RBF_DISABLED_SEQUENCE,
        witnessUtxo: {
          script: Buffer.from(witnessScript),
          value: inp.valueSats,
        },
        tapInternalKey: xOnly,
        tapBip32Derivation: [
          {
            masterFingerprint: Buffer.from(inp.masterFingerprint),
            pubkey: xOnly,
            path: inp.bip32Path,
            leafHashes: [], // key-spend path — no leaf hashes
          },
        ],
      });
    }

    decodedInputs.push({
      txid: inp.txid,
      vout: inp.vout,
      valueSats: inp.valueSats,
      scriptType: inp.scriptType,
    });
  }

  // ── Add outputs ───────────────────────────────────────────────────────────
  const decodedOutputs: BtcDecodedOutput[] = [];

  // Recipient output.
  psbt.addOutput({
    address: recipientOutput.address,
    value: recipientOutput.valueSats,
  });
  decodedOutputs.push({
    address: recipientOutput.address,
    valueSats: recipientOutput.valueSats,
    role: "recipient",
  });

  // Change output (if present).
  if (changeOutput !== null) {
    const changeOutAdded: Parameters<typeof psbt.addOutput>[0] = {
      address: changeOutput.address,
      value: changeOutput.valueSats,
    };
    psbt.addOutput(changeOutAdded);

    // Populate BIP-32 derivation on the change output (D-02 / Pitfall 6).
    // Without this, the Ledger device renders the change output as a "send".
    const changeIdx = psbt.data.outputs.length - 1;
    if (changeOutput.scriptType === "p2wpkh" && changeOutput.pubkey && changeOutput.bip32Path) {
      psbt.updateOutput(changeIdx, {
        bip32Derivation: [
          {
            masterFingerprint: Buffer.from(changeOutput.masterFingerprint ?? new Uint8Array(4)),
            pubkey: Buffer.from(changeOutput.pubkey),
            path: changeOutput.bip32Path,
          },
        ],
      });
    } else if (changeOutput.scriptType === "p2tr" && changeOutput.bip32Path) {
      const xOnly = changeOutput.xOnlyPubkey
        ? Buffer.from(changeOutput.xOnlyPubkey)
        : changeOutput.pubkey
          ? Buffer.from(changeOutput.pubkey.slice(1, 33))
          : Buffer.alloc(32);
      psbt.updateOutput(changeIdx, {
        tapBip32Derivation: [
          {
            masterFingerprint: Buffer.from(changeOutput.masterFingerprint ?? new Uint8Array(4)),
            pubkey: xOnly,
            path: changeOutput.bip32Path,
            leafHashes: [],
          },
        ],
      });
    }

    decodedOutputs.push({
      address: changeOutput.address,
      valueSats: changeOutput.valueSats,
      role: "change",
    });
  }

  // ── Compute fee and totals ────────────────────────────────────────────────
  const inputSum = inputs.reduce((acc, inp) => acc + inp.valueSats, 0n);
  const outputSum =
    recipientOutput.valueSats + (changeOutput !== null ? changeOutput.valueSats : 0n);
  const feeSats = inputSum - outputSum;
  const changeSats = changeOutput !== null ? changeOutput.valueSats : 0n;

  // ── Extract unsigned tx hex (canonical recompute artifact — Pitfall 5) ───
  const unsignedTxHex = bytesToHex(psbt.data.globalMap.unsignedTx!.toBuffer());

  return {
    psbtBase64: psbt.toBase64(),
    unsignedTxHex,
    perInputPrevouts,
    inputs: decodedInputs,
    outputs: decodedOutputs,
    feeSats,
    changeSats,
  };
}

// ─── PSBT decoder ─────────────────────────────────────────────────────────────

/**
 * Decode a PSBT base64 string into a discriminated union.
 * NEVER throws — returns { kind: "unknown" } on any malformed input.
 * Consumed by the preview_send BTC branch (Plan 23-04) for the DECODED block.
 */
export function decodeBtcPsbt(psbtBase64: string): BtcPsbtDecoded {
  try {
    const psbt = Psbt.fromBase64(psbtBase64);
    // txInputs and txOutputs are the parsed tx-level input/output views.
    const txInputs = psbt.txInputs;
    const txOutputs = psbt.txOutputs;

    const decodedInputs: BtcDecodedInput[] = psbt.data.inputs.map((inp, i) => {
      const txIn = txInputs[i];
      if (txIn === undefined) throw new Error(`btc-psbt: missing txInput at index ${i}`);
      // txid in bitcoinjs-lib is stored in reverse byte order (little-endian hash).
      const txidBuf = Buffer.from(txIn.hash);
      txidBuf.reverse();
      const txid = bytesToHex(txidBuf);
      const valueSats = inp.witnessUtxo?.value ?? 0n;
      const scriptType: "p2wpkh" | "p2tr" =
        inp.tapInternalKey !== undefined ? "p2tr" : "p2wpkh";
      return { txid, vout: txIn.index, valueSats, scriptType };
    });

    const decodedOutputs: BtcDecodedOutput[] = psbt.data.outputs.map((out, i) => {
      const txOut = txOutputs[i];
      if (txOut === undefined) throw new Error(`btc-psbt: missing txOutput at index ${i}`);
      let addr = "unknown";
      try {
        addr = btcAddress.fromOutputScript(txOut.script, networks.bitcoin);
      } catch {
        // Non-standard script — leave as "unknown".
      }
      // Heuristic: output with bip32Derivation or tapBip32Derivation is change.
      const isChange =
        (out.bip32Derivation !== undefined && out.bip32Derivation.length > 0) ||
        (out.tapBip32Derivation !== undefined && out.tapBip32Derivation.length > 0);
      return {
        address: addr,
        valueSats: txOut.value,
        role: isChange ? "change" : "recipient",
      };
    });

    // Compute fee from input sum - output sum.
    const inputSum = decodedInputs.reduce((acc, inp) => acc + inp.valueSats, 0n);
    const outputSum = decodedOutputs.reduce((acc, out) => acc + out.valueSats, 0n);
    const feeSats = inputSum >= outputSum ? inputSum - outputSum : 0n;

    return {
      kind: "native",
      inputs: decodedInputs,
      outputs: decodedOutputs,
      feeSats,
    };
  } catch {
    return { kind: "unknown" };
  }
}

// ─── ESM spy-affordance (CLAUDE.md) ──────────────────────────────────────────

/** Indirection object for vi.spyOn across ESM module boundaries. */
export const _btcPsbt = { buildBtcPsbt, decodeBtcPsbt };
