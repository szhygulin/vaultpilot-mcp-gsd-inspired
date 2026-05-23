---
phase: 31-evm-eigenlayer-rocket-pool
plan: 01
subsystem: contracts-sot
tags:
  - eigenlayer
  - rocket-pool
  - sot
  - canonical-dispatch
  - planner-gate-verification
  - v2.3

requires:
  - phase: 30-lido-stake-unstake-wrap-unwrap
    provides: "Lido SOT shape (LidoContracts interface + LIDO_RAW + 3 getters); Lido KNOWN_SPENDERS row pattern; T-LIDO-SPENDER-DRIFT-1 cross-view byte-identity pattern that Phase 31 mirrors for EigenLayer + Rocket Pool"
  - phase: 29-morpho-blue
    provides: "Sibling sub-table SOT shape (Partial<Record<ChainId, ...>>); single-contract-per-chain getter analog"
  - phase: 28-compound-v3
    provides: "Partial<Record<ChainId, Partial<Record<...>>>> nested sub-table shape; KNOWN_SPENDERS additive-row precedent"
  - phase: 9-hardening
    provides: "CANONICAL_DISPATCH_TARGETS Layer 0.5 dispatch gate + per-chain ReadonlySet allowlist; ESM spy-affordance indirection pattern"

provides:
  - "EigenLayerLst literal-union (7 LSTs)"
  - "EigenLayerContracts interface + EIGENLAYER_RAW chainId=1 row"
  - "5 EigenLayer getters (StrategyManager / DelegationManager / strategy / lstToken / fan-out)"
  - "RocketPoolContracts interface + ROCKETPOOL_RAW chainId=1 row"
  - "3 Rocket Pool getters (depositPool / reth / settingsDeposit)"
  - "ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI = 1e16n constant (D-07 resilience)"
  - "3 KNOWN_SPENDERS_ETHEREUM additive rows (EigenLayer StrategyManager + Rocket Pool RocketDepositPool + Rocket Pool rETH)"
  - "CANONICAL_DISPATCH_TARGETS[1] extended by +9 net entries (rETH de-duped via BRIDGED_VARIANTS)"
  - "T-EIGENLAYER-SPENDER-DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1a/b cross-view byte-identity regression tests"
  - "scripts/verify-phase31-addresses.mjs — re-usable planner-gate verification script"
  - ".planning/phases/31-evm-eigenlayer-rocket-pool/31-01-PLANNER-GATE-VERIFICATION.md (A1 + A2 + A4 audit trail)"

affects:
  - Plan 31-02 (EigenLayer reads + deposit — consumes EigenLayer SOT)
  - Plan 31-03 (Rocket Pool reads + stake + unstake — consumes Rocket Pool SOT)
  - preview_send DECODED ARGS dispatch layer (selector collision branch for WETH9.deposit vs RocketDepositPool.deposit)

tech-stack:
  added: []
  patterns:
    - "Cross-SOT byte-identity invariant: lstTokens.stETH ≡ Phase-30 Lido SOT; lstTokens.rETH ≡ Phase-31 Rocket Pool SOT"
    - "Planner-gate verification script pattern (`scripts/verify-phase{N}-addresses.mjs`) for on-chain assumption resolution before SOT commit"

key-files:
  created:
    - "scripts/verify-phase31-addresses.mjs — one-shot mainnet verification (RocketStorage + Strategy.underlyingToken)"
    - ".planning/phases/31-evm-eigenlayer-rocket-pool/31-01-PLANNER-GATE-VERIFICATION.md — A1/A2/A4 audit trail"
  modified:
    - "src/config/contracts.ts — +287 lines (EigenLayer + Rocket Pool blocks + 3 KNOWN_SPENDERS rows)"
    - "src/security/canonical-dispatch.ts — +32 lines (eigenEntries + rocketEntries + 4 new imports)"
    - "test/config-contracts.test.ts — +272 lines / +40 tests"
    - "test/security-canonical-dispatch.test.ts — +112 / -2 lines / +9 new tests (1 pinned-size assertion bumped 29 → 38)"

key-decisions:
  - "RocketDAOProtocolSettingsDeposit proxy resolved on-chain to 0x227BE8dD01DF8ad9BED0178e4F8cEC2996C5c365 — supersedes the RESEARCH-cited training-data literal 0xac2245BE… (training data was wrong; planner-gate verification was load-bearing for A1)."
  - "Curated EigenLayer registry locked at exactly 7 LSTs (stETH/rETH/cbETH/ETHx/wBETH/sfrxETH/mETH) per D-04 — matches RESEARCH § Topic 1 INCLUDE column."
  - "rETH address 0xae78736C… de-dupes in CANONICAL_DISPATCH_TARGETS[1] because it is ALREADY present in BRIDGED_VARIANTS as a canonical Ethereum-mainnet token contract. Net Phase 31 dispatch delta = +9 (not +10 as the plan asserted). Same shape as the Phase 30 wstETH de-dupe precedent."

patterns-established:
  - "Planner-gate verification script (`scripts/verify-phase{N}-addresses.mjs`) — one-shot read-only mainnet probe consumed at SOT-commit time; output captured to a `.planning/.../{plan}-PLANNER-GATE-VERIFICATION.md` audit-trail artifact. Reusable for future protocol-upgrade verifications."

requirements-completed:
  - EIG-01
  - EIG-02
  - RP-01
  - RP-02

duration: 15min
completed: 2026-05-23
---

# Phase 31 Plan 31-01: EigenLayer + Rocket Pool SOT Foundation Summary

**Per-chain EigenLayer + Rocket Pool SOT extensions, canonical-dispatch allowlist wiring, and SOT cross-view byte-identity regression tests — all foundation work consumed by Plans 31-02 (EigenLayer) and 31-03 (Rocket Pool). Three RESEARCH assumptions (A1 RocketDAOProtocolSettingsDeposit proxy / A2 per-LST underlying-token addresses / A4 RocketStorage canonical address) resolved against live Ethereum mainnet before SOT commit.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-23 08:58:41 UTC (worktree baseline commit `b4639e4`)
- **Completed:** 2026-05-23 09:13:31 UTC
- **Tasks:** 3 of 3 completed
- **Files modified:** 6 (2 created + 4 modified)

## Accomplishments

- **Planner-gate verification artifact:** `scripts/verify-phase31-addresses.mjs` ran against live Ethereum mainnet via PublicNode public RPC and produced 3 RESOLVED verdicts captured to `31-01-PLANNER-GATE-VERIFICATION.md` for audit trail. A1 surfaced a non-trivial correction: the RESEARCH-cited training-data literal `0xac2245BE…` was WRONG; the correct proxy address is `0x227BE8dD01DF8ad9BED0178e4F8cEC2996C5c365` resolved via `RocketStorage.getAddress`.
- **Per-chain EigenLayer + Rocket Pool SOT in `src/config/contracts.ts`:** EigenLayer block (interface + 7-LST literal-union + 5 getters) + Rocket Pool block (interface + 3 getters + D-07 resilience constant) — both `Partial<Record<ChainId, …>>` so Phase 31 ships chainId=1 only with the shape preserved for v2.x.
- **`KNOWN_SPENDERS_ETHEREUM` extended additive-only with 3 new rows** inserted between Lido WithdrawalQueue and 1inch. Each row's `address` field delegates to a SOT getter — T-EIGENLAYER-SPENDER-DRIFT-1 + T-ROCKETPOOL-SPENDER-DRIFT-1a/b cross-view byte-identity is enforced by construction.
- **Canonical-dispatch allowlist extended (Ethereum arm)** with EigenLayer StrategyManager + 7 per-strategy proxies + Rocket Pool RocketDepositPool + rETH. Net +9 entries (rETH de-duped via BRIDGED_VARIANTS); size 29 → 38. Non-Ethereum chains unchanged by construction (SOT getters return null/[] per D-03).
- **Full vitest suite green: 3537 → 3577 (+40 net tests)**. Strict `tsc --noEmit` clean. FROZEN regions (`payload-fingerprint.ts` / `presign-hash.ts` / `handle-store.ts` / `send_transaction.ts` / `clients/etherscan.ts`) byte-identical to baseline.

## Task Commits

Each task was committed atomically:

1. **Task 1: Planner-gate verification — resolve A1/A2/A4 against live mainnet RPC** — `242261f` (feat)
2. **Task 2: SOT extension — EigenLayer + Rocket Pool blocks + 3 KNOWN_SPENDERS rows** — `0e25ebc` (feat)
3. **Task 3: Canonical-dispatch allowlist extension — EigenLayer + Rocket Pool arms (Ethereum-only)** — `2fd3677` (feat)

## Files Created/Modified

### Created

- `scripts/verify-phase31-addresses.mjs` — one-shot read-only Ethereum mainnet verification script. Resolves the RocketDAOProtocolSettingsDeposit proxy via `RocketStorage.getAddress(keccak256("contract.address", "rocketDAOProtocolSettingsDeposit"))` and cross-checks `Strategy.underlyingToken()` returns against the RESEARCH-cited literals for cbETH / ETHx / wBETH / sfrxETH / mETH. Output captured to the planner-gate verification file. Re-runnable for future protocol-upgrade verifications.
- `.planning/phases/31-evm-eigenlayer-rocket-pool/31-01-PLANNER-GATE-VERIFICATION.md` — audit trail of the A1 / A2 / A4 resolution. Records: RocketStorage live + RocketDAOProtocolSettingsDeposit = `0x227BE8dD01DF8ad9BED0178e4F8cEC2996C5c365` + 5 PASS rows for the underlying-token verifications (zero drift).

### Modified

- `src/config/contracts.ts` (+287 lines) — EigenLayer block (`EigenLayerLst` 7-LST literal-union + `EigenLayerContracts` interface + `EIGENLAYER_RAW` + 5 getters), Rocket Pool block (`RocketPoolContracts` interface + `ROCKETPOOL_RAW` + 3 getters + `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI` constant), 3 additive `KNOWN_SPENDERS_ETHEREUM` rows.
- `src/security/canonical-dispatch.ts` (+32 lines) — added `eigenEntries` + `rocketEntries` arms to `buildPerChainAllowlist`, threaded the 4 new SOT-getter imports.
- `test/config-contracts.test.ts` (+272 lines / +40 tests) — 2 new describe blocks: "EigenLayer SOT" (T-EIGENLAYER-SPENDER-DRIFT-1 + 9 literal anchors + 7 underlying-token assertions + fan-out coverage + 4-chain pruning + EIP-55 round-trip), "Rocket Pool SOT" (T-ROCKETPOOL-SPENDER-DRIFT-1a + 1b + 2 literal anchors + settingsDeposit anchor + fallback constant + 4-chain pruning + EIP-55 round-trip + additive-row-count).
- `test/security-canonical-dispatch.test.ts` (+112 / -2 lines / +9 tests) — 1 new describe block: "Phase 31 EigenLayer + Rocket Pool entries (Ethereum)" + 1 existing pinned-size assertion updated 29 → 38 (with rationale comment).

## Decisions Made

- **A1 supersedes training-data literal:** Resolved on-chain via RocketStorage to `0x227BE8dD01DF8ad9BED0178e4F8cEC2996C5c365` — the RESEARCH-cited `0xac2245BE…` was training-data hallucination, NOT the live deployment. Captured in `31-01-PLANNER-GATE-VERIFICATION.md` for audit trail and annotated inline in `src/config/contracts.ts`.
- **A2 zero drift:** All 5 per-LST underlying-token addresses (cbETH / ETHx / wBETH / sfrxETH / mETH) PASS byte-identical against `Strategy.underlyingToken()` returns. Commit the RESEARCH-cited literals as-is.
- **A4 confirmed:** RocketStorage at `0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46` is live (bytecode size 11270 bytes).
- **Curated 7-LST registry locked** per CONTEXT.md D-04 and RESEARCH § Topic 1 INCLUDE column (stETH / rETH / cbETH / ETHx / wBETH / sfrxETH / mETH).
- **Allowlist size delta = +9 (not +10):** The plan's `must_haves.truths` claimed `buildPerChainAllowlist(1) Set grows by exactly 10 addresses`. Empirically the delta is +9 because the rETH address is already in `BRIDGED_VARIANTS` (canonical Ethereum-mainnet token contract); the Set de-dupes the duplicate entry. This is benign — same address, two views, both byte-identical by construction — and exactly the shape of the Phase 30 wstETH de-dupe precedent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Fact correction] Dispatch-allowlist delta is +9, not +10, due to BRIDGED_VARIANTS rETH overlap**

- **Found during:** Task 3 (canonical-dispatch extension test run)
- **Issue:** The plan's `must_haves.truths` and `<verified_values>` both claimed `buildPerChainAllowlist(1) Set grows by exactly 10 addresses`. The pinned-size test assertion claimed `... .size === 39`. Empirical run produced `size === 38`.
- **Root cause:** `0xae78736Cd615f374D3085123A210448E74Fc6393` (Rocket Pool rETH) is ALREADY a row in `src/tokens/bridged-variants.ts` for chainId=1 (`canonicalSymbol: "rETH"`, native Rocket Pool deployment — see `bridged-variants.ts:622-630`). When `buildPerChainAllowlist(1)` spreads both `...tokenContracts` (which contains rETH via BRIDGED_VARIANTS) and `...rocketEntries` (which contains rETH via the new Rocket Pool SOT), the JavaScript `Set` de-dupes the duplicate entry. Net Phase 31 additions are +9, not +10.
- **Precedent:** Identical shape to the Phase 30 wstETH de-dupe noted at `src/security/canonical-dispatch.ts:164` ("wstETH 0x7f39C581… already in BRIDGED_VARIANTS → Set de-dupe → net +2"). The plan's `must_haves` assumed Phase 31 had no such overlap.
- **Fix:** Updated the pinned-size assertion to `.toBe(38)` with a rationale comment cross-referencing the wstETH precedent. Added a new assertion "Phase 31 membership delta is +9 net (rETH de-duped via BRIDGED_VARIANTS)" in the new Phase 31 describe block.
- **Files modified:** `test/security-canonical-dispatch.test.ts` only (no SOT change required — cross-view byte-identity is preserved because the SOT getter and the BRIDGED_VARIANTS row resolve to the same address).
- **Verification:** Full vitest suite green (3577 passed). `tsc --noEmit` clean.
- **Committed in:** `2fd3677` (Task 3 commit).
- **Security note:** This is a BENIGN overlap, not a security regression. The intent of including rETH in the allowlist (so `prepare_rocketpool_unstake` can route `burn()` to it) is satisfied — the address IS in the Set, just sourced from one row instead of two. Cross-view byte-identity (T-ROCKETPOOL-SPENDER-DRIFT-1b) is enforced because both the SOT getter (`getRocketPoolRethAddress(1)`) and the BRIDGED_VARIANTS row use `getAddress(0xae78736C…)` at module load.

## Threat Mitigations Wired

| Threat ID | Mitigation Wired | Verification Anchor |
|-----------|------------------|---------------------|
| T-EIGENLAYER-SPENDER-DRIFT-1 | KNOWN_SPENDERS_ETHEREUM "EigenLayer StrategyManager" row ↔ `getEigenLayerStrategyManagerAddress(1)` cross-view byte-identity | `test/config-contracts.test.ts` "T-EIGENLAYER-SPENDER-DRIFT-1 — ... byte-identical" |
| T-ROCKETPOOL-SPENDER-DRIFT-1 | KNOWN_SPENDERS_ETHEREUM "Rocket Pool RocketDepositPool" + "Rocket Pool rETH token (burn target)" rows ↔ SOT getters cross-view byte-identity | `test/config-contracts.test.ts` "T-ROCKETPOOL-SPENDER-DRIFT-1a" + "T-ROCKETPOOL-SPENDER-DRIFT-1b" |
| T-DISPATCH-COLLISION-31 | CANONICAL_DISPATCH_TARGETS[1] has all 7 curated strategy proxies as distinct entries — a bug routing deposit to a non-allowlisted strategy fires DISPATCH_TARGET_REFUSED | `test/security-canonical-dispatch.test.ts` "Ethereum (1) Set includes all 7 curated EigenLayer strategy proxies" |
| T-A1-A2-UNVERIFIED-DRIFT | A1/A2/A4 resolved against live mainnet at planner-gate; values committed inline. Audit trail in `31-01-PLANNER-GATE-VERIFICATION.md` | `scripts/verify-phase31-addresses.mjs` re-runnable for future re-verification |
| T-31-SC | Zero new npm packages installed | `package.json` unchanged |
| T-FROZEN-31 | `payload-fingerprint.ts` / `presign-hash.ts` / `handle-store.ts` / `send_transaction.ts` / `clients/etherscan.ts` all byte-identical to baseline | `git diff --stat` returns empty for those 5 files |

## Cross-View Byte-Identity Anchors

The two cross-SOT byte-identity invariants Phase 31 introduces:

- `getEigenLayerLstTokenAddress(1, "stETH") === getLidoStethAddress(1)` — anchored at `EIGENLAYER_RAW[1].lstTokens.stETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` (same literal as `LIDO_RAW[1].steth`).
- `getEigenLayerLstTokenAddress(1, "rETH") === getRocketPoolRethAddress(1)` — anchored at `EIGENLAYER_RAW[1].lstTokens.rETH = 0xae78736Cd615f374D3085123A210448E74Fc6393` (same literal as `ROCKETPOOL_RAW[1].reth`).

## Vitest Trajectory

| Stage | Tests passing | Net delta |
|-------|--------------:|----------:|
| Pre-task baseline (origin/main at `a3e873f`) | 3537 | — |
| Post-Task-2 (`test/config-contracts.test.ts` +40) | 3577 | +40 |
| Post-Task-3 (`test/security-canonical-dispatch.test.ts` +9; pre-existing size assertion bumped — same count) | 3577 | +40 |

(`test/security-canonical-dispatch.test.ts` went from 32 → 41 tests; pre-existing pinned size assertion was UPDATED in place, not added, so test-file row count is +9 but test-suite count is +9 — net suite delta is +40, sourced from +40 contracts + +9 dispatch − (number of orig dispatch tests displaced by edits = 0; the 29 → 38 update was an in-place edit of an existing test, not removing one).)

## Cross-Reference

- Planner-gate audit trail: `.planning/phases/31-evm-eigenlayer-rocket-pool/31-01-PLANNER-GATE-VERIFICATION.md`
- Re-verification script: `scripts/verify-phase31-addresses.mjs`
- CONTEXT decisions resolved: D-01 (EigenLayer + Rocket Pool SOT shape), D-04 (curated 7-LST registry), D-12 (canonical-dispatch Ethereum arm extended), D-12a (3 additive KNOWN_SPENDERS rows; cross-view byte-identity enforced)
- Plans consuming this foundation: 31-02 (EigenLayer reads + deposit), 31-03 (Rocket Pool reads + stake + unstake)

## Self-Check: PASSED

- `.planning/phases/31-evm-eigenlayer-rocket-pool/31-01-PLANNER-GATE-VERIFICATION.md` — FOUND
- `scripts/verify-phase31-addresses.mjs` — FOUND
- `src/config/contracts.ts` (modified) — FOUND
- `src/security/canonical-dispatch.ts` (modified) — FOUND
- `test/config-contracts.test.ts` (modified) — FOUND
- `test/security-canonical-dispatch.test.ts` (modified) — FOUND
- Commit `242261f` (Task 1) — FOUND in git log
- Commit `0e25ebc` (Task 2) — FOUND in git log
- Commit `2fd3677` (Task 3) — FOUND in git log
