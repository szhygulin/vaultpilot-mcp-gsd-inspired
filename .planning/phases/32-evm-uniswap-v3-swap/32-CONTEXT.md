# Phase 32: Uniswap V3 swap (auto-fee-tier, same-chain) — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 32`)

<domain>
## Phase Boundary

User can swap ERC-20↔ERC-20 (and WETH-wrapped ETH) on Uniswap V3 with auto-fee-tier selection (best price across 0.01% / 0.05% / 0.30% / 1.00% pools). Multi-hop routing through Uniswap V3's Quoter V2 when single-hop has worse price. Sandwich-MEV defense at >2% price impact (default 50bps slippage hint; refuses without explicit `slippageBps` at high impact).

LP verb set is Phase 33. Curve is Phase 34. Escape hatch is Phase 35.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 32`. Anchor candidates:

- **Quoter V2 vs Quoter V1 (DF)**: Quoter V2 is the current SOT (`0x61fFE014bA17989E743c5F6cB21bF9697530B21e` on Ethereum). Researcher to verify per-chain Quoter V2 deployment + scope-probe whether SwapRouter02 + UniversalRouter is the right router target for v2.4 (UniversalRouter is newer, supports Permit2; SwapRouter02 is the v1 router).
- **Auto-fee-tier selection algorithm**: Quoter V2's `quoteExactInputSingle` returns the best fee-tier across all pools for a given pair; Phase 32 trusts the Quoter's selection. Multi-hop routing via `quoteExactInput` (path-based).
- **Sandwich-MEV >2% refusal**: mirrors v2.0 Phase 14 Jupiter + v2.1 Phase 20 SunSwap (default 50 bps; refuses without explicit `slippageBps` at >2% price impact). v2.6 Phase 40 extends with per-L2 thresholds.
- **`get_uniswap_quote` returning the route path**: agent surfaces the route path to the user so they see whether the swap is single-hop or multi-hop (multi-hop adds gas cost + slippage risk per hop).
- **Canonical dispatch allowlist**: SwapRouter02 + Quoter V2 addresses added to Uniswap arm; per-chain table extension.

### Claude's Discretion

- Internal helper names (`UniswapQuoter`, `selectFeeTier`, etc.)
- Whether UniversalRouter is the v2.4 target (decided at researcher's scope-probe time)
- Fixture Y literal anchor value

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — `src/config/contracts.ts` SOT + sandwich-MEV refusal pattern
- `.planning/REQUIREMENTS.md` §UNI-01/02/03/10 — exact Phase 32 surface
- `.planning/ROADMAP.md` Phase 32
- `src/tools/prepare_jupiter_swap.ts` (Plan 14-02) — sandwich-MEV refusal + slippage-bounded execution pattern Phase 32 mirrors
- `src/protocols/aave-v3.ts` + Phase 7 — protocol-decoder pattern; Phase 32 mirrors for Uniswap
- Uniswap V3 docs — https://docs.uniswap.org/contracts/v3/overview

</canonical_refs>

<specifics>
## Specific Ideas

- Sandwich-MEV refusal gate logic: at preview time, simulate the swap via `eth_call` against the Quoter; compute price impact from `(expectedOut - actualOut) / expectedOut`; refuse if >2% AND `slippageBps` not explicitly set by the agent.
- Auto-fee-tier output surfacing in CHECKS PERFORMED: `Path: USDC → 0.05% → ETH` (single-hop) or `Path: USDC → 0.30% → ETH → 0.05% → WBTC` (multi-hop). Path strings are human-readable for the user.
- Phase 32 ships swap-only; LP tooling (mint / increase / decrease / collect / burn / rebalance) is Phase 33.

</specifics>

<deferred>
## Deferred Ideas

- Uniswap V3 full LP verb set — Phase 33
- Uniswap V2 (legacy) — out of scope; v2.4 is V3-only
- Uniswap X (intent-based RFQ) — out of scope; needs intent-based signing
- Permit2 integration via UniversalRouter — defer until typed-data clear-sign lands
- Cross-chain Uniswap (Uniswap V4 with `delta` hooks) — defer to v3.x

</deferred>

---

*Phase: 32-evm-uniswap-v3-swap*
*Context placeholder: 2026-05-20*
