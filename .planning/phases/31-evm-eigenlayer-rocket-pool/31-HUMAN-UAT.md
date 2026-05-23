---
status: partial
phase: 31-evm-eigenlayer-rocket-pool
source: [31-VERIFICATION.md]
started: 2026-05-23T13:30:00Z
updated: 2026-05-23T13:30:00Z
---

## Current Test

[awaiting human testing — bundled v2.3 verify-phase real-Ledger smoke across Phases 28/29/30/31 per the 2026-05-16 directive]

## Tests

### 1. EIG-02 — EigenLayer LST deposit via prepare_eigenlayer_deposit on mainnet
expected: Ledger device displays BLIND-SIGN HASH (no ERC-7730 coverage) that matches character-for-character the LEDGER BLIND-SIGN HASH block in preview_send; LEDGER NOTICE template surfaces blind-sign-required precondition (Settings → Blind signing → Enabled) BEFORE signing; tx broadcasts and lands on-chain; allowance is consumed.
result: [pending]

### 2. RP-02 stake — RocketDepositPool.deposit() via prepare_rocketpool_stake on mainnet
expected: Ledger device displays BLIND-SIGN HASH that matches preview_send; D-13 LEDGER NOTICE (SHARED template) emitted; tx broadcasts and mints rETH proportional to msg.value at current exchange rate.
result: [pending]

### 3. RP-02 unstake — rETH.burn(amount) via prepare_rocketpool_unstake on mainnet
expected: Ledger device displays BLIND-SIGN HASH for rETH.burn; D-13 LEDGER NOTICE (SHARED template — same as stake; symmetric blind-sign UX) emitted; tx broadcasts; rETH burned; ETH returned to msg.sender; D-08 pre-flight outcome verified post-send (no Pitfall 5 race-window revert).
result: [pending]

### 4. Phase 28 (Compound V3) — small-amount supply/withdraw/borrow/repay against one curated Comet
expected: Per-tool LEDGER NOTICE (Compound V3 is NOT in ERC-7730 registry); on-device hash match for each of the 4 selectors; intent-vs-reality refusals fire correctly when allowance/collateral/repay-max boundaries are exercised.
result: [pending]

### 5. Phase 29 (Morpho Blue) — small-amount supply/withdraw/supplyCollateral/withdrawCollateral/borrow/repay against one isolated market
expected: Clear-sign decoded args (Morpho IS in ERC-7730 registry — NO LEDGER NOTICE); on-device DECODED ARGS match preview_send; all 6 market-write selectors verified.
result: [pending]

### 6. Phase 30 (Lido) — small-amount stake/unstake-via-NFT/wrap/unwrap on mainnet
expected: Clear-sign decoded args (Lido IS in ERC-7730 registry — NO LEDGER NOTICE per D-12); on-device DECODED ARGS match preview_send for all 4 selectors; NFT withdrawal-receipt surface (expectedTokenId via getLastRequestId() + 1) verified end-to-end (T-LIDO-NFT-TOKENID-RACE accepted residual exercised).
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
