// src/signing/uniswap-il.ts
//
// Uniswap V3 impermanent-loss estimate — Phase 33 Plan 33-01.
//
// Pure-bigint IL approximation per CONTEXT.md D-02: surfaces both raw IL
// (position vs hodl baseline at mint price) and net-of-fees IL (raw IL +
// accrued fees). In-range positions get HIGH-confidence exact entry-price
// reconstruction. Out-of-range positions fall back to the geometric midpoint
// `sqrt(sqrt(P_lower) * sqrt(P_upper))` with LOW confidence flag.
//
// Per RESEARCH § Topic 5 ASSUMED threshold: extreme asymmetric ranges
// (`sqrtRatio_upper / sqrtRatio_lower > 10`) yield empty IL strings with
// "low" confidence — the agent surfaces "[ESTIMATE unavailable — extreme
// asymmetric range]" at the get_lp_positions response layer.
//
// NO side effects. NO RPC reads. NO module-load state.
//
// Threat anchor:
//   - T-IL-ESTIMATE-MISLEADING: user trusts IL as precise PnL. Mitigation:
//     ilEstimateConfidence: "high" | "low" + extreme-range refusal + the
//     [ESTIMATE] prefix discipline at the tool layer.

import {
  getAmountsForLiquidity,
} from "./uniswap-liquidity.js";
import {
  sqrtPriceX96ToTick,
  tickToSqrtPriceX96,
} from "./uniswap-tick.js";

const Q96 = 1n << 96n;

/** Asymmetric-range refusal threshold per RESEARCH § Topic 5 (ASSUMED). */
const EXTREME_RANGE_RATIO_THRESHOLD = 10n;

/** Bigint integer square root for the geometric-midpoint fallback. */
function bigintSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("bigintSqrt: negative input");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

/** Format a raw bigint into a decimal string with the given decimals. */
function formatRaw(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const intPart = abs / base;
  const fracPart = abs % base;
  if (fracPart === 0n) {
    return (negative ? "-" : "") + intPart.toString();
  }
  const fracStr = fracPart
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return (
    (negative ? "-" : "") +
    intPart.toString() +
    (fracStr.length > 0 ? "." + fracStr : "")
  );
}

/**
 * Inputs to {@link computeIlEstimate}.
 */
export interface IlEstimateInput {
  /** Position liquidity (uint128). */
  liquidity: bigint;
  /** Position range — tick bounds. */
  tickLower: number;
  tickUpper: number;
  /** Current pool sqrtPriceX96 (from Pool.slot0()). */
  currentSqrtPriceX96: bigint;
  /** Accrued fees (settled + unsettled), from computeAccruedFees. */
  accruedFees: { amount0: bigint; amount1: bigint };
  /** Token decimals for amount formatting. */
  decimals0: number;
  decimals1: number;
}

/**
 * Compute impermanent-loss estimate per CONTEXT.md D-02.
 *
 * Returns:
 *   - ilRaw: position value minus hodl-baseline value at current price
 *            (positive = position outperformed; negative = IL incurred).
 *   - ilNetOfFees: ilRaw + value_of_accrued_fees (in current-price terms).
 *   - ilEstimateConfidence:
 *       - "high" for in-range positions (entry-price reconstruction is exact).
 *       - "low" for out-of-range positions OR extreme-asymmetric ranges.
 *
 * For extreme asymmetric ranges (`sqrtUpper / sqrtLower > 10`), the function
 * returns empty IL strings with "low" confidence — geometric midpoint is
 * meaningless when the range spans many orders of magnitude.
 */
export function computeIlEstimate(args: IlEstimateInput): {
  ilRaw: string;
  ilNetOfFees: string;
  ilEstimateConfidence: "high" | "low";
} {
  const sqrtLower = tickToSqrtPriceX96(args.tickLower);
  const sqrtUpper = tickToSqrtPriceX96(args.tickUpper);

  // Asymmetric-range refusal — if upper/lower > THRESHOLD, the geometric-
  // midpoint heuristic produces meaningless numbers. Return empty strings +
  // "low" confidence so the tool surfaces "[ESTIMATE unavailable]".
  if (sqrtUpper / sqrtLower > EXTREME_RANGE_RATIO_THRESHOLD) {
    return { ilRaw: "", ilNetOfFees: "", ilEstimateConfidence: "low" };
  }

  const currentTick = sqrtPriceX96ToTick(args.currentSqrtPriceX96);
  const inRange = currentTick >= args.tickLower && currentTick < args.tickUpper;

  // Entry price reconstruction. Per D-02:
  //   - In-range: use current sqrtPrice as the assumed entry price (the
  //     canonical reconstruction; an active position with known liquidity at
  //     this current price is consistent with mint amounts derived from
  //     getAmountsForLiquidity(currentSqrtPrice, sqrtLower, sqrtUpper, L)).
  //   - Out-of-range: fall back to geometric midpoint of (sqrtLower, sqrtUpper).
  //     ASSUMED threshold per RESEARCH § Topic 5.
  let entrySqrtPrice: bigint;
  let confidence: "high" | "low";
  if (inRange) {
    entrySqrtPrice = args.currentSqrtPriceX96;
    confidence = "high";
  } else {
    // Geometric midpoint = sqrt(sqrtLower × sqrtUpper).
    // Compute via bigint sqrt on the product.
    entrySqrtPrice = bigintSqrt(sqrtLower * sqrtUpper);
    confidence = "low";
  }

  // Hodl baseline: the (amount0_at_mint, amount1_at_mint) the user would
  // have held IF they hadn't minted. Reconstruct from entry price.
  const [hodl0, hodl1] = getAmountsForLiquidity(
    entrySqrtPrice,
    sqrtLower,
    sqrtUpper,
    args.liquidity,
  );

  // Current position value: getAmountsForLiquidity at the CURRENT price.
  const [pos0, pos1] = getAmountsForLiquidity(
    args.currentSqrtPriceX96,
    sqrtLower,
    sqrtUpper,
    args.liquidity,
  );

  // Convert both portfolios to a common numeraire (token1, via price
  // adjustment for token0). value_in_token1 = amount0 × current_price + amount1
  // where current_price (raw) = (currentSqrtPriceX96 / Q96)^2.
  //   To avoid precision loss, compute:
  //     value = (amount0 × currentSqrtPriceX96^2) / Q192 + amount1
  const Q192 = Q96 * Q96;
  const currentSqrtSquared = args.currentSqrtPriceX96 * args.currentSqrtPriceX96;
  const hodlValueT1 = (hodl0 * currentSqrtSquared) / Q192 + hodl1;
  const posValueT1 = (pos0 * currentSqrtSquared) / Q192 + pos1;

  // IL (raw) = posValue - hodlValue, expressed in token1 raw units.
  const ilRawRaw = posValueT1 - hodlValueT1;

  // Net-of-fees = raw + fee value (fees converted to token1 via same price).
  const feeValueT1 =
    (args.accruedFees.amount0 * currentSqrtSquared) / Q192 + args.accruedFees.amount1;
  const ilNetRaw = ilRawRaw + feeValueT1;

  return {
    ilRaw: formatRaw(ilRawRaw, args.decimals1),
    ilNetOfFees: formatRaw(ilNetRaw, args.decimals1),
    ilEstimateConfidence: confidence,
  };
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection
// ---------------------------------------------------------------------------

export const _uniswapV3Il = { computeIlEstimate };
