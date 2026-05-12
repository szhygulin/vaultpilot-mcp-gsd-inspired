---
phase: 3
slug: walletconnect-pairing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-12
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `03-RESEARCH.md` § Validation Architecture (lines 400–440).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@^2.1.0` (already configured) |
| **Config file** | None — vitest defaults; tests in `test/` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npm run typecheck` |
| **Estimated runtime** | ~5 seconds (current suite is small; Phase 3 adds ~4 test files + ~25 new cases) |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test && npm run typecheck`
- **Before `/gsd-verify-work`:** Full suite green + manual real-Ledger smoke (one pairing against a live device)
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

> Tasks below are placeholders mapped from PAIR-01..05 + DEMO-06; the planner will write the canonical task list in `03-01-PLAN.md` and `03-02-PLAN.md`. This table reflects the verification *intent* per requirement, not the final task IDs.

| Task ID (anticipated) | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|----|----|----|----|----|----|----|----|----|----|
| 03-01-W0 | 01 | 0 | All | — | Mock SignClient helper installed | infra | `npm test -- helpers/mock-sign-client` | ❌ W0 | ⬜ pending |
| 03-01-01 | 01 | 1 | PAIR-04 | T-WC-INIT-1 | Missing `WALLETCONNECT_PROJECT_ID` → `MissingProjectIdError` with WC dashboard URL | unit | `npm test -- walletconnect-client` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | PAIR-04 | T-WC-INIT-2 | `SignClient.init` uses `storageOptions: { dbName: ":memory:" }` + `logger: "error"` (no fs pollution, no stdout pollution) | unit | `npm test -- walletconnect-client` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | PAIR-01 | — | `pair()` returns `{ uri, sessionPromise }`; mock approval resolves to a `SessionTypes.Struct` | unit | `npm test -- session-manager` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 1 | PAIR-01 timeout | — | 60s elapses with no approval → `ApprovalTimeoutError` (fake timers) | unit | `npm test -- session-manager` | ❌ W0 | ⬜ pending |
| 03-01-05 | 01 | 1 | PAIR-02 | — | After approval, status exposes `{ paired: true, address, chainId, sessionTopicLast8 }`; uses `parseAccountId` (no string slicing) | unit | `npm test -- session-manager` | ❌ W0 | ⬜ pending |
| 03-01-06 | 01 | 1 | PAIR-05 | — | Second `pair()` without `force` returns cached session via `session.getAll().filter(expiry > now)` | unit | `npm test -- session-manager` | ❌ W0 | ⬜ pending |
| 03-01-07 | 01 | 1 | PAIR-05 force | — | `force: true` calls `signClient.disconnect({ topic, reason })` before re-pairing | unit (mock assertion) | `npm test -- session-manager` | ❌ W0 | ⬜ pending |
| 03-01-08 | 01 | 1 | — | T-WC-EXP-1 | `session_delete` event drops cached session; next `getStatus()` returns `{ paired: false }` | unit (event sim) | `npm test -- session-manager` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | PAIR-01, PAIR-03 | T-VERIFY-1 | `pair_ledger_live` tool response `content[0].text` carries `VERIFY-ON-DEVICE` block verbatim | unit (regex/`toMatch` with `\s+`) | `npm test -- pair-ledger-live` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | PAIR-04 | T-WC-INIT-1 | Missing project ID → `isError: true`, `errorCode: "MISSING_PROJECT_ID"`, text names env var + WC dashboard URL | unit (env clear) | `npm test -- pair-ledger-live` | ❌ W0 | ⬜ pending |
| 03-02-03 | 02 | 2 | DEMO-06 (anticipated) | — | `VAULTPILOT_DEMO=true` → `errorCode: "DEMO_MODE_REFUSED"`, pointer to `set_demo_wallet` (tool may not exist yet — text-only mention) | unit (env set) | `npm test -- pair-ledger-live` | ❌ W0 | ⬜ pending |
| 03-02-04 | 02 | 2 | PAIR-02 | — | `get_ledger_status` returns `{ paired: false }` before pairing | unit | `npm test -- get-ledger-status` | ❌ W0 | ⬜ pending |
| 03-02-05 | 02 | 2 | PAIR-02 | — | `get_ledger_status` returns `{ paired: true, address, chainId, sessionTopicLast8 }` after pair (via session-manager mock) | unit | `npm test -- get-ledger-status` | ❌ W0 | ⬜ pending |
| 03-02-06 | 02 | 2 | All (smoke) | — | Real WC relay + real Ledger device — full pair, address surfaced in tool response matches Ledger Live UI | manual | verify-phase | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/helpers/mock-sign-client.ts` — `MockSignClient` factory with `_simulateApproval(session)` / `_simulateRejection(error)` / `_simulateTimeout()` / `_simulateSessionDelete(topic)` API (reused across all four test files; avoids fragile timing)
- [ ] `test/wallet-walletconnect-client.test.ts` — `MissingProjectIdError` + singleton dedup + `:memory:` storage option asserted on init
- [ ] `test/wallet-session-manager.test.ts` — pair / status / disconnect / force-re-pair / timeout / session_delete event
- [ ] `test/pair-ledger-live.test.ts` — tool handler response shape + verbatim VERIFY-ON-DEVICE block + error envelopes
- [ ] `test/get-ledger-status.test.ts` — paired vs unpaired branches

*Mocking strategy:* vitest module-level mock via `vi.mock("@walletconnect/sign-client", ...)`. The Wave 0 helper is the single source of truth; tests script scenarios explicitly via the `_simulate*` API.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real WC relay round-trip (URI → Ledger Live → device approval → session) | PAIR-01, PAIR-02, PAIR-03 | No Ledger device in CI; the relay is external | 1. `WALLETCONNECT_PROJECT_ID=<real> npm start` 2. From Claude Code: call `pair_ledger_live` 3. Paste `wcUri` into Ledger Live → Connect a Dapp → paste 4. Approve on device 5. Call `get_ledger_status` and confirm address matches Ledger Live → Settings → Connected Apps |
| Ledger Live UI cross-check (Assumption A2: does Ledger Live surface the session topic to the user?) | PAIR-03 | No authoritative doc on Ledger Live UI fields | While paired, screenshot Ledger Live → Settings → Connected Apps; record whether the session topic / last-8 is visible. If not: revise `VERIFY-ON-DEVICE` block to focus only on the address (research § Open Question 1) |
| Metadata UX (A4 icons, A5 url) | — | Ledger Live's tolerance for empty/unreachable metadata is undocumented | First pair confirms; if `metadata.icons: []` is rejected, supply a 1px data URL fallback |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (manual-only items are explicitly enumerated above)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (verified — every code task pairs with a unit test in the same wave)
- [ ] Wave 0 covers all MISSING references (mock-sign-client helper + 4 test files; new dep `@walletconnect/sign-client@^2.23.9`)
- [ ] No watch-mode flags (`npm test` runs vitest with `run` semantics — single-pass)
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** plan-checker PASS on 2026-05-12 (3 MEDIUM flags surfaced, classified below).

---

## Accepted Residuals (plan-checker MEDIUM flags, dispositioned 2026-05-12)

These are flagged-but-accepted gaps that ship with Phase 3. Each names the cheapest remediation if the gap surfaces a real defect later.

| # | Concern | Plan / Task | Disposition | Remediation if defect surfaces |
|---|---------|------------|-------------|--------------------------------|
| R1 | Multi-digit chainId regression anchor missing | 03-01 Task 2, Test 7 | **Fixed** — Test 7 added (`eip155:42161:0x...` case) | n/a |
| R2 | Test 9 doesn't independently prove the `session_delete` listener; the empty-store filter alone makes the assertion pass | 03-01 Task 3, Test 9 | **Accepted** — the SDK's store-empty-on-delete is the load-bearing path; the listener is defensive-only. The verify-phase real-Ledger pairing exercises the full path end-to-end. | Add a `_peekCachedSessionForTesting` helper on session-manager and split Test 9 into (a) listener fires + cache cleared, (b) store-filter-authoritative |
| R3 | A2 (does Ledger Live show session topic?) has no code-level fallback hook — the `VERIFY_ON_DEVICE_TEMPLATE` const is frozen | 03-02 Task 1 | **Accepted** — if A2 fails at verify-phase, the fix is one const edit + Test 1's regex update + `npm test`. Low cost. | Replace the template const with two variants (`VERIFY_ON_DEVICE_TEMPLATE_WITH_TOPIC` / `_NO_TOPIC`) and select based on the first-pair finding |
