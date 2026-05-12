# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-12)

**Core value:** The user trusts what the Ledger screen shows — nothing else. Tampering at any layer between the agent and the device produces a visible mismatch on-screen before signing.
**Current focus:** Phase 1 — Server skeleton + install

## Current Position

Phase: 1 of 10 (Server skeleton + install) — **plans 01-01, 01-02, 01-03 all shipped; phase complete pending real-runtime `claude mcp add` smoke**
Plan: 3 of 3 done in current phase
Status: Ready to ship Phase 1 (verify-phase open: register with Claude Code, confirm `claude mcp list` shows connected)
Last activity: 2026-05-12 — Phase 1 fully implemented. 01-01 (TypeScript scaffold + LICENSE) sequential; 01-02 (MCP server framework) and 01-03 (`--check` CLI) executed in parallel via subagents. All 8 unit tests pass; `--check` end-to-end smoke produces correct human + JSON output with status escalation working as specified.

Progress: [█░░░░░░░░░] 3/30 plans (10%) — phase 1 of 10 phases done

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

- **Parallel-agent race on shared main**: dispatched 01-02 + 01-03 as parallel subagents both writing to `main`. Mid-execution the 01-03 agent's `git checkout HEAD --` (cleaning its working set before its commit) un-staged some of 01-02's in-flight files. The 01-02 agent caught it on post-commit `git status` and shipped a recovery commit (7b24bb5). No data lost; tests + build green after recovery. **Lesson**: for Phase 2+ parallel dispatch, give each subagent its own `.claude/worktrees/<branch-name>/` worktree per the global CLAUDE.md "one worktree per feature" rule. The orchestrator merges branches after both complete. Cost of the violation here was one extra commit + a debug round; cost in a larger phase would compound.
- **Plan-boundary slip**: 01-02-PLAN.md said "don't touch src/index.ts" but 01-03 agent legitimately needed to fix a pre-existing typecheck failure there (the JSON default-import shape on the `--version` branch). Surfaced as deviation in agent report. **Lesson**: when one plan owns "the bin entrypoint wires both handlers" by virtue of writing both stubs (01-01), file-ownership boundaries between later plans need to acknowledge the shared file. Either: route shared-file changes through the orchestrator, or explicitly carve `src/index.ts` as "contested — first agent to touch announces, other agent reads after."

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none yet)* | | | |

## Session Continuity

Last session: 2026-05-12 (initial scaffolding)
Stopped at: PROJECT.md / REQUIREMENTS.md / ROADMAP.md / STATE.md / config.json drafted; Phase 1 plans not yet generated
Resume file: None — next action is `/gsd-discuss-phase 1` or `/gsd-plan-phase 1`
