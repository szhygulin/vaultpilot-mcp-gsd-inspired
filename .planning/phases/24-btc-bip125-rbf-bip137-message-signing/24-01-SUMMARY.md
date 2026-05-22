---
phase: "24"
plan: "01"
subsystem: "btc-signing"
tags: ["bitcoin", "rbf", "bip125", "psbt", "fee-bump", "prepare-tool"]
dependency_graph:
  requires:
    - "23-03"  # prepare_btc_send + PSBT pipeline (Phase 23 Plan 23-03)
    - "23-04"  # preview_send BTC + send_transaction BTC branches (Phase 23 Plan 23-04)
  provides:
    - "BTC-W-02"  # prepare_btc_rbf_bump tool
    - "BTC-Design-Fork-1"  # signalRbf opt-in on prepare_btc_send
  affects:
    - "preview_send.ts"  # kind: "rbf" arm added
    - "send_transaction.ts"  # kind: "rbf" flows through unchanged BTC branch
tech_stack:
  added: []
  patterns:
    - "BIP-125 strict-same-inputs (Rule 2) — no UTXO consolidation, no CPFP"
    - "sequenceOverride on buildBtcPsbt — RBF opt-in at the PSBT layer"
    - "Esplora /tx/{txid} fetchBtcTx — fee arithmetic from on-chain data"
    - "kind: native | rbf union on PreparedTxBtc — handle-store widening"
key_files:
  created:
    - "src/tools/prepare_btc_rbf_bump.ts"
    - "test/tools-prepare-btc-rbf-bump.test.ts"
  modified:
    - "src/protocols/btc-psbt.ts"       # sequenceOverride field (Task 1)
    - "src/signing/handle-store.ts"     # kind widening + originalTxid/feeSats/feeRate fields (Task 1)
    - "src/signing/error-codes.ts"      # 5 BTC_RBF_* error codes (Task 1)
    - "src/signing/blocks-btc.ts"       # PREPARE_RECEIPT_BTC_RBF_TEMPLATE (Task 1)
    - "src/chains/bitcoin/esplora-client.ts"  # fetchBtcTx + EsploraTxFullBody types (Task 1)
    - "src/tools/register-all.ts"       # prepare_btc_rbf_bump.js import (Task 2)
    - "src/tools/prepare_btc_send.ts"   # signalRbf?: boolean (Task 2, Design Fork 1)
    - "src/tools/preview_send.ts"       # kind: "rbf" arm in previewSendBtcBranch (Task 2)
    - "test/signing-fingerprint.test.ts"  # Fixture V (Task 0)
decisions:
  - "Design Fork 1 RESOLVED Option A: signalRbf?: boolean on prepare_btc_send (default false; byte-identical to Phase 23 Fixtures O/P/Q)"
  - "BIP-125 Rule 2: strict-same-inputs only — fee absorbed by reducing change output; no new inputs added"
  - "RBF_ENABLED_SEQUENCE = 0xfffffffd (itself bumpable); static 1 sat/vB min relay bump (BIP-125 Rule 4)"
  - "Fixture V = 0x946eeae4f39317444201821a47bdd0819bffc155925e5b855d22d04a2e1cfefc (RBF PSBT, sequence 0xfffffffd, 120_000 sats fee)"
  - "Esplora /tx/{txid} NO-CACHE: mempool state changes; server computes originalFeeRate independently (T-24-04)"
  - "send_transaction.ts BTC branch: kind: rbf flows through unchanged (signing + broadcast path identical to native)"
metrics:
  duration: "~90 min (including context restoration from prior session)"
  completed: "2026-05-22T16:26:00Z"
  tasks: 3
  files: 12
---

# Phase 24 Plan 01: BTC BIP-125 RBF Fee Bump Summary

BIP-125 Replace-By-Fee fee-bump tool (`prepare_btc_rbf_bump`) for mempool-pending BTC transactions, using the Esplora API to compute server-side fee arithmetic, strict-same-inputs reconstruction (BIP-125 Rule 2), and the existing `sequenceOverride` on `buildBtcPsbt` to set `0xfffffffd` on all inputs. Design Fork 1 resolved: `signalRbf?: boolean` added to `prepare_btc_send` with default-false path byte-identical to Phase 23.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 0 | Failing test scaffold + Fixture V | 89c3cd7 | test/tools-prepare-btc-rbf-bump.test.ts, test/signing-fingerprint.test.ts |
| 1 | Extend shared modules | 630249d | btc-psbt.ts, handle-store.ts, error-codes.ts, blocks-btc.ts, esplora-client.ts |
| 2 | Implement tools | 472ed0c | prepare_btc_rbf_bump.ts, register-all.ts, prepare_btc_send.ts, preview_send.ts |

## Key Decisions Made

1. **BIP-125 Rule 2**: Strict-same-inputs only. Fee absorbed entirely by reducing the change output. If `feeDelta > changeSats`, refuse with `BTC_RBF_CANNOT_AFFORD`. No UTXO consolidation.

2. **Design Fork 1 (Option A)**: `signalRbf?: boolean` on `prepare_btc_send`, default false. The default path produces byte-identical PSBTs to Phase 23 (Fixtures O/P/Q unchanged).

3. **Server-side fee arithmetic (T-24-04)**: `originalFeeRate = (sum(vin.prevout.value) - sum(vout.value)) / Math.ceil(weight/4)`. Esplora is authoritative; agent's claimed rate is ignored.

4. **No-cache for Esplora /tx/{txid}**: Mempool state changes between RBF attempts. The fetch result is used once per prepare call.

5. **Frozen modules**: `btc-fingerprint.ts` and `btc-sighash.ts` zero-diff vs `origin/main`. The same domain tag `"VaultPilot-btctx-v1:"` distinguishes RBF from native (sequence difference produces different Fixture V vs O/P/Q fingerprints).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test scaffold bugs in tools-prepare-btc-rbf-bump.test.ts**
- **Found during:** Task 2 test run
- **Issue:** Three bugs in the failing scaffold written in Task 0:
  (a) `unsignedTxHex: "01000000" + "00".repeat(40)` is not valid BTC raw tx hex — `Transaction.fromHex()` throws, outer catch returns `INTERNAL_ERROR` instead of success
  (b) `_resetDemoModeForTesting(true)` does not enable demo mode — the function takes no args and just clears the cache; needed `process.env.VAULTPILOT_DEMO = "true"` + `_resetDemoModeForTesting()`
  (c) `BTC_RBF_CANNOT_AFFORD` test setup had `vout1Value: 100` with default `vout0Value: 880_000` → fee ≈ 119_900/110 ≈ 1089.9 sat/vB; `newFeeRate: 500 < originalFeeRate + 1` → `BTC_RBF_INSUFFICIENT_FEE_RATE` fired first
  (d) BIP-125 Rule 2 test used `newFeeRate: 30` but `originalFeeRate = 100 sat/vB` → `BTC_RBF_INSUFFICIENT_FEE_RATE` fired first
  (e) `vi.restoreAllMocks()` in `afterEach` strips `createHandleSpy.mockImplementation` — `createHandle` returned `undefined` on subsequent tests (pattern from prepare-btc-send.test.ts was missing)
- **Fix:** Valid tx hex from `Transaction` constructor, proper demo mode env setup, corrected fee numbers for `BTC_RBF_CANNOT_AFFORD` (vout0=970_000 so originalFeeRate≈271.8, newFeeRate=500 passes Rule 4), BIP-125 Rule 2 newFeeRate bumped to 150, `createHandleSpy.mockImplementation` re-applied in `beforeEach` via `vi.importActual`
- **Files modified:** `test/tools-prepare-btc-rbf-bump.test.ts`
- **Commit:** 472ed0c

## Fixture V Cross-Link

Fixture V = `0x946eeae4f39317444201821a47bdd0819bffc155925e5b855d22d04a2e1cfefc`

Pinned in `test/signing-fingerprint.test.ts` (commit 89c3cd7) and consumed in `test/tools-prepare-btc-rbf-bump.test.ts` (commit 472ed0c). Computed from: sequence `0xfffffffd`, single P2WPKH input (1_000_000 sats), single output (880_000 sats = 120_000 sats fee). RBF replacement fingerprint is structurally distinct from native send fingerprints (Fixtures O/P/Q) because sequence changes the BIP-143 sighash preimage.

## FROZEN Modules Verification

```
git diff origin/main -- src/signing/btc-fingerprint.ts src/signing/btc-sighash.ts
# (empty — zero diff)
```

## Test Summary

| Test file | Tests | Status |
|-----------|-------|--------|
| test/tools-prepare-btc-rbf-bump.test.ts | 19 | PASS |
| test/signing-fingerprint.test.ts | 23 | PASS |
| test/prepare-btc-send.test.ts | 14 | PASS |
| test/preview-send.test.ts | 19 | PASS |
| Full suite | 2807 pass / 2 flaky | Pre-existing flaky: wallet-session-manager (timing-sensitive, passes in isolation) |

## Threat Flags

None. No new network endpoints, no new auth paths, no new trust boundaries. The `fetchBtcTx` function follows the same `fetchAddressUtxos` never-throw union pattern already in production.

## Self-Check: PASSED
