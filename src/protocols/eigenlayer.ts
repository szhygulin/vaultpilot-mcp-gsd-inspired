// EigenLayer protocol primitives for Phase 31 (Plan 31-02).
// Single-file decoder covering the EigenLayer write surface shipped in v1.x:
//   - StrategyManager.depositIntoStrategy(strategy, token, amount)
//   - StrategyManager.stakerStrategyShares(staker, strategy)      [read]
//   - StrategyBase.sharesToUnderlyingView(amountShares)            [read]
//   - StrategyBase.userUnderlyingView(user)                        [read]
//   - DelegationManager.getQueuedWithdrawals(staker)               [read]
//
// Structural analog: src/protocols/lido.ts (Phase 30) — multi-method selector
// table + parseAbi fragments + spy-affordance.
//
// Per CONTEXT.md D-01 + D-02: SEPARATE file for EigenLayer (sibling to
// src/protocols/lido.ts), NOT a widening of an existing protocol decoder.
// EigenLayer ships TWO core contracts (StrategyManager + DelegationManager)
// plus a curated 7-LST strategy registry — its own decoder surface.
//
// Per D-07: selectors are HARDCODED VERIFIED LITERALS (not computed at
// runtime). Drift in any selector cascades through the cryptographic-binding
// chain (Fixture Z in test/signing-fingerprint.test.ts fails at a specific
// line). The byte-identity regression in test/protocols-eigenlayer.test.ts
// MUST catch any drift before the selector reaches a payloadFingerprint.
//
// Function selectors VERIFIED via viem.toFunctionSelector at research time
// (31-RESEARCH § Topic 1, 2026-05-23):
//   StrategyManager.depositIntoStrategy(address,address,uint256):  0xe7a050aa
//   StrategyManager.stakerStrategyShares(address,address):         0x7a7e0d92
//   StrategyBase.sharesToUnderlyingView(uint256):                  0x7a8b2637
//   StrategyBase.userUnderlyingView(address):                      0x553ca5f8
//   DelegationManager.getQueuedWithdrawals(address):               0x5dd68579
//
// ESM spy-affordance: `_eigenLayerProtocol` wraps the encoder so tests can
// `vi.spyOn(_eigenLayerProtocol, "encodeDepositIntoStrategy")` without
// monkey-patching named exports (ESM bindings are immutable; direct spies
// are no-ops for internal calls). Per CLAUDE.md § Conventions.
//
// Consumed by:
//   - src/tools/prepare_eigenlayer_deposit.ts  (Plan 31-02 — encodeDepositIntoStrategy)
//   - src/chains/eigenlayer.ts                 (Plan 31-02 — ABI fragments)
//   - test/protocols-eigenlayer.test.ts        (byte-identity regressions)
//   - test/signing-fingerprint.test.ts         (Fixture Z)

import { type Address, type Hex, encodeFunctionData, parseAbi } from "viem";

import {
  getEigenLayerStrategyManagerAddress,
  getEigenLayerDelegationManagerAddress,
  getEigenLayerStrategyAddress,
  getEigenLayerLstTokenAddress,
  getAllEigenLayerStrategiesForChain,
  type ChainId,
  type EigenLayerLst,
} from "../config/contracts.js";

// Re-export SOT getters + EigenLayerLst type — callers inside `src/protocols/`
// and `src/tools/` can import from a single locality. The SOT remains
// `src/config/contracts.ts`; these are delegation wrappers.
export {
  getEigenLayerStrategyManagerAddress,
  getEigenLayerDelegationManagerAddress,
  getEigenLayerStrategyAddress,
  getEigenLayerLstTokenAddress,
  getAllEigenLayerStrategiesForChain,
};
export type { ChainId, EigenLayerLst };

// ---------------------------------------------------------------------------
// ABI fragments (parseAbi-typed)
// ---------------------------------------------------------------------------

/**
 * StrategyManager ABI fragments — the EigenLayer staker-side surface.
 * - `depositIntoStrategy(strategy, token, amount) → shares` — write (the only
 *   write the Phase 31 v1.x deposit flow encodes).
 * - `stakerStrategyShares(staker, strategy) → shares` — read; fans out per
 *   curated strategy in get_eigenlayer_positions.
 */
export const STRATEGY_MANAGER_ABI = parseAbi([
  "function depositIntoStrategy(address strategy, address token, uint256 amount) returns (uint256 shares)",
  "function stakerStrategyShares(address staker, address strategy) view returns (uint256)",
]);

/**
 * StrategyBase ABI fragments — the per-strategy proxy read surface.
 * - `sharesToUnderlyingView(amountShares) → uint256` — canonical shares↔
 *   underlying conversion (CALLER MUST prefer over the off-chain helper).
 * - `userUnderlyingView(user) → uint256` — convenience read; sums staker's
 *   underlying in this strategy across all share-bearing positions.
 * - `totalShares()` — used by the D-06 cap pre-flight to compare against
 *   `maxTotalDeposits()`.
 * - `underlyingToken()` — used at planner-gate to verify the SOT lstToken
 *   row matches the on-chain registry (A2 mitigation; see 31-01).
 * - `maxTotalDeposits()` — D-06 cap pre-flight target. Some strategies do
 *   NOT expose this; the prepare-tool defensively catches and treats as
 *   `MAX_UINT256` (Pitfall 6 mitigated).
 */
export const STRATEGY_BASE_ABI = parseAbi([
  "function sharesToUnderlyingView(uint256 amountShares) view returns (uint256)",
  "function userUnderlyingView(address user) view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function underlyingToken() view returns (address)",
  "function maxTotalDeposits() view returns (uint256)",
]);

/**
 * DelegationManager ABI fragments — the queued-withdrawal read surface.
 * - `getQueuedWithdrawals(staker) → (Withdrawal[], uint256[][])` — returns
 *   per-staker queued withdrawal struct array + parallel shares matrix.
 *
 * Note (RESEARCH § Topic 5 A3): the Withdrawal struct has 7 fields. If
 * governance changes the ABI, viem strict-mode decode will throw rather than
 * silently garbage — surfacing the drift. Future protocol upgrade → re-pin.
 */
export const DELEGATION_MANAGER_ABI = parseAbi([
  "struct Withdrawal { address staker; address delegatedTo; address withdrawer; uint256 nonce; uint32 startBlock; address[] strategies; uint256[] shares; }",
  "function getQueuedWithdrawals(address staker) view returns (Withdrawal[] withdrawals, uint256[][] shares)",
]);

// ---------------------------------------------------------------------------
// Selector table (HARDCODED VERIFIED LITERALS — D-07)
// ---------------------------------------------------------------------------

/**
 * 4-byte function selectors for the 5 EigenLayer functions VaultPilot calls.
 * Empirically verified via `viem.toFunctionSelector` at research time
 * (31-RESEARCH § Topic 1, 2026-05-23). Drift in any of these cascades through
 * the cryptographic-binding chain (Fixture Z in test/signing-fingerprint.test.ts
 * fails at a specific line). The byte-identity regression in
 * test/protocols-eigenlayer.test.ts MUST catch any drift before the selector
 * reaches a payloadFingerprint.
 */
export const EIGENLAYER_SELECTORS = {
  /** StrategyManager.depositIntoStrategy(address,address,uint256) — the only Phase 31 v1.x write */
  depositIntoStrategy: "0xe7a050aa" as Hex,
  /** StrategyManager.stakerStrategyShares(address,address) — per-strategy share count read */
  stakerStrategyShares: "0x7a7e0d92" as Hex,
  /** StrategyBase.sharesToUnderlyingView(uint256) — canonical shares→underlying conversion */
  sharesToUnderlyingView: "0x7a8b2637" as Hex,
  /** StrategyBase.userUnderlyingView(address) — staker-aggregated underlying read */
  userUnderlyingView: "0x553ca5f8" as Hex,
  /** DelegationManager.getQueuedWithdrawals(address) — per-staker pending-withdrawal read */
  getQueuedWithdrawals: "0x5dd68579" as Hex,
} as const;

// ---------------------------------------------------------------------------
// Encoder functions
// ---------------------------------------------------------------------------

/**
 * Encode `StrategyManager.depositIntoStrategy(strategy, token, amount)`
 * calldata. Returns 100-byte calldata (4-byte selector + 3 × 32-byte word).
 *
 * The caller MUST set `tx.valueWei = 0n` — deposit is NOT payable; the LST
 * is consumed via ERC-20 `transferFrom` (D-05 allowance pre-flight required).
 *
 * The caller MUST resolve `strategy` and `token` from the curated registry
 * (Pitfall 3 mitigated — server-resolved per LST symbol, never agent-passed).
 *
 * Fixture Z anchor: see test/signing-fingerprint.test.ts for the byte-identity
 * regression on the resulting payloadFingerprint for the stETH-strategy /
 * 1e18-amount canonical input.
 */
export function encodeDepositIntoStrategy(
  strategy: Address,
  lstToken: Address,
  amountWei: bigint,
): Hex {
  return encodeFunctionData({
    abi: STRATEGY_MANAGER_ABI,
    functionName: "depositIntoStrategy",
    args: [strategy, lstToken, amountWei],
  });
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Production callers that
 * route through this object can be intercepted by
 * `vi.spyOn(_eigenLayerProtocol, "encodeDepositIntoStrategy")` in tests —
 * named-export bindings are immutable in ESM; a direct `vi.spyOn` on the
 * export is a no-op for module-internal calls.
 *
 * Mirror of `_lidoProtocol` in src/protocols/lido.ts.
 */
export const _eigenLayerProtocol = {
  encodeDepositIntoStrategy,
};
