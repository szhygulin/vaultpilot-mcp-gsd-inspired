# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-12)

**Core value:** The user trusts what the Ledger screen shows — nothing else. Tampering at any layer between the agent and the device produces a visible mismatch on-screen before signing.
**Current focus:** Phase 3 — WalletConnect pairing — **code-complete; verify-phase pending real-Ledger smoke**

## Current Position

Phase: 3 of 10 (WalletConnect pairing) — **code-complete**. Plans 03-01 (WC sign-client + session manager + CAIP parser) + 03-02 (`pair_ledger_live` + `get_ledger_status` tools) shipped via PR #8 + PR #9; 90/90 tests pass; typecheck + build clean. Verify-phase gate is the only thing between Phase 3 and "done": exercise real Ledger pairing against live WC relay + `WALLETCONNECT_PROJECT_ID` from cloud.walletconnect.com.
Plan: 2 of 2 done in current phase
Status: Phase 3 code-complete. Verify-phase pending (manual, requires Ledger device).
Last activity: 2026-05-12 — Phase 3 planned + executed. Planning bundle (RESEARCH + VALIDATION + PATTERNS + 2 PLAN files) shipped as PR #7. Then 03-01 shipped as PR #8 (4 atomic commits, 18 new test cases, 4 deviations — 2 were genuine SDK-API corrections vs the plan: `storageOptions.database` not `dbName`; `parseAccountId` returns `{ namespace, reference, address }` not `{ chainId, address }`). Then 03-02 shipped as PR #9 (2 atomic commits, 15 new test cases, zero deviations — clean run benefited from 03-01's upstream fixes).

Progress: [███░░░░░░░] 9/30 plans (30%) — phases 1 + 2 of 10 done; phase 3 code-complete

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.

Recent decisions affecting current work:

- Initial scaffolding: Vertical-slice MVP over breadth-first; verify-phase per milestone exercises a real end-to-end flow
- Initial scaffolding: `@modelcontextprotocol/sdk` over FastMCP for v1.x
- Initial scaffolding: `viem` over ethers.js
- Initial scaffolding: BUSL-1.1 license from day one
- Initial scaffolding: Companion `vaultpilot-preflight` skill deferred to v1.3 (residual risk documented in SECURITY.md from day one)
- Docs sync (PR #672): NFT reads moved from out-of-scope to v3.1 milestone; marketplace fills stay deferred (need typed-data signing surface)
- Docs sync (PR #672): BTC + LTC ship as one v2.2 milestone (shared Esplora + Ledger BTC infra); not split into separate milestones
- Docs sync (PR #672): v1.3 hardening expanded from one verification tool (`get_verification_artifact`) to three (`get_verification_artifact` + `verify_tx_decode` + `get_tx_verification`) — each covers a distinct attacker model
- Docs sync (PR #672): v1.1 scope expanded to include the full ERC-20 lifecycle (transfer + approve + revoke + WETH unwrap), not just transfer; approval-class surfacing becomes load-bearing here

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase 1 verify-phase open**: requires user with a Claude Code instance to run `claude mcp add vaultpilot-mcp -- node /Users/s/dev/vaultpilot/vaultpilot-mcp-gsd-inspired/dist/index.js` and confirm `claude mcp list` shows it as connected. The in-process initialize-handshake test covers server construction; the real-stdio path is the only thing not yet exercised.
- **Phase 3 verify-phase pending**: requires `WALLETCONNECT_PROJECT_ID` from https://cloud.walletconnect.com + a Ledger device with Ledger Live paired. Manual flow: `WALLETCONNECT_PROJECT_ID=<real> npm start` → from Claude Code call `pair_ledger_live` → paste `wcUri` into Ledger Live → Connect a Dapp → approve on device → call `get_ledger_status` → confirm address matches Ledger Live → Settings → Connected Apps. Also resolves research § Assumption A2 (whether Ledger Live's UI surfaces the session topic) — if not, edit `VERIFY_ON_DEVICE_TEMPLATE` in `src/tools/pair_ledger_live.ts` to address-only + update Test 1's regex.
- **Phase 4 prerequisite**: A real Ledger device with the Ethereum app installed + Ledger Live paired is required for the Phase 4 verify-phase step (the trust-pipeline milestone is moot without device-side hash verification). Phase 3 verify-phase confirms the WC pairing seam Phase 4 will route signing over.

### Phase 1 retro

- **Parallel-agent race on shared main**: dispatched 01-02 + 01-03 as parallel subagents both writing to `main`. Mid-execution the 01-03 agent's `git checkout HEAD --` (cleaning its working set before its commit) un-staged some of 01-02's in-flight files. The 01-02 agent caught it on post-commit `git status` and shipped a recovery commit (7b24bb5). No data lost; tests + build green after recovery. **Lesson**: for Phase 2+ parallel dispatch, give each subagent its own `.claude/worktrees/<branch-name>/` worktree per the global CLAUDE.md "one worktree per feature" rule. The orchestrator merges branches after both complete. **Applied in Phase 2 — zero races.**
- **Plan-boundary slip**: 01-02-PLAN.md said "don't touch src/index.ts" but 01-03 agent legitimately needed to fix a pre-existing typecheck failure there (the JSON default-import shape on the `--version` branch). Surfaced as deviation in agent report. **Lesson**: when one plan owns "the bin entrypoint wires both handlers" by virtue of writing both stubs (01-01), file-ownership boundaries between later plans need to acknowledge the shared file. Either: route shared-file changes through the orchestrator, or explicitly carve `src/index.ts` as "contested — first agent to touch announces, other agent reads after."

### Phase 2 retro

- **Worktree isolation worked**: each of 4 plans (02-01, 02-02, 02-03, 02-04) ran in its own `.claude/worktrees/<branch>/` checkout. Parallel agents (02-02 + 02-04) committed independently without any race. PR-per-plan + admin-merge gave a clean linear history on `main`.
- **Side-effect-import registration pattern held up**: each tool module's top-level `registerTool(...)` call is the side effect; `register-all.ts` is just imports. 02-04 added 4 imports, 02-03 added 1 — both edited the same file but git auto-merged trivially because they touched different lines.
- **Agent design deviation worth noting**: 02-03 plan said "fan out native + ERC-20 + pricing in three concurrent calls"; agent shipped sequential pricing-after-balances on the rationale that only addresses with non-zero balances need pricing (better cache hit rate). Reasonable; preserved in source comment.
- **Driving gsd from source vs installed**: I'm running gsd from the source repo, not from a registered install. This compresses the formal subagent contracts (planner / plan-checker / verifier) into my own dispatch. For Phase 3+, recommended path is to install gsd properly per the upstream instructions and use `/gsd-plan-phase 3` + `/gsd-execute-phase 3`. Audited as clean; cost is a Claude Code restart + a fresh conversation.

### Phase 3 retro

- **Full GSD pipeline ran end-to-end**: `/gsd-plan-phase 3` orchestrated researcher → pattern-mapper (parallel) → planner → plan-checker → execute (per-plan worktree dispatch). Each phase produced its canonical artifact; planning bundle landed as one PR (#7), then one PR per execution plan (#8, #9). No mid-flight context resets or recovery commits.
- **Research-time SDK probing paid off**: researcher verified `@walletconnect/sign-client@2.23.9` against installed type defs (Pattern 1 + Pattern 2 in 03-RESEARCH.md had working call sketches). The planner consumed these and produced concrete plans with verified code snippets.
- **Planner-research drift caught by SDK type defs at execute time**: 03-01 execution surfaced two SDK-API mistakes the planner inherited from research: `storageOptions: { dbName }` should be `{ database }` (verified at `keyvaluestorage/dist/types/shared/types.d.ts`), and `parseAccountId` returns `{ namespace, reference, address }` not `{ chainId, address }`. TS strict mode caught both immediately. Executor's `Deviation:` discipline made the corrections visible in PR #8's body. **Lesson**: a future research-step improvement is to type-check the call sketches against the dist type defs as part of researcher output, not just at execute time. Cost was small (single iteration of in-worktree fixes), but it's a pattern.
- **Plan-checker's 3 MEDIUM flags were correctly graded**: R1 (multi-digit chainId test) was a 1-line plan edit before commit; R2 (session_delete listener test independence) + R3 (A2 code-level fallback) were both correctly classified as residuals — neither blocks Phase 3 verify-phase or Phase 4 dependency. Plan-checker didn't catch the 2 SDK-API issues that execute-phase later caught — they only surface against installed type defs, not against plan-text reading.
- **Zero parallel agents in Phase 3**: 03-02 strictly depends on 03-01 (imports session-manager + walletconnect-client + env helpers). Sequential execution was the right call; no worktree races because no parallelism to race.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none yet)* | | | |

## Session Continuity

Last session: 2026-05-12 (Phase 3 code-complete)
Stopped at: Phase 3 plans 03-01 + 03-02 shipped via PR #8 + PR #9; verify-phase pending real-Ledger smoke
Resume file: None — next action is the manual Phase 3 verify-phase (requires Ledger device + WALLETCONNECT_PROJECT_ID), OR `/gsd-plan-phase 4` if the user wants to plan ahead while waiting for hardware
