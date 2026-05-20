// TRON-PREP-02 — TRON pre-sign hash recompute (research § Topic 4, DF-2 LOCKED).
//
// This is the SHA-256 the Ledger TRX app displays in blind-sign mode. The
// user matches it against the LEDGER BLIND-SIGN HASH (TRON) block emitted
// in preview_send (Plan 18-04). Confirmed via LedgerHQ/app-tron source:
// `cx_hash_sha256(raw_data_buffer, raw_data_length, …)` — the same SHA-256
// over `transaction.raw_data` Protobuf bytes. The on-device label is
// `"Transaction ID"` (per the TRX app source).
//
// Same input bytes as the TRON fingerprint (`payload-fingerprint-tron.ts`)
// but different hash function. This mirrors the Solana precedent (Phase 12):
// same message bytes, dual-hash — keccak256 for VaultPilot binding (DF-1),
// SHA-256 for on-device display (DF-2). EVM is the outlier (different
// preimage for fingerprint vs presign).
//
// CRITICAL: the input `rawDataBytes` MUST be `Buffer.from(transaction.raw_data_hex,
// "hex")` — the SAME bytes that flow into `computeTronPayloadFingerprint`.
// Passing different bytes here would produce a hash that does NOT match the
// Ledger device display, breaking the on-device-hash-match trust anchor.
//
// Note: `presignHash` field name matches `PreviewPinned.presignHash: Hex` for
// type-stability across chains. User-facing block label is `LEDGER BLIND-SIGN
// HASH (TRON)` while the on-device label is `"Transaction ID"` per the TRX
// app source — distinct labels for distinct surfaces; the field name stays
// uniform.
//
// Cross-ref: research § Topic 4 (DF-2 SHA-256 — TRON consensus tx-id =
// SHA-256(raw_data) = what Ledger TRX app displays) + research § Topic 1
// (DF-1 — the binding fingerprint, distinct hash function, distinct domain tag).

import { createHash } from "node:crypto";
import type { Hex } from "viem";

/**
 * Compute the SHA-256 of the TRON transaction raw_data bytes BEFORE signing.
 *
 * Returns BOTH the input raw_data bytes (echoed back verbatim — the helper
 * does NOT mutate) and the SHA-256 hash. `preview_send`'s TRON branch pins
 * `presignHash` into `PreviewPinned.presignHash: Hex` so downstream send
 * gates can re-verify; the LEDGER BLIND-SIGN HASH (TRON) block surfaces
 * the same value for the user to compare against the on-device display.
 *
 * The resulting `presignHash` === `"0x" + transaction.txID` — TRON's
 * consensus tx-id IS the SHA-256 of raw_data, which is exactly what the
 * Ledger TRX app displays on-screen in blind-sign mode (DF-2 lock per
 * research § Topic 4).
 */
export function computeTronPresignHash(input: {
  rawDataBytes: Uint8Array;
}): { rawDataBytes: Uint8Array; presignHash: Hex } {
  // Node stdlib SHA-256 — no extra deps. Matches the Ledger TRX app's
  // `cx_hash_sha256` byte-for-byte (DF-2 lock). Also matches the TRON
  // consensus tx-id derivation: `SHA-256(raw_data)` per the TRON protocol
  // documentation and tronweb's `transaction.txID` field.
  const digest = createHash("sha256").update(input.rawDataBytes).digest("hex");
  return {
    rawDataBytes: input.rawDataBytes,
    presignHash: `0x${digest}` as Hex,
  };
}

/**
 * ESM spy-affordance per CLAUDE.md convention. Consumers import
 * `_tronPresign` and call `_tronPresign.computeTronPresignHash(input)`
 * so tests can spy on the call without monkey-patching the production
 * import path.
 */
export const _tronPresign = { computeTronPresignHash };
