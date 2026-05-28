---
phase: 39-bridge-tier-1-facet-decoders-final-recipient-assertion
plan: 01
subsystem: signing
tags: [viem, bridge, evm, security, mcp, canonical-dispatch, esm-seam]

# Dependency graph
requires:
  - phase: 38-safe-hard-trigger
    provides: Phase 38 error codes (INSUFFICIENT_SIGNATURES, STALE_SIGNATURE) that the new DECODED_RECIPIENT_DRIFT code appends after
  - phase: 09-hardening
    provides: _canonicalDispatch ESM seam pattern (_canonicalDispatch) — mirrored by _bridgeTier1Decoders
provides:
  - DECODED_RECIPIENT_DRIFT ErrorCode union member for Layer 0.6 refusal
  - DECODED_RECIPIENT_DRIFT_TEMPLATE export from blocks.ts (3 slots: BRIDGE/DECODED/SUPPLIED)
  - PreparedTxEvm.bridgeParams?.toAddress as the Layer 0.6 comparand
  - src/protocols/bridge-decoders/index.ts registry skeleton with _bridgeTier1Decoders ESM seam
  - BridgeFacetDecodeResult DU type (ok | no-match | error)
  - decodeBridgeTier1FacetRecipient dispatcher returning no-match for all inputs (empty TIER1_DECODERS map)
affects:
  - 39-02 (bridge per-decoder files register into TIER1_DECODERS map)
  - 39-03 (preview_send Layer 0.6 wiring imports _bridgeTier1Decoders + DECODED_RECIPIENT_DRIFT_TEMPLATE + bridgeParams)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "_bridgeTier1Decoders ESM seam: identical to _canonicalDispatch — object wrapper so vi.spyOn intercepts calls from preview_send"
    - "TIER1_DECODERS ReadonlyMap<string, (data: Hex) => BridgeFacetDecodeResult> — empty skeleton; Plan 39-02 populates"
    - "APPEND-ONLY discipline: error-codes.ts union and blocks.ts templates both extended at end-of-file only"

key-files:
  created:
    - src/protocols/bridge-decoders/index.ts
    - test/bridge-decoders-index.test.ts
  modified:
    - src/signing/error-codes.ts
    - src/signing/blocks.ts
    - src/signing/handle-store.ts

key-decisions:
  - "bridgeParams?: { toAddress?: string } optional bag on PreparedTxEvm (not a required top-level field) — non-breaking; no existing EVM handle-construction site changes"
  - "TIER1_DECODERS map left empty in Plan 39-01 skeleton; Plan 39-02 registers all four bridge decoders via a '// Plan 39-02 registers decoders here' anchor"
  - "BridgeFacetDecodeResult DU has three arms (ok / no-match / error) — error arm distinct from no-match so Layer 0.6 can refuse on decode failures without silently passing"

patterns-established:
  - "_bridgeTier1Decoders: mirrors _canonicalDispatch seam — export const _bridgeTier1Decoders = { decodeBridgeTier1FacetRecipient }"
  - "DECODED_RECIPIENT_DRIFT_TEMPLATE: REFUSED em-dash title + three-slot shape (bridge / decoded / supplied) matching DISPATCH_TARGET_REFUSAL_TEMPLATE convention"

requirements-completed: [BRIDGE-T1-05, BRIDGE-T1-06]

# Metrics
duration: 8min
completed: 2026-05-28
---

# Phase 39 Plan 01: Bridge Tier-1 Decoders Infrastructure Summary

**Wave 0 infrastructure: DECODED_RECIPIENT_DRIFT error code + refusal template + PreparedTxEvm.bridgeParams?.toAddress + bridge-decoders/index.ts registry skeleton with _bridgeTier1Decoders ESM seam returning no-match for all inputs**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-28T16:32:00Z
- **Completed:** 2026-05-28T16:40:36Z
- **Tasks:** 3 (1 standard, 1 standard, 1 TDD)
- **Files modified:** 5

## Accomplishments

- Appended `DECODED_RECIPIENT_DRIFT` to the `ErrorCode` union (append-only after `STALE_SIGNATURE`) with JSDoc explaining Phase 39 / Layer 0.6 / recovery hint
- Appended `DECODED_RECIPIENT_DRIFT_TEMPLATE` to `blocks.ts` with em-dash title `[REFUSED — DECODED RECIPIENT DRIFT]` + three slots `{BRIDGE}` / `{DECODED}` / `{SUPPLIED}` per BRIDGE-T1-05
- Added optional `bridgeParams?: { toAddress?: string }` field to `PreparedTxEvm` (additive-only; state machine, TTL, lifecycle, PreviewPinned all untouched)
- Created `src/protocols/bridge-decoders/index.ts` with `BridgeFacetDecodeResult` DU, empty `TIER1_DECODERS` map with Plan 39-02 extension anchor, `decodeBridgeTier1FacetRecipient` dispatcher, and `_bridgeTier1Decoders` ESM seam
- 10 new tests in `test/bridge-decoders-index.test.ts` covering all 5 behaviors (empty calldata, short calldata, unrecognized selector, ESM seam identity, case-insensitive lookup)
- Full suite green: 5027 tests pass (+ 10 new; no regressions)
- FROZEN-area zero-diff: `payload-fingerprint.ts`, `presign-hash.ts`, `send_transaction.ts`, `lifi-btc.ts` byte-identical to origin/main

## Task Commits

1. **Task 1: Append DECODED_RECIPIENT_DRIFT error code + template** — `ef94a7e` (feat)
2. **Task 2: Widen PreparedTxEvm with bridgeParams** — `5385b61` (feat)
3. **Task 3 RED: Failing test for registry skeleton** — `4dc4ab6` (test)
4. **Task 3 GREEN: Create bridge-decoders/index.ts** — `08dfe11` (feat)

## Files Created/Modified

- `src/signing/error-codes.ts` — `DECODED_RECIPIENT_DRIFT` appended to ErrorCode union after `STALE_SIGNATURE`; semicolon moved to new final member
- `src/signing/blocks.ts` — `DECODED_RECIPIENT_DRIFT_TEMPLATE` export appended at end-of-file; em-dash title + 3-slot shape
- `src/signing/handle-store.ts` — `PreparedTxEvm.bridgeParams?: { toAddress?: string }` additive optional field
- `src/protocols/bridge-decoders/index.ts` — NEW: `BridgeFacetDecodeResult` DU + empty `TIER1_DECODERS` map + `decodeBridgeTier1FacetRecipient` + `_bridgeTier1Decoders` ESM seam
- `test/bridge-decoders-index.test.ts` — NEW: 10 tests covering registry dispatch behaviors

## Decisions Made

- `bridgeParams?: { toAddress?: string }` optional bag vs top-level field: bag is cleaner and consistent with existing RESEARCH design decision (RESOLVED OQ-2 in RESEARCH.md) — non-breaking, no existing handle-construction site changes.
- `TIER1_DECODERS` empty in 39-01 with anchor comment: separates concerns — infrastructure (this plan) from per-bridge decoder implementation (39-02). Avoids coupling.
- `BridgeFacetDecodeResult` has three arms: `ok` / `no-match` / `error` — `error` is distinct from `no-match` so Layer 0.6 (Plan 39-03) can refuse on ABI-decode failures rather than silently passing.

## Deviations from Plan

None — plan executed exactly as written. All FROZEN-area files zero-diff vs origin/main.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 39-02 can now create `src/protocols/bridge-decoders/wormhole.ts`, `mayan-swift.ts`, `near-omnibridge.ts`, `across-v3.ts` and register their selectors in `TIER1_DECODERS` at the `// Plan 39-02 registers decoders here` anchor in `index.ts`.
- Plan 39-03 can wire `_bridgeTier1Decoders.decodeBridgeTier1FacetRecipient` into `preview_send.ts` Layer 0.6 and import `DECODED_RECIPIENT_DRIFT_TEMPLATE` from `blocks.ts`, reading `record.tx.bridgeParams?.toAddress` as the comparand.
- No blockers.

---
*Phase: 39-bridge-tier-1-facet-decoders-final-recipient-assertion*
*Completed: 2026-05-28*

## Self-Check: PASSED

- FOUND: `src/protocols/bridge-decoders/index.ts`
- FOUND: `test/bridge-decoders-index.test.ts`
- FOUND: `.planning/phases/39-bridge-tier-1-facet-decoders-final-recipient-assertion/39-01-SUMMARY.md`
- FOUND: commit `ef94a7e` (Task 1)
- FOUND: commit `5385b61` (Task 2)
- FOUND: commit `4dc4ab6` (Task 3 RED)
- FOUND: commit `08dfe11` (Task 3 GREEN)
- FOUND: commit `200cfd7` (metadata)
