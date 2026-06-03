---
phase: 47
plan: 02
subsystem: tools
tags: [bittensor, prepare-tools, staking, slippage-guard, extrinsic-builder]
requires: ["47-01"]
provides:
  - buildBittensorUnsignedTx (extrinsic-builder)
  - prepare_bittensor_native_send (TAO-W-01)
  - prepare_bittensor_add_stake_limit (TAO-W-02, DEFAULT entry)
  - prepare_bittensor_remove_stake_limit (TAO-W-03, DEFAULT exit)
  - blocks-bittensor templates
affects:
  - src/signing/handle-store.ts (additive PrepareArgs fields)
  - src/tools/register-all.ts (3 additive imports)
tech-stack:
  added: []
  patterns: [sibling prepare-tool, demo-FIRST refusal, _bittensorBuilder spy seam, chain-derived limit_price]
key-files:
  created:
    - src/chains/bittensor/extrinsic-builder.ts
    - src/signing/blocks-bittensor.ts
    - src/tools/prepare_bittensor_native_send.ts
    - src/tools/prepare_bittensor_add_stake_limit.ts
    - src/tools/prepare_bittensor_remove_stake_limit.ts
    - test/_helpers/mock-bittensor-api.ts
    - test/prepare-bittensor-native-send.test.ts
    - test/prepare-bittensor-add-stake-limit.test.ts
    - test/prepare-bittensor-remove-stake-limit.test.ts
  modified:
    - src/signing/handle-store.ts
    - src/tools/register-all.ts
decisions:
  - "OQ-1: limit_price is a worst-acceptable RAO-per-alpha PRICE; add=ceiling (price+tol), remove=floor (price−tol)"
  - "OQ-2: unsigned dry-run ADVISORY (deferred to 47-03), never a hard refusal"
  - "D-MD: mode:0 pinned for v2.7 GA unit scope; mode:1 offline-merkleize wired-but-gated"
metrics:
  duration: ~30min
  completed: 2026-06-03
---

# Phase 47 Plan 02: Bittensor Prepare Tools Summary

Three user-facing prepare tools (native TAO send + DEFAULT slippage-guarded add/remove stake_limit) on the Plan 47-01 binding core, plus the `extrinsic-builder` (unsigned-tx + signableBlob + chain-derived limit_price) and the `blocks-bittensor` receipt templates.

## What was built

- **`extrinsic-builder.ts`** — `buildBittensorUnsignedTx(input)` discriminated on `native | add-stake-limit | remove-stake-limit`. Builds `api.tx.<section>.<method>`, derives `limitPrice` from `simSwapTaoForAlpha`/`simSwapAlphaForTao` + `currentAlphaPrice` via tolerance haircut (NEVER client x·y=k), pins the full `SignerPayloadJSON`, computes `signableBlob = registry.createType("ExtrinsicPayload",...).toU8a({method:true})`. `_bittensorBuilder` spy seam for chain-hash injection. All api access through `_bittensorRegistry`.
- **`blocks-bittensor.ts`** — PREPARE RECEIPT (native/add/remove), LEDGER BLIND-SIGN HASH (Bittensor, blake2-256), DECODED ARGS, VERIFY templates. Per-extrinsic unit labels: add = "TAO/RAO", remove = "ALPHA".
- **3 prepare tools** — demo-FIRST refusal (zero registry calls in demo branch), SS58 + netuid-u16 validation, pairing gate, fingerprint over signableBlob, `PreparedTxBittensor` handle with section/method camelCase, full hotkey SS58 unredacted.
- **`handle-store` PrepareArgs** — additive `rao`/`alpha`/`hotkey`/`netuid` raw-string fields.
- **`register-all`** — 3 additive side-effect imports.
- **Shared mock** `test/_helpers/mock-bittensor-api.ts` — derived from the live probe shapes; NO live socket.

## Open-question resolutions (with evidence)

- **OQ-1 (limit_price direction):** RESOLVED. `currentAlphaPrice(netuid)` is RAO-per-alpha (1e9-scaled, per tao-rpc-client ALPHA_PRICE_SCALE, live-resolved 2026-06-03). `limitPrice` is a worst-acceptable PRICE: `add_stake_limit` (buy alpha) → CEILING `price × (1 + tol)`; `remove_stake_limit` (sell alpha) → FLOOR `price × (1 − tol)`. Falsifier: a wrong direction inverts the guard. Encoded as `applyToleranceToPrice(..., "ceiling"|"floor")` with a documented constant block. Tests assert both directions (1% ceiling → ×1.01, 1% floor → ×0.99). Small-mainnet confirmation is the v2.7 verify-phase.
- **OQ-2 (dry-run posture):** RESOLVED. ADVISORY (EVM-style), not a hard refusal — deferred to `simulation-bittensor.ts` (Plan 47-03). The builder never blocks on a sim outcome. Evidence: chain-enforced CheckMetadataHash + on-device blake2 hash match are the real anchors (47-RESEARCH §Probe 4).
- **A5 (addSignature payload-arg form):** deferred to Plan 47-04 (send assembly) — not exercised by prepare.

## Tasks completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | extrinsic-builder + blocks-bittensor | 2fbc5a9 | 2 files |
| 2 | prepare_bittensor_native_send + test | 2fbc5a9 | tool + test + mock |
| 3 | add/remove stake_limit + register-all + tests | 2fbc5a9 | 2 tools + register-all + 2 tests |

## Deviations from Plan

- handle-store `PrepareArgs` widened with `rao`/`alpha`/`hotkey`/`netuid` raw-string fields (Rule 3 — blocking issue: `PrepareArgs` didn't carry a `rao` field, tsc-blocking). Additive only; existing fields byte-unchanged.

## Verification

- `npx tsc --noEmit` — RC=0
- `npx vitest run` prepare-bittensor-{native,add,remove} — 10 passed
- Full sweep (fingerprint + presign + 3 prepare + EVM send-transaction) — 46 passed
- FROZEN zero-diff (EVM/Solana/TRON binding + send_transaction) — clean
- register-all + handle-store — additive-only

## Self-Check: PASSED

- FOUND: extrinsic-builder.ts, blocks-bittensor.ts, 3 prepare tools, mock helper, 3 tests
- FOUND: commit 2fbc5a9
