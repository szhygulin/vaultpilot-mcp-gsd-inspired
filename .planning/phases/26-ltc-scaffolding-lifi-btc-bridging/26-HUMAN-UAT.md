---
status: partial
phase: 26-ltc-scaffolding-lifi-btc-bridging
source: [26-VERIFICATION.md]
started: 2026-05-23T01:30:00Z
updated: 2026-05-23T01:30:00Z
verify_session: v2.2-milestone-closeout
---

## Current Test

[awaiting human testing — bundled with v2.2 real-Ledger verify session per the 2026-05-16 directive]

## Tests

### 1. Real LTC pairing — confirm ASSUMED A1
expected: `pair_litecoin_ledger` returns both L-prefix legacy and ltc1q segwit addresses; both addresses appear verbatim on the Ledger screen during pairing; `getAppConfiguration().name === "Litecoin"` (ASSUMED A1 in `src/wallet/ledger-btc-transport.ts`)
result: [pending]

### 2. LTC native send broadcast over real USB-HID
expected: `prepare_litecoin_native_send` → `preview_send` → `send_transaction` end-to-end with the Litecoin app open; `LEDGER BLIND-SIGN HASH (LTC)` block matches on-device hash display; small returnable LTC transfer broadcasts successfully against mainnet
result: [pending]

### 3. BIP-137 message signing on-device with LTC magic bytes
expected: `sign_message_ltc` produces a compact BIP-137 signature; on-device message hash display matches Fixture Z value (`0xa36092f9…`); LTC magic prefix `\x19Litecoin Signed Message:\n` (varint 0x19) confirmed
result: [pending]

### 4. BTC→EVM and BTC→Solana LiFi bridge with on-device PSBT signing
expected: `prepare_btc_lifi_swap` against live li.quest API for both BTC→ETH and BTC→SOL destinations; PSBT signed on real Ledger BTC app; on-device final-recipient address matches user-supplied `toAddress` (Inv #6b round-trip equality holds against live LiFi quote); broadcast succeeds (small returnable amount)
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

(none — all items pending real-device session)
