# Phase 8 — Plan Verification (Plan-Checker)

**Phase:** 8 — Multi-EVM fan-out + token tooling
**Phase directory:** `.planning/phases/08-multi-evm-fan-out-token-tooling/`
**Plans checked:** 5 (08-01, 08-02, 08-03, 08-04, 08-05)
**Branch:** `plan/phase-08` (verified via `git symbolic-ref --short HEAD`)
**Bundle commit:** `a3d50e0` (verified on `plan/phase-08`, contains all 7 files)
**Check date:** 2026-05-16

---

## VERIFICATION PASSED — 0 BLOCK / 4 FLAG / 3 NIT

All 5 plans deliver the Phase 8 goal as stated in `ROADMAP.md`:

> Every existing tool gets a `chain` parameter; chain-id assertion enforced at preview + send time. `resolve_token` disambiguates bridged variants. `get_token_allowances` enumerates outstanding ERC-20 allowances with the `[SET-LEVEL ENUMERATION]` block.

Goal-backward trace:
- **chain parameter on every existing tool** → 08-02 threads `chain` through 13 chain-taking tools (6 reads + 7 prepares) + 3 OPTIONAL on `preview_send` / `send_transaction` / `set_active_account`.
- **chain-id assertion at preview + send** → 08-02 ships Layer 2 MISMATCH refusal at the TOP of `preview_send` + `send_transaction` BEFORE the existing three gates; `CHAIN_ID_MISMATCH` error code (15 → 16).
- **resolve_token bridged-variant disambiguation** → 08-04 ships `src/tools/resolve_token.ts` + `src/tokens/bridged-variants.ts` (~75 curated rows) with USDC vs USDC.e on Polygon/Arbitrum/Optimism + USDbC on Base.
- **get_token_allowances + [SET-LEVEL ENUMERATION] block** → 08-04 ships `src/tools/get_token_allowances.ts` (viem getLogs + multicall) + `SET_LEVEL_ENUMERATION_TEMPLATE` in `src/signing/blocks.ts` with byte-level fixture comparison (T-SET-LEVEL-BLOCK-DRIFT-1).
- **multi-chain WC pairing (Success Criterion #8)** → 08-05 widens `REQUIRED_NAMESPACES.eip155.chains` from `getConfiguredChainIds()` + `sessionToStatus` multi-chain accounting + `partiallyPaired` flag (T-WC-PARTIAL-1).
- **multi-chain RPC + config foundation (INST-40)** → 08-01 ships `src/chains/registry.ts` + ChainId widening + 25 new SOT addresses + `infura`/`alchemy` × 5 chains templates.
- **cross-chain `get_portfolio_summary` (READ-41)** → 08-03 adds Promise.allSettled fan-out + 4 per-chain top-50 JSON registries + per-chain 10s timeout (A9).

All 5 plans:
- Carry the `<frozen_assertions>` block naming the 4 FROZEN files verbatim (Dim 5 ✓).
- Cover their declared REQ-IDs in test surface (Dim 1 ✓).
- Have concrete `<files>`, `<action>`, `<verify>`, `<done>` per task (Dim 3 ✓).
- Honor the wave structure 08-01 → 08-02 → (08-03 ∥ 08-04) → 08-05 (Dim 4 ✓).
- Fixture J declared as PROPERTY test (`new Set([fp(1..10)]).size === 5`), NOT a literal pin (Dim 6 ✓ per RESEARCH § Topic 9 lock).
- Cite PATTERNS.md and RESEARCH.md chapter-and-verse instead of re-deriving (Dim 12 ✓).
- DF-1 (chain required on prepare_*) honored in 08-02; DF-2 (1M-block lookback) honored in 08-04 (Dim 9 ✓).

The FLAGs and NITs below are all sub-blocker — scope, test-count rough estimates, and one CLAUDE.md fixture-anchoring convention note. None of them threatens phase delivery; all are surfaced to the planner for opportunistic inclusion or for the executor's situational awareness.

---

## Coverage Summary

| Requirement / Success Criterion | Plan(s) | Status | Evidence |
|---|---|---|---|
| **READ-40** — all read tools accept `chain` | 08-02 | Covered | `requirements: [READ-40, ...]` in 08-02 frontmatter; 6 read tools modified per `<files_modified>` (`get_token_balance`, `get_transaction_status`, `get_token_metadata`, `get_lending_positions`, `simulate_position_change`, `check_contract_security`) |
| **READ-41** — `get_portfolio_summary` cross-chain fan-out | 08-03 | Covered | `requirements: [READ-41]`; cross-chain branch via `Promise.allSettled` + 10s per-chain timeout; `test/get-portfolio-summary.cross-chain.test.ts` 10 cases |
| **READ-42** — `resolve_token` with bridged variants | 08-04 | Covered | `requirements: [READ-42, READ-43, READ-44]`; `BRIDGED_VARIANTS` curated table (~75 rows); USDC vs USDC.e disambiguation in Test 1 + verbatim variantNote in Test 6 |
| **READ-43** — `get_token_allowances` enumerates | 08-04 | Covered | viem `getLogs` for Approval events + multicall cross-check; per-row `token`, `spender`, `spenderLabel`, `amount`, `isUnlimited`, `lastSeenBlock` |
| **READ-44** — `[SET-LEVEL ENUMERATION]` block | 08-04 | Covered | `SET_LEVEL_ENUMERATION_TEMPLATE` added to `src/signing/blocks.ts`; Test 4 byte-level fixture comparison (T-SET-LEVEL-BLOCK-DRIFT-1) |
| **PREP-40** — `prepare_*` accept `chain` + assertion | 08-02 | Covered | 7 prepare tools modified; Layer 2 MISMATCH refusal at preview + send; Layer 3 fingerprint-drift continues to bind chainId (FROZEN) |
| **PREP-41** — `chain` mandatory on every `prepare_*` | 08-02 | Covered | INPUT_SCHEMA `required: ["chain", ...]` on all 7 prepares; per-tool test Test (b) asserts refusal w/ canonical list |
| **INST-40** — `RPC_PROVIDER + RPC_API_KEY` × 5 chains | 08-01 | Covered | `PROVIDER_TEMPLATES` for `infura` + `alchemy` × 5 chains; Test 11 (URL substitution) + Test 37 (`configuredChains` shape) |
| **SC #8** — WC multi-chain pairing | 08-05 | Covered | `REQUIRED_NAMESPACES.eip155.chains` from `getConfiguredChainIds()` (5 entries); `partiallyPaired` flag (T-WC-PARTIAL-1); `accountsByChain` Map |

All 8 REQ-IDs from ROADMAP `**Requirements:**` line + the 8th Success Criterion (no REQ-ID, roadmap-only) are covered. Zero uncovered.

---

## Plan Summary

| Plan | Tasks | Files (src) | Tests added (est.) | Wave | Status |
|------|-------|-------------|--------------------|------|--------|
| 08-01 | 1 | 5 MODIFY + 1 NEW | ~53 | 1 | Valid |
| 08-02 | 3 (sub-waves) | 17 MODIFY + 1 DELETE | ~52-65 | 2 | Valid |
| 08-03 | 1 | 3 MODIFY + 4 NEW (JSON) | ~16 | 3 (∥ 08-04) | Valid |
| 08-04 | 1 | 2 MODIFY + 3 NEW | ~30 | 3 (∥ 08-03) | Valid |
| 08-05 | 1 | 3 MODIFY | ~17 | 4 | Valid |

**Parallelism check (Dimension 4)**: 08-03 ∥ 08-04 file-touch overlap analysis:
- 08-03 modifies: `get_portfolio_summary.ts`, `tokens/registry.ts`, `pricing/defillama.ts`; creates 4 JSON files + 1 test file.
- 08-04 modifies: `signing/blocks.ts` (additive), `tools/register-all.ts` (+2 imports at line 5-6 carve); creates `bridged-variants.ts`, `resolve_token.ts`, `get_token_allowances.ts` + 3 test files.
- **Zero overlap.** Parallelism is safe by construction.

**Dependency graph**: 08-01 (Wave 1) → 08-02 (Wave 2) → 08-03 ∥ 08-04 (Wave 3) → 08-05 (Wave 4). No cycles, no forward references, no broken edges. `depends_on` frontmatter values consistent with the wave structure.

---

## Dimension-by-Dimension Verdict

| Dim | Name | Verdict | Notes |
|-----|------|---------|-------|
| 1 | Requirement coverage | PASS | All 8 REQ-IDs + SC#8 covered; mapping above |
| 2 | Goal-backward | PASS | Every goal claim traces to ≥1 plan |
| 3 | Task completeness | PASS | All tasks have files/action/verify/done; the 3 sub-tasks in 08-02 are properly cumulative-toward-single-commit |
| 4 | Dependency integrity | PASS | Wave structure holds; parallelism overlap verified |
| 5 | FROZEN-area discipline | PASS | All 5 plans carry `<frozen_assertions>`; 08-02 explicitly notes `send_transaction.ts` diff is ONLY additive top-of-handler block (three-gate logic BYTE-FROZEN) |
| 6 | Fixture J shape | PASS | 08-02 explicitly declares Fixture J as `new Set([fp(1..10)]).size === 5` property test, NOT a literal pin; cross-referenced from 08-01, 08-03, 08-04, 08-05 `<frozen_assertions>` |
| 7 | Threat model completeness | PASS | All 5 plans carry STRIDE register. T-CHAIN-MISMATCH-1 (08-02), T-EIP155-REPLAY (08-02), T-USDC-USDC.E (08-04), T-LOGS-MISS + T-LOGS-CEILING-1 (08-04), T-WC-PARTIAL-1 (08-05), T-FROZEN-SIGNING-1 (all 5) — each with named test or documented residual |
| 8 | Nyquist validation | SKIPPED | 08-RESEARCH.md has no `## Validation Architecture` section; project's `workflow.nyquist_validation` only fires when the research surfaces validation requirements (per spec). Dimension N/A. |
| 9 | Pre-locked design forks honored | PASS | DF-1 (chain REQUIRED on prepare_*; OPTIONAL on `get_portfolio_summary` per READ-41 + `resolve_token` per READ-42) appears in 08-02 `<execution_context>` line 43 + 08-04 line 25; DF-2 (`lookbackBlocks: 1_000_000n`) appears in 08-04 `<interfaces>` constant. Zero "TBD / Ask user" markers across all 5 plans. |
| 10 | Test-count plausibility | PASS (3 FLAGs) | See FLAGs below — counts diverge from rough estimates by ±10–20 in three plans. None breaches the +30 BLOCK threshold. |
| 11 | STOP-THE-LINE invariant labels | PASS (1 FLAG) | T-FROZEN-SIGNING-1 present in every plan. T-CHAIN-DISTINCTNESS-1 + T-CHAIN-MISMATCH-1 present in 08-02. T-LOGS-CEILING-1 present in 08-04. T-WC-PARTIAL-1 present in 08-05. T-USDC-USDC.E present in 08-04. T-EIP155-REPLAY present in 08-02. **Minor**: T-LOGS-MISS labeled but covered alongside T-LOGS-CEILING-1 in 08-04 — labels distinct but tests share Test 8. See NIT below. |
| 12 | Citation discipline | PASS | All 5 plans cite PATTERNS.md § N line N + RESEARCH.md § Topic N line N chapter-and-verse. Zero re-derivation of established content. |
| 13 | Register-all carve discipline | PASS | 08-04 inserts +2 imports AFTER `check_contract_security.js` (line 5) per PATTERNS.md § 3 line 432-443. 08-05 modifies existing `set_active_account.js` line 26 (no new import). Verified against actual `src/tools/register-all.ts` content. |
| 14 | STRUCTURAL EXTENSION naming | PASS | 08-01 `<execution_context>` line 88 explicitly states "STRUCTURAL EXTENSION not mechanical-clone"; 08-02 line 112 reiterates "Phase 8 is bounded-diff propagation across many files (6-line diff per tool); NOT new prepare_* tool cloning"; 08-PATTERNS.md Executive Summary anchors this. Zero copy-paste of Phase 6/7 prepare_* boilerplate. |
| 15 | commit_docs discipline | PASS | `a3d50e0` on `plan/phase-08` (current HEAD); `git show --stat HEAD` confirms 7 files (5 PLAN.md + RESEARCH + PATTERNS), 4879 insertions. Co-authored-by stamp present. |

**Additional dims from spec:**
- **Dim 11 (Research Resolution / #1602)**: 08-RESEARCH.md `## Open Questions` section reads "All resolved at planning gate (researcher reasonable-call locks per Phase 5/6/7 pattern)". Heading lacks `(RESOLVED)` suffix but body resolves all questions. PASS (with NIT — see below for opportunistic cleanup).
- **Dim 12 (Pattern Compliance / #1861)**: 08-PATTERNS.md `## 1. File-to-Analog Mapping` ships file-to-analog table; all 5 PLANs reference PATTERNS.md sections explicitly in their `<context>` blocks. Each modified-file's analog appears either in the plan or in PATTERNS.md. PASS.

---

## FLAGs (4) — should fix; execution can proceed

### FLAG-1 — Dim 10: 08-01 test count exceeds planning-prompt estimate range

- **Plan:** 08-01
- **Estimate range:** 25-35 cases
- **Actual count (from `<behavior>` block):** 15 (chains-registry) + 30 (config-contracts) + 4 (config-env) + 4 (get-vaultpilot-config-status) = **~53 cases**
- **Deviation:** +18 over upper bound; not at +30 BLOCK threshold
- **Impact:** The test surface is generous, not skinny. Risk is execution-time bloat, not coverage gap.
- **Surfaced for:** planner situational awareness; no revision required. The 25 byte-identity assertions (5 chains × 5 typed slots) folded into config-contracts are load-bearing for SOT integrity — keeping them is correct.

### FLAG-2 — Dim 10: 08-04 test count below planning-prompt estimate range

- **Plan:** 08-04
- **Estimate range:** 35-50 cases
- **Actual count:** 10 (bridged-variants) + 8 (resolve-token) + 12 (get-token-allowances) = **~30 cases**
- **Deviation:** -5 under lower bound; within ±10 tolerance band
- **Impact:** None — the 12 cases in `get-token-allowances` cover all 3 anchors (T-USDC-USDC.E, T-LOGS-CEILING-1, T-SET-LEVEL-BLOCK-DRIFT-1) + the 4 schema/happy-path/filter/spender-label cases. Coverage is sufficient.
- **Surfaced for:** planner situational awareness. Executor MAY add per-symbol bridged-variant table coverage (e.g. DAI on Polygon canonical vs bridged) opportunistically if low cost.

### FLAG-3 — Dim 10: 08-05 test count below planning-prompt estimate range

- **Plan:** 08-05
- **Estimate range:** 20-30 cases
- **Actual count:** 10 (session-manager.multi-chain) + 3 (set-active-account ext) + 4 (get-ledger-status ext) = **~17 cases**
- **Deviation:** -3 under lower bound; within ±10 tolerance
- **Impact:** None — the 10 cases in `session-manager.multi-chain.test.ts` cover both LOAD-BEARING anchors (T-WC-PARTIAL-1 Test 4 + T-SESSION-TOPIC-LEAK-1 Test 10) + T-WC-MULTI-CHAIN-PAIRING-REGRESSION-1 Test 2.
- **Surfaced for:** planner situational awareness. The real-Ledger physical-device verify-phase task is explicitly NOT in plan scope per CLAUDE.md — that's where the additional A5/A6 confirmation lives.

### FLAG-4 — Dim 11: T-LOGS-MISS and T-LOGS-CEILING-1 share Test 8 mitigation

- **Plan:** 08-04
- **Symptom:** Threat register lists T-LOGS-MISS (allowance-enumeration false-negative when allowance > lookback window) and T-LOGS-CEILING-1 (PublicNode 10k-block ceiling) as distinct STRIDE entries, but both name `test/get-token-allowances.test.ts` Test 8 as the asserter.
- **Impact:** Test 8 actually covers the chunking + warning + `chunksScanned` + `rpcDegraded` (T-LOGS-CEILING-1) AND the `lookbackBlocks` + `fromBlock` + `toBlock` verbatim surface (T-LOGS-MISS). The shared test is correct — the assertions overlap meaningfully — but the threat-register reader sees "Test 8" twice and may assume a single mitigation covers two threats.
- **Fix hint:** In 08-04 `<threat_model>` table, change T-LOGS-MISS asserted-by to `"test/get-token-allowances.test.ts Test 8 (lookbackBlocks + fromBlock surface) + Tool description (out-of-scope language for deeper history)"`. A 1-line clarification.
- **Inline fix:** Not applied — this is a documentation-clarity flag, not a delivery gap. Executor or revision-pass can address.

---

## NITs (3) — opportunistic improvements

### NIT-1 — Dim 11 (#1602): RESEARCH "Open Questions" heading suffix

- **File:** 08-RESEARCH.md line 1159
- **Current:** `## Open Questions`
- **Suggested:** `## Open Questions (RESOLVED)` — the body explicitly says "All resolved at planning gate"; the suffix would let downstream verifiers + linters PASS without parsing prose.
- **Severity:** NIT — research artifact was committed in `a3d50e0`; suffix can be added in a follow-up doc-only commit OR ignored (the spec's strict-parse fallback already PASSes for "no questions listed").

### NIT-2 — Dim 2: 08-05 `requirements: []` frontmatter is empty but plan delivers Success Criterion #8

- **File:** 08-05-PLAN.md line 12
- **Current:** `requirements: []`
- **Observation:** 08-05's own `<requirement_coverage>` table acknowledges this: "No REQ-IDs assigned in this plan (the Phase 8 success criterion #8 is roadmap-level, not requirement-level...)". The ROADMAP's "Requirements" line for Phase 8 has 8 REQ-IDs all covered by other plans; SC#8 is success-criterion-level only.
- **Impact:** None — the frontmatter is honest about what it does. The verifier (`gsd-verifier` post-execute) would see SC#8 covered by 08-05's success_criteria block + Test 4 (T-WC-PARTIAL-1 anchor).
- **Suggested:** Either leave `requirements: []` (honest) OR coin a synthetic REQ-ID like `SC-08-08` for traceability symmetry. Either path is defensible; current state is fine.

### NIT-3 — Dim 14: 08-05 register-all assertion is the inverse — verifies "no diff"

- **File:** 08-05-PLAN.md line 429
- **Observation:** 08-05 asserts `git diff origin/main -- src/tools/register-all.ts` MUST be EMPTY (no new tool registrations). This is the inverse of 08-04's "+2 import lines at the line 5-6 carve" assertion. Both are correct in isolation; both will be true post-merge. The inversion is intentional and matches the wave structure (08-04 owns the +2 imports; 08-05 modifies nothing in register-all). NIT only because the two assertions could be read as contradictory by a reader skimming both plans simultaneously without context. The PATTERNS.md § 3 line 432-443 carve table makes the non-conflict explicit.
- **Impact:** None — both plans land in different commits, and the post-merge state is "08-04's +2 lines present; 08-05 added nothing." Resolution at PR-review time.
- **Suggested:** No action; surfaced only to confirm cross-plan consistency was checked.

---

## Cheap-fix policy applied

Per the cheap-fix policy (≤5 lines, single PLAN file, no scope change): the 4 FLAGs above are not cheap fixes — they are either documentation observations (FLAG-4 is 1 line but in 08-04's threat-table inside a `<threat_model>` block which is structural, not just text), test-count observations (no rewrite), or scope-coverage observations. Surfaced to the planner / executor; nothing applied inline.

The 3 NITs are even smaller but all live in supporting artifacts (RESEARCH.md) or are intentional state (empty `requirements: []`, inverse assertion). No inline fix applied.

**0 inline fixes applied; 0 BLOCKers surfaced; 4 FLAGs + 3 NITs surfaced.**

---

## Cryptographic-binding chain — FROZEN verification

All 5 plans carry the verbatim FROZEN-area assertion:

> Zero diff to `src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/signing/handle-store.ts` (state machine), `src/tools/send_transaction.ts` (three gates). Fixtures A-H byte-identical across persona-cycle integration tests. Per RESEARCH § Topic 9, the preimage already binds chainId byte-for-byte; no new fixture literal needed. Fixture J is a property test (`new Set([fp(chain=1), fp(chain=42161), fp(chain=137), fp(chain=8453), fp(chain=10)]).size === 5`), NOT a hardcoded literal pin. Place Fixture J in 08-02 (the chain-threading plan).

08-02 ships Fixture J explicitly per its `<files_modified>` line 35 + `<interfaces>` lines 360-381 + Task 3 step 6. The four other plans carry the assertion but do NOT modify FROZEN files — each `<verify>` block includes a `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts` check that MUST return EMPTY.

**08-02 is the only plan with a non-empty diff against `src/tools/send_transaction.ts`** — and that diff is GUARANTEED additive (top-of-handler Layer 2 MISMATCH refusal BEFORE the existing schema gate + three-gate logic). The PR description for 08-02 must call out this additive-only invariant explicitly; the plan's `<success_criteria>` line 700 already does:

> `git diff origin/main -- src/tools/send_transaction.ts` shows ONLY the additive top-of-handler Layer 2 block (the three-gate logic BELOW byte-identical to Phase 7 baseline)

This is the PR-review gate that protects the FROZEN signing pipeline.

---

## Verdict

Plans verified. The 4 FLAGs are surfaced for planner situational awareness; none threatens Phase 8 delivery. The 3 NITs are opportunistic cleanups. Wave structure is sound; parallelism overlap is empty; cryptographic-binding chain is byte-frozen across the entire phase by construction.

Recommendation: **Proceed to execution.** Run `/gsd-execute-phase 8` to dispatch the 5 plans in waves 1 → 2 → (3 ∥ 3) → 4.

