---
phase: 35-evm-escape-hatch-custom-call-abi-read
plan: 03
subsystem: escape-hatch / EVM signing-flow / preview_send EVM branch
tags:
  - escape-hatch
  - prepare_custom_call
  - canonical-dispatch-bypass
  - WARN-non-protocol-target
  - Fixture-P
  - acknowledgeNonProtocolTarget
  - format-fanout-sentinel
  - FROZEN-additive
requires:
  - 35-01 (fetchEtherscanAbi, getCachedEtherscanAbi, ABI_NOT_AVAILABLE)
provides:
  - prepare_custom_call MCP tool (CUSTOM-01)
  - acknowledgeNonProtocolTarget bypass flag + preparedBy handle annotations
  - WARN_NON_PROTOCOL_TARGET_TEMPLATE / CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE / NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE (blocks.ts SOT)
  - canonical-alternatives selector→tool lookup table (28 rows)
  - NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED error code
  - PrepareArgs.data? raw calldata passthrough field
  - peekEtherscanAbiCache equivalent (getCachedEtherscanAbi from 35-01) wired into preview_send
  - Fixture P escape-hatch fingerprint anchor (0xb137028a...)
affects:
  - src/tools/preview_send.ts (EVM-branch bypass + custom-call decode arm only)
  - src/signing/handle-store.ts (ADDITIVE TYPE SURFACE — two optional fields + PrepareArgs.data)
  - src/signing/blocks.ts (APPEND-ONLY)
  - src/signing/error-codes.ts (APPEND-ONLY)
  - src/tools/register-all.ts (APPEND-ONLY)
tech-stack:
  added: []
  patterns:
    - Format-fanout-sentinel (single SOT template; integration test byte-identity)
    - ESM spy-affordance (_canonicalAlternatives)
    - JSON-Schema literal-true dispatch-boundary gate
    - Cryptographic-binding fixture pinned as hardcoded literal (Fixture P)
    - Per-session ABI cache HIT-only API at preview (no network round-trip)
key-files:
  created:
    - src/tools/prepare_custom_call.ts
    - src/security/canonical-alternatives.ts
    - test/security-canonical-alternatives.test.ts
    - test/prepare-custom-call.test.ts
    - test/preview-send.custom-call.test.ts
    - test/integration/escape-hatch.test.ts
    - .planning/phases/35-evm-escape-hatch-custom-call-abi-read/35-03-SUMMARY.md
  modified:
    - src/tools/preview_send.ts (EVM-only bypass + custom-call decode arm)
    - src/signing/handle-store.ts (HandleRecord.acknowledgeNonProtocolTarget? + .preparedBy?; PrepareArgs.data?; createHandle widening)
    - src/signing/blocks.ts (3 new templates)
    - src/signing/error-codes.ts (NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED arm)
    - src/tools/register-all.ts (prepare_custom_call import)
    - test/signing-fingerprint.test.ts (FIXTURE_P_FP + Fixture P test)
decisions:
  - acknowledgeNonProtocolTarget is a SEPARATE record annotation, NOT a fingerprint dimension — Fixture P proves the standard PREP-03 envelope is unchanged for escape-hatch calldata
  - Bypass branch lives ONLY at the EVM dispatch site; Solana/TRON/BTC dispatch sites cannot inherit the bypass (Pitfall 1 grep-guarded)
  - NO 4byte fallback in the custom-call decode arm — absence of ABI is itself meaningful information for the user (Pitfall 4)
  - WARN block template lives in single SOT (blocks.ts); both prepare_custom_call and preview_send import + substitute it (T-35-03-G byte-identity at integration test)
  - PrepareArgs.data? added as additive optional field — every other prepare_* tool leaves it undefined; raw calldata passthrough preserves the agent-supplied hex in PREPARE RECEIPT verbatim
metrics:
  duration: ~75 minutes (Tasks 1-4 + worktree rebase onto feat/35-escape-hatch + Fixture P address fix iteration)
  completed: 2026-05-26
---

# Phase 35 Plan 35-03: prepare_custom_call + Canonical-Dispatch Escape Hatch (CUSTOM-01) Summary

## Overview

Shipped the v2.4 milestone close-out tool — `prepare_custom_call`, the escape hatch
that lets the agent prepare arbitrary unsigned EVM transactions outside the
canonical-dispatch allowlist when the user has explicitly confirmed they want
to call a non-protocol target. Three coordinated load-bearing defenses prevent
abuse: a JSON-Schema literal-true gate on `acknowledgeNonProtocolTarget`, a
structured-refusal-with-canonical-alternative path when the agent omits the
flag, and a `[WARN — NON-PROTOCOL TARGET]` block emitted byte-identically in
both prepare and preview responses (drift = tamper signal).

The FROZEN cryptographic-binding chain stays byte-identical to origin/main
(`payload-fingerprint.ts`, `presign-hash.ts`, `send_transaction.ts`,
`fourbyte.ts` — all zero-diff). Handle-store gains two additive optional
fields and one PrepareArgs slot; state machine + TTL functions UNCHANGED.

## Files Modified

### Created

| File | Lines | Role |
|------|-------|------|
| `src/tools/prepare_custom_call.ts` | 363 | MCP tool — schema gate + canonical-alternative refusal + handle mint + WARN/RECEIPT emission |
| `src/security/canonical-alternatives.ts` | 217 | Curated selector→tool table (28 rows) + lookupCanonicalAlternative + _canonicalAlternatives ESM spy-affordance |
| `test/security-canonical-alternatives.test.ts` | 132 | 14 tests — table integrity + lookup + spy-affordance |
| `test/prepare-custom-call.test.ts` | 420 | 83 tests — schema gate, happy path, multi-chain, demo mode, input validation |
| `test/preview-send.custom-call.test.ts` | 437 | 13 tests — bypass branch, WARN emission, decode HIT/MISS, Pitfall 1 + 4 grep guards |
| `test/integration/escape-hatch.test.ts` | 526 | 65 tests — end-to-end lifecycle, byte-identity, persona-cycle, grep guards, FROZEN gate |

### Modified

| File | Change | Diff Size |
|------|--------|-----------|
| `src/tools/preview_send.ts` | Two surgical insertions — EVM-only bypass branch (~25 lines) + custom-call DECODED ARGS arm (~70 lines) | +93/-2 |
| `src/signing/handle-store.ts` | Additive optional fields on HandleRecord + PrepareArgs.data + createHandle widening | +57/-1 |
| `src/signing/blocks.ts` | Three new templates appended end-of-file | +75/-0 |
| `src/signing/error-codes.ts` | NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED arm appended | +17/-1 |
| `src/tools/register-all.ts` | One import line appended | +1/-0 |
| `test/signing-fingerprint.test.ts` | FIXTURE_P_FP export + Fixture P test | +40/-0 |

## Test Trajectory

- **Baseline (rebased onto feat/35-escape-hatch):** 4353 passing / 1 skipped
- **After Task 1 (canonical-alternatives + foundation):** 4367 (+14)
- **After Task 2 (prepare_custom_call + Fixture P):** 4453 (+86)
- **After Task 3 (preview_send bypass + decode arm):** 4466 (+13)
- **After Task 4 (integration test):** 4532 (+65)

**Total delta: +179 NEW tests; 0 regressions; 1 pre-existing skipped.**

## Fixture P Captured Literal

```
FIXTURE_P_FP = "0xb137028a94f1af0a98dc0f96102101ad4efc756784fa54dc0a8fc10d5a8a1701"
```

Inputs (cross-linked from test/prepare-custom-call.test.ts +
test/preview-send.custom-call.test.ts + test/integration/escape-hatch.test.ts):

```
chainId  = 1
to       = "0x00000000000000000000000000000000DeaDBeef"
valueWei = 0n
data     = "0xdeadbeef"
```

NOTE: PATTERNS.md and the original plan called for
`"0x0000000000000000000000000000000000DeaDBeef"` (42 hex chars after `0x`).
That address fails the 40-char regex validation in
`prepare_custom_call.ts`. Trimmed two leading zeros to make a valid
40-char (20-byte) address; Fixture P literal was recaptured against the
corrected input. Documented for future cross-link assertions.

## FROZEN-Area Zero-Diff Verification

```
git diff origin/main -- \
  src/signing/payload-fingerprint.ts \
  src/signing/presign-hash.ts \
  src/tools/send_transaction.ts \
  src/clients/fourbyte.ts
# returns: 0 lines (zero-diff verified)
```

## Grep-Guard Counts

| Guard | Expected | Actual | Status |
|-------|----------|--------|--------|
| `acknowledgeNonProtocolTarget` assignment in src/ (non-comment, non-string-literal) | 2 files | prepare_custom_call.ts + handle-store.ts | ✓ |
| `record.acknowledgeNonProtocolTarget` non-comment reads in preview_send.ts | 1 | 1 (EVM dispatch site) | ✓ |
| `fourbyte` / `lookupSelector` in custom-call decode arm | 0 | 0 | ✓ |
| `WARN_NON_PROTOCOL_TARGET_TEMPLATE` references in preview_send.ts | ≥2 | 2 (import + substitution) | ✓ |
| `WARN_NON_PROTOCOL_TARGET_TEMPLATE` references in prepare_custom_call.ts | ≥1 | 1 | ✓ |
| Single SOT for WARN template (definition site count in blocks.ts) | 1 | 1 | ✓ |

## WARN Byte-Identity

Integration test `escape-hatch — WARN block byte-identity across prepare + preview`
extracts the immutable WARN-block body lines from both `prepare_custom_call`
response AND `preview_send` response, asserts string equality on:

```
  This call BYPASSES the canonical-dispatch allowlist. You explicitly
  acknowledged this at prepare time (acknowledgeNonProtocolTarget: true).
  If unsure, decline on-device.
```

Drift between the two response paths = test failure (T-35-03-G mitigation).

## Persona Cycle From-Independence

Same `(chainId=1, to=FIXTURE_P_TO, valueWei=0n, data=0xdeadbeef)` prepared
under three personas (whale / stable-saver / defi-degen) yields IDENTICAL
Fixture P fingerprint across all three. The three `from` addresses are
distinct (Vitalik / Circle USDC treasury / Binance 7). Re-anchors the
PREP-03 envelope `from`-independence invariant for escape-hatch calldata.

## v2.4 Milestone Close-Out

**Phase 35 CODE-COMPLETE** (CUSTOM-01 surface):
- Plan 35-01 (CUSTOM-02): `get_contract_abi` + Etherscan V2 multi-chain widening — ✓ landed
- Plan 35-02 (CUSTOM-03): `read_contract` + ABI-driven `eth_call` — pending (parallel wave 2; cherry-pick at merge)
- Plan 35-03 (CUSTOM-01): `prepare_custom_call` escape hatch — ✓ this plan

**v2.4 verify-phase requires real-Ledger smoke** for:
- Uniswap V3 swap (Phase 32) — single-hop + multi-hop + sandwich-MEV refusal
- Uniswap V3 LP mint (Phase 33) — mint + increaseLiquidity + composite rebalance
- Curve swap (Phase 34) — legacy stETH/ETH + 10 stable_ng plain pools
- Escape-hatch custom call (Phase 35) — non-protocol target with WARN block on-device

The four prepare flows above are the v2.4 user-facing surface. v2.4 ships
once the verify-phase real-Ledger smoke confirms on-device clear-sign
behavior matches the per-tool LEDGER NOTICE assertions; the escape hatch
intentionally blind-signs (no canonical-dispatch coverage by definition).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FROZEN EVM-body byte-identity violated by initial Task 3 commit**
- **Found during:** Full test suite regression check after Task 4.
- **Issue:** Task 3 commit `ed8a8d4` wrapped the canonical-dispatch refusal
  in an if/else for the bypass branch, moving `dispatchCheck` to 8-space
  indent — broke test/preview-send.solana.test.ts "FROZEN EVM body
  byte-identity (LOAD-BEARING)" snippet pin (Plan 12-04 lock).
- **Fix:** Refactored to use `const escapeHatchBypassActive` flag ABOVE the
  EVM Layer 0.5 block; kept the inner `if (record.tx.data !== "0x") { ... }`
  body byte-identical to the pre-12-04 base. dispatchCheck still runs
  (cheap); refusal arm short-circuited via `&& !escapeHatchBypassActive`.
  Semantically equivalent. Updated test/preview-send.custom-call.test.ts
  "bypass fires" assertion to check refusal envelope absence rather than
  dispatchSpy invocation count.
- **Files modified:** src/tools/preview_send.ts, test/preview-send.custom-call.test.ts
- **Commit:** `c378a8e`

### Documented Plan-Spec Deviations

- **`peekEtherscanAbiCache` helper not added** — Plan 35-01 already exposed
  `getCachedEtherscanAbi` with the same cache-only-no-network contract.
  Used directly. Documented as the cache-hit-only path consumer.
- **PATTERNS.md Fixture P address had 42 hex chars** — bug in the plan
  template; trimmed two zeros to make a valid 40-char EVM address.
  Documented above in "Fixture P Captured Literal" so future cross-links
  use the corrected value.
- **NON_VIEW_FUNCTION not present in this worktree** — Plan 35-02 hasn't
  landed; per executor prompt instructions, append `NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED`
  where the plan says (cherry-pick at merge will reconcile).
- **`peekEtherscanAbiCache` export rename to `getCachedEtherscanAbi`** — the
  plan's task 3 mentioned `peekEtherscanAbiCache` as a possible new export;
  35-01 chose `getCachedEtherscanAbi` for the same shape. Cross-referenced
  in preview_send.ts import; no functional difference.

## Threat Mitigations Implemented

- **T-35-03-A (Tampering — calldata drift between prepare and send):** Integration test Test 8 tampers with `record.tx.data` between prepare and send → triggers PAYLOAD_FINGERPRINT_DRIFT. FROZEN Layer 3 gate fires.
- **T-35-03-B (Elevation of Privilege — agent crafts a custom call without surfacing the bypass nature):** Schema-level literal-true gate + handler-level canonical-alternative refusal + WARN block in BOTH prepare and preview (defense-in-depth).
- **T-35-03-C (Elevation of Privilege — different prepare_* tool sets the bypass flag):** Grep-guard test asserts EXACTLY 2 source-file assignment sites; comment lines + string-literal lines filtered out.
- **T-35-03-F (Tampering — bypass leaks into non-EVM dispatch sites):** Pitfall 1 grep-guard test asserts EXACTLY 1 non-comment read of `record.acknowledgeNonProtocolTarget` in preview_send.ts.
- **T-35-03-G (Tampering — WARN block text drifts between prepare and preview):** Format-fanout-sentinel pattern (single SOT template in blocks.ts); integration test Test 3 asserts byte-identical immutable body lines.
- **T-35-03-H (Denial of Service — preview-time ABI cache lookup triggers network round-trip):** Used `getCachedEtherscanAbi` (cache-only API; no network).

## Self-Check: PASSED

- [x] `src/security/canonical-alternatives.ts` exists with CANONICAL_ALTERNATIVES export
- [x] `lookupCanonicalAlternative` exported; `_canonicalAlternatives` ESM spy-affordance
- [x] `src/tools/prepare_custom_call.ts` exists; registers via `registerTool`
- [x] JSON-Schema literal-true gate present (`const: true`)
- [x] Fixture P literal in `test/signing-fingerprint.test.ts`
- [x] `test/integration/escape-hatch.test.ts` exists with ≥7 describe/it blocks (65 tests)
- [x] All grep guards pass
- [x] FROZEN-area zero-diff vs origin/main
- [x] Full test suite green (4532 passing / 1 skipped; +178 from baseline)
- [x] Typecheck clean

**Commits in this plan (5 atomic; 4 task commits + 1 Rule 1 fix):**
- `11365b2` feat(35-03): canonical-alternatives table + 3 blocks templates + handle-store escape-hatch fields + NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED (Task 1)
- `3c2de23` feat(35-03): prepare_custom_call tool + Fixture P literal + register-all wiring (Task 2)
- `ed8a8d4` feat(35-03): preview_send EVM-only canonical-dispatch bypass + custom-call DECODED ARGS arm (Task 3)
- `6be7bba` test(35-03): escape-hatch lifecycle integration + grep guards + v2.4 milestone close-out (Task 4)
- `c378a8e` fix(35-03): preserve FROZEN EVM-body byte-identity in preview_send Layer 0.5 [Rule 1]
