// src/signing/compound-collateralization.ts
//
// Pure-bigint Compound V3 collateralization math per research § Topic 5 +
// patterns § 2. Structural mirror of `src/signing/aave-health.ts`:
//   - All bigint arithmetic; no `Number` casts.
//   - No side effects, no RPC, no module-load state.
//   - 4-arm `LiquidationRisk` classifier — REUSED from `aave-health.ts` (same
//     thresholds: >= 1.50 safe, 1.10-1.50 warning, < 1.10 danger).
//
// Compound vs Aave semantic delta:
//   - Aave returns a single `healthFactor` (scaled 1e18). Compound exposes TWO
//     canonical booleans (`isBorrowCollateralized` + `isLiquidatable`) — the
//     on-chain SOT — plus a derived `liquidationCollateralRatio`. The reader
//     computes both; if they ever disagree (off-chain Chainlink price drift
//     vs on-chain bool freshness), the bools win.
//
// Cryptographic-binding chain UNAFFECTED — pure math, no preimage bytes here.
//
// Threat anchors:
//   - T-COMPOUND-RATIO-DRIFT-1 (HIGH): PRICE_FEED_SCALE / COLLATERAL_FACTOR_SCALE
//     / RATIO_SCALE drift cascades through every Compound projection. Constants
//     are byte-identical to research § Topic 5 literals; test/signing-compound-
//     collateralization.test.ts asserts all three.
//   - T-COMPOUND-CROSS-CHECK-1 (MEDIUM): the derived ratio MAY diverge from the
//     on-chain bools when off-chain price feed staleness lags the on-chain
//     Chainlink read by a block. Consumers (`get_lending_positions`) surface
//     BOTH bools AND ratio; on disagreement, bool is the trust anchor.

import {
  classifyLiquidationRisk,
  type LiquidationRisk,
} from "./aave-health.js";

/**
 * Compound V3 price-feed scale. `Comet.getPrice(feed)` returns a uint128 with
 * 8 decimals (Chainlink-compatible). Research § Topic 5 line 198.
 */
export const PRICE_FEED_SCALE: bigint = 10n ** 8n;

/**
 * Compound V3 collateral-factor scale. `borrowCollateralFactor` /
 * `liquidateCollateralFactor` / `liquidationFactor` are 18-decimal scaled
 * (`1e18` = 100%). Research § Topic 5 line 200.
 */
export const COLLATERAL_FACTOR_SCALE: bigint = 10n ** 18n;

/**
 * Derived collateralization-ratio scale. Mirrors Aave's `HF_SCALE` (1e18) so
 * the agent-facing surface is parity across the two protocols.
 */
export const RATIO_SCALE: bigint = 10n ** 18n;

/**
 * One collateral row for the computation. The on-chain `getAssetInfo` row
 * shape + a balance from `collateralBalanceOf(user, asset)`.
 *
 * `balance` and `priceUsd` are bigints; `decimals` is the asset's ERC-20
 * decimal count (recovered from `assetInfo.scale` log10 inversion).
 */
export interface CompoundCollateralPosition {
  /** Raw collateral balance in asset wei (10^decimals). */
  balance: bigint;
  /** Chainlink-feed price (PRICE_FEED_SCALE — 1e8). */
  priceUsd: bigint;
  /** Asset's ERC-20 decimal count. */
  decimals: number;
  /** `borrowCollateralFactor` from `getAssetInfo` (COLLATERAL_FACTOR_SCALE). */
  borrowCollateralFactor: bigint;
  /** `liquidateCollateralFactor` from `getAssetInfo` (COLLATERAL_FACTOR_SCALE). */
  liquidateCollateralFactor: bigint;
}

/**
 * Base-asset position (the Comet's `baseToken`). Borrow value AND any surplus
 * lender supply — Compound's base-asset lender position offsets debt for the
 * canonical `isBorrowCollateralized` semantics (research § Topic 5 line 215:
 * `Comet.isBorrowCollateralized` returns true iff
 * `weighted(borrowCF · collateral) >= borrow`).
 */
export interface CompoundBasePosition {
  /** User's base-asset debt (`borrowBalanceOf`). 0 when noDebt. */
  baseBorrowed: bigint;
  /** Base-asset price (PRICE_FEED_SCALE — 1e8). */
  basePriceUsd: bigint;
  /** Base-asset ERC-20 decimals (recovered from token). */
  baseDecimals: number;
}

export interface CompoundCollateralInput {
  collateral: CompoundCollateralPosition[];
  base: CompoundBasePosition;
}

export interface CompoundCollateralOutput {
  /**
   * Derived collateralization ratio: `weightedCollateralUsd / debtUsd` scaled
   * by RATIO_SCALE (1e18). `null` when `noDebt === true` (debt is 0 — ratio
   * mathematically undefined). Mirror of Aave's `healthFactorScaled` arm.
   */
  ratioScaled: bigint | null;
  /** True when `baseBorrowed === 0n`. Agents check this FIRST. */
  noDebt: boolean;
  /**
   * On-chain canonical: `weighted(borrowCF · collateral)` (USD; PRICE_FEED_SCALE).
   * Compound's threshold for `isBorrowCollateralized: true`.
   */
  borrowCollateralizedValueUsd: bigint;
  /**
   * On-chain canonical: `weighted(liquidateCF · collateral)` (USD;
   * PRICE_FEED_SCALE). Threshold for `isLiquidatable: false` (debt < this).
   */
  liquidateCollateralizedValueUsd: bigint;
  /**
   * Raw collateral value (sum of `balance * priceUsd / 10^decimals`) — NOT
   * weighted. PRICE_FEED_SCALE.
   */
  totalCollateralValueUsd: bigint;
  /** `baseBorrowed * basePriceUsd / 10^baseDecimals` (PRICE_FEED_SCALE). */
  debtValueUsd: bigint;
  /**
   * Off-chain derivation of `Comet.isBorrowCollateralized(user)` — true iff
   * `borrowCollateralizedValueUsd >= debtValueUsd`. Agents cross-check vs the
   * on-chain bool; on disagreement, the on-chain bool wins.
   */
  isBorrowCollateralized: boolean;
  /**
   * Off-chain derivation of `Comet.isLiquidatable(user)` — true iff
   * `liquidateCollateralizedValueUsd < debtValueUsd` (per Compound's gate:
   * a position is liquidatable when liquidate-weighted collateral falls below
   * debt). Agents cross-check vs the on-chain bool.
   */
  isLiquidatable: boolean;
  /** 4-arm classifier — reused from aave-health.ts. */
  liquidationRisk: LiquidationRisk;
}

/**
 * Compute Compound V3 collateralization metrics in pure bigint.
 *
 * Formula (research § Topic 5 lines 205-225, verbatim):
 *   collateralValue_i  = balance_i * priceUsd_i / 10^decimals_i
 *   borrowWeighted_i   = collateralValue_i * borrowCF_i / COLLATERAL_FACTOR_SCALE
 *   liquidateWeighted_i = collateralValue_i * liquidateCF_i / COLLATERAL_FACTOR_SCALE
 *   debtValueUsd       = baseBorrowed * basePriceUsd / 10^baseDecimals
 *   ratioScaled        = Σ_i borrowWeighted_i * RATIO_SCALE / debtValueUsd
 *
 * RATIO_SCALE = 1e18 so the agent reads `ratioScaled / 1e18` as the "factor"
 * (parity with Aave's HF). The 4-arm classifier reuses Aave thresholds.
 *
 * `noDebt` arm returns `ratioScaled: null` (agents check `noDebt` FIRST) and
 * `isBorrowCollateralized: true` + `isLiquidatable: false` (no debt → fully
 * collateralized by definition).
 */
export function computeCompoundCollateralization(
  input: CompoundCollateralInput,
): CompoundCollateralOutput {
  let totalCollateralValueUsd = 0n;
  let borrowCollateralizedValueUsd = 0n;
  let liquidateCollateralizedValueUsd = 0n;

  for (const c of input.collateral) {
    if (c.balance === 0n) continue;
    const collateralValue =
      (c.balance * c.priceUsd) / 10n ** BigInt(c.decimals);
    totalCollateralValueUsd += collateralValue;
    borrowCollateralizedValueUsd +=
      (collateralValue * c.borrowCollateralFactor) / COLLATERAL_FACTOR_SCALE;
    liquidateCollateralizedValueUsd +=
      (collateralValue * c.liquidateCollateralFactor) / COLLATERAL_FACTOR_SCALE;
  }

  const debtValueUsd =
    input.base.baseBorrowed === 0n
      ? 0n
      : (input.base.baseBorrowed * input.base.basePriceUsd) /
        10n ** BigInt(input.base.baseDecimals);

  if (debtValueUsd === 0n) {
    return {
      ratioScaled: null,
      noDebt: true,
      borrowCollateralizedValueUsd,
      liquidateCollateralizedValueUsd,
      totalCollateralValueUsd,
      debtValueUsd: 0n,
      isBorrowCollateralized: true,
      isLiquidatable: false,
      liquidationRisk: classifyLiquidationRisk(null, true),
    };
  }

  const ratioScaled =
    (borrowCollateralizedValueUsd * RATIO_SCALE) / debtValueUsd;

  return {
    ratioScaled,
    noDebt: false,
    borrowCollateralizedValueUsd,
    liquidateCollateralizedValueUsd,
    totalCollateralValueUsd,
    debtValueUsd,
    // Compound's canonical `isBorrowCollateralized` returns true when the
    // borrow-CF-weighted collateral covers the debt; we replicate that.
    isBorrowCollateralized: borrowCollateralizedValueUsd >= debtValueUsd,
    // Liquidatable when the LIQUIDATE-weighted collateral falls below debt —
    // the more permissive threshold (liquidateCF > borrowCF) is Compound's
    // grace band before a wallet is eligible for liquidation.
    isLiquidatable: liquidateCollateralizedValueUsd < debtValueUsd,
    liquidationRisk: classifyLiquidationRisk(ratioScaled, false),
  };
}

// Re-export for consumers (parity with aave-health.ts surface).
export { classifyLiquidationRisk, type LiquidationRisk };
