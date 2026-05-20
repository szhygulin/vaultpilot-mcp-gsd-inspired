# Phase 40: Sandwich-MEV slippage hint per-L2 thresholds — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 40`)

<domain>
## Phase Boundary

Sandwich-MEV slippage refusal extends from Ethereum mainnet (v2.4 Phase 32 default 50bps / >2% price-impact refusal) to per-L2 thresholds. Per-L2 thresholds reflect each chain's actual sandwich-MEV exposure — Arbitrum + Optimism + Base + Polygon have different mempool semantics from Ethereum (some L2s have private mempools that virtually eliminate sandwich risk; others are public + sandwich-prone).

v2.6 milestone close-out: SECURITY.md per-L2 MEV section finalization.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 40`. Anchor candidates:

- **Per-chain threshold values (DF)**: researcher to calibrate at execute time based on actual sandwich-MEV exposure data. Initial proposal: Ethereum 50bps default / >2% refusal (unchanged from Phase 32); Arbitrum/Base/Optimism 30bps default / >3% refusal (private-sequencer mempools); Polygon 100bps default / >2% refusal (public mempool, high MEV).
- **`src/config/sandwich-mev-thresholds.ts` SOT**: per-chain table — `Record<ChainId, { defaultSlippageBps: number, priceImpactRefusalPct: number }>`. Lazy-loaded; consumed by `prepare_uniswap_swap` / `prepare_curve_swap` / future EVM swap tools.
- **Env override**: `MEV_THRESHOLD_<CHAIN>=<bps>` (e.g. `MEV_THRESHOLD_ETHEREUM=100` to relax). Validates as positive integer; refuses on invalid.
- **`SANDWICH_MEV_REFUSED` errorCode**: structured refusal includes chain name + threshold values + the actual price impact + user-action hint ("explicitly set `slippageBps` if you accept the higher risk").

### Claude's Discretion

- Final per-chain threshold values — researcher's data-driven call at execute time
- Whether per-chain thresholds ship for all 5 v1.2 EVM chains or only the highest-volume subset
- SECURITY.md per-L2 MEV section wording

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — sandwich-MEV refusal pattern (Phase 14 Jupiter + Phase 32 Uniswap)
- `.planning/REQUIREMENTS.md` §MEV-01 — exact Phase 40 surface
- `.planning/ROADMAP.md` Phase 40
- `src/tools/prepare_uniswap_swap.ts` (Plan 32-02) — sandwich-MEV gate Phase 40 extends per-chain
- `src/chains/registry.ts` (Plan 08-01) — multi-chain `ChainId` literal-union + per-chain config Phase 40 inherits

</canonical_refs>

<specifics>
## Specific Ideas

- Per-L2 MEV exposure: Arbitrum + Optimism + Base have private sequencer mempools — transactions aren't visible to MEV bots until they're already ordered. Sandwich-MEV is structurally low. Polygon's mempool is public + high-volume MEV searcher activity — sandwich-MEV is structurally high.
- Threshold tuning is a calibration vs not a security boundary — too-tight thresholds trigger frequent false refusals (annoying); too-loose thresholds let real sandwich attacks through. Researcher's data-driven call at execute time is the right scope.
- SECURITY.md per-L2 MEV section should call out the threat-model nuance: "sandwich-MEV exposure is per-chain, not per-tool — same swap on Polygon is higher-risk than the same swap on Arbitrum." Users running multi-chain workflows benefit from understanding this.

</specifics>

<deferred>
## Deferred Ideas

- MEV-resistant transaction submission (Flashbots Protect / MEV Blocker / SecureRPC) — out of scope per PROJECT.md "MEV-resistant tx submission" deferred to v3+ backlog
- Per-tool MEV exposure tuning (Curve vs Uniswap have different MEV profiles even on the same chain) — defer; per-chain suffices
- Dynamic threshold adjustment based on mempool conditions — out of scope; static per-chain SOT suffices

</deferred>

---

*Phase: 40-mev-sandwich-slippage-hint-per-l2*
*Context placeholder: 2026-05-20*
