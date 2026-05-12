---
phase: 5
slug: demo-mode-diagnostics
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-12
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `05-RESEARCH.md` § Validation Architecture, **with Q-CONTRADICTION-PREP Option B applied** — Plan 05-02 REMOVES `DEMO_MODE_REFUSED` refusals from `prepare_native_send` + `preview_send` (research's "must still pass" markers for those tests are inverted: they must change).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `vitest@^2.1.0` (already configured) |
| **Config file** | None — vitest auto-discovers `test/**/*.test.ts` |
| **Quick run command** | `npm test -- <file>.test.ts` (per-file, ~1-2s) |
| **Full suite command** | `npm test && npm run typecheck && npm run build` |
| **Estimated runtime** | ~5-7s after Phase 5 lands (~50 new + ~3 evolved tests on top of 196 baseline) |

---

## Sampling Rate

- **Per task commit:** `npm test`
- **Per wave merge:** `npm test && npm run typecheck && npm run build`
- **Phase gate:** Full suite green + combined Phase 3+4+5 verify-phase smoke (real Ledger pairing + demo-mode rehearsal across set_demo_wallet → portfolio read → prepare → preview → send simulation)
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

> Phase 5 EVOLVES Phase 3+4 code. Test surface changes are marked **🔄 REPLACE** (rewrite existing assertion) vs **✅ PRESERVE** (existing test must still pass) vs **❌ NEW** (Wave 0 — file doesn't exist yet).

| Task ID (anticipated) | Plan | Requirement | Threat Ref | Secure Behavior | Test Type | Status | Surface |
|----|----|----|----|----|----|----|----|
| 05-01-01 | 01 | DEMO-01 | T-DEMO-PREDICATE-1 | `VAULTPILOT_DEMO=true` literal → resolved demo on | unit | `npm test -- demo-resolve` | ❌ NEW |
| 05-01-02 | 01 | DEMO-01 (regression) | — | `VAULTPILOT_DEMO=True` (uppercase) does NOT trigger demo | regression | `npm test -- pair-ledger-live` (line 207) | ✅ PRESERVE |
| 05-01-03 | 01 | DEMO-02 | T-DEMO-PREDICATE-1 | `VAULTPILOT_DEMO=false` literal → resolved demo off | unit | `npm test -- demo-resolve` | ❌ NEW |
| 05-01-04 | 01 | Q-STRICT | T-DEMO-PREDICATE-1 | `VAULTPILOT_DEMO=1` / `yes` / `True` → `process.exit(1)` + stderr error | unit (in-process `vi.spyOn(process, "exit").mockImplementation(throw)` — chosen over subprocess spawn for runtime cost; throw-mock catches the same logical case the subprocess would; loses real-stderr observability — acceptable tradeoff for v1.0) | `npm test -- demo-resolve` | ❌ NEW |
| 05-01-05 | 01 | DEMO-07 / INST-05 | T-DEMO-PREDICATE-1 | No env + no config file → auto-demo on; seeds `whale` as active persona | unit | `npm test -- demo-resolve` | ❌ NEW |
| 05-01-06 | 01 | — | T-CONFIG-MALFORMED-1 | Malformed `~/.vaultpilot-mcp/config.json` → `process.exit(1)` + stderr | unit | `npm test -- demo-resolve` | ❌ NEW |
| 05-01-07 | 01 | DEMO-03 | — | `get_demo_wallet` lists 4 personas with addresses + rehearsableFlows | unit | `npm test -- get-demo-wallet` | ❌ NEW |
| 05-01-08 | 01 | DEMO-04 | — | `set_demo_wallet({ persona: "whale" })` activates whale; `getActivePersona()` returns whale | unit | `npm test -- set-demo-wallet` | ❌ NEW |
| 05-01-09 | 01 | DEMO-04 (gate) | T-PERSONA-CONFUSION-1 | `set_demo_wallet({ persona: "unknown" })` → SDK-pipeline rejects (schema enum); handler never invoked | unit (SDK-pipeline + standalone ajv + TS narrowing — mirror Phase 4 Test 1 methodology) | `npm test -- set-demo-wallet` | ❌ NEW |
| 05-01-10 | 01 | Q-WRONG-MODE | T-PERSONA-CONFUSION-1 | `set_demo_wallet` outside demo mode → `errorCode: "WRONG_MODE"` | unit | `npm test -- set-demo-wallet` | ❌ NEW |
| 05-01-11 | 01 | T-NO-PERSIST-1 | T-NO-PERSIST-1 | Persona state is process-local; `_resetDemoStateForTesting()` clears it | unit | `npm test -- demo-state` | ❌ NEW |
| 05-02-01 | 02 | DEMO-05 / Q-CONTRADICTION-PREP-B | T-NULL-PERSONA-1 | Demo mode `prepare_native_send` SUCCEEDS using `getActivePersona().address` (NOT refusal); prepareReceipt.from = persona address | unit | `npm test -- prepare-native-send` (Test ~8) | 🔄 REPLACE old `DEMO_MODE_REFUSED` assertion |
| 05-02-02 | 02 | DEMO-05 / Q-CONTRADICTION-PREP-B | T-NULL-PERSONA-1 | Demo mode `preview_send` SUCCEEDS; pins gas/nonce/fees against `publicClient`; emits LEDGER BLIND-SIGN HASH block | unit | `npm test -- preview-send` (Test ~10) | 🔄 REPLACE old `DEMO_MODE_REFUSED` assertion |
| 05-02-03 | 02 | DEMO-05 | — | Demo `send_transaction` runs `publicClient.call({ account: getActivePersona().address, ... })`; returns `{ simulated: true, simulationResult, simulatedAt }`; `signClient.request` spy at 0 calls | unit | `npm test -- send-transaction` (Test 9 — evolve) | 🔄 REPLACE (existing Test 9 stubs persona) |
| 05-02-04 | 02 | T-NULL-PERSONA-1 | T-NULL-PERSONA-1 | Defensive: explicit demo (no auto-demo seed) + no `set_demo_wallet` call → `prepare_native_send` returns `WRONG_MODE` envelope | unit | `npm test -- prepare-native-send` | ❌ NEW |
| 05-02-05 | 02 | DEMO-06 (regression) | — | Demo `pair_ledger_live` still refuses outright with `DEMO_MODE_REFUSED` (NOT changed by Phase 5) | regression | `npm test -- pair-ledger-live` (line 188) | ✅ PRESERVE |
| 05-02-06 | 02 | DEMO-06 (regression) | — | Demo `get_tx_verification` still refuses with `DEMO_MODE_REFUSED` (NOT changed by Phase 5) | regression | `npm test -- get-tx-verification` (line 282) | ✅ PRESERVE |
| 05-02-07 | 02 | DEMO-05 (integration) | T-DEMO-BROADCAST-1 | End-to-end: `set_demo_wallet → prepare_native_send → preview_send → send_transaction` returns simulation envelope; `signClient.request` spy `toHaveBeenCalledTimes(0)`; Fixture A payloadFingerprint `0x7e1867b2...` byte-identical across modes (proves PREP-03 preimage is `from`-independent) | integration | `npm test -- demo-flow.integration` | ❌ NEW |
| 05-02-08 | 02 | T-PERSONA-FINGERPRINT-DRIFT-1 | T-PERSONA-FINGERPRINT-DRIFT-1 | `userDecision: "cancel"` in demo mode → handle transitions to cancelled; no broadcast; no simulation | unit | `npm test -- send-transaction` | ❌ NEW |
| 05-03-01 | 03 | DIAG-01 | T-CONFIG-LEAK-1 | `get_vaultpilot_config_status` returns exact field shape (booleans + counts + suffixes only) | unit | `npm test -- get-vaultpilot-config-status` | ❌ NEW |
| 05-03-02 | 03 | DIAG-01 (audit) | T-CONFIG-LEAK-1 | Response NEVER contains `ETHEREUM_RPC_URL` value, full WC topic, or config-file content — assert by `JSON.stringify(result)` substring scan | regression | same file | ❌ NEW |
| 05-03-03 | 03 | DIAG-02 | T-DEVICE-INFO-CLAIM-1 | `get_ledger_device_info` returns `{ paired: false, deviceConnected: "unknown", appOpen: "unknown", firmware: "unknown", hint: "...call pair_ledger_live..." }` when unpaired | unit | `npm test -- get-ledger-device-info` | ❌ NEW |
| 05-03-04 | 03 | DIAG-02 | T-DEVICE-INFO-CLAIM-1 | When paired, returns `{ paired: true, deviceConnected: "unknown", ..., sessionTopicSuffix: <last-8> }` — `deviceConnected`/`appOpen`/`firmware` stay "unknown" (no real probe API exists; tool description names limitation) | unit | `npm test -- get-ledger-device-info` | ❌ NEW |
| 05-03-05 | 03 | DIAG-03 | — | `src/server.ts` `instructions` field carries one-paragraph self-description naming trust pipeline + SECURITY.md link | regression | `npm test -- server-bootstrap` | ✅ PRESERVE (evolve text) |
| 05-03-06 | 03 | DIAG-04 | T-UPDATE-CHECK-LEAK-1 | Update check fires once per session; second call no-ops | unit | `npm test -- update-check` | ❌ NEW |
| 05-03-07 | 03 | DIAG-04 | — | `VAULTPILOT_DISABLE_UPDATE_CHECK=1` → no fetch call | unit | `npm test -- update-check` | ❌ NEW |
| 05-03-08 | 03 | DIAG-04 | T-UPDATE-CHECK-DOS-1 | 5xx / network failure / abort-controller timeout → silent (no thrown error; logger spy at 0 error calls) | unit | `npm test -- update-check` | ❌ NEW |
| 05-03-09 | 03 | DEMO-07 | T-NOTICE-OMIT-1 | First tool response in auto-demo mode has `VAULTPILOT NOTICE — Auto demo mode active` prepended via dispatcher wrap | integration | `npm test -- auto-demo-notice` | ❌ NEW |
| 05-03-10 | 03 | DEMO-07 | T-NOTICE-RACE-1 | NOTICE fires EXACTLY ONCE per session — second tool response doesn't carry it | integration | `npm test -- auto-demo-notice` | ❌ NEW |
| 05-03-11 | 03 | DEMO-07 | T-NOTICE-OVERREACH-1 | NOTICE does NOT fire when demo is explicitly opted-in via `VAULTPILOT_DEMO=true` (only auto-demo triggers it) | unit | `npm test -- auto-demo-notice` | ❌ NEW |
| 05-VERIFY | — | Combined Ph3+4+5 | All | Real Ledger + demo-mode rehearsal smoke: install fresh + run with no env → auto-demo NOTICE appears → set_demo_wallet → portfolio read → prepare/preview against persona → send simulation envelope (no broadcast); separately, with env+pair, the full real flow works | manual | verify-phase | ⬜ pending |
| Backwards-compat | — | All Phase 1-4 | — | All 196 existing tests pass after each Phase 5 plan lands (with the explicit 🔄 REPLACE rows updated) | regression | `npm test` (full) | ✅ PRESERVE (with replacements) |

*Status: ❌ NEW (Wave 0) · 🔄 REPLACE (existing test rewritten) · ✅ PRESERVE (existing test unchanged) · ⬜ pending (manual)*

---

## Wave 0 Requirements

**Test helpers (new):**
- [ ] `test/helpers/mock-config-file.ts` — `mkdtemp` + write `config.json` + return path + cleanup. NEVER touches real `~/.vaultpilot-mcp/`. Used by `demo-resolve.test.ts` + `demo-flow.integration.test.ts`.
- [ ] (Optional) `test/helpers/mock-fetch.ts` for update-check tests — or inline `vi.spyOn(globalThis, "fetch")`.

**New test files:**
- [ ] `test/demo-resolve.test.ts` — resolution chain (env / config / auto-detect / rejection)
- [ ] `test/demo-state.test.ts` — persona state + reset semantics
- [ ] `test/get-demo-wallet.test.ts` — lists 4 personas
- [ ] `test/set-demo-wallet.test.ts` — activate / unknown (SDK-pipeline schema gate per Phase 4 Test 1 methodology) / wrong-mode
- [ ] `test/get-vaultpilot-config-status.test.ts` — DIAG-01 + secret-safety audit
- [ ] `test/get-ledger-device-info.test.ts` — DIAG-02 envelope (paired + unpaired branches)
- [ ] `test/update-check.test.ts` — DIAG-04 fire-once / suppress / silent-fail
- [ ] `test/auto-demo-notice.test.ts` — DEMO-07 first-response intercept + once-per-session + auto-only-not-explicit
- [ ] `test/demo-flow.integration.test.ts` — Plan 05-02 end-to-end demo flow (mirror `test/trust-pipeline.integration.test.ts`)

**Test files to evolve (Phase 5 modifies existing tests):**
- [ ] `test/prepare-native-send.test.ts` — REPLACE the `DEMO_MODE_REFUSED` test (line ~108): demo mode now SUCCEEDS using persona address; assertion shifts from refusal to byte-identity on `prepareReceipt.from`
- [ ] `test/preview-send.test.ts` — REPLACE the demo refusal test (line ~555): similar surface change
- [ ] `test/send-transaction.test.ts` Test 9 — EVOLVE: stub `setActivePersona("whale")` in beforeEach; assert `callSpy.mock.calls[0][1].account === vitalik.address`
- [ ] `test/server-bootstrap.test.ts` — VERIFY post-edit `instructions` text if 05-03 rewrites it (per DIAG-03)

**Tests that must stay green (regression anchors):**
- [ ] `test/pair-ledger-live.test.ts` — DEMO-06 refusal preserved (Phase 5 doesn't touch this tool); DEMO-01 strict-literal regression at line 207
- [ ] `test/get-tx-verification.test.ts` — DEMO-06 refusal preserved at line 282
- [ ] All 196 Phase 1-4 tests after Plan 05-01 lands (only `isDemoMode()` body changes; predicate behavior for env=`"true"` preserved)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fresh-install auto-demo + first-response NOTICE | DEMO-07 / INST-05 | Requires actually-fresh `~/.vaultpilot-mcp/` (or `mv ~/.vaultpilot-mcp ~/.vaultpilot-mcp.bak`); test isolation in unit tests is via `mock-config-file.ts` + env override | 1. `mv ~/.vaultpilot-mcp ~/.vaultpilot-mcp.bak 2>/dev/null \|\| true` 2. `unset VAULTPILOT_DEMO` 3. `npm start` 4. From Claude Code: any tool call (e.g. `get_demo_wallet`) 5. Confirm first response carries `VAULTPILOT NOTICE — Auto demo mode active` 6. Second tool call: confirm NOTICE NOT repeated 7. `mv ~/.vaultpilot-mcp.bak ~/.vaultpilot-mcp` (restore) |
| Demo-flow rehearsal (set_demo_wallet → prepare → preview → send simulation) end-to-end on real install | DEMO-03..05, INST-05 | Exercises the full reachable demo pipeline against real RPC reads (PublicNode) | `VAULTPILOT_DEMO=true npm start` → `get_demo_wallet` (lists 4) → `set_demo_wallet({ persona: "whale" })` → `get_portfolio_summary` (vitalik's real portfolio) → `prepare_native_send({ to: <test addr>, valueWei: "1000" })` → `preview_send({ handle })` → `send_transaction({ handle, previewToken, userDecision: "send" })` → assert response is `{ simulated: true, ... }`, never broadcast, never paired with Ledger |
| Combined Phase 3+4+5 verify-phase | All Phase 3+4+5 reqs | Batched per user direction at end of trust pipeline | (separate runbook — combines real-Ledger pair + sign flow from Phase 3+4 verify-phase with demo-rehearsal flow above) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (manual-only items enumerated above)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all NEW references (helper + 9 new test files + 4 evolved test files)
- [ ] **Test surface changes documented**: 🔄 REPLACE rows in Plan 05-02 — `prepare-native-send.test.ts` + `preview-send.test.ts` + `send-transaction.test.ts` (Test 9) — must be updated in the SAME COMMIT as the source code change, NOT skipped or deferred
- [ ] No watch-mode flags (`npm test` runs vitest with `run` semantics)
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter after plan-checker green

**Approval:** pending — flip after plan-checker green.
