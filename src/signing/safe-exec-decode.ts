// SHARED decoder for Safe `execTransaction(...)` calldata.
//
// Phase 37 Plan 37-03 (SAFE-08). Consumed by:
//   - `src/tools/prepare_safe_tx_execute.ts` — CHECKS PERFORMED composite
//     preview (the encapsulated `(to, value, data, operation)` quartet
//     surfaced to the user at prepare time, plus the Invariant #1 sanity
//     selector assertion).
//   - `src/tools/preview_send.ts` — composite-tx decode arm for any handle
//     whose `tx.data` starts with `0x6a761202` (the EXEC_TRANSACTION_SELECTOR).
//
// Single source of truth — mirrors the Plan 33-03 `src/signing/uniswap-*`
// SHARED-decoder discipline (Pitfall 7 / CLAUDE.md ESM bindings rule). Drift
// here breaks BOTH the prepare-side CHECKS PERFORMED block AND the
// preview-side composite-tx arm; the byte-identity integration test (Plan
// 37-03 Task 3) anchors prepare-vs-preview WARN-block parity.

import {
  decodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

/**
 * Canonical Safe `execTransaction(...)` selector.
 *
 * keccak256("execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)").slice(0, 10)
 *   = 0x6a761202
 *
 * Verified against 4byte.directory + the canonical Safe Smart Account spec
 * (https://github.com/safe-global/safe-smart-account). Used as the load-
 * bearing discriminator in `preview_send.ts`'s composite-tx decode arm — the
 * `tx.to` is the user's Safe proxy at `safeAddress` (per-user, NOT globally
 * allowlistable), so selector-based dispatch is the only safe choice.
 */
export const EXEC_TRANSACTION_SELECTOR = "0x6a761202" as const;

/**
 * Canonical Safe `execTransaction(...)` ABI entry, parsed via viem.parseAbi.
 *
 * Signature mirror of the Safe Smart Account spec: 10 positional arguments,
 * returns a single `bool success`. The function consumes a single `bytes
 * signatures` blob containing the concatenated 65-byte ECDSA signatures
 * sorted ascending by signer address (per Plan 37-03 Task 1 step 12 / Safe
 * checkSignatures iteration discipline).
 */
export const execTransactionAbi = parseAbi([
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool)",
]);

/**
 * Decoded Safe `execTransaction(...)` quartet + gas-relay quintet + signatures
 * blob. The encapsulated `(to, value, data, operation)` quartet is what the
 * Safe will dispatch when the on-chain execTransaction lands — surfaced in
 * CHECKS PERFORMED / DECODED ARGS so the user sees the BUSINESS-LAYER op,
 * not just "execTransaction(...)".
 *
 * `operation` is narrowed to the `0 | 1` enum (call | delegatecall). Values
 * outside that set produce a thrown `Error` — Safe's `execTransaction` would
 * revert on-chain for operation >= 2, so refusing at decode time is the
 * fail-fast discipline.
 */
export interface DecodedSafeExecTransaction {
  to: Address;
  value: bigint;
  data: Hex;
  operation: 0 | 1;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: Address;
  refundReceiver: Address;
  signatures: Hex;
}

/**
 * Decode a single Safe `execTransaction(...)` calldata blob into its named
 * quartet + gas-relay quintet + signatures. Throws on:
 *   - selector mismatch (data does NOT start with 0x6a761202)
 *   - viem-internal decode failure (malformed calldata)
 *   - operation outside {0, 1}
 *
 * NOTE on safety: callers (prepare_safe_tx_execute + preview_send) MUST
 * pre-check `data.slice(0, 10) === EXEC_TRANSACTION_SELECTOR` before invoking
 * — the selector check is the routing discriminator in preview_send's
 * dispatch arm, NOT a defense inside this decoder.
 */
export function decodeSingleSafeExecTransaction(
  data: Hex,
): DecodedSafeExecTransaction {
  const decoded = decodeFunctionData({ abi: execTransactionAbi, data });
  if (decoded.functionName !== "execTransaction") {
    throw new Error(
      `decodeSingleSafeExecTransaction: expected functionName 'execTransaction', got '${decoded.functionName}'`,
    );
  }
  const args = decoded.args as readonly [
    Address,
    bigint,
    Hex,
    number,
    bigint,
    bigint,
    bigint,
    Address,
    Address,
    Hex,
  ];
  const [
    to,
    value,
    innerData,
    operationRaw,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    signatures,
  ] = args;
  if (operationRaw !== 0 && operationRaw !== 1) {
    throw new Error(
      `decodeSingleSafeExecTransaction: invalid operation value ${operationRaw} — expected 0 (call) or 1 (delegatecall)`,
    );
  }
  return {
    to,
    value,
    data: innerData,
    operation: operationRaw as 0 | 1,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    signatures,
  };
}
