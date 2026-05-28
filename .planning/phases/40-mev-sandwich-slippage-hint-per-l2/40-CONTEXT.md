# Phase 40: Sandwich-MEV slippage hint per-L2 thresholds — Context

**Gathered:** 2026-05-28
**Status:** Context gathered — ready for `/gsd-plan-phase 40`

<domain>
## Phase Boundary

Sandwich-MEV slippage refusal extends from Ethereum mainnet (v2.4 Phase 32 default 50bps / >2% price-impact refusal) to per-L2 thresholds. Per-L2 thresholds reflect each chain's actual sandwich-MEV exposure — Arbitrum + Optimism + Base have private sequencer mempools (structurally low sandwich risk); Polygon's mempool is public + high MEV-searcher activity (structurally high).

This is also the **v2.6 milestone close-out**: SECURITY.md per-L2 MEV section finalization.

</domain>

<decisions>
## Implementation Decisions (LOCKED)

- **Scope = parametrize the EXISTING Uniswap gate per-chain (user decision 2026-05-28).** `prepare_uniswap_swap` already has the sandwich-MEV gate (today: `INVALID_INPUT` + `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` + hintTool, fixed 50bps default / >2% refusal). Phase 40 makes that gate's thresholds per-chain from a new SOT. **`prepare_curve_swap` does NOT get a gate** — it deliberately has none (Phase 34: explicit `slippageBps` [1,5000] + 50% footgun cap, no price-impact refusal). Leave Curve's model unchanged; update its CHECKS-PERFORMED note to reference that the per-L2 SOT is Uniswap-scoped and Curve stays explicit-slippage-only by design. "Future EVM swap tools" can opt into the SOT later.

- **`SANDWICH_MEV_REFUSED` errorcode — migrate EVM + TRON (user decision 2026-05-28).** Add `"SANDWICH_MEV_REFUSED"` to the `ErrorCode` union in `src/signing/error-codes.ts` (append-only — current tail is `DECODED_RECIPIENT_DRIFT`). Migrate the EXISTING sandwich refusals from `INVALID_INPUT` to `SANDWICH_MEV_REFUSED` in BOTH `prepare_uniswap_swap` (EVM) AND `prepare_sunswap_swap` (TRON) for one consistent refusal contract across all chains. This is a behavior change — existing tests asserting `INVALID_INPUT` for sandwich refusal MUST be updated to `SANDWICH_MEV_REFUSED`. The refusal TEMPLATES (`SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` blocks.ts, `SANDWICH_MEV_REFUSAL_TRON_TEMPLATE` blocks-tron.ts) stay; only the errorcode field changes (and the structured refusal gains chain-name + threshold values + actual price impact + the existing `slippageBps`-override hint). Keep the `hintTool` if present.

- **`src/config/sandwich-mev-thresholds.ts` SOT** — per-chain table `Record<ChainId, { defaultSlippageBps: number; priceImpactRefusalPct: number }>` over the EVM `ChainId` literal-union from `src/chains/registry.ts`. Lazy-loaded; consumed by `prepare_uniswap_swap` (and `get_uniswap_quote`'s warning threshold if the planner finds it should track the same SOT — confirm in research). TRON's SunSwap threshold stays in its own TRON path (not in this EVM SOT); only its errorcode migrates.

- **Env override `MEV_THRESHOLD_<CHAIN>=<bps>`** (e.g. `MEV_THRESHOLD_ETHEREUM=100` to relax). Validates as a positive integer; refuses on invalid. Per-chain override of the default slippage bps (and/or refusal pct — planner decides the exact override semantics; keep it simple: override the default slippage bps).

- **`SANDWICH_MEV_REFUSED` structured refusal** includes chain name + threshold values + the actual price impact + user-action hint ("explicitly set `slippageBps` if you accept the higher risk").

### Claude's Discretion

- Final per-chain threshold VALUES — researcher's data-driven calibration at research time (initial proposal in <specifics>; the researcher confirms against real L2 sandwich-MEV exposure data).
- Whether per-chain thresholds ship for all 5 v1.2 EVM chains (ethereum, polygon, arbitrum, optimism, base) or a subset — default to all 5 (the SOT covers the configured-chain set).
- Whether `get_uniswap_quote`'s `SANDWICH_MEV_WARNING_THRESHOLD_BPS` (currently fixed 200) should read the per-chain SOT — confirm in research; if cheap and consistent, do it; else leave the quote-warning fixed and note the asymmetry.
- SECURITY.md per-L2 MEV section wording + v2.6 milestone close-out summary shape.

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — sandwich-MEV refusal pattern; FROZEN-area discipline; append-only error-codes/blocks
- `.planning/REQUIREMENTS.md` §MEV-01 — exact Phase 40 surface
- `.planning/ROADMAP.md` Phase 40 + v2.6 milestone close-out note
- `src/tools/prepare_uniswap_swap.ts` (Plan 32-02) — the EXISTING sandwich-MEV gate Phase 40 parametrizes per-chain (see line ~31 comment + the `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` usage)
- `src/tools/prepare_sunswap_swap.ts` (Plan 20) — TRON sandwich gate (D-03b, >200bps); errorcode migrates here too
- `src/tools/prepare_curve_swap.ts` (Plan 34) — NO gate by design; Phase 40 leaves it, updates the CHECKS-PERFORMED note only
- `src/tools/get_uniswap_quote.ts` — `SANDWICH_MEV_WARNING_THRESHOLD_BPS = 200` (line 69) quote-warning; research confirms whether it tracks the SOT
- `src/signing/error-codes.ts` — `ErrorCode` union (append `SANDWICH_MEV_REFUSED` after `DECODED_RECIPIENT_DRIFT`)
- `src/signing/blocks.ts` — `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` (line ~2126); `src/signing/blocks-tron.ts` — `SANDWICH_MEV_REFUSAL_TRON_TEMPLATE` (line ~629)
- `src/chains/registry.ts` (Plan 08-01) — multi-chain `ChainId` literal-union + per-chain config the SOT keys on
- `SECURITY.md` — append per-L2 MEV section + v2.6 close-out

</canonical_refs>

<specifics>
## Specific Ideas

- Per-L2 MEV exposure: Arbitrum + Optimism + Base have private sequencer mempools — txs aren't visible to MEV bots until ordered; sandwich-MEV is structurally low. Polygon's mempool is public + high-volume MEV searcher activity; sandwich-MEV is structurally high. Ethereum mainnet public mempool is the baseline (Phase 32: 50bps / >2%).
- Initial threshold proposal (researcher confirms/adjusts): Ethereum 50bps default / >2% refusal (UNCHANGED from Phase 32); Arbitrum/Base/Optimism 30bps default / >3% refusal (private-sequencer); Polygon 100bps default / >2% refusal (public, high MEV). These are a CALIBRATION, not a security boundary — too-tight = false-refusal annoyance; too-loose = real sandwiches slip through.
- SECURITY.md per-L2 MEV section should state the threat-model nuance: "sandwich-MEV exposure is per-chain, not per-tool — the same swap on Polygon is higher-risk than on Arbitrum." Multi-chain users benefit from understanding this.
- Migration note: flipping Uniswap + SunSwap sandwich refusal from `INVALID_INPUT` to `SANDWICH_MEV_REFUSED` is observable — grep all tests asserting the old errorcode on the sandwich path and update them; this is the bulk of the test delta.

</specifics>

<deferred>
## Deferred Ideas

- Adding a sandwich-MEV price-impact gate to `prepare_curve_swap` — explicitly NOT done (user decision 2026-05-28: parametrize Uniswap only; Curve stays explicit-slippage-only by design).
- MEV-resistant transaction submission (Flashbots Protect / MEV Blocker / SecureRPC) — out of scope per PROJECT.md, deferred to v3+ backlog.
- Per-tool MEV exposure tuning (Curve vs Uniswap differ even on the same chain) — defer; per-chain suffices.
- Dynamic threshold adjustment based on live mempool conditions — out of scope; static per-chain SOT suffices.

</deferred>

---

*Phase: 40-mev-sandwich-slippage-hint-per-l2*
*Context gathered: 2026-05-28 (2 design forks resolved via AskUserQuestion: Curve scope = parametrize-Uniswap-only; errorcode reach = EVM+TRON)*
