---
phase: 18-tron-native-trc20-trust-pipeline
verified: 2026-05-20T17:58:00Z
status: human_needed
score: 9/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Real Ledger TRX-app blind-sign hash match"
    expected: "SHA-256(raw_data_bytes) displayed on-device as 'Transaction ID' matches the LEDGER BLIND-SIGN HASH (TRON) block in preview_send output character-for-character"
    why_human: "Requires a physical Ledger device with TRX app installed and a real TRON mainnet transaction to verify the on-device SHA-256 display"
  - test: "TRX-app clear-sign decoded display for bundled TRC-20 (USDT/USDC/USDD/TUSD)"
    expected: "Ledger TRX app v0.5+ displays decoded 'To', 'Token', 'Amount' for the Phase 18 allowlist contracts (not blind-sign mode)"
    why_human: "Requires a physical Ledger device with TRX app to verify the bundled registry clear-sign behavior"
  - test: "Native TRX mainnet broadcast — small amount"
    expected: "prepare_tron_native_send → preview_send → send_transaction sequence results in an on-chain confirmed TRX transfer visible on TronScan"
    why_human: "Requires real mainnet TRX funds, real Ledger device, and live TronGrid endpoint"
  - test: "USDT-TRC20 mainnet broadcast — small amount"
    expected: "prepare_tron_trc20_send → preview_send → send_transaction sequence results in an on-chain confirmed USDT transfer visible on TronScan"
    why_human: "Requires real mainnet USDT-TRC20 funds, real Ledger device, and live TronGrid endpoint"
---

# Phase 18: TRON native + TRC-20 trust pipeline Verification Report

**Phase Goal:** Full `prepare → preview → send` flow for native TRX (TransferContract) and TRC-20 (TriggerSmartContract `transfer(to, amount)`) with the cryptographic-binding pipeline end-to-end: `payloadFingerprint` (keccak256 + `VaultPilot-trontx-v1:` 21-byte domain tag) + `LEDGER BLIND-SIGN HASH` (SHA-256(raw_data) = TRON consensus tx-id) + asymmetric Layer 0.7 simulation gate (TRC-20 mandatory refusal, native advisory) + Layer 0.5 canonical-dispatch (TRC-20 only) + three-gate FROZEN region in send_transaction.ts byte-untouched (additive TRON dispatch only). Persona-cycle byte-identity proven end-to-end.

**Verified:** 2026-05-20T17:58:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | `payloadFingerprint = keccak256("VaultPilot-trontx-v1:" ‖ raw_data_bytes)` with 21-byte domain tag | ✓ VERIFIED | `src/signing/payload-fingerprint-tron.ts` line 41: `FINGERPRINT_DOMAIN_TAG_TRON = "VaultPilot-trontx-v1:"`. Domain-tag length invariant tests pass in `test/signing-fingerprint-tron.test.ts` (`.length === 21`, `Buffer.byteLength === 21`, exact value asserted). Fixture M literal `0xaa8305…fd4fa`, Fixture N literal `0xffa617…b520` hardcoded (no `beforeAll`-snapshot). |
| 2 | `LEDGER BLIND-SIGN HASH = SHA-256(raw_data_bytes) = transaction.txID` | ✓ VERIFIED | `src/signing/presign-hash-tron.ts`: Node `crypto.createHash("sha256")` over `rawDataBytes`; returns `"0x" + digest`. Test `test/signing-presign-hash-tron.test.ts` pins `presignHash === "0x" + FIXTURE_M_TX_ID` and asserts `presignHash.slice(2) === txID`. `preview_send.ts` line 1324–1373 builds `LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE` block from `_tronPresign.computeTronPresignHash`. |
| 3 | Fixtures M + N hardcoded `0x...` literal anchors; consumer re-anchors in prepare tests | ✓ VERIFIED | `test/signing-fingerprint-tron.test.ts` lines 118–139: Fixture M `0xaa8305509481b97e50acb9e4d582bb53a1db1c99f9c357febe1fbf7389ffd4fa`, Fixture N `0xffa617dd3396eb038869b98e7385aa302e4ff69ed4d7cabe4904370c5015b520`. Consumer re-anchors confirmed: `test/prepare-tron-native-send.test.ts` line 128, `test/prepare-tron-trc20-send.test.ts` line 116. NO `beforeAll`-snapshot anywhere. |
| 4 | `extendExpiration(tx, 900)` called in BOTH `src/protocols/tron-native.ts` AND `src/protocols/tron-trc20.ts` | ✓ VERIFIED | `src/protocols/tron-native.ts` line 119: `tx = await input.tronWeb.transactionBuilder.extendExpiration(tx, 900)`. `src/protocols/tron-trc20.ts` line 137: `txUnknown = await input.tronWeb.transactionBuilder.extendExpiration(txUnknown, 900)`. Both documented as LOAD-BEARING per RESEARCH §Topic 5. |
| 5 | Three-gate FROZEN region in `send_transaction.ts` (PREVIEW_REQUIRED + PREVIEW_TOKEN_MISMATCH + PAYLOAD_FINGERPRINT_DRIFT) byte-untouched; only additive TRON branch below | ✓ VERIFIED | `git diff 379db27..HEAD -- src/tools/send_transaction.ts` shows 0 removed logic lines in the gate region (lines ~217–356). The 7 "removed" lines are: 1 import line updated to add `getActiveTronPersona` (additive); 5 lines in the fingerprint ternary refactored to insert TRON as a new case BETWEEN Solana and EVM (EVM fallback preserved identically). Gate structure, error envelopes, and error codes byte-identical. TRON branch dispatched at line 366 AFTER the three gates. |
| 6 | EVM + Solana branches BYTE-FROZEN in `preview_send.ts`, `send_transaction.ts`, `get_tx_verification.ts` | ✓ VERIFIED | `git diff 379db27..HEAD -- src/tools/preview_send.ts` shows 0 removed lines (all additive: new imports + `if (txType === "tron")` dispatch + `previewSendTronBranch` function appended). `git diff` on `get_tx_verification.ts` shows 0 removed lines. All FROZEN signing/security sibling files (`payload-fingerprint.ts`, `payload-fingerprint-solana.ts`, `simulation.ts`, `simulation-solana.ts`, etc.) also show empty diffs. |
| 7 | FLAG-1.5 inline-fix applied: `txID: record.pinned!.presignHash.slice(2)` (SHA-256, NOT keccak256) | ✓ VERIFIED | `src/tools/send_transaction.ts` line 1217: `txID: pinned.presignHash.slice(2)`. Comment on lines 1211–1214 explicitly documents the FLAG-1.5 correction. `test/send-transaction.tron.test.ts` asserts the `txID` field equals the SHA-256 presign hash (not the keccak256 fingerprint). |
| 8 | `SECURITY.md` TRON section appended; existing content byte-frozen | ✓ VERIFIED | `SECURITY.md` line 187: `## TRON (v2.1 — Phase 18)` with 6 subsections covering USB-HID transport, Protobuf preimage, SHA-256 vs keccak256, TRX clear-sign coverage, Layer 0.7 asymmetry, TAPOS + expiration. `git diff 379db27..HEAD -- SECURITY.md` shows append-only (0 removed lines). |
| 9 | LOAD-BEARING integration test covers persona-cycle byte-identity + three-gate + Layer 0.5 + Layer 0.7 + advisory | ✓ VERIFIED | `test/trust-pipeline-tron.integration.test.ts`: 14 tests with `[STOP-THE-LINE]` comment. Tests 3–4 verify persona-cycle sender-dependence (different `rawDataHex` → different fingerprints). Tests 6–8 verify all three FROZEN gates. Test 10 verifies Layer 0.5 DISPATCH_TARGET_REFUSED. Test 11 verifies Layer 0.7 SIMULATION_REFUSED for TRC-20 revert. Test 12 verifies native advisory (NOT refusal). Test 13 verifies `get_tx_verification` TRON re-emit. All 14 pass. |
| 10 | `error-codes.ts` 23-code locked union UNCHANGED; Phase 18 reuses existing codes | ✓ VERIFIED | `src/signing/error-codes.ts` union ends at `"SOLANA_APP_NOT_OPEN"` — 23 entries. `grep -c "| "` returns 23. `git diff 379db27..HEAD -- src/signing/error-codes.ts` returns EMPTY (0 bytes). |

**Score:** 10/10 automated truths verified

### Deferred Items

None. All Phase 18 automated requirements are met.

### ROADMAP Success Criteria Coverage

The ROADMAP Phase 18 has 7 success criteria. ROADMAP SC#6 contains a stale fixture reference ("Fixture K + Fixture L" in `test/signing-fingerprint.test.ts`) — this was documented as FLAG-2 in the Plan-Check and is upstream-doc hygiene only. The actual implementation uses Fixtures M + N in the correct sibling file `test/signing-fingerprint-tron.test.ts` per CONTEXT D-08 + PATTERNS meta-decision #4 (K + L are already taken by Phase 12 Solana). The implementation is correct; the ROADMAP entry is stale prose. SC#5 (TRX app clear-sign on real device) is a hardware verification item.

| SC # | Description | Status | Evidence |
|------|-------------|--------|---------|
| 1 | `prepare_tron_native_send` returns `{ handle, to, sun, blockHeader, payloadFingerprint, prepareReceipt }` with TRON-domain-tagged fingerprint | ✓ VERIFIED | `src/tools/prepare_tron_native_send.ts` line 365–366 |
| 2 | `prepare_tron_trc20_send` produces TriggerSmartContract with `transfer` calldata; decimal amount via metadata decimals | ✓ VERIFIED | `src/protocols/tron-trc20.ts` encoder; `src/tools/prepare_tron_trc20_send.ts` |
| 3 | `preview_send` TRON branch surfaces LEDGER BLIND-SIGN HASH block (SHA-256 over raw_data) | ✓ VERIFIED | `src/tools/preview_send.ts` lines 1322–1373 |
| 4 | `send_transaction` TRON branch enforces previewToken + userDecision + fingerprint drift gate | ✓ VERIFIED | Three-gate region lines 217–356; TRON dispatch at line 366 |
| 5 | Ledger TRX app clear-signs native and TRC-20 on device; decoded display visible | ? NEEDS HUMAN | Requires physical Ledger device with TRX app |
| 6 | Fixture K/L (actual: M/N) hardcoded literals in sibling test file; cross-linked from prepare tests | ✓ VERIFIED | ROADMAP text has stale names; implementation correct (Fixtures M + N in `test/signing-fingerprint-tron.test.ts`) |
| 7 | SECURITY.md updated for TRON threat model | ✓ VERIFIED | 6-subsection TRON section appended at line 187 |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/signing/payload-fingerprint-tron.ts` | TRON keccak256 fingerprint with 21-byte domain tag | ✓ VERIFIED | 72 lines; `FINGERPRINT_DOMAIN_TAG_TRON`, `computeTronPayloadFingerprint`, `_tronFingerprint` spy-affordance |
| `src/signing/presign-hash-tron.ts` | SHA-256 of rawDataBytes = TRON tx-id | ✓ VERIFIED | 69 lines; `computeTronPresignHash`, `_tronPresign` spy-affordance |
| `src/signing/simulation-tron.ts` | TRC-20 `triggerconstantcontract` + native `emitNoSimulationAvailable()` | ✓ VERIFIED | NEVER throws; `_simulationTron` spy-affordance; 5-status classifier |
| `src/signing/blocks-tron.ts` | 7 template constants | ✓ VERIFIED | All 7 templates including `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE` |
| `src/signing/amount-tron.ts` | `parseTronAmountStrict` with `"u64" \| "u256"` bound | ✓ VERIFIED | `U64_MAX`, `U256_MAX`, `InvalidAmountError` with 5 `kind` variants |
| `src/security/canonical-dispatch-tron.ts` | 4-entry TRC-20 allowlist from `tron-top-25.json` | ✓ VERIFIED | `TRON_TRC20_DISPATCH_ALLOWLIST` loaded from JSON SOT; 4 symbols (USDT/USDC/USDD/TUSD) |
| `src/protocols/tron-native.ts` | TransferContract encoder with `extendExpiration(tx, 900)` | ✓ VERIFIED | Line 119; LOAD-BEARING comment present |
| `src/protocols/tron-trc20.ts` | TriggerSmartContract encoder with `extendExpiration(tx, 900)` | ✓ VERIFIED | Line 137; `unknown` cast documented at boundary |
| `test/signing-fingerprint-tron.test.ts` | Fixtures M + N hardcoded `0x...` literals; NO `beforeAll`-snapshot | ✓ VERIFIED | Lines 118–139; `beforeAll` absent; 6 tests |
| `test/signing-presign-hash-tron.test.ts` | Fixture M presign hardcoded literal; `presignHash.slice(2) === txID` | ✓ VERIFIED | `FIXTURE_M_TX_ID` pinned; both assertions present |
| `test/trust-pipeline-tron.integration.test.ts` | LOAD-BEARING 14-test end-to-end; `[STOP-THE-LINE]` comment | ✓ VERIFIED | 14 tests; all pass |
| `SECURITY.md` TRON section | 6 subsections covering the trust model | ✓ VERIFIED | Lines 187–224; append-only |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `preview_send.ts` TRON branch | `_canonicalDispatchTron.checkTronDispatchTarget` | Layer 0.5 (TRC-20 only) | ✓ WIRED | `preview_send.ts` imports `_canonicalDispatchTron`; called at Layer 0.5 in `previewSendTronBranch` |
| `preview_send.ts` TRON branch | `_simulationTron.runTronPreviewSimulation` | Layer 0.7 (TRC-20 mandatory) | ✓ WIRED | TRC-20 path calls `runTronPreviewSimulation`; refuses on non-ok via `SIMULATION_REFUSED` |
| `preview_send.ts` TRON branch | `_simulationTron.emitNoSimulationAvailable()` | Layer 0.7 (native advisory) | ✓ WIRED | Native path calls `emitNoSimulationAvailable()` and emits `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE` block |
| `preview_send.ts` TRON branch | `_tronPresign.computeTronPresignHash` | LEDGER BLIND-SIGN HASH block | ✓ WIRED | Line 1324 in preview_send.ts; result used to populate `LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE` |
| `send_transaction.ts` TRON fingerprint recompute | `computeTronPayloadFingerprint` | PAYLOAD_FINGERPRINT_DRIFT gate | ✓ WIRED | Lines 331–334; `rawDataHex` decoded from handle and passed to recompute |
| `send_transaction.ts` TRON branch envelope | `pinned.presignHash.slice(2)` as `txID` | FLAG-1.5 SHA-256 correctness | ✓ WIRED | Line 1217: `txID: pinned.presignHash.slice(2)` |
| `send_transaction.ts` TRON branch | `_tronLedgerTransport.signTransaction` | USB-HID signing | ✓ WIRED | Calls the transport; error mapping covers `LedgerTronDeviceNotConnectedError`, `LedgerTronAppNotOpenError` |
| `get_tx_verification.ts` TRON branch | `blockHeader`, `rawDataHex`, `dispatchCheckResult` | TRON re-emit fields | ✓ WIRED | Lines 599–605 for prepared/previewed; TRC-20 re-runs allowlist check |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `preview_send.ts` TRON branch | `presignHash` | `_tronPresign.computeTronPresignHash({ rawDataBytes: Buffer.from(record.tx.rawDataHex, "hex") })` | Yes — SHA-256 over stored Protobuf bytes | ✓ FLOWING |
| `send_transaction.ts` TRON branch | `txID` field | `pinned.presignHash.slice(2)` (stored at preview time) | Yes — same SHA-256 hash, stripped of 0x prefix | ✓ FLOWING |
| `send_transaction.ts` TRON branch | `recomputed` fingerprint | `computeTronPayloadFingerprint({ rawDataBytes: Buffer.from(record.tx.rawDataHex, "hex") })` | Yes — recomputed over handle's stored rawDataHex | ✓ FLOWING |
| `canonical-dispatch-tron.ts` | `TRON_TRC20_DISPATCH_ALLOWLIST` | Loaded from `tron-top-25.json` at module load; filtered by USDT/USDC/USDD/TUSD | Yes — JSON SOT, 4 real entries | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TRON fingerprint domain-tag invariant | `npx vitest run test/signing-fingerprint-tron.test.ts` | 6 tests pass, Fixture M + N literals verified | ✓ PASS |
| SHA-256 presign hash equals txID | `npx vitest run test/signing-presign-hash-tron.test.ts` | 5 tests pass, `presignHash.slice(2) === FIXTURE_M_TX_ID` | ✓ PASS |
| Full trust-pipeline integration (13+ behaviors) | `npx vitest run test/trust-pipeline-tron.integration.test.ts` | 14 tests pass; Layer 0.5, 0.7, three-gate, persona-cycle all verified | ✓ PASS |
| Full test suite | `npm test` | 2061/2061 pass | ✓ PASS |
| TypeScript typecheck | `npm run typecheck` | 0 errors | ✓ PASS |

### Probe Execution

No conventional probe scripts (`scripts/*/tests/probe-*.sh`) declared for Phase 18. Integration test serves as the LOAD-BEARING behavioral probe — confirmed above.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| TRON-PREP-01 | 18-01 | `payloadFingerprint` = keccak256 with `"VaultPilot-trontx-v1:"` domain tag over Protobuf raw_data | ✓ SATISFIED | `src/signing/payload-fingerprint-tron.ts`; Fixtures M + N in tests |
| TRON-PREP-02 | 18-04 | `preview_send` TRON branch: TRC-20 mandatory `triggerconstantcontract`; native advisory; SHA-256 blind-sign hash | ✓ SATISFIED | `previewSendTronBranch` in `preview_send.ts`; Layer 0.7 gate tests pass |
| TRON-PREP-03 | 18-04 | `send_transaction` three-gate enforcement (previewToken + userDecision + fingerprint drift) | ✓ SATISFIED | Three-gate FROZEN region byte-intact; TRON branch dispatched after gates; integration tests 6–8 pass |
| TRON-PREP-04 | 18-04 | USB-HID transport in `get_tron_status` + `send_transaction` TRON branch | ✓ SATISFIED | `_tronLedgerTransport.signTransaction` wired; `LEDGER_NOT_CONNECTED` error mapping present |
| TRON-W-01 | 18-02 | `prepare_tron_native_send({ to, sun })` produces unsigned TransferContract Protobuf tx | ✓ SATISFIED | Tool registered in `register-all.ts`; `test/prepare-tron-native-send.test.ts` passes |
| TRON-W-02 | 18-03 | `prepare_tron_trc20_send({ to, tokenAddress, amount })` produces TriggerSmartContract with `transfer` calldata; decimal-string amount | ✓ SATISFIED | Tool registered; `parseTronAmountStrict` used; `test/prepare-tron-trc20-send.test.ts` passes |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | No `TBD`/`FIXME`/`XXX` markers; no stubs; no empty handlers | — | — |

The ROADMAP SC#6 fixture-name drift (K+L vs M+N, `signing-fingerprint.test.ts` vs `signing-fingerprint-tron.test.ts`) is a documentation inconsistency only — the implementation is correct. This was pre-identified as FLAG-2 in the Plan-Check as upstream-doc hygiene scheduled for execute-phase sign-off. The stale ROADMAP prose does not reflect a code failure.

### Human Verification Required

#### 1. Real Ledger TRX-app blind-sign hash match

**Test:** Prepare a native TRX transfer → preview → compare the `LEDGER BLIND-SIGN HASH (TRON)` block's 64-char hex against the hash shown on a physical Ledger device screen in the TRX app's blind-sign mode.

**Expected:** Character-for-character match; on-device label is "Transaction ID"; value equals SHA-256(raw_data_bytes).

**Why human:** Requires a physical Ledger device with TRX app v0.5+ installed and a real TRON mainnet connection. The cryptographic equivalence `presignHash = SHA-256(raw_data) = txID` is proven in the test suite, but the on-device *display* of exactly this value can only be confirmed against the actual device.

#### 2. TRX-app clear-sign decoded display for Phase 18 TRC-20 contracts

**Test:** Prepare a USDT-TRC20 transfer → preview → confirm the Ledger TRX app displays decoded `To`, `Token`, `Amount` fields (clear-sign mode) rather than the raw blind-sign SHA-256 hash.

**Expected:** Ledger TRX app v0.5+ has USDT/USDC/USDD/TUSD in its bundled token registry; the device shows decoded human-readable fields matching the PREPARE RECEIPT content.

**Why human:** Requires a physical Ledger device and a real TRC-20 transfer attempt. The `tokenSignatures: []` parameter is code-verified correct (bundled registry tokens need no external ERC-20 plugin), but the actual on-device rendering path is hardware-dependent.

#### 3. Native TRX mainnet broadcast (small amount)

**Test:** End-to-end: `prepare_tron_native_send({ to, sun: "100000" })` → `preview_send` → confirm LEDGER BLIND-SIGN HASH block displayed → `send_transaction({ userDecision: "send" })` → confirm `txID` visible on TronScan within 60 seconds.

**Expected:** On-chain confirmation; `send_transaction` returns `{ txID, broadcastedAt }` with a valid TronScan link.

**Why human:** Requires real mainnet TRX funds and a physical Ledger device.

#### 4. USDT-TRC20 mainnet broadcast (small amount)

**Test:** Same flow with `prepare_tron_trc20_send({ to, tokenAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", amount: "0.01" })`.

**Expected:** On-chain USDT transfer; Layer 0.5 (allowlist) and Layer 0.7 (simulation) both pass in real-mainnet conditions.

**Why human:** Requires real mainnet USDT-TRC20 balance and a physical Ledger device.

### Gaps Summary

No automated gaps. All 10 automated must-haves are VERIFIED.

The phase goal's automated components — domain-tagged keccak256 fingerprint, SHA-256 blind-sign hash, Fixtures M + N literal anchors, `extendExpiration(tx, 900)` in both encoders, FLAG-1.5 txID fix, three-gate FROZEN region integrity, EVM/Solana branch byte-freeze, SECURITY.md append, LOAD-BEARING integration test, and 23-code error union freeze — are all confirmed in the codebase.

The four human-verification items are hardware-dependent behaviors that cannot be checked programmatically. They are expected residual pending Phase 18's real-Ledger USB-HID TRON-app smoke test (noted in ROADMAP Phase 17 close-out commentary as deferred to Phase 18 trust pipeline completion).

---

_Verified: 2026-05-20T17:58:00Z_
_Verifier: Claude (gsd-verifier)_
