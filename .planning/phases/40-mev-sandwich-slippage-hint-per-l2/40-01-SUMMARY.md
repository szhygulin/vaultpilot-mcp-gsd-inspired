---
phase: 40-mev-sandwich-slippage-hint-per-l2
plan: 01
subsystem: security
tags: [sandwich-mev, per-chain, uniswap, sunswap, curve, error-codes, slippage, polygon, arbitrum, optimism, base]

# Dependency graph
requires:
  - phase: 32-uniswap-v3-swap
    provides: "Phase-32 sandwich-MEV gate (fixed 200bps / INVALID_INPUT) that Phase 40 parametrizes per-chain"
  - phase: 20-tron-sunswap
    provides: "TRON sandwich gate (fixed 200bps / INVALID_INPUT) whose errorcode migrates to SANDWICH_MEV_REFUSED"
  - phase: 34-curve-swap
    provides: "prepare_curve_swap explicit-slippage-only model (gate-free by design) whose CHECKS-PERFORMED note is updated"
  - phase: 39-bridge-tier1-recipient
    provides: "DECODED_RECIPIENT_DRIFT as the prior tail of the ErrorCode union (SANDWICH_MEV_REFUSED appended after it)"
provides:
  - "src/config/sandwich-mev-thresholds.ts: per-chain SANDWICH_MEV_THRESHOLDS Record<ChainId,{defaultSlippageBps,priceImpactRefusalPct}> + getSandwichThresholds resolver + InvalidMevThresholdError"
  - "SANDWICH_MEV_REFUSED ErrorCode (appended after DECODED_RECIPIENT_DRIFT in error-codes.ts)"
  - "prepare_uniswap_swap: per-chain gate using getSandwichThresholds(chainId) + enriched SANDWICH_MEV_REFUSED refusal naming chain+thresholds+actual impact"
  - "prepare_sunswap_swap: errorcode-only migration INVALID_INPUT → SANDWICH_MEV_REFUSED on sandwich path"
  - "prepare_curve_swap: updated CHECKS-PERFORMED note (Uniswap-scoped per-L2 SOT, Curve explicit-slippage-only)"
  - "get_uniswap_quote: warning threshold wired to getSandwichThresholds(1).priceImpactRefusalPct*100 (ethereum SOT bar, no behavior change)"
  - "SECURITY.md: per-L2 sandwich-MEV threat-model section + Phase 40 threat register + v2.6 milestone close-out"
affects: [future-evm-swap-tools, sandwich-mev-gate, per-chain-calibration, error-code-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-chain SOT: Record<ChainId,T> keyed on ChainId literal-union — mirrors CONTRACTS_RAW + PUBLICNODE_RPC_URLS shape"
    - "Lazy env-read at call time (not module load): process.env[varName] inside resolver function, never cached at module level"
    - "Strict integer parse: /^[1-9][0-9]*$/ regex + Number() + range check [1,10000] — decimal-place-mistake defense"
    - "InvalidMevThresholdError: typed error class with chain+rawValue; consuming tools catch and map to SANDWICH_MEV_REFUSED envelope"

key-files:
  created:
    - src/config/sandwich-mev-thresholds.ts
    - test/sandwich-mev-thresholds.test.ts
  modified:
    - src/signing/error-codes.ts
    - src/tools/prepare_uniswap_swap.ts
    - src/tools/prepare_sunswap_swap.ts
    - src/tools/prepare_curve_swap.ts
    - src/tools/get_uniswap_quote.ts
    - test/prepare-uniswap-swap.test.ts
    - test/prepare-sunswap-swap.test.ts
    - test/prepare-curve-swap.test.ts
    - SECURITY.md

key-decisions:
  - "Per-chain SOT keys on ChainId literal-union from contracts.ts; 5 EVM chains: ethereum 50/2.0, polygon 100/2.0, arbitrum/optimism/base 30/3.0"
  - "Override semantics: MEV_THRESHOLD_<CHAIN> mutates defaultSlippageBps ONLY; priceImpactRefusalPct stays from the table"
  - "Invalid env override refuses (throws InvalidMevThresholdError) — refuse-on-invalid posture, not silently-fall-back"
  - "TRON (SunSwap): errorcode-only migration; TRON is NOT in EVM SOT; 200bps threshold + template stay TRON-specific"
  - "Curve stays gate-free by design; no price-impact gate added; CHECKS-PERFORMED + file-header notes updated only"
  - "get_uniswap_quote warning wired to getSandwichThresholds(1) at call site — consistency, no behavior change (ethereum bar = 200bps)"
  - "SECURITY.md append-only: Phase 32 byte-anchored prose unchanged; new section appended at end"

patterns-established:
  - "Per-chain SOT pattern: module-const Record<ChainId,T> + resolver function with lazy env override + typed error class"
  - "Discriminated test migration: only sandwich-path INVALID_INPUT assertions flip to SANDWICH_MEV_REFUSED; other INVALID_INPUT cases left unchanged"

requirements-completed: [MEV-01]

# Metrics
duration: 15min
completed: 2026-05-28
---

# Phase 40 Plan 01: Per-chain Sandwich-MEV Thresholds Summary

**Per-chain sandwich-MEV SOT (5 EVM chains) + SANDWICH_MEV_REFUSED errorCode spanning Uniswap (per-chain bar) + SunSwap (TRON fixed 200bps), closing v2.6 milestone (MEV-01)**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-28T22:45:00Z
- **Completed:** 2026-05-28T22:54:00Z
- **Tasks:** 3 (Task 1 TDD RED+GREEN, Task 2 tool migration + tests, Task 3 SECURITY.md)
- **Files modified:** 11 (2 created, 9 modified)

## Accomplishments

- `src/config/sandwich-mev-thresholds.ts`: per-chain SOT + `getSandwichThresholds` resolver with lazy `MEV_THRESHOLD_<CHAIN>` env override (strict integer parse, refuse-on-invalid) + `InvalidMevThresholdError` typed error class
- `SANDWICH_MEV_REFUSED` appended to `ErrorCode` union (append-only, after `DECODED_RECIPIENT_DRIFT`); spans two producers: EVM per-chain (Uniswap) + TRON fixed 200bps (SunSwap)
- `prepare_uniswap_swap`: gate parametrized per-chain; `InvalidMevThresholdError` maps to `SANDWICH_MEV_REFUSED`; refusal envelope enriched with chain + threshold values + actual priceImpactBps
- `prepare_sunswap_swap`: errorcode-only migration; TRON 200bps threshold/template/hintTool unchanged
- `prepare_curve_swap`: CHECKS-PERFORMED note + file-header updated to reference per-L2 SOT being Uniswap-scoped; Curve stays gate-free, zero logic change
- `get_uniswap_quote`: warning threshold wired to `getSandwichThresholds(1)` call-site; no behavior change (ethereum bar = 200bps)
- SECURITY.md per-L2 sandwich-MEV threat-model section + Phase 40 threat register (5 threats) + v2.6 milestone close-out
- Full test suite: 5108 passed / 1 skipped across 348 test files; FROZEN set zero-diff vs origin/main; tsc clean

## Task Commits

Each task was committed atomically:

1. **Task 1 RED** - `7d6c5e9` (test: failing tests for per-chain SOT)
2. **Task 1 GREEN** - `76290fd` (feat: per-chain SOT + SANDWICH_MEV_REFUSED errorCode)
3. **Task 2** - `64ab02c` (feat: migrate Uniswap/SunSwap gates + Curve note + quote warning)
4. **Task 3** - `3f5afd9` (docs: SECURITY.md per-L2 section + v2.6 close-out)

## Files Created/Modified

- `src/config/sandwich-mev-thresholds.ts` — Per-chain SOT + getSandwichThresholds resolver + InvalidMevThresholdError (new file)
- `test/sandwich-mev-thresholds.test.ts` — 22 unit tests: table values, env override, lazy call-time, invalid values, boundary, per-chain bar differential (new file)
- `src/signing/error-codes.ts` — Append SANDWICH_MEV_REFUSED after DECODED_RECIPIENT_DRIFT (append-only)
- `src/tools/prepare_uniswap_swap.ts` — Per-chain threshold resolution; gate uses priceImpactRefusalPct*100; SANDWICH_MEV_REFUSED; enriched refusal text; remove dead module consts
- `src/tools/prepare_sunswap_swap.ts` — Errorcode INVALID_INPUT → SANDWICH_MEV_REFUSED on sandwich path only
- `src/tools/prepare_curve_swap.ts` — CHECKS-PERFORMED + header note updated; zero logic change
- `src/tools/get_uniswap_quote.ts` — Warning threshold wired to getSandwichThresholds(1) call-site
- `test/prepare-uniswap-swap.test.ts` — T6 flip to SANDWICH_MEV_REFUSED + chain/threshold/impact assertions + invalid env test
- `test/prepare-sunswap-swap.test.ts` — Test 6 flip to SANDWICH_MEV_REFUSED
- `test/prepare-curve-swap.test.ts` — Update T14 for new note; add T16/T16b Curve-never-emits-SANDWICH_MEV_REFUSED
- `SECURITY.md` — Append per-L2 MEV section + Phase 40 threat register + v2.6 milestone close-out

## Decisions Made

- Per-chain SOT covers all 5 EVM chains — future tools opt in by calling `getSandwichThresholds(chainId)`.
- Override scope: `defaultSlippageBps` ONLY (priceImpactRefusalPct stays from table) — keeps it simple per CONTEXT.
- Refuse-on-invalid (not silently fall back): empty string set explicitly is also invalid, distinct from var unset.
- Discriminated test migration: only sandwich-path INVALID_INPUT assertions flip; non-sandwich INVALID_INPUT cases left unchanged.
- The `2.0` value formats as `"2"` in JS; test uses `/2%|2\.0%/` to avoid format brittleness.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Empty string env override treated as "unset" instead of "invalid"**
- **Found during:** Task 1 GREEN (test run against implementation)
- **Issue:** Initial implementation treated `process.env.MEV_THRESHOLD_ETHEREUM = ""` as "var is unset" (returns default). But behavior spec lists `""` as invalid.
- **Fix:** Split the check — `raw === undefined` → return default; `raw.trim().length === 0` (set-but-empty) → throw InvalidMevThresholdError. This preserves "truly unset" returning the default while "set to empty" refusing.
- **Files modified:** `src/config/sandwich-mev-thresholds.ts`
- **Committed in:** 76290fd (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Necessary for correct behavior of the invalid-override guard. No scope creep.

## Issues Encountered

None beyond the auto-fixed empty-string edge case above.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. All changes are within existing MCP tool handlers and configuration modules. FROZEN trust-pipeline files (`payload-fingerprint.ts`, `presign-hash.ts`, `send_transaction.ts`, `handle-store.ts`) have zero diff vs `origin/main`.

## Next Phase Readiness

v2.6 milestone is code-complete. Deferred items:
- Real-Ledger smoke testing per 40-VALIDATION.md Manual-Only Verifications (live per-L2 swap against each chain to exercise the threshold)
- Tier-2 bridge facet decoders (deBridge/DLN, Stargate, Hop, Symbiosis) — documented in REQUIREMENTS.md as out-of-scope for v2.6

## Self-Check: PASSED

Files exist:
- `src/config/sandwich-mev-thresholds.ts` ✓
- `test/sandwich-mev-thresholds.test.ts` ✓
- `SECURITY.md` contains "Sandwich-MEV per-L2" ✓

Commits exist:
- 7d6c5e9 (RED test) ✓
- 76290fd (GREEN implementation) ✓
- 64ab02c (Task 2 migration) ✓
- 3f5afd9 (Task 3 SECURITY.md) ✓

Full suite: 5108 passed / 0 failed ✓
FROZEN zero-diff: FROZEN_ZERO_DIFF_OK ✓
tsc --noEmit: clean ✓

---
*Phase: 40-mev-sandwich-slippage-hint-per-l2*
*Completed: 2026-05-28*
