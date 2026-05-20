# Phase 17 Plan-Check Report

**Checked:** 2026-05-20
**Phase dir:** `.planning/phases/17-tron-scaffolding-usb-hid-trx-reads-persistent-accounts/`
**Plans verified:** 5 (17-01 through 17-05)
**Worktree:** `.claude/worktrees/phase-17-research` (branch `plan/phase-17`)

## Overall verdict

**FLAG-WITH-INLINE-FIXES** — 0 blockers, 4 flags. All load-bearing regression anchors are present; all FROZEN-area assertions are written; goal-backward coverage is complete. Flags are coordination/wiring details that can be repaired inline at execute time without re-planning.

## Dimension verdicts (10)

1. **Requirements coverage — PASS.** ROADMAP Phase 17 lists `PAIR-NEV-* reuse, TRON-PAIR-01, TRON-PAIR-02, TRON-READ-01, TRON-READ-02, TRON-READ-03`. Each has explicit covering task(s):
   - TRON-PAIR-01 → 17-02 (`fetchTronAddress`) + 17-03 (`pair_tron_ledger.ts`)
   - TRON-PAIR-02 → 17-03 (`get_tron_status.ts`)
   - TRON-READ-01 → 17-01 (`getNativeBalance`) + 17-03 (`get_tron_balance.ts`)
   - TRON-READ-02 → 17-03 (`get_tron_token_balance.ts`) + 17-04 (registry)
   - TRON-READ-03 → 17-01 (`getBlockTip`) + 17-03 (`get_tron_block_tip.ts`)
   - PAIR-NEV-* reuse → 17-03 calls `saveAccount({ chain: "tron", ... })`; non-EVM-account-store schema untouched.
   - **NOTE — out-of-scope-but-shipped:** TRON-READ-04 (`get_portfolio_summary` TRON leg) is ROADMAP-mapped to Phase 21 (line 486 of REQUIREMENTS.md `TRON-READ-04, TRON-DIAG-01 | Phase 21`). PATTERNS.md meta-decision §1 overrides and ships it in 17-04. This is a documented planner choice with cross-chain-symmetry rationale (Phase 11 also shipped its portfolio leg in-wave). Not a coverage gap — a scope extension. Flag #1 below.

2. **Wave order soundness — PASS.** Frontmatter declarations match dependency graph:
   - 17-01: `wave=1, depends_on=[], parallel_eligible=none` ✓
   - 17-02: `wave=2, depends_on=[17-01], parallel_eligible=none` ✓
   - 17-03: `wave=3, depends_on=[17-01, 17-02], parallel_eligible=none` ✓
   - 17-04: `wave=4, depends_on=[17-01, 17-03], parallel_eligible=17-05` ✓
   - 17-05: `wave=4, depends_on=[17-01, 17-03], parallel_eligible=17-04` ✓
   - File-disjointness for Wave 4 parallel pair verified: 17-04 touches `tokens/`, `pricing/defillama.ts`, `tools/get_portfolio_summary.ts`; 17-05 touches `demo/`, `tools/set_demo_wallet.ts`, `tools/get_demo_wallet.ts`. Zero overlap.

3. **FROZEN-area discipline — FLAG (#2).** Every plan's `<success_criteria>` contains an explicit `git diff origin/main -- ...` assertion listing EVM signing modules (`payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts`, `blocks.ts`, `error-codes.ts`, `amount.ts`, `resolve-from.ts`, `simulation.ts`, `aave-health.ts`), `send_transaction.ts`, `preview_send.ts`, `canonical-dispatch.ts`, `skill-integrity.ts`. 17-03/17-04/17-05 also include `non-evm-account-store.ts`.

   **Flag:** the Phase 12 Solana fingerprint modules called out in the prompt (`src/signing/payload-fingerprint-solana.ts`, `src/signing/presign-hash-solana.ts`) are NOT named in any plan's FROZEN list. RESEARCH § Topic 10 names them prose-style ("All Solana-side signing modules from Phase 12") and PATTERNS.md FROZEN list cites `solana-fingerprint.ts` — but the per-plan `git diff` command does not enumerate the Solana-specific signing files. If Phase 12 has not yet shipped, the absent files would make the diff command no-op silently; if shipped, drift is uncaught.

4. **Test methodology — PASS.** All four required load-bearing regression anchors are explicitly named in plan test sections and success-criteria bullets:
   - 17-01 Test 2: `accountIndex("44'/195'/3'/0/0") === "3"` (segments[2] anchor, fail-loud against `lastHardenedIndex` regression — Pitfall 6).
   - 17-01 Test 6: `formatSunToTrx` bigint-widening regression with `9_007_199_254_740_993` fixture (Pitfall 1).
   - 17-02 Test 4: `fetchTronAddress` returns mock's `address` field VERBATIM with mocked `{ address: "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb" }`; test asserts string-equal byte level; success-criterion adds `grep -r "from \"bs58\"" ... | wc -l == 0` (Pitfall 2 — no-bs58.encode).
   - 17-03 Test 2 of `get_tron_token_balance`: USDD fixture with `decimals: 18` literal in envelope (Pitfall 5 — per-entry decimals).
   - 17-04 Test 4 + success-criterion: registry-shape decimals invariant + USDD=18 literal assertion (Pitfall 5).
   - 17-03 Test 9 of `pair-tron-ledger`: source-file grep `not.toContain("lastHardenedIndex")` (Pitfall 6 — defense-in-depth).
   - 17-03 Test 3: slot-3 substitution test renders `Slot:    #3` + `derivation path: 44'/195'/3'/0/0` (Pitfall 6 — REGRESSION ANCHOR).

5. **Research-finding propagation — PASS.** All 3 load-bearing findings surface in plans:
   - `tronweb@6.3.0` install named in 17-01 step 1 (NOT `@tronprotocol/sdk`); execution-context confirms research § Topic 1 lock.
   - 5-level BIP-44 path `m/44'/195'/0'/0/0` constant in 17-02 (`DEFAULT_TRON_DERIVATION_PATH`); `accountIndex(path)` extracts `segments[2]` in 17-01 + 17-03 explicit prose + tests.
   - `getAddress()` returns `{ address: string }` already base58check — 17-02 explicitly forbids `bs58.encode` step; test asserts byte-identity.
   - Per-entry hardcoded decimals (TRX=6, USDD=18) — 17-04 JSON schema requires explicit `decimals` field; module-load `validateEntry` rejects missing-decimals entries. Pitfall 5 regression-anchored at test-level in 17-03 + 17-04 + plan success criteria.

6. **PAIR-NEV-* schema reuse — PASS.** Both 17-03 prose and `<success_criteria>` explicitly assert "zero schema change to `src/wallet/non-evm-account-store.ts`" — 17-03's FROZEN diff list includes the file. RESEARCH § Topic 10 line 343 confirms `chain: "tron" | "bitcoin" | "litecoin"` already baked in Phase 11 at `non-evm-account-store.ts:43`. 17-03 is a pure consumer via `saveAccount({ chain: "tron", ... })`.

7. **`get_portfolio_summary` shape — PASS.** 17-04 extends in place (no `get_tron_portfolio_summary` fork). Steps 4a-4h: discriminated-union widening `PortfolioChainName = ChainName | "solana" | "tron"`, additive `NATIVE_PRICING_PROXY.tron`, `TronChainPortfolio` interface, `AnyChainPortfolio` widening, `includeTron` arg, `resolveTronWalletForFanOut`, `Promise.allSettled` leg. Same call site; same envelope; back-compat verified via Test 8.

8. **Sibling interface for persona — PASS.** 17-05 step 1 declares `TronPersona` interface as sibling (NOT widening `Persona`); execution-context cites PATTERN-MAPPER META-DECISION §2; test 6 of `tron-persona.test.ts` is a compile-time type test: `const p: Persona = tp;` MUST fail. PATTERNS.md surprise #2 confirms.

9. **`register-all.ts` carve coordination — PASS.** 17-03 (only plan to touch the file) inserts 5 imports immediately after line 19 (`import "./get_solana_status.js";`). Exact insertion position named in 17-03 execution-context AND step 6. 17-04 + 17-05 success-criteria explicitly assert `git diff origin/main -- src/tools/register-all.ts` returns EMPTY (zero additional registrations from those plans). 17-01 + 17-02 likewise.

10. **`axios@1.15.0` CVE residual — FLAG (#3, soft).** 17-01 execution-context lines 38 names the residual and the rationale (server-side env-or-fallback URL, no agent input). 17-01 step 1 explicitly says "DO NOT run `npm audit fix`". HOWEVER no plan ships the SECURITY.md documentation; 17-01 explicitly defers it ("NOT this plan — Phase 17 verify-phase / Phase 18 ships SECURITY.md TRON section"). Not a blocker because the prompt instruction was "SHOULD document this as an accepted residual" — the residual is documented IN RESEARCH.md § Topic 1 + Pitfall 3, and the residual is named in the plan's execution-context, just not in user-facing SECURITY.md. Flag for verify-phase pickup.

## Per-plan verdicts

- **17-01: PASS.** TronWeb install + chain shelf + 5-level path helper + bigint-boundary + USDD-decimals-18 reg-anchor preconditions all named. ESM spy `_tronRegistry` + `_trxRpcInternals` present. FROZEN diff explicit.

- **17-02: PASS.** Mirror of Solana transport with the no-`bs58.encode` divergence cleanly called out at THREE levels (prose Pitfall 2 reference, test 4 verbatim-equality assertion, success-criterion grep gate `from "bs58" | wc -l == 0`). `DEFAULT_TRON_DERIVATION_PATH === "44'/195'/0'/0/0"` literal-anchored in test 9.

- **17-03: FLAG (#4).** All 5 tools + register-all.ts + config-status extension cleanly scoped. Demo-mode FIRST refusal + `Promise.race` 60s + locked errorCode set + VERIFY-ON-DEVICE template + slot-3 regression anchor + `lastHardenedIndex` grep gate all present.

   **Flag:** the Plan-17-03 → Plan-17-04 type-only dependency on `findByAddress` from `src/tokens/tron-top-25.ts` is described as "imports the LOADER (which Plan 17-04 ships)" — but the LOADER file `src/tokens/tron-top-25.ts` itself is shipped by 17-04, not 17-03. If 17-03 is executed before 17-04 lands (Wave 3 vs Wave 4), the `import { findByAddress } from "../tokens/tron-top-25.js"` line will fail TypeScript build (file does not exist yet). Both PATTERNS.md surprise #3 and 17-03 execution-context acknowledge this as "phase-gate happens after both plans land" — but the in-wave parallel build will fail. Practical implication: 17-03 commits will not green `npm run build` until 17-04 lands. Fix: either (a) carry an empty `src/tokens/tron-top-25.ts` stub in 17-01 (more natural foundation home), or (b) make 17-03's `get_tron_token_balance.ts` an internal-only export that's NOT in `register-all.ts` until 17-04 lands. Cheap inline fix — flag, not blocker.

- **17-04: PASS.** Registry + `getTronPrices` + portfolio-leg widening shipped together. USDD=18 reg-anchor explicit at JSON entry level + validator level + test level. WTRX `NATIVE_PRICING_PROXY.tron` named. Wave-4 parallel-safety with 17-05 confirmed via explicit file-disjointness audit. Trade-off versus ROADMAP scope (TRON-READ-04 mapped to Phase 21) explicitly justified via pattern-mapper meta-decision §1.

- **17-05: PASS.** Sibling `TronPersona` interface (NOT widening) + DOA validation + `state.ts` widening + set/get demo wallet branches all wired. Persona address `TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb` named (research § Topic 8 preferred candidate) with fallback (JustLend) named for verify-phase. Branch ordering TRON-before-Solana-before-EVM explicit.

## BLOCKERs

None.

## FLAGs (cheap inline fixes)

1. **`get_portfolio_summary` TRON leg in 17-04 extends scope beyond ROADMAP.** ROADMAP Phase 17 requirements line names `TRON-READ-01..03`, NOT TRON-READ-04. REQUIREMENTS.md line 486 explicitly maps TRON-READ-04 to Phase 21. PATTERNS.md meta-decision §1 silently re-scopes. Recommendation: either (a) the planner explicitly adds `TRON-READ-04` to Phase 17's requirement list in ROADMAP.md as part of plan landing (one-line edit), or (b) Plan 17-04 splits the portfolio-leg work into a follow-up plan executed at Phase 21 entry. Picking (a) preserves the cross-chain-symmetry rationale; picking (b) preserves ROADMAP integrity. Recommend (a): update ROADMAP Phase 17 requirement list to include TRON-READ-04, update REQUIREMENTS.md cross-reference table line 486 to move TRON-READ-04 to Phase 17. Cheap one-file inline fix.

2. **FROZEN list does not enumerate Phase 12 Solana fingerprint modules.** Prompt asks for `src/signing/payload-fingerprint-solana.ts` + `src/signing/presign-hash-solana.ts` to appear in every plan's `git diff origin/main -- ...` assertion. Currently absent from all 5 plans' explicit list (RESEARCH covers them prose-style, but the executable check doesn't). Inline fix: append both paths to every plan's FROZEN diff success-criterion command. If Phase 12 hasn't shipped yet, the diff against absent files is a no-op — harmless. If Phase 12 ships before Phase 17 executes, the assertion catches drift.

3. **SECURITY.md axios CVE residual deferred.** Plans 17-01 and 17-04 lock the tronweb@6.3.0 / axios@1.15.0 dependency without surfacing the documented residual in SECURITY.md TRON section. Defer-to-verify-phase is consistent with the planner's stated approach but creates a window where `npm audit` runs in CI surface unexplained HIGH-severity findings. Optional inline fix: add a single-line task to 17-01 to append a "TRON dependency residuals" paragraph to SECURITY.md.

4. **17-03 imports from 17-04's file before 17-04 lands.** Wave-3 commit of 17-03 cannot green `npm run build` until 17-04 (Wave 4) lands, because `src/tokens/tron-top-25.ts` doesn't exist yet. Inline fix options: (a) move the empty `tron-top-25.ts` stub-with-types to 17-01 (foundational home, type-only loader contract); (b) 17-03 ships `get_tron_token_balance.ts` with `findByAddress` declared as a local type only (no import); 17-04 wires it. Preferred: (a) — move the empty registry skeleton + type contract into 17-01, 17-04 ships the JSON entries. Two-line edit to 17-01 plan files-this-plan-ships list; one-line update to 17-03 dependency hint.

## NITs

- 17-04 step 2 references `import ... with { type: "json" }` OR `assert { type: "json" }` — leaves the choice to "match the Solana loader's import style verbatim." Mild ambiguity, acceptable.
- 17-05 step 1 hardcodes `simulationEnvelopeShape: "triggerconstantcontract"` as a literal-union; type test in `tron-persona.test.ts` would catch any drift from this literal but isn't explicitly listed.
- 17-04 `tron-top-25.json` final entry list left to plan-author discretion (research § Topic 6 lock); acceptable per "curated registry" pattern but verify-phase may need to re-check coverage after execute time.

## Cross-plan concerns

- **Wave 3 → Wave 4 file dependency between 17-03 and 17-04** (Flag #4): same coordination Phase 11 used per PATTERNS.md surprise #3; documented as known pattern but worth surfacing pre-execute so the planner can apply Flag #4 fix at write time.
- **Demo-persona-vs-portfolio chain** (17-05 → 17-04): 17-04's `resolveTronWalletForFanOut()` calls `getActiveTronPersona()` from `src/demo/state.ts` shipped by 17-05. Both Wave 4; both must land before integration tests pass. Documented in 17-05 execution-context — no fix needed, just track at execute-time.
- **TronWeb namespace import** (multiple plans): plans use `TronWeb` (capital) in some places and `tronWeb.utils.address.isAddress` (lowercase) in others. Per RESEARCH § Topic 1 the SDK exports `class TronWeb`; the lowercase `tronWeb` is an instance method namespace access. Plans correctly differentiate — `TronWeb.utils.address.isAddress(...)` (static) in DOA-validation paths is acceptable; an instance `tw.address.isAddress(...)` would also work. Surface-coherent.
- **Configurability of MAX_DECIMALS=18 cap** in 17-04 Test 4 (`decimals <= 18`): TRC-20 decimals are technically unbounded in the spec; the test invariant could clip a future high-decimal entry. Not a blocker but a defense-in-depth assumption.

---

**Recommendation:** Execute as planned. Apply Flag #4 fix (move `tron-top-25.ts` stub to 17-01) before kicking off Wave 3 so 17-03 commits green `npm run build` in isolation. Apply Flag #2 fix (Phase-12 Solana signing modules in FROZEN diff) at plan-finalization time — one-line edit per plan. Surface Flag #1 (TRON-READ-04 scope-versus-ROADMAP) to user for one-line ROADMAP edit OR leave as-is and document at Phase 21 entry. Flag #3 (SECURITY.md) is verify-phase concern.
