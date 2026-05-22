---
status: partial
phase: 25-btc-psbt-multisig-flow
source: [25-VERIFICATION.md]
started: 2026-05-22
updated: 2026-05-22
---

## Current Test

[awaiting human testing — bundled with the v2.2 verify-phase deferred items per 2026-05-16 directive]

## Tests

### 1. On-device multisig wallet-policy registration
expected: With a Ledger BTC app v2.1+ over USB-HID, `register_btc_multisig_wallet` runs the `registerWallet` APDU; the device displays the M-of-N wallet policy + co-signer keys for on-device confirmation; the returned 32-byte `walletHmac` is persisted in `~/.vaultpilot-mcp/btc-multisig.json`.
result: [pending]

### 2. On-device multisig PSBT signing
expected: `sign_btc_multisig_psbt` → `preview_send` → `send_transaction` signs the user's input contribution via `AppClient.signPsbt` against the registered wallet policy; the device shows the inputs/outputs being signed; the returned PSBT carries the user's partial signature.
result: [pending]

### 3. Finalized multisig PSBT broadcasts on mainnet
expected: With a second cooperating co-signer reaching the M threshold, `combine_btc_psbts` merges the partials and `finalize_btc_psbt` produces a valid finalized transaction that broadcasts and confirms on mainnet.
result: [pending]

### 4. WalletPolicy shim — live SDK export verification
expected: The `WalletPolicy` shim in `ledger-btc-transport.ts` resolves correctly against the live `@ledgerhq/ledger-bitcoin@0.3.1` export shape at runtime (WR-03 made the failure path a clear diagnostic — confirm the success path on a real install).
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
