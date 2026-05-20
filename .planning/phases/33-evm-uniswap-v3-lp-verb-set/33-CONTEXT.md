# Phase 33: Uniswap V3 full LP verb set + `get_lp_positions` with IL estimate — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 33`)

<domain>
## Phase Boundary

User can manage Uniswap V3 LP positions end-to-end — mint new position with tick range, increase liquidity, decrease liquidity, collect fees, burn (close) position, rebalance (multicall: decrease all + collect + mint at new range). `get_lp_positions` returns positions with current price + tick range + in-range/out-of-range flag + accrued fees + impermanent-loss estimate (relative to a hodl baseline).

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 33`. Anchor candidates:

- **Tick math (DF)**: tick ↔ sqrtPriceX96 ↔ price conversions are non-trivial bigint math. Researcher to scope-probe `@uniswap/v3-sdk` vs hand-rolled implementation at execute time. Phase 33 ships `src/signing/uniswap-tick.ts` per outcome.
- **IL estimate baseline**: impermanent-loss vs hodl-baseline computation needs the user's entry price (from mint event) + current price. Approximate (doesn't account for accrued fees offsetting IL). Phase 33 surfaces both raw IL + net-of-fees IL in `get_lp_positions`.
- **`prepare_uniswap_v3_rebalance` multicall builder**: composite tx (decrease all + collect + mint at new range) is structurally distinct from single-step prepare tools. Phase 33 introduces a `composite-tx preview` shape — preview block surfaces the multi-step decoded view (each step as a sub-block).
- **NonfungiblePositionManager address**: sourced from `src/config/contracts.ts` per-chain table; canonical-dispatch allowlist extension.
- **Tick-as-price surfacing**: agent passes prices and decimals (`priceLower: "1900.5"`, `priceUpper: "2100.0"`); server resolves to ticks using current pool sqrtPriceX96. Avoids forcing the agent to do tick math.

### Claude's Discretion

- Internal helper names (`UniswapV3LpReader`, `tickToHumanPrice`, etc.)
- Fixture literal anchor values for each of mint / increase / decrease / collect / burn shapes
- Whether `prepare_uniswap_v3_rebalance` is a single tool or a multi-tool flow the agent orchestrates

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — `src/config/contracts.ts` SOT + composite-tx pattern (new shape)
- `.planning/REQUIREMENTS.md` §UNI-04..10 — exact Phase 33 surface
- `.planning/ROADMAP.md` Phase 33
- `src/tools/prepare_aave_supply.ts` (Phase 7) — mechanical-clone pattern; Phase 33's 5 mint/increase/decrease/collect/burn tools clone this shape
- Uniswap V3 NonfungiblePositionManager docs — https://docs.uniswap.org/contracts/v3/reference/periphery/NonfungiblePositionManager

</canonical_refs>

<specifics>
## Specific Ideas

- LP positions are NFT-keyed (each position is an ERC-721 token at the NonfungiblePositionManager); `get_lp_positions` scans the user's NFT balances via the standard ERC-721 enumeration + decodes each position.
- IL estimate is a useful but approximate signal — surface as `[ESTIMATE]` labeled with disclaimer; never as a precise number. Users with sophisticated LP strategies should be told the estimate is a rough hint, not a precise PnL.
- `prepare_uniswap_v3_rebalance` is the first **composite-tx** in the codebase — preview shape needs to surface "step 1 / step 2 / step 3" decoded sub-blocks. Phase 33 establishes the convention for future composite-tx tools (Safe multisig three-step in v2.5 uses the same shape).
- Tick math complexity: tick spacing per fee tier (60 for 0.30%, 200 for 1.00%) constrains which ticks are valid; the server snaps user-supplied prices to the nearest valid tick + surfaces the snap in CHECKS PERFORMED.

</specifics>

<deferred>
## Deferred Ideas

- Curve swap + add-liquidity — Phase 34
- Escape hatch — Phase 35
- Uniswap V4 hooks — defer to v3.x
- LP-strategy automation (auto-rebalance on out-of-range) — out of scope; v2.4 is verb-set only

</deferred>

---

*Phase: 33-evm-uniswap-v3-lp-verb-set*
*Context placeholder: 2026-05-20*
