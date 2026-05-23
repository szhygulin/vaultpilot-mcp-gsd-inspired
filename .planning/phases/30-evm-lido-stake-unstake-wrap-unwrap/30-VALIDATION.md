---
phase: 30
slug: evm-lido-stake-unstake-wrap-unwrap
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-23
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Sourced from `30-RESEARCH.md` § Validation Architecture (HIGH confidence). Tasks fill in the per-task table during planning; planner stamps `nyquist_compliant: true` after Wave 0 coverage is complete.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (Phase 28/29 config — `vitest.config.ts` at repo root) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run test/protocols-lido.test.ts test/config-contracts.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~25 seconds full suite (Phase 29 baseline + ~1-2s for Lido additions) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run test/protocols-lido.test.ts test/config-contracts.test.ts` (quick run — covers selector byte-identity + SOT cross-view invariant)
- **After every plan wave:** `npx vitest run` (full suite — catches cross-module regressions in `preview_send`, `register-all`, fingerprint chain)
- **Before `/gsd-verify-work`:** Full suite green; integration test `test/lido-lifecycle.integration.test.ts` green
- **Max feedback latency:** ≤ 30 seconds

---

## Per-Task Verification Map

> Filled in during planning. Each task line below has a placeholder; planner replaces with concrete `<automated>` command from each plan's tasks.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 30-01-XX | 30-01 | 1 | LIDO-05 | T-LIDO-DISPATCH-DRIFT / T-LIDO-SPENDER-DRIFT-1 | SOT byte-identity invariants hold; dispatch allowlist accepts Lido contracts | unit | `npx vitest run test/config-contracts.test.ts` | ✅ extend | ⬜ pending |
| 30-01-XX | 30-01 | 1 | (selectors) | — | 4 Lido selectors match `viem.toFunctionSelector` outputs | unit | `npx vitest run test/protocols-lido.test.ts` | ❌ W0 | ⬜ pending |
| 30-01-XX | 30-01 | 1 | (fixtures) | T-LIDO-FINGERPRINT-DRIFT | Fixtures V/W/X/Y hardcoded literal `payloadFingerprint` values | unit | `npx vitest run test/signing-fingerprint.test.ts` | ✅ extend | ⬜ pending |
| 30-02-XX | 30-02 | 2 | LIDO-01 | T-LIDO-REBASE-SNAPSHOT-STALENESS | `get_lido_positions` returns `approx: true`; Arbitrum branch reads wstETH only | unit | `npx vitest run test/get-lido-positions.test.ts` | ❌ W0 | ⬜ pending |
| 30-02-XX | 30-02 | 2 | — | — | `computeRebaseRewards` deterministic literal anchor | unit | `npx vitest run test/signing-lido-rebase.test.ts` | ❌ W0 | ⬜ pending |
| 30-03-XX | 30-03 | 3 | LIDO-02 | T-LIDO-WRONG-CHAIN / T-LIDO-ZERO-VALUE-STAKE | `prepare_lido_stake` rejects non-Ethereum + zero-value; Fixture V cross-link | unit | `npx vitest run test/prepare-lido-stake.test.ts` | ❌ W0 | ⬜ pending |
| 30-03-XX | 30-03 | 3 | LIDO-03 | T-LIDO-ALLOWANCE-DRIFT / T-LIDO-NFT-TOKENID-RACE / T-LIDO-WITHDRAWAL-AMOUNT-BOUNDS | `prepare_lido_unstake` allowance pre-flight refuses w/ hintTool; NFT block populated; array calldata; Fixture W cross-link; bounds enforced | unit | `npx vitest run test/prepare-lido-unstake.test.ts` | ❌ W0 | ⬜ pending |
| 30-03-XX | 30-03 | 3 | LIDO-04 (wrap) | T-LIDO-ALLOWANCE-DRIFT | `prepare_lido_wrap` allowance pre-flight + Fixture X cross-link | unit | `npx vitest run test/prepare-lido-wrap.test.ts` | ❌ W0 | ⬜ pending |
| 30-03-XX | 30-03 | 3 | LIDO-04 (unwrap) | — | `prepare_lido_unwrap` (no allowance needed; wstETH is the user's own token) + Fixture Y cross-link | unit | `npx vitest run test/prepare-lido-unwrap.test.ts` | ❌ W0 | ⬜ pending |
| 30-03-XX | 30-03 | 3 | LIDO-02..04 | T-LIDO-FINGERPRINT-DRIFT | Full persona-cycle: stake → unstake → wrap → unwrap; byte-identity of V/W/X/Y across personas | integration | `npx vitest run test/lido-lifecycle.integration.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> Tests + fixtures that must exist before the corresponding implementation task can run. Planner adds these as Wave 0 stubs (or wave-1 if the implementation is unit-test-first).

- [ ] `test/protocols-lido.test.ts` — ABI parsable; 4 selector byte-identity (`0xa1903eab` / `0xd6681042` / `0xea598cb0` / `0xde0e9a3e`); 4 encoder round-trips
- [ ] `test/signing-lido-rebase.test.ts` — `computeRebaseRewards(shares, currentRate, snapshotRate)` deterministic; hardcoded shares + rate inputs → hardcoded output
- [ ] `test/get-lido-positions.test.ts` — mock publicClient for Ethereum + Arbitrum branches; assert `approx: true` flag; assert wstETH-only on Arbitrum (no stETH); assert `stEthPerToken` reads from Ethereum L1 client even when chain=arbitrum
- [ ] `test/prepare-lido-stake.test.ts` — value-bearing tx shape (`value` populated, `data` = `Lido.submit(address(0))` selector + 32-byte zero referral); Fixture V cross-link; non-Ethereum refusal with `CHAIN_ID_MISMATCH`; zero-value refusal
- [ ] `test/prepare-lido-unstake.test.ts` — array calldata `requestWithdrawals([amount], owner)`; `[NFT RECEIPT EXPECTED]` block populated (expected tokenId via `getLastRequestId(owner) + 1`); allowance pre-flight refusal path with `INVALID_INPUT + hintTool`; Fixture W cross-link; amount bounds (≥100 wei, ≤1000 ETH)
- [ ] `test/prepare-lido-wrap.test.ts` — single-arg encoding `WstETH.wrap(stethAmount)`; allowance pre-flight refusal path; Fixture X cross-link
- [ ] `test/prepare-lido-unwrap.test.ts` — single-arg encoding `WstETH.unwrap(wstethAmount)`; NO allowance pre-flight (user owns wstETH directly); Fixture Y cross-link
- [ ] `test/lido-lifecycle.integration.test.ts` — full persona-cycle: stake → unstake → wrap → unwrap with re-anchored byte-identity assertions per persona; matches Phase 6/7/28/29 integration scaffold
- [ ] Extend `test/signing-fingerprint.test.ts` — Fixtures V/W/X/Y hardcoded `0x...` literal assertions (no `beforeAll` snapshot — per CLAUDE.md cryptographic-binding rule)
- [ ] Extend `test/config-contracts.test.ts` — T-LIDO-SPENDER-DRIFT-1 cross-view byte-identity: `getLidoStethAddress(1)` + `getLidoWstethAddress(1)` + `getLidoWithdrawalQueueAddress(1)` each match their respective `KNOWN_SPENDERS_ETHEREUM` entries

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ERC-7730 clear-sign device decode renders human-readable args on Ledger device | LIDO-02..04 | Requires physical Ledger device with Ethereum app; clear-sign coverage is data-driven — verified via registry at planning time, but final UX is on-device | v2.3 verify-phase: small ETH stake (0.01 ETH); compare on-device decoded args (referral=0x0, amount=0.01 ETH) against agent-relayed prepare-time decoded args |
| `[NFT RECEIPT EXPECTED]` tokenId matches actual minted NFT tokenId | LIDO-03 | The `getLastRequestId(owner) + 1` prediction is best-effort; another transaction in the same block could shift the actual minted tokenId (T-LIDO-NFT-TOKENID-RACE residual risk) | v2.3 verify-phase: after `requestWithdrawals` lands on mainnet, read `getLastRequestId(owner)` and confirm it matches the agent-relayed expected tokenId |
| Real-Ledger small-amount mainnet broadcast for all 4 write tools | LIDO-02..04 | Hardware-signing flow + WC bridge cannot be unit-tested | v2.3 verify-phase per `30-HUMAN-UAT.md` (planner authors at plan time) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (10 new/extended test files enumerated above)
- [ ] No watch-mode flags (`vitest run`, not `vitest`)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter after planner stamps per-task table

**Approval:** pending — planner to stamp after Wave 0 task list is complete
