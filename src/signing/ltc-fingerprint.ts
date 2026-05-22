// src/signing/ltc-fingerprint.ts — Phase 26 Plan 26-02 (LTC-W-01).
//
// Domain-tagged keccak256 payloadFingerprint over the concatenated per-input
// BIP-143 sighashes for Litecoin UTXO transactions.
//
// CLONE of `src/signing/btc-fingerprint.ts` with ONE change: the domain tag
// string. Do NOT share with `btc-fingerprint.ts` — the distinct tag is the
// cross-chain tamper-detection mechanism (T-26-05 mitigation).
//
// BTC: "VaultPilot-btctx-v1:"  (20 UTF-8 bytes)
// LTC: "VaultPilot-ltctx-v1:"  (20 UTF-8 bytes)
//
// Having distinct domain tags makes the keccak preimage byte-distinct for
// any sighash input: the only way LTC and BTC fingerprints can collide is
// if the domain tags are identical. They are not.
//
// Preimage:
//   "VaultPilot-ltctx-v1:" (20 UTF-8 bytes) ‖ sighash₀ ‖ sighash₁ ‖ … ‖ sighashₙ₋₁
//
// Each sighash is exactly 32 bytes — from `btc-sighash.computeAllSighashes`.
// BIP-143 is byte-identical for LTC and BTC — only the domain tag differs.
//
// Cross-ref: Phase 26 RESEARCH "LTC Fingerprint Module", T-26-05, Fixture Y
// literal anchor in test/signing-fingerprint.test.ts.
//
// Upstream producer: `src/signing/btc-sighash.computeAllSighashes` returns
// the Uint8Array[] this module consumes (reused verbatim for LTC).

import { concat, keccak256, toBytes } from "viem";
import type { Hex } from "viem";

/**
 * Version-stamped LTC domain tag. EXPORTED so the test suite can assert
 * the 20-byte UTF-8 length invariant and the byte-distinctness from
 * FINGERPRINT_DOMAIN_TAG_BTC. The tag is NOT configurable — changing
 * it is a wire-shape break requiring a v2 format bump.
 */
export const FINGERPRINT_DOMAIN_TAG_LTC = "VaultPilot-ltctx-v1:";

/**
 * Compute the prepare-time-stable LTC payloadFingerprint (LTC-W-01 /
 * T-26-05 cross-chain distinctness).
 *
 * Preimage = DOMAIN_TAG (utf-8, 20 bytes) ‖ sighash₀ ‖ … ‖ sighashₙ₋₁
 *
 * `perInputSighashes` MUST be the output of
 * `btc-sighash.computeAllSighashes(unsignedTx, inputs)` — one 32-byte
 * Uint8Array per input, in the same order as the PSBT's input vector.
 * BIP-143 is identical for LTC and BTC; `btc-sighash.ts` is REUSED.
 *
 * The fingerprint is UTXO-SET-DEPENDENT by construction. Two different UTXO
 * selections always produce different fingerprints for the same recipient +
 * amount — this is the desired property for the Layer 1 / Layer 3 drift gates.
 *
 * Returns a 32-byte 0x-prefixed hex string (66 chars including the prefix).
 *
 * Throws if `perInputSighashes` is empty or any sighash is not exactly 32 bytes.
 */
export function computeLtcPayloadFingerprint(
  perInputSighashes: readonly Uint8Array[],
): Hex {
  if (perInputSighashes.length === 0) {
    throw new Error(
      "LTC payloadFingerprint requires at least one input sighash",
    );
  }
  for (const sh of perInputSighashes) {
    if (sh.length !== 32) {
      throw new Error(
        `per-input sighash must be 32 bytes, got ${sh.length}`,
      );
    }
  }
  const preimage = concat([
    toBytes(FINGERPRINT_DOMAIN_TAG_LTC),
    ...perInputSighashes,
  ]);
  return keccak256(preimage);
}

/**
 * ESM spy-affordance per CLAUDE.md convention. Consumers (Plan 26-02
 * prepare_litecoin_native_send + preview_send + send_transaction) import
 * `_ltcFingerprint` and call `_ltcFingerprint.computeLtcPayloadFingerprint(...)`
 * so tests can spy on the call without monkey-patching the production import path.
 */
export const _ltcFingerprint = { computeLtcPayloadFingerprint };
