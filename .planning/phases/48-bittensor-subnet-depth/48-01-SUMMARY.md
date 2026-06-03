---
phase: 48-bittensor-subnet-depth
plan: 01
subsystem: signing
tags: [bittensor, subtensor, scale, extrinsic-builder, payload-fingerprint, dispatch-allowlist, dtao]

# Dependency graph
requires:
  - phase: 47-bittensor-trust-pipeline
    provides: buildBittensorUnsignedTx + ExtrinsicPayload blob path + computeBittensorPayloadFingerprint + BITTENSOR_DISPATCH_ALLOWLIST + BittensorInstructionSummary union + the buildSignableBlob fixture helper
provides:
  - 5 new BuildBittensorInput kinds (add-stake, remove-stake, move-stake, swap-stake, transfer-stake) built in pallet-macro (hotkey-first / coldkey-first) order
  - BittensorInstructionSummary widened 3->8 variants with per-extrinsic unit-typed amount fields
  - BITTENSOR_DISPATCH_ALLOWLIST grown 3->8 camelCase (section,method) pairs
  - Fixtures TAO-D..H (independently-computed 0x literals) + the hotkey<->netuid-swap RED-FLAG regression
  - FROZEN_FILES extended to cover the 2 reused Bittensor binding modules (byte-identical to origin/main)
affects: [48-02, 48-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deferred-staking builder kinds clone the shipped *_limit shape minus the slippage guard"
    - "Per-extrinsic UNIT lives in the field name (amountStakedRao=TAO/RAO, amountUnstakedAlpha/alphaAmount=ALPHA)"
    - "hotkey<->netuid-swap fingerprint regression as the executable §RED FLAG money-correctness guard"

key-files:
  created: []
  modified:
    - src/chains/bittensor/extrinsic-builder.ts
    - src/signing/handle-store.ts
    - src/security/canonical-dispatch-bittensor.ts
    - test/signing-fingerprint-bittensor.test.ts
    - test/security-canonical-dispatch-bittensor.test.ts

key-decisions:
  - "Built all 5 shapes HOTKEY-FIRST (pallet-macro order) — NOT the Python-SDK netuid-first; transfer-stake builds destinationColdkey FIRST"
  - "Fixtures TAO-D..H use deterministic pinned (pallet,call) index literals (the shipped 0x4b09 convention); only self-consistency matters — the swap regression proves arg order"
  - "Plain/reallocation/transfer shapes carry NO limit_price (no guard); the NOTICE steer lands in Plan 48-03"

patterns-established:
  - "Pattern: deferred-staking builder kind = clone *_limit, drop simSwap/limitPrice"
  - "Pattern: RED-FLAG hotkey<->netuid swap regression asserts .not.toBe(canonical fixture)"

requirements-completed: [TAO-W-09]

# Metrics
duration: ~22min
completed: 2026-06-03
---

# Phase 48 Plan 01: Deferred-staking builder + fixtures foundation Summary

**5 deferred Bittensor staking builder kinds (add/remove/move/swap/transfer-stake) in pallet-macro hotkey-first order, an 8-pair dispatch allowlist, and Fixtures TAO-D..H with the hotkey↔netuid-swap RED-FLAG regression — all over the FROZEN, zero-diff Phase-47 binding.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-06-03T18:15Z
- **Completed:** 2026-06-03T18:22Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Extended `BuildBittensorInput` + `buildBittensorUnsignedTx` with 5 new kinds; each builds via `api.tx.subtensorModule.<camelMethod>(...)` in pallet-macro order (hotkey-first for add/remove; origin/dest hotkey+netuid for move; one hotkey+origin/dest netuid for swap; **destinationColdkey-first** for transfer).
- Widened `BittensorInstructionSummary` 3→8 variants with per-extrinsic unit-typed amount fields (transfer-stake carries `destinationColdkey`, full SS58).
- Grew `BITTENSOR_DISPATCH_ALLOWLIST` 3→8 camelCase keys; snake_case keys do NOT match (negative tests for `add_stake` + `transfer_stake`).
- Pinned Fixtures TAO-D..H as independently-computed 0x literals + the hotkey↔netuid-swap RED-FLAG regression (proves the arg order is in the preimage) + per-shape +1-unit regressions + pairwise-distinctness.
- Extended the FROZEN gate to cover the 2 reused Bittensor binding modules — all 8 binding modules byte-identical to origin/main.

## Task Commits

1. **Task 1: 5 builder kinds + 5 summary variants** - `06b003f` (feat)
2. **Task 2: 5 allowlist keys + extended dispatch test** - `a7ccecf` (feat)
3. **Task 3: Fixtures TAO-D..H + RED-FLAG regression + FROZEN_FILES extension** - `134e577` (test)

## Files Created/Modified
- `src/chains/bittensor/extrinsic-builder.ts` - +5 BuildBittensorInput kinds, +5 builder branches, +5 SubtensorBuilderApi method signatures (pallet-macro order)
- `src/signing/handle-store.ts` - BittensorInstructionSummary widened 3→8 (additive type surface)
- `src/security/canonical-dispatch-bittensor.ts` - allowlist 3→8 camelCase pairs
- `test/signing-fingerprint-bittensor.test.ts` - Fixtures TAO-D..H + swap/`+1` regressions + FROZEN_FILES coverage of the 2 Bittensor binding modules
- `test/security-canonical-dispatch-bittensor.test.ts` - 8-pair membership + 5 positive + 2 snake_case-negative cases

## Decisions Made
- **Hotkey-first order (the §RED FLAG):** built all 5 in pallet-macro SCALE order, anchored to the subtensor `dispatches.rs` Rust source + the shipped `addStakeLimit(hotkey, netuid, …)` precedent. The hotkey↔netuid-swap fingerprint regression is the executable guard.
- **Fixture indices:** pinned deterministic `0x09__` (pallet, call) literals following the shipped `0x4b09` convention — the fingerprint binds the bytes; the live builder re-anchors via `api.tx`. Real on-chain indices are NOT needed for the binding fixtures, only self-consistent arg order.
- **No limit_price on the new shapes:** plain/reallocation/transfer shapes intentionally omit the slippage guard (the NOTICE steer is Plan 48-03).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- **Worktree had no `node_modules`:** the `feat/48-bittensor` worktree was missing its dependency tree (the main repo's node_modules also lacked the `@polkadot/*` / `@zondax/*` scopes). Resolved by running `npm ci` (restores the committed, already-vetted lockfile tree — not a new-package install). Verified `@polkadot/api@16.5.6`, `@zondax/ledger-substrate@2.3.4`. Baseline shipped bittensor tests green before any edit.

## Open-Question resolutions (execute-time)
- **RED-FLAG `.meta.args` re-introspection:** the live `api.tx.subtensorModule.<method>.meta.args` order check requires live chain metadata (out of scope — no live RPC). The hotkey-first order is anchored to the Rust pallet source + the shipped `addStakeLimit` precedent; the hotkey↔netuid-swap fingerprint regression is the offline executable guard. Re-confirm `.meta.args` on a subtensor spec bump.

## Verification
- `npx vitest run test/signing-fingerprint-bittensor.test.ts test/security-canonical-dispatch-bittensor.test.ts --no-coverage` → 45 passed
- `npx vitest run test/send-transaction.test.ts --no-coverage` (EVM regression) → 19 passed
- `npx tsc --noEmit` → RC 0
- FROZEN zero-diff: all 8 binding modules byte-identical to origin/main; send_transaction.ts 0 deletion lines

## Next Phase Readiness
- Plan 48-02 (validator enrichment) builds against the read surface — independent of this plan's builder kinds.
- Plan 48-03 consumes the 5 builder kinds + the 5 summary variants + the TAO-D..H fixtures as fixed interfaces.

---
*Phase: 48-bittensor-subnet-depth*
*Completed: 2026-06-03*
