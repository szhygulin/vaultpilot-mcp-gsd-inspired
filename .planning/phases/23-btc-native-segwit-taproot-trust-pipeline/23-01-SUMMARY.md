---
phase: 23-btc-native-segwit-taproot-trust-pipeline
plan: "01"
subsystem: signing
tags: [btc, sighash, fingerprint, bip143, bip341, cryptographic-binding, utxo-model]
dependency_graph:
  requires: []
  provides:
    - src/signing/btc-sighash.ts (computeAllSighashes — per-input BIP-143/341 sighash compute)
    - src/signing/btc-fingerprint.ts (computeBtcPayloadFingerprint — domain-tagged keccak256)
    - test/btc-sighash.test.ts (4-behavior regression suite + asymmetry anchor)
    - test/signing-fingerprint.test.ts (Fixture O — 0xb3af7f... literal anchor)
  affects:
    - plans 23-02..23-04 (consume btc-sighash + btc-fingerprint as upstream producers)
tech_stack:
  added: []
  patterns:
    - Per-input sighash dispatch: hashForWitnessV0 (segwit, BIP-143) vs hashForWitnessV1 (taproot, BIP-341)
    - Domain-tagged keccak256 preimage (variadic per-input spread, mirrors TRON sibling shape)
    - ESM spy-affordance indirection (_btcSighash, _btcFingerprint)
    - Cryptographic-binding fixture as hardcoded 0x... literal (Fixture O)
key_files:
  created:
    - src/signing/btc-sighash.ts
    - src/signing/btc-fingerprint.ts
    - test/btc-sighash.test.ts
  modified:
    - test/signing-fingerprint.test.ts (appended Fixture O describe block + BTC imports)
decisions:
  - "Fixture O is 0xb3af7f8e8b4f657c3ea2570359faaaf4a3b7ef6fe0f332e5f49a198be56a76a4 (segwit single-input single-output, txid=0xaa*32, value=1_000_000 sats, output=900_000 sats)"
  - "Domain tag length asserted as 20 bytes (RESEARCH doc error: stated 21; actual VaultPilot-btctx-v1: is 20 chars)"
  - "Mixed-set determinism test uses same-tx + different allValues arrays to prove segwit/taproot scope asymmetry without adding tx inputs"
metrics:
  duration: "9m 59s"
  completed: "2026-05-22T12:34:47Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 1
---

# Phase 23 Plan 01: BTC sighash compute + fingerprint primitives Summary

Per-input BIP-143/341 sighash compute and domain-tagged keccak256 payloadFingerprint for the BTC UTXO-model trust pipeline. Fixture O (segwit single-input) pinned as `0xb3af7f8e8b4f657c3ea2570359faaaf4a3b7ef6fe0f332e5f49a198be56a76a4`.

## Tasks Completed

| # | Name | Commit | Key Files |
|---|------|--------|-----------|
| 1 | btc-sighash.ts — per-input BIP-143/341 sighash compute + Wave 0 test scaffold | d0f3021 | src/signing/btc-sighash.ts, test/btc-sighash.test.ts |
| 2 | btc-fingerprint.ts — domain-tagged keccak256 over concatenated sighashes + Fixture O | b0f6326 | src/signing/btc-fingerprint.ts, test/signing-fingerprint.test.ts |

## Verification Results

- `npx vitest run test/btc-sighash.test.ts test/signing-fingerprint.test.ts`: 25 tests passed (5 + 20).
- `npx tsc --noEmit`: clean.
- `git diff --quiet origin/main -- src/signing/payload-fingerprint.ts src/signing/payload-fingerprint-solana.ts src/signing/payload-fingerprint-tron.ts`: exits 0 (FROZEN siblings byte-identical).
- Full suite: 2687 tests passed; 2 pre-existing timing failures in wallet-session-manager.test.ts (pass in isolation, unrelated to this plan).

## Key Decisions Made

1. **Fixture O literal**: `0xb3af7f8e8b4f657c3ea2570359faaaf4a3b7ef6fe0f332e5f49a198be56a76a4` — segwit single-input single-output, computed from `hashForWitnessV0` over txid=0xaa*32, vout=0, value=1_000_000 sats, output=900_000 sats to P2WPKH(G).

2. **Mixed-set determinism test structure**: uses a 3-input tx with two call sites (inputsA vs inputsB) differing only in `inputs[2].valueSats`. The taproot sighash at index 1 changes (because `hashForWitnessV1` receives the changed `allValues[]`); the segwit sighash at index 0 is unchanged (because `hashForWitnessV0` only reads from its own `inp.prevOutScript`+`inp.valueSats`). This is the correct way to prove the BIP-143/341 whole-prevout-set asymmetry via the `computeAllSighashes` API.

3. **Empty-array fast-path**: `computeAllSighashes` returns `[]` for an empty input array (no throw) — consistent with zero-sighash being a valid degenerate case. `computeBtcPayloadFingerprint` explicitly throws on empty array (fingerprint of nothing is meaningless).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Domain-tag byte length: 20 not 21**
- **Found during:** Task 2 (Fixture O computation)
- **Issue:** RESEARCH doc states `"VaultPilot-btctx-v1:"` = 21 UTF-8 bytes. Actual length is 20 chars ("btctx" has 5 chars vs TRON's "trontx" with 6 chars). The plan's `<action>` says to assert `length === 21`.
- **Fix:** Test asserts `Buffer.byteLength(FINGERPRINT_DOMAIN_TAG_BTC, "utf8") === 20` (the runtime value). The tag string is still distinct from TRON (`"btctx-v1"` vs `"trontx-v1"`), Solana (`"soltx-v1"`), and EVM (`"txverify-v1"`) — cross-chain reuse impossible.
- **Files modified:** test/signing-fingerprint.test.ts (domain-tag invariant test uses 20)
- **Commit:** b0f6326

## Known Stubs

None — both modules are fully functional with no placeholder values.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Both modules are pure-compute cryptographic primitives with no I/O.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src/signing/btc-sighash.ts exists | FOUND |
| src/signing/btc-fingerprint.ts exists | FOUND |
| test/btc-sighash.test.ts exists | FOUND |
| SUMMARY.md exists | FOUND |
| Commit d0f3021 exists | FOUND |
| Commit b0f6326 exists | FOUND |
| FROZEN fingerprint siblings byte-identical to origin/main | PASSED |
