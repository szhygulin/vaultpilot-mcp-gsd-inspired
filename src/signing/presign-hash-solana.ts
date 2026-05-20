// SOL-PREP-02 — Solana pre-sign hash recompute (research § Topic 2, DF-2 LOCKED).
//
// This is the SHA-256 the Ledger Solana app displays in blind-sign mode. The
// user matches it against the LEDGER BLIND-SIGN HASH (Solana) block emitted
// in preview_send (Plan 12-04). Confirmed empirically against
// `LedgerHQ/app-solana/src/handle_sign_message.c::cx_hash_sha256(G_command.
// message, G_command.message_length, …)`. The on-device label is `"Message
// Hash"`.
//
// Distinct from the EVM `presign-hash.ts` analog — EVM uses keccak256 over
// the EIP-1559 RLP envelope; Solana uses SHA-256 over the raw message bytes
// (no envelope wrapping). Both helpers return a `presignHash: Hex` field so
// `PreviewPinned.presignHash` stays type-stable across chains.
//
// CRITICAL: the input `messageBytes` MUST be the output of
// `Transaction.serializeMessage()` — the SAME bytes that flow into
// `computeSolanaPayloadFingerprint`. Passing different bytes here would
// produce a hash that does NOT match the Ledger device display, breaking
// the on-device-hash-match trust anchor.
//
// Cross-ref: research § Topic 2 (DF-2 SHA-256 device-display hash — confirmed
// in app-solana source) + Topic 1 (DF-1 — the binding fingerprint, distinct
// hash function, distinct domain tag).

import { createHash } from "node:crypto";
import type { Hex } from "viem";

/**
 * Compute the SHA-256 of the Solana message bytes BEFORE signing.
 *
 * Returns BOTH the input message bytes (echoed back verbatim — the helper
 * does NOT mutate) and the SHA-256 hash. Preview_send pins
 * `presignHash` into `PreviewPinned.presignHash: Hex` so downstream send
 * gates can re-verify; the LEDGER BLIND-SIGN HASH (Solana) block surfaces
 * the same value for the user to compare against the on-device display.
 *
 * The user-facing block label is `LEDGER BLIND-SIGN HASH (Solana)` while
 * the on-device label is the Ledger SOL app's `"Message Hash"` — distinct
 * user-facing labels for distinct surfaces; the field name stays uniform
 * across chains (`presignHash`).
 */
export function computeSolanaPresignHash(input: {
  messageBytes: Uint8Array;
}): { messageBytes: Uint8Array; presignHash: Hex } {
  // Node stdlib SHA-256 — no extra deps. Matches the Ledger SOL app's
  // `cx_hash_sha256` byte-for-byte (DF-2 lock).
  const digest = createHash("sha256").update(input.messageBytes).digest("hex");
  return {
    messageBytes: input.messageBytes,
    presignHash: `0x${digest}` as Hex,
  };
}

/**
 * ESM spy-affordance per CLAUDE.md convention. Consumers import
 * `_solanaPresign` and call `_solanaPresign.computeSolanaPresignHash(input)`
 * so tests can spy on the call without monkey-patching the production
 * import path.
 */
export const _solanaPresign = { computeSolanaPresignHash };
