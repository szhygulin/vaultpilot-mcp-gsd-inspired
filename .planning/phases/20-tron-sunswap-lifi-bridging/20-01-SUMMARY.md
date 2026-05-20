---
phase: 20
plan: "01"
subsystem: tron-sunswap
tags: [tron, sunswap, defi, mev-defense, canonical-dispatch, phase-20]
dependency_graph:
  requires: [18-02, 18-03, 18-04, 19-01, 19-02, 19-03]
  provides: [get_sunswap_quote, prepare_sunswap_swap, TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST]
  affects: [preview_send, send_transaction, get_tx_verification, handle-store, canonical-dispatch-tron, blocks-tron]
tech_stack:
  added:
    - "src/clients/sunswap.ts — SunSwap V2 RPC client (TronGrid getAmountsOut/getReserves/getPair)"
    - "src/protocols/sunswap-tron.ts — encodeSunswapSwap + decodeSunswapSwapCall via viem.encodeFunctionData"
  patterns:
    - "LRU Map cache (10-entry, 30s TTL) for on-chain quote responses"
    - "viem.encodeFunctionData fallback for address[] ABI encoding (avoids tronweb 41-prefix bug)"
    - "Pre-Zod raw-args key-presence check for sandwich-MEV slippage detection (D-03b)"
    - "TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST sibling set alongside TRON_TRC20_DISPATCH_ALLOWLIST"
key_files:
  created:
    - src/clients/sunswap.ts
    - src/protocols/sunswap-tron.ts
    - src/tools/get_sunswap_quote.ts
    - src/tools/prepare_sunswap_swap.ts
    - test/clients-sunswap.test.ts
    - test/protocols-sunswap-tron.test.ts
    - test/get-sunswap-quote.test.ts
    - test/prepare-sunswap-swap.test.ts
    - test/signing-fingerprint-tron-20.test.ts
    - test/security-canonical-dispatch-tron.test.ts
    - test/preview-send.tron-sunswap.test.ts
    - test/get-tx-verification.tron-sunswap.test.ts
  modified:
    - src/security/canonical-dispatch-tron.ts
    - src/signing/handle-store.ts
    - src/signing/blocks-tron.ts
    - src/tools/register-all.ts
    - src/tools/preview_send.ts
    - src/tools/send_transaction.ts
    - src/tools/get_tx_verification.ts
    - SECURITY.md
decisions:
  - "viem.encodeFunctionData for address[] ABI encoding: tronweb's native encoding uses 41-prefixed 21-byte hex which doesn't match EVM ABI's 20-byte address slots — viem produces correct EVM calldata"
  - "TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST as a new sibling set (option a of Open Question #2): separate from stablecoin allowlist; distinct checkTronSmartContractDispatchTarget function"
  - "Pre-Zod slippage detection: raw key-presence check before Zod .default(50) resolution — critical for D-03b sandwich-MEV gate correctness"
  - "LiFi bridging deferred (D-04b): Phase 20 scope is TRON-only SunSwap V2 intra-chain swaps"
metrics:
  duration: "~75 minutes (continuation execution)"
  completed: "2026-05-20"
  tasks_completed: 3
  files_created: 12
  files_modified: 8
---

# Phase 20 Plan 01: SunSwap V2 TRON Integration Summary

## One-liner

SunSwap V2 on TRON: `get_sunswap_quote` (on-chain `getAmountsOut`) + `prepare_sunswap_swap` (TriggerSmartContract `swapExactTokensForTokens`) with D-03b sandwich-MEV gate, `TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST` router allowlist, server-side path computation (D-10), and Fixture Tron-20-A hardcoded fingerprint anchor.

## What Was Built

### Task 1 — Commit `1d9a46c`
- `src/clients/sunswap.ts`: SunSwap V2 RPC client; `fetchSunswapQuote` with LRU cache (10-entry, 30s TTL); `_sunswapClient` ESM spy-affordance; `resetSunswapCacheForTesting`
- `src/protocols/sunswap-tron.ts`: `encodeSunswapSwap` (viem.encodeFunctionData + TronWeb triggerSmartContract + extendExpiration(900)); `decodeSunswapSwapCall`; `_sunSwapTron` spy-affordance
- `src/security/canonical-dispatch-tron.ts`: `TRON_SMARTCONTRACT_DISPATCH_ALLOWLIST` (1-entry router set) + `checkTronSmartContractDispatchTarget` + `SUNSWAP_V2_ROUTER_TRON_ADDRESS` — sibling to Phase 18 stablecoin set
- `src/signing/handle-store.ts`: `sunswap-swap` variant added to `TronInstructionSummary`
- `src/signing/blocks-tron.ts`: `PREPARE_RECEIPT_TRON_SUNSWAP_TEMPLATE` + `SANDWICH_MEV_REFUSAL_TRON_TEMPLATE` appended
- `test/signing-fingerprint-tron-20.test.ts`: Fixture Tron-20-A hardcoded `0x...` literal anchors (NO `beforeAll`-snapshot)
- `test/security-canonical-dispatch-tron.test.ts`: T-SOT-DRIFT-1 cross-import assertion (`SUNSWAP_V2_ROUTER_TRON_ADDRESS === KNOWN_SPENDERS_TRON[0].address`)

### Task 2 — Commit `704c6b9`
- `src/tools/get_sunswap_quote.ts`: MCP tool; validates addresses via `tronUtils.address.isAddress`; resolves decimals via `tron-top-25`; NEVER-throws (null quote → INTERNAL_ERROR); warns at priceImpactBps > 200
- `src/tools/prepare_sunswap_swap.ts`: MCP tool; pre-Zod sandwich-MEV gate (D-03b/D-03c); `amountOutMin = (outAmount × (10000 - slippageBps)) / 10000`; `deadline = now + 600`; `checkTronSmartContractDispatchTarget` dispatch gate
- `src/tools/register-all.ts`: 2 new imports added
- `test/get-sunswap-quote.test.ts`: 10 tests
- `test/prepare-sunswap-swap.test.ts`: 22 tests including Fixture Tron-20-A consumer re-anchor (Test 5)

### Task 3 — Commit `4705c63`
- `src/signing/handle-store.ts`: `PrepareArgs` extended with `inputToken?`, `outputToken?`, `slippageBps?` (Phase 20 optional fields)
- `src/tools/preview_send.ts`: Phase 20 sunswap-swap arm (AFTER approve/revoke, BEFORE trc20-transfer Layer 0.5); `shouldEmitTronLedgerNotice` sunswap-swap case; selector pinned as `0x38ed1739`
- `src/tools/send_transaction.ts`: `kindLabel` fix for sunswap-swap in demo-mode response
- `src/tools/get_tx_verification.ts`: sunswap-swap arm in `prepareReceiptBlock` ternary; `checkTronSmartContractDispatchTarget` for `dispatchCheckResult`
- `SECURITY.md`: Phase 20 §6 sub-section appended (sandwich-MEV D-03b, router allowlist, path server-side D-10, LiFi deferral D-04b)
- `test/preview-send.tron-sunswap.test.ts`: 7 tests
- `test/get-tx-verification.tron-sunswap.test.ts`: 4 tests

## Test Results

- Full suite: 194 test files, 2455 tests passing, 1 skipped (pre-existing)
- New tests: 63 tests across 6 new test files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Broken CJS require pattern in `src/clients/sunswap.ts`**
- Found during: Task 1 (prior context session)
- Issue: The initial write used a broken `require`/`require_impl` CJS pattern for tronweb address utilities
- Fix: Replaced with `import { formatTronAddress, parseTronAddress } from "../chains/tron/address.js"` — the standard pattern used throughout the codebase
- Files modified: `src/clients/sunswap.ts`
- Commit: `1d9a46c`

**2. [Rule 1 - Bug] Wrong import path in `test/signing-fingerprint-tron-20.test.ts`**
- Found during: Task 1
- Issue: Import `"./signing-fingerprint-tron-19.js"` failed; the actual file is `signing-fingerprint-tron-19.test.ts`
- Fix: Changed to `"./signing-fingerprint-tron-19.test.js"`
- Files modified: `test/signing-fingerprint-tron-20.test.ts`
- Commit: `1d9a46c`

**3. [Rule 1 - Bug] `sc.cause` undefined in `get_sunswap_quote` null-quote arm**
- Found during: Task 2 test run (Test 3)
- Issue: `makeStructuredError("INTERNAL_ERROR", "SunSwap quote unavailable...")` without a `cause` arg → test `.toMatch(/SunSwap quote unavailable/i)` on undefined
- Fix: Added cause string `"SunSwap quote unavailable — RPC failure or pair not found"` as 3rd arg
- Files modified: `src/tools/get_sunswap_quote.ts`
- Commit: `704c6b9`

**4. [Rule 1 - Bug] Tests 20/21 used `require("../src/tools/index.js")` which fails in ESM**
- Found during: Task 2 test run
- Issue: `Cannot find module '../src/tools/index.js'` — `require()` doesn't work in ESM vitest
- Fix: Used already-imported `getRegisteredTool` from the top-level dynamic import
- Files modified: `test/prepare-sunswap-swap.test.ts`
- Commit: `704c6b9`

**5. [Rule 2 - Missing critical functionality] `PrepareArgs` missing Phase 20 fields**
- Found during: Task 3 TypeScript compile check
- Issue: `prepare_sunswap_swap.ts` assigns `inputToken`, `outputToken`, `slippageBps` to `PrepareArgs` which TypeScript rejected
- Fix: Added 3 optional fields to `PrepareArgs` interface in `handle-store.ts`
- Files modified: `src/signing/handle-store.ts`
- Commit: `4705c63`

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: outbound-network | src/clients/sunswap.ts | New TronGrid RPC calls (getAmountsOut, getReserves, getPair); mitigated by LRU cache + NEVER-throws contract + null → INTERNAL_ERROR |

## FROZEN-area Zero-Diff Assertion

`git diff origin/main -- <Phase 18/19 frozen paths>` returned 0 lines at Task 3 commit. Phase 18/19 tool files are byte-identical to origin/main.

## Self-Check: PASSED
