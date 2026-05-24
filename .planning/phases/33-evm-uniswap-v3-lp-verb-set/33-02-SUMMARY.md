---
phase: 33-evm-uniswap-v3-lp-verb-set
plan: 02
subsystem: prepare-tools + protocol-decoder + preview-dispatch
tags: [uniswap-v3, lp, npm, prepare, preview, fixtures, ledger-blind-sign, selector-collision]
requires:
  - "Phase 33 Plan 33-01 SOT promotion: getUniswapV3NonfungiblePositionManagerAddress + KNOWN_SPENDERS + canonical-dispatch"
  - "Phase 33 Plan 33-01 _uniswapV3Tick.snapPriceToTick (mint-time tick snap)"
  - "Phase 33 Plan 33-01 LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE in src/signing/blocks.ts (APPEND-ONLY)"
  - "Phase 33 Plan 33-01 NPM_READ_ABI in src/chains/uniswap-v3-lp.ts (positions(tokenId) consumed by increase / decrease / collect / burn)"
  - "FROZEN Phase 4 trust pipeline (computePayloadFingerprint / createHandle — consumed unchanged)"
provides:
  - "src/protocols/uniswap-v3-lp.ts — NPM ABI + 5 selectors + MAX_UINT128 + 5 encoders + _uniswapV3LpProtocol spy-affordance"
  - "5 MCP prepare tools (prepare_uniswap_v3_{mint,increase_liquidity,decrease_liquidity,collect,burn}) (UNI-05..08)"
  - "preview_send NPM (tx.to, selector) tuple dispatch — 5 verb arms + collision resolution with Phase 31 rETH.burn"
  - "decodeSingleNpmCall exported helper — SHARED with Plan 33-03 composite-multicall arm (Pitfall 7 SOT discipline)"
  - "10 templates (5 PREPARE RECEIPT + 5 DECODED ARGS) + UniswapV3LpDecoded union + buildUniswapV3LpDecodedArgsBlock in src/signing/blocks.ts (APPEND-ONLY)"
  - "Fixtures UNI-LP-{A..E} hardcoded 0x... literal anchors in test/signing-fingerprint.test.ts (cryptographic-binding chain regression anchors)"
affects:
  - "src/protocols/uniswap-v3-lp.ts (NEW)"
  - "src/tools/prepare_uniswap_v3_*.ts (5 NEW)"
  - "src/tools/preview_send.ts (+5 arms + 2 helpers + 1 LEDGER NOTICE arm + 1 structuredContent serialization arm; rETH burn arm extended with NPM fallthrough)"
  - "src/signing/blocks.ts (APPEND-ONLY +10 templates +1 union +1 helper)"
  - "src/tools/register-all.ts (+5 imports IMMEDIATELY AFTER Plan 33-01's get_lp_positions.js line)"
  - "test/signing-fingerprint.test.ts (APPEND-ONLY +5 fixtures +1 distinctness test)"
  - "test/preview-send.uniswap-v3-lp.test.ts (NEW)"
  - "test/protocols-uniswap-v3-lp.test.ts (NEW)"
  - "test/prepare-uniswap-v3-{mint,increase-liquidity,decrease-liquidity,collect,burn}.test.ts (5 NEW)"
tech-stack:
  added: []
  patterns:
    - "(tx.to, selector) tuple-dispatch — applied to the cross-protocol burn-selector collision NPM ↔ rETH (Phase 31)"
    - "SHARED-decoder Pitfall 7 discipline — decodeSingleNpmCall exported once, consumed by preview_send Plan 33-02 outer arms AND (forward) by Plan 33-03 composite-multicall recursion"
    - "Cryptographic-binding fixture: hardcoded 0x... literals (NO beforeAll-snapshot) per CLAUDE.md"
    - "ESM spy-affordance _uniswapV3LpProtocol indirection per CLAUDE.md § Conventions"
    - "Mechanical-clone-of-prepare_aave_supply prepare-tool shape (5 instances)"
    - "APPEND-ONLY discipline at src/signing/blocks.ts — every prior template byte-identical"
key-files:
  created:
    - "src/protocols/uniswap-v3-lp.ts"
    - "src/tools/prepare_uniswap_v3_mint.ts"
    - "src/tools/prepare_uniswap_v3_increase_liquidity.ts"
    - "src/tools/prepare_uniswap_v3_decrease_liquidity.ts"
    - "src/tools/prepare_uniswap_v3_collect.ts"
    - "src/tools/prepare_uniswap_v3_burn.ts"
    - "test/protocols-uniswap-v3-lp.test.ts"
    - "test/prepare-uniswap-v3-mint.test.ts"
    - "test/prepare-uniswap-v3-increase-liquidity.test.ts"
    - "test/prepare-uniswap-v3-decrease-liquidity.test.ts"
    - "test/prepare-uniswap-v3-collect.test.ts"
    - "test/prepare-uniswap-v3-burn.test.ts"
    - "test/preview-send.uniswap-v3-lp.test.ts"
  modified:
    - "src/tools/preview_send.ts"
    - "src/signing/blocks.ts"
    - "src/tools/register-all.ts"
    - "test/signing-fingerprint.test.ts"
decisions:
  - "decreaseLiquidity amount0Min/amount1Min default to 0 at the prepare layer in Plan 33-02 — current-pool-state derivation deferred to v2.4.x; slippageBps remains in response for downstream consumers. PREPARE RECEIPT + CHECKS PERFORMED disclose the deferred state."
  - "Selector-collision burn (0x42966c68) resolved via in-place extension of the existing Phase 31 ROCKETPOOL_SELECTORS.burn arm (now branches `if-rETH / else-if-NPM / else-fallthrough`) rather than a separate arm — preserves the prior-phase code path byte-for-byte while widening it to the new SOT."
  - "Hardcoded fixture literals computed at execute time and pinned (NOT beforeAll-snapshot). Drift in any of {SOT getter, encoder shape, computePayloadFingerprint surface} fails a specific named test rather than silently re-snapshotting against itself."
metrics:
  duration: "~33 min"
  completed: "2026-05-24"
  tests_added: "+58 net (3926 → 3984)"
  files_created: 13
  files_modified: 4
---

# Phase 33 Plan 33-02: 5 single-step Uniswap V3 LP prepare tools + preview-send NPM dispatch + Fixtures UNI-LP-{A..E} Summary

5 NPM prepare tools (mint / increase / decrease / collect / burn) + protocol-decoder + selector-collision resolution with Phase 31 rETH.burn + 5 hardcoded payload-fingerprint fixtures — completing the v2.4 single-step LP verb surface (UNI-05 through UNI-08).

## What Landed

Plan 33-02 closes the single-step half of Phase 33's LP verb set. The 3 atomic commits land sequentially, each gated by `npm test` green:

1. **`4d4668a` — NPM protocol module + 15-test regression suite.** New `src/protocols/uniswap-v3-lp.ts` ships the parseAbi fragment for the 5 NPM verbs (load-bearing struct field order per RESEARCH § Topic 2), the selector table (`UNISWAP_V3_LP_SELECTORS` with 5 hardcoded literal selectors), the `MAX_UINT128` sentinel for collect-everything, 5 encoder functions each with internal selector-drift assertion, and the `_uniswapV3LpProtocol` ESM spy-affordance. Selector-collision documentation between NPM.burn and Phase 31 rETH.burn (both `0x42966c68`) is pinned by a cross-import regression test. Anti-pattern guard (file-level grep): the Phase 32 deadline-overload selector `0x5ae401dc` MUST NOT appear in this module (NPM uses `multicall(bytes[])`, Plan 33-03's slot).

2. **`380c947` — 5 prepare tools + 10 templates + 5 test files (33 tests).** The 5 prepare tools follow `prepare_aave_supply.ts` mechanical-clone shape with three Phase 33-specific extensions: tick snap via `_uniswapV3Tick.snapPriceToTick` for mint, BOTH-token approval pre-flight against NPM for mint + increase (per RESEARCH § Topic 8 — NPM is a spender), and unconditional LEDGER NOTICE emission for all 5 (per RESEARCH § Topic 10 — NPM not in ERC-7730 registry). All 5 tools refuse non-ethereum chains, source NPM address via `getUniswapV3NonfungiblePositionManagerAddress(chainId)!` (grep-zero asserted — never inlined), set `valueWei = 0n` (Phase 33 refuses ETH-in per CONTEXT.md), and emit 3-block responses (PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE).

3. **`c36d92e` — preview_send NPM dispatch + Fixtures UNI-LP-A..E + 4 preview tests.** Five (tx.to, selector) tuple-dispatch arms wired into `preview_send.ts`; exported `decodeSingleNpmCall` helper for Plan 33-03 to reuse per Pitfall 7 SHARED-decoder discipline. The cross-protocol burn-selector collision with Phase 31 rETH.burn is resolved by extending the existing rETH arm with an NPM fallthrough — both routes work; regression test pins the prior-phase route. 5 hardcoded payload-fingerprint literals pin the cryptographic-binding chain for each verb's calldata shape.

## Per-Task Detail

### Task 1 — NPM protocol module (commit `4d4668a`)

- **`src/protocols/uniswap-v3-lp.ts`** (NEW, 309 LOC + 240 LOC test): SEPARATE file from Phase 32's `src/protocols/uniswap-v3.ts` per CONTEXT.md D-02 — no cross-imports. Module ships:
  - `NPM_WRITE_ABI` parseAbi fragment with 5 verbs in canonical struct-field order (MintParams 11 fields with `recipient` at position 10, NOT position 4 like SwapRouter02's ExactInputSingleParams).
  - `UNISWAP_V3_LP_SELECTORS` hardcoded literal table.
  - `MAX_UINT128 = 340282366920938463463374607431768211455n` sentinel.
  - 5 encoders each with `assertSelector(data, expected, verb)` internal guard.
  - `_uniswapV3LpProtocol` ESM spy-affordance.
- **`test/protocols-uniswap-v3-lp.test.ts`** (15 tests): selector byte-identity vs `viem.toFunctionSelector`, encoder round-trip (encode → decodeFunctionData byte-identical), MAX_UINT128 sentinel identity, collision documentation (`UNISWAP_V3_LP_SELECTORS.burn === ROCKETPOOL_SELECTORS.burn === 0x42966c68`), anti-pattern grep (Phase 32 selector NOT in source), ESM spy round-trip, ABI fragment shape.

### Task 2 — 5 prepare tools + 10 templates + register-all (commit `380c947`)

- **`src/signing/blocks.ts`** (APPEND-ONLY): 5 PREPARE RECEIPT templates + 5 DECODED ARGS templates + `UniswapV3LpDecoded` discriminated union + `buildUniswapV3LpDecodedArgsBlock` helper. Plan 33-01's `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE` block stays byte-identical. The decrease template bakes in the verbatim "decreaseLiquidity does NOT transfer tokens to your wallet. Call prepare_uniswap_v3_collect to harvest." sentence (T-DECREASE-DOES-NOT-TRANSFER mitigation).
- **`src/tools/prepare_uniswap_v3_mint.ts`** (NEW): chain (ethereum-only) / token0 / token1 / fee / priceLower / priceUpper / amount0 / amount1 + optional slippageBps / deadlineSeconds / from. Token-sort discipline (`invertDecimalPrice` 36-decimal bigint reciprocal when agent submits reversed). Tick snap with snapDeltaBps > 100 refusal per CONTEXT.md D-03. Approval pre-flight on BOTH tokens. 3-block response.
- **`src/tools/prepare_uniswap_v3_increase_liquidity.ts`** (NEW): tokenId-keyed; reads positions(tokenId) to derive token0/token1 for the dual-token approval pre-flight.
- **`src/tools/prepare_uniswap_v3_decrease_liquidity.ts`** (NEW): two parameter modes (XOR-validated): `liquidityPercent` (1..100, server reads positions.liquidity and computes proportionally) OR `liquidityDelta` (raw bigint). NO approval pre-flight (NFT-ownership). The verbatim "does NOT transfer" sentence flows verbatim through the template. `amount0Min`/`amount1Min` default to 0 — current-pool-state derivation deferred to v2.4.x; CHECKS PERFORMED + PREPARE RECEIPT both disclose the deferred state.
- **`src/tools/prepare_uniswap_v3_collect.ts`** (NEW): defaults `amount0Max`/`amount1Max` to MAX_UINT128 sentinel. User overrides parse via `parseAmountStrict` against the position's token decimals (reads positions(tokenId) only when override supplied). CHECKS PERFORMED notes sentinel use (T-MAX-UINT128-SENTINEL mitigation). recipient defaults to sender.
- **`src/tools/prepare_uniswap_v3_burn.ts`** (NEW): pre-flight via positions(tokenId) refuses non-empty positions with `INVALID_INPUT + hintTool` routing (liquidity > 0 → `prepare_uniswap_v3_decrease_liquidity`; tokensOwed > 0 → `prepare_uniswap_v3_collect`) per T-BURN-PRECONDITION mitigation.
- **`src/tools/register-all.ts`**: 5 new import lines IMMEDIATELY AFTER Plan 33-01's `get_lp_positions.js` line (per PATTERNS.md wave-merge discipline; Plan 33-03's rebalance import lands AFTER this block).
- 5 test files (33 tests total): chain gates, token validation, approval pre-flights on token0 + token1 separately, T-DECREASE-DOES-NOT-TRANSFER notice baking, MAX_UINT128 sentinel default + override paths, burn pre-flight refusals for both liquidity > 0 and tokensOwed > 0 with correct hintTool routing.

### Task 3 — preview_send arms + Fixtures + collision regression (commit `c36d92e`)

- **`src/tools/preview_send.ts`** modifications:
  - Imports widened: `NPM_WRITE_ABI`, `UNISWAP_V3_LP_SELECTORS` from `../protocols/uniswap-v3-lp.js`; `getUniswapV3NonfungiblePositionManagerAddress` from `../config/contracts.js`; `buildUniswapV3LpDecodedArgsBlock`, `LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE`, `UniswapV3LpDecoded` from `../signing/blocks.js`.
  - **NEW exported `decodeSingleNpmCall(data, sel): UniswapV3LpDecoded | null`** — SHARED helper per Pitfall 7. Plan 33-03's composite-multicall arm will recurse via this exact same helper; the export is the SOT-handoff.
  - **NEW `serializeUniswapV3LpDecoded`** for `structuredContent.decodedArgs` JSON shape.
  - 5 selector-dispatch arms wired AFTER the existing Phase 32 Uniswap V3 SwapRouter02 arm, each gated by `tx.to === NPM SOT`.
  - **Burn-collision resolution (T-SELECTOR-COLLISION-BURN)**: the existing Phase 31 `ROCKETPOOL_SELECTORS.burn` arm was extended in-place — now branches `if-rETH-SOT / else-if-NPM-SOT / else-fallthrough`. Both rETH and NPM paths route correctly under the same `0x42966c68` selector. T3 regression test in `test/preview-send.uniswap-v3-lp.test.ts` pins the prior-phase route.
  - `decodedArgsBlock` selection + LEDGER NOTICE selection + `structuredContent.decodedArgs.kind` union + `ledgerNotice` tag all extended with the new arm.
- **`test/signing-fingerprint.test.ts`** (APPEND-ONLY): 5 hardcoded literal payload-fingerprint fixtures UNI-LP-{A..E} pinning canonical NPM mint / increase / decrease / collect / burn calldata against the FROZEN `computePayloadFingerprint` surface. Each fixture asserts the verb selector BEFORE the fingerprint assertion (Phase 32 line-537 discipline). All preimage inputs flow through SOT getters + `_uniswapV3LpProtocol` spy-affordance — NEVER inlined. 5-fixture distinctness assertion guards calldata-shape collapse regressions.
- **`test/preview-send.uniswap-v3-lp.test.ts`** (NEW, 4 tests): T1 (NPM, mint) → DECODED ARGS + LEDGER NOTICE; T2 (NPM, burn 0x42966c68) → NPM burn arm (NOT Phase 31); T3 REGRESSION (rETH, 0x42966c68) → STILL routes to Phase 31 Rocket Pool burn (prior-phase invariant); T4 (NPM, collect, MAX_UINT128 sentinels) → DECODED ARGS renders "MAX_UINT128 (collect everything)" labels.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Test expectation bug] `listRegisteredTools()` returns `RegisteredTool[]` not `string[]`**
- **Found during:** Task 2 (5 register-all wiring smoke tests).
- **Issue:** Initial test wrote `expect(listRegisteredTools()).toContain("prepare_uniswap_v3_mint")` — but the function returns `RegisteredTool[]` objects, not name strings.
- **Fix:** Changed to `expect(listRegisteredTools().map((t) => t.name)).toContain(...)` matching the prepare-aave-supply.test.ts pattern.
- **Files modified:** 5 test files (all prepare_uniswap_v3 tests).
- **Commit:** `380c947` (Task 2; fixed before commit).

**2. [Rule 1 — Test grep collision] Anti-pattern test fired against doc-comment references to `0x5ae401dc`**
- **Found during:** Task 1 (file-level anti-pattern grep).
- **Issue:** Module doc-comment used the literal `0x5ae401dc` inside a sentence saying it "MUST NOT appear" — the grep test caught its own doc-comment self-reference.
- **Fix:** Reworded the doc-comment to use the prefix-only form (`0x5ae4...`) so the comment retains semantic clarity while the literal grep returns 0. Anti-pattern enforcement is the load-bearing constraint; documenting the constraint shouldn't trip the constraint.
- **Files modified:** `src/protocols/uniswap-v3-lp.ts`.
- **Commit:** `4d4668a` (Task 1; fixed before commit).

**3. [Rule 1 — Bug] InvalidAmountError constructor signature mismatch**
- **Found during:** Task 2 (typecheck after mint tool).
- **Issue:** Called `new InvalidAmountError(msg, { kind: "format" })` — but the constructor signature is `(message: string, kind: "empty" | "format" | "fractional-overflow")` (positional, not object).
- **Fix:** Changed to `new InvalidAmountError(msg, "format")` at the two `invertDecimalPrice` throw sites.
- **Files modified:** `src/tools/prepare_uniswap_v3_mint.ts`.
- **Commit:** `380c947` (Task 2; fixed before commit).

**4. [Rule 2 — Missing critical functionality] Phase 33 NPM burn arm unreachable under existing dispatch flow**
- **Found during:** Task 3 (T2 preview-send test failed — expected NPM burn DECODED ARGS but text contained Rocket Pool burn label).
- **Issue:** The existing Phase 31 `} else if (sel === ROCKETPOOL_SELECTORS.burn) {` arm matched the selector first; on `tx.to !== rETH SOT` it set no decoded variable and the chain exited — bypassing the new Phase 33 NPM arm entirely.
- **Fix:** Extended the Phase 31 arm in-place to branch `if-rETH / else-if-NPM / else-fall-through` — both routes now resolve via tx.to dispatch under the shared selector. Preserves the prior-phase Pitfall 2 mitigation byte-for-byte while widening to the new SOT.
- **Files modified:** `src/tools/preview_send.ts`.
- **Commit:** `c36d92e` (Task 3; fixed before commit).

No Rule 4 architectural deviations. No checkpoints. No package-install gates fired.

## Threat Mitigations Confirmed

| Threat | Mitigation | Verified |
|--------|-----------|----------|
| T-LEDGER-BLIND-SIGN-NPM | LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE emitted UNCONDITIONALLY in all 5 prepare responses + at preview_send when isUniswapV3Lp | Pass — 5 prepare tests + preview T1/T2/T4 all assert |
| T-DECREASE-DOES-NOT-TRANSFER | Verbatim "decreaseLiquidity does NOT transfer tokens to your wallet" sentence baked into UNISWAP_V3_LP_DECREASE_PREPARE_RECEIPT_TEMPLATE | Pass — prepare-uniswap-v3-decrease-liquidity.test.ts asserts |
| T-MAX-UINT128-SENTINEL | Default + CHECKS PERFORMED disclosure; DECODED ARGS renders "MAX_UINT128 (collect everything)" label at preview | Pass — prepare-uniswap-v3-collect.test.ts + preview T4 assert |
| T-BURN-PRECONDITION | Pre-flight via positions(tokenId) refuses non-empty positions with hintTool routing | Pass — prepare-uniswap-v3-burn.test.ts asserts both liquidity > 0 and tokensOwed > 0 paths |
| T-APPROVAL-INSUFFICIENT-LP | Dual-token allowance read against NPM; insufficient → INVALID_INPUT + hintTool: prepare_token_approve naming the under-approved token | Pass — prepare-uniswap-v3-mint.test.ts + prepare-uniswap-v3-increase-liquidity.test.ts both assert (separate token0 + token1 cases) |
| T-FROM-DEPENDENT-FP-LP (accepted) | Fixtures pin per-persona deterministic fingerprints; persona-cycle re-anchor deferred to Plan 33-03 integration test (per planning) | Documented — to be confirmed at Plan 33-03 |
| T-SELECTOR-COLLISION-BURN | (tx.to, selector) tuple dispatch — rETH arm extended with NPM fallthrough; both routes regression-tested | Pass — preview T2 (NPM route) + T3 (rETH route preserved) |
| T-CONFIG-LITERAL-MIGRATION-2 | grep-zero for `0xC36442b4...` outside src/config/contracts.ts | Pass — `grep -rn "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" src/tools/prepare_uniswap_v3_*.ts \| wc -l` = 0 |

## Success Criteria

- [x] All 3 tasks of Plan 33-02 executed
- [x] Each task committed individually with `33-02` prefix (`4d4668a`, `380c947`, `c36d92e`)
- [x] **FROZEN-area zero-diff**: `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts src/clients/fourbyte.ts` is 0 lines
- [x] **No SDK leak**: `git diff package.json package-lock.json` is empty (no `@uniswap/v3-sdk` / `@uniswap/v3-core` / `@uniswap/v3-periphery` ever installed)
- [x] Fixtures UNI-LP-A, UNI-LP-B, UNI-LP-C, UNI-LP-D, UNI-LP-E pinned as hardcoded `0x...` literals in `test/signing-fingerprint.test.ts` (NO beforeAll-snapshot)
- [x] LEDGER NOTICE block surfaces unconditionally in every prepare response (5 tools) + at preview_send for the NPM (tx.to, selector) tuple
- [x] `decodeSingleNpmCall` helper EXPORTED from `preview_send.ts` for Plan 33-03 consumption (Pitfall 7 SHARED-decoder SOT)
- [x] Tuple-dispatch (tx.to, selector) in preview_send resolves the 0x42966c68 collision with Phase 31 rETH.burn — regression test in `test/preview-send.uniswap-v3-lp.test.ts` pins both routes
- [x] Full test suite: `npm test` exits 0 — 3984 passed (+58 net from baseline 3926)
- [x] SUMMARY.md created at `.planning/phases/33-evm-uniswap-v3-lp-verb-set/33-02-SUMMARY.md`
- [x] All commits stay on branch `feat/33-uniswap-v3-lp`

## Self-Check: PASSED

Verified on commit `c36d92e`:

- 13 new files exist (1 src protocol + 5 src prepare tools + 7 test files) — confirmed via `ls`
- 4 modified files (preview_send.ts / blocks.ts / register-all.ts / signing-fingerprint.test.ts) all committed across the 3 atomic commits
- All 3 task commits present in `git log --oneline`: `4d4668a`, `380c947`, `c36d92e`
- FROZEN-area `git diff origin/main -- <6 files>` is 0 lines
- `package.json` / `package-lock.json` `git diff` is 0 lines
- Full suite green: 3984 passed, 1 skipped, 0 failed (308 test files)

## Handoff to Plan 33-03

Plan 33-03 (composite rebalance — `prepare_uniswap_v3_rebalance` + composite-multicall preview shape + Fixture UNI-LP-F + persona-cycle integration test) consumes:

- `decodeSingleNpmCall` EXPORTED from `src/tools/preview_send.ts` — reuse for composite-multicall recursion per Pitfall 7 SOT discipline (DO NOT redefine).
- `UNISWAP_V3_LP_SELECTORS` from `src/protocols/uniswap-v3-lp.ts` — add `multicallBytes: "0xac9650d8"` slot AND the `encodeMulticallBytes` encoder + `MULTICALL_BYTES_ABI` parseAbi fragment (Plan 33-03 scope).
- `_uniswapV3LpProtocol` spy-affordance — Plan 33-03 widens with the new `encodeMulticallBytes` key.
- 5 PREPARE RECEIPT + 5 DECODED ARGS templates already shipped — Plan 33-03 adds `UNISWAP_V3_REBALANCE_PREPARE_RECEIPT_TEMPLATE` + composite-multicall DECODED ARGS rendering helper.
- `UniswapV3LpDecoded` discriminated union — Plan 33-03 widens with a `composite-multicall` variant carrying `subCalls: readonly UniswapV3LpDecoded[]`.
- `register-all.ts` — Plan 33-03's `prepare_uniswap_v3_rebalance.js` import lands AFTER Plan 33-02's 5-line block (sequential wave landing).
- `test/signing-fingerprint.test.ts` 5-fixture distinctness pattern — extends to UNI-LP-{A..F} 6-fixture set.
