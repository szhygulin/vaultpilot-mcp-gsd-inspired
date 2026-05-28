// src/protocols/bridge-decoders/near-omnibridge.ts — Phase 39 Plan 39-02 (BRIDGE-T1-03).
//
// NEAR OmniBridge `initTransfer` calldata decoder.
// Extracts the `recipient` (ABI `string` — NEAR account ID) field and normalizes
// it via `.toLowerCase().trim()` for the Inv #6b final-recipient assertion.
//
// Contract: 0xe00c629aFaCCb0510995A2B95560E446A24c85B9 (Ethereum mainnet)
// Function: initTransfer(address,uint128,uint128,uint128,string,string)
// Selector: 0xdeb915b8
// Recipient field: args[4] — ABI string (NOT bytes32; structurally different from Wormhole/Mayan)
//
// NEAR account IDs are always lowercase in practice; the on-chain string is
// verbatim but comparison is case-insensitive. Normalization: toLowerCase().trim().
// RESEARCH §Pitfall 3.
//
// DISPLAY/ASSERT-ONLY — does NOT reconstruct or re-encode calldata.
// NEVER-throws discriminated union result (WR-02 compliance).

import { decodeFunctionData, parseAbi } from "viem";
import type { Hex } from "viem";

// ─── ABI ──────────────────────────────────────────────────────────────────────

const NEAR_INIT_TRANSFER_ABI = parseAbi([
  "function initTransfer(address tokenAddress, uint128 amount, uint128 fee, uint128 nativeFee, string recipient, string message)",
]);

// ─── Selector constants ───────────────────────────────────────────────────────

/** 4-byte selector for NEAR OmniBridge `initTransfer`. VERIFIED: viem.toFunctionSelector 2026-05-28. */
export const NEAR_SELECTORS = {
  initTransfer: "0xdeb915b8" as Hex,
} as const;

// ─── Summary interface ────────────────────────────────────────────────────────

/**
 * Decoded summary of a NEAR OmniBridge `initTransfer` call.
 * `finalRecipient` is the NEAR account ID, lowercased + trimmed — the field the
 * Layer 0.6 assertion compares against the user-supplied `toAddress`.
 * `message` is the advisory EVM-chain destination address (NOT the final recipient).
 */
export interface NearOmniBridgeSummary {
  /** NEAR account ID, lowercased and trimmed (e.g. "nearzaurora"). */
  readonly finalRecipient: string;
  /** Advisory message field (e.g. EVM address on destination — NOT the recipient). */
  readonly message: string;
}

// ─── Discriminated union result ───────────────────────────────────────────────

/**
 * NEVER-throws discriminated union result for `decodeNearOmniBridgeTransfer` (WR-02).
 */
export type DecodeNearOmniBridgeResult =
  | { kind: "ok"; summary: NearOmniBridgeSummary }
  | { kind: "error"; message: string };

// ─── Decoder ──────────────────────────────────────────────────────────────────

/**
 * Decode NEAR OmniBridge `initTransfer` calldata and extract the final recipient.
 *
 * Returns `{ kind: "ok", summary }` with the lowercased+trimmed NEAR account ID on success.
 * Returns `{ kind: "error", message }` for selector mismatch or malformed calldata.
 * NEVER throws — WR-02 compliance.
 *
 * Normalization: `String(args[4]).toLowerCase().trim()` per RESEARCH §Pitfall 3.
 * A user-supplied "NearZaurora" normalized the same way will match "nearzaurora".
 */
export function decodeNearOmniBridgeTransfer(data: Hex): DecodeNearOmniBridgeResult {
  // Selector-prefix guard — cheap short-circuit before attempting ABI decode.
  if (!data.toLowerCase().startsWith(NEAR_SELECTORS.initTransfer)) {
    return {
      kind: "error",
      message: "selector mismatch: not an initTransfer call",
    };
  }

  try {
    const decoded = _nearHelpers.decodeFunctionData(data);
    // args[4] = recipient (ABI string — NEAR account ID)
    // args[5] = message (advisory EVM destination, NOT the final recipient)
    const finalRecipient = String(decoded.args[4]).toLowerCase().trim();
    const message = String(decoded.args[5]);

    return {
      kind: "ok",
      summary: {
        finalRecipient,
        message,
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
export const _nearHelpers = {
  decodeFunctionData: (data: Hex) =>
    decodeFunctionData({ abi: NEAR_INIT_TRANSFER_ABI, data }),
};
