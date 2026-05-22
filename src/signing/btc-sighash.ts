// src/signing/btc-sighash.ts — Phase 23 Plan 23-01 (BTC-PREP-01, D-05).
//
// Per-input BIP-143 (segwit) and BIP-341 (taproot key-spend) sighash
// computation. Feeds `btc-fingerprint.ts` as the preimage producer.
//
// SIBLING of `src/signing/payload-fingerprint-tron.ts` (FROZEN) — this file
// is the per-input sighash producer; `btc-fingerprint.ts` assembles the
// domain-tagged keccak256 over the concatenated sighashes.
//
// FROZEN: `payload-fingerprint.ts` / `payload-fingerprint-solana.ts` /
// `payload-fingerprint-tron.ts` / `presign-hash*.ts` / `handle-store.ts`
// are byte-untouched by Phase 23. `btc-sighash.ts` + `btc-fingerprint.ts`
// are NEW siblings.
//
// BIP-143 / BIP-341 sighash asymmetry (REGRESSION ANCHOR — Phase 23
// RESEARCH Pitfall 2 + Threat T-23-01):
//
//   hashForWitnessV0 (segwit, BIP-143):
//     Commits to THIS input's prevout script + value ONLY.
//     `hashForWitnessV0(inIndex, prevOutScript, value, hashType)`
//
//   hashForWitnessV1 (taproot, BIP-341 key-spend):
//     Commits to ALL inputs' prevout scripts + values (sha_prevouts /
//     sha_amounts / sha_scriptpubkeys cover the WHOLE prevout set).
//     `hashForWitnessV1(inIndex, prevOutScripts[], values[], hashType)`
//     CRITICAL: passing only [scriptᵢ] / [valueᵢ] produces a wrong hash
//     that the Ledger device will reject. `allScripts` + `allValues` MUST
//     be assembled from the full selected-UTXO set before this loop.
//
// `initEccLib` guarantee: importing `../chains/bitcoin/types.js` fires
// `initEccLib(tinySecp256k1)` at module scope (idempotent). Required for
// taproot `hashForWitnessV1` — bitcoinjs-lib@7 throws "No ECC Library
// provided" if the ECC backend is absent. Same pattern as `xpub-scan.ts:55`
// and `bitcoin-persona.ts:54`.
//
// Cross-ref: Phase 23 RESEARCH Pattern 2 (per-input sighash dispatch),
// Pitfall 2 (whole-prevout-set requirement), D-05 (fingerprint preimage).

import { Transaction } from "bitcoinjs-lib";

import "../chains/bitcoin/types.js"; // ensure initEccLib(tinySecp256k1) fires

/**
 * A single UTXO input descriptor carrying the data `computeAllSighashes`
 * needs to dispatch to the correct BIP-143 (segwit) or BIP-341 (taproot)
 * sighash API.
 *
 * `prevOutScript`: the locking script (scriptPubKey) of the UTXO being
 *   spent — `payments.p2wpkh({ pubkey }).output` for segwit,
 *   `payments.p2tr({ internalPubkey }).output` for taproot.
 * `valueSats`: the UTXO's sat value as bigint — bitcoinjs-lib@7 uses
 *   bigint for all value fields (probe-confirmed).
 */
export interface SighashInput {
  readonly scriptType: "p2wpkh" | "p2tr";
  readonly prevOutScript: Uint8Array;
  readonly valueSats: bigint;
}

/**
 * Compute per-input BIP-143 (segwit) or BIP-341 (taproot key-spend) sighashes
 * for an unsigned transaction. Returns a Uint8Array[] of 32-byte sighashes,
 * one per input, in the same order as `inputs`.
 *
 * Taproot inputs (hashForWitnessV1) receive the FULL prevout set
 * (`allScripts[]` / `allValues[]`) assembled once before the loop — BIP-341
 * commits to the whole prevout set, not just the current input's prevout.
 * See the REGRESSION ANCHOR comment at the top of this file.
 *
 * Segwit inputs (hashForWitnessV0) receive only their own prevout script +
 * value — BIP-143 does not commit to the other inputs' prevouts.
 *
 * Returns an empty array if `inputs` is empty (no throw).
 */
export function computeAllSighashes(
  unsignedTx: Transaction,
  inputs: readonly SighashInput[],
): Uint8Array[] {
  if (inputs.length === 0) return [];

  // Assemble the full prevout set ONCE before any taproot sighash computation.
  // BIP-341 whole-prevout-set requirement: hashForWitnessV1 commits to
  // sha_prevouts / sha_amounts / sha_scriptpubkeys over ALL inputs.
  // Do NOT defer this into the loop body — if the arrays are constructed
  // per-call (e.g. [scriptᵢ] / [valueᵢ]) the taproot sighash is WRONG.
  const allScripts = inputs.map((i) => i.prevOutScript);
  const allValues = inputs.map((i) => i.valueSats);

  return inputs.map((inp, i) => {
    if (inp.scriptType === "p2wpkh") {
      // BIP-143 — segwit. SIGHASH_ALL = 1.
      return unsignedTx.hashForWitnessV0(
        i,
        inp.prevOutScript,
        inp.valueSats,
        Transaction.SIGHASH_ALL,
      );
    }
    // BIP-341 — taproot key-spend. SIGHASH_DEFAULT = 0.
    // Receives ALL inputs' prevout scripts + values (BIP-341 whole-prevout-set
    // commitment — REGRESSION ANCHOR: adding or removing any input changes
    // EVERY taproot input's sighash; the mixed-set determinism test enforces
    // this invariant at test time).
    return unsignedTx.hashForWitnessV1(
      i,
      allScripts,
      allValues,
      Transaction.SIGHASH_DEFAULT,
    );
  });
}

/**
 * ESM spy-affordance per CLAUDE.md convention. Consumers import
 * `_btcSighash` and call `_btcSighash.computeAllSighashes(...)` so tests can
 * spy on the call without monkey-patching the production import path.
 */
export const _btcSighash = { computeAllSighashes };
