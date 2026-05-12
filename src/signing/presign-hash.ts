// PREP-04 — EIP-1559 pre-sign hash recompute (research § Code Example 2 verbatim).
//
// This is the keccak the Ledger device displays in blind-sign mode. The user
// matches it against the LEDGER BLIND-SIGN HASH block we emit (subject to A1
// — the device may chunk / truncate, hence the dual-form block template).
//
// EIP-2718 + RLP wrapping is handled internally by
// `viem.serializeTransaction` (verified at viem/_types/utils/transaction/
// serializeTransaction.d.ts:20). Hand-rolling the envelope is an
// anti-pattern (research § Anti-Patterns line 421).
//
// Cross-ref: research § Code Example 2 (lines 571–612, verified at
// /tmp/viem-probe/compute-fingerprint.mjs, 2026-05-12).

import { keccak256, serializeTransaction } from "viem";
import type { Address, Hex } from "viem";

/**
 * Compute the keccak256 of the EIP-1559 transaction envelope BEFORE signing.
 *
 * Returns BOTH the serialized bytes and the keccak — Plan 04-04's
 * `send_transaction` forwards the serialized bytes to WalletConnect; Plan
 * 04-03's `preview_send` puts the keccak in the LEDGER BLIND-SIGN HASH
 * block; Plan 04-05's `get_tx_verification` exposes both so the agent can
 * cross-check (and the user can manually parseTransaction the serialized
 * bytes if curious).
 *
 * Per the EIP-1559 spec (EIP-2718 wrapping):
 *   serialized = 0x02 || rlp([chainId, nonce, maxPriorityFeePerGas,
 *                              maxFeePerGas, gas, to, value, data,
 *                              accessList])
 *   hash = keccak256(serialized)
 */
export function computePresignHash(input: {
  chainId: number;
  nonce: number;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gas: bigint;
  to: Address;
  value: bigint;
  data: Hex;
}): { serialized: Hex; presignHash: Hex } {
  const serialized = serializeTransaction({
    type: "eip1559",
    chainId: input.chainId,
    nonce: input.nonce,
    to: input.to,
    value: input.value,
    gas: input.gas,
    maxFeePerGas: input.maxFeePerGas,
    maxPriorityFeePerGas: input.maxPriorityFeePerGas,
    data: input.data,
    accessList: [],
  });
  return { serialized, presignHash: keccak256(serialized) };
}
