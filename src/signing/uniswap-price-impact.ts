// src/signing/uniswap-price-impact.ts
//
// Uniswap V3 price-impact math — Phase 32 Plan 32-02 (UNI-01).
//
// Pure-bigint Quoter-midpoint price-impact computation. NO side effects. NO
// RPC reads. NO module-load state. All arithmetic in bigint; the single
// bigint-to-number cast at the final return is safe — the value is capped at
// 10000n which fits comfortably in a JS-safe integer.
//
// Per CONTEXT.md D-04b: Phase 32 v2.4 ships the SIMPLIFIED midpoint method —
// the caller computes a "fair" output by quoting a tiny amount (amountIn /
// 10000n) through the same fee tier and scaling the result back. Production-
// grade midpoint sourcing (Chainlink / TWAP / external oracle) deferred to
// v2.6 Phase 40 (per-L2 calibration).
//
// Per RESEARCH § Topic 5 (algorithm derivation):
//   tinyAmount = amountIn / 10000n          (caller-side; sub-base-unit fallback
//                                            is the caller's concern, not this
//                                            helper's)
//   tinyOut    = Quoter V2(tinyAmount).out
//   fairOut    = tinyOut * 10000n           (scale back — impact-free reference)
//   actualOut  = Quoter V2(amountIn).out
//   drop       = fairOut > actualOut ? fairOut - actualOut : 0n  (floor at 0n)
//   priceImpactBps = (drop * 10000n) / fairOut                   (capped at 10000)
//
// Locked on src/signing/ to keep the trust-pipeline shelf coherent — mirrors
// the pure-math separation pattern of src/signing/eigenlayer-shares.ts +
// src/signing/rocketpool-rate.ts + src/signing/lido-rebase.ts.
//
// Residual risk (T-32-PRICE-IMPACT-UNDERSTATEMENT, per RESEARCH § Topic 5):
//   The Quoter-midpoint method UNDERSTATES impact on pools with extremely
//   concentrated liquidity at the spot tick where the tiny-amount reference
//   cannot detect the cliff. Mitigation: D-08's 2% sandwich-MEV refusal
//   threshold errs on the side of refusal — even understated impact > 2%
//   triggers the gate. SECURITY.md §6 v2.4 addendum (Plan 32-03) carries the
//   user-facing disclosure.
//
// ESM spy-affordance: `_uniswapV3PriceImpact` wraps the helper so tests can
// `vi.spyOn(_uniswapV3PriceImpact, "computePriceImpactBps")` without
// monkey-patching named exports (ESM bindings are immutable; direct spies are
// no-ops for module-internal calls). Per CLAUDE.md § Conventions.
//
// Consumed by:
//   - src/tools/get_uniswap_quote.ts   (Plan 32-02 — text + structured envelope)
//   - src/tools/prepare_uniswap_swap.ts (Plan 32-03 — sandwich-MEV gate at
//                                       prepare time after re-fetching the quote)

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Inputs for `computePriceImpactBps`. The caller computes these from two
 * Quoter V2 reads: one tiny-amount quote (scaled back) for the fair-price
 * reference, and one full-amount quote for the actual swap output.
 */
export interface PriceImpactInput {
  /**
   * Impact-free fair-price reference. Caller computes this as
   * `tinyOut * scaleFactor` where `tinyOut = QuoterV2(amountIn / 10000n).out`
   * and `scaleFactor = 10000n` (or `amountIn / tinyAmount` after sub-base-unit
   * fallback). May be 0n (degenerate — see edge case 1 in
   * `computePriceImpactBps`).
   */
  fairOut: bigint;
  /**
   * Quoter V2 output for the full `amountIn` at the SELECTED fee tier (the
   * tier that won auto-fee-tier selection — D-04). Should be ≤ `fairOut`
   * under normal conditions; if greater (RPC noise / tick math rounding) the
   * helper floors `drop` at 0n.
   */
  actualOut: bigint;
}

// ---------------------------------------------------------------------------
// computePriceImpactBps — pure-bigint Quoter-midpoint math
// ---------------------------------------------------------------------------

/**
 * Compute price-impact in basis points (0..10000) per D-04b Quoter-midpoint
 * method. ALL bigint arithmetic; the single bigint-to-number cast at the
 * final return is safe — value capped at 10000n which fits in a JS-safe
 * integer.
 *
 * Edge cases (deterministic):
 *   1. `fairOut === 0n` → returns 10000 (degenerate — no reference price
 *      available; conservative: treat as 100% impact so the sandwich-MEV
 *      gate trips).
 *   2. `actualOut > fairOut` (RPC noise / favorable execution) → `drop`
 *      clamped to 0n → returns 0 (cannot have negative impact).
 *   3. `bps > 10000n` (theoretical — RPC bug or extreme math) → capped at
 *      10000 (safety net; 100% is the structural max).
 *
 * Happy-path formula:
 *   drop = fairOut - actualOut
 *   bps  = (drop * 10000n) / fairOut    (integer-division truncates toward 0)
 *
 * Residual risk per D-04b: UNDERSTATES impact on pools with extremely
 * concentrated liquidity at the spot tick where the tiny-amount reference
 * cannot detect the cliff; mitigation = D-08 2% sandwich-MEV refusal
 * threshold.
 *
 * Reference fixtures pinned in test/signing-uniswap-price-impact.test.ts.
 */
export function computePriceImpactBps(input: PriceImpactInput): number {
  // Edge case 1 — degenerate (no reference price); conservative max impact.
  if (input.fairOut === 0n) {
    return 10000;
  }
  // Edge case 2 — actualOut > fairOut (RPC rounding noise / favorable
  // execution); floor drop at 0n so we cannot emit negative impact.
  const drop =
    input.fairOut > input.actualOut ? input.fairOut - input.actualOut : 0n;
  const bps = (drop * 10000n) / input.fairOut;
  // Edge case 3 — cap at 10000 (safety net for RPC bug or extreme math).
  return Number(bps > 10000n ? 10000n : bps);
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Tests can
 * `vi.spyOn(_uniswapV3PriceImpact, "computePriceImpactBps")` to intercept
 * without monkey-patching named exports (ESM bindings are immutable; direct
 * spies are no-ops for module-internal calls). Mirror of
 * `_eigenLayerShares` in src/signing/eigenlayer-shares.ts and
 * `_rocketPoolRate` in src/signing/rocketpool-rate.ts.
 */
export const _uniswapV3PriceImpact = { computePriceImpactBps };
