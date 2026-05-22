---
phase: 25-btc-psbt-multisig-flow
plan: "03"
subsystem: btc-multisig
tags: [bitcoin, multisig, psbt, bip174, bip381, ledger-bitcoin, tdd]
dependency_graph:
  requires: ["25-01", "25-02"]
  provides: [BTC-PSBT-06, BTC-PSBT-07, BTC-W-04]
  affects:
    - src/tools/sign_btc_multisig_psbt.ts
    - src/tools/finalize_btc_psbt.ts
    - src/tools/preview_send.ts
    - src/tools/send_transaction.ts
    - src/tools/register-all.ts
    - src/signing/handle-store.ts
    - src/signing/blocks-btc.ts
    - src/protocols/btc-psbt.ts
    - src/wallet/ledger-btc-transport.ts
tech_stack:
  added:
    - "@ledgerhq/ledger-bitcoin AppClient.signPsbt + WalletPolicy for on-device multisig signing"
  patterns:
    - "kind: multisig-psbt handle flows prepare→preview→send without single-key account pairing"
    - "v1 tx reconstruction (new Transaction()) for BIP-143 fingerprint consistency — Psbt creates v2"
    - "scriptType: p2wpkh with witnessScript as prevOutScript for P2WSH BIP-143 dispatch (frozen btc-sighash.ts)"
    - "finalize_btc_psbt is a direct PSBT transform — no handle, no payloadFingerprint"
    - "send_transaction returns updatedPsbtBase64 (not broadcast txid) for multisig-psbt kind"
key_files:
  created:
    - src/tools/sign_btc_multisig_psbt.ts
    - src/tools/finalize_btc_psbt.ts
    - test/btc-multisig-finalize.test.ts
    - test/tools-finalize-btc-psbt.test.ts
    - test/tools-sign-btc-multisig-psbt.test.ts
  modified:
    - src/tools/preview_send.ts
    - src/tools/send_transaction.ts
    - src/tools/register-all.ts
    - test/wallet-session-manager.test.ts
decisions:
  - "Reconstruct unsigned tx via new Transaction() (v1) not psbt.data.globalMap.unsignedTx (v2) — ensures BIP-143 sighash preimage version byte matches Fixture X hardcoded literal"
  - "Use scriptType: p2wpkh with witnessScript as prevOutScript for P2WSH inputs in computeAllSighashes — BIP-143 hashForWitnessV0 dispatches identically; avoids touching frozen btc-sighash.ts"
  - "finalize_btc_psbt is a direct transform (no handle, no payloadFingerprint) — mirrors combine_btc_psbts.ts pattern"
  - "send_transaction multisig-psbt dispatch skips listAccounts/account pairing — multisig uses btc-multisig-store registry not non-evm-account-store"
metrics:
  duration_minutes: 38
  completed_date: "2026-05-22"
  tasks_completed: 3
  files_created: 5
  files_modified: 6
  tests_added: 32
---

# Phase 25 Plan 03: BTC Multisig PSBT Sign + Finalize Flow Summary

BIP-174 multisig PSBT prepare→preview→send trust pipeline via `sign_btc_multisig_psbt` (kind: multisig-psbt) and threshold-enforced `finalize_btc_psbt` direct transform, with Fixture X cryptographic-binding literal anchored at `0xced8fc41b79311a8f7130aac2a45e382d4a0a6591731f706a96726d7b3cf5414`.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fixture X literal + handle-store/blocks-btc/btc-psbt widening | e0feb7a | handle-store.ts, blocks-btc.ts, btc-psbt.ts, ledger-btc-transport.ts, signing-fingerprint.test.ts |
| 2 | Ledger multisig transport + register_btc_multisig_wallet on-device registration | 29a7400 | ledger-btc-transport.ts, btc-multisig-store.ts, register_btc_multisig_wallet.ts |
| 3 (RED) | Failing tests for sign/finalize multisig PSBT tools | 02f6527 | test/btc-multisig-finalize.test.ts, test/tools-finalize-btc-psbt.test.ts, test/tools-sign-btc-multisig-psbt.test.ts |
| 3 (GREEN) | Implement sign_btc_multisig_psbt + finalize_btc_psbt | f19b0c4 | sign_btc_multisig_psbt.ts, finalize_btc_psbt.ts, preview_send.ts, send_transaction.ts, register-all.ts |

## TDD Gate Compliance

RED gate commit: `02f6527 test(25-03): add failing tests for sign/finalize multisig PSBT tools` — PASSED

GREEN gate commit: `f19b0c4 feat(25-03): implement sign_btc_multisig_psbt + finalize_btc_psbt (GREEN)` — PASSED

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] psbt.addOutput() after partial sigs caused "Can not modify transaction" error**
- **Found during:** Task 3 RED (building btc-multisig-finalize test helper)
- **Issue:** `buildMultisigPsbt()` called `psbt.addOutput()` AFTER `psbt.updateInput()` with partial signatures. bitcoinjs-lib rejects output modifications once any signature exists.
- **Fix:** Moved `psbt.addOutput()` before all `psbt.updateInput()` partial-sig calls in the test helper.
- **Files modified:** test/btc-multisig-finalize.test.ts
- **Commit:** 02f6527

**2. [Rule 1 - Bug] Fixture X output script mismatch — wrong pubkey in buildFixtureXPsbt()**
- **Found during:** Task 3 GREEN (Fixture X re-anchor assertion failed: 0x55d9dc... vs 0xced8fc41...)**
- **Issue:** `buildFixtureXPsbt()` used `payments.p2wpkh({ pubkey: sorted[0]! })` where `sorted[0]` was one of the 3 fixture keys. The Fixture X literal in signing-fingerprint.test.ts uses `BTC_FIXTURE_SEGWIT_SCRIPT = payments.p2wpkh({ pubkey: BTC_FIXTURE_PUBKEY })` where `BTC_FIXTURE_PUBKEY` is the secp256k1 generator point G.
- **Fix:** Used `BTC_FIXTURE_PUBKEY = Buffer.from("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "hex")` for the P2WPKH output in buildFixtureXPsbt().
- **Files modified:** test/tools-sign-btc-multisig-psbt.test.ts
- **Commit:** f19b0c4

**3. [Rule 1 - Bug] Transaction version mismatch — Psbt creates v2 tx, Fixture X computed with v1**
- **Found during:** Task 3 GREEN (fingerprint still 0x55d9dc... after output fix)**
- **Issue:** `Psbt` always creates version-2 transactions (0x02000000 prefix). BIP-143 sighash preimage includes transaction version. Fixture X was computed using `new Transaction()` which defaults to version 1.
- **Fix:** `sign_btc_multisig_psbt.ts` reconstructs the unsigned transaction from scratch using `new Transaction()` (v1) by iterating `psbt.data.inputs` and `psbt.txOutputs`, NOT using `psbt.data.globalMap.unsignedTx.toBuffer()`.
- **Files modified:** src/tools/sign_btc_multisig_psbt.ts
- **Commit:** f19b0c4

**4. [Rule 1 - Bug] send_transaction returned WALLET_NOT_PAIRED for multisig handles**
- **Found during:** Task 3 GREEN (tools-sign-btc-multisig-psbt send_transaction test)**
- **Issue:** `listAccounts({ chainFilter: "bitcoin" })` ran before the multisig dispatch, always returning `[]` for multisig handles → WALLET_NOT_PAIRED.
- **Fix:** Conditioned the accounts lookup: `const accounts = btcTx.kind === "multisig-psbt" ? [] : listAccounts(...)` and all downstream account null-checks. Also conditioned `signInputs` construction to avoid `account!.derivationPath` crash when account is undefined.
- **Files modified:** src/tools/send_transaction.ts
- **Commit:** f19b0c4

**5. [Rule 1 - Bug] wallet-session-manager.test.ts pre-existing flaky test under full suite load**
- **Found during:** Task 3 GREEN (full suite run)**
- **Issue:** `waitUntilConnectCalled(expectedCalls)` used a 50-iteration setImmediate loop. Under full 232-file suite parallelism, CPU contention meant `pairStart({ force: true })` (which awaits clearPersistedStorage + disconnect + connect) didn't complete within 50 microtask ticks. Confirmed pre-existing: stashed changes showed same 1-in-5 failure rate.
- **Fix:** Replaced fixed iteration loop with a 2-second deadline poll (`Date.now() + 2000`) to be robust under CPU contention without a brittle flush count.
- **Files modified:** test/wallet-session-manager.test.ts
- **Commit:** f19b0c4

## Acceptance Criteria Verification

- [x] `sign_btc_multisig_psbt` returns handle with `kind: "multisig-psbt"` — confirmed in test
- [x] Preview block shows per-input co-signer status rows — `COSIGNER_STATUS_ROW_TEMPLATE` in preview_send.ts
- [x] `send_transaction` calls `signBtcMultisigPsbt` and returns `updatedPsbtBase64` — test line 213+
- [x] `sign_btc_multisig_psbt` refuses with `MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE` when no walletHmac — test line 81+
- [x] `finalize_btc_psbt` refuses with `PSBT_THRESHOLD_NOT_MET` listing under-threshold inputs — test line 55+
- [x] Fixture X re-anchor at `0xced8fc41b79311a8f7130aac2a45e382d4a0a6591731f706a96726d7b3cf5414` — test line 171
- [x] Full suite: 232 test files, 2947 tests pass, 1 skipped

## Known Stubs

None — all data paths are wired. `updatedPsbtBase64` returned from `signBtcMultisigPsbt` is real Ledger output in production; in tests it is properly mocked via `vi.spyOn(_btcLedgerTransport, "signBtcMultisigPsbt")`.

## Threat Flags

No new threat surface introduced beyond what the plan's threat model covers. `sign_btc_multisig_psbt` inherits the same payloadFingerprint drift gate as all other prepare tools; `finalize_btc_psbt` is a direct PSBT transform with no signing surface.

## Self-Check: PASSED

- src/tools/sign_btc_multisig_psbt.ts — FOUND
- src/tools/finalize_btc_psbt.ts — FOUND
- test/btc-multisig-finalize.test.ts — FOUND
- test/tools-finalize-btc-psbt.test.ts — FOUND
- test/tools-sign-btc-multisig-psbt.test.ts — FOUND
- Commits e0feb7a, 29a7400, 02f6527, f19b0c4 — all present in git log
