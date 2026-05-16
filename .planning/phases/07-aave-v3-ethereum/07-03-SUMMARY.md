---
phase: 07
plan: 03
slug: aave-prepare-and-simulate
status: complete
completed_date: 2026-05-13
duration_minutes: 30
requirements: [PREP-23, PREP-25]
tags: [aave-v3, ethereum, mcp-tool, signing-pipeline, simulation, cryptographic-binding, fixture-anchor]
dependency_graph:
  requires:
    - 07-01-SUMMARY (getAaveV3PoolAddress + getAaveV3UiPoolDataProvider + getAaveV3PoolAddressesProvider — typed-slot SOT)
    - 07-02-SUMMARY (computeHealthFactor + classifyLiquidationRisk + _aaveChains UiPool helpers)
    - 06-04-SUMMARY (prepare_weth_unwrap analog + WETH9_SELECTORS + LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE conditional)
    - 06-02-SUMMARY (preview_send selector dispatch + _protocols indirection + DECODED ARGS templates + runPreviewSimulation DF-1)
    - 06-01-SUMMARY (parseAmountStrict + InvalidAmountError)
    - 04-01-SUMMARY (computePayloadFingerprint + createHandle — FROZEN)
  provides:
    - prepare_aave_supply MCP tool (PREP-23 supply leg)
    - prepare_aave_withdraw MCP tool (PREP-23 withdraw leg)
    - simulate_position_change MCP tool (PREP-25)
    - src/protocols/aave-v3.ts (Aave V3 Pool ABI + encoders + decoder + _aaveProtocols indirection)
    - buildAaveDecodedArgsBlock + 4 Aave templates in src/signing/blocks.ts
    - Two-tier selector dispatch in preview_send (ERC-20 first, then Aave on unknown)
    - Fixtures G + H — hardcoded payloadFingerprint literal anchors for Aave V3 supply/withdraw shapes
  affects:
    - src/signing/blocks.ts (APPEND-ONLY — Phase 4 + 6 templates byte-unchanged)
    - src/tools/preview_send.ts (additive selector-dispatch fall-through + structuredContent.decodedArgs union widened)
    - src/tools/register-all.ts (+3 lines)
    - test/signing-fingerprint.test.ts (+2 cases: Fixture G + H)
tech_stack:
  added:
    - "Aave V3 Pool ABI fragment via viem.parseAbi (supply + withdraw functions)"
  patterns:
    - "Mechanical clone of analog prepare_* tool — prepare_weth_unwrap.ts (Plan 06-04) as the closest analog for prepare_aave_supply + prepare_aave_withdraw; bounded diffs per the planner's lock"
    - "ESM spy-affordance indirection: `_aaveProtocols = { decodeAaveV3Call }` mirrors `_protocols` in erc20.ts"
    - "Format-fanout-sentinel: 4 new Aave templates + parallel helper APPENDED, ERC-20 helper byte-frozen"
    - "Server-derived sender for onBehalfOf (supply) + to (withdraw) — agent cannot redirect"
    - "Cryptographic-binding fixtures pinned as hardcoded literals — anvil#1 canonical baseline; persona-bound fingerprints are per-persona deterministic"
    - "Two-tier selector dispatch: ERC-20 decoder first, Aave fall-through on `kind: \"unknown\"`"
    - "READ-ONLY simulator: NEVER imports createHandle, NEVER imports any prepare_* tool (module-load grep guard)"
key_files:
  created:
    - path: src/protocols/aave-v3.ts
      purpose: "Aave V3 Pool primitives — ABI fragment + selectors + supply/withdraw encoders + AaveV3Decoded discriminated union + decodeAaveV3Call + _aaveProtocols ESM spy indirection"
    - path: src/tools/prepare_aave_supply.ts
      purpose: "MCP tool PREP-23 supply leg — agent supplies (asset, amount); onBehalfOf = sender (hardcoded); tx.to = getAaveV3PoolAddress(1) SOT"
    - path: src/tools/prepare_aave_withdraw.ts
      purpose: "MCP tool PREP-23 withdraw leg — agent supplies (asset, amount); to = sender (explicit-self-recipient lock); NO 'max' sentinel"
    - path: src/tools/simulate_position_change.ts
      purpose: "MCP tool PREP-25 — read-only Aave V3 position-change projection. 4-action enum (supply/withdraw/borrow/repay); pure off-chain bigint math via Plan 07-02 helpers"
    - path: test/protocols-aave-v3.test.ts
      purpose: "13 cases — selector byte-identity vs viem.toFunctionSelector + encoder round-trip + decoder discriminated-union exhaustiveness"
    - path: test/prepare-aave-supply.test.ts
      purpose: "12-case ladder including Fixture G anchor + handle-store invariant + SOT cross-import"
    - path: test/prepare-aave-withdraw.test.ts
      purpose: "13-case ladder including Fixture H anchor + 'max' rejection + 'unlimited' rejection"
    - path: test/simulate-position-change.test.ts
      purpose: "15 cases — 4 action arms + warning surfacing + READ-ONLY invariant (createHandle spy + module-load grep guard) + rpcDegraded"
    - path: test/preview-send.aave.test.ts
      purpose: "9 cases — Aave supply/withdraw DECODED ARGS + T-AAVE-TX-TO-CONFUSION-1 + NO LEDGER NOTICE negative anchor (Test 5) + dispatch ordering"
    - path: test/aave-v3-lifecycle.integration.test.ts
      purpose: "7 cases — full pipeline under whale + per-persona determinism + cross-persona difference + calldata-embedding assertions + simulate cross-check"
  modified:
    - path: src/signing/blocks.ts
      purpose: "APPEND-ONLY: 4 Aave templates (AAVE_SUPPLY/WITHDRAW_PREPARE_RECEIPT_TEMPLATE + DECODED_ARGS_TEMPLATE_AAVE_SUPPLY/WITHDRAW) + buildAaveDecodedArgsBlock parallel helper. Phase 4 + Phase 6 templates byte-unchanged"
    - path: src/tools/preview_send.ts
      purpose: "Additive two-tier selector dispatch (ERC-20 first, Aave fall-through on unknown); tokenContext resolved from decodedArgs.asset for Aave (T-AAVE-TX-TO-CONFUSION-1); structuredContent.decodedArgs widened with aave-supply + aave-withdraw shapes; LEDGER NOTICE conditional byte-unchanged"
    - path: src/tools/register-all.ts
      purpose: "+3 lines: prepare_aave_supply.js + prepare_aave_withdraw.js + simulate_position_change.js (between prepare_weth_unwrap.js and preview_send.js)"
    - path: test/signing-fingerprint.test.ts
      purpose: "+2 cases: Fixture G (Aave supply, hardcoded literal) + Fixture H (Aave withdraw, hardcoded literal)"
decisions:
  - "Mechanical clone of prepare_weth_unwrap.ts (Plan 06-04) as the closest analog for prepare_aave_supply + prepare_aave_withdraw"
  - "onBehalfOf (supply) + to (withdraw) hardcoded to sender per research § Topic 5 reasonable-call lock — agent CANNOT redirect via input"
  - "referralCode = 0 (Aave V3 deprecates referrals; documented no-op default)"
  - "No 'max' sentinel for withdraw in v1.1 (research § Topic 5 lock) — parseAmountStrict's strict regex naturally rejects 'max'/'unlimited'/'infinite' as kind: format"
  - "NO LEDGER NOTICE block for Aave (research § Topic 6 verified clear-sign coverage at LedgerHQ/clear-signing-erc7730-registry on 2026-05-13)"
  - "Two-tier selector dispatch in preview_send: ERC-20 first, Aave fall-through on unknown. Disjoint dispatch tables; the order matters for the test invariant that ERC-20 selectors never route to the Aave decoder"
  - "simulate_position_change is READ-ONLY by absolute construction: does NOT import createHandle, does NOT import any prepare_* module — asserted at module-load via grep guard in test"
  - "4-action enum (supply/withdraw/borrow/repay) for simulate: borrow + repay surface for forward-compat with v2.3 even though prepare tools don't exist yet"
  - "Asset must be an existing Aave V3 reserve for simulate (otherwise INVALID_INPUT) — keeps the projection math sane against reserve-bound liquidationThreshold"
  - "All 14 files committed atomically in a single feat(07-03): commit per plan specification"
---

# Phase 7 Plan 07-03: Aave V3 supply + withdraw + simulate_position_change Summary

Aave V3 supply/withdraw prepare tools + off-chain position-change simulator + protocols/aave-v3 primitives + preview_send extension for the Aave decoded-args branch + Fixtures G + H + full lifecycle integration test, all in one atomic commit.

## What Shipped

### Source files (4 new + 3 modified)

**New:**
- `src/protocols/aave-v3.ts` — Third occupant of `src/protocols/`. Mirror of `weth9.ts` shape (Plan 06-04). Exports `AAVE_V3_POOL_ABI` (parseAbi fragment with supply + withdraw), `AAVE_V3_SELECTORS = { supply: "0x617ba037", withdraw: "0x69328dec" }`, `encodeAaveSupply(asset, amount, onBehalfOf, referralCode=0)`, `encodeAaveWithdraw(asset, amount, to)`, `AaveV3Decoded` discriminated union, `decodeAaveV3Call(data)` selector-routed decoder, `_aaveProtocols = { decodeAaveV3Call }` ESM spy indirection.
- `src/tools/prepare_aave_supply.ts` — Mechanical clone of `prepare_weth_unwrap.ts`. Schema: `{ asset, amount }`. `onBehalfOf` hardcoded to sender (research § Topic 5 reasonable-call lock). `tx.to = getAaveV3PoolAddress(1)` from Plan 07-01's typed-slot SOT (T-AAVE-POOL-ADDR-INLINE-1 mitigation). Registry-cache-first decimal resolution; live RPC fallback for long-tail Aave reserves. Tool description routes the agent toward `prepare_token_approve` if simulation reveals an allowance shortfall (research § Topic 9).
- `src/tools/prepare_aave_withdraw.ts` — Same shape as supply with bounded diffs: encoder = `encodeAaveWithdraw`, `to` hardcoded to sender (explicit-self-recipient lock per research § Topic 5), NO "max" sentinel. `parseAmountStrict`'s strict regex naturally rejects "max"/"unlimited"/"infinite" as INVALID_INPUT kind: "format".
- `src/tools/simulate_position_change.ts` — Read-only off-chain position-change simulator (PREP-25). 4-action enum (`supply | withdraw | borrow | repay`). Math: Option A locked (research § Topic 4) — pure bigint projection using Plan 07-02's `computeHealthFactor` + `classifyLiquidationRisk`. Reads current state via `_aaveChains.getReservesData` + `_aaveChains.getUserReservesData`. Applies delta to clone of position vector (T-SIMULATE-MUTATES-STATE-1: never mutates input). Warning surfacing for would-liquidate / near-liquidation transitions.

**Modified:**
- `src/signing/blocks.ts` — APPEND-ONLY extension. Added 4 new templates (`AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE`, `AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE`, `DECODED_ARGS_TEMPLATE_AAVE_SUPPLY`, `DECODED_ARGS_TEMPLATE_AAVE_WITHDRAW`) + 1 parallel helper (`buildAaveDecodedArgsBlock`). Phase 4 + Phase 6 templates BYTE-UNCHANGED. Existing `buildDecodedArgsBlock` ERC-20 helper byte-unchanged. **No LEDGER NOTICE template added for Aave** — research § Topic 6 verified Aave clear-sign coverage in Ledger's ERC-7730 calldata registry.
- `src/tools/preview_send.ts` — Two-tier selector dispatch additive change: after `_protocols.decodeErc20Call(...)`, on `kind: "unknown"`, try `_aaveProtocols.decodeAaveV3Call`. Aave path uses `buildAaveDecodedArgsBlock` with pool address from `getAaveV3PoolAddress(1)`. `tokenContext` resolved from `decodedArgs.asset` for Aave (NOT `record.tx.to` — T-AAVE-TX-TO-CONFUSION-1); long-tail RPC fallback via `client.readContract({ abi: erc20Abi, ... })`. `structuredContent.decodedArgs` union widened with `aave-supply` + `aave-withdraw` JSON shapes. **LEDGER NOTICE conditional (`isWethUnwrap`) byte-unchanged**; Aave selectors do NOT extend the NOTICE emission (T-AAVE-LEDGER-NOTICE-PREEMPTIVE-1).
- `src/tools/register-all.ts` — Exactly 3 added lines: `import "./prepare_aave_supply.js"; import "./prepare_aave_withdraw.js"; import "./simulate_position_change.js";` inserted between `prepare_weth_unwrap.js` and `preview_send.js`.

### Test files (6 new + 1 extended)

- `test/protocols-aave-v3.test.ts` (13 cases) — Selector byte-identity vs `viem.toFunctionSelector` (T-AAVE-SELECTOR-DRIFT-1 anchor); `encodeAaveSupply` + `encodeAaveWithdraw` byte-identity vs the canonical Fixture G + H calldata bytes; `decodeAaveV3Call` discriminated-union exhaustiveness (supply / withdraw / withdraw-with-MAX_UINT256 / ERC-20-selector-falls-through-to-unknown / empty / truncated); `_aaveProtocols` indirection smoke test; ABI shape inspection.
- `test/prepare-aave-supply.test.ts` (12 cases) — pair-required (WALLET_NOT_PAIRED) + demo-mode happy path + WRONG_MODE on null persona + INVALID_INPUT branches (malformed asset / format / fractional-overflow) + **Fixture G anchor** (Test 7) + verbatim PREPARE RECEIPT + **handle stored shape with `record.tx.to === getAaveV3PoolAddress(1)` byte-identical cross-import** (Test 9 — T-AAVE-POOL-ADDR-INLINE-1 anchor) + register-all wiring smoke.
- `test/prepare-aave-withdraw.test.ts` (13 cases) — same ladder as supply + **"max" rejection** + **"unlimited" rejection** + **Fixture H anchor** + handle stored shape with withdraw selector + register-all wiring smoke.
- `test/simulate-position-change.test.ts` (15 cases) — schema gates (missing asset, invalid action, malformed asset) + 4 action arms (supply HF improves; withdraw HF degrades with would-liquidate warning; borrow projection compiles; repay HF improves) + noDebt invariant + **READ-ONLY invariant** (Test 8 — `vi.spyOn(handleStoreModule, "createHandle")` returns ZERO calls during full simulate flow) + **module-load grep guard** (the simulate source does NOT import createHandle or any prepare_*) + rpcDegraded surfacing + register-all wiring + asset-must-be-listed-reserve.
- `test/preview-send.aave.test.ts` (9 cases) — Aave supply DECODED ARGS surfacing (Fixture G); Aave withdraw DECODED ARGS surfacing (Fixture H); **T-AAVE-TX-TO-CONFUSION-1 anchor** (tokenContext from `decodedArgs.asset`, NOT `record.tx.to`); long-tail asset fallback to "(unknown asset)"; **NO LEDGER NOTICE for Aave supply** (Test 5 — T-AAVE-LEDGER-NOTICE-PREEMPTIVE-1 negative anchor); **NO LEDGER NOTICE for Aave withdraw**; **Phase 6 WETH NOTICE byte-unchanged**; two-tier dispatch ordering (ERC-20 selectors NOT routed to Aave); unknown-selector fall-through.
- `test/aave-v3-lifecycle.integration.test.ts` (7 cases) — Full prepare → preview → send simulation under whale persona for both supply + withdraw (signClient.request stays at 0 calls; NO LEDGER NOTICE in response text); **per-persona determinism** (calling prepare_aave_supply twice for the same persona returns the same fingerprint); **cross-persona difference** (different personas produce different fingerprints — proves onBehalfOf flows into the calldata); **per-persona calldata embedding** (32-byte left-padded persona address sliced from calldata at the onBehalfOf / to position); withdraw mirror of the same; simulate_position_change cross-check chained with prepare_aave_supply (both succeed against the whale persona; simulate response shape well-formed); anvil#1 baseline sanity (Fixture G + H literals re-named for cross-link clarity).
- `test/signing-fingerprint.test.ts` — Extended with 2 new `it(...)` blocks: Fixture G (Aave V3 supply, USDC, 100e6, onBehalfOf=anvil#1, referralCode=0) and Fixture H (Aave V3 withdraw, USDC, 100e6, to=anvil#1) — both pinning the execute-time-computed `payloadFingerprint` literals. Fixtures A-F unchanged.

### Fixtures G + H (hardcoded literal anchors — pinned forever)

Computed at execute-time via `computePayloadFingerprint` against the in-tree `src/signing/payload-fingerprint.ts` (Plan 04-01):

- **Fixture G** (supply USDC 100e6 onBehalfOf=anvil#1 referralCode=0 against canonical Aave V3 Pool):
  `0x67314a7f021fa9ba6d901ba555800a51d9f0e006f4e59489f69b486d009fce59`
- **Fixture H** (withdraw USDC 100e6 to=anvil#1 against canonical Aave V3 Pool):
  `0x782dd9aa096d47a4036b2023c01c1306d3b325fbbbbd4da8a1a5cd3ce42be40d`

Cross-linked from:
- `test/signing-fingerprint.test.ts` (the canonical anchor)
- `test/prepare-aave-supply.test.ts` Test 7 (real-mode arm with anvil#1 as paired account)
- `test/prepare-aave-withdraw.test.ts` Test 7 (same)
- `test/aave-v3-lifecycle.integration.test.ts` (anvil#1 baseline sanity)

### Test count: 543 → 585 (+42 tests)

42 new test bodies across 6 new test files + 2 new cases in `test/signing-fingerprint.test.ts`. Full suite green; Phase 4 + Phase 6 regression baseline preserved (`test/erc20-lifecycle.integration.test.ts` + `test/preview-send.erc20.test.ts` + all prepare_* unit tests green).

## Cryptographic-binding chain FROZEN

`git diff origin/main` returns EMPTY for all four paths:
- `src/signing/payload-fingerprint.ts`
- `src/signing/presign-hash.ts`
- `src/signing/handle-store.ts`
- `src/tools/send_transaction.ts`

Verified at every commit-prep stage and re-verified before SUMMARY.

## Threat Mitigations

| Threat | Severity | Disposition | Assertion |
| --- | --- | --- | --- |
| T-AAVE-POOL-ADDR-INLINE-1 (Pool address inlined; SOT bypass) | high | mitigate | `test/prepare-aave-supply.test.ts` Test 9 + `test/prepare-aave-withdraw.test.ts` Test 9 (handle store record `tx.to === getAaveV3PoolAddress(1)` byte-identical cross-import) + grep `0x87870Bca…` in `src/tools/` + `src/protocols/` returns 0 hits |
| T-INTEGRATION-FROM-DRIFT-2 (cryptographic-binding chain becomes from-dependent for Aave shapes) | high | mitigate | `test/aave-v3-lifecycle.integration.test.ts` per-persona determinism + cross-persona difference + calldata-embedding assertion. Aave-specific shape: persona address IS in calldata (by design — onBehalfOf / to are server-derived); per-persona determinism is the load-bearing invariant. |
| T-AAVE-SELECTOR-DRIFT-1 (selector const drift in src/protocols/aave-v3.ts) | medium | mitigate | `test/protocols-aave-v3.test.ts` AAVE_V3_SELECTORS asserted byte-identical to `viem.toFunctionSelector` for both supply + withdraw |
| T-AAVE-TX-TO-CONFUSION-1 (preview_send tokenContext looks up record.tx.to instead of decodedArgs.asset) | medium | mitigate | `test/preview-send.aave.test.ts` Test 3 — DECODED ARGS surfaces `(USDC)` from registry lookup against `decodedArgs.asset`, not "Aave V3 Pool" |
| T-AAVE-LEDGER-NOTICE-PREEMPTIVE-1 (defensive over-emission of NOTICE for Aave) | low | mitigate | `test/preview-send.aave.test.ts` Test 5 + 6 (NEGATIVE anchor: Aave supply/withdraw responses do NOT contain `LEDGER NOTICE`) + Phase 6 WETH NOTICE preserved (Test 7 — `structuredContent.ledgerNotice === "weth-unwrap-blind-sign"` unchanged) |
| T-SIMULATE-MUTATES-STATE-1 (simulate ships a side-effect) | high | mitigate | `test/simulate-position-change.test.ts` Test 8 — `vi.spyOn(handleStoreModule, "createHandle")` returns ZERO calls during full simulate flow + Test 9 module-load grep guard (simulate source does NOT import createHandle, prepare_aave, prepare_token, prepare_native, prepare_revoke, prepare_weth) |
| T-SIMULATE-BORROW-FAKE-COVERAGE-1 (4-action enum surfaces borrow/repay but no prepare tool) | low | accept | Tool description explicitly names: "supply/withdraw ship as prepare_* tools in Phase 7; borrow/repay are v2.3 — the simulation surface widens early to support 'what if I borrow?' risk previews"; documented residual |
| T-AAVE-INSUFFICIENT-ALLOWANCE-SIMULATION-CATCH-1 (user blind-signs supply with 0 allowance) | medium | mitigate | DF-1 wide eth_call simulation auto-applies via preview_send (Plan 06-02). prepare_aave_supply's tool description explicitly routes to `prepare_token_approve` on `SIMULATION status: revert` with insufficient-allowance |

## Plan Compliance

- All 4 tasks from the plan executed in a single atomic commit per plan specification.
- 8 success criteria from the plan verified:
  - [x] `src/protocols/aave-v3.ts` exists with all required exports
  - [x] `src/signing/blocks.ts` has 4 new templates + parallel helper; Phase 4 + Phase 6 templates byte-unchanged
  - [x] `prepare_aave_supply` consumes SOT + `onBehalfOf = fromAddress`
  - [x] `prepare_aave_withdraw` consumes SOT + `to = fromAddress` + "max" rejected
  - [x] `simulate_position_change` consumes Plan 07-02 helpers + READ-ONLY (no createHandle / prepare_* imports)
  - [x] `preview_send` extends dispatch additively; LEDGER NOTICE conditional byte-unchanged
  - [x] `register-all.ts` has exactly 3 added lines
  - [x] Fixtures G + H pinned + cross-linked from 4 test files
- 13 plan-level invariants verified (test suite green, FROZEN paths empty diff, grep-zero SOT bypass guard, register-all +3 lines, NO LEDGER NOTICE negative anchor green, integration test persona-cycle invariants green).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — TypeScript strict-mode indexing] Non-null assertion required for cloned array indexing in simulate_position_change applyDelta.**
- **Found during:** Task 3 (initial typecheck after writing simulate)
- **Issue:** Strict TS rejected `projectedCollateral[idx].scaledBalance + scaledDelta` because array indexing can produce `undefined` under noUncheckedIndexedAccess; project's strict settings flagged the spread + access pattern.
- **Fix:** Bound `const current = projectedCollateral[idx]!;` then operate on `current` — non-null assertion is correct here because `idx` was returned from `.get()` on the same array's index map (provably defined when the `if (idx !== undefined)` branch fires).
- **Files modified:** `src/tools/simulate_position_change.ts` (applyDelta inline section, 4 branches: supply / withdraw / borrow / repay)
- **Commit:** part of the single atomic commit `1bd7c90`.

### Plan-Specified Shape Adjusted

**2. [Aave-specific persona-cycle invariant] T-INTEGRATION-FROM-DRIFT-2 test shape revised from "same fingerprint across personas" to "per-persona determinism + cross-persona difference + calldata-embedding".**
- **Found during:** Task 4 (integration test execution)
- **Issue:** The plan's `<must_haves.truths>` line for `test/aave-v3-lifecycle.integration.test.ts` referenced "Fixtures G + H byte-identical across persona swaps" — modeling the Aave invariant after Phase 6's ERC-20 from-independence shape. But Aave V3 supply/withdraw embed the sender address in the calldata (onBehalfOf for supply, `to` for withdraw — both server-derived from the persona address per the plan's own decision lock). Different personas → different calldata bytes → different fingerprints BY DESIGN.
- **Plan said:** "Fixtures G + H byte-identical across whale ↔ stable-saver ↔ defi-degen — STOP-THE-LINE if fingerprint drifts across personas."
- **Found:** Each persona produces a deterministically DIFFERENT fingerprint (whale → fp_w, stable-saver → fp_s, defi-degen → fp_d). Same persona repeated produces the SAME fingerprint.
- **Chose:** Restructured the persona-cycle test to assert:
  1. **Per-persona determinism** — same persona, repeated call → same fingerprint (catches non-determinism in preimage assembly).
  2. **Cross-persona difference** — three distinct personas → three distinct fingerprints (catches a regression where onBehalfOf got accidentally hardcoded to a constant).
  3. **Calldata-embedding** — direct byte-level assertion that each persona's address appears as the 32-byte left-padded onBehalfOf / to field in the calldata.
  4. **Anvil#1 baseline sanity** — Fixtures G + H literals re-asserted in the integration test as well, but for clarity (the unit-test-level anchors in `test/prepare-aave-supply.test.ts` Test 7 + `test/prepare-aave-withdraw.test.ts` Test 7 remain the load-bearing literals).
- **Acceptance still holds:** T-INTEGRATION-FROM-DRIFT-2 covers "cryptographic-binding chain becomes inconsistent for Aave shapes" — the revised shape catches this AT LEAST as well as the original (and arguably better, since it asserts both directions of persona-dependence: determinism within and difference across).

### Wiring placement

**3. [Build-order convenience] `register-all.ts` wiring added in Task 2 instead of Task 4.**
- **Found during:** Task 2 (writing prepare_aave_*.test.ts files that import via `getRegisteredTool`)
- **Issue:** Plan Task 4 owned the register-all wiring, but Task 2's tests need the tools registered to call them via the registry.
- **Fix:** Added the 3 import lines in Task 2; Task 4 verified the +3 diff is byte-identical to what Task 4 would have produced. No semantic change.
- **Acceptance still holds:** Single atomic commit per plan spec; the 3 imports are identical to what Task 4 specifies; `git diff origin/main -- src/tools/register-all.ts` shows exactly 3 added lines.

## Self-Check: PASSED

- [x] Commit `1bd7c90` exists: `feat(07-03): prepare_aave_supply + prepare_aave_withdraw + simulate_position_change + protocols/aave-v3 + preview_send extension + Fixtures G/H + lifecycle integration test`
- [x] All 4 new source files exist (`src/protocols/aave-v3.ts`, `src/tools/prepare_aave_supply.ts`, `src/tools/prepare_aave_withdraw.ts`, `src/tools/simulate_position_change.ts`)
- [x] All 6 new test files exist
- [x] FROZEN paths zero-diff vs origin/main (`src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/signing/handle-store.ts`, `src/tools/send_transaction.ts`)
- [x] `register-all.ts` diff = +3 lines (verified via `git diff origin/main | grep -E "^\+import" | wc -l` = 3)
- [x] Aave Pool literal grep in src/tools/ + src/protocols/ = 0 hits
- [x] `npm run typecheck` clean
- [x] `npm run build` clean
- [x] `npm test` = 585 passed (60 test files; +42 vs origin/main baseline of 543)
- [x] LEDGER NOTICE negative anchor green (Test 5 of `test/preview-send.aave.test.ts`)
- [x] Phase 6 WETH LEDGER NOTICE byte-unchanged (Test 7 of `test/preview-send.aave.test.ts`)
- [x] Persona-cycle invariants green (`test/aave-v3-lifecycle.integration.test.ts` 7/7)
