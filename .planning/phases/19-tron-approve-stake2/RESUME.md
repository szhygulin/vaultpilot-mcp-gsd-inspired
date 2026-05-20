# Phase 19 — Fresh-Context Resume Brief

**One-shot orientation for the next session. Read this first.**

---

## Where we are

Phase 19 (TRC-20 approve + Stake 2.0) has these artifacts on `main`:

| File | Status | Notes |
|------|--------|-------|
| `19-CONTEXT.md` | ✅ shipped | 11 decisions D-01..D-11; D-11a amended for additive widening |
| `19-DISCUSSION-LOG.md` | ✅ shipped | Parallel advisor-research + AskUserQuestion outcomes |
| `19-RESEARCH.md` | ✅ shipped | tronweb 6.3.0 API surface HIGH confidence; 3 open questions noted |
| `19-PATTERNS.md` | ✅ shipped | 13/15 analogs found; 5 surprises flagged |
| `19-01..04-PLAN.md` | ❌ NOT YET | Planner not dispatched — that's the next step |
| `19-PLAN-CHECK.md` | ❌ NOT YET | Plan-checker runs after planner |

Local main: `git log --oneline -1` should show the PR that bundled D-11a amendment + RESEARCH + PATTERNS.

---

## Next command

```
/gsd-plan-phase 19 --skip-research
```

Research is already done (`19-RESEARCH.md` exists). The `--skip-research` flag tells plan-phase not to prompt about re-running the researcher.

The planner will produce `19-01-PLAN.md` through `19-04-PLAN.md` + the plan-checker runs the revision loop until it returns PASS or hits max iterations.

---

## Inputs the planner MUST consider

### From CONTEXT (locked decisions D-01..D-11)
- 4 plans strict-sequential (D-09): 19-01 approve+revoke / 19-02 freeze+unfreeze+withdraw-expire / 19-03 vote+claim+SR-registry-hybrid / 19-04 lifecycle integration test
- Fixture sibling carve `Tron-19-{A,B,C,D}` in NEW file `test/signing-fingerprint-tron-19.test.ts` (NOT extending Phase 18's `test/signing-fingerprint-tron.test.ts`) (D-08)
- SR registry hybrid: live `tronWeb.trx.listSuperRepresentatives()` primary + bundled `src/tokens/tron-srs.json` snapshot fallback (D-05)
- Voting rewards advisory `estimatedRewardSun` — no intent-vs-reality gate (D-06)
- Lifecycle integration test in Wave 4 with `vi.setSystemTime` (D-10)

### From CONTEXT D-11a (FROZEN-vs-additive-widening clarification)
**ADDITIVE widening PERMITTED** in these Phase 18-shipped files (project precedent + research + pattern-mapper all confirm):
- `src/signing/handle-store.ts` — `PreparedTxTron.kind` union + `TronInstructionSummary` discriminated union widening (7 new kinds)
- `src/signing/blocks-tron.ts` — APPEND-ONLY: 3 new templates (`UNLIMITED_APPROVAL_TRON_TEMPLATE`, `STAKE_RESOURCE_TRON_TEMPLATE`, `REWARD_ESTIMATE_TRON_TEMPLATE`)
- `src/security/canonical-dispatch-tron.ts` — additive if planner inspection finds the current allowlist refuses new stake kinds (Surprise #3)
- `src/tools/preview_send.ts` TRON branch — additive decode arms for the 7 new kinds

**BYTE-UNTOUCHED** (consume only): `payload-fingerprint-tron.ts`, `presign-hash-tron.ts`, `simulation-tron.ts`, `amount-tron.ts`, `protocols/tron-native.ts`, `protocols/tron-trc20.ts`, Phase 18 prepare tools.

### From PATTERNS (5 surprises the planner must act on)
1. `handle-store.ts` additive widening (resolved by D-11a amendment above)
2. `preview_send.ts` decode arms (resolved by D-11a amendment above)
3. `canonical-dispatch-tron.ts` exhaustive-check inspection (planner must verify at task-write time)
4. tronweb Stake 2.0 builder method names need `.d.ts` verification at execute time (researcher confirmed HIGH at write-time; runtime spot-check still warranted)
5. `listSuperRepresentatives()` returns `address` as 0x41-prefixed hex — needs `formatTronAddress()` conversion before snapshot/labeling

### From RESEARCH (3 open questions for the planner)
1. **LiFi TRON facet address NOT confirmed** — planner must add `checkpoint:human-verify` task in Plan 19-01 before committing to `contracts.ts`. If unconfirmable, omit from Phase 19 and defer LiFi entries to Phase 20 (where they're scope-native).
2. **`tron-srs.json` snapshot size** — recommend top ~30 by voteCount; implementer derives names from SR `url` fields heuristically.
3. **`TronInstructionSummary` 7 new kinds** — exact field shapes are implementer's discretion; the kind discriminator strings are locked above.

### From RESEARCH (load-bearing pitfalls)
- `vote()` takes `{[srAddress]: number}` MAP, NOT an array — protocol layer converts the agent's `[{srAddress, count}]` array input
- `FreezeBalanceV2Contract.frozen_balance` typed `number` not `bigint` — needs `Number()` conversion + overflow guard after `parseTronAmountStrict` returns `bigint`
- `WithdrawExpireUnfreezeContract` takes ZERO args (withdraws all expired records for the owner)
- TRC-20 `approve` selector `0x095ea7b3` (NOT same as ERC-20 `approve` even though ABI-identical — different from Phase 18 Topic 8's `0xa9059cbb` transfer selector; common confusion source)
- MAX_UINT256 must be passed as the decimal-string SENTINEL `"max"` per D-02b (Phase 28 anti-typo pattern); lowercase strict-equality

---

## After planning

After `/gsd-plan-phase 19 --skip-research` finishes (plan-checker returns PASS):

```
/gsd-execute-phase 19
```

Same per-PR admin-merge cadence as Phase 18. Strict-sequential 4 plans → 4 feature PRs → 1 close-out chore PR. Expected duration: ~3-4 hours total (Phase 18 was ~3 hours; Phase 19 has similar surface area + 7 tools vs Phase 18's 5 broader integrations).

---

## Project conventions reminder (from CLAUDE.md)

- **ESM spy-affordance** required: `_tronApprove`, `_tronStake`, `_tronVote` indirection objects on every new protocol module
- **Hardcoded `0x...` fixture literals**, NO `beforeAll`-snapshot — drift must fail at a specific line
- **Decimal-aware arithmetic** — token amounts as decimal strings at the agent boundary; `parseTronAmountStrict` handles overflow guards
- **Per-PR admin-merge cadence** with independent `gh pr diff` review before each merge (per `feedback_pr_review_before_merge` memory)
- **API-overload resilience** — instruct executors to commit early and commit often (Phase 18 lesson learned)
- **Worktree isolation** via `Agent(isolation="worktree")` for each plan executor

---

*Brief written 2026-05-20 for fresh-context handoff. Delete this file after Phase 19 plans ship.*
