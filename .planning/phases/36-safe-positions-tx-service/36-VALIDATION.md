---
phase: 36
slug: safe-positions-tx-service
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-27
---

# Phase 36 — Validation Strategy

> Read-only phase. No `payloadFingerprint` / `presignHash` surface. Validation centers on (1) external Safe Tx Service client never-throws semantics, (2) on-chain Singleton multicall reads, (3) txServiceDrift detection, (4) canonical-dispatch Singleton allowlist completeness.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test -- --run test/clients-safe-tx-service.test.ts test/security-canonical-dispatch-safe.test.ts` |
| **Full suite command** | `npm run test -- --run` |
| **Estimated runtime** | ~60s full suite (already at >890 tests post-Phase 9) |

---

## Sampling Rate

- **After every task commit:** quick command (Safe-only tests).
- **After every plan wave:** full suite green.
- **Before `/gsd-verify-work`:** full suite green; no regressions vs the post-Phase-35 baseline.
- **Max feedback latency:** ~10s (Safe-only fast subset).

---

## Per-Plan Verification Map

| Plan | Wave | Requirement | Test File | Test Type | Automated Command | Status |
|------|------|-------------|-----------|-----------|-------------------|--------|
| 36-01 | 1 | SAFE-03 | `test/clients-safe-tx-service.test.ts` | unit (fetch-stub) | `npm run test -- --run test/clients-safe-tx-service.test.ts` | ⬜ |
| 36-01 | 1 | SAFE-04 | `test/security-canonical-dispatch-safe.test.ts` | property (per-chain) | `npm run test -- --run test/security-canonical-dispatch-safe.test.ts` | ⬜ |
| 36-01 | 1 | SAFE-04 | `test/config-contracts.test.ts` (extend) | property (SafeContracts ↔ allowlist invariant) | `npm run test -- --run test/config-contracts.test.ts` | ⬜ |
| 36-02 | 2 | SAFE-01 | `test/integration/safe-positions.test.ts` | integration (stubbed fetch + multicall) | `npm run test -- --run test/integration/safe-positions.test.ts` | ⬜ |
| 36-02 | 2 | SAFE-02 | `test/integration/safe-get-transaction.test.ts` | integration (stubbed fetch + ABI-cache) | `npm run test -- --run test/integration/safe-get-transaction.test.ts` | ⬜ |
| 36-02 | 2 | SAFE-01 | `test/chains-safe.test.ts` | unit (Singleton ABI parsing) | `npm run test -- --run test/chains-safe.test.ts` | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/clients-safe-tx-service.test.ts` — stubs for SAFE-03 (5-arm union; fetch-stub seam)
- [ ] `test/security-canonical-dispatch-safe.test.ts` — stubs for SAFE-04 (Singleton allowlist coverage)
- [ ] `test/chains-safe.test.ts` — stubs for SAFE-01 (Singleton ABI parsing)
- [ ] `test/integration/safe-positions.test.ts` — stubs for SAFE-01 (fan-out + drift + module list)
- [ ] `test/integration/safe-get-transaction.test.ts` — stubs for SAFE-02 (operation discriminator + best-effort decode)

*Framework already installed; no Wave 0 install step needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real mainnet Safe read | SAFE-01 | Requires a live Safe address with non-zero state; on-chain RPC; Safe Tx Service network | Run `get_safe_positions({ wallet: <known-multisig-owner>, chain: "ethereum" })` against a known Safe; verify owners + threshold + modules match Etherscan; record in `36-HUMAN-UAT.md` (deferred per v2.x bundling directive). |
| Tx Service drift behavior | SAFE-01 | Drift only reproducible against stale Tx Service responses (rare) | Inspect `txServiceDrift` flag after a `removeOwner` mainnet tx within ~1min — confirm the drift signal appears + clears after Tx Service catches up. Deferred to verify-phase bundling. |

---

## Validation Architecture (Nyquist)

Adapted from `36-RESEARCH.md` §Validation Architecture.

- **Property 1:** `SafeContracts[chain].singletons[]` ⊆ `SAFE_SINGLETON_DISPATCH_ALLOWLIST[chain]` (set containment). Per-chain loop over `configuredChains`. Coverage: all 4 variants (v1.3.0-L1, v1.3.0-L2, v1.4.1-L1, v1.4.1-L2) × 5 chains = 20 entries.
- **Property 2:** `SafeTxServiceClient` returns the 5-arm union for every stubbed response shape: 200 happy / 404 / 429 (+ retry-after) / 500 / unsupported-chain. Never throws on any path. (Mirror of `etherscan.ts` invariant.)
- **Property 3:** `get_safe_positions` cross-check: when Tx Service reports `{owners: [A,B], threshold: 1}` but on-chain reports `{owners: [A,B,C], threshold: 2}`, the per-Safe output uses on-chain values AND `txServiceDrift: true` + `driftReasons: ["owners-mismatch", "threshold-mismatch"]`.
- **Property 4:** Wallet-not-owner safety: when on-chain `getOwners()` does NOT include the requested wallet (Tx Service stale post `removeOwner`), the Safe is silently dropped from output. Per-test fixture in `safe-positions.test.ts`.
- **Property 5:** 1-of-1 Safe read produces correct per-Safe entry (single owner, threshold 1, possibly empty pending-tx list). Critical for personal-use case.
- **Property 6:** Partial multi-chain failure: simulate 2 chains 429 + 3 chains 200 → output has `degradedChains: [137, 8453]` + healthy Safes from the other 3 chains. Never throws.
- **Property 7:** `get_safe_transaction` operation discriminator: returns `"call"` (op 0) and `"delegatecall"` (op 1) string variants; NOT raw numeric. Phase 38 hard-trigger consumer reads this.
- **Property 8:** Best-effort SafeTx calldata decode: when `etherscan.ts` ABI cache contains the `to` address, surface `decodedFunctionName(args...)` string; cache miss → `decodedOperation: null`. Confirms Phase 35 cache reuse path.
- **Property 9:** Module sentinel filtering: `getModulesPaginated(SENTINEL, 100)` raw return `(modules, next)` with `next == SENTINEL_MODULE` correctly filtered; output `enabledModules[]` excludes `0x0...0001`.
- **Property 10:** Per-session call ceiling: 31st call to `SafeTxServiceClient.fetchSafes()` returns `error { reason: "session-call-ceiling" }`. Mirror of Etherscan rate-budget pattern.

---

## Coverage Summary

| Requirement | Validation Dimension | Test File | Status |
|-------------|----------------------|-----------|--------|
| SAFE-01 (`get_safe_positions`) | Properties 3, 4, 5, 6, 9 | `safe-positions.test.ts` | ⬜ |
| SAFE-02 (`get_safe_transaction`) | Properties 7, 8 | `safe-get-transaction.test.ts` | ⬜ |
| SAFE-03 (Tx Service client) | Properties 2, 6, 10 | `clients-safe-tx-service.test.ts` | ⬜ |
| SAFE-04 (Singleton SOT + dispatch allowlist) | Property 1 | `security-canonical-dispatch-safe.test.ts` + `config-contracts.test.ts` | ⬜ |

---

*Phase: 36-safe-positions-tx-service*
*Validation strategy drafted: 2026-05-27*
</content>
</invoke>