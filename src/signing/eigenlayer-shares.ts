// src/signing/eigenlayer-shares.ts
//
// Pure-bigint EigenLayer shares↔underlying math — Phase 31 (Plan 31-02).
//
// Shared by:
//   - src/chains/eigenlayer.ts (best-effort ethEquivalent math; Plan 31-02)
//   - test/signing-eigenlayer-shares.test.ts (deterministic anchors)
//
// Locked on src/signing/ to keep the trust-pipeline shelf coherent (mirrors
// src/signing/lido-rebase.ts shape).
//
// NO side effects. NO RPC reads. NO module-load state. All bigint arithmetic;
// no Number() casts; no floating point.
//
// Threat anchors:
//   - T-EIGENLAYER-SHARES-STALENESS: the off-chain helper is APPROXIMATE — it
//     only produces a canonical conversion when the caller supplies a
//     `underlyingPerShareNumerator` derived from a recent on-chain read.
//     Callers SHOULD prefer on-chain `StrategyBase.sharesToUnderlyingView` for
//     the canonical value. The `approx: true` literal type is LOAD-BEARING:
//     any widening to `boolean` breaks the strict-TS compile, surfacing the
//     drift before merge. Identical pattern to `LidoRebaseOutput.approx`.
//
// Formula:
//   underlyingAmount = (shares * underlyingPerShareNumerator) / SHARES_SCALE
//   approx: true     (literal type — never boolean; never false)
//
// When `underlyingPerShareNumerator` is omitted (e.g. as a degenerate baseline
// for 1:1-share LSTs or zero balances), the helper returns `shares` verbatim.
// The on-chain `sharesToUnderlyingView` remains the load-bearing canonical
// answer; this helper exists for future ergonomics (e.g. quick UI math on a
// cached rate) and is exercised only in test-suite anchors today.

/**
 * Bigint scale for share→underlying conversion (1e18). Bigint literal — not
 * Number. Byte-identity with `10n ** 18n` is asserted in
 * test/signing-eigenlayer-shares.test.ts.
 */
export const SHARES_SCALE: bigint = 10n ** 18n;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface EigenLayerSharesInput {
  /** Per-strategy share count from `StrategyManager.stakerStrategyShares`. */
  shares: bigint;
  /**
   * Optional 1e18-scaled numerator representing `underlyingPerShare`. When
   * omitted, the helper returns `shares` verbatim (1:1 baseline). Callers
   * SHOULD derive this from an on-chain `sharesToUnderlyingView(SHARES_SCALE)`
   * snapshot for non-1:1 strategies; absent that, on-chain
   * `sharesToUnderlyingView(shares)` is preferable.
   */
  underlyingPerShareNumerator?: bigint;
}

export interface EigenLayerSharesOutput {
  /**
   * Approximate underlying amount in token wei.
   * Formula: `(shares * underlyingPerShareNumerator) / SHARES_SCALE`
   * (bigint arithmetic; integer-division truncates toward zero).
   * When `underlyingPerShareNumerator` is omitted, returns `shares` verbatim.
   * Can be 0n when shares === 0n (degenerate-zero case — never throws).
   */
  underlyingAmount: bigint;
  /**
   * Literal `true` — ALWAYS present and ALWAYS the bare literal.
   * T-EIGENLAYER-SHARES-STALENESS load-bearing: this is NOT a `boolean`
   * field. The literal-type narrowing means the strict TS compiler will
   * reject any widening to `boolean` and any attempt to assign `false`.
   * Callers MUST surface this flag alongside the underlying value so the
   * agent cannot present the value as canonical / audited.
   */
  approx: true;
}

// ---------------------------------------------------------------------------
// convertSharesToUnderlying
// ---------------------------------------------------------------------------

/**
 * Convert shares to approximate underlying token wei.
 *
 * Formula:
 *   when underlyingPerShareNumerator supplied:
 *     underlyingAmount = (shares * underlyingPerShareNumerator) / SHARES_SCALE
 *   when omitted:
 *     underlyingAmount = shares
 *
 * ALL bigint arithmetic. No `Number()` casts. No floating point.
 * Returns `{ underlyingAmount, approx: true }` — `approx` is a literal type
 * (never boolean; never false) per T-EIGENLAYER-SHARES-STALENESS.
 *
 * Degenerate-zero case: when shares === 0n, returns
 * `{ underlyingAmount: 0n, approx: true }` — never throws.
 *
 * Cross-check at verify-phase: callers SHOULD prefer the on-chain
 * `StrategyBase.sharesToUnderlyingView` over this helper for any UI surface
 * that displays the canonical value.
 */
export function convertSharesToUnderlying(
  input: EigenLayerSharesInput,
): EigenLayerSharesOutput {
  const underlyingAmount =
    input.underlyingPerShareNumerator !== undefined
      ? (input.shares * input.underlyingPerShareNumerator) / SHARES_SCALE
      : input.shares;
  return {
    underlyingAmount,
    approx: true,
  };
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Tests can
 * `vi.spyOn(_eigenLayerShares, "convertSharesToUnderlying")` to intercept
 * without monkey-patching named exports (ESM bindings are immutable; direct
 * spies are no-ops for module-internal calls). Mirror of `_lidoRebase` in
 * src/signing/lido-rebase.ts.
 */
export const _eigenLayerShares = { convertSharesToUnderlying };
