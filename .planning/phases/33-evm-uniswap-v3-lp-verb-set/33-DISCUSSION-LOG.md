# Phase 33 Discussion Log

**Date:** 2026-05-24
**Mode:** Autonomous (user runs project in high-autonomy mode per memory `autonomous-phase-execution`)

## Pre-existing State

Phase 33 already had a placeholder `33-CONTEXT.md` written 2026-05-20 alongside other v2.4 phase scaffolding. It contained:

- A crisp `<domain>` boundary statement
- 5 "Anchor candidates" listed under `<decisions>` (marked pending)
- Canonical refs to ROADMAP/REQUIREMENTS/CLAUDE.md
- Specifics on NFT-keyed positions, IL estimate caveats, composite-tx convention
- Deferred ideas (Curve / escape hatch / V4 hooks / strategy automation)

## Analysis Performed

1. **Read** `.planning/STATE.md` — Phase 32 (Uniswap V3 swap) closed code-complete 2026-05-23; next phase per roadmap is 33.
2. **Read** `.planning/ROADMAP.md` Phase 33 section — 3 plans pre-outlined with crisp success criteria.
3. **Read** `.planning/REQUIREMENTS.md` UNI-04..10 — exact tool surface defined; Phase 32 already covers UNI-01..03 + the SwapRouter02/Quoter portion of UNI-10.
4. **Read** placeholder `33-CONTEXT.md` — verified all 5 anchor candidates align with REQUIREMENTS + ROADMAP, with no scope conflicts.
5. **Cross-checked** Claude's-Discretion items against scope: composite-tool-vs-multi-tool-flow is pinned by UNI-09 ("is a composite tool that builds a multicall") — so it's NOT discretionary, it's spec-locked.

## Gray-Area Disposition

No gray areas required user input. All decision candidates resolve to one of:

- **Spec-locked** by ROADMAP/REQUIREMENTS (composite tool shape, 5 single-step prepares, NonfungiblePositionManager from contracts.ts SOT, canonical-dispatch allowlist extension, `src/signing/uniswap-tick.ts` placement)
- **Pattern-locked** by Phase 7/Phase 32 (mechanical-clone of `prepare_aave_supply` shape, KNOWN_SPENDERS row promotion convention, Fixtures-as-hardcoded-literals discipline)
- **Researcher scope-probe candidate** per CLAUDE.md SDK Scope-Probing Discipline (whether to adopt `@uniswap/v3-sdk` or hand-roll tick math — deferred to RESEARCH.md verdict at planning gate)
- **Specifics with clear default + researcher confirmation** (IL-estimate ambiguity heuristic; whether `mint` needs explicit `amount0Min`/`amount1Min` MEV gate)

## Decisions Made Autonomously (Promoted from Placeholder)

The 5 placeholder anchor candidates were promoted to locked decisions and 2 more were added:

1. **Tick math placement** → `src/signing/uniswap-tick.ts` (per UNI-10). SDK vs hand-rolled deferred to researcher.
2. **IL estimate as labeled approximation** → both raw + net-of-fees, prefixed `[ESTIMATE]`, with `ilEstimateConfidence: "low" | "high"` for the ambiguous-entry-price case.
3. **Tick-as-price agent interface** → agent passes decimal prices, server snaps; refuse if snap delta > 100 bps.
4. **NonfungiblePositionManager from `src/config/contracts.ts`** SOT extension, mirroring Phase 32's `getUniswapV3SwapRouter02` getter shape.
5. **Canonical-dispatch allowlist** → one-row diff on `CANONICAL_DISPATCH_TARGETS.ethereum`.
6. **Composite-tx preview shape** (NEW pattern, establishes v2.5 Safe three-step convention) → one tool / one handle / one calldata payload; `preview_send` surfaces step N/N decoded sub-blocks.
7. **Plan structure** → 3 plans, sequential: 33-01 reads + tick math + contracts SOT; 33-02 five single-step prepares + fixtures; 33-03 rebalance composite + composite preview shape + fixture F.

## Deferred Ideas

Carried over from placeholder with one addition (WETH-pair convenience entry points):

- Multi-chain LP (Polygon/Arbitrum/Base/Optimism) — v2.4.x
- Curve swap + add-liquidity — Phase 34
- `prepare_custom_call` escape hatch — Phase 35
- Uniswap V4 hooks — v3.x
- LP-strategy automation — out of v2.4 scope (verb-set only)
- WETH-pair convenience entry points (mint with native ETH) — out of v2.4 scope; users pre-wrap via Phase 6's `prepare_weth_wrap`
- `prepare_uniswap_v3_swap_via_lp_router` — speculative, not on roadmap

## Output

`33-CONTEXT.md` finalized 2026-05-24. Ready for `/gsd-plan-phase 33`.
