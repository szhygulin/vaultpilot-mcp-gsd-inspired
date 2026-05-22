---
phase: 25-btc-psbt-multisig-flow
verified: 2026-05-22T22:30:00Z
status: human_needed
score: 13/13 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Register a multisig wallet policy on a physical Ledger device and verify the wallet name + key list appears on-screen"
    expected: "Ledger BTC app v2.1+ displays the wallet name and M-of-N descriptor keys; user confirms on-device; register_btc_multisig_wallet returns walletHmac"
    why_human: "Requires a physical Ledger hardware wallet connected via USB-HID with BTC app v2.1+; automated tests mock the transport via vi.spyOn(_btcLedgerTransport)"
  - test: "Sign a multisig PSBT on-device via sign_btc_multisig_psbt → send_transaction; verify the Ledger screen shows the correct inputs/outputs"
    expected: "Ledger BTC app displays each input being signed; returns updatedPsbtBase64 (not a broadcast txid); user confirms the outputs match the PREPARE RECEIPT"
    why_human: "Requires a physical Ledger and a real multisig PSBT; send_transaction returns updatedPsbtBase64 not a txid — on-device confirmation can only be verified with hardware"
  - test: "Broadcast a finalized multisig PSBT to mainnet with a second cooperating signer"
    expected: "finalize_btc_psbt returns finalPsbtBase64 + txHex; transaction confirms on mainnet"
    why_human: "Requires a real M-of-N wallet with a second physical co-signer, real BTC, and a broadcast step outside this codebase"
  - test: "Verify WalletPolicy shim (WR-03 fix) resolves correctly in production against @ledgerhq/ledger-bitcoin@0.3.1 actual export shape"
    expected: "WalletPolicy constructor is resolved successfully at runtime; registerBtcMultisigWallet does not throw the startup assertion"
    why_human: "The three-path fallback order is behavioral; automated tests mock the transport before the shim is exercised; fix confirmed by probe at review but requires live import verification"
---

# Phase 25: btc-psbt-multisig-flow Verification Report

**Phase Goal:** User can participate in M-of-N multisig PSBT workflows — register a multisig wallet descriptor, read multisig balances + UTXOs, combine partially-signed PSBTs from co-signers, sign their input contribution, finalize the fully-signed PSBT for broadcast.
**Verified:** 2026-05-22T22:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can register a wsh(sortedmulti(M,...)) descriptor and get back the first 5 derived P2WSH addresses | ✓ VERIFIED | `register_btc_multisig_wallet.ts` calls `parseWshSortedMulti` + `deriveMultisigAddress` × 5; test asserts 5-address return |
| 2 | Malformed descriptors, M>N, M<1, and non-/** key expressions are refused with structured errors before persistence | ✓ VERIFIED | `parseWshSortedMulti` returns null for all invalid forms; tool returns `MULTISIG_DESCRIPTOR_INVALID` before any `saveMultisigWallet` call; 7 test cases cover each refusal path |
| 3 | Registry persists to ~/.vaultpilot-mcp/btc-multisig.json with 0o600 permissions via tempfile+rename atomic write | ✓ VERIFIED | `writeAtomic` in `btc-multisig-store.ts:181` writes `{ mode: 0o600 }`; uses tempfile+rename; test verifies mode via spy on `_btcMultisigStorage.writeFileSync` |
| 4 | User can read aggregate balance and raw UTXOs for a registered multisig wallet via Esplora at the descriptor's derived addresses | ✓ VERIFIED | `get_btc_multisig_balance.ts` and `get_btc_multisig_utxos.ts` use gap-limit scan (concurrency 5, 20-consecutive-unused) over derived P2WSH addresses via `fetchAddressInfo`/`fetchAddressUtxos`; tests stub fetch via `vi.stubGlobal` |
| 5 | register_btc_multisig_wallet without a connected Ledger stores the record HMAC-less; device-absent path is the default fallback | ✓ VERIFIED | Tool wraps `_btcLedgerTransport.registerBtcMultisigWallet` in try/catch; device-not-connected error → persist HMAC-less; test asserts record has no `walletHmac` on device-absent path |
| 6 | User can combine co-signer PSBTs; conflicts refused with PSBT_COMBINE_CONFLICT before Psbt.combine() | ✓ VERIFIED | `combineBtcPsbts` in `btc-psbt.ts:502`; conflict check at line 569 returns `{ kind: "conflict" }` before line 576 `combined.combine(...)` is ever reached; 10 tests including all-pairs conflict scan and idempotent re-submission |
| 7 | sign_btc_multisig_psbt returns a handle (kind: multisig-psbt) and a payloadFingerprint | ✓ VERIFIED | `createHandle` called with `kind: "multisig-psbt"` at line 471; `payloadFingerprint` computed via FROZEN `computeBtcPayloadFingerprint`; test asserts handle kind and fingerprint |
| 8 | Preview block shows per-input co-signer status (sigs present / threshold / still needed) | ✓ VERIFIED | `preview_send.ts:2184–2215` branch for `multisig-psbt` builds `COSIGNER_STATUS_ROW_TEMPLATE` rows; test verifies cosigner status rows in preview output |
| 9 | send_transaction signs multisig PSBT via @ledgerhq/ledger-bitcoin AppClient.signPsbt and returns updatedPsbtBase64 (not a txid) | ✓ VERIFIED | `send_transaction.ts:1579` calls `_btcLedgerTransport.signBtcMultisigPsbt`; returns `structuredContent: { updatedPsbtBase64, chain: "bitcoin", kind: "multisig-psbt" }`; test asserts updatedPsbtBase64 not null |
| 10 | register_btc_multisig_wallet performs on-device registerWallet when Ledger connected, persists walletHmac; falls back HMAC-less without device | ✓ VERIFIED | `register_btc_multisig_wallet.ts:290–330`; device-present path calls `_btcLedgerTransport.registerBtcMultisigWallet` and persists `walletHmac`; device-absent stores HMAC-less; tests cover both paths |
| 11 | sign_btc_multisig_psbt refuses with MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE when registry record has no walletHmac | ✓ VERIFIED | Check at line 215 of `sign_btc_multisig_psbt.ts`: `if (!wallet.walletHmac)` → `MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE`; also re-checked in `send_transaction.ts:1558`; test asserts the error code |
| 12 | finalize_btc_psbt refuses with PSBT_THRESHOLD_NOT_MET listing under-threshold inputs when any input has fewer than M signatures | ✓ VERIFIED | `finalizeBtcPsbt` in `btc-psbt.ts:620` counts `partialSig.length` per input before `finalizeAllInputs()`; returns `{ kind: "threshold-not-met", underThresholdInputs }`; tool maps to `PSBT_THRESHOLD_NOT_MET`; 12 test cases |
| 13 | Multisig PSBT payloadFingerprint is Fixture X — hardcoded 0xced8fc41... literal in test/signing-fingerprint.test.ts, re-anchored in sign-tool test | ✓ VERIFIED | `test/signing-fingerprint.test.ts:684` asserts `toBe("0xced8fc41b79311a8f7130aac2a45e382d4a0a6591731f706a96726d7b3cf5414")`; `test/tools-sign-btc-multisig-psbt.test.ts:233` re-anchors the same literal; no `beforeAll`-snapshot |

**Score:** 13/13 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/config/btc-multisig-storage.ts` | Storage path + mode resolution | ✓ VERIFIED | Exports `getBtcMultisigStoragePath`, `getBtcMultisigStorageMode`, `getBtcMultisigStorageDir`, `ensureStorageDirWithPerms` |
| `src/wallet/btc-multisig-store.ts` | BtcMultisigWalletRecord CRUD + descriptor parse + BIP-67 address derivation | ✓ VERIFIED | Exports `saveMultisigWallet`, `loadMultisigWallet`, `parseWshSortedMulti`, `deriveMultisigAddress`, `_btcMultisigStorage`; `writeAtomic` at 0o600; `validateRecord` checks `threshold > totalSigners` |
| `src/tools/register_btc_multisig_wallet.ts` | register_btc_multisig_wallet tool | ✓ VERIFIED | Imports `VERIFY_ON_DEVICE_MULTISIG_TEMPLATE` from `blocks-btc.ts` (CR-01 fixed); `registrationNote` initialized (IN-02 fixed) |
| `src/tools/get_btc_multisig_balance.ts` | get_btc_multisig_balance tool | ✓ VERIFIED | Gap-limit scan over P2WSH addresses; Esplora balance aggregation |
| `src/tools/get_btc_multisig_utxos.ts` | get_btc_multisig_utxos tool | ✓ VERIFIED | Gap-limit scan; returns flat UTXO list |
| `src/protocols/btc-psbt.ts` | combineBtcPsbts + finalizeBtcPsbt helpers | ✓ VERIFIED | `combineBtcPsbts` with pre-scan before `Psbt.combine`; minimum-input guard (IN-01 fixed); `finalizeBtcPsbt` with threshold enforcement; both in `_btcPsbt` spy-affordance |
| `src/tools/combine_btc_psbts.ts` | combine_btc_psbts direct-transform tool | ✓ VERIFIED | No `createHandle`, no `payloadFingerprint`; routes `kind: "conflict"` → `PSBT_COMBINE_CONFLICT` |
| `src/wallet/ledger-btc-transport.ts` | signBtcMultisigPsbt + registerBtcMultisigWallet | ✓ VERIFIED | Both functions exported and in `_btcLedgerTransport` spy-affordance; `LedgerBtcAppVersionTooOldError` class present; WalletPolicy shim no longer falls back to namespace object (WR-03 fixed) |
| `src/tools/sign_btc_multisig_psbt.ts` | sign_btc_multisig_psbt prepare tool | ✓ VERIFIED | `createHandle` with `kind: "multisig-psbt"`; dead `descriptorTemplate` removed (WR-02 fixed) |
| `src/tools/finalize_btc_psbt.ts` | finalize_btc_psbt direct transform | ✓ VERIFIED | No `createHandle`, no `payloadFingerprint` |
| `test/signing-fingerprint.test.ts` | Fixture X hardcoded literal | ✓ VERIFIED | `0xced8fc41b79311a8f7130aac2a45e382d4a0a6591731f706a96726d7b3cf5414` as concrete `toBe()` literal |
| `src/signing/handle-store.ts` | kind union widened to include "multisig-psbt" | ✓ VERIFIED | `kind: "native" | "rbf" | "multisig-psbt"` at line 570; optional multisig fields added |
| `src/signing/blocks-btc.ts` | 3 Phase 25 template constants | ✓ VERIFIED | `PREPARE_RECEIPT_BTC_MULTISIG_TEMPLATE`, `COSIGNER_STATUS_ROW_TEMPLATE`, `VERIFY_ON_DEVICE_MULTISIG_TEMPLATE` all present |
| `src/signing/error-codes.ts` | 6 Phase 25 error codes | ✓ VERIFIED | `PSBT_COMBINE_CONFLICT`, `PSBT_THRESHOLD_NOT_MET`, `MULTISIG_WALLET_NOT_FOUND`, `MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE`, `LEDGER_BTC_APP_VERSION_TOO_OLD`, `MULTISIG_DESCRIPTOR_INVALID` — all appended to the union, not reordered |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/tools/register_btc_multisig_wallet.ts` | `src/wallet/btc-multisig-store.ts` | `saveMultisigWallet + parseWshSortedMulti + deriveMultisigAddress` | ✓ WIRED | All three imported and called in tool handler |
| `src/wallet/btc-multisig-store.ts` | `src/config/btc-multisig-storage.ts` | `getBtcMultisigStoragePath + ensureStorageDirWithPerms` | ✓ WIRED | `getBtcMultisigStoragePath` called in `writeAtomic`; `ensureStorageDirWithPerms` called before write |
| `src/tools/get_btc_multisig_balance.ts` | `src/chains/bitcoin/esplora-client.ts` | Per-address Esplora fan-out | ✓ WIRED | `fetchAddressInfo` imported and used in gap-limit scan |
| `src/tools/combine_btc_psbts.ts` | `src/protocols/btc-psbt.ts` | `_btcPsbt.combineBtcPsbts` | ✓ WIRED | `_btcPsbt` imported; `_btcPsbt.combineBtcPsbts` called; result routed to `PSBT_COMBINE_CONFLICT` on conflict |
| `src/tools/sign_btc_multisig_psbt.ts` | `src/signing/handle-store.ts` | `createHandle` with kind multisig-psbt | ✓ WIRED | `createHandle` imported and called; `PreparedTxBtc` built with `kind: "multisig-psbt"` |
| `src/tools/send_transaction.ts` | `src/wallet/ledger-btc-transport.ts` | `_btcLedgerTransport.signBtcMultisigPsbt` | ✓ WIRED | `_btcLedgerTransport.signBtcMultisigPsbt` called in the `multisig-psbt` dispatch branch; `MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE` re-checked at send time |
| `src/wallet/ledger-btc-transport.ts` | `@ledgerhq/ledger-bitcoin` | `AppClient.signPsbt + registerWallet + WalletPolicy` | ✓ WIRED | `AppClient`, `WalletPolicy`, `WalletPolicyNamed` imported; `AppClient.signPsbt` called in `signBtcMultisigPsbt`; `AppClient.registerWallet` called in `registerBtcMultisigWallet` |
| `src/tools/finalize_btc_psbt.ts` | `src/protocols/btc-psbt.ts` | `_btcPsbt.finalizeBtcPsbt` | ✓ WIRED | `_btcPsbt.finalizeBtcPsbt` called; `kind: "threshold-not-met"` maps to `PSBT_THRESHOLD_NOT_MET` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `register_btc_multisig_wallet.ts` | addresses (5 P2WSH) | `deriveMultisigAddress` from BIP-32 xpubs | Yes — derived from real xpubs via BIP32Factory + payments.p2wsh | ✓ FLOWING |
| `get_btc_multisig_balance.ts` | balanceResult | Esplora `fetchAddressInfo` fan-out | Yes — live HTTP to Esplora (stubbed in tests) | ✓ FLOWING |
| `get_btc_multisig_utxos.ts` | utxoList | Esplora `fetchAddressUtxos` fan-out | Yes — live HTTP to Esplora (stubbed in tests) | ✓ FLOWING |
| `sign_btc_multisig_psbt.ts` | payloadFingerprint | `computeBtcPayloadFingerprint` over PSBT sighashes | Yes — FROZEN module computes from real PSBT per-input preimages | ✓ FLOWING |
| `send_transaction.ts` | updatedPsbtBase64 | `_btcLedgerTransport.signBtcMultisigPsbt` | Yes (production); mocked in tests via spy-affordance | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase 25 test files all pass | `npx vitest run test/btc-multisig-store.test.ts test/btc-multisig-address-derivation.test.ts test/tools-register-btc-multisig-wallet.test.ts test/btc-multisig-combine.test.ts test/tools-combine-btc-psbts.test.ts test/btc-multisig-finalize.test.ts test/tools-sign-btc-multisig-psbt.test.ts test/tools-finalize-btc-psbt.test.ts test/signing-fingerprint.test.ts` | 9 files, 136 tests passed | ✓ PASS |
| Full suite green (no regressions) | `npx vitest run` | 232 files, 2951 passed, 1 skipped | ✓ PASS |
| Build clean (no type errors) | `npm run build` | `tsc` exits 0, no output | ✓ PASS |
| FROZEN modules untouched | `git diff origin/main -- src/signing/btc-fingerprint.ts src/signing/btc-sighash.ts` | empty diff | ✓ PASS |
| 0o600 registry file permission | `grep -c 'mode: 0o600' src/wallet/btc-multisig-store.ts` | 1 match | ✓ PASS |
| All 6 Phase 25 error codes present | `grep 'PSBT_COMBINE_CONFLICT\|PSBT_THRESHOLD_NOT_MET\|MULTISIG_WALLET_NOT_FOUND\|MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE\|LEDGER_BTC_APP_VERSION_TOO_OLD\|MULTISIG_DESCRIPTOR_INVALID' src/signing/error-codes.ts` | 6 codes in union | ✓ PASS |
| Fixture X hardcoded literal | `grep '0xced8fc41b79311a8f7130aac2a45e382d4a0a6591731f706a96726d7b3cf5414' test/signing-fingerprint.test.ts test/tools-sign-btc-multisig-psbt.test.ts` | 2 matches (anchor + re-anchor) | ✓ PASS |
| combine_btc_psbts is a direct transform | `grep 'createHandle\|payloadFingerprint' src/tools/combine_btc_psbts.ts` | no matches | ✓ PASS |
| finalize_btc_psbt is a direct transform | `grep 'createHandle\|payloadFingerprint' src/tools/finalize_btc_psbt.ts` | no matches | ✓ PASS |
| @ledgerhq/ledger-bitcoin in dependencies | `package.json` | `"^0.3.1"` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| BTC-PSBT-03 | 25-01 | `register_btc_multisig_wallet` — descriptor validation + 0o600 registry | ✓ SATISFIED | Tool exists, validates, persists at 0o600; 22 tests cover the tool |
| BTC-PSBT-04 | 25-01 | `get_btc_multisig_balance` + `get_btc_multisig_utxos` — Esplora balance/UTXO reads | ✓ SATISFIED | Both tools exist; gap-limit scan over derived P2WSH addresses via Esplora |
| BTC-PSBT-05 | 25-02 | `combine_btc_psbts` — co-signer PSBT merge with conflict detection | ✓ SATISFIED | `combineBtcPsbts` pre-scan fires before `Psbt.combine`; `PSBT_COMBINE_CONFLICT` returned on conflict; 23 tests |
| BTC-PSBT-06 | 25-03 | `sign_btc_multisig_psbt` — prepare→preview→send with multisig-psbt handle | ✓ SATISFIED | Full trust pipeline: createHandle + payloadFingerprint + PREPARE RECEIPT; preview shows co-signer status; send calls signBtcMultisigPsbt |
| BTC-PSBT-07 | 25-03 | `finalize_btc_psbt` — threshold-enforced PSBT finalizer | ✓ SATISFIED | `finalizeBtcPsbt` counts partialSig per input before `finalizeAllInputs()`; refuses with `PSBT_THRESHOLD_NOT_MET` |
| BTC-W-04 | 25-03 | Full combine/sign/finalize multisig lifecycle | ✓ SATISFIED | All 5 tools (register + balance + utxos + combine + sign + finalize) exist and are wired into register-all.ts; full signing pipeline functional |

### Anti-Patterns Found

| File | Finding | Severity | Status |
|------|---------|----------|--------|
| `src/tools/register_btc_multisig_wallet.ts` | Duplicate `VERIFY_ON_DEVICE_MULTISIG_TEMPLATE` (CR-01) | Blocker | Fixed — now imports from `blocks-btc.ts`; re-exports for test compatibility |
| `src/wallet/btc-multisig-store.ts` | Missing `threshold <= totalSigners` guard in `validateRecord` (WR-01) | Warning | Fixed — guard added at line 137 with warn log |
| `src/tools/sign_btc_multisig_psbt.ts` | Dead `descriptorTemplate` variable with `void` suppression (WR-02) | Warning | Fixed — entire block removed |
| `src/wallet/ledger-btc-transport.ts` | `WalletPolicy` shim fallback to namespace object (WR-03) | Warning | Fixed — three-path resolution with startup assertion in `registerBtcMultisigWallet`/`signBtcMultisigPsbt` |
| `src/protocols/btc-psbt.ts` | `combineBtcPsbts` no minimum-input guard (IN-01) | Info | Fixed — guard returns `{ kind: "error" }` for < 2 PSBTs |
| `src/tools/register_btc_multisig_wallet.ts` | Uninitialized `registrationNote` (IN-02) | Info | Fixed — initialized to `"Device registration status unknown."` |
| `src/tools/get_btc_multisig_balance.ts` | Gap-limit scan over-requests on final batch (IN-03) | Info | Skipped (not a correctness bug; at most 4 extra Esplora requests; aligned with review fix decision) |

All CR-01 and WR-01..03 findings verified fixed in codebase. All IN-01 and IN-02 fixed. IN-03 accepted as-is per code-review fix rationale.

### Human Verification Required

#### 1. On-Device Multisig Wallet Policy Registration

**Test:** Connect a Ledger device with Bitcoin app v2.1+. Run `register_btc_multisig_wallet` with a valid 2-of-3 descriptor and the device connected.
**Expected:** Ledger screen displays the wallet name and co-signer keys; user confirms; tool response includes `walletHmac` (32-byte hex); record persists with `walletHmac` in `~/.vaultpilot-mcp/btc-multisig.json`.
**Why human:** Physical Ledger device required for `AppClient.registerWallet` APDU. Automated tests mock `_btcLedgerTransport` via `vi.spyOn`.

#### 2. On-Device Multisig PSBT Signing

**Test:** Using the registered wallet (with `walletHmac`), run `sign_btc_multisig_psbt` with a real 2-of-3 PSBT, then `send_transaction` with the handle + previewToken.
**Expected:** Ledger screen shows inputs/outputs from the PSBT; user approves; `send_transaction` returns `{ updatedPsbtBase64, chain: "bitcoin", kind: "multisig-psbt" }` — NOT a broadcast txid.
**Why human:** Physical Ledger device required for `AppClient.signPsbt`. The `send_transaction` multisig path is fully wired (verified by automated tests) but the on-device screen display can only be confirmed with hardware.

#### 3. Finalized PSBT Mainnet Broadcast with Second Co-Signer

**Test:** With a real 2-of-3 multisig wallet, have a second co-signer sign, combine both PSBTs via `combine_btc_psbts`, then `finalize_btc_psbt`. Broadcast the `txHex`.
**Expected:** Transaction confirms on mainnet; `finalize_btc_psbt` returns `{ finalPsbtBase64, txHex }` with valid witness data.
**Why human:** Requires real BTC, a second cooperating physical signer, and actual network broadcast. The finalization logic is tested with synthetic PSBTs in automated tests.

#### 4. WalletPolicy Shim Production Verification (WR-03)

**Test:** Import `ledger-btc-transport.ts` in a live Node.js process with `@ledgerhq/ledger-bitcoin@0.3.1` installed, call `registerBtcMultisigWallet`.
**Expected:** `WalletPolicy` is resolved via the named import path without hitting the startup assertion. No `"WalletPolicy is not a constructor"` error.
**Why human:** The three-path shim fallback order is behavioral. Automated tests mock the transport before the constructor is invoked; the fix was verified by runtime probe at review but the production export shape of `@ledgerhq/ledger-bitcoin@0.3.1` should be confirmed on the target Node.js version.

---

## Summary

Phase 25 delivers a complete BTC M-of-N multisig PSBT workflow. All 13 must-have truths are verified in the codebase with substantive, wired implementations backed by 136 passing tests across 9 test files. The full suite of 232 test files and 2951 tests passes clean. The TypeScript build is error-free.

**Security properties verified:**
- Pre-combine conflict scan runs BEFORE `Psbt.combine()` — `bip174` silent-drop bypassed
- `finalize_btc_psbt` enforces M-of-N threshold before `finalizeAllInputs()` — `PSBT_THRESHOLD_NOT_MET` returned
- `sign_btc_multisig_psbt` refuses `MULTISIG_WALLET_NOT_REGISTERED_ON_DEVICE` when `walletHmac` absent — checked at both prepare and send time
- Registry file persists at `0o600` via atomic tempfile+rename
- FROZEN cryptographic-binding modules (`btc-fingerprint.ts`, `btc-sighash.ts`) are byte-identical to `origin/main`
- Fixture X hardcoded at `0xced8fc41b79311a8f7130aac2a45e382d4a0a6591731f706a96726d7b3cf5414` with cross-link re-anchor

**Code review findings (25-REVIEW.md):** All 6 fixable findings (CR-01, WR-01..03, IN-01, IN-02) confirmed fixed in codebase. IN-03 accepted as documented non-correctness issue.

**Requirements satisfied:** BTC-PSBT-03, BTC-PSBT-04, BTC-PSBT-05, BTC-PSBT-06, BTC-PSBT-07, BTC-W-04 — all verified.

**Status is `human_needed`** because on-device Ledger hardware verification (multisig wallet-policy registration on-screen, on-device PSBT signing confirmation, and mainnet broadcast with a second co-signer) cannot be exercised programmatically. This is consistent with the v2.2 deferred-verify-phase pattern documented in `25-VALIDATION.md`.

---

_Verified: 2026-05-22T22:30:00Z_
_Verifier: Claude (gsd-verifier)_
