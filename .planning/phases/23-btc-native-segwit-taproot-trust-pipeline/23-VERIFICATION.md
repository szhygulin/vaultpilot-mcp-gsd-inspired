---
phase: 23-btc-native-segwit-taproot-trust-pipeline
verified: 2026-05-22T17:30:00Z
status: human_needed
score: 7/7
overrides_applied: 0
human_verification:
  - test: "Run prepare_btc_send → preview_send → send_transaction with a real Ledger device over USB-HID + BTC app open, segwit-only PSBT (small mainnet amount)"
    expected: "LEDGER BLIND-SIGN HASH (BTC) per-input sighash bytes displayed in preview_send response match what the Ledger device shows in blind-sign mode; device signs; Esplora POST /tx returns a txid"
    why_human: "Cannot verify real USB-HID device interaction or Esplora mainnet broadcast programmatically"
  - test: "Run the same flow with a taproot-only PSBT (bc1p… recipient, taproot UTXO input)"
    expected: "Device signs the taproot input; BIP-341 sighash displayed matches device; broadcast accepted"
    why_human: "Real-device P2TR key-spend path through hw-app-btc signPsbtBuffer not exercisable without hardware"
  - test: "Run the same flow with a mixed segwit+taproot input set (both bc1q… and bc1p… UTXOs selected by BnB)"
    expected: "Two signPsbtBuffer passes fire (one per script type), partials are combined, device signs each input group, final tx broadcasts"
    why_human: "Two-pass Psbt.combine path requires real Ledger BTC app v2.1+ and mixed UTXO set on mainnet"
  - test: "Verify the on-device display for the change output shows 'change' not a recipient send"
    expected: "Ledger BTC app marks the derived change address as change (knownAddressDerivations populated with change address)"
    why_human: "Pitfall 6 mitigation (knownAddressDerivations) can only be confirmed visually on the device screen"
---

# Phase 23: BTC Native SegWit + Taproot Trust Pipeline — Verification Report

**Phase Goal:** Full prepare → preview → send flow works for native BTC sends. The BTC trust pipeline is structurally distinct — PSBT serialization replaces the EVM/Solana single-blob shape; payloadFingerprint is computed over the BIP-143 sighashes per input; the Ledger BTC app signs each input via the PSBT workflow. Native segwit (bc1q…) AND taproot (bc1p…) sends both work; mixed-script-type inputs supported.
**Verified:** 2026-05-22T17:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `prepare_btc_send({ to, sats, feeRate? })` returns the documented shape with per-input `payloadFingerprint` via BIP-143/341 sighashes domain-tagged `"VaultPilot-btctx-v1:"` | VERIFIED | `src/signing/btc-sighash.ts` implements `computeAllSighashes` with `hashForWitnessV0` (segwit) and `hashForWitnessV1` (taproot, whole-prevout-set). `src/signing/btc-fingerprint.ts` exports `computeBtcPayloadFingerprint` over concatenated sighashes. `src/tools/prepare_btc_send.ts` wires the full pipeline. `test/prepare-btc-send.test.ts` 14 tests pass including segwit, taproot, and mixed-input cases. |
| 2 | `preview_send` BTC branch recomputes per-input sighashes from the STORED canonical artifact (not a re-parsed PSBT), refuses on drift, emits decoded inputs/outputs + multi-hash LEDGER BLIND-SIGN HASH block | VERIFIED | `previewSendBtcBranch` at `src/tools/preview_send.ts:2083` reads `btcTx.perInputPrevouts` + `btcTx.unsignedTxHex` (not `psbtBase64`). Comment at line 2093: "Do NOT re-parse the PSBT — use unsignedTxHex + perInputPrevouts". `PAYLOAD_FINGERPRINT_DRIFT` refusal wired. `LEDGER_BLIND_SIGN_HASH_BTC_TEMPLATE` renders N rows via `INPUT_SIGHASH_ROW_BTC_TEMPLATE`. `test/preview-send.btc.test.ts` 9 tests pass. |
| 3 | `send_transaction` BTC branch enforces `previewToken` + `userDecision: "send"` + `payloadFingerprint` drift gate; FROZEN three-gate region byte-identical to `origin/main` | VERIFIED | `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/payload-fingerprint-solana.ts src/signing/payload-fingerprint-tron.ts src/signing/presign-hash.ts` returns zero diff. `send_transaction.ts` diff shows ONLY additive changes: the `"btc"` discriminator arm in the recompute ternary and a new `if (txType === "btc")` dispatch block BELOW the FROZEN region (~line 392). The three-gate structure (PREVIEW_REQUIRED, PREVIEW_TOKEN_MISMATCH, PAYLOAD_FINGERPRINT_DRIFT) is byte-identical. `test/send-transaction.btc.test.ts` T-16 zero-diff assertion included; 16 tests pass. |
| 4 | Native segwit (bc1q…) AND taproot (bc1p…) sends both work via the same `prepare_btc_send` tool | VERIFIED | `src/protocols/btc-psbt.ts:buildBtcPsbt` handles both `p2wpkh` (segwit, `bip32Derivation`) and `p2tr` (taproot, `tapInternalKey` + `tapBip32Derivation`). `src/wallet/ledger-btc-transport.ts:signBtcPsbt` dispatches to `signPsbtBuffer` with `addressFormat: "bech32"` for segwit and `"bech32m"` for taproot. Tests in `btc-psbt.test.ts` cover both script types; `prepare-btc-send.test.ts` covers both. |
| 5 | Mixed-script-type inputs supported: `signBtcPsbt` performs exactly TWO `signPsbtBuffer` passes for a mixed PSBT + `Psbt.combine` + `finalizeAllInputs` + `extractTransaction` | VERIFIED | `src/wallet/ledger-btc-transport.ts:310-431` implements two-pass split: partitions by `scriptType`, builds group PSBTs (clearing derivation on non-group inputs), calls `signPsbtBuffer` once per non-empty group, then `combined.combine(signedParts[i])` for each additional part, then per-input finalization. `test/ledger-btc-transport.test.ts` test at line 752 asserts `signPsbtBufferSpy.toHaveBeenCalledTimes(2)` for mixed inputs + correct `accountPath`/`addressFormat` per group. 32 tests pass. |
| 6 | Fixture O (segwit single-input), Fixture P (taproot single-input), Fixture Q (mixed 2-input) hardcoded as `0x…` literals in `test/signing-fingerprint.test.ts`; no `beforeAll`-snapshot | VERIFIED | `test/signing-fingerprint.test.ts` lines 388-573 contain: Fixture O `"0xb3af7f8e..."`, Fixture P `"0x01af3f91..."`, Fixture Q `"0xffa4a2f8..."`. No `beforeAll` in the Phase 23 blocks (confirmed by grep). Cross-linked in `prepare-btc-send.test.ts`. 22 tests in `signing-fingerprint.test.ts` pass. |
| 7 | SECURITY.md updated with BTC threat model section including PSBT trust shape, per-input sighash binding, two-pass signing seam, accepted residuals, and threat register table | VERIFIED | `SECURITY.md` lines 380-439 contain "Phase 23 — Bitcoin (BTC) Native SegWit + Taproot Trust Pipeline" with cross-chain layer comparison table, PSBT two-pass description, accepted residuals (Esplora endpoint trust, OQ-3 change-index race, v2.2 verify-phase pending), and `| Threat ID | STRIDE | Severity | Mitigation |` threat register table (T-23-13 through T-23-SC). |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/signing/btc-sighash.ts` | Per-input BIP-143/341 sighash compute; `computeAllSighashes`; `_btcSighash` spy-affordance | VERIFIED | Exports `computeAllSighashes`, `SighashInput`, `_btcSighash`. `hashForWitnessV0` (segwit) and `hashForWitnessV1` (taproot, whole-prevout-set) both present. `initEccLib` fired via side-effect import. |
| `src/signing/btc-fingerprint.ts` | Domain-tagged keccak256 fingerprint; `FINGERPRINT_DOMAIN_TAG_BTC`; `_btcFingerprint` | VERIFIED | Exports `FINGERPRINT_DOMAIN_TAG_BTC = "VaultPilot-btctx-v1:"`, `computeBtcPayloadFingerprint`, `_btcFingerprint`. Input guards for empty array and non-32-byte sighashes. |
| `src/signing/btc-coin-select.ts` | BnB + largest-first fallback; fee-rate sanity; dust asymmetry | VERIFIED | Exports `selectCoinsBnb`, `_btcCoinSelect`. BnB algorithm, largest-first fallback, `BnB_TOLERANCE`, per-script vbyte table with `[CITED]` comment. Fee-rate bounds (D-03). Dust asymmetry: recipient below dust → refused; change below dust → folded into fee (D-07). No `coinselect` dependency. |
| `src/protocols/btc-psbt.ts` | PSBT-v0 assembly; `buildBtcPsbt`; `decodeBtcPsbt`; RBF disabled; mixed-input | VERIFIED | Exports `buildBtcPsbt`, `decodeBtcPsbt`, `_btcPsbt`. `RBF_DISABLED_SEQUENCE = 0xfffffffe` on every input. `tapInternalKey` + `tapBip32Derivation` on taproot inputs. `decodeBtcPsbt` returns discriminated union, never throws. Returns `perInputPrevouts[]` for canonical artifact. |
| `src/chains/bitcoin/change-index.ts` | `nextChangeIndex` via chain-1 xpub scan; back-compatible `xpub-scan.ts` | VERIFIED | Exports `nextChangeIndex`, `_changeIndex`. `xpub-scan.ts` gains additive `chain: 0 | 1 = 0` parameter with `node.derive(chain)` at line 139. TTL cache key incorporates `chain`. Existing callers unaffected (default `0`). |
| `src/signing/blocks-btc.ts` | `PREPARE_RECEIPT_BTC_NATIVE_TEMPLATE`; `LEDGER_BLIND_SIGN_HASH_BTC_TEMPLATE`; `INPUT_SIGHASH_ROW_BTC_TEMPLATE` | VERIFIED | All three templates exported with slot substitution discipline. `INPUT_SIGHASH_ROW_BTC_TEMPLATE` enables N-row rendering for multi-input. Format-fanout-sentinel header names sibling blocks files. |
| `src/signing/handle-store.ts` | `PreparedTxBtc` union member; state machine FROZEN | VERIFIED | `PreparedTxBtc` interface added at line 537. `PreparedTx` union widened additively. Stores `unsignedTxHex` + `perInputPrevouts` as canonical artifact (not just `psbtBase64`). Only one line removed: old union type replaced with widened version. `createHandle`/`transitionTo*`/TTL logic byte-identical (zero removed lines in state machine). |
| `src/signing/error-codes.ts` | `BTC_DUST_OUTPUT`, `BTC_FEE_RATE_OUT_OF_BOUNDS`, `BTC_NO_UTXOS_AVAILABLE`, `BTC_MIXED_INPUT_SIGN_FAILURE` | VERIFIED | All four BTC-specific error codes present at lines 150-153. Existing codes untouched. |
| `src/tools/prepare_btc_send.ts` | `registerTool("prepare_btc_send")`; full pipeline; demo mode; PREPARE RECEIPT verbatim | VERIFIED | Calls `registerTool("prepare_btc_send")` at line 183. Pipeline wires `selectCoinsBnb` → `buildBtcPsbt` → `computeAllSighashes` → `computeBtcPayloadFingerprint` → `createHandle`. Demo mode reads `getActiveBtcPersona()`. Input validation fires before any state read. `txType: "btc"` in response. |
| `src/wallet/ledger-btc-transport.ts` | `signBtcPsbt` two-pass mixed-input signing; `_btcLedgerTransport` spy; `LedgerBtcAppNotOpenError` | VERIFIED | `signBtcPsbt` at line 310 implements two-pass partition by `scriptType`, per-group `buildGroupPsbt`, sequential `signPsbtBuffer` calls, `combined.combine(signedParts[i])`, per-input finalization, `extractTransaction().toHex()`. `_btcLedgerTransport` exports `signBtcPsbt`. `LedgerBtcAppNotOpenError` class. Transport `try/finally` close. |
| `src/chains/bitcoin/esplora-client.ts` | `broadcastTx` POST /tx never-throws discriminated union | VERIFIED | `broadcastTx` at line 593 returns `{ kind: "ok"; txid } | { kind: "rejected"; message } | { kind: "error"; message }`. AbortController timeout. Routes base URL via registry. Never throws. |
| `src/tools/register-all.ts` | `prepare_btc_send` side-effect import | VERIFIED | Line 39: `import "./prepare_btc_send.js"; // Phase 23 Plan 23-03 (BTC-PSBT-01)` |
| `SECURITY.md` | BTC threat model section with threat register table | VERIFIED | Lines 380-439. Includes PSBT trust shape, two-pass signing, three accepted residuals, `| Threat ID | STRIDE | Severity | Mitigation |` table. |
| `test/signing-fingerprint.test.ts` | Fixtures O, P, Q hardcoded literals; no beforeAll-snapshot | VERIFIED | Fixture O `0xb3af7f8e...` at line 419; Fixture P `0x01af3f91...` at line 520; Fixture Q `0xffa4a2f8...` at line 573. No `beforeAll` in Phase 23 blocks. |
| `test/btc-trust-pipeline.integration.test.ts` | Persona-cycle byte-identity both directions; segwit/taproot/mixed end-to-end | VERIFIED | 13 tests pass. Direction A: persona-distinct fingerprints (different UTXOs → different fingerprints). Direction B (T-08): same `{to,sats}` + same `utxoOverride` → byte-identical fingerprints. Covers segwit-only, taproot-only, mixed-input flows. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/signing/btc-fingerprint.ts` | `src/signing/btc-sighash.ts` | `computeBtcPayloadFingerprint` consumes `Uint8Array[]` from `computeAllSighashes` | WIRED | `btc-fingerprint.ts` imports from `btc-sighash.ts` indirectly via callers; the type contract (`readonly Uint8Array[]`) is the interface. Wired in `prepare_btc_send.ts` and both preview/send branches. |
| `src/tools/prepare_btc_send.ts` | `src/protocols/btc-psbt.ts` | `_btcPsbt.buildBtcPsbt` → `_btcSighash.computeAllSighashes` → `_btcFingerprint.computeBtcPayloadFingerprint` | WIRED | Confirmed by grep and code reading. All three calls present in the pipeline. |
| `src/tools/register-all.ts` | `src/tools/prepare_btc_send.ts` | Side-effect import at line 39 | WIRED | `import "./prepare_btc_send.js"` present. |
| `src/protocols/btc-psbt.ts` | `src/signing/btc-coin-select.ts` | `buildBtcPsbt` consumes `selectCoinsBnb` output | WIRED | Confirmed in `prepare_btc_send.ts` pipeline: `selectCoinsBnb` → `buildBtcPsbt`. |
| `src/chains/bitcoin/change-index.ts` | `src/chains/bitcoin/xpub-scan.ts` | `scanXpub` with `chain: 1` | WIRED | `change-index.ts` calls `scanXpub(..., { chain: 1 })`. `xpub-scan.ts` parameterized with `node.derive(chain)`. |
| `src/tools/send_transaction.ts` | `src/wallet/ledger-btc-transport.ts` | BTC dispatch arm calls `_btcLedgerTransport.signBtcPsbt` | WIRED | BTC dispatch arm at `send_transaction.ts:392` calls `sendTransactionBtcBranch` which invokes `_btcLedgerTransport.signBtcPsbt`. |
| `src/tools/send_transaction.ts` | `src/chains/bitcoin/esplora-client.ts` | BTC dispatch arm broadcasts via `broadcastTx` | WIRED | `esploraBroadcastTx` imported and called in `sendTransactionBtcBranch`. |
| `src/tools/preview_send.ts` | `src/signing/btc-fingerprint.ts` | BTC branch recomputes fingerprint from canonical artifact | WIRED | `previewSendBtcBranch` calls `_btcFingerprint.computeBtcPayloadFingerprint(perInputSighashes)` at line 2103. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `prepare_btc_send.ts` | `selectedInputs`, `psbtResult`, `perInputSighashes`, `payloadFingerprint` | `selectCoinsBnb` → `buildBtcPsbt` → `computeAllSighashes` → `computeBtcPayloadFingerprint` | Yes — real UTXO data from Esplora; real sighash math | FLOWING |
| `preview_send.ts` (BTC branch) | `perInputSighashes`, `recomputed` | `btcTx.perInputPrevouts` + `btcTx.unsignedTxHex` (stored canonical artifact from handle store) | Yes — reads from handle store, recomputes deterministically | FLOWING |
| `send_transaction.ts` (BTC arm) | `recomputed` | `(record.tx as PreparedTxBtc).unsignedTxHex` + `.perInputPrevouts` | Yes — reads from handle store | FLOWING |
| `ledger-btc-transport.ts` | `signedParts[]`, `rawTxHex` | `app.signPsbtBuffer(...)` (real USB-HID device APDU exchange) | Yes — real device signing | FLOWING (pending real-device verification) |

### Behavioral Spot-Checks

Step 7b skipped — no runnable entry points without a live Esplora endpoint and a real Ledger device. The full test suite (144 Phase 23 tests + 2786 total) validates all programmatically-testable behaviors.

### Probe Execution

Step 7c: No `probe-*.sh` files found in `scripts/`. Not applicable.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|-------------|-------------|--------|---------|
| BTC-PREP-01 | 23-01 | BTC `payloadFingerprint = keccak256("VaultPilot-btctx-v1:" ‖ concatenated BIP-143 sighashes)` | SATISFIED | `btc-fingerprint.ts` + `btc-sighash.ts` fully implement. Fixture O pinned. REQUIREMENTS.md checkbox `[ ]` is a documentation-only discrepancy — the code is complete. |
| BTC-PREP-02 | 23-04 | `preview_send` BTC branch with decoded blocks + multi-hash LEDGER BLIND-SIGN HASH | SATISFIED | `previewSendBtcBranch` in `preview_send.ts:2083`. 9 tests pass. |
| BTC-PREP-03 | 23-04 | `send_transaction` BTC branch with three-gate enforcement | SATISFIED | BTC arm in `send_transaction.ts` reuses FROZEN three-gate region. 16 tests pass. |
| BTC-PSBT-01 | 23-02, 23-03 | `prepare_btc_send` with BnB coin-selection, segwit+taproot support | SATISFIED | `btc-coin-select.ts` + `btc-psbt.ts` + `prepare_btc_send.ts`. 14 tests pass. |
| BTC-PSBT-02 | 23-02, 23-04 | Mixed-script-type inputs in single PSBT; two-pass signing | SATISFIED | `buildBtcPsbt` accepts mixed inputs (construction). `signBtcPsbt` two-pass split (signing). Test asserts exactly 2 `signPsbtBuffer` calls for mixed. |
| BTC-W-01 | 23-03 | `prepare_btc_send` produces canonical PSBT-based unsigned tx; segwit+taproot both supported | SATISFIED | Same as BTC-PSBT-01 evidence. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/signing/btc-fingerprint.ts` | Comment at line 41 | Doc says "21 UTF-8 bytes" for `FINGERPRINT_DOMAIN_TAG_BTC`; actual tag `"VaultPilot-btctx-v1:"` is 20 chars/bytes | Info | Documentation inconsistency only. Code and test both assert 20 bytes consistently. No functional impact — the keccak preimage is correct. |
| `REQUIREMENTS.md` | Line 255 | `BTC-PREP-01` checkbox shows `[ ]` (unchecked) despite full implementation in `btc-fingerprint.ts` and `btc-sighash.ts` | Info | Documentation-only gap. The 23-01-SUMMARY.md presumably marks it complete but REQUIREMENTS.md was not updated. |

No `TBD`, `FIXME`, or `XXX` markers found in any Phase 23 new or modified source files.

### Human Verification Required

The automated checks (144 tests, TypeScript clean, FROZEN region byte-identical, Fixtures O/P/Q pinned as literals) all pass. The following require real-device testing.

### 1. Segwit PSBT real-Ledger smoke

**Test:** Open BTC app on Ledger, run `prepare_btc_send` with a bc1q… recipient + small mainnet amount, follow with `preview_send`, compare the displayed per-input sighash against the `LEDGER BLIND-SIGN HASH (BTC)` block in the response, then `send_transaction`
**Expected:** Sighash bytes match on-device; device signs; Esplora returns a txid; `send_transaction` response includes the confirmed txid
**Why human:** USB-HID transport + real BTC app APDU exchange + Esplora broadcast cannot be exercised without hardware

### 2. Taproot PSBT real-Ledger smoke

**Test:** Same flow with a bc1p… recipient and a taproot UTXO input
**Expected:** P2TR key-spend signing path works via `signPsbtBuffer` with `accountPath: "m/86'/0'/0'"` and `addressFormat: "bech32m"`
**Why human:** Real Ledger BTC app v2.1+ P2TR support not exercisable without hardware

### 3. Mixed-input two-pass signing on real device

**Test:** Trigger `prepare_btc_send` with BnB selecting both segwit and taproot UTXOs (mixed inputs), follow through to `send_transaction`
**Expected:** Two `signPsbtBuffer` calls fire (one per script type), `Psbt.combine` succeeds, transaction broadcasts
**Why human:** Two-pass split behavior against real hw-app-btc v10 not exercisable without hardware; the device-visible mismatch if knownAddressDerivations is wrong can only be confirmed on-device

### 4. Change output recognized as "change" on device

**Test:** Include a change output in a BTC send, confirm on the Ledger device screen
**Expected:** Ledger BTC app displays change output as "change" (not as a recipient send)
**Why human:** Pitfall 6 mitigation (knownAddressDerivations populated with change address) can only be verified by reading the Ledger display; automated tests mock the transport

### Gaps Summary

No gaps — all 7 roadmap Success Criteria are VERIFIED in code. The `wallet-session-manager.test.ts` flake is pre-existing (Phase 23 makes zero changes to `session-manager.ts`; confirmed by `git diff origin/main -- src/wallet/session-manager.ts` returning empty). Four items require real-device human verification, elevating status to `human_needed`.

---

_Verified: 2026-05-22T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
