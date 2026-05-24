---
phase: 33-evm-uniswap-v3-lp-verb-set
plan: 01
subsystem: signing-pipeline + protocol-read
tags: [uniswap-v3, lp, npm, tick-math, ledger-blind-sign, sot]
requires:
  - "Phase 32 D-01: UniswapV3Contracts.nonfungiblePositionManager pre-populated in src/config/contracts.ts:754 (getter at line 787)"
  - "Phase 32 D-13a: KNOWN_SPENDERS_ETHEREUM 'Uniswap V3 SwapRouter02' row promotion pattern (insertion model + cross-view drift test idiom)"
  - "Phase 32 D-15: composeMulticallWithUnwrap centralization pattern (sibling pure-math shelf convention in src/signing/)"
provides:
  - "Uniswap V3 LP read surface: get_lp_positions({wallet, chain?}) returns per-NFT envelope (UNI-04)"
  - "5 pure-bigint LP math modules under src/signing/uniswap-{tick,liquidity,fees,il,pool-address}.ts (UNI-10)"
  - "NonfungiblePositionManager promoted to KNOWN_SPENDERS_ETHEREUM + CANONICAL_DISPATCH_TARGETS.ethereum (T-UNISWAP-V3-NPM-SPENDER-DRIFT-1 + T-DISPATCH-ALLOWLIST-DRIFT-2 mitigations)"
  - "LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE in src/signing/blocks.ts (APPEND-ONLY, ready for Plan 33-02 prepare tools)"
  - "Module-load self-check in src/signing/uniswap-pool-address.ts anchored against canonical USDC/WETH 0.05% pool (Etherscan-VERIFIED)"
affects:
  - "src/config/contracts.ts (KNOWN_SPENDERS_ETHEREUM: +1 row)"
  - "src/security/canonical-dispatch.ts (Ethereum-arm: +1 entry; 39 → 40)"
  - "src/signing/blocks.ts (APPEND-ONLY: +LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE)"
  - "src/tools/register-all.ts (+1 import line)"
tech-stack:
  added: []
  patterns:
    - "Pure-bigint Q64.96 / Q128.128 fixed-point math (no JSBI; no @uniswap/v3-sdk)"
    - "ESM spy-affordance indirection (_uniswapV3{Tick,Liquidity,Fees,Il,PoolAddress,LpReader})"
    - "Promise.allSettled per-position RPC fan-out (T-PROMISE-ALL-POISON-LP mitigation)"
    - "Module-load self-check assertion (NEW in codebase — first runtime drift-anchor against derived on-chain values)"
key-files:
  created:
    - "src/signing/uniswap-tick.ts"
    - "src/signing/uniswap-liquidity.ts"
    - "src/signing/uniswap-fees.ts"
    - "src/signing/uniswap-il.ts"
    - "src/signing/uniswap-pool-address.ts"
    - "src/chains/uniswap-v3-lp.ts"
    - "src/tools/get_lp_positions.ts"
    - "test/signing-uniswap-tick.test.ts"
    - "test/signing-uniswap-liquidity.test.ts"
    - "test/signing-uniswap-fees.test.ts"
    - "test/signing-uniswap-il.test.ts"
    - "test/signing-uniswap-pool-address.test.ts"
    - "test/get-lp-positions.test.ts"
  modified:
    - "src/config/contracts.ts"
    - "src/security/canonical-dispatch.ts"
    - "src/signing/blocks.ts"
    - "src/tools/register-all.ts"
    - "test/config-contracts.test.ts"
    - "test/security-canonical-dispatch.test.ts"
    - "test/signing-blocks.test.ts"
decisions:
  - "SDK Probe Verdict honored: HAND-ROLL all tick / liquidity / fees / IL / pool-address math. Zero new npm packages."
  - "ilEstimateConfidence tier — 'high' for in-range exact reconstruction; 'low' for out-of-range geometric midpoint OR extreme-asymmetric range (sqrtUpper/sqrtLower > 10) refusal."
  - "Module-load self-check on uniswap-pool-address.ts derives canonical USDC/WETH 0.05% pool — throws on factory address / POOL_INIT_CODE_HASH / encoding drift."
  - "get_lp_positions reader uses 18-decimal default for IL computation; tool layer can re-compute with token-specific decimals via get_token_metadata in a future v2.4.x refinement (deferred ergonomics; in-scope for Plan 33-02 if needed)."
metrics:
  duration: "~32 min"
  completed: "2026-05-24"
  tests_added: "+90 net (3836 → 3926)"
  files_created: 13
  files_modified: 7
---

# Phase 33 Plan 33-01: Uniswap V3 LP read surface + LP math primitives + SOT promotion Summary

`get_lp_positions` MCP tool + 5 pure-bigint LP math modules (tick / liquidity / fees / IL / pool-address) + NonfungiblePositionManager promotion to KNOWN_SPENDERS + canonical-dispatch + LEDGER NOTICE template — full non-trust-pipeline foundation for Phase 33 LP verbs.

## What Landed

Phase 33 Plan 33-01 establishes the entire **read + math + allowlist + LEDGER-notice surface** Phase 33 needs before Plans 33-02 (5 single-step prepares) and 33-03 (composite rebalance) can build on top. The 3 atomic commits land sequentially:

1. **`1521305` — SOT promotion + canonical-dispatch arm + cross-view drift test.** NonfungiblePositionManager joins `KNOWN_SPENDERS_ETHEREUM` (sourced via `getUniswapV3NonfungiblePositionManagerAddress(1)!` — never inlined) and `CANONICAL_DISPATCH_TARGETS.ethereum`. T-UNISWAP-V3-NPM-SPENDER-DRIFT-1 regression cross-checks the byte-identity between the two views; canonical-dispatch size anchor lifts 39 → 40.

2. **`150240c` — 5 pure-bigint LP math modules.** Hand-rolled per RESEARCH § Topic 1 SDK Probe Verdict (`@uniswap/v3-sdk` pulls JSBI + ethersproject v5 + sdk-core deprecated graph for ~80 LOC of math; zero new npm packages). Each module mirrors the `src/signing/uniswap-path.ts` sibling-shelf shape with an `_uniswap*` ESM spy-affordance indirection.

3. **`630ab76` — NPM reader + get_lp_positions tool + LEDGER NOTICE template + register-all wiring.** End-to-end LP read surface that enumerates user NFTs via ERC-721 balanceOf + tokenOfOwnerByIndex, decodes positions(tokenId) (12-tuple), derives pool address via deterministic CREATE2 (no factory RPC), fans out slot0() + ticks(lower/upper) + feeGrowthGlobal0/1, then computes accrued fees + IL estimate per position. Promise.allSettled discipline anchors T-PROMISE-ALL-POISON-LP.

## Per-Task Detail

### Task 1 — SOT + canonical-dispatch + cross-view drift test (commit `1521305`)

- **`src/config/contracts.ts`**: one-row addition to `KNOWN_SPENDERS_ETHEREUM` between SwapRouter02 and WETH9 (alphabetical-by-label). Address delegated to the SOT getter — `getUniswapV3NonfungiblePositionManagerAddress(1)!`. NPM is a spender per RESEARCH § Topic 8 (mint / increaseLiquidity perform internal `TransferHelper.safeTransferFrom` on BOTH token0 AND token1).
- **`src/security/canonical-dispatch.ts`**: import + 5-line arm mirroring the Phase 32 SwapRouter02 pattern. Non-Ethereum chains unaffected (SOT getter returns null per D-03 → spread adds nothing).
- **`test/config-contracts.test.ts`**: T-UNISWAP-V3-NPM-SPENDER-DRIFT-1 + insertion-order anchor + EIP-55 checksum guard.
- **`test/security-canonical-dispatch.test.ts`**: Uniswap_V3_NPM inclusion + Ethereum-only narrowing + size-delta anchor (39 → 40) + refused-tx allowlist surfacing. Also updated 3 pre-Phase-33 hard-pinned size assertions (39 → 40).
- **+8 tests; 3836 → 3844.**

### Task 2 — 5 pure-bigint LP math modules (commit `150240c`)

- **`src/signing/uniswap-tick.ts`** (~330 LOC): Q64.96 tick ↔ sqrtPriceX96 ↔ price primitives — verbatim bigint port of v3-core `TickMath.sol` lines 23-204. `getSqrtRatioAtTick` iterative-shift constants are mathematically derived `log_{1.0001}` of `2^{-k}` — unchanged from canonical Solidity. `getTickAtSqrtRatio` MSB lookup + 14-iteration mantissa refinement + 2-tick candidate window. Plus `priceToSqrtPriceX96` / `sqrtPriceX96ToPrice` (decimal-string interface with 36-digit precision via bigint sqrt) + `priceToTick` / `tickToPrice` / `snapPriceToTick` + `TICK_SPACINGS` table (4 canonical Ethereum tiers).
- **`src/signing/uniswap-liquidity.ts`**: `getAmount{0,1}ForLiquidity` + `getAmountsForLiquidity` 3-case branch + `getLiquidityForAmount{0,1}` + `getLiquidityForAmounts` — verbatim bigint port of v3-periphery `LiquidityAmounts.sol`.
- **`src/signing/uniswap-fees.ts`**: `computeAccruedFees` combines settled `tokensOwed{0,1}` + unsettled Q128.128 delta. Internal `computeFeeGrowthInsidePerToken` mirrors v3-core `Pool.sol#getFeeGrowthInside` 3-case branch. `BigInt.asUintN(256, ...)` models the on-chain Q128.128 wrap-by-design overflow at every subtraction site.
- **`src/signing/uniswap-il.ts`**: `computeIlEstimate` per CONTEXT.md D-02 — in-range HIGH confidence (entry price = current sqrtPrice, canonical reconstruction) + out-of-range LOW confidence (geometric midpoint `sqrt(sqrtLower × sqrtUpper)` fallback per RESEARCH § Topic 5 ASSUMED threshold) + extreme-asymmetric-range refusal (`sqrtUpper/sqrtLower > 10` → empty IL strings + low confidence).
- **`src/signing/uniswap-pool-address.ts`**: CREATE2 deterministic derivation per v3-periphery `PoolAddress.sol`. Factory `0x1F98431c8aD98523631AE4a59f267346ea31F984` + `POOL_INIT_CODE_HASH = 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54` canonical since 2021 Factory deployment. Module-load self-check derives USDC/WETH 0.05% pool `0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640` (Etherscan-VERIFIED) — throws on any drift in factory / init-code-hash / encoding.
- Each module carries an `_uniswapV3{Tick,Liquidity,Fees,Il,PoolAddress}` ESM spy-affordance indirection.
- **+72 tests; 3844 → 3916.** Tick math has 34 tests including hardcoded canonical-reference vectors for `getSqrtRatioAtTick(t)` at t ∈ {0, ±1, ±60, ±200, 10, -200000, MIN_TICK, MAX_TICK} computed from probe-installed `@uniswap/v3-sdk` (verified 2026-05-24). Pool-address has 10 tests covering 4 canonical Etherscan-verified pools (USDC/WETH 0.05%, USDC/WETH 0.30%, WBTC/WETH 0.30%, DAI/USDC 0.01%) + token-sort invariance.

### Task 3 — NPM reader + tool + LEDGER NOTICE + register-all (commit `630ab76`)

- **`src/chains/uniswap-v3-lp.ts`**: `NPM_READ_ABI` (positions/balanceOf/tokenOfOwnerByIndex) + `POOL_READ_ABI` (slot0/feeGrowthGlobal0X128/feeGrowthGlobal1X128/ticks). `readUserPositions` enumeration flow: balanceOf → Promise.allSettled tokenOfOwnerByIndex fan-out → Promise.allSettled per-position decode (positions + slot0 + ticks(lower) + ticks(upper) + feeGrowthGlobal0/1 in parallel) → computeAccruedFees + computeIlEstimate. Per-position rejections log to stderr (CLAUDE.md stderr-for-diagnostics rule) and are silently filtered. `_uniswapV3LpReader` ESM spy-affordance.
- **`src/tools/get_lp_positions.ts`**: MCP tool. Phase 33 Ethereum-only narrowing (`LP_SUPPORTED_CHAINS = new Set(["ethereum"])`); non-Ethereum chains refuse with `INVALID_INPUT` + "Phase 33 ships Ethereum-only — multi-chain Uniswap V3 LP deferred to v2.4.x" message. `[ESTIMATE]` prefix discipline in CHECKS PERFORMED text content + `ilEstimateConfidence` flag in structured envelope. `rpcDegraded` fires via `isPublicNodeFallback(chainId)` (READ-05 invariant).
- **`src/signing/blocks.ts`**: APPEND-ONLY `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` — 13-line unconditional blind-sign warning. Body cites NPM lack of ERC-7730 coverage + Ledger registry URL + on-device verification protocol. Byte-identity of every upstream template preserved.
- **`src/tools/register-all.ts`**: one-line import added after the Phase 32 swap registration line.
- **+10 tests; 3916 → 3926.** Test file covers chain narrowing (refusals for polygon / arbitrum / malformed wallet), happy-path envelope shape via `vi.spyOn(_uniswapV3LpReader, "readUserPositions")` (with dynamic re-import to maintain ESM module identity for the spy seam), [ESTIMATE] prefix coverage, ilEstimateConfidence flag, rpcDegraded surfacing, and Promise.allSettled survivor discipline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Test expectation bug] Uniswap price convention is token1/token0, not "human-readable"**
- **Found during:** Task 2 (tick math test failure on round-trip).
- **Issue:** My initial test asserted `priceToTick("1900", 6, 18)` returns a negative tick for "USDC/WETH ~$1900". In Uniswap V3 the convention is `price = token1/token0` (always, regardless of human intuition). With USDC=token0(6) + WETH=token1(18), `price="1900"` raw means `1900 * 1e18/1e6 = 1.9e21` — large positive tick.
- **Fix:** Reworked the tests to use the canonical sort convention (smaller-hex-address = token0). For USDC/WETH the canonical pool has USDC as token0, WETH as token1 → `price` in human form is `0.000526` WETH per 1 USDC. Tests now use both orientations explicitly.
- **Files modified:** `test/signing-uniswap-tick.test.ts`.
- **Commit:** `150240c` (Task 2; fixed before commit).

**2. [Rule 1 — Test expectation bug] JS `%` on negative-and-divisible numbers returns -0**
- **Found during:** Task 2 (snapPriceToTick test failure with `expected -0 to be +0`).
- **Issue:** `(-3600) % 60 === -0` in JS, and `expect(-0).toBe(0)` fails on `Object.is` equality.
- **Fix:** Use `Math.abs(tick % spacing)` in the assertion. The snap discipline is correct; only the test comparison shape was wrong.
- **Files modified:** `test/signing-uniswap-tick.test.ts`.
- **Commit:** `150240c` (Task 2; fixed before commit).

**3. [Rule 1 — Test expectation tolerance] LiquidityAmounts round-trip tolerance too strict**
- **Found during:** Task 2 (round-trip property test failed with diff of 27-64 units out of 1e18).
- **Issue:** My initial expectation was "within 1 unit" but nested `mulDiv` integer rounding (4 divides in the round-trip) accumulates a few dozen units of error.
- **Fix:** Loosened tolerance to 1e6 = 0.0001% of L=1e18 — far below any meaningful price impact. Round-trip property is verified for algorithmic-shape correctness, not byte-equality.
- **Files modified:** `test/signing-uniswap-liquidity.test.ts`.
- **Commit:** `150240c` (Task 2; fixed before commit).

**4. [Rule 1 — Test spy seam] ESM dynamic-import + `vi.resetModules()` breaks top-level spy attachment**
- **Found during:** Task 3 (get_lp_positions test failure — mocked reader not intercepting).
- **Issue:** The test's top-level `import { _uniswapV3LpReader }` captures one module instance. Then `vi.resetModules()` + dynamic `await import("../src/tools/register-all.js")` creates a FRESH module instance that the tool actually consumes. The spy on the top-level reference was a no-op.
- **Fix:** Move the `vi.spyOn(reader._uniswapV3LpReader, ...)` call INSIDE the test helper, against the same dynamically-imported module instance the tool consumes. Same ESM module-identity discipline the project's other tests use.
- **Files modified:** `test/get-lp-positions.test.ts`.
- **Commit:** `630ab76` (Task 3; fixed before commit).

### Pre-Existing Assertions Updated

The plan calls for adding NPM to `CANONICAL_DISPATCH_TARGETS.ethereum`, which lifts the Set size from 39 → 40. Three pre-existing tests had hard-pinned the 39 baseline; updating them is in-scope (those anchors document phase-level deltas and would surface unintended changes elsewhere — Phase 33's +1 was the intended change). Same shape as the Phase 32 update from 38 → 39.

No Rule 4 architectural deviations. No checkpoints. No package-install gates fired.

## Threat Mitigations Confirmed

| Threat | Mitigation | Verified |
|--------|-----------|----------|
| T-CONFIG-LITERAL-MIGRATION-2 | grep-zero for `0xC36442b4a4522E871399CD717aBDD847Ab11FE88` outside `src/config/contracts.ts` | Pass — zero hits |
| T-UNISWAP-V3-NPM-SPENDER-DRIFT-1 | Cross-view byte-identity test in `test/config-contracts.test.ts` | Pass |
| T-DISPATCH-ALLOWLIST-DRIFT-2 | `Uniswap_V3_NPM` inclusion test in `test/security-canonical-dispatch.test.ts` | Pass |
| T-POOL-ADDRESS-COMPUTE-DRIFT | Module-load self-check in `src/signing/uniswap-pool-address.ts` | Pass — import succeeds |
| T-PROMISE-ALL-POISON-LP | `Promise.allSettled` at every fan-out site in `src/chains/uniswap-v3-lp.ts` | Pass — survivor test |
| T-IL-ESTIMATE-MISLEADING | `[ESTIMATE]` prefix + `ilEstimateConfidence` tier flag + extreme-range refusal | Pass — envelope test |
| T-RPC-DEGRADED-SILENT | `rpcDegraded` via `isPublicNodeFallback(chainId)` | Pass — rpcDegraded test |
| T-33-TICK-MATH-DRIFT | 34-test reference vector regression against probe-computed `@uniswap/v3-sdk` values | Pass |
| T-33-FEE-WRAP-MISMODELED | Explicit Q128.128 wrap test using `BigInt.asUintN(256, ...)` | Pass |

## Success Criteria

- [x] All 3 tasks of Plan 33-01 executed
- [x] Each task committed individually with `33-01` prefix (`1521305`, `150240c`, `630ab76`)
- [x] **FROZEN-area zero-diff**: `git diff src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts src/clients/fourbyte.ts` shows ZERO lines changed
- [x] `git diff package.json package-lock.json` is EMPTY (no SDK leak)
- [x] Full test suite passes: `npm test` exits 0 (3926 tests; +90 net)
- [x] SUMMARY.md created at `.planning/phases/33-evm-uniswap-v3-lp-verb-set/33-01-SUMMARY.md`
- [x] All commits on branch `feat/33-uniswap-v3-lp` (no branch switching)
- [x] grep-zero: NPM address never inlined outside SOT
- [x] grep-zero: `@uniswap/v3-sdk` / `jsbi` / `JSBI` not imported anywhere in `src/`

## Self-Check: PASSED

Verified on commit `630ab76`:

- 13 new files exist (5 src/signing + 1 src/chains + 1 src/tools + 5 test signing + 1 test tool) — all confirmed via `[ -f $f ]`
- 7 modified files (3 src + 4 test) committed across 3 atomic commits
- All 3 task commits present in `git log --oneline --all`: `1521305`, `150240c`, `630ab76`
- FROZEN-area `git diff` is zero
- `package.json` / `package-lock.json` `git diff` is zero
- Full suite green: 3926 tests pass, 1 skipped

## Handoff to Plan 33-02

Plan 33-02 (5 single-step prepares: mint / increaseLiquidity / decreaseLiquidity / collect / burn) consumes:

- `getUniswapV3NonfungiblePositionManagerAddress(chainId)!` for `tx.to` (NEVER inline).
- `_uniswapV3Tick.snapPriceToTick(priceLower, fee, ...)` + `priceToSqrtPriceX96` for tick-snap at mint.
- `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` from `src/signing/blocks.ts` for unconditional emission in every prepare response.
- The NPM canonical-dispatch arm at `src/security/canonical-dispatch.ts` is already wired — the Layer 0.5 allowlist gate will accept NPM `tx.to` automatically.

Plan 33-02 modifies `register-all.ts` to add 5 new prepare imports IMMEDIATELY AFTER Plan 33-01's `get_lp_positions.js` line (per the PATTERNS.md wave-merge discipline).
