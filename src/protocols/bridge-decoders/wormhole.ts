// src/protocols/bridge-decoders/wormhole.ts — Phase 39 Plan 39-02 (BRIDGE-T1-01).
//
// Wormhole Token Bridge `transferTokensWithPayload` calldata decoder.
// Extracts the `recipient` (bytes32) field and normalizes it to the
// destination-chain recipient address for the Inv #6b final-recipient assertion.
//
// Contract: 0x3ee18B2214AFF97000D974cf647E7C347E8fa585 (Ethereum mainnet proxy)
// Function: transferTokensWithPayload(address,uint256,uint16,bytes32,uint32,bytes)
// Selector: 0xc5a5ebda
// Recipient field: args[3] (bytes32); recipientChain: args[2] (uint16)
//
// ENCODING-AWARE NORMALIZATION (T-39-02-SOLANA-NORM critical correctness):
//   - recipientChain ∈ EVM set {2,4,5,6,16,23,24,30}:
//       last-20-bytes of bytes32 → getAddress() (EIP-55)
//   - recipientChain === 1 (Solana):
//       bs58.encode over the FULL 32 bytes (NEVER truncate; NEVER toLowerCase;
//       base58 is CASE-SENSITIVE)
//   - other chains → { kind: "error", message: "unsupported destination chain..." }
//
// DISPLAY/ASSERT-ONLY — does NOT reconstruct or re-encode calldata.
// NEVER-throws discriminated union result (WR-02 compliance).

import bs58 from "bs58";
import { decodeFunctionData, getAddress, parseAbi } from "viem";
import type { Hex } from "viem";

// ─── ABI ──────────────────────────────────────────────────────────────────────

const WORMHOLE_TRANSFER_ABI = parseAbi([
  "function transferTokensWithPayload(address token, uint256 amount, uint16 recipientChain, bytes32 recipient, uint32 nonce, bytes payload)",
]);

// ─── Selector constants ───────────────────────────────────────────────────────

/** 4-byte selector for Wormhole Token Bridge `transferTokensWithPayload`. VERIFIED: viem.toFunctionSelector 2026-05-28. */
export const WORMHOLE_SELECTORS = {
  transferTokensWithPayload: "0xc5a5ebda" as Hex,
} as const;

// ─── Wormhole chain ID sets ───────────────────────────────────────────────────

/** Wormhole chain IDs for EVM-compatible destination chains (RESEARCH §Pitfall 1). */
const WORMHOLE_EVM_CHAIN_IDS = new Set([2, 4, 5, 6, 16, 23, 24, 30]);

/** Wormhole chain ID 1 = Solana. */
const WORMHOLE_SOLANA_CHAIN_ID = 1;

// ─── Summary interface ────────────────────────────────────────────────────────

/**
 * Decoded summary of a Wormhole `transferTokensWithPayload` call.
 * `finalRecipient` is the ALREADY-NORMALIZED recipient:
 *   - EVM dest: EIP-55 checksummed address (from last-20-bytes of bytes32)
 *   - Solana dest: base58-encoded full 32-byte pubkey (CASE-SENSITIVE)
 */
export interface WormholeSummary {
  /** Normalized recipient: EIP-55 address (EVM) or base58 pubkey (Solana). */
  readonly finalRecipient: string;
  /** Wormhole destination chain ID (e.g. 1=Solana, 16=Moonbeam). */
  readonly recipientChain: number;
  /** Destination type — determines normalization applied. */
  readonly destinationType: "evm" | "solana";
}

// ─── Discriminated union result ───────────────────────────────────────────────

/**
 * NEVER-throws discriminated union result for `decodeWormholeTransferWithPayload` (WR-02).
 */
export type DecodeWormholeResult =
  | { kind: "ok"; summary: WormholeSummary }
  | { kind: "error"; message: string };

// ─── Decoder ──────────────────────────────────────────────────────────────────

/**
 * Decode Wormhole Token Bridge `transferTokensWithPayload` calldata and extract
 * the final recipient, encoding-aware (EVM vs Solana destination).
 *
 * Returns `{ kind: "ok", summary }` on success.
 * Returns `{ kind: "error", message }` for selector mismatch, malformed calldata,
 * or unsupported destination chain.
 * NEVER throws — WR-02 compliance.
 *
 * CRITICAL: Solana base58 is CASE-SENSITIVE. NEVER truncate bytes32 for Solana
 * destinations — the full 32 bytes are the pubkey. NEVER toLowerCase. (T-39-02-SOLANA-NORM)
 */
export function decodeWormholeTransferWithPayload(data: Hex): DecodeWormholeResult {
  // Selector-prefix guard — cheap short-circuit before attempting ABI decode.
  if (!data.toLowerCase().startsWith(WORMHOLE_SELECTORS.transferTokensWithPayload)) {
    return {
      kind: "error",
      message: "selector mismatch: not a transferTokensWithPayload call",
    };
  }

  try {
    const decoded = _wormholeHelpers.decodeFunctionData(data);
    // args[2] = recipientChain (uint16); args[3] = recipient (bytes32)
    const recipientChain = Number(decoded.args[2]);
    const recipientBytes32 = decoded.args[3] as `0x${string}`;

    if (recipientChain === WORMHOLE_SOLANA_CHAIN_ID) {
      // Solana destination: bs58-encode the FULL 32 bytes.
      // NEVER truncate to last-20-bytes. NEVER toLowerCase. base58 is case-sensitive.
      const hexStr = recipientBytes32.slice(2); // remove "0x"
      const buf = Buffer.from(hexStr, "hex");
      const finalRecipient = bs58.encode(buf);
      return {
        kind: "ok",
        summary: { finalRecipient, recipientChain, destinationType: "solana" },
      };
    } else if (WORMHOLE_EVM_CHAIN_IDS.has(recipientChain)) {
      // EVM destination: extract last 20 bytes, normalize via getAddress() (EIP-55).
      const last20Hex = recipientBytes32.slice(2).slice(-40); // 40 hex chars = 20 bytes
      const finalRecipient = getAddress(`0x${last20Hex}`);
      return {
        kind: "ok",
        summary: { finalRecipient, recipientChain, destinationType: "evm" },
      };
    } else {
      // Unsupported destination chain (Terra/NEAR/Cosmos/etc.) — no normalization defined.
      return {
        kind: "error",
        message: `unsupported destination chain for recipient normalization (chain ${recipientChain})`,
      };
    }
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
export const _wormholeHelpers = {
  decodeFunctionData: (data: Hex) =>
    decodeFunctionData({ abi: WORMHOLE_TRANSFER_ABI, data }),
};
