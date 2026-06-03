---
phase: 48
slug: bittensor-subnet-depth
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 48 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 48-RESEARCH.md §Validation Architecture. Breadth phase — reuses the FROZEN Phase-47 binding/builder/allowlist machinery; the 5 new tx shapes flow through unmodified.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (repo-standard) |
| **Config file** | repo root (existing vitest setup) |
| **Quick run command** | `npx vitest run test/signing-fingerprint-bittensor.test.ts test/prepare-bittensor-*.test.ts test/security-canonical-dispatch-bittensor.test.ts test/preview-send.bittensor-depth.test.ts --no-coverage` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5s quick / full suite per repo baseline |

---

## Sampling Rate

- **After every task commit:** the quick command (bittensor-depth-scoped).
- **After every plan wave:** the full suite.
- **Before `/gsd-verify-work`:** full suite green; **FROZEN-area zero-diff asserted** — the 6 binding modules + the `send_transaction` three-gate region (the shipped Phase-47 FROZEN describe block already covers them; the new send-arm reads NO per-shape branch — the 5 new shapes flow through the existing shape-agnostic arm).
- **Max feedback latency:** < 15s (quick).

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| TAO-W-06 | `prepare_bittensor_add_stake` demo-FIRST refusal; amount labeled TAO/RAO; fingerprint = Fixture TAO-D; NO limit_price/allow_partial in the call; pairing gate | unit (spy `_bittensorRegistry`) | `npx vitest run test/prepare-bittensor-add-stake.test.ts` | ❌ W0 | ⬜ pending |
| TAO-W-06 | `prepare_bittensor_remove_stake` amount labeled ALPHA (field named `alpha` not `rao`); fingerprint = Fixture TAO-E | unit | `npx vitest run test/prepare-bittensor-remove-stake.test.ts` | ❌ W0 | ⬜ pending |
| TAO-W-06 | preview emits `[NOTICE — no slippage guard; prefer *_limit]` for plain add/remove; ABSENT for `*_limit` | unit (preview branch) | `npx vitest run test/preview-send.bittensor-depth.test.ts` | ❌ W0 | ⬜ pending |
| TAO-W-07 | `prepare_bittensor_move_stake`: origin+dest HOTKEY + origin+dest NETUID echoed; amount ALPHA; fingerprint = Fixture TAO-F; SAME-owner (no custody block) | unit | `npx vitest run test/prepare-bittensor-move-stake.test.ts` | ❌ W0 | ⬜ pending |
| TAO-W-07 | `prepare_bittensor_swap_stake`: ONE hotkey + origin+dest NETUID; amount ALPHA; fingerprint = Fixture TAO-G; SAME-owner | unit | `npx vitest run test/prepare-bittensor-swap-stake.test.ts` | ❌ W0 | ⬜ pending |
| TAO-W-08 | `prepare_bittensor_transfer_stake`: destination_coldkey REQUIRED + in receipt (full SS58); `[WITHDRAWAL — CUSTODY CHANGE]` block present; ABSENT for move/swap; fingerprint = Fixture TAO-H | unit | `npx vitest run test/prepare-bittensor-transfer-stake.test.ts` | ❌ W0 | ⬜ pending |
| TAO-W-09 | 5 new camelCase `(section,method)` pairs in `BITTENSOR_DISPATCH_ALLOWLIST`; snake_case keys do NOT match (negative); non-allowlisted refuses | unit (pure) | `npx vitest run test/security-canonical-dispatch-bittensor.test.ts` | ⚠️ EXTEND (Phase 47) | ⬜ pending |
| TAO-W-09 | Fixtures TAO-D..H hardcoded `0x` literals over `ExtrinsicPayload.toU8a({method:true})`; +1-unit AND **hotkey↔netuid-swap** regressions (the RED-FLAG guard); cross-linked from consumer tests | unit (pure) | `npx vitest run test/signing-fingerprint-bittensor.test.ts` | ⚠️ EXTEND (Phase 47) | ⬜ pending |
| TAO-W-09 | FROZEN zero-diff: 6 binding modules + `send_transaction` three-gate region byte-identical; the NEW send path reads NO per-shape branch | unit (git diff) | `npx vitest run test/signing-fingerprint-bittensor.test.ts` (FROZEN describe block) | ⚠️ exists (Phase 47) | ⬜ pending |
| TAO-R-05 | `get_bittensor_validators` enriched: take% + identity name + registrations; unregistered hotkey → preview WARNING; null-identity tolerated | unit (spy `_bittensorRegistry`) | `npx vitest run test/get-bittensor-validators-enrichment.test.ts` | ❌ W0 | ⬜ pending |
| TAO-R-05 | preview-time unregistered-hotkey warning fires when staked hotkey absent from `getNeuronsLite(netuid)` | unit (preview branch) | `npx vitest run test/preview-send.bittensor-depth.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/prepare-bittensor-add-stake.test.ts` + `test/prepare-bittensor-remove-stake.test.ts` — plain variants (TAO-W-06)
- [ ] `test/prepare-bittensor-move-stake.test.ts` + `test/prepare-bittensor-swap-stake.test.ts` — same-owner reallocation (TAO-W-07)
- [ ] `test/prepare-bittensor-transfer-stake.test.ts` — custody change + withdrawal block (TAO-W-08)
- [ ] `test/preview-send.bittensor-depth.test.ts` — NOTICE block + withdrawal-block distinctness + unregistered-hotkey warning
- [ ] `test/get-bittensor-validators-enrichment.test.ts` — identity + take + registration (TAO-R-05)
- [ ] EXTEND `test/signing-fingerprint-bittensor.test.ts` — Fixtures TAO-D..H + a **hotkey↔netuid-swap regression** for plain add/remove (the RED-FLAG guard: pallet SCALE order is hotkey-first, NOT the Python-SDK-docs netuid-first)
- [ ] EXTEND `test/security-canonical-dispatch-bittensor.test.ts` — 5 new camelCase keys + snake_case-negative
- [ ] Mock `ApiPromise` fixture extension: `api.tx.subtensorModule.{addStake,removeStake,moveStake,swapStake,transferStake}` returning the probed `.method.toHex()`; `delegateInfoRuntimeApi.getDelegate`; `identitiesV2`. Derive shapes from 48-RESEARCH's pallet-source probes; **re-introspect `.meta.args` at execute time** to confirm hotkey-first order before pinning fixtures.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-Ledger small mainnet `add_stake` + `transfer_stake` | TAO-W-06 / TAO-W-08 | Physical Polkadot Generic app device + the real ed25519 device signature | v2.7 verify-phase: prepare a small plain `add_stake` and a `transfer_stake`, confirm the device-displayed hash matches, confirm `transfer_stake` shows the custody-change destination, sign + broadcast |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references; Wave-0 list ↔ task create-targets bijection (EXTEND targets pre-exist from Phase 47)
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
