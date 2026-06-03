// TAO-PREP-01 — payloadFingerprint compute path for Bittensor (subtensor)
// (47-RESEARCH §Probe 1 + §Pattern 1; milestone-locked decision).
//
// The fingerprint binds the agent's claimed UNSIGNED `SignerPayload` SCALE
// bytes at prepare time. It is re-checked at send time; any drift is the
// PAYLOAD_FINGERPRINT_DRIFT structured refusal (Plan 47-04). The domain tag
// is version-stamped ("v1:") and CHAIN-DISTINCT ("VaultPilot-taotx-v1:").
//
// Sibling of `src/signing/payload-fingerprint-solana.ts` (Solana — FROZEN),
// `src/signing/payload-fingerprint-tron.ts` (TRON — FROZEN), and
// `src/signing/payload-fingerprint.ts` (EVM — FROZEN). The differentiator is
// the DOMAIN TAG, NOT the hash function: all chains use keccak256 at the
// binding layer. The device-side display hash (blake2-256, computed in
// `presign-hash-bittensor.ts`) serves the on-device user-verification layer,
// NOT the agent→server binding layer.
//
// CRITICAL tag-length note (47-RESEARCH correction #1): "VaultPilot-taotx-v1:"
// is exactly 20 UTF-8 bytes — the SAME length as Solana's
// "VaultPilot-soltx-v1:". Distinctness is by CONTENT (taotx ≠ soltx), NOT by
// length. Do NOT assert a UNIQUE byte length for this tag — it would be wrong
// (it collides with Solana's 20). The TRON sibling's unique-length assertion
// (21 bytes) does not apply here.
//
// Anti-pattern guard — NEVER pass the SIGNED envelope (`signedTx.toU8a()` /
// `tx.toHex()`) here. That includes the signature and would change post-sign,
// breaking the prepare→send drift gate. Pass ONLY the unsigned signable blob:
// `registry.createType("ExtrinsicPayload", signerPayloadJSON, { version })
// .toU8a({ method: true })` — the bytes the Ledger device signs over and that
// subtensor consensus binds (47-RESEARCH §Probe 1, Decision D-BLOB). The
// `{ method: true }` flag is REQUIRED so the SCALE `(call ‖ extra ‖
// additionalSigned)` blob carries the call bytes — omitting it would hash a
// call-less payload that the device never sees.
//
// Cross-ref: 47-RESEARCH §Probe 1 (preimage = ExtrinsicPayload SCALE bytes) +
// §Pattern 1 (sibling mirror + the CRITICAL tag-length correction).

import { concat, keccak256, toBytes } from "viem";
import type { Hex } from "viem";

/**
 * Version-stamped Bittensor domain tag. EXPORTED so the test suite can assert
 * the exact string value + pairwise distinctness from every other chain tag.
 *
 * NOTE: this tag is 20 UTF-8 bytes — IDENTICAL in length to Solana's
 * "VaultPilot-soltx-v1:". Cross-chain reuse is impossible at the preimage
 * level by CONTENT (taotx ≠ soltx), not by length. The tag itself is NOT
 * configurable — changing it is a wire-shape break and must coincide with a
 * v2 fingerprint format.
 */
export const FINGERPRINT_DOMAIN_TAG_BITTENSOR = "VaultPilot-taotx-v1:";

/**
 * Compute the prepare-time-stable Bittensor payloadFingerprint per TAO-PREP-01.
 *
 * Preimage = DOMAIN_TAG (utf-8, 20 bytes) ‖ signableBytes (variable)
 *
 * `signableBytes` MUST be the output of
 * `registry.createType("ExtrinsicPayload", signerPayloadJSON, { version })
 * .toU8a({ method: true })` — the canonical SCALE-encoded
 * `(call ‖ signed-extension extra ‖ additionalSigned)` blob with NO leading
 * compact-length prefix. This is the Substrate analog of Solana's
 * `serializeMessage()` / TRON's `raw_data_hex`. It is SENDER-INDEPENDENT (the
 * subtensor `SignerPayload` does not embed the signing address — the `from`
 * is supplied separately to `addSignature` at send time), in contrast with
 * Solana whose `feePayer` is inside the message bytes.
 *
 * Returns a 32-byte 0x-prefixed hex string (66 chars including the prefix).
 */
export function computeBittensorPayloadFingerprint(input: {
  signableBytes: Uint8Array;
}): Hex {
  const tag = toBytes(FINGERPRINT_DOMAIN_TAG_BITTENSOR); // 20 bytes utf-8
  const preimage = concat([tag, input.signableBytes]);
  return keccak256(preimage);
}

/**
 * ESM spy-affordance per CLAUDE.md convention. Consumers (Plan 47-02 prepare
 * tools + Plan 47-04 send branch) import `_bittensorFingerprint` and call
 * `_bittensorFingerprint.computeBittensorPayloadFingerprint(input)` so tests
 * can spy on the call without monkey-patching the production import path.
 */
export const _bittensorFingerprint = { computeBittensorPayloadFingerprint };
