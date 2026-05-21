---
status: partial
phase: 22-btc-scaffolding-esplora-usb-hid-persistent-accounts
source: [22-VERIFICATION.md]
started: 2026-05-21
updated: 2026-05-21
---

## Current Test

[awaiting human testing — bundled with Phase 17 + Phase 21 deferred items per 2026-05-16 directive]

## Tests

### 1. Real-Ledger USB-HID BTC app pair — physical device required
expected: Connect Ledger, open Bitcoin app, run `pair_btc_ledger()`; device displays TWO addresses in sequence (segwit then taproot) matching the returned `addresses.segwit` (bc1q…) + `addresses.taproot` (bc1p…) byte-for-byte; persists 2 records under `chain: "bitcoin"`
result: [pending]

### 2. Live Esplora cross-check — blockstream.info + mempool.space endpoint compat
expected: Run `get_btc_balance` against a known mainnet address; sat/BTC balance matches mempool.space or blockstream.info block-explorer UI; with `BTC_ESPLORA_URL=https://mempool.space/api` override, identical response shape
result: [pending]

### 3. Live xpub-scan against a known funded BIP-84 zpub
expected: `get_btc_account_balance({ xpub })` returns aggregate balance + correct `addressesScanned` count; gap-limit-20 terminates as expected; per-xpub 5-min TTL cache hit on second call
result: [pending]

### 4. VERIFY-ON-DEVICE template renders correctly in agent UI
expected: The full DUAL-address `VERIFY-ON-DEVICE` block is presented as readable, scannable text in the agent's chat surface; both addresses + both derivation paths appear; line breaks preserve formatting
result: [pending]

### 5. Demo persona end-to-end — set_demo_wallet btc-whale + read tools
expected: Setting `set_demo_wallet({ slug: "btc-whale" })` and then running `get_btc_balance` against the persona's segwit address returns realistic mainnet data; the active envelope is sane
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
