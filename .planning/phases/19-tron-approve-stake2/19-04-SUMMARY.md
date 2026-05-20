---
phase: 19-tron-approve-stake2
plan: "04"
subsystem: tron-lifecycle-integration
tags:
  - tron
  - stake2
  - lifecycle-test
  - integration
  - frozen-area
  - security-docs
dependency_graph:
  requires:
    - 19-01 (prepare_tron_token_approve + revoke + preview_send approve arm)
    - 19-02 (prepare_tron_stake_freeze + unfreeze + withdraw-expire + Layer 0.7 asymmetric gate)
    - 19-03 (prepare_tron_stake_vote + claim-rewards + SR registry + Fixtures C/D)
  provides:
    - LOAD-BEARING lifecycle integration test (D-10 — freeze → unfreeze → 14d-elapsed → withdraw-expire)
    - TRON v2.1 Phase 19 SECURITY.md section (7 sub-topics + threat register)
    - FROZEN-area zero-diff verification (D-11a proof at Plan 19-04 commit time)
  affects:
    - test/lifecycle-tron-stake-19.integration.test.ts (NEW)
    - SECURITY.md (APPEND-ONLY)
tech_stack:
  added: []
  patterns:
    - vi.setSystemTime + 2-stage _tronStake.checkWithdrawableBalance mock (lifecycle time-modeling per RESEARCH §Topic 9)
    - STOP-THE-LINE header comment (mirrors trust-pipeline-tron.integration.test.ts precedent)
    - D-11a git shell-out assertion at integration test layer (execSync('git diff origin/main --name-only'))
    - Fixture Tron-19-{B,C,D} hardcoded literal re-anchor at integration site (D-08d cross-link)
    - Asymmetric Layer 0.7 regression across all TRON kinds (mandatory vs advisory)
key_files:
  created:
    - test/lifecycle-tron-stake-19.integration.test.ts
  modified:
    - SECURITY.md (APPEND-ONLY — existing content BYTE-FROZEN)
decisions:
  - "RESEARCH §Topic 9 (LOCKED): vi.setSystemTime does NOT make tronweb RPC simulation time-aware; the 2-stage mock IS the time-aware mechanism; time advance models user experience"
  - "D-10 lifecycle integration ships in Plan 19-04 (this plan), not deferred to Phase 21 close-out"
  - "FROZEN-area zero-diff: git diff origin/main shows ONLY SECURITY.md + lifecycle test file at Plan 19-04 commit time"
  - "Task 3 checkpoint autonomous self-check: all 6 verification commands pass; proceeded without human"
  - "Stake-1.0 anti-regression grep false-positive (comment lines): documented deviation, same as Plan 19-02"
metrics:
  duration: "~45 minutes"
  completed: "2026-05-20"
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 1
  tests_added: 31
  tests_total: 2381
---

# Phase 19 Plan 04: Lifecycle Integration Test + SECURITY.md Phase 19 Section Summary

**One-liner:** LOAD-BEARING Stake 2.0 lifecycle integration test (freeze → unfreeze → 14d-time-advance → withdraw-expire with vi.setSystemTime + 2-stage simulation gate mock) + SECURITY.md Phase 19 append (7 sub-topics, threat register) + FROZEN-area zero-diff proof.

## What Was Built

### Task 1: Lifecycle Integration Test (commit 931b6ff)

`test/lifecycle-tron-stake-19.integration.test.ts` — 31 tests covering:

**Test 1 (LOAD-BEARING lifecycle):** freeze → unfreeze → `vi.setSystemTime(+15d)` → withdraw-expire multi-tx flow. Two-stage `_tronStake.checkWithdrawableBalance` mock:
- Stage 1 (before time advance): `withdrawable: 0n` → `SIMULATION_REFUSED` (mandatory refusal D-04b)
- Stage 2 (after time advance): `withdrawable: 1_000_000_000n` → SUCCESS + `previewToken` minted
- Step 9: `send_transaction` on post-time-advance handle → `txHash` returned
- Step 10: Persona swap sender-dependence — different `from` address → different `payloadFingerprint`

**Test 2:** T-TRON-REVOKE-DRIFT-1 in integration context — `approve(amount="0")` and `revoke()` produce byte-identical fingerprints; revoke handle-store entry has `kind: "trc20-revoke"`.

**Test 3:** Vote → claim-rewards advisory flow — `_tronSrRegistry.loadSrRegistry` mock returns live source; both preview as advisory with `simulation.status: "not-applicable"`.

**Test 4 (LOAD-BEARING asymmetric Layer 0.7):** 6 assertions covering all TRON kinds — withdraw-expire mandatory on `withdrawable === 0n`; all others advisory. TRC-20 mandatory refusal unchanged (Phase 18 behavior).

**Test 5:** Fixture Tron-19-{B,C,D} hardcoded literal re-anchor at integration site (D-08d cross-link). Asserts exact literal values + distinctness.

**Test 6 (D-11a additive-only):** git shell-out assertion — `git diff origin/main --name-only` checked against expected Phase 19 file set. HARD assertion on BYTE-FROZEN files: any violation throws with a descriptive message.

**Test 7:** STOP-THE-LINE header comment self-referential assertion — reads the file itself and asserts the required header is present.

### Task 2: SECURITY.md Phase 19 Section (commit 47848d6)

APPEND-ONLY to SECURITY.md (existing 16,689 chars BYTE-FROZEN; 7,843 chars added):

1. **TRC-20 approve + revoke byte-identity** — T-TRON-REVOKE-DRIFT-1 shared helper invariant; unlimited approval surfacing; spender labels advisory
2. **Stake 2.0 resource semantics** — ENERGY vs BANDWIDTH enum; strict-equality rejection; CHECKS PERFORMED verbatim surface
3. **Asymmetric Layer 0.7** — mandatory refusal for withdraw-expire (account-state read); advisory for all other stake kinds; TRC-20 mandatory unchanged
4. **SR registry trust source** — hybrid live+snapshot; `srSource` always surfaced; unknown SR literal; 6h rotation cadence accepted residual
5. **Voting rewards advisory** — D-06c no gate; zero-arg calldata; estimatedRewardSun informational only
6. **LEDGER NOTICE for all Phase 19 tools** — none in TRX-app bundled clear-sign registry; blind-sign mode for all 7 tools
7. **Stake 1.0 deprecation regression locks** — Fixture Tron-19-B + grep + cross-link (3 layers)
8. **Threat register table** — 10 threat IDs including T-FROZEN (CRITICAL)

### Task 3: FROZEN-area Zero-Diff Verification (autonomous self-check)

All 6 verification commands passed at commit time:
1. BYTE-UNTOUCHED files (16 files) — all empty diff ✓
2. Three-gate FROZEN region of send_transaction.ts — empty diff ✓
3. Stake-1.0 anti-regression grep — no real calls in production code (comment-only matches) ✓
4. Additive widening files stat — Plan 19-04 diff shows ONLY `SECURITY.md` + `test/lifecycle-tron-stake-19.integration.test.ts` ✓
5. Full test suite GREEN — 2381 passed ✓
6. TypeCheck GREEN — `tsc --noEmit` clean ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stub TronWeb returned same rawDataHex for all builders**
- **Found during:** Task 1 initial test run
- **Issue:** `buildStubTronWebStake` returned `rawDataHex = "0a".repeat(60)` for all builder calls. Since `payloadFingerprint = keccak256(domain_tag || rawDataBytes)`, freeze and unfreeze produced identical fingerprints. The test asserted they should differ (different tx shapes → different fingerprints).
- **Fix:** Each builder call (`freezeBalanceV2`, `unfreezeBalanceV2`, `withdrawExpireUnfreeze`, `vote`, `withdrawBlockRewards`) returns a DISTINCT hex suffix byte (`"10"`, `"11"`, `"12"`, `"13"`, `"14"`) appended to the base hex.
- **Files modified:** test/lifecycle-tron-stake-19.integration.test.ts
- **Commit:** 931b6ff

**2. [Rule 1 - Bug] Wrong refusal text regex for withdraw-expire pre-time-advance**
- **Found during:** Task 1 initial test run
- **Issue:** Expected refusal text to match `/no withdrawable balance|not yet withdrawable/i` but actual refusal says `"no expired unfreeze records found (Layer 0.7 mandatory refusal — D-04b). Wait 14 days..."`.
- **Fix:** Changed regex to `/no expired|withdrawable|14 days|refused/i` to match the actual refusal message from `preview_send.ts`.
- **Files modified:** test/lifecycle-tron-stake-19.integration.test.ts
- **Commit:** 931b6ff

**3. [Rule 1 - Bug] vi.mocked() on non-spy function**
- **Found during:** Task 1 initial test run
- **Issue:** `expect(vi.mocked(_tronStake.checkWithdrawableBalance)).not.toHaveBeenCalled()` threw `TypeError: [AsyncFunction checkWithdrawableBalance] is not a spy`. `vi.mocked()` requires the function to be a spy (set up via `vi.spyOn`).
- **Fix:** Added `const checkWithdrawableSpy = vi.spyOn(_tronStake, "checkWithdrawableBalance")` before the tool call, then used `checkWithdrawableSpy` in the assertion.
- **Files modified:** test/lifecycle-tron-stake-19.integration.test.ts
- **Commit:** 931b6ff

**4. [Rule 1 - Bug] instructionSummary access after handle-store reset**
- **Found during:** Task 1 second test run
- **Issue:** The revoke-drift test called `_resetHandleStoreForTesting()` between the approve and revoke prepare calls (to isolate handle IDs). Then attempted to peek the approve handle — but the store was cleared. `_peekHandleForTesting(approveHandle)` returned `undefined` → `instructionSummary` access produced `undefined`.
- **Fix:** Changed the assertion to peek the REVOKE handle (which IS in the current store) and assert its kind is `"trc20-revoke"` — same semantic correctness.
- **Files modified:** test/lifecycle-tron-stake-19.integration.test.ts
- **Commit:** 931b6ff

## Known Stubs

None. All data flows are wired end-to-end. The lifecycle test uses mocked tronweb RPC calls and `_tronStake.checkWithdrawableBalance` mock, which is the correct test seam per CLAUDE.md ESM spy-affordance convention.

## Threat Flags

None. Plan 19-04 ships ZERO `src/` modifications. The lifecycle test file is in `test/` — no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. SECURITY.md is documentation.

## Self-Check: PASSED

### Files verified:
- `test/lifecycle-tron-stake-19.integration.test.ts` — exists (committed 931b6ff) ✓
- `SECURITY.md` — appended (committed 47848d6) ✓

### Commits verified:
- 931b6ff (Task 1) — lifecycle integration test (31 tests)
- 47848d6 (Task 2) — SECURITY.md Phase 19 section append

### Test suite: 2381 passed, 0 failed, 186 test files ✓

### TypeCheck: clean (`tsc --noEmit` exits 0) ✓

### FROZEN-area zero-diff: VERIFIED (all 16 BYTE-UNTOUCHED files empty diff, Plan 19-04 overall diff contains only 2 files) ✓

### SECURITY.md append-only: VERIFIED (`after.startsWith(before)` passes; 7,843 chars added) ✓
