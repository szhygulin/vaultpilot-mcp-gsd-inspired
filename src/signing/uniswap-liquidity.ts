// src/signing/uniswap-liquidity.ts
//
// Uniswap V3 liquidity ↔ amounts math — Phase 33 Plan 33-01.
//
// Pure-bigint Q64.96 implementations of the canonical v3-periphery
// LiquidityAmounts.sol primitives (lines 47-145). Hand-rolled per SDK Probe
// Verdict (RESEARCH § Topic 1). Sibling-shelf of src/signing/uniswap-tick.ts.
//
// NO side effects. NO RPC reads. NO module-load state.
//
// Algorithmic reference: @uniswap/v3-periphery LiquidityAmounts.sol — each
// function is a verbatim bigint translation of the Solidity reference. The
// `FullMath.mulDiv` calls become straightforward bigint multiply-divide (no
// overflow risk because JS bigint is arbitrary precision; the Solidity
// uint256 wrap-discipline is preserved by structure).
//
// Threat anchors:
//   - T-33-LIQUIDITY-MATH-DRIFT: drift between the bigint port and the
//     canonical Solidity silently produces wrong mint/decrease amounts.
//     Mitigation: hardcoded reference vectors in
//     test/signing-uniswap-liquidity.test.ts including the round-trip
//     property getLiquidityForAmounts(getAmountsForLiquidity(L)) ≈ L.
//
// Cross-link: consumed by src/signing/uniswap-il.ts (IL estimate) and by
// Plan 33-02 prepare tools (mint amount derivation).

const Q96 = 1n << 96n;

// ---------------------------------------------------------------------------
// getAmount0ForLiquidity / getAmount1ForLiquidity
// ---------------------------------------------------------------------------

/**
 * amount0 = liquidity * (sqrtB - sqrtA) * 2^96 / (sqrtA * sqrtB)
 * (v3-periphery LiquidityAmounts.sol lines 82-95).
 *
 * The Solidity `FullMath.mulDiv(liquidity << 96, sqrtB - sqrtA, sqrtB) / sqrtA`
 * is preserved here as bigint multiply-divide. Order matters: divide by sqrtB
 * first to keep intermediates bounded, then by sqrtA.
 */
export function getAmount0ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): bigint {
  let a = sqrtRatioAX96;
  let b = sqrtRatioBX96;
  if (a > b) [a, b] = [b, a];
  if (a === 0n) {
    throw new Error("getAmount0ForLiquidity: sqrtRatioAX96 must be > 0");
  }
  const numerator1 = liquidity << 96n;
  const numerator2 = b - a;
  return (numerator1 * numerator2) / b / a;
}

/**
 * amount1 = liquidity * (sqrtB - sqrtA) / 2^96
 * (v3-periphery LiquidityAmounts.sol lines 102-110).
 */
export function getAmount1ForLiquidity(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): bigint {
  let a = sqrtRatioAX96;
  let b = sqrtRatioBX96;
  if (a > b) [a, b] = [b, a];
  return (liquidity * (b - a)) / Q96;
}

/**
 * 3-case branch on `sqrtCurrent <=> [sqrtA, sqrtB]`:
 *   - sqrtCurrent ≤ sqrtA: position is all-token0; amount1 = 0.
 *   - sqrtA < sqrtCurrent < sqrtB: position is mixed; both legs populated.
 *   - sqrtCurrent ≥ sqrtB: position is all-token1; amount0 = 0.
 * (v3-periphery LiquidityAmounts.sol lines 120-136).
 */
export function getAmountsForLiquidity(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
): [bigint, bigint] {
  let a = sqrtRatioAX96;
  let b = sqrtRatioBX96;
  if (a > b) [a, b] = [b, a];
  let amount0 = 0n;
  let amount1 = 0n;
  if (sqrtRatioX96 <= a) {
    amount0 = getAmount0ForLiquidity(a, b, liquidity);
  } else if (sqrtRatioX96 < b) {
    amount0 = getAmount0ForLiquidity(sqrtRatioX96, b, liquidity);
    amount1 = getAmount1ForLiquidity(a, sqrtRatioX96, liquidity);
  } else {
    amount1 = getAmount1ForLiquidity(a, b, liquidity);
  }
  return [amount0, amount1];
}

// ---------------------------------------------------------------------------
// getLiquidityForAmount0 / getLiquidityForAmount1 / getLiquidityForAmounts
// ---------------------------------------------------------------------------

/**
 * liquidity = amount0 * (sqrtA * sqrtB) / 2^96 / (sqrtB - sqrtA)
 * (v3-periphery LiquidityAmounts.sol lines 23-31).
 */
export function getLiquidityForAmount0(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint,
): bigint {
  let a = sqrtRatioAX96;
  let b = sqrtRatioBX96;
  if (a > b) [a, b] = [b, a];
  if (b === a) {
    throw new Error("getLiquidityForAmount0: degenerate range (sqrtA === sqrtB)");
  }
  const intermediate = (a * b) / Q96;
  return (amount0 * intermediate) / (b - a);
}

/**
 * liquidity = amount1 * 2^96 / (sqrtB - sqrtA)
 * (v3-periphery LiquidityAmounts.sol lines 39-46).
 */
export function getLiquidityForAmount1(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount1: bigint,
): bigint {
  let a = sqrtRatioAX96;
  let b = sqrtRatioBX96;
  if (a > b) [a, b] = [b, a];
  if (b === a) {
    throw new Error("getLiquidityForAmount1: degenerate range (sqrtA === sqrtB)");
  }
  return (amount1 * Q96) / (b - a);
}

/**
 * 3-case branch + `min` for the in-range case.
 * (v3-periphery LiquidityAmounts.sol lines 56-75).
 */
export function getLiquidityForAmounts(
  sqrtRatioX96: bigint,
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  let a = sqrtRatioAX96;
  let b = sqrtRatioBX96;
  if (a > b) [a, b] = [b, a];
  if (sqrtRatioX96 <= a) {
    return getLiquidityForAmount0(a, b, amount0);
  }
  if (sqrtRatioX96 < b) {
    const l0 = getLiquidityForAmount0(sqrtRatioX96, b, amount0);
    const l1 = getLiquidityForAmount1(a, sqrtRatioX96, amount1);
    return l0 < l1 ? l0 : l1;
  }
  return getLiquidityForAmount1(a, b, amount1);
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection
// ---------------------------------------------------------------------------

export const _uniswapV3Liquidity = {
  getAmount0ForLiquidity,
  getAmount1ForLiquidity,
  getAmountsForLiquidity,
  getLiquidityForAmount0,
  getLiquidityForAmount1,
  getLiquidityForAmounts,
};
