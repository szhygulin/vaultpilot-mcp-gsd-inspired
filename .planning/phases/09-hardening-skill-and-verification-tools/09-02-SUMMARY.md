---
phase: 09
plan: 02
subsystem: src/security/skill-integrity.ts SHA-256 lazy probe + VAULTPILOT NOTICE dispatcher-wrap + Step 0 self-reference fix + sister-repo v1.3.0 coordinated release
tags: [skill-integrity, sec-31, sha-256, lazy-probe, dispatcher-wrap, notice-dedup, external-sot, instructions-surfacing, sister-repo-tag, v1.3.0, phase-9, wave-2]
requirements: [SEC-31]
wave: 2
status: complete
completed: 2026-05-18
sister-repo:
  url: "https://github.com/szhygulin/vaultpilot-preflight-skill"
  visibility: "private"
  default-branch: "main"
  release-commit: "9d5a306"
  tag: "v1.3.0"
  tag-ref-sha: "09a41f08c8847715206b70206633c60c6fe8e478"
  skill-md-sha256: "28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2"
  smoke-test-status: "PASS (test/sha256.sh — README documented SHA matches SKILL.md actual SHA)"
expected-skill-sha256: "28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2"
dependency-graph:
  requires:
    - "Plan 09-01 (sister-repo bootstrap; placeholder-state SKILL.md at SHA fd15cd8c…; tag v1.3.0 deferred per plan-checker W-1)"
  provides:
    - "src/security/skill-integrity.ts — EXPECTED_SKILL_SHA256 constant + PROBE_PATHS (personal + project scope) + SkillIntegrityState 3-arm union + lazy-memoized checkSkillIntegrity + dedup-per-session consumeSkillIntegrityNotice + _skillIntegrity ESM spy-affordance + _resetSkillIntegrityForTesting hook"
    - "src/server.ts dispatcher-wrap — first-dispatch lazy probe + VAULTPILOT NOTICE prepend on missing/tampered state; dedup-per-session via noticeEmitted flag in skill-integrity.ts; mirror of auto-demo NOTICE wrap shape; ordering LOCKED (auto-demo first, skill second per PATTERNS.md § 2 line 200)"
    - "src/server.ts INSTRUCTIONS extension — `vaultpilot-preflight skill v1.3.0 expected SHA-256: ${EXPECTED_SKILL_SHA256}` line surfaced to the agent at MCP initialize handshake; this is one of TWO external SOTs for the skill's Step 0 self-check (the other being sister-repo README)"
    - "src/signing/blocks.ts +2 templates — VAULTPILOT_NOTICE_TEMPLATE_MISSING + VAULTPILOT_NOTICE_TEMPLATE_TAMPERED (APPEND-ONLY; existing 9+ templates byte-frozen including Plan 08-02 CHAIN_ID_MISMATCH_REFUSAL + Plan 08-04 SET_LEVEL_ENUMERATION)"
    - "src/signing/error-codes.ts +1 code — SKILL_INTEGRITY_FAILURE (16 → 17 codes; not emitted as refusal — surfaces via NOTICE prepend; producer-map comment extended)"
    - "src/tools/get_vaultpilot_config_status.ts +1 field — skillIntegrity (secret-safe; ok arm carries sha256, missing arm carries kind only, tampered arm carries kind+path only; computed+expected NEVER surfaced)"
    - "Sister-repo szhygulin/vaultpilot-preflight-skill v1.3.0 tag (annotated; ref SHA 09a41f08…; SKILL.md byte-identical to post-Step-0-fix planning template; README documents EXPECTED_SKILL_SHA256 verbatim; smoke test green)"
  affects:
    - ".planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md (MODIFIED — Step 0 self-reference fix; externalized EXPECTED_SKILL_SHA256 lookup to MCP INSTRUCTIONS + README; SKILL.md body NEVER contains the SHA — avoids circular-hash by construction)"
    - "test/server-dispatcher-wrap.test.ts (MODIFIED — beforeEach now stubs _skillIntegrity to OK so legacy auto-demo dedup tests aren't contaminated by the new skill-NOTICE dispatcher-wrap; the legacy tests assert auto-demo dedup in isolation; dedicated skill-NOTICE coverage lives in test/server.skill-notice.test.ts)"
    - "test/get-vaultpilot-config-status.test.ts (EXTENDED — Tests 39-41 cover 3 arms of skillIntegrity field with secret-safety substring scan)"
  unblocks:
    - "Plan 09-03 (get_verification_artifact tool) — independent surface; no coupling to skill-integrity"
    - "Plan 09-04 (canonical-dispatch.ts + verify_tx_decode) — parallel-eligible with this plan; both add APPEND-ONLY entries to blocks.ts + error-codes.ts (zero source-line collision); skill-integrity probe is now available for any downstream tool that wants to gate on skill presence"
    - "Plan 09-05 (get_tx_verification + session-topic-last8 surfacing) — independent additive surfaces"
    - "v1.3 release coordination — sister-repo v1.3.0 tag is the canonical install pin; main-repo `EXPECTED_SKILL_SHA256` constant is byte-equal to the tagged SKILL.md's SHA"
    - "Future tampered-skill-version warnings — the NOTICE infrastructure (template + dedup helper + dispatcher-wrap) is reusable; bumping EXPECTED_SKILL_SHA256 to a new release just requires updating the constant + re-running the sister-repo coordinated step"
tech-stack:
  added: []
  patterns:
    - "Lazy-on-first-dispatch IO (RESEARCH § Topic 3 Pitfall + Phase 5 retro) — checkSkillIntegrity fires on the first tool dispatch of the session, NOT at server boot. Boot-time IO blocks the MCP `initialize` handshake. Mirror of src/diagnostics/update-check.ts::runUpdateCheckOnce — module-scoped flag + memoization."
    - "Dedup-per-session NOTICE emission (race-defense) — `noticeEmitted` flag set BEFORE returning the template (Pitfall 4 mitigation per src/diagnostics/notice.ts:48). Two concurrent first-dispatches cannot both emit; Node's single-threaded event loop + synchronous read-and-set means exactly one wins. Test 10 in test/security-skill-integrity.test.ts locks this with Promise.all of 5 concurrent calls (exactly one returns the template, four return null)."
    - "ESM spy-affordance indirection per CLAUDE.md § Conventions — `_skillIntegrity = { checkSkillIntegrity }` indirection lets `vi.spyOn(_skillIntegrity, 'checkSkillIntegrity')` intercept production callsites. Direct spy on the named export would be a no-op (ESM named-export bindings are immutable). Tests 4 + 5 + 11 in test/security-skill-integrity.test.ts use the spy seam; tests in test/server.skill-notice.test.ts stub the entire probe via this indirection to inject ok/missing/tampered states without real IO."
    - "Dispatcher-wrap ordering LOCK (PATTERNS.md § 2 line 200) — auto-demo NOTICE fires FIRST (existing behavior; install-state announcement; higher salience on a brand-new install); skill-integrity NOTICE fires SECOND. A session triggering BOTH sees auto-demo on dispatch #1 and skill on dispatch #2 — each is single-emission. Test 5 in test/server.skill-notice.test.ts locks this property end-to-end."
    - "External-source-of-truth discipline for SHA pinning — SHA-256 cannot self-reference by construction (any value embedded inside the hashed file alters the file's own SHA, breaking the check). The pinned SHA lives OUTSIDE the hashed SKILL.md in TWO independent locations: (a) MCP `INSTRUCTIONS` field (server-side pin, surfaced at initialize) and (b) sister-repo README integrity-check section (release-side pin). The skill's Step 0 self-check looks up EITHER — defense-in-depth across two surfaces. THIS IS A LOAD-BEARING DEVIATION from Plan 09-01's original placeholder-fixpoint plan; documented in plan body's <implementation_guidance> as planning-time correction."
    - "Secret-safe diagnostic surfacing (Q-CONFIG-LEAK lineage) — skillIntegrity field on get_vaultpilot_config_status carries `kind` always, `path` on found arms, `sha256` on ok arm only. NEVER carries `computed`/`expected` on tampered arm (those internal-only bytes surface via the VAULTPILOT NOTICE dispatcher block at dispatch time, not via this tool). Test 41 in test/get-vaultpilot-config-status.test.ts asserts secret-safety via JSON.stringify substring scan against a unique sentinel."
    - "APPEND-ONLY discipline on shared format-fanout-sentinel files — src/signing/blocks.ts (Phase 4/6/7/08-02/08-04 templates byte-frozen; Plan 09-02 appends 2 templates at end-of-file); src/signing/error-codes.ts (Phase 4/5/05-01/08-02 codes byte-frozen; Plan 09-02 appends 1 code at end-of-union). Zero source-line collision with Plan 09-04 (which appends to the same two files in distinct end-of-file regions) — trivial rebase if both branches push concurrently."
key-files:
  created:
    - "src/security/skill-integrity.ts (NEW — 158 lines; the SHA-256 lazy probe module)"
    - "test/security-skill-integrity.test.ts (NEW — 12 cases; T-SKILL-SHA-PIN-1 + T-SKILL-MISSING-1 + T-NOTICE-DEDUP-1 anchors)"
    - "test/server.skill-notice.test.ts (NEW — 6 cases; dispatcher-wrap behavior end-to-end + ordering with auto-demo NOTICE)"
    - ".planning/phases/09-hardening-skill-and-verification-tools/09-02-SUMMARY.md (NEW — this file)"
  modified:
    - "src/server.ts (+27 lines — skill-integrity import + INSTRUCTIONS extension line + dispatcher-wrap appended after auto-demo NOTICE wrap; pre-existing auto-demo wrap byte-frozen)"
    - "src/signing/blocks.ts (+66 lines — APPEND-ONLY: VAULTPILOT_NOTICE_TEMPLATE_MISSING + VAULTPILOT_NOTICE_TEMPLATE_TAMPERED; existing 9+ templates byte-frozen)"
    - "src/signing/error-codes.ts (+12 lines — APPEND-ONLY: SKILL_INTEGRITY_FAILURE in ErrorCode union; producer-map comment extended)"
    - "src/tools/get_vaultpilot_config_status.ts (+46 lines — additive skillIntegrity field + summarizeSkillIntegrity secret-safe helper + DESCRIPTION extension)"
    - ".planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md (Step 0 self-reference fix — externalized EXPECTED_SKILL_SHA256 lookup; +21/-10 lines)"
    - "test/server-dispatcher-wrap.test.ts (+21 lines — stub _skillIntegrity to OK in beforeEach + reset in afterEach to isolate legacy auto-demo tests from the new skill-NOTICE wrap)"
    - "test/get-vaultpilot-config-status.test.ts (+106 lines — Tests 39-41 cover 3 arms of skillIntegrity field with secret-safety substring scan)"
  sister-repo-modified:
    - "vaultpilot-preflight-skill/SKILL.md (REPLACED — byte-identical to post-Step-0-fix planning template; SHA-256 fd15cd8c… → 28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2)"
    - "vaultpilot-preflight-skill/README.md (substituted EXPECTED_SKILL_SHA256_PLACEHOLDER → 28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2 + clarifying paragraph naming the dual-source-of-truth discipline)"
  sister-repo-created:
    - "vaultpilot-preflight-skill v1.3.0 annotated tag (commit 9d5a306; ref SHA 09a41f08c8847715206b70206633c60c6fe8e478; SKILL.md SHA 28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2)"
decisions:
  - "**Step 0 self-reference fix is LOAD-BEARING — externalized the SHA lookup to MCP INSTRUCTIONS + sister-repo README.** Plan 09-01 shipped SKILL.md with `EXPECTED_SKILL_SHA256 = \\`EXPECTED_SKILL_SHA256_PLACEHOLDER\\`` literally inside Step 0 narrative. Substituting the SHA-of-the-file INTO the file changes the file's bytes → changes the SHA → breaks the check by construction. SHA-256 has no fixpoint by avalanche property; the placeholder-fixpoint algorithm in Plan 09-01's spec does NOT converge for cryptographic hashes. Plan 09-02 corrects this by externalizing the EXPECTED_SKILL_SHA256 lookup to (a) MCP `instructions` field (template-literal interpolation surfaces the live constant value to the agent at initialize time) and (b) sister-repo README integrity-check section (release-side pin, kept in sync via coordinated bump). The SKILL.md body itself NEVER contains the SHA — a stable template that the smoke test + the MCP probe both hash to the same value (28d47f34d74…) without circular dependency. This is a DEVIATION from Plan 09-01's spec but the spec was unrealizable as written; the planner anticipated the correction (Plan 09-02 plan body's <implementation_guidance> explicitly walks through the fixpoint-non-convergence analysis and prescribes this exact fix)."
  - "**EXPECTED_SKILL_SHA256 single-SOT discipline: 1 src file, not 2.** Plan 09-02's success criteria + `<verify>` block expected `grep -rl <hex> src/ | wc -l == 2` (constant in skill-integrity.ts + INSTRUCTIONS interpolation in server.ts). At execute time, the literal hex appears in EXACTLY 1 src file — server.ts uses `${EXPECTED_SKILL_SHA256}` template-literal interpolation which does NOT embed the hex literal at the source level (it's evaluated at runtime). This is technically STRONGER single-SOT than the plan expected: any change to the constant propagates automatically without a source-level change to server.ts. Test 12 in test/security-skill-integrity.test.ts asserts exactly 1 file. The plan body's `<accepted_residuals>` section noted this nuance ('appears in 2 files via interpolation, not 2 literal declarations') — execute-time reality is even cleaner (1 file). No source-side coordination needed when bumping the SHA."
  - "**Stubbed _skillIntegrity to OK in legacy server-dispatcher-wrap.test.ts beforeEach.** The pre-existing test file at test/server-dispatcher-wrap.test.ts asserts auto-demo NOTICE dedup behavior in isolation (Tests 1-2 specifically assert 'NOTICE prepended on first response' / 'NOTICE NOT prepended on second response'). Without intervention, the new skill-NOTICE dispatcher-wrap would emit a missing-skill NOTICE on Test 2's second dispatch (no SKILL.md in the test environment's HOME), breaking the legacy assertion. Resolved by stubbing _skillIntegrity.checkSkillIntegrity to return ok in beforeEach + reset in afterEach. This is a Rule 1 (auto-fix bug) — test crosstalk caused by my new production behavior, not a real regression in the auto-demo wrap. The dedicated coverage for skill-NOTICE behavior lives in the new test/server.skill-notice.test.ts (6 cases) — separation-of-concerns preserved."
  - "**Sister-repo v1.3.0 is an ANNOTATED tag (not lightweight).** The plan's `<action>` step 12 said `git tag --force v1.3.0 && git push origin main --tags --force-with-lease`. At execute time, v1.3.0 did NOT exist yet (Plan 09-01's `<deferred>` skipped tag creation per plan-checker W-1), so `--force` was unnecessary. Created as an annotated tag with `-m \"v1.3.0 — companion skill for vaultpilot-mcp v1.3.0 (SEC-31 + SEC-32 + SEC-33). EXPECTED_SKILL_SHA256: 28d47f34…\"` for traceability + GitHub UI rendering of the tag message. Pushed via `git push origin v1.3.0` (single-tag push, not `--tags` blanket). Tag ref SHA: 09a41f08c8847715206b70206633c60c6fe8e478."
  - "**Test 4 memoization assertion uses filesystem-mutation behavioral check, not vi.spyOn(fsp, 'readFile').** Initial draft used `vi.spyOn(fsp, 'readFile')` to count IO calls between the first and second checkSkillIntegrity invocations. `vitest` raised `TypeError: Cannot redefine property: readFile` — Node's `fs/promises` named exports are non-configurable bindings that vitest cannot monkey-patch. Rewrote to a behavioral assertion: install the SOT (ok state), mutate the file between calls (byte-flip → would change SHA → would surface as tampered if IO re-ran), assert second call returns same object reference AND still reports ok. The behavioral check is STRONGER than the call-count check — it tests the observable consequence of memoization (no fresh IO observed), not the implementation detail (number of readFile invocations). Same root cause for the homedir stub: switched from `vi.spyOn(os, 'homedir')` (same TypeError) to `process.env.HOME = tmpDir` (Node `os.homedir()` honors HOME on POSIX). Both fixes follow the principle from CLAUDE.md § ESM-spy-affordance: when the export binding can't be redefined, use the seam that IS configurable (env var, behavioral check)."
metrics:
  duration: "~30 minutes (single execution wave; one rework on tests — vi.spyOn(node:os/node:fs-promises) TypeError caught at first npm test run; resolved with env-var stub + behavioral memoization check)"
  completed: 2026-05-18
  tasks_completed: 1
  files_created: 4
  files_modified: 7
  files_deleted: 0
  sister_repo_files_modified: 2
  sister_repo_tags_created: 1
  tests_before: 789
  tests_after: 810
  tests_delta: 21
  loc_delta: "+1148/-15 in main repo (one atomic commit d77e51c); +40/-14 in sister repo (one commit 9d5a306 + v1.3.0 tag)"
---

# Phase 9 Plan 02: `src/security/skill-integrity.ts` SHA-256 Pin + `VAULTPILOT NOTICE` Dispatcher-Wrap + Step 0 Self-Reference Fix + Sister-Repo v1.3.0 Coordinated Release Summary

Wave 2 of Phase 9 — second plan of the Hardening + Companion Skill + Verification Tools milestone. Closes SEC-31 (Server pins skill SHA-256 in `instructions`; on every signing flow the agent is instructed to `sha256sum` the skill and confirm match). Ships the MCP-side half of the defense-in-depth pair: lazy first-dispatch SHA-256 probe + dedup-per-session NOTICE prepend on missing/tampered skill + INSTRUCTIONS-field surfacing of the pinned hex. Resolves plan-checker W-1 (sister-repo v1.3.0 tag deferral from Plan 09-01) by creating + pushing the v1.3.0 tag in a coordinated step with the main-repo MCP constant landing. Cryptographic-binding chain BYTE-FROZEN (FROZEN 12-file list zero-diff).

## What Shipped

### 1. `src/security/skill-integrity.ts` (NEW — 158 lines)

```typescript
export const EXPECTED_SKILL_SHA256 =
  "28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2";

const PROBE_PATHS: ReadonlyArray<() => string> = [
  () => join(homedir(), ".claude", "skills", "vaultpilot-preflight", "SKILL.md"),
  () => join(process.cwd(), ".claude", "skills", "vaultpilot-preflight", "SKILL.md"),
] as const;

export type SkillIntegrityState =
  | { kind: "ok"; path: string; sha256: string }
  | { kind: "missing"; pathsProbed: string[] }
  | { kind: "tampered"; path: string; computed: string; expected: string };

export async function checkSkillIntegrity(): Promise<SkillIntegrityState> { ... }
export const _skillIntegrity = { checkSkillIntegrity };
export function consumeSkillIntegrityNotice(state): string | null { ... }
export function _resetSkillIntegrityForTesting(): void { ... }
```

- **`EXPECTED_SKILL_SHA256`** — pinned at `28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2` (the SHA-256 of `.planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md` after Step 0 self-reference fix). Single-SOT in `src/`; `server.ts` surfaces it via template-literal interpolation (no literal duplication).
- **Lazy-on-first-dispatch** — boot-time IO blocks `initialize` handshake per Phase 5 retro. `cachedState` memoizes for the life of the process.
- **`consumeSkillIntegrityNotice`** sets `noticeEmitted = true` BEFORE returning the template (Pitfall 4 race-mitigation; mirror of `src/diagnostics/notice.ts:48`). Two concurrent dispatches cannot both emit.
- **`_skillIntegrity` ESM spy-affordance** per CLAUDE.md § Conventions — production callers (`server.ts`, `get_vaultpilot_config_status.ts`) route through this object so tests can `vi.spyOn` the indirection.
- **`_resetSkillIntegrityForTesting`** clears both `cachedState` AND `noticeEmitted` for cross-test isolation.

### 2. `src/server.ts` — dispatcher-wrap + INSTRUCTIONS extension

NEW import (after the existing `consumeAutoDemoNotice` import):

```typescript
import {
  EXPECTED_SKILL_SHA256,
  _skillIntegrity,
  consumeSkillIntegrityNotice,
} from "./security/skill-integrity.js";
```

INSTRUCTIONS array extended with ONE new line surfacing the pinned SHA via template-literal interpolation:

```typescript
`vaultpilot-preflight skill v1.3.0 expected SHA-256: ${EXPECTED_SKILL_SHA256} (install: git clone https://github.com/szhygulin/vaultpilot-preflight-skill ~/.claude/skills/vaultpilot-preflight && cd ~/.claude/skills/vaultpilot-preflight && git checkout v1.3.0).`
```

Dispatcher-wrap appended AFTER the existing auto-demo NOTICE block (byte-frozen at lines 142-162) and BEFORE the final `return result;` — mirrors auto-demo wrap shape verbatim:

```typescript
const integrityState = await _skillIntegrity.checkSkillIntegrity();
const skillNotice = consumeSkillIntegrityNotice(integrityState);
if (skillNotice !== null) {
  return {
    ...result,
    content: [{ type: "text" as const, text: skillNotice }, ...result.content],
  };
}
return result;
```

Ordering LOCKED per PATTERNS.md § 2 line 200: auto-demo NOTICE fires FIRST; skill NOTICE fires SECOND. A session triggering both emits auto-demo on dispatch #1 (the auto-demo wrap returns early, skipping the skill wrap on that response) and skill on dispatch #2.

### 3. `src/signing/blocks.ts` (APPEND-ONLY, +66 lines)

`VAULTPILOT_NOTICE_TEMPLATE_MISSING` (slot: `{PATHS}` — newline-indented list of probed paths):

```
VAULTPILOT NOTICE — vaultpilot-preflight skill not installed
  The companion preflight skill is not installed at any of:
    {PATHS}
  Without the skill, defense-in-depth against a compromised-MCP scenario is
  reduced to MCP-side checks only (the trust anchor remains the Ledger device
  screen). To install:
    git clone https://github.com/szhygulin/vaultpilot-preflight-skill ~/.claude/skills/vaultpilot-preflight
    cd ~/.claude/skills/vaultpilot-preflight && git checkout v1.3.0
  See ./SECURITY.md for the full residual-risk model.
```

`VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` (slots: `{PATH}`, `{COMPUTED}`, `{EXPECTED}`):

```
VAULTPILOT NOTICE — vaultpilot-preflight skill integrity mismatch
  Skill at: {PATH}
  Computed SHA-256: {COMPUTED}
  Expected SHA-256: {EXPECTED}
  The skill content differs from the version this MCP build pins. Either:
    (a) the skill was tampered with locally — re-clone or reset to the pinned tag
    (b) you have a newer skill version than this MCP — upgrade vaultpilot-mcp
    (c) you have an older skill version than this MCP — git checkout v1.3.0 in
        ~/.claude/skills/vaultpilot-preflight
  Until resolved, treat skill output as untrusted (the Ledger device screen
  remains the trust anchor; the skill is defense-in-depth).
```

Existing 9+ templates BYTE-FROZEN (verified by per-template grep).

### 4. `src/signing/error-codes.ts` (APPEND-ONLY, +12 lines)

`ErrorCode` union extended from 16 → 17 entries:

```typescript
export type ErrorCode =
  | "WALLET_NOT_PAIRED"
  | ... // 14 existing codes byte-frozen
  | "CHAIN_ID_MISMATCH"
  | "SKILL_INTEGRITY_FAILURE";  // Phase 9 Plan 09-02
```

NOT emitted as a refusal envelope — surfaces via the VAULTPILOT NOTICE prepend. The code exists for the diagnostics surface + future skill-side test scaffolding. Producer-map comment extended naming Plan 09-02 + the `(NOT emitted as refusal — surfaces via VAULTPILOT NOTICE prepend)` clarification.

### 5. `src/tools/get_vaultpilot_config_status.ts` (+46 lines, additive)

NEW `skillIntegrity` field on structuredContent with secret-safe summarizer:

```typescript
type SkillIntegritySummary =
  | { kind: "ok"; path: string; sha256: string }
  | { kind: "missing" }
  | { kind: "tampered"; path: string };
```

Secret-safety contract:
- `ok` arm: surfaces `path` + `sha256` (the pinned hex is public-by-design per T-INSTRUCTIONS-FIELD-LEAK-1 accept; documented in the README + the INSTRUCTIONS field).
- `missing` arm: surfaces `kind` only — `pathsProbed` is NOT surfaced (user runs `ls ~/.claude/skills/` to diagnose paths).
- `tampered` arm: surfaces `kind` + `path` only — `computed` + `expected` are NOT surfaced (those internal-only bytes appear in the VAULTPILOT NOTICE dispatcher block at dispatch time, not on this diagnostic surface).

DESCRIPTION extended naming the new field + secret-safety semantics so a routing agent finds the tool for `is the vaultpilot-preflight companion skill installed and intact?`.

### 6. `.planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md` (Step 0 self-reference fix)

The original Step 0 narrative embedded `EXPECTED_SKILL_SHA256 = \`EXPECTED_SKILL_SHA256_PLACEHOLDER\`` inside the file Plan 09-02's fixpoint algorithm was supposed to hash. SHA-256 has no fixpoint by avalanche property; the placeholder-fixpoint algorithm does NOT converge.

Rewritten Step 0 instructs the agent to look up `EXPECTED_SKILL_SHA256` from EITHER of two external sources of truth:

```markdown
2. Look up the EXPECTED_SKILL_SHA256 from EITHER of these external sources of truth
   (do NOT trust any value embedded inside this file — a SHA cannot self-reference
   by construction; the SHA lives OUTSIDE the hashed content):

   - **vaultpilot-mcp's MCP `initialize` response `instructions` field** — the
     server pins the expected SHA at build time and surfaces it verbatim. Look
     for the line `vaultpilot-preflight skill v1.3.x expected SHA-256: <hex>`.
   - **The sister repo's README.md "Expected SHA-256" section** — ...
```

Trust model: defense-in-depth across THREE independent surfaces — (a) MCP-side INSTRUCTIONS pin (the format-fanout-sentinel constant), (b) sister-repo README pin (the release-side documentation), (c) MCP-side runtime SHA computation against the locally-installed SKILL.md (the dispatcher-wrap VAULTPILOT NOTICE block). A tampered SKILL.md is caught by (c); a tampered MCP that lies about the constant is caught by cross-checking against (b); a tampered README is caught by (a) and (c).

### 7. Sister-repo coordinated v1.3.0 release

In `/tmp/vaultpilot-preflight-skill-bootstrap/` (the Plan 09-01 bootstrap clone, preserved):

```bash
# 1. Replace SKILL.md byte-identically with the post-Step-0-fix planning template
cp /Users/s/dev/vaultpilot/vaultpilot-mcp-gsd-inspired/.claude/worktrees/feat-09-02-skill-integrity-pin-and-vaultpilot-notice/.planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md SKILL.md
shasum -a 256 SKILL.md
# 28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2  SKILL.md  ✓

# 2. Substitute README placeholder with real hex + add clarifying paragraph
sed -i.bak 's/EXPECTED_SKILL_SHA256_PLACEHOLDER/28d47f34.../g' README.md

# 3. Verify sister-repo CI smoke test
bash test/sha256.sh
# OK: SKILL.md SHA-256 matches README.md (28d47f34...)  ✓

# 4. Commit + push + tag
git add SKILL.md README.md
git commit -m "release: v1.3.0 — SHA-256 pin substitution (closes Plan 09-02 loop) ..."
# [main 9d5a306] release: v1.3.0 ...
git push origin main
# 03a6b24..9d5a306  main -> main

git tag v1.3.0 -m "v1.3.0 — companion skill for vaultpilot-mcp v1.3.0 ..."
git push origin v1.3.0
# * [new tag]         v1.3.0 -> v1.3.0

gh api repos/szhygulin/vaultpilot-preflight-skill/git/refs/tags/v1.3.0 --jq '.object.sha'
# 09a41f08c8847715206b70206633c60c6fe8e478
```

Sister-repo state post-release:
- `main` at `9d5a306` (release commit)
- `v1.3.0` annotated tag pointing at `9d5a306`; tag ref SHA `09a41f08c8847715206b70206633c60c6fe8e478`
- `SKILL.md` SHA-256: `28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2` (= main-repo `EXPECTED_SKILL_SHA256` = planning-template SHA)
- `README.md` `Expected SHA-256:` line: same hex (smoke test green)

## Test Trajectory

| Stage | Test count | Notes |
|-------|-----------|-------|
| Phase 9 baseline (post-Plan 09-01 merge, HEAD f1df318) | 789 | All passing |
| Plan 09-02 add 12 cases in test/security-skill-integrity.test.ts | 801 | All passing |
| Plan 09-02 add 6 cases in test/server.skill-notice.test.ts | 807 | All passing |
| Plan 09-02 add 3 cases in test/get-vaultpilot-config-status.test.ts | **810** | All passing |

`+21 net` (12 + 6 + 3 = 21). `npm run typecheck` clean (no output). `npm run build` clean (no output).

## Cryptographic-Binding Chain — BYTE-FROZEN

```bash
git diff origin/main -- \
  src/signing/payload-fingerprint.ts \
  src/signing/presign-hash.ts \
  src/signing/handle-store.ts \
  src/tools/send_transaction.ts \
  src/clients/etherscan.ts \
  src/clients/fourbyte.ts \
  src/protocols/aave-v3.ts \
  src/protocols/erc20.ts \
  src/protocols/weth9.ts \
  src/signing/aave-health.ts \
  src/signing/amount.ts \
  src/signing/simulation.ts | wc -l
#        0
```

12-file FROZEN list zero-diff. Plan 09-02 touches only the dispatcher-wrap region of `server.ts` + APPEND-ONLY regions of `blocks.ts` + `error-codes.ts` + an additive field on `get_vaultpilot_config_status.ts` + a new `src/security/` module. Phase 8 Layer 2 chain-mismatch region in `preview_send.ts:173-191` UNCHANGED (Plan 09-02 doesn't touch preview_send.ts).

## EXPECTED_SKILL_SHA256 Single-SOT

```bash
grep -rl "28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2" src/
# src/security/skill-integrity.ts
```

Exactly 1 src file. The `src/server.ts` INSTRUCTIONS line uses `${EXPECTED_SKILL_SHA256}` template-literal interpolation — no literal hex in the source. STRONGER single-SOT than the plan's `<verify>` block expected (`wc -l == 2`); any change to the constant propagates automatically without a source-side change to `server.ts`. Test 12 in `test/security-skill-integrity.test.ts` asserts exactly 1 file.

## Trust Boundaries Closed

| Boundary | Status | How |
|----------|--------|-----|
| MCP build → `EXPECTED_SKILL_SHA256` constant (src/security/skill-integrity.ts) | ✅ | Pinned hex literal; format-fanout-sentinel SOT |
| MCP build → MCP `INSTRUCTIONS` field (initialize handshake) | ✅ | Template-literal interpolation surfaces the live constant to the agent at session start |
| MCP build → sister-repo README integrity-check section | ✅ scaffolded | README substituted with real hex + clarifying paragraph; coordinated bump on each tagged release |
| `~/.claude/skills/vaultpilot-preflight/SKILL.md` → MCP server lazy probe | ✅ | First-dispatch `readFile` + SHA-256 + compare against pinned constant; missing/tampered → NOTICE block prepended; OK → no NOTICE |
| Dispatcher-wrap → `VAULTPILOT NOTICE` prepend | ✅ | Dedup-per-session via `noticeEmitted` flag set BEFORE return (race-defense); single emission across N dispatches |
| `_skillIntegrity` → `get_vaultpilot_config_status.skillIntegrity` (diagnostic surface) | ✅ | Secret-safe summarizer strips computed/expected/pathsProbed; user sees `kind` + `path` (on found arms) + `sha256` (on ok arm) only |
| Sister-repo SKILL.md → `v1.3.0` tag | ✅ | Annotated tag pushed (commit 9d5a306; ref SHA 09a41f08…); users install via `git checkout v1.3.0`; smoke test green |

## Threat Register — Mitigations Asserted

| ID | Severity | Status | How asserted |
|----|----------|--------|--------------|
| **T-SKILL-TAMPER-1** | high | ✅ asserted | Tampered SKILL.md detected by `checkSkillIntegrity` → `kind: tampered` → NOTICE prepended. `test/security-skill-integrity.test.ts` Test 3 (byte-flipped fixture, SHA mismatch confirmed) + `test/server.skill-notice.test.ts` Test 3 (dispatcher-wrap emits NOTICE with PATH/COMPUTED/EXPECTED slots substituted). Pairs with Plan 09-01's Step 0 self-check (defense-in-depth across MCP + agent layers). |
| **T-SKILL-MISSING-1** | medium | ✅ asserted | No SKILL.md at any probe path → `kind: missing` → NOTICE prepended with install one-liner. `test/security-skill-integrity.test.ts` Test 2 (empty tmpDir, both probe paths ENOENT) + `test/server.skill-notice.test.ts` Test 2 (dispatcher-wrap emits NOTICE on dispatch #1; dedup verified on dispatch #2). |
| **T-NOTICE-DEDUP-1** | high | ✅ asserted | Module-scoped `noticeEmitted` flag set BEFORE return; two consecutive non-OK calls → first returns string, second returns null. `test/security-skill-integrity.test.ts` Test 9 + race-defense Test 10 (`Promise.all` of 5 concurrent calls → exactly 1 template-hit, 4 null). End-to-end Test 2 in `test/server.skill-notice.test.ts` (dispatch #2 has no NOTICE). |
| **T-SKILL-SHA-PIN-1** | high | ✅ asserted | Node `crypto.createHash('sha256')` standard-library primitive; sanity-checked against independent computation in Test 3 (`crypto.createHash('sha256').update(flipped).digest('hex') === state.computed`). Single-SOT discipline locked by Test 12. |
| **T-SKILL-PROBE-PATH-LEAK-1** | low | accepted | Probe paths are `homedir()/.claude/skills/...` (universally known) + `cwd()/.claude/skills/...` (the user's project, which they're already in). Neither is a secret. NOTICE block surfaces them so the user can self-diagnose. |
| **T-INSTRUCTIONS-FIELD-LEAK-1** | low | accepted | EXPECTED_SKILL_SHA256 in INSTRUCTIONS is PUBLIC-BY-DESIGN: the README documents it, the sister-repo tag's content's SHA IS the value, the agent needs it for Step 0 self-check. Not a secret. |
| **T-FROZEN-SIGNING-1 (STOP-THE-LINE)** | high | ✅ asserted | 12-file FROZEN list zero-diff via `git diff origin/main -- ... | wc -l == 0`. |
| **T-DIAGNOSTIC-SECRET-LEAK-1** | medium | ✅ asserted | Test 41 in `test/get-vaultpilot-config-status.test.ts` substring-scans the entire serialized response against a unique sentinel (`abad1dea…`) in the tampered arm's `computed` field; asserts NEVER appears in either `structuredContent` or `content[0].text`. The summarizer strips `computed`/`expected`/`pathsProbed` before they reach the response envelope. |

## Hand-off to Plans 09-03 / 09-04 / 09-05

**Plan 09-03 (`get_verification_artifact` tool)**: independent surface; no coupling to skill-integrity. The skill-integrity probe is now AVAILABLE for any downstream tool that wants to gate on skill presence (call `_skillIntegrity.checkSkillIntegrity()` — memoized at near-zero cost beyond the session-wide first call).

**Plan 09-04 (`canonical-dispatch.ts` + `verify_tx_decode`)**: parallel-eligible with this plan (Wave B). Both add APPEND-ONLY entries to `src/signing/blocks.ts` (09-02 added 2 templates; 09-04 will add `DISPATCH_TARGET_REFUSAL_TEMPLATE`) + `src/signing/error-codes.ts` (09-02 added `SKILL_INTEGRITY_FAILURE`; 09-04 will add `DISPATCH_TARGET_REFUSED`). Distinct end-of-file regions — zero source-line collision; trivial rebase if both push concurrently. Plan 09-04 can land independently on a separate feature branch off `origin/main`.

**Plan 09-05 (`get_tx_verification` + session-topic-last8 surfacing)**: independent additive surfaces; no coupling. The PATTERNS.md § 2 dispatcher-wrap ordering (auto-demo → skill → ?) is now established — any future NOTICE-style block Plan 09-05 might add would slot in AFTER the skill-integrity wrap (or before, depending on salience trade-off; document in 09-05 plan body).

**Future skill bumps (v1.3.1+)**: update `EXPECTED_SKILL_SHA256` constant (single-SOT in `src/security/skill-integrity.ts`); re-run sister-repo coordinated step (replace SKILL.md byte-identically; substitute README; tag the new version; push). The dispatcher-wrap + NOTICE template infrastructure is reusable — no code changes required to bump a version.

**Future tampered-skill-version warnings**: the `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` template names all 3 likely causes (local tamper / newer skill / older skill); a future skill that wants version-granular guidance can extend the template with a `{VERSION_HINT}` slot without touching the dispatcher-wrap.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - bug, planning-time correction] Step 0 self-reference is mathematically unrealizable**

- **Found during:** Plan body's `<implementation_guidance>` analysis (the planner explicitly anticipated this correction)
- **Issue:** Plan 09-01 shipped SKILL.md with `EXPECTED_SKILL_SHA256 = \`EXPECTED_SKILL_SHA256_PLACEHOLDER\`` literally inside Step 0 narrative. Substituting the SHA-of-the-file INTO the file changes the file's bytes → changes the SHA → breaks the check by construction. SHA-256 has no fixpoint by avalanche property; the placeholder-fixpoint algorithm in Plan 09-01's original spec does NOT converge.
- **Fix:** Rewrote Step 0 to externalize the EXPECTED_SKILL_SHA256 lookup to (a) MCP `instructions` field (template-literal interpolation surfaces the live constant value to the agent at initialize time) and (b) sister-repo README integrity-check section (release-side pin, kept in sync via coordinated bump). The SKILL.md body itself NEVER contains the SHA — a stable template that the smoke test + the MCP probe both hash to the same value (`28d47f34d74…`) without circular dependency.
- **Why:** This is a load-bearing correction. The plan body's `<implementation_guidance>` section explicitly walks through the fixpoint-non-convergence analysis and prescribes this exact fix (lines 387-437). Plan 09-01 SUMMARY acknowledges the deviation pre-emptively in its hand-off section.
- **Files modified:** `.planning/phases/09-hardening-skill-and-verification-tools/09-01-SKILL-TEMPLATE.md` (Step 0 narrative rewrite); sister-repo `SKILL.md` byte-identical mirror; sister-repo `README.md` clarifying paragraph naming the dual-source-of-truth discipline

**2. [Rule 1 - test crosstalk] Pre-existing server-dispatcher-wrap.test.ts Test 2 broke under new skill-NOTICE wrap**

- **Found during:** First `npm test` run after landing the production change
- **Issue:** `test/server-dispatcher-wrap.test.ts` Tests 1-2 assert auto-demo NOTICE dedup behavior in isolation (Test 2: "second tool call in same session → no NOTICE block"). My new skill-NOTICE dispatcher-wrap emits a missing-skill NOTICE on Test 2's second dispatch (no SKILL.md in the test environment's HOME), breaking the legacy "no NOTICE on second response" assertion.
- **Fix:** Added `vi.spyOn(_skillIntegrity, "checkSkillIntegrity").mockResolvedValue(OK_STATE)` to the legacy test file's `beforeEach`. The legacy tests now assert auto-demo dedup behavior in isolation, with skill-integrity stubbed to OK. Dedicated coverage for the new skill-NOTICE wrap behavior lives in the new `test/server.skill-notice.test.ts` (6 cases).
- **Why:** Separation-of-concerns preserved. The pre-existing test's intent (auto-demo dedup in isolation) is honored; the new behavior gets its own dedicated test file.
- **Files modified:** `test/server-dispatcher-wrap.test.ts` (+21 lines, beforeEach stub + afterEach reset)

**3. [Rule 3 - blocking, test framework limitation] `vi.spyOn(node:os/node:fs-promises)` raises TypeError on non-configurable bindings**

- **Found during:** First `npm test` run; 6 tests in `test/security-skill-integrity.test.ts` failed with `TypeError: Cannot redefine property: homedir` and `TypeError: Cannot redefine property: readFile`
- **Issue:** Node's `node:os` and `node:fs/promises` named-export bindings are non-configurable property descriptors that vitest cannot monkey-patch via `vi.spyOn`. Initial test design used `vi.spyOn(os, "homedir")` to redirect probe paths and `vi.spyOn(fsp, "readFile")` to count IO calls.
- **Fix part 1 (homedir):** Switched from `vi.spyOn(os, "homedir")` to `process.env.HOME = tmpDir`. Node `os.homedir()` honors HOME on POSIX (verified: `node -e "process.env.HOME='/tmp/test-home'; console.log(require('node:os').homedir())"` returns `/tmp/test-home`). The afterEach restores the saved HOME value.
- **Fix part 2 (readFile call-count):** Rewrote Test 4's memoization assertion from `vi.spyOn(fsp, "readFile")` + call-count check to a behavioral filesystem-mutation check. Install the SOT (ok state), mutate the file between calls (byte-flip → would change SHA → would surface as tampered if IO re-ran), assert second call returns the same object reference AND still reports ok. The behavioral check is STRONGER than the call-count check — it tests the observable consequence of memoization (no fresh IO observed), not the implementation detail.
- **Why:** Both fixes follow the principle from CLAUDE.md § ESM-spy-affordance: when the export binding can't be redefined, use the seam that IS configurable. The `_skillIntegrity` indirection that production code DOES route through remains spy-able (Test 11 in the same file verifies the round-trip).
- **Files modified:** `test/security-skill-integrity.test.ts` (stubHomedir uses HOME env var; Test 4 rewritten as filesystem-mutation behavioral check)

### Plan Body Observations (not deviations)

- **EXPECTED_SKILL_SHA256 appears in EXACTLY 1 src file, not 2.** The plan's success criterion + `<verify>` block expected `grep -rl <hex> src/ | wc -l == 2` (constant in skill-integrity.ts + INSTRUCTIONS interpolation in server.ts). At execute time, the literal hex appears in EXACTLY 1 src file — `server.ts` uses `${EXPECTED_SKILL_SHA256}` template-literal interpolation which does NOT embed the hex literal at the source level (it's evaluated at runtime). This is technically STRONGER single-SOT than the plan expected. Test 12 asserts exactly 1 file. The plan body's `<accepted_residuals>` section noted this nuance.

- **Sister-repo v1.3.0 created as annotated tag (not lightweight).** Plan's `<action>` step 12 said `git tag --force v1.3.0`. At execute time, v1.3.0 didn't exist yet (Plan 09-01's `<deferred>` skipped tag creation), so `--force` was unnecessary. Created as `git tag v1.3.0 -m "..."` (annotated) for traceability + GitHub UI rendering of the tag message.

## Accepted Residuals

- **Supply-chain hardening for the build-time `EXPECTED_SKILL_SHA256` constant** (reproducible builds + sigstore signing) — v1.4+ DIST-* scope; v1.3 ships the constant as a normal source-code value, trust-modeled at the build pipeline.
- **`MIN_COMPATIBLE_SKILL_VERSION` range check** (graceful handling of skill v1.3.1+ against MCP v1.3.0) — v1.4+ ergonomics; v1.3 is strict-pin.
- **Plugin-scope probe path** (`<plugin>/skills/vaultpilot-preflight/SKILL.md`) — v1.3.1 / v1.4 deferral per RESEARCH § Assumption A10.
- **Automated SHA bump script** (when bumping skill v1.3.0 → v1.3.1, automate the SHA recompute + cross-substitution) — v1.4 ergonomics; v1.3 manual coordination is acceptable for a single tag.
- **Cross-source integrity check at MCP boot** (MCP INSTRUCTIONS SHA matches README SHA matches sister-repo SKILL.md SHA — verified at startup) — v1.3 ships single-SOT discipline + execute-time cross-check at the substitution event; runtime cross-check is v1.4+ overhead.
- **`process.cwd()`-based project-scope probe** assumes `claude mcp add` launches the MCP server with `cwd = user's project root` (RESEARCH § Assumption A5). If the server is launched with a different cwd (e.g. global service install), the project-scope path always misses ENOENT and falls through to personal-scope. Personal-scope is the primary install target per the README install one-liner; project-scope is best-effort.
- **Symlink-handled probe paths** rely on Node `readFile` following symlinks by default. A user with `~/.claude/skills/vaultpilot-preflight` as a symlink to a cloned repo sees the dereferenced SHA computed — correct behavior. No special handling needed; documented.
- **Sister-repo CI `.github/workflows/ci.yml`** still deferred from Plan 09-01 (OAuth workflow-scope blocker). Local `bash test/sha256.sh` smoke test runs and passes; CI integration is a fanout-sentinel for README-vs-SKILL drift but not load-bearing — Plan 09-02's execute-time cross-check provides authoritative drift detection at the substitution event. User can add the workflow file via GitHub UI or `gh auth refresh -s workflow`.

## Phase 9 Progress

Phase 9 = 5 plans (this is the 2nd):

- **09-01** ✅ Sister repo bootstrap + SKILL.md + Step 0 + invariants encoded (Plan 09-01)
- **09-02** ✅ `src/security/skill-integrity.ts` + `EXPECTED_SKILL_SHA256` + dispatcher-wrap `VAULTPILOT NOTICE` + Step 0 self-reference fix + sister-repo v1.3.0 coordinated release (THIS PLAN)
- 09-03 ⏳ `get_verification_artifact` tool
- 09-04 ⏳ `verify_tx_decode` tool + canonical dispatch allowlist
- 09-05 ⏳ `get_tx_verification` tool + session-topic-last8 surfacing in send success

## Self-Check: PASSED

- `src/security/skill-integrity.ts` exists: ✅ `git log --diff-filter=A --name-only HEAD~1..HEAD | grep skill-integrity.ts` returns the file
- `src/security/skill-integrity.ts` exports the 5 surfaces: ✅ EXPECTED_SKILL_SHA256, checkSkillIntegrity, consumeSkillIntegrityNotice, _skillIntegrity, _resetSkillIntegrityForTesting all present
- `EXPECTED_SKILL_SHA256` is a 64-char hex literal: ✅ `28d47f34d74c661cee989a3ccc67b911fe59b566d6e2d44c3d03f981516839e2` (length 64, all `[a-f0-9]`)
- `EXPECTED_SKILL_SHA256` equals SHA-256 of post-Step-0-fix planning template: ✅ `shasum -a 256 .planning/.../09-01-SKILL-TEMPLATE.md` returns the same hex
- `EXPECTED_SKILL_SHA256` single-SOT in src/: ✅ `grep -rl <hex> src/` returns exactly 1 file (`src/security/skill-integrity.ts`)
- `src/server.ts` has skill-integrity import + INSTRUCTIONS line + dispatcher-wrap: ✅ all 3 changes present
- `src/server.ts` dispatcher-wrap is AFTER auto-demo NOTICE block: ✅ skill wrap at lines 169-178; auto-demo wrap at lines 153-167 (byte-frozen)
- `src/signing/blocks.ts` has 2 new templates at end-of-file: ✅ VAULTPILOT_NOTICE_TEMPLATE_MISSING + VAULTPILOT_NOTICE_TEMPLATE_TAMPERED appended; existing 9+ templates byte-frozen
- `src/signing/error-codes.ts` has SKILL_INTEGRITY_FAILURE: ✅ appended to ErrorCode union (16 → 17); producer-map comment extended
- `src/tools/get_vaultpilot_config_status.ts` has skillIntegrity field: ✅ secret-safe summarizer + structuredContent additive
- `.planning/.../09-01-SKILL-TEMPLATE.md` Step 0 self-reference fixed: ✅ external-source-of-truth narrative replaces the embedded SHA literal
- Sister repo `v1.3.0` tag exists: ✅ `gh api repos/szhygulin/vaultpilot-preflight-skill/git/refs/tags/v1.3.0 --jq '.object.sha'` returns `09a41f08c8847715206b70206633c60c6fe8e478`
- Sister repo `SKILL.md` SHA matches main-repo constant: ✅ `gh api repos/szhygulin/vaultpilot-preflight-skill/contents/SKILL.md --jq '.content' | base64 -d | shasum -a 256` returns the same hex
- Sister repo smoke test green: ✅ `bash test/sha256.sh` outputs `OK: SKILL.md SHA-256 matches README.md (28d47f34…)`
- `git diff origin/main -- src/` shows only the expected additive surface: ✅ 5 src files modified/created (skill-integrity.ts NEW; server.ts + blocks.ts + error-codes.ts + get_vaultpilot_config_status.ts MODIFY)
- FROZEN 12-file list zero-diff: ✅ `git diff origin/main -- <12 files> | wc -l == 0`
- TypeScript strict pass: ✅ `npx tsc --noEmit` clean (no output)
- Build clean: ✅ `npm run build` outputs `> tsc` only (no errors)
- Test suite GREEN: ✅ 810/810 (789 baseline + 21 new)
- Main-repo branch correct: ✅ `git symbolic-ref --short HEAD == feat/09-02-skill-integrity-pin-and-vaultpilot-notice`
- Worktree path correct: ✅ `git rev-parse --show-toplevel == /Users/s/dev/vaultpilot/vaultpilot-mcp-gsd-inspired/.claude/worktrees/feat-09-02-skill-integrity-pin-and-vaultpilot-notice`
- Main-repo commit landed: ✅ `git log --oneline -1` returns `d77e51c feat(09-02): skill-integrity SHA-256 pin + VAULTPILOT NOTICE dispatcher-wrap + Step 0 self-reference fix (SEC-31)`
- Sister-repo commit + tag pushed: ✅ commit `9d5a306` on `main`; tag `v1.3.0` annotated, ref SHA `09a41f08…`
