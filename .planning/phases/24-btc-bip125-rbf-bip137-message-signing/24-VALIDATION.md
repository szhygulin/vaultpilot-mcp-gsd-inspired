---
phase: 24
slug: btc-bip125-rbf-bip137-message-signing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-22
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run test/signing-fingerprint.test.ts test/tools-prepare-btc-rbf-bump.test.ts test/tools-sign-message-btc.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled by the planner — see RESEARCH.md `## Validation Architecture` for the cryptographic-correctness validation requirements (RBF fee math, BIP-137 signature shape, fixture literals R + S).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 24-01-* | 01 | 1 | BTC-W-02 | T-24-RBF | RBF refused on confirmed tx / non-signalling tx / non-increasing fee | unit | `npx vitest run test/tools-prepare-btc-rbf-bump.test.ts` | ❌ W0 | ⬜ pending |
| 24-02-* | 02 | 2 | BTC-W-03 | T-24-MSG | BIP-137 compact-sig shape byte-exact; magic-prefix hash matches Fixture S | unit | `npx vitest run test/tools-sign-message-btc.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/tools-prepare-btc-rbf-bump.test.ts` — RBF replacement build + refusal cases
- [ ] `test/tools-sign-message-btc.test.ts` — BIP-137 signature shape
- [ ] Fixtures R + S hardcoded `0x…` literals added to `test/signing-fingerprint.test.ts`

*Existing vitest infrastructure covers framework needs — no install required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ledger BTC app clear-signs message text on-device | BTC-W-03 SC#5 | Requires physical Ledger over USB-HID | Captured in `24-HUMAN-UAT.md` — bundled with the deferred v2.2 real-Ledger verify-phase |
| RBF replacement broadcasts + replaces the original in a live mempool | BTC-W-02 | Requires a real mempool-pending tx + broadcast | Captured in `24-HUMAN-UAT.md` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
