# Phase 31: EigenLayer + Rocket Pool — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 31`)

<domain>
## Phase Boundary

User can deposit LSTs into EigenLayer for restaking, and stake / unstake on Rocket Pool (rETH). EigenLayer is Ethereum-only; Rocket Pool is Ethereum-only. Two protocols bundled in one phase since they're both small write surfaces (one prepare tool each + one read tool each).

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 31`. Anchor candidates:

- **EigenLayer strategy targeting**: `prepare_eigenlayer_deposit({ strategy, lst, amount })` requires the user to specify which strategy + which LST. Curated strategy registry in `src/config/contracts.ts` (top strategies by TVL at planning time — stETH, rETH, native ETH, etc.); long-tail surfaces as `[UNKNOWN STRATEGY]` label.
- **EigenLayer-specific operator-delegation flow**: out of scope for Phase 31 — Phase 31 ships deposit-only. `prepare_eigenlayer_delegate` + `_undelegate` flow tracked in v2.x backlog.
- **Rocket Pool rETH mint/burn**: stake mints rETH from the `RocketDepositPool`; unstake burns rETH via `rETH.burn`. Both are atomic single-tx operations (no queue-based withdrawal like Lido).
- **Rocket Pool node operator deposits**: out of scope for Phase 31 — Phase 31 ships standard user-side stake/unstake only.

### Claude's Discretion

- Internal helper names (`EigenLayerReader`, `RocketPoolReader`, etc.)
- Whether EigenLayer + Rocket Pool ship as separate Phase 31a/31b or merged in one phase (merged is the current plan)
- Fixture literal anchor values

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — `src/config/contracts.ts` SOT
- `.planning/REQUIREMENTS.md` §EIG-01/02 + §RP-01/02 — exact Phase 31 surface
- `.planning/ROADMAP.md` Phase 31
- EigenLayer docs — https://docs.eigenlayer.xyz/
- Rocket Pool docs — https://docs.rocketpool.net/

</canonical_refs>

<specifics>
## Specific Ideas

- EigenLayer's restaking model: user deposits an LST (stETH, rETH, native ETH via EigenPod) into a strategy; the strategy is what AVS operators target for slashing rewards. Phase 31 ships deposit only; the slashing-risk surfacing is informational in CHECKS PERFORMED (no enforcement).
- Rocket Pool rETH is a non-rebasing receipt token (value-per-share grows over time); `get_rocketpool_positions` surfaces both rETH balance and current ETH-equivalent value.
- Both protocols have well-defined Ledger CAL clear-sign coverage (per research at execute time); LEDGER NOTICE block needed only if a specific selector falls outside CAL coverage.

</specifics>

<deferred>
## Deferred Ideas

- EigenLayer operator-delegation flow — v2.x backlog
- EigenLayer queue-based withdrawal (post-Holesky upgrade) — surface in `get_eigenlayer_positions` as accrued; defer claim flow to v2.x
- Rocket Pool node-operator deposits (16 ETH minipool) — out of scope; niche operational flow
- Other LSTs (Frax sfrxETH, Coinbase cbETH, etc.) — defer to v2.x demand-driven

</deferred>

---

*Phase: 31-evm-eigenlayer-rocket-pool*
*Context placeholder: 2026-05-20*
