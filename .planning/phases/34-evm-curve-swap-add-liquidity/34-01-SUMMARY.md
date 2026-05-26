---
phase: 34-evm-curve-swap-add-liquidity
plan: 1
subsystem: config-sot, chains, security, test
tags: [curve, pool-registry, abi-shelf, fixtures, canonical-dispatch, known-spenders]
dependency_graph:
  requires: []
  provides:
    - getAllCurvePoolsForChain
    - getCurvePoolByAddress
    - CurvePoolEntry
    - CurvePoolAbiVersion
    - CURVE_LEGACY_EXCHANGE_ABI
    - CURVE_NG_EXCHANGE_ABI
    - CURVE_GET_DY_ABI
    - CURVE_NG_ADD_LIQUIDITY_ABI
    - CURVE_NG_CALC_TOKEN_AMOUNT_ABI
    - CURVE_LP_BALANCE_OF_ABI
    - getCurveGetDy
    - getCurveCalcTokenAmount
    - getCurveLpBalance
    - _curveChain
    - FIXTURE_CRV_A_FP
    - FIXTURE_CRV_B_FP
    - FIXTURE_CRV_C_FP
  affects:
    - src/security/canonical-dispatch.ts (Ethereum allowlist +11 entries)
    - KNOWN_SPENDERS_ETHEREUM (+11 Curve pool rows)
tech_stack:
  added: []
  patterns:
    - Curve pool registry SOT-getter pattern (D-13a loop promotion)
    - ESM spy-affordance indirection (_curveChain)
    - placeholder-literal workflow for fixture anchors
key_files:
  created:
    - src/chains/curve.ts
    - test/chains-curve.test.ts
  modified:
    - src/config/contracts.ts
    - src/security/canonical-dispatch.ts
    - test/config-contracts.test.ts
    - test/security-canonical-dispatch.test.ts
    - test/signing-fingerprint.test.ts
decisions:
  - CurvePoolAbiVersion discriminator dispatches by tag not heuristic ABI probing
  - KNOWN_SPENDERS promoted via SOT-getter loop not 11 hand-written literals (D-13a)
  - stable_ng lpToken === pool.address; legacy has separate ERC-20 (Pitfall 3 anchor)
  - Fixture CRV-C uses 2-coin amounts array (registry has only 2-coin pools at v2.4)
  - CANONICAL_DISPATCH_TARGETS[1].size grew from 40 to 51 (+11 Curve pool addresses)
metrics:
  duration: ~20 minutes
  completed: 2026-05-26
  tasks_completed: 3
  files_changed: 7
---

# Phase 34 Plan 1: Curve pool registry SOT + ABI shelf + Fixtures CRV-A/B/C Summary

Landed the load-bearing foundations for Phase 34: curated Curve pool registry (11 entries: 1 legacy stETH/ETH + 10 stable_ng plain pools), KNOWN_SPENDERS promotion, canonical-dispatch Curve arm, `src/chains/curve.ts` ABI shelf with reader helpers, and Fixtures CRV-A/B/C hardcoded payloadFingerprint literal anchors.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Curve pool registry SOT + KNOWN_SPENDERS promotion + canonical-dispatch arm | d5a214a | src/config/contracts.ts, src/security/canonical-dispatch.ts, test/config-contracts.test.ts, test/security-canonical-dispatch.test.ts |
| 2 | src/chains/curve.ts ABI shelf + reader helpers + ESM spy-affordance | dfde8d6 | src/chains/curve.ts (NEW), test/chains-curve.test.ts (NEW) |
| 3 | Fixtures CRV-A/B/C hardcoded payloadFingerprint literal anchors | f43039c | test/signing-fingerprint.test.ts |

## Files Added/Modified

### NEW: `src/chains/curve.ts` (~155 lines)
- 6 named `parseAbi` exports: CURVE_LEGACY_EXCHANGE_ABI (0x3df02124), CURVE_NG_EXCHANGE_ABI (0xddc1f59d), CURVE_GET_DY_ABI (0x5e0d443f), CURVE_NG_ADD_LIQUIDITY_ABI (0xb72df5de), CURVE_NG_CALC_TOKEN_AMOUNT_ABI (0x3db06dd8), CURVE_LP_BALANCE_OF_ABI (0x70a08231)
- 3 async reader helpers: getCurveGetDy, getCurveCalcTokenAmount, getCurveLpBalance
- `_curveChain` ESM spy-affordance indirection (CLAUDE.md convention — added at write time)

### NEW: `test/chains-curve.test.ts` (~150 lines)
- 6 ABI selector byte-identity tests (drift gate)
- 3 readContract mock-client tests (correct address/abi/functionName/args for each helper)
- `_curveChain` drift gate (3 keys, own properties)

### EXTENDED: `src/config/contracts.ts` (+~250 lines)
- `CurvePoolAbiVersion = "legacy" | "stable_ng"` type
- `CurvePoolEntry` interface with 6 load-bearing fields
- `CURVE_POOLS_RAW` with 11 pools on chainId=1 (1 legacy + 10 stable_ng), all wrapped in `getAddress()`
- `getAllCurvePoolsForChain(chainId)` getter
- `getCurvePoolByAddress(chainId, poolAddress)` lookup (case-insensitive via getAddress)
- 11 new KNOWN_SPENDERS_ETHEREUM rows via SOT-getter loop spread (D-13a pattern)

### EXTENDED: `src/security/canonical-dispatch.ts` (+10 lines)
- `getAllCurvePoolsForChain` added to import
- Curve arm in `buildPerChainAllowlist`: `const curveEntries = getAllCurvePoolsForChain(chainId).map(p => p.address)`
- `...curveEntries` spread into the Set builder

### EXTENDED: `test/config-contracts.test.ts` (+~100 lines)
- T-CURVE-REGISTRY-INTEGRITY-1: 11 entries, 1 legacy, 10 stable_ng, lpToken invariants
- T-CURVE-REGISTRY-DECIMALS-1: hardcoded-table coinDecimals cross-check
- T-CURVE-SPENDER-DRIFT-1: every pool has exactly 1 KNOWN_SPENDERS row with "Curve " prefix

### EXTENDED: `test/security-canonical-dispatch.test.ts` (+~40 lines, size assertions updated)
- Curve pool dispatch arm describe-block: all 11 pools in CANONICAL_DISPATCH_TARGETS[1]
- Non-Ethereum chains exclude Curve (D-03 carve)
- Size assertions updated: 40 → 51 (net +11 Curve pool addresses)

### EXTENDED: `test/signing-fingerprint.test.ts` (+~160 lines)
- Import: CURVE_LEGACY_EXCHANGE_ABI, CURVE_NG_EXCHANGE_ABI, CURVE_NG_ADD_LIQUIDITY_ABI, encodeFunctionData
- `export const FIXTURE_CRV_A_FP = "0xea4f7e878de8e5f570f446d1444786ecb23b16f4c0cdcc3e286af2966fc0be53"`
- `export const FIXTURE_CRV_B_FP = "0x91232f051349d2711e4259458489444ed3d9018073d9277220b3e0c753920c75"`
- `export const FIXTURE_CRV_C_FP = "0x2762d8badc0a798a9947b77dd56a5127bd4c65eb17b1daf6465590810edc063b"`
- 4-test describe block: CRV-A, CRV-B, CRV-C, 3-distinct assertion

## Test Counts

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| test/config-contracts.test.ts | 118 | 142 | +24 |
| test/security-canonical-dispatch.test.ts | 51 | 55 | +4 |
| test/chains-curve.test.ts | 0 (new) | 13 | +13 |
| test/signing-fingerprint.test.ts | 52 | 56 | +4 |
| **Total (full suite)** | ~4019 | 4064 | **+45** |

## FROZEN-Area Zero-Diff Invariant

`git diff --stat origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts` returns **ZERO lines** (confirmed).

## Verification Results

```
npx vitest run test/config-contracts.test.ts test/security-canonical-dispatch.test.ts test/chains-curve.test.ts test/signing-fingerprint.test.ts -x
→ 266 passed

npx vitest run (full suite)
→ 312 test files, 4064 passed | 1 skipped, 0 failed
```

## Fixture Anchors

| Fixture | Pool | tx.to | selector | from-dep? | FIXTURE_CRV_*_FP |
|---------|------|-------|----------|-----------|-----------------|
| CRV-A | stETH/ETH legacy | 0xDC24316b... | 0x3df02124 | NO | 0xea4f7e878de8e5f570f446d1444786ecb23b16f4c0cdcc3e286af2966fc0be53 |
| CRV-B | PayPool stable_ng | 0x383E6b44... | 0xddc1f59d | YES (_receiver=FIXTURE_PERSONA) | 0x91232f051349d2711e4259458489444ed3d9018073d9277220b3e0c753920c75 |
| CRV-C | PayPool stable_ng | 0x383E6b44... | 0xb72df5de | NO | 0x2762d8badc0a798a9947b77dd56a5127bd4c65eb17b1daf6465590810edc063b |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Updated existing tests] Ethereum allowlist size assertions updated 40 → 51**
- **Found during:** Task 1 GREEN phase
- **Issue:** 4 existing hard-pinned size assertions in test/security-canonical-dispatch.test.ts expected exactly 40 entries; adding 11 Curve pool addresses made them 51.
- **Fix:** Updated all 4 assertions with explanatory comments documenting the Phase 34 net delta.
- **Files modified:** test/security-canonical-dispatch.test.ts
- **Commit:** d5a214a (Task 1 commit)

**2. [Rule 2 - Correct] Fixture CRV-C uses 2-coin array instead of "3-coin" from CONTEXT.md sketch**
- **Found during:** Task 3 planning
- **Issue:** CONTEXT.md §Fixture Anchors sketch said "3-coin pool" for CRV-C. But Phase 34 registry has only 2-coin pools (all 11 pools have coins.length === 2). The plan itself resolved this (Task 3 behavior section clearly says "Use a 2-coin amounts array").
- **Fix:** Used 2-coin amounts array as specified in the plan; CRV-C comment documents the discrepancy for future readers.
- **Commit:** f43039c

## Note for Plans 34-02 + 34-03 Executors

**Stable, consumable exports:**
- `getAllCurvePoolsForChain(chainId)` / `getCurvePoolByAddress(chainId, poolAddress)` — from `src/config/contracts.js`
- `_curveChain.getCurveGetDy`, `_curveChain.getCurveCalcTokenAmount`, `_curveChain.getCurveLpBalance` — from `src/chains/curve.js`
- `CURVE_LEGACY_EXCHANGE_ABI`, `CURVE_NG_EXCHANGE_ABI`, `CURVE_NG_ADD_LIQUIDITY_ABI`, `CURVE_GET_DY_ABI`, `CURVE_NG_CALC_TOKEN_AMOUNT_ABI`, `CURVE_LP_BALANCE_OF_ABI` — from `src/chains/curve.js`
- `FIXTURE_CRV_A_FP`, `FIXTURE_CRV_B_FP`, `FIXTURE_CRV_C_FP` (exported) — from `test/signing-fingerprint.js`

**DO NOT re-export or duplicate the pool registry literals** — import from `src/config/contracts.js` exclusively (CLAUDE.md SOT discipline).

## Self-Check: PASSED

- src/chains/curve.ts: FOUND
- test/chains-curve.test.ts: FOUND
- Commits d5a214a, dfde8d6, f43039c: FOUND
- FIXTURE_CRV_A/B/C export const: 3 lines confirmed
- FROZEN files diff: 0 lines confirmed
- Full suite: 4064 passed, 0 failed
