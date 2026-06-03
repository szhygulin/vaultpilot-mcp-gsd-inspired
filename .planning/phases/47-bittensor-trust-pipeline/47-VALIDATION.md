---
phase: 47
slug: bittensor-trust-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 47 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 47-RESEARCH.md §Validation Architecture. Phase 47 IS the signing-binding — the load-bearing security phase for v2.7.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (repo-standard) |
| **Config file** | repo root (existing vitest setup) |
| **Quick run command** | `npx vitest run test/signing-fingerprint-bittensor.test.ts test/signing-presign-hash-bittensor.test.ts test/prepare-bittensor-*.test.ts test/security-canonical-dispatch-bittensor.test.ts --no-coverage` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5s quick / full suite per repo baseline |

---

## Sampling Rate

- **After every task commit:** the quick command (bittensor-signing-scoped).
- **After every plan wave:** the full suite.
- **Before `/gsd-verify-work`:** full suite green; **FROZEN-area zero-diff asserted** — the EVM/Solana/TRON `payloadFingerprint`/`presign-hash` modules + the `send_transaction` three-gate region are byte-identical to origin/main (this phase ADDS sibling files + additive arms, never edits the frozen chain).
- **Max feedback latency:** < 15s (quick).

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| TAO-PREP-01 / TAO-W-05 | Fixtures TAO-A (native fp) + TAO-B (add_stake_limit fp) — hardcoded `0x` literals over `registry.createType("ExtrinsicPayload", payload, {version}).toU8a({method:true})`; +1-unit-amount regression proves amount is in the preimage; domain-tag content + pairwise distinctness (NOT unique-length — taotx-v1: is 20 bytes = soltx-v1:); `_bittensorFingerprint` spy | unit (pure) | `npx vitest run test/signing-fingerprint-bittensor.test.ts` | ❌ W0 | ⬜ pending |
| TAO-PREP-02 / TAO-W-05 | Fixture TAO-C (blake2-256 presign) literal over the SAME signable blob; `_bittensorPresign` spy | unit (pure) | `npx vitest run test/signing-presign-hash-bittensor.test.ts` | ❌ W0 | ⬜ pending |
| TAO-W-04 | `(section,method)` allowlist: the 3 allowed pairs `(subtensorModule,addStakeLimit)` / `(subtensorModule,removeStakeLimit)` / `(balances,transferKeepAlive)` pass, any other (e.g. `sudo`, `swapColdkey`) refuses; **camelCase keying** pinned (record.tx carries camelCase) | unit (pure) | `npx vitest run test/security-canonical-dispatch-bittensor.test.ts` | ❌ W0 | ⬜ pending |
| TAO-PREP-02 | `state_call`/`dryRun` classifier never-throws; RPC failure → advisory (NOT a hard refusal) | unit (spy `_bittensorRegistry`) | `npx vitest run test/simulation-bittensor.test.ts` | ❌ W0 | ⬜ pending |
| TAO-W-01 | `prepare_bittensor_native_send`: demo-FIRST refusal (zero registry/transport calls in demo branch); PREPARE RECEIPT verbatim RAO; `payloadFingerprint` = Fixture TAO-A; pairing gate | unit (spy `_bittensorRegistry`) | `npx vitest run test/prepare-bittensor-native-send.test.ts` | ❌ W0 | ⬜ pending |
| TAO-W-02 | `prepare_bittensor_add_stake_limit`: `limit_price` from `simSwapTaoForAlpha` (mocked) adjusted by tolerance %, NEVER client-side x·y=k; `amount_staked` labeled **TAO/RAO**; fingerprint = Fixture TAO-B; netuid→subnet identity echoed; full hotkey SS58 (no truncation) | unit (mock runtime API) | `npx vitest run test/prepare-bittensor-add-stake-limit.test.ts` | ❌ W0 | ⬜ pending |
| TAO-W-03 | `prepare_bittensor_remove_stake_limit`: `amount_unstaked` labeled **ALPHA** (distinct unit from TAO); `limit_price` from `simSwapAlphaForTao`; per-extrinsic unit typing (one field never accepts both) | unit (mock runtime API) | `npx vitest run test/prepare-bittensor-remove-stake-limit.test.ts` | ❌ W0 | ⬜ pending |
| TAO-PREP-03 | `send_transaction` Bittensor arm: previewToken + userDecision + payloadFingerprint-drift gates enforced identically; `tx.addSignature(ss58, '0x00'+<known 64-byte sig>, payload)` assembles a well-formed signed envelope; `author.submitExtrinsic` called (mocked) | integration (spy registry + transport) | `npx vitest run test/bittensor-trust-pipeline.integration.test.ts` | ❌ W0 | ⬜ pending |
| TAO-W-05 | FROZEN zero-diff: EVM+Solana+TRON fingerprint/presign modules + `send_transaction` three-gate region byte-identical to origin/main | unit (git diff describe block) | `npx vitest run test/signing-fingerprint-bittensor.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/signing-fingerprint-bittensor.test.ts` — Fixtures TAO-A/B + domain-tag invariants + FROZEN zero-diff describe block (TAO-PREP-01, TAO-W-05)
- [ ] `test/signing-presign-hash-bittensor.test.ts` — Fixture TAO-C blake2-256 (TAO-PREP-02)
- [ ] `test/security-canonical-dispatch-bittensor.test.ts` — `(section,method)` allowlist (TAO-W-04)
- [ ] `test/simulation-bittensor.test.ts` — dry-run classifier, advisory posture (TAO-PREP-02)
- [ ] `test/prepare-bittensor-native-send.test.ts` (TAO-W-01)
- [ ] `test/prepare-bittensor-add-stake-limit.test.ts` (TAO-W-02)
- [ ] `test/prepare-bittensor-remove-stake-limit.test.ts` (TAO-W-03)
- [ ] `test/bittensor-trust-pipeline.integration.test.ts` — full prepare→preview→send + ed25519 assembly (TAO-PREP-03)
- [ ] Shared mock `ApiPromise` fixture: returns the probed `addStakeLimit.meta.args`, `simSwapTaoForAlpha`/`simSwapAlphaForTao` envelopes, `accountNextIndex`, and an `ExtrinsicPayload` builder. **Derive shapes from 47-RESEARCH's probe outputs, NOT hand-typed** — re-capture if the SDK/spec pins bump (matches CLAUDE.md "derive fixtures from real captured emit").

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-Ledger small mainnet stake — on-device blake2-256 hash match | TAO-PREP-02 / TAO-W-05 | Physical Polkadot Generic app device + the 64-byte ed25519 device signature (captured only on-device) | v2.7 verify-phase: prepare `add_stake_limit` for a small amount, confirm the device-displayed blake2-256 hash matches the `LEDGER BLIND-SIGN HASH (Bittensor)` block, sign, confirm `author.submitExtrinsic` inclusion. Also confirms mode:0-vs-mode:1 mainnet acceptance (research A3). |

*Unit tests assert the ed25519 ASSEMBLY with a synthetic/known 64-byte signature vector — the real device signature is a verify-phase capture.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references; Wave-0 list ↔ task create-targets is an exact bijection
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
