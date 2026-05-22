---
phase: 26-ltc-scaffolding-lifi-btc-bridging
verified: 2026-05-23T01:30:00Z
status: human_needed
score: 6/6 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Pair a real Ledger with the Litecoin app open: call pair_litecoin_ledger and confirm both addresses (L-prefix legacy + ltc1q segwit) appear verbatim on the Ledger screen"
    expected: "VERIFY-ON-DEVICE block rendered; both addresses shown on device; ASSUMED A1 string 'Litecoin' matches what getAppConfiguration().name returns"
    why_human: "USB-HID Ledger transport + real LTC app required; ASSUMED A1 comment in ledger-btc-transport.ts marks this as device-unverified"
  - test: "With the Litecoin app open, call prepare_litecoin_native_send and then preview_send; confirm the LEDGER BLIND-SIGN HASH block appears on-device and the hash matches the displayed value"
    expected: "On-device blind-sign hash matches the server-emitted presignHash; user approves; demo mode passes, real broadcast is manual-only"
    why_human: "Real Ledger LTC-app PSBT-signing path requires physical device; demo mode exercises the trust-pipeline in tests but does not sign on-device"
  - test: "With the Litecoin app open, call sign_message_ltc and confirm the message hash appears on-device with the correct LTC magic bytes (varint 0x19)"
    expected: "Compact BIP-137 signature returned; Fixture Z hash value confirms correct 0x19 magic prefix; device screen shows the message hash"
    why_human: "Real Ledger LTC app required to verify on-device display of BIP-137 message hash"
  - test: "Call prepare_btc_lifi_swap with a real BTC→EVM and a real BTC→SOL destination; verify the PSBT LEDGER BLIND-SIGN HASH appears on-device; confirm on-device final-recipient address matches the user-supplied toAddress"
    expected: "PSBT signed on-device; broadcast succeeds against mainnet (or devnet); no Inv#6b mismatch on a clean quote; the LiFi bridge routes correctly to the destination chain"
    why_human: "Real Ledger BTC app PSBT-signing + live LiFi API interaction required; li.quest may have route availability constraints"
---

# Phase 26: LTC Scaffolding + LiFi BTC Bridging — Verification Report

**Phase Goal:** LTC mirrors BTC scaffolding scaled down — `prepare_litecoin_native_send` + `sign_message_ltc` + Esplora via litecoinspace.org. LiFi-routed BTC bridging to EVM and Solana lands here. The full prepare → preview → send trust pipeline is reused with LTC-specific primitives and a new from-scratch LiFi client.
**Verified:** 2026-05-23T01:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | `pair_litecoin_ledger()` returns L-prefix legacy + ltc1q segwit addresses; gates on Litecoin app; saves two records under chain: "litecoin" | ✓ VERIFIED | `pair_litecoin_ledger.ts` exists; `LITECOIN_APP_NOT_OPEN` gate present (3 occurrences); `chain: "litecoin"` in 5 locations; `buildLtcApp` with `currency: "litecoin"` in transport; test/pair-litecoin-ledger.test.ts 10 tests pass |
| 2 | LTC read tools return balance/history/fees via litecoinspace.org; `fetchFeeEstimates` uses `/v1/fees/recommended`; reads never throw | ✓ VERIFIED | 3 tools exist and registered; esplora-client has 16 occurrences of `v1/fees/recommended`; NEVER-throws discriminated union confirmed; 3 test files (20 tests) pass |
| 3 | `prepare_litecoin_native_send` produces a PSBT-based unsigned LTC tx with `VaultPilot-ltctx-v1:` domain-tagged payloadFingerprint; LTC chain is byte-distinct from BTC | ✓ VERIFIED | `ltc-fingerprint.ts` with `FINGERPRINT_DOMAIN_TAG_LTC = "VaultPilot-ltctx-v1:"` confirmed; `computeLtcPayloadFingerprint` called in tool; Fixture Y pinned as `0x105386cb...` with cross-chain distinctness assertion; 18 tests pass |
| 4 | `sign_message_ltc` produces a BIP-137 compact signature over `\x19Litecoin Signed Message:\n` (varint 0x19, distinct from BTC's 0x18) | ✓ VERIFIED | `sign_message_ltc.ts` has 7 occurrences of "Litecoin Signed Message"; Fixture Z pinned as `0xa36092f9...` with cross-chain inequality assertion; 16 tool tests pass |
| 5 | `prepare_btc_lifi_swap` fetches a LiFi quote, fires Inv#6b assertion (RECIPIENT_MISMATCH on toAddress drift), passes PSBT verbatim (never reconstructed), and produces a btc-lifi handle with `VaultPilot-btclifi-v1:` fingerprint | ✓ VERIFIED | Inv#6b at line 255 of prepare_btc_lifi_swap.ts; PSBT verbatim passthrough documented; `VaultPilot-btclifi-v1:` in btc-lifi-fingerprint.ts; Fixture AA `0x8b014bc1...` pinned with cross-chain distinctness; 26 tests pass including BTC→ETH + BTC→SOL paths |
| 6 | The full prepare → preview → send trust pipeline (three gates: previewToken + userDecision + payloadFingerprint drift) is enforced for both litecoin and btc-lifi handles identically to BTC | ✓ VERIFIED | `txType === "litecoin"` in preview_send (2) and send_transaction (4); `txType === "btc-lifi"` in preview_send (1) and send_transaction (3); integration test ltc-trust-pipeline (10 tests) and btc-lifi-trust-pipeline (10 tests) all pass; FROZEN region (btc-fingerprint.ts, btc-sighash.ts) last modified at Phase 23, zero Phase 26 diff |

**Score:** 6/6 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/chains/litecoin/types.ts` | LTC_NETWORK const + branded types + assert guards | ✓ VERIFIED | 14 occurrences of LTC_NETWORK; assertLtcSegwitAddress + assertLtcLegacyAddress present |
| `src/chains/litecoin/registry.ts` | litecoinspace.org default + `_litecoinRegistry` spy-affordance | ✓ VERIFIED | 6 occurrences of `_litecoinRegistry` |
| `src/chains/litecoin/esplora-client.ts` | NEVER-throws; `v1/fees/recommended` fee endpoint; TTL cache | ✓ VERIFIED | 16 occurrences of `v1/fees/recommended`; WR-03 TTL fix confirmed (30s on addressInfoCache) |
| `src/tools/pair_litecoin_ledger.ts` | Dual-address pairing; app gate; two saveAccount calls | ✓ VERIFIED | Registered in register-all.ts |
| `src/tools/get_litecoin_balance.ts` | litoshi + LTC-formatted balance | ✓ VERIFIED | Imports from `litecoin/esplora-client.js` |
| `src/tools/get_litecoin_tx_history.ts` | Paginated txs via Esplora cursor | ✓ VERIFIED | Registered |
| `src/tools/get_litecoin_fee_estimates.ts` | 5-target sat/vB shape from mempool.space endpoint | ✓ VERIFIED | Registered |
| `src/signing/ltc-fingerprint.ts` | `VaultPilot-ltctx-v1:` domain tag + `_ltcFingerprint` spy-affordance | ✓ VERIFIED | 3 occurrences of domain tag |
| `src/tools/prepare_litecoin_native_send.ts` | PSBT-based + LTC fingerprint + LTC_NETWORK | ✓ VERIFIED | computeLtcPayloadFingerprint (2) + LTC_NETWORK (8) + registered |
| `src/tools/sign_message_ltc.ts` | BIP-137 LTC magic bytes; LTC_MAGIC_BYTES_HEX exported | ✓ VERIFIED | 7 occurrences of "Litecoin Signed Message"; registered |
| `src/clients/lifi.ts` | NEVER-throws; `20000000000001` BTC chain ID; no `_lifiClient` indirection | ✓ VERIFIED | 3 occurrences of `20000000000001`; no internal indirection |
| `src/protocols/bridge-decoders/lifi-btc.ts` | `decodeLifiPsbt` NEVER-throws discriminated union; verbatim psbtHex passthrough | ✓ VERIFIED | WR-02 fix applied: returns `{ kind: "ok"\|"error" }` not throw |
| `src/signing/btc-lifi-fingerprint.ts` | `VaultPilot-btclifi-v1:` domain tag + `_btcLifiFingerprint` spy-affordance | ✓ VERIFIED | 3 occurrences of domain tag |
| `src/tools/prepare_btc_lifi_swap.ts` | Inv#6b assertion + PSBT verbatim + handle creation | ✓ VERIFIED | Inv#6b at line 255; PSBT passthrough confirmed; registered |
| `test/signing-fingerprint.test.ts` | Fixture Y + Fixture AA hardcoded literals | ✓ VERIFIED | Fixture Y (5 occurrences), Fixture AA (4 occurrences) |
| `test/signing-bip137-ltc.test.ts` | Fixture Z hardcoded literal | ✓ VERIFIED | 8 occurrences of "Fixture Z" |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/chains/litecoin/esplora-client.ts` | litecoinspace.org | `_litecoinRegistry.getEsploraBaseUrl()` | ✓ WIRED | `_litecoinRegistry` present in esplora-client |
| `src/tools/pair_litecoin_ledger.ts` | non-evm-account-store | `saveAccount({ chain: 'litecoin', ... })` | ✓ WIRED | `chain: "litecoin"` appears 5 times in tool |
| `src/tools/register-all.ts` | all 7 LTC + LiFi tools | side-effect imports | ✓ WIRED | pair_litecoin_ledger, get_litecoin_balance, get_litecoin_tx_history, get_litecoin_fee_estimates, prepare_litecoin_native_send, sign_message_ltc, prepare_btc_lifi_swap all imported |
| `src/tools/prepare_litecoin_native_send.ts` | `src/signing/ltc-fingerprint.ts` | `_ltcFingerprint.computeLtcPayloadFingerprint` | ✓ WIRED | 2 occurrences in tool |
| `src/tools/preview_send.ts` | LTC handle branch | `txType === "litecoin"` dispatch | ✓ WIRED | 2 occurrences |
| `src/tools/send_transaction.ts` | LTC handle branch | `txType === "litecoin"` dispatch + LTC esplora broadcast | ✓ WIRED | 4 occurrences litecoin; `litecoin/esplora-client` import confirmed |
| `src/tools/prepare_btc_lifi_swap.ts` | `src/clients/lifi.ts` | `fetchBtcLifiQuote` | ✓ WIRED | 4 occurrences |
| `src/tools/prepare_btc_lifi_swap.ts` | Inv#6b assertion | `quote.action.toAddress === params.toAddress` | ✓ WIRED | RECIPIENT_MISMATCH at line 255 |
| `src/tools/prepare_btc_lifi_swap.ts` | `src/protocols/bridge-decoders/lifi-btc.ts` | `decodeLifiPsbt` | ✓ WIRED | 3 occurrences |
| `src/tools/preview_send.ts` | btc-lifi handle branch | `txType === "btc-lifi"` dispatch | ✓ WIRED | 1 occurrence |
| `src/tools/send_transaction.ts` | btc-lifi handle branch | `txType === "btc-lifi"` dispatch + BTC esplora broadcast | ✓ WIRED | 3 occurrences |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `get_litecoin_balance.ts` | balance / utxos | `fetchAddressInfo` + `fetchAddressUtxos` from litecoin/esplora-client | Yes — HTTP fetch with NEVER-throws wrapper | ✓ FLOWING |
| `prepare_litecoin_native_send.ts` | PSBT + payloadFingerprint | `fetchAddressUtxos` (UTXOs) → `buildBtcPsbt({ network: LTC_NETWORK })` → `computeLtcPayloadFingerprint` | Yes — real coin-selection → PSBT construction | ✓ FLOWING |
| `prepare_btc_lifi_swap.ts` | psbtHex + payloadFingerprint | `fetchBtcLifiQuote` → `decodeLifiPsbt` → `Buffer.from(psbtHex, "hex")` → `_btcLifiFingerprint.computeBtcLifiPayloadFingerprint` | Yes — live LiFi HTTP quote; CR-01 fix confirmed (Buffer.from hex decode, not UTF-8) | ✓ FLOWING |
| `send_transaction.ts` (btc-lifi) | send-time fingerprint | `Buffer.from(record.tx.psbtHex, "hex")` at line 386 | Yes — matches prepare-time encoding | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Fixture Y hardcoded literal passes | `npx vitest run test/signing-fingerprint.test.ts` | 5 Fixture Y tests pass | ✓ PASS |
| Fixture Z hardcoded literal passes | `npx vitest run test/signing-bip137-ltc.test.ts` | 8 Fixture Z tests pass | ✓ PASS |
| Fixture AA hardcoded literal passes (post CR-01 fix) | `npx vitest run test/signing-fingerprint.test.ts` | 4 Fixture AA tests pass; literal is `0x8b014bc1...` computed via `Buffer.from(hex, "hex")` | ✓ PASS |
| LTC trust pipeline end-to-end | `npx vitest run test/ltc-trust-pipeline.integration.test.ts` | 10/10 tests pass including T-09 Fixture Y byte-identity re-anchor | ✓ PASS |
| BTC-LiFi trust pipeline end-to-end | `npx vitest run test/btc-lifi-trust-pipeline.test.ts` | 10/10 tests pass including three-gate enforcement | ✓ PASS |
| Full suite no regressions | `npx vitest run` | 3143 passed, 1 skipped (pre-existing), 246 test files | ✓ PASS |
| TypeScript strict mode | `npx tsc --noEmit` | Exit 0 | ✓ PASS |

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` conventional probes found for this phase. Phase PLAN files do not declare any explicit probes. Test-suite spot-checks (Step 7b) cover the runnable verification surface.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| LTC-PAIR-01 | 26-01 | `pair_litecoin_ledger()` returns L-prefix + ltc1q addresses; gates on Litecoin app; saves two chain: "litecoin" records | ✓ SATISFIED | Tool exists, tested, registered; app gate + dual saveAccount confirmed |
| LTC-READ-01 | 26-01 | `get_litecoin_balance` returns litoshi + LTC balance via litecoinspace.org | ✓ SATISFIED | Tool exists, tested, imports from litecoin/esplora-client |
| LTC-READ-02 | 26-01 | `get_litecoin_tx_history` + `get_litecoin_fee_estimates` mirror BTC equivalents against litecoinspace.org | ✓ SATISFIED | Both tools exist, tested; `/v1/fees/recommended` endpoint used |
| LTC-W-01 | 26-02 | `prepare_litecoin_native_send` PSBT-based with `VaultPilot-ltctx-v1:` payloadFingerprint | ✓ SATISFIED | Tool exists, full pipeline tested; Fixture Y anchors the fingerprint literal |
| LTC-W-02 | 26-02 | `sign_message_ltc` with LTC magic bytes | ✓ SATISFIED | Tool exists, BIP-137 varint 0x19 confirmed; Fixture Z anchors the hash literal |
| BTC-LIFI-01 | 26-03 | `prepare_btc_lifi_swap` BTC→EVM/Solana with Inv#6b assertion | ✓ SATISFIED (code) / ? NEEDS HUMAN (real LiFi route) | Tool exists, Inv#6b wired, BTC→ETH + BTC→SOL demo tests pass; live LiFi route requires human verification. Note: REQUIREMENTS.md `[ ]` checkbox not checked off — minor doc gap, not a code gap |

**Note on BTC-LIFI-01 assertion timing:** ROADMAP SC6 says "assertion at preview time"; implementation fires at prepare time (before handle creation, line 255 of prepare_btc_lifi_swap.ts). This is strictly more defensive. The RESEARCH Pattern 5 document (cited in plan) explicitly specifies "BEFORE handle creation". This is an intentional, security-improving deviation from imprecise ROADMAP wording — not a defect.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/protocols/bridge-decoders/lifi-btc.ts` | 27 | `"../../../src/chains/bitcoin/types.js"` — traverses out of `src/` and back in; semantically fragile import path | ℹ Info (IN-01, code review finding) | Resolves today; breaks if `src/` is renamed. Non-blocking — TypeScript resolves it correctly. Review finding left open per user context. |
| `src/tools/prepare_btc_lifi_swap.ts` | 37 | `computeBtcLifiPayloadFingerprint` imported but all calls go through `_btcLifiFingerprint.computeBtcLifiPayloadFingerprint` indirection; named import unused at call sites | ℹ Info (IN-02, code review finding) | Unused lint warning; `tsc --noEmit` passes. Non-blocking. Review finding left open per user context. |
| `src/wallet/ledger-btc-transport.ts` | 888, 901 | `// ASSUMED A1: verify against real device` — `getAppConfiguration().name === "Litecoin"` string unverified on physical hardware | ⚠ Warning (documented assumption) | Not a code defect — properly annotated. Requires human verification (added to human_verification section). |

No `TBD`, `FIXME`, or `XXX` markers found in any Phase 26 file. No placeholder return patterns. All tool handlers produce real data or structured errors.

**Code Review Status:** All 7 findings from 26-REVIEW.md have been resolved:
- CR-01 (BLOCKER): `Buffer.from(psbtHex, "hex")` applied at both prepare and send sites; Fixture AA literal `0x8b014bc1...` is computed against the corrected encoding — confirmed via test using same `Buffer.from(FIXTURE_AA_PSBT_HEX, "hex")` path.
- WR-01: `LITECOIN_APP_NOT_OPEN`, `APPROVAL_TIMEOUT`, `USER_REJECTED` added to ErrorCode union (src/signing/error-codes.ts lines 249-251).
- WR-02: `decodeLifiPsbt` now returns `DecodeLifiPsbtResult = { kind: "ok" | "error" }` — NEVER-throws convention honored.
- WR-03: `addressInfoCache` has 30s TTL via `ADDRESS_INFO_CACHE_TTL_MS = 30_000` and `addressInfoCacheTs` companion map.
- WR-04: Change forfeiture disclosed in PREPARE RECEIPT; refusal threshold of 10,000 litoshi added.
- WR-05: `WALLET_NOT_PAIRED` refusal added when no segwit account is paired at prepare time.
- WR-06: `LedgerLtcAppNotOpenError` → `LITECOIN_APP_NOT_OPEN`; `LedgerDeviceNotConnectedError` → `LEDGER_NOT_CONNECTED` in sign_message_ltc.ts.
- IN-01 and IN-02 remain open (non-blocking info findings per user context).

### Human Verification Required

#### 1. Real Ledger LTC Pairing + ASSUMED A1 Verification

**Test:** With a Ledger device that has the Litecoin app installed and open, call `pair_litecoin_ledger`. Confirm the VERIFY-ON-DEVICE block appears in the response with both the L-prefix legacy address and the ltc1q segwit address shown verbatim.
**Expected:** Both addresses appear on the Ledger screen as prompted. The `getAppConfiguration().name === "Litecoin"` check passes (ASSUMED A1 confirmed). The wrong-app gate (e.g., Bitcoin app open) produces `LITECOIN_APP_NOT_OPEN` not a silent wrong-address return.
**Why human:** USB-HID Ledger transport + real Litecoin app required. The ASSUMED A1 string `"Litecoin"` is annotated as unverified in ledger-btc-transport.ts and must be confirmed against a real device.

#### 2. LTC Native Send Broadcast

**Test:** After pairing, call `prepare_litecoin_native_send` with a small litoshi amount, then `preview_send`, and confirm the LEDGER BLIND-SIGN HASH (LTC) block appears. Observe on-device hash display. Optionally broadcast with `send_transaction`.
**Expected:** The on-device hash matches the server-emitted presignHash. The PSBT-signing path via `buildLtcApp` / `signLtcPsbt` completes without error. Broadcast via litecoinspace.org POST /tx succeeds.
**Why human:** Real Ledger LTC-app PSBT-signing is not covered by unit/integration tests (demo mode uses simulation). The `signLtcPsbt` function with `currency: "litecoin"` over real USB transport requires a physical device.

#### 3. LTC BIP-137 Message Signing On-Device

**Test:** Call `sign_message_ltc` with a short message. Confirm the LTC magic bytes (varint 0x19) produce the expected Fixture Z hash on-device.
**Expected:** Compact 65-byte base64 signature returned. On-device display shows the message hash. The signature verifies correctly against the LTC magic-byte preimage.
**Why human:** Real Ledger LTC app required for the signing call. BIP-137 varint prefix correctness (0x19 not 0x18) can only be fully confirmed against device behavior.

#### 4. BTC→EVM/Solana LiFi Bridge with On-Device Confirmation

**Test:** Call `prepare_btc_lifi_swap` with a real BTC→ETH and a real BTC→SOL destination. Verify the Inv#6b assertion passes on a legitimate quote. Optionally complete the full prepare→preview→send cycle.
**Expected:** LiFi quote fetched successfully from li.quest; `decodedFinalRecipient` equals `userSuppliedToAddress`; PSBT LEDGER BLIND-SIGN HASH appears; on-device final-recipient address is shown. Broadcast via BTC esplora-client succeeds.
**Why human:** Live LiFi API + real Ledger BTC-app PSBT-signing required. Route availability on li.quest depends on market conditions and network liquidity. The Fixture AA fingerprint value anchors the math, but the end-to-end broadcast path requires a device.

---

### Gaps Summary

No automated gaps found. All 6 roadmap success criteria are satisfied in code. All 6 plan must-haves are VERIFIED. The full test suite (3143 tests, 246 files) passes with zero regressions. TypeScript strict mode passes clean. All 7 code-review findings (1 critical + 6 warnings) are resolved in code. 2 INFO findings remain open (non-blocking, per user context).

**Status is `human_needed`** because 4 behaviors require a real Ledger device and/or live external service to verify completely: real LTC pairing (ASSUMED A1), native LTC send broadcast, on-device BIP-137 message signing, and BTC→EVM/SOL LiFi bridge broadcast. This matches the v2.2 verify-phase pattern established by Phases 22-25 (USB-HID smoke deferred to milestone close-out session).

---

_Verified: 2026-05-23T01:30:00Z_
_Verifier: Claude (gsd-verifier)_
