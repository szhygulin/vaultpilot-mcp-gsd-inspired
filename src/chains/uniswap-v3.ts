// src/chains/uniswap-v3.ts
//
// Uniswap V3 chain client — Phase 32 Plan 32-02 (UNI-01).
//
// Quoter V2 readContract wrapper. Two surfaces:
//   1. quoteAllSingleHopFeeTiers — iterates 4 fee tiers (100/500/3000/10000)
//      in parallel via Promise.allSettled; per-tier reverts mapped to null
//      (T-32-QUOTER-REVERT-POISON mitigation — the non-Settled variant of the
//      parallel-promise primitive would poison the whole batch on any single
//      tier's revert).
//   2. quoteMultiHopCandidates — builds 0..2 candidate paths from the
//      canonical pair-to-fee-tier mapping (CANONICAL_FEE_TIERS, RESEARCH §
//      Topic 10); WETH-anchored and (when applicable) USDC-anchored hops
//      against quoteExactInput(path).
//
// Per CONTEXT.md D-04 auto-fee-tier algorithm:
//   - Single-hop step 1+2: iterate 4 tiers; select max amountOut.
//   - Multi-hop step 3: canonical-mapped intermediate hops (WETH / USDC
//     anchors). Phase 32 does NOT iterate multi-hop fee tiers (combinatorial
//     blowup; deferred to v3.x algorithmic-routing surface).
//   - Step 4 (0.5% improvement threshold) lives in the TOOL layer
//     (src/tools/get_uniswap_quote.ts), not here. This module returns raw
//     candidate quotes.
//
// CANONICAL_FEE_TIERS is the 7-entry hardcoded mapping derived from RESEARCH
// § Topic 10 TVL evidence (2026-05-23). Stability assumption A3 documented in
// RESEARCH; if mainnet TVL distribution shifts, multi-hop quotes pick
// suboptimal tiers but the single-hop arm still wins via the 0.5% threshold —
// graceful degradation to "leaves output on the table" not "broken."
//
// Pitfall 1 anchor (RESEARCH § Topic 1): Quoter V2's QuoteExactInputSingle-
// Params struct field order is (tokenIn, tokenOut, amountIn, fee,
// sqrtPriceLimitX96) — amountIn BEFORE fee; no recipient; no
// amountOutMinimum. This DIFFERS from SwapRouter02's ExactInputSingleParams.
// Drift is a silent bug class — mitigated here by importing QUOTER_V2_ABI
// from src/protocols/uniswap-v3.ts (Plan 32-01) which encodes the canonical
// order; tests assert the readContract args object has the 5 fields in the
// EXACT order.
//
// Pitfall 6 anchor (T-32-QUOTER-REVERT-POISON): Promise.allSettled NOT
// Promise.all. Per-tier reverts are EXPECTED (no pool for that tier). A
// single failing tier must not abort the batch — that would silently route
// a viable swap to D-04a no-liquidity refusal.
//
// Chain scope: Ethereum-mainnet ONLY at v2.4 (D-03). Token anchor
// constants (WETH / USDC / USDT / DAI / WBTC) live as module-level `const`
// declarations sourced from a small hardcoded Ethereum-only table. Downstream
// multi-chain expansion (Phase 40+) will move them to src/config/contracts.ts.
//
// ESM spy-affordance: `_uniswapV3Chain` wraps the 3 public functions so tests
// can `vi.spyOn(_uniswapV3Chain, "quoteAllSingleHopFeeTiers")` without
// monkey-patching named exports. Mirror of `_rocketPoolChains` in
// src/chains/rocketpool.ts.
//
// Consumed by:
//   - src/tools/get_uniswap_quote.ts   (Plan 32-02 — handler routes through
//                                       the _uniswapV3Chain indirection)
//   - test/chains-uniswap-v3.test.ts   (Plan 32-02 unit tests)

import {
  type Address,
  type Hex,
  type PublicClient,
  getAddress,
} from "viem";

import {
  QUOTER_V2_ABI,
  getUniswapV3QuoterV2Address,
} from "../protocols/uniswap-v3.js";
import { type PathHop, _uniswapV3Path } from "../signing/uniswap-path.js";

// ---------------------------------------------------------------------------
// Token anchor constants (Ethereum mainnet)
// ---------------------------------------------------------------------------
//
// These addresses are the ONLY hardcoded literals in this module. They feed
// CANONICAL_FEE_TIERS keys (pairKey-derived) and the WETH/USDC multi-hop
// anchor selection. EIP-55-checksummed via getAddress at module load — a
// corrupted snapshot throws at load, not at first call.
//
// Phase 32 is Ethereum-only by D-03. Multi-chain expansion moves these to
// src/config/contracts.ts in a follow-up phase.

const WETH_ETHEREUM: Address = getAddress(
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
);
const USDC_ETHEREUM: Address = getAddress(
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
);
const USDT_ETHEREUM: Address = getAddress(
  "0xdAC17F958D2ee523a2206206994597C13D831ec7",
);
const DAI_ETHEREUM: Address = getAddress(
  "0x6B175474E89094C44Da98b954EedeAC495271d0F",
);
const WBTC_ETHEREUM: Address = getAddress(
  "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
);

// ---------------------------------------------------------------------------
// pairKey — order-independent address pair join
// ---------------------------------------------------------------------------

/**
 * Build a canonical-mapping lookup key from two addresses. Order-independent:
 * `pairKey(A, B) === pairKey(B, A)`. Format: lowercase-sorted-address pair
 * joined by `|` separator.
 *
 * Used as the key shape for CANONICAL_FEE_TIERS so the table can be
 * consulted regardless of which side the caller passes as tokenIn.
 */
export function pairKey(a: Address, b: Address): string {
  const aL = a.toLowerCase();
  const bL = b.toLowerCase();
  return aL < bL ? `${aL}|${bL}` : `${bL}|${aL}`;
}

// ---------------------------------------------------------------------------
// CANONICAL_FEE_TIERS — 7-entry hardcoded mapping per RESEARCH § Topic 10
// ---------------------------------------------------------------------------

/**
 * Canonical pair-to-fee-tier mapping for Uniswap V3 multi-hop intermediate
 * hops on Ethereum mainnet. Derived from TVL evidence at planning time
 * (RESEARCH § Topic 10, 2026-05-23 — A3 stability assumption documented in
 * RESEARCH § Assumptions Log).
 *
 * 7 entries:
 *   WETH ↔ USDC = 500   (0.05%)
 *   WETH ↔ USDT = 3000  (0.30%)
 *   WETH ↔ WBTC = 3000  (0.30%)
 *   WETH ↔ DAI  = 3000  (0.30%)
 *   USDC ↔ USDT = 100   (0.01%)
 *   USDC ↔ DAI  = 100   (0.01%)
 *   USDT ↔ DAI  = 100   (0.01%)
 *
 * Keyed via pairKey (order-independent). The TVL-as-signal stability window
 * is v2.4..v2.5; re-verify at any Uniswap protocol-major-version bump
 * (V4 / Permit2 era).
 *
 * If the mapping is stale, multi-hop quotes pick suboptimal tiers — but the
 * 0.5% improvement threshold (D-04 step 4, enforced in the tool layer)
 * causes the suboptimal multi-hop to lose to single-hop. Function degrades
 * to "still works" not "broken" (T-32-FEE-TIER-CANONICAL-MAPPING-STALE
 * accept disposition).
 */
export const CANONICAL_FEE_TIERS: Readonly<
  Record<string, 100 | 500 | 3000 | 10000>
> = {
  [pairKey(WETH_ETHEREUM, USDC_ETHEREUM)]: 500,
  [pairKey(WETH_ETHEREUM, USDT_ETHEREUM)]: 3000,
  [pairKey(WETH_ETHEREUM, WBTC_ETHEREUM)]: 3000,
  [pairKey(WETH_ETHEREUM, DAI_ETHEREUM)]: 3000,
  [pairKey(USDC_ETHEREUM, USDT_ETHEREUM)]: 100,
  [pairKey(USDC_ETHEREUM, DAI_ETHEREUM)]: 100,
  [pairKey(USDT_ETHEREUM, DAI_ETHEREUM)]: 100,
};

/**
 * Look up the canonical fee tier for a pair. Returns null if the pair is not
 * in CANONICAL_FEE_TIERS (e.g. arbitrary alt-token pair) — caller treats
 * null as "no canonical mapping; skip this multi-hop candidate."
 */
export function lookupCanonicalFee(
  a: Address,
  b: Address,
): 100 | 500 | 3000 | 10000 | null {
  return CANONICAL_FEE_TIERS[pairKey(a, b)] ?? null;
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/** One single-hop tier's quote result; null if the tier reverted. */
export interface SingleHopQuoteResult {
  fee: 100 | 500 | 3000 | 10000;
  amountOut: bigint;
}

/** One multi-hop candidate's quote result; null if the path reverted. */
export interface MultiHopQuoteResult {
  /** Decoded hops (matches the encoded path; for envelope display). */
  path: PathHop[];
  /** Packed-bytes path consumed by the Quoter V2 quoteExactInput call. */
  encodedPath: Hex;
  amountOut: bigint;
}

// ---------------------------------------------------------------------------
// quoteAllSingleHopFeeTiers
// ---------------------------------------------------------------------------

const SINGLE_HOP_FEE_TIERS: readonly (100 | 500 | 3000 | 10000)[] = [
  100, 500, 3000, 10000,
];

/**
 * Quote a single-hop swap across all 4 standard Uniswap V3 fee tiers in
 * parallel. Per-tier reverts (no pool at that fee tier) mapped to null;
 * the function NEVER throws (T-32-QUOTER-REVERT-POISON mitigation).
 *
 * Uses Promise.allSettled — NOT Promise.all. A single reverted tier must
 * not poison the batch.
 *
 * Quoter V2 readContract args follow the QUOTER V2 struct field order
 * (tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96) per Pitfall 1.
 * `sqrtPriceLimitX96 = 0n` disables the per-pool price-limit check per the
 * Uniswap-canonical pattern; users rely on amountOutMinimum for slippage
 * protection (Phase 32 D-05).
 *
 * @returns Array of length 4 — one entry per fee tier in [100, 500, 3000,
 *          10000] order. Each entry is either { fee, amountOut } or null.
 */
export async function quoteAllSingleHopFeeTiers(
  client: PublicClient,
  params: { tokenIn: Address; tokenOut: Address; amountIn: bigint },
): Promise<Array<SingleHopQuoteResult | null>> {
  const quoterV2 = getUniswapV3QuoterV2Address(1);
  if (quoterV2 === null) {
    // Defensive — Ethereum mainnet SOT slot is populated at Phase 32 D-01;
    // null here would indicate the SOT block was zeroed. Return all-null
    // rather than throw (T-32-QUOTER-REVERT-POISON applies to the batch
    // semantics — the tool layer's D-04a no-liquidity arm fires next).
    return SINGLE_HOP_FEE_TIERS.map(() => null);
  }

  const settled = await Promise.allSettled(
    SINGLE_HOP_FEE_TIERS.map(async (fee) => {
      const r = (await client.readContract({
        address: quoterV2,
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [
          {
            // STRUCT FIELD ORDER (Pitfall 1):
            //   tokenIn → tokenOut → amountIn → fee → sqrtPriceLimitX96
            // Differs from SwapRouter02.ExactInputSingleParams — do NOT
            // harmonize.
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn: params.amountIn,
            fee,
            sqrtPriceLimitX96: 0n,
          },
        ],
      })) as readonly [bigint, bigint, number, bigint];
      return { fee, amountOut: r[0] };
    }),
  );

  return settled.map((s) => (s.status === "fulfilled" ? s.value : null));
}

// ---------------------------------------------------------------------------
// quoteMultiHopCandidates
// ---------------------------------------------------------------------------

/**
 * Build candidate multi-hop paths via CANONICAL_FEE_TIERS, then quote each
 * via Quoter V2 quoteExactInput(path, amountIn) in parallel using
 * Promise.allSettled (per-candidate reverts mapped to null —
 * T-32-QUOTER-REVERT-POISON mitigation applied at the multi-hop arm too).
 *
 * Candidate construction:
 *   - WETH-anchored: skipped if tokenIn === WETH or tokenOut === WETH (no
 *     degenerate hop). Requires CANONICAL_FEE_TIERS to carry both
 *     tokenIn↔WETH and WETH↔tokenOut entries.
 *   - USDC-anchored: skipped if tokenIn === USDC or tokenOut === USDC.
 *     Requires both tokenIn↔USDC and USDC↔tokenOut entries.
 *
 * Returns 0..2 candidates. If both anchors are unavailable (arbitrary
 * alt-token pair), returns [] — no multi-hop attempt; the tool layer's
 * D-04a no-liquidity arm decides whether to refuse based on single-hop
 * results.
 *
 * NOTE on the (Promise.allSettled, [] short-circuit) interaction: when the
 * candidate list is empty we return [] directly WITHOUT calling
 * Promise.allSettled at all — there's nothing to settle. Tests rely on this
 * (the "no anchor available" case asserts result.length === 0).
 */
export async function quoteMultiHopCandidates(
  client: PublicClient,
  params: { tokenIn: Address; tokenOut: Address; amountIn: bigint },
): Promise<Array<MultiHopQuoteResult | null>> {
  const quoterV2 = getUniswapV3QuoterV2Address(1);
  if (quoterV2 === null) {
    return [];
  }

  // Build 0..2 candidate paths.
  const candidates: Array<{ path: PathHop[]; encodedPath: Hex }> = [];

  // WETH-anchored candidate.
  if (
    params.tokenIn !== WETH_ETHEREUM &&
    params.tokenOut !== WETH_ETHEREUM
  ) {
    const feeInToWeth = lookupCanonicalFee(params.tokenIn, WETH_ETHEREUM);
    const feeWethToOut = lookupCanonicalFee(WETH_ETHEREUM, params.tokenOut);
    if (feeInToWeth !== null && feeWethToOut !== null) {
      const path: PathHop[] = [
        {
          tokenIn: params.tokenIn,
          fee: feeInToWeth,
          tokenOut: WETH_ETHEREUM,
        },
        {
          tokenIn: WETH_ETHEREUM,
          fee: feeWethToOut,
          tokenOut: params.tokenOut,
        },
      ];
      const encodedPath = _uniswapV3Path.encodeV3Path(path);
      candidates.push({ path, encodedPath });
    }
  }

  // USDC-anchored candidate.
  if (
    params.tokenIn !== USDC_ETHEREUM &&
    params.tokenOut !== USDC_ETHEREUM
  ) {
    const feeInToUsdc = lookupCanonicalFee(params.tokenIn, USDC_ETHEREUM);
    const feeUsdcToOut = lookupCanonicalFee(USDC_ETHEREUM, params.tokenOut);
    if (feeInToUsdc !== null && feeUsdcToOut !== null) {
      const path: PathHop[] = [
        {
          tokenIn: params.tokenIn,
          fee: feeInToUsdc,
          tokenOut: USDC_ETHEREUM,
        },
        {
          tokenIn: USDC_ETHEREUM,
          fee: feeUsdcToOut,
          tokenOut: params.tokenOut,
        },
      ];
      const encodedPath = _uniswapV3Path.encodeV3Path(path);
      candidates.push({ path, encodedPath });
    }
  }

  if (candidates.length === 0) {
    // No anchor available in the canonical mapping; skip multi-hop entirely.
    return [];
  }

  const settled = await Promise.allSettled(
    candidates.map(async (c) => {
      const r = (await client.readContract({
        address: quoterV2,
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInput",
        args: [c.encodedPath, params.amountIn],
      })) as readonly [bigint, readonly bigint[], readonly number[], bigint];
      return {
        path: c.path,
        encodedPath: c.encodedPath,
        amountOut: r[0],
      };
    }),
  );

  return settled.map((s) => (s.status === "fulfilled" ? s.value : null));
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Tests + tool-layer
 * production callers route through this object so
 * `vi.spyOn(_uniswapV3Chain, "quoteAllSingleHopFeeTiers")` can intercept
 * without monkey-patching named exports (ESM bindings are immutable; direct
 * spies are no-ops for module-internal calls). Mirror of `_rocketPoolChains`
 * in src/chains/rocketpool.ts.
 */
export const _uniswapV3Chain = {
  quoteAllSingleHopFeeTiers,
  quoteMultiHopCandidates,
  lookupCanonicalFee,
};
