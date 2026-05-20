---
phase: 18-tron-native-trc20-trust-pipeline
plan: 18-02
subsystem: prepare-tools
tags: [tron, prepare, native-transfer, fingerprint, fixture-m, tron-w-01]
dependency_graph:
  requires:
    - 18-01 (PreparedTxTron + _tronFingerprint + parseTronAmountStrict + PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE)
  provides:
    - src/protocols/tron-native.ts (encodeTronTransfer, decodeTronNativeCall, _tronNative)
    - src/tools/prepare_tron_native_send.ts (MCP tool — TRON-W-01 surface)
    - src/tools/register-all.ts (+1 line — import prepare_tron_native_send.js)
  affects:
    - src/tools/register-all.ts (additive 1-line)
tech_stack:
  added:
    - tronweb@6.3.0 transactionBuilder.sendTrx + transactionBuilder.extendExpiration (consumed)
    - tronweb@6.3.0 utils.address.isAddress (input validation gate)
  patterns:
    - encodeTronTransfer: sendTrx + extendExpiration(tx, 900) LOAD-BEARING expiration extension
    - Overflow guard: sun > Number.MAX_SAFE_INTEGER → RangeError (TRON uses number, not bigint)
    - _tronNative ESM spy-affordance (mirror of _solanaSystem in protocols/solana-system.ts)
    - Fixture M consumer re-anchor (load-bearing redundancy per CLAUDE.md + CONTEXT D-08d)
    - Demo-mode FIRST refusal pattern (mirrors Solana tool's getActiveSolanaPersona FIRST)
    - Format-fanout sentinel: PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE substitution only
key_files:
  created:
    - src/protocols/tron-native.ts
    - src/tools/prepare_tron_native_send.ts
    - test/protocols-tron-native.test.ts
    - test/prepare-tron-native-send.test.ts
  modified:
    - src/tools/register-all.ts (+1 line)
decisions:
  - D-01 (TRON fingerprint preimage = keccak256(domain_tag ‖ raw_data_bytes) — consumed here at prepare time)
  - D-06 (ref-block read at prepare time; expiration extended to 900s via extendExpiration(tx, 900))
  - D-08 (Fixture M consumer re-anchor in test/prepare-tron-native-send.test.ts — literal 0xaa8305...ffd4fa)
  - TRON input validation via tronweb.utils.address.isAddress (RESEARCH §Topic 6 lock — no hand-rolled base58check)
metrics:
  duration: ~45 minutes
  completed: 2026-05-20T16:04:10Z
  tasks_completed: 5
  files_created: 4
  files_modified: 1
  tests_added: 40
  tests_total: 1967
---

# Phase 18 Plan 02: `prepare_tron_native_send` + TRON Native Protocol Encoder/Decoder + Fixture M Consumer Re-anchor Summary

`prepare_tron_native_send` MCP tool (TRON-W-01) with TransferContract Protobuf encoder, decodeTronNativeCall decoder, and Fixture M consumer re-anchor; `extendExpiration(tx, 900)` load-bearing expiration extension guards against handle-older-than-60s broadcast failures.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | src/protocols/tron-native.ts — encodeTronTransfer + decodeTronNativeCall + _tronNative | 2a3132e |
| 2 | src/tools/prepare_tron_native_send.ts — TRON-W-01 MCP prepare tool | 6c038fd |
| 3 | src/tools/register-all.ts — +1 line: import prepare_tron_native_send.js | 883ac43 |
| 4 | test/protocols-tron-native.test.ts — encoder + decoder + overflow + ESM spy (18 tests) | f1bfe54 |
| 5 | test/prepare-tron-native-send.test.ts — Fixture M re-anchor + full coverage (22 tests) | 20890eb |

## Fixture M Consumer Re-anchor

**Load-bearing redundancy per CLAUDE.md fixture discipline + CONTEXT D-08d.**

`test/prepare-tron-native-send.test.ts` rebuilds the prepare-time TX via the mock encoder (pinning Fixture M `raw_data_hex`), re-computes the fingerprint through the full tool pipeline, and asserts:

```
payloadFingerprint === "0xaa8305509481b97e50acb9e4d582bb53a1db1c99f9c357febe1fbf7389ffd4fa"
```

Drift in preimage assembly fails at BOTH:
1. `test/signing-fingerprint-tron.test.ts:Fixture M` (Plan 18-01 anchor)
2. `test/prepare-tron-native-send.test.ts:Fixture M consumer re-anchor` (this plan)

## Load-bearing Decisions

### `extendExpiration(tx, 900)` LOAD-BEARING (RESEARCH §Topic 5)

`encodeTronTransfer` always calls `transactionBuilder.extendExpiration(tx, 900)` after `sendTrx` returns. Without this, tronweb's default expiration is `block_timestamp + 60_000ms` (60 seconds). A user who pauses between prepare and send for >60s would receive `BROADCAST_FAILED: TRANSACTION_EXPIRATION_ERROR`. The extension sets expiration to `block_timestamp + 960_000ms` (≈ 16 min), matching `HANDLE_TTL_MS`.

Regression: `test/protocols-tron-native.test.ts` asserts `extendExpiration` is called exactly once with second arg `900`.

### Overflow guard

`encodeTronTransfer` checks `sun > Number.MAX_SAFE_INTEGER` before calling `Number(sun)`. `tronweb.transactionBuilder.sendTrx` takes `number` (not bigint); without the guard, passing `2^64` would silently truncate. The guard throws `RangeError` before tronweb is called.

### Input validation order: INVALID_INPUT FIRES FIRST

`to` is validated via `tronUtils.address.isAddress` before any state read (demo/real mode check, listAccounts). `sun` is validated via `parseTronAmountStrict(sun, 0, "u64")` before any RPC call. This ordering means bad inputs return `INVALID_INPUT` regardless of mode state — the test suite asserts this holds even in demo mode without an active persona.

## Deviations from Plan

None — plan executed exactly as written. The decoder's `decodeTronNativeCall` handles the deviation-rule-3 edge case (JSON-stringified `parameter.value` from some tronweb versions) via a `try/catch JSON.parse` path that returns `{ kind: "unknown" }` on any failure.

## Test Results

- **New tests added:** 40 (18 in protocols-tron-native + 22 in prepare-tron-native-send)
- **Total tests:** 1967 (all pass)
- **Full suite:** `npm test` — 1967 passed, 0 failed
- **Build:** `npm run build` — clean (no errors)
- **Typecheck:** `npm run typecheck` — clean (no errors)
- **FROZEN-area assertion:** `git diff origin/main -- [frozen files]` — empty (zero modifications)
- **register-all.ts diff:** exactly 1 insertion

## Known Stubs

None — this plan ships the full prepare tool + encoder + decoder + tests. Plan 18-04 wires the `preview_send` TRON branch and `send_transaction` simulation path that consume these artifacts.

## Self-Check: PASSED

All 4 new files created at correct paths. register-all.ts has exactly 1 insertion. Commits verified in git log. FROZEN area byte-untouched. Full suite 1967/1967 green.
