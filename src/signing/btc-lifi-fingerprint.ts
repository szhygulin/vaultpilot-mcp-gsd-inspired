// src/signing/btc-lifi-fingerprint.ts — Phase 26 Plan 26-03 (BTC-LIFI-01).
//
// Domain-tagged keccak256 payloadFingerprint for BTC LiFi bridge transactions.
// Sibling of `src/signing/btc-fingerprint.ts` (BTC native sends) and
// `src/signing/ltc-fingerprint.ts` (LTC sends).
//
// STRUCTURAL DIVERGENCE from btc-fingerprint.ts:
//   btc-fingerprint hashes a VARIADIC SPREAD of N 32-byte per-input sighashes
//   (one per UTXO, over a VaultPilot-constructed PSBT).
//
//   btc-lifi-fingerprint hashes ONE Uint8Array representing the WHOLE PSBT bytes
//   (keccak256("VaultPilot-btclifi-v1:" ‖ psbtBytes)).
//   This is because the PSBT is LiFi-constructed, not VaultPilot-constructed.
//   VaultPilot's role is to sign + broadcast, not to construct. The whole-PSBT-bytes
//   preimage commits to the exact byte sequence the Ledger device will sign —
//   any modification (reorder, drop OP_RETURN, change output) changes the fingerprint.
//   This is the T-26-11 (PSBT output mutation) + T-26-14 (prepare↔send byte drift) mitigation.
//
// Domain tag "VaultPilot-btclifi-v1:" is DISTINCT from:
//   "VaultPilot-btctx-v1:"  (BTC native sends — btc-fingerprint.ts)
//   "VaultPilot-ltctx-v1:"  (LTC sends — ltc-fingerprint.ts)
// This cross-chain fingerprint distinctness is the T-26-12 mitigation.
// Fixture AA pins the literal and asserts inequality against both siblings.
//
// FROZEN guard (mirroring btc-fingerprint.ts): this module is a NEW file.
// btc-fingerprint.ts and btc-sighash.ts remain BYTE-UNTOUCHED by Plan 26-03.

import { concat, keccak256, toBytes } from "viem";
import type { Hex } from "viem";

/**
 * Version-stamped BTC LiFi bridge domain tag. EXPORTED so the test suite can
 * assert the byte-length invariant and the string distinctness from BTC + LTC tags.
 *
 * "VaultPilot-btclifi-v1:" — 23 UTF-8 bytes.
 * Distinct from "VaultPilot-btctx-v1:" (20 bytes) and "VaultPilot-ltctx-v1:" (20 bytes).
 * The longer domain tag is intentional — the "lifi" infix disambiguates LiFi-constructed
 * PSBTs from user-constructed VaultPilot PSBTs.
 *
 * The tag is NOT configurable — changing it is a wire-shape break requiring a v2 format bump.
 */
export const FINGERPRINT_DOMAIN_TAG_BTC_LIFI = "VaultPilot-btclifi-v1:";

/**
 * Compute the prepare-time-stable BTC LiFi payloadFingerprint per BTC-LIFI-01.
 *
 * Preimage = DOMAIN_TAG ("VaultPilot-btclifi-v1:", 23 UTF-8 bytes) ‖ psbtBytes
 *
 * `psbtBytes` MUST be the raw PSBT bytes decoded from `transactionRequest.data`
 * (e.g. `toBytes(psbtHex)` from viem or `Buffer.from(psbtHex, "hex")`).
 * The whole-PSBT-bytes preimage commits to the exact byte sequence the Ledger device
 * will PSBT-sign — any output reorder, OP_RETURN drop, or value change produces a
 * distinct fingerprint.
 *
 * This function does NOT take per-input sighashes (unlike computeBtcPayloadFingerprint).
 * The PSBT is LiFi-constructed; VaultPilot commits to the whole PSBT verbatim.
 *
 * Returns a 32-byte 0x-prefixed hex string (66 chars including the prefix).
 */
export function computeBtcLifiPayloadFingerprint(psbtBytes: Uint8Array): Hex {
  const preimage = concat([toBytes(FINGERPRINT_DOMAIN_TAG_BTC_LIFI), psbtBytes]);
  return keccak256(preimage);
}

/**
 * ESM spy-affordance per CLAUDE.md convention. Consumers (prepare_btc_lifi_swap,
 * preview_send btc-lifi branch, send_transaction btc-lifi branch) import
 * `_btcLifiFingerprint` and call
 * `_btcLifiFingerprint.computeBtcLifiPayloadFingerprint(...)` so tests can spy
 * on the call without monkey-patching the production import path.
 */
export const _btcLifiFingerprint = { computeBtcLifiPayloadFingerprint };
