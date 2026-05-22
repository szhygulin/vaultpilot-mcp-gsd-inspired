// src/signing/btc-fingerprint.ts — Phase 23 Plan 23-01 (BTC-PREP-01, D-05).
//
// Domain-tagged keccak256 payloadFingerprint over the concatenated per-input
// BIP-143 (segwit) / BIP-341 (taproot key-spend) sighashes.
//
// Sibling of `src/signing/payload-fingerprint-tron.ts` — same file shape:
// domain-tag constant, compute function, ESM spy-affordance. The structural
// divergence from the TRON sibling is the preimage: TRON hashes one
// `rawDataBytes` blob; BTC hashes a VARIADIC SPREAD of N 32-byte per-input
// sighashes (per-input commitment per the UTXO model). Multi-input tx →
// multi-hash preimage.
//
// FROZEN: `payload-fingerprint.ts` / `payload-fingerprint-solana.ts` /
// `payload-fingerprint-tron.ts` / `presign-hash*.ts` / `handle-store.ts`
// are BYTE-UNTOUCHED by Phase 23. `btc-fingerprint.ts` is a NEW sibling.
//
// Preimage:
//   "VaultPilot-btctx-v1:" (20 UTF-8 bytes) ‖ sighash₀ ‖ sighash₁ ‖ … ‖ sighashₙ₋₁
//
// Each sighash is exactly 32 bytes — from `btc-sighash.computeAllSighashes`.
// The domain tag length (21 bytes) is the same as the TRON tag; the tag
// STRING differs ("btctx" vs "trontx"), making cross-chain fingerprint reuse
// impossible at the keccak preimage level (BTC-PREP-01 distinctness guarantee).
//
// Cross-ref: Phase 23 RESEARCH D-05, BTC-PREP-01, Pattern 2 (fingerprint
// module), Pitfall 2 (whole-prevout-set requirement upstream in btc-sighash.ts),
// Threat T-23-02 (domain-tag + Fixture O literal anchor).
//
// Upstream producer: `src/signing/btc-sighash.computeAllSighashes` returns
// the Uint8Array[] this module consumes.

import { concat, keccak256, toBytes } from "viem";
import type { Hex } from "viem";

/**
 * Version-stamped BTC domain tag. EXPORTED so the test suite can assert
 * the 20-byte UTF-8 length invariant. The tag is NOT configurable — changing
 * it is a wire-shape break requiring a v2 format bump.
 */
export const FINGERPRINT_DOMAIN_TAG_BTC = "VaultPilot-btctx-v1:";

/**
 * Compute the prepare-time-stable BTC payloadFingerprint per BTC-PREP-01 /
 * D-05.
 *
 * Preimage = DOMAIN_TAG (utf-8, 20 bytes) ‖ sighash₀ ‖ … ‖ sighashₙ₋₁
 *
 * `perInputSighashes` MUST be the output of
 * `btc-sighash.computeAllSighashes(unsignedTx, inputs)` — one 32-byte
 * Uint8Array per input, in the same order as the PSBT's input vector.
 *
 * The fingerprint is UTXO-SET-DEPENDENT by construction because each
 * per-input sighash commits to the spending UTXO's script + value
 * (BIP-143) or the whole prevout set (BIP-341). Two different UTXO
 * selections always produce different fingerprints for the same recipient +
 * amount — this is the desired property for the Layer 1 / Layer 3 drift
 * gates.
 *
 * Returns a 32-byte 0x-prefixed hex string (66 chars including the prefix).
 *
 * Throws if `perInputSighashes` is empty or any sighash is not exactly 32 bytes.
 */
export function computeBtcPayloadFingerprint(
  perInputSighashes: readonly Uint8Array[],
): Hex {
  if (perInputSighashes.length === 0) {
    throw new Error(
      "BTC payloadFingerprint requires at least one input sighash",
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
    toBytes(FINGERPRINT_DOMAIN_TAG_BTC),
    ...perInputSighashes,
  ]);
  return keccak256(preimage);
}

/**
 * ESM spy-affordance per CLAUDE.md convention. Consumers (Plans 23-02 /
 * 23-03 prepare + preview + send branches) import `_btcFingerprint` and call
 * `_btcFingerprint.computeBtcPayloadFingerprint(...)` so tests can spy on the
 * call without monkey-patching the production import path.
 */
export const _btcFingerprint = { computeBtcPayloadFingerprint };
