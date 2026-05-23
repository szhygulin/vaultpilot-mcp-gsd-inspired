---
status: partial
phase: 30-evm-lido-stake-unstake-wrap-unwrap
source: [30-VERIFICATION.md]
started: 2026-05-23T10:55:00Z
updated: 2026-05-23T10:55:00Z
---

## Current Test

[awaiting human testing — bundled with v2.x verify-phase backlog per project convention]

## Tests

### 1. Stake ETH via full pipeline on mainnet
expected: Ledger device shows decoded Lido.submit(referral=address(0)) call with correct ETH value; no LEDGER NOTICE; clear-sign display matches prepare receipt
result: [pending]

### 2. Unstake stETH via prepare_lido_unstake → preview_send → send_transaction
expected: Ledger device shows decoded requestWithdrawals call; NFT receipt block visible in agent chat with correct predicted tokenId; best-effort disclaimer present
result: [pending]

### 3. Wrap stETH → wstETH via prepare_lido_wrap with allowance pre-flight test
expected: Ledger shows decoded WstETH.wrap call; no LEDGER NOTICE; stETH allowance pre-flight refusal works correctly on real mainnet when allowance < amount; INVALID_INPUT + hintTool: "prepare_token_approve" returned with correct spender (wstETH address)
result: [pending]

### 4. Unwrap wstETH → stETH via prepare_lido_unwrap (no approval expected)
expected: Ledger shows decoded WstETH.unwrap call; no LEDGER NOTICE; no approval prompt (wstETH is user's own token); call succeeds without allowance pre-flight
result: [pending]

### 5. `get_lido_positions` on Ethereum mainnet with real wallet holding stETH
expected: Returns populated `stethBalance`, `stethShares`, `wstethBalance`, `conversionRate`, `accruedRebaseRewards`; `approx: true` present; values plausible against on-chain state via Etherscan cross-check
result: [pending]

### 6. `get_lido_positions` on Arbitrum with real wallet holding bridged wstETH (Pitfall 5)
expected: Returns `wstethBalance` from Arbitrum; `conversionRate` fetched from Ethereum L1 (NOT Arbitrum); `stethBalance` / `stethShares` / `accruedRebaseRewards` are null; `approx: true` present; Pitfall 5 routing verifiable
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
