---
phase: 48-bittensor-subnet-depth
plan: 03
subsystem: tools
tags: [bittensor, subtensor, dtao, staking, prepare, preview, custody, slippage, write]

# Dependency graph
requires:
  - phase: 48-bittensor-subnet-depth
    provides: 5 builder kinds (add/remove/move/swap/transfer-stake) HOTKEY-FIRST + 5 allowlist keys + Fixtures TAO-D..H + the hotkey↔netuid-swap RED-FLAG regression (48-01)
  - phase: 48-bittensor-subnet-depth
    provides: isHotkeyRegisteredOnNetuid (getNeuronsLite presence) the preview unregistered-hotkey warning consumes (48-02)
  - phase: 47-bittensor-trust-pipeline
    provides: prepare_bittensor_add_stake_limit clone source + previewSendBittensorBranch + blocks-bittensor SOT + _bittensorRegistry/_bittensorBuilder/_simulationBittensor spy seams
provides:
  - 5 deferred-staking prepare tools (prepare_bittensor_{add,remove,move,swap,transfer}_stake)
  - 5 preview DECODED-ARGS arms + NOTICE (plain) / WITHDRAWAL (transfer-only) / unregistered-hotkey WARNING emission
  - 5 PREPARE RECEIPT templates + 3 advisory block templates in the blocks-bittensor format-fanout SOT
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Plain/reallocation/transfer prepare tools = clone of add_stake_limit minus the tolerancePct/limitPrice/simSwap guard plumbing"
    - "Per-extrinsic UNIT lives in the field NAME (§Pitfall 3): add_stake = TAO/RAO (amountStakedRao); remove/move/swap/transfer = ALPHA (amountUnstakedAlpha / alphaAmount)"
    - "Custody distinctness: ONLY transfer-stake emits [WITHDRAWAL — CUSTODY CHANGE]; move/swap declare ownership UNCHANGED"
    - "Preview unregistered-hotkey WARNING is best-effort: a registration-read failure swallows to a skip, never a refusal"

key-files:
  created:
    - test/prepare-bittensor-add-stake.test.ts
    - test/prepare-bittensor-remove-stake.test.ts
    - test/prepare-bittensor-move-stake.test.ts
    - test/prepare-bittensor-swap-stake.test.ts
    - test/prepare-bittensor-transfer-stake.test.ts
    - test/preview-send.bittensor-depth.test.ts
  modified:
    - src/tools/prepare_bittensor_add_stake.ts
    - src/tools/prepare_bittensor_remove_stake.ts
    - src/tools/prepare_bittensor_move_stake.ts
    - src/tools/prepare_bittensor_swap_stake.ts
    - src/tools/prepare_bittensor_transfer_stake.ts
    - src/signing/blocks-bittensor.ts
    - src/tools/register-all.ts
    - src/tools/preview_send.ts

key-decisions:
  - "transfer_stake treated as withdrawal-grade: destinationColdkey REQUIRED + SS58-validated + echoed FULL/untruncated in both receipt and structuredContent + a distinct [WITHDRAWAL — CUSTODY CHANGE] preview block"
  - "Plain add/remove get an advisory [NOTICE — no slippage guard] steering to the *_limit guarded defaults — advisory, never a refusal"
  - "Preview unregistered-hotkey WARNING targets the DESTINATION netuid for move/swap (the staking target); transfer-stake is a custody op and skips the staking-target WARNING entirely"
  - "Each prepare-tool fingerprint assertion cross-links its pinned TAO-D..H 0x literal (no beforeAll-snapshot — CLAUDE.md fixture discipline)"

patterns-established:
  - "Pattern: 5-arm summary.kind dispatch in previewSendBittensorBranch producing per-unit-labeled DECODED ARGS; block-assembly order DECODED → NOTICE → WITHDRAWAL → WARNING → CHECKS → BLIND-SIGN HASH → VERIFY"
  - "Pattern: anti-hang prepare-tool test = spy _bittensorRegistry.getApi + _bittensorBuilder.resolveChainHashes; demo-FIRST refusal asserts getApi/resolveChainHashes NEVER called"
  - "Pattern: preview-depth test seeds a bittensor handle via createHandle with the 48-01 summary, mocks _simulationBittensor to ok + a transport-free getNeuronsLite stub for the WARNING path"

requirements-completed: [TAO-W-06, TAO-W-07, TAO-W-08, TAO-R-05]

# Metrics
duration: ~25min
completed: 2026-06-03
---

# Phase 48 Plan 03: Deferred staking prepare tools + preview depth Summary

**The 5 deferred-staking prepare tools (plain add/remove, same-owner move/swap, custody-changing transfer) land HOTKEY-FIRST with per-extrinsic unit labels (TAO/RAO for add, ALPHA for the rest), each binding to its pinned Fixture TAO-D..H; the preview emits a NOTICE for the unguarded plain calls, a transfer-only [WITHDRAWAL — CUSTODY CHANGE] block, and a best-effort unregistered-hotkey WARNING — every byte mocked at the registry/builder/simulation seams, no live socket.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-06-03
- **Tasks:** 3 (Tasks 1-2 implementation shipped earlier this phase; Task 3 — the 6 tests + this SUMMARY — completed here)
- **Files:** 14 (6 test files created; 8 source files modified across the plan)

## Accomplishments

### The 5 prepare tools (TAO-W-06/07/08)
- `prepare_bittensor_add_stake` / `_remove_stake` — the PLAIN unguarded calls (`subtensorModule.addStake` / `removeStake`), no `limit_price` / `allow_partial`. add_stake parses + labels its amount **TAO/RAO** (field `rao`); remove_stake parses + labels **ALPHA** (field `alpha`). Same demo-FIRST refusal → live pairing gate → INVALID_INPUT as the shipped `*_limit` clone source.
- `prepare_bittensor_move_stake` / `_swap_stake` — SAME-owner alpha reallocation (`moveStake` re-delegates to a different hotkey AND/OR subnet; `swapStake` is one hotkey, subnet→subnet). Both echo origin+dest netuids; move echoes both hotkeys. Amount **ALPHA**. Ownership declared UNCHANGED — no custody block.
- `prepare_bittensor_transfer_stake` — CUSTODY CHANGE (`transferStake`). `destinationColdkey` is REQUIRED, SS58-validated, and echoed FULL/untruncated in both the PREPARE RECEIPT and `structuredContent` (T-48-09 — no truncation hides the custody destination). Amount **ALPHA**.

### The preview depth arms (preview_send.ts, additive)
- 5 new `summary.kind` DECODED-ARGS arms, each with the call name in snake_case + full hotkey(s) + netuid(s) + the per-extrinsic-unit-labeled amount.
- `[NOTICE — no slippage guard]` for plain add/remove only — steering to the `*_limit` guarded defaults; the `*_limit` arms do NOT emit it.
- `[WITHDRAWAL — CUSTODY CHANGE]` for transfer-stake ONLY, carrying the full `destinationColdkey`; move/swap do NOT emit it (the distinctness guard, T-48-06).
- `[WARNING — hotkey not registered on netuid N]` via the 48-02 `isHotkeyRegisteredOnNetuid` for the staking arms (add/remove use their netuid; move/swap use the DESTINATION netuid); best-effort — a read failure swallows to a skip, never a refusal.

### blocks-bittensor.ts (the format-fanout SOT)
- 5 new PREPARE RECEIPT templates (`..._ADD_STAKE_PLAIN_TEMPLATE` / `..._REMOVE_STAKE_PLAIN_TEMPLATE` / `..._MOVE_STAKE_TEMPLATE` / `..._SWAP_STAKE_TEMPLATE` / `..._TRANSFER_STAKE_TEMPLATE`) + 3 advisory block templates (NOTICE / WITHDRAWAL / unregistered-hotkey WARNING). No block inlined in a tool or in the preview arm.

### The 6 tests (Task 3 — written this session)
- 5 prepare-tool tests + the preview-depth test, 33 new assertions-suites total, all green. Each prepare-tool fingerprint assertion cross-links its pinned TAO-D..H `0x` literal (no `beforeAll`-snapshot). The preview-depth test pins NOTICE present/absent, the WITHDRAWAL transfer-only distinctness, and the unregistered-hotkey WARNING fire/no-fire/best-effort-skip behavior.

## Test results

- 6 new tests: **33 passed**
- Full bittensor sweep (6 new + signing-fingerprint-bittensor [29] + security-canonical-dispatch-bittensor [16] + get-bittensor-validators-enrichment [6]): **84 passed**
- EVM regression (`test/send-transaction.test.ts`): **19 passed**
- `tsc --noEmit`: **RC=0**
- Every `@polkadot/api` interaction mocked at the `_bittensorRegistry.getApi` / `_bittensorBuilder.resolveChainHashes` / `_simulationBittensor.runBittensorPreviewSimulation` seams — **NO live socket opened in any test** (anti-hang; all commands timeout-wrapped + file-scoped).

## FROZEN cryptographic-binding chain (TAO-W-09)

Verified zero-diff vs `origin/main` for the 7 binding modules:
`payload-fingerprint.ts`, `payload-fingerprint-solana.ts`, `payload-fingerprint-tron.ts`, `payload-fingerprint-bittensor.ts`, `presign-hash.ts`, `presign-hash-solana.ts`, `presign-hash-bittensor.ts` — **all empty diff**. The 5 new tx shapes flow through these shape-agnostic pure fns UNCHANGED. `src/tools/send_transaction.ts` has **zero diff** vs `origin/main` (trivially additive-safe — the send path reads no per-shape branch).

## Deviations from Plan

None — Tasks 1-2 shipped exactly as planned; Task 3 wrote the 6 tests to the planned acceptance criteria. Three initial test-assertion mismatches were corrected during authoring (not tool bugs):
- The PLAIN PREPARE RECEIPT NOTE line legitimately contains the prose "no limit_price — prefer prepare_bittensor_*_stake_limit"; the negative assertion was tightened to `not.toMatch(/limit_price:\s/)` (no field VALUE line) rather than rejecting the steering prose.
- The NOTICE template uses uppercase "PREFER"; the preview assertion regex was case-corrected.

No FROZEN files touched; no source changes made this session (the 5 prepare tools + preview arms already existed and compiled — RC=0).

## Self-Check: PASSED

All 6 created test files exist on disk; the `test(48-03)` commit exists in `git log`.
