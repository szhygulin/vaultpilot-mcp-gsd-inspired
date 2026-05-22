---
phase: 26
plan: "26-03"
subsystem: btc-lifi-bridge
tags: [btc, lifi, bridge, psbt, fingerprint, trust-pipeline]
dependency_graph:
  requires: [26-01, 26-02]
  provides: [prepare_btc_lifi_swap, btc-lifi-trust-pipeline]
  affects: [preview_send, send_transaction, handle-store, blocks-btc, register-all, error-codes, signing-fingerprint]
tech_stack:
  added: []
  patterns:
    - NEVER-throws LiFi HTTP client via raw fetch (no @lifi/sdk)
    - Whole-PSBT-bytes payloadFingerprint (keccak256("VaultPilot-btclifi-v1:" || psbtBytes))
    - PSBT verbatim passthrough (Pitfall 6 mitigation — output order load-bearing)
    - Inv#6b recipient assertion (T-26-10 mitigation — case-insensitive toAddress comparison)
    - vi.stubGlobal("fetch") test seam for external HTTP client (CLAUDE.md convention)
    - Fixture AA hardcoded literal (0x8b014bc1...) cross-linked across two test files
    - ESM spy-affordance _btcLifiFingerprint for preview_send and send_transaction dispatch
key_files:
  created:
    - src/clients/lifi.ts
    - src/protocols/bridge-decoders/lifi-btc.ts
    - src/signing/btc-lifi-fingerprint.ts
    - src/tools/prepare_btc_lifi_swap.ts
    - test/clients-lifi.test.ts
    - test/lifi-btc-decoder.test.ts
    - test/prepare-btc-lifi-swap.test.ts
    - test/btc-lifi-trust-pipeline.test.ts
  modified:
    - src/signing/error-codes.ts (added LIFI_NO_ROUTE + RECIPIENT_MISMATCH)
    - src/signing/handle-store.ts (PreparedTxBtcLifi interface + PreparedTx union widen + outputCount/hasOpReturn fields)
    - src/signing/blocks-btc.ts (APPEND-ONLY: PREPARE_RECEIPT_BTC_LIFI_TEMPLATE + LEDGER_BLIND_SIGN_HASH_BTC_LIFI_TEMPLATE)
    - src/tools/register-all.ts (import prepare_btc_lifi_swap.js)
    - src/tools/preview_send.ts (btc-lifi dispatch + previewSendBtcLifiBranch)
    - src/tools/send_transaction.ts (btc-lifi fingerprint recompute arm + sendTransactionBtcLifiBranch)
    - test/signing-fingerprint.test.ts (Fixture AA + cross-chain distinctness tests)
decisions:
  - Used raw fetch (no @lifi/sdk) — RESEARCH verdict: SDK adds 13+ transitive deps and assumes wallet signing control
  - Whole-PSBT-bytes fingerprint for btc-lifi (not per-input sighashes) — LiFi constructs the PSBT, VaultPilot commits to the verbatim byte sequence
  - Domain tag "VaultPilot-btclifi-v1:" (22 bytes) distinct from "VaultPilot-btctx-v1:" and "VaultPilot-ltctx-v1:" for cross-chain fingerprint distinctness (T-26-12)
  - Added outputCount/hasOpReturn to PreparedTxBtcLifi to avoid re-decoding PSBT at preview time
  - Fixture AA computed at plan-execute time and pinned as 0x8b014bc1e6373349059387a8b430db1063652ae81a1e7b22e7b3223ea70634f7
metrics:
  duration: "~3 hours"
  completed: "2026-05-23"
  tasks: 3
  files: 15
---

# Phase 26 Plan 26-03: BTC LiFi Bridge (prepare_btc_lifi_swap + trust pipeline) Summary

BTC→EVM/SOL LiFi bridge tool with whole-PSBT-bytes keccak fingerprint, Inv#6b recipient assertion, and Ledger BTC app PSBT-sign → Esplora broadcast.

## What Was Built

### Task 1: LiFi HTTP client + PSBT decoder + btc-lifi fingerprint

- **`src/clients/lifi.ts`** — NEVER-throws `fetchBtcLifiQuote` using raw fetch. Discriminated union: `ok | not-found | rate-limited | error`. `mapLifiResponse` extracts only `action.toAddress + transactionRequest.{to,data,value}` (T-26-13 response injection mitigation). Test seam: `vi.stubGlobal("fetch", ...)`. No `@lifi/sdk`, no `_lifiClient` indirection.

- **`src/protocols/bridge-decoders/lifi-btc.ts`** — `decodeLifiPsbt(psbtHex)` returns `LifiPsbtSummary { vaultAddress, amountSats, hasOpReturn, outputCount, psbtHex }`. psbtHex is passed through verbatim — never reconstructed (Pitfall 6 mitigation).

- **`src/signing/btc-lifi-fingerprint.ts`** — `computeBtcLifiPayloadFingerprint(psbtBytes)` = keccak256("VaultPilot-btclifi-v1:" || psbtBytes). ESM spy-affordance `_btcLifiFingerprint`. Domain tag distinct from BTC + LTC tags (T-26-12 cross-chain distinctness).

- 23 tests: 13 client + 10 decoder.

### Task 2: prepare_btc_lifi_swap tool + Fixture AA

- **`src/tools/prepare_btc_lifi_swap.ts`** — 9-step handler: demo-check → validate → pair → LiFi quote → Inv#6b → decode → fingerprint → handle → receipt. Inv#6b: `quote.action.toAddress.toLowerCase() !== params.toAddress.toLowerCase()` → RECIPIENT_MISMATCH (T-26-10). PSBT verbatim passthrough.

- **`src/signing/error-codes.ts`** — Added `LIFI_NO_ROUTE` and `RECIPIENT_MISMATCH` to the ErrorCode union.

- **`src/signing/handle-store.ts`** — Added `PreparedTxBtcLifi` interface + widened `PreparedTx` union + `outputCount`/`hasOpReturn` fields for display at preview time.

- **`src/signing/blocks-btc.ts`** — APPEND-ONLY: `PREPARE_RECEIPT_BTC_LIFI_TEMPLATE` and `LEDGER_BLIND_SIGN_HASH_BTC_LIFI_TEMPLATE`.

- **`test/signing-fingerprint.test.ts`** — Fixture AA hardcoded literal `0x8b014bc1e6373349059387a8b430db1063652ae81a1e7b22e7b3223ea70634f7` + cross-chain distinctness assertions + `_btcLifiFingerprint` spy-affordance test.

- 26 tests covering all error arms, Inv#6b case-insensitivity, BTC→ETH, BTC→SOL, Fixture AA cross-link, PREPARE RECEIPT slot substitution.

### Task 3: preview_send + send_transaction btc-lifi branches

- **`src/tools/preview_send.ts`** — `previewSendBtcLifiBranch`: whole-PSBT fingerprint recompute, LEDGER_BLIND_SIGN_HASH_BTC_LIFI_TEMPLATE render, presignHash = payloadFingerprint.

- **`src/tools/send_transaction.ts`** — btc-lifi arm in three-gate fingerprint recompute chain + `sendTransactionBtcLifiBranch`: demo simulation envelope, Ledger BTC app PSBT-sign, Esplora broadcast.

- **`test/btc-lifi-trust-pipeline.test.ts`** — 10 integration tests: Gate 1 (PREVIEW_REQUIRED), Gate 2 (PREVIEW_TOKEN_MISMATCH), Gate 3 (PAYLOAD_FINGERPRINT_DRIFT), cancel path, full demo cycle, PSBT verbatim passthrough.

## Test Results

- Total tests: 93 (across 5 new/modified test files) + 246 test files pass (3143 tests) in full suite
- Frozen files: `src/signing/btc-fingerprint.ts`, `src/signing/btc-sighash.ts` — zero diff confirmed
- `blocks-btc.ts` — additions only confirmed

## Fixture AA

```
Domain tag: "VaultPilot-btclifi-v1:" (22 UTF-8 bytes)
PSBT: 3-output LiFi-shape PSBT
  Input:    txid=cc*32, vout=0, 1_000_000 sats P2WPKH
  Output 0: P2WPKH deposit (bc1qw508d...) 980_000 sats
  Output 1: OP_RETURN ("=|lifi" + 16 zero bytes) 0 sats
  Output 2: P2WPKH change 10_000 sats
Fixture AA: 0x8b014bc1e6373349059387a8b430db1063652ae81a1e7b22e7b3223ea70634f7
Cross-linked: test/signing-fingerprint.test.ts + test/prepare-btc-lifi-swap.test.ts + test/btc-lifi-trust-pipeline.test.ts
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed non-existent `chain` field from PrepareArgs usage**
- **Found during:** Task 2 build verification
- **Issue:** `prepare_btc_lifi_swap.ts` used `chain: params.toChain` in `PrepareArgs` but that field doesn't exist in the interface
- **Fix:** Removed the `chain` field — only `to` and `valueWei` used
- **Files modified:** `src/tools/prepare_btc_lifi_swap.ts`

**2. [Rule 2 - Missing field] Added outputCount + hasOpReturn to PreparedTxBtcLifi**
- **Found during:** Task 3 preview_send branch implementation
- **Issue:** Preview branch needed outputCount/hasOpReturn for PREPARE RECEIPT template substitution but these weren't stored in the handle
- **Fix:** Added `outputCount: number` and `hasOpReturn: boolean` to `PreparedTxBtcLifi`; updated `prepare_btc_lifi_swap.ts` to store them from `psbtSummary`
- **Files modified:** `src/signing/handle-store.ts`, `src/tools/prepare_btc_lifi_swap.ts`

## Threat Flags

None — no new network endpoints or auth paths beyond what the plan specified. The LiFi HTTP client is read-only (GET /v1/quote). Inv#6b and response-injection mitigation (mapLifiResponse) are implemented as planned.

## Known Stubs

None — all fields are wired from live data (LiFi quote → PSBT decoder → handle).

## Self-Check: PASSED

All 8 created files found on disk. All 4 commits (e0a7166, f8894aa, ece9aeb, c9bb8e1) confirmed in git log.
