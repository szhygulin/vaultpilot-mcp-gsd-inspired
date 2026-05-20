# Phase 19 Discussion Log

**Phase:** 19-tron-approve-stake2
**Date:** 2026-05-20
**Mode:** parallel (advisor-researcher dispatched while user answered AskUserQuestion)

## Pre-loaded context

- Phase 19 had a placeholder `19-CONTEXT.md` from v2.0 milestone scaffolding with 7 anchor decisions already documented (Stake 2.0-only, resource enum, 14-day informational, byte-identity, etc.)
- Phase 18 (TRON trust pipeline) just shipped end-to-end (PRs #97-100 + close-out #101); TRON primitives shelf available for Phase 19 consumption
- ROADMAP Phase 19 success criteria + 4-plan estimate from v2.0 milestone scaffolding

## Gray areas surfaced (5 total)

1. **SR registry caching policy** → advisor-research (Decision 1)
2. **Voting rewards amount surfacing at prepare time** → advisor-research (Decision 2)
3. **Lifecycle integration test placement** → AskUserQuestion (Q1)
4. **Plan structure for Phase 19** → AskUserQuestion (Q2)
5. **Fixture letter selection** → AskUserQuestion (Q3)

## AskUserQuestion outcomes

### Q1: Lifecycle integration test placement

- **Selected:** Phase 19 Wave 4 (this phase close-out)
- **Why:** Matches Phase 18's load-bearing-integration-test-in-last-wave pattern; mocks 14-day waiting period via `vi.setSystemTime`; test ships with the tools.
- **Recorded as:** D-10 (Lifecycle integration test in Wave 4)

### Q2: Plan structure for Phase 19

- **Selected:** 4 plans as estimated
- **Why:** Strict-sequential cadence per Phase 18 precedent; clear scope split (approve+revoke / freeze+unfreeze / vote+claim / integration).
- **Recorded as:** D-09 (Plan structure — 4 plans strict-sequential)

### Q3: Fixture letter selection

- **Selected:** Sibling carve `Tron-19-A` + `Tron-19-B` (and onward — `Tron-19-C` + `Tron-19-D` for vote + claim)
- **Why:** Phase 19 ships 4 distinct tx shapes; reserving 4 single letters per phase doesn't scale through v2.x. Phase-prefixed names anchor each fixture to its source phase + leave the single-letter pool for cross-chain primitives.
- **Recorded as:** D-08 (Fixture naming — sibling carve `Tron-19-{A,B,C,D}`)

## Advisor-researcher outcomes (background-parallel)

### Decision 1 — SR registry caching policy

- **Selected:** Option D (hybrid — live primary, snapshot fallback on RPC failure)
- **Rationale:** Mirrors the project's "trust source must be unambiguous" discipline (cf. KNOWN_SPENDERS, canonical-dispatch allowlist). `srSource: "live" | "snapshot-fallback"` surfaced per-call in CHECKS PERFORMED block.
- **Recorded as:** D-05 (Super-representative validation — hybrid registry)

### Decision 2 — Voting rewards amount surfacing

- **Selected:** Options B + D combined (best-effort advisory + typed nullable `estimatedRewardSun`)
- **Rationale:** `WithdrawBalanceContract()` has zero args — there's no user intent to gate against (deliberate departure from Phase 28 Compound's `INVALID_INPUT + hintTool` intent-vs-reality pattern). Estimate is informational only.
- **Recorded as:** D-06 (Voting rewards — advisory `estimatedRewardSun`)

## Decisions not surfaced (already locked in placeholder)

- TRC-20 approve byte-identity invariant (D-01)
- Unlimited-approval surfacing (D-02)
- Stake 2.0 only + resource enum (D-03)
- 14-day waiting period informational (D-04)
- Spender labels table extension (D-07)
- FROZEN-area discipline scope (D-11)

## Deferred ideas captured

- SunSwap + LiFi bridging → Phase 20
- Multi-chain portfolio + diagnostics → Phase 21
- Legacy Stake 1.0 → out of scope
- Stake 2.0 delegate-to-other-account → future-work backlog
- TRC-721 / TRC-1155 approve → v3.1 NFT support
- Voting power transfer in a single tx → out of scope (protocol limitation)
- SR-rotation-detection alerts → out of scope
- Stake-claim accounting auto-reconciliation → out of scope

## Discussion mode notes

- Advisor mode NOT auto-triggered (no USER-PROFILE.md). Manually dispatched a `gsd-advisor-researcher` subagent in parallel with the AskUserQuestion call — saved ~45 seconds vs sequential. Pattern: when 4+ gray areas exist and 2+ can benefit from research, parallel-dispatch the researcher while the user answers the remaining via AskUserQuestion.
- All 5 gray areas resolved in a single discuss-phase cycle (no follow-up rounds needed).
