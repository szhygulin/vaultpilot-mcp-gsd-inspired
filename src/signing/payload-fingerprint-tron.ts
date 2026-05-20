// TRON-PREP-01 — payloadFingerprint compute path for TRON (research § Topic 1,
// DF-1 LOCKED).
//
// The fingerprint binds the agent's claimed TRON raw_data bytes at prepare
// time. It is re-checked at send time; any drift is the
// PAYLOAD_FINGERPRINT_DRIFT structured refusal (Plan 18-04). The
// domain tag is version-stamped ("v1:") and CHAIN-DISTINCT
// ("VaultPilot-trontx-v1:" — 21 UTF-8 bytes vs the EVM "VaultPilot-txverify-v1:"
// 23 UTF-8 bytes and Solana "VaultPilot-soltx-v1:" 20 UTF-8 bytes) so
// cross-chain reuse is impossible at the keccak preimage level.
//
// Sibling of `src/signing/payload-fingerprint-solana.ts` (Solana — Plan 12-01)
// and `src/signing/payload-fingerprint.ts` (EVM — FROZEN). The differentiator
// is the DOMAIN TAG, NOT the hash function: all three chains use keccak256 at
// the binding layer. The device-side display hash (DF-2 — SHA-256, computed in
// `presign-hash-tron.ts`) serves the on-device user-verification layer, NOT
// the agent→server binding layer.
//
// Anti-pattern guard — NEVER pass the outer `tronweb.Transaction` object's
// full JSON to this helper. The outer envelope includes `signature[]` (filled
// post-sign) and the `txID` field (computed by tronweb client-side; NOT part
// of the consensus preimage). Pass ONLY `Buffer.from(transaction.raw_data_hex,
// "hex")` — the canonical Protobuf-serialized bytes that TRON consensus hashes.
// (RESEARCH § Topic 1 Pitfall: passing the full envelope would produce a
// fingerprint that changes once signatures are populated.)
//
// Cross-ref: research § Topic 1 (DF-1 preimage rationale + domain-tag
// distinctness) + research § Topic 4 (DF-2 SHA-256 device-display hash —
// sibling helper `presign-hash-tron.ts`).

import { concat, keccak256, toBytes } from "viem";
import type { Hex } from "viem";

/**
 * Version-stamped TRON domain tag. EXPORTED so the test suite can assert
 * the 21-byte UTF-8 length invariant (distinct from EVM 23-byte tag and
 * Solana 20-byte tag — cross-chain reuse impossible at the preimage level).
 * The tag itself is NOT configurable — changing it is a wire-shape break and
 * must coincide with a v2 fingerprint format.
 */
export const FINGERPRINT_DOMAIN_TAG_TRON = "VaultPilot-trontx-v1:";

/**
 * Compute the prepare-time-stable TRON payloadFingerprint per TRON-PREP-01.
 *
 * Preimage = DOMAIN_TAG (utf-8, 21 bytes) ‖ rawDataBytes (variable)
 *
 * `rawDataBytes` MUST be `Buffer.from(transaction.raw_data_hex, "hex")` —
 * the canonical Protobuf-serialized bytes of `transaction.raw_data` that
 * TRON nodes use to compute the consensus tx-id. The TRON fingerprint IS
 * SENDER-DEPENDENT by construction because `owner_address` is a Protobuf
 * field inside both `TransferContract` and `TriggerSmartContract`.
 *
 * Returns a 32-byte 0x-prefixed hex string (66 chars including the prefix).
 */
export function computeTronPayloadFingerprint(input: {
  rawDataBytes: Uint8Array;
}): Hex {
  const tag = toBytes(FINGERPRINT_DOMAIN_TAG_TRON); // 21 bytes utf-8
  const preimage = concat([tag, input.rawDataBytes]);
  return keccak256(preimage);
}

/**
 * ESM spy-affordance per CLAUDE.md convention. Consumers (Plans 18-02 /
 * 18-03 prepare tools + Plan 18-04 preview+send branch) import
 * `_tronFingerprint` and call
 * `_tronFingerprint.computeTronPayloadFingerprint(input)` so tests can
 * spy on the call without monkey-patching the production import path.
 */
export const _tronFingerprint = { computeTronPayloadFingerprint };
