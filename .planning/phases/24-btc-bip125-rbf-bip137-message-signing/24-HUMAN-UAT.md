---
status: partial
phase: 24-btc-bip125-rbf-bip137-message-signing
source: [24-VERIFICATION.md]
started: 2026-05-22
updated: 2026-05-22
---

## Current Test

[awaiting human testing — bundled with the v2.2 verify-phase deferred items per 2026-05-16 directive]

## Tests

### 1. BIP-137 message signing — Ledger on-device display (SC#5)
expected: With a paired Ledger BTC app, call `sign_message_btc({ wallet: "<segwit address>", message: "Hello VaultPilot" })`. The BTC app displays the literal message text "Hello VaultPilot" character-for-character on the device screen before the user confirms. The returned `signatureBase64` is 65 bytes, base64-encoded, header byte 39 or 40.
result: [pending]

### 2. BIP-125 RBF replacement — live mempool fee bump
expected: Send a small BTC tx via `prepare_btc_send` with `signalRbf: true`; once it is mempool-pending, call `prepare_btc_rbf_bump({ txid, newFeeRate: <higher> })`, `preview_send`, `send_transaction`. The replacement transaction evicts the original in the mempool (original disappears, replacement appears with the higher fee rate). The Ledger screen shows the replacement's recipient output(s) matching the original + a reduced change output.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
