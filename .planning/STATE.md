# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-12)

**Core value:** The user trusts what the Ledger screen shows — nothing else. Tampering at any layer between the agent and the device produces a visible mismatch on-screen before signing.
**Current focus:** Phase 3 — WalletConnect pairing (next)

## Current Position

Phase: 2 of 10 (Ethereum read-only portfolio) — **complete**. Plans 02-01, 02-02, 02-03, 02-04 all shipped; verify-phase passed (real-network smoke against PublicNode + DefiLlama returned correct portfolio for vitalik.eth: 5.62 ETH + 16+ ERC-20 rows + USD totals).
Plan: 4 of 4 done in current phase
Status: Phase 2 complete. Ready to plan Phase 3.
Last activity: 2026-05-12 — Phase 2 fully implemented. 02-01 (viem RPC client) sequential; 02-02 (ERC-20 multicall scanner) + 02-04 (ENS + standalone tools) parallel via subagents in isolated worktrees; 02-03 (DefiLlama pricing + get_portfolio_summary keystone) sequential after 02-02. 57/57 tests pass. End-to-end smoke against PublicNode pulled real balances + USD totals.

Progress: [██░░░░░░░░] 7/30 plans (23%) — phases 1 + 2 of 10 done

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
- **Phase 3 prerequisite**: `WALLETCONNECT_PROJECT_ID` will be needed at Phase 3; user should register a project at https://cloud.walletconnect.com before that phase begins
- **Phase 4 prerequisite**: A real Ledger device with the Ethereum app installed + Ledger Live paired is required for the Phase 4 verify-phase step (the trust-pipeline milestone is moot without device-side hash verification)

### Phase 1 retro

- **Parallel-agent race on shared main**: dispatched 01-02 + 01-03 as parallel subagents both writing to `main`. Mid-execution the 01-03 agent's `git checkout HEAD --` (cleaning its working set before its commit) un-staged some of 01-02's in-flight files. The 01-02 agent caught it on post-commit `git status` and shipped a recovery commit (7b24bb5). No data lost; tests + build green after recovery. **Lesson**: for Phase 2+ parallel dispatch, give each subagent its own `.claude/worktrees/<branch-name>/` worktree per the global CLAUDE.md "one worktree per feature" rule. The orchestrator merges branches after both complete. **Applied in Phase 2 — zero races.**
- **Plan-boundary slip**: 01-02-PLAN.md said "don't touch src/index.ts" but 01-03 agent legitimately needed to fix a pre-existing typecheck failure there (the JSON default-import shape on the `--version` branch). Surfaced as deviation in agent report. **Lesson**: when one plan owns "the bin entrypoint wires both handlers" by virtue of writing both stubs (01-01), file-ownership boundaries between later plans need to acknowledge the shared file. Either: route shared-file changes through the orchestrator, or explicitly carve `src/index.ts` as "contested — first agent to touch announces, other agent reads after."

### Phase 2 retro

- **Worktree isolation worked**: each of 4 plans (02-01, 02-02, 02-03, 02-04) ran in its own `.claude/worktrees/<branch>/` checkout. Parallel agents (02-02 + 02-04) committed independently without any race. PR-per-plan + admin-merge gave a clean linear history on `main`.
- **Side-effect-import registration pattern held up**: each tool module's top-level `registerTool(...)` call is the side effect; `register-all.ts` is just imports. 02-04 added 4 imports, 02-03 added 1 — both edited the same file but git auto-merged trivially because they touched different lines.
- **Agent design deviation worth noting**: 02-03 plan said "fan out native + ERC-20 + pricing in three concurrent calls"; agent shipped sequential pricing-after-balances on the rationale that only addresses with non-zero balances need pricing (better cache hit rate). Reasonable; preserved in source comment.
- **Driving gsd from source vs installed**: I'm running gsd from the source repo, not from a registered install. This compresses the formal subagent contracts (planner / plan-checker / verifier) into my own dispatch. For Phase 3+, recommended path is to install gsd properly per the upstream instructions and use `/gsd-plan-phase 3` + `/gsd-execute-phase 3`. Audited as clean; cost is a Claude Code restart + a fresh conversation.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none yet)* | | | |

## Session Continuity

Last session: 2026-05-12 (Phase 2 complete)
Stopped at: Phase 2 shipped (4 plans + verify); Phase 3 (WalletConnect pairing) not yet planned
Resume file: None — next action is `/gsd-plan-phase 3` (after gsd install + restart, recommended)
