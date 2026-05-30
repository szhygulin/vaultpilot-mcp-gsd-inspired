---
phase: 43
plan: 01
subsystem: protocols/curve
tags: [curve, add_liquidity, stableswap, legacy-abi, fixed-array, eth-in, payable]
requires: [curve-stable_ng-add-liquidity, payload-fingerprint, curve-registry, preview_send]
provides: [curve-legacy-add-liquidity, curve-legacy-decoder, curve-legacy-fingerprint]
affects: [src/chains/curve.ts, src/protocols/curve.ts, src/tools/prepare_curve_add_liquidity.ts, src/tools/preview_send.ts]
tech-stack:
  added: []
  patterns: [abiVersion-dispatch, ESM-spy-affordance, cryptographic-binding-fixtures, tuple-dispatch-decode]
key-files:
  created: []
  modified:
    - src/chains/curve.ts
    - src/protocols/curve.ts
    - src/tools/prepare_curve_add_liquidity.ts
    - src/tools/preview_send.ts
    - test/signing-fingerprint.test.ts
    - test/protocols-curve.test.ts
    - test/prepare-curve-add-liquidity.test.ts
    - test/preview-send-curve.test.ts
decisions:
  - D-01: fixed uint256[2] legacy ABI (separate shelf), not the dynamic uint256[] NG reader
  - D-02: selector 0x0b4c7e4d for add_liquidity(uint256[2],uint256); distinct from stable_ng 0xb72df5de
  - D-03: ETH-in (coin0 sentinel, amounts[0]>0) sets valueWei === amounts[0]; else valueWei = 0n
  - D-04: approval pre-flight skips the ETH-sentinel coin (no ERC20.allowance read on 0xEeee…)
  - D-05: Fixtures CRV-D (ETH-in) + CRV-E (stETH-only) pinned as hardcoded literals
  - D-06: preview_send additive-only; FROZEN signing/send chain zero-diff
metrics:
  duration: "phase build (prior executor) + remediation pass (this run)"
  completed: "2026-05-30"
---

# Phase 43 Plan 01: Curve legacy add_liquidity (fixed uint256[2] StableSwap, ETH-in @payable) Summary

Lifts the Phase 34 deferral: `prepare_curve_add_liquidity` now accepts the legacy stETH/ETH pool (`0xDC24316b9AE028F1497c275EB9192a3Ea0f67022`) via an `add_liquidity(uint256[2],uint256)` dispatch arm (selector `0x0b4c7e4d`, RESEARCH-verified) mirroring `prepare_curve_swap`'s abiVersion dispatch, including the `@payable` ETH-in path where `tx.value === amounts[0]`. Fingerprints are byte-identical to the FROZEN `computePayloadFingerprint` path.

## Tasks Completed (REAL commit SHAs)

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Legacy ABI shelf + fixed-array reader + selector/encoder/decoder + Fixtures CRV-D/E | `9ffa652` |
| 2 | Tool dispatch arm — ETH-in @payable + sentinel approval skip | `d96b763` |
| 3 | preview_send additive legacy decode case + regression | `9eb5122` |
| Remediation | Replace stale Phase-34 T3 refusal test with Phase-43 acceptance + wire legacy quote spy | `8f9c1c6` |

> A prior summary cited phantom SHAs `4f1f389 / a1c4f02 / 5e8d1a7` and falsely reported "all green / pushed / PR opened". Those claims were incorrect. The real task SHAs are above; this remediation pass re-verified everything from ground truth.

## What Was Built

- **`src/chains/curve.ts`:** `CURVE_LEGACY_ADD_LIQUIDITY_ABI` (fixed `uint256[2]`, `@payable`) + `CURVE_LEGACY_CALC_TOKEN_AMOUNT_ABI`; `getCurveLegacyCalcTokenAmount(client, pool, [bigint,bigint])` reader; exposed via `_curveChain` at write time.
- **`src/protocols/curve.ts`:** `CURVE_SELECTORS.addLiquidityLegacy = 0x0b4c7e4d`; `AddLiquidityLegacyParams`; `encodeAddLiquidityLegacy` (inline `uint256[2]`, no dynamic offset/length prefix); `"add_liquidity-legacy"` `CurveDecoded` variant with `isEthIn`; tuple-guarded `(legacy, 0x0b4c7e4d)` decode branch; exposed via `_curveProtocol`.
- **`src/tools/prepare_curve_add_liquidity.ts`:** legacy refusal deleted; abiVersion-dispatched quote (legacy → fixed-array reader) + encode + `valueWei` (ETH-in → `valueWei = amounts[0]`); approval pre-flight skips the ETH sentinel coin; `isEthIn` in `structuredContent`.
- **`src/tools/preview_send.ts`:** admits `addLiquidityLegacy` in the Curve selector-set tuple gate (additive) + an `add_liquidity-legacy` rendering case (`[CURVE ADD LIQUIDITY]` block with per-coin amounts, minMintAmount, ETH-in line, tx.value, MEV line).
- **Fixtures:** CRV-D (`FIXTURE_CRV_D_FP = 0x4af107b15f98df5a0e7bd75d1d58ecb87152fe2e09a4eda4230be5515203dfc2`) and CRV-E (`FIXTURE_CRV_E_FP = 0x762c6ca7365ff373b3e1ed2f39d2efcc69a6dafd307a947f47e8fabdb9da0c8e`), pinned as hardcoded literals, distinctness asserted, cross-linked.

## Deviations from Plan

### Remediation (this run) — auto-fixed

**1. [Rule 1 - Bug] Stale Phase-34 `T3` legacy-refusal test contradicted Phase-43 intent**
- **Found during:** post-build verification (`test/prepare-curve-add-liquidity.test.ts`).
- **Issue:** The Phase-43 impl (`d96b763`) correctly deleted the legacy refusal, but the Phase-34 `T3` test still asserted the old `INVALID_INPUT "deferred to v2.4.x"` envelope, and the `_curveChain` mock never wired `getCurveLegacyCalcTokenAmount`. The tool therefore proceeded and threw `INTERNAL_ERROR` (unstubbed on-chain quote). Genuine incomplete Phase-43 work (the Task-2 behavior block required T3b/T3c/T3d tool tests that were never added), not a fixture bug.
- **Root-cause decision (HONEST):** the **test** was the wrong side. The plan objective, `must_haves` truth #1, and success criterion #1 all require the legacy pool to be ACCEPTED. Independently verified the expected behavior: selector `0x0b4c7e4d` (DIAG_DATA confirmed `0x0b4c7e4d` + `1e18` + `0` + `950e15`), `valueWei === amounts[0] === 1e18` for ETH-in, `payloadFingerprint` deterministic from the FROZEN preimage. The implementation matches all three; the assertion contradicted them.
- **Fix:** Wired `getCurveLegacyCalcTokenAmount` into the hoisted spies + `_curveChain` mock; replaced `T3` with Phase-43 acceptance behavior (T3 acceptance, T3b ETH-in fp===CRV-D, T3c stETH-only fp===CRV-E, T3d legacy-reader + ETH-sentinel approval skip).
- **Fixture verification (NOT a literal change):** CRV-D/E literals were independently re-derived from the FROZEN `computePayloadFingerprint` + `encodeAddLiquidityLegacy` (via a throwaway in-process compute, since a display-layer corruption mangled raw 64-hex strings printed to stdout — the same hazard the prior run hit). The computed values matched the already-pinned literals byte-for-byte; `test/signing-fingerprint.test.ts` was NOT modified.
- **Files modified:** `test/prepare-curve-add-liquidity.test.ts`.
- **Commit:** `8f9c1c6`.

### Non-Curve failures — investigated, NOT my changes

| File | origin/main (`630d7b0`) | feat/43 | Verdict |
| ---- | ----------------------- | ------- | ------- |
| `test/integration/safe-get-transaction.test.ts` (Test 18 FROZEN-additive-arms guard) | PASS | PASS | Not a defect — passes on current committed state (the prior red was a transient `origin/main` resolution issue during the chaotic prior run). The guard's `authorizedFragments` already covers the single preview_send deletion (`sel === CURVE_SELECTORS.addLiquidityNg`). |
| `test/integration/safe-three-step-flow.test.ts` (same guard) | PASS | PASS | Same — passes now. |
| `test/get-btc-status.test.ts` | FAIL | FAIL | **PRE-EXISTING** (BTC subsystem, untouched by Phase 43). |
| `test/non-evm-store.eager-init.test.ts` | FAIL | FAIL | **PRE-EXISTING** (non-evm-store, untouched). |
| `test/verify-tx-decode.test.ts` | FAIL | FAIL | **PRE-EXISTING** (verify-tx-decode, untouched). |

ZERO failures attributable to Phase 43.

## FROZEN Invariant

`git diff origin/main -- src/tools/send_transaction.ts src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts`

Result: **ZERO lines.** `preview_send.ts` is additive-only (one authorized single-line selector-set deletion, already in the guard allowlist). No contract address inlined (pool sourced from the registry SOT). No private-key material.

## Full Suite Result

`npx vitest run` on `8f9c1c6`: **9 failed | 5358 passed | 1 skipped** (3 failed test files), `tsc --noEmit` exit 0.

All 9 remaining failures live in the 3 documented PRE-EXISTING files (`get-btc-status`, `non-evm-store.eager-init`, `verify-tx-decode`), each of which fails identically on `origin/main` (`630d7b0`). Every Curve / fingerprint / preview-send / Safe test is GREEN.

## Self-Check: PASSED

- Curve remediation commit `8f9c1c6` present in `git log`.
- Task commits `9ffa652` / `d96b763` / `9eb5122` present.
- FROZEN diff = 0 lines.
- Full suite: only the 3 documented pre-existing failures remain; zero Phase-43 failures.
- Baseline confirmed: the 3 pre-existing files fail on `origin/main` `630d7b0` (temporary detached worktree, npm ci, removed after).
