---
phase: 41
plan: "41-02"
subsystem: compound-v3-multi-chain
tags: [compound-v3, multi-chain, arbitrum, polygon, base, optimism, ledger-notice, lifecycle-tests]
dependency_graph:
  requires: ["41-01"]
  provides: ["compound-v3-l2-tool-dispatch", "compound-v3-l2-ledger-notice", "compound-v3-l2-lifecycle-fixtures"]
  affects: ["preview_send", "get_compound_market_info", "get_lending_positions", "simulate_position_change", "prepare_compound_supply", "prepare_compound_withdraw", "prepare_compound_borrow", "prepare_compound_repay"]
tech_stack:
  added: []
  patterns: ["hardcoded-fixture-fingerprints", "esm-spy-affordance", "per-chain-comet-allowlist"]
key_files:
  created:
    - test/canonical-dispatch-compound-l2.test.ts
  modified:
    - src/tools/prepare_compound_supply.ts
    - src/tools/prepare_compound_withdraw.ts
    - src/tools/prepare_compound_borrow.ts
    - src/tools/prepare_compound_repay.ts
    - src/tools/get_compound_market_info.ts
    - src/tools/get_lending_positions.ts
    - src/tools/simulate_position_change.ts
    - src/tools/preview_send.ts
    - test/signing-fingerprint.test.ts
    - test/compound-v3-lifecycle.integration.test.ts
    - test/chains-compound-v3.test.ts
    - test/security-canonical-dispatch.test.ts
    - test/simulate-position-change.test.ts
    - test/get-compound-market-info.test.ts
    - test/get-lending-positions.test.ts
    - test/prepare-compound-supply.test.ts
    - test/prepare-compound-withdraw.test.ts
    - test/prepare-compound-borrow.test.ts
    - test/prepare-compound-repay.test.ts
    - test/integration/safe-get-transaction.test.ts
    - test/integration/safe-three-step-flow.test.ts
decisions:
  - "Removed chainName !== 'ethereum' hard-gates from all 6 Compound tool files; chain enum widened to all 5 supported chains"
  - "Removed record.tx.chainId === 1 guard from isCompoundComet in preview_send.ts (Rule 2: LEDGER NOTICE must fire on all chains with Comets)"
  - "Hardcoded 4 L2 payloadFingerprint fixtures as 0x literals (FIXTURE_CMP_ARB/BASE/OPT/POLY_A); never beforeAll-snapshot per CLAUDE.md"
  - "Address coincidence (0x9c4ec768...) is Arbitrum USDC Comet but NOT Base — dispatch test asserts membership on correct chain only"
  - "FROZEN-area zero-diff confirmed for all 8 frozen files; preview_send.ts is explicitly NOT frozen"
metrics:
  duration_minutes: 20
  completed_date: "2026-05-29T06:42:45Z"
  tasks_completed: 3
  files_modified: 21
---

# Phase 41 Plan 02: Compound V3 L2 tool dispatch + lifecycle tests Summary

Remove all remaining Ethereum-mainnet-only gates from 6 Compound V3 tool files, wire up multi-chain LEDGER NOTICE in preview_send, and add hardcoded cross-chain payloadFingerprint fixtures with full lifecycle round-trip tests for Arbitrum/Polygon/Base/Optimism.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Remove `chainName !== "ethereum"` hard-gates from 6 tool files; widen chain enums | 64e52b5 |
| 2 | Add FIXTURE_CMP_{ARB,BASE,OPT,POLY}_A hardcoded fixtures + L2 dispatch-coverage test | a359d5e |
| 3 | Compound V3 L2 lifecycle round-trips + preview_send multi-chain fix + 11 regression fixes | 2fa6083 |

## What Was Built

**Task 1 — Tool gate removal (6 files):**
- `prepare_compound_supply/withdraw/borrow/repay.ts`: removed `if (chainName !== "ethereum") { return INVALID_INPUT }` block and v2.3-lock comment; description updated to list all 5 chains; chain enum widened from `["ethereum"]` to all 5.
- `get_compound_market_info.ts`: description updated; enum widened; no handler gate existed (already used `getAllCompoundCometsForChain`).
- `get_lending_positions.ts`: Compound fan-out guard changed from `chainId === 1` to `getAllCompoundCometsForChain(chainId).length > 0`; same for display text gate.
- `simulate_position_change.ts`: removed `if (input.chainId !== 1) { return INVALID_INPUT }` block; changed `getAllCompoundCometsForChain(1)` → `getAllCompoundCometsForChain(input.chainId)`; `SimulateCompoundInput.chainId` type widened from `number` to `ChainId`.

**Task 2 — Fixtures and dispatch coverage:**
- `test/signing-fingerprint.test.ts`: 4 hardcoded `0x...` constants at top-level (required for ESM export); 4 fixture assertions + Set.size===5 distinctness test inside `describe("computePayloadFingerprint")`.
- `test/canonical-dispatch-compound-l2.test.ts` (new file): per-chain Comet count assertions (`{42161: 4, 137: 2, 8453: 4, 10: 3}`); per-Comet `allowlist.has()` assertions for every L2; address-coincidence test for `0x9c4ec768...` (Arb IN, Base NOT IN).

**Task 3 — Lifecycle tests + regression fixes:**
- `test/compound-v3-lifecycle.integration.test.ts`: added `L2_SUPPLY_CASES` + `describe("Phase 41 — Compound V3 L2 lifecycle round-trips")` with 4 per-chain prepare→preview→send round-trips (each asserting no chain-gate refusal, fingerprint matches fixture, LEDGER NOTICE present, send completes) and 1 Arbitrum persona-determinism test.
- `src/tools/preview_send.ts` (Rule 2 deviation): removed `record.tx.chainId === 1` guard from `isCompoundComet`; `getAllCompoundCometsForChain(1)` → `getAllCompoundCometsForChain(record.tx.chainId as ChainId)`. Without this fix, L2 Compound transactions would never emit the LEDGER NOTICE.
- 11 regression test files updated to reflect Phase 41 multi-chain behaviour (see Deviations section).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] LEDGER NOTICE not emitted for L2 Compound transactions**
- **Found during:** Task 3 (lifecycle integration test — Arbitrum round-trip failed to find LEDGER NOTICE)
- **Issue:** `preview_send.ts` had `record.tx.chainId === 1` hard-gate in `isCompoundComet`, preventing LEDGER NOTICE emission on any L2 chain regardless of Task 1's tool gate removal.
- **Fix:** Removed the `record.tx.chainId === 1` condition; replaced `getAllCompoundCometsForChain(1)` with `getAllCompoundCometsForChain(record.tx.chainId as ChainId)`. Comment updated to reflect Phase 41 scope.
- **Files modified:** `src/tools/preview_send.ts`
- **Commit:** 2fa6083

**2. [Rule 1 - Bug] 11 regression test files asserting old mainnet-only behaviour**
- **Found during:** Task 3 post-commit full suite run
- **Issues:**
  - `test/prepare-compound-{supply,withdraw,borrow,repay}.test.ts`: asserted `enum: ["ethereum"]`
  - `test/get-compound-market-info.test.ts`: asserted description contains `cUSDCv3`/`cWETHv3`
  - `test/get-lending-positions.test.ts`: asserted Arbitrum Compound arm empty
  - `test/chains-compound-v3.test.ts`: asserted `getAllCometStates(client, 42161, WALLET)` returns `[]`
  - `test/security-canonical-dispatch.test.ts`: asserted `getAllCompoundCometsForChain` returns `[]` on non-mainnet
  - `test/simulate-position-change.test.ts`: asserted Arbitrum+canonical Comet → `INVALID_INPUT`
  - `test/integration/safe-get-transaction.test.ts` + `safe-three-step-flow.test.ts`: FROZEN-area diff snapshot did not include Phase 41 authorized deletion fragments
- **Fix:** Updated all 11 files to reflect Phase 41 multi-chain behaviour; extended authorized-fragments lists in the two FROZEN-area diff tests.
- **Commit:** 2fa6083

**3. [Rule 3 - Blocking] ESM export inside describe block**
- **Found during:** Task 2 (esbuild transform error: "Unexpected export")
- **Issue:** First attempt placed `export const FIXTURE_CMP_ARB_A = ...` inside the `describe` block.
- **Fix:** Moved all 4 `export const` declarations to top-level before the `describe` block.
- **Commit:** a359d5e

**4. [Rule 1 - Bug] Wrong domain tag in fixture pre-computation**
- **Found during:** Task 2 (fixture mismatch vs Fixture R)
- **Issue:** First computed fixtures with `VaultPilot-tx-v1:` tag; actual tag is `VaultPilot-txverify-v1:` (23 bytes).
- **Fix:** Recomputed all 4 fixtures with correct tag and verified against Fixture R.
- **Commit:** a359d5e

## FROZEN-Area Verification

Zero-diff confirmed for all 8 frozen files:
- `src/signing/payload-fingerprint.ts` — UNCHANGED
- `src/signing/presign-hash.ts` — UNCHANGED
- `src/signing/handle-store.ts` — UNCHANGED
- `src/tools/send_transaction.ts` — UNCHANGED
- `src/protocols/compound-v3.ts` — UNCHANGED
- `src/security/canonical-dispatch.ts` — UNCHANGED
- `src/chains/registry.ts` — UNCHANGED
- `src/chains/compound-v3.ts` — UNCHANGED

`preview_send.ts` is NOT in the frozen list — the Rule 2 deviation is authorized.

## Known Stubs

None. All 4 L2 chains have live Comet addresses wired through SOT; lifecycle tests use real RPC-mocked prepare→preview→send flows.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary-crossing changes introduced. The `isCompoundComet` change narrows to SOT-canonical per-chain Comets — no surface expansion.

## Self-Check: PASSED

- SUMMARY.md: present at `.planning/phases/41-.../41-02-SUMMARY.md`
- Task 1 commit 64e52b5: present
- Task 2 commit a359d5e: present
- Task 3 commit 2fa6083: present
- Full suite: 5254 tests passing, 1 skipped, 0 failing
- FROZEN-area zero-diff: confirmed (0 lines diff across all 8 frozen files)
