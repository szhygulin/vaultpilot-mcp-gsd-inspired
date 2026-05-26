// Phase 35 Plan 35-03 (CUSTOM-01). Selector → canonical-tool routing table for
// `prepare_custom_call`'s structured-refusal path. The escape hatch
// (`prepare_custom_call`) intentionally bypasses the canonical-dispatch
// allowlist — when the agent supplies calldata whose first 4 bytes match a
// protocol-aware `prepare_*` tool, the refusal text steers the agent toward
// the canonical-dispatch-routed path BEFORE the user has to make a bypass
// decision.
//
// NOT a widening of `KNOWN_SPENDERS_ETHEREUM` (which is per-address labels
// for approval UI). This table maps 4-byte function SELECTORS to the
// protocol-aware `prepare_*` tool that handles them.
//
// Each row: `{ selector, tool, reason }`. The selector source-of-truth is the
// per-protocol `_SELECTORS` constants in `src/protocols/*.ts` — this table is
// curated by audit, NOT derived. Selector collisions (e.g.,
// `0xd0e30db0 = WETH9.deposit = RocketPool.deposit`; `0x42966c68 = rETH.burn
// = NPM.burn`) are surfaced via the FIRST matching row (rationale: any
// suggestion is more useful than none; the user reads the rationale text
// before deciding to bypass).
//
// ESM spy-affordance per project CLAUDE.md: `_canonicalAlternatives` mirrors
// the `_canonicalDispatch` pattern in `src/security/canonical-dispatch.ts:298`.

import type { Hex } from "viem";

/**
 * One row in the curated selector → tool table.
 *
 *   `selector` — 0x-prefixed 8-hex (4-byte function selector). Lowercase by
 *                convention; the lookup helper normalizes on read so
 *                checksummed input matches.
 *   `tool`     — the `prepare_*` tool name (no chain qualifier) the user
 *                should call instead. Surface verbatim in the refusal text
 *                so the agent can self-correct.
 *   `reason`   — human-readable rationale. Names the protocol + function
 *                signature so the user can cross-check the selector match.
 */
export interface CanonicalAlternative {
  selector: Hex;
  tool: string;
  reason: string;
}

/**
 * Curated selector → tool table. Audited against `src/protocols/*.ts` on
 * 2026-05-26. APPEND-ONLY: new prepare_* tools land their selectors here,
 * existing rows stay byte-frozen so refusal text doesn't drift across
 * releases.
 */
export const CANONICAL_ALTERNATIVES: readonly CanonicalAlternative[] = [
  // ERC-20 (src/protocols/erc20.ts)
  {
    selector: "0xa9059cbb",
    tool: "prepare_token_send",
    reason: "ERC-20 transfer(address to, uint256 amount)",
  },
  {
    selector: "0x095ea7b3",
    tool: "prepare_token_approve",
    reason: "ERC-20 approve(address spender, uint256 amount)",
  },
  // WETH9 (src/protocols/weth9.ts)
  {
    selector: "0x2e1a7d4d",
    tool: "prepare_weth_unwrap",
    reason: "WETH9.withdraw(uint256 amount)",
  },
  // Aave V3 Pool (src/protocols/aave-v3.ts)
  {
    selector: "0x617ba037",
    tool: "prepare_aave_supply",
    reason: "Aave V3 Pool.supply(asset, amount, onBehalfOf, referralCode)",
  },
  {
    selector: "0x69328dec",
    tool: "prepare_aave_withdraw",
    reason: "Aave V3 Pool.withdraw(asset, amount, to)",
  },
  // Compound V3 Comet (src/protocols/compound-v3.ts) — supply/withdraw cover
  // four agent-facing intents (supply/withdraw/borrow/repay) via the
  // base/collateral disambiguation inside Compound V3 itself.
  {
    selector: "0xf2b9fdb8",
    tool: "prepare_compound_supply",
    reason: "Compound V3 Comet.supply(asset, amount) — also covers prepare_compound_repay (asset is base token)",
  },
  {
    selector: "0xf3fef3a3",
    tool: "prepare_compound_withdraw",
    reason: "Compound V3 Comet.withdraw(asset, amount) — also covers prepare_compound_borrow (asset is base token)",
  },
  // Morpho Blue (src/protocols/morpho-blue.ts)
  {
    selector: "0xa99aad89",
    tool: "prepare_morpho_supply",
    reason: "Morpho Blue.supply(marketParams, assets, shares, onBehalf, data)",
  },
  {
    selector: "0x5c2bea49",
    tool: "prepare_morpho_withdraw",
    reason: "Morpho Blue.withdraw(marketParams, assets, shares, onBehalf, receiver)",
  },
  {
    selector: "0x238d6579",
    tool: "prepare_morpho_supply_collateral",
    reason: "Morpho Blue.supplyCollateral(marketParams, assets, onBehalf, data)",
  },
  {
    selector: "0x8720316d",
    tool: "prepare_morpho_withdraw_collateral",
    reason: "Morpho Blue.withdrawCollateral(marketParams, assets, onBehalf, receiver)",
  },
  {
    selector: "0x50d8cd4b",
    tool: "prepare_morpho_borrow",
    reason: "Morpho Blue.borrow(marketParams, assets, shares, onBehalf, receiver)",
  },
  {
    selector: "0x20b76e81",
    tool: "prepare_morpho_repay",
    reason: "Morpho Blue.repay(marketParams, assets, shares, onBehalf, data)",
  },
  // Lido (src/protocols/lido.ts)
  {
    selector: "0xa1903eab",
    tool: "prepare_lido_stake",
    reason: "Lido.submit(address referral) — payable, ETH stake amount in msg.value",
  },
  {
    selector: "0xd6681042",
    tool: "prepare_lido_unstake",
    reason: "WithdrawalQueue.requestWithdrawals(uint256[] amounts, address owner) — Lido unstake NFT receipt",
  },
  {
    selector: "0xea598cb0",
    tool: "prepare_lido_wrap",
    reason: "WstETH.wrap(uint256 stETHAmount) — stETH → wstETH",
  },
  {
    selector: "0xde0e9a3e",
    tool: "prepare_lido_unwrap",
    reason: "WstETH.unwrap(uint256 wstETHAmount) — wstETH → stETH",
  },
  // EigenLayer (src/protocols/eigenlayer.ts)
  {
    selector: "0xe7a050aa",
    tool: "prepare_eigenlayer_deposit",
    reason: "EigenLayer StrategyManager.depositIntoStrategy(strategy, token, amount)",
  },
  // Rocket Pool (src/protocols/rocketpool.ts) — selector 0xd0e30db0 collides
  // with WETH9.deposit; this row maps to the RocketDepositPool semantics
  // because Phase 35 has no prepare_weth_wrap tool yet. selector 0x42966c68
  // (rETH.burn) collides with NPM.burn (Uniswap V3 LP); we list rETH first
  // because the unstake intent is more common at this layer of the stack.
  {
    selector: "0xd0e30db0",
    tool: "prepare_rocketpool_stake",
    reason: "RocketDepositPool.deposit() — payable, ETH stake amount in msg.value (collides with WETH9.deposit; no prepare_weth_wrap tool exists yet)",
  },
  {
    selector: "0x42966c68",
    tool: "prepare_rocketpool_unstake",
    reason: "rETH.burn(uint256 amount) — Rocket Pool unstake (collides with NPM.burn — use prepare_uniswap_v3_burn for empty-position close)",
  },
  // Uniswap V3 Swap (src/protocols/uniswap-v3.ts)
  {
    selector: "0x04e45aaf",
    tool: "prepare_uniswap_swap",
    reason: "Uniswap V3 SwapRouter02.exactInputSingle(params) — single-hop swap",
  },
  {
    selector: "0xb858183f",
    tool: "prepare_uniswap_swap",
    reason: "Uniswap V3 SwapRouter02.exactInput(params) — multi-hop swap with packed path",
  },
  {
    selector: "0x5ae401dc",
    tool: "prepare_uniswap_swap",
    reason: "Uniswap V3 SwapRouter02.multicall(uint256 deadline, bytes[] data) — D-10 outer deadline wrapper",
  },
  // Uniswap V3 LP (src/protocols/uniswap-v3-lp.ts)
  {
    selector: "0x88316456",
    tool: "prepare_uniswap_v3_mint",
    reason: "NonfungiblePositionManager.mint(MintParams) — new Uniswap V3 LP position",
  },
  {
    selector: "0x219f5d17",
    tool: "prepare_uniswap_v3_increase_liquidity",
    reason: "NonfungiblePositionManager.increaseLiquidity(IncreaseLiquidityParams)",
  },
  {
    selector: "0x0c49ccbe",
    tool: "prepare_uniswap_v3_decrease_liquidity",
    reason: "NonfungiblePositionManager.decreaseLiquidity(DecreaseLiquidityParams)",
  },
  {
    selector: "0xfc6f7865",
    tool: "prepare_uniswap_v3_collect",
    reason: "NonfungiblePositionManager.collect(CollectParams) — harvest LP fees",
  },
  {
    selector: "0xac9650d8",
    tool: "prepare_uniswap_v3_rebalance",
    reason: "NonfungiblePositionManager.multicall(bytes[]) — composite rebalance (decrease-all + collect + mint)",
  },
  // Curve (src/protocols/curve.ts)
  {
    selector: "0x3df02124",
    tool: "prepare_curve_swap",
    reason: "Curve legacy exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) — stETH/ETH pool",
  },
  {
    selector: "0xddc1f59d",
    tool: "prepare_curve_swap",
    reason: "Curve stable_ng exchange(int128 i, int128 j, uint256 dx, uint256 min_dy, address receiver)",
  },
  {
    selector: "0xb72df5de",
    tool: "prepare_curve_add_liquidity",
    reason: "Curve stable_ng add_liquidity(uint256[] amounts, uint256 min_mint_amount)",
  },
];

/**
 * Case-insensitive selector → row lookup. Returns the first matching row
 * (collision case — see file header) or `null` when no match is found.
 *
 * Callers MUST handle the null return — the null is itself meaningful
 * information for the user (no canonical alternative recognized; the bypass
 * was the agent's explicit choice).
 */
export function lookupCanonicalAlternative(
  selector: Hex,
): CanonicalAlternative | null {
  const normalized = selector.toLowerCase();
  const match = CANONICAL_ALTERNATIVES.find(
    (c) => c.selector.toLowerCase() === normalized,
  );
  return match ?? null;
}

/**
 * ESM spy-affordance — wrap the lookup helper in a mutable object so
 * `vi.spyOn(_canonicalAlternatives, "lookupCanonicalAlternative")` can
 * intercept. Per CLAUDE.md § Conventions: ESM named-export bindings are
 * immutable; a direct `vi.spyOn` on the named export is a no-op for
 * internal calls. Indirection here keeps the test seam open.
 *
 * Mirror of `_canonicalDispatch` at `src/security/canonical-dispatch.ts:298`.
 */
export const _canonicalAlternatives = { lookupCanonicalAlternative };
