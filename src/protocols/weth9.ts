// Second occupant of `src/protocols/` — WETH9 protocol primitives for Phase 6
// (Plan 06-04). The combined-decode side of WETH9.withdraw already lives in
// src/protocols/erc20.ts (Plan 06-02 — the WETH9 fragment is included in
// ERC20_COMBINED_DECODE_ABI so preview_send's selector-routed decode handles
// all four ops in a single decodeFunctionData call). This module ships the
// ENCODER side so prepare_weth_unwrap can construct calldata.
//
// SDK reality (verified against viem@2.48.11):
//   - viem does NOT export a `weth9Abi` const. Research § Topic 2 names
//     `parseAbi(...)` as the canonical pattern for "I need this one method,
//     not the whole interface."
//   - `WETH9.withdraw(uint256)` selector === keccak256("withdraw(uint256)")[:4]
//     === 0x2e1a7d4d (verified via viem.toFunctionSelector).
//   - WETH9 is hard-coded to 18 decimals on every chain (the canonical
//     contract source is immutable on Ethereum mainnet) — no on-chain
//     decimals() lookup needed.
//
// The combined-ABI decode in src/protocols/erc20.ts handles the receiving
// side. This module is consumed by:
//   - src/tools/prepare_weth_unwrap.ts (Plan 06-04 — encoder + canonical
//     address re-export)
//   - src/signing/blocks.ts            (Plan 06-04 — WETH9_DECIMALS for the
//     DECODED ARGS withdraw branch's formatUnits call)

import { type Address, type Hex, encodeFunctionData, parseAbi } from "viem";

import { getWethAddress, type ChainId } from "../config/contracts.js";

/**
 * WETH9 ABI fragment. Two methods:
 *   - `withdraw(uint256)` — Phase 6 (PREP-28) consumes this for the unwrap path.
 *   - `deposit()` — NOT consumed in v1.x (wrap is a v2+ concern); included
 *     here for symmetry so a future plan that adds prepare_weth_wrap doesn't
 *     need to evolve this const.
 *
 * Format-fanout-sentinel: the only place in `src/` that imports a WETH9 ABI
 * fragment for ENCODING. The decode-side fragment is co-located in
 * src/protocols/erc20.ts (Plan 06-02) so preview_send's combined-ABI decode
 * has a single dispatch table.
 */
export const WETH9_WITHDRAW_ABI = parseAbi([
  "function withdraw(uint256 amount)",
  "function deposit() payable",
]);

/**
 * 4-byte function selector for WETH9.withdraw. Universal (canonical Solidity
 * function-signature hash) — drift here breaks every WETH unwrap flow.
 * Cross-checked in test/protocols-weth9.test.ts.
 */
export const WETH9_SELECTORS = {
  withdraw: "0x2e1a7d4d" as Hex,
} as const;

/**
 * WETH9 decimals — hard-coded to 18 across every chain (the canonical
 * contract source is immutable on Ethereum mainnet). Plan 06-04 uses this
 * directly rather than going through get_token_metadata at prepare time;
 * saves one RPC round-trip on the hot path. The registry has it too (it's in
 * the top-50), but this avoids the registry dependency for prepare_weth_unwrap
 * and gives src/signing/blocks.ts a constant the DECODED ARGS withdraw branch
 * can use without any token-context lookup.
 */
export const WETH9_DECIMALS = 18;

/**
 * Encode `WETH9.withdraw(amount)` calldata. Returns the 36-byte calldata
 * (4-byte selector + 32-byte amount). The caller MUST set `tx.to` to the
 * WETH9 contract address (use `getWethContractAddress(chainId)` or
 * `getWethAddress(chainId)` from src/config/contracts.ts).
 *
 * Encoding goes through viem's canonical `encodeFunctionData` path — NEVER
 * hand-rolled. The byte-identity invariant (Fixture F) is asserted in
 * test/protocols-weth9.test.ts and test/signing-fingerprint.test.ts.
 */
export function encodeWethWithdraw(amount: bigint): Hex {
  return encodeFunctionData({
    abi: WETH9_WITHDRAW_ABI,
    functionName: "withdraw",
    args: [amount],
  });
}

/**
 * Convenience re-export of the canonical WETH9 contract address for the given
 * chain. The SOT remains `src/config/contracts.ts`; this function delegates
 * directly so callers in `src/protocols/` and `src/tools/` can import from a
 * single locality if they're already consuming WETH9 primitives. Both import
 * paths are equally valid — the SOT is the underlying `getWethAddress`.
 */
export function getWethContractAddress(chainId: ChainId): Address {
  return getWethAddress(chainId);
}
