---
phase: 41
slug: compound-v3-multi-chain-expansion-polygon-arbitrum-base-opti
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-29
---

# Phase 41 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Additive multi-chain Compound port — the cryptographic-binding chain is FROZEN, so validation
> concentrates on (a) SOT correctness of the new per-chain Comet rows, (b) the dispatch allowlist
> auto-extending for the L2 arms, (c) Ethereum byte-identity, and (d) cross-chain fingerprint distinctness.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run test/config-contracts.test.ts test/canonical-dispatch-compound-l2.test.ts test/signing-fingerprint.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5s (quick) / full suite per project baseline |

---

## Sampling Rate

- **After every task commit:** Run the quick command
- **After every plan wave:** Run the full suite
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds (quick) before each commit

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 41-01-* | 01 | 1 | CMP-06 | T-41-INPUT | `getAllCompoundCometsForChain(42161/137/8453/10)` returns the expected verified Comet rows; Ethereum row unchanged | unit | `npx vitest run test/config-contracts.test.ts` | ✅ extend | ⬜ pending |
| 41-02-* | 02 | 2 | Phase 41 SC-4 / SC-7 | T-41-DISPATCH | every new L2 Comet address resolves through `checkDispatchTarget` on its chain | unit | `npx vitest run test/canonical-dispatch-compound-l2.test.ts` | ❌ W0 new file | ⬜ pending |
| 41-02-* | 02 | 2 | Phase 41 SC-6 | T-41-FROZEN | Fixtures R/S/T/U byte-identical; 4 cross-chain fingerprints distinct (`Set.size === 5`) | unit | `npx vitest run test/signing-fingerprint.test.ts` | ✅ extend | ⬜ pending |
| 41-02-* | 02 | 2 | Phase 41 SC-3 / CMP-01..05 | T-41-INTENT | `prepare_compound_*` accept the 4 L2 chains; `deriveIntent` gate fires per chain via `getChainClient(chainId)` | integration | `npx vitest run test/compound-v3-lifecycle.integration.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

**No separate Wave 0 for this phase.** This is an additive multi-chain port — the new test artifacts are written *alongside* the code they regress, not as a pre-existing failing-test scaffold. Both items below are OUTPUTS of Plan 41-02 Task 2 (tests-with-code), not prerequisites that must pre-exist; `wave_0_complete: true` reflects that there is no scaffolding debt to discharge before execution:

- `test/canonical-dispatch-compound-l2.test.ts` — NEW dispatch-coverage test file (created in Plan 41-02 Task 2)
- `test/signing-fingerprint.test.ts` fixtures `FIXTURE_CMP_ARB_A` / `FIXTURE_CMP_BASE_A` / `FIXTURE_CMP_OPT_A` / `FIXTURE_CMP_POLY_A` — 4 new hardcoded `0x…` literals (added in Plan 41-02 Task 2; pinned via the RED→capture→GREEN fixture workflow, NOT beforeAll-snapshot)

*Existing infrastructure (`test/config-contracts.test.ts`, `test/signing-fingerprint.test.ts`, `test/compound-v3-lifecycle.integration.test.ts`) covers the remaining requirements by extension.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-Ledger L2 Compound supply/withdraw/borrow/repay against mainnet | Phase 41 SC-2/SC-3 | Requires a physical Ledger + funded L2 wallet + per-chain RPC; cannot be automated in CI | Pair Ledger; on Arbitrum/Base/Optimism/Polygon, small supply → withdraw on a native-USDC (or USDC.e on Polygon) Comet; confirm LEDGER NOTICE blind-sign on-device and the on-device hash matches `preview_send`'s `LEDGER BLIND-SIGN HASH`. Bundled into the deferred v2.x verify-phase per the 2026-05-16 directive. |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (the 1 new test file + 4 fixtures are Plan 41-02 Task 2 outputs)
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-29
