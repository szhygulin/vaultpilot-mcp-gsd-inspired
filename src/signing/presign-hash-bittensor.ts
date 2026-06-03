// TAO-PREP-02 — Bittensor pre-sign hash recompute (47-RESEARCH §Probe 5;
// milestone-locked decision).
//
// This is the blake2-256 hash the Polkadot Generic Ledger app displays in
// blind-sign mode (the firmware blake2-256-pre-hashes the signing payload for
// blobs > 256 bytes — 47-RESEARCH §Probe 5). The user matches it against the
// LEDGER BLIND-SIGN HASH (Bittensor) block emitted in preview_send (Plan
// 47-03).
//
// THE ONE DIVERGENCE from the SHA-256 Solana/TRON siblings: Substrate signing
// uses blake2-256, not SHA-256. The keccak256 binding fingerprint
// (`payload-fingerprint-bittensor.ts`) is UNCHANGED in hash function across
// chains; only this device-display hash differs per Substrate/Ledger
// convention. Both helpers return a `presignHash: Hex` field so
// `PreviewPinned.presignHash` stays type-stable across chains.
//
// CRITICAL: the input `signableBytes` MUST be the SAME bytes that flow into
// `computeBittensorPayloadFingerprint` — i.e.
// `registry.createType("ExtrinsicPayload", signerPayloadJSON, { version })
// .toU8a({ method: true })`. Passing different bytes here would produce a hash
// that does NOT match the Ledger device display, breaking the on-device
// hash-match trust anchor.
//
// Cross-ref: 47-RESEARCH §Probe 5 (blake2-256 = `blake2AsHex(blob, 256)`) +
// §Probe 1 (the binding fingerprint — distinct hash function over the SAME
// blob) + §Don't Hand-Roll ("blake2AsU8a(bytes, 256)" — never custom blake2).

import { blake2AsHex } from "@polkadot/util-crypto";
import type { Hex } from "viem";

/**
 * Compute the blake2-256 of the Bittensor unsigned signable blob BEFORE
 * signing.
 *
 * Returns BOTH the input signable bytes (echoed back verbatim — the helper
 * does NOT mutate) and the blake2-256 hash. Preview_send pins `presignHash`
 * into `PreviewPinned.presignHash: Hex` so downstream send gates can
 * re-verify; the LEDGER BLIND-SIGN HASH (Bittensor) block surfaces the same
 * value for the user to compare against the on-device display.
 *
 * `blake2AsHex(data, 256)` returns a 0x-prefixed 32-byte hash. Uses the
 * `@polkadot/util-crypto` SOT — NEVER hand-roll blake2 (47-RESEARCH
 * §Don't Hand-Roll).
 *
 * The user-facing block label is `LEDGER BLIND-SIGN HASH (Bittensor)`; the
 * field name stays uniform across chains (`presignHash`).
 */
export function computeBittensorPresignHash(input: {
  signableBytes: Uint8Array;
}): { signableBytes: Uint8Array; presignHash: Hex } {
  // @polkadot/util-crypto blake2-256 — matches what the Substrate firmware
  // hashes for >256-byte payloads (the Substrate divergence from SHA-256).
  const presignHash = blake2AsHex(input.signableBytes, 256) as Hex;
  return {
    signableBytes: input.signableBytes,
    presignHash,
  };
}

/**
 * ESM spy-affordance per CLAUDE.md convention. Consumers import
 * `_bittensorPresign` and call
 * `_bittensorPresign.computeBittensorPresignHash(input)` so tests can spy on
 * the call without monkey-patching the production import path.
 */
export const _bittensorPresign = { computeBittensorPresignHash };
