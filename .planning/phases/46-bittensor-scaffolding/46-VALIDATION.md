---
phase: 46
slug: bittensor-scaffolding
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 46 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 46-RESEARCH.md §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (repo-standard) |
| **Config file** | repo root (existing vitest setup) |
| **Quick run command** | `npx vitest run test/bittensor-*.test.ts test/pair-bittensor-ledger.test.ts test/get-bittensor-*.test.ts --no-coverage` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5s quick / full suite per repo baseline |

---

## Sampling Rate

- **After every task commit:** Run the quick command (bittensor-scoped).
- **After every plan wave:** Run the full suite.
- **Before `/gsd-verify-work`:** Full suite must be green; FROZEN-area zero-diff asserted (signing modules are NOT touched this phase — assert no accidental edit).
- **Max feedback latency:** < 15s (quick), full suite per repo baseline.

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| TAO-PAIR-01 | `pair_bittensor_ledger` returns SS58 + VERIFY-ON-DEVICE; demo-mode refuses BEFORE transport open | unit (spy `_transport`) | `npx vitest run test/pair-bittensor-ledger.test.ts` | ❌ W0 | ⬜ pending |
| TAO-PAIR-01 | SS58 first-N test vectors match `encodeAddress(pubKey, 42)` literals | unit (pure) | `npx vitest run test/bittensor-ss58-vectors.test.ts` | ❌ W0 | ⬜ pending |
| TAO-PAIR-02 | `get_bittensor_status` → cache shape; never errors; 30-day stale flag; rpcEndpoint without live connect | unit (mock store) | `npx vitest run test/get-bittensor-status.test.ts` | ❌ W0 | ⬜ pending |
| TAO-R-01 | free RAO → decimal TAO; staked alpha summed; RAO formatting edge cases (0, 1, trailing-zero trim) | unit (spy `_bittensorRegistry`) | `npx vitest run test/get-bittensor-balance.test.ts` | ❌ W0 | ⬜ pending |
| TAO-R-02 | per-(hotkey, netuid) rows; alpha labeled distinct from TAO; TAO-equiv via `currentAlphaPrice` | unit (mock runtime API) | `npx vitest run test/get-bittensor-stake.test.ts` | ❌ W0 | ⬜ pending |
| TAO-R-03 | subnet enumeration (name/symbol byte-decode); validator enumeration | unit (mock runtime API) | `npx vitest run test/get-bittensor-subnets.test.ts` | ❌ W0 | ⬜ pending |
| TAO-R-04 | persists under `chain:"bittensor"`; `pairedNonEvmChains` includes it; `bittensorRpcConfigured`; persona DOA at load | unit | `npx vitest run test/bittensor-persona.test.ts` + config-status test | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/pair-bittensor-ledger.test.ts` — TAO-PAIR-01 (spy `_transport`, demo-refusal-before-open)
- [ ] `test/bittensor-ss58-vectors.test.ts` — TAO-PAIR-01 (hardcoded `{pubKeyHex → ss58}` literals via `encodeAddress(_, 42)`)
- [ ] `test/get-bittensor-status.test.ts` — TAO-PAIR-02
- [ ] `test/get-bittensor-balance.test.ts` — TAO-R-01 (RAO formatter edge cases)
- [ ] `test/get-bittensor-stake.test.ts` — TAO-R-02 (alpha-vs-TAO labeling)
- [ ] `test/get-bittensor-subnets.test.ts` — TAO-R-03
- [ ] `test/bittensor-persona.test.ts` — TAO-R-04 (DOA throw on bad SS58)
- [ ] Shared fixtures: a mock `ApiPromise` returning the probed `getStakeInfoForColdkey` / `getAllDynamicInfo` / `currentAlphaPrice` JSON — derive from the real probe outputs captured in 46-RESEARCH.md, NOT hand-typed (re-capture if the SDK pin bumps; matches the project's "derive fixtures from real captured emit" convention).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-Ledger pair against mainnet — SS58 byte-match on-device | TAO-PAIR-01 | Physical Polkadot Generic app device required | v2.7 verify-phase: pair via USB-HID, confirm device-displayed SS58 matches `pair_bittensor_ledger` response byte-for-byte |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
