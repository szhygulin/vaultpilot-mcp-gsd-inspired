// src/signing/rocketpool-rate.ts
//
// Pure-bigint rETH ↔ ETH exchange-rate math — Phase 31 Plan 31-03 (RP-01).
//
// Shared by:
//   - src/chains/rocketpool.ts            (readEthereumPositions; Plan 31-03)
//   - src/tools/get_rocketpool_positions.ts (ethEquivalent surfacing; Plan 31-03)
//
// Locked on src/signing/ to keep the trust-pipeline shelf coherent (mirrors
// src/signing/eigenlayer-shares.ts + src/signing/lido-rebase.ts shape).
//
// NO side effects. NO RPC reads. NO module-load state.
//
// Contrast with src/signing/lido-rebase.ts:
//   - Lido stETH is a REBASE-bearing token; the "accrued rewards" figure is
//     an APPROXIMATION (shares-based snapshot), surfaced via the load-bearing
//     `approx: true` literal type. T-LIDO-REBASE-SNAPSHOT-STALENESS.
//   - Rocket Pool rETH is a NON-rebasing receipt token. The exchange rate
//     returned by `rETH.getExchangeRate()` is the canonical contract-level
//     conversion rate at the read block — exact, not an approximation. The
//     ETH equivalent of an rETH balance is `(balance * rate) / 1e18` and is
//     authoritative for the read block. NO `approx` flag in the output.
//
// Threat anchors:
//   - T-ROCKETPOOL-RATE-PURE-MATH: this module is pure-bigint by construction.
//     Any introduction of Number() casts or floating-point arithmetic produces
//     decimal-precision drift and is a regression.

/**
 * rETH base scale (1 rETH = 1e18 wei). Bigint literal — not Number.
 * Byte-identity with `10n ** 18n` is asserted in test/signing-rocketpool-rate.test.ts.
 */
export const RETH_SCALE: bigint = 10n ** 18n;

/**
 * rETH token decimals. Always 18 (ERC-20 standard; RocketTokenRETH immutable).
 * Bigint to mirror the eigenlayer-shares.ts + lido-rebase.ts constant typing.
 */
export const RETH_DECIMALS: bigint = 18n;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface RocketPoolRateInput {
  /** rETH balance from `rETH.balanceOf(wallet)` (in 1e18-scaled wei). */
  rethBalance: bigint;
  /** 1e18-scaled rETH→ETH rate from `rETH.getExchangeRate()`. */
  exchangeRate: bigint;
}

export interface RocketPoolRateOutput {
  /**
   * ETH equivalent of the rETH balance at the read block, in wei.
   * Formula: (rethBalance * exchangeRate) / 1e18  — all bigint; no float.
   * Exact for the read block (rETH is non-rebasing — no `approx` flag).
   */
  ethEquivalent: bigint;
}

// ---------------------------------------------------------------------------
// computeEthEquivalent
// ---------------------------------------------------------------------------

/**
 * Compute the ETH equivalent of a rETH balance at a given exchange rate.
 *
 * Formula:
 *   ethEquivalent = (rethBalance * exchangeRate) / RETH_SCALE
 *
 * ALL bigint arithmetic. No `Number()` casts. No floating point.
 *
 * Degenerate-zero case: when rethBalance === 0n OR exchangeRate === 0n,
 * returns `{ ethEquivalent: 0n }` — never throws.
 *
 * Result is EXACT for the read block (rETH is non-rebasing). Contrast with
 * Lido's `computeRebaseRewards`, which carries a load-bearing `approx: true`
 * literal because the rebase model produces an APPROXIMATE figure.
 */
export function computeEthEquivalent(input: RocketPoolRateInput): RocketPoolRateOutput {
  return {
    ethEquivalent: (input.rethBalance * input.exchangeRate) / RETH_SCALE,
  };
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Production callers that
 * route through this object can be intercepted by
 * `vi.spyOn(_rocketPoolRate, "computeEthEquivalent")` in tests —
 * named-export bindings are immutable in ESM; a direct `vi.spyOn` on the
 * export is a no-op for module-internal calls.
 *
 * Mirror of `_lidoRebase` in src/signing/lido-rebase.ts and
 * `_eigenLayerShares` in src/signing/eigenlayer-shares.ts.
 */
export const _rocketPoolRate = { computeEthEquivalent };
