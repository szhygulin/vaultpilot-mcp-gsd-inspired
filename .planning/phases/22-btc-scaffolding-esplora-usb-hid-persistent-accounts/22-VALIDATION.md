---
phase: 22
slug: btc-scaffolding-esplora-usb-hid-persistent-accounts
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-21
updated: 2026-05-21
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Filled by `gsd-planner` from `22-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run test/{scoped file path}` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~25-35 seconds (full suite); ~1-2s scoped per test file |

---

## Sampling Rate

- **After every task commit:** Run scoped `npm test -- {file under test}` (~1-2s)
- **After every plan wave:** Run full suite `npm test` (~35s)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~2 seconds (scoped); ~35 seconds (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 22-01-T1 | 22-01 | 1 | BTC-READ-01..05 (foundation) | T-22-SC (supply chain) | bitcoinjs-lib + hw-app-btc supply-chain pinned; bech32/bech32m two-gate (regex + lib) | unit | `npx vitest run test/chains-bitcoin-registry.test.ts test/chains-bitcoin-address-types.test.ts test/config-env-bitcoin.test.ts` | ❌ Wave 0 | ⬜ pending |
| 22-01-T2 | 22-01 | 1 | BTC-READ-01..05 (HTTP shell) | T-22-01, T-22-03, T-22-04 | NEVER-throws 5-arm union; fetch-stub seam at outer boundary; AbortController timeout; LRU cache; rate-limit surfaced explicitly | unit | `npx vitest run test/chains-bitcoin-esplora-client.test.ts` | ❌ Wave 0 | ⬜ pending |
| 22-02-T1 | 22-02 | 2 | BTC-PAIR-01 (transport) | T-22-05, T-22-06, T-22-08, T-22-10, T-22-11 | getAppConfiguration BTC-vs-LTC gate FIRST; HARDCODED format-per-path; verify:true on-device confirm; try/finally close handle leak defense; 5-level BIP-44 regression anchor; chainCode is public material | unit | `npx vitest run test/ledger-btc-transport.test.ts` | ❌ Wave 0 | ⬜ pending |
| 22-02-T2 | 22-02 | 2 | BTC-PAIR-01, PAIR-NEV-01..03, PAIR-NEV-05..06 | T-22-07, T-22-09 | Demo-mode-FIRST gate (T-DEMO-1); dual saveAccount under chain:"bitcoin" (PAIR-NEV-03 multi-record); locked errorCode set; idempotent (chain,address) upsert; cold-boot restore via existing PAIR-NEV-02 eager-init (no new init code) | unit | `npx vitest run test/pair-btc-ledger.test.ts test/non-evm-account-store.test.ts test/non-evm-store.eager-init.test.ts` | ❌ Wave 0 (pair-btc-ledger) + ✅ EXTEND (non-evm-store tests) | ⬜ pending |
| 22-03-T1 | 22-03 | 3 | BTC-READ-03 | T-22-14, T-22-15 | Gap-limit-20 termination on COMBINED tx_count; concurrency cap 5; per-xpub TTL 5min; BIP-32 Test Vector 1 deterministic hardcoded literal anchor (CLAUDE.md fixture convention adapted) | unit | `npx vitest run test/chains-bitcoin-xpub-scan.test.ts` | ❌ Wave 0 | ⬜ pending |
| 22-03-T2 | 22-03 | 3 | BTC-READ-01, BTC-READ-02, BTC-READ-03, BTC-READ-04, BTC-READ-05 | T-22-12, T-22-13, T-22-16, T-22-17 | Pattern-match on 5-arm Esplora union (NEVER throw); funded - spent computation (not raw funded — RESEARCH Pitfall 3); Promise.allSettled parallel; gap-limit-respecting xpub scan; 5-key fee-estimate projection (ROADMAP SC#7); no Psbt import (Phase 22 anti-pattern) | unit | `npx vitest run test/get-btc-balance.test.ts test/get-btc-balances.test.ts test/get-btc-account-balance.test.ts test/get-btc-tx-history.test.ts test/get-btc-fee-estimates.test.ts` | ❌ Wave 0 | ⬜ pending |
| 22-04-T1 | 22-04 | 4 | BTC-PAIR-02 (persona surface) | T-22-19, T-22-20 | DUAL DOA validation at module load (segwit + taproot); sibling-interface NOT EVM-Persona-widening; OFAC-clean ritual verified at write time; simulationEnvelopeShape Phase 23 anchor typed | unit | `npx vitest run test/bitcoin-persona.test.ts test/demo-state.bitcoin.test.ts` | ❌ Wave 0 | ⬜ pending |
| 22-04-T2 | 22-04 | 4 | BTC-PAIR-02 | T-22-18, T-22-21, T-22-22, T-22-23 | Dual-record envelope via address-prefix discrimination; staleAccountWarning per-record OR; pairedNonEvmChains dedupes via new Set (ZERO code change to aggregation); btcEsploraConfigured boolean reflects env-set only; NO lazy probe; shoulder-surfing defense intact (derivationPath does NOT bleed via list_paired_non_evm_accounts) | unit | `npx vitest run test/get-btc-status.test.ts test/get-vaultpilot-config-status-bitcoin.test.ts test/get-demo-wallet.bitcoin.test.ts test/set-demo-wallet.bitcoin.test.ts` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 = each Plan's first task creates the new test files since none exist yet. The plans are structured so each task's `<files>` block lists both source + test files together — execute-plan's TDD-aware executor writes the test first when `tdd="true"` is set on the task.

- [ ] `test/chains-bitcoin-registry.test.ts` — covers Plan 22-01 Task 1 (env override + warn-once latch)
- [ ] `test/chains-bitcoin-esplora-client.test.ts` — covers Plan 22-01 Task 2 (4 fetch helpers, 5-arm union, LRU, AbortController)
- [ ] `test/chains-bitcoin-address-types.test.ts` — covers Plan 22-01 Task 1 (bech32 + bech32m branded + two-gate assert)
- [ ] `test/chains-bitcoin-xpub-scan.test.ts` — covers Plan 22-03 Task 1 (gap-limit-20 + BIP-32 Test Vector 1 hardcoded anchor + concurrency-5 + TTL-5min)
- [ ] `test/config-env-bitcoin.test.ts` — covers Plan 22-01 Task 1 (`BTC_ESPLORA_URL` env reader)
- [ ] `test/ledger-btc-transport.test.ts` — covers Plan 22-02 Task 1 (per-call transport + dual-address fetch + getAppConfiguration BTC-app gate + handle-leak defense)
- [ ] `test/pair-btc-ledger.test.ts` — covers Plan 22-02 Task 2 (demo-mode-first + 60s race + VERIFY-ON-DEVICE block + dual saveAccount)
- [ ] `test/get-btc-balance.test.ts` — covers Plan 22-03 Task 2 (single Esplora call → BalanceReport)
- [ ] `test/get-btc-balances.test.ts` — covers Plan 22-03 Task 2 (parallel segwit + taproot via Promise.allSettled)
- [ ] `test/get-btc-account-balance.test.ts` — covers Plan 22-03 Task 2 (xpub-scan; gap-limit-20 stop is load-bearing)
- [ ] `test/get-btc-tx-history.test.ts` — covers Plan 22-03 Task 2 (limit + pagination cursor + stripped row shape)
- [ ] `test/get-btc-fee-estimates.test.ts` — covers Plan 22-03 Task 2 (5-key projection from Esplora /fee-estimates)
- [ ] `test/get-btc-status.test.ts` — covers Plan 22-04 Task 2 (dual-address envelope; per-record staleAccountWarning OR; no lazy probe)
- [ ] `test/get-vaultpilot-config-status-bitcoin.test.ts` — covers Plan 22-04 Task 2 (`btcEsploraConfigured` + `pairedNonEvmChains` extension)
- [ ] `test/bitcoin-persona.test.ts` — covers Plan 22-04 Task 1 (DOA validation throws on tampered segwit OR taproot)
- [ ] `test/demo-state.bitcoin.test.ts` — covers Plan 22-04 Task 1 (setActiveBtcPersona round-trip + setActiveBtcPersonaBySlug + reset)
- [ ] `test/get-demo-wallet.bitcoin.test.ts` + `test/set-demo-wallet.bitcoin.test.ts` — covers Plan 22-04 Task 2 (slug routing)
- [ ] **EXTEND** `test/non-evm-account-store.test.ts` — assert two `chain: "bitcoin"` records coexist + age independently (Plan 22-02 Task 2)
- [ ] **EXTEND** `test/non-evm-store.eager-init.test.ts` — assert cold-boot restore loads BOTH bitcoin records (Plan 22-02 Task 2)

---

## Cryptographic-Binding Fixtures (adapted for deterministic-derivation outputs — CLAUDE.md convention extended)

Phase 22 has NO signing, NO `payloadFingerprint` — but address derivation outputs ARE deterministic, so the spirit of CLAUDE.md's "Cryptographic-binding fixtures pinned as hardcoded literals" convention extends to:

1. **BIP-32 Test Vector 1 → first-5-derivations anchor** (Plan 22-03 Task 1): hardcoded `bc1q…` + `bc1p…` literals in `test/chains-bitcoin-xpub-scan.test.ts`. NO `beforeAll`-snapshot — drift in `bitcoinjs-lib`'s derivation OR in the payment helpers (p2wpkh / p2tr) fails at a specific line.

2. **Esplora response fixtures** (Plan 22-01 Task 2 + Plan 22-03 Task 2): JSON literals for `/address/{addr}` happy-path, `/fee-estimates` happy-path, `/address/{addr}/utxo` happy-path, `/address/{addr}/txs` happy-path, 404 not-found shape. All sourced from RESEARCH §Validation Architecture live-probe captures (2026-05-21).

3. **Gap-limit boundary anchor** (Plan 22-03 Task 1): mock Esplora returns 20 consecutive empty addresses; assertion is `fetchAddressInfo` called EXACTLY 20 times, NOT 21.

4. **BTC whale persona address anchor** (Plan 22-04 Task 1): hardcoded `bc1q…` + `bc1p…` literals in `src/demo/bitcoin-persona.ts` AND in the inline OFAC-clean verification ritual commit-message format.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| USB-HID Ledger BTC app open + segwit + taproot address derivation | BTC-PAIR-01 | Requires physical Ledger device | Connect Ledger, open BTC app, run `pair_btc_ledger()`, verify on-device address against returned `addresses.segwit` + `addresses.taproot` (BOTH must match byte-for-byte) |
| Live Esplora blockstream.info + mempool.space endpoint compat | BTC-READ-01..05 | Network-dependent; live API may drift | Run `get_btc_balance` against a known mainnet address; cross-check sat/BTC balance against mempool.space or blockstream.info block-explorer UI |
| Real-Ledger BTC-app version probe | BTC-PAIR-02 | Phase 22 captures version at pair time only; Phase 27 ships the lazy probe | Confirm `pair_btc_ledger` returns non-"unknown" `appVersion` from a real Ledger BTC app |
| BTC whale persona OFAC verification | Plan 22-04 Task 1 | Requires manual cross-check against 0xB10C OFAC SDN registry + mempool.space UI | Visit https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses; grep the persona addresses; confirm absence. Visit https://mempool.space/address/<addr>; confirm no sanction labels |

*All other phase behaviors have automated verification via vitest + fetch-stub fixtures.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (esplora-client / xpub-scan / ledger-btc-transport / pair / 5 read tools / status / config-status / persona / state / demo-wallet routing — 18 stub files total)
- [x] No watch-mode flags
- [x] Feedback latency < 35s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved — planner sign-off 2026-05-21
