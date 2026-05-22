---
phase: 25-btc-psbt-multisig-flow
plan: "02"
subsystem: btc-psbt-combine
tags:
  - bitcoin
  - multisig
  - psbt
  - bip-174
  - combine
  - conflict-detection
dependency_graph:
  requires:
    - 25-01  # btc-multisig registry + error codes (PSBT_COMBINE_CONFLICT already added)
    - 23-02  # btc-psbt.ts base (_btcPsbt spy-affordance, Psbt import)
  provides:
    - combineBtcPsbts  # helper in btc-psbt.ts with pre-combine conflict scan
    - combine_btc_psbts  # registered direct-transform MCP tool (BTC-PSBT-05)
  affects:
    - 25-03  # sign_btc_multisig_psbt uses the combined PSBT output
    - 25-04  # finalize_btc_psbt receives combined PSBT
tech_stack:
  added: []
  patterns:
    - discriminated-union return type (BtcCombineResult) — never-throws style from decodeBtcPsbt
    - _btcPsbt spy-affordance extended with combineBtcPsbts (vi.spyOn seam)
    - errEnvelope local helper mirroring prepare_btc_rbf_bump.ts shape
    - TDD RED/GREEN cycle per plan tdd="true" frontmatter
key_files:
  created:
    - src/tools/combine_btc_psbts.ts
    - test/btc-multisig-combine.test.ts
    - test/tools-combine-btc-psbts.test.ts
  modified:
    - src/protocols/btc-psbt.ts  # added BtcPsbtConflict, BtcCombineResult, combineBtcPsbts, extended _btcPsbt
    - src/tools/register-all.ts  # added combine_btc_psbts.js import
decisions:
  - All-pairs scan (i,j) j>i: ensures conflicts between non-adjacent PSBTs are detected
  - Identical sig bytes → NOT a conflict (idempotent re-submission safety valve)
  - Psbt.combine called only after zero-conflict pre-scan; bip174 keyPusher silent-drop is bypassed
  - Direct transform tool: no createHandle, no payloadFingerprint (per trust-pipeline mapping)
  - Error message truncates sig hexes to first 16 chars + ellipsis for readability in conflict detail
metrics:
  duration_minutes: 22
  completed_date: "2026-05-22"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 2
  tests_added: 21
---

# Phase 25 Plan 02: combine_btc_psbts — PSBT merge with pre-combine conflict scan

**One-liner:** Direct-transform PSBT combiner with all-pairs per-input per-pubkey conflict scan that raises `PSBT_COMBINE_CONFLICT` before any `Psbt.combine()` call, bypassing bip174's silent self-wins key drop.

## What Was Built

### Task 1: combineBtcPsbts helper in btc-psbt.ts (TDD)

- Added `BtcPsbtConflict` interface: `{ inputIndex, pubkeyHex, sigHex0, sigHex1 }`.
- Added `BtcCombineResult` discriminated union: `{ kind: "ok" | "conflict" | "error" }` — never throws.
- Implemented `combineBtcPsbts(psbtBase64s: readonly string[]): BtcCombineResult`:
  1. Parses every PSBT inside try/catch — any failure → `{ kind: "error" }`.
  2. Pre-scan: for each pair `(i, j)` with `j > i`, for each input index, builds pubkey→sigHex map from each input's `partialSig` array; differing signature bytes → push `BtcPsbtConflict`.
  3. Identical signature bytes for same pubkey/input → idempotent, NOT a conflict.
  4. `conflicts.length > 0` → `{ kind: "conflict" }` — `Psbt.combine` is never called.
  5. Zero conflicts → `psbts[0].combine(...psbts.slice(1))` → `{ kind: "ok", psbtBase64 }`.
- Extended `_btcPsbt` spy-affordance: `{ buildBtcPsbt, decodeBtcPsbt, combineBtcPsbts }`.
- Updated module comment "Consumed by:" list with `combine_btc_psbts.ts`.
- `test/btc-multisig-combine.test.ts` (8 tests): malformed-PSBT error, conflict detection with full struct assertion, no-combine-on-conflict property, all-pairs scan (A+B+C where A and C conflict), idempotent re-submission ok, conflict-free merge with both pubkeys present in combined PSBT.

### Task 2: combine_btc_psbts tool + register-all wiring

- `src/tools/combine_btc_psbts.ts`: `registerTool` + `errEnvelope` shape from `prepare_btc_rbf_bump.ts`.
  - Input schema `{ psbts: string[] }`, minItems: 2.
  - Validates `psbts` is array with ≥ 2 non-empty string elements → `INVALID_INPUT`.
  - Routes to `_btcPsbt.combineBtcPsbts` via spy-affordance.
  - `conflict` → `PSBT_COMBINE_CONFLICT` with `inputIndex + pubkeyHex + both sig hexes` in message.
  - `error` → `INTERNAL_ERROR`.
  - `ok` → `{ combinedPsbt, chain: "bitcoin", inputCount }` in structuredContent.
  - Tool description names the routing context (merging co-signer PSBTs) and conflict surface.
  - NO `createHandle`, NO `payloadFingerprint` imports (confirmed by grep).
- `src/tools/register-all.ts`: added `import "./combine_btc_psbts.js"` after Phase 25-01 BTC imports.
- `test/tools-combine-btc-psbts.test.ts` (13 tests): `vi.spyOn(_btcPsbt, "combineBtcPsbts")` spy tests for all error paths + success; integration tests with real PSBTs for conflict and conflict-free cases; no-handle/no-payloadFingerprint assertion on structuredContent.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 RED | `02a0056` | test(25-02): add failing tests for combineBtcPsbts pre-combine conflict scan |
| Task 1 GREEN | `2414f69` | feat(25-02): combineBtcPsbts helper + pre-combine conflict scan in btc-psbt.ts |
| Task 2 | `086f280` | feat(25-02): combine_btc_psbts tool + register-all wiring (BTC-PSBT-05) |

## Must-Have Truths — All Satisfied

- **User can combine co-signer PSBTs:** `combine_btc_psbts({ psbts: [...] })` merges conflict-free PSBTs and returns `combinedPsbt` base64.
- **Conflict → structured refusal before combine:** Same-pubkey/same-input differing sigs → `PSBT_COMBINE_CONFLICT` naming `inputIndex + pubkeyHex + sigHex0 + sigHex1`; `Psbt.combine` never called.
- **Pre-scan runs BEFORE Psbt.combine:** Verified by test that asserts `kind === "conflict"` before any ok result could appear; bip174's `keyPusher` silent-drop is bypassed.
- **Conflict-free merge succeeds:** Test verifies combined PSBT contains both pubkeys' signatures.
- **BTC-PSBT-05 satisfied.**

## Deviations from Plan

None — plan executed exactly as written.

- No `threshold` parameter added to `combineBtcPsbts` (correctly excluded per plan — threshold is finalize's concern).
- `_btcPsbt` extension excludes `finalizeBtcPsbt` slot (reserved for Plan 25-03 per plan).
- TDD cycle completed: RED commit (`02a0056`) → GREEN commit (`2414f69`); no REFACTOR needed.

## Known Stubs

None. All acceptance criteria met:
- `combineBtcPsbts` returns real conflict detection and real merges.
- Tool surfaces real conflict data from the combiner.
- No placeholder messages or TODO paths.

## Threat Flags

None. All threats in plan's threat model are addressed:
- T-25-06 (conflicting signature injection) — mitigated: pre-scan raises `PSBT_COMBINE_CONFLICT`.
- T-25-07 (malformed PSBT crashes combiner) — mitigated: try/catch → `{ kind: "error" }`.
- T-25-08 (silent co-signer sig drop) — mitigated: same as T-25-06 (pre-scan converts silent drop to visible refusal).

## Self-Check: PASSED

Files created:
- `src/tools/combine_btc_psbts.ts` — FOUND
- `test/btc-multisig-combine.test.ts` — FOUND
- `test/tools-combine-btc-psbts.test.ts` — FOUND

Files modified:
- `src/protocols/btc-psbt.ts` — FOUND (combineBtcPsbts × 4, _btcPsbt extended)
- `src/tools/register-all.ts` — FOUND (combine_btc_psbts.js import × 1)

Commits present: 02a0056, 2414f69, 086f280 — FOUND

Full vitest suite: 2909 passed, 1 known flake (wallet-session-manager.test.ts WalletConnect load-sensitive).

TypeScript: `npx tsc --noEmit` — 0 errors.
