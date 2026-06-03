// src/signing/marginfi-health.ts
//
// Pure-bigint MarginFi risk-weighted health math (D-07). Phase 13 — Plan 13-02.
// Sibling of `src/signing/aave-health.ts` (Phase 7) — same shape: pinned
// fixed-point constants, an input interface, a `compute*Health` pure function,
// and a `classify*Risk` band. Pure functions ONLY — NO side effects, NO RPC,
// NO module-load state, bigint-only (no `Number` / float in the math path).
//
// Formula (13-RESEARCH § Health Math, re-derived on-chain-accurate per D-07 —
// NOT imported from the SDK; the SDK `computeHealthComponents` is the REFERENCE
// to verify against at verify-phase, A3):
//   assets       = Σ (quantity_i × oraclePrice_i × assetWeightMaint_i)
//   liabilities  = Σ (quantity_j × oraclePrice_j × liabilityWeightMaint_j)
//   Solvent at maintenance when assets ≥ liabilities.
//   health-factor-equivalent (SOL-W-03 display) = assets / liabilities
//     (≥ 1 safe at the maintenance margin type).
//
// Weights: MAINTENANCE weights drive the liquidation-risk surface (Init weights
// gate NEW borrows — A3). Isolated-tier assets contribute 0 as collateral.
//
// Fixed-point: MarginFi stores weights + oracle prices as WrappedI80F48 (signed
// 80.48, 2^48 fractional). `oraclePrice` + `assetWeightMaint` +
// `liabilityWeightMaint` arrive here as I80F48-scaled bigints (converted at the
// decoder seam in `src/chains/solana/marginfi.ts`). `quantity` is the resolved
// native token amount (bigint). `assets`/`liabilities` accumulate in scale
// 2^96 (quantity × price[2^48] × weight[2^48]); the ratio rescales to
// `MARGINFI_HF_SCALE` (1e18), so the 2^96 scale cancels — the display ratio is
// scale-independent of the I80F48 exponent.
//
// Threat anchors:
//   - T-13-04 (Tampering): I80F48 scale-constant drift mis-bands risk. The
//     scale literal is pinned in test/signing-marginfi-health.test.ts AND a
//     deterministic input → expected scaled-bigint anchor (Pitfall 4).
//   - T-13-03 (Information disclosure): a stale oracle invalidates a "safe"
//     claim. `oracleStale` surfaces verbatim — the reader must not assert
//     liquidation safety on a stale price (mirror Aave's verbatim-surface
//     caveat). No throw — surface, don't crash (reads).

/**
 * I80F48 fractional scale — 2^48. MarginFi's WrappedI80F48 fixed-point uses a
 * 48-bit fractional part. PINNED (Pitfall 4): a wrong scale silently
 * mis-displays liquidation risk, a trust surface.
 */
export const I80F48_SCALE: bigint = 1n << 48n;

/**
 * Display health-ratio scale — 1e18. Mirrors `aave-health.ts` `HF_SCALE` for
 * cross-protocol display consistency (the agent reads one HF scale across Aave
 * + MarginFi).
 */
export const MARGINFI_HF_SCALE: bigint = 10n ** 18n;

/** MarginFi bank risk tier. Isolated-tier assets are not usable as collateral. */
export type MarginfiRiskTier = "Collateral" | "Isolated";

/**
 * A single asset (deposit) position. `quantity` is the resolved native token
 * amount (bigint); `oraclePrice` + `assetWeightMaint` are I80F48-scaled
 * bigints. `riskTier === "Isolated"` → this position contributes 0 to assets.
 */
export interface MarginfiAssetPosition {
  /** Bank pubkey, base58 (provenance for the surface). */
  bank: string;
  /** Resolved native token amount (asset_shares × bank.asset_share_value). */
  quantity: bigint;
  /** Oracle price, I80F48-scaled (2^48). */
  oraclePrice: bigint;
  /** Maintenance asset weight, I80F48-scaled (2^48). */
  assetWeightMaint: bigint;
  /** Bank risk tier — Isolated assets contribute 0 as collateral. */
  riskTier: MarginfiRiskTier;
  /** Oracle staleness flag (oracleMaxAge / oracleMaxConfidence exceeded). */
  oracleStale: boolean;
}

/**
 * A single liability (borrow) position. `quantity` resolved native amount;
 * `oraclePrice` + `liabilityWeightMaint` are I80F48-scaled bigints.
 */
export interface MarginfiLiabilityPosition {
  bank: string;
  /** Resolved native token amount (liability_shares × bank.liability_share_value). */
  quantity: bigint;
  /** Oracle price, I80F48-scaled (2^48). */
  oraclePrice: bigint;
  /** Maintenance liability weight, I80F48-scaled (2^48). */
  liabilityWeightMaint: bigint;
  /** Oracle staleness flag. */
  oracleStale: boolean;
}

export interface MarginfiHealthInput {
  assets: MarginfiAssetPosition[];
  liabilities: MarginfiLiabilityPosition[];
}

export interface MarginfiHealthOutput {
  /** Σ (quantity × price × assetWeightMaint), scale 2^96. Isolated → 0. */
  assetsScaled: bigint;
  /** Σ (quantity × price × liabilityWeightMaint), scale 2^96. */
  liabilitiesScaled: bigint;
  /**
   * Health-factor-equivalent = assets / liabilities, rescaled to
   * `MARGINFI_HF_SCALE` (1e18). `null` when `noDebt === true` (mirror the
   * aave-health null-not-MAX_UINT256 lock — agents read `noDebt` FIRST). When
   * liabilities > 0 but assets == 0, returns `0n` (NOT null — there IS debt).
   */
  healthRatioScaled: bigint | null;
  /** True when there are no liabilities and the ratio is mathematically undefined. */
  noDebt: boolean;
  /** True when ANY position carries a stale oracle — invalidates a "safe" claim (T-13-03). */
  oracleStale: boolean;
}

/**
 * Compute MarginFi maintenance health (D-07). Pure bigint. No RPC, no float.
 *
 * `assets`/`liabilities` accumulate in scale 2^96 (quantity × price[2^48] ×
 * weight[2^48]). The display ratio rescales to 1e18; the 2^96 scale cancels.
 * Isolated-tier asset positions contribute 0 to `assetsScaled`.
 *
 * `oracleStale` is the OR over every input position's `oracleStale` — surfaced
 * verbatim so the reader never asserts liquidation safety on a stale price.
 */
export function computeMarginfiHealth(
  input: MarginfiHealthInput,
): MarginfiHealthOutput {
  let assetsScaled = 0n;
  let oracleStale = false;

  for (const a of input.assets) {
    if (a.oracleStale) oracleStale = true;
    // Isolated-tier assets are not usable as collateral — 0 contribution.
    if (a.riskTier === "Isolated") continue;
    assetsScaled += a.quantity * a.oraclePrice * a.assetWeightMaint;
  }

  let liabilitiesScaled = 0n;
  for (const l of input.liabilities) {
    if (l.oracleStale) oracleStale = true;
    liabilitiesScaled += l.quantity * l.oraclePrice * l.liabilityWeightMaint;
  }

  if (liabilitiesScaled === 0n) {
    return {
      assetsScaled,
      liabilitiesScaled: 0n,
      healthRatioScaled: null,
      noDebt: true,
      oracleStale,
    };
  }

  return {
    assetsScaled,
    liabilitiesScaled,
    // Both operands share the 2^96 scale → it cancels; rescale to 1e18.
    healthRatioScaled: (assetsScaled * MARGINFI_HF_SCALE) / liabilitiesScaled,
    noDebt: false,
    oracleStale,
  };
}

export type MarginfiLiquidationRisk = "safe" | "warning" | "danger" | "noDebt";

/**
 * Classify the health ratio into a 4-arm band. Thresholds mirror
 * `aave-health.ts` `classifyLiquidationRisk` for cross-protocol consistency:
 *   - ratio ≥ 1.50 → "safe"
 *   - 1.10 ≤ ratio < 1.50 → "warning"
 *   - ratio < 1.10 → "danger"
 *   - noDebt → "noDebt"
 *
 * Pure classification, no side effects. `healthRatioScaled === null` with
 * `noDebt === false` is defensively treated as "noDebt" (unreachable — the
 * compute fn returns 0n, not null, when there is debt with zero assets).
 */
export function classifyMarginfiRisk(
  healthRatioScaled: bigint | null,
  noDebt: boolean,
): MarginfiLiquidationRisk {
  if (noDebt) return "noDebt";
  if (healthRatioScaled === null) return "noDebt";
  const SAFE_THRESHOLD = 15n * 10n ** 17n; // 1.50e18
  const WARNING_THRESHOLD = 11n * 10n ** 17n; // 1.10e18
  if (healthRatioScaled >= SAFE_THRESHOLD) return "safe";
  if (healthRatioScaled >= WARNING_THRESHOLD) return "warning";
  return "danger";
}
