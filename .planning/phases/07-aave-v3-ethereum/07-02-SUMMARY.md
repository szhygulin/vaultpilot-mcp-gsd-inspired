---
phase: 07
plan: 02
subsystem: tools/chains/signing — Aave V3 lending reader
tags: [aave-v3, lending, health-factor, read-tool, ui-pool-data-provider, sibling-shelf, pure-bigint-math]
requires:
  - 07-01 (typed-slot SOT for Aave V3 addresses: UiPoolDataProviderV3 + PoolAddressesProvider)
  - 06-04 (config/contracts.ts SOT convention)
  - 02-* (Phase 2 read-tool pattern: getEthereumClient + isPublicNodeFallback + rpcDegraded surfacing)
provides:
  - READ-20 tool: get_lending_positions({ wallet })
  - src/chains/aave-v3.ts (sibling-shelf helper consumed by 07-02 reader + 07-03 simulate tool)
  - src/signing/aave-health.ts (pure-bigint HF math + classifyLiquidationRisk; consumed by 07-02 + 07-03)
affects:
  - tools registry (+1 tool: get_lending_positions)
  - register-all.ts (+1 import line; alphabetic-within-reads-group placement)
tech-stack:
  added: []
  patterns:
    - parseAbi struct-ref resolution into named-tuple components (research § Topic 2)
    - ESM spy-affordance indirection (_aaveChains object) per CLAUDE.md Convention
    - Pure-bigint health-factor math at protocol-canonical 1e18 scale (Aave HF_SCALE)
    - rpcDegraded surfacing copied verbatim from Phase 2 get_portfolio_summary.ts:219
    - "null instead of MAX_UINT256 for noDebt arm" (T-AAVE-HF-INFINITY-1 lock)
key-files:
  created:
    - src/signing/aave-health.ts                 # 182 LOC — pure-bigint HF math; computeHealthFactor + classifyLiquidationRisk + RAY/BPS_SCALE/HF_SCALE constants
    - src/chains/aave-v3.ts                      # 148 LOC — UiPoolDataProviderV3 ABI + getReservesData + getUserReservesData + _aaveChains spy-affordance
    - src/tools/get_lending_positions.ts         # 367 LOC — MCP tool (READ-20); parallel Promise.all reads + per-row builder + aggregate HF + rpcDegraded
    - test/signing-aave-health.test.ts           # 204 LOC — 15 cases: byte-identical scale constants + deterministic HF literal anchor + classifyLiquidationRisk thresholds + boundaries
    - test/chains-aave-v3.test.ts                # 136 LOC — 6 cases: parseAbi struct-ref resolution + SOT cross-import + spy interception
    - test/get-lending-positions.test.ts         # 415 LOC — 11 cases: schema gates + happy-path 3-position + noDebt + frozen reserve + eMode + rpcDegraded + RPC error + zero-balance drop + wiring + SOT bypass grep
  modified:
    - src/tools/register-all.ts                  # +1 line: import "./get_lending_positions.js"
decisions:
  - Sibling-shelf placement for src/chains/aave-v3.ts (mirror of src/chains/erc20-scanner.ts shape) — both Wave 2 (07-02 reader) and Wave 3 (07-03 simulate) consume the same UiPoolDataProviderV3 helpers; colocating in get_lending_positions.ts would force 07-03 to re-author or import a non-export
  - Pure-bigint math module under src/signing/ (NOT src/protocols/ or src/utils/) — the prepare/preview path may consume the deterministic HF projection in the future; locking it on the trust-pipeline shelf keeps the read-side math and the projection math byte-identical
  - noDebt arm returns null instead of MAX_UINT256 — research § Topic 3 lock (T-AAVE-HF-INFINITY-1); agents read `noDebt: true` FIRST, `healthFactor` second. The tool description names the contract verbatim
  - No DefiLlama call for Aave positions — UiPoolDataProviderV3 returns priceInMarketReferenceCurrency per reserve + baseCurrency.marketReferenceCurrencyUnit (1e8 on mainnet); the protocol-native oracle is the SOT
  - eMode handling v1.1 simplification (research § Topic 3 A3) — surface userEModeCategoryId verbatim; use per-asset reserveLiquidationThreshold regardless. v2.3 widens to per-category override via getEModeCategoryData
  - Frozen / inactive reserves surfaced verbatim (T-AAVE-FROZEN-RESERVE-SILENT-OMIT-1) — NEVER filter; let the agent route around them with isFrozen + isActive flags
  - Zero-balance reserves dropped (suppliedScaled === 0 && borrowedScaled === 0) — distinct from frozen filtering; one userReserve entry per system reserve means the vast majority are 0/0 for any given user
metrics:
  duration: ~25 minutes (single execution wave, no rework, all tests green on first run)
  completed: 2026-05-13
  tasks_completed: 1
  files_created: 6
  files_modified: 1
  tests_added: 32 (15 + 6 + 11; full suite: 482 → 514)
  loc_added: 1452 (commit insertion count; net new — no deletions)
---

# Phase 7 Plan 02: get_lending_positions — Aave V3 Reader Summary

READ-20 ships: agents can now query a wallet's Aave V3 lending positions on Ethereum mainnet — per-reserve supply / borrow balances, aggregate health factor, liquidation-risk classification, frozen-reserve flags, and eMode category — via a single tool call backed by two parallel `UiPoolDataProviderV3` reads.

## Scope

Plan 07-02 delivered:

1. **`src/signing/aave-health.ts`** — pure-bigint HF math module (`computeHealthFactor`, `classifyLiquidationRisk`, `RAY` / `BPS_SCALE` / `HF_SCALE` constants). 182 LOC, no side effects, no RPC, no module-load state. Shared with Plan 07-03's `simulate_position_change` (the entire reason the math lives in a separate module under `src/signing/`).
2. **`src/chains/aave-v3.ts`** — sibling-shelf helper for UiPoolDataProviderV3 reads. 148 LOC. Exports `aaveV3UiPoolAbi` (viem `parseAbi` with 3 struct refs + 2 function fragments), 3 decoded-interface types, 2 async helpers (`getReservesData`, `getUserReservesData`), and `_aaveChains` ESM spy-affordance indirection. Mirror of `src/chains/erc20-scanner.ts` shape.
3. **`src/tools/get_lending_positions.ts`** — the MCP tool. 367 LOC. Parallel `Promise.all` reads + per-position row builder (mirror of `get_portfolio_summary.ts::buildRow`) + aggregate HF + `liquidationRisk` + `rpcDegraded` surfacing via `isPublicNodeFallback()`.
4. **`src/tools/register-all.ts`** — exactly +1 line: `import "./get_lending_positions.js";` immediately after `get_portfolio_summary.js`.
5. **3 new test files (32 cases)** — pure-fn math anchors, parseAbi struct-ref resolution proof, SOT cross-import assertion, spy interception, schema gates, happy-path with deterministic HF=5e18 anchor, frozen reserve surfacing, eMode surfacing, rpcDegraded, RPC error path, zero-balance drop, wiring confirmation, and shell-out SOT bypass grep.

## Threat-Model Anchors

| Threat ID | Severity | Mitigation | Asserted by |
| --- | --- | --- | --- |
| T-AAVE-HF-MATH-DRIFT-1 | HIGH | Hardcoded HF literal anchor (`healthFactorScaled === 1700000000000000000n` for deterministic input vector) + byte-identical constants on `RAY` / `BPS_SCALE` / `HF_SCALE` | `test/signing-aave-health.test.ts` cases 1-4 + 7 |
| T-AAVE-HF-INFINITY-1 | MEDIUM | `computeHealthFactor` returns `{ healthFactorScaled: null, noDebt: true }` for zero-debt input; tool surfaces `healthFactor: null` so agents read `noDebt` FIRST | `test/signing-aave-health.test.ts` "noDebt arm" + `test/get-lending-positions.test.ts` "noDebt" |
| T-AAVE-FROZEN-RESERVE-SILENT-OMIT-1 | MEDIUM | `buildPositionRow` has no `.filter` for `isFrozen` / `isActive`; rows surface with the flags verbatim | `test/get-lending-positions.test.ts` "frozen reserve surfaces with isFrozen: true (NOT filtered out)" |
| T-AAVE-RPC-DEGRADED-NO-SURFACE-1 | MEDIUM | `if (isPublicNodeFallback()) result.rpcDegraded = true;` — verbatim copy of `get_portfolio_summary.ts:219` | `test/get-lending-positions.test.ts` "rpcDegraded surfacing" |
| T-AAVE-EMODE-WRONG-HF-1 | LOW (documented A3 caveat) | `userEModeCategoryId` surfaces verbatim; tool description names the v1.1 per-asset-LT simplification and the v2.3 widening path | `test/get-lending-positions.test.ts` "eMode user → userEModeCategoryId surfaces verbatim" |

## Deviations from Plan

**None.** The plan was followed exactly:

- All 7 files in `files_modified` created or modified as specified
- All 31 plan-prescribed test cases authored (the suite ships 32 — one bonus case in `signing-aave-health.test.ts` covers a non-RAY-1.0 `liquidityIndex` path to guard against a regression where someone removes the `/RAY` step from the inflation math; called out as a load-bearing extra under T-AAVE-HF-MATH-DRIFT-1)
- All Threat Register IDs anchored to specific test cases
- FROZEN-area zero-diff verified post-commit
- `register-all.ts` +1 line, alphabetic-within-reads-group placement
- SOT bypass guard green (UiPoolDataProviderV3 literal lives only in `src/config/contracts.ts`)
- ESM spy-affordance (`_aaveChains`) added at write time per CLAUDE.md convention — not retroactively

## Test Counts

| Stage | Files | Tests |
| --- | --- | --- |
| Baseline (head: d383063, Plan 07-01 merged) | 51 | 482 |
| After Plan 07-02 (head: dfbd6c4) | 54 | 514 |
| Net new | +3 | +32 |

Breakdown of +32 net new:

- `test/signing-aave-health.test.ts` — 15 cases (3 constant anchors + 5 computeHealthFactor cases + 7 classifyLiquidationRisk cases)
- `test/chains-aave-v3.test.ts` — 6 cases (3 parseAbi shape + 2 SOT-import + 1 spy)
- `test/get-lending-positions.test.ts` — 11 cases (2 schema gates + 1 happy-path with HF=5e18 anchor + 1 noDebt + 1 frozen reserve + 1 eMode + 1 rpcDegraded + 1 RPC error + 1 zero-balance drop + 1 wiring + 1 SOT bypass grep)

## Commit

- `dfbd6c4` — `feat(07-02): get_lending_positions reader + UiPoolDataProviderV3 helpers + health-factor math module` (7 files changed, +1453 insertions, 0 deletions)

## Cross-Wave Hand-off (for Plan 07-03)

Plan 07-03's `simulate_position_change` will consume both new modules from this plan:

- **`_aaveChains.getReservesData` / `_aaveChains.getUserReservesData`** — the same UiPoolDataProviderV3 reads. The `_aaveChains` indirection makes `vi.spyOn` straightforward for the simulate tool's tests; the helpers return decoded structs so 07-03 reuses the same shape.
- **`computeHealthFactor` + `classifyLiquidationRisk`** — current HF from the user's current scaled balances; projected HF from the post-tx scaled balances after the supply / withdraw / borrow / repay simulation. The `HealthFactorOutput` shape carries `totalCollateralBase` / `totalDebtBase` / `weightedLiquidationThresholdBase` precisely so 07-03 can show before / after deltas without re-summing.

The `userEModeCategoryId` surface contract is also forward-compatible — 07-03 surfaces it verbatim on the simulate response so the v2.3 widening lands as a math fix, not a response-shape change.

## Self-Check: PASSED

Files created (verified `[ -f path ]`):

- src/signing/aave-health.ts — FOUND
- src/chains/aave-v3.ts — FOUND
- src/tools/get_lending_positions.ts — FOUND
- test/signing-aave-health.test.ts — FOUND
- test/chains-aave-v3.test.ts — FOUND
- test/get-lending-positions.test.ts — FOUND

File modified (verified `git diff origin/main -- src/tools/register-all.ts`):

- src/tools/register-all.ts — +1 line confirmed

Commit (verified `git log --oneline | grep dfbd6c4`):

- dfbd6c4 — FOUND

FROZEN-area zero-diff (verified `git diff origin/main` against the 4 pinned paths):

- payload-fingerprint.ts / presign-hash.ts / handle-store.ts / send_transaction.ts — all empty diff

SOT bypass grep (verified `grep -ril 0x56b7A1012765C285afAC8b8F25C69Bf10ccfE978 src/tools/ src/chains/ src/signing/`):

- No hits — UiPoolDataProviderV3 literal lives only in `src/config/contracts.ts`
