---
phase: 14-solana-jupiter-swaps
plan: 02
subsystem: solana-jupiter
tags: [jupiter, solana, swap, prepare-tool, mev, frozen-binding, blind-sign]
requires:
  - "14-01: src/clients/jupiter.ts (_jupiter getQuote + getSwapTransaction)"
  - "14-01: getJupiterV6Program() SOT + SOLANA_DISPATCH_ALLOWLIST (Jupiter + ComputeBudget)"
  - "14-01: test/fixtures/jupiter-swap-legacy.b64.ts (the SINGLE shared fixture — imported, not copied)"
  - "FROZEN: computeSolanaPayloadFingerprint (unchanged) + createHandle + preview_send Solana branch"
provides:
  - "src/protocols/jupiter.ts — legacy-tx deserialize + top-level program enumeration + v0 anti-pattern guard (_jupiter ESM seam)"
  - "src/tools/prepare_jupiter_swap.ts — SOL-W-12/13 prepare tool (demo-FIRST, MEV refusal, FROZEN binding, size-overflow hard refusal, blind-sign)"
  - "Fixture Z — Jupiter swap fingerprint hardcoded literal in test/signing-fingerprint-solana.test.ts"
affects:
  - "src/tools/register-all.ts (wiring)"
  - "test/preview-send.solana.test.ts (stale Jupiter-deferral canary swapped to an unknown program — Rule 1)"
tech-stack:
  added: []
  patterns:
    - "third-party-tx → FROZEN binding (serializeMessage bytes through computeSolanaPayloadFingerprint UNCHANGED)"
    - "v0/VersionedTransaction anti-pattern guard (typed JupiterV0TransactionError; NEVER silent v0 bytes)"
    - "MEV refusal gate (priceImpactPct*100 > 2% AND slippage not explicit → SANDWICH_MEV_REFUSED, no handle)"
    - "size-overflow HARD refusal (no v0 fallback)"
    - "economics surfaced from the QUOTE, not the opaque tx"
key-files:
  created:
    - src/protocols/jupiter.ts
    - src/tools/prepare_jupiter_swap.ts
    - test/protocols-jupiter.test.ts
    - test/prepare-jupiter-swap.test.ts
  modified:
    - src/tools/register-all.ts
    - test/signing-fingerprint-solana.test.ts
    - test/preview-send.solana.test.ts
decisions:
  - "instructionSummary omitted from createHandle (SolanaInstructionSummary union is closed to native/spl; jupiter summary is internal-only). Only programIds is load-bearing for Layer-0.5 — mirror of prepare_marginfi_supply."
  - "Added a defense-in-depth feePayer-match assertion: the Jupiter-built tx feePayer must equal the resolved paired wallet, else refuse (tamper signal)."
  - "v0 detection uses the message-header high-bit (0x80) after the shortvec signature count, with a VersionedTransaction.deserialize belt-and-suspenders probe — VersionedTransaction is imported ONLY for the refusal-detection path, never a .deserialize() success path that yields v0 bytes."
metrics:
  duration: "~35m"
  completed: 2026-06-04
  tasks: 3
  files: 7
---

# Phase 14 Plan 14-02: prepare_jupiter_swap Summary

`prepare_jupiter_swap` (SOL-W-12/13) binds + gates a swap transaction a THIRD PARTY (Jupiter) constructed — legacy deserialize → FROZEN `computeSolanaPayloadFingerprint` UNCHANGED → MEV refusal gate → 1232-byte size-overflow HARD refusal (no v0 fallback) → CHECKS PERFORMED from the quote → blind-sign LEDGER NOTICE. Fixture Z anchors the swap fingerprint; the FROZEN signing/send files show a zero diff against origin/main.

## What shipped

- **`src/protocols/jupiter.ts`** — `deserializeJupiterSwapTx(b64)`: `Transaction.from()` LEGACY deserialize → `new Uint8Array(tx.serializeMessage())` (the EXACT FROZEN preimage; tx NOT mutated) → de-duped TOP-LEVEL `programIds` (inner CPI DEX hops NOT enumerated) + minimal `kind:"jupiter"` summary. **v0 anti-pattern guard**: `isVersionedTransaction()` checks the message-header high-bit (0x80) after the shortvec signature count, with a `VersionedTransaction.deserialize` belt-and-suspenders probe; a v0 tx → `JupiterV0TransactionError` (typed) → caller emits a structured refusal — NEVER silent v0 bytes. `_jupiter` ESM seam.
- **`src/tools/prepare_jupiter_swap.ts`** (SOL-W-12/13) — input validation (base58 mints, base-unit amount, slippageBps bounds, same-token refusal) → **demo-FIRST** refusal (WRONG_MODE / WALLET_NOT_PAIRED exactly as the SPL tool) → re-quote → **MEV REFUSAL GATE** (`Number(priceImpactPct)*100 > 2.0%` AND slippage NOT explicit → `SANDWICH_MEV_REFUSED`, NO handle, /swap never called) → POST /swap (VERBATIM quoteResponse) with a **size-overflow HARD refusal** (no v0 fallback) → legacy deserialize (v0 → refusal) → **FROZEN `computeSolanaPayloadFingerprint`** → `createHandle` (RAW args; solana-typed tx with top-level `programIds` for Layer-0.5) → PREPARE RECEIPT (verbatim) + CHECKS PERFORMED (From/To/Price-impact/Route from the **QUOTE**, symbols via the curated registry) + blind-sign LEDGER NOTICE; `blindSign:true`.
- **Fixture Z** in `test/signing-fingerprint-solana.test.ts` — hardcoded literal `0x6d14fb2164f56333cc15386d8ca1943d86458473f14526439baf2cffba459550` over the pinned swap message bytes (NO beforeAll-snapshot) + a single-byte-flip embedding regression. Cross-linked to the prepare + protocols tests.

## FROZEN-zero-diff gate (directive 8) — PASSED

```
git diff --stat origin/main -- src/tools/send_transaction.ts src/signing/payload-fingerprint.ts \
  src/signing/payload-fingerprint-solana.ts src/signing/presign-hash.ts \
  src/signing/presign-hash-solana.ts src/signing/handle-store.ts
```
→ EMPTY. The third-party swap tx flows through the UNCHANGED Phase-12 trust primitives.

## Final top-level program set (the swap decode emits)

`{ ComputeBudget, AssociatedToken, System, SPL-Token, Jupiter v6 }` — identical to the 14-01 enumeration (same imported fixture bytes; the prepare handle stores all 5 in `tx.programIds` for the Layer-0.5 gate).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Swapped a stale Jupiter-deferral canary in test/preview-send.solana.test.ts**
- **Found during:** full-suite final gate (1 failure: a preview_send test expected `DISPATCH_TARGET_REFUSED` for Jupiter v6).
- **Issue:** That test used Jupiter v6 as the "non-allowlisted program that refuses at Layer 0.5" canary (comment: "Phase 14 Jupiter deferral"). 14-01 correctly ADDED Jupiter v6 to the allowlist (ROADMAP SC #5), so the canary became stale — a regression DIRECTLY caused by this phase's allowlist extension.
- **Fix:** Swapped the canary to a genuinely-unknown program ID (`EvilProgram111…`), preserving the test's intent (a non-allowlisted program still refuses with verbatim offenders + simulation never called).
- **Files modified:** test/preview-send.solana.test.ts
- **Commit:** (this plan's commit)

### Design note (not a deviation)

- `instructionSummary` is NOT passed to `createHandle` — the closed `SolanaInstructionSummary` union (native/spl only) does not include a `jupiter` kind, and the economics surface comes from the QUOTE, not the summary. Only `programIds` is load-bearing for the Layer-0.5 dispatch gate. This mirrors `prepare_marginfi_supply` exactly.

## Verification

- `npx vitest run test/protocols-jupiter.test.ts test/prepare-jupiter-swap.test.ts test/signing-fingerprint-solana.test.ts test/canonical-dispatch-solana.test.ts` → all green.
- FROZEN zero-diff → EMPTY.
- `grep "VersionedTransaction" src/protocols/jupiter.ts src/tools/prepare_jupiter_swap.ts` → only inside the anti-pattern guard / refusal-detection path; never a `.deserialize()` success path producing v0 bytes.
- `grep "JUP6Lkb…" src/protocols/jupiter.ts src/tools/prepare_jupiter_swap.ts` → empty (program ID via the SOT getter only).
- Full suite: 398 files, 5702 passed, 1 skipped, 0 failed.
- demo=true: prepare/quote tests pass under `VAULTPILOT_DEMO=true` (17/17) — the env-pin defends the Phase-13 auto-demo CI-failure class.
- `npx tsc --noEmit` → zero errors.
