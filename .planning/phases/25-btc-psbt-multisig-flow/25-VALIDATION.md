---
phase: 25
slug: btc-psbt-multisig-flow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-22
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run test/btc-multisig-registry.test.ts test/tools-btc-multisig.test.ts test/signing-fingerprint.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~80 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 80 seconds

---

## Per-Task Verification Map

Filled by the planner — see RESEARCH.md `## Validation Architecture` for the cryptographic-correctness validation requirements (descriptor validation, combine-conflict detection, finalize threshold enforcement, multisig PSBT fingerprint fixture X).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-* | 01 | 1 | BTC-PSBT-03, BTC-PSBT-04 | T-25-REG | Malformed descriptor refused at registration; registry file 0o600 | unit | `npx vitest run test/btc-multisig-registry.test.ts` | ❌ W0 | ⬜ pending |
| 25-02-* | 02 | — | BTC-PSBT-05 | T-25-COMBINE | Conflicting co-signer signatures raise PSBT_COMBINE_CONFLICT — never silently dropped | unit | `npx vitest run test/tools-btc-combine-psbt.test.ts` | ❌ W0 | ⬜ pending |
| 25-03-* | 03 | — | BTC-PSBT-06, BTC-PSBT-07, BTC-W-04 | T-25-FINALIZE | finalize refused below signature threshold; multisig PSBT fingerprint byte-exact (Fixture X) | unit | `npx vitest run test/tools-btc-multisig-sign.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/btc-multisig-registry.test.ts` — descriptor parse/validation + registry persistence
- [ ] `test/tools-btc-multisig.test.ts` (or per-tool test files) — combine / sign / finalize tools
- [ ] Fixture X hardcoded `0x…` literal added to `test/signing-fingerprint.test.ts`

*Existing vitest infrastructure covers framework needs — no install required (a new runtime dependency `@ledgerhq/ledger-bitcoin` is adopted for Ledger multisig signing; tests mock it at the transport seam).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ledger BTC app registers a multisig wallet policy + signs a multisig PSBT on-device | BTC-PSBT-06 | Requires a physical Ledger over USB-HID with the BTC app | Captured in `25-HUMAN-UAT.md` — bundled with the deferred v2.2 real-Ledger verify-phase |
| A finalized multisig PSBT broadcasts and confirms on mainnet | BTC-PSBT-07 | Requires a real M-of-N wallet with a second cooperating signer + broadcast | Captured in `25-HUMAN-UAT.md` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 80s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
