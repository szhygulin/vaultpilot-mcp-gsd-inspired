---
phase: 23
slug: btc-native-segwit-taproot-trust-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-22
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `23-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^2.1.0 (installed since Phase 1) |
| **Config file** | `vitest` config in project root / `package.json` |
| **Quick run command** | `npx vitest run <the plan's new/modified test files>` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~60–90 seconds (full suite; baseline 2677 tests) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <new/modified test files for that task>`
- **After every plan wave:** Run `npx vitest run` (full suite — must stay green; baseline 2677 tests)
- **Before `/gsd-verify-work`:** Full suite green AND `tsc` clean
- **Max feedback latency:** ~90 seconds

---

## Per-Task Verification Map

> Filled by the planner during planning — each plan's tasks map to the requirement rows below.
> The planner MUST derive `<automated>` verify blocks from this map.

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| BTC-PREP-01 | Fingerprint = keccak over domain-tag ‖ concat(per-input sighashes); Fixtures O/P/Q pinned as `0x…` literals | unit | `npx vitest run test/signing-fingerprint.test.ts` | ✅ append O/P/Q |
| BTC-PREP-01 | Per-input sighash deterministic (segwit `hashForWitnessV0`, taproot `hashForWitnessV1`) | unit | `npx vitest run test/btc-sighash.test.ts` | ❌ W0 |
| BTC-PREP-02 | `preview_send` BTC branch — decoded inputs/outputs + per-input sighash block + drift recompute | unit | `npx vitest run test/preview-send.btc.test.ts` | ❌ W0 |
| BTC-PREP-03 | `send_transaction` BTC branch — previewToken + userDecision + fingerprint-drift gate | unit | `npx vitest run test/send-transaction.btc.test.ts` | ❌ W0 |
| BTC-PSBT-01 | `prepare_btc_send` returns `{handle, psbt, inputs[], outputs[], feeSats, payloadFingerprint, prepareReceipt}`; BnB + manual override | unit | `npx vitest run test/prepare-btc-send.test.ts` | ❌ W0 |
| BTC-PSBT-01 | BnB selection + largest-first fallback; fee-sanity bounds (D-03); dust refusal (D-07) | unit | `npx vitest run test/btc-coin-select.test.ts` | ❌ W0 |
| BTC-PSBT-02 | Mixed segwit+taproot inputs build a valid PSBT; two-pass signing combines correctly (mocked transport) | unit + integration | `npx vitest run test/btc-psbt.test.ts test/ledger-btc-transport.test.ts` | ❌ W0 |
| BTC-W-01 | Native segwit AND taproot sends both produce valid PSBTs via the same tool | unit | `npx vitest run test/prepare-btc-send.test.ts` | ❌ W0 |
| (cross) | Persona-cycle byte-identity — same `{to, sats}` + same UTXOs → byte-identical fingerprint; different UTXOs → distinct fingerprint | integration | `npx vitest run test/btc-trust-pipeline.integration.test.ts` | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/btc-sighash.test.ts` — per-input BIP-143/341 sighash determinism; covers BTC-PREP-01
- [ ] `test/btc-coin-select.test.ts` — BnB + largest-first fallback + fee-sanity + dust; covers BTC-PSBT-01 / D-01 / D-03 / D-07
- [ ] `test/btc-psbt.test.ts` — `buildBtcPsbt` segwit/taproot/mixed; covers BTC-PSBT-01 / BTC-PSBT-02
- [ ] `test/prepare-btc-send.test.ts` — the prepare tool end-to-end (mocked Esplora + transport); covers BTC-PSBT-01 / BTC-W-01
- [ ] `test/preview-send.btc.test.ts` — preview BTC branch; covers BTC-PREP-02
- [ ] `test/send-transaction.btc.test.ts` — BTC dispatch-arm gates + FROZEN-region zero-diff assertion; covers BTC-PREP-03
- [ ] `test/btc-trust-pipeline.integration.test.ts` — persona-cycle byte-identity regression anchor
- [ ] `test/ledger-btc-transport.test.ts` extension — `signBtcPsbt` two-pass mock coverage
- [ ] Fixture O (segwit) + P (taproot) + Q (mixed) appended to `test/signing-fingerprint.test.ts` as hardcoded `0x…` literals (computed once via `node -e`, NO `beforeAll`-snapshot)

*Framework is already installed (Phase 1) — no framework-install task needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-Ledger USB-HID BTC-app PSBT signing (segwit + taproot + mixed two-pass) | BTC-W-01 / BTC-PSBT-02 | Requires a physical Ledger with the BTC app; transport is mocked in CI | Bundled into the v2.2 verify-phase real-Ledger smoke (Assumptions A1–A5 from RESEARCH.md) |
| Live Esplora UTXO fetch + small-amount mainnet broadcast | BTC-PSBT-01 | Requires live network + funded mainnet wallet | v2.2 verify-phase, per the 2026-05-16 deferred-items directive |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
