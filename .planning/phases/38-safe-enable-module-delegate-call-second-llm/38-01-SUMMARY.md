---
phase: 38-safe-enable-module-delegate-call-second-llm
plan: 01
subsystem: safe-multisig
tags: [safe, security, second-llm, inv-12.5, hard-trigger, v2.5-close-out]
requires:
  - phase-37 (three-step signing flow + PreparedTxSafeTypedData + decodeSingleSafeExecTransaction)
  - phase-36 (safe positions + Tx Service + operation semantic-string discriminator)
  - phase-9 (sister-repo SHA-pin pattern + get_verification_artifact + PASTEABLE_BLOCK_TEMPLATE)
provides:
  - "Inv #12.5 hard-trigger emission at 4 MCP-side sites (prepare_safe_tx_propose / _approve / _execute / preview_send)"
  - "src/protocols/safe.ts — ENABLE_MODULE_SELECTOR + decodeEnableModuleCalldata + isEnableModuleCalldata"
  - "HARD_TRIGGER_MODULE_ENABLE_TEMPLATE + HARD_TRIGGER_DELEGATECALL_TEMPLATE + PASTEABLE_BLOCK_TEMPLATE_SAFE (blocks.ts APPEND-ONLY)"
  - "get_verification_artifact txType dispatch — PreparedTxSafeTypedData handles surface real Safe fields (A1 resolution)"
  - "v1.4 SHA pin (replacement of v1.3.x; DF-2 resolution)"
  - "Planning artifact 38-02-SKILL-TEMPLATE.md — byte-identical SOT for Plan 38-02 sister-repo SKILL.md"
  - "Fixture SAFE-G hardcoded literal regression anchor"
  - "SECURITY.md Phase 38 section + Inv #12.5 codification + threat register + v2.5 close-out summary"
affects:
  - src/protocols/safe.ts (NEW)
  - src/signing/blocks.ts (APPEND-ONLY templates + v1.4 prose update)
  - src/security/skill-integrity.ts (v1.4 SHA pin REPLACEMENT)
  - src/server.ts (INSTRUCTIONS prose v1.3.0 → v1.4)
  - src/tools/prepare_safe_tx_propose.ts (informational line REMOVED; hard-trigger blocks APPENDED)
  - src/tools/prepare_safe_tx_approve.ts (same)
  - src/tools/prepare_safe_tx_execute.ts (same)
  - src/tools/preview_send.ts (defense-in-depth re-emission inside isSafeExecTransaction branch)
  - src/tools/get_verification_artifact.ts (txType dispatch extension)
  - SECURITY.md (new Phase 38 section)
tech_stack:
  added: []  # zero new npm packages — all functionality via existing viem 2.48.11
  patterns:
    - "Format-fanout-sentinel SOT discipline applied to ENABLE_MODULE_SELECTOR + hard-trigger block titles"
    - "Single-coordinated-release discipline (ALL FOUR satellite sites move in lockstep with SHA pin)"
    - "Per-protocol module convention (src/protocols/safe.ts mirrors weth9.ts/erc20.ts shape)"
    - "APPEND-ONLY block template constants (src/signing/blocks.ts end-of-file)"
    - "Cryptographic-binding fixture pinning (Fixture SAFE-G hardcoded literal; NO beforeAll-snapshot)"
key_files:
  created:
    - src/protocols/safe.ts
    - test/protocols-safe.test.ts
    - test/signing-blocks-hard-trigger.test.ts
    - .planning/phases/38-safe-enable-module-delegate-call-second-llm/38-02-SKILL-TEMPLATE.md
  modified:
    - src/signing/blocks.ts
    - src/security/skill-integrity.ts
    - src/server.ts
    - src/tools/prepare_safe_tx_propose.ts
    - src/tools/prepare_safe_tx_approve.ts
    - src/tools/prepare_safe_tx_execute.ts
    - src/tools/preview_send.ts
    - src/tools/get_verification_artifact.ts
    - test/prepare-safe-tx-propose.test.ts
    - test/prepare-safe-tx-approve.test.ts
    - test/prepare-safe-tx-execute.test.ts
    - test/preview-send.safe-execute.test.ts
    - test/get-verification-artifact.test.ts
    - test/security-skill-integrity.test.ts
    - SECURITY.md
decisions:
  - "DF-1 REPLACE — Phase 37 informational `delegatecall: YES` line REMOVED at all three prepare sites; hard-trigger blocks emitted as separate text-blocks adjacent to (not inside) CHECKS PERFORMED"
  - "DF-2 REPLACE — single EXPECTED_SKILL_SHA256 constant updated v1.3.x → v1.4 (NOT promoted to multi-version additive list; CONTEXT proposal of additive list deferred — promoting would be a security regression)"
  - "A1 INCLUDED — get_verification_artifact extended with txType dispatch + PASTEABLE_BLOCK_TEMPLATE_SAFE; PreparedTxSafeTypedData handles now surface real Safe fields, NOT EVM sentinel zeros"
  - "Composite emission order LOCKED: MODULE ENABLE first (narrower selector match; safe-on-self gated), DELEGATECALL second (broader operation discriminator). Never combined."
  - "MODULE ENABLE safe-on-self gate: trigger fires only when `to === safeAddress` (lowercased compare); calls to `enableModule` on a DIFFERENT Safe do NOT trigger (CONTEXT §domain line 11)"
  - "Truncated enableModule calldata → INVALID_INPUT refusal at prepare-side; silently SKIPS the block at preview (defense-in-depth only)"
  - "Format-fanout-sentinel: each hard-trigger title appears exactly ONCE as a string-literal in src/signing/blocks.ts; grep regression test pins the SOT"
metrics:
  duration: "~80 minutes (Task 1 + Task 2 + Task 3)"
  completed: "2026-05-27"
  tasks: 3
  commits: 3
  files_created: 4
  files_modified: 15
  tests_delta: "+48 (4969 → 5017)"
---

# Phase 38 Plan 38-01: `enableModule` + delegatecall hard-trigger second-LLM check Summary

Promote two Phase 37 placeholder informational lines (`delegatecall: YES`) into APPEND-ONLY `[HARD-TRIGGER — MODULE ENABLE]` and `[HARD-TRIGGER — DELEGATECALL]` blocks emitted at four MCP-side sites (3 prepare + preview_send re-emission), wired to a new `src/protocols/safe.ts` selector + decoder + predicate, with `get_verification_artifact` extended to surface real Safe fields for `PreparedTxSafeTypedData` handles (A1 resolution). SHA pin REPLACED v1.3.x → v1.4 computed from a new main-repo planning artifact `.planning/phases/38-.../38-02-SKILL-TEMPLATE.md`. SECURITY.md Phase 38 section codifies Inv #12.5 + closes out the v2.5 milestone (Phases 36 + 37 + 38).

## Commit hashes

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `75bd11a` | `feat(38-01)`: src/protocols/safe.ts + APPEND-ONLY hard-trigger templates + Fixture SAFE-G + v1.4 SHA pin (8 files, +729/-14) |
| 2 | `85ff61b` | `feat(38-01)`: wire hard-trigger emission at 4 sites + get_verification_artifact txType dispatch (10 files, +970/-29) |
| 3 | TBD (this commit) | `docs(38-01)`: Inv #12.5 codification in SECURITY.md + Phase 38 threat register + v2.5 close-out summary + SUMMARY |

## Test trajectory

| Phase | Test count | Delta |
|-------|------------|-------|
| Pre-Plan-38-01 baseline | 4969 + 1 skipped | — |
| Post-Plan-38-01 | 5017 + 1 skipped | **+48 net** |

Breakdown by file:
- `test/protocols-safe.test.ts` (NEW): 9 tests
- `test/signing-blocks-hard-trigger.test.ts` (NEW): 11 tests
- `test/security-skill-integrity.test.ts` (EXTENDED): +2 tests (Test 13 zero-v1.3.0-literals; Test 14 planning artifact + Step 0.5 + scan keys)
- `test/prepare-safe-tx-propose.test.ts` (EXTENDED): +6 tests
- `test/prepare-safe-tx-approve.test.ts` (EXTENDED): +6 tests
- `test/prepare-safe-tx-execute.test.ts` (EXTENDED): +5 tests
- `test/preview-send.safe-execute.test.ts` (EXTENDED): +6 tests
- `test/get-verification-artifact.test.ts` (EXTENDED): +3 tests

The "delegatecall path surfaces Phase-38 informational note" test at propose / approve / execute was adapted (NOT removed) to assert hard-trigger block emission + Phase-37-informational-line REMOVAL — those count as adapted regressions rather than new tests in the delta.

## FROZEN-area zero-diff confirmation

```
$ git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/handle-store.ts src/tools/send_transaction.ts test/signing-fingerprint.test.ts test/signing-safe-tx-hash.test.ts | wc -l
0
```

Held across all three atomic commits. Phase 37 cryptographic-binding fixtures SAFE-A / SAFE-B / SAFE-C / SAFE-D unchanged. `send_transaction.ts` three gates untouched.

## v1.4 SHA pin value

```
8eb8ba90fb4c7a21ac5579a4533d9221cc136b8d188b0daa6b652b5743da9a4f
```

Computed via `sha256sum .planning/phases/38-safe-enable-module-delegate-call-second-llm/38-02-SKILL-TEMPLATE.md`. Plan 38-02 byte-identically copies the planning template to sister-repo `szhygulin/vaultpilot-preflight-skill` SKILL.md and tags `v1.4`; `sha256sum SKILL.md` at sister-repo execute-time must equal this value (the byte-identity invariant Plan 38-02 cross-checks).

Single-coordinated-release discipline — ALL FOUR satellite sites moved in the same atomic commit (Task 1 / commit `75bd11a`):

1. `src/security/skill-integrity.ts:60-61` — `EXPECTED_SKILL_SHA256` constant
2. `src/server.ts:52` — `INSTRUCTIONS` interpolation prose (`v1.3.0` → `v1.4`)
3. `src/signing/blocks.ts:759` — `VAULTPILOT_NOTICE_TEMPLATE_MISSING` install one-liner (`git checkout v1.3.0` → `git checkout v1.4`)
4. `src/signing/blocks.ts:784` — `VAULTPILOT_NOTICE_TEMPLATE_TAMPERED` branch (c) "older skill version" prose

`grep -n 'v1\.3\.0' src/server.ts src/signing/blocks.ts` returns zero matches; `Test 13 (security-skill-integrity.test.ts)` asserts this.

## Format-fanout-sentinel SOT verification

```
$ grep -c '"\[HARD-TRIGGER — MODULE ENABLE\]"' src/signing/blocks.ts
1
$ grep -c '"\[HARD-TRIGGER — DELEGATECALL\]"' src/signing/blocks.ts
1
```

Each title appears exactly once as a string-literal emission (JSDoc / comment-line backtick references excluded). `ENABLE_MODULE_SELECTOR = "0x610b5925"` lives in `src/protocols/safe.ts` exactly once.

## Deviations from Plan

None substantive — all GSD rules (Rules 1-4) NOT triggered during execution.

Minor adjustments (Rule 0 — within-plan refinement; not deviations):

1. **Test 14 wording** — security-skill-integrity.test.ts Test 14 was added to assert the planning artifact exists + contains the Step 0.5 heading + both HARD-TRIGGER scan keys; this satisfied the plan §`done` criterion ("38-02-SKILL-TEMPLATE.md exists and contains 'Step 0.5 — Inv #12.5' + both `[HARD-TRIGGER — *]` literal titles") without requiring a separate test file.

2. **Placeholder-substitution assertion phrasing** — `test/signing-blocks-hard-trigger.test.ts` post-substitution `{` checks use `/\{[A-Z_]+\}/.test(emitted)` (UPPERCASE-placeholder pattern) instead of plain `emitted.includes("{")`. Reason: the templates contain literal JS-object syntax `{ handle: "{HANDLE}" }` (lowercase `handle`) as part of the agent instruction prose, which is NOT a placeholder. The all-caps pattern is the correct semantic check for fully-substituted placeholders.

3. **Format-fanout-sentinel grep refinement** — the plan §"Format-fanout-sentinel" check was specified as `grep -c '\[HARD-TRIGGER — MODULE ENABLE\]' src/signing/blocks.ts | grep -v '^//' | grep -v '^ *\*'` returning 1. The implementation refined this to grep for the string-literal-quoted occurrence (`"\[HARD-TRIGGER — MODULE ENABLE\]"`) which precisely targets the load-bearing emission line (a `"` quote precedes the bracket only in TS string literals). This avoids the fragility of regex-filtering comment markers across mixed JSDoc + line-comment shapes. The semantic intent — the title appears in exactly ONE emit — is preserved.

## A1 resolution operational impact

Before Plan 38-01: `get_verification_artifact` against a `PreparedTxSafeTypedData` handle returned a pasteable block with EVM-sentinel zeros (`to: 0x000...`, `value: 0`, `data: 0x`) — useless for second-LLM decode because the bytes don't describe what the Safe will execute.

After Plan 38-01: `get_verification_artifact` branches on `record.tx.txType === "safe-typed-data"` and substitutes `PASTEABLE_BLOCK_TEMPLATE_SAFE` with REAL Safe fields:
- `chainId`, `safeAddress`, `safeTxTo`, `safeTxValue`, `safeTxData`, `operation` (semantic string), `safeTxHash`, `payloadFingerprint`

The hard-trigger block's Step 1 instruction (`Run get_verification_artifact({ handle }) and surface the output to the user verbatim`) is now operationally meaningful — the second LLM receives the actual SafeTx the Safe will execute. The `>>>>` / `<<<<` markers are preserved (skill-side v1.4 Step 0.5 `markers preserved` requirement).

`PreparedTxEvm` handles (including execute-path handles with `isSafeExecTransaction === true`) still surface the unchanged EVM template — the second LLM decodes the outer `execTransaction(...)` calldata and recursively decodes the encapsulated SafeTx. Phase 9 regression unchanged.

## Plan 38-02 unblocking artifacts

1. **`.planning/phases/38-safe-enable-module-delegate-call-second-llm/38-02-SKILL-TEMPLATE.md`** — canonical v1.4 SKILL.md content. Plan 38-02 byte-identically copies this file to the sister-repo `szhygulin/vaultpilot-preflight-skill` SKILL.md.

2. **v1.4 SHA pin `8eb8ba90fb4c7a21ac5579a4533d9221cc136b8d188b0daa6b652b5743da9a4f`** — committed to `src/security/skill-integrity.ts:60-61` in Task 1 (commit `75bd11a`). Plan 38-02 cuts the sister-repo `v1.4` release tag; `sha256sum SKILL.md` at sister-repo tag time must equal this hex (the byte-identity cross-check).

3. **CHANGELOG.md entry template (v1.4 — Inv #12.5 HALT step)** — Plan 38-02 will author against the recommended insertion-point prose at `38-02-SKILL-TEMPLATE.md` Step 0.5 (`Detect hard-trigger blocks in MCP responses. If [HARD-TRIGGER — MODULE ENABLE] or [HARD-TRIGGER — DELEGATECALL] appears in the response, HALT and require: ...`).

CI workflow (`.github/workflows/ci.yml`) carries forward as deferred per CONTEXT §"Sister-repo CI workflow still deferred" — gh OAuth lacks `workflow` scope; same constraint as Plan 09-01 W-1.

## v2.5 milestone close-out (Phase 36 + 37 + 38)

The v2.5 Safe multisig milestone is **code-complete** across three phases. Verify-phase remains pending real-Ledger Ethereum-app mainnet smoke covering:
- 1-of-1 Safe `propose` → `submit_safe_tx_signature` → `prepare_safe_tx_execute` → `send_transaction` end-to-end
- Sentinel "no-op" module's `enableModule` triggers the hard-trigger block + second-LLM ritual + skill-side HALT
- `delegatecall` operation triggers the matching block independently
- Composite (both triggers) emits BOTH blocks in document order; user processes each via the skill-side enforcement loop
- On-device blind-sign hash matches the `LEDGER BLIND-SIGN HASH` (or `safeTxHash` for typed-data) surface in `preview_send` / `prepare_safe_tx_*`

Phase 39 (cross-chain bridges) is the next v2.6 phase. The FROZEN trust-pipeline files stay byte-identical to `origin/main` across the full v2.5 milestone.

## Self-Check: PASSED

- `src/protocols/safe.ts` FOUND
- `src/signing/blocks.ts` MODIFIED (3 new APPEND-ONLY constants present)
- `src/security/skill-integrity.ts` MODIFIED (v1.4 SHA pin)
- `src/server.ts` MODIFIED (v1.4 prose)
- `src/tools/prepare_safe_tx_propose.ts` MODIFIED (informational line removed; hard-trigger blocks appended)
- `src/tools/prepare_safe_tx_approve.ts` MODIFIED (same)
- `src/tools/prepare_safe_tx_execute.ts` MODIFIED (same)
- `src/tools/preview_send.ts` MODIFIED (defense-in-depth re-emission)
- `src/tools/get_verification_artifact.ts` MODIFIED (txType dispatch)
- `SECURITY.md` MODIFIED (Phase 38 section appended)
- `.planning/phases/38-safe-enable-module-delegate-call-second-llm/38-02-SKILL-TEMPLATE.md` FOUND
- `test/protocols-safe.test.ts` FOUND
- `test/signing-blocks-hard-trigger.test.ts` FOUND
- `test/prepare-safe-tx-propose.test.ts` MODIFIED + extended
- `test/prepare-safe-tx-approve.test.ts` MODIFIED + extended
- `test/prepare-safe-tx-execute.test.ts` MODIFIED + extended
- `test/preview-send.safe-execute.test.ts` MODIFIED + extended
- `test/get-verification-artifact.test.ts` MODIFIED + extended
- `test/security-skill-integrity.test.ts` MODIFIED + extended
- Commit `75bd11a` FOUND (Task 1)
- Commit `85ff61b` FOUND (Task 2)
- All 5017 tests pass; `tsc --noEmit` clean
- FROZEN-area zero-diff held
