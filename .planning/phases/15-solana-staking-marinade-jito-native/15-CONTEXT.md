# Phase 15: Staking — Marinade + Jito + native SOL — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 15`)

<domain>
## Phase Boundary

User can stake on Marinade (mSOL), Jito (jitoSOL stake pool), and via native SOL delegate/deactivate/withdraw flows. Marinade ships with immediate-unstake (incurs fee surfaced in `CHECKS PERFORMED`); Jito ships deposit-only per upstream gap (unstake deferred). Native Stake Program delegate/deactivate/withdraw lifecycle ships in full. Stake-account creation sub-helper invoked by `prepare_solana_delegate` when no stake account exists for the wallet.

Marinade + Jito program IDs + native Stake Program added to canonical-dispatch allowlist.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 15`. Anchor candidates:

- **Marinade SDK / instruction encoding**: `@marinade.finance/marinade-ts-sdk` exposes typed instruction builders. Researcher to scope-probe at execute time per `rnd` skill.
- **Jito stake-pool SDK**: `@solana/spl-stake-pool` covers Jito's stake-pool program. Researcher to confirm.
- **Native Stake Program**: `@solana/web3.js` (or `@solana/kit`) exposes `StakeProgram.createAccount` / `delegate` / `deactivate` / `withdraw` directly.
- **Marinade immediate-unstake fee**: surfaced verbatim in `CHECKS PERFORMED` — load-bearing because the user is paying a fee for early liquidity vs. waiting the standard ~2-day delayed-unstake.
- **Jito unstake gap**: emit explicit `[NOTICE — Jito stake-pool unstake not yet supported]` block at preview time. The gap is upstream (Jito's SPL stake-pool has unstake but withdrawal-authority complexity makes it non-trivial — defer to v2.x backlog).
- **Stake account creation**: `prepare_solana_delegate` checks for an existing stake account; if absent, the prepared transaction includes `StakeProgram.createAccount` + `StakeProgram.delegate` as a single bundle (atomic from the user's perspective). Researcher to confirm Ledger SOL app can clear-sign the bundled instruction set.
- **Vote-account validation**: `prepare_solana_delegate` should optionally validate the vote account is currently active (researcher to define UX: hard refuse vs. NOTICE block with vote-account name from registry).

### Claude's Discretion

- Internal helper names
- Whether to surface validator commission % in `CHECKS PERFORMED` (likely yes — it directly affects yield)

</decisions>

<canonical_refs>
## Canonical References

### Project context
- `.planning/REQUIREMENTS.md` §SOL-W-14..20 — exact Phase 15 requirement surface
- `.planning/ROADMAP.md` Phase 15 — Success Criteria + Plans list

### Pattern references
- Phase 12 Solana trust pipeline primitives (mechanical clones)
- Phase 13 Solana sub-table in `src/config/contracts.ts` (Phase 15 extends with Marinade + Jito program IDs + native Stake Program)
- Phase 6 `⚠ UNLIMITED APPROVAL` strict-equality surfacing pattern (Phase 15 uses similar verbatim-fee surfacing for Marinade immediate-unstake)

### External
- Marinade docs — https://docs.marinade.finance/
- `@marinade.finance/marinade-ts-sdk` — https://github.com/marinade-finance/marinade-ts-sdk
- Jito stake-pool docs — https://www.jito.network/
- `@solana/spl-stake-pool` — https://github.com/solana-labs/solana-program-library/tree/master/stake-pool
- Solana native Stake Program — https://docs.solanalabs.com/runtime/programs/stake
- Vote-account registry / validator metadata — researcher to surface canonical source (e.g. Solana Foundation validator metadata)

</canonical_refs>

<specifics>
## Specific Ideas

- The Jito unstake gap is the most surprising-to-users issue in this phase — the deposit-only NOTICE block should be unmissable.
- Marinade's immediate-unstake fee is variable (depends on liquidity pool state); fetch at quote time, surface verbatim.
- Native SOL staking is a 3-step lifecycle (delegate → deactivate → withdraw) with a ~2-day deactivation window. The withdraw tool should NOT refuse mid-deactivation; researcher to confirm the right UX (NOTICE block with deactivation-completion time? or hard refuse?).

</specifics>

<deferred>
## Deferred Ideas

- Jito stake-pool unstake — defer until Jito's withdrawal-authority story clarifies
- Multi-validator delegation (split stake) — defer to v3.x ergonomics
- LST swap (mSOL → SOL via Marinade-bonded swap) — defer; Jupiter swap covers same-effect transactions
- Restaking on Solana (parallel to v2.3 EigenLayer EVM) — defer; no mature Solana restaking primitive yet

</deferred>

---

*Phase: 15-solana-staking-marinade-jito-native*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 15` time)*
