---
status: partial
phase: 41-compound-v3-multi-chain-expansion-polygon-arbitrum-base-opti
source: [41-VERIFICATION.md]
started: 2026-05-29
updated: 2026-05-29
---

## Current Test

[awaiting human testing — bundled with the v2.3.x verify-phase deferred items per 2026-05-16 directive. Automated verification (7/7 success criteria) PASSED; these items require a physical Ledger + funded L2 wallets + per-chain RPC.]

## Tests

### 1. Arbitrum Compound supply → withdraw (native USDC Comet, SC#2/SC#3)
expected: With a paired Ledger on Arbitrum, `prepare_compound_supply({ chain: "arbitrum", cometAddress: <0x9c4ec768… native-USDC Comet>, asset: <USDC>, amount: "1" })` → `preview_send` → `send_transaction`. The `preview_send` response carries the LEDGER NOTICE block (Compound blind-signs on Arbitrum — not in the Ledger clear-sign registry), and the on-device blind-sign hash matches `preview_send`'s `LEDGER BLIND-SIGN HASH`. Then `prepare_compound_withdraw` the same amount; broadcasts succeed on Arbitrum mainnet.
result: [pending]

### 2. Base Compound supply → withdraw (native USDC Comet, SC#2/SC#3)
expected: Same lifecycle on Base (`chain: "base"`, USDC Comet `0xb125E6…`). LEDGER NOTICE present; on-device hash matches; supply + withdraw broadcast on Base mainnet. Confirms the `preview_send.ts` multi-chain LEDGER-NOTICE widening fires off-Ethereum.
result: [pending]

### 3. Optimism Compound borrow → repay-max (SC#3/SC#5)
expected: On Optimism (`chain: "optimism"`), supply WETH collateral, `prepare_compound_borrow` USDC, then `prepare_compound_repay({ amount: "max" })` (MAX_UINT256 sentinel). The repay-all closes the borrow position; intent-vs-reality (`deriveIntent`) gate fires against the Optimism RPC. Broadcasts succeed.
result: [pending]

### 4. Polygon bridged-USDC.e Comet — base-token disambiguation (SC#1/SC#3)
expected: On Polygon (`chain: "polygon"`), `prepare_compound_supply` against the USDC.e Comet `0xF25212…` with `asset` = bridged USDC.e `0x2791…`. The `deriveIntent` `baseToken()` read returns `0x2791…` (bridged), classifying it as base-supply. Supplying native USDC `0x3c499c…` instead is classified as collateral (not base) — confirming the `"USDC.e"` key disambiguation on-device.
result: [pending]

### 5. Cross-chain fingerprint distinctness on-device (SC#6)
expected: A supply of the same logical amount on two different L2 Comets (e.g. Arbitrum USDC vs Base USDC) produces two DISTINCT `payloadFingerprint` values in `prepare_*`, and the Ledger device shows distinct blind-sign hashes — confirming `chainId` + `to` both flow into the preimage (matches Fixtures FIXTURE_CMP_ARB_A vs FIXTURE_CMP_BASE_A).
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
