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

/**
 * Version-stamped domain tag. EXPORTED so the test suite can assert the
 * 23-byte UTF-8 length invariant (research line 879). The tag itself is NOT
 * configurable — changing it is a wire-shape break and must coincide with a
 * v2 fingerprint format.
 */
export const FINGERPRINT_DOMAIN_TAG = "VaultPilot-txverify-v1:";

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
