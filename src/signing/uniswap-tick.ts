// src/signing/uniswap-tick.ts
//
// Uniswap V3 tick math primitives — Phase 33 Plan 33-01.
//
// Pure-bigint Q64.96 tick ↔ sqrtPriceX96 ↔ price conversions, hand-rolled per
// the SDK Probe Verdict (RESEARCH § Topic 1: HAND-ROLL — @uniswap/v3-sdk pulls
// JSBI + ethersproject v5 + sdk-core deprecated graph; surface area is small;
// viem provides BigInt + Q64.96 math natively). Same precedent as Phase 32's
// src/signing/uniswap-path.ts.
//
// NO side effects. NO RPC reads. NO module-load state.
//
// Algorithmic reference: @uniswap/v3-core TickMath.sol lines 23-205. Each
// `getSqrtRatioAtTick` iterative-shift constant is verbatim from the canonical
// Solidity source (DO NOT modify — the values are mathematically derived
// log-base-1.0001 of 2^{-shift}).
//
// Threat anchors:
//   - T-33-TICK-MATH-DRIFT: drift between the bigint port and the canonical
//     Solidity reference silently misroutes prices ↔ ticks. Mitigation:
//     hardcoded reference vectors in test/signing-uniswap-tick.test.ts
//     anchored to on-chain Pool.slot0() at fixed blocks.
//
// Cross-link: consumed by src/chains/uniswap-v3-lp.ts (per-position tick
// math via the _uniswapV3Tick indirection) and by Plan 33-02 prepare tools
// (snapPriceToTick at mint/increase time).

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum tick that may be passed to getSqrtRatioAtTick — log_{1.0001} 2^{-128}. */
export const MIN_TICK = -887272;
/** Maximum tick that may be passed to getSqrtRatioAtTick — −MIN_TICK. */
export const MAX_TICK = 887272;

/** Minimum sqrtPriceX96 (= getSqrtRatioAtTick(MIN_TICK)). */
export const MIN_SQRT_RATIO = 4295128739n;
/** Maximum sqrtPriceX96 (= getSqrtRatioAtTick(MAX_TICK)). */
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

/** Q96 constant = 2^96 — Q64.96 fixed-point base. */
const Q96 = 1n << 96n;
/** Q192 constant = 2^192 — for sqrtPriceX96-squared full-precision math. */
const Q192 = 1n << 192n;
/** 2^256 — modular reduction modulus mirroring the on-chain uint256 wrap. */
const TWO_256 = 1n << 256n;

/**
 * Canonical Uniswap V3 fee tiers (uint24 on-chain). Phase 33 ships only the 4
 * standard Ethereum tiers per RESEARCH § Topic 3 — L2-only `LOW_200/300/400`
 * excluded per D-03 (Ethereum-only). Clone of `PathHop.fee` literal-union in
 * `src/signing/uniswap-path.ts`.
 */
export type Uniswapv3FeeTier = 100 | 500 | 3000 | 10000;

/**
 * Canonical fee-tier → tick-spacing table per RESEARCH § Topic 3.
 *   - 100   (0.01%): 1    — stablecoin-pair tier
 *   - 500   (0.05%): 10   — blue-chip pairs (ETH/USDC)
 *   - 3000  (0.30%): 60   — standard pairs (most pools)
 *   - 10000 (1.00%): 200  — exotic / volatile pairs
 */
export const TICK_SPACINGS: Readonly<Record<Uniswapv3FeeTier, number>> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
} as const;

// ---------------------------------------------------------------------------
// getSqrtRatioAtTick → tickToSqrtPriceX96
// ---------------------------------------------------------------------------

/**
 * Compute `sqrt(1.0001^tick) * 2^96` (Q64.96).
 *
 * Verbatim port of v3-core TickMath.sol#getSqrtRatioAtTick lines 23-54. The
 * iterative-shift constants are mathematically derived log_{1.0001} of 2^{-k}
 * and MUST NOT be altered — each one expresses `sqrt(1.0001^{2^k})` in Q128
 * fixed-point.
 *
 * Wrapping discipline: each `ratio = (ratio * constant) >> 128` is performed
 * modulo 2^256 (the on-chain implicit wrap). We model this with explicit
 * `BigInt.asUintN(256, ...)` since JS bigint is arbitrary precision.
 *
 * Throws: `tick out of range` if `|tick| > MAX_TICK`.
 */
export function tickToSqrtPriceX96(tick: number): bigint {
  if (!Number.isInteger(tick)) {
    throw new Error(`tickToSqrtPriceX96: tick must be an integer (got ${tick})`);
  }
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`tickToSqrtPriceX96: tick out of range (${tick})`);
  }
  const absTick = BigInt(tick < 0 ? -tick : tick);

  // Initial ratio: 1.0001^{2^0} in Q128.128 if bit 0 set, else 2^128.
  let ratio =
    (absTick & 0x1n) !== 0n
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;

  const mul = (k: bigint, c: bigint) => {
    if ((absTick & k) !== 0n) {
      ratio = BigInt.asUintN(256, (ratio * c) >> 128n);
    }
  };
  mul(0x2n,     0xfff97272373d413259a46990580e213an);
  mul(0x4n,     0xfff2e50f5f656932ef12357cf3c7fdccn);
  mul(0x8n,     0xffe5caca7e10e4e61c3624eaa0941cd0n);
  mul(0x10n,    0xffcb9843d60f6159c9db58835c926644n);
  mul(0x20n,    0xff973b41fa98c081472e6896dfb254c0n);
  mul(0x40n,    0xff2ea16466c96a3843ec78b326b52861n);
  mul(0x80n,    0xfe5dee046a99a2a811c461f1969c3053n);
  mul(0x100n,   0xfcbe86c7900a88aedcffc83b479aa3a4n);
  mul(0x200n,   0xf987a7253ac413176f2b074cf7815e54n);
  mul(0x400n,   0xf3392b0822b70005940c7a398e4b70f3n);
  mul(0x800n,   0xe7159475a2c29b7443b29c7fa6e889d9n);
  mul(0x1000n,  0xd097f3bdfd2022b8845ad8f792aa5825n);
  mul(0x2000n,  0xa9f746462d870fdf8a65dc1f90e061e5n);
  mul(0x4000n,  0x70d869a156d2a1b890bb3df62baf32f7n);
  mul(0x8000n,  0x31be135f97d08fd981231505542fcfa6n);
  mul(0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n);
  mul(0x20000n, 0x5d6af8dedb81196699c329225ee604n);
  mul(0x40000n, 0x2216e584f5fa1ea926041bedfe98n);
  mul(0x80000n, 0x48a170391f7dc42444e8fa2n);

  // For positive ticks, invert (the constants are for negative-tick branch).
  if (tick > 0) {
    ratio = (TWO_256 - 1n) / ratio;
  }

  // Q128.128 → Q128.96 with round-up; downcast to uint160 (guaranteed by tick
  // bound). The mod-1<<32 round-up matches the canonical Solidity off-by-one
  // anchor: getTickAtSqrtRatio(getSqrtRatioAtTick(t)) === t.
  const shifted = ratio >> 32n;
  const remainder = ratio & ((1n << 32n) - 1n);
  return shifted + (remainder === 0n ? 0n : 1n);
}

// ---------------------------------------------------------------------------
// getTickAtSqrtRatio → sqrtPriceX96ToTick
// ---------------------------------------------------------------------------

/**
 * Compute the greatest tick `t` such that `getSqrtRatioAtTick(t) <= sqrtPriceX96`.
 *
 * Verbatim port of v3-core TickMath.sol#getTickAtSqrtRatio lines 61-204. The
 * MSB lookup + log_2 fixed-point chain is the canonical inverse — round-trip
 * with `tickToSqrtPriceX96(sqrtPriceX96ToTick(s))` is byte-stable up to the
 * tick's resolution.
 *
 * Throws: `sqrtPriceX96 out of range` if `s < MIN_SQRT_RATIO` or `s >= MAX_SQRT_RATIO`.
 */
export function sqrtPriceX96ToTick(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
    throw new Error(`sqrtPriceX96ToTick: sqrtPriceX96 out of range (${sqrtPriceX96})`);
  }
  // ratio = sqrtPriceX96 << 32 (Q160 → Q192).
  const ratio = sqrtPriceX96 << 32n;

  // MSB lookup — find the index of the highest set bit in `ratio`.
  let r = ratio;
  let msb = 0n;
  const shifts: readonly [bigint, bigint][] = [
    [0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn, 7n],
    [0xFFFFFFFFFFFFFFFFn, 6n],
    [0xFFFFFFFFn, 5n],
    [0xFFFFn, 4n],
    [0xFFn, 3n],
    [0xFn, 2n],
    [0x3n, 1n],
    [0x1n, 0n],
  ];
  for (const [threshold, bitShift] of shifts) {
    const f = r > threshold ? 1n << bitShift : 0n;
    msb |= f;
    r >>= f;
  }

  // Re-anchor `r` at Q128 around msb position.
  if (msb >= 128n) {
    r = ratio >> (msb - 127n);
  } else {
    r = ratio << (127n - msb);
  }

  // log_2 = (msb - 128) << 64  (Q64.64 representation of the integer part).
  let log_2 = (msb - 128n) << 64n;

  // 14 iterations of Newton-style mantissa refinement.
  for (let i = 0n; i < 14n; i++) {
    r = (r * r) >> 127n;
    const f = r >> 128n;
    log_2 |= f << (63n - i);
    r >>= f;
  }

  // Convert log_2 → log_{sqrt(1.0001)} via the canonical multiplier 255738958999603826347141.
  const log_sqrt10001 = log_2 * 255738958999603826347141n;

  // Two-tick candidate window for round-up correctness.
  // tickLow:  (log_sqrt10001 - error_low) >> 128
  // tickHigh: (log_sqrt10001 + error_high) >> 128
  // Cast via `signedShift128` because JS bigint right-shift is arithmetic on
  // negatives, matching the Solidity int256 semantics.
  const tickLow = Number(arithShiftRight(log_sqrt10001 - 3402992956809132418596140100660247210n, 128n));
  const tickHi = Number(arithShiftRight(log_sqrt10001 + 291339464771989622907027621153398088495n, 128n));

  if (tickLow === tickHi) return tickLow;
  // tickHi is valid iff getSqrtRatioAtTick(tickHi) <= sqrtPriceX96.
  return tickToSqrtPriceX96(tickHi) <= sqrtPriceX96 ? tickHi : tickLow;
}

/** Arithmetic right shift for bigint — matches Solidity int256 `>>`. */
function arithShiftRight(value: bigint, bits: bigint): bigint {
  // JS `>>` on bigint is arithmetic (sign-extending) but only for negative
  // values represented natively. Since our input is a signed log value, the
  // sign carries through bigint's two's-complement-by-convention.
  if (value >= 0n) return value >> bits;
  // For negative: −((−value − 1) >> bits) − 1 implements floor-divide.
  return -((-(value + 1n)) >> bits) - 1n;
}

// ---------------------------------------------------------------------------
// priceToSqrtPriceX96 / sqrtPriceX96ToPrice (human-decimal interfaces)
// ---------------------------------------------------------------------------

/**
 * Convert a human-decimal price (token1 per token0, e.g. "1900.5" USDC/WETH)
 * into `sqrtPriceX96` (Q64.96). Handles decimal asymmetry: `price` is in
 * human-units; the on-chain raw `price = (token1_raw / token0_raw) =
 * (price_human * 10^decimals1 / 10^decimals0)`.
 *
 * Implementation: parse decimal string with up to 36 decimal places of
 * precision (sufficient for tick math), then compute integer square root via
 * Newton's method.
 *
 * Throws on negative / malformed input.
 */
export function priceToSqrtPriceX96(
  price: string,
  decimals0: number,
  decimals1: number,
): bigint {
  // Parse decimal string into a scaled bigint (price * 10^36).
  const scale = 36;
  const [intPart, fracPart = ""] = price.split(".");
  if (intPart === undefined || /[^0-9]/.test(intPart) || /[^0-9]/.test(fracPart)) {
    throw new Error(`priceToSqrtPriceX96: malformed price (${price})`);
  }
  if (intPart === "" && fracPart === "") {
    throw new Error(`priceToSqrtPriceX96: empty price`);
  }
  const fracPadded = (fracPart + "0".repeat(scale)).slice(0, scale);
  const priceScaled = BigInt(intPart + fracPadded); // price * 10^scale
  if (priceScaled === 0n) {
    throw new Error(`priceToSqrtPriceX96: price must be > 0`);
  }

  // Raw token1/token0 ratio = priceScaled * 10^(decimals1 - decimals0) / 10^scale
  // sqrtPriceX96 = sqrt(rawRatio) * 2^96
  //              = sqrt(rawRatio * 2^192)
  //              = sqrt(priceScaled * 10^(decimals1 - decimals0) * 2^192 / 10^scale)
  // We compute the radicand exactly, then integer sqrt.
  let numerator = priceScaled * Q192;
  let denominator = 10n ** BigInt(scale);
  const expDiff = decimals1 - decimals0;
  if (expDiff > 0) {
    numerator *= 10n ** BigInt(expDiff);
  } else if (expDiff < 0) {
    denominator *= 10n ** BigInt(-expDiff);
  }
  const radicand = numerator / denominator;
  return bigintSqrt(radicand);
}

/**
 * Inverse of `priceToSqrtPriceX96`. Returns a decimal-string price with
 * 18 fractional digits (sufficient for human display + downstream agent
 * relay).
 */
export function sqrtPriceX96ToPrice(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): string {
  // rawRatio = sqrtPriceX96^2 / 2^192
  // priceHuman = rawRatio * 10^(decimals0 - decimals1)
  //
  // We compute price * 10^18 (18 decimals of human precision) as a bigint,
  // then format.
  const HUMAN_DECIMALS = 18n;
  let numerator = sqrtPriceX96 * sqrtPriceX96 * 10n ** HUMAN_DECIMALS;
  let denominator = Q192;
  const expDiff = decimals0 - decimals1;
  if (expDiff > 0) {
    numerator *= 10n ** BigInt(expDiff);
  } else if (expDiff < 0) {
    denominator *= 10n ** BigInt(-expDiff);
  }
  const scaled = numerator / denominator;
  return formatScaledBigint(scaled, Number(HUMAN_DECIMALS));
}

function formatScaledBigint(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const intPart = abs / base;
  const fracPart = abs % base;
  if (fracPart === 0n) {
    return (negative ? "-" : "") + intPart.toString();
  }
  const fracStr = fracPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  return (negative ? "-" : "") + intPart.toString() + (fracStr.length > 0 ? "." + fracStr : "");
}

// ---------------------------------------------------------------------------
// priceToTick / tickToPrice
// ---------------------------------------------------------------------------

/** Convert decimal human price → integer tick (rounded toward minus-infinity by canonical algorithm). */
export function priceToTick(
  price: string,
  decimals0: number,
  decimals1: number,
): number {
  const s = priceToSqrtPriceX96(price, decimals0, decimals1);
  return sqrtPriceX96ToTick(s);
}

/** Convert tick → decimal human price string (18 decimals of precision). */
export function tickToPrice(
  tick: number,
  decimals0: number,
  decimals1: number,
): string {
  const s = tickToSqrtPriceX96(tick);
  return sqrtPriceX96ToPrice(s, decimals0, decimals1);
}

// ---------------------------------------------------------------------------
// snapPriceToTick
// ---------------------------------------------------------------------------

/**
 * Snap a decimal price to the nearest valid tick for the given fee tier.
 * Returns the snapped tick + snapped human price + the snap delta in bps
 * (basis-points absolute difference between the input price and the snapped
 * price).
 *
 * Per CONTEXT.md D-03: the caller refuses on snapDeltaBps > 100 (1%) — this
 * function ALWAYS returns a snap result; the refusal is the prepare tool's
 * responsibility, not this primitive's.
 */
export function snapPriceToTick(
  price: string,
  fee: Uniswapv3FeeTier,
  decimals0: number,
  decimals1: number,
): { tick: number; snappedPrice: string; snapDeltaBps: number } {
  const rawTick = priceToTick(price, decimals0, decimals1);
  const spacing = TICK_SPACINGS[fee];
  // Round to nearest multiple of `spacing`, with .5 → up.
  const snapped = Math.round(rawTick / spacing) * spacing;
  const snappedPrice = tickToPrice(snapped, decimals0, decimals1);

  // snapDeltaBps = |snappedPrice - price| / price * 10000
  // Compute via scaled bigint to preserve precision.
  const scale = 36n;
  const SCALE_BIG = 10n ** scale;
  const parseScaled = (s: string): bigint => {
    const [int, frac = ""] = s.split(".");
    const fracPadded = (frac + "0".repeat(Number(scale))).slice(0, Number(scale));
    return BigInt(int + fracPadded);
  };
  const inputScaled = parseScaled(price);
  const snappedScaled = parseScaled(snappedPrice);
  const diff = inputScaled > snappedScaled ? inputScaled - snappedScaled : snappedScaled - inputScaled;
  if (inputScaled === 0n) {
    return { tick: snapped, snappedPrice, snapDeltaBps: 0 };
  }
  // bps = diff / input * 10000  →  scale up by 10000 first, then divide.
  const bpsBig = (diff * 10000n) / inputScaled;
  // Clamp to a JS number range (basis points stay well under 2^53 for any sane price).
  const snapDeltaBps = Number(bpsBig);
  return { tick: snapped, snappedPrice, snapDeltaBps };
  // Note: void SCALE_BIG — kept as a local constant for code clarity, the
  // parseScaled closure binds `scale` directly.
}

// ---------------------------------------------------------------------------
// bigintSqrt — Newton's-method integer square root
// ---------------------------------------------------------------------------

/**
 * Integer square root of a non-negative bigint via Newton's method.
 * Returns the largest bigint `s` such that `s * s <= n`.
 */
function bigintSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error(`bigintSqrt: negative input (${n})`);
  if (n < 2n) return n;
  // Initial guess: a power-of-2 upper bound.
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Tests can
 * `vi.spyOn(_uniswapV3Tick, "priceToTick")` to intercept without
 * monkey-patching named exports (ESM bindings are immutable; direct spies
 * are no-ops for module-internal calls). Mirror of `_uniswapV3Path` in
 * src/signing/uniswap-path.ts.
 */
export const _uniswapV3Tick = {
  priceToSqrtPriceX96,
  sqrtPriceX96ToPrice,
  tickToSqrtPriceX96,
  sqrtPriceX96ToTick,
  priceToTick,
  tickToPrice,
  snapPriceToTick,
};
