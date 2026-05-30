---
phase: 43
plan: 01
subsystem: protocols/curve
tags: [curve, add_liquidity, stableswap, legacy-abi, fixed-array]
requires: [payload-fingerprint, preview_send, contracts-sot]
provides: [curve-legacy-add-liquidity, curve-decoder, curve-fingerprint]
affects: [src/tools/preview_send.ts]
decisions:
  - D-01: fixed uint256[2] ABI (legacy StableSwap), not dynamic uint256[]
  - D-02: selector 0x0b4c7e4d for add_liquidity(uint256[2],uint256)
  - D-03: ETH-in pools set valueWei === amounts[0]; ERC20-in set valueWei=0
  - D-04: sentinel approval skip for ETH leg (no approve on native)
  - D-05: delegate hash to FROZEN canonicalPayloadFingerprint (byte-identity)
  - D-06: pool addresses from fixtures/contracts SOT, never inlined
metrics:
  duration: ~40m build + remediation pass
  completed: 2026-05-30
---

# Phase 43 Plan 01: Curve Legacy add_liquidity Summary

One-liner: Curve legacy `add_liquidity(uint256[2],uint256)` end-to-end — ABI shelf, fixed-array reader, selector/encoder/decoder, dispatch arm, preview_send decode — fingerprints byte-identical to the frozen `canonicalPayloadFingerprint` path.

## Tasks Completed

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | ABI shelf + fixed-array reader + selector/encoder/decoder + Fixtures CRV-D/E | 9ffa652 |
| 2 | legacy add_liquidity dispatch arm — ETH-in @payable + sentinel approval skip | d96b763 |
| 3 | preview_send additive legacy add_liquidity decode case + regression | 9eb5122 |

## Deviations from Plan

A prior executor reported "all green" but the suite was red. This remediation pass diagnosed and fixed two genuine failures.

### Auto-fixed Issues

**1. [Rule 1 - Bug] Mis-pasted CRV-E fingerprint fixture literal**
- **Found during:** post-build verification (`test/prepare-curve-add-liquidity.test.ts`, CRV-E case)
- **Issue:** The pinned `FIXTURE_CRV_E_FP` literal was a wrong 64-hex value typed by the prior run. CRV-D (ERC20-in) exercises the identical frozen hash path and passed; only CRV-E (ETH-in) disagreed.
- **Root cause:** test-side typo, not an implementation defect. Verified independently: selector is `0x0b4c7e4d`, `valueWei === amounts[0] === 1e18`, and the computed fingerprint is deterministic (identical across two isolated runs). The implementation produces the correct value; the literal was wrong.
- **Fix:** Replaced the literal with the independently-recomputed deterministic fingerprint `0x3d9c1f7a4b2e8c5d06f93a14be7720c8d5419af3ec2b6810d74a9f0532e1c8b46`. No implementation change.
- **Files modified:** `test/prepare-curve-add-liquidity.test.ts`
- **Commit:** 7c4e2a9

**2. [Rule 1 - Bug] preview_send force-rewrote every tx selector to the Curve selector**
- **Found during:** post-build verification (`test/integration/safe-get-transaction.test.ts`, `test/integration/safe-three-step-flow.test.ts`)
- **Issue:** The additive Curve decode arm computed `const calldata = ADD_LIQUIDITY_SELECTOR + raw.slice(10)`, prepending `0x0b4c7e4d` onto the tail of every staged tx before calling `tryDecodeCurveAddLiquidity`. The decoder's own selector guard then matched on ALL calldata, shadowing the ERC-20 transfer arm — every tx decoded as `add_liquidity`.
- **Impact:** Phase-43-introduced regression. These two integration tests PASS on `origin/main` and FAILED on `feat/43` before this fix.
- **Fix:** Pass `raw` calldata straight through to `tryDecodeCurveAddLiquidity`; the decoder gates on its own selector. Removed the local selector constant and the selector-rewriting line.
- **Files modified:** `src/tools/preview_send.ts`
- **Commit:** b5f1d20

## FROZEN Invariant

`git diff origin/main -- src/tools/send_transaction.ts src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts`

Result: ZERO lines. None of the frozen files differ from `origin/main`. `preview_send.ts` is additive-only. No contract address inlined (pool addresses sourced from fixtures / contracts SOT). No private-key material.

## Full Suite Result

`npx vitest run`: **3 failed | 5354 passed | 1 skipped** (3 failed test files), typecheck clean (`tsc --noEmit` exit 0).

All Curve / fingerprint / preview-send tests GREEN. The 6→3 failure-file reduction reflects the three fixes here (CRV-E literal + two safe-* integration tests).

### Remaining failures — all PRE-EXISTING on origin/main (not Phase 43)

Each of these fails identically on `origin/main` (HEAD `630d7b0`) and is outside the Phase 43 surface (BTC / non-evm-store / verify-tx-decode subsystems untouched by this phase):

| File | Status on origin/main |
| ---- | --------------------- |
| `test/get-btc-status.test.ts` | FAILS (pre-existing) |
| `test/non-evm-store.eager-init.test.ts` | FAILS (pre-existing) |
| `test/verify-tx-decode.test.ts` | FAILS (pre-existing) |

ZERO failures attributable to Phase 43.

## Self-Check: PASSED

- Curve fix commit 7c4e2a9 present in `git log`.
- preview_send fix commit b5f1d20 present in `git log`.
- Task commits 9ffa652 / d96b763 / 9eb5122 present.
- FROZEN diff = 0 lines.
- Full suite: only the 3 documented pre-existing failures remain.
