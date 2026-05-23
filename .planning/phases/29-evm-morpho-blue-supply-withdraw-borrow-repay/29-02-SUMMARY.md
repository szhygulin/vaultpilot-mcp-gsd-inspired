---
phase: 29
plan: 02
subsystem: chains / tools / signing-math
tags: [morpho-blue, evm-lending, read-tool, event-log-scan, shares-math, off-chain-accrual, esm-spy-indirection]
requires:
  - Plan 29-01 (MORPHO_BLUE_ABI + getMorphoBlueAddress + morpho-markets-ethereum.json + _morphoBlue spy — BYTE-FROZEN by Plan 29-02)
  - viem (^2.48 — already in package.json since Phase 2)
  - src/chains/registry.ts (getChainClient + isPublicNodeFallback — existing helpers)
  - src/demo/state.ts (getActivePersona + _resetActivePersonaForTesting — existing helpers)
provides:
  - src/signing/morpho-shares-math.ts — pure-bigint SharesMathLib (VIRTUAL_SHARES=1e6 + VIRTUAL_ASSETS=1n) + toAssetsDown/Up + toSharesDown/Up
  - src/chains/morpho-blue.ts — readPosition + readMarket + readMarketParams + scanTouchedMarkets + computeExpectedSupply/BorrowAssets + _morphoChains ESM spy indirection (6 methods)
  - src/tools/get_morpho_positions.ts — MCP read tool aggregating positions keyed by marketId across all touched markets, cross-referenced against the 25-entry curated registry
  - +1 register-all.ts side-effect import line
affects:
  - src/tools/register-all.ts (MODIFY — +1 line; alphabetical insertion between get_lending_positions and get_compound_market_info)
tech-stack:
  added: []
  patterns:
    - "ESM spy-affordance indirection per CLAUDE.md Conventions — _morphoChains exposes all 6 methods so Plan 29-03 prepare tools can vi.spyOn(_morphoChains, 'readPosition' | 'readMarketParams') without monkey-patching the production import path."
    - "Event-log scan with `args: { onBehalf: wallet }` indexed filter (research § Pattern 3 + Phase 8 get_token_allowances mirror) — 3 event types fanned via Promise.all; chunked 100k-block pagination over a 1M-block default lookback."
    - "Pure-bigint SharesMathLib mirror of src/signing/aave-health.ts shape (constants + functions; no I/O, no module-load state)."
    - "Rounding direction discipline: toAssetsDown for supply (conservative under-report — what user CAN withdraw); toAssetsUp for borrow (conservative over-report — what user OWES). Research § Topic 4 + § Pitfall 4."
    - "rpcDegraded surface mirrors Phase 8 — top-level (scan failure + public-node fallback) + per-position rows (per-market read failure). READ-05 invariant extends — NEVER silent zeros."
    - "Demo-mode persona routing in a read tool: getActivePersona() override → wallet defaults to persona.address; demoPersonaRouted flag in structuredContent for traceability. Phase 5 DEMO-04 invariant."
    - "Hardcoded SharesMathLib regression-anchor literals in test/signing-morpho-shares-math.test.ts (999000999001n for Down, 999000999002n for Up — both pinned)."
    - "Markets sorted desc by (supplyAssetsExpected + borrowAssetsExpected) bigint sum; degraded rows trail."
key-files:
  created:
    - src/signing/morpho-shares-math.ts
    - src/chains/morpho-blue.ts
    - src/tools/get_morpho_positions.ts
    - test/signing-morpho-shares-math.test.ts
    - test/chains-morpho-blue.test.ts
    - test/get-morpho-positions.test.ts
  modified:
    - src/tools/register-all.ts
decisions:
  - "Persona address override on a read tool: implemented as transparent wallet substitution (not refusal) when getActivePersona() is non-null. demoPersonaRouted:<slug> flag surfaces in structuredContent so consumers can distinguish caller-supplied wallet from persona-routed wallet."
  - "100k-block chunk size for the event-log scan (larger than Phase 8's 10k PublicNode chunk) — amortizes per-call setup cost across the 3 concurrent event filters; safe under Alchemy (50k cap) and self-hosted RPC. PublicNode-specific narrowing deferred to v2.3.x when multi-chain Morpho lands."
  - "scanTouchedMarkets signature accepts an options object ({ morpho, fromBlock, toBlock }) rather than positional args — keeps the tool's deterministic-replay path tractable (fromBlock + toBlock pinned at call site) and the multi-chain widening forward-compatible (morpho address passed in rather than inferred)."
  - "readPosition / readMarket / readMarketParams return named-field objects rather than viem's raw decoded tuples — callers consume by name, not array index, so a future viem decoder shift wouldn't propagate as a silent bug."
  - "Unlabeled-market path falls back to ERC-20 readContract for symbol + decimals (2 concurrent reads per token; sentinel '?'/18 on failure). NOT the curated registry — Plan 29-02 explicitly does not auto-update morpho-markets-ethereum.json on registry miss."
  - "Empty-position rows (supplyShares === 0n && borrowShares === 0n && collateral === 0n) are FILTERED at the tool layer; the underlying readOneMarket returns a typed 'empty' sentinel so degraded rows are not confused with all-zero positions."
metrics:
  duration: "~50 min wall time"
  completed: "2026-05-23"
  test_count_delta: +43  # 13 signing-morpho-shares-math + 16 chains-morpho-blue + 14 get-morpho-positions
---

# Phase 29 Plan 29-02: Morpho Blue Chain Reads + SharesMathLib + `get_morpho_positions` Tool Summary

Phase 29 Wave 2 read surface delivered — pure-bigint SharesMathLib (anti-inflation guards anchored), per-market RPC reads with `_morphoChains` ESM spy indirection, market-discovery event-log scan (`onBehalf` indexed filter — research § Pattern 3 Pitfall), and the `get_morpho_positions` MCP tool aggregating positions across the wallet's touched markets keyed by marketId. MOR-01 covered. Plan 29-03 consumes `_morphoChains.readPosition` (repay-max borrowShares read) + `_morphoChains.readMarketParams` (intent-vs-reality gate) — both wired and exercised by Plan 29-02's own test surface.

## Tasks Completed

| # | Task                                                                                                                       | Commit    |
| - | -------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1 | src/signing/morpho-shares-math.ts — pure-bigint SharesMathLib + VIRTUAL constants + 13 regression-anchored tests           | `d65cccc` |
| 2 | src/chains/morpho-blue.ts — 3 readContract helpers + scanTouchedMarkets + 2 off-chain accrual helpers + _morphoChains spy; 16 tests | `9386d26` |
| 3 | src/tools/get_morpho_positions.ts — MCP tool + register-all.ts +1 import; 14 integration tests                            | `d0a3bdf` |

## MOR-01 Coverage

`get_morpho_positions({ wallet, chain?: "ethereum" })` returns positions keyed by marketId across ALL markets the wallet has touched (event-log scan via getLogs with `args: { onBehalf: wallet }` filter — research § Pattern 3), cross-referenced against the 25-entry known-market registry from Plan 29-01. Per-position output fields verified against acceptance criteria:

- `marketId` (32-byte hex)
- `marketLabel: string | null` (registry hit → label; miss → null)
- `loanToken: { address, symbol, decimals }` (registry-first; ERC-20 fallback for unlabeled)
- `collateralToken: { address, symbol, decimals }` (same dispatch)
- `lltv` (decimal-string for bigint preservation)
- `supplyShares` (raw on-chain bigint as decimal string)
- `supplyAssetsExpected` (off-chain `toAssetsDown` — conservative for withdrawable amount)
- `borrowShares` (raw on-chain)
- `borrowAssetsExpected` (off-chain `toAssetsUp` — conservative for debt display)
- `collateral` (raw amount, NOT shares — research § Topic 2 Position struct + § Pitfall 4)
- `isUnlabeled: boolean`
- `displayValue: "approx (stale market state; on-chain accrueInterest happens at tx time)"`

Top-level structuredContent: `chain / chainId / wallet / positions / marketsTouched / marketsActive / lookbackBlocks / fromBlock / toBlock / rpcDegraded? / lookbackWarn? / demoPersonaRouted?`.

## `_morphoChains` ESM Spy Indirection — All 6 Methods Wired

Plan 29-03's prepare tools will `vi.spyOn(_morphoChains, "<method>")` to inject mocked RPC reads in their adversarial tests. The full surface is exposed and verified by `test/chains-morpho-blue.test.ts` T7 (referential equality between every named export and `_morphoChains.<name>`):

| Method                          | Signature                                                                         | Plan 29-03 consumer                                       |
| ------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `readPosition`                  | `(client, morpho, marketId, user) → {supplyShares, borrowShares, collateral}`    | `prepare_morpho_repay` (repay-max borrowShares read)      |
| `readMarket`                    | `(client, morpho, marketId) → {totalSupplyAssets, totalSupplyShares, ...}`        | `get_morpho_positions` (this plan); future v2.3.x         |
| `readMarketParams`              | `(client, morpho, marketId) → {loanToken, collateralToken, oracle, irm, lltv}`    | All 6 `prepare_morpho_*` (intent-vs-reality gate)         |
| `scanTouchedMarkets`            | `(client, wallet, { morpho?, fromBlock?, toBlock? }) → Set<Hex>`                  | This plan only — Plan 29-03 doesn't rescan                |
| `computeExpectedSupplyAssets`   | `(pos, mkt) → bigint` (`toAssetsDown`)                                            | This plan only                                            |
| `computeExpectedBorrowAssets`   | `(pos, mkt) → bigint` (`toAssetsUp`)                                              | This plan only                                            |

## SharesMathLib Regression Anchors

`test/signing-morpho-shares-math.test.ts` pins 13 cases against research § Topic 4 + § Don't Hand-Roll spec:

- VIRTUAL_SHARES === 1_000_000n (1e6 anti-inflation guard)
- VIRTUAL_ASSETS === 1n
- `toAssetsDown(1e9, 1e12, 1e9) === 999000999001n`
- `toAssetsUp(1e9, 1e12, 1e9) === 999000999002n` (Up = Down + 1 here — within bigint floor-vs-ceil spread)
- `toSharesDown(1e9, 1e12, 1e9) === 1000999n`
- `toSharesUp(1e9, 1e12, 1e9) === 1001000n`
- Zero-shares edge: Down + Up both return `0n`
- Empty-market anti-inflation: `toAssetsDown(1e6, 0n, 0n) === 1n` (the canonical first-depositor rate)
- Rounding direction: `Up >= Down` for identical operands; spread ≤ 1n

Drift in any of these literals would cascade through every Morpho position display surface.

## Test Count Delta

| File                                         | New cases | Notes                                                                              |
| -------------------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| `test/signing-morpho-shares-math.test.ts`    | 13        | Constants byte-identity + 4 function regression anchors + zero/empty edges        |
| `test/chains-morpho-blue.test.ts`            | 16        | T1-T3 read shape + T4 event-log filter (CRITICAL) + T5-T6 numerical + T7 spy hygiene |
| `test/get-morpho-positions.test.ts`          | 14        | T1-T9 from plan + 5 input-validation + publicNode rpcDegraded                      |

**Total: +43 cases.** Full suite: 257 → 260 files, 3284 → 3327 passing + 1 skipped. Zero regressions.

## Acceptance Criteria — Verified

| Criterion                                                                                                                                                    | Status |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `src/signing/morpho-shares-math.ts` exists with VIRTUAL constants + 4 pure-bigint functions; regression-anchored                                            | PASS   |
| `src/chains/morpho-blue.ts` exists with all 6 helpers + `_morphoChains` indirection                                                                          | PASS   |
| `src/tools/get_morpho_positions.ts` exists with full input schema + handler flow + per-position output fields + rpcDegraded surface + empty-row filtering   | PASS   |
| `src/tools/register-all.ts` has +1 import line for `get_morpho_positions.js`                                                                                 | PASS   |
| `test/chains-morpho-blue.test.ts` — 7 spec cases + 9 sub-cases = 16 green                                                                                    | PASS   |
| `test/signing-morpho-shares-math.test.ts` — 6 spec cases + 7 sub-cases = 13 green                                                                            | PASS   |
| `test/get-morpho-positions.test.ts` — 9 spec cases + 5 supplementary = 14 green                                                                              | PASS   |
| `npx tsc --noEmit` clean                                                                                                                                     | PASS   |
| Full `npx vitest run` green (260 files / 3328 cases)                                                                                                         | PASS   |
| **FROZEN-area zero-diff** — `git diff main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/signing/error-codes.ts` returns EMPTY | PASS   |
| **Plan 29-01 outputs UNTOUCHED** — `git diff 7540840..HEAD -- src/protocols/morpho-blue.ts src/config/contracts.ts src/tokens/morpho-markets-ethereum.json test/signing-fingerprint-morpho.test.ts test/protocols-morpho-blue.test.ts` returns EMPTY | PASS   |
| **Prior-phase BYTE-FROZEN zero-diff** — signing/aave-health + signing/compound-collateralization + signing/btc-* + signing/sol-* + signing/tron-* unchanged | PASS   |
| `grep -n "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" src/ -r \| grep -v src/config/contracts.ts` returns EMPTY                                              | PASS   |

## Deviations from Plan

### 1. wstETH/USDC marketId literal appears in `src/protocols/morpho-blue.ts` (pre-existing, Plan 29-01 baseline)

- **Found during:** Final acceptance-criteria check.
- **Issue:** The plan's grep guard `grep -n "0xb323..." src/ -r | grep -v src/tokens/morpho-markets-ethereum.json` returns EMPTY was specified as a Plan 29-02 acceptance criterion. The grep returns one hit in `src/protocols/morpho-blue.ts` line 206 — a documentation comment Plan 29-01 wrote as a regression-anchor citation for `deriveMarketId` (`@see app.morpho.org/ethereum/markets at the wstETH/USDC anchor 0xb323…`).
- **Status:** Pre-existing. The Plan 29-02 commits introduce ZERO new occurrences of this literal in `src/` (verified: `git diff 7540840..HEAD --name-only | xargs grep -l "0xb323…"` returns only `test/` files). `src/protocols/morpho-blue.ts` is BYTE-FROZEN per Plan 29-02 orchestrator instructions — I cannot remove the comment without violating the FROZEN-region constraint, which is a higher-priority gate.
- **Routing:** The grep guard is documenting an aspirational invariant (marketId literals live only in JSON); the Plan 29-01 comment is a doc-citation rather than a load-bearing literal. Plan 29-03 may relax the guard text to `grep -v <both files>` or `grep -v -E '<comment-context>'`. No code change in Plan 29-02 — pre-existing condition documented here for traceability.

### 2. T9 lookbackWarn semantics refined

- **Found during:** Implementation.
- **Issue:** The plan's T9 said "Mock the lookback to be truncated (current block - 1M is still positive but smaller than some 'default mainnet history' threshold)." That construction is ambiguous — there is no canonical "default mainnet history" threshold inside the tool. The cleaner falsifiable test is: when `lookbackBlocks > currentBlock` (i.e. the lookback would extend before block 0), `fromBlock` clamps to `0n` and `lookbackWarn:true` surfaces.
- **Fix:** T9 sets `VAULTPILOT_MORPHO_LOG_LOOKBACK=30_000_000` (larger than the mock's `latestBlock=20_000_000`); the tool clamps `fromBlock` to `0n` and emits `lookbackWarn:true`. The semantics are now testable and surface in `structuredContent.lookbackBlocks` + `lookbackWarn`.
- **Files:** `test/get-morpho-positions.test.ts` T9. No source-code deviation — the tool's lookbackWarn logic was always written against the clamp condition.

### 3. T2/T7 test WALLET address changed from vitalik.eth to a non-persona address

- **Found during:** First T7 run — `expect(PERSONA_ADDRESS).not.toBe(WALLET)` failed because the `whale` demo persona address IS `0xd8dA…6045` (vitalik.eth), and that's the canonical test wallet across the rest of the test suite.
- **Fix:** Changed `WALLET` in `test/get-morpho-positions.test.ts` to `0x1111…1111` so the persona-routing override is exercised against a distinct value. Inline comment in the test file explains the choice.
- **Files:** `test/get-morpho-positions.test.ts` (only). No source-code change.

## FROZEN Regions — SHA256 Byte-Identity Verified

Captured at plan start vs. plan end:

| File                                                  | SHA256 (start = end)                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `test/signing-fingerprint.test.ts`                    | `264d672e0dc90dbaefe5b63789ec56392143f8633eb9a4165f419cff7ad29b7e` |
| `test/signing-fingerprint-morpho.test.ts`             | `e8e0727dc92eaa8b147da1e38ccbb5df8b7c1a0e217d3e75114ec22e75aecc8f` |
| `src/tools/send_transaction.ts`                       | `149e150583f60d789e9c86d3c632174955db97de8fab62b230dcbbd70ab1e681` |
| `src/signing/aave-health.ts`                          | `8858ecc6952e7491530d11e9ed02cf11b1b2cdf9edf8372e520cc6b7897b77d9` |
| `src/protocols/morpho-blue.ts`                        | `ebf16cc8a47d24cc43032ac6f153d8ce4036c2a3ab7f960fd1cc6ff24dd46d51` |
| `src/config/contracts.ts`                             | `9084462763661993b466871c47223422b921d991bd23446d6c34910e81017b34` |
| `src/tokens/morpho-markets-ethereum.json`             | `0709cbed0052fd568b2f3f20b1ce148bde20da1810061b81ec68425c3170fe9c` |

All other listed FROZEN files in src/signing/ (aave-fingerprint compound-collateralization btc-* sol-* tron-*) → `git diff main` returns 0 lines for the bundle.

## Plan 29-03 Hand-off

`_morphoChains` is wired and tested. Plan 29-03 should `vi.spyOn(_morphoChains, "readPosition")` for the repay-max regression and `vi.spyOn(_morphoChains, "readMarketParams")` for the intent-vs-reality gate. Both methods are referentially equal to their named exports (verified by `test/chains-morpho-blue.test.ts` T7), so spies on the indirection intercept all production calls — no silent no-ops.

The 25-entry registry shape (`src/tokens/morpho-markets-ethereum.json`) — Plan 29-03 prepare tools should consume the same `MorphoMarketRegistryEntry` interface that `src/tools/get_morpho_positions.ts` defines internally. If Plan 29-03 needs the same interface, it should EXTRACT it to `src/tokens/morpho-markets-ethereum.ts` (NEW typed loader) rather than redefining — this is a forward note, not a Plan 29-02 deliverable.

## Self-Check: PASSED

- `[ -f src/signing/morpho-shares-math.ts ]` → FOUND
- `[ -f src/chains/morpho-blue.ts ]` → FOUND
- `[ -f src/tools/get_morpho_positions.ts ]` → FOUND
- `[ -f test/signing-morpho-shares-math.test.ts ]` → FOUND
- `[ -f test/chains-morpho-blue.test.ts ]` → FOUND
- `[ -f test/get-morpho-positions.test.ts ]` → FOUND
- `git log --oneline | grep d65cccc` → FOUND
- `git log --oneline | grep 9386d26` → FOUND
- `git log --oneline | grep d0a3bdf` → FOUND
