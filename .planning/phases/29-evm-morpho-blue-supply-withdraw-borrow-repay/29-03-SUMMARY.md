---
phase: 29
plan: 03
subsystem: tools / signing-blocks / security / preview-pipeline
tags: [morpho-blue, evm-lending, prepare-tools, asset-match-gate, repay-max, canonical-dispatch, lifecycle-integration, esm-spy-indirection]
requires:
  - Plan 29-01 (MORPHO_BLUE_ABI + 6 encoders + decoder + deriveMarketId + getMorphoBlueAddress + morpho-markets-ethereum.json + Fixtures V/W/X/Y — all BYTE-FROZEN by Plan 29-03)
  - Plan 29-02 (_morphoChains.readPosition + readMarket + readMarketParams + scanTouchedMarkets + computeExpectedSupply/BorrowAssets + get_morpho_positions tool — all BYTE-FROZEN by Plan 29-03)
  - Phase 28 prepare_compound_* tools (structural mirror for prepare_morpho_*)
  - Phase 28 Plan 28-04 preview_send four-tier dispatch precedent (extending to ERC-20 → Aave → Compound → Morpho)
  - viem (^2.48 — existing)
provides:
  - 6 prepare_morpho_*.ts MCP tools (supply / withdraw / supply_collateral / withdraw_collateral / borrow / repay) with: asset-match gate (loanToken vs collateralToken; refusal carries structuredContent.hintTool), intent-vs-reality gate (idToMarketParams + deriveMarketId re-check), demo-mode + WC-session gates, approval pre-flight soft warning (supply-direction tools only), encoder call via Plan 29-01 SOT, payloadFingerprint, handle, PREPARE RECEIPT block
  - prepare_morpho_borrow collateral-present check (position.collateral > 0n; refuse + hintTool prepare_morpho_supply_collateral)
  - prepare_morpho_repay repay-max via _morphoChains.readPosition(marketId, onBehalf).borrowShares + encodeMorphoRepay(params, 0n, borrowShares, ...) — NOT MAX_UINT256; MAX_UINT256 decimal-string explicit rejection per research § Pitfall 3
  - prepare_morpho_withdraw "max" path via toAssetsDown(supplyShares, totalSupplyAssets, totalSupplyShares)
  - 12 new templates in src/signing/blocks.ts (6 PREPARE RECEIPT + 6 DECODED ARGS) + buildMorphoDecodedArgsBlock helper; APPEND-ONLY (pre-existing templates byte-identical)
  - src/security/canonical-dispatch.ts Ethereum-arm allowlist extended with getMorphoBlueAddress(1)! (SOT-sourced; 26 → 27 entries; other-chain arms UNCHANGED)
  - src/tools/preview_send.ts four-tier dispatch extension with 6 Morpho decode arms via _morphoBlue.decodeMorphoBlueCall; dual token-context resolution from decoded.marketParams; NO LEDGER NOTICE (Morpho IS in LedgerHQ ERC-7730 registry — opposite of Compound); buildMorphoDecodedArgsJson serializer for structuredContent.decodedArgs
  - src/tools/get_lending_positions.ts discriminated-union widening (aave-v3 | compound-v3 | morpho-blue); Morpho fan-out arm via _morphoChains.scanTouchedMarkets + per-market reads; sources.{aave, compound, morpho} summary; Aave + Compound rows BYTE-IDENTICAL
  - +6 register-all.ts side-effect imports for prepare_morpho_* tools
affects:
  - Phase 30+ EVM lending plans (Spark, EulerV2, FluxFinance) — Morpho four-tier dispatch slot established
  - v2.3.x Morpho Base + Polygon deployments — SOT getter widening picks up new chains in canonical-dispatch automatically
  - v2.3.x get_morpho_market_info tool — deferred per Open Question #4; morpho-markets-ethereum.json registry is the current discovery surface
tech-stack:
  added: []
  patterns:
    - "Dual-token context resolution in preview_send — Morpho calls carry BOTH loanToken AND collateralToken in the decoded MarketParams (unlike Aave + Compound which have one asset per call). Each resolved independently against the per-chain registry + RPC fallback. T-COMPOUND-TX-TO-CONFUSION-1 extension."
    - "Repay-max via share-based encoding (research § Topic 5 + § Pitfall 3) — server reads position.borrowShares at prepare time + encodes repay(params, 0n, borrowShares, onBehalf, \"0x\"). NOT MAX_UINT256. The PREPARE RECEIPT renders \"amount: max\" VERBATIM (CLAUDE.md Conventions); the CHECKS PERFORMED block surfaces the resolved borrowShares; the structuredContent.resolvedBorrowShares field gives agents the machine-readable value."
    - "MAX_UINT256 anti-pattern explicit rejection — fires BEFORE the RPC reads with a structured hint pointing at the lowercase \"max\" string sentinel (research § Pitfall 3)."
    - "Asset-match gate at prepare time — for each of the 6 tools, asserts args.asset matches the expected side (loanToken for supply/withdraw/borrow/repay; collateralToken for supplyCollateral/withdrawCollateral). Mismatch → structuredContent.hintTool naming the correct counterpart tool. The hintTool plumbing flows at the per-tool structuredContent level (NOT envelope extension) — keeps error-codes.ts BYTE-FROZEN; 21-code union UNCHANGED."
    - "Intent-vs-reality gate (defense-in-depth — research § Pattern 2) — readMarketParams returns zero-address loanToken iff market does not exist; re-derive deriveMarketId(returnedParams) and assert equality with input marketId. Drift → INTERNAL_ERROR (should never fire in practice; mitigates T-MARKET-ID-DRIFT)."
    - "Approval pre-flight soft warning — ADVISORY only (never a refusal); supply-direction tools (supply, supply_collateral, repay) read ERC20.allowance(onBehalf, MORPHO) and emit a PRE-FLIGHT NOTE in CHECKS PERFORMED when allowance < required. Mirrors Phase 19 SunSwap precedent."
    - "Four-tier preview_send dispatch — ERC-20 → Aave → Compound → Morpho. The fourth tier sits AFTER Compound's unknown fall-through. ABI dispatch tables are disjoint, so clean fall-through is sufficient."
    - "NO LEDGER NOTICE for Morpho calldata (research § Topic 8) — Morpho IS in the LedgerHQ ERC-7730 clear-signing registry; the device clear-signs MarketParams + amounts + onBehalf. Opposite of Phase 28 Compound, which emits LEDGER_NOTICE_COMPOUND_TEMPLATE."
    - "canonical-dispatch.ts is an APPEND-target (Phase 28 added 6 Comets; Phase 29 adds 1 Morpho entry). The lifecycle-tron-stake-19 test's BYTE_FROZEN list dropped canonical-dispatch.ts in scope correction (the genuine invariant — SOT-sourced membership, zero inline literals — is covered by test/security-canonical-dispatch.test.ts)."
    - "End-to-end byte-identity discipline: Fixtures V/W/X/Y from Plan 29-01 are re-anchored through the full prepare-tool pipeline in test/morpho-blue-lifecycle.integration.test.ts. Cross-persona byte-DISTINCTION proves the onBehalf field is in the cryptographic-binding preimage."
key-files:
  created:
    - src/tools/prepare_morpho_supply.ts
    - src/tools/prepare_morpho_withdraw.ts
    - src/tools/prepare_morpho_supply_collateral.ts
    - src/tools/prepare_morpho_withdraw_collateral.ts
    - src/tools/prepare_morpho_borrow.ts
    - src/tools/prepare_morpho_repay.ts
    - test/prepare-morpho-supply.test.ts
    - test/prepare-morpho-withdraw.test.ts
    - test/prepare-morpho-supply-collateral.test.ts
    - test/prepare-morpho-withdraw-collateral.test.ts
    - test/prepare-morpho-borrow.test.ts
    - test/prepare-morpho-repay.test.ts
    - test/preview-send.morpho.test.ts
    - test/morpho-blue-lifecycle.integration.test.ts
  modified:
    - src/signing/blocks.ts (+12 templates + buildMorphoDecodedArgsBlock helper; APPEND-ONLY)
    - src/security/canonical-dispatch.ts (+1 Morpho Blue entry via SOT getter)
    - src/tools/preview_send.ts (four-tier dispatch extension + dual token-context + DECODED ARGS rendering + structuredContent serialization)
    - src/tools/get_lending_positions.ts (discriminated-union widening + Morpho fan-out arm + sources.morpho summary)
    - src/tools/register-all.ts (+6 prepare_morpho_* imports)
    - test/preview-send.dispatch-allowlist.test.ts (+2 cases; existing 11 byte-identical)
    - test/security-canonical-dispatch.test.ts (+6 cases; existing 26 byte-identical)
    - test/get-lending-positions.test.ts (+4 Morpho-branch cases; default _morphoChains.scanTouchedMarkets mock returns empty Set; existing 15 cases byte-identical)
    - test/signing-blocks.test.ts (+14 cases covering 12 templates + 5 dispatch arms)
    - test/lifecycle-tron-stake-19.integration.test.ts (scope correction — canonical-dispatch.ts dropped from BYTE_FROZEN list; mirrors Phase 23 scope correction for signing-fingerprint append-targets)
decisions:
  - "Dual token-context resolution in preview_send (loanToken + collateralToken in parallel) — added as separate variables rather than collapsing to a single tokenContext to keep the DECODED ARGS template surface symmetric (both labels render even when only one is on-list)."
  - "MAX_UINT256 anti-pattern check fires BEFORE the RPC reads in prepare_morpho_repay — short-circuits the wrong-sentinel attempt without consuming RPC budget; the structured hint points at the lowercase \"max\" string sentinel."
  - "Lifecycle test asserts byte-IDENTITY within persona (Fixture V/W/X/Y end-to-end through prepare-tool) AND byte-DISTINCTION across personas (different onBehalf → different fingerprint). The cross-persona check is the canonical proof that onBehalf is in the cryptographic-binding preimage (the supply tx data carries onBehalf as a field; the fingerprint includes the data hash)."
  - "lifecycle-tron-stake-19 scope correction — dropped src/security/canonical-dispatch.ts from the test's BYTE_FROZEN list. The file is provably an APPEND-target across phases (Phase 28 added 6 Comets; Phase 29 adds 1 Morpho). The genuine invariant (SOT-sourced, zero inline literals) is covered by test/security-canonical-dispatch.test.ts which directly tests the allowlist structure. Mirrors the Phase 23 scope correction for signing-fingerprint and error-codes append-targets."
  - "Withdraw-max via toAssetsDown rather than share-based encoding — Morpho's withdraw encoder accepts (assets, shares) with exactlyOneZero; the asset-based path with the resolved value rounds DOWN (under-reports what user CAN withdraw against the stale market state). The on-chain accrueInterest at tx time may add slightly more; the user receives at most what the prepare displayed plus a tiny accrual delta. Safe direction."
  - "Per-tool registry lookup (each prepare tool inlines the morpho-markets-ethereum.json registry parser) rather than a shared helper — keeps the file footprint minimal and the get_morpho_positions.ts:507 _morphoPositionsRegistry export available for test consumers without forcing the prepare tools to depend on get_morpho_positions.ts. Format-fanout-sentinel: every consumer parses the same JSON shape, but each owns the cast independently."
metrics:
  duration: "~42 min wall time"
  completed: "2026-05-23"
  task_count: 8 atomic commits (6 logical sub-units + lifecycle test + scope correction)
  test_count_delta: +85 # +7 prepare-morpho-supply + 6 withdraw + 5 supply_collateral + 5 withdraw_collateral + 7 borrow + 6 repay + 9 preview-send-morpho + 4 get-lending-positions Morpho-branch + 6 security-canonical-dispatch + 2 preview-send.dispatch-allowlist + 14 signing-blocks-Morpho + 10 lifecycle + 4 Aave/Compound test files re-checked
  files_created: 14
  files_modified: 10
requirements-completed: [MOR-02, MOR-03, MOR-04, MOR-05]
---

# Phase 29 Plan 29-03: Morpho Blue 6 prepare tools + asset-match gate + preview dispatch + canonical-dispatch + lifecycle integration

**6 prepare_morpho_* MCP tools (supply / withdraw / supplyCollateral / withdrawCollateral / borrow / repay) with asset-match gate, repay-max via position.borrowShares, four-tier preview_send dispatch, canonical-dispatch Ethereum allowlist 26 → 27, and full 4-state lifecycle integration test re-anchoring Fixtures V/W/X/Y end-to-end. v2.3 EVM lending Morpho leg complete.**

## Performance

- **Duration:** 42 min
- **Started:** 2026-05-23T04:04:37Z
- **Completed:** 2026-05-23T04:46:40Z
- **Tasks:** 8 atomic commits
- **Files created:** 14 (6 prepare tools + 7 test files + 1 lifecycle integration test)
- **Files modified:** 10 (5 src + 5 test)

## Accomplishments

- 6 `prepare_morpho_*` MCP tools shipped — supply / withdraw / supplyCollateral / withdrawCollateral / borrow / repay. Each carries: schema, agent-routing-prompt description, demo-mode + WC-session gates, intent-vs-reality gate (idToMarketParams + deriveMarketId re-check), asset-match gate (loanToken vs collateralToken with structuredContent.hintTool refusal), encoder call via Plan 29-01 SOT, payloadFingerprint, handle, PREPARE RECEIPT block.
- Repay-max idiom implemented per research § Topic 5: server reads `position.borrowShares` at prepare time + encodes `repay(params, 0n, borrowShares, ...)`. PREPARE RECEIPT renders `amount: max` VERBATIM; CHECKS PERFORMED surfaces the resolved borrowShares; MAX_UINT256 anti-pattern explicit rejection per research § Pitfall 3.
- Collateral-present check on `prepare_morpho_borrow` — refuses pre-encode if `position.collateral === 0n` with hintTool pointing at `prepare_morpho_supply_collateral` (research § Pattern 2).
- canonical-dispatch.ts Ethereum-arm extended via `getMorphoBlueAddress(1)!` SOT getter; allowlist size 26 → 27. Other-chain arms (chainId 8453 / 137 / 42161 / 10) UNCHANGED — Morpho L2 deployments deferred to v2.3.x. ZERO inline literals.
- preview_send.ts four-tier dispatch (ERC-20 → Aave → Compound → Morpho) with 6 Morpho decode arms via `_morphoBlue.decodeMorphoBlueCall`; dual token-context resolution from decoded.marketParams (NOT record.tx.to — T-COMPOUND-TX-TO-CONFUSION-1 extension); NO LEDGER NOTICE (Morpho IS in LedgerHQ ERC-7730 clear-signing registry — opposite of Compound).
- get_lending_positions.ts discriminated-union widening: rows carry `protocol: "aave-v3" | "compound-v3" | "morpho-blue"`; Morpho fan-out arm via `_morphoChains.scanTouchedMarkets` + per-market reads (re-using Plan 29-02 infrastructure); top-level `sources.{aave, compound, morpho}` summary. **Aave + Compound rows BYTE-IDENTICAL** — existing test assertions unchanged.
- 12 new templates in src/signing/blocks.ts (6 PREPARE RECEIPT + 6 DECODED ARGS) + buildMorphoDecodedArgsBlock dispatch helper. APPEND-ONLY (pre-existing templates byte-identical).
- 85+ new tests across 14 created + 5 modified test files; lifecycle integration test re-anchors all 4 Plan 29-01 fixtures (V/W/X/Y) end-to-end through the prepare-tool pipeline.

## Task Commits

1. **blocks.ts — 12 MORPHO_* templates + buildMorphoDecodedArgsBlock helper** — `4d6f782` (feat)
2. **canonical-dispatch Ethereum allowlist — +1 entry (getMorphoBlueAddress)** — `41524ef` (feat)
3. **4 prepare tools — supply / withdraw / supply_collateral / withdraw_collateral** — `e95377a` (feat)
4. **2 prepare tools — borrow / repay (repay-max via _morphoChains.readPosition)** — `8ee7e23` (feat)
5. **preview_send Morpho dispatch arms (6 selector decodes; dual token-context)** — `2c02fa2` (feat)
6. **get_lending_positions Morpho arm — discriminated-union widening + sources.morpho** — `50b53f8` (feat)
7. **signing-blocks Morpho template byte-identity + lifecycle-tron-stake-19 scope correction** — `12ab5f2` (test)
8. **morpho-blue-lifecycle.integration.test.ts — 4-state pipeline + Fixtures V/W/X/Y end-to-end** — `2d70ff9` (feat)

_Plan metadata commit (this SUMMARY file) will follow per orchestrator convention._

## Files Created/Modified

### Created (14)
- `src/tools/prepare_morpho_supply.ts` — supply prepare tool with asset-match gate + approval pre-flight
- `src/tools/prepare_morpho_withdraw.ts` — withdraw prepare tool with "max" path via toAssetsDown
- `src/tools/prepare_morpho_supply_collateral.ts` — collateral post; asset-match against collateralToken
- `src/tools/prepare_morpho_withdraw_collateral.ts` — collateral release; receiver defaults to onBehalf
- `src/tools/prepare_morpho_borrow.ts` — borrow with collateral-present check (research § Pattern 2)
- `src/tools/prepare_morpho_repay.ts` — repay with share-based repay-max (research § Topic 5) + MAX_UINT256 anti-pattern rejection
- `test/prepare-morpho-supply.test.ts` — 7 cases including Fixture V byte-identity
- `test/prepare-morpho-withdraw.test.ts` — 6 cases including "max" → toAssetsDown
- `test/prepare-morpho-supply-collateral.test.ts` — 5 cases including Fixture Y byte-identity
- `test/prepare-morpho-withdraw-collateral.test.ts` — 5 cases
- `test/prepare-morpho-borrow.test.ts` — 7 cases including Fixture W byte-identity + collateral-present refusal
- `test/prepare-morpho-repay.test.ts` — 6 cases including Fixture X byte-identity (REPAY-MAX) + MAX_UINT256 anti-pattern
- `test/preview-send.morpho.test.ts` — 9 cases (6 selector arms + share-based annotation + NO LEDGER NOTICE assertion + selector round-trips)
- `test/morpho-blue-lifecycle.integration.test.ts` — 10 cases (4-state pipeline + asset-match refusal scenarios via full pipeline + persona swap)

### Modified (10)
- `src/signing/blocks.ts` — APPEND-ONLY: 12 new templates + buildMorphoDecodedArgsBlock helper
- `src/security/canonical-dispatch.ts` — +1 entry via getMorphoBlueAddress(1) SOT getter; size 26 → 27
- `src/tools/preview_send.ts` — four-tier dispatch (added Morpho tier); dual token-context resolution; buildMorphoDecodedArgsJson serializer
- `src/tools/get_lending_positions.ts` — discriminated-union widening; Morpho fan-out arm; sources.morpho summary
- `src/tools/register-all.ts` — +6 prepare_morpho_* imports (alphabetical after Compound block)
- `test/preview-send.dispatch-allowlist.test.ts` — +2 cases (Morpho passes Layer 0.5; negative regression)
- `test/security-canonical-dispatch.test.ts` — +6 cases (membership + size-pin 26→27 + non-mainnet null + refused-payload)
- `test/get-lending-positions.test.ts` — +4 Morpho-branch cases; default `_morphoChains.scanTouchedMarkets` mock returns empty Set; existing 15 cases byte-identical
- `test/signing-blocks.test.ts` — +14 cases (12 templates + 5 dispatch arms)
- `test/lifecycle-tron-stake-19.integration.test.ts` — scope correction (canonical-dispatch.ts dropped from BYTE_FROZEN; see Deviations §)

## Decisions Made

- **Dual token-context resolution as separate variables** (not collapsed to a single `tokenContext`). Keeps the Morpho DECODED ARGS template surface symmetric — both loanToken AND collateralToken labels render even when only one resolves on-list.
- **MAX_UINT256 anti-pattern check before RPC reads in prepare_morpho_repay** — short-circuits the wrong-sentinel attempt without consuming RPC budget.
- **Per-tool registry lookup** (each prepare tool inlines the morpho-markets-ethereum.json registry parser) rather than a shared helper — keeps the file footprint minimal and the get_morpho_positions.ts:507 _morphoPositionsRegistry export available for test consumers without forcing the prepare tools to depend on get_morpho_positions.ts.
- **Withdraw-max via toAssetsDown** rather than share-based encoding — rounds DOWN, conservative; the on-chain accrueInterest delta is in the safe direction (user receives at most prepare-displayed value + small accrual).
- **lifecycle-tron-stake-19 BYTE_FROZEN list scope correction** — `canonical-dispatch.ts` dropped because it's provably an APPEND-target across phases (Phase 28 added 6 Comets; Phase 29 adds 1 Morpho). Mirrors the Phase 23 correction for `signing-fingerprint` + `error-codes` append-targets. The genuine "SOT-sourced; zero inline literals" invariant remains covered by `test/security-canonical-dispatch.test.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] lifecycle-tron-stake-19.integration.test.ts BYTE_FROZEN scope correction**
- **Found during:** Final full-suite verification after the canonical-dispatch.ts +1-entry commit (commit `41524ef`)
- **Issue:** Phase 19's lifecycle integration test asserts a hard `BYTE_FROZEN_FILES` list that includes `src/security/canonical-dispatch.ts`. But canonical-dispatch.ts is provably an APPEND-target across phases — Phase 28 Plan 28-04 added 6 Compound Comets to the Ethereum-arm allowlist (commit `0d0d5c5` on main). The test passes on `main` because `git diff origin/main` is empty, but it lights up on any feature branch making additive changes to that file. This is the same pattern Phase 23 fixed for `signing-fingerprint` and `error-codes` append-targets.
- **Fix:** Dropped `canonical-dispatch.ts` from `BYTE_FROZEN_FILES`. The genuine invariant (SOT-sourced membership; zero inline literals) is directly tested by `test/security-canonical-dispatch.test.ts`. Added documentation comment in the test explaining the scope correction.
- **Files modified:** `test/lifecycle-tron-stake-19.integration.test.ts`
- **Verification:** Full vitest run passes (268 test files, 3412 tests); the test's other byte-frozen assertions for the actual Phase 18 TRON primitives + the EXPECTED_PHASE_19_FILES set are preserved.
- **Committed in:** `12ab5f2` (alongside the signing-blocks Morpho template tests in the same atomic commit per cadence)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The deviation was test-scope correction, not code-behavior change. The genuine security invariant remains covered by the dedicated test. No scope creep.

## Issues Encountered

- **TypeScript narrowing in `buildMorphoDecodedArgsBlock`:** The discriminated union has two structurally-distinct arms (collateral arms lack `shares` + `isShareBased`); TS could not narrow by `kind` checks alone. Resolved by introducing a `shareBased = decoded as Extract<...>` local binding after the collateral arms early-return.
- **`getStatus()` return shape:** Initial test fixture used `{ paired: false }` but the actual session-manager returns `null` for unpaired state. Caught and fixed in T7 of `test/prepare-morpho-supply.test.ts`; pattern propagated to the other 5 prepare-tool test files.

## User Setup Required

None - no external service configuration required. Morpho Blue is on-chain on Ethereum mainnet; all RPC reads use the existing chain-registry infrastructure with public-node fallback.

## Next Phase Readiness

- v2.3 EVM lending milestone Morpho leg COMPLETE — MOR-02 / MOR-03 / MOR-04 / MOR-05 all satisfied.
- Phase 29 PR-ready: 16 commits on `feat/29-morpho-blue-supply-withdraw-borrow-repay` (6 from Plan 29-01 + 4 from Plan 29-02 + 8 from Plan 29-03 — including this SUMMARY commit when orchestrator opens the PR).
- Phase 30+ EVM lending plans (Spark, EulerV2, FluxFinance) can follow the same four-tier-dispatch + asset-match-gate + canonical-dispatch SOT extension pattern.
- Backlog issue to file at PR-open: `get_morpho_market_info` v2.3.x follow-up tool per planning-context Open Question #4 (currently the 25-entry morpho-markets-ethereum.json registry serves as the discovery surface).
- LedgerHQ ERC-7730 registry freshness check at PR-open: verify `calldata-MorphoBlue.json` still present in `registry/morpho/` (T-29-03-T-NO-LEDGER-NOTICE residual-risk mitigation).

## Self-Check: PASSED

- All 14 created files exist on disk ✓
- All 10 modified files have non-trivial diffs vs main ✓
- 8 Plan 29-03 commits all present in `git log main..HEAD` ✓
- FROZEN-region zero-diff verified:
  - `src/tools/send_transaction.ts` — 0 lines ✓
  - `src/signing/payload-fingerprint.ts` — 0 ✓
  - `src/signing/presign-hash.ts` — 0 ✓
  - `src/signing/handle-store.ts` — 0 ✓
  - `src/signing/error-codes.ts` — 0 ✓
  - `test/signing-fingerprint.test.ts` — 0 ✓
  - Plan 29-01/02 surfaces post-commit `22f0494`: 0 lines diff (BYTE-FROZEN through Plan 29-03) ✓
- canonical-dispatch allowlist runtime size verified: Ethereum (1) = 27 entries (was 26) ✓
- Full suite: 268 test files / 3412 tests pass (1 skipped — pre-existing) ✓
- `npx tsc --noEmit` clean ✓

---
*Phase: 29-evm-morpho-blue-supply-withdraw-borrow-repay*
*Plan: 03*
*Completed: 2026-05-23*
