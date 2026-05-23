---
phase: 32-evm-uniswap-v3-swap
plan: 02
subsystem: evm-dex-quote
tags:
  - uniswap-v3
  - quote-tool
  - quoter-v2
  - auto-fee-tier
  - multi-hop
  - sandwich-mev-warning
  - v2.4

# Dependency graph
requires:
  - phase: 32-evm-uniswap-v3-swap
    plan: 01
    provides: QUOTER_V2_ABI + UNISWAP_V3_SELECTORS.quoteExactInputSingle/quoteExactInput + getUniswapV3QuoterV2Address(1) SOT getter + PathHop interface + encodeV3Path (via _uniswapV3Path) + Fixture UNI-A cross-link target
  - phase: 31-eigenlayer-rocketpool
    provides: _rocketPoolChains/_eigenLayerChains shape — ESM spy-affordance for chain-client wrappers (used as analog for _uniswapV3Chain)
  - phase: 20-sunswap-tron
    provides: get_sunswap_quote envelope shape + sandwich-MEV warning string convention — cloned with EVM substitutions
  - phase: 6-erc20-lifecycle
    provides: parseAmountStrict (decimal-overflow guard) + InvalidAmountError + erc20Abi readContract pattern for decimals resolution

provides:
  - src/signing/uniswap-price-impact.ts pure-bigint Quoter-midpoint math (computePriceImpactBps + PriceImpactInput + _uniswapV3PriceImpact spy-affordance)
  - src/chains/uniswap-v3.ts Quoter V2 chain wrapper (quoteAllSingleHopFeeTiers via Promise.allSettled 4-tier iteration + quoteMultiHopCandidates via canonical mapping + CANONICAL_FEE_TIERS 7-entry SOT + pairKey + lookupCanonicalFee + _uniswapV3Chain spy-affordance)
  - src/tools/get_uniswap_quote.ts MCP tool — auto-fee-tier selection + 0.5% multi-hop improvement threshold + D-04a no-liquidity refusal + ETH sentinel resolution + D-08 sandwich-MEV warning + decimal-aware amount + slippage bounds

affects:
  - 32-03 (prepare_uniswap_swap — will re-fetch the quote at prepare time for sandwich-MEV refusal gate; consumes envelope shape from Task 3 + price-impact math from Task 1)
  - phase 40 (per-L2 sandwich-MEV calibration — will widen the threshold table from the 200-bps hardcode in get_uniswap_quote.ts)

# Tech tracking
tech-stack:
  added: []   # No new npm packages — viem + existing project deps only
  patterns:
    - "Promise.allSettled per-tier iteration to avoid batch-poisoning when individual fee tiers revert (no pool at that tier) — T-32-QUOTER-REVERT-POISON mitigation"
    - "Quoter V2 struct field order INTENTIONALLY DIFFERENT from SwapRouter02 ExactInputSingleParams (Pitfall 1 — amountIn before fee; no recipient; no amountOutMinimum)"
    - "Pure-bigint Quoter-midpoint price-impact math with the single bigint-to-number cast at the final return (no float in the algorithm)"
    - "ETH sentinel resolved server-side to WETH for the Quoter call; envelope echoes 'ETH' back unchanged (D-05 — agent preserves input shape)"
    - "Same-token-swap caught AFTER sentinel resolution (catches ETH↔ETH + ETH↔WETH + address-equivalence in one place)"
    - "CANONICAL_FEE_TIERS as 7-entry hardcoded TVL-derived mapping; the 0.5% improvement threshold in the tool layer makes stale mapping degrade gracefully ('still works' not 'broken')"

key-files:
  created:
    - src/signing/uniswap-price-impact.ts
    - src/chains/uniswap-v3.ts
    - src/tools/get_uniswap_quote.ts
    - test/signing-uniswap-price-impact.test.ts
    - test/chains-uniswap-v3.test.ts
    - test/get-uniswap-quote.test.ts
  modified:
    - src/tools/register-all.ts   (additive: 1 import line `./get_uniswap_quote.js`)

key-decisions:
  - "Quoter-midpoint method uses tiny-amount fair reference at the CALLER level (sub-base-unit fallback in get_uniswap_quote.ts when amountIn / 10000n === 0n); the helper itself stays pure with no fallback logic. Documented residual risk per D-04b — UNDERSTATES impact on concentrated-liquidity pools; D-08 2% refusal threshold is the mitigation."
  - "Token anchor constants (WETH/USDC/USDT/DAI/WBTC) live as module-level const in src/chains/uniswap-v3.ts (NOT in src/config/contracts.ts) — Phase 32 is Ethereum-only by D-03; multi-chain expansion will move them. Avoids a SOT extension Phase 33 will overlap."
  - "Promise.all (without .allSettled) used at the tool layer for the 3-way parallel of singleHop + multiHop + tinySingleHop — these are 3 DIFFERENT chain-client calls that themselves use allSettled internally per tier. The outer Promise.all is safe because each inner call NEVER throws (T-32-QUOTER-REVERT-POISON discipline holds at the chain layer)."
  - "Quoter V2 SOT-getter null branch handled defensively as INTERNAL_ERROR (not all-null Promise.allSettled). At Phase 32 the chainId=1 slot is populated; null indicates SOT corruption — distinct failure mode from D-04a no-liquidity, hence different error code."
  - "Auto-fee-tier first-non-null wins on tied amountOut (the selection loop's > comparator does not update on equality). Documented in test/get-uniswap-quote.test.ts comment — tighter mocks exercise per-tier-output selection via Test 2."

patterns-established:
  - "Chain-client analog chain extended: aave-v3 → rocketpool → eigenlayer → uniswap-v3. Each wraps readContract with ESM spy-affordance _<protocol>Chain footer."
  - "Quote-envelope shape stable across phases: { inputToken, outputToken, inAmount, outAmount, route, priceImpactBps, slippageBps, source } — Phase 20 SunSwap shape extended with EVM fields (fee?, chain, chainId) at Phase 32."
  - "Sandwich-MEV WARNING at quote time vs REFUSAL at prepare time: warning string only at >2% impact during quote; refusal block lives at prepare time (Plan 32-03 wires it). Mirrors Phase 20 SunSwap V2 split between get_sunswap_quote (warning) + prepare_sunswap_swap (gate)."

requirements-completed:
  - UNI-01

# Metrics
duration: 14min
completed: 2026-05-23
---

# Phase 32 Plan 32-02: get_uniswap_quote — auto-fee-tier + multi-hop + sandwich-MEV warning

**Quoter V2 chain wrapper with Promise.allSettled 4-tier iteration + canonical-mapped multi-hop candidates + Quoter-midpoint price-impact + MCP tool `get_uniswap_quote` returning the standard quote envelope with auto-fee-tier selection, 0.5% multi-hop improvement threshold, D-04a no-liquidity refusal, ETH sentinel resolution, and sandwich-MEV WARNING at priceImpactBps > 200 (REFUSAL block lives at prepare time — Plan 32-03).**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-23T20:58 UTC
- **Completed:** 2026-05-23T21:11 UTC
- **Tasks:** 3/3
- **Files modified:** 7 (3 source created + 3 test created + 1 modified)

## Accomplishments

### Surfaces created (consumed by Plan 32-03 prepare tool)

- **`src/signing/uniswap-price-impact.ts`** (NEW) — Pure-bigint Quoter-midpoint math. `computePriceImpactBps(input: PriceImpactInput): number` with 3 deterministic edge cases (degenerate fairOut=0n → 10000; actualOut > fairOut → 0; bps > 10000n → cap). Single bigint→number cast at the final return. ESM spy-affordance `_uniswapV3PriceImpact`. JSDoc carries D-04b residual-risk text verbatim.
- **`src/chains/uniswap-v3.ts`** (NEW) — Quoter V2 chain client wrapper. `quoteAllSingleHopFeeTiers` iterates 4 tiers via `Promise.allSettled`; per-tier reverts mapped to null. `quoteMultiHopCandidates` builds 0..2 WETH/USDC-anchored paths from `CANONICAL_FEE_TIERS` (7-entry hardcoded mapping per RESEARCH § Topic 10) and quotes them in parallel. Quoter V2 struct field order preserved (Pitfall 1: tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96). ESM spy-affordance `_uniswapV3Chain`.
- **`src/tools/get_uniswap_quote.ts`** (NEW) — MCP tool registration. 16-step handler flow: chain-validation → sentinel-resolution → same-token-refusal → slippage-bounds → decimals-resolution → amount-parse → SOT-presence check → 3-way parallel Quoter reads → best-single-hop + best-multi-hop selection → D-04a no-liquidity refusal → 0.5% improvement threshold → Quoter-midpoint price-impact → route descriptor → text response → sandwich-MEV warning → structured envelope.
- **`src/tools/register-all.ts`** (additive 1 line) — `import "./get_uniswap_quote.js";` placed adjacent to Plan 31-03 entries, preserving phase-ordered convention.

### CANONICAL_FEE_TIERS mapping (per RESEARCH § Topic 10; TVL evidence 2026-05-23)

| Pair         | Fee tier | % cost |
|--------------|----------|--------|
| WETH ↔ USDC  | 500      | 0.05%  |
| WETH ↔ USDT  | 3000     | 0.30%  |
| WETH ↔ WBTC  | 3000     | 0.30%  |
| WETH ↔ DAI   | 3000     | 0.30%  |
| USDC ↔ USDT  | 100      | 0.01%  |
| USDC ↔ DAI   | 100      | 0.01%  |
| USDT ↔ DAI   | 100      | 0.01%  |

A3 stability assumption documented in RESEARCH § Assumptions Log. Re-verify at any Uniswap protocol-major-version bump (V4 / Permit2 era). If stale: multi-hop quotes pick suboptimal tiers and lose to single-hop via the 0.5% improvement threshold — function degrades to "leaves output on the table" not "broken" (T-32-FEE-TIER-CANONICAL-MAPPING-STALE accept disposition).

### Tool description (agent-routing prompt — `src/tools/get_uniswap_quote.ts`)

```
Get a Uniswap V3 quote on Ethereum mainnet for a token swap. Returns the
expected output amount, auto-selected fee tier (best of 0.01% / 0.05% / 0.30%
/ 1.00% pools), route (single-hop or multi-hop via WETH/USDC anchor), price
impact (basis points), and slippage tolerance. Quote source is always
'uniswap-v3-quoter-v2' (on-chain readContract via the Quoter V2 contract —
no fallback snapshot). Use before prepare_uniswap_swap to get priceImpactBps
and decide whether to explicitly supply slippageBps. When priceImpactBps >
200 (2%), you MUST pass slippageBps explicitly to prepare_uniswap_swap
(sandwich-MEV defense per D-08). Native ETH supported via tokenIn or
tokenOut = 'ETH' sentinel; server resolves to WETH internally for the
Quoter call but echoes 'ETH' back in the envelope inputToken/outputToken.
Phase 32: Ethereum mainnet only. Other EVM chains coming in v2.5+ via
Phase 8 multi-chain surface. Failure modes: INVALID_INPUT (chain not
ethereum, malformed tokenIn/tokenOut, same-token-swap, decimal-overflow,
slippageBps out of bounds, no Uniswap V3 liquidity at any standard fee tier
with hintTool: 'request_capability'); INTERNAL_ERROR (RPC failure).
```

### Price-impact sample trace (D-04b worked example)

Inputs: USDC → WETH, amountIn = 100_000_000 (100 USDC at 6 decimals), fee tier 500 = 0.05%.

```
tinyAmount  = amountIn / 10000n              = 10_000n          (sub-base-unit fallback NOT triggered)
tinyOut     = QuoterV2(tinyAmount).out       = 100n             (mock data)
fairOut     = tinyOut * 10000n               = 1_000_000n       (impact-free reference)
actualOut   = QuoterV2(amountIn).out         = 999_000n         (full-amount quote)
drop        = fairOut - actualOut            = 1_000n           (floored at 0n)
priceImpactBps = (drop * 10000n) / fairOut   = (1_000n * 10000n) / 1_000_000n
                                              = 10               (0.10%)
```

Result: priceImpactBps = 10 (below the 200-bps sandwich-MEV threshold; no warning emitted).

### Quote envelope shape

```typescript
{
  inputToken:    "ETH" | Address,          // echoes agent input
  outputToken:   "ETH" | Address,          // echoes agent input
  inAmount:      string,                   // raw bigint as decimal string
  outAmount:     string,                   // raw bigint as decimal string
  fee?:          100 | 500 | 3000 | 10000, // present on single-hop ONLY
  route: {
    hops: Array<{ tokenIn: string; fee: 100 | 500 | 3000 | 10000; tokenOut: string }>,
    strategy: "single-hop" | "multi-hop",
  },
  priceImpactBps: number,                  // 0..10000
  slippageBps:    number,                  // 1..10000 (default 50)
  source:         "uniswap-v3-quoter-v2",
  chain:          "ethereum",
  chainId:        1,
}
```

## Files Created/Modified

### Created (6)
- `src/signing/uniswap-price-impact.ts` — 127 lines; pure-bigint Quoter-midpoint helper
- `src/chains/uniswap-v3.ts` — 350 lines; Quoter V2 wrapper with Promise.allSettled 4-tier + canonical multi-hop iteration
- `src/tools/get_uniswap_quote.ts` — 393 lines; MCP tool with 16-step handler flow
- `test/signing-uniswap-price-impact.test.ts` — 11 assertions
- `test/chains-uniswap-v3.test.ts` — 20 assertions
- `test/get-uniswap-quote.test.ts` — 20 assertions (with Fixture UNI-A cross-link)

### Modified (1, additive)
- `src/tools/register-all.ts` — 1 import line for `./get_uniswap_quote.js` (Phase 32 Plan 32-02)

## Commits (atomic per task)

| Task | Commit  | Message |
|------|---------|---------|
| 1    | f54ee4f | feat(32-02): src/signing/uniswap-price-impact.ts — pure-bigint Quoter-midpoint price-impact math |
| 2    | 004db31 | feat(32-02): src/chains/uniswap-v3.ts — Quoter V2 wrapper with Promise.allSettled fee-tier iteration |
| 3    | 54828c7 | feat(32-02): src/tools/get_uniswap_quote.ts — MCP tool with auto-fee-tier + multi-hop + sandwich-MEV warning |

## Decisions Made

1. **Sub-base-unit tinyAmount fallback at the CALLER level** — The price-impact helper stays pure (no fallback logic); the caller in `src/tools/get_uniswap_quote.ts` computes `tinyAmount = amountIn / 10000n` and, when that yields 0n, falls back to `tinyAmount = amountIn` with `tinyScaleFactor = 1n`. Keeps the helper unit-testable with deterministic inputs.

2. **Token anchor constants live in `src/chains/uniswap-v3.ts`, NOT `src/config/contracts.ts`** — Phase 32 is Ethereum-only by D-03; the 5 token addresses (WETH/USDC/USDT/DAI/WBTC) are scoped to the Quoter V2 wrapper and consumed nowhere else at v2.4. Phase 40+ multi-chain widening will migrate to the SOT. Avoids SOT churn that Phase 33 will overlap.

3. **Outer Promise.all is safe at the tool layer** — Promise.all (without .allSettled) is used for the 3-way parallel of singleHop + multiHop + tinySingleHop reads. Each inner call uses Promise.allSettled internally and NEVER throws (T-32-QUOTER-REVERT-POISON discipline holds at the chain layer). Documented in the tool's Step 7 comment.

4. **Quoter V2 SOT-getter null branch yields INTERNAL_ERROR (not D-04a no-liquidity)** — Defensive Step 6 check. At Phase 32 chainId=1 is populated; null indicates SOT corruption, not a missing pool. Distinct failure mode → distinct errorCode.

5. **First-non-null wins on tied amountOut** — The selection-loop's `>` comparator does not update on equality. Documented in test/get-uniswap-quote.test.ts Test 1 comment; Test 2 exercises per-tier-output selection with distinct mocks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Plan-spec bug] `Number(...)` mention in JSDoc comments tripped the acceptance grep**
- **Found during:** Task 1 (acceptance criterion `grep -E "Math\.|Number\(|parseFloat|parseInt" src/signing/uniswap-price-impact.ts | grep -v "Number(bps" | wc -l` returns 0)
- **Issue:** Two JSDoc lines referenced `Number(...)` cast as part of explanatory prose, which `grep -v "Number(bps"` did not filter out (the comment text said `Number(...)`, not `Number(bps`).
- **Fix:** Reformulated the two JSDoc lines to use "bigint-to-number cast at the final return" prose instead of the literal `Number(...)` substring. The runtime code (`return Number(bps > 10000n ? 10000n : bps);`) is unchanged; the threat-documentation is preserved with paraphrased prose.
- **Files modified:** `src/signing/uniswap-price-impact.ts`
- **Verification:** `grep -E "Math\.|Number\(|parseFloat|parseInt" src/signing/uniswap-price-impact.ts | grep -v "Number(bps" | wc -l` returns 0; 11/11 tests still pass.
- **Committed in:** f54ee4f (Task 1 commit)

**2. [Rule 1 — Plan-spec bug] `Promise.all` mention in module-header comment tripped the anti-pattern guard**
- **Found during:** Task 2 (acceptance criterion `grep -cE 'Promise\.all\(|Promise\.all\s' src/chains/uniswap-v3.ts` returns 0)
- **Issue:** Module-header comment said "Promise.all would poison the whole batch" as part of the threat documentation for T-32-QUOTER-REVERT-POISON. The literal substring `Promise.all ` (with trailing space) matched the anti-pattern grep.
- **Fix:** Reformulated the comment to "the non-Settled variant of the parallel-promise primitive" without using the literal `Promise.all<space>` or `Promise.all(` form. Threat-documentation preserved with paraphrased prose; runtime cross-link via the `Promise.allSettled` calls + 20 regression assertions in test/chains-uniswap-v3.test.ts.
- **Files modified:** `src/chains/uniswap-v3.ts`
- **Verification:** `grep -cE 'Promise\.all\(|Promise\.all\s' src/chains/uniswap-v3.ts` returns 0; `Promise.allSettled` count remains 8.
- **Committed in:** 004db31 (Task 2 commit)

**3. [Rule 1 — Plan-spec bug] Acceptance criterion grep pattern doesn't match `export async function`**
- **Found during:** Task 2 (acceptance criterion `grep -c "export function quoteAllSingleHopFeeTiers\|export function quoteMultiHopCandidates\|export function pairKey\|export function lookupCanonicalFee" src/chains/uniswap-v3.ts` expected to return 4)
- **Issue:** The two `quote*` functions are `async` (they return Promises) and declared as `export async function ...`. The grep pattern `"export function quoteAllSingleHopFeeTiers"` does NOT match `"export async function quoteAllSingleHopFeeTiers"`. Result: grep returns 2 (only the synchronous `pairKey` and `lookupCanonicalFee` match), not 4.
- **Fix:** Documented as a deviation; no source code change required. The 4 functions ARE all exported (verifiable via the test file's imports — all 4 are consumed). The `async` qualifier is structurally mandatory (the functions await readContract). The plan's acceptance grep pattern is the spec bug; the runtime test coverage (20 assertions in test/chains-uniswap-v3.test.ts) is the load-bearing assertion.
- **Files modified:** none
- **Verification:** All 4 functions imported successfully in test file; `npm run build` passes; 20/20 test assertions pass.
- **Committed in:** 004db31 (Task 2 commit; no source change needed)

**4. [Rule 1 — Bug] Test 1 expected `fee=500` but mock returns equal output for all tiers → `fee=100` wins on first-non-null**
- **Found during:** Task 3 (initial `vitest run test/get-uniswap-quote.test.ts` had 2 failures)
- **Issue:** Test 1 (happy-path envelope shape) used `setupMocks({ singleHopOut: 50_000_000_000_000_000n, ... })` which returns the SAME amountOut for all 4 fee tiers. The tool's selection loop uses a strict `>` comparator, so the FIRST non-null tier wins on tied amounts. The fee-tier iteration order is `[100, 500, 3000, 10000]` → fee=100 wins. The test's `expect(sc.fee).toBe(500)` was incorrect for the equal-tier mock.
- **Fix:** Updated Test 1 assertion to `expect(sc.fee).toBe(100)` with an explanatory comment that documents the equal-tier-tie-breaks-to-first-non-null behavior; cross-link to Test 2 which exercises distinct per-tier outputs with a tighter mock.
- **Files modified:** `test/get-uniswap-quote.test.ts`
- **Verification:** Test 1 passes; Test 2 still exercises per-tier-output selection (fee=500 wins with distinct mocks).
- **Committed in:** 54828c7 (Task 3 commit)

**5. [Rule 1 — Bug] Test 11 "priceImpactBps <= 200 no warning" used a default tinyOut that produced fairOut=0n → degenerate 10000 bps**
- **Found during:** Task 3 (initial `vitest run` had Test 11 failing — text DID contain `⚠ Price impact`)
- **Issue:** The `setupMocks` helper's default `tinyOut = singleHopOut / 10000n` yielded `1000n / 10000n = 0n` when `singleHopOut = 1000n`. The tool then computes `fairOut = 0n * 10000n = 0n` → `computePriceImpactBps` returns 10000 (degenerate case) → warning string IS emitted. The test's intent ("no warning at <= 200 bps") required an explicit `tinyOut` driving a non-zero fairOut with small drop.
- **Fix:** Test 11 now uses `setupMocks({ singleHopOut: 999_000n, tinyOut: 100n, amountIn: 100_000_000n })` — yields fairOut=1_000_000n, drop=1_000n, bps=10 (0.10%). Warning correctly suppressed.
- **Files modified:** `test/get-uniswap-quote.test.ts`
- **Verification:** Test 11 passes; full file 20/20 pass.
- **Committed in:** 54828c7 (Task 3 commit)

---

**Total deviations:** 5 auto-fixed (2 plan-spec grep-collision bugs in acceptance criteria, 1 plan-spec `export async function` regex mismatch, 2 test-mock-helper bugs). No architectural changes. No scope creep. All deviations correct minor errors in the plan's specification text; the substantive behavior + threat-coverage are unchanged.

**Impact on plan:** Acceptance grep collisions are a recurring pattern (Plan 32-01 also hit 3 of them). Future plans MAY benefit from a separate "comments may contain symbol-X" carve-out in `grep -c` acceptance criteria; punted to a future GSD process improvement, not blocking Phase 32.

## Issues Encountered

None. Quoter V2 mock-driven testing was straightforward; the Plan 32-01 protocol-decoder + path-encoder surfaces consumed exactly as the plan anticipated.

## Verification Pass

- `npx vitest run test/signing-uniswap-price-impact.test.ts test/chains-uniswap-v3.test.ts test/get-uniswap-quote.test.ts` — **3 files, 51 passed**.
- `npx vitest run` (full suite) — **292 files, 3778 passed | 1 skipped**.
- `npx tsc --noEmit` — **exits 0**.
- `npm run build` — **succeeds**.
- **FROZEN-area zero-diff** confirmed via `git diff --stat src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts src/clients/fourbyte.ts` returns empty (T-FROZEN-32 honored end-to-end).
- **Anti-pattern guards** confirmed: `grep -cE 'Promise\.all\(|Promise\.all\s' src/chains/uniswap-v3.ts` returns 0; `Promise.allSettled` count = 8; `Math.|Number\(|parseFloat|parseInt` count in `src/signing/uniswap-price-impact.ts` (excluding `Number(bps`) returns 0.
- **Plan 32-01 fixtures byte-identical** — `test/signing-fingerprint.test.ts` Fixtures UNI-A/B/C still pass (no regression in the cryptographic-binding chain).

## Next Phase Readiness

- **Plan 32-03 (`prepare_uniswap_swap`) ready to plan + execute** — consumes:
  - `getUniswapV3SwapRouter02Address(1)` from Plan 32-01 SOT (calldata `tx.to`)
  - `composeMulticallWithUnwrap` + `encodeExactInputSingle` + `encodeExactInput` + `encodeMulticallWithDeadline` from Plan 32-01 (calldata composition)
  - `LEDGER_NOTICE_UNISWAP_V3_TEMPLATE` (unconditional blind-sign notice) + `SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE` (D-08 gate) from Plan 32-01
  - **`get_uniswap_quote` envelope shape from Task 3** — Plan 32-03 will re-fetch the quote at prepare time and read `priceImpactBps` to gate the sandwich-MEV refusal
  - **`_uniswapV3PriceImpact.computePriceImpactBps` from Task 1** — Plan 32-03 will re-compute price-impact at prepare time after the re-fetch
  - Fixtures UNI-A/B/C as integration anchors
- **SECURITY.md §6 v2.4 addendum** lands in Plan 32-03 (D-04b residual-risk + D-08 sandwich-MEV defense-in-depth + D-03 UniversalRouter deferral + D-11 unconditional LEDGER NOTICE rationale).

## Self-Check: PASSED

Verified created files exist:
- FOUND: src/signing/uniswap-price-impact.ts
- FOUND: src/chains/uniswap-v3.ts
- FOUND: src/tools/get_uniswap_quote.ts
- FOUND: test/signing-uniswap-price-impact.test.ts
- FOUND: test/chains-uniswap-v3.test.ts
- FOUND: test/get-uniswap-quote.test.ts

Verified commits exist (`git log --oneline | grep -q`):
- FOUND: f54ee4f (Task 1)
- FOUND: 004db31 (Task 2)
- FOUND: 54828c7 (Task 3)

---
*Phase: 32-evm-uniswap-v3-swap*
*Plan: 02*
*Completed: 2026-05-23*
