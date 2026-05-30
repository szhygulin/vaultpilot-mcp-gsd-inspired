---
phase: 43
slug: curve-add-liquidity-legacy-stableswap-fixed-array
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-30
---

# Phase 43 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 43-RESEARCH.md §8 (Validation Architecture). All four target test
> files already exist (Phase 34) — this phase EXTENDS them with the legacy cases.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (project-pinned) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run test/protocols-curve.test.ts test/signing-fingerprint.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds (quick) / full suite per project baseline |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run test/protocols-curve.test.ts test/signing-fingerprint.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green AND FROZEN zero-diff asserted
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 43-01-01 | 01 | 1 | CRV-addliq-legacy | T-43-ABI | Legacy `add_liquidity(uint256[2],uint256)` selector === `0x0b4c7e4d` (byte-identity vs `toFunctionSelector`); ≠ stable_ng `0xb72df5de` | unit | `npx vitest run test/protocols-curve.test.ts` | ✅ | ⬜ pending |
| 43-01-02 | 01 | 1 | CRV-addliq-legacy | T-43-ABI | `encodeAddLiquidityLegacy` emits fixed `uint256[2]` calldata (no dynamic offset/length); `_curveProtocol.encodeAddLiquidityLegacy` present (spy-affordance drift gate) | unit | `npx vitest run test/protocols-curve.test.ts` | ✅ | ⬜ pending |
| 43-01-03 | 01 | 1 | CRV-addliq-legacy | T-43-DISPATCH | `decodeCurveCall("legacy",0x0b4c7e4d)` on stETH pool → `add_liquidity-legacy` (amounts+isEthIn); legacy selector vs stable_ng pool → `null`; stable_ng `0xb72df5de` vs legacy pool → `null` (Phase 34 test stays green) | unit | `npx vitest run test/protocols-curve.test.ts` | ✅ | ⬜ pending |
| 43-01-04 | 01 | 1 | CRV-addliq-legacy | T-43-FP | Fixture CRV-D (ETH-in) hardcoded `0x…` fp + selector-before-fp; CRV-E (stETH-only) hardcoded fp; CRV-D ≠ CRV-E distinctness; CRV-C (stable_ng) byte-frozen green | unit | `npx vitest run test/signing-fingerprint.test.ts` | ✅ | ⬜ pending |
| 43-01-05 | 01 | 1 | CRV-addliq-legacy | T-43-ETHIN | Tool ETH-in: `amounts:["1","0"]` on stETH pool → `valueWei==="1000000000000000000"`, selector `0x0b4c7e4d`, fp===CRV-D; stETH-only `amounts:["0","1"]` → `valueWei==="0"`, fp===CRV-E | unit | `npx vitest run test/prepare-curve-add-liquidity.test.ts` | ✅ | ⬜ pending |
| 43-01-06 | 01 | 1 | CRV-addliq-legacy | T-43-APPROVE | Approval pre-flight SKIPS the ETH-sentinel coin (no `allowance` read on `0xEeee…`); legacy quote uses `getCurveLegacyCalcTokenAmount` (fixed-array reader), NOT the NG reader | unit | `npx vitest run test/prepare-curve-add-liquidity.test.ts` | ✅ | ⬜ pending |
| 43-01-07 | 01 | 1 | CRV-addliq-legacy | T-43-NOREGRESS | Legacy refusal GONE (stETH pool no longer `INVALID_INPUT "deferred"`); stable_ng arm UNCHANGED (PayPool still `valueWei==="0"`, `0xb72df5de`) | unit | `npx vitest run test/prepare-curve-add-liquidity.test.ts` | ✅ | ⬜ pending |
| 43-01-08 | 01 | 1 | CRV-addliq-legacy | T-43-PREVIEW | `preview_send` `[CURVE ADD LIQUIDITY]` block for legacy decode + ETH-in surface + MEV line; tuple gate admits `0x0b4c7e4d` only with a registered Curve `tx.to` | unit | `npx vitest run test/preview-send-curve.test.ts` | ✅ | ⬜ pending |
| 43-01-09 | 01 | 1 | CRV-addliq-legacy | T-43-FROZEN | `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts` returns ZERO lines | shell gate | `git diff --stat origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Existing infrastructure covers all phase requirements — vitest installed, all four target test files exist (Phase 34): `test/protocols-curve.test.ts`, `test/signing-fingerprint.test.ts`, `test/prepare-curve-add-liquidity.test.ts`, `test/preview-send-curve.test.ts`. No new framework install, no new test file, no shared-fixture file.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-Ledger ETH-in legacy add_liquidity signs with correct on-device `msg.value` display | CRV-addliq-legacy (RQ-3) | Requires real ETH + Ledger hardware | Sign a small (e.g. 0.01 ETH) stETH/ETH `add_liquidity([eth,0], min)` on mainnet; confirm the Ledger screen shows the ETH value and the pool address; bundled into the deferred Curve real-Ledger HUMAN-UAT, not a code-completion blocker |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter
