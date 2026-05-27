// PREP-03 — payloadFingerprint compute path (research § Code Example 1 verbatim).
//
// The fingerprint binds the agent's claimed args (chainId, to, valueWei, data)
// at prepare time. It is re-checked at send time; any drift is the
// PAYLOAD_FINGERPRINT_DRIFT structured refusal (Plan 04-04). The domain tag
// is version-stamped ("v1:") so a future v2 format (e.g. with access-list
// bound) can NOT collide at the keccak preimage level.
//
// Cross-ref: research § Q1 (preimage rationale) + Code Example 1 (lines 506–544,
// verified end-to-end at /tmp/viem-probe/compute-fingerprint.mjs, 2026-05-12).

import { concat, hexToBytes, keccak256, numberToBytes, toBytes } from "viem";
import type { Address, Hex } from "viem";

import type { ChainId } from "../config/contracts.js";

/**
 * Version-stamped domain tag. EXPORTED so the test suite can assert the
 * 23-byte UTF-8 length invariant (research line 879). The tag itself is NOT
 * configurable — changing it is a wire-shape break and must coincide with a
 * v2 fingerprint format.
 */
export const FINGERPRINT_DOMAIN_TAG = "VaultPilot-txverify-v1:";

/**
 * Phase 37 Plan 37-01 (SAFE-05) — `payloadFingerprint` domain tag for SafeTx
 * typed-data flows. Sibling to the EVM `VaultPilot-txverify-v1:` tag and the
 * non-EVM tags (`VaultPilot-soltx-v1:` / `VaultPilot-trontx-v1:` /
 * `VaultPilot-btctx-v1:` / `VaultPilot-ltctx-v1:` / `VaultPilot-btclifi-v1:`).
 *
 * Cross-flow fingerprint reuse is IMPOSSIBLE by construction — the tag is the
 * first 22 UTF-8 bytes of the preimage; flipping a Safe tag in for an EVM tag
 * (or vice versa) produces a structurally distinct keccak. Fixture SAFE-D
 * anchors this preimage shape as a hardcoded `0x…` literal in
 * `test/signing-fingerprint.test.ts`.
 */
export const SAFE_TX_FINGERPRINT_DOMAIN_TAG = "VaultPilot-safetx-v1:";

/**
 * Compute the prepare-time-stable payloadFingerprint per PREP-03.
 *
 * Preimage = DOMAIN_TAG (utf-8) ‖ chainId(32-byte BE) ‖ to(20 bytes) ‖
 *            value(32-byte BE) ‖ data(variable)
 *
 * For a native send with data === "0x", the preimage is 107 bytes
 * (23 + 32 + 20 + 32 + 0). For an ERC-20 transfer with 68-byte data,
 * the preimage is 175 bytes. The keccak output is a 32-byte 0x-prefixed
 * hex string (66 chars including the prefix).
 *
 * Throws (via viem.hexToBytes) on a malformed `to` or `data` input.
 */
export function computePayloadFingerprint(input: {
  chainId: number;
  to: Address;
  valueWei: bigint;
  data: Hex;
}): Hex {
  const tag = toBytes(FINGERPRINT_DOMAIN_TAG); // 23 bytes utf-8
  const chainIdBytes = numberToBytes(input.chainId, { size: 32 });
  const toBytes20 = hexToBytes(input.to); // 20 bytes — viem rejects non-address-shaped input
  const valueBytes = numberToBytes(input.valueWei, { size: 32 });
  const dataBytes = hexToBytes(input.data); // 0 bytes when data === "0x"
  const preimage = concat([tag, chainIdBytes, toBytes20, valueBytes, dataBytes]);
  return keccak256(preimage);
}

/**
 * Phase 37 Plan 37-01 — Safe typed-data `payloadFingerprint` compute path.
 *
 * Distinct domain tag from `computePayloadFingerprint` (EVM) so a Safe
 * typed-data handle and an EVM `execTransaction` handle never produce the
 * same fingerprint — even when the inner SafeTx args coincide with EVM args
 * by accident.
 *
 * Preimage layout (per 37-CONTEXT.md §"`payloadFingerprint` domain tag for
 * SafeTx typed-data"):
 *
 *   tag                            // 21 bytes utf-8 ("VaultPilot-safetx-v1:")
 *   chain         (uint64 LE)      //  8 bytes  ← LE per CONTEXT lock
 *   safeAddress                    // 20 bytes
 *   safeVersion   (utf-8 string)   //  6 bytes  ("v1.3.0" or "v1.4.1")
 *   safeTxHash                     // 32 bytes  (EIP-712 digest)
 *   nonce         (uint256 BE)     // 32 bytes
 *   operation     (uint8)          //  1 byte   (0=call, 1=delegatecall)
 *   to                             // 20 bytes
 *   value         (uint256 BE)     // 32 bytes
 *   keccak256(data)                // 32 bytes
 *
 * Endianness gotcha (RESEARCH §Pitfall A4): viem `numberToBytes` defaults to
 * BIG-ENDIAN; the CONTEXT lock encodes `chain` as LITTLE-ENDIAN to keep
 * cross-chain replay defenses distinct from the EVM uint256-BE chainId
 * convention. We reverse the BE bytes explicitly. Fixture SAFE-D is the
 * regression anchor.
 */
export function computeSafeTxPayloadFingerprint(input: {
  chain: ChainId;
  safeAddress: Address;
  safeVersion: "1.3.0" | "1.4.1";
  safeTxHash: Hex;
  nonce: bigint;
  operation: 0 | 1;
  to: Address;
  value: bigint;
  data: Hex;
}): Hex {
  const tag = toBytes(SAFE_TX_FINGERPRINT_DOMAIN_TAG); // 21 bytes utf-8
  // viem.numberToBytes is BE-only; reverse for LE per CONTEXT lock (Pitfall A4).
  const chainBytes = new Uint8Array(
    numberToBytes(input.chain, { size: 8 }),
  ).reverse(); // uint64 LE — 8 bytes
  const safeAddressBytes = hexToBytes(input.safeAddress); // 20 bytes
  const versionBytes = toBytes(`v${input.safeVersion}`); // "v1.3.0" / "v1.4.1" — 6 bytes utf-8
  const safeTxHashBytes = hexToBytes(input.safeTxHash); // 32 bytes
  const nonceBytes = numberToBytes(input.nonce, { size: 32 }); // uint256 BE
  const operationBytes = numberToBytes(input.operation, { size: 1 }); // uint8
  const toBytes20 = hexToBytes(input.to); // 20 bytes
  const valueBytes = numberToBytes(input.value, { size: 32 }); // uint256 BE
  const dataKeccak = hexToBytes(keccak256(hexToBytes(input.data))); // 32 bytes
  const preimage = concat([
    tag,
    chainBytes,
    safeAddressBytes,
    versionBytes,
    safeTxHashBytes,
    nonceBytes,
    operationBytes,
    toBytes20,
    valueBytes,
    dataKeccak,
  ]);
  return keccak256(preimage);
}
