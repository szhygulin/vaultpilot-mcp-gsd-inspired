# Phase 10 Plan-Checker Report

**Checked:** 2026-05-18
**Phase:** 10 — Distribution + ergonomics (v1.4)
**Plans verified:** 4 (10-01, 10-02, 10-03, 10-04)
**Commit verified:** `240af24` on `plan/phase-10` (`docs(10): plan phase 10 — Distribution + ergonomics (4 plans, 0 design forks open)`)
**Verdict:** PASSED with 1 WARNING (scope-sanity borderline on Plan 10-03 — surfaced, non-blocking)

---

## Dimension Scorecard

| Dimension | Status | Notes |
|---|---|---|
| 1. Requirement Coverage | PASS | DIST-40 → 10-01; DIST-41 → 10-02; DIST-42 → 10-02 + 10-03; DIST-43 → 10-04. All 4 in frontmatter `requirements`. |
| 2. Task Completeness | PASS | Each plan has 1 `<task>` with all required elements (files/action/verify/done + behavior). |
| 3. Dependency Correctness | PASS | 10-01 ∥ 10-03 ∥ 10-04 → 10-02 graph valid, acyclic, no forward refs. Matches PATTERNS § 7. |
| 4. Key Links Planned | PASS | install.sh ↔ release-assets (10-01↔10-02); install.sh ↔ setup CLI (10-02↔10-03); register-all ↔ request_capability (10-04); wizard ↔ writeConfigFile (10-03). |
| 5. Scope Sanity | WARN | Plan 10-03 has 15 files in a single TDD task — at the 15+ blocker boundary. Cohesion + small per-file size mitigate; surfaced as WARNING not BLOCKER. |
| 6. Verification Derivation | PASS | All `must_haves` truths are user-observable (binary installs from one-liner; wizard writes config; request_capability returns URL; rate-limit refuses 4th call). |
| 7. Context Compliance | N/A | No CONTEXT.md (planner notes "0 design forks open" — DF-1 + DF-2 pre-locked in RESEARCH). |
| 7b. Scope Reduction | PASS | No "v1/v2", "static for now", "placeholder", or "future enhancement" language used to dodge in-scope decisions. v1.4.1+ deferrals are genuine non-requirements (`--register-only` flag, `--dry-run` flag-form sugar, sigstore SLSA, Apple cert). |
| 7c. Architectural Tier Compliance | PASS | RESEARCH § Architectural Responsibility Map cleanly maps tiers (build-time / shell / MCP server / browser-N/A). Plans place every capability in the correct tier. |
| 8. Nyquist | SKIPPED | RESEARCH has no "Validation Architecture" section; no VALIDATION.md. Per spec, Dimension 8 skipped. |
| 9. Cross-Plan Data Contracts | PASS | InstallEnvelope union widening coordinated across 10-02 + 10-03 via APPEND-ONLY-in-separate-comment-blocks discipline; both plans cite same `ENVELOPE_VERSION = 1` lock per T-INSTALL-ENVELOPE-COMPAT-1. setup-mcp-clients.ts ownership clearly assigned (10-03 owns; 10-02 consumes via installed-binary CLI, NOT direct src/ import). |
| 10. CLAUDE.md Compliance | PASS | All plans honor: "Stderr for diagnostics, stdout for MCP protocol" (wizard prompts → stderr, envelope JSON → stdout); "Tool descriptions are agent routing prompts" (DESCRIPTION lock for `NEVER auto-submits`); "ESM spy-affordance indirection" (_rateLimit, _paths); "Documentation Style — concise" (README install section is 3 lines, no ramp-up); "No private key material crosses any boundary" (Phase 10 doesn't touch signing pipeline at all). |
| 11. Research Resolution | PASS | RESEARCH § Open Questions (RESOLVED) — verified at line 1261. |
| 12. Pattern Compliance | PASS | Every NEW file maps to a PATTERNS § 1 analog. The 4 no-analog items (release.yml, install.sh, install.ps1, setup-prompts.ts) are explicitly covered by verbatim-copyable sketches in RESEARCH § Topics 4-7. |

---

## Cross-Cut Verification Anchors

### Goal-backward analysis

**Phase goal (from ROADMAP § Phase 10):** "A user without Node can install via shell-installer one-liner. A user with Node gets a setup wizard for keys + Ledger pairing."

| What must be TRUE | Covering plan + task evidence |
|---|---|
| 1. Per-platform binaries published per ROADMAP success-criterion #1 | 10-01: `.github/workflows/release.yml` matrix-builds 4 targets via `@yao-pkg/pkg@^6.19.0`; linux-arm64 NPM fallback assigned to 10-02 install.sh refusal arm |
| 2. `install.sh` curl-pipe works (POSIX) | 10-02: per RESEARCH § Topic 5 sketch verbatim; all 8 mandatory invariants (set -euo pipefail, main wrap, curl -fsSL, SHA-256-before-extract, idempotency, Gatekeeper OFFER, PATH warn, refusal arms) named and tested |
| 3. `install.ps1` curl-pipe works (Windows) | 10-02: PowerShell analog with $ErrorActionPreference, Invoke-WebRequest, Get-FileHash, SmartScreen NOTICE, HKCU PATH-append |
| 4. `vaultpilot-mcp setup` wizard exists + writes config.json | 10-03: 6-step `@clack/prompts` flow + atomic `writeConfigFile()` mode 0o600 + `--non-interactive --json` mirror + single Zod SOT |
| 5. `request_capability` produces pre-filled URL, rate-limited 3/hour | 10-04: `URLSearchParams` WHATWG build + sliding-window rate-limit + DESCRIPTION names "NEVER auto-submits" |
| 6. FROZEN cryptographic-binding chain UNCHANGED | All 4 plans: `<frozen_assertions>` lists explicit zero-diff scope; LARGEST FROZEN-area boundary of any phase (only additive touch is `writeConfigFile()` after line 95 in config-file.ts) |

### FROZEN-area discipline

Every plan's `<verify><automated>` block includes a `git diff origin/main -- <FROZEN list>` invocation that exits non-zero on any touch. The FROZEN scope is consistent across all 4 plans:

- ALL `src/signing/*` (except 10-04's additive `RATE_LIMIT_EXCEEDED` in `error-codes.ts`)
- ALL `src/tools/prepare_*` + `preview_send.ts` + `send_transaction.ts` + verify-tools
- ALL `src/protocols/*`
- ALL `src/security/*` (Phase 9 surface; 10-04 ADDS `request-capability-rate-limit.ts` as 3rd occupant)
- `src/wallet/session-manager.ts`, `src/chains/registry.ts`, `src/config/{contracts,env}.ts`
- `src/config/config-file.ts` lines 1-95 (10-03 owns ADDITIVE `writeConfigFile()` after line 95 — verified against current source: file is exactly 95 lines as claimed)

### Pre-locked design forks (DF) honored

- **DF-1**: `@yao-pkg/pkg@^6.19.0` over Bun + Node SEA + nexe — claimed in 10-01 frontmatter `must_haves.truths` + rationale block; not re-raised in any plan
- **DF-2**: `@clack/prompts@^1.4.0` over `prompts` + `@inquirer/prompts` + native readline — claimed in 10-03 frontmatter + rationale; not re-raised

### Threat model completeness

All threats from `<check_dimensions>` named with explicit mitigations:

| Threat | Plan | Mitigation |
|---|---|---|
| T-INSTALL-MITM-1 | 10-01 + 10-02 | per-asset `.sha256` in release.yml + `shasum -a 256 -c` BEFORE extract in install.sh |
| T-PARTIAL-DOWNLOAD-1 | 10-02 | `main() { … }; main "$@"` arp242 wrap |
| T-MACOS-QUARANTINE-1 | 10-02 | interactive `xattr -d` OFFER + Plan 10-01 SECURITY.md row |
| T-WIZARD-CONFIG-CORRUPT-1 | 10-03 | atomic tmp+rename + mode 0o600 |
| T-CAPABILITY-SPAM-1 | 10-04 | sliding-window 3/hour rate-limit |
| T-CAPABILITY-INJECTION-1 | 10-04 | `URLSearchParams` WHATWG round-trip test |
| T-CONFIG-LEAK-1 | 10-03 | `redactForEnvelope` + 3-sentinel substring scan test |

### STOP-THE-LINE labels

All STOP-THE-LINE threats explicitly named with severity HIGH + automated test anchor:

| Label | Plan | Anchor |
|---|---|---|
| T-FROZEN-SIGNING-1 | every plan | `<verify>` automated `git diff` assertion |
| T-PKG-CROSS-COMPILE-1 | 10-01 | local Linux smoke + prerelease `v1.4.0-rc1` integration test |
| T-SHA256-VERIFY-BEFORE-EXTRACT-1 | 10-02 | install.sh `shasum -a 256 -c ... || fail` (before tar xzf) |
| T-INSTALL-ENVELOPE-COMPAT-1 | 10-02 | test Cases 1 + 17 (ENVELOPE_VERSION === 1 + backward-compat parse) |
| T-WIZARD-SCHEMA-SOT-1 | 10-03 | `cli-setup-schema.test.ts` Case 4 cross-test (grep both wizard files for SetupPayloadSchema import) |
| T-CONFIG-LEAK-1 | 10-03 | `cli-setup-non-interactive.test.ts` Case 5 (3-sentinel substring scan) |
| T-CAPABILITY-AUTO-SUBMIT-1 | 10-04 | `request-capability.test.ts` Case 6 (DESCRIPTION literal substring assertion) |
| T-CAPABILITY-RATE-LIMIT-1 | 10-04 | `request-capability-rate-limit.test.ts` Cases 6 + 7 (ESM spy round-trip on check + record) |

### Test-count plausibility

| Plan | Estimate | Reasonable range | Verdict |
|---|---|---|---|
| 10-01 | 12 | 10-20 | PASS (conservative; no src/ touch → likely 0) |
| 10-02 | 18 | 15-25 | PASS (18 InstallEnvelope shape cases enumerated in implementation guidance) |
| 10-03 | 45 | 30-50 | PASS (45 across 5 test files — itemized 10 + 12 + 10 + 5 + 8) |
| 10-04 | 25 | 20-30 | PASS (25 across 2 test files — itemized 10 + 15) |

### PATTERNS + RESEARCH citation discipline

Every plan's `<context>` block cites both PATTERNS.md and RESEARCH.md by exact path; every `must_haves.truths` entry cites the exact RESEARCH § Topic + line range or PATTERNS § line for the lock. Sampled citations verified:

- 10-01 "DF-1 LOCKED ... Rationale" → RESEARCH § DF-1 (verified)
- 10-02 "Topic 5 sketch lines 312-411" → RESEARCH § Topic 5 (verified)
- 10-03 "Topic 7 sketch lines 691-697" → RESEARCH § Topic 7 (verified)
- 10-04 "Topic 8 sketch lines 723-781" → RESEARCH § Topic 8 (verified)

### Factual anchors cross-checked against current source

| Plan claim | Current source | Verdict |
|---|---|---|
| 10-03: `src/config/config-file.ts` lines 1-95 BYTE-FROZEN | File is exactly 95 lines | PASS — claim matches |
| 10-03: `src/index.ts` lines 9-13 `--check` + lines 15-19 `--version` BYTE-FROZEN | `--check` at lines 9-13, `--version` at lines 15-19 | PASS |
| 10-04: `error-codes.ts` 19 → 20 codes | Currently 19 entries in union | PASS |
| 10-04: `makeStructuredError` at `error-codes.ts:109` | Function at line 109 | PASS |
| 10-04: `register-all.ts` last import = `get_ledger_device_info.js` at line 32 | Confirmed exact line + entity | PASS |
| 10-02 + 10-03: Phase 1 `install-envelope.ts` baseline has 5 CheckId literals | 5 literals at lines 5-10 | PASS |
| All: `.github/workflows/` does NOT yet exist | Verified: no workflows dir | PASS (first occupant claim true) |
| All: `src/cli/` does NOT yet exist | Verified: no cli dir | PASS (first occupant claim true) |
| All: `commit_docs` on `plan/phase-10` | `240af24` confirmed via `git log --oneline -5` | PASS |

---

## Issues (structured)

```yaml
issues:
  - id: W-1
    plan: "10-03"
    dimension: scope_sanity
    severity: warning
    description: |
      Plan 10-03 has 15 files in a single TDD task — at the 15+ blocker
      boundary of Dimension 5. The plan is structured as `type="auto"
      tdd="true"` (TDD pairing src ↔ test); 5 NEW src/cli/ files + 5 NEW
      test files (1:1 mirror) + 3 ADDITIVE src modifications (each 1-3
      lines) + 2 docs/pkg edits.
    metrics:
      tasks: 1
      files: 15
      src_files_new: 5
      src_files_additive: 3
      test_files_new: 5
      docs_pkg_files: 2
      estimated_loc_src: 280
      estimated_loc_test: 600
      estimated_tests: 45
    mitigating_factors:
      - "src/cli/ files are tightly cohesive (single shelf, single feature)"
      - "individual src files small (40-150 LOC each)"
      - "test files mirror src 1:1 (canonical GSD TDD pairing)"
      - "3 additive modifications are tiny (1-3 lines each — index.ts, install-envelope.ts, config-file.ts)"
      - "package.json + README.md are config/docs additive only"
    recommendation: |
      Accept as WARNING (not BLOCKER) given cohesion + small per-file
      size + TDD pairing being a single conceptual unit. If executor
      finds the task exceeds context budget at execute time, split into
      sub-tasks: (a) src/cli/ shelf + setup-mcp-clients tests, (b)
      wizard interactive + non-interactive + their tests, (c)
      writeConfigFile + index.ts wiring + install-envelope widening +
      docs. Add to phase retro: tracking single-task file-count vs
      multi-plan parallelism trade-off.
    fix_hint: "Optional — executor may proceed as-is; revisit only if context
      budget proves tight during execution."
```

---

## Recommendation

**PASSED — proceed to `/gsd-execute-phase 10`.**

The one warning (Plan 10-03 file count at scope-sanity boundary) does not block. Cohesion + TDD pairing + small per-file size justify keeping the single-task structure. If execution finds context budget tight, the executor can split mid-flight using the sub-task partition named in the warning.

All other dimensions PASS or SKIP (Nyquist — no Validation Architecture section, expected for distribution phase). FROZEN-area discipline is the strongest of any phase to date (LARGEST boundary), pre-locked DFs (DF-1 + DF-2) honored without re-raise, threat model + STOP-THE-LINE labels fully enumerated with automated test anchors, factual anchors verified against current source.
