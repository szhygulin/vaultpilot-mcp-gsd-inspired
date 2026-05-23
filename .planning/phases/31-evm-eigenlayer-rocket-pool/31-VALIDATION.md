---
phase: 31
slug: evm-eigenlayer-rocket-pool
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 31 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npm test -- test/{tests-touched-this-task}` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (full); ~3 seconds (per-file) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- test/<files-touched>` (sub-3s feedback)
- **After every plan wave:** Run `npm test` (full suite green)
- **Before `/gsd-verify-work`:** Full suite must be green AND `npm run build` clean
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

Plans 31-01, 31-02, 31-03 produce their own task lists; tasks are filed back into this table by the planner.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 31-01-NN | 01 | 1 | EIG-01, EIG-02, RP-01, RP-02 | T-EIGENLAYER-SPENDER-DRIFT-1, T-ROCKETPOOL-SPENDER-DRIFT-1, T-DISPATCH-COLLISION-31 | SOT cross-view byte-identity; canonical-dispatch routes on `(to, selector)` tuple to avoid WETH9.deposit/RocketDepositPool.deposit selector collision | unit | `npm test -- test/config-contracts.test.ts test/canonical-dispatch.test.ts` | ⬜ W0 | ⬜ pending |
| 31-02-NN | 02 | 2 | EIG-01, EIG-02 | T-EIGENLAYER-APPROVAL-DRIFT-1, T-EIGENLAYER-CAP-OVERFLOW-1, T-LEDGER-NOTICE-EIGENLAYER-1 | LST-approval pre-flight refuses `INVALID_INPUT + hintTool`; per-strategy cap pre-flight handles `2^256-1` sentinel without overflow; LEDGER NOTICE block emitted (no ERC-7730 coverage) | unit + integration | `npm test -- test/prepare-eigenlayer-deposit.test.ts test/get-eigenlayer-positions.test.ts test/signing-fingerprint.test.ts` | ⬜ W0 | ⬜ pending |
| 31-03-NN | 03 | 3 | RP-01, RP-02 | T-ROCKETPOOL-MIN-DEPOSIT-1, T-ROCKETPOOL-LIQUIDITY-1, T-LEDGER-NOTICE-ROCKETPOOL-1 | Minimum-deposit pre-flight refuses sub-minimum stake; deposit-pool-liquidity pre-flight refuses unstake exceeding pool ETH; LEDGER NOTICE block emitted for stake + unstake | unit + integration | `npm test -- test/prepare-rocketpool-stake.test.ts test/prepare-rocketpool-unstake.test.ts test/get-rocketpool-positions.test.ts test/signing-fingerprint.test.ts` | ⬜ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 stubs are written WITH each plan (vitest convention: failing red tests committed first, executor implements GREEN). Listed here for traceability.

- [ ] `test/config-contracts.test.ts` — EigenLayer SOT cross-view byte-identity assertions (T-EIGENLAYER-SPENDER-DRIFT-1); Rocket Pool cross-view (T-ROCKETPOOL-SPENDER-DRIFT-1)
- [ ] `test/canonical-dispatch.test.ts` — additive entries for EigenLayer StrategyManager + per-strategy + RocketDepositPool + rETH; `(to, selector)` tuple routing for `0xd0e30db0` collision case (T-DISPATCH-COLLISION-31)
- [ ] `test/protocols-eigenlayer.test.ts` — selector + parseAbi anchors for `depositIntoStrategy` (`0xe7a050aa`)
- [ ] `test/protocols-rocketpool.test.ts` — selector + parseAbi anchors for `RocketDepositPool.deposit` (`0xd0e30db0`) + `rETH.burn` (`0x42966c68`)
- [ ] `test/prepare-eigenlayer-deposit.test.ts` — happy path + LST-approval pre-flight refusal + cap pre-flight refusal + curated-strategy-registry refusal arm
- [ ] `test/get-eigenlayer-positions.test.ts` — multi-strategy aggregation + pending-withdrawal queue surface
- [ ] `test/prepare-rocketpool-stake.test.ts` — happy path + minimum-deposit pre-flight refusal
- [ ] `test/prepare-rocketpool-unstake.test.ts` — happy path + deposit-pool-liquidity pre-flight refusal
- [ ] `test/get-rocketpool-positions.test.ts` — rETH balance + exchange-rate + ethEquivalent
- [ ] `test/signing-fingerprint.test.ts` — Fixtures Z + AA + AB hardcoded `0x...` literals (cross-linked from consumer tests per CLAUDE.md cryptographic-binding rule)
- [ ] `test/integration-eigenlayer-rocketpool.test.ts` — persona-cycle byte-identity across deposit + stake + unstake (matches Phase 7/30 integration-test shape)
- [ ] `test/security-md.test.ts` (or equivalent) — assert `SECURITY.md §6` v2.3 milestone close-out summary appears verbatim per D-15

---

## Validation Architecture

Inherits Phase 30 validation shape:

1. **Selector pinning** — every 4-byte selector hardcoded as a literal in the corresponding `protocols/*.ts` AND cross-asserted in `protocols-*.test.ts`. Drift fails at module load.
2. **Cross-view byte-identity** — every SOT getter (e.g. `getEigenLayerStrategyManagerAddress(1)`) cross-asserted against `KNOWN_SPENDERS_ETHEREUM` entries in `config-contracts.test.ts`. Drift fails the regression.
3. **Selector-collision dispatch routing** — `canonical-dispatch.ts` routes on `(to, selector)` tuple because `WETH9.deposit()` and `RocketDepositPool.deposit()` share selector `0xd0e30db0` (RESEARCH § Pitfall 1). Dedicated test asserts both contracts dispatch correctly when selector matches.
4. **Approval pre-flight refusal arms** — every `INVALID_INPUT + hintTool` refusal arm has a dedicated unit test asserting the refusal shape (errorCode 1, `hintTool: "prepare_token_approve"` or `"request_capability"`).
5. **Fingerprint hardcoded literals** — Fixtures Z/AA/AB committed as literal `0x...` strings in `test/signing-fingerprint.test.ts`; consumer tests (`prepare-*.test.ts`) cross-link.
6. **Persona-cycle byte-identity** — one integration test runs the full EigenLayer-deposit + RocketPool-stake + RocketPool-unstake cycle across 2+ personas; assertions re-anchor fingerprint identity across persona swaps.
7. **`from`-independent fingerprint** — fingerprint is bound to `(chainId, to, data, value)` only, NOT to `from`; persona-swap test confirms.
8. **LEDGER NOTICE block presence** — all 3 prepare tools emit the LEDGER NOTICE block (D-13 resolved: no ERC-7730 coverage); dedicated tests assert verbatim presence.

---

## Threat Model Cross-References

| Threat | Mitigation | Test Anchor |
|--------|------------|-------------|
| T-EIGENLAYER-SPENDER-DRIFT-1 | SOT getters delegate to LIDO-pattern interface; cross-view test asserts byte-identity | `test/config-contracts.test.ts` |
| T-ROCKETPOOL-SPENDER-DRIFT-1 | SOT getters; cross-view assertion | `test/config-contracts.test.ts` |
| T-DISPATCH-COLLISION-31 | `(to, selector)` tuple dispatch routing (NOT selector-only) | `test/canonical-dispatch.test.ts` |
| T-EIGENLAYER-APPROVAL-DRIFT-1 | LST-approval pre-flight via `LST.allowance(owner, StrategyManager)` | `test/prepare-eigenlayer-deposit.test.ts` |
| T-EIGENLAYER-CAP-OVERFLOW-1 | Sentinel-check `2^256-1` BEFORE arithmetic; refuse only if `cap < amount + currentDeposits` | `test/prepare-eigenlayer-deposit.test.ts` |
| T-LEDGER-NOTICE-EIGENLAYER-1 | LEDGER NOTICE block emitted on `prepare_eigenlayer_deposit` | `test/prepare-eigenlayer-deposit.test.ts` |
| T-ROCKETPOOL-MIN-DEPOSIT-1 | Pre-flight via `RocketDAOProtocolSettingsDeposit.getMinimumDeposit()` + hardcoded fallback | `test/prepare-rocketpool-stake.test.ts` |
| T-ROCKETPOOL-LIQUIDITY-1 | Pre-flight via `RocketDepositPool.getBalance()` + `rETH.getEthValue(rethAmount)` | `test/prepare-rocketpool-unstake.test.ts` |
| T-LEDGER-NOTICE-ROCKETPOOL-1 | LEDGER NOTICE block emitted on stake + unstake | `test/prepare-rocketpool-stake.test.ts`, `test/prepare-rocketpool-unstake.test.ts` |
