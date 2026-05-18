# Phase 9 — Plan Verification (Plan-Checker Pass)

**Checked:** 2026-05-18
**Verifier:** plan-checker
**Phase:** 9 — Hardening (v1.3) — companion skill + 3 verification tools + dispatch allowlist + WC session-topic surfacing
**Plans verified:** 5 (09-01 through 09-05) + 1 supplementary template (09-01-SKILL-TEMPLATE.md)
**Branch:** `plan/phase-09`
**Commit:** `6f119a7` (on `plan/phase-09`, 8 files / 4883 insertions)

## VERIFICATION PASSED (with WARNINGS)

The plan set delivers the phase goal "Close residual-risk gaps that v1.0–v1.2 carry: compromised-MCP defense (skill), coordinated-agent (second-LLM), narrow-agent decode-lie (inline server-side cross-check)" through a coordinated 5-plan wave structure that touches zero bytes of the 12-file FROZEN cryptographic-binding chain. Three WARNINGS surfaced for execute-time discipline; no BLOCKERS.

---

## Dimension Results

| Dimension | Status | Notes |
|---|---|---|
| 1. Requirement coverage (SEC-30..38) | PASS | All 9 SEC-IDs mapped; 8/8 success criteria mapped |
| 2. Goal-backward (skill + 3 tools + allowlist + WC topic) | PASS | Phase goal fully decomposed across 5 plans |
| 3. Task completeness | PASS | All tasks have files / action / verify / done |
| 4. Dependency integrity | PASS | A → (B parallel 09-02 ∥ 09-04) → C (09-03) → D (09-05) holds; no cycles |
| 5. FROZEN-area discipline | PASS | Every plan has `<frozen_assertions>` naming 12-file list + Phase 8 Layer 2 region |
| 6. Pre-locked design forks honored | PASS | DF-1 separate sister repo + DF-2 parallel CANONICAL_DISPATCH_TARGETS; 3 load-bearing decisions documented |
| 7. Threat model completeness | PASS | All T-* codes present; cross-plan T-COMPROMISED-MCP-1 chained |
| 8. Nyquist | SKIPPED | No `## Validation Architecture` section in 09-RESEARCH.md per Phase 6/7/8 pattern |
| 9. Test-count plausibility | PASS | All 5 plans within prompt's ±10 range |
| 10. STOP-THE-LINE invariant labels | PASS | All required T-* anchors present |
| 11. PATTERNS + RESEARCH citation discipline | PASS | Plans cite analog files + RESEARCH topics; no re-derivation |
| 12. Sister-repo execute-time checkpoint | PASS | 09-01 Task 0 is `checkpoint:human-action` |
| 13. SHA-256 self-reference impossibility | PASS (with WARNING — see W-1) | 09-02 correctly externalizes EXPECTED_SKILL_SHA256 to MCP INSTRUCTIONS + README; SKILL.md body never contains the SHA at end state |
| 14. CANONICAL_DISPATCH_TARGETS option (b) PARTIAL | PASS | BRIDGED_VARIANTS shape verified against src/tokens/bridged-variants.ts; filter+map is correct |
| 15. commit_docs discipline | PASS | Bundle commit `6f119a7` on `plan/phase-09`; 5 PLANs + SKILL-TEMPLATE + RESEARCH + PATTERNS |
| 7c. Architectural tier compliance | PASS | RESEARCH.md ## Architectural Responsibility Map present; all tasks assign work to the named tiers |
| 9 (alt). Cross-plan data contracts | PASS | sessionTopicLast8 surface consistent; dispatchCheckResult re-runs same SOT helper |
| 10 (alt). CLAUDE.md compliance | PASS | ESM spy-affordance discipline + no inline addresses + decimal-aware + stderr/stdout discipline honored |
| 11 (alt). Research resolution (#1602) | PASS | RESEARCH.md has `## Open Questions (RESOLVED)` section at line 943 |
| 12 (alt). Pattern compliance (#1861) | PASS | 09-PATTERNS.md present with per-file analog mappings; every NEW file maps to in-tree analog |

---

## Requirement Coverage Map (SEC-30..38)

| Requirement | Plans (per `requirements_covered`) | Notes |
|---|---|---|
| SEC-30 — Companion skill ships with SKILL.md + integrity sentinel | 09-01 | Sister repo + SKILL.md + frontmatter |
| SEC-31 — Server pins SHA-256 in `instructions`; tamper/missing → NOTICE | 09-02 | Lazy probe + dispatcher-wrap + INSTRUCTIONS extension |
| SEC-32 — Skill encodes invariants #1/#2/#2.5/#5/#11 | 09-01 | Steps 1-6 cover invariants (#14 added bonus per RESEARCH) |
| SEC-33 — Step 0 mandatory pre-Invariant integrity self-check | 09-01 | Step 0 + `DO NOT SIGN.` halt text |
| SEC-34 — `get_verification_artifact` sparse JSON + pasteableBlock | 09-03 | T-PASTEABLE-BYTE-IDENTITY-1 anchor |
| SEC-35 — Outer dispatch-target allowlist (Aave/WETH/1inch/LiFi) | 09-04 | Layer 0.5 + option (b) PARTIAL for BRIDGED_VARIANTS |
| SEC-36 — WC session-topic cross-check in every signing flow | 09-05 | sessionTopicLast8 across preview_send + send_transaction + get_tx_verification |
| SEC-37 — `verify_tx_decode` 3-arm cross-check | 09-05 | Single-SOT decoder reuse via _protocols + _aaveProtocols |
| SEC-38 — `get_tx_verification` re-emit with tx JSON | 09-05 | Additive txJson + sessionTopicLast8 + dispatchCheckResult |

All 9 SEC-IDs in at least one plan's `requirements_covered` field. SC#1–#8 (8 Success Criteria from ROADMAP) map 1:1 to plans:
- SC#1 → 09-01 (sister repo + SKILL.md)
- SC#2 → 09-02 (SHA-256 pin + NOTICE)
- SC#3 → 09-01 (Step 0 + invariants)
- SC#4 → 09-03 (pasteableBlock)
- SC#5 → 09-05 (verify_tx_decode)
- SC#6 → 09-05 (get_tx_verification re-spec)
- SC#7 → 09-04 (dispatch allowlist)
- SC#8 → 09-05 (sessionTopicLast8)

---

## Dependency Graph

```
Wave 1 (A): 09-01 [SKILL-TEMPLATE bootstrap + sister repo, user checkpoint]
                |
                v
Wave 2 (B):  09-02   ∥   09-04
              (SHA pin)   (dispatch allowlist)
                |             |
                +------+------+
                       |
Wave 3 (C): 09-03 (get_verification_artifact, defers register-all carve to 09-05)
                       |
                       v
Wave 4 (D): 09-05 (verify_tx_decode + get_tx_verification re-spec + sessionTopicLast8 + register-all close-out for 09-03 + 09-05)
```

- No cycles
- No forward references
- 09-02 ∥ 09-04 file-touch overlap: both APPEND to `blocks.ts` + `error-codes.ts` — distinct end-of-file/end-of-union regions, trivial rebase
- 09-03's register-all deferral to 09-05 explicitly documented; 09-05 owns BOTH new imports

---

## FROZEN-area discipline (cross-cutting)

Every plan asserts zero diff to the 12-file FROZEN list:
- `src/signing/payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts`, `aave-health.ts`, `amount.ts`, `simulation.ts`
- `src/clients/etherscan.ts`, `fourbyte.ts`
- `src/protocols/aave-v3.ts`, `erc20.ts`, `weth9.ts`
- `src/tools/send_transaction.ts` three-gate region (Layer 3)

09-05 carries the only INTENTIONAL diff on `send_transaction.ts` (additive `sessionTopicLast8` at success-path structuredContent lines 524-530 — outside three-gate region). T-FROZEN-THREE-GATE-REGRESSION-1 anchor in `test/send-transaction.test.ts` (git-diff regex assertion limiting changes to additive line) enforces this at PR-review time.

Phase 8 Layer 2 region in `preview_send.ts:173-191` UNCHANGED in every plan. 09-04 Layer 0.5 lands BETWEEN handle-lookup (line 144-156 region) and Layer 2 (line 173-191); 09-05's success-path additive at lines 559-581 is a distinct region.

---

## Pre-locked design fork verification

- **DF-1 (sister-repo separate GH repo)** — honored: 09-01 ships `vaultpilot-preflight-skill` as a separate `gh repo create` user checkpoint; rationale documented in plan execution_context and PR template.
- **DF-2 (parallel CANONICAL_DISPATCH_TARGETS table)** — honored: 09-04 ships parallel table, NOT widening of `KNOWN_SPENDERS_ETHEREUM`; option (b) PARTIAL extends with BRIDGED_VARIANTS for Phase 6 ERC-20 compatibility.

Three planner-documented load-bearing decisions verified:
1. **09-02 Step 0 self-reference fix** — verified PASS. The 09-02 plan correctly identifies that "SHA-256 algorithm does NOT support circular-hash by construction" (line 437) and externalizes the EXPECTED_SKILL_SHA256 lookup to MCP `INSTRUCTIONS` + sister-repo `README.md`. The SKILL.md body never contains the SHA at the post-09-02 end state. See W-1 warning for transient broken state.
2. **09-04 option (b) PARTIAL (CANONICAL_DISPATCH_TARGETS consumes BRIDGED_VARIANTS)** — verified PASS. `BridgedVariant` interface confirmed to have `chainId` + `address` fields matching the plan's `.filter(v => v.chainId === chainId).map(v => v.address)` shape (verified against `src/tokens/bridged-variants.ts` lines 1-30).
3. **09-05 option (c) for amount comparison (WEI string discipline)** — verified PASS. Plan body line 535 LOCKS option (c): "agent passes WEI string in claimedDecode.args.amount"; tool DESCRIPTION names the discipline; per-action comparison logic compares WEI-to-WEI via `BigInt(claimedDecode.args.amount) === decoded.amountWei`. (NOTE: the plan's "Interfaces" sketch at line 317 still references `parseAmountStrict(amount, 18)` with a TODO marker — option (c) is the LOCKED decision per line 535 and the implementation_guidance overrides the sketch; the executor follows the LOCKED decision. See W-3 warning for cleanup recommendation.)

---

## Test-count plausibility

| Plan | Plan estimate | Prompt expected | Status |
|---|---|---|---|
| 09-01 | 5 | +5–10 | OK |
| 09-02 | 25 | +20–30 | OK |
| 09-03 | 18 | +15–25 | OK |
| 09-04 | 38 | +30–45 | OK (planner clarifies test count after option (b) PARTIAL ~20 additional BRIDGED_VARIANTS coverage assertions; on the upper end of range) |
| 09-05 | 35 | +25–40 | OK |

---

## STOP-THE-LINE invariant labels present

| Code | Plans referencing |
|---|---|
| T-FROZEN-SIGNING-1 | 09-01, 09-02, 09-03, 09-04, 09-05 |
| T-SKILL-SHA-PIN-1 | 09-02 |
| T-NOTICE-DEDUP-1 | 09-02 |
| T-DISPATCH-ALLOWLIST-1 | 09-04 |
| T-CANONICAL-DISPATCH-COVERAGE-1 | 09-04 |
| T-VERIFY-DECODE-3ARM-1 | 09-05 |
| T-DECODER-SINGLE-SOT-1 | 09-05 |
| T-SESSION-TOPIC-DRIFT-1 | 09-05 |
| T-ERC20-TOKEN-COMPATIBILITY-1 | 09-04 |

Cross-plan threats: T-COMPROMISED-MCP-1 (cross-plan defense-in-depth in 09-03 + 09-04 + 09-05); T-DISPATCH-MISMATCH-1 (09-04); T-DECODE-DIVERGENCE-1 + T-DECODE-UNSUPPORTED-1 (09-05); T-WC-TOPIC-DRIFT-1 (via T-SESSION-TOPIC-DRIFT-1).

---

## Sister-repo execute-time checkpoint

09-01 Task 0 is a `checkpoint:human-action` blocking gate. Execute parameters fully named:
- Repo name: `vaultpilot-preflight-skill`
- Owner: `szhygulin`
- Visibility: `private` (matches main)
- Description, license (MIT), initial branch (`main`) all specified

Resume signal documented (`proceed` / `change: <field>=<value>`). Per memory `feedback_auto_mode.md` compliance.

---

## Warnings (execute-time discipline)

### W-1 (warning) — Transient broken state across 09-01 → 09-02 boundary

**Dimension:** SHA-256 self-reference impossibility (13)
**Severity:** warning (execute-time discipline; not a goal-blocker)

**Description:** 09-01 ships `09-01-SKILL-TEMPLATE.md` + sister-repo `SKILL.md` containing the broken self-referential `EXPECTED_SKILL_SHA256 = `EXPECTED_SKILL_SHA256_PLACEHOLDER`` pattern in Step 0 body. 09-01's plan body itself (line 437) acknowledges the initial `v1.3.0` sister-repo tag CI WILL FAIL on the placeholder. 09-02 fixes Step 0 by removing the SKILL-internal SHA line and externalizing to MCP `INSTRUCTIONS` + README. The end state is correct, but between 09-01 merge and 09-02 merge:
- The sister-repo `v1.3.0` tag has known-broken CI
- Any user who clones during this window cannot reach a functional SKILL.md
- 09-01's accepted_residuals do call this out as intentional ("placeholder is a transient state, not a load-bearing artifact")

**Fix hint:** Two options:
- (a) Coordinate execute order: skip sister-repo v1.3.0 tag at 09-01, let 09-02 create the tag in one coordinated step (09-01 plan body line 426 already offers this as an alternative — "If the executor wants a green CI on initial push, they can SKIP the v1.3.0 tag at this time and have Plan 09-02's executor create+push the tag in a single coordinated step.")
- (b) Author the Step 0 externalization fix directly in 09-01-SKILL-TEMPLATE.md at 09-01 execute time (deviates from 09-01 plan body but produces a coherent v1.3.0 release on initial push)

Option (a) is recommended — the planner has already documented it as acceptable. Recommend executor takes option (a) and skips the v1.3.0 sister-repo tag at 09-01.

### W-2 (warning) — 09-03 register-all coordination prose

**Dimension:** Task completeness (3) + key links (4)
**Severity:** warning

**Description:** 09-03's `<implementation_guidance>` test-invocation section (line 312) initially says "since `get_verification_artifact` is NOT registered (Plan 09-05 owns the register-all line), tests can't use `getRegisteredTool`" then immediately self-corrects with "Correction: the register-all coordination is only for the BOOT-TIME import — at TEST time, `import "src/tools/get_verification_artifact.js"` in the test file triggers the side-effect `registerTool` call." The corrected understanding is technically sound (registration is at module-load side-effect, not register-all-dispatch), but the dual-statement prose in a single plan section is confusing. PR description text in done block also retains the "NOT routable via production MCP dispatch until Plan 09-05 lands" claim, which is correct for PRODUCTION but mismatches the test-invocation reality.

**Fix hint:** Cleanup at execute time — the executor should write a single coherent test-invocation paragraph in `test/get-verification-artifact.test.ts`'s file-header comment explaining that the tool IS registered at module-import side-effect time and the register-all carve is purely about production dispatch routing. Not blocking; cosmetic.

### W-3 (warning) — 09-05 amount-comparison sketch vs LOCKED decision drift

**Dimension:** Task completeness (3)
**Severity:** warning

**Description:** 09-05's `<interfaces>` section (line 317, 333, 344, 360, 376) shows code sketches using `parseAmountStrict(claimedDecode.args.amount, 18)` with a `/* TODO: per-token decimals if known */` comment. This is the SKETCH that predates the LOCKED option (c) decision documented at line 535 in `<implementation_guidance>`. The locked decision is "agent passes WEI string in claimedDecode.args.amount; compare WEI-to-WEI via `BigInt(claimedDecode.args.amount) === decoded.amountWei`". Tool DESCRIPTION (line 244) names the WEI-string discipline. The execute-time discipline is the LOCKED option (c), not the sketch. The drift between sketch and LOCKED decision risks an executor following the sketch literally and shipping the broken `parseAmountStrict(amount, 18)` approach (which would produce false divergences for non-18-decimal tokens like USDC/USDT/WBTC).

**Fix hint:** At execute time, the executor MUST follow line 535's LOCKED option (c) (WEI-string compare via `BigInt()`), NOT the sketch literals at lines 317/333/344/360/376. PR description recommend explicitly naming option (c) and the deviation from the sketch. The planner already calls this out in implementation_guidance line 535 — the executor is expected to read past the sketch to the LOCKED decision; flagging this as a warning because the sketch is the more visible/copyable surface in the plan.

---

## Inline cheap fixes applied

None applied at planning gate. All three warnings (W-1, W-2, W-3) are execute-time-discipline concerns that exceed the cheap-fix threshold (multi-line text edits OR architectural prose clarification). They are surfaced for the executor's PR-time attention rather than fixed inline here.

---

## Verdict

**Plans verified.** Phase 9 plan set delivers SEC-30 through SEC-38 with all 8 ROADMAP success criteria mapped. Dependency graph is acyclic and respects the LOCKED wave structure. FROZEN-area discipline holds across the 12-file list. Three documented load-bearing decisions (09-02 SHA externalization, 09-04 option (b) PARTIAL, 09-05 option (c) WEI-string) are correctly carried in the planning artifacts.

Three execution-time warnings (W-1 transient broken sister-repo state across 09-01 → 09-02; W-2 09-03 register-all prose cleanup; W-3 09-05 sketch-vs-locked-decision drift) require executor PR-time attention but do NOT block execution.

Run `/gsd-execute-phase 09` to proceed. Strongly recommend executor:
- For 09-01: take option (a) and SKIP v1.3.0 sister-repo tag at 09-01; coordinate the tag with 09-02
- For 09-03: write a single coherent test-invocation header comment
- For 09-05: follow LOCKED option (c) (WEI-string compare), NOT the `parseAmountStrict(amount, 18)` sketch
