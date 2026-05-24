// src/signing/uniswap-fees.ts
//
// Uniswap V3 accrued-fee computation — Phase 33 Plan 33-01.
//
// Pure-bigint Q128.128 fixed-point math for combined settled + unsettled fee
// totals per LP position. Hand-rolled per SDK Probe Verdict (RESEARCH §
// Topic 1). Sibling-shelf of src/signing/uniswap-tick.ts.
//
// NO side effects. NO RPC reads. NO module-load state.
//
// Algorithmic reference: @uniswap/v3-periphery PositionValue.sol#fees lines
// 60-130. The accrued total is the sum of two components:
//   - SETTLED:    tokensOwed0 + tokensOwed1  (already accounted at last interact)
//   - UNSETTLED:  (feeGrowthInside_current - feeGrowthInside_last) × L / 2^128
//
// Q128.128 wrap discipline: the subtraction
// `feeGrowthInside - feeGrowthInsideLast` MUST wrap modulo 2^256 because the
// on-chain accumulator overflows by design (Solidity uint256 overflow). We
// model this with `BigInt.asUintN(256, x - y)`.
//
// Threat anchors:
//   - T-33-FEE-WRAP-MISMODELED: if the subtraction is JS-style (no wrap),
//     positions whose feeGrowthInsideLast exceeds the current value (very
//     common after long periods) yield NEGATIVE accruals — caller sees zero
//     or negative when actual on-chain returns positive. Mitigation:
//     BigInt.asUintN(256, ...) at every subtraction site + explicit
//     test/signing-uniswap-fees.test.ts wrapping fixture.

// Q128 = 2^128 — fixed-point denominator.
const Q128 = 1n << 128n;

/**
 * Compute fee growth inside a position's range per the canonical 3-case branch:
 *   - currentTick < tickLower: feeGrowthInside = feeGrowthBelow_upper - feeGrowthBelow_lower
 *   - tickLower <= currentTick < tickUpper: in-range case
 *   - currentTick >= tickUpper: feeGrowthInside = feeGrowthAbove_lower - feeGrowthAbove_upper
 *
 * Where:
 *   feeGrowthBelow_x = (currentTick >= tickX) ? feeGrowthOutside_x : feeGrowthGlobal - feeGrowthOutside_x
 *   feeGrowthAbove_x = (currentTick >= tickX) ? feeGrowthGlobal - feeGrowthOutside_x : feeGrowthOutside_x
 *
 * All arithmetic wrapped modulo 2^256 to mirror on-chain Solidity overflow
 * semantics. See v3-core Pool.sol#getFeeGrowthInside.
 */
function computeFeeGrowthInsidePerToken(
  feeGrowthGlobalX128: bigint,
  feeGrowthOutsideLowerX128: bigint,
  feeGrowthOutsideUpperX128: bigint,
  tickLower: number,
  tickUpper: number,
  currentTick: number,
): bigint {
  // feeGrowthBelow_x for both endpoints.
  const feeGrowthBelow =
    currentTick >= tickLower
      ? feeGrowthOutsideLowerX128
      : BigInt.asUintN(256, feeGrowthGlobalX128 - feeGrowthOutsideLowerX128);
  // feeGrowthAbove_x for both endpoints.
  const feeGrowthAbove =
    currentTick >= tickUpper
      ? BigInt.asUintN(256, feeGrowthGlobalX128 - feeGrowthOutsideUpperX128)
      : feeGrowthOutsideUpperX128;
  // feeGrowthInside = feeGrowthGlobal - feeGrowthBelow - feeGrowthAbove
  // (wrapped to 2^256).
  return BigInt.asUintN(256, feeGrowthGlobalX128 - feeGrowthBelow - feeGrowthAbove);
}

/**
 * Inputs to {@link computeAccruedFees}. All Q128.128 fixed-point values are
 * `bigint`. Tick indices are `number` (uint24 fits comfortably in JS number).
 */
export interface AccruedFeesInput {
  /** L — position liquidity (uint128). */
  liquidity: bigint;
  /** tickLower / tickUpper — position range. */
  tickLower: number;
  tickUpper: number;
  /** Pool.slot0().tick — current tick. */
  currentTick: number;
  /** Pool.feeGrowthGlobal0X128() / Pool.feeGrowthGlobal1X128() — Q128.128. */
  feeGrowthGlobal0X128: bigint;
  feeGrowthGlobal1X128: bigint;
  /** Pool.ticks(tickLower).feeGrowthOutside0X128 / 1X128. */
  feeGrowthOutsideLower0X128: bigint;
  feeGrowthOutsideLower1X128: bigint;
  /** Pool.ticks(tickUpper).feeGrowthOutside0X128 / 1X128. */
  feeGrowthOutsideUpper0X128: bigint;
  feeGrowthOutsideUpper1X128: bigint;
  /** Position.feeGrowthInside{0,1}LastX128 — last-settled snapshot. */
  feeGrowthInside0LastX128: bigint;
  feeGrowthInside1LastX128: bigint;
  /** Position.tokensOwed{0,1} — settled fee balance (uint128). */
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

/**
 * Compute combined accrued fees (settled + unsettled) per token. Returns raw
 * token amounts (not decimal-adjusted — the caller formats with the token's
 * decimals via `viem.formatUnits`).
 */
export function computeAccruedFees(args: AccruedFeesInput): {
  amount0: bigint;
  amount1: bigint;
} {
  const feeGrowthInside0X128 = computeFeeGrowthInsidePerToken(
    args.feeGrowthGlobal0X128,
    args.feeGrowthOutsideLower0X128,
    args.feeGrowthOutsideUpper0X128,
    args.tickLower,
    args.tickUpper,
    args.currentTick,
  );
  const feeGrowthInside1X128 = computeFeeGrowthInsidePerToken(
    args.feeGrowthGlobal1X128,
    args.feeGrowthOutsideLower1X128,
    args.feeGrowthOutsideUpper1X128,
    args.tickLower,
    args.tickUpper,
    args.currentTick,
  );

  // Unsettled delta — wrapped subtraction to model Solidity uint256 overflow.
  const delta0 = BigInt.asUintN(
    256,
    feeGrowthInside0X128 - args.feeGrowthInside0LastX128,
  );
  const delta1 = BigInt.asUintN(
    256,
    feeGrowthInside1X128 - args.feeGrowthInside1LastX128,
  );

  // Unsettled fee per token = delta × L / 2^128.
  const unsettled0 = (delta0 * args.liquidity) / Q128;
  const unsettled1 = (delta1 * args.liquidity) / Q128;

  return {
    amount0: args.tokensOwed0 + unsettled0,
    amount1: args.tokensOwed1 + unsettled1,
  };
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection
// ---------------------------------------------------------------------------

export const _uniswapV3Fees = { computeAccruedFees };
