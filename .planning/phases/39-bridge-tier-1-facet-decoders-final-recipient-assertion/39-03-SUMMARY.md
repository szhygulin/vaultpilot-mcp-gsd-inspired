---
phase: 39-bridge-tier-1-facet-decoders-final-recipient-assertion
plan: 03
subsystem: signing
tags: [viem, bridge, evm, solana, security, mcp, layer-0.6, encoding-aware, integration-test]

# Dependency graph
requires:
  - phase: 39-bridge-tier-1-facet-decoders-final-recipient-assertion
    plan: 01
    provides: DECODED_RECIPIENT_DRIFT error code + template + PreparedTxEvm.bridgeParams?.toAddress
  - phase: 39-bridge-tier-1-facet-decoders-final-recipient-assertion
    plan: 02
    provides: _bridgeTier1Decoders ESM seam + four Tier-1 decoders registered in TIER1_DECODERS
provides:
  - preview_send Layer 0.6: bridge Tier-1 final-recipient assertion (Inv #6b EVM path)
  - Encoding-aware compare: EVM via getAddress; Solana base58 case-SENSITIVE; NEAR trim-only
  - Integration test covering mismatch refusal, layer ordering, DEX no-op, malformed no-throw,
    Solana encoding-aware case-sensitive regression guard
  - SECURITY.md Inv #6b section + Phase 39 threat register + companion-skill follow-up note
affects:
  - SECURITY.md (Phase 39 Inv #6b threat register appended)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Layer 0.6 separate if(data !== '0x') block: mirrors Layer 0.5 structure; FROZEN body byte-identical"
    - "Encoding-aware compare: EVM_ADDRESS_RE test dispatches to getAddress(both sides) vs trim-only case-sensitive"
    - "Empty userRecipient on ok result refuses (Pitfall 5 — no silent pass)"
    - "vi.mock bridge-decoders/index.js with ...actual spread; bridgeTier1DecoderSpy for forced outcomes"
    - "vi.importActual re-import for real-fixture tests (DEX no-op, Solana encoding-aware)"

key-files:
  modified:
    - src/tools/preview_send.ts
    - SECURITY.md
  created:
    - test/preview-send.bridge-tier1.test.ts

key-decisions:
  - "Layer 0.6 is a SEPARATE new if(data !== '0x') block — NOT nested inside Layer 0.5 — to preserve Layer 0.5 body byte-identity (FROZEN test in preview-send.solana.test.ts)"
  - "Encoding-aware compare uses EVM_ADDRESS_RE regex to branch: 0x+40hex → getAddress both sides; otherwise trim-only CASE-SENSITIVE (critical for Solana base58)"
  - "Integration tests use vi.importActual for real-decoder tests (DEX no-op, Solana) to exercise the actual registry without breaking the mock for other tests"

requirements-completed: [BRIDGE-T1-05, BRIDGE-T1-06]

# Metrics
duration: 10min
completed: 2026-05-28
---

# Phase 39 Plan 03: Layer 0.6 Bridge Tier-1 Final-Recipient Assertion Summary

**preview_send Layer 0.6 wired: Inv #6b EVM path — encoding-aware finalRecipient assertion with case-sensitive Solana base58 compare; 9 integration tests; SECURITY.md codified**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-28T17:05:59Z
- **Completed:** 2026-05-28T17:15:43Z
- **Tasks:** 3 (1 standard, 1 TDD, 1 standard)
- **Files modified:** 3 (1 modified, 1 created, 1 appended)

## Accomplishments

- Inserted Layer 0.6 `if (record.tx.data !== "0x") { ... }` block in `preview_send.ts` AFTER the Layer 0.5 closing brace and BEFORE the Layer 2 `if (typeof args.chain === "string")` chain-mismatch check
- Added three imports: `_bridgeTier1Decoders` from bridge-decoders/index.js; `DECODED_RECIPIENT_DRIFT_TEMPLATE` to blocks.ts import group; `PreparedTxEvm` type to handle-store import group
- Three-arm logic: `error` → refuse with decode error; `ok` → encoding-aware compare; `no-match` → pass through
- Encoding-aware compare: `EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/` dispatches to `getAddress(both sides)` for EVM, or `trim-only case-SENSITIVE` for Solana/NEAR — explicit code comment documents the branch
- Pitfall 5 handled: empty `userRecipient` (absent `bridgeParams.toAddress`) on `ok` result → mismatch path → refuse
- Layer 0.5 body byte-identical (FROZEN test `test/preview-send.solana.test.ts` still passes)
- Created `test/preview-send.bridge-tier1.test.ts` with 9 tests covering all BRIDGE-T1-05/T1-06 behaviors
- T-BRIDGE-SOLANA-NORM-1 regression guard: test 8 (exact-base58 MATCHES) + test 9 (lowercased-base58 REFUSES) prove case-sensitive compare
- Appended Phase 39 Inv #6b section to SECURITY.md (append-only): threat, control, centralization rationale, encoding-aware normalization, accepted residuals, threat register table, companion-skill follow-up note
- Full suite green: 5083 tests (5074 baseline → +9 new; 0 regressions; 347 test files)
- FROZEN-area zero-diff: `payload-fingerprint.ts`, `presign-hash.ts`, `send_transaction.ts`, `lifi-btc.ts` byte-identical to origin/main

## Task Commits

1. **Task 1: Insert Layer 0.6 bridge final-recipient assertion into preview_send.ts** — `c1d0747` (feat)
2. **Task 2: Integration test — Layer 0.6 mismatch refusal, ordering, DEX no-op, malformed no-throw, Solana encoding-aware compare** — `d8df640` (test)
3. **Task 3: Codify Inv #6b in SECURITY.md + Phase 39 threat register + companion-skill coordinated-bump note** — `8cc8d66` (docs)

## Files Created/Modified

- `src/tools/preview_send.ts` — Layer 0.6 block inserted; three new imports added
- `test/preview-send.bridge-tier1.test.ts` — NEW: 9 integration tests for Layer 0.6
- `SECURITY.md` — Inv #6b section + threat register + companion-skill note appended at end-of-file

## Decisions Made

- Separate `if (record.tx.data !== "0x")` block for Layer 0.6: the Layer 0.5 body has a FROZEN byte-identity test (`test/preview-send.solana.test.ts` "FROZEN EVM body byte-identity"). Nesting Layer 0.6 inside Layer 0.5 would modify the FROZEN body. Separate block is the correct structure.
- `EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/` for branch detection: detects both decoded finalRecipient AND user-supplied value as EVM. If either is not 0x+40hex, falls through to trim-only case-sensitive compare. This correctly handles Solana base58, NEAR account-ids, and unknown future encodings conservatively.
- Integration test uses `vi.importActual` inline for real-decoder tests: the module-level `vi.mock` replaces `_bridgeTier1Decoders` with the spy globally; tests needing the real registry call `vi.importActual` and set `bridgeTier1DecoderSpy.mockImplementation(...)` to delegate to the real function.

## Deviations from Plan

None — plan executed exactly as written. The RESEARCH §Pattern 3 naive `.toLowerCase()` compare was intentionally NOT used; the encoding-aware branch is more precise per the plan's CONTEXT critical_correctness_constraint.

## Issues Encountered

None.

## Known Stubs

None — Layer 0.6 is fully wired. All four decoders return real decoded recipients; the compare logic is encoding-aware and tested.

## Threat Flags

None — no new network endpoints, no new auth paths, no schema changes at trust boundaries. Layer 0.6 is a read-only assertion gate inside existing `preview_send.ts` control flow.

## Self-Check: PASSED

- FOUND: `src/tools/preview_send.ts` (modified — Layer 0.6 block + imports)
- FOUND: `test/preview-send.bridge-tier1.test.ts` (created)
- FOUND: `SECURITY.md` (Inv #6b section appended)
- FOUND: commit `c1d0747` (Task 1)
- FOUND: commit `d8df640` (Task 2)
- FOUND: commit `8cc8d66` (Task 3)
- VERIFIED: `npx tsc --noEmit` exits 0
- VERIFIED: `npx vitest run test/preview-send.bridge-tier1.test.ts` — 9 tests green
- VERIFIED: Full suite — 5083 tests (347 files); 0 regressions
- VERIFIED: Layer 0.5 FROZEN body — `test/preview-send.solana.test.ts` 14 tests green
- VERIFIED: SECURITY.md append-only — no deletion lines in `git diff origin/main -- SECURITY.md`
- VERIFIED: FROZEN zero-diff — `payload-fingerprint.ts`, `presign-hash.ts`, `send_transaction.ts`, `lifi-btc.ts`
