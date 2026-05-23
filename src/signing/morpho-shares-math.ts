// src/signing/morpho-shares-math.ts
//
// Pure-bigint SharesMathLib — mirror of morpho-blue's on-chain
// `SharesMathLib.sol` (Phase 29 Plan 29-02). Research § Topic 4 + § Don't
// Hand-Roll spec the constants verbatim.
//
// Shared by:
//   - src/chains/morpho-blue.ts   (Plan 29-02: computeExpectedSupplyAssets +
//                                  computeExpectedBorrowAssets off-chain accrual)
//   - Plan 29-03 prepare tools   (if a share-based display path emerges — see
//                                  research § Topic 5 repay-max pattern)
//
// Mirror of `src/signing/aave-health.ts` shape: constants + pure functions,
// NO side effects, NO RPC reads, NO module-load state.
//
// Threat anchors:
//   - T-29-02-T-SHARES-MATH-DRIFT (HIGH): VIRTUAL_SHARES / VIRTUAL_ASSETS
//     drift cascades through every Morpho position display. Constants are
//     LOAD-BEARING anti-inflation guards (research § Topic 4 + § Don't
//     Hand-Roll); drift = misalignment with on-chain accounting.
//     `test/signing-morpho-shares-math.test.ts` regression-anchors the two
//     literals AND fixed-input → expected-output values for each function.
//   - T-VIRTUAL-INFLATION-1 (HIGH): VIRTUAL_SHARES (1e6) + VIRTUAL_ASSETS (1n)
//     defend against the inflation attack the Morpho audit-time analysis
//     identified — the first depositor cannot drive 1 share = N assets by
//     donating directly to the contract because the virtual offsets keep
//     `(totalAssets + 1) / (totalShares + 1e6)` bounded near 1:1e6 on an
//     empty market.

/**
 * Anti-inflation virtual offset on the SHARES denominator. 1e6 per
 * `SharesMathLib.sol` — research § Topic 4 + § Don't Hand-Roll. Drift breaks
 * the on-chain accrual mirror; `test/signing-morpho-shares-math.test.ts` T1
 * asserts the literal byte-identity.
 */
export const VIRTUAL_SHARES = 1_000_000n;

/**
 * Anti-inflation virtual offset on the ASSETS numerator. 1n per
 * `SharesMathLib.sol`. Pairs with VIRTUAL_SHARES — the (1, 1e6) ratio is the
 * canonical empty-market exchange rate (1 asset = 1e6 shares).
 */
export const VIRTUAL_ASSETS = 1n;

/**
 * Convert shares → assets rounded DOWN. Conservative for "what the user CAN
 * withdraw" — under-reporting is the safe direction.
 *
 *   `assets = shares * (totalAssets + VIRTUAL_ASSETS) / (totalShares + VIRTUAL_SHARES)`
 *
 * Mirrors `SharesMathLib.toAssetsDown` (research § Topic 4). Division uses
 * bigint floor-division — drop the remainder for floor behavior.
 */
export function toAssetsDown(
  shares: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint {
  return (shares * (totalAssets + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES);
}

/**
 * Convert shares → assets rounded UP. Conservative for "what the user OWES" —
 * over-reporting debt is the safe direction (the user sees a debt figure
 * slightly higher than reality; the on-chain repay clears the actual amount).
 *
 *   `assets = (shares * (totalAssets + VIRTUAL_ASSETS) + totalShares + VIRTUAL_SHARES - 1) /
 *             (totalShares + VIRTUAL_SHARES)`
 *
 * Mirrors `SharesMathLib.toAssetsUp`. The `+ denominator - 1` numerator
 * addition is the canonical bigint ceiling-division idiom.
 */
export function toAssetsUp(
  shares: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint {
  const denom = totalShares + VIRTUAL_SHARES;
  return (shares * (totalAssets + VIRTUAL_ASSETS) + denom - 1n) / denom;
}

/**
 * Inverse direction — convert assets → shares rounded DOWN.
 *
 *   `shares = assets * (totalShares + VIRTUAL_SHARES) / (totalAssets + VIRTUAL_ASSETS)`
 *
 * Mirrors `SharesMathLib.toSharesDown`. Shipped for completeness even though
 * Plan 29-02 only consumes the asset-direction functions — Plan 29-03 may
 * use the inverse for a share-based encoding path if one emerges.
 */
export function toSharesDown(
  assets: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint {
  return (assets * (totalShares + VIRTUAL_SHARES)) / (totalAssets + VIRTUAL_ASSETS);
}

/**
 * Inverse direction — convert assets → shares rounded UP.
 *
 *   `shares = (assets * (totalShares + VIRTUAL_SHARES) + totalAssets + VIRTUAL_ASSETS - 1) /
 *             (totalAssets + VIRTUAL_ASSETS)`
 *
 * Mirrors `SharesMathLib.toSharesUp`.
 */
export function toSharesUp(
  assets: bigint,
  totalAssets: bigint,
  totalShares: bigint,
): bigint {
  const denom = totalAssets + VIRTUAL_ASSETS;
  return (assets * (totalShares + VIRTUAL_SHARES) + denom - 1n) / denom;
}
