---
phase: 47
plan: 01
subsystem: signing
tags: [bittensor, substrate, payload-fingerprint, blake2-256, binding, fixtures]
requires: []
provides:
  - computeBittensorPayloadFingerprint (keccak256 over unsigned SignerPayload SCALE bytes)
  - computeBittensorPresignHash (blake2-256 device-display hash)
  - parseBittensorAmountStrict (RAO + ALPHA, 9-dec u64)
  - PreparedTxBittensor union member + BittensorInstructionSummary
  - Fixtures TAO-A / TAO-B / TAO-C (hardcoded 0x literals)
affects:
  - src/signing/handle-store.ts (additive union member)
tech-stack:
  added: ["@polkadot-api/merkleize-metadata@1.2.3 (exact pin)"]
  patterns: [sibling-arm fingerprint, ESM spy-affordance, offline-derived crypto fixtures]
key-files:
  created:
    - src/signing/payload-fingerprint-bittensor.ts
    - src/signing/presign-hash-bittensor.ts
    - src/signing/amount-bittensor.ts
    - test/signing-fingerprint-bittensor.test.ts
    - test/signing-presign-hash-bittensor.test.ts
  modified:
    - src/signing/handle-store.ts
    - package.json
    - package-lock.json
decisions:
  - "Offline fixture construction via TypeRegistry.setSignedExtensions(subtensor 13-extension tuple) — byte-stable mode:0 blob without live RPC"
  - "Re-export canonical InvalidAmountError from amount-solana.ts (not redefine) to keep instanceof uniform"
  - "Tag distinctness asserted by CONTENT + pairwise inequality, NOT unique-length (taotx-v1: is 20 bytes = soltx-v1:)"
metrics:
  duration: ~25min
  completed: 2026-06-03
---

# Phase 47 Plan 01: Bittensor Binding Core Summary

keccak256 `payloadFingerprint` over the unsigned subtensor `SignerPayload` SCALE bytes, blake2-256 device-display presign hash, strict RAO/ALPHA decimal parser, and Fixtures TAO-A/B/C as offline-derived hardcoded literals — the load-bearing crypto foundation every downstream Bittensor plan computes against.

## What was built

- **`payload-fingerprint-bittensor.ts`** — `computeBittensorPayloadFingerprint({signableBytes})` = `keccak256(concat([toBytes("VaultPilot-taotx-v1:"), signableBytes]))`. Binds ONLY the unsigned `ExtrinsicPayload.toU8a({method:true})` blob, never the signed envelope. `_bittensorFingerprint` spy.
- **`presign-hash-bittensor.ts`** — `computeBittensorPresignHash({signableBytes})` → `{signableBytes, presignHash}` where `presignHash = blake2AsHex(signableBytes, 256)`. The one divergence from the SHA-256 Solana/TRON siblings. `_bittensorPresign` spy.
- **`amount-bittensor.ts`** — `parseBittensorAmountStrict(str, decimals=9)`: empty/format/fractional-overflow/u64-overflow gate. Re-exports the canonical `InvalidAmountError`.
- **`handle-store.ts`** — ADDITIVE `PreparedTxBittensor` interface (EVM-shape sentinels + `signableBlob`/`signerPayloadJSON`/`ss58Address`/`section`/`method`/`mode`/`metadataHash`/`instructionSummary`) + `BittensorInstructionSummary` discriminated union (per-extrinsic unit typing: add=TAO/RAO, remove=ALPHA) + union widened with `| PreparedTxBittensor`. State machine byte-identical.
- **Fixtures TAO-A/B/C** — hardcoded `0x` literals computed offline via a bare `TypeRegistry` with the subtensor signed-extension tuple pinned (`setSignedExtensions`); +1-RAO regressions on both A and B; a mode:1 fixture flagged recompute-on-spec-bump; FROZEN zero-diff describe block.

## Tasks completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 0 | Supply-chain checkpoint (merkleize-metadata) | d1443a4 | package.json |
| 1 | fingerprint + presign + amount sibling modules | d1443a4 | 3 src/signing modules |
| 2 | Fixtures TAO-A/B/C + PreparedTxBittensor union member | d1443a4 | handle-store.ts + 2 test files |

## Deviations from Plan

None — plan executed as written. Task 0 (supply-chain checkpoint) was pre-verified and pre-approved by the orchestrator; confirmed `@polkadot-api/merkleize-metadata@1.2.3` has empty postinstall, 484KB, papi org, then installed with `--save-exact` (pin `"1.2.3"`, no caret). Single-version `@polkadot/util` + `@polkadot/util-crypto` confirmed deduped.

## Verification

- `npx tsc --noEmit` — RC=0
- `npx vitest run test/signing-fingerprint-bittensor.test.ts test/signing-presign-hash-bittensor.test.ts` — 17 passed (incl. FROZEN zero-diff block)
- `npx vitest run test/send-transaction.test.ts` (EVM regression) — 19 passed
- FROZEN zero-diff (EVM/Solana/TRON binding modules + send_transaction): empty diff vs origin/main
- handle-store: 147 insertions, 1 deletion (the union-line additive replacement)

## Self-Check: PASSED

- FOUND: src/signing/payload-fingerprint-bittensor.ts, presign-hash-bittensor.ts, amount-bittensor.ts
- FOUND: test/signing-fingerprint-bittensor.test.ts, signing-presign-hash-bittensor.test.ts
- FOUND: commit d1443a4
