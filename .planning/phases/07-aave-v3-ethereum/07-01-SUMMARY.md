---
phase: 07
plan: 01
slug: aave-v3-contracts-sot
subsystem: config-sot
tags: [aave-v3, contracts, sot, phase-7, wave-1, prerequisite]
requirements: [PREP-24]
wave: 1
status: complete
completed: 2026-05-13
dependency-graph:
  requires:
    - "src/config/contracts.ts (Plan 06-03 first-occupant SOT)"
    - "KNOWN_SPENDERS_ETHEREUM (Plan 06-03 — Aave V3 Pool at row 0)"
  provides:
    - "ContractsForChain 6-field interface (was 1: `weth`; +5 aave-v3 typed slots)"
    - "5 getter functions for Aave V3 Ethereum typed slots"
    - "Cross-view consistency anchor between typed-slot accessor and spender row"
  affects:
    - "src/config/contracts.ts (MODIFY)"
    - "test/config-contracts.test.ts (MODIFY — +8 cases)"
  unblocks:
    - "07-02 (get_lending_positions — consumes getAaveV3UiPoolDataProvider + getAaveV3PoolAddressesProvider)"
    - "07-03 (prepare_aave_supply / withdraw / simulate_position_change — consumes getAaveV3PoolAddress)"
    - "07-04 (check_contract_security — independent of these addresses but Phase-7-gated on wave-1 land)"
tech-stack:
  added: []
  patterns:
    - "first-occupant SOT extension (additive only; no shape change to existing surface)"
    - "EIP-55 corrupted-snapshot guard at module load (`getAddress(...)` wrap at every literal site)"
    - "ChainId literal-union narrowing (compile-time chain-leak prevention)"
    - "cross-view byte-identity anchor (typed slot ↔ known-spender row)"
key-files:
  created: []
  modified:
    - "src/config/contracts.ts (+81 net lines: interface widening + 5 literals + 5 getters + obsolete-comment edit)"
    - "test/config-contracts.test.ts (+59 net lines: 8 new assertions + 5 imports)"
decisions:
  - "Kept file-header comment (lines 5-6) untouched even though it's slightly stale post-Phase-7 — minimal-diff discipline; the obsolete-comment edit was scoped to lines 76-82 per the plan."
  - "Mirrored `getWethAddress` shape verbatim for all 5 new getters (no `_<scope>` ESM spy-affordance wrapping needed — none of the new getters are called by another export internally; downstream consumers will import them directly)."
metrics:
  duration: "~25 minutes"
  tasks-completed: 1
  files-modified: 2
  tests-before: 474
  tests-after: 482
  tests-delta: 8
  loc-delta: "+140 / -13"
---

# Phase 7 Plan 07-01: Aave V3 Contracts SOT Extension Summary

Wave 1 prerequisite extending Plan 06-03's `src/config/contracts.ts` first-occupant SOT with 5 cross-verified Aave V3 Ethereum addresses as typed slots on `ContractsForChain` + 5 getter functions. Pure-additive — no behavior change to existing exports, FROZEN cryptographic-binding chain untouched.

## What Shipped

**`src/config/contracts.ts`:**
- `ContractsForChain` interface widened 1 → 6 fields. New fields: `aavePool`, `aavePoolAddressesProvider`, `aaveUiPoolDataProvider`, `aaveOracle`, `aaveIncentivesController`.
- `CONTRACTS_RAW[1]` populated with all 5 Aave V3 literals from research § Topic 1, each `getAddress(...)`-wrapped at the literal site:
  - Pool: `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` (proxy)
  - PoolAddressesProvider: `0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e`
  - UiPoolDataProviderV3: `0x56b7A1012765C285afAC8b8F25C69Bf10ccfE978`
  - AaveOracle: `0x54586bE62E3c3580375aE3723C145253060Ca0C2`
  - IncentivesController: `0x8164Cc65827dcFe994AB23944CBC90e0aa80bFcb`
- 5 new getters exported, each mirroring `getWethAddress`'s shape: `getAaveV3PoolAddress`, `getAaveV3PoolAddressesProvider`, `getAaveV3UiPoolDataProvider`, `getAaveV3Oracle`, `getAaveV3IncentivesController`. Each takes `chainId: ChainId` and returns `Address`. Each carries a doc-comment naming the consuming Phase 7 plan.
- Lines 76-82 obsolete "12th candidate slot is reserved for Phase 7" comment edited to the table-extensibility rationale (`>= 11` regression anchor permits future bridge / DEX / lending additions without test churn; Aave V3 Pool sits at row 0 alphabetical-by-label).

**`test/config-contracts.test.ts`:**
- 5 new getter imports added at the top.
- New `describe("src/config/contracts.ts — Aave V3 typed slots (Phase 7 Plan 07-01)")` block with 8 cases:
  1-5. Byte-identity per typed slot vs `getAddress(<literal>)`.
  6. EIP-55 round-trip across all 5 (proves corrupted-snapshot guard fires).
  7. Cross-view consistency: `getAaveV3PoolAddress(1) === KNOWN_SPENDERS_ETHEREUM.find(r => r.label === "Aave V3 Pool").address` — T-AAVE-SPENDER-DRIFT-1 anchor.
  8. `@ts-expect-error` ChainId narrowing — `getAaveV3PoolAddress(999)` is a compile error.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | clean (including the `@ts-expect-error` directive firing on Test 8) |
| `npm run build` | clean |
| `npm test` | 482 passed (51 files) — 474 → 482 (+8 new) |
| `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts` | EMPTY (FROZEN cryptographic-binding chain untouched) |
| `git diff origin/main -- src/tools/register-all.ts` | EMPTY (no tool registration) |
| `KNOWN_SPENDERS_ETHEREUM.length` | 11 (unchanged) |
| Cross-view consistency at runtime | `getAaveV3PoolAddress(1) === KNOWN_SPENDERS_ETHEREUM[0].address` evaluates `true` |
| 5 new getters callable via Node REPL | all return their cross-verified checksummed literals |
| Atomic commit | one commit (`278f9b9`) covering both files |

## Threat Mitigations

- **T-AAVE-ADDR-INLINE-1** (Tampering — contract-substitution drift via inlined Pool address): mitigated. Test 1 + Test 6 anchor byte-identity + EIP-55 round-trip for the Pool slot. Plan 07-03's grep-zero assertion on inline `0x87870Bca…` duplicates is the downstream complement.
- **T-AAVE-SPENDER-DRIFT-1** (Tampering — typed slot vs spender row divergence): mitigated. Test 7 asserts `getAaveV3PoolAddress(1) === KNOWN_SPENDERS_ETHEREUM[<aave-v3-pool-row>].address` at every test run. Drift between the two views fails this exact line.
- **T-AAVE-CHAIN-LEAK-1** (Tampering — hard-coded chainId leak): mitigated. Test 8's `@ts-expect-error` directive proves the ChainId union narrows; runtime undefined cannot leak from this SOT.

All three threats MEDIUM or LOW; no `high`-severity surface for this plan.

## Deviations from Plan

None of substance. Two minor judgement calls:

- **Plan's "12 pre-existing cases" baseline** — vitest actually reports 13 pre-existing cases in `test/config-contracts.test.ts` (describe-1: 2, describe-2: 5, describe-3: 5, describe-4 Phase 8: 1 = 13). The plan's "12" was an off-by-one; the relevant invariant (zero regressions on existing cases, +8 new = 21 total in this file) holds. Total project tests went 474 → 482, exactly matching the plan's +8 expectation.
- **File-header comment (lines 5-6) left untouched** — the framing "Phase 7 (Aave V3 Pool) and Phase 8 (multi-chain) extend" is now slightly stale (Phase 7 has landed), but the plan's `<interfaces>` block scoped the obsolete-comment edit to lines 76-82 only. Minimal-diff discipline; reading "Phase 7 … extend" as past-purpose still parses correctly. A future Phase 8 plan can refresh this header alongside its multi-chain expansion.

## What This Unblocks

- **Plan 07-02** (`get_lending_positions`) can now `import { getAaveV3UiPoolDataProvider, getAaveV3PoolAddressesProvider } from "../config/contracts.js"` for the UiPoolDataProviderV3 reader.
- **Plan 07-03** (3 prepare_* tools: supply / withdraw / simulate_position_change) can now `import { getAaveV3PoolAddress } from "../config/contracts.js"` for `tx.to`.
- **Plan 07-04** (`check_contract_security`) — formally Phase 7-gated; no address dependency on this plan, but its parallel-eligibility waits for 07-01 + 07-02 to land.

## Files

- `src/config/contracts.ts` — modified (interface widening, 5 literals, 5 getters, obsolete-comment edit)
- `test/config-contracts.test.ts` — modified (5 import additions, +8 new cases in new describe block)

## Commit

- `278f9b9 feat(07-01): aave-v3 contracts SOT extension (5 typed slots + 5 getters) + regression test`

## Self-Check: PASSED

- File `src/config/contracts.ts` exists with 6-field interface, 5 getters, edited line-76-82 comment.
- File `test/config-contracts.test.ts` exists with 8 new cases under the Phase 7 describe block.
- Commit `278f9b9` present in `git log`.
- 482 tests passing (474 baseline + 8 new).
- FROZEN-area + register-all zero-diff.
- Cross-view consistency runtime-verified.
