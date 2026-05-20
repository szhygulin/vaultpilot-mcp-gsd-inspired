---
phase: 19-tron-approve-stake2
plan: "01"
subsystem: tron-approve
tags:
  - tron
  - trc20-approve
  - trc20-revoke
  - preview-send
  - known-spenders
  - byte-identity
dependency_graph:
  requires:
    - "18-04 (previewSendTronBranch, blocks-tron templates, simulation-tron, payload-fingerprint-tron)"
    - "18-03 (prepare_tron_trc20_send pattern reference)"
    - "06-03 (prepare_token_approve EVM analog)"
  provides:
    - "prepare_tron_token_approve MCP tool (TRON-PREP-05)"
    - "prepare_tron_revoke_approval MCP tool (TRON-W-03)"
    - "KNOWN_SPENDERS_TRON sub-table (TRON-W-08)"
    - "Fixture Tron-19-A hardcoded 0x literal anchor"
    - "previewSendTronBranch approve/revoke arm"
  affects:
    - "src/tools/preview_send.ts (approve/revoke early-return arm + shouldEmitTronLedgerNotice)"
    - "src/signing/handle-store.ts (TronInstructionSummary union widened with trc20-approve + trc20-revoke)"
    - "src/signing/blocks-tron.ts (3 new APPEND-ONLY templates)"
    - "src/config/contracts.ts (KNOWN_SPENDERS_TRON sub-table + lookupTronSpender)"
tech_stack:
  added: []
  patterns:
    - "prepareTronApproveInternal shared byte-identity helper (D-01): both approve + revoke delegate to same encode path"
    - "rawAmount === '0' discriminator in instructionSummary: trc20-revoke kind, no amount field"
    - "ESM spy-affordance: _tronApprove, _contractsTron indirection objects"
    - "Fixture Tron-19-A hardcoded 0x literal — NO beforeAll snapshot"
    - "Early-return arm placement BEFORE Layer 0.5/0.7 in previewSendTronBranch"
key_files:
  created:
    - src/protocols/tron-approve.ts
    - src/tools/prepare_tron_token_approve.ts
    - src/tools/prepare_tron_revoke_approval.ts
    - test/signing-fingerprint-tron-19.test.ts
    - test/protocols-tron-approve.test.ts
    - test/config-contracts.tron.test.ts
    - test/prepare-tron-token-approve.test.ts
    - test/prepare-tron-revoke-approval.test.ts
    - test/preview-send.tron-approve.test.ts
  modified:
    - src/config/contracts.ts
    - src/signing/blocks-tron.ts
    - src/signing/handle-store.ts
    - src/tools/preview_send.ts
    - src/tools/register-all.ts
decisions:
  - "D-01: prepareTronApproveInternal shared helper enforces byte-identity by construction — revoke imports approve's internal helper with amountWei=0n"
  - "D-02b: 'max' strict lowercase equality ONLY → U256_MAX; 'MAX'/'unlimited'/'infinite' rejected by parseTronAmountStrict"
  - "D-02c: PREPARE RECEIPT surfaces verbatim rawAmount (e.g. 'max'), NOT expanded bigint decimal"
  - "Task 0 checkpoint:decision resolved as 'defer-lifi' — 5 entries in KNOWN_SPENDERS_TRON, no LiFi entry pending Phase 20+"
  - "Approve/revoke preview bypasses Layer 0.5 stablecoin allowlist — allowlist guards transfer counterparties, not approve token contracts"
  - "shouldEmitTronLedgerNotice widened to emit: true for trc20-approve/trc20-revoke — approve ABI distinct from transfer, not in TRX-app bundled clear-sign registry"
metrics:
  duration: "~2 hours (multi-session with context compaction)"
  completed: "2026-05-20"
  tasks_completed: 3
  tasks_total: 3
  files_created: 9
  files_modified: 5
---

# Phase 19 Plan 01: TRON TRC-20 Approve + Revoke + preview_send Arm Summary

TRC-20 approve/revoke tooling with shared byte-identity helper (D-01), Fixture Tron-19-A hardcoded literal anchor, KNOWN_SPENDERS_TRON sub-table, and additive preview_send arm placing approve/revoke before the Phase 18 transfer-only guards.

## What Was Built

### Task 1: Protocol Layer + Infrastructure (commit f9eb803)

- **`src/protocols/tron-approve.ts`** — `encodeTronTrc20Approve` (selector `095ea7b3`), `decodeTronTrc20ApproveCall`, `_tronApprove` ESM spy seam
- **`src/config/contracts.ts`** — `KNOWN_SPENDERS_TRON` (5 entries: SunSwap V2 Router, USDT, USDC, USDD, TUSD), `lookupTronSpender`, `_contractsTron` ESM spy, DOA validation loop
- **`src/signing/blocks-tron.ts`** — 3 APPEND-ONLY templates: `PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE`, `UNLIMITED_APPROVAL_TRON_TEMPLATE`, `KNOWN_SPENDER_LABEL_TRON_TEMPLATE`
- **`src/signing/handle-store.ts`** — `TronInstructionSummary` union widened with `trc20-approve` (has `amount`, `amountIsMax`, `spenderLabel`) and `trc20-revoke` (no `amount` field) variants
- **`test/signing-fingerprint-tron-19.test.ts`** — Fixture Tron-19-A hardcoded fingerprint `0xb6ed7397e41a3159b4068cb4e25882108dce9beccf277de81935d2f5bf5a5ef4`; placeholder stubs for Fixtures B/C/D
- **`test/protocols-tron-approve.test.ts`** — 19 tests: selector constant, encode/decode, ESM spy
- **`test/config-contracts.tron.test.ts`** — 15 tests: KNOWN_SPENDERS_TRON table shape, lookupTronSpender, regression on KNOWN_SPENDERS_ETHEREUM count
- **`test/blocks-tron.test.ts`** (modified) — extended with 3 new describe blocks for Templates 8/9/10; 42 tests total

### Task 2: Prepare Tools (commit e34c480)

- **`src/tools/prepare_tron_token_approve.ts`** — MCP tool registration + `prepareTronApproveInternal` shared helper (exported for revoke sibling); D-02b "max" sentinel; D-02c verbatim PREPARE RECEIPT; instructionSummary discrimination: `rawAmount === "0"` → `trc20-revoke` else → `trc20-approve`
- **`src/tools/prepare_tron_revoke_approval.ts`** — distinct named MCP tool (D-01c); NO `amount` field in input schema; hard-codes `rawAmount: "0", amountWei: 0n` in call to `prepareTronApproveInternal`
- **`src/tools/register-all.ts`** — 2 new import lines after Phase 18 TRON cluster
- **`test/prepare-tron-token-approve.test.ts`** — 24 tests (3 todo): Fixture Tron-19-A consumer re-anchor, PREPARE RECEIPT verbatim, "max" sentinel, INVALID_INPUT validation, demo/pairing guards, amount="0" → trc20-revoke kind
- **`test/prepare-tron-revoke-approval.test.ts`** — 18 tests (3 todo): T-TRON-REVOKE-DRIFT-1 byte-identity invariant (LOAD-BEARING), happy path, INVALID_INPUT, demo/pairing guards

### Task 3: preview_send Arm (commit ca40d27)

- **`src/tools/preview_send.ts`** (additive widening):
  - `previewSendTronBranch`: early-return arm placed BEFORE Layer 0.5 + Layer 0.7 guards; reads `summary0.kind === "trc20-approve" || "trc20-revoke"` → approve/revoke path
  - Approve/revoke arm: skips dispatch allowlist + simulation; pins selector `"0x095ea7b3"`; renders `PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE` + `KNOWN_SPENDER_LABEL_TRON_TEMPLATE` + `LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE` + `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE` + conditional `UNLIMITED_APPROVAL_TRON_TEMPLATE` (only when `amountIsMax === true`) + `LEDGER_NOTICE_TRON_TEMPLATE` (unconditional)
  - `shouldEmitTronLedgerNotice` widened: `trc20-approve` → `emit: true, instructionName: "TRC-20 approve"`; `trc20-revoke` → `emit: true, instructionName: "TRC-20 revoke"`
  - Existing Phase 18 transfer/native arms BYTE-IDENTICAL (skipped via early-return, not modified)
- **`test/preview-send.tron-approve.test.ts`** — 19 tests: approve happy path, unlimited block, revoke happy path, non-stablecoin token bypass, selector `"0x095ea7b3"` assertion, LEDGER NOTICE present, no-simulation advisory, trc20-transfer back-compat

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Error envelope field name: sc.code → sc.errorCode**
- **Found during:** Task 2 test run
- **Issue:** Tests used `sc.code` to access the error code field, but `makeStructuredError` returns `{ errorCode, message, cause }` — the field is `errorCode`, not `code`. Parallel to `prepare-tron-trc20-send.test.ts` which uses `sc.errorCode` correctly.
- **Fix:** Changed all `sc.code` references to `sc.errorCode` in both `test/prepare-tron-token-approve.test.ts` and `test/prepare-tron-revoke-approval.test.ts`.
- **Files modified:** test/prepare-tron-token-approve.test.ts, test/prepare-tron-revoke-approval.test.ts
- **Commit:** e34c480

**2. [Rule 1 - Bug] T-TRON-REVOKE-DRIFT-1 test had incorrect semantic assertion**
- **Found during:** Task 2 test run
- **Issue:** The T-TRON-REVOKE-DRIFT-1 test originally asserted that `approve({T,S,amount:"0"})` would produce `kind: "trc20-approve"` with `amount: 0n`, but the actual discriminator in `prepareTronApproveInternal` routes `rawAmount === "0"` → `trc20-revoke` for BOTH the revoke tool AND approve with amount="0". The semantic routing distinction is between `prepare_tron_revoke_approval` (no amount schema field) vs `prepare_tron_token_approve` (has amount field), not between their output kinds when called with amount="0".
- **Fix:** Corrected the test assertions to reflect that `approve(amount="0")` also produces `kind: "trc20-revoke"` (no amount field); D-01 byte-identity is verified via matching `payloadFingerprint`.
- **Files modified:** test/prepare-tron-revoke-approval.test.ts
- **Commit:** e34c480

**3. [Rule 1 - Bug] shouldEmitTronLedgerNotice: moved return statement (forward-planning comment was dead code)**
- **Found during:** Task 3 additive-only diff assertion
- **Issue:** The original function had `return { emit: false, ... }` BEFORE the forward-planning comment `// Phase 19+ widens: switch on 'tx.kind'`. The comment was dead code (after return). Adding new if-branches required moving the return to be the final fallback. Git treats this as a deletion + insertion of the same line.
- **Fix:** Retained the original two Phase 18 comments (`// tx.kind === "trc20" — all Phase 18 stablecoins in bundled registry` and `// Phase 19+ widens: switch on 'tx.kind' for approve/stake/swap variants`) and placed them BEFORE the new if-blocks; the `return` statement is now the correct final fallback. This is the only "deletion" in the additive-only diff (one line moved, not removed).
- **Impact:** Functionally zero — the return statement is present in the file; it was repositioned as required by the widening.
- **Commit:** ca40d27

## Test Delta

| File | New Tests | Notes |
|------|-----------|-------|
| test/signing-fingerprint-tron-19.test.ts | 7 (3 todo) | Fixture Tron-19-A anchor |
| test/protocols-tron-approve.test.ts | 19 | Protocol layer |
| test/config-contracts.tron.test.ts | 15 | KNOWN_SPENDERS_TRON table |
| test/blocks-tron.test.ts | +2 | Extended from 40 to 42 |
| test/prepare-tron-token-approve.test.ts | 24 (3 todo) | Tool coverage |
| test/prepare-tron-revoke-approval.test.ts | 18 (3 todo) | T-TRON-REVOKE-DRIFT-1 |
| test/preview-send.tron-approve.test.ts | 19 | Preview arm |
| **Total new** | **~104** | **+9 todo stubs for future phases** |

Full suite: 2169 tests passing, 9 todo, 175 test files.

## Threat Flag Scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan's threat model covers.

## Self-Check: PASSED

- f9eb803 exists: `git log --oneline --all | grep f9eb803` ✓
- e34c480 exists: confirmed ✓
- ca40d27 exists: confirmed ✓
- FROZEN area zero-diff: `git diff origin/main -- src/signing/payload-fingerprint-tron.ts ...` → empty ✓
- Four hard-guard lines in preview_send.ts intact ✓
- 175 test files passing, 2169 tests active ✓
