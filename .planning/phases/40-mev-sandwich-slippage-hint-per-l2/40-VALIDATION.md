---
phase: 40
slug: mev-sandwich-slippage-hint-per-l2
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-28
---

# Phase 40 — Validation Strategy

> Per-phase validation contract. Derived from 40-RESEARCH.md § Validation Architecture.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Quick run command** | `npx vitest run test/sandwich-mev-thresholds.test.ts test/prepare-uniswap-swap.test.ts test/prepare-sunswap-swap.test.ts` |
| **Full suite command** | `npx vitest run` |

## Sampling Rate

- **After every task commit:** quick run command
- **After the wave:** `npx vitest run`
- **Before `/gsd-verify-work`:** full suite green

## Per-Requirement Verification Map (MEV-01)

| Behavior | Test Type | Command | File Exists |
|----------|-----------|---------|-------------|
| SOT exposes per-chain `{defaultSlippageBps, priceImpactRefusalPct}` for all 5 EVM chains | unit | `npx vitest run test/sandwich-mev-thresholds.test.ts` | ❌ W0 |
| `MEV_THRESHOLD_<CHAIN>` override applies (valid positive int) | unit | same | ❌ W0 |
| `MEV_THRESHOLD_<CHAIN>` invalid (non-int / ≤0 / >10000) refuses | unit | same | ❌ W0 |
| Uniswap refuses with `SANDWICH_MEV_REFUSED` at the per-chain bar (migrated from INVALID_INPUT) | unit | `npx vitest run test/prepare-uniswap-swap.test.ts` | ✅ migrate |
| Per-chain bar differs: same impact refuses on Polygon-bar, passes on Arbitrum-bar | unit | same | ❌ W0 |
| SunSwap (TRON) refuses with `SANDWICH_MEV_REFUSED` (errorcode migrated) | unit | `npx vitest run test/prepare-sunswap-swap.test.ts` | ✅ migrate |
| Curve never emits `SANDWICH_MEV_REFUSED` (stays gate-free) | unit | `npx vitest run test/prepare-curve-swap.test.ts` | ✅ add 1 |
| Refusal text names chain + thresholds + actual impact + slippage-override hint | unit | uniswap test | ❌ W0 |
| FROZEN set zero-diff vs origin/main | source assertion | `git diff origin/main -- <frozen set>` empty | n/a |

## Wave 0 Requirements

- [ ] `src/config/sandwich-mev-thresholds.ts` SOT + `getSandwichThresholds` resolver + `MEV_THRESHOLD_<CHAIN>` env override
- [ ] `test/sandwich-mev-thresholds.test.ts`
- [ ] append `SANDWICH_MEV_REFUSED` to the `ErrorCode` union (append-only)
- [ ] migrate Uniswap gate (per-chain threshold + errorcode) + SunSwap gate (errorcode only)
- [ ] migrate sandwich-path assertions in `prepare-uniswap-swap.test.ts` + `prepare-sunswap-swap.test.ts`; add Curve gate-free regression
- [ ] SECURITY.md per-L2 MEV section + v2.6 milestone close-out

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Per-L2 swap against each configured chain exercising the live per-chain threshold | MEV-01 | needs live RPC + real pool liquidity per chain; bundled into the v2.6 deferred verify-phase | Run a high-impact swap on Polygon (refuses at >2%) and Arbitrum (passes <3%) without explicit slippageBps |

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Wave 0 covers all MISSING references
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
