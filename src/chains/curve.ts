// src/chains/curve.ts — Phase 34 Plan 34-01 Task 2
//
// Curve Finance ABI shelf + RPC reader helpers. Mirrors src/chains/aave-v3.ts
// shape: parseAbi structs at top, async helper functions, _curveChain ESM
// spy-affordance indirection at bottom.
//
// Analogs per PATTERNS.md:
//   - File shape: src/chains/aave-v3.ts (exact analog)
//   - parseAbi naming: src/chains/uniswap-v3.ts (SWAP_ROUTER_02_ABI convention)
//
// ABI version dispatch: The registry's `abiVersion` tag ("legacy" | "stable_ng")
// drives which exchange ABI to use. This file exports BOTH ABIs separately so
// callers import by name — no runtime confusion.
//
// ESM spy-affordance: `_curveChain` is the MUTABLE indirection object callers
// route through so `vi.spyOn(_curveChain, "getCurveGetDy")` etc. can intercept
// in tests. Per CLAUDE.md "ESM spy-affordance indirection" convention — added
// AT WRITE TIME, not retroactively.
//
// READS ONLY: this file owns the READ path (get_dy, calc_token_amount, balanceOf).
// The ENCODER path (exchange / add_liquidity calldata assembly) lives in
// src/protocols/curve.ts (Plan 34-03).

import { type Address, type PublicClient, parseAbi } from "viem";

// ---------------------------------------------------------------------------
// ABI fragments — 6 named exports per plan spec.
//
// Selector table (verified at research time 2026-05-26 via viem.toFunctionSelector):
//   CURVE_LEGACY_EXCHANGE_ABI   → 0x3df02124  exchange(int128,int128,uint256,uint256)
//   CURVE_NG_EXCHANGE_ABI       → 0xddc1f59d  exchange(int128,int128,uint256,uint256,address)
//   CURVE_GET_DY_ABI            → 0x5e0d443f  get_dy(int128,int128,uint256)
//   CURVE_NG_ADD_LIQUIDITY_ABI  → 0xb72df5de  add_liquidity(uint256[],uint256) — 2-param form
//   CURVE_NG_CALC_TOKEN_AMOUNT_ABI → 0x3db06dd8 calc_token_amount(uint256[],bool)
//   CURVE_LP_BALANCE_OF_ABI     → 0x70a08231  balanceOf(address)
// ---------------------------------------------------------------------------

/**
 * Legacy stETH/ETH pool exchange ABI.
 * Source: curvefi/curve-contract StableSwapSTETH.vy — `@payable` `exchange(int128,int128,uint256,uint256)`.
 * Selector: 0x3df02124.
 *
 * Caller note: when i === 0 (ETH-in on legacy pool), set `tx.value = dx`.
 * The pool's `@payable` checks `msg.value == dx` internally.
 */
export const CURVE_LEGACY_EXCHANGE_ABI = parseAbi([
  "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) payable returns (uint256)",
]);

/**
 * stable_ng pool exchange ABI (factory-stable-ng generation).
 * Source: curvefi/stableswap-ng CurveStableSwapNG.vy — `exchange(int128,int128,uint256,uint256,address)`.
 * Selector: 0xddc1f59d.
 *
 * The `_receiver` parameter defaults to `msg.sender` on-chain; server always
 * passes the signer address explicitly (from-dependent calldata for Fixture CRV-B).
 * stable_ng `exchange` is NOT payable.
 */
export const CURVE_NG_EXCHANGE_ABI = parseAbi([
  "function exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver) returns (uint256)",
]);

/**
 * `get_dy` quote ABI — same 3-param signature across legacy AND stable_ng.
 * Source: both StableSwapSTETH.vy and CurveStableSwapNG.vy expose the same
 * pool-level `get_dy(int128, int128, uint256) -> uint256`. The stable_ng version
 * delegates to the views contract internally (Pitfall 1 from RESEARCH.md) — the
 * caller only needs this 3-param pool-level ABI; do NOT call the 4-param
 * StableSwapViews form directly.
 * Selector: 0x5e0d443f.
 */
export const CURVE_GET_DY_ABI = parseAbi([
  "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
]);

/**
 * stable_ng `add_liquidity` ABI — 2-param form (no `_receiver` override).
 * Source: curvefi/stableswap-ng CurveStableSwapNG.vy — `add_liquidity(uint256[],uint256)`.
 * Selector: 0xb72df5de (CONTEXT.md locked decision — 2-param form; NOT the
 * 3-param 0xa7256d09 form which includes an explicit `_receiver` argument).
 *
 * Phase 34 scope: stable_ng only. Legacy add_liquidity deferred to v2.4.x.
 * Dynamic `uint256[]` DynArray allows 2-8 coin pools without a separate ABI.
 */
export const CURVE_NG_ADD_LIQUIDITY_ABI = parseAbi([
  "function add_liquidity(uint256[] _amounts, uint256 _min_mint_amount) returns (uint256)",
]);

/**
 * stable_ng `calc_token_amount` quote ABI.
 * Source: curvefi/stableswap-ng CurveStableSwapNG.vy.
 * Selector: 0x3db06dd8.
 *
 * The `_is_deposit` bool disambiguates deposit vs withdrawal LP math. Server
 * ALWAYS passes `true` (deposit direction) — using `false` would compute a
 * withdrawal-direction LP amount, which is the wrong bound for `add_liquidity`.
 */
export const CURVE_NG_CALC_TOKEN_AMOUNT_ABI = parseAbi([
  "function calc_token_amount(uint256[] _amounts, bool _is_deposit) view returns (uint256)",
]);

/**
 * Standard ERC-20 `balanceOf` ABI fragment — used for LP-token balance reads.
 * Selector: 0x70a08231.
 *
 * Caller note: pass the pool's `lpToken` field address (from the registry), NOT
 * the pool address itself (they differ for the legacy stETH/ETH pool — Pitfall 3).
 * For stable_ng pools, `lpToken === pool.address` by construction.
 */
export const CURVE_LP_BALANCE_OF_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

// ---------------------------------------------------------------------------
// Reader helpers — async RPC calls via viem PublicClient.readContract.
// ---------------------------------------------------------------------------

/**
 * Quote `get_dy(i, j, dx)` on a Curve pool (legacy or stable_ng — same ABI).
 *
 * @param client - PublicClient for the relevant chain (chainId=1 at Phase 34).
 * @param poolAddress - The Curve pool contract address.
 * @param i - Input coin index (0-based, matching pool.coins[] order).
 * @param j - Output coin index.
 * @param dx - Input amount in wei (bigint, raw integer units).
 * @returns Quoted output amount dy in wei (bigint).
 *
 * NOTE: int128 params are passed as bigint per viem convention (`BigInt(i)`).
 * Re-fetched at prepare time per RESEARCH.md Pattern 3 (never cache).
 */
export async function getCurveGetDy(
  client: PublicClient,
  poolAddress: Address,
  i: number,
  j: number,
  dx: bigint,
): Promise<bigint> {
  return (await client.readContract({
    address: poolAddress,
    abi: CURVE_GET_DY_ABI,
    functionName: "get_dy",
    args: [BigInt(i), BigInt(j), dx], // int128 encoded as bigint in viem
  })) as bigint;
}

/**
 * Quote `calc_token_amount(amounts, true)` on a stable_ng pool.
 *
 * @param client - PublicClient for the relevant chain.
 * @param poolAddress - The stable_ng pool contract address (NOT the legacy pool).
 * @param amounts - Array of input amounts (bigint[]), one per pool coin.
 * @returns Estimated LP tokens to be minted (bigint, 18 decimals for stable_ng).
 *
 * ALWAYS passes `true` as `_is_deposit` — `false` computes withdrawal-direction
 * LP burn amount, which is wrong for `add_liquidity` slippage derivation.
 * Caller is responsible for refusing on `abiVersion === "legacy"` upstream
 * (this helper doesn't itself dispatch on abiVersion).
 */
export async function getCurveCalcTokenAmount(
  client: PublicClient,
  poolAddress: Address,
  amounts: bigint[],
): Promise<bigint> {
  return (await client.readContract({
    address: poolAddress,
    abi: CURVE_NG_CALC_TOKEN_AMOUNT_ABI,
    functionName: "calc_token_amount",
    args: [amounts, true], // true = deposit
  })) as bigint;
}

/**
 * Read LP-token `balanceOf(wallet)` for a Curve pool.
 *
 * @param client - PublicClient for the relevant chain.
 * @param lpTokenAddress - The LP-token ERC-20 address from the pool registry
 *   entry's `lpToken` field. For stable_ng pools this equals the pool address.
 *   For the legacy stETH/ETH pool this is a SEPARATE contract address. Always
 *   read from the registry — never derive from the pool address alone (Pitfall 3).
 * @param wallet - The wallet address whose LP balance to read.
 * @returns LP token balance in wei (bigint, always 18 decimals for Curve LP tokens).
 */
export async function getCurveLpBalance(
  client: PublicClient,
  lpTokenAddress: Address,
  wallet: Address,
): Promise<bigint> {
  return (await client.readContract({
    address: lpTokenAddress,
    abi: CURVE_LP_BALANCE_OF_ABI,
    functionName: "balanceOf",
    args: [wallet],
  })) as bigint;
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection — CLAUDE.md "ESM spy-affordance indirection"
// convention. Added at WRITE TIME per the convention. Callers (src/tools/
// get_curve_positions.ts, src/tools/prepare_curve_swap.ts, etc.) import and
// call through _curveChain so vi.spyOn can intercept without monkey-patching
// the named export bindings (ESM bindings are immutable; direct spies on named
// exports are no-ops for internal calls).
// ---------------------------------------------------------------------------

export const _curveChain = { getCurveGetDy, getCurveCalcTokenAmount, getCurveLpBalance };
