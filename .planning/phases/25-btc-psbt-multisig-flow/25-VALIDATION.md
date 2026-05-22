---
phase: 25
slug: btc-psbt-multisig-flow
status: draft
nyquist_compliant: true
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
| **Quick run command** | `npx vitest run test/btc-multisig-store.test.ts test/btc-multisig-combine.test.ts test/tools-sign-btc-multisig-psbt.test.ts test/signing-fingerprint.test.ts` |
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

See RESEARCH.md `## Validation Architecture` for the cryptographic-correctness requirements (descriptor validation, combine-conflict detection, finalize threshold enforcement, multisig PSBT fingerprint Fixture X).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-* | 01 | 1 | BTC-PSBT-03, BTC-PSBT-04 | T-25-REG | Malformed descriptor refused at registration; registry file 0o600 | unit | `npx vitest run test/btc-multisig-store.test.ts test/btc-multisig-address-derivation.test.ts test/tools-register-btc-multisig-wallet.test.ts` | ❌ W0 | ⬜ pending |
| 25-02-* | 02 | 2 | BTC-PSBT-05 | T-25-COMBINE | Conflicting co-signer signatures raise PSBT_COMBINE_CONFLICT — never silently dropped | unit | `npx vitest run test/btc-multisig-combine.test.ts test/tools-combine-btc-psbts.test.ts` | ❌ W0 | ⬜ pending |
| 25-03-* | 03 | 3 | BTC-PSBT-06, BTC-PSBT-07, BTC-W-04 | T-25-FINALIZE | finalize refused below signature threshold; multisig PSBT fingerprint byte-exact (Fixture X) | unit | `npx vitest run test/btc-multisig-finalize.test.ts test/tools-sign-btc-multisig-psbt.test.ts test/tools-finalize-btc-psbt.test.ts test/signing-fingerprint.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files are created per-task during execution (TDD pattern — RED scaffold first). The plans' `<verify>` blocks reference exactly these files:

- [ ] `test/btc-multisig-store.test.ts` — descriptor parse/validation + 0o600 atomic-write registry persistence (25-01)
- [ ] `test/btc-multisig-address-derivation.test.ts` — BIP-67-sorted P2WSH address derivation (25-01)
- [ ] `test/tools-register-btc-multisig-wallet.test.ts` — register + balance + utxos tools (25-01)
- [ ] `test/btc-multisig-combine.test.ts` — combine helper + pre-combine conflict scan (25-02)
- [ ] `test/tools-combine-btc-psbts.test.ts` — `combine_btc_psbts` tool (25-02)
- [ ] `test/btc-multisig-finalize.test.ts` — finalize helper + threshold enforcement (25-03)
- [ ] `test/tools-sign-btc-multisig-psbt.test.ts` — `sign_btc_multisig_psbt` tool (25-03)
- [ ] `test/tools-finalize-btc-psbt.test.ts` — `finalize_btc_psbt` tool (25-03)
- [ ] Fixture X hardcoded `0x…` literal added to existing `test/signing-fingerprint.test.ts` (25-03)

*Existing vitest infrastructure covers framework needs — no install required. Two new runtime dependencies (`@bitcoinerlab/descriptors`, `@ledgerhq/ledger-bitcoin`) are adopted during execution; tests mock the Ledger transport at the spy-affordance seam.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ledger BTC app registers a multisig wallet policy + signs a multisig PSBT on-device | BTC-PSBT-06 | Requires a physical Ledger over USB-HID with the BTC app | Captured in `25-HUMAN-UAT.md` — bundled with the deferred v2.2 real-Ledger verify-phase |
| A finalized multisig PSBT broadcasts and confirms on mainnet | BTC-PSBT-07 | Requires a real M-of-N wallet with a second cooperating signer + broadcast | Captured in `25-HUMAN-UAT.md` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 80s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-22
