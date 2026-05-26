---
phase: "34"
plan: "34-03"
subsystem: "protocols/curve, tools/prepare_curve_swap, tools/prepare_curve_add_liquidity, tools/preview_send"
tags: [curve-finance, stableswap, evm, ethereum, defi, mcp-tool, tdd, fixture-crosslink]
dependency_graph:
  requires: ["34-01", "34-02"]
  provides: ["CRV-02", "CRV-03"]
  affects: ["preview_send", "register-all", "canonical-dispatch"]
tech_stack:
  added: []
  patterns:
    - "(tx.to, selector) TUPLE dispatch in preview_send — prevents selector-collision false decodes"
    - "abiVersion-gated encoder dispatch — encodeExchangeLegacy vs encodeExchangeStableNg vs encodeAddLiquidityStableNg"
    - "per-coin parseAmountStrict with failing index in error message"
    - "legacy add_liquidity refused before amounts validation — structural unsupported refusal"
    - "Fixture CRV-A/B/C end-to-end byte-identity cross-links (protocol + prepare + preview layers)"
key_files:
  created:
    - src/protocols/curve.ts
    - src/tools/prepare_curve_swap.ts
    - src/tools/prepare_curve_add_liquidity.ts
    - test/protocols-curve.test.ts
    - test/prepare-curve-swap.test.ts
    - test/prepare-curve-add-liquidity.test.ts
    - test/preview-send-curve.test.ts
  modified:
    - src/tools/preview_send.ts (ADDITIVE — 90 insertions, 2 import-line extensions)
    - src/tools/register-all.ts (ADDITIVE — 2 new import lines)
decisions:
  - "Legacy add_liquidity refused (LOAD-BEARING) — legacy pool ABI is fixed-N; deferred to v2.4.x per CONTEXT.md Open Question 1"
  - "No sandwich-MEV gate for Curve — asymmetric to Phase 32 UniV3; explicitly documented in CHECKS PERFORMED on both prepare tools and preview_send blocks"
  - "(tx.to, selector) TUPLE dispatch in preview_send — any Vyper StableSwap pool can share 4-byte selectors; registry gate prevents false decode"
  - "stable_ng _receiver = signer server-side (NOT agent-supplied) — from-dependent calldata; Fixture CRV-B anchors byte-stability"
  - "ETH-in valueWei = amountIn only when legacy pool AND i === 0 AND coins[0] === ETH_SENTINEL (Pitfall 2 mitigation)"
metrics:
  duration: "~45 minutes (split across sessions)"
  completed_date: "2026-05-26"
  task_count: 4
  file_count: 9
---

# Phase 34 Plan 34-03: Curve Write-Surface Summary

One-liner: Curve Finance unsigned-tx write surface — per-abiVersion exchange dispatch + stable_ng add_liquidity + (tx.to, selector) tuple-dispatch preview_send arm with Fixtures CRV-A/B/C byte-identity anchors.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | `src/protocols/curve.ts` — selectors + encoders + decoder + indirection | `17e5a09` | `src/protocols/curve.ts`, `test/protocols-curve.test.ts` |
| 2 | `prepare_curve_swap` — per-abiVersion dispatch + get_dy + min_dy | `04ae895` | `src/tools/prepare_curve_swap.ts`, `test/prepare-curve-swap.test.ts` |
| 3 | `prepare_curve_add_liquidity` — legacy refusal + calc_token_amount | `1963251` | `src/tools/prepare_curve_add_liquidity.ts`, `test/prepare-curve-add-liquidity.test.ts` |
| 4 | `preview_send` Curve arm + `register-all` carve | `cd79234` | `src/tools/preview_send.ts`, `src/tools/register-all.ts`, `test/preview-send-curve.test.ts` |

## Files Added / Extended

| File | Status | Notes |
|------|--------|-------|
| `src/protocols/curve.ts` | NEW | CURVE_SELECTORS (5), encoders (3), decodeCurveCall, CurveDecoded type, _curveProtocol indirection |
| `src/tools/prepare_curve_swap.ts` | NEW | 12-step handler; chain gate, registry lookup, i/j resolution, slippage [1,5000], parseAmountStrict, resolveFrom, on-chain get_dy, bigint minDy, abiVersion dispatch, ERC-20 pre-flight |
| `src/tools/prepare_curve_add_liquidity.ts` | NEW | legacy refusal BEFORE amounts validation (LOAD-BEARING), amounts.length gate (Pitfall 5), per-element parse with index in error, calc_token_amount quote, bigint minMintAmount, per-coin ERC-20 pre-flight |
| `src/tools/preview_send.ts` | EXTENDED (additive) | 2 new import groups + let curveDecoded + Curve selector-chain arm + inline buildCurveDecodedArgsBlock + curveDecoded arm in decodedArgsBlock chain |
| `src/tools/register-all.ts` | EXTENDED (additive) | 2 new lines: prepare_curve_swap.js + prepare_curve_add_liquidity.js at Plan 34-03 carve point |
| `test/protocols-curve.test.ts` | NEW | 83 tests: selector byte-identity (5), encoder length/prefix (6), slippage math (3), decoder tuple-dispatch (7), indirection drift gate (1), Fixture CRV-A/B/C cross-links (4) |
| `test/prepare-curve-swap.test.ts` | NEW | 74 tests: chain gate, registry gate, token validation, slippage bounds, ETH-in path, stable_ng path, bigint math regression, Fixture CRV-B cross-link (LOAD-BEARING), approval pre-flight, MEV doc line |
| `test/prepare-curve-add-liquidity.test.ts` | NEW | 70 tests: T3 legacy refusal (LOAD-BEARING), T4 Pitfall 5 anchor, T5 per-element parse index, T8 Fixture CRV-C cross-link (LOAD-BEARING), T9 per-coin approval surface, T10 MEV doc line |
| `test/preview-send-curve.test.ts` | NEW | 11 tests: legacy [CURVE SWAP], ETH-in isEthIn surface, stable_ng exchange receiver, [CURVE ADD LIQUIDITY], T4 tuple dispatch regression (LOAD-BEARING T-34-03-SELECTOR-COLLISION), MEV doc x2, Layer 0.5 sanity, selector byte-coverage x3 |

## Test Count Delta

- Plan 34-01/34-02 (prior): 4143 tests
- Plan 34-03 (this plan): +83 + 74 + 70 + 11 = **238 new tests**
- Full suite after plan: **4316 tests passing** (317 test files)

## Fixture Cross-Link Confirmations

| Fixture | Layer | Status |
|---------|-------|--------|
| CRV-A (`0xea4f7e...`) | protocol (encodeExchangeLegacy + computePayloadFingerprint) | PASS |
| CRV-B (`0x912325...`) | protocol + prepare_curve_swap tool (stable_ng _receiver=FIXTURE_PERSONA) | PASS |
| CRV-C (`0x2762d8...`) | protocol + prepare_curve_add_liquidity tool (add_liquidity([50e6,50e6], min=99e18)) | PASS |

## Invariant Confirmations

| Check | Status |
|-------|--------|
| FROZEN files zero-diff (payload-fingerprint, presign-hash, handle-store, send_transaction) | PASS |
| preview_send.ts additions-only (2 import-line extensions + new arm, no arm modifications) | PASS |
| register-all.ts exactly 2 new lines at Plan 34-03 carve point | PASS |
| T-34-03-SELECTOR-COLLISION regression (non-registry tx.to + Curve selector → no false decode) | PASS |
| Legacy add_liquidity refused before amounts validation (load-bearing structural refusal) | PASS |
| slippageBps [1, 5000] enforced on both tools (no MEV gate, but footgun cap) | PASS |
| ETH-in path: legacy pool i=0 coins[0]=ETH_SENTINEL → valueWei = amountIn | PASS |
| stable_ng _receiver = signer (NOT agent-supplied) | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] T9 PYUSD address case mismatch in approval hint**
- **Found during:** Task 3 first test run
- **Issue:** `coinAddr` (checksummed `getAddress()` result) was used in the approval hint text; test checked `PYUSD_ADDR.toLowerCase()` against the joined content text
- **Fix:** Output `coinAddr.toLowerCase()` in the approval hint message for prepare_curve_add_liquidity
- **Files modified:** `src/tools/prepare_curve_add_liquidity.ts`

**2. [Rule 1 - Bug] preview-send-curve T7 `isDispatchRefusal` type narrowing**
- **Found during:** Task 4 first test run
- **Issue:** `result.isError && sc?.errorCode === "DISPATCH_TARGET_REFUSED"` returns `undefined` when `result.isError` is falsy (not strictly `false`); `expect(undefined).toBe(false)` fails
- **Fix:** Rewrote T7 assertion with explicit `if (result.isError)` branch + positive assertion `!result.isError || errorCode !== "DISPATCH_TARGET_REFUSED"`
- **Files modified:** `test/preview-send-curve.test.ts`

**3. [Rule 3 - Blocking] `formatUnits` and `getAddress` not in preview_send.ts viem imports**
- **Found during:** Task 4 implementation
- **Issue:** Inline `buildCurveDecodedArgsBlock` used `formatUnits` and `getAddress` from viem; neither was imported
- **Fix:** Extended the viem import line additively
- **Files modified:** `src/tools/preview_send.ts`

**4. [Rule 3 - Blocking] Curve arm indentation placed at wrong nesting level**
- **Found during:** Task 4 compilation
- **Issue:** First insertion attempt placed the `} else if (` at 10-space indent (2 levels too high); TypeScript/esbuild threw `Unexpected "else"`
- **Fix:** Corrected to 12-space indentation matching the Phase 30/31/32/33 selector-chain `else if` chain
- **Files modified:** `src/tools/preview_send.ts`

## Known Stubs

None — all data paths wired from on-chain reads (get_dy, calc_token_amount) at prepare time.

## Deferred Items

- Legacy add_liquidity (stETH/ETH pool) — deferred to v2.4.x per CONTEXT.md Open Question 1
- 3-coin meta-pool support
- Gauge staking (Curve gauge deposits)
- Multi-chain Curve (non-Ethereum chains)

## Note for /gsd-verify-work

Real-Ledger smoke tests should exercise:
1. Legacy stETH→ETH swap (i=1,j=0 stETH-in path, valueWei=0n; on-device verify selector 0x3df02124)
2. stable_ng PYUSD→USDC swap with on-device verification that receiver = signer (Fixture CRV-B shape)
3. stable_ng PYUSD/USDC add_liquidity with on-device verification of per-coin amounts + minMintAmount (Fixture CRV-C shape)

## Self-Check: PASSED
