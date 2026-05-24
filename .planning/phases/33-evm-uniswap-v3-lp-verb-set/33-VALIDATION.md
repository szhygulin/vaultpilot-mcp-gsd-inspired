---
phase: 33
slug: evm-uniswap-v3-lp-verb-set
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-24
---

# Phase 33 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source of truth: `33-RESEARCH.md` § Validation Architecture (lines 1231-1294).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (project standard since Phase 1) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- <test-file-pattern>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30-45s (full suite is ~890 tests post-Phase-9; Phase 33 adds ~100-130 tests across 18+ new files) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- <touched-test-file>` (vitest watch mode acceptable for local dev)
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~45 seconds for full suite

---

## Per-Task Verification Map

Sourced from `33-RESEARCH.md` § Validation Architecture → Phase Requirements → Test Map. Task IDs are placeholders pending PLAN.md creation; actual IDs follow `33-{PP}-{TT}` shape after planner runs.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 33-01-01 | 01 | 1 | UNI-04, UNI-10 | T-CONFIG-LITERAL-MIGRATION-2 | NPM SOT slot honored from `src/config/contracts.ts`; module-load self-check refuses if missing | unit | `npm test -- test/config-contracts.test.ts -t UNISWAP_V3_NPM_PRESENT` | ✅ (Phase 32 invariant) | ⬜ pending |
| 33-01-02 | 01 | 1 | UNI-10 | T-UNISWAP-V3-NPM-SPENDER-DRIFT-1 | NPM promoted to `KNOWN_SPENDERS_ETHEREUM`; cross-view byte-identity vs contracts.ts getter | unit | `npm test -- test/config-contracts.test.ts -t UNISWAP-V3-NPM-SPENDER-DRIFT` | ❌ Wave 0 | ⬜ pending |
| 33-01-03 | 01 | 1 | UNI-10 | T-DISPATCH-ALLOWLIST-DRIFT-2 | NPM in `CANONICAL_DISPATCH_TARGETS.ethereum`; refuses send to non-canonical NPM clone | unit | `npm test -- test/security-canonical-dispatch.test.ts -t Uniswap_V3_NPM` | ❌ Wave 0 | ⬜ pending |
| 33-01-04 | 01 | 1 | UNI-04 | — | Pool address via CREATE2 deterministic compute; module-load self-check anchors against canonical USDC/WETH 0.05% pool | unit | `npm test -- test/signing-uniswap-pool-address.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-01-05 | 01 | 1 | UNI-04 | — | Tick math primitives (`priceToTick`, `tickToPrice`, `getSqrtRatioAtTick`, `getTickAtSqrtRatio`, `snapPriceToTick`); refuses snap delta > 100 bps | unit | `npm test -- test/signing-uniswap-tick.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-01-06 | 01 | 1 | UNI-04 | — | Liquidity math (`getAmountsForLiquidity`, `getLiquidityForAmounts`) | unit | `npm test -- test/signing-uniswap-liquidity.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-01-07 | 01 | 1 | UNI-04 | — | Accrued fee computation (settled `tokensOwed0/1` + unsettled Q128.128 delta) | unit | `npm test -- test/signing-uniswap-fees.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-01-08 | 01 | 1 | UNI-04 | — | IL estimate (in-range exact, out-of-range geometric-midpoint fallback with `ilEstimateConfidence: "low"` flag) | unit | `npm test -- test/signing-uniswap-il.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-01-09 | 01 | 1 | UNI-04 | — | `get_lp_positions({ wallet, chain? })` returns positions per NFT-id with full envelope (price, range, in/out-of-range, accrued fees, IL estimate) | unit + integration | `npm test -- test/get-lp-positions.test.ts test/integration-uniswap-v3-lp.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-02-01 | 02 | 2 | UNI-05 | T-LEDGER-BLIND-SIGN-NPM | `prepare_uniswap_v3_mint` (calldata + token0/token1 approval pre-flight + tick snap + LEDGER NOTICE block) | unit | `npm test -- test/prepare-uniswap-v3-mint.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-02-02 | 02 | 2 | UNI-05 | — | Fixture UNI-LP-A (mint `payloadFingerprint` hardcoded literal) | unit | `npm test -- test/signing-fingerprint.test.ts -t UNI-LP-A` | ❌ Wave 0 | ⬜ pending |
| 33-02-03 | 02 | 2 | UNI-06 | T-LEDGER-BLIND-SIGN-NPM | `prepare_uniswap_v3_increase_liquidity` (token0/token1 approval pre-flight + LEDGER NOTICE) | unit | `npm test -- test/prepare-uniswap-v3-increase-liquidity.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-02-04 | 02 | 2 | UNI-06 | — | Fixture UNI-LP-B (increase fingerprint) | unit | `npm test -- test/signing-fingerprint.test.ts -t UNI-LP-B` | ❌ Wave 0 | ⬜ pending |
| 33-02-05 | 02 | 2 | UNI-06 | T-DECREASE-DOES-NOT-TRANSFER | `prepare_uniswap_v3_decrease_liquidity` with explicit notice "decreases liquidity but does NOT transfer tokens — call collect() to harvest" | unit | `npm test -- test/prepare-uniswap-v3-decrease-liquidity.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-02-06 | 02 | 2 | UNI-06 | — | Fixture UNI-LP-C (decrease fingerprint) | unit | `npm test -- test/signing-fingerprint.test.ts -t UNI-LP-C` | ❌ Wave 0 | ⬜ pending |
| 33-02-07 | 02 | 2 | UNI-07 | T-MAX-UINT128-SENTINEL | `prepare_uniswap_v3_collect` (`amount0Max`/`amount1Max` MAX_UINT128 sentinel default; CHECKS PERFORMED notes the sentinel) | unit | `npm test -- test/prepare-uniswap-v3-collect.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-02-08 | 02 | 2 | UNI-07 | — | Fixture UNI-LP-D (collect fingerprint) | unit | `npm test -- test/signing-fingerprint.test.ts -t UNI-LP-D` | ❌ Wave 0 | ⬜ pending |
| 33-02-09 | 02 | 2 | UNI-08 | T-BURN-PRECONDITION | `prepare_uniswap_v3_burn` (pre-flight refusal `INVALID_INPUT + hintTool` if position is non-empty) | unit | `npm test -- test/prepare-uniswap-v3-burn.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-02-10 | 02 | 2 | UNI-08 | — | Fixture UNI-LP-E (burn fingerprint) | unit | `npm test -- test/signing-fingerprint.test.ts -t UNI-LP-E` | ❌ Wave 0 | ⬜ pending |
| 33-02-11 | 02 | 2 | UNI-05..08 | — | `src/protocols/uniswap-v3-lp.ts` NPM ABI + selector dispatch + decoder | unit | `npm test -- test/protocols-uniswap-v3-lp.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-03-01 | 03 | 3 | UNI-09 | T-MULTICALL-SELECTOR-DRIFT | `prepare_uniswap_v3_rebalance` 3-step multicall composition via `multicall(bytes[])` selector `0xac9650d8` (distinct from Phase 32 deadline-overload `0x5ae401dc`) | unit | `npm test -- test/prepare-uniswap-v3-rebalance.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-03-02 | 03 | 3 | UNI-09 | — | Fixture UNI-LP-F (rebalance multicall fingerprint hardcoded literal — full outer multicall calldata single hash) | unit | `npm test -- test/signing-fingerprint.test.ts -t UNI-LP-F` | ❌ Wave 0 | ⬜ pending |
| 33-03-03 | 03 | 3 | UNI-09 | T-COMPOSITE-DECODE-SOT | Composite-multicall preview shape (`preview_send` composite arm recursively decodes inner calls via shared `decodeSingleNpmCall` helper — SINGLE source of truth) | unit + integration | `npm test -- test/preview-send.uniswap-v3-lp-composite.test.ts` | ❌ Wave 0 | ⬜ pending |
| 33-03-04 | 03 | 3 | UNI-04, UNI-09 | T-FROM-INDEPENDENCE-UNI-LP | Persona-cycle byte-identity integration (all 6 fixtures re-anchored under at least 2 personas) | integration | `npm test -- test/integration-uniswap-v3-lp.test.ts` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Per `33-RESEARCH.md` § Validation Architecture → Wave 0 Gaps:

- [ ] `test/get-lp-positions.test.ts` — covers UNI-04 (read tool envelope)
- [ ] `test/integration-uniswap-v3-lp.test.ts` — covers UNI-04 + UNI-09 persona-cycle byte-identity (re-anchors all 6 fixtures under ≥2 personas)
- [ ] `test/signing-uniswap-tick.test.ts` — covers UNI-04 tick math primitives
- [ ] `test/signing-uniswap-liquidity.test.ts` — covers UNI-04 liquidity math
- [ ] `test/signing-uniswap-fees.test.ts` — covers UNI-04 fee math (Q128.128 wrap discipline)
- [ ] `test/signing-uniswap-il.test.ts` — covers UNI-04 IL estimate (in-range exact + out-of-range fallback)
- [ ] `test/signing-uniswap-pool-address.test.ts` — covers UNI-04 pool CREATE2 deterministic derivation + module-load self-check
- [ ] `test/protocols-uniswap-v3-lp.test.ts` — covers NPM ABI + selector + encoder regressions
- [ ] `test/prepare-uniswap-v3-mint.test.ts` — covers UNI-05
- [ ] `test/prepare-uniswap-v3-increase-liquidity.test.ts` — covers UNI-06
- [ ] `test/prepare-uniswap-v3-decrease-liquidity.test.ts` — covers UNI-06
- [ ] `test/prepare-uniswap-v3-collect.test.ts` — covers UNI-07
- [ ] `test/prepare-uniswap-v3-burn.test.ts` — covers UNI-08
- [ ] `test/prepare-uniswap-v3-rebalance.test.ts` — covers UNI-09
- [ ] `test/preview-send.uniswap-v3-lp-composite.test.ts` — covers UNI-09 composite preview shape
- [ ] `test/signing-fingerprint.test.ts` extension — covers Fixtures UNI-LP-{A,B,C,D,E,F} (hardcoded `0x...` literals, NOT `beforeAll`-snapshot)
- [ ] `test/config-contracts.test.ts` extension — covers `T-UNISWAP-V3-NPM-SPENDER-DRIFT-1`
- [ ] `test/security-canonical-dispatch.test.ts` extension — covers NPM in dispatch allowlist
- [ ] Framework install: NONE — vitest already in project (since Phase 1)

---

## Manual-Only Verifications

Per the project's `gsd-pr-workflow` memory + 2026-05-16 directive: v2.x phases ship "code-complete" with the real-Ledger verify-phase deferred (bundled into v2.4 milestone close-out per ROADMAP.md).

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end mint of a small Uniswap V3 LP position on Ethereum mainnet with on-Ledger blind-sign approval (USDC/WETH 0.05% pool, small range, ~$10 deposit) | UNI-05, UNI-10 | Requires physical Ledger device + WalletConnect pairing + LEDGER NOTICE block UAT confirmation (NPM blind-signs — no ERC-7730 clear-sign coverage as of 2026-05-24) | Pair Ledger Live, call `prepare_uniswap_v3_mint`, verify CHECKS PERFORMED block enumerates token0/token1 approvals + tick snap, approve all 3 transactions on-device, verify position appears in `get_lp_positions` |
| End-to-end rebalance composite tx with on-Ledger blind-sign | UNI-09 | Requires LEDGER NOTICE for composite multicall + on-device verification that single signature authorizes 3 inner calls — establishes the v2.5 Safe three-step UAT precedent | Pair Ledger Live, create a position, call `prepare_uniswap_v3_rebalance` with shifted tick range, verify preview surfaces 3 sub-blocks (decrease + collect + mint), approve on-device, verify position state reflects new tick range |
| `get_lp_positions` IL estimate accuracy vs Uniswap UI within 1% on a representative position | UNI-04 | Requires comparing computed IL against Uniswap's reference computation on a live position (out-of-band; UI reference not script-automatable) | Open a known position on Uniswap UI, capture IL, call `get_lp_positions`, compare; surface deviation > 1% as deferred-to-v2.4.x backlog item if it appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (sourced from RESEARCH.md § Validation Architecture)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (24 tasks, all have automated verify)
- [ ] Wave 0 covers all MISSING references (18 new test files + 3 extensions)
- [ ] No watch-mode flags (`npm test` runs once and exits)
- [ ] Feedback latency < 45s (full suite estimated 30-45s)
- [ ] `nyquist_compliant: true` set in frontmatter (pending — set by executor on Wave 0 file landing)

**Approval:** pending (will be set to `approved 2026-05-24` once plan-checker passes)
