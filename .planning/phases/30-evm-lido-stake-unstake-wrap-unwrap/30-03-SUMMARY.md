---
phase: 30-evm-lido-stake-unstake-wrap-unwrap
plan: "03"
subsystem: lido-write-tools
tags: [lido, stake, unstake, wrap, unwrap, nft-receipt, preview_send, decoded-args, lifecycle]
dependency_graph:
  requires:
    - 30-01  # protocols/lido.ts, blocks.ts templates, signing-fingerprint fixtures V/W/X/Y
    - 30-02  # get_lido_positions, chains/lido.ts, lido-rebase.ts
  provides:
    - prepare_lido_stake
    - prepare_lido_unstake
    - prepare_lido_wrap
    - prepare_lido_unwrap
    - preview_send Lido DECODED ARGS dispatch (4 selectors)
    - lido-lifecycle integration test
  affects:
    - src/tools/preview_send.ts
    - src/tools/register-all.ts
    - src/signing/blocks.ts
tech_stack:
  added:
    - decodeFunctionData (viem) for inline Lido selector dispatch in preview_send
  patterns:
    - Five-tier selector dispatch (ERC-20 → Aave → Compound → Morpho → Lido) in preview_send
    - LidoDecoded discriminated union + buildLidoDecodedArgsBlock in blocks.ts
    - Approval pre-flight (D-05) + NFT RECEIPT EXPECTED block (D-04) in prepare_lido_unstake
    - Persona-independence/dependence fixture anchors at integration level (V/X/Y independent, W dependent)
key_files:
  created:
    - src/tools/prepare_lido_stake.ts
    - src/tools/prepare_lido_unstake.ts
    - src/tools/prepare_lido_wrap.ts
    - src/tools/prepare_lido_unwrap.ts
    - test/prepare-lido-stake.test.ts
    - test/prepare-lido-unstake.test.ts
    - test/prepare-lido-wrap.test.ts
    - test/prepare-lido-unwrap.test.ts
    - test/lido-lifecycle.integration.test.ts
  modified:
    - src/signing/blocks.ts (+116 LOC — LidoDecoded type, 4 DECODED ARGS templates, buildLidoDecodedArgsBlock)
    - src/tools/preview_send.ts (+125 LOC — 5th dispatch tier, decodedArgsForJson Lido cases, imports)
    - src/tools/register-all.ts (+5 LOC — 4 prepare_lido_* imports)
decisions:
  - "D-12: No LEDGER NOTICE for any Lido selector (ERC-7730 clear-sign confirmed) — mirrors Phase 7 Aave precedent"
  - "D-04: NFT RECEIPT EXPECTED block appended to prepare_lido_unstake — expectedTokenId = getLastRequestId() + 1"
  - "D-05: Allowance pre-flight in prepare_lido_unstake (spender=WQ) and prepare_lido_wrap (spender=wstETH)"
  - "D-06: Single-element array encoding for requestWithdrawals — 132 bytes calldata (not 100)"
  - "Integration test mocks chains/registry.js for readContract (viem PublicClient methods bound at creation time — viem/actions mock insufficient)"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-23"
  tasks: 3
  files_created: 9
  files_modified: 3
  tests_added: 51
  tests_total: 3538
---

# Phase 30 Plan 03: Lido Write Tools + preview_send Dispatch + Lifecycle Test Summary

Four Lido write tools (stake/unstake/wrap/unwrap), preview_send DECODED ARGS dispatch for all 4 Lido selectors, register-all wiring, and persona-cycle lifecycle integration test anchoring Fixtures V/W/X/Y.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | prepare_lido_stake + prepare_lido_unwrap + unit tests | 2e4ade5 | src/tools/prepare_lido_stake.ts, src/tools/prepare_lido_unwrap.ts, test/prepare-lido-stake.test.ts (14 tests), test/prepare-lido-unwrap.test.ts (12 tests) |
| 2 | prepare_lido_unstake + prepare_lido_wrap + unit tests | eb9f6ef | src/tools/prepare_lido_unstake.ts, src/tools/prepare_lido_wrap.ts, test/prepare-lido-unstake.test.ts (16 tests), test/prepare-lido-wrap.test.ts (14 tests) |
| 3 | preview_send dispatch + register-all + lifecycle test | e618e45 | src/signing/blocks.ts (+116), src/tools/preview_send.ts (+125), src/tools/register-all.ts (+5), test/lido-lifecycle.integration.test.ts (9 tests) |

## LOC Deltas

| File | Status | LOC |
|------|--------|-----|
| src/tools/prepare_lido_stake.ts | NEW | 233 |
| src/tools/prepare_lido_unstake.ts | NEW | 299 |
| src/tools/prepare_lido_wrap.ts | NEW | 245 |
| src/tools/prepare_lido_unwrap.ts | NEW | 206 |
| src/signing/blocks.ts | EXTENDED | +116 |
| src/tools/preview_send.ts | EXTENDED | +125 |
| src/tools/register-all.ts | EXTENDED | +5 |
| test/prepare-lido-stake.test.ts | NEW | 374 |
| test/prepare-lido-unstake.test.ts | NEW | 455 |
| test/prepare-lido-wrap.test.ts | NEW | 410 |
| test/prepare-lido-unwrap.test.ts | NEW | 332 |
| test/lido-lifecycle.integration.test.ts | NEW | 516 |

## register-all Import Lines (in order)

```typescript
import "./get_lido_positions.js";         // Phase 30 Plan 30-02 (LIDO-01) — stETH + wstETH positions (Ethereum + Arbitrum)
import "./prepare_lido_stake.js";         // Phase 30 Plan 30-03 (LIDO-02) — ETH → stETH (Lido.submit value-bearing)
import "./prepare_lido_unstake.js";       // Phase 30 Plan 30-03 (LIDO-03) — stETH withdrawal queue (NFT receipt)
import "./prepare_lido_wrap.js";          // Phase 30 Plan 30-03 (LIDO-04) — stETH → wstETH (WstETH.wrap)
import "./prepare_lido_unwrap.js";        // Phase 30 Plan 30-03 (LIDO-04) — wstETH → stETH (WstETH.unwrap)
```

## PREPARE RECEIPT Block Layouts

**prepare_lido_stake:**
```
PREPARE RECEIPT
  operation:    Lido stake (ETH → stETH)
  chain:        ethereum (chainId 1)
  stethContract: 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84
  amount:       {ETH amount} ETH
```

**prepare_lido_unstake:**
```
PREPARE RECEIPT
  operation:    Lido unstake (stETH → withdrawal NFT)
  chain:        ethereum (chainId 1)
  withdrawalQueue: 0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1
  stethAmount:  {stETH amount} stETH

[NFT RECEIPT EXPECTED]
NFT contract:  0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1
Expected token ID: {getLastRequestId() + 1}  (best-effort at prepare time; may shift if another withdrawal queues before this tx lands)
Requestor:     {fromAddress}
Claimable:     ~1-5 days (finalization window; monitor via Lido withdrawal tracker)
```

**prepare_lido_wrap:**
```
PREPARE RECEIPT
  operation:    Lido wrap (stETH → wstETH)
  chain:        ethereum (chainId 1)
  wstethContract: 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0
  stethAmount:  {stETH amount} stETH
```

**prepare_lido_unwrap:**
```
PREPARE RECEIPT
  operation:    Lido unwrap (wstETH → stETH)
  chain:        ethereum (chainId 1)
  wstethContract: 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0
  wstethAmount: {wstETH amount} wstETH
```

## Fixture V/W/X/Y Persona-Dependence Audit

| Fixture | Selector | Persona-INDEPENDENT | Persona-DEPENDENT |
|---------|----------|--------------------|--------------------|
| V | Lido.submit(address(0)) | YES — calldata has only referral=address(0); `from` not in calldata | — |
| W | requestWithdrawals([amounts], owner) | — | YES — owner=fromAddress flows into calldata; different personas → different fingerprint |
| X | WstETH.wrap(stethAmount) | YES — only stETH amount in calldata; `from` not in calldata | — |
| Y | WstETH.unwrap(wstethAmount) | YES — only wstETH amount in calldata; `from` not in calldata | — |

Integration test assertions:
- V, X, Y: all 3 personas (whale/stable-saver/defi-degen) produce the same hardcoded fixture fingerprint
- W: all 3 personas produce DISTINCT fingerprints; same persona is deterministic across repeated calls

## Integration Test Summary

`test/lido-lifecycle.integration.test.ts` — 9 tests:
- Fixture V persona-independence (whale/stable-saver/defi-degen all match FIXTURE_V_FP)
- Fixture X persona-independence (all match FIXTURE_X_FP)
- Fixture Y persona-independence (all match FIXTURE_Y_FP)
- Fixture W persona-dependence (3 distinct fingerprints)
- Fixture W determinism (same persona, same fingerprint on repeated calls)
- Full stake pipeline: prepare → preview (DECODED ARGS lido-stake, no LEDGER NOTICE) → send (simulated)
- Full unstake pipeline: prepare → preview (DECODED ARGS lido-unstake, D-04 NFT fields) → send (simulated)
- Full wrap pipeline: prepare → preview (DECODED ARGS lido-wrap, no LEDGER NOTICE) → send (simulated)
- Full unwrap pipeline: prepare → preview (DECODED ARGS lido-unwrap, no LEDGER NOTICE) → send (simulated)

## Test Count Delta

| Scope | Before | After | Delta |
|-------|--------|-------|-------|
| Unit tests (4 prepare tools) | 0 | 56 | +56 |
| Lifecycle integration | 0 | 9 | +9 |
| Total vitest suite | ~3486 | 3538 | +52 (+1 skip unchanged) |

## FROZEN Region Zero-Diff Confirmation

`git diff 8e3590c -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts` — ZERO diff. All 5 FROZEN files are byte-identical to base commit.

Wave 1+2 artifacts (src/protocols/lido.ts, src/signing/lido-rebase.ts, src/chains/lido.ts, src/tools/get_lido_positions.ts, src/signing/blocks.ts pre-Plan-30-03 region, src/config/contracts.ts, src/security/canonical-dispatch.ts) — zero modifications.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] formatUnits trailing zero normalization in hintArgs.amount**
- **Found during:** Task 2 test failures
- **Issue:** Tests asserted `hintArgs.amount === "1.0"` but `formatUnits(1e18, 18)` returns `"1"` (viem trims trailing zeros)
- **Fix:** Updated assertions in test/prepare-lido-unstake.test.ts and test/prepare-lido-wrap.test.ts to expect `"1"` with comment explaining viem behavior
- **Files modified:** test/prepare-lido-unstake.test.ts, test/prepare-lido-wrap.test.ts
- **Commit:** eb9f6ef

**2. [Rule 3 - Blocking] Registry mock required in lifecycle integration test**
- **Found during:** Task 3 integration test failures
- **Issue:** plan's PATTERNS.md suggested mocking `viem/actions.readContract` but viem `PublicClient` methods are bound at client creation time — `vi.mock("viem/actions")` does NOT intercept `client.readContract()` calls on real public clients. prepare_lido_wrap and prepare_lido_unstake failed with `isError: true`.
- **Fix:** Added `vi.mock("../src/chains/registry.js")` to inject a `readContract` mock at the registry boundary (same pattern as unit tests). `viem/actions` mock retained for getTransactionCount/estimateFeesPerGas/estimateGas/call used by preview_send.
- **Files modified:** test/lido-lifecycle.integration.test.ts
- **Commit:** e618e45

## v2.3 Close-Out Note

Phase 30 Plan 30-03 completes the Lido write surface (LIDO-02/03/04). Per CONTEXT.md deferred § "v2.3 close-out SECURITY.md milestone summary section", Phase 31 (EigenLayer + Rocket Pool) is the next milestone. A bundled SECURITY.md milestone summary task is planned to cover the v2.3 close-out at Phase 31 completion.

## Self-Check

Checking all committed files exist and commits are valid...

## Self-Check: PASSED

All 9 new files created, all 3 modified files extended. Commits 2e4ade5, eb9f6ef, e618e45 exist in git log.
