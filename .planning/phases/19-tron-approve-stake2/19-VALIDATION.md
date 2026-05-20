---
phase: 19
slug: tron-approve-stake2
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-20
---

# Phase 19 — Validation Strategy

> **Wave 0 / Nyquist note:** TDD inline satisfies Wave 0 — every plan task that creates a new source file ships its sibling test file in the same atomic commit (`type: tdd` on each task). No Wave 0 setup task is needed because the test infrastructure (vitest) is already in place from Phase 1. The `❌ W0` markers in the sampling map below indicate "file does not exist yet on `main`; created by the plan's TDD task," not "Wave 0 prerequisite unmet."


> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (project standard) |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npx vitest run test/signing-fingerprint-tron-19.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~60 seconds full suite (Phase 18 baseline 2061 tests ~45s; +~120 new test cases) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/signing-fingerprint-tron-19.test.ts -x` (~2s)
- **After every plan wave:** Run `npx vitest run -x` (~60s)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-* | 01 | 1 | TRON-PREP-05 | T-SPENDER-SUB-1 | Spender allowlist check + byte-identity invariant | unit | `npx vitest run test/prepare-tron-token-approve.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-01-* | 01 | 1 | TRON-PREP-05 | T-MAX-EXPLICIT | `amount: "max"` → MAX_UINT256 strict-equality | unit | same file | ❌ W0 | ⬜ pending |
| 19-01-* | 01 | 1 | TRON-W-03 | T-REVOKE-NAMED | Distinct named tool; `approve(spender,0)` calldata | unit | `npx vitest run test/prepare-tron-revoke-approval.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-01-* | 01 | 1 | TRON-PREP-05 | T-FIXTURE-A | Fixture Tron-19-A literal anchor (byte-identity) | unit | `npx vitest run test/signing-fingerprint-tron-19.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-01-* | 01 | 1 | TRON-W-08 | T-SPENDER-LABEL | `KNOWN_SPENDERS_TRON` sub-table in contracts.ts | unit | `npx vitest run test/config-contracts.test.ts -x` | ✅ extends | ⬜ pending |
| 19-02-* | 02 | 2 | TRON-W-04 | T-STAKE2-DISTINCT | `FreezeBalanceV2Contract` (NOT Stake 1.0 `FreezeBalanceContract`) | unit | `npx vitest run test/prepare-tron-stake-freeze.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-02-* | 02 | 2 | TRON-W-04 | T-FIXTURE-B | Fixture Tron-19-B literal anchor | unit | `npx vitest run test/signing-fingerprint-tron-19.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-02-* | 02 | 2 | TRON-W-04 | — | `parseTronAmountStrict` + `number` conversion overflow guard for `frozen_balance` | unit | `npx vitest run test/prepare-tron-stake-freeze.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-02-* | 02 | 2 | TRON-W-05 | T-EARLY-WITHDRAW | Simulation gate refuses pre-14d withdraw (asymmetric Layer 0.7 advisory→refusal) | unit | `npx vitest run test/prepare-tron-withdraw-expire-unfreeze.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-02-* | 02 | 2 | TRON-W-05 | — | Zero-arg dispatch shape | unit | same file | ❌ W0 | ⬜ pending |
| 19-03-* | 03 | 3 | TRON-W-06 | T-VOTE-MAP | `votes[]` array → `{[srAddress]: number}` map conversion in protocol layer | unit | `npx vitest run test/prepare-tron-stake-vote.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-03-* | 03 | 3 | TRON-W-06 | T-FIXTURE-C | Fixture Tron-19-C literal anchor | unit | `npx vitest run test/signing-fingerprint-tron-19.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-03-* | 03 | 3 | TRON-W-06 | T-SR-REGISTRY | Hybrid live + snapshot fallback for SR labels | unit | `npx vitest run test/protocols-tron-sr-registry.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-03-* | 03 | 3 | TRON-W-07 | T-FIXTURE-D | Fixture Tron-19-D literal anchor | unit | `npx vitest run test/signing-fingerprint-tron-19.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-03-* | 03 | 3 | TRON-W-07 | — | Zero-arg `prepare_tron_stake_claim_rewards` + advisory `estimatedRewardSun` | unit | `npx vitest run test/prepare-tron-stake-claim-rewards.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-04-* | 04 | 4 | D-10 | T-LIFECYCLE | Lifecycle: freeze → unfreeze → `vi.setSystemTime(+14d)` → withdraw | integration | `npx vitest run test/lifecycle-tron-stake-19.integration.test.ts -x` | ❌ W0 | ⬜ pending |
| 19-04-* | 04 | 4 | D-11 | T-FROZEN | FROZEN-area zero-diff (payload-fingerprint-tron + presign-hash-tron + simulation-tron + amount-tron) | manual+git | `git diff origin/main -- src/signing/payload-fingerprint-tron.ts src/signing/presign-hash-tron.ts src/signing/simulation-tron.ts src/signing/amount-tron.ts` | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/signing-fingerprint-tron-19.test.ts` — Fixture sibling carve (Tron-19-{A,B,C,D}) per D-08
- [ ] `test/prepare-tron-token-approve.test.ts` — TRON-PREP-05 + max + spender label
- [ ] `test/prepare-tron-revoke-approval.test.ts` — TRON-W-03 byte-identity vs approve(spender,0)
- [ ] `test/prepare-tron-stake-freeze.test.ts` — TRON-W-04 FreezeBalanceV2Contract + overflow guard
- [ ] `test/prepare-tron-stake-unfreeze.test.ts` — TRON-W-04 mirror tool
- [ ] `test/prepare-tron-withdraw-expire-unfreeze.test.ts` — TRON-W-05 zero-arg + simulation gate
- [ ] `test/prepare-tron-stake-vote.test.ts` — TRON-W-06 array→map conversion
- [ ] `test/prepare-tron-stake-claim-rewards.test.ts` — TRON-W-07 zero-arg + advisory reward
- [ ] `test/protocols-tron-sr-registry.test.ts` — SR registry hybrid live+snapshot
- [ ] `test/lifecycle-tron-stake-19.integration.test.ts` — D-10 multi-tx lifecycle with vi.setSystemTime
- [ ] `src/tokens/tron-srs.json` — top ~30 SRs by voteCount (snapshot fallback)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ledger TRX-app screen displays `⚠ UNLIMITED APPROVAL` text alongside `2^256-1` value when previewing `amount: "max"` approve | TRON-PREP-05 | Hardware-wallet display content cannot be automated in CI; requires physical Ledger | Pair device, call `prepare_tron_token_approve({amount:"max"})`, run `preview_send` then `send_transaction`, photograph device screen, file under `.planning/verification/19-ledger-screenshots/` |
| Lifecycle integration: real freeze → wait 14d on testnet → withdraw — confirms TRON consensus aligns with simulator | D-10 | Requires real Nile testnet broadcast + 14d real-time wait — out of scope for automated CI | Documented manual UAT instruction in `19-04-PLAN.md`; user runs on personal testnet account |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
