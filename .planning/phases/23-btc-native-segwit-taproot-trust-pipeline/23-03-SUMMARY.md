---
phase: 23-btc-native-segwit-taproot-trust-pipeline
plan: "03"
subsystem: btc-prepare-tool
tags:
  - bitcoin
  - psbt
  - prepare_btc_send
  - segwit
  - taproot
  - fixture-pinning
  - tdd

dependency_graph:
  requires:
    - "23-01: src/signing/btc-sighash.ts (computeAllSighashes) + src/signing/btc-fingerprint.ts (computeBtcPayloadFingerprint)"
    - "23-02: src/signing/btc-coin-select.ts (selectCoinsBnb) + src/protocols/btc-psbt.ts (buildBtcPsbt) + src/chains/bitcoin/change-index.ts (_changeIndex.nextChangeIndex)"
    - "22-02: src/wallet/ledger-btc-transport.ts (_btcLedgerTransport.fetchBtcAddresses) + src/wallet/non-evm-account-store.ts (listAccounts)"
    - "22-03: src/chains/bitcoin/esplora-client.ts (fetchAddressUtxos, fetchFeeEstimates)"
    - "22-04: src/demo/state.ts (getActiveBtcPersona)"
    - "18-02: src/signing/amount-tron.ts (parseTronAmountStrict, InvalidAmountError)"
  provides:
    - "src/tools/prepare_btc_send.ts — MCP tool: 11-step PSBT-v0 prepare flow for segwit + taproot + mixed UTXO sends"
    - "src/signing/handle-store.ts — PreparedTxBtc union member + BtcInstructionSummary type + PrepareArgs.sats field"
    - "src/signing/blocks-btc.ts — PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE format-fanout-sentinel (produced in Task 1 / 8cdadd7)"
    - "src/signing/error-codes.ts — BTC_DUST_OUTPUT, BTC_FEE_RATE_OUT_OF_BOUNDS, BTC_NO_UTXOS_AVAILABLE, BTC_MIXED_INPUT_SIGN_FAILURE codes (Task 1 / 8cdadd7)"
    - "test/prepare-btc-send.test.ts — 14-test regression suite with Fixture O/P/Q consumer re-anchors"
    - "test/signing-fingerprint.test.ts — Fixture P (taproot, 0x01af3f...) + Fixture Q (mixed, 0xffa4a2...) pinned literals"
  affects:
    - "23-04: send_transaction BTC branch — uses PreparedTxBtc handle + payloadFingerprint re-check"
    - "23-05: preview_send BTC branch — uses BtcInstructionSummary for DECODED ARGS block"

tech-stack:
  added: []
  patterns:
    - "11-step PSBT prepare handler pattern: input-validation FIRST → demo-mode FIRST → pairing check → UTXO fetch → feeRate resolution → coin-select → change-address → buildBtcPsbt → computeAllSighashes → computeBtcPayloadFingerprint → createHandle → PREPARE RECEIPT"
    - "Fixture P + Q pinned as hardcoded 0x… literals in signing-fingerprint.test.ts cross-linked from prepare-btc-send.test.ts"
    - "STUB_UNSIGNED_TX_HEX must be a valid bitcoin raw tx (bitcoinjs-lib Transaction.fromHex is strict); use a known-good minimal tx from Transaction.toHex()"
    - "PrepareArgs additive widening: sats?: string — same pattern as lamports/sun from prior phases"

key-files:
  created:
    - "src/tools/prepare_btc_send.ts"
    - "test/prepare-btc-send.test.ts"
  modified:
    - "src/signing/handle-store.ts — PreparedTxBtc + BtcInstructionSummary + PrepareArgs.sats (additive; state machine BYTE-IDENTICAL)"
    - "src/tools/register-all.ts — added import ./prepare_btc_send.js (BTC-PSBT-01 wiring)"
    - "test/signing-fingerprint.test.ts — Fixture P + Q appended (TDD RED; cross-linked literals)"

key-decisions:
  - "PrepareArgs.sats field added additively (parallel to lamports/sun precedent) — required for handle-store storage of raw sats string per PREP-02 verbatim invariant"
  - "STUB_UNSIGNED_TX_HEX fix: the test stub must be a real valid bitcoin tx hex; Transaction.fromHex rejects invalid bytes. Minimal tx built via Transaction.toHex() and hardcoded in test."
  - "Fixture O used as segwit re-anchor in prepare-btc-send.test.ts (cross-link only; not pinned again in signing-fingerprint.test.ts)"
  - "Demo mode uses generator G pubkey (0279be...81798) as PSBT stub pubkey — fingerprint security depends on sighashes not BIP-32 metadata"
  - "BTC_MIXED_INPUT_SIGN_FAILURE only used in Phase 23-04 send_transaction; not emitted by prepare tool"

patterns-established:
  - "BTC prepare tool: ESM spy-affordance objects _btcCoinSelect, _btcPsbt, _btcSighash, _btcFingerprint, _changeIndex used in tests"
  - "utxoOverride bypass: when supplied, skip Esplora UTXO fetch entirely (fee-estimates still fetched for feeRate bounds)"
  - "Hardcoded fixture literals strategy: run tsc + node ESM scripts to compute Fixture P/Q values, then pin the 0x… literals statically"

requirements-completed: [BTC-PSBT-01, BTC-W-01]

duration: 45min
completed: 2026-05-22
---

# Phase 23 Plan 03: prepare_btc_send BTC Trust Pipeline Summary

**`prepare_btc_send` MCP tool: PSBT-v0 11-step handler for native BTC segwit+taproot sends with payloadFingerprint binding and Fixture P/Q regression anchors**

## Performance

- **Duration:** ~45 min (continuation from prior session)
- **Started:** 2026-05-22T15:50:00Z
- **Completed:** 2026-05-22T16:21:00Z
- **Tasks:** 2 (Task 1 in prior session `8cdadd7`; Task 2 GREEN in this session `d1e33e3`)
- **Files modified:** 7

## Accomplishments

- `prepare_btc_send` tool: handles segwit (P2WPKH), taproot (P2TR), and mixed UTXO sets; INVALID_INPUT checked before any state read; demo-mode FIRST refusal; D-03 feeRate default; D-07 dust asymmetry; PREPARE RECEIPT verbatim (PREP-02)
- Fixtures P (taproot, `0x01af3f...`) and Q (mixed segwit+taproot, `0xffa4a2...`) pinned as hardcoded literals in `test/signing-fingerprint.test.ts` — cross-linked from `test/prepare-btc-send.test.ts`
- `PreparedTxBtc` union member in handle-store + `PrepareArgs.sats` field — state machine BYTE-IDENTICAL

## Task Commits

1. **Task 1: blocks-btc.ts + PreparedTxBtc + BTC error codes** - `8cdadd7` (feat)
2. **Task 2 RED: failing tests for prepare_btc_send + Fixtures P + Q** - `508d5fd` (test)
3. **Task 2 GREEN: prepare_btc_send.ts + register-all wiring + PrepareArgs.sats** - `d1e33e3` (feat)

## Files Created/Modified

- `src/tools/prepare_btc_send.ts` — 11-step PSBT prepare handler (segwit + taproot + mixed); 794 lines
- `src/signing/handle-store.ts` — Added `PreparedTxBtc` + `BtcInstructionSummary` + `PrepareArgs.sats`; state machine BYTE-IDENTICAL
- `src/tools/register-all.ts` — Wired `import "./prepare_btc_send.js"` next to Phase 22 BTC tools
- `test/prepare-btc-send.test.ts` — 14-test regression suite covering happy path, Fixture O/P/Q re-anchors, INVALID_INPUT FIRST, demo-mode, D-03, BTC_FEE_RATE_OUT_OF_BOUNDS, BTC_NO_UTXOS_AVAILABLE, utxoOverride, PREPARE RECEIPT verbatim, WALLET_NOT_PAIRED
- `test/signing-fingerprint.test.ts` — Fixture P + Fixture Q appended (hardcoded `0x…` literals)
- `src/signing/blocks-btc.ts` — (Task 1) PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE + block templates
- `src/signing/error-codes.ts` — (Task 1) BTC_DUST_OUTPUT, BTC_FEE_RATE_OUT_OF_BOUNDS, BTC_NO_UTXOS_AVAILABLE, BTC_MIXED_INPUT_SIGN_FAILURE

## Decisions Made

- Added `PrepareArgs.sats?: string` field to handle-store.ts additively, mirroring the `lamports` (Phase 12) and `sun` (Phase 18) precedent. Required for PREP-02 verbatim storage of the agent's raw sats string.
- Fixed test stub `STUB_UNSIGNED_TX_HEX`: bitcoinjs-lib `Transaction.fromHex` requires a valid raw bitcoin tx. The original stub (`"01000000" + "00".repeat(32)`) was invalid. Fixed by computing a minimal valid tx via `Transaction.toHex()` and hardcoding it as a constant.
- In demo mode, the generator point G (`0279be...`) serves as PSBT pubkey stub — fingerprint security is sighash-derived, not pubkey-derived.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed STUB_UNSIGNED_TX_HEX in test (invalid tx bytes)**
- **Found during:** Task 2 GREEN (test run)
- **Issue:** Happy-path tests failing with `INTERNAL_ERROR: "Transaction has unexpected data"` — the handler calls `Transaction.fromHex(psbtResult.unsignedTxHex)` at step 8, but the mock stub value `"01000000" + "00".repeat(32)` is not a valid bitcoin serialized transaction
- **Fix:** Computed a minimal valid bitcoin tx using `Transaction.toHex()` on a real tx object, then hardcoded the resulting hex as `STUB_UNSIGNED_TX_HEX` constant in the test
- **Files modified:** `test/prepare-btc-send.test.ts`
- **Verification:** All 14 tests GREEN after fix
- **Committed in:** `d1e33e3` (Task 2 GREEN commit)

**2. [Rule 2 - Missing Critical] Added PrepareArgs.sats to handle-store.ts**
- **Found during:** Task 2 GREEN (tsc --noEmit)
- **Issue:** `src/tools/prepare_btc_send.ts:710:9: error TS2353: 'sats' does not exist in type 'PrepareArgs'`
- **Fix:** Added `sats?: string` field to `PrepareArgs` interface in handle-store.ts, matching the `lamports`/`sun` pattern from prior phases. Additive only — state machine BYTE-IDENTICAL.
- **Files modified:** `src/signing/handle-store.ts`
- **Verification:** `npx tsc --noEmit` clean after fix
- **Committed in:** `d1e33e3` (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 bug fix, 1 missing critical field)
**Impact on plan:** Both auto-fixes required for correctness. No scope creep.

## Issues Encountered

- CWD drift in prior session: Bash tool cwd reset to main repo, causing commits to go to wrong branch. Resolved in prior session by explicit git commands from worktree cwd. No impact on final state — all commits correctly landed on `worktree-agent-a74d2035a63246e7d` branch.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. `prepare_btc_send` reads from Esplora (same surface as existing BTC read tools in Phase 22) and writes to the in-process handle store (same surface as prepare_native_send). No new external services or credentials exposed.

## Known Stubs

- `_changeIndex.nextChangeIndex` call: currently passes the paired segwit/taproot address as a proxy xpub — returns index 0 for fresh accounts. Real xpub derivation deferred to verify-phase (no real Ledger in CI). The change address is the existing segwit/taproot address at index 0. Non-blocking for Phase 23 code-complete per the 2026-05-16 directive.
- `_btcLedgerTransport.fetchBtcAddresses`: mocked in tests; real device call deferred to verify-phase. Code path is wired; USB-HID transport not exercised in CI.

## Next Phase Readiness

- Phase 23-04 (`send_transaction` BTC branch): `PreparedTxBtc` handle shape is finalized; `payloadFingerprint` is computed and stored; `psbtBase64` + `unsignedTxHex` + `perInputPrevouts` are all present for re-check and two-pass signing
- Phase 23-05 (`preview_send` BTC branch): `BtcInstructionSummary` type is defined; `instructionSummary` field present on `PreparedTxBtc`

## Self-Check: PASSED

- FOUND: `src/tools/prepare_btc_send.ts`
- FOUND: `test/prepare-btc-send.test.ts`
- FOUND: `23-03-SUMMARY.md` (this file)
- FOUND commit: `8cdadd7` (feat(23-03): blocks-btc.ts + PreparedTxBtc + BTC error codes)
- FOUND commit: `508d5fd` (test(23-03): add failing tests for prepare_btc_send + Fixtures P + Q)
- FOUND commit: `d1e33e3` (feat(23-03): prepare_btc_send.ts + register-all wiring + PrepareArgs.sats)
- NOTE: SUMMARY.md commit skipped — `.planning/` directory resolves to main repo path, outside worktree git scope. File exists on disk and will be committed by orchestrator on worktree merge.

---
*Phase: 23-btc-native-segwit-taproot-trust-pipeline*
*Completed: 2026-05-22*
