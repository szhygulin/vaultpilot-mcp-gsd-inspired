---
phase: 34-evm-curve-swap-add-liquidity
plan: 2
subsystem: tools, test
tags: [curve, lp-positions, read-only, multicall, zero-filter, rpcDegraded]
dependency_graph:
  requires:
    - getAllCurvePoolsForChain (src/config/contracts.ts — Plan 34-01)
    - _curveChain.getCurveLpBalance (src/chains/curve.ts — Plan 34-01)
    - getChainClient, isPublicNodeFallback (src/chains/registry.ts)
    - registerTool, getRegisteredTool (src/tools/index.ts)
    - makeStructuredError (src/signing/error-codes.ts)
  provides:
    - get_curve_positions MCP tool (CRV-01)
  affects:
    - src/tools/register-all.ts (one additive import at Plan 34-02 carve point)
tech_stack:
  added: []
  patterns:
    - Promise.allSettled fan-out + zero-filter (get_eigenlayer_positions analog)
    - READ-ONLY-by-construction grep guard (simulate_position_change analog)
    - ESM spy-affordance via _curveChain indirection object
    - vi.mock registry.js at module level + getRegisteredTool() call pattern
key_files:
  created:
    - src/tools/get_curve_positions.ts
    - test/get-curve-positions.test.ts
  modified:
    - src/tools/register-all.ts
decisions:
  - "Passed pool.lpToken (NOT pool.address) to getCurveLpBalance — Pitfall 3 anchor: legacy stETH/ETH has separate lpToken 0x06325440D014e39736583c165C2963BA99fAf14E vs pool address 0xDC24316b9AE028F1497c275EB9192a3Ea0f67022"
  - "Comments in get_curve_positions.ts must not mention forbidden identifiers verbatim (createHandle, computePayloadFingerprint) to avoid matching the module-source grep guard regex; used paraphrased descriptions instead"
  - "Used vi.mock('../src/chains/registry.js') at module level + getRegisteredTool() to call handler — same pattern as get_eigenlayer_positions.test.ts (ESM mock hoisting avoids beforeEach import order issues)"
metrics:
  duration: ~20 minutes
  completed: 2026-05-26
  tasks_completed: 1
  files_changed: 3
---

# Phase 34 Plan 2: get_curve_positions LP-balance multicall + READ-ONLY grep guard Summary

Landed `get_curve_positions({wallet, chain?})` — per-wallet Curve LP balance multicall across all 11 registered pools via `Promise.allSettled` fan-out on `pool.lpToken`, zero-filter, structuredContent with per-pool composition, and a module-source grep guard asserting the READ-ONLY-by-construction invariant.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | get_curve_positions tool + register-all carve + READ-ONLY grep guard | 56ad7d7 | src/tools/get_curve_positions.ts (NEW), src/tools/register-all.ts (1 line), test/get-curve-positions.test.ts (NEW) |

## Files Added/Modified

### NEW: `src/tools/get_curve_positions.ts` (~145 lines)
- Chain gate: Ethereum-only; non-ethereum → `CHAIN_ID_MISMATCH`
- Wallet validation: `isAddress(walletRaw, { strict: false })` + EIP-55 normalization via `getAddress`
- Multicall fan-out: `Promise.allSettled(pools.map(pool => _curveChain.getCurveLpBalance(client, pool.lpToken, wallet)))`
- CRITICAL (Pitfall 3): passes `pool.lpToken` NOT `pool.address` — legacy stETH/ETH pool has a separate LP token ERC-20
- Zero-filter: `result.value === 0n → continue`
- rpcDegraded: set on any rejection OR `isPublicNodeFallback(chainId)`
- structuredContent: `{chain, chainId, wallet, positions[{poolAddress, displayName, abiVersion, lpBalance, lpDecimals:18, coins[{address,decimals}], priceUnknown:true}]}`
- `priceUnknown: true` on every entry (LP USD pricing deferred to v3.x)
- READ-ONLY-by-construction: no `createHandle`, no `handle-store`, no `computePayloadFingerprint`

### EXTENDED: `src/tools/register-all.ts` (+1 line)
- Inserted `import "./get_curve_positions.js"; // Phase 34 Plan 34-02 (CRV-01)...` after `prepare_uniswap_v3_rebalance.js` import, before `simulate_position_change.js`
- Plan 34-03's adjacent slot (immediately after) is preserved per PATTERNS.md parallel-safety verdict

### NEW: `test/get-curve-positions.test.ts` (~220 lines, 14 tests)
- T-34-02-A: module-source grep guard (`import .*createHandle`, `from .*handle-store`, `computePayloadFingerprint`)
- T-34-02-B: Pitfall 3 lpToken vs pool.address call-arg regression (legacy + stable_ng assertions)
- T-34-02-C: chain gate refusal (polygon, arbitrum → `CHAIN_ID_MISMATCH`)
- T-34-02-D: Promise.allSettled rejection → `rpcDegraded: true` + failing pool omitted
- Wallet validation (3 tests: non-address, undefined, empty string)
- Default chain path (no chain arg → ethereum, no CHAIN_ID_MISMATCH)
- Zero-filter (1 non-zero pool → positions.length === 1)
- PublicNode fallback → rpcDegraded
- structuredContent shape (stable_ng fields + legacy abiVersion)

## Test Counts

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| test/get-curve-positions.test.ts | 0 (new) | 14 | +14 |
| **Total (full suite)** | 4064 | 4078 | **+14** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Source comments must not contain forbidden identifier verbatim**
- **Found during:** Task 1 GREEN phase — first test run
- **Issue:** The READ-ONLY grep guard test uses regex `/computePayloadFingerprint/` (plain string match). A draft comment in `get_curve_positions.ts` contained the exact text `computePayloadFingerprint`, causing a false positive match.
- **Fix:** Paraphrased the comment to avoid the exact identifier string: "payload-fingerprint computation" instead of `computePayloadFingerprint`. Same fix applied for `createHandle` → "handle creation". This is consistent with how `simulate_position_change.ts` handles the same issue (uses "imports" not "import" before `createHandle`).
- **Files modified:** src/tools/get_curve_positions.ts (comment text only)
- **Commit:** 56ad7d7

## Confirmation: READ-ONLY Grep Guard

```
grep -v '^//' src/tools/get_curve_positions.ts | grep -cE '(import .*createHandle|from .*handle-store|computePayloadFingerprint)'
→ 0 (pass)
```

READ-ONLY-by-construction invariant holds.

## Confirmation: register-all.ts Carve Point

```
grep -c 'get_curve_positions' src/tools/register-all.ts
→ 1 (exactly one additive line at the carve point)
```

Plan 34-03's adjacent slot (two lines immediately after) is empty and ready for `prepare_curve_swap.js` + `prepare_curve_add_liquidity.js`.

## Confirmation: FROZEN-Area Zero-Diff

```
git diff --stat origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/tools/preview_send.ts
→ (empty — zero lines)
```

FROZEN files untouched.

## Verification Results

```
npx vitest run test/get-curve-positions.test.ts
→ 14 passed, 0 failed

npx vitest run (full suite)
→ 313 test files, 4078 passed | 1 skipped, 0 failed
```

## Note for Plan 34-03 Executor

`src/tools/register-all.ts` is ready for the two-line additive insertion immediately after the 34-02 slot:

```typescript
import "./get_curve_positions.js";                   // Phase 34 Plan 34-02 (CRV-01) — [already inserted]
import "./prepare_curve_swap.js";                    // Phase 34 Plan 34-03 (CRV-02) — insert here
import "./prepare_curve_add_liquidity.js";           // Phase 34 Plan 34-03 (CRV-03) — insert here
import "./simulate_position_change.js";
```

`get_curve_positions` MCP tool is registered and functional. The `_curveChain.getCurveLpBalance` indirection is stubbed in tests via `vi.spyOn` — Plan 34-03 can use the same pattern.

## Self-Check: PASSED

- src/tools/get_curve_positions.ts: FOUND
- test/get-curve-positions.test.ts: FOUND
- Commit 56ad7d7: FOUND
- registerTool("get_curve_positions"): present in source
- READ-ONLY grep guard: 0 matches (pass)
- register-all.ts carve: 1 line (pass)
- FROZEN files diff: 0 lines (pass)
- Full suite: 4078 passed, 0 failed
