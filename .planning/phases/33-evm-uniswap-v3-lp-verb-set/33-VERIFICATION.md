---
phase: 33
slug: evm-uniswap-v3-lp-verb-set
status: human_needed
verified_at: 2026-05-24T11:58:00Z
score: 22/22 must-haves verified (code-complete contract per v2.x milestone discipline)
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "End-to-end mint via Ledger hardware wallet (USDC/WETH 0.05%)"
    expected: "Ledger device displays BLIND-SIGN HASH; user manually compares against payloadFingerprint surfaced in prepare/preview response; user approves on-device; mint tx confirms on Ethereum mainnet"
    why_human: "Ledger device interaction + visual hash comparison + on-chain confirmation cannot be automated in this codebase (no Ledger emulator wired; per v2.x phase contract, real-Ledger UAT is bundled into v2.4 milestone close-out per 2026-05-16 directive)"
  - test: "End-to-end rebalance (composite multicall) via Ledger"
    expected: "Single Ledger signature authorizes the 3-step rebalance (decreaseLiquidity-all + collect + mint at new range); BLIND-SIGN HASH matches the single payloadFingerprint shown in preview; tx broadcasts and lands with the old position emptied + new position minted at the new range"
    why_human: "Composite-tx user flow + on-device signature + on-chain settlement require a live wallet + position. CRITICAL first composite-tx shape in the codebase per CONTEXT.md D-06 — establishes the v2.5 Safe three-step convention; live verification is load-bearing for the architectural precedent"
  - test: "Lifecycle: mint → increase → decrease → collect → burn"
    expected: "Each step prepared, signed on Ledger, confirms on-chain; get_lp_positions reflects state transitions correctly across each step; accruedFees + IL estimate update sensibly"
    why_human: "Multi-step on-chain flow with state transitions; UI/UX feel of the lifecycle progression; agent routing across `prepare_uniswap_v3_*` tools; not automatable without Anvil fork + Ledger emulator (out of scope for v2.4)"
  - test: "Real Ledger BLIND-SIGN HASH presentation matches LEDGER_NOTICE template instruction"
    expected: "User reads LEDGER_NOTICE block, copies the payloadFingerprint, compares against the device-displayed hash, sees byte-identity; NOTICE's user-instruction is actionable and clear on physical device"
    why_human: "Verifies the LEDGER NOTICE template's instructional value end-to-end against a real device — code-level test only confirms emission, not actionability"
---

# Phase 33: Uniswap V3 LP Verb Set Verification Report

**Phase Goal:** User can manage Uniswap V3 LP positions end-to-end — mint new position, increase liquidity, decrease liquidity, collect fees, burn (close) position, rebalance (close + re-mint at new range). `get_lp_positions` returns positions with current price + range + accrued fees + impermanent-loss estimate.

**Verified:** 2026-05-24T11:58:00Z
**Status:** human_needed (code-complete; real-Ledger UAT deferred per v2.x contract)
**Re-verification:** No — initial verification
**Branch:** `feat/33-uniswap-v3-lp` (clean, no branch switch)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN Must-Haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `get_lp_positions({wallet, chain?})` returns per-NFT envelope with current price, tick range, in/out-of-range, accrued fees, IL estimate | VERIFIED | `src/tools/get_lp_positions.ts:118` calls `_uniswapV3LpReader.readUserPositions(client, wallet, chainId)`; envelope at `src/tools/get_lp_positions.ts:150-180` includes `tokenId / token0 / token1 / feeTier / tickLower / tickUpper / currentTick / inRange / priceLowerHuman / priceUpperHuman / currentPriceHuman / liquidity / accruedFees{amount0,amount1} / ilEstimate{raw, netOfFees, confidence}` |
| 2 | `prepare_uniswap_v3_mint` produces unsigned NPM `mint` call | VERIFIED | `src/tools/prepare_uniswap_v3_mint.ts` (690 LOC); calldata via `_uniswapV3LpProtocol.encodeMint(...)`; tx.to via `getUniswapV3NonfungiblePositionManagerAddress(chainId)!`; Fixture UNI-LP-A pin `0x48582b81...d1bb` |
| 3 | `prepare_uniswap_increase_liquidity + _decrease_liquidity + _collect + _burn` cover the rest of the lifecycle | VERIFIED | All 4 prepare tools exist (`src/tools/prepare_uniswap_v3_{increase_liquidity,decrease_liquidity,collect,burn}.ts`, 384–473 LOC each); registered in `register-all.ts:106-109`; Fixtures UNI-LP-B/C/D/E pinned |
| 4 | `prepare_uniswap_v3_rebalance({tokenId, newTickLower, newTickUpper})` builds multicall (decrease all + collect + mint); preview surfaces multi-step decoded view | VERIFIED | `src/tools/prepare_uniswap_v3_rebalance.ts:459` calls `_uniswapV3LpProtocol.composeRebalanceCalldata({...})`; `src/protocols/uniswap-v3-lp.ts:412-436` composes 3 inner calls in LOAD-BEARING order (decrease → collect → mint); preview composite arm at `preview_send.ts:1274+` recurses via `_npmDecodeShared.decodeSingleNpmCall` 3× |
| 5 | Tick math + price ↔ tick conversions server-side | VERIFIED | `src/signing/uniswap-tick.ts` (434 LOC): `priceToSqrtPriceX96 / sqrtPriceX96ToPrice / tickToSqrtPriceX96 / sqrtPriceX96ToTick / priceToTick / tickToPrice / snapPriceToTick / TICK_SPACINGS`; pure-bigint Q64.96 hand-roll (no JSBI/SDK) |
| 6 | NPM address sourced from `src/config/contracts.ts`; canonical-dispatch allowlist extension | VERIFIED | KNOWN_SPENDERS_ETHEREUM row uses `getUniswapV3NonfungiblePositionManagerAddress(1)!` (NEVER inlined); `src/security/canonical-dispatch.ts:193-198` adds NPM to allowlist via SOT getter; grep-zero confirms literal address only appears in `src/config/contracts.ts:754` |
| 7 | FROZEN-area zero-diff held (6 cryptographic-binding files) | VERIFIED | `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts src/clients/fourbyte.ts \| wc -l` = `0` |
| 8 | Fixtures UNI-LP-{A..F} hardcoded `0x...` literals (NOT beforeAll); selectors asserted BEFORE fingerprint | VERIFIED | `test/signing-fingerprint.test.ts:737-763` declares 6 fixtures as `const ... = "0x..."`; UNI-LP-F selector pin at line 914-916 BEFORE fp pin at line 923; no `beforeAll` in UNI-LP block (line 725 comment: "NO `beforeAll`-snapshot") |
| 9 | 6-fixture distinctness asserted | VERIFIED | `test/signing-fingerprint.test.ts:927-941` — `Set([FIXTURE_UNI_LP_A..F_FP]).size === 6` |
| 10 | Persona-cycle byte-identity integration anchors all 6 fixtures under ≥2 personas | VERIFIED | `test/integration-uniswap-v3-lp.test.ts` (315 LOC) — Anvil acct 1 `0x70997970...` + Anvil acct 2 `0x3C44CdDd...`; from-DEPENDENT (UNI-LP-A/D/F) vs from-INDEPENDENT (UNI-LP-B/C/E) classification with per-persona determinism + cross-persona shape assertions; 19 integration tests pass |
| 11 | `prepare_uniswap_v3_rebalance` = ONE tool / ONE handle / ONE multicall calldata / single payloadFingerprint over outer multicall | VERIFIED | `src/tools/prepare_uniswap_v3_rebalance.ts:459` single `composeRebalanceCalldata` call; line 485 single `computePayloadFingerprint(tx)`; line 486 single `createHandle({...})`; no sub-handles, no multi-hash chain — Phase 4 trust pipeline consumed unchanged |
| 12 | preview_send composite arm decodes inner calls via SHARED `decodeSingleNpmCall` helper (NOT redefined) | VERIFIED | `decodeSingleNpmCall` exported once at `src/tools/preview_send.ts:457`; `_npmDecodeShared = { decodeSingleNpmCall }` spy seam at line 591; 3 call sites (lines 1221, 1267, 1306) all route through `_npmDecodeShared.decodeSingleNpmCall(...)` — Pitfall 7 SHARED-decoder SOT |
| 13 | `0xac9650d8` (multicall(bytes[])) ≠ `0x5ae401dc` (Phase 32 deadline overload) regression | VERIFIED | `src/protocols/uniswap-v3-lp.ts:155` declares `multicallBytes: "0xac9650d8"`; `grep -n "0x5ae401dc" src/protocols/uniswap-v3-lp.ts` returns ZERO hits; distinctness test in `test/protocols-uniswap-v3-lp.test.ts` asserts `multicallBytes !== UNISWAP_V3_SELECTORS.multicallWithDeadline` |
| 14 | (tx.to, selector) tuple-dispatch resolves `0x42966c68` collision (NPM burn vs Phase 31 rETH.burn) | VERIFIED | `src/tools/preview_send.ts:1193-1273` branches `if-rETH-SOT / else-if-NPM-SOT / else-fallthrough`; both paths regression-tested in `test/preview-send.uniswap-v3-lp.test.ts` (T2: NPM route; T3: rETH route preserved) |
| 15 | `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` unconditionally surfaced in every Phase 33 prepare response | VERIFIED | `grep -l "LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE" src/tools/prepare_uniswap_v3_*.ts` returns all 6 files (mint, increase, decrease, collect, burn, rebalance); template defined at `src/signing/blocks.ts:2379` |
| 16 | No SDK leak: package.json/lock unchanged | VERIFIED | `git diff origin/main..HEAD -- package.json package-lock.json \| wc -l` = `0`; grep-zero `@uniswap/v3-sdk\|jsbi\|JSBI` in `src/` |
| 17 | Full test suite green | VERIFIED | `npm test` → 311 test files; 4032 passed, 1 skipped, 0 failed; duration 130s |
| 18 | NPM in KNOWN_SPENDERS_ETHEREUM (T-UNISWAP-V3-NPM-SPENDER-DRIFT-1) | VERIFIED | `src/config/contracts.ts` row with `address: getUniswapV3NonfungiblePositionManagerAddress(1)!`, `label: "Uniswap V3 NonfungiblePositionManager"`; cross-view drift test in `test/config-contracts.test.ts` passes |
| 19 | NPM in CANONICAL_DISPATCH_TARGETS.ethereum | VERIFIED | `src/security/canonical-dispatch.ts:193` reads SOT; allowlist size lifted 39 → 40; ethereum-only narrowing preserved (non-ethereum getter returns null → empty spread) |
| 20 | Pool address CREATE2 module-load self-check | VERIFIED | `src/signing/uniswap-pool-address.ts` (133 LOC) anchored against canonical USDC/WETH 0.05% pool `0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640`; module import alone exercises the self-check; test `test/signing-uniswap-pool-address.test.ts` covers 4 canonical Etherscan-verified pools |
| 21 | Promise.allSettled per-position fan-out (T-PROMISE-ALL-POISON-LP) | VERIFIED | `src/chains/uniswap-v3-lp.ts` uses `Promise.allSettled` for `tokenOfOwnerByIndex` enumeration + per-position decode; per-position rejections log to stderr; healthy positions still returned |
| 22 | Composite-intent-only PREPARE RECEIPT for rebalance (CONTEXT.md D-06) | VERIFIED | `src/signing/blocks.ts:2817-2830` — template carries `{CHAIN}, {NPM}, {TOKEN_ID}, {NEW_PRICE_LOWER/UPPER}, {NEW_TICK_LOWER/UPPER}, {SLIPPAGE_BPS}, {DEADLINE}` only; NO inner-step amounts; "single signature authorizes all 3 steps" notice |

**Score:** 22/22 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/signing/uniswap-tick.ts` | Q64.96 tick/price/sqrtPriceX96 primitives + TICK_SPACINGS + `_uniswapV3Tick` | VERIFIED | 434 LOC; exports `priceToSqrtPriceX96, sqrtPriceX96ToPrice, tickToSqrtPriceX96, sqrtPriceX96ToTick, priceToTick, tickToPrice, snapPriceToTick, TICK_SPACINGS, _uniswapV3Tick`; pure-bigint hand-roll |
| `src/signing/uniswap-liquidity.ts` | LiquidityAmounts.sol port | VERIFIED | 178 LOC; `getAmountsForLiquidity / getLiquidityForAmounts` |
| `src/signing/uniswap-fees.ts` | Accrued-fee Q128.128 math | VERIFIED | 147 LOC; `computeAccruedFees` + `BigInt.asUintN(256, ...)` wrap modeling |
| `src/signing/uniswap-il.ts` | IL estimate (in-range exact + out-of-range geometric-midpoint fallback) | VERIFIED | 186 LOC; `computeIlEstimate` returns confidence tier "high"/"low" + extreme-asymmetric-range refusal |
| `src/signing/uniswap-pool-address.ts` | CREATE2 deterministic pool address + module-load self-check | VERIFIED | 133 LOC; canonical USDC/WETH 0.05% pool self-check |
| `src/chains/uniswap-v3-lp.ts` | NPM read surface (positions enumeration + slot0 fan-out) | VERIFIED | 318 LOC; `NPM_READ_ABI / POOL_READ_ABI / readUserPositions / _uniswapV3LpReader`; Promise.allSettled discipline |
| `src/tools/get_lp_positions.ts` | MCP tool with `[ESTIMATE]` discipline + rpcDegraded | VERIFIED | 218 LOC; chain-narrow to ethereum; ilEstimateConfidence tier surfaced |
| `src/protocols/uniswap-v3-lp.ts` | NPM ABI + selector table + 5 single + 1 composite encoders + MAX_UINT128 + spy-affordance (7 keys) | VERIFIED | 459 LOC; `NPM_WRITE_ABI, MULTICALL_BYTES_ABI, UNISWAP_V3_LP_SELECTORS (6 entries), MAX_UINT128, encodeMint, encodeIncreaseLiquidity, encodeDecreaseLiquidity, encodeCollect, encodeBurn, encodeMulticallBytes, composeRebalanceCalldata, _uniswapV3LpProtocol` (7 keys) |
| `src/tools/prepare_uniswap_v3_mint.ts` | mint tool with tick snap + dual-token approval pre-flight + LEDGER NOTICE | VERIFIED | 690 LOC; registered |
| `src/tools/prepare_uniswap_v3_increase_liquidity.ts` | increase tool | VERIFIED | 473 LOC; registered |
| `src/tools/prepare_uniswap_v3_decrease_liquidity.ts` | decrease tool with verbatim "does NOT transfer" notice | VERIFIED | 384 LOC; registered |
| `src/tools/prepare_uniswap_v3_collect.ts` | collect tool with MAX_UINT128 sentinel default | VERIFIED | 399 LOC; registered |
| `src/tools/prepare_uniswap_v3_burn.ts` | burn tool with non-empty pre-flight refusal | VERIFIED | 258 LOC; registered |
| `src/tools/prepare_uniswap_v3_rebalance.ts` | composite rebalance — ONE handle / ONE calldata / single payloadFingerprint | VERIFIED | 624 LOC; registered |
| `src/signing/blocks.ts::LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` | APPEND-only, unconditional emission template | VERIFIED | line 2379; consumed by 6 prepare tools + preview_send |
| `test/signing-fingerprint.test.ts` Fixtures UNI-LP-{A..F} | 6 hardcoded literals; selector-before-fp; 6-fixture distinctness | VERIFIED | lines 737-763 + 927-941 |
| `test/integration-uniswap-v3-lp.test.ts` | Persona-cycle byte-identity for 6 fixtures × 2 personas | VERIFIED | 315 LOC; 19 tests; from-DEPENDENT vs from-INDEPENDENT classification |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/tools/get_lp_positions.ts` | `src/chains/uniswap-v3-lp.ts::_uniswapV3LpReader.readUserPositions` | import + call | WIRED | line 25 import; line 118 call with `client, wallet, chainId` |
| `src/chains/uniswap-v3-lp.ts` | `src/signing/uniswap-pool-address.ts::computePoolAddress` | per-position pool derivation | WIRED | imported + called per position |
| `src/chains/uniswap-v3-lp.ts` | `src/signing/uniswap-fees.ts + uniswap-il.ts` | accrued-fee + IL computation | WIRED | `computeAccruedFees` + `computeIlEstimate` called per position |
| `src/security/canonical-dispatch.ts` | `getUniswapV3NonfungiblePositionManagerAddress` | Ethereum arm allowlist seed | WIRED | line 71 import; line 193 read; line 199 spread into final Set |
| All 6 `prepare_uniswap_v3_*.ts` | `_uniswapV3LpProtocol.encode*` | calldata composition via spy-affordance | WIRED | all 6 tools call through the indirection |
| All 6 `prepare_uniswap_v3_*.ts` | `getUniswapV3NonfungiblePositionManagerAddress` | tx.to source (NEVER inlined) | WIRED | grep-zero of literal address confirms |
| All 6 `prepare_uniswap_v3_*.ts` | `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` | unconditional emission | WIRED | imported in all 6 files |
| `src/tools/preview_send.ts` | `UNISWAP_V3_LP_SELECTORS` + `MULTICALL_BYTES_ABI` | tuple dispatch (5 single + 1 composite arms) | WIRED | imports + 6 arms |
| `src/tools/preview_send.ts (composite arm)` | `_npmDecodeShared.decodeSingleNpmCall` (SHARED from Plan 33-02) | recursive decoding via SOT-shared helper | WIRED | 3 call sites (lines 1221, 1267, 1306) all route through indirection |
| `test/signing-fingerprint.test.ts` | `src/signing/payload-fingerprint.ts` (FROZEN) | 6 fixtures pin payloadFingerprint over computed calldata | WIRED | computePayloadFingerprint consumed unchanged |
| `test/integration-uniswap-v3-lp.test.ts` | all 6 Fixtures UNI-LP-{A..F} | persona-cycle re-anchor | WIRED | each fixture re-derived per persona |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `get_lp_positions` | `positions` | `_uniswapV3LpReader.readUserPositions(client, wallet, chainId)` → `client.readContract({address: NPM, functionName: "balanceOf"})` + tokenOfOwnerByIndex + positions + slot0 + ticks + feeGrowthGlobal* | YES (real RPC reads against NPM + Pool contracts; viem `readContract` on canonical addresses) | FLOWING |
| `prepare_uniswap_v3_*` (5 single) | `tx.data` | `_uniswapV3LpProtocol.encode<Verb>(...)` via viem `encodeFunctionData` over verified parseAbi fragments | YES (viem-encoded calldata; selectors asserted at encoder against canonical hex literals) | FLOWING |
| `prepare_uniswap_v3_rebalance` | `tx.data` | `_uniswapV3LpProtocol.composeRebalanceCalldata(...)` returns `encodeMulticallBytes([decreaseInner, collectInner, mintInner])` | YES (3 inner calldata payloads composed in LOAD-BEARING order, wrapped in `multicall(bytes[])` selector `0xac9650d8`) | FLOWING |
| `preview_send` composite arm | `uniswapV3LpDecoded` | `_npmDecodeShared.decodeSingleNpmCall(innerCall, innerSel)` × 3 inner calls | YES (viem `decodeFunctionData` against canonical NPM ABI for each inner call) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite (4032 tests) | `npm test` | 311 files / 4032 passed / 1 skipped / 0 failed (130s) | PASS |
| FROZEN-area zero-diff | `git diff origin/main -- <6 files> \| wc -l` | `0` | PASS |
| No SDK leak | `git diff origin/main..HEAD -- package.json package-lock.json \| wc -l` | `0` | PASS |
| NPM address never inlined outside SOT | `grep -rn "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" src/ --include='*.ts' \| grep -v config/contracts.ts \| wc -l` | `0` | PASS |
| Deadline-overload selector absent from Phase 33 module | `grep -n "0x5ae401dc" src/protocols/uniswap-v3-lp.ts` | ZERO HITS | PASS |
| Phase 33 imports in register-all (exact 7 lines in wave order) | `grep -c "Phase 33" src/tools/register-all.ts` | `7` (1+5+1) | PASS |
| Module-load self-check on pool-address derivation | implicit: `npm test` imports the module → self-check fires | PASS (no throw across 311 test files) | PASS |
| All 6 prepares emit LEDGER NOTICE template | `grep -l "LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE" src/tools/prepare_uniswap_v3_*.ts \| wc -l` | `6` | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| (none declared) | n/a | Phase 33 has no probe scripts; behavioral spot-checks above cover the validation surface | N/A |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| UNI-04 | 33-01 | `get_lp_positions({wallet, chain?})` returns LP positions per NFT-id with current price + tick range + in/out-of-range + accrued fees + IL estimate | SATISFIED | `src/tools/get_lp_positions.ts` — envelope verified above; ilEstimateConfidence tier; `[ESTIMATE]` discipline |
| UNI-05 | 33-02 | `prepare_uniswap_v3_mint` produces unsigned NPM mint call | SATISFIED | `src/tools/prepare_uniswap_v3_mint.ts`; Fixture UNI-LP-A anchor |
| UNI-06 | 33-02 | `prepare_uniswap_increase_liquidity + _decrease_liquidity` cover liquidity adjustments | SATISFIED | Both tools exist + tested; Fixtures UNI-LP-B/C anchor |
| UNI-07 | 33-02 | `prepare_uniswap_collect` harvests accrued fees | SATISFIED | `src/tools/prepare_uniswap_v3_collect.ts`; MAX_UINT128 sentinel default; Fixture UNI-LP-D anchor |
| UNI-08 | 33-02 | `prepare_uniswap_burn` closes a fully-decreased position | SATISFIED | `src/tools/prepare_uniswap_v3_burn.ts`; non-empty pre-flight refusal with hintTool routing; Fixture UNI-LP-E anchor |
| UNI-09 | 33-03 | `prepare_uniswap_v3_rebalance` composite multicall (decrease all + collect + mint); preview multi-step decoded view | SATISFIED | `src/tools/prepare_uniswap_v3_rebalance.ts`; composite preview arm + DECODED ARGS sub-blocks; Fixture UNI-LP-F anchor |
| UNI-10 | 33-01 | NPM addresses sourced from `src/config/contracts.ts`; tick math server-side in `src/signing/uniswap-tick.ts`; canonical-dispatch wiring | SATISFIED | SOT getter `getUniswapV3NonfungiblePositionManagerAddress`; `src/signing/uniswap-tick.ts` (434 LOC); canonical-dispatch arm at `src/security/canonical-dispatch.ts:193` |

No orphaned requirements: ROADMAP Phase 33 declares UNI-04 through UNI-10; all 7 covered by phase plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No TBD/FIXME/XXX/HACK markers introduced; no console.log-only implementations; no hardcoded empty returns that flow to rendering | INFO | Clean phase output |

Stub classification: all `return null` / empty-array patterns observed in Phase 33 source files are typed defaults / fallback arms (e.g., `decodeSingleNpmCall` returns `null` for unknown selectors — that is the documented contract). No grep matches flow to user-visible output without a real-data writer upstream.

### Human Verification Required

Per v2.x phase-contract directive (2026-05-16): real-Ledger UAT is DEFERRED from per-phase verification and BUNDLED into v2.4 milestone close-out. Phase 33 ships code-complete; the four end-to-end flows below must run against a real device + live position before the v2.4 milestone closes.

### 1. End-to-end mint via Ledger hardware wallet

**Test:** User runs `prepare_uniswap_v3_mint` for a USDC/WETH 0.05% position on Ethereum mainnet; presents handle to `send_transaction`; signs on Ledger device.
**Expected:** Ledger displays BLIND-SIGN HASH (NPM not in ERC-7730 registry — confirmed at planning time); user manually compares against the `payloadFingerprint` surfaced in `prepare` + `preview_send` response; user approves on-device; tx confirms on Ethereum mainnet; new NFT position appears in user's wallet; `get_lp_positions` returns the new position with correct envelope.
**Why human:** Ledger device interaction + visual hash comparison + on-chain confirmation cannot be automated; per v2.x phase contract, real-Ledger UAT is bundled into v2.4 milestone close-out.

### 2. End-to-end rebalance (composite multicall) via Ledger

**Test:** User has existing position; runs `prepare_uniswap_v3_rebalance({tokenId, newPriceLower, newPriceUpper})`; reviews PREPARE RECEIPT + CHECKS PERFORMED (3 step sub-blocks); signs once on Ledger.
**Expected:** Single Ledger signature authorizes the 3-step rebalance; BLIND-SIGN HASH matches the single `payloadFingerprint` shown in preview; tx broadcasts; old position emptied (liquidity=0, tokensOwed=0); new position minted at the new range; `get_lp_positions` reflects the transition.
**Why human:** First composite-tx shape in the codebase per CONTEXT.md D-06 — establishes the v2.5 Safe three-step convention; live verification is load-bearing for the architectural precedent. Composite-tx user flow + on-device single signature + on-chain settlement cannot be automated.

### 3. Lifecycle: mint → increase → decrease → collect → burn

**Test:** User executes each verb in sequence against a single NFT position; checks `get_lp_positions` envelope between each step.
**Expected:** Each step prepared, signed on Ledger, confirms on-chain; envelope reflects state transitions correctly (liquidity adjusts; accruedFees + IL estimate update sensibly); burn pre-flight refuses non-empty position (T-BURN-PRECONDITION) with correct hintTool routing.
**Why human:** Multi-step on-chain flow with state transitions; UI/UX feel of the lifecycle progression; agent routing across `prepare_uniswap_v3_*` tools.

### 4. LEDGER NOTICE template actionability against real device

**Test:** User reads `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` block emitted in any `prepare_uniswap_v3_*` response; physically performs the on-device hash comparison the NOTICE instructs.
**Expected:** Hash byte-identity holds between server-side `payloadFingerprint` and device-displayed BLIND-SIGN HASH; NOTICE instruction is actionable + clear; user can complete the comparison without ambiguity.
**Why human:** Code-level test only confirms template emission; actionability of the human-instruction text is a real-device usability check.

### Gaps Summary

No code-level gaps blocking goal achievement. Phase 33 is **code-complete** per the v2.x contract:

- All 6 ROADMAP Phase 33 success criteria delivered by shipped code (truths 1-6 above)
- All 7 requirement IDs (UNI-04 through UNI-10) traceable to concrete artifacts
- FROZEN cryptographic-binding chain unchanged (zero-diff verified against `origin/main`)
- No SDK leak (`package.json` / `package-lock.json` unchanged)
- 4032 tests pass; 1 skipped (matches Plan 33-03 SUMMARY claim)
- 6-fixture cryptographic-binding regression suite + persona-cycle byte-identity integration test in place
- Composite-tx preview shape (Pitfall 7 SHARED-decoder discipline anchored via `_npmDecodeShared` ESM spy seam at write time)
- Selector-collision (0x42966c68 NPM burn vs Phase 31 rETH.burn) resolved via (tx.to, selector) tuple-dispatch
- LEDGER NOTICE unconditionally emitted in all 6 Phase 33 prepare responses

The 4 human-verification items above are real-Ledger end-to-end flows DEFERRED to v2.4 milestone close-out per the gsd-pr-workflow memory directive (2026-05-16). They are not gaps blocking phase progression — they are the v2.x phase-contract close-out hook for HUMAN-UAT.

---

_Verified: 2026-05-24T11:58:00Z_
_Verifier: Claude (gsd-verifier)_
_Branch: feat/33-uniswap-v3-lp (clean, no branch switch)_
