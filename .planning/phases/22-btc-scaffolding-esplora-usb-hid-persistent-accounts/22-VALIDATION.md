---
phase: 22
slug: btc-scaffolding-esplora-usb-hid-persistent-accounts
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-21
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Filled by `gsd-planner` from `22-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- {scoped file path}` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~25-35 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run scoped `npm test -- {file under test}`
- **After every plan wave:** Run full suite `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds (scoped); ~35 seconds (full)

---

## Per-Task Verification Map

> Populated by gsd-planner during plan generation. Each row maps a task to its requirement, test type, and automated command.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD     | TBD  | TBD  | TBD         | TBD        | TBD             | TBD       | TBD               | TBD         | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/chains/bitcoin/esplora-client.test.ts` — stubs for BTC-READ-01..05 (fetch-stub fixtures)
- [ ] `test/chains/bitcoin/derivation.test.ts` — stubs for BTC-PAIR-01..02 (BIP-32 Test Vector 1 anchor)
- [ ] `test/chains/bitcoin/xpub-scanner.test.ts` — stubs for BTC-READ-03 gap-limit scan
- [ ] `test/wallet/btc-pair.test.ts` — stubs for BTC-PAIR-01 (USB-HID transport stub + PAIR-NEV-* persistence)
- [ ] `test/tools/btc-read-tools.test.ts` — stubs for BTC-READ-01..05 read-tool dispatch
- [ ] Cryptographic-binding fixtures pinned as hardcoded literals: known mainnet xpub → first 5 segwit (bc1q…) + first 5 taproot (bc1p…) derivations + Esplora response fixtures for address / utxo / fee-estimates endpoints

*If none of the above already exist when Phase 22 starts execution, the first task in each plan creates the stub file under Wave 0.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| USB-HID Ledger BTC app open + segwit + taproot address derivation | BTC-PAIR-01 | Requires physical Ledger device | Connect Ledger, open BTC app, run `pair_btc_ledger()`, verify on-device address against returned `addresses.segwit` + `addresses.taproot` |
| Live Esplora blockstream.info + mempool.space endpoint compat | BTC-READ-01..05 | Network-dependent; live API may drift | Run `get_btc_balance` against a known mainnet address; cross-check sat/BTC balance against block explorer UI |

*All other phase behaviors have automated verification via vitest + fetch-stub fixtures.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (esplora-client / derivation / xpub-scanner / btc-pair / btc-read-tools stub files)
- [ ] No watch-mode flags
- [ ] Feedback latency < 35s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
