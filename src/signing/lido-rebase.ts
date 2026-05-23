// src/signing/lido-rebase.ts
//
// Pure-bigint rebase-reward math for Lido stETH — Phase 30 (Plan 30-02).
//
// Shared by:
//   - src/chains/lido.ts          (get_lido_positions Ethereum branch; Plan 30-02)
//   - src/tools/get_lido_positions.ts (accruedRebaseRewards surfacing; Plan 30-02)
//
// Locked on src/signing/ to keep the trust-pipeline shelf coherent (mirrors
// src/signing/aave-health.ts + src/signing/compound-health.ts shape).
//
// NO side effects. NO RPC reads. NO module-load state.
//
// Threat anchors:
//   - T-LIDO-REBASE-SNAPSHOT-STALENESS (MEDIUM): approximate accrual formula
//     uses shares-based snapshot — NOT exact transfer-history accounting.
//     The `approx: true` literal type is LOAD-BEARING: any widening to `boolean`
//     breaks the strict-TS compile, surfacing the drift before merge.
//     D-09 lock: formula = currentStethBalance - shares (bigint subtraction).
//
// Formula (D-09):
//   accruedRebaseRewards = currentStethBalance - shares
//   approx: true         (literal type — never boolean; never false)
//
// The approximation is valid because:
//   - `shares` is the rebase-invariant share count at deposit time
//   - `currentStethBalance = getPooledEthByShares(shares)` grows as Lido
//     accrues validator rewards — so the delta approximates earned stETH
//   - Full exact accounting requires transfer-history scan (deferred to v3.x)

/**
 * stETH base scale (1 stETH = 1e18 wei). Bigint literal — not Number.
 * Byte-identity with `10n ** 18n` is asserted in test/signing-lido-rebase.test.ts.
 */
export const STETH_BASE: bigint = 10n ** 18n;

/**
 * stETH token decimals. Always 18 (ERC-20 standard; Lido contract immutable).
 * Bigint to mirror the aave-health.ts constant typing (HF_SCALE is bigint).
 */
export const STETH_DECIMALS: bigint = 18n;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface LidoRebaseInput {
  /** Rebase-invariant share count from `stETH.sharesOf(wallet)`. */
  shares: bigint;
  /** Current rebase-adjusted balance from `stETH.balanceOf(wallet)`. */
  currentStethBalance: bigint;
}

export interface LidoRebaseOutput {
  /**
   * Approximate accrued rebase rewards in stETH wei.
   * Formula: currentStethBalance - shares  (D-09; bigint subtraction; no float).
   * Can be 0n when shares === currentStethBalance (fresh deposit, no accrual yet).
   * NEVER negative by invariant — Lido balances grow monotonically per share.
   */
  accruedRebaseRewards: bigint;
  /**
   * Literal `true` — ALWAYS present and ALWAYS the bare literal.
   * D-09 load-bearing: this is NOT a `boolean` field. The literal-type narrowing
   * means the strict TS compiler will reject any widening to `boolean` and any
   * attempt to assign `false`. Callers MUST surface this flag alongside the
   * rewards value so the agent cannot present the value as audited PnL.
   */
  approx: true;
}

// ---------------------------------------------------------------------------
// computeRebaseRewards
// ---------------------------------------------------------------------------

/**
 * Compute approximate accrued rebase rewards per D-09.
 *
 * Formula:
 *   accruedRebaseRewards = currentStethBalance - shares
 *
 * ALL bigint arithmetic. No `Number()` casts. No floating point.
 * Returns `{ accruedRebaseRewards, approx: true }` — `approx` is a literal
 * type (never boolean; never false) per T-LIDO-REBASE-SNAPSHOT-STALENESS.
 *
 * Degenerate-zero case: when shares === 0n and currentStethBalance === 0n,
 * returns `{ accruedRebaseRewards: 0n, approx: true }` — never throws.
 *
 * Cross-check at verify-phase: the result should approach 0 for a fresh deposit
 * (no accrual yet) and grow over time as Lido's oracle distributes validator
 * rewards by increasing the stETH total supply.
 */
export function computeRebaseRewards(input: LidoRebaseInput): LidoRebaseOutput {
  return {
    accruedRebaseRewards: input.currentStethBalance - input.shares,
    approx: true,
  };
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Production callers that
 * route through this object can be intercepted by `vi.spyOn(_lidoRebase,
 * "computeRebaseRewards")` in tests — named-export bindings are immutable in
 * ESM; a direct `vi.spyOn` on the export is a no-op for module-internal calls.
 *
 * Mirror of `_aaveChains` in src/chains/aave-v3.ts.
 */
export const _lidoRebase = { computeRebaseRewards };
