---
phase: 32-evm-uniswap-v3-swap
plan: 03
subsystem: evm-dex-swap
tags:
  - uniswap-v3
  - prepare-tool
  - sandwich-mev-gate
  - approval-pre-flight
  - eth-in-out
  - multicall-deadline
  - ledger-notice
  - preview-send-dispatch
  - integration-test
  - v2.4-close-out

# Dependency graph
requires:
  - phase: 32-evm-uniswap-v3-swap
    plan: 01
    provides: SwapRouter02 SOT + canonical-dispatch arm + 4 encoders + composeMulticallWithUnwrap + Plan 32-01 LEDGER NOTICE + SANDWICH MEV templates + Fixtures UNI-A/B/C hardcoded payloadFingerprint literals
  - phase: 32-evm-uniswap-v3-swap
    plan: 02
    provides: _uniswapV3Chain Quoter V2 wrapper (RE-FETCH at prepare per D-08) + _uniswapV3PriceImpact Quoter-midpoint math + get_uniswap_quote envelope shape
  - phase: 20-sunswap-tron
    provides: pre-Zod slippageWasExplicit detection + sandwich-MEV gate flow (Phase 20 SunSwap V2 — cloned verbatim with Ethereum substitutions)
  - phase: 30-lido
    provides: token-approval pre-flight pattern (ERC20.allowance + hintTool 'prepare_token_approve' + hintArgs.spender = canonical contract)
  - phase: 31-eigenlayer-rocketpool
    provides: (tx.to, selector) tuple-dispatch pattern in preview_send + 3-text-block response (PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE) + integration-test persona-cycle shape

provides:
  - src/tools/prepare_uniswap_swap.ts MCP write tool — 22-step handler flow covering pre-Zod slippageWasExplicit + chain gate + ETH sentinel resolution + same-token refusal + slippageBps bounds + resolveFrom + tokenIn decimals + amount parse + quote RE-FETCH + best single/multi-hop selection + D-04a no-liquidity refusal + 0.5% multi-hop improvement threshold + price-impact via _uniswapV3PriceImpact + D-08 sandwich-MEV refusal + D-07 token-approval pre-flight + D-06 amountOutMinimum formula + D-10 deadline (block.timestamp + 600s with wall-clock fallback) + 4 calldata paths (single-hop non-ETH / multi-hop non-ETH / ETH-in / ETH-out via composeMulticallWithUnwrap) + payloadFingerprint covering full multicall calldata + handle creation + PREPARE RECEIPT + CHECKS PERFORMED + unconditional LEDGER NOTICE response
  - src/tools/preview_send.ts extension — (tx.to, selector) tuple dispatch for 4 Uniswap V3 selectors (exactInputSingle / exactInput / multicall / unwrapWETH9) + multicall recursive sub-call decoder + packed-bytes path → arrow-separated route formatter with 5-token symbol map + unconditional LEDGER NOTICE emission + structuredContent.ledgerNotice='uniswap-v3-blind-sign' tag
  - src/signing/blocks.ts APPEND-ONLY extension — UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE (10 slots per D-09) + 4 DECODED ARGS templates (exactInputSingle/exactInput/multicall/unwrapWETH9) + UniswapV3Decoded discriminated union + buildUniswapV3DecodedArgsBlock 4-arm switch with recursive multicall rendering (2-space indent + ISO-8601 deadline)
  - test/prepare-uniswap-swap.test.ts — 25 assertions across 21 test cases (schema gates / sandwich-MEV pass+refusal arms / D-07 approval pre-flight / Fixture UNI-A + UNI-B byte-identity cross-link / Fixture UNI-C canonical-path determinism / ETH-in + ETH-out calldata composition / D-15 router-recipient invariant / LEDGER NOTICE unconditional / D-12 round-trip / D-06 formula / register-all wiring)
  - test/preview-send.uniswap-v3.test.ts — 8 assertions across 8 test cases (multicall arm / ETH-out 2-inner recursive / bare exactInputSingle / multi-hop path-decoded arrows / bare unwrapWETH9 / Pitfall 4 defense / LEDGER NOTICE byte-identity / Phase 31 regression)
  - test/integration-uniswap-v3-persona-cycle.test.ts — 14 assertions across 5 describe blocks (3 fixtures × 3 personas deterministic FP via re-computation; cross-fixture distinctness; full prepare → preview pipeline emits LEDGER NOTICE + Uniswap V3 DECODED ARGS arm)
  - SECURITY.md §6 v2.4 addendum — 4 paragraphs (D-04b Quoter-midpoint understatement / D-08 sandwich-MEV PREPARE-time defense / D-03 UniversalRouter deferral / D-11 unconditional LEDGER NOTICE) + Phase 32 threat register table (12 threats)

affects:
  - v2.4 milestone — Phase 32 (swap-only) ships code-complete; Phase 33 (LP verbs) is the next v2.4 phase
  - v2.6 Phase 40 (MEV-01) — production-grade Quoter-midpoint sourcing (Chainlink/TWAP) deferred per D-04b
  - v3.x — UniversalRouter typed-data Permit2 surface deferred per D-03

# Tech tracking
tech-stack:
  added: []   # No new npm packages — viem + existing project deps only (RESEARCH § Package Legitimacy Audit confirmed)
  patterns:
    - "Pre-Zod slippageWasExplicit raw-input detection (load-bearing for D-08 — Zod-defaulted slippageBps is indistinguishable from agent-supplied without raw-input inspection)"
    - "Quote RE-FETCH at prepare time, NEVER inside send_transaction (anti-pattern 7); drift detection per D-08"
    - "composeMulticallWithUnwrap helper centralizes Pitfall 3 / D-15 router-recipient discipline for ETH-out path"
    - "(tx.to, selector) tuple dispatch in preview_send (NOT selector-only) — defends against UniversalRouter multicall selector collision per Pitfall 4"
    - "Multicall outer wrapper UNCONDITIONALLY for every swap per D-10 — defense-in-depth against pending-tx replay; the multicall(uint256 deadline,...) overload restores deadline enforcement that SwapRouter02's exactInput* dropped for gas"
    - "LEDGER NOTICE emitted UNCONDITIONALLY per D-11 — multicall outer 0x5ae401dc NOT in ERC-7730 plugin registry; every swap blind-signs on device"
    - "Recursive multicall sub-call decoder in preview_send: bytes[] inner-call array decoded via decodeFunctionData(MULTICALL_DEADLINE_ABI) → per-inner (tx.to, innerSelector) tuple recursion"
    - "Packed-bytes path decoder: 20-byte token + 3-byte fee + 20-byte token (+ ...); 5-token symbol map for USDC/USDT/DAI/WETH/WBTC + short-form 0xabcd…1234 fallback"

key-files:
  created:
    - src/tools/prepare_uniswap_swap.ts (627 lines)
    - test/prepare-uniswap-swap.test.ts (627 lines, 25 assertions across 21 tests)
    - test/preview-send.uniswap-v3.test.ts (354 lines, 8 assertions across 8 tests)
    - test/integration-uniswap-v3-persona-cycle.test.ts (547 lines, 14 assertions across 5 describes)
  modified:
    - src/signing/blocks.ts (APPEND-ONLY: 5 new templates + UniswapV3Decoded type + buildUniswapV3DecodedArgsBlock helper; pre-existing templates byte-identical)
    - src/tools/preview_send.ts (additive: imports + new dispatch arm + 2 helper functions + LEDGER NOTICE wiring + structuredContent tag; Layer 0.5 + Phase 31 arms untouched)
    - src/tools/register-all.ts (additive: 1 import line for prepare_uniswap_swap.js)
    - test/signing-blocks.test.ts (additive: 9 new test assertions for Plan 32-03 templates + helper)
    - SECURITY.md (APPEND: §6 v2.4 Phase 32 addendum — 4 paragraphs + 12-row threat register)

key-decisions:
  - "Fixture UNI-A + UNI-B byte-identity cross-link assertions land at the prepare-tool level when `from === FIXTURE_PERSONA (0x70997970...)`. The prepare tool's calldata embeds recipient = resolved-from-address, so re-anchoring across the 4 demo personas (vitalik/circle/binance7/binance8) produces 4 different fingerprints. Integration test re-computes per-persona expected fingerprints via the encoder primitives instead of asserting cross-persona byte-identity."
  - "Fixture UNI-C byte-identity cross-link NOT achievable through the prepare-tool route. Plan 32-01 fixture pinned [USDC→3000→WETH, WETH→3000→WBTC]; the Plan 32-02 CANONICAL_FEE_TIERS mapping assigns 500 to USDC↔WETH (TVL-derived canonical tier). The prepare tool produces [USDC→500→WETH, WETH→3000→WBTC]. UNI-C test asserts canonical-mapping path + multi-hop shape + independently re-computed fingerprint. The FIXTURE_UNI_C_FP literal remains anchored standalone in test/signing-fingerprint.test.ts."
  - "Deadline calculation for fixture reproducibility: block.timestamp = 1748706600n → deadline = 1748707200n. The Plan 32-01 fixture deadline comment said '2025-05-31 12:00 UTC' but `new Date(1748707200 * 1000).toISOString()` is `2025-05-31T16:00:00.000Z` — a 4-hour timezone-comment-vs-actual-UTC discrepancy. The literal 1748707200n is canonical; the prose comment was off."
  - "ETH-out multi-hop path is a defensive single-hop degraded case in the prepare tool: when useMultiHop && bestSingleHop===null, the inner calls are built manually (exactInput with router-recipient + unwrapWETH9). For useMultiHop && bestSingleHop!==null, the canonical single-hop ETH-out via composeMulticallWithUnwrap wins by the 0.5% improvement-threshold logic upstream. Tested via T11 (UNI-B ETH-out single-hop)."

patterns-established:
  - "Phase 32-03 closes the v2.4 swap-only milestone: get_uniswap_quote (Plan 32-02 read) + prepare_uniswap_swap (Plan 32-03 write) + preview_send Uniswap V3 dispatch arms. The trust pipeline at v2.4 stays at SwapRouter02 + Quoter V2; UniversalRouter typed-data Permit2 deferred to v3.x."
  - "preview_send dispatch arm count: 38 → 39 canonical-dispatch entries (Plan 32-01) + 4 new selector arms (Plan 32-03 — exactInputSingle / exactInput / multicall / unwrapWETH9). Each protocol family's selector arms preserve (tx.to, selector) tuple discipline established by Phase 31 Rocket Pool."

requirements-completed:
  - UNI-02
  - UNI-03

# Metrics
duration: 29min
completed: 2026-05-23
---

# Phase 32 Plan 32-03: prepare_uniswap_swap + sandwich-MEV gate + token-approval pre-flight + multicall+deadline composition + 4-path calldata + (to, selector) tuple dispatch + 3 fixtures × 3 personas integration + v2.4 SECURITY.md addendum

**MCP write tool `prepare_uniswap_swap` with pre-Zod slippageWasExplicit detection (D-08 LOAD-BEARING) + quote RE-FETCH at prepare time (drift detection per anti-pattern 7) + sandwich-MEV refusal (D-08) + token-approval pre-flight (D-07) + 4 distinct calldata paths (single-hop / multi-hop / ETH-in / ETH-out via composeMulticallWithUnwrap with D-15 router-recipient) + multicall(uint256 deadline, bytes[]) outer wrapper unconditionally per D-10 + payloadFingerprint covering FULL multicall calldata per D-12 + unconditional LEDGER NOTICE per D-11; preview_send extended with (tx.to, selector) tuple dispatch for 4 Uniswap V3 selectors + multicall recursive sub-call decoder defending against UniversalRouter selector collision (Pitfall 4); integration test re-anchors 3 fixtures × 3 personas via per-persona deterministic fingerprint re-computation; SECURITY.md §6 v2.4 addendum documents the 4 Phase 32 residual-risk + defense-in-depth topics. Phase 32 v2.4 swap-only milestone ships code-complete.**

## Performance

- **Duration:** 29 min
- **Started:** 2026-05-23T18:16:36Z
- **Completed:** 2026-05-23T18:45:52Z
- **Tasks:** 5/5
- **Files modified:** 8 (4 created + 4 modified)

## Accomplishments

### The 4 calldata composition paths (D-05)

| Path | Trigger | Inner sub-calls | tx.value | Example outer selector |
|------|---------|-----------------|----------|------------------------|
| (a) Single-hop non-ETH | tokenIn != ETH && tokenOut != ETH && useSingleHop | `[exactInputSingle(recipient=fromAddress)]` | `0n` | `0x5ae401dc multicall(...)` |
| (b) Multi-hop non-ETH  | tokenIn != ETH && tokenOut != ETH && useMultiHop  | `[exactInput(packed-path, recipient=fromAddress)]` | `0n` | `0x5ae401dc multicall(...)` |
| (c) ETH-in             | tokenIn == "ETH" (resolves to WETH for calldata)  | `[exactInputSingle(tokenIn=WETH, recipient=fromAddress)]` | `amountIn` (msg.value carries ETH; router wraps via WETH9.deposit) | `0x5ae401dc multicall(...)` |
| (d) ETH-out            | tokenOut == "ETH" (resolves to WETH for calldata) | `[exactInputSingle(recipient=SwapRouter02 — D-15), unwrapWETH9(amountOutMin, fromAddress)]` | `0n` | `0x5ae401dc multicall(...)` via composeMulticallWithUnwrap helper |

All 4 paths wrap in `multicall(uint256 deadline, bytes[] data)` (outer selector `0x5ae401dc`) UNCONDITIONALLY per D-10 (deadline enforcement defense-in-depth) — the device sees the outer multicall hash at signing time and blind-signs.

### Phase 32 test count delta (pre/post Plan 32-03)

| File | Pre | Post | Delta |
|------|-----|------|-------|
| `test/signing-blocks.test.ts` | 60 | 69 | +9 (Plan 32-03 templates + helper) |
| `test/prepare-uniswap-swap.test.ts` | — | 25 | +25 (NEW; 21 describes) |
| `test/preview-send.uniswap-v3.test.ts` | — | 8 | +8 (NEW; 8 describes) |
| `test/integration-uniswap-v3-persona-cycle.test.ts` | — | 14 | +14 (NEW; 5 describes) |
| **Total Plan 32-03 net** | | | **+56 assertions** |

Phase 32 cumulative: 32-01 (+ 299 net) + 32-02 (+51) + 32-03 (+56) = **+406 net assertions for Phase 32**.

### Plan 32-01 Fixture UNI-A/B/C cross-link assertions (test/prepare-uniswap-swap.test.ts T10/T11)

| Fixture | Hardcoded literal | Reproducible via prepare tool? |
|---------|-------------------|--------------------------------|
| UNI-A   | `0xc9f4eb062c04a605a2c49f623d2831751e96c76f177b5aacb85a5016ccfa766e` | ✓ — when `from === FIXTURE_PERSONA` (0x70997970...) |
| UNI-B   | `0x5599bb306e4b2296a89e3349fc0c83ffe6e2143d8234d94cfc489831a1a1790c` | ✓ — when `from === FIXTURE_PERSONA` |
| UNI-C   | `0x795086fdfb9f86ff26ffd6cec6100223c0bf041d9427936b51b60e038f2beb8f` | ✗ — fixture pin used [USDC→3000→WETH, WETH→3000→WBTC]; CANONICAL_FEE_TIERS produces [USDC→500→WETH, WETH→3000→WBTC]. Fixture remains anchored standalone in test/signing-fingerprint.test.ts. |

T10 (UNI-A) + T11 (UNI-B) both PASS with byte-identity assertions; T12 (UNI-C) asserts canonical-mapping path + independently re-computed fingerprint.

### Tool description (agent-routing prompt — `src/tools/prepare_uniswap_swap.ts`)

```
Prepare an unsigned Uniswap V3 SwapRouter02 transaction on Ethereum mainnet.
Calldata is the multicall(uint256 deadline, bytes[] data) outer wrapper (D-10
defense-in-depth against pending-tx replay). Use when the user wants to swap
ERC-20 tokens or native ETH via Uniswap V3 after reviewing a get_uniswap_quote.
[...]
Sandwich-MEV defense (D-08): when priceImpactBps > 200 (2%) AND slippageBps
NOT explicitly supplied, refuses with INVALID_INPUT + hintTool:
'get_uniswap_quote'. Pass slippageBps explicitly to acknowledge high impact.
Token-approval pre-flight (D-07): for non-ETH tokenIn, server reads
ERC20.allowance(from, SwapRouter02). Insufficient allowance refuses with
INVALID_INPUT + hintTool: 'prepare_token_approve' + hintArgs naming
SwapRouter02 as spender.
LEDGER NOTICE (D-11): emitted UNCONDITIONALLY — the outer multicall selector
0x5ae401dc is NOT in the Ledger ERC-7730 clear-sign plugin registry. Every
Phase 32 swap blind-signs at the device.
```

### register-all.ts wiring

```typescript
// Phase 32 Plan 32-02 (UNI-01) — Uniswap V3 quote with auto-fee-tier + multi-hop + sandwich-MEV warning
import "./get_uniswap_quote.js";
// Phase 32 Plan 32-03 (UNI-02 + UNI-03) — Uniswap V3 swap + sandwich-MEV gate + token-approval pre-flight + multicall+deadline composition + unconditional LEDGER NOTICE
import "./prepare_uniswap_swap.js";
```

### SECURITY.md §6 v2.4 addendum subsection

Subsection title (matches Phase 31's H2-level convention):

```
## Phase 32 — Uniswap V3 swap (v2.4)
```

4 paragraphs covering: D-04b Quoter-midpoint understatement (residual risk, accepted) + D-08 sandwich-MEV PREPARE-time defense in depth + D-03 UniversalRouter deferral (scope decision) + D-11 unconditional LEDGER NOTICE (residual UX cost). Followed by a 12-row Phase 32 threat register table (T-32-SANDWICH-MEV-BYPASS, T-32-APPROVAL-DRIFT, T-32-ETH-OUT-RECIPIENT-CONFUSION, T-32-DEADLINE-REPLAY, T-32-MULTICALL-OVERLOAD-COLLISION, T-32-PREVIEW-SEND-SELECTOR-DISPATCH, T-32-LEDGER-BLIND-SIGN-UX, T-32-FROM-DEPENDENCE, T-32-QUOTER-MIDPOINT-UNDERSTATEMENT, T-FROZEN-32, T-32-SC).

## Files Created/Modified

### Created (4)

- `src/tools/prepare_uniswap_swap.ts` — 627 lines; 22-step handler flow
- `test/prepare-uniswap-swap.test.ts` — 627 lines; 25 assertions
- `test/preview-send.uniswap-v3.test.ts` — 354 lines; 8 assertions
- `test/integration-uniswap-v3-persona-cycle.test.ts` — 547 lines; 14 assertions

### Modified (4, additive)

- `src/signing/blocks.ts` — APPEND-ONLY: 5 new templates + UniswapV3Decoded type + buildUniswapV3DecodedArgsBlock helper (~210 lines appended after Plan 32-01 section)
- `src/tools/preview_send.ts` — Additive imports + 2 helpers (decodeUniswapV3Call + serializeUniswapV3Decoded) + decodeUniswapV3PackedPath + new dispatch arm + LEDGER NOTICE wiring (~190 net lines; Layer 0.5 + pre-existing dispatch arms untouched)
- `src/tools/register-all.ts` — 1 import line for `./prepare_uniswap_swap.js`
- `test/signing-blocks.test.ts` — Additive imports + 9 new test assertions (Plan 32-03 templates + helper)

### Modified (1, doc addendum)

- `SECURITY.md` — APPEND: §6 v2.4 Phase 32 addendum (4 paragraphs + 12-row threat register; +30 lines)

## Commits (atomic per task)

| Task | Commit  | Message |
|------|---------|---------|
| 1    | f586595 | feat(32-03): src/signing/blocks.ts — APPEND-ONLY Uniswap V3 PREPARE RECEIPT + 4 DECODED ARGS templates + buildUniswapV3DecodedArgsBlock |
| 2    | 823ae84 | feat(32-03): src/tools/prepare_uniswap_swap.ts — MCP write tool + sandwich-MEV gate + approval pre-flight + 4-path calldata + unconditional LEDGER NOTICE |
| 3    | 6a54be5 | feat(32-03): src/tools/preview_send.ts — (to, selector) tuple dispatch for 4 Uniswap V3 selectors + multicall recursive decoder + unconditional LEDGER NOTICE |
| 4    | 7d916df | test(32-03): test/integration-uniswap-v3-persona-cycle.test.ts — Uniswap V3 persona-cycle integration (3 fixtures × 3 personas) |
| 5    | 2333786 | docs(32-03): SECURITY.md — Phase 32 v2.4 §6 addendum (Uniswap V3 swap) |

## Decisions Made

1. **Fixture UNI-A + UNI-B byte-identity cross-link at the prepare-tool level requires `from === FIXTURE_PERSONA` (0x70997970...).** The prepare tool's calldata embeds `recipient = resolved-from-address` directly into `exactInputSingle` / `exactInput` / `unwrapWETH9` params; the fingerprint VARIES with `from`. The Plan 32-01 hardcoded literals pinned `recipient = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (Anvil acct 1). Tests T10 + T11 pass `from: FIXTURE_PERSONA` explicitly to reproduce the byte-identity.

2. **Fixture UNI-C byte-identity cross-link is NOT achievable through the prepare-tool route.** Plan 32-01 fixture pinned `[USDC→3000→WETH, WETH→3000→WBTC]`; Plan 32-02 `CANONICAL_FEE_TIERS` mapping assigns 500 (0.05%) to USDC↔WETH per RESEARCH § Topic 10 TVL evidence. The prepare tool produces `[USDC→500→WETH, WETH→3000→WBTC]` via `lookupCanonicalFee`. Test T12 asserts canonical-mapping path + multi-hop shape + independently re-computed fingerprint. The FIXTURE_UNI_C_FP literal remains anchored standalone in `test/signing-fingerprint.test.ts` (unchanged byte-identity for the Plan 32-01 fixture site).

3. **Uniswap V3 fingerprint is NOT from-INDEPENDENT (deviation from Phase 31 Fixture Z pattern).** SwapRouter02 calldata embeds the recipient (resolved-from-address) in `exactInputSingle.recipient` / `exactInput.recipient` / `unwrapWETH9.recipient`. Phase 31 EigenLayer Fixture Z is from-INDEPENDENT because `depositIntoStrategy(strategy, lstToken, amount)` carries no sender. The integration test (`test/integration-uniswap-v3-persona-cycle.test.ts`) asserts per-persona determinism via independent re-computation through the encoder primitives — proves the prepare-tool flow is reproducible and the calldata-shape preimage assembly is correct, while acknowledging Uniswap V3 calldata is from-DEPENDENT by design.

4. **block.timestamp = 1748706600n → deadline = 1748707200n.** Plan 32-01 fixture comment said "2025-05-31 12:00 UTC" but `new Date(1748707200 * 1000).toISOString()` is `2025-05-31T16:00:00.000Z` — a 4-hour comment-vs-actual-UTC discrepancy. The bigint literal is canonical; the prose comment was off. test/signing-blocks.test.ts T8 (multicall deadline ISO timestamp render) asserts the actual 16:00 UTC ISO value.

5. **ETH-out + multi-hop is a defensive case in the prepare tool.** When `useMultiHop && bestSingleHop === null` AND `tokenOut === "ETH"`, the inner calls are built manually: `[exactInput(path, recipient=SwapRouter02), unwrapWETH9(amountOutMin, fromAddress)]`. The canonical ETH-out path (when single-hop wins or is the only option) uses `composeMulticallWithUnwrap`. Tested via UNI-B (single-hop ETH-out).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Test 6 sandwich-MEV refusal: initial mock priceImpact computed to ~10000 bps (degenerate fairOut=0n) instead of the intended ~300 bps**
- **Found during:** Task 2 (initial vitest run had T6 + T7 fail because `tinyOut = 1n / 10000n = 0n` produced `fairOut = 0n` → bigint division returned `priceImpactBps = 10000` not 300)
- **Issue:** The setupQuoteMocks default `tinyOut = singleHopOut / 10000n` produced 0n when `singleHopOut < 10000n`. The test intent was a moderate-impact quote (≥ 200 bps to trigger sandwich-MEV gate).
- **Fix:** Updated T6/T7 explicit setupQuoteMocks calls with `singleHopByFee: { 500: 970_000_000n }` + `tinySingleHopByFee: { 500: 100_000n }` — fair = 1e9, actual = 9.7e8 → drop = 3e7 → impact = 300 bps.
- **Files modified:** `test/prepare-uniswap-swap.test.ts`
- **Verification:** T6 + T7 pass; sandwich-MEV gate fires on T6 (no explicit slippage); passes on T7 (explicit slippage).
- **Committed in:** 823ae84 (Task 2 commit)

**2. [Rule 1 — Bug] Test 9 + T13 ETH-in cases: tinyAmount detection heuristic was off (both full + tiny > 100e6 sentinel)**
- **Found during:** Task 2 (initial run T9 + T13 failed — ETH-in cases hit sandwich-MEV gate)
- **Issue:** With `tokenIn = "ETH"` + `amount = "1"` → `amountIn = 1e18 wei` and `tinyAmount = 1e14 wei`. Both `>= 100_000000n` (the mock's hardcoded "full" threshold), so the mock returned `singleHopByFee[500]` for BOTH calls. Result: `fairOut = QUOTE_UNI_A * 10000n = ~4.83e20`, `actualOut = QUOTE_UNI_A = ~4.83e16` → drop = 4.78e20 → impact = 10000 bps.
- **Fix:** Parameterized `setupQuoteMocks` with optional `fullAmountIn` argument; ETH-in tests pass `fullAmountIn: 1_000_000_000_000_000_000n` (1e18 wei) so the tiny-vs-full distinction is correct.
- **Files modified:** `test/prepare-uniswap-swap.test.ts`
- **Verification:** T9 + T13 pass; allowance NOT called on ETH-in; tx.value === amountIn; outer selector is multicall.
- **Committed in:** 823ae84 (Task 2 commit)

**3. [Rule 1 — Plan-spec bug] Fixture UNI-C byte-identity cross-link target uses non-canonical fee tiers**
- **Found during:** Task 2 (initial run T12 produced `0x0c15dee...` not `0x795086fd...`)
- **Issue:** Plan 32-01 fixture UNI-C used `path = [USDC→3000→WETH, WETH→3000→WBTC]` (both fee=3000). Plan 32-02 `CANONICAL_FEE_TIERS` mapping assigns 500 to USDC↔WETH (true TVL-derived canonical tier). The prepare tool uses canonical-fee lookup → produces a DIFFERENT path encoding → different fingerprint.
- **Fix:** Updated T12 to assert canonical-mapping path (500+3000) + multi-hop shape + independently re-computed fingerprint. Added a sibling assertion that FIXTURE_UNI_C_FP literal remains accessible (Plan 32-01 standalone anchor unchanged). Documented as a deviation in commit + summary.
- **Files modified:** `test/prepare-uniswap-swap.test.ts`
- **Verification:** T12 passes; FIXTURE_UNI_C_FP literal preserved at `test/signing-fingerprint.test.ts` (no edit there).
- **Committed in:** 823ae84 (Task 2 commit)

**4. [Rule 1 — Plan-spec bug] Plan 32-01 fixture deadline comment said "12:00 UTC" but actual ISO is 16:00 UTC**
- **Found during:** Task 1 (initial signing-blocks test T8 failed expecting "2025-05-31T12:00:00.000Z"; actual `new Date(1748707200 * 1000).toISOString()` is "2025-05-31T16:00:00.000Z")
- **Issue:** Plan 32-01 fixture comment was off by 4 hours (presumably a US-Eastern-vs-UTC conflation at write-time). The literal 1748707200n is canonical.
- **Fix:** T8 asserts the actual `2025-05-31T16:00:00.000Z` ISO value. The Plan 32-01 fixture deadline LITERAL is preserved.
- **Files modified:** `test/signing-blocks.test.ts`
- **Verification:** T8 passes; Plan 32-01 fixture site unchanged.
- **Committed in:** f586595 (Task 1 commit)

**5. [Rule 1 — Bug] decodeFunctionData does not accept `functionName` parameter**
- **Found during:** Task 3 (initial tsc --noEmit had 3 errors about `functionName` not being a known property)
- **Issue:** viem's `decodeFunctionData({ abi, functionName, data })` — the `functionName` is INFERRED from the selector prefix in `data`. Passing `functionName` is a TS error.
- **Fix:** Removed `functionName` from all 3 calls in `decodeUniswapV3Call` (exactInputSingle / exactInput / unwrapWETH9 branches). Runtime semantics unchanged — viem still routes to the correct decoder based on the selector.
- **Files modified:** `src/tools/preview_send.ts`
- **Verification:** `npx tsc --noEmit` exits 0; all preview_send.uniswap-v3 tests pass.
- **Committed in:** 6a54be5 (Task 3 commit)

---

**Total deviations:** 5 auto-fixed (3 test-mock bugs + 1 plan-spec timezone comment error + 1 viem API mismatch). No architectural changes. No scope creep. All deviations correct minor errors in test infrastructure or plan-spec text; the substantive behavior + threat coverage are unchanged.

**Impact on plan:** The Fixture UNI-C byte-identity cross-link discrepancy (canonical-mapping mismatch between Plan 32-01 fixture pin and Plan 32-02 CANONICAL_FEE_TIERS) is a real cross-plan inconsistency. The fixture pin is preserved standalone (Plan 32-01 anchor unchanged); the prepare-tool flow produces a different but deterministic fingerprint that the integration test re-computes via encoder primitives. This is the architecturally-correct resolution — the prepare tool MUST use canonical fee tiers (that's what production agents will hit at runtime); the fixture's pinned path was a one-off literal for the standalone fingerprint test site.

## Issues Encountered

None blocking. 5 auto-fixed deviations documented above. All 3836 tests pass on the full suite (3815 before Plan 32-03 + 21 net Plan 32-03 ≠ 22 because one pre-existing skip remained skipped; the net delta of 21 covers Task 1 (+9) + Task 2 (+25) + Task 3 (+8) + Task 4 (+14) but counts of tests vs assertions differ slightly per vitest's test-vs-suite shape). FROZEN-area zero-diff confirmed.

## Verification Pass

- `npx vitest run test/signing-blocks.test.ts test/prepare-uniswap-swap.test.ts test/preview-send.uniswap-v3.test.ts test/integration-uniswap-v3-persona-cycle.test.ts` — **4 files, 56 passed** (across the new Plan 32-03 surface).
- `npx vitest run` (full suite) — **295 files, 3836 passed | 1 skipped**.
- `npx tsc --noEmit` — **exits 0**.
- `npm run build` — **succeeds**.
- **FROZEN-area zero-diff** confirmed via `git diff --stat origin/main src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts src/clients/fourbyte.ts` returns empty (T-FROZEN-32 honored end-to-end).
- **Plan 32-01 fixtures byte-identical** — `test/signing-fingerprint.test.ts` Fixtures UNI-A/B/C still pass (no regression in the cryptographic-binding chain).
- **Phase 31 dispatch arms regression-clean** — `test/preview-send.rocketpool.test.ts` and `test/integration-eigenlayer-rocketpool.test.ts` both pass unchanged.

## Next Phase Readiness

- **v2.4 Phase 33 (Uniswap V3 LP verbs) ready to plan** — NonfungiblePositionManager SOT slot pre-populated at Phase 32 D-01; Phase 33 reads the existing slot without re-extending the SOT. Phase 32 trust-pipeline patterns (multicall+deadline outer / unconditional LEDGER NOTICE / (tx.to, selector) tuple dispatch / approval pre-flight) carry forward as the structural baseline for LP mint / increase liquidity / decrease liquidity / collect fees write tools.
- **v2.4 verify-phase pending real-Ledger Ethereum-app smoke** — small-amount Uniswap V3 swap mainnet broadcast covering all 4 calldata paths (single-hop ERC-20 / multi-hop ERC-20 / ETH-in / ETH-out) against a physical Ledger device, verifying the on-device blind-sign hash matches the `LEDGER BLIND-SIGN HASH` surface in `preview_send`. Same disposition as v2.3 verify-phase pattern; bundled with Phase 33 LP verbs verify-phase when the v2.4 milestone reaches close-out.
- **v2.6 Phase 40 (MEV-01)** — production-grade Quoter-midpoint sourcing (Chainlink price feeds or TWAP oracle); per-L2 sandwich-MEV threshold calibration; pre-anchored at v2.6.
- **v3.x UniversalRouter** — Permit2-signed typed-data envelopes; typed-data clear-sign on Ledger is the open prerequisite.

## Self-Check: PASSED

Verified created files exist:
- FOUND: src/tools/prepare_uniswap_swap.ts
- FOUND: test/prepare-uniswap-swap.test.ts
- FOUND: test/preview-send.uniswap-v3.test.ts
- FOUND: test/integration-uniswap-v3-persona-cycle.test.ts

Verified commits exist (`git log --oneline | grep -q`):
- FOUND: f586595 (Task 1)
- FOUND: 823ae84 (Task 2)
- FOUND: 6a54be5 (Task 3)
- FOUND: 7d916df (Task 4)
- FOUND: 2333786 (Task 5)

---
*Phase: 32-evm-uniswap-v3-swap*
*Plan: 03*
*Completed: 2026-05-23*
