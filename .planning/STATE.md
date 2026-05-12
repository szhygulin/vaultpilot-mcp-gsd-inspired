# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-12)

**Core value:** The user trusts what the Ledger screen shows — nothing else. Tampering at any layer between the agent and the device produces a visible mismatch on-screen before signing.
**Current focus:** Phase 1 — Server skeleton + install

## Current Position

Phase: 1 of 10 (Server skeleton + install) — v1.x scope; v2.x and v3.x milestones documented in ROADMAP backlog
Plan: 0 of 3 in current phase
Status: Ready to plan
Last activity: 2026-05-12 — REQUIREMENTS / ROADMAP / PROJECT / CONTEXT / README synced with upstream PR #672 (tool surface ~80→~190; NFT reads in scope; BTC/LTC fully shipped; honest-model-error class added; new ergonomics + contacts + sharing + device-trust surfaces added to v3.x backlog)

Progress: [░░░░░░░░░░] 0%

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

- **Phase 1 prerequisite**: `WALLETCONNECT_PROJECT_ID` will be needed at Phase 3; user should register a project at https://cloud.walletconnect.com before that phase begins
- **Phase 4 prerequisite**: A real Ledger device with the Ethereum app installed + Ledger Live paired is required for the Phase 4 verify-phase step (the trust-pipeline milestone is moot without device-side hash verification)

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none yet)* | | | |

## Session Continuity

Last session: 2026-05-12 (initial scaffolding)
Stopped at: PROJECT.md / REQUIREMENTS.md / ROADMAP.md / STATE.md / config.json drafted; Phase 1 plans not yet generated
Resume file: None — next action is `/gsd-discuss-phase 1` or `/gsd-plan-phase 1`
