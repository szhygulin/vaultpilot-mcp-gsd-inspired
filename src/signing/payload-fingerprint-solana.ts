// SOL-PREP-01 — payloadFingerprint compute path for Solana (research § Topic 1,
// DF-1 LOCKED).
//
// The fingerprint binds the agent's claimed Solana message bytes at prepare
// time. It is re-checked at send time; any drift is the
// PAYLOAD_FINGERPRINT_DRIFT structured refusal (Wave 5 — Plan 12-05). The
// domain tag is version-stamped ("v1:") and CHAIN-DISTINCT
// ("VaultPilot-soltx-v1:" — 20 UTF-8 bytes vs the EVM "VaultPilot-txverify-v1:"
// 23 UTF-8 bytes) so cross-chain reuse is impossible at the keccak preimage
// level (sibling assertion to Phase 8 Fixture J chain-distinctness).
//
// Sibling of `src/signing/payload-fingerprint.ts` — EVM version stays
// byte-frozen. The differentiator is the DOMAIN TAG, NOT the hash function:
// both chains use keccak256 at the binding layer. The device-side display
// hash (DF-2 — SHA-256, computed in `presign-hash-solana.ts`) serves the
// on-device user-verification layer, NOT the agent→server binding layer.
//
// Anti-pattern guard — NEVER pass the full `Transaction.serialize({
// requireAllSignatures: false })` output here. That includes a zero-filled
// signature region pre-signing and would produce a fingerprint that
// changes once signatures are populated. Pass ONLY the bytes from
// `Transaction.serializeMessage()` — the bytes the network actually signs
// over (RESEARCH § Topic 1 Pitfall 2).
//
// Cross-ref: research § Topic 1 (preimage rationale + DF-1 lock) + Topic 2
// (DF-2 SHA-256 device-display hash — distinct from this fingerprint).

import { concat, keccak256, toBytes } from "viem";
import type { Hex } from "viem";

/**
 * Version-stamped Solana domain tag. EXPORTED so the test suite can assert
 * the 20-byte UTF-8 length invariant (distinct from the EVM 23-byte tag —
 * cross-chain reuse impossible at the preimage level). The tag itself is
 * NOT configurable — changing it is a wire-shape break and must coincide
 * with a v2 fingerprint format.
 */
export const FINGERPRINT_DOMAIN_TAG_SOLANA = "VaultPilot-soltx-v1:";

/**
 * Compute the prepare-time-stable Solana payloadFingerprint per SOL-PREP-01.
 *
 * Preimage = DOMAIN_TAG (utf-8, 20 bytes) ‖ messageBytes (variable)
 *
 * `messageBytes` MUST be the output of `Transaction.serializeMessage()` —
 * the canonical Solana message-only serialization that includes
 * `feePayer` (account_keys[0]), `recentBlockhash`, and the instruction
 * vector. The Solana fingerprint IS SENDER-DEPENDENT by construction
 * (contrast with EVM where the `from` field is not in the EIP-1559
 * preimage) because `feePayer` is in the signed message bytes — this is
 * correct and load-bearing.
 *
 * Returns a 32-byte 0x-prefixed hex string (66 chars including the prefix).
 */
export function computeSolanaPayloadFingerprint(input: {
  messageBytes: Uint8Array;
}): Hex {
  const tag = toBytes(FINGERPRINT_DOMAIN_TAG_SOLANA); // 20 bytes utf-8
  const preimage = concat([tag, input.messageBytes]);
  return keccak256(preimage);
}

/**
 * ESM spy-affordance per CLAUDE.md convention. Consumers (Plans 12-02 /
 * 12-03 prepare tools + Plans 12-04 / 12-05 preview+send branches) import
 * `_solanaFingerprint` and call
 * `_solanaFingerprint.computeSolanaPayloadFingerprint(input)` so tests can
 * spy on the call without monkey-patching the production import path.
 */
export const _solanaFingerprint = { computeSolanaPayloadFingerprint };
