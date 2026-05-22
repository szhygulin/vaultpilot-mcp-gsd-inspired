---
phase: 27
slug: btc-ltc-core-rpc-incident-report-diagnostics
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 27 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run <changed-test-file>` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~60–120 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <changed-test-file>`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

> Filled in per-task by the planner. Each PLAN.md task carries `<acceptance_criteria>` with a concrete `npx vitest run` command or source assertion. Phase 27 is purely read-side — no cryptographic-binding fixtures required.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| (planner fills) | 01 | 1 | BTC-FORENSIC-01..04 | T-27-* | Core client NEVER throws; HTTP 500 → rpc-error arm; basic-auth header present iff creds set; coreNotConfigured envelope when env absent | unit | `npx vitest run` | ⬜ pending |
| (planner fills) | 02 | 2 | BTC-FORENSIC-05, LTC-FORENSIC-01 | T-27-* | get_btc_mempool_summary refuses cleanly without Core; LTC tools mirror BTC shape | unit | `npx vitest run` | ⬜ pending |
| (planner fills) | 03 | 3 | BTC-INC-01 | T-27-* | build_incident_report aggregates via Promise.allSettled with per-chain timeout; anomaly thresholds documented; SECURITY.md v2.2 close-out updated | unit + integration | `npx vitest run` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing vitest infrastructure covers all phase requirements — no new framework install. New sibling test files (`test/clients-bitcoin-core-rpc.test.ts`, forensic-tool tests, `test/build-incident-report.test.ts`) follow existing `test/` naming conventions.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Bitcoin Core RPC smoke against a real node | BTC-FORENSIC-01..05 | Requires the user to run their own Bitcoin Core node or hosted-service endpoint | v2.2 verify-phase: set `BITCOIN_CORE_RPC_URL` + basic-auth creds, call each forensic tool, confirm responses align with `bitcoin-cli` ground truth |
| Live Litecoin Core RPC smoke | LTC-FORENSIC-01 | Requires a real Litecoin Core node | v2.2 verify-phase: set `LITECOIN_CORE_RPC_URL`, call each LTC forensic tool, confirm response shape mirrors BTC equivalents |
| `coreNotConfigured` envelope when env absent | BTC-FORENSIC-01, LTC-FORENSIC-01 | Verified automatically — listed here only for completeness |  |
| `build_incident_report` against live chain state | BTC-INC-01 | Anomaly thresholds need a real chain to exercise meaningfully | v2.2 verify-phase: call `build_incident_report({ includeChains: ["bitcoin", "litecoin", "ethereum"] })` with at least one paired wallet and confirm output structure matches the agent-friendly contract |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
