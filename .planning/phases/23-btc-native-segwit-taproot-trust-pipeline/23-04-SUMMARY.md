---
phase: 23-btc-native-segwit-taproot-trust-pipeline
plan: "04"
subsystem: btc-trust-pipeline
tags: [bitcoin, psbt, ledger, preview-send, send-transaction, esplora, demo-mode, integration-test, security]
dependency_graph:
  requires: [23-03]
  provides: [BTC-PREP-02, BTC-PREP-03, BTC-PSBT-02-signing]
  affects: [preview_send, send_transaction, SECURITY.md]
tech_stack:
  added: []
  patterns:
    - two-pass mixed-input PSBT signing (signPsbtBuffer × 2 + Psbt.combine)
    - per-input BIP-143/341 sighash fingerprint recompute from canonical artifact (Pitfall 5 mitigation)
    - D-04 mempool-replay demo envelope for BTC send
    - persona-cycle byte-identity Direction A + Direction B regression anchor
key_files:
  created:
    - test/preview-send.btc.test.ts
    - test/send-transaction.btc.test.ts
    - test/btc-trust-pipeline.integration.test.ts
  modified:
    - src/wallet/ledger-btc-transport.ts
    - src/chains/bitcoin/esplora-client.ts
    - src/tools/preview_send.ts
    - src/tools/send_transaction.ts
    - SECURITY.md
decisions:
  - "BTC fingerprint recompute reads stored unsignedTxHex + perInputPrevouts (NOT re-parsed PSBT) per Pitfall 5 — prevents spurious drift-gate failures from PSBT normalization"
  - "previewSendBtcBranch return type mirrors previewSendTronBranch (explicit Promise<{isError?; content: Array<{type:'text'; text:string}>; structuredContent?}>) for ToolHandler compatibility"
  - "Demo mode BTC send does NOT call transitionToSent — returns rehearsal envelope only; handle stays 'previewed' (mirrors Solana + TRON precedent)"
  - "utxoOverride + LARGE_SATS used in integration test to force coin-selection to pick both UTXOs for mixed-input coverage (SMALL_SATS only needs 1 UTXO)"
  - "T-07 Direction A uses two taproot UTXOs with different txids (TAPROOT_UTXO_LARGE vs TAPROOT_UTXO_SMALL) to prove txid-dependence of BIP-341 sighash"
metrics:
  duration: ~45 minutes (execution session — prior context session covered earlier portion)
  completed: "2026-05-22T14:11:36Z"
  tasks_completed: 3
  files_modified: 5
  files_created: 3
  tests_added: 38
  full_suite: "220 test files / 2786 tests pass / 1 skipped"
---

# Phase 23 Plan 04: BTC Trust Pipeline — preview_send + send_transaction + Integration Test

**One-liner:** BTC trust pipeline wired end-to-end: two-pass mixed-input PSBT signing, per-input sighash fingerprint recompute from canonical artifact, Esplora broadcast, D-04 mempool-replay demo envelope, and persona-cycle byte-identity integration test anchoring both fingerprint directions.

## What Was Built

### Task 1: signBtcPsbt two-pass mixed-input signing + broadcastTx (commit 6b5ace9)

`src/wallet/ledger-btc-transport.ts`:
- `signBtcPsbt(psbtBase64, inputs, knownAddressDerivations)` — two-pass split for mixed-script-type PSBTs: partition inputs by script type, call `signPsbtBuffer` once per non-empty group (m/84'/0'/0' + bech32 for segwit; m/86'/0'/0' + bech32m for taproot), combine via `Psbt.combine`, finalize per-input (skip already-finalized), extract raw tx hex.
- `LedgerBtcAppNotOpenError` named error class.
- `_btcLedgerTransport` ESM spy-affordance export.

`src/chains/bitcoin/esplora-client.ts`:
- `broadcastTx(rawTxHex)` — never-throws discriminated union `{ kind: "ok"; txid } | { kind: "rejected"; message } | { kind: "error"; message }`, AbortController timeout, POST /tx.

Test coverage: 32 tests in `test/ledger-btc-transport.test.ts` + 5 `broadcastTx` tests in `test/chains-bitcoin-esplora-client.test.ts`.

### Task 2: preview_send + send_transaction BTC branches + D-04 demo envelope (commit af983d7)

`src/tools/preview_send.ts`:
- `previewSendBtcBranch` — Layer 1 fingerprint recompute from stored canonical artifact (unsignedTxHex + perInputPrevouts, NOT re-parsed PSBT per Pitfall 5); PAYLOAD_FINGERPRINT_DRIFT refusal on mismatch; mints previewToken; emits PREPARE RECEIPT (BTC) + LEDGER BLIND-SIGN HASH (BTC) with N per-input sighash rows; sessionTopicLast8=null (no WC relay).
- Dispatch: `if (txType === "btc") { return await previewSendBtcBranch(...); }` additive after TRON dispatch.

`src/tools/send_transaction.ts`:
- `sendTransactionBtcBranch` — demo-mode D-04 mempool-replay short-circuit; pairing check via `listAccounts({ chainFilter: "bitcoin" })`; sign via `_btcLedgerTransport.signBtcPsbt`; broadcast via `esploraBroadcastTx`; error mapping (LedgerBtcDeviceNotConnectedError → LEDGER_NOT_CONNECTED, LedgerBtcAppNotOpenError → LEDGER_REJECTED, /reject/i → LEDGER_REJECTED, /combine|finalize|mixed/i → BTC_MIXED_INPUT_SIGN_FAILURE, Esplora rejected/error → BROADCAST_FAILED).
- BTC arm in fingerprint-recompute discriminator (ADDITIVE — outside FROZEN three-gate region).
- FROZEN three-gate region byte-identical to origin/main (T-16 git diff assertion).

Test coverage: 9 tests in `test/preview-send.btc.test.ts` + 16 tests in `test/send-transaction.btc.test.ts`.

### Task 3: BTC trust-pipeline integration test + SECURITY.md BTC section (commit d7649d7)

`test/btc-trust-pipeline.integration.test.ts` (13 tests):
- Direction A: same {to,sats} + DIFFERENT UTXOs → DIFFERENT payloadFingerprint (persona-distinct).
- Direction B: same {to,sats} + SAME utxoOverride → BYTE-IDENTICAL payloadFingerprint (regression anchor).
- End-to-end segwit-only, taproot-only, mixed-input (prepare → preview → send, demo mode).
- Three-gate enforcement (PREVIEW_TOKEN_MISMATCH, PREVIEW_REQUIRED, cancel).

`SECURITY.md`: Phase 23 BTC section with trust-shape divergence table, PSBT serialization and two-pass signing documentation, Pitfall 5 canonical artifact documentation, three accepted residuals, Phase 23 threat register summary (T-23-13 through T-23-SC).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] BtcPsbtSignInput field mismatch in sendTransactionBtcBranch**
- **Found during:** Task 2 implementation (TypeScript compile)
- **Issue:** Initial implementation used `path` and omitted `index` field; interface requires `index`, `bip32Path`.
- **Fix:** Added `index: idx` and renamed `path` to `bip32Path` in the `BtcPsbtSignInput` construction.
- **Files modified:** src/tools/send_transaction.ts

**2. [Rule 1 - Bug] _btcLedgerTransport.signBtcPsbt call used object arg instead of 3 positional args**
- **Found during:** Task 2 TypeScript compile
- **Issue:** Called `signBtcPsbt({ psbtBase64, signInputs, knownAddressDerivations })` — the spy-affordance wrapper takes 3 positional args.
- **Fix:** Changed to `signBtcPsbt(psbtBase64, signInputs, [])`.
- **Files modified:** src/tools/send_transaction.ts

**3. [Rule 1 - Bug] previewSendBtcBranch return type annotation incompatible with ToolHandler**
- **Found during:** Task 2 TypeScript compile
- **Issue:** Initial `ReturnType<typeof registerTool extends ...>` annotation resolved to `void`, which TypeScript rejected; `content[].type` must be literal `"text"`, not `string`.
- **Fix:** Changed to explicit `Promise<{ isError?: boolean; content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown> }>` (mirrors previewSendTronBranch shape).
- **Files modified:** src/tools/preview_send.ts

**4. [Rule 1 - Bug] stash drop during test run lost Task 2 tracked file changes**
- **Found during:** Task 2 verification (re-entering session after context compaction)
- **Issue:** A `git stash create && git stash drop` sequence in the session dropped modifications to preview_send.ts and send_transaction.ts before they were committed.
- **Fix:** Re-implemented Task 2 source changes from summary context + test files.
- **Files modified:** src/tools/preview_send.ts, src/tools/send_transaction.ts

**5. [Rule 1 - Bug] fetchFeeEstimates mock returned wrong shape in integration test**
- **Found during:** Task 3 integration test run
- **Issue:** Mock returned `{ ok: true, estimates }` but `prepare_btc_send` reads `feeResult.kind !== "ok"`.
- **Fix:** Changed mock to `{ kind: "ok", estimates: FAKE_FEE_ESTIMATES }`.
- **Files modified:** test/btc-trust-pipeline.integration.test.ts

**6. [Rule 1 - Bug] T-05 mixed-input test: SMALL_SATS covered by a single UTXO, coin-selector didn't pick both**
- **Found during:** Task 3 integration test failures
- **Issue:** `[SEGWIT_UTXO_A (100000), TAPROOT_UTXO (300000)]` + `SMALL_SATS (50000)` → coin-selector picked only TAPROOT_UTXO (cheapest that covers); test expected 2 input rows.
- **Fix:** Added `TAPROOT_UTXO_SMALL (80000)` + `LARGE_SATS (150000)` so coin-selection requires both UTXOs. Test updated to pass `LARGE_SATS` explicitly.
- **Files modified:** test/btc-trust-pipeline.integration.test.ts

**7. [Rule 1 - Bug] T-03 integration test asserted handle transitions to 'sent' in demo mode**
- **Found during:** Task 3 integration test run
- **Issue:** Demo-mode `send_transaction` BTC branch returns rehearsal envelope without calling `transitionToSent` (mirrors Solana + TRON). Test asserted `status === "sent"`.
- **Fix:** Updated assertion to `status === "previewed"` with explanatory comment.
- **Files modified:** test/btc-trust-pipeline.integration.test.ts

**8. [Rule 1 - Bug] T-07 Direction A assertion: mixed-input [SEGWIT+TAPROOT_LARGE] vs [TAPROOT_LARGE] both produce same FP with SMALL_SATS**
- **Found during:** Task 3 integration test run
- **Issue:** Both preparations selected only TAPROOT_UTXO_LARGE (covers SMALL_SATS alone), so the fingerprints were identical instead of distinct.
- **Fix:** Changed T-07 to compare TAPROOT_UTXO_LARGE vs TAPROOT_UTXO_SMALL (different txids → different sighash → different FP).
- **Files modified:** test/btc-trust-pipeline.integration.test.ts

## Known Stubs

None — all paths fully wired. The `bip32Path: account.derivationPath` in `sendTransactionBtcBranch` uses the stored derivation path from the non-EVM account store; real-device pubkey derivation deferred to v2.2 verify-phase (documented residual in SECURITY.md).

## Threat Flags

None — all new surfaces covered by the Phase 23 threat register in SECURITY.md (T-23-13 through T-23-18 + T-23-07 accepted residual).

## Self-Check

### Files exist:
- src/wallet/ledger-btc-transport.ts — FOUND (Task 1 from prior commit)
- src/chains/bitcoin/esplora-client.ts — FOUND (Task 1 from prior commit)
- src/tools/preview_send.ts — FOUND (previewSendBtcBranch added)
- src/tools/send_transaction.ts — FOUND (sendTransactionBtcBranch added)
- test/preview-send.btc.test.ts — FOUND
- test/send-transaction.btc.test.ts — FOUND
- test/btc-trust-pipeline.integration.test.ts — FOUND
- SECURITY.md — FOUND (Phase 23 BTC section appended)

### Commits verified:
- 6b5ace9 — feat(23-04): signBtcPsbt two-pass mixed-input signing + broadcastTx
- af983d7 — feat(23-04): preview_send BTC branch + send_transaction BTC branch + D-04 demo envelope
- d7649d7 — docs(23-04): BTC trust-pipeline integration test + SECURITY.md BTC section

### Test suite: 220 test files / 2786 tests pass / 1 skipped (pre-existing wallet-session-manager flaky test)

## Self-Check: PASSED
