# Phase 28: Compound V3 — multi-Comet supply / withdraw / borrow / repay — Context

**Gathered:** 2026-05-20
**Status:** Locked — research/patterns/plans committed; ready for execution

Decisions in `<decisions>` are LOCKED per research and patterns; execute-time changes require replan.

<domain>
## Phase Boundary

User can read Compound V3 positions per Comet (each Comet is a single-borrow-asset isolated market) and supply / withdraw / borrow / repay. Multi-Comet support means the agent specifies which Comet to interact with. Ethereum mainnet first; multi-chain (Arbitrum / Polygon / Base / Optimism) deferred to v2.3.x follow-up if Compound's per-chain Comet deployment is mature at planning time.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 28`. Anchor candidates:

- **Comet address per-chain (DF)**: Compound V3 deploys one Comet per (chain, borrowAsset) pair — `cWETHv3` / `cUSDCv3` etc. Researcher to enumerate active Comets at planning time + verify Ledger CAL clear-sign coverage. Phase 28 ships Ethereum-first; multi-chain v2.3.x.
- **Health-factor math**: Compound V3 uses asset-specific collateral factors per Comet; HF computation diverges from Aave V3's normalized HF. Phase 28 ships `src/signing/compound-health.ts` (mirrors v1.1 `src/signing/aave-health.ts` pure-bigint shape).
- **`amount: "max"` close-position**: server-side resolves to outstanding-debt amount + small buffer (≈1% to cover interest accrual between prepare and broadcast). Mirrors Morpho Phase 29 pattern.
- **Per-Comet decoder**: each Comet has the same ABI but different addresses; `prepare_compound_*` tools take `cometAddress` explicitly so the agent commits to which market.
- **Canonical dispatch allowlist**: each Comet address added to allowlist; per-chain `CompoundComets` table extension.

### Claude's Discretion

- Internal helper names (`CompoundCometReader`, `parseCompoundHealthFactor`, etc.)
- Fixture R + Fixture S literal anchor values
- Whether multi-chain Comet support ships in Phase 28 or v2.3.x follow-up — researcher to assess at planning gate

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — `src/config/contracts.ts` SOT discipline
- `.planning/REQUIREMENTS.md` §CMP-01..06 — exact Phase 28 surface
- `.planning/ROADMAP.md` Phase 28
- `src/protocols/aave-v3.ts` (Phase 7) — protocol-decoder pattern Phase 28 mirrors for Compound V3
- `src/signing/aave-health.ts` (Phase 7) — pure-bigint HF math shape; Phase 28 clones for Compound
- Compound V3 docs — https://docs.compound.finance/

</canonical_refs>

<specifics>
## Specific Ideas

- Compound V3's isolated-market design means each Comet is a fully independent lending pool — supplying to `cUSDCv3` doesn't borrow against `cWETHv3` positions. The agent MUST specify `cometAddress` per-call; no implicit "default Comet".
- Mechanical-clone-of-Aave shape: `prepare_compound_supply` clones `prepare_aave_supply`; `_withdraw` clones `_withdraw`; `_borrow` and `_repay` are new shapes Aave V3 didn't ship.
- Health-factor surface in `get_compound_positions`: per-position HF + the asset-specific collateral factors that drive it; agent + user see the load-bearing inputs not just the output.

</specifics>

<deferred>
## Deferred Ideas

- Multi-chain Compound V3 (Arbitrum / Polygon / Base / Optimism) — v2.3.x if deployment is mature
- Compound V2 (legacy cTokens) — out of scope; v2.3 is V3-only
- Compound borrow-with-COMP-incentive accrual — surface APR in `get_compound_market_info`, defer claim-rewards flow to follow-up

</deferred>

---

*Phase: 28-evm-compound-v3-supply-withdraw-borrow-repay*
*Context placeholder: 2026-05-20*
