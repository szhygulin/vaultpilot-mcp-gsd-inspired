---
phase: 23-btc-native-segwit-taproot-trust-pipeline
plan: "02"
subsystem: btc-psbt-construction
tags:
  - bitcoin
  - psbt
  - coin-selection
  - bnb
  - change-index
  - utxo

dependency_graph:
  requires:
    - "22-01: src/chains/bitcoin/types.ts (UtxoRow, initEccLib)"
    - "22-03: src/chains/bitcoin/xpub-scan.ts (gap-limit scan engine)"
    - "22-01: bitcoinjs-lib@7.0.1 (already in package.json)"
  provides:
    - "src/signing/btc-coin-select.ts (selectCoinsBnb)"
    - "src/protocols/btc-psbt.ts (buildBtcPsbt, decodeBtcPsbt)"
    - "src/chains/bitcoin/change-index.ts (nextChangeIndex)"
    - "src/chains/bitcoin/xpub-scan.ts: additive chain:0|1 parameter"
  affects:
    - "23-03: prepare_btc_send.ts (consumes selectCoinsBnb + buildBtcPsbt + nextChangeIndex)"
    - "23-04: preview_send BTC branch (consumes decodeBtcPsbt)"

tech_stack:
  added: []
  patterns:
    - "BnB (Erhardt 2016) coin selection — pure-bigint in-repo (no coinselect npm)"
    - "PSBT-v0 (BIP-174) via bitcoinjs-lib.Psbt with mixed segwit+taproot inputs"
    - "xpub gap-limit scan extended to chain=1 (change chain) with TTL cache key isolation"
    - "decodeBtcPsbt discriminated union — NEVER throws (mirror tron-native.ts decoder)"

key_files:
  created:
    - src/signing/btc-coin-select.ts
    - src/chains/bitcoin/change-index.ts
    - src/protocols/btc-psbt.ts
    - test/btc-coin-select.test.ts
    - test/change-index.test.ts
    - test/btc-psbt.test.ts
  modified:
    - src/chains/bitcoin/xpub-scan.ts

decisions:
  - "BnB exact-match window is computed per-subset (not globally pre-computed) to avoid fixed-input-count fee estimation error"
  - "decodeBtcPsbt uses psbt.txInputs / psbt.txOutputs (public API) rather than psbt.data.globalMap.unsignedTx.ins/outs (internal)"
  - "OQ-3 two-rapid-prepare change index race documented as accepted residual in change-index.ts header"

metrics:
  duration: "14 minutes"
  completed_date: "2026-05-22T12:40:18Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 1
  tests_added: 33
  test_baseline: 2677
  test_final: 2710
---

# Phase 23 Plan 02: PSBT-Construction Subsystem Summary

**One-liner:** BnB coin selection + PSBT-v0 assembly with mixed segwit+taproot inputs + change-chain index derivation via parameterized xpub gap-limit scan.

## What Was Built

### Task 1 — `src/signing/btc-coin-select.ts` (commit `204a61c`)

Pure-bigint, no-I/O branch-and-bound coin selection with largest-first fallback.

Key behaviors:
- **BnB (Erhardt 2016):** Searches for a zero-change-output solution; computes fee per-subset based on actual selected inputs (fixes a naive approach that pre-computes fee on all UTXOs).
- **Largest-first fallback:** Fires when BnB finds no exact-enough match (within 500-sat tolerance).
- **D-03 fee-rate bounds:** Refuses `feeRate < 1 sat/vB` or `feeRate > 10× highPriorityEstimate`.
- **D-07 dust asymmetry:** Recipient below dust → `{ kind: "refused" }`; change below dust → folds into fee (`changeSats = 0n`) — never refuses for below-dust change.
- **Mixed script-type vbyte table** `[CITED: BIP-141]`: P2WPKH input 68, P2TR input 58, P2WPKH output 31, P2TR output 43, overhead 11.
- Exports `selectCoinsBnb` + `_btcCoinSelect` (ESM spy-affordance).

Test coverage: 12 tests — BnB exact match, largest-first fallback, feeRate bounds, mixed segwit+taproot, dust asymmetry.

### Task 2 — `src/chains/bitcoin/change-index.ts` + `xpub-scan.ts` extension (commit `10fe574`)

Change-chain (chain-1) next-unused index via the Phase 22 xpub gap-limit scan.

- `xpub-scan.ts` gains additive `chain: 0 | 1 = 0` parameter on `deriveAddress` + `scanXpub`; `node.derive(0)` becomes `node.derive(chain)`.
- TTL cache key extended from `${xpub}::${scriptType}` to `${xpub}::${scriptType}::${chain}` — chain-0 and chain-1 scans don't collide.
- `change-index.ts`: thin wrapper calling `scanXpub(xpub, scriptType, 1)` and returning `max(activeIndex) + 1` (or 0 if no active addresses).
- OQ-3 caveat documented: two rapid prepares both see the same next-unused index — accepted residual.
- All 14 existing xpub-scan tests stay green (back-compat proved).

Test coverage: 8 tests — chain-1 returns first unused, skips used indices, cache isolation, gap-limit termination, back-compat with default chain=0, chain-0 vs chain-1 derive different addresses.

### Task 3 — `src/protocols/btc-psbt.ts` (commit `adef494`)

PSBT-v0 assembly and never-throwing decoder.

- `buildBtcPsbt`: assembles unsigned PSBT-v0 holding both segwit and taproot inputs in ONE PSBT (BTC-PSBT-02); `RBF_DISABLED_SEQUENCE = 0xfffffffe` on every input (D-06); dust enforcement on all outputs (D-07); change output carries `bip32Derivation` / `tapBip32Derivation` (D-02/Pitfall 6 — device marks as "change" not "send").
- Returns `perInputPrevouts[]` + `unsignedTxHex` as canonical fingerprint-recompute artifact (Pitfall 5 defense — no PSBT re-parse at preview/send time).
- Side-effect-imports `../chains/bitcoin/types.js` to guarantee `initEccLib(tinySecp256k1)` fires (taproot `payments.p2tr` throws without it).
- `decodeBtcPsbt`: discriminated union `{ kind: "native" | "unknown" }`, NEVER throws — uses `psbt.txInputs` / `psbt.txOutputs` public API.
- No `.toString("hex")` on bitcoinjs-lib v7 returns; uses `@noble/hashes/utils.bytesToHex`.
- Exports `buildBtcPsbt`, `decodeBtcPsbt`, `_btcPsbt` (ESM spy-affordance).

Test coverage: 13 tests — segwit-only, taproot-only, mixed (BTC-PSBT-02), change output derivation, RBF sequence, dust refusal, decoder on garbage/empty/random/valid input.

## Verification

All plan acceptance criteria met:

- `npx vitest run test/btc-coin-select.test.ts test/btc-psbt.test.ts test/change-index.test.ts test/chains-bitcoin-xpub-scan.test.ts` — 47 tests green.
- `npx vitest run` (full suite) — 2710 tests passed (baseline 2677 + 33 new), 0 failures, 1 pre-existing skip.
- `npx tsc --noEmit` — clean.
- No new npm dependencies; `grep -c "coinselect" package.json` = 0.
- `grep -c "derive(chain)" src/chains/bitcoin/xpub-scan.ts` = 1.
- `grep -c "0xfffffffe\|RBF_DISABLED_SEQUENCE" src/protocols/btc-psbt.ts` = 6.
- Vbyte table carries `[CITED]` comments referencing BIP-141.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] BnB fee estimation computed on wrong input set**
- **Found during:** Task 1 implementation
- **Issue:** The naive approach pre-computed `feeNoChange = estimateFee(sorted, ...)` using all UTXOs in the sorted list, then used that as the BnB search target. But BnB explores subsets of different sizes, each with different fees.
- **Fix:** BnB now computes the no-change fee per candidate subset inside the search function, using only the currently-selected inputs.
- **Files modified:** `src/signing/btc-coin-select.ts`
- **Commit:** `204a61c`

**2. [Rule 1 - Bug] `decodeBtcPsbt` used `psbt.data.globalMap.unsignedTx.ins/outs` (internal API)**
- **Found during:** Task 3 test execution
- **Issue:** The decoder tried to access `tx.ins[i]` via the internal globalMap, which threw an error swallowed by the catch block, returning `{ kind: "unknown" }` for valid PSBTs.
- **Fix:** Switched to the public `psbt.txInputs` / `psbt.txOutputs` accessors.
- **Files modified:** `src/protocols/btc-psbt.ts`
- **Commit:** `adef494`

## Threat Flags

None — no new network endpoints, auth paths, or file access patterns introduced. The change-index.ts Esplora boundary is identical to the existing chain-0 xpub scan already covered by T-23-07 (Fabricated UTXOs from hostile Esplora endpoint — accepted residual in the plan's threat model).

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `src/signing/btc-coin-select.ts` exists | FOUND |
| `src/chains/bitcoin/change-index.ts` exists | FOUND |
| `src/protocols/btc-psbt.ts` exists | FOUND |
| `test/btc-coin-select.test.ts` exists | FOUND |
| `test/change-index.test.ts` exists | FOUND |
| `test/btc-psbt.test.ts` exists | FOUND |
| `src/chains/bitcoin/xpub-scan.ts` exists | FOUND |
| Commit `204a61c` exists | FOUND |
| Commit `10fe574` exists | FOUND |
| Commit `adef494` exists | FOUND |
| 33 new tests pass (btc-coin-select: 12, btc-psbt: 13, change-index: 8) | PASSED |
| 14 existing xpub-scan tests still pass | PASSED |
