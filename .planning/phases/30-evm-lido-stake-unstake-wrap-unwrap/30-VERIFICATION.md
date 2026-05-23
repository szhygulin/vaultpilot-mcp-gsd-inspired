---
phase: 30-evm-lido-stake-unstake-wrap-unwrap
verified: 2026-05-23T10:55:00Z
status: human_needed
score: 6/6 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Stake ETH on Ethereum mainnet via prepare_lido_stake → preview_send → send_transaction"
    expected: "Ledger device shows decoded Lido.submit(referral=0x000…) call with correct ETH value; no LEDGER NOTICE; clear-sign display matches prepare receipt"
    why_human: "Real Ledger hardware + WalletConnect session required to verify on-device ERC-7730 clear-sign rendering"
  - test: "Unstake stETH via prepare_lido_unstake → preview_send → send_transaction"
    expected: "Ledger device shows decoded requestWithdrawals call; NFT receipt block visible in agent chat with correct predicted tokenId"
    why_human: "Real Ledger hardware required; tokenId prediction accuracy verifiable only against live withdrawal queue state"
  - test: "Wrap stETH → wstETH via prepare_lido_wrap → preview_send → send_transaction"
    expected: "Ledger shows decoded WstETH.wrap call; no LEDGER NOTICE; stETH approval pre-flight works correctly on real mainnet"
    why_human: "Real Ledger hardware required; approval pre-flight verification needs real on-chain stETH allowance state"
  - test: "Unwrap wstETH → stETH via prepare_lido_unwrap → preview_send → send_transaction"
    expected: "Ledger shows decoded WstETH.unwrap call; no LEDGER NOTICE; no approval prompt (wstETH is user's own token)"
    why_human: "Real Ledger hardware required to confirm no stray approval prompt and correct clear-sign rendering"
  - test: "get_lido_positions on Ethereum mainnet with a real wallet holding stETH"
    expected: "Returns populated stethBalance, stethShares, wstethBalance, conversionRate, accruedRebaseRewards; approx: true present; values plausible against on-chain state"
    why_human: "Real RPC call to Ethereum mainnet; correctness of rebase reward approximation verifiable only against live Lido oracle state"
  - test: "get_lido_positions on Arbitrum with a real wallet holding bridged wstETH"
    expected: "Returns wstethBalance from Arbitrum; conversionRate from Ethereum L1; stethBalance/stethShares/accruedRebaseRewards are null; approx: true present"
    why_human: "Real Arbitrum + Ethereum L1 RPCs required; Pitfall 5 (stEthPerToken routed to L1, not Arbitrum) verifiable only with real bridged contract behavior"
---

# Phase 30: Lido stake / unstake / wrap / unwrap — Verification Report

**Phase Goal:** User can stake ETH (mints stETH), unstake stETH (queues withdrawal), wrap stETH→wstETH, and unwrap wstETH→stETH. Read tools work on Ethereum mainnet + Arbitrum (bridged stETH/wstETH); writes are Ethereum-only.
**Verified:** 2026-05-23T10:55:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | `get_lido_positions` returns stETH + wstETH balances + accrued rebase rewards (Ethereum + Arbitrum) | VERIFIED | `src/tools/get_lido_positions.ts` calls `readEthereumPositions` (5 fields) and `readArbitrumPositions` (wstETH-only with L1 rate); `structuredContent` carries all D-08 fields including `approx: true` on both chains |
| 2 | `prepare_lido_stake` produces unsigned `Lido.submit(referral)` with `value` = amount | VERIFIED | `prepare_lido_stake.ts:175–184` sets `tx = { chainId: 1, to: getLidoStethAddress(1)!, valueWei: amountWei, data: encodeLidoSubmit("0x000…") }` — ETH amount in `valueWei` per D-07 (payable call) |
| 3 | `prepare_lido_unstake` produces unsigned `requestWithdrawals` call + NFT receipt block | VERIFIED | `prepare_lido_unstake.ts:230–272` encodes `encodeRequestWithdrawals(amountWei, fromAddress)`, reads `getLastRequestId()`, calls `NFT_RECEIPT_EXPECTED_TEMPLATE` with best-effort tokenId; `finalText = receipt + "\n\n" + nftBlock` |
| 4 | `prepare_lido_wrap` produces unsigned `WstETH.wrap(stethAmount)` call | VERIFIED | `prepare_lido_wrap.ts:188–194` encodes `encodeWstethWrap(amountWei)`, sets `tx.to = getLidoWstethAddress(1)!`, `tx.valueWei = 0n` |
| 5 | `prepare_lido_unwrap` produces unsigned `WstETH.unwrap(wstethAmount)` call | VERIFIED | `prepare_lido_unwrap.ts:152–159` encodes `encodeWstethUnwrap(amountWei)`, sets `tx.to = getLidoWstethAddress(1)!`, `tx.valueWei = 0n` |
| 6 | All 4 prepare tools registered in `register-all.ts`; read tool also registered | VERIFIED | `register-all.ts:92–96` carries 5 Lido imports: `get_lido_positions.js`, `prepare_lido_stake.js`, `prepare_lido_unstake.js`, `prepare_lido_wrap.js`, `prepare_lido_unwrap.js` |

**Score:** 6/6 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/config/contracts.ts` | LidoContracts + 3 getters + KNOWN_SPENDERS rows | VERIFIED | Lines 384–548: `LidoContracts` interface, `LIDO_RAW` table (chainId 1 + 42161), `getLidoStethAddress`/`getLidoWstethAddress`/`getLidoWithdrawalQueueAddress` getters, rows 17+18 in `KNOWN_SPENDERS_ETHEREUM` |
| `src/protocols/lido.ts` | 4 ABI fragments + LIDO_SELECTORS + 4 encoders + `_lidoProtocol` | VERIFIED | 221 lines; `LIDO_SELECTORS` (4 hardcoded Hex literals); `encodeLidoSubmit`, `encodeRequestWithdrawals`, `encodeWstethWrap`, `encodeWstethUnwrap`; `_lidoProtocol` at tail |
| `src/security/canonical-dispatch.ts` | Lido arm for Ethereum (stETH + wstETH + WithdrawalQueue) | VERIFIED | Lines 138–152: imports 3 Lido getters; `lidoEntries` constructed with zero-address filter; `...lidoEntries` in Set constructor |
| `src/signing/lido-rebase.ts` | Pure-bigint `computeRebaseRewards` + `approx: true` literal type | VERIFIED | 112 lines; `STETH_BASE`, `STETH_DECIMALS`, `LidoRebaseOutput.approx: true` (literal, not boolean), `computeRebaseRewards`, `_lidoRebase` indirection |
| `src/chains/lido.ts` | `readEthereumPositions` + `readArbitrumPositions` + cross-chain L1 read | VERIFIED | 245 lines; `readEthereumPositions` (4-read `Promise.all`); `readArbitrumPositions` (two-client fan-out, Pitfall 5 load-bearing comment at lines 206–209) |
| `src/tools/get_lido_positions.ts` | MCP tool with narrowed 2-chain enum, D-08 fields, `approx: true` always | VERIFIED | 243 lines; chain narrowed to `["ethereum", "arbitrum"]`; `approx: true` in structuredContent on both branches (lines 165, 211) |
| `src/tools/prepare_lido_stake.ts` | CHAIN_ID_MISMATCH gate + zero-value guard + PREPARE RECEIPT | VERIFIED | 233 lines; chain gate at line 108; zero-value guard at line 157; PREPARE RECEIPT with `LIDO_STAKE_PREPARE_RECEIPT_TEMPLATE` |
| `src/tools/prepare_lido_unstake.ts` | Chain gate + amount bounds + allowance pre-flight + NFT block | VERIFIED | 299 lines; chain gate; `MIN_WITHDRAWAL = 100n`, `MAX_WITHDRAWAL = 1_000n * 10n**18n`; allowance read at line 191; `NFT_RECEIPT_EXPECTED_TEMPLATE` at line 265 |
| `src/tools/prepare_lido_wrap.ts` | Chain gate + allowance pre-flight + `WstETH.wrap` encode | VERIFIED | 245 lines; chain gate; stETH allowance read against `wstethAddr` as spender at line 157; `encodeWstethWrap` at line 188 |
| `src/tools/prepare_lido_unwrap.ts` | Chain gate + no allowance + `WstETH.unwrap` encode | VERIFIED | 206 lines; chain gate; no allowance pre-flight (correct per approval matrix); `encodeWstethUnwrap` at line 152 |
| `src/tools/preview_send.ts` | DECODED ARGS for 4 Lido selectors; no LEDGER NOTICE for Lido | VERIFIED | Lines 624–687: 4-way selector dispatch with `decodeFunctionData`; `ledgerNoticeBlock` predicate at line 952 is `isWethUnwrap` OR `isCompoundComet` only — Lido never matches |
| `src/signing/blocks.ts` | 4 PREPARE RECEIPT templates + `NFT_RECEIPT_EXPECTED_TEMPLATE` function | VERIFIED | Lines 1562+: 4 `LIDO_*_PREPARE_RECEIPT_TEMPLATE` exports; `NFT_RECEIPT_EXPECTED_TEMPLATE` as parameterized function at line 1642 with T-LIDO-NFT-TOKENID-RACE disclaimer at line 1651 |
| `test/signing-fingerprint.test.ts` | Fixtures V/W/X/Y hardcoded `0x...` literals | VERIFIED | Lines 336–409: Fixture V (`0xab550a2883…`), W (`0x5f7514882e…`), X (`0x0f08b774cb…`), Y (`0x6d0dff1071…`) — no `beforeAll` snapshot |
| `test/config-contracts.test.ts` | T-LIDO-SPENDER-DRIFT-1 cross-view byte-identity assertions | VERIFIED | Lines 559–600+: `T-LIDO-SPENDER-DRIFT-1a` (wstETH row ↔ `getLidoWstethAddress(1)`), `T-LIDO-SPENDER-DRIFT-1b` (WithdrawalQueue row ↔ `getLidoWithdrawalQueueAddress(1)`), Ethereum/Arbitrum literal anchors |
| `test/lido-lifecycle.integration.test.ts` | Full stake→unstake→wrap→unwrap lifecycle + V/X/Y persona-independence + W dependence | VERIFIED | 516 lines per 30-03-SUMMARY; 9 tests; persona-independence for V/X/Y, persona-dependence for W |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/tools/prepare_lido_stake.ts` | `src/protocols/lido.ts` | `import { getLidoStethAddress, STETH_DECIMALS, encodeLidoSubmit }` | WIRED | Lines 38–43; `encodeLidoSubmit` called at line 175 |
| `src/tools/prepare_lido_unstake.ts` | `src/protocols/lido.ts` | `import { getLidoStethAddress, getLidoWithdrawalQueueAddress, encodeRequestWithdrawals }` | WIRED | Lines 36–41; `encodeRequestWithdrawals` called at line 230 |
| `src/tools/prepare_lido_wrap.ts` | `src/protocols/lido.ts` | `import { getLidoStethAddress, getLidoWstethAddress, encodeWstethWrap }` | WIRED | Lines 36–39; `encodeWstethWrap` called at line 188 |
| `src/tools/prepare_lido_unwrap.ts` | `src/protocols/lido.ts` | `import { getLidoWstethAddress, WSTETH_DECIMALS, encodeWstethUnwrap }` | WIRED | Lines 34–36; `encodeWstethUnwrap` called at line 152 |
| `src/tools/get_lido_positions.ts` | `src/chains/lido.ts` | `import { _lidoChains }` | WIRED | Line 34; `_lidoChains.readEthereumPositions` and `_lidoChains.readArbitrumPositions` called |
| `src/chains/lido.ts` | `src/signing/lido-rebase.ts` | `import { _lidoRebase }` | WIRED | Line 40; `_lidoRebase.computeRebaseRewards` called at line 161 |
| `src/tools/preview_send.ts` | `src/protocols/lido.ts` | `import { LIDO_SELECTORS, … ABI fragments }` | WIRED | Line 81; `LIDO_SELECTORS.submit/requestWithdrawals/wrap/unwrap` used at lines 625, 641, 657, 672 |
| `src/security/canonical-dispatch.ts` | `src/config/contracts.ts` Lido getters | `import { getLidoStethAddress, getLidoWstethAddress, getLidoWithdrawalQueueAddress }` | WIRED | Lines 63–65; `lidoEntries` at line 141; `...lidoEntries` in Set at line 152 |
| `test/signing-fingerprint.test.ts` | Lido encoder outputs → hardcoded literals | `import encoders + getLido*Address` | WIRED | Fixtures V/W/X/Y each call encoders + `computePayloadFingerprint` and assert byte-identity to hardcoded hex |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `get_lido_positions.ts` | `result.stethBalance`, `stethShares`, etc. | `readEthereumPositions(client, wallet)` → `client.readContract` against real Lido stETH + wstETH contracts | Real DB queries (on-chain `readContract` calls) | FLOWING — feeds structuredContent directly |
| `prepare_lido_stake.ts` | `data`, `tx.valueWei` | `encodeLidoSubmit(referral)`, `parseAmountStrict(rawAmount, 18)` | Derived from agent input + ABI encoder | FLOWING — handle + payloadFingerprint computed from tx |
| `prepare_lido_unstake.ts` | `allowance`, `lastId`, `expectedTokenId` | `client.readContract` for `allowance` and `getLastRequestId` | Real contract reads at prepare time | FLOWING — data feeds allowance gate and NFT block |
| `prepare_lido_wrap.ts` | `allowance` | `client.readContract` for `stETH.allowance(from, wstethAddr)` | Real contract read at prepare time | FLOWING — data feeds approval gate |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| vitest full suite | `npx vitest run` | 3537 passed, 1 skipped (276 test files) | PASS |
| FROZEN region zero-diff | `git diff --stat 5bb9d7c20168a8c65730d87cdf95ea784cc8acb1..HEAD -- [frozen files]` | (empty output) | PASS |
| D-12: no LEDGER NOTICE in Lido tools | `grep -n "LEDGER_NOTICE\|LEDGER NOTICE" src/tools/prepare_lido_*.ts` | (no output, exit 1) | PASS |
| preview_send Lido dispatch wired | `grep -n "LIDO_SELECTORS" src/tools/preview_send.ts` | Lines 81 (import), 625, 641, 657, 672 (usage) | PASS |
| register-all: all 5 Lido tools | `grep "lido" src/tools/register-all.ts` | Lines 92–96: 5 imports | PASS |

---

### Probe Execution

Step 7c: No `scripts/*/tests/probe-*.sh` probes found for this phase. Skipped.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| LIDO-01 | 30-02 | `get_lido_positions` returns stETH + wstETH balances + accrued rebase rewards (Ethereum + Arbitrum) | SATISFIED | `src/tools/get_lido_positions.ts` implements full D-08 field set; Ethereum + Arbitrum branches both implemented; `approx: true` always present |
| LIDO-02 | 30-03 | `prepare_lido_stake` produces unsigned `Lido.submit(referral)` with `value` = amount | SATISFIED | `src/tools/prepare_lido_stake.ts` encodes `encodeLidoSubmit(address(0))` with `tx.valueWei = amountWei` |
| LIDO-03 | 30-03 | `prepare_lido_unstake` produces unsigned `requestWithdrawals` (NFT receipt in CHECKS PERFORMED) | SATISFIED | `src/tools/prepare_lido_unstake.ts` encodes via `encodeRequestWithdrawals`, appends `NFT_RECEIPT_EXPECTED_TEMPLATE` block |
| LIDO-04 | 30-03 | `prepare_lido_wrap` + `prepare_lido_unwrap` produce `WstETH.wrap` + `WstETH.unwrap` calls | SATISFIED | Both tools exist and encode via `encodeWstethWrap` / `encodeWstethUnwrap` |
| LIDO-05 | 30-01 | Lido contracts sourced from `src/config/contracts.ts`; reads on Ethereum + Arbitrum; writes Ethereum-only; canonical-dispatch Lido arm wired | SATISFIED | `getLidoStethAddress`/`getLidoWstethAddress`/`getLidoWithdrawalQueueAddress` in `contracts.ts`; `lidoEntries` wired in `canonical-dispatch.ts`; all 4 write tools enforce Ethereum-only via `CHAIN_ID_MISMATCH` gate |

---

### Threat Mitigation Table

| Threat ID | Status | Verification Evidence |
|-----------|--------|----------------------|
| T-LIDO-WRONG-CHAIN | MITIGATED | All 4 prepare tools: `chainName !== "ethereum"` → `CHAIN_ID_MISMATCH` refusal before any RPC reads (stake:108, unstake:119, wrap:103, unwrap:100). Chain narrowed to `["ethereum"]` in INPUT_SCHEMA enum |
| T-LIDO-ALLOWANCE-DRIFT | MITIGATED | `prepare_lido_unstake.ts:191–218`: `stETH.allowance(from, wqAddr)` read; `allowance < amountWei` → `INVALID_INPUT + hintTool: "prepare_token_approve" + hintArgs.spender = wqAddr`. `prepare_lido_wrap.ts:157–184`: same pattern with `spender = wstethAddr` |
| T-LIDO-DISPATCH-DRIFT | MITIGATED | `canonical-dispatch.ts:138–152`: `lidoEntries` built from 3 Lido getters with zero-address sentinel filter; `...lidoEntries` in `buildPerChainAllowlist` Set. Full vitest suite green confirms dispatch tests pass |
| T-LIDO-FINGERPRINT-DRIFT | MITIGATED | `test/signing-fingerprint.test.ts:336–409`: Fixtures V/W/X/Y hardcoded `0x...` literals (no `beforeAll` snapshot). FROZEN region `git diff --stat 5bb9d7c..HEAD -- [frozen files]` returns empty |
| T-LIDO-REBASE-SNAPSHOT-STALENESS | MITIGATED | `src/signing/lido-rebase.ts:69`: `approx: true` is a **literal type** (not boolean) — TS compile-time gate. `get_lido_positions.ts:165,211`: `approx: true` always in structuredContent on both branches. DESCRIPTION string warns agents explicitly |
| T-LIDO-NFT-TOKENID-RACE | ACCEPTED | `src/signing/blocks.ts:1651`: NFT_RECEIPT_EXPECTED_TEMPLATE includes `(best-effort at prepare time; may shift if another withdrawal queues before this tx lands)` on the tokenId line — residual risk disclosed to user per D-04 |
| T-LIDO-SPENDER-DRIFT-1 | MITIGATED | `test/config-contracts.test.ts:573–583`: T-LIDO-SPENDER-DRIFT-1a + 1b assert `KNOWN_SPENDERS_ETHEREUM` rows byte-identical to `getLidoWstethAddress(1)` and `getLidoWithdrawalQueueAddress(1)`. 3537 tests green |
| T-LIDO-ZERO-VALUE-STAKE | MITIGATED | `prepare_lido_stake.ts:157–167`: `if (amountWei === 0n)` → `INVALID_INPUT` with message "stake amount must be > 0 (staking 0 ETH yields 0 stETH)" |
| T-LIDO-WITHDRAWAL-AMOUNT-BOUNDS | MITIGATED | `prepare_lido_unstake.ts:57–58,168–181`: `MIN_WITHDRAWAL = 100n`, `MAX_WITHDRAWAL = 1_000n * 10n**18n`; both bounds enforced with descriptive `INVALID_INPUT` message |
| D-12 (NO LEDGER NOTICE) | CONFIRMED | `grep -n "LEDGER_NOTICE\|LEDGER NOTICE" src/tools/prepare_lido_*.ts` returns no output. `preview_send.ts:952–956`: `ledgerNoticeBlock` emitted only for `isWethUnwrap` or `isCompoundComet` — Lido selectors produce `null` |

---

### FROZEN Region Invariant

`git diff --stat 5bb9d7c20168a8c65730d87cdf95ea784cc8acb1..HEAD -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts`

**Result: (empty — zero diff confirmed)**

All 5 FROZEN files byte-identical to the base commit across all 3 waves of Phase 30 execution.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none found) | — | — | — | — |

Scan summary: no `TBD`, `FIXME`, or `XXX` markers found in Phase 30 files. No stub return patterns (`return null`, empty handlers, hardcoded empty arrays passed to rendering). All encoders and handlers are fully implemented.

**Notable deviation (auto-fixed, not a blocker):** Plan 30-01 stated `requestWithdrawals` calldata is 100 bytes (202 chars); empirical viem ABI encoding produces 132 bytes (266 chars) due to the 5-slot head+tail layout for `(uint256[], address)`. Tests were updated to assert the empirically correct value and the decoder round-trip passes. The deviation is documented in 30-01-SUMMARY.md. This does not affect correctness — single-element array encoding is confirmed via `decodeFunctionData` round-trip tests.

**Notable deviation (auto-fixed, not a blocker):** Plan 30-01 stated dispatch allowlist would grow by +3 on Ethereum; actual net is +2 because wstETH (`0x7f39C581…`) was already in `BRIDGED_VARIANTS` (Set de-duplication). The size anchor in `test/security-canonical-dispatch.test.ts` was updated from 27 to 29. No correctness impact — the Set contains the right addresses.

---

### Human Verification Required

**6 items require human testing** (real Ledger hardware + live mainnet RPCs). These are bundled with the project convention of accumulating Ledger-verified items for periodic on-device testing runs.

#### 1. Stake ETH via full pipeline on mainnet

**Test:** Set demo mode off; pair real Ledger; call `prepare_lido_stake({ chain: "ethereum", amount: "0.001" })`, then `preview_send(handle)`, then `send_transaction(handle, userDecision: "send")`
**Expected:** Ledger displays decoded Lido.submit call showing 0.001 ETH value; user can verify and approve; no LEDGER NOTICE emitted in agent response; transaction broadcasts
**Why human:** Real Ledger + WalletConnect required; ERC-7730 clear-sign rendering on physical device screen not verifiable by grep

#### 2. Unstake stETH + NFT receipt via full pipeline on mainnet

**Test:** With stETH balance and WithdrawalQueue allowance set, call `prepare_lido_unstake`, verify `[NFT RECEIPT EXPECTED]` block appears in response, complete through to send
**Expected:** NFT receipt block shown with expected tokenId; Ledger shows decoded requestWithdrawals; disclaimer text about best-effort tokenId visible
**Why human:** Live withdrawal queue state needed to evaluate tokenId prediction accuracy; NFT minting confirmation requires transaction broadcast

#### 3. Wrap stETH → wstETH with approval gate test

**Test:** (a) Call `prepare_lido_wrap` with zero stETH allowance for wstETH contract → verify `INVALID_INPUT + hintTool: prepare_token_approve + hintArgs.spender = 0x7f39C581…`. (b) Set allowance via `prepare_token_approve`, then retry `prepare_lido_wrap` → completes with clear-sign on device
**Expected:** Part (a): refusal with correct spender address. Part (b): Ledger shows decoded wrap call; no LEDGER NOTICE
**Why human:** Real mainnet stETH + allowance state required; Ledger clear-sign rendering requires device

#### 4. Unwrap wstETH → stETH with no approval on mainnet

**Test:** Call `prepare_lido_unwrap` with wstETH balance but no stETH allowance set — tool should NOT check or require allowance
**Expected:** Tool succeeds without any allowance-related error; Ledger shows decoded WstETH.unwrap call; no approval prompt
**Why human:** Verifying absence of stray approval check requires real execution path

#### 5. get_lido_positions Ethereum mainnet accuracy

**Test:** Call `get_lido_positions({ wallet: <wallet_with_stETH>, chain: "ethereum" })`; compare returned values against Etherscan/Lido app on-chain state
**Expected:** `stethBalance`, `stethShares`, `wstethBalance`, `conversionRate` match on-chain values within 1 block; `accruedRebaseRewards` is plausible approximation; `approx: true` present
**Why human:** Real Ethereum RPC + known wallet balance required; numerical accuracy of rebase approximation not verifiable offline

#### 6. get_lido_positions Arbitrum: stEthPerToken routed to Ethereum L1

**Test:** Call `get_lido_positions({ wallet: <wallet_with_wstETH_on_arbitrum>, chain: "arbitrum" })`; verify `conversionRate` matches the Ethereum L1 wstETH rate; verify `stethBalance`, `stethShares`, `accruedRebaseRewards` are null
**Expected:** `conversionRate` from Ethereum L1 (not Arbitrum); null fields present; no RPC error from calling stEthPerToken on bridged Arbitrum contract
**Why human:** Real Arbitrum + Ethereum L1 RPCs required to confirm Pitfall 5 mitigation works end-to-end with real bridge state

---

### Gaps Summary

No gaps found. All 6 observable truths verified, all 15 required artifacts confirmed substantive and wired, all key links verified, all 9 threat mitigations confirmed in code, all 5 LIDO requirements satisfied, FROZEN region zero-diff, full test suite (3537 tests) passing.

Human verification items are expected — they require real Ledger hardware and live mainnet RPCs that cannot be verified programmatically.

---

_Verified: 2026-05-23T10:55:00Z_
_Verifier: Claude (gsd-verifier)_
