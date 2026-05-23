// Lido protocol primitives for Phase 30 (Plan 30-01).
// Single-file decoder covering all 4 Lido write contracts:
//   - stETH (Lido proxy)         — `submit(address referral)` payable
//   - WithdrawalQueueERC721      — `requestWithdrawals(uint256[], address)`
//   - wstETH                     — `wrap(uint256)` + `unwrap(uint256)`
//
// Structural merge of:
//   - src/protocols/weth9.ts     (single-method ABI + selector + encoder shape)
//   - src/protocols/aave-v3.ts   (multi-method selector-table shape)
//
// Per D-02 (CONTEXT.md): single file for all 4 contracts — Lido is one
// protocol with bound contracts. Per D-07: selectors are HARDCODED VERIFIED
// LITERALS (not computed at runtime) — any drift breaks the cryptographic-
// binding chain and is caught by test/protocols-lido.test.ts.
//
// Function selectors VERIFIED via viem.toFunctionSelector at research time
// (research § Topic 1, date 2026-05-23):
//   Lido.submit(address):                            0xa1903eab
//   WithdrawalQueue.requestWithdrawals(uint256[],address): 0xd6681042
//   WstETH.wrap(uint256):                            0xea598cb0
//   WstETH.unwrap(uint256):                          0xde0e9a3e
//
// Format-fanout-sentinel: the ONLY place in `src/` that imports Lido ABI
// fragments for ENCODING. `preview_send.ts` decoding will also route through
// these exports (Plan 30-03). NEVER inline parseAbi or selectors outside.
//
// ESM spy-affordance: `_lidoProtocol` wraps all encoder functions so tests
// can `vi.spyOn(_lidoProtocol, "encodeLidoSubmit")` without monkey-patching
// named exports (ESM bindings are immutable; direct spies are no-ops for
// internal calls). Per CLAUDE.md § Conventions.
//
// Consumed by:
//   - src/tools/prepare_lido_stake.ts   (Plan 30-03 — encodeLidoSubmit)
//   - src/tools/prepare_lido_unstake.ts (Plan 30-03 — encodeRequestWithdrawals)
//   - src/tools/prepare_lido_wrap.ts    (Plan 30-03 — encodeWstethWrap)
//   - src/tools/prepare_lido_unwrap.ts  (Plan 30-03 — encodeWstethUnwrap)
//   - test/protocols-lido.test.ts       (byte-identity regressions)
//   - test/signing-fingerprint.test.ts  (Fixtures V/W/X/Y)

import { type Address, type Hex, encodeFunctionData, parseAbi } from "viem";

import {
  getLidoStethAddress,
  getLidoWstethAddress,
  getLidoWithdrawalQueueAddress,
  type ChainId,
} from "../config/contracts.js";

// Re-export SOT getters — callers inside `src/protocols/` and `src/tools/`
// can import from a single locality if already consuming Lido primitives.
// The SOT remains `src/config/contracts.ts`; these are delegation wrappers.
export { getLidoStethAddress, getLidoWstethAddress, getLidoWithdrawalQueueAddress };

// ---------------------------------------------------------------------------
// Token decimal constants
// ---------------------------------------------------------------------------

/** stETH decimals — always 18 (ERC-20 standard; Lido contract immutable). */
export const STETH_DECIMALS = 18;

/** wstETH decimals — always 18 (WstETH contract immutable). */
export const WSTETH_DECIMALS = 18;

// ---------------------------------------------------------------------------
// ABI fragments
// ---------------------------------------------------------------------------

/**
 * Lido stETH `submit` ABI fragment. Payable; ETH amount goes in `msg.value`.
 * Calldata carries ONLY the 4-byte selector + 32-byte referral address.
 * Phase 30 hardcodes referral = address(0) per D-07 (Pitfall 7 mitigated).
 */
export const LIDO_STETH_SUBMIT_ABI = parseAbi([
  "function submit(address _referral) payable returns (uint256)",
]);

/**
 * WithdrawalQueueERC721 `requestWithdrawals` ABI fragment. Accepts an
 * ARRAY of amounts — Phase 30 ships single-element array only (D-06).
 * Selector: 0xd6681042 (verified via viem.toFunctionSelector at research time).
 */
export const WQ_REQUEST_ABI = parseAbi([
  "function requestWithdrawals(uint256[] calldata _amounts, address _owner) returns (uint256[] requestIds)",
]);

/**
 * wstETH `wrap` ABI fragment. Converts stETH → wstETH (rebase-resistant).
 * Selector: 0xea598cb0 (verified — D-07 placeholder CONFIRMED CORRECT).
 */
export const WSTETH_WRAP_ABI = parseAbi([
  "function wrap(uint256 _stETHAmount) returns (uint256)",
]);

/**
 * wstETH `unwrap` ABI fragment. Converts wstETH → stETH (rebase-bearing).
 * Selector: 0xde0e9a3e (verified — D-07 placeholder CONFIRMED CORRECT).
 */
export const WSTETH_UNWRAP_ABI = parseAbi([
  "function unwrap(uint256 _wstETHAmount) returns (uint256)",
]);

// ---------------------------------------------------------------------------
// Selector table (HARDCODED VERIFIED LITERALS — D-07)
// ---------------------------------------------------------------------------

/**
 * 4-byte function selectors for all 4 Lido write functions. Empirically
 * verified via `viem.toFunctionSelector` at research time (research § Topic 1,
 * 2026-05-23). Drift in any of these cascades through the cryptographic-binding
 * chain (Fixtures V/W/X/Y in test/signing-fingerprint.test.ts fail at a
 * specific line). The byte-identity regression in test/protocols-lido.test.ts
 * MUST catch any drift before the selector reaches a payloadFingerprint.
 */
export const LIDO_SELECTORS = {
  /** Lido.submit(address _referral)  — stake ETH payable call */
  submit: "0xa1903eab" as Hex,
  /** WithdrawalQueue.requestWithdrawals(uint256[] calldata _amounts, address _owner) */
  requestWithdrawals: "0xd6681042" as Hex,
  /** WstETH.wrap(uint256 _stETHAmount)   — stETH → wstETH */
  wrap: "0xea598cb0" as Hex,
  /** WstETH.unwrap(uint256 _wstETHAmount) — wstETH → stETH */
  unwrap: "0xde0e9a3e" as Hex,
} as const;

// ---------------------------------------------------------------------------
// Encoder functions
// ---------------------------------------------------------------------------

/**
 * Encode `Lido.submit(referral)` calldata. Returns 36-byte calldata
 * (4-byte selector + 32-byte referral address). The caller MUST set
 * `tx.value` to the ETH stake amount — `submit` is payable; the ETH
 * amount is in `msg.value`, NOT calldata (Pitfall 7 mitigated).
 *
 * Phase 30 always passes `referral = address(0)` per D-07 (no third-party
 * referral payouts in scope). Plan 30-03 tool signature mirrors this.
 */
export function encodeLidoSubmit(referral: Address): Hex {
  return encodeFunctionData({
    abi: LIDO_STETH_SUBMIT_ABI,
    functionName: "submit",
    args: [referral],
  });
}

/**
 * Encode `WithdrawalQueueERC721.requestWithdrawals([stethAmountWei], owner)`
 * calldata. Produces 100-byte calldata (4-byte selector + 32-byte offset +
 * 32-byte array length=1 + 32-byte element + 32-byte owner address).
 *
 * CRITICAL — D-06 / Pitfall 1: the amounts param is `uint256[] calldata`,
 * so the ABI encoding is a dynamic array. For a single withdrawal, the
 * outer `[stethAmountWei]` wraps the single element — passing a raw bigint
 * instead of `[bigint]` produces an ABI encoding error or incorrect calldata.
 * This is the canonical single-element array encoding: always wrap in an
 * outer array even for single-amount requests.
 *
 * The caller SHOULD pre-validate `100n <= stethAmountWei <= 1_000n * 10n**18n`
 * (Pitfall 6 bounds) — this encoder does not validate.
 */
export function encodeRequestWithdrawals(stethAmountWei: bigint, owner: Address): Hex {
  return encodeFunctionData({
    abi: WQ_REQUEST_ABI,
    functionName: "requestWithdrawals",
    args: [[stethAmountWei], owner],  // outer [] = single-element array per D-06
  });
}

/**
 * Encode `WstETH.wrap(stethAmount)` calldata. Returns 36-byte calldata
 * (4-byte selector + 32-byte amount). The caller MUST set `tx.value = 0n`
 * (wrap is NOT payable; stETH is consumed as an ERC-20 transfer, not ETH).
 *
 * The caller MUST ensure stETH allowance >= stethAmount for the wstETH
 * contract as spender (D-05 pre-flight in Plan 30-03 prepare_lido_wrap).
 */
export function encodeWstethWrap(stethAmount: bigint): Hex {
  return encodeFunctionData({
    abi: WSTETH_WRAP_ABI,
    functionName: "wrap",
    args: [stethAmount],
  });
}

/**
 * Encode `WstETH.unwrap(wstethAmount)` calldata. Returns 36-byte calldata
 * (4-byte selector + 32-byte amount). The caller MUST set `tx.value = 0n`
 * (unwrap is NOT payable). No approval needed — wstETH is the user's own
 * token burned directly by the contract.
 */
export function encodeWstethUnwrap(wstethAmount: bigint): Hex {
  return encodeFunctionData({
    abi: WSTETH_UNWRAP_ABI,
    functionName: "unwrap",
    args: [wstethAmount],
  });
}

// Convenience re-export of the ChainId type so callers that import from
// src/protocols/lido.ts don't need a second import from src/config/contracts.ts.
export type { ChainId };

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Production callers that
 * route through this object can be intercepted by `vi.spyOn(_lidoProtocol,
 * "encodeLidoSubmit")` in tests — named-export bindings are immutable in ESM;
 * a direct `vi.spyOn` on the export is a no-op for module-internal calls.
 *
 * Mirror of `_aaveProtocols` in src/protocols/aave-v3.ts.
 */
export const _lidoProtocol = {
  encodeLidoSubmit,
  encodeRequestWithdrawals,
  encodeWstethWrap,
  encodeWstethUnwrap,
};
