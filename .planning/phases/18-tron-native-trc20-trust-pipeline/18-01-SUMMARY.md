---
phase: 18-tron-native-trc20-trust-pipeline
plan: 18-01
subsystem: signing-primitives
tags: [tron, fingerprint, simulation, handle-store, canonical-dispatch, trc20, trx]
dependency_graph:
  requires: []
  provides:
    - src/signing/payload-fingerprint-tron.ts
    - src/signing/presign-hash-tron.ts
    - src/signing/simulation-tron.ts
    - src/signing/blocks-tron.ts
    - src/signing/amount-tron.ts
    - src/security/canonical-dispatch-tron.ts
    - src/signing/handle-store.ts (additive widening)
  affects:
    - src/signing/handle-store.ts
tech_stack:
  added:
    - tronweb@6.3.0 (Phase 17 already wired; Plan 18-01 consumes type imports)
    - viem keccak256 (TRON fingerprint DF-1)
    - Node crypto sha256 (TRON presign hash DF-2)
  patterns:
    - Classifier-vs-consumer split (simulation-tron: NEVER-throws contract)
    - ESM spy-affordance indirection (_tronFingerprint, _tronPresign, _simulationTron, _canonicalDispatchTron)
    - Hardcoded cryptographic-binding fixture literals (Fixtures M + N)
    - Sentinel-zero EVM fields on PreparedTxTron (enables zero-narrowing at EVM call sites)
    - Format-fanout-sentinel discipline (blocks-tron.ts sole source of template strings)
key_files:
  created:
    - src/signing/payload-fingerprint-tron.ts
    - src/signing/presign-hash-tron.ts
    - src/signing/simulation-tron.ts
    - src/signing/blocks-tron.ts
    - src/signing/amount-tron.ts
    - src/security/canonical-dispatch-tron.ts
    - test/signing-fingerprint-tron.test.ts
    - test/signing-presign-hash-tron.test.ts
    - test/simulation-tron.test.ts
    - test/blocks-tron.test.ts
    - test/amount-tron.test.ts
    - test/canonical-dispatch-tron.test.ts
    - test/handle-store.tron.test.ts
  modified:
    - src/signing/handle-store.ts (PreparedTxTron + TronInstructionSummary + PrepareArgs TRON fields)
decisions:
  - D-01 (TRON fingerprint preimage = keccak256("VaultPilot-trontx-v1:" ‖ raw_data_bytes) — 21-byte domain tag, chain-distinct)
  - D-02 (TRON presign hash = SHA-256(raw_data_bytes) = transaction.txID — Ledger TRX app blind-sign display)
  - D-03 (classifier-vs-consumer: runTronPreviewSimulation classifies, preview_send enforces asymmetric TRC-20 refusal vs native advisory)
  - D-07 (parseTronAmountStrict with overflowBound: "u64" | "u256" discriminator — single helper for both native TRX and TRC-20)
  - D-08 (Fixtures M + N hardcoded 0x... literals in new sibling test file)
  - D-11 (canonical-dispatch-tron sourced from tron-top-25.json SOT, NOT hardcoded — 4-entry stablecoin set)
metrics:
  duration: ~90 minutes
  completed: 2026-05-20
  tasks_completed: 14
  files_created: 13
  files_modified: 1
  tests_added: 101
  tests_total: 1927
---

# Phase 18 Plan 01: TRON Signing Primitives Shelf Summary

TRON signing primitives shelf: keccak256 domain-tagged payloadFingerprint (DF-1), SHA-256 presign hash (DF-2 = transaction.txID), simulation helper with asymmetric native/TRC-20 posture, 7 template blocks, u64/u256-discriminated amount parsing, 4-entry TRC-20 stablecoin canonical-dispatch allowlist, and handle-store widened to `PreparedTxTron`.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Rescue 3 pre-built files (fingerprint + presign + simulation) | 774c51e |
| 2 | blocks-tron.ts — 7 template constants | 57cda8f |
| 3 | amount-tron.ts — parseTronAmountStrict + u64/u256 + InvalidAmountError | ca19af4 |
| 4 | canonical-dispatch-tron.ts — 4-entry TRC-20 allowlist from JSON SOT | c5bc0a7 |
| 5 | handle-store.ts — PreparedTxTron + TronInstructionSummary + PrepareArgs widening | e9b4e7b |
| 6 | test/signing-fingerprint-tron.test.ts + test/signing-presign-hash-tron.test.ts | 6ef54f2 |
| 7 | test/simulation-tron.test.ts + test/blocks-tron.test.ts + test/amount-tron.test.ts | f21a173 |
| 8 | test/canonical-dispatch-tron.test.ts + test/handle-store.tron.test.ts | 7445484 |

## Cryptographic Fixture Anchors (Fixtures M + N)

Hardcoded literals in `test/signing-fingerprint-tron.test.ts`:

- **Fixture M** (native TRX, 1 TRX, pinned ref-block):
  - `payloadFingerprint = 0xaa8305509481b97e50acb9e4d582bb53a1db1c99f9c357febe1fbf7389ffd4fa`
  - `presignHash = 0xa056782c3943d1a0c94c6eb30c6175b34c47cf8f42a2e88f95bbadcb22fbf400`
  - raw_data_bytes length: 133 bytes

- **Fixture N** (TRC-20 USDT transfer, 100 USDT, same ref-block):
  - `payloadFingerprint = 0xffa617dd3396eb038869b98e7385aa302e4ff69ed4d7cabe4904370c5015b520`
  - raw_data_bytes length: 211 bytes

- **Domain tag**: `"VaultPilot-trontx-v1:"` — exactly 21 UTF-8 bytes (chain-distinct from EVM 23-byte + Solana 20-byte)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] USDD address in plan's execution_context was wrong**
- **Found during:** Task 4 (canonical-dispatch-tron.ts)
- **Issue:** Plan's hardcoded USDD address `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` is actually WTRX in `tron-top-25.json`. The plan's own instruction said "pull from `src/tokens/tron-top-25.json` rather than hardcoding — single source of truth." The correct USDD address per JSON SOT is `TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn` (18 decimals).
- **Fix:** `canonical-dispatch-tron.ts` filters `tron-top-25.json` by symbol (`USDT`, `USDC`, `USDD`, `TUSD`) so USDD resolves to the correct address from the SOT.
- **Files modified:** `src/security/canonical-dispatch-tron.ts`, `test/canonical-dispatch-tron.test.ts`
- **Commit:** c5bc0a7

**2. [Rule 1 - Bug] Fixture M/N TO address in plan was invalid**
- **Found during:** Task 5 (computing Fixture M/N literals)
- **Issue:** Plan's suggested `TO = "TQrZ8tQyZ8eaQ8wKy3qYWxTrL2eBhTPBJ4"` fails `TronWeb.isAddress()` — not a valid TRON base58check address.
- **Fix:** Replaced with `"TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8"` (USDC contract — a known stable valid TRON address used as a deterministic test recipient).
- **Files modified:** `test/signing-fingerprint-tron.test.ts`, `test/signing-presign-hash-tron.test.ts`
- **Commit:** 6ef54f2

**3. [Rule 2 - Critical functionality] Test fixture approach: hardcoded raw_data_hex instead of internal tronweb CJS paths**
- **Found during:** Test writing
- **Issue:** The plan suggested using tronweb's internal `txJsonToPb` serializer directly in tests. This path (`tronweb/lib/commonjs/utils/transaction.js`) is not exported in tronweb's `package.json` `exports` map — ESM restrictions block access in vitest.
- **Fix:** Computed the deterministic Protobuf-serialized `raw_data_hex` bytes once (via a discardable node script using the CJS path in the main repo context), then hardcoded the hex literal in the test file. This is actually more correct per CLAUDE.md "Cryptographic-binding fixtures pinned as hardcoded literals" — the fixture is now a pure constant with zero network or SDK dependency.
- **Files modified:** `test/signing-fingerprint-tron.test.ts`, `test/signing-presign-hash-tron.test.ts`
- **Commit:** 6ef54f2

## Test Results

- **New tests added:** 101 (across 7 new test files)
- **Total tests:** 1927 (all pass)
- **Full suite:** `npm test` — 1927 passed, 0 failed (pre-existing flaky timer test in `wallet-session-manager.test.ts` passes when run in isolation; intermittent in full suite; unrelated to Plan 18-01)
- **Build:** `npm run build` — clean (no errors)
- **FROZEN-area assertion:** `git diff origin/main -- [frozen files]` — empty (zero modifications)

## Known Stubs

None — this plan ships primitives only. Plans 18-02 + 18-03 wire the actual `prepare_tron_native_send` and `prepare_tron_trc20_send` tools that consume these primitives.

## Self-Check: PASSED

All 7 new source files created, handle-store.ts additively widened, all 7 new test files created. Commits verified in git log. FROZEN area byte-untouched. Full suite green.
