// src/protocols/bridge-decoders/across-v3.ts — Phase 39 Plan 39-02 (BRIDGE-T1-04).
//
// Across V3 SpokePool `depositV3` calldata decoder.
// Extracts the `recipient` (plain EVM `address`) field and normalizes it via
// getAddress() (EIP-55) for the Inv #6b final-recipient assertion.
//
// Contract: 0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5 (Ethereum mainnet SpokePool)
// Function: depositV3(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,uint32,bytes)
// Selector: 0x7b939232
// Recipient field: args[1] — plain EVM address (Across V3 is EVM-to-EVM only)
//
// DISPLAY/ASSERT-ONLY — does NOT reconstruct or re-encode calldata.
// NEVER-throws discriminated union result (WR-02 compliance).

import { decodeFunctionData, getAddress, parseAbi } from "viem";
import type { Hex } from "viem";

// ─── ABI ──────────────────────────────────────────────────────────────────────

const ACROSS_V3_DEPOSIT_ABI = parseAbi([
  "function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message)",
]);

// ─── Selector constants ───────────────────────────────────────────────────────

/** 4-byte selector for Across V3 SpokePool `depositV3`. VERIFIED: viem.toFunctionSelector 2026-05-28. */
export const ACROSS_V3_SELECTORS = {
  depositV3: "0x7b939232" as Hex,
} as const;

// ─── Summary interface ────────────────────────────────────────────────────────

/**
 * Decoded summary of an Across V3 `depositV3` call.
 * `finalRecipient` is the EIP-55 checksummed EVM address — the field the
 * Layer 0.6 assertion compares against the user-supplied `toAddress`.
 */
export interface AcrossV3Summary {
  /** EVM recipient address, EIP-55 checksummed via getAddress(). */
  readonly finalRecipient: string;
  /** Destination chain ID (e.g. 42161n = Arbitrum One). */
  readonly destinationChainId: bigint;
  /** Input token address (EIP-55 checksummed). */
  readonly inputToken: string;
  /** Output token address on destination chain (EIP-55 checksummed). */
  readonly outputToken: string;
}

// ─── Discriminated union result ───────────────────────────────────────────────

/**
 * NEVER-throws discriminated union result for `decodeAcrossV3Deposit` (WR-02).
 * All errors return `{ kind: "error" }` — no throws propagate to `preview_send`.
 */
export type DecodeAcrossV3Result =
  | { kind: "ok"; summary: AcrossV3Summary }
  | { kind: "error"; message: string };

// ─── Decoder ──────────────────────────────────────────────────────────────────

/**
 * Decode Across V3 `depositV3` calldata and extract the final recipient.
 *
 * Returns `{ kind: "ok", summary }` with the EIP-55 checksummed recipient on success.
 * Returns `{ kind: "error", message }` for selector mismatch or malformed calldata.
 * NEVER throws — WR-02 compliance.
 */
export function decodeAcrossV3Deposit(data: Hex): DecodeAcrossV3Result {
  // Selector-prefix guard — cheap short-circuit before attempting ABI decode.
  if (!data.toLowerCase().startsWith(ACROSS_V3_SELECTORS.depositV3)) {
    return {
      kind: "error",
      message: "selector mismatch: not a depositV3 call",
    };
  }

  try {
    const decoded = _acrossV3Helpers.decodeFunctionData(data);
    // args[1] = recipient (EVM address); args[2] = inputToken; args[3] = outputToken; args[6] = destinationChainId
    const finalRecipient = getAddress(decoded.args[1] as string);
    const inputToken = getAddress(decoded.args[2] as string);
    const outputToken = getAddress(decoded.args[3] as string);
    const destinationChainId = decoded.args[6] as bigint;

    return {
      kind: "ok",
      summary: {
        finalRecipient,
        destinationChainId,
        inputToken,
        outputToken,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "error", message: `ABI decode failed: ${msg}` };
  }
}

// ─── ESM spy-affordance indirection ──────────────────────────────────────────

/**
 * ESM indirection object for `vi.spyOn` in tests (CLAUDE.md convention).
 * Direct spy on a named ESM export is a no-op; spy via this object works.
 */
export const _acrossV3Helpers = {
  decodeFunctionData: (data: Hex) =>
    decodeFunctionData({ abi: ACROSS_V3_DEPOSIT_ABI, data }),
};
