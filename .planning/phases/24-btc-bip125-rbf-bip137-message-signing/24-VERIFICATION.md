---
phase: 24-btc-bip125-rbf-bip137-message-signing
verified: 2026-05-22T20:10:00Z
status: human_needed
score: 10/11 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Connect a Ledger hardware wallet with BTC app open. Call sign_message_btc({ wallet: '<your segwit address>', message: 'Hello VaultPilot' }). Observe the device screen."
    expected: "The BTC app displays the literal message text 'Hello VaultPilot' character-for-character on the device screen in blind-sign mode before the user confirms. The returned signatureBase64 is 65 bytes, base64-encoded, with header byte 39 or 40."
    why_human: "Requires physical Ledger device over USB-HID. Cannot verify APDU display behavior programmatically. This is ROADMAP SC#5."
  - test: "Prepare a real mempool-pending BTC transaction with signalRbf: true via prepare_btc_send. Wait for it to appear in the mempool (e.g., via Esplora). Then call prepare_btc_rbf_bump({ txid: <txid>, newFeeRate: <higher rate> }) and broadcast via send_transaction. Observe mempool."
    expected: "The replacement transaction replaces the original in the mempool (original disappears, replacement appears with the higher fee rate). The Ledger screen shows the replacement's outputs matching the original recipients + reduced change."
    why_human: "Requires a live mempool, real funds (or testnet), and broadcast capability. Cannot simulate mempool replacement programmatically."
---

# Phase 24: BTC BIP-125 RBF + BIP-137 Message Signing — Verification Report

**Phase Goal:** User can bump fees on confirmed-pending BTC transactions via BIP-125 RBF, and sign arbitrary messages with their BTC keys per BIP-137 (canonical signature shape for wallet ownership proof).
**Verified:** 2026-05-22T20:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `prepare_btc_rbf_bump({ txid, newFeeRate })` produces an unsigned RBF replacement PSBT handle for mempool-pending RBF-signalling transactions | VERIFIED | `src/tools/prepare_btc_rbf_bump.ts` (767 lines): full pipeline from fetchBtcTx → buildBtcPsbt(sequenceOverride: 0xfffffffd) → computeAllSighashes → computeBtcPayloadFingerprint → createHandle(kind:"rbf"). Test suite 25/25 PASS. |
| 2 | `prepare_btc_rbf_bump` refuses confirmed transactions, non-RBF-signalling transactions, and fee rates that do not exceed the original by at least 1 sat/vB, each with a distinct structured error code | VERIFIED | 5 error codes confirmed in `src/signing/error-codes.ts` lines 182–186: `BTC_TX_ALREADY_CONFIRMED`, `BTC_NOT_RBF_SIGNALLED`, `BTC_RBF_INSUFFICIENT_FEE_RATE`, `BTC_RBF_NO_CHANGE_OUTPUT`, `BTC_RBF_CANNOT_AFFORD`. All 5 refusal paths have passing tests. |
| 3 | The RBF replacement preserves the original tx's exact input set (BIP-125 Rule 2 — strict-same-inputs) and refuses multi-recipient originals with a structured error | VERIFIED | CR-01 fix applied: `recipientVouts.length > 1` guard at line 540 returns `INVALID_INPUT`. BIP-125 Rule 2 test at line 600 asserts input txid/vout set equality. |
| 4 | `prepare_btc_send` accepts `signalRbf?: boolean` (default false); default-false path byte-identical to Phase 23 (Fixtures O/P/Q unchanged) | VERIFIED | `src/tools/prepare_btc_send.ts` line 171: `signalRbf` schema slot; line 209: `rawSignalRbf === true ? 0xfffffffd : undefined`. test/prepare-btc-send.test.ts 14/14 PASS; Fixtures O/P/Q pass in test/signing-fingerprint.test.ts. |
| 5 | The RBF replacement PSBT flows through `preview_send` and `send_transaction` via the `kind: "rbf"` handle arm | VERIFIED | `src/tools/preview_send.ts` line 2108: `rerunTool` branch; line 2165: `if (btcTx.kind === "rbf")` arm using `PREPARE_RECEIPT_BTC_RBF_TEMPLATE`. `src/tools/send_transaction.ts` line 1602: `originalTxid` spread for rbf. test/preview-send.test.ts 19/19 PASS. |
| 6 | The PREPARE RECEIPT for an RBF bump surfaces old fee rate, new fee rate, original fee sats, new fee sats, and the absolute sats delta; delta uses actual PSBT fee (not rate estimate) | VERIFIED | CR-02 fix applied: `const feeDeltaSats = psbtResult.feeSats - originalFeeSats` at line 705. Template slots `{ORIGINAL_TXID}`, `{NEW_FEE_RATE}`, `{ORIGINAL_FEE_SATS}`, `{ORIGINAL_FEE_RATE}`, `{NEW_FEE_SATS}`, `{FEE_DELTA_SATS}` confirmed in `src/signing/blocks-btc.ts` lines 141–160. CR-02 regression test at line 747 passes. |
| 7 | `sign_message_btc({ wallet, message })` produces a BIP-137 compact signature (base64, 65 bytes) over the segwit address via the Ledger BTC app | VERIFIED | `src/tools/sign_message_btc.ts` (441 lines): header = v + 39, sig65 assembly, base64 encoding. test/tools-sign-message-btc.test.ts 14/14 PASS. Fixture W `0xca329bc5...` pinned as hardcoded literal (no beforeAll-snapshot). |
| 8 | The server computes the BIP-137 double-SHA256 message hash and surfaces it in a LEDGER BLIND-SIGN HASH block alongside the message text | VERIFIED | `computeBip137MessageHash` at line 120 in sign_message_btc.ts. `LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE` with `{MESSAGE_TEXT}` and `{MESSAGE_HASH}` slots at `src/signing/blocks-btc.ts` line 190. Response includes `messageHash` field. |
| 9 | `sign_message_btc` passes only the raw message bytes to the device — the Ledger BTC app applies the magic prefix internally (no double-prefix) | VERIFIED | `messageHex = Buffer.from(message, "utf8").toString("hex")` at line 356 in sign_message_btc.ts. Test in tools-sign-message-btc.test.ts asserts no `"Bitcoin Signed Message:\n"` substring in the hex passed to the spy. `app.signMessage(path, messageHex)` uses positional args (line 503 in ledger-btc-transport.ts). |
| 10 | The 65-byte compact signature header byte is v + 39 (P2WPKH bech32 base) per BIP-137; demo mode and unpaired-account paths refuse with structured errors | VERIFIED | `const header = v + 39` at line 148. `DEMO_MODE_REFUSED` at line 295, `WALLET_NOT_PAIRED` at line 313, `INVALID_INPUT` for unmatched wallet at line 217. Fixture W BIP-137 test 9/9 PASS. |
| 11 | Ledger BTC app clear-signs message text on-device (SC#5); RBF broadcast replaces original in a live mempool | UNCERTAIN (human needed) | Requires physical Ledger hardware + live mempool. The server-side pipeline is fully wired and verified; on-device display behavior cannot be verified programmatically. |

**Score:** 10/11 truths verified (1 requires human hardware testing)

### Deferred Items

None — all Phase 24 scope items are implemented. BIP-322 taproot message signing is explicitly out-of-scope (deferred to a future `sign_message_btc_bip322` tool per CONTEXT.md and ROADMAP.md).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/tools/prepare_btc_rbf_bump.ts` | prepare_btc_rbf_bump MCP tool (min 200 lines) | VERIFIED | 767 lines; full trust pipeline; createHandle(kind:"rbf") |
| `src/chains/bitcoin/esplora-client.ts` | fetchBtcTx — GET /tx/{txid} | VERIFIED | Line 667: exported; 5-arm union; NO caching (comment + implementation confirmed) |
| `src/protocols/btc-psbt.ts` | buildBtcPsbt with sequenceOverride? param | VERIFIED | Lines 95, 199, 217: `sequenceOverride` in BtcPsbtArgs and both addInput sites |
| `test/signing-fingerprint.test.ts` | Fixture V — RBF fingerprint hardcoded literal | VERIFIED | Line 631: `0x946eeae4f39317444201821a47bdd0819bffc155925e5b855d22d04a2e1cfefc`; no beforeAll-snapshot; annotated Phase 24/Plan 24-01 |
| `test/tools-prepare-btc-rbf-bump.test.ts` | BTC-W-02 unit coverage (min 100 lines) | VERIFIED | 876 lines; 25 tests; all refusal cases, fee math, PREPARE RECEIPT diff, CR-01/CR-02/WR-01/WR-02/WR-03/WR-04 regression tests |
| `src/tools/sign_message_btc.ts` | sign_message_btc MCP tool (min 150 lines) | VERIFIED | 441 lines; no handle created; direct-sign pattern |
| `src/wallet/ledger-btc-transport.ts` | signBtcMessage in _btcLedgerTransport spy-affordance | VERIFIED | Line 483: exported function; line 545–549: in _btcLedgerTransport object; positional args |
| `test/signing-bip137.test.ts` | Fixture W — BIP-137 message hash hardcoded literal | VERIFIED | Line 104: `0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e`; annotated as double-SHA256, not keccak256; no beforeAll-snapshot |
| `test/tools-sign-message-btc.test.ts` | BTC-W-03 tool-level coverage (min 80 lines) | VERIFIED | 383 lines; 14 tests; demo refusal, pairing check, response shape, base64 sig |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `prepare_btc_rbf_bump.ts` | `esplora-client.ts` | `fetchBtcTx(txid)` | WIRED | Line 35: import; used in handler body |
| `prepare_btc_rbf_bump.ts` | `btc-psbt.ts` | `_btcPsbt.buildBtcPsbt({ sequenceOverride: 0xfffffffd })` | WIRED | Line 604: `sequenceOverride: RBF_ENABLED_SEQUENCE` |
| `prepare_btc_rbf_bump.ts` | `handle-store.ts` | `createHandle` with `kind: "rbf"` | WIRED | Line 652: `kind: "rbf"` in PreparedTxBtc; line 676: `createHandle(...)` |
| `sign_message_btc.ts` | `ledger-btc-transport.ts` | `_btcLedgerTransport.signBtcMessage(path, messageHex)` | WIRED | Line 52: import; line 357: call with positional args |
| `sign_message_btc.ts` | `blocks-btc.ts` | `LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE` | WIRED | Line 44: import; used in response assembly |
| `sign_message_btc.ts` | `non-evm-account-store.ts` | `listAccounts({ chainFilter: "bitcoin" })` | WIRED | Line 51: import; line 307: `listAccounts(...)` call |
| `src/tools/register-all.ts` | `prepare_btc_rbf_bump.ts` | side-effect import | WIRED | Line 40: `import "./prepare_btc_rbf_bump.js"` |
| `src/tools/register-all.ts` | `sign_message_btc.ts` | side-effect import | WIRED | Line 41: `import "./sign_message_btc.js"` |
| `preview_send.ts` | `blocks-btc.ts` | `PREPARE_RECEIPT_BTC_RBF_TEMPLATE` for `kind: "rbf"` arm | WIRED | Line 106: import; line 2165: `if (btcTx.kind === "rbf")` → template substitution |
| `send_transaction.ts` | `handle-store.ts` | `originalTxid` in RBF success response | WIRED | Line 1602: `...(btcTx.kind === "rbf" ? { originalTxid: btcTx.originalTxid } : {})` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `prepare_btc_rbf_bump.ts` | `txData` (Esplora tx) | `fetchBtcTx(txid)` → `doFetch<EsploraTxFullBody>` → real HTTP | Yes — live Esplora query (no cache) | FLOWING |
| `prepare_btc_rbf_bump.ts` | `psbtResult` | `_btcPsbt.buildBtcPsbt(...)` with reconstructed inputs | Yes — PSBT built from real tx data | FLOWING |
| `prepare_btc_rbf_bump.ts` | `payloadFingerprint` | `computeBtcPayloadFingerprint(perInputSighashes)` | Yes — BIP-143 sighash pipeline over real inputs | FLOWING |
| `sign_message_btc.ts` | `{ v, r, s }` | `_btcLedgerTransport.signBtcMessage(path, messageHex)` → real Ledger APDU | Real device only (returns stub in tests via vi.spyOn) | FLOWING |
| `sign_message_btc.ts` | `messageHash` | `computeBip137MessageHash(message)` → double-SHA256 | Yes — deterministic computation | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All Phase 24 specific tests pass | `npx vitest run test/tools-prepare-btc-rbf-bump.test.ts test/tools-sign-message-btc.test.ts test/signing-fingerprint.test.ts test/signing-bip137.test.ts` | 71/71 PASS | PASS |
| Phase 23 regression tests still pass | `npx vitest run test/prepare-btc-send.test.ts test/preview-send.test.ts` | 33/33 PASS | PASS |
| TypeScript compilation clean | `npx tsc --noEmit` | 0 errors | PASS |
| FROZEN crypto modules untouched | `git diff origin/main -- src/signing/btc-fingerprint.ts src/signing/btc-sighash.ts` | empty diff | PASS |
| Full suite (excluding known pre-existing flaky) | `npx vitest run` | 2836/2838 PASS; 2 failures in test/wallet-session-manager.test.ts (pre-existing load-dependent flaky — 34/34 in isolation) | PASS |

### Probe Execution

No probe scripts declared in PLAN.md files or found under `scripts/*/tests/probe-*.sh`. Step 7c: SKIPPED (no probe scripts for this phase).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| BTC-W-02 | 24-01-PLAN.md | `prepare_btc_rbf_bump({ txid, newFeeRate })` — RBF replacement PSBT; original input set preserved; BIP-125 rules enforced; refused on confirmed/non-RBF txs | SATISFIED | Tool fully implemented and tested (25 tests); all 5 refusal codes wired; BIP-125 Rule 2 strict-same-inputs enforced; CR-01 multi-output guard added |
| BTC-W-03 | 24-02-PLAN.md | `sign_message_btc({ wallet, message })` — BIP-137 compact signature; segwit address; BIP-322 deferred | SATISFIED (automated) / NEEDS HUMAN (on-device display) | Tool fully implemented (14 tests); BIP-137 pipeline correct; Fixture W pinned; SC#5 (device clear-sign) requires physical hardware |

### Code Review Fixes Verification

All 6 issues from 24-REVIEW.md were fixed. Verification:

| Finding | Status | Evidence |
|---------|--------|---------|
| CR-01: Silent truncation of multiple recipient outputs | FIXED | `recipientVouts.length > 1` guard at line 540 in prepare_btc_rbf_bump.ts; `INVALID_INPUT` error returned; regression test at line 647 PASS |
| CR-02: `{FEE_DELTA_SATS}` wrong when sub-dust change folded into fee | FIXED | `const feeDeltaSats = psbtResult.feeSats - originalFeeSats` at line 705; regression tests at lines 747 and 756 PASS |
| WR-01: No upper-bound sanity check on `newFeeRate` | FIXED | `fetchFeeEstimates()` called; `BTC_FEE_RATE_OUT_OF_BOUNDS` guard at line 372; regression test at line 775 PASS |
| WR-02: Taproot change output uses wrong BIP-32 path | FIXED | `changeBip32Path = changeScriptType === "p2tr" ? "m/86'/0'/0'/1/0" : "m/84'/0'/0'/1/0"` at line 578; regression tests at lines 813 and 867 PASS |
| WR-03: Fingerprint-drift error references wrong tool for rbf handles | FIXED | `const rerunTool = btcTx.kind === "rbf" ? "prepare_btc_rbf_bump" : "prepare_btc_send"` at preview_send.ts line 2108 |
| WR-04: `originalTxid` missing from `send_transaction` RBF success response | FIXED | `...(btcTx.kind === "rbf" ? { originalTxid: btcTx.originalTxid } : {})` at send_transaction.ts line 1602 |
| IN-01: Fee rate minimum hint off by one | FIXED | `Math.ceil(originalFeeRate + MIN_RELAY_FEE_BUMP_SATS_PER_VB) + 1` at line 406 |
| IN-02: txid regex comment says "lowercase" but regex accepts mixed-case | FIXED | Comment updated to "64 case-insensitive hex characters" at line 155 |

### Anti-Patterns Found

No blockers or warnings found.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `sign_message_btc.ts` | 291 | "not available in demo mode" | Info | This is a valid user-facing error message (demo-mode refusal text), not a stub indicator |

No `TBD`, `FIXME`, or `XXX` markers found in any Phase 24 modified file.

### Human Verification Required

#### 1. On-Device Message Display (BTC-W-03 SC#5)

**Test:** Connect a Ledger hardware wallet with BTC app open. Call `sign_message_btc({ wallet: '<your bc1q... address>', message: 'Hello VaultPilot' })` via the MCP server.
**Expected:** The BTC app displays the literal message text `"Hello VaultPilot"` character-for-character on the device screen under blind-sign mode. The user can compare the on-screen message against the agent-relayed message before confirming. The returned `signatureBase64` decodes to exactly 65 bytes with header byte 39 (for v=0) or 40 (for v=1).
**Why human:** Requires a physical Ledger device over USB-HID. The APDU `signMessage` display behavior cannot be verified without the device. This corresponds to ROADMAP Phase 24 Success Criterion #5.

#### 2. Live Mempool RBF Replacement (BTC-W-02 mempool behavior)

**Test:** On testnet or mainnet, prepare a BTC transaction with `signalRbf: true` via `prepare_btc_send`. Broadcast it. Wait for mempool confirmation. Then call `prepare_btc_rbf_bump({ txid: <txid>, newFeeRate: <higher rate> })` and broadcast via `send_transaction`. Monitor the mempool (e.g., via Esplora or a block explorer).
**Expected:** The replacement transaction appears in the mempool with the higher fee rate. The original transaction is evicted (replaced). The replacement's outputs match the original recipients with the reduced change output.
**Why human:** Requires a live mempool, real funds or testnet coins, and broadcast capability. The prepare/preview/send pipeline is fully wired and verified server-side; the mempool replacement behavior requires an actual Bitcoin node.

### Gaps Summary

No gaps blocking goal achievement. All automated checks pass. The two human verification items (SC#5 on-device display and live mempool replacement) are the standard v2.2 deferred-verify-phase items noted in the VALIDATION.md and consistent with the project's hardware-gated verification model.

The phase delivers:
- `prepare_btc_rbf_bump` — full BIP-125 RBF pipeline with all 5 refusal codes, strict-same-inputs, and the complete trust chain through preview/send
- `sign_message_btc` — BIP-137 compact signature via Ledger BTC app, no handle, direct-sign pattern
- All 6 code-review findings (2 blockers + 4 warnings) confirmed fixed
- FROZEN crypto modules (`btc-fingerprint.ts`, `btc-sighash.ts`) zero-diff vs origin/main
- Fixtures V and W pinned as hardcoded literals with no beforeAll-snapshot

---

_Verified: 2026-05-22T20:10:00Z_
_Verifier: Claude (gsd-verifier)_
