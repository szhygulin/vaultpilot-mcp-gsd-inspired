---
status: partial
phase: 23-btc-native-segwit-taproot-trust-pipeline
source: [23-VERIFICATION.md]
started: 2026-05-22
updated: 2026-05-22
---

## Current Test

[awaiting human testing — bundled with the v2.2 verify-phase deferred items per 2026-05-16 directive]

## Tests

### 1. Segwit PSBT real-Ledger smoke — physical device required
expected: Pair a Ledger BTC app, `prepare_btc_send` a small native-segwit (bc1q…) send, `preview_send`, `send_transaction`; the per-input BIP-143 sighash bytes shown in the `LEDGER BLIND-SIGN HASH (BTC)` block match what the device displays; Esplora broadcast accepts the finalized tx
result: [pending]

### 2. Taproot PSBT real-Ledger smoke — P2TR key-spend path
expected: `prepare_btc_send` a small native-taproot (bc1p…) send through the full pipeline; the BIP-341 key-path spend signs correctly via `@ledgerhq/hw-app-btc` and broadcasts
result: [pending]

### 3. Mixed-input two-pass signing on a real device
expected: A send whose coin selection pulls both segwit and taproot UTXOs triggers exactly TWO `signPsbtBuffer` passes against a real BTC app v2.1+, combined via `Psbt.combine`; the finalized tx is valid and broadcasts
result: [pending]

### 4. Change output recognized as own on-device
expected: With the account xpub persisted at pair time, `prepare_btc_send` derives a fresh chain-1 change address; `knownAddressDerivations` causes the Ledger to display the change output as the user's own ("change"), NOT as an additional send recipient; the on-device total spend excludes the change
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
