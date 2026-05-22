---
phase: 26
slug: ltc-scaffolding-lifi-btc-bridging
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-22
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run <changed-test-file>` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~60–90 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <changed-test-file>`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

> Filled in per-task by the planner. Each PLAN.md task carries `<acceptance_criteria>` with a concrete `npx vitest run` command or source assertion. Cryptographic-binding fixtures (Y / Z / AA) get hardcoded `0x…` literal anchors in the signing-fingerprint test files per CLAUDE.md convention.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| (planner fills) | 01 | 1 | LTC-PAIR-01, LTC-READ-01/02 | — | LTC pairing returns verbatim address; reads never throw | unit | `npx vitest run` | ⬜ pending |
| (planner fills) | 02 | 2 | LTC-W-01, LTC-W-02 | T-26-* | LTC fingerprint domain-tagged; from-independent byte-identity | unit | `npx vitest run` | ⬜ pending |
| (planner fills) | 03 | 3 | BTC-LIFI-01 | T-26-* | `decodedFinalRecipient == userSuppliedToAddress` refusal on mismatch | unit | `npx vitest run` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing vitest infrastructure covers all phase requirements — no new framework install. New sibling test files (LTC scaffolding, LTC signing-fingerprint, BTC-LiFi) follow existing `test/` naming conventions.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ledger Litecoin-app pairing over real USB-HID | LTC-PAIR-01 | Requires physical Ledger device | Bundled into the v2.2 real-Ledger verify session — pair, confirm LTC address on-device |
| LTC native-send small mainnet broadcast | LTC-W-01 | Requires device + LTC balance | v2.2 verify session — small returnable LTC transfer, on-device hash match |
| BIP-137 LTC message signing on-device | LTC-W-02 | Requires device | v2.2 verify session — sign message, confirm bytes on-device |
| BTC→EVM / BTC→Solana LiFi bridge broadcast | BTC-LIFI-01 | Requires device + BTC balance + live LiFi route | v2.2 verify session — small bridge, confirm final recipient on-device |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
