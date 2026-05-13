// src/signing/aave-health.ts
//
// Pure-bigint health-factor math per Aave V3 protocol docs + research § Topic 3.
//
// Shared by:
//   - src/tools/get_lending_positions.ts    (current HF; Plan 07-02)
//   - src/tools/simulate_position_change.ts (post-tx projected HF; Plan 07-03)
//
// Locked on src/signing/ to keep the trust-pipeline shelf coherent (deterministic
// math the prepare/preview path may consume in the future). Pure functions only —
// NO side effects, NO RPC reads, NO module-load state.
//
// Threat anchors:
//   - T-AAVE-HF-MATH-DRIFT-1 (HIGH): RAY / BPS_SCALE / HF_SCALE drift cascades
//     through every lending-flow projection. Constants are byte-identical to
//     research § Topic 3 literals; test/signing-aave-health.test.ts asserts the
//     three literals AND a deterministic input → expected-HF anchor.
//   - T-AAVE-HF-INFINITY-1 (MEDIUM): the noDebt arm returns null (NOT
//     MAX_UINT256) so agents read `noDebt: true` first, `healthFactorScaled`
//     second. Research § Topic 3 lock.

/**
 * Aave V3 index scale. `liquidityIndex` and `variableBorrowIndex` are
 * RAY-scaled (1e27); a raw scaled balance is decoded via
 * `(scaled * index) / RAY` to recover the underlying-asset wei value.
 */
export const RAY: bigint = 10n ** 27n;

/**
 * Basis-points scale. `liquidationThreshold` is in bps (e.g. 8500 = 85.00%);
 * divide by `BPS_SCALE` to convert to a fraction.
 */
export const BPS_SCALE: bigint = 10000n;

/**
 * Aave's protocol-canonical health-factor scale. `Pool.getUserAccountData(user)`
 * returns `healthFactor` scaled by 1e18; mirror that scale in this module so
 * the v1.x verify-phase cross-check (research § Topic 3 A2) is byte-identical.
 */
export const HF_SCALE: bigint = 10n ** 18n;

export interface CollateralPosition {
  /** `userScaledATokenBalance` from UiPoolDataProviderV3. */
  scaledBalance: bigint;
  /** `liquidityIndex` (RAY) from `AggregatedReserveData`. */
  index: bigint;
  /** `priceInMarketReferenceCurrency` from `AggregatedReserveData`. */
  price: bigint;
  /** Reserve decimals; viem returns `uint256` but Aave caps at 18 — narrow to JS number. */
  decimals: number;
  /** `reserveLiquidationThreshold` (bps; e.g. 8500 = 85%). */
  liquidationThresholdBps: bigint;
}

export interface DebtPosition {
  /** `userScaledVariableDebt` from UiPoolDataProviderV3. */
  scaledDebt: bigint;
  /** `variableBorrowIndex` (RAY) from `AggregatedReserveData`. */
  index: bigint;
  /** `priceInMarketReferenceCurrency` from `AggregatedReserveData`. */
  price: bigint;
  /** Reserve decimals; viem returns `uint256` but Aave caps at 18 — narrow to JS number. */
  decimals: number;
}

export interface HealthFactorInput {
  collateralPositions: CollateralPosition[];
  debtPositions: DebtPosition[];
}

export interface HealthFactorOutput {
  /**
   * Health factor scaled by `HF_SCALE` (1e18). `null` when `noDebt === true`
   * (research § Topic 3 lock — avoid agents pattern-matching `MAX_UINT256` as
   * "numerically near max"). Agents check `noDebt` FIRST.
   */
  healthFactorScaled: bigint | null;
  /** True when there is no variable-rate debt and HF is mathematically undefined. */
  noDebt: boolean;
  /** Sum of `collateralValue` over positions, in baseCurrency units. */
  totalCollateralBase: bigint;
  /** Sum of `debtValue` over positions, in baseCurrency units. */
  totalDebtBase: bigint;
  /** Sum of `collateralValue * liquidationThresholdBps / BPS_SCALE` — load-bearing for projection. */
  weightedLiquidationThresholdBase: bigint;
}

/**
 * Compute health factor per Aave V3 protocol docs (research § Topic 3 formula
 * verbatim).
 *
 * Formula:
 *   collateralValue_i = (scaledBalance_i * liquidityIndex_i / RAY)
 *                       * priceInMarketReferenceCurrency_i
 *                       / 10^decimals_i
 *   debtValue_j       = (scaledDebt_j * variableBorrowIndex_j / RAY)
 *                       * priceInMarketReferenceCurrency_j
 *                       / 10^decimals_j
 *   weightedLT        = Σ_i (collateralValue_i * liquidationThresholdBps_i / BPS_SCALE)
 *   HF = weightedLT * HF_SCALE / Σ_j debtValue_j
 *
 * RAY-scaled indices, BPS-scaled thresholds. ALL bigint arithmetic. No
 * `Number` casts. No floating point.
 *
 * The `noDebt` arm returns `healthFactorScaled: null` so agents don't
 * pattern-match `MAX_UINT256` as numerically near max — they read
 * `noDebt: true` FIRST and `healthFactorScaled` second. Defensive at the
 * surface; research § Topic 3 lock.
 *
 * v1.1 uses per-asset `liquidationThresholdBps` from
 * `AggregatedReserveData.reserveLiquidationThreshold` regardless of
 * `userEModeCategoryId` (research § Topic 3 A3 caveat — eMode per-category
 * widening deferred to v2.3). The reader surfaces `userEModeCategoryId`
 * verbatim so the agent / user sees the caveat.
 *
 * Cross-check at verify-phase: against `Pool.getUserAccountData(user)`'s
 * `healthFactor` field (selector 0xbf92857c) — research § Topic 3 A2.
 */
export function computeHealthFactor(input: HealthFactorInput): HealthFactorOutput {
  let totalCollateralBase = 0n;
  let weightedLiquidationThresholdBase = 0n;
  for (const c of input.collateralPositions) {
    const balanceWei = (c.scaledBalance * c.index) / RAY;
    const valueScaled = (balanceWei * c.price) / 10n ** BigInt(c.decimals);
    totalCollateralBase += valueScaled;
    weightedLiquidationThresholdBase += (valueScaled * c.liquidationThresholdBps) / BPS_SCALE;
  }

  let totalDebtBase = 0n;
  for (const d of input.debtPositions) {
    const debtWei = (d.scaledDebt * d.index) / RAY;
    totalDebtBase += (debtWei * d.price) / 10n ** BigInt(d.decimals);
  }

  if (totalDebtBase === 0n) {
    return {
      healthFactorScaled: null,
      noDebt: true,
      totalCollateralBase,
      totalDebtBase: 0n,
      weightedLiquidationThresholdBase,
    };
  }

  return {
    healthFactorScaled: (weightedLiquidationThresholdBase * HF_SCALE) / totalDebtBase,
    noDebt: false,
    totalCollateralBase,
    totalDebtBase,
    weightedLiquidationThresholdBase,
  };
}

export type LiquidationRisk = "safe" | "warning" | "danger" | "noDebt";

/**
 * Classify HF into a 4-arm risk band. Thresholds per research § Topic 8:
 *   - HF >= 1.50 → "safe"
 *   - 1.10 <= HF < 1.50 → "warning"
 *   - HF < 1.10 → "danger"
 *   - noDebt → "noDebt"
 *
 * Pure classification, no side effects. The agent reads `liquidationRisk` to
 * route warnings before suggesting supply / withdraw.
 *
 * Defensive: `healthFactorScaled === null` + `noDebt === false` should be
 * unreachable; we fall through to "noDebt" rather than throw so a malformed
 * upstream input cannot crash the reader.
 */
export function classifyLiquidationRisk(
  healthFactorScaled: bigint | null,
  noDebt: boolean,
): LiquidationRisk {
  if (noDebt) return "noDebt";
  if (healthFactorScaled === null) return "noDebt";
  // HF_SCALE = 1e18; thresholds scaled accordingly.
  const SAFE_THRESHOLD = 15n * 10n ** 17n; // 1.50e18
  const WARNING_THRESHOLD = 11n * 10n ** 17n; // 1.10e18
  if (healthFactorScaled >= SAFE_THRESHOLD) return "safe";
  if (healthFactorScaled >= WARNING_THRESHOLD) return "warning";
  return "danger";
}
