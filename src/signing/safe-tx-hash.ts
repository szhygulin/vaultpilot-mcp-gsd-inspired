// Phase 37 Plan 37-01 (SAFE-05) — Safe EIP-712 typed-data digest computation.
//
// Pure-function digest for SafeTx v1.3.0 + v1.4.1. Built on `viem.hashTypedData`
// (no hand-rolled EIP-712 encoder — RESEARCH §Anti-Patterns). v1.3.0 and v1.4.1
// share BYTE-IDENTICAL EIP-712 typehashes (RESEARCH §Pitfall 1): one digest path
// handles both versions. `safeVersion` is load-bearing at the REFUSAL gate in
// `prepare_safe_tx_propose` (pre-v1.3.0 Safes have an `EIP712Domain` without
// `chainId` → cross-chain replay risk; refused before reaching this module).
//
// `chainId` choice (RESEARCH §Pitfall 2): pinned to `Number(input.chain)`.
// viem accepts `number | bigint` and encodes as `uint256` either way; pinning
// `number` keeps it consistent with the rest of the codebase. Fixtures SAFE-A/B/C
// anchor byte-for-byte correctness at this choice.
//
// Cross-ref: 37-RESEARCH.md §"Code Examples" Example 1 (lines 477-583) +
// §"Architecture Patterns" Pattern 2 (lines 287-325).

import { hashTypedData, type Address, type Hex, type TypedData } from "viem";

import type { ChainId } from "../config/contracts.js";

/** Safe Enum.Operation — 0 = Call, 1 = DelegateCall. */
export type SafeOperation = 0 | 1;

/**
 * Versions of Safe Smart Account supported by Phase 37. v1.3.0 + v1.4.1 share
 * byte-identical EIP-712 typehashes (RESEARCH §Pitfall 1) — version is used
 * ONLY at the refusal gate in `prepare_safe_tx_propose` to refuse pre-v1.3.0
 * (no chainId in their EIP-712 domain → cross-chain replay risk).
 */
export type SupportedSafeVersion = "1.3.0" | "1.4.1";

/**
 * Full EIP-712 typed-data structure for a SafeTx — surfaced to the agent for
 * transparency / independent re-derivation. Domain matches Safe v1.3.0+v1.4.1
 * (`{chainId, verifyingContract}`); SafeTx fields match the canonical
 * Safe smart-account spec (RESEARCH Example 1 lines 484-520).
 */
export interface SafeEIP712TypedData {
  domain: {
    chainId: number;
    verifyingContract: Address;
  };
  types: {
    EIP712Domain: [
      { name: "chainId"; type: "uint256" },
      { name: "verifyingContract"; type: "address" },
    ];
    SafeTx: [
      { name: "to"; type: "address" },
      { name: "value"; type: "uint256" },
      { name: "data"; type: "bytes" },
      { name: "operation"; type: "uint8" },
      { name: "safeTxGas"; type: "uint256" },
      { name: "baseGas"; type: "uint256" },
      { name: "gasPrice"; type: "uint256" },
      { name: "gasToken"; type: "address" },
      { name: "refundReceiver"; type: "address" },
      { name: "nonce"; type: "uint256" },
    ];
  };
  primaryType: "SafeTx";
  message: {
    to: Address;
    value: bigint;
    data: Hex;
    operation: SafeOperation;
    safeTxGas: bigint;
    baseGas: bigint;
    gasPrice: bigint;
    gasToken: Address;
    refundReceiver: Address;
    nonce: bigint;
  };
}

/**
 * Input shape for `buildSafeEIP712TypedData` / `computeSafeTxHash`. The 5
 * gas-relay fields (`safeTxGas` / `baseGas` / `gasPrice` / `gasToken` /
 * `refundReceiver`) are optional; modern Safe v1.3.0+ non-relayed txs set all
 * five to zero per the standard Safe UI convention (RESEARCH §Pitfall 7).
 */
export interface ComputeSafeTxHashInput {
  chain: ChainId;
  safeAddress: Address;
  safeVersion: SupportedSafeVersion;
  to: Address;
  value: bigint;
  data: Hex;
  operation: SafeOperation;
  safeTxGas?: bigint;
  baseGas?: bigint;
  gasPrice?: bigint;
  gasToken?: Address;
  refundReceiver?: Address;
  nonce: bigint;
}

const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/**
 * Build the canonical EIP-712 typed-data structure for a SafeTx. Defaults the
 * 5 gas-relay fields to zero per Safe v1.3.0+ non-relayed convention.
 *
 * `safeVersion` is accepted but NOT branched-on internally — v1.3.0 + v1.4.1
 * produce IDENTICAL typed-data shapes (RESEARCH §Pitfall 1). The version is
 * carried in the signature so the caller can surface it; the encoding path
 * is single.
 */
export function buildSafeEIP712TypedData(
  input: ComputeSafeTxHashInput,
): SafeEIP712TypedData {
  return {
    domain: {
      // Pin chainId as number (RESEARCH §Pitfall 2 — consistency with the
      // codebase). viem encodes as uint256 either way; the choice is locked.
      chainId: Number(input.chain),
      verifyingContract: input.safeAddress,
    },
    types: {
      EIP712Domain: [
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "SafeTx",
    message: {
      to: input.to,
      value: input.value,
      data: input.data,
      operation: input.operation,
      safeTxGas: input.safeTxGas ?? 0n,
      baseGas: input.baseGas ?? 0n,
      gasPrice: input.gasPrice ?? 0n,
      gasToken: input.gasToken ?? ZERO_ADDRESS,
      refundReceiver: input.refundReceiver ?? ZERO_ADDRESS,
      nonce: input.nonce,
    },
  };
}

/**
 * Compute the canonical 32-byte EIP-712 digest for a SafeTx — the "SafeTx hash".
 * Byte-identical to Safe's on-chain `getTransactionHash(...)` view and what
 * the Safe Tx Service stores.
 *
 * The cast to `viem.TypedData`-compatible shape is necessary because viem's
 * generic `hashTypedData` overload infers `chainId: bigint` from its strict
 * domain schema, while the codebase locks `chainId: number` (RESEARCH §Pitfall
 * 2). At runtime viem encodes both equivalently as `uint256`; the cast is a
 * type-system concession, not a behavioral concession. Fixtures SAFE-A/B/C
 * anchor byte-for-byte correctness.
 */
export function computeSafeTxHash(input: ComputeSafeTxHashInput): Hex {
  const td = buildSafeEIP712TypedData(input);
  return hashTypedData({
    domain: td.domain,
    types: td.types as unknown as TypedData,
    primaryType: td.primaryType,
    message: td.message,
  });
}
