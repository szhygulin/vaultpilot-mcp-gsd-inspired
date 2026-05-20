# Phase 28 Plan-Check Report

**Checked:** 2026-05-20
**Checker:** gsd-plan-checker (goal-backward verification, FORCE stance)
**Scope:** 28-CONTEXT.md + 28-RESEARCH.md + 28-PATTERNS.md + 28-{01,02,03,04}-PLAN.md against ROADMAP Phase 28 + REQUIREMENTS.md §CMP-01..06

## Overall verdict

**FLAG-WITH-INLINE-FIXES** — 0 blockers, 6 flags, 5 nits. Plans cover all 6 requirements with strong analog-mirroring discipline, sound wave order, and full FROZEN-area coverage. Flags are scope-clarity issues (decision-deviation documentation), not coverage gaps. Plans are executable as-is; flags can be addressed in PR descriptions.

## Dimension verdicts (11)

| # | Dimension | Verdict | Notes |
|---|---|---|---|
| 1 | Requirement coverage | PASS | All 6 CMP-01..06 reqs assigned: 28-01 [CMP-06]; 28-02 [CMP-03, CMP-04]; 28-03 [CMP-05]; 28-04 [CMP-01, CMP-02, CMP-06] |
| 2 | Wave-order soundness | PASS | 28-01 (w1, deps []) → 28-02 (w2, [28-01]) → 28-03 (w3, [28-01, 28-02]) → 28-04 (w4, [28-01, 28-02, 28-03]); strict-sequential as prompted |
| 3 | FROZEN-area discipline | PASS-WITH-NIT | All 4 plans' success_criteria assert zero-diff on the 5 FROZEN files. Solana fingerprint/presign modules don't exist yet (v1.x ships EVM only — memory `v1.x fully code-complete` + filesystem check); plans correctly DON'T touch non-existent files (vacuous compliance). Patterns § 6 mentions "15-code locked union" — stale; actual is 20-code (verified `src/signing/error-codes.ts` lines 81-101) — NIT |
| 4 | Test methodology | PASS | Fixtures R/S/T/U pinned as hardcoded `0x...` literals in `test/signing-fingerprint.test.ts` (Plan 28-01); NO `beforeAll`-snapshot (CLAUDE.md Conventions honored); 28-02/03 re-anchor at consumer-side tests (T9 in each test file); 28-04 ships `test/compound-v3-lifecycle.integration.test.ts` mirroring Phase 6 ERC-20 lifecycle shape with persona-swap byte-identity (`T-INTEGRATION-FROM-DRIFT-1` extension) |
| 5 | Research-finding propagation | PASS | 6 mainnet Comet addresses (`0xc3d688B6...` etc.) seeded in 28-01 SOT; `parseAbi` 8-fn fragment in 28-01 + 11-fn extension in 28-04; `COMPOUND_COMETS_RAW` sibling const idiom honored (NOT widening `ContractsForChain`); `LEDGER_NOTICE_COMPOUND_TEMPLATE` required at preview in 28-04 (mirrors `LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE`); single-calldata-two-intents pattern locked across plans |
| 6 | `INVALID_INPUT + hintTool` pattern | PASS | All 4 prepare tools (28-02 + 28-03) refuse with `errorCode: "INVALID_INPUT"` + `structuredContent.hintTool: "<sibling tool>"`. Pairings: supply→repay; withdraw→borrow; borrow→withdraw; repay→supply. No new error code added — ErrorCode union FROZEN. 28-02 step 6 explicitly weighs envelope-extension vs per-tool surface and chooses per-tool (correctly preserves FROZEN discipline). Refusal messages include current-state context (has-supply/has-borrow) per truth assertions |
| 7 | `get_lending_positions` extend-in-place | PASS | 28-04 EXTENDS `get_lending_positions.ts` via discriminated-union row widening (`protocol: "aave-v3" | "compound-v3"`); ZERO fork to `get_compound_positions` separate tool; Aave rows byte-identical (only `protocol` field added); top-level `sources.{aave, compound}` summary with zero-anchor discipline; test asserts existing Aave-only assertions stay green |
| 8 | `simulate_position_change` extension | PASS | 28-04 step 7 adds `protocol: "aave-v3" | "compound-v3"` slot (default `"aave-v3"` for back-compat) + `cometAddress?` for Compound arm; existing Aave path UNCHANGED; same 4-action enum (supply/withdraw/borrow/repay) consumed by Compound dispatcher; cross-protocol `classifyLiquidationRisk` REUSED from `aave-health.ts` (no duplication) |
| 9 | `register-all.ts` carve coordination | PASS | 28-02: +2 imports (`prepare_compound_supply` + `_withdraw` after `prepare_aave_*` block); 28-03: +2 imports (`_borrow` + `_repay` after 28-02 block); 28-04: +1 import (`get_compound_market_info` in read-tool block after `get_lending_positions`). Total +5 imports — matches prompt expectation. Insertion positions distinct → no same-line conflict on cumulative landing |
| 10 | Multi-chain DEFERRED | PASS | Plan 28-01 SOT seeds Ethereum-only (`COMPOUND_COMETS_RAW: { 1: {...6 addresses} }`); `getAllCompoundCometsForChain(2)` returns `[]` (test T8); canonical-dispatch arm wiring in 28-04 step 10 is Ethereum-only (`chainId === 1 ? getAllCompoundCometsForChain(1) : []`); 28-02/03/04 all use `chain: z.literal("ethereum")` Zod literal narrowing. Polygon/Arbitrum/Base/Optimism addresses NOT seeded |
| 11 | `deriveIntent` Option A/B fork | PASS-WITH-NIT | Plan 28-03 lines 148 explicitly documents Option A (re-call `_compoundChains.readBaseToken` on refusal path only) vs Option B (widen `deriveIntent` return shape). Choice + cost (extra RPC ONLY on refusal) named in execution_context. NIT: trade-off documented in plan body but not in `must_haves.truths` — re-readers may miss it |

## Per-plan verdicts

- **28-01**: PASS — SOT extension + protocol module + 4 fixture pins. Comprehensive zero-diff assertions on 5 FROZEN files. `@ts-expect-error` on `getAllCompoundCometsForChain(2)` is clever defensive coding — fails-loud if `ChainId` widens.
- **28-02**: PASS — partial `src/chains/compound-v3.ts` (just the intent helpers — minimal needed) + 2 prepare tools + shared `deriveIntent` helper. Intent-gate prologue runs BEFORE `parseAmountStrict` and `encodeFunctionData` per `vi.spyOn` assertions. `hintTool` surfaced via `structuredContent` (NOT envelope) — keeps `error-codes.ts` FROZEN.
- **28-03**: PASS — reverse-direction prepare tools + `"max"` → MAX_UINT256 LITERAL for repay. Reuses 28-02's `deriveIntent`; grep-zero assertions enforce 4 distinct call sites (one per prepare tool, no inlined intent logic). Concern: CMP-05 wording deviation (see FLAGs).
- **28-04**: PASS — extends `src/chains/compound-v3.ts` + adds `compound-collateralization.ts` + `get_compound_market_info` + extends `get_lending_positions` (discriminated-union) + extends `simulate_position_change` (Compound arm) + extends `preview_send` (three-tier dispatch) + extends `canonical-dispatch.ts` (+6 Ethereum allowlist members) + LEDGER NOTICE template + 19-file integration test. **Largest plan — borderline scope** (see NITs).

## BLOCKERs

None.

## FLAGs

1. **CMP-05 wording deviation in Plan 28-03 (resolved by user-prompt override but worth surfacing in PR body).** ROADMAP success criterion #5 says `prepare_compound_repay({ amount: "max" })` resolves "server-side to outstanding-debt amount + small buffer". Plan 28-03 changes this to MAX_UINT256 LITERAL based on the user prompt — "(mirror Phase 6 pattern)". Plan 28-03 line 153 documents the deviation explicitly. **Fix:** PR body MUST surface the deviation alongside the rationale so reviewers don't bounce on ROADMAP mismatch. The original "debt × 1.01" approach (research § Topic 4) would have produced a more honest DECODED ARGS block (user sees concrete number, not opaque MAX); the MAX_UINT256 path defers honesty to Comet contract clamping. Acceptable trade-off but should be called out.

2. **CONTEXT.md status is "Placeholder — context-gathering pending".** The CONTEXT.md file at line 4 reads `**Status:** Placeholder — context-gathering pending (run /gsd-discuss-phase 28)`. The Decisions section says `Pending — to be gathered`. Yet plans cite "CONTEXT.md decision lock" multiple times (e.g., 28-RESEARCH.md line 18, "per CONTEXT.md decision lock"). **Fix:** Either run `/gsd-discuss-phase 28` to make the placeholder decisions concrete, OR update CONTEXT.md to status `Complete` if the anchor candidates in lines 18-22 are now the final decisions. The plans operate as-if CONTEXT.md is locked; the placeholder language creates an audit-trail ambiguity.

3. **Plan 28-04 scope — borderline at 19-file delta.** Patterns § 9 verdict declared 28-04 "the largest plan". 19 files modified/created in a single PR is at the edge of execute-ability without quality degradation. Per CLAUDE.md context-budget heuristics (5-8 files target, 10 warning, 15+ blocker by gsd-plan-checker convention) — this hits the warning threshold. Plan 28-04 has 4 NEW + 14 MODIFIED + 1 NOT MODIFIED. **Fix:** Either split 28-04 into 28-04a (reads: `compound-collateralization.ts` + `get_compound_market_info.ts` + `get_lending_positions.ts` widening + `simulate_position_change.ts` extension) and 28-04b (defense + integration: `canonical-dispatch.ts` + `blocks.ts` LEDGER NOTICE + `preview_send.ts` three-tier + integration test); OR accept the large scope and budget extra review time. The 4 plans' carve was specified in the prompt as 4 plans serial, so a split would deviate from prompt scope.

4. **Plan 28-04 extends `src/protocols/compound-v3.ts` ABI (Plan 28-01's file) but the file is NOT in 28-04's `files_modified` frontmatter.** Plan 28-04 step 2 explicitly says "Add `src/protocols/compound-v3.ts` to `files_modified` if not already — it's an extension, not a touch of FROZEN. (Looking back at frontmatter — `src/protocols/compound-v3.ts` is NOT in this plan's `files_modified`; ADD it during the execute step.)" This is an in-plan acknowledgment of a missing frontmatter entry. **Fix:** Update 28-04's `files_modified` to include `src/protocols/compound-v3.ts` BEFORE execution (don't rely on execute-time discovery). Same gap: 28-04 frontmatter omits `src/protocols/compound-v3.ts` from `key_links` even though `getSupplyRate`/`getBorrowRate`/etc. additions are cross-link targets.

5. **Plan 28-04 step 6 — `get_lending_positions` extraction risk.** Step 6 instructs "Refactor the existing inline Aave logic into a `readAavePositions(client, chainId, wallet)` helper (PURE EXTRACTION — no logic change)." A pure-extraction refactor inside a 19-file PR is the kind of change that's easy to claim and hard to verify. **Fix:** Add an explicit success-criterion assertion that pre-refactor and post-refactor `get_lending_positions` results on a known wallet produce byte-identical JSON (record fixture before refactor, compare after). Currently the assertion is `Aave-only assertions byte-identical` — that covers shape, not value-byte-identity on a synthetic fixture.

6. **Patterns § 6 carries stale "15-code locked union" reference.** PATTERNS.md line 658: "Phase 28 reuses the locked 15-code set." Actual union has 20 codes (verified `src/signing/error-codes.ts` lines 81-101). Plans 28-02 + 28-03 + 28-04 correctly say "locked 20-code union" in their bodies. **Fix:** Update 28-PATTERNS.md line 658 to "locked 20-code set" to keep the cross-doc reference honest. NIT-tier in priority but listed here because PATTERNS.md is a load-bearing reference doc for executor agents.

## NITs

1. **28-RESEARCH.md `## Open Questions` section heading not marked `(RESOLVED)`** (Dimension 11 gate). 4 questions listed; Q1-Q3 answered inline ("Phase 28 is Ethereum-only so the question doesn't bite"; "Confirmed deferred"; "Phase 28 SKIP"); Q4 (fixture letters G+H) was superseded by plans choosing R/S/T/U (since G/H already exist from Phase 7 in `test/signing-fingerprint.test.ts:113,140`). Mark heading `## Open Questions (RESOLVED)` and add `Q4 RESOLVED: R/S/T/U chosen (G+H taken by Phase 7).`

2. **`liquidationCollateralRatio` field name drift between research and patterns.** Research § Topic 5 line 203 names the field `liquidationCollateralRatio`; patterns § 2 line 200 names the output field `ratioScaled`; 28-04 must_haves line 38 uses `liquidationCollateralRatio` in the response shape and `ratioScaled` in the sources summary. The two names refer to the SAME bigint value (1e18-scaled). Pick one name and apply consistently. Suggest `liquidationCollateralRatio` (matches `get_compound_positions` external-facing field per research § Topic 6 line 283).

3. **28-04 ABI extension splits the Plan 28-01 ABI const across two plans.** Plan 28-01 ships an 8-function `COMPOUND_V3_COMET_ABI`; Plan 28-04 step 2 adds 11 more functions. Pros: Wave 1 surface is tight; Wave 4 has the read functions when needed. Cons: a future reader of the file sees `parseAbi([...])` and may not realize the array was assembled across two plans. Add a code-comment marker (`// Phase 28 / Plan 28-01:` / `// Phase 28 / Plan 28-04:`) at the boundary so the assembly is self-documenting.

4. **28-03 reverse-intent message has a minor double-RPC cost on refusal path** (Plan 28-03 lines 117-122). The refusal-message branch re-calls `_compoundChains.readBaseToken` to render the actual base-asset address in the error message. This is an extra RPC ONLY on refusal (cheap), but a planner-flagged alternative (modify `deriveIntent` to return `{ intent, baseToken }`) would amortize. Explicitly noted at line 148 as Option A vs B. NIT acceptable — Option A keeps Plan 28-02 untouched.

5. **`grep -E "0xc3d688B6|0x3Afdc9BC|..." src/` regex grep-zero discipline.** Plans 28-01/02/03/04 all anchor this grep. The pipe-alternation regex with `grep -E` works in BSD `grep` (macOS default); on other systems may need `grep -P` or `grep -E` with escaped pipes. Low risk (CI on macOS / Linux GNU grep — both honor `-E`) but worth confirming the runner doesn't run BusyBox grep. Apply the grep with `grep --extended-regexp` for portability if there's any doubt.

## Cross-plan concerns

- **`src/protocols/compound-v3.ts` ABI surface evolves Plan 28-01 → Plan 28-04.** Plan 28-01 ships 8 functions (matching Wave 1 surface). Plan 28-04 extends to 19 functions for read-tool surface. Per FLAG #4 above, 28-04's `files_modified` frontmatter must include `src/protocols/compound-v3.ts` before execution.
- **`src/chains/compound-v3.ts` evolves Plan 28-02 (4 helpers) → Plan 28-04 (8 helpers).** This split is documented in PATTERNS § 10 ("Mirror Phase 7 split between Plan 07-02 / 07-03 sibling-shelf evolution") and both plans honor it. The `_compoundChains` ESM spy export grows additively — no rebinding risk.
- **`src/signing/blocks.ts` evolves across 3 plans** (28-02: 2 RECEIPT; 28-03: 2 RECEIPT; 28-04: 1 LEDGER NOTICE + 2 DECODED ARGS). All append-only; coordination point per PATTERNS § 10. Trivial rebase risk if plans land out of order.
- **`register-all.ts` carve** (FLAG #4) — 28-02 +2, 28-03 +2, 28-04 +1 — distinct insertion points avoid same-line merge conflicts.
- **`canonical-dispatch.ts` Ethereum-arm growth from N to N+6.** PATTERNS § 3 calls out the count as 20 → 26 (4 canonical + 17 BRIDGED_VARIANTS − 1 WETH overlap + 6 Comets). Verify the math is asserted in `test/security-canonical-dispatch.test.ts` extension — 28-04 truth line 40 covers the membership change but not the exact count delta. Suggested success-criterion addition: assert `buildPerChainAllowlist(1).size === <prev N> + 6`.

## Verdict-summary one-liner

**FLAG-WITH-INLINE-FIXES** — Plans are executable as-is with full requirement coverage, sound wave order, FROZEN-area discipline, `INVALID_INPUT + hintTool` consistent across 28-02/03, `get_lending_positions` extended in-place (not forked), Compound multi-chain explicitly deferred to v2.3.x. The 6 FLAGs are scope-clarity / documentation-honesty improvements (CMP-05 wording deviation surfacing, CONTEXT.md status, 28-04 borderline scope, 28-04 frontmatter omission, refactor byte-identity assertion, PATTERNS.md stale count) — all addressable in PR descriptions or single-line edits without blocking execution.

---

*Plan-checker: gsd-plan-checker (goal-backward verification, FORCE stance)*
*Checked against: ROADMAP.md Phase 28 Goal / Success Criteria; REQUIREMENTS.md §CMP-01..06; 28-RESEARCH.md 10 topics + 6 DFs; 28-PATTERNS.md analog mapping; CLAUDE.md Conventions (FROZEN-area, fixture-pinning, ESM-spy indirection)*
