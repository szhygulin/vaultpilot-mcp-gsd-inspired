// src/protocols/bridge-decoders/mayan-swift.ts — Phase 39 Plan 39-02 (BRIDGE-T1-02).
//
// Mayan Swift `createOrderWithEth` + `createOrderWithToken` calldata decoder.
// Extracts `destAddr` (bytes32) from the `OrderParams` struct and normalizes it
// encoding-aware (EVM vs Solana) for the Inv #6b final-recipient assertion.
//
// Contract: 0xC38e4e6A15593f908255214653d3D947CA1c2338 (Ethereum mainnet + EVM chains)
// Functions:
//   createOrderWithEth(OrderParams) — native ETH input; selector 0xb866e173
//   createOrderWithToken(address,uint256,OrderParams) — ERC-20 input; selector 0x8e8d142b
// OrderParams tuple: (bytes32,bytes32,uint64,uint64,uint64,uint64,uint64,bytes32,uint16,bytes32,uint8,uint8,bytes32)
//   destAddr  = tuple[7] (bytes32) — THE FIELD TO EXTRACT
//   destChainId = tuple[8] (uint16) — determines EVM vs Solana path (structural test)
//
// CRITICAL: Two-selector decode (RESEARCH §Pitfall 6):
//   createOrderWithEth:   OrderParams is args[0]; destAddr = args[0][7]
//   createOrderWithToken: OrderParams is args[2]; destAddr = args[2][7]
//   Extracting from the wrong index yields garbage — both selectors are tested.
//
// ENCODING-AWARE NORMALIZATION (T-39-02-SOLANA-NORM):
//   Structural test on destAddr bytes32 (RESEARCH §Open Q1 resolved):
//   - Leading 12 bytes all zero (EVM-padded address): getAddress(last-20-bytes)
//   - Otherwise (non-zero leading bytes = Solana pubkey): bs58.encode(full 32 bytes)
//   NEVER truncate bytes32 for Solana. NEVER toLowerCase. base58 is CASE-SENSITIVE.
//
// DISPLAY/ASSERT-ONLY — does NOT reconstruct or re-encode calldata.
// NEVER-throws discriminated union result (WR-02 compliance).

import bs58 from "bs58";
import { decodeFunctionData, getAddress, parseAbi } from "viem";
import type { Hex } from "viem";

// ─── ABI ──────────────────────────────────────────────────────────────────────

const MAYAN_ORDER_PARAMS_TUPLE =
  "(bytes32,bytes32,uint64,uint64,uint64,uint64,uint64,bytes32,uint16,bytes32,uint8,uint8,bytes32)";

const MAYAN_ETH_ABI = parseAbi([
  `function createOrderWithEth(${MAYAN_ORDER_PARAMS_TUPLE} params)`,
]);

const MAYAN_TOKEN_ABI = parseAbi([
  `function createOrderWithToken(address tokenIn, uint256 amountIn, ${MAYAN_ORDER_PARAMS_TUPLE} params)`,
]);

// ─── Selector constants ───────────────────────────────────────────────────────

/** 4-byte selectors for Mayan Swift order functions. VERIFIED: viem.toFunctionSelector 2026-05-28. */
export const MAYAN_SWIFT_SELECTORS = {
  createOrderWithEth: "0xb866e173" as Hex,
  createOrderWithToken: "0x8e8d142b" as Hex,
} as const;

// ─── Summary interface ────────────────────────────────────────────────────────

/**
 * Decoded summary of a Mayan Swift `createOrderWithEth` or `createOrderWithToken` call.
 * `finalRecipient` is the ALREADY-NORMALIZED recipient:
 *   - EVM dest: EIP-55 checksummed address (from last-20-bytes of bytes32)
 *   - Solana dest: base58-encoded full 32-byte pubkey (CASE-SENSITIVE)
 */
export interface MayanSwiftSummary {
  /** Normalized recipient: EIP-55 address (EVM) or base58 pubkey (Solana). */
  readonly finalRecipient: string;
  /** Mayan destChainId from OrderParams tuple[8]. */
  readonly destChainId: number;
  /** Destination type — determines normalization applied. */
  readonly destinationType: "evm" | "solana";
}

// ─── Discriminated union result ───────────────────────────────────────────────

/**
 * NEVER-throws discriminated union result for `decodeMayanSwiftOrder` (WR-02).
 */
export type DecodeMayanSwiftResult =
  | { kind: "ok"; summary: MayanSwiftSummary }
  | { kind: "error"; message: string };

// ─── Decoder ──────────────────────────────────────────────────────────────────

/**
 * Decode Mayan Swift `createOrderWithEth` or `createOrderWithToken` calldata
 * and extract the final recipient, encoding-aware (EVM vs Solana destination).
 *
 * Returns `{ kind: "ok", summary }` on success.
 * Returns `{ kind: "error", message }` for selector mismatch or malformed calldata.
 * NEVER throws — WR-02 compliance.
 *
 * Pitfall 6: createOrderWithEth → OrderParams at args[0]; createOrderWithToken → args[2].
 * Pitfall SOLANA-NORM: Solana destAddr bytes32 has non-zero leading bytes → bs58 full 32 bytes.
 *   NEVER truncate. NEVER toLowerCase. base58 is CASE-SENSITIVE.
 */
export function decodeMayanSwiftOrder(data: Hex): DecodeMayanSwiftResult {
  const lower = data.toLowerCase();
  const isEth = lower.startsWith(MAYAN_SWIFT_SELECTORS.createOrderWithEth);
  const isToken = lower.startsWith(MAYAN_SWIFT_SELECTORS.createOrderWithToken);

  if (!isEth && !isToken) {
    return {
      kind: "error",
      message: "selector mismatch: not a Mayan createOrderWithEth or createOrderWithToken call",
    };
  }

  try {
    let orderParams: readonly unknown[];

    if (isEth) {
      // createOrderWithEth(OrderParams params) — tuple is args[0]
      const decoded = _mayanSwiftHelpers.decodeWithEth(data);
      orderParams = decoded.args[0] as readonly unknown[];
    } else {
      // createOrderWithToken(address,uint256,OrderParams params) — tuple is args[2]
      const decoded = _mayanSwiftHelpers.decodeWithToken(data);
      orderParams = decoded.args[2] as readonly unknown[];
    }

    // destAddr = tuple[7] (bytes32); destChainId = tuple[8] (uint16)
    const destAddr = orderParams[7] as `0x${string}`;
    const destChainId = Number(orderParams[8]);

    // Structural normalization: check if leading 12 bytes are all zero (EVM-padded address).
    // RESEARCH §Open Q1 resolved: use structural test instead of chain-id-scheme dependence.
    const hexBody = destAddr.slice(2); // 64 hex chars = 32 bytes
    const leading24Hex = hexBody.slice(0, 24); // 24 hex chars = 12 bytes
    const isEvmPadded = /^0{24}$/.test(leading24Hex);

    if (isEvmPadded) {
      // EVM destination: extract last 20 bytes, normalize via getAddress() (EIP-55).
      const last20Hex = hexBody.slice(-40); // 40 hex chars = 20 bytes
      const finalRecipient = getAddress(`0x${last20Hex}`);
      return {
        kind: "ok",
        summary: { finalRecipient, destChainId, destinationType: "evm" },
      };
    } else {
      // Non-EVM destination (Solana pubkey): bs58-encode the FULL 32 bytes.
      // NEVER truncate. NEVER toLowerCase. base58 is CASE-SENSITIVE.
      const buf = Buffer.from(hexBody, "hex");
      const finalRecipient = bs58.encode(buf);
      return {
        kind: "ok",
        summary: { finalRecipient, destChainId, destinationType: "solana" },
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
 * Two decode paths — one per selector — for testability.
 */
export const _mayanSwiftHelpers = {
  decodeWithEth: (data: Hex) =>
    decodeFunctionData({ abi: MAYAN_ETH_ABI, data }),
  decodeWithToken: (data: Hex) =>
    decodeFunctionData({ abi: MAYAN_TOKEN_ABI, data }),
};
