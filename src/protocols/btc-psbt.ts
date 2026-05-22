// src/protocols/btc-psbt.ts — Phase 23 Plan 23-02 Task 3.
//
// PSBT-v0 (BIP-174) assembly + decoder for BTC trust pipeline.
// Protocol-encoder sibling of tron-native.ts / solana-system.ts.
//
// Consumed by:
//   - src/tools/prepare_btc_send.ts   (buildBtcPsbt via _btcPsbt)
//   - src/tools/preview_send.ts BTC branch (decodeBtcPsbt — Plan 23-04)
//   - src/tools/combine_btc_psbts.ts  (combineBtcPsbts via _btcPsbt — Plan 25-02)
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

import { Psbt, networks, payments, address as btcAddress, type Network } from "bitcoinjs-lib";
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
  /**
   * Optional sequence override for all inputs. When omitted, uses
   * `RBF_DISABLED_SEQUENCE (0xfffffffe)` — byte-identical to Phase 23.
   * Pass `0xfffffffd` from `prepare_btc_rbf_bump` to signal RBF (Phase 24).
   * Pass `0xfffffffd` from `prepare_btc_send` when `signalRbf: true` (Design Fork 1).
   */
  readonly sequenceOverride?: number;
  /**
   * Optional bitcoinjs-lib Network object. Defaults to `networks.bitcoin`.
   * Pass `LTC_NETWORK` from `src/chains/litecoin/types.ts` for LTC PSBT construction.
   * RESEARCH Pitfall 2: omitting this defaults to BTC mainnet and silently produces
   * bc1q addresses for LTC PSBTs — always pass the network explicitly for non-BTC chains.
   */
  readonly network?: Network;
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

// ─── Phase 25 Plan 25-02: Combine result types ────────────────────────────────

/** A single same-key/same-input signature conflict found during pre-combine scan. */
export interface BtcPsbtConflict {
  readonly inputIndex: number;
  /** Hex-encoded compressed pubkey (33 bytes). */
  readonly pubkeyHex: string;
  /** Hex-encoded signature from the first PSBT in the array. */
  readonly sigHex0: string;
  /** Hex-encoded conflicting signature from another PSBT. */
  readonly sigHex1: string;
}

/**
 * Result from combineBtcPsbts — discriminated union, NEVER throws.
 *
 * - "ok"       — conflict-free merge succeeded; merged PSBT as base64.
 * - "conflict" — pre-combine scan found same-key/same-input signature mismatches;
 *                Psbt.combine was NOT called.
 * - "error"    — one or more input strings could not be parsed as a PSBT.
 */
export type BtcCombineResult =
  | { readonly kind: "ok"; readonly psbtBase64: string }
  | { readonly kind: "conflict"; readonly conflicts: readonly BtcPsbtConflict[] }
  | { readonly kind: "error"; readonly message: string };

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
 * Pass `network` explicitly — defaults to `networks.bitcoin` only for BTC callers.
 */
function addressToScript(addr: string, network: Network = networks.bitcoin): Uint8Array {
  return btcAddress.toOutputScript(addr, network);
}

/**
 * Build the witnessUtxo script for a PSBT input given the input's address.
 * For p2wpkh: derive the address from the pubkey then get the script.
 * For p2tr: derive the address from the x-only internal pubkey then get the script.
 * Pass `network` explicitly — defaults to `networks.bitcoin` only for BTC callers.
 * RESEARCH Pitfall 2: omitting network defaults to BTC mainnet; always pass for LTC.
 */
function inputWitnessScript(input: BtcPsbtInput, network: Network = networks.bitcoin): Uint8Array {
  if (input.scriptType === "p2wpkh") {
    const payment = payments.p2wpkh({
      pubkey: Buffer.from(input.pubkey),
      network,
    });
    if (!payment.output) throw new Error(`btc-psbt: p2wpkh payment has no output for input ${input.txid}:${input.vout}`);
    return payment.output;
  }
  // p2tr: use x-only pubkey (32 bytes).
  const xOnly = input.xOnlyPubkey ?? input.pubkey.slice(1, 33);
  const payment = payments.p2tr({
    internalPubkey: Buffer.from(xOnly),
    network,
  });
  if (!payment.output) throw new Error(`btc-psbt: p2tr payment has no output for input ${input.txid}:${input.vout}`);
  return payment.output;
}

// ─── PSBT assembly ────────────────────────────────────────────────────────────

/**
 * Build an unsigned PSBT-v0 (BIP-174) for a BTC transaction.
 *
 * Assembles both segwit and taproot inputs in a single PSBT (BTC-PSBT-02).
 * Sets `args.sequenceOverride ?? RBF_DISABLED_SEQUENCE` on every input.
 * When `sequenceOverride` is omitted, behavior is byte-identical to Phase 23
 * (D-06: `RBF_DISABLED_SEQUENCE = 0xfffffffe`). Pass `0xfffffffd` from
 * `prepare_btc_rbf_bump` (Phase 24) or `prepare_btc_send({ signalRbf: true })`
 * to signal RBF per BIP-125.
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
  const effectiveSequence = args.sequenceOverride ?? RBF_DISABLED_SEQUENCE;
  const network = args.network ?? networks.bitcoin;

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
  const psbt = new Psbt({ network });

  const perInputPrevouts: BtcPrevout[] = [];
  const decodedInputs: BtcDecodedInput[] = [];

  for (const inp of inputs) {
    const witnessScript = inputWitnessScript(inp, network);
    perInputPrevouts.push({
      script: witnessScript,
      valueSats: inp.valueSats,
      scriptType: inp.scriptType,
    });

    if (inp.scriptType === "p2wpkh") {
      psbt.addInput({
        hash: inp.txid,
        index: inp.vout,
        sequence: effectiveSequence,
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
        sequence: effectiveSequence,
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
 * Pass `network` when decoding LTC PSBTs — defaults to `networks.bitcoin` for BTC.
 */
export function decodeBtcPsbt(psbtBase64: string, network: Network = networks.bitcoin): BtcPsbtDecoded {
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
        addr = btcAddress.fromOutputScript(txOut.script, network);
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

// ─── Phase 25 Plan 25-02: PSBT combiner with pre-combine conflict scan ────────

/**
 * Combine an array of partially-signed PSBTs from co-signers into one merged PSBT.
 *
 * Security invariant (T-25-06 / T-25-08):
 *   bip174's keyPusher silently discards duplicate keys (self wins). This means
 *   calling Psbt.combine() directly would silently overwrite a co-signer's
 *   signature if two PSBTs carry different signatures for the same pubkey on
 *   the same input. We MUST run the pre-scan and refuse before combine is called.
 *
 * Algorithm (RESEARCH Pattern 3):
 *   1. Parse every PSBT via Psbt.fromBase64 inside try/catch. Any failure →
 *      { kind: "error", message }.
 *   2. For each pair (i, j) with j > i, for each input index, build a
 *      pubkey→signatureHex map from each input's partialSig array and compare.
 *      Same pubkey + differing signature bytes → push a BtcPsbtConflict.
 *      Identical signature bytes are idempotent (re-submission) — NOT a conflict.
 *   3. If conflicts.length > 0 → { kind: "conflict", conflicts }.
 *      Psbt.combine is NEVER called.
 *   4. Otherwise: psbts[0].combine(...psbts.slice(1)), return
 *      { kind: "ok", psbtBase64: combined.toBase64() }.
 *
 * NOTE: combine merges co-signer signatures only — it has NO threshold concept.
 * Threshold enforcement belongs to finalizeBtcPsbt (Plan 25-03).
 */
export function combineBtcPsbts(psbtBase64s: readonly string[]): BtcCombineResult {
  if (psbtBase64s.length < 2) {
    return { kind: "error", message: "combineBtcPsbts requires at least 2 PSBTs" };
  }

  // ── Step 1: Parse all PSBTs ───────────────────────────────────────────────
  const psbts: Psbt[] = [];
  for (const b64 of psbtBase64s) {
    try {
      psbts.push(Psbt.fromBase64(b64));
    } catch (err) {
      return {
        kind: "error",
        message: `Failed to parse PSBT: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ── Step 2: Pre-combine conflict scan across all pairs ────────────────────
  const conflicts: BtcPsbtConflict[] = [];

  for (let i = 0; i < psbts.length; i++) {
    for (let j = i + 1; j < psbts.length; j++) {
      const psbtI = psbts[i]!;
      const psbtJ = psbts[j]!;

      // Both PSBTs must have the same number of inputs (guaranteed by bip174
      // combine's own TX-equality check, but we iterate per-input here).
      const inputCount = Math.min(psbtI.data.inputs.length, psbtJ.data.inputs.length);

      for (let inputIndex = 0; inputIndex < inputCount; inputIndex++) {
        const inputI = psbtI.data.inputs[inputIndex];
        const inputJ = psbtJ.data.inputs[inputIndex];
        if (!inputI || !inputJ) continue;

        const sigsI = inputI.partialSig ?? [];
        const sigsJ = inputJ.partialSig ?? [];

        // Build pubkey → sigHex map for psbt[i]
        const mapI = new Map<string, string>();
        for (const ps of sigsI) {
          mapI.set(
            Buffer.from(ps.pubkey).toString("hex"),
            Buffer.from(ps.signature).toString("hex"),
          );
        }

        // Compare against psbt[j]
        for (const ps of sigsJ) {
          const pubkeyHex = Buffer.from(ps.pubkey).toString("hex");
          const sigHexJ = Buffer.from(ps.signature).toString("hex");
          const sigHexI = mapI.get(pubkeyHex);
          if (sigHexI !== undefined && sigHexI !== sigHexJ) {
            // Same pubkey, same input, different signature bytes → conflict.
            conflicts.push({
              inputIndex,
              pubkeyHex,
              sigHex0: sigHexI,
              sigHex1: sigHexJ,
            });
          }
        }
      }
    }
  }

  // ── Step 3: Return conflict result (Psbt.combine NEVER called) ────────────
  if (conflicts.length > 0) {
    return { kind: "conflict", conflicts };
  }

  // ── Step 4: No conflicts — safe to combine ────────────────────────────────
  try {
    const combined = psbts[0]!;
    combined.combine(...psbts.slice(1));
    return { kind: "ok", psbtBase64: combined.toBase64() };
  } catch (err) {
    return {
      kind: "error",
      message: `Psbt.combine failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ─── ESM spy-affordance (CLAUDE.md) ──────────────────────────────────────────

// ─── Phase 25 Plan 25-03: PSBT finalizer with threshold enforcement ───────────

/**
 * Result of `finalizeBtcPsbt` — discriminated union, NEVER throws.
 *
 * `"ok"`: All inputs had ≥ M partial signatures; `finalizeAllInputs()` succeeded;
 *   `finalPsbtBase64` + `txHex` are ready for broadcast.
 * `"threshold-not-met"`: One or more inputs had fewer than M partial signatures;
 *   `underThresholdInputs` lists the 0-based input indices.
 * `"error"`: Unexpected error (malformed PSBT or finalizer threw).
 */
export type BtcFinalizeResult =
  | { readonly kind: "ok"; readonly finalPsbtBase64: string; readonly txHex: string }
  | { readonly kind: "threshold-not-met"; readonly underThresholdInputs: readonly number[] }
  | { readonly kind: "error"; readonly message: string };

/**
 * Threshold-enforced PSBT finalizer (Plan 25-03 / BTC-PSBT-07).
 *
 * Security invariant (T-25-11 mitigation):
 *   `bitcoinjs-lib finalizeAllInputs()` throws an opaque error if any input
 *   has fewer than M partial signatures (the p2ms getSortedSigs path). This
 *   function checks `partialSig.length >= threshold` per input BEFORE calling
 *   `finalizeAllInputs()` and returns `{ kind: "threshold-not-met" }` with the
 *   under-threshold input indices instead of letting the opaque throw propagate.
 *
 * DOES NOT produce a handle or payloadFingerprint — this is a direct PSBT
 * transform (same shape as `combineBtcPsbts`).
 *
 * `threshold`: the M value for this wallet (caller extracts from the registry
 * record or passes directly). `finalize_btc_psbt.ts` validates threshold ≥ 1.
 */
export function finalizeBtcPsbt(psbtBase64: string, threshold: number): BtcFinalizeResult {
  try {
    const psbt = Psbt.fromBase64(psbtBase64);

    // ── Step 1: Per-input threshold check (T-25-11 mitigation) ──────────────
    const underThreshold: number[] = [];
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      const sigs = psbt.data.inputs[i]?.partialSig ?? [];
      if (sigs.length < threshold) underThreshold.push(i);
    }

    if (underThreshold.length > 0) {
      return { kind: "threshold-not-met", underThresholdInputs: underThreshold };
    }

    // ── Step 2: Finalize + extract raw tx ────────────────────────────────────
    psbt.finalizeAllInputs();
    return {
      kind: "ok",
      finalPsbtBase64: psbt.toBase64(),
      txHex: psbt.extractTransaction().toHex(),
    };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Indirection object for vi.spyOn across ESM module boundaries. */
export const _btcPsbt = { buildBtcPsbt, decodeBtcPsbt, combineBtcPsbts, finalizeBtcPsbt };
