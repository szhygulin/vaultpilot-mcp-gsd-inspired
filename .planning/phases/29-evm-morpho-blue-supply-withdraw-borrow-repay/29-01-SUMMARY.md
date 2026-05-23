---
phase: 29
plan: 01
subsystem: protocols / config / signing-fixtures
tags: [morpho-blue, evm-lending, sot-extension, calldata-protocol, market-id-derivation, fingerprint-fixtures]
requires:
  - viem (^2.48 — already in package.json since Phase 2)
  - src/signing/payload-fingerprint.ts (FROZEN — unchanged)
  - src/config/contracts.ts (existing ContractsForChain + KNOWN_SPENDERS_ETHEREUM shape)
provides:
  - getMorphoBlueAddress(chainId) — SOT for Morpho Blue singleton contract (chainId 1 only this phase)
  - MORPHO_BLUE_ABI — 15-fragment parseAbi const (6 writes + 3 reads + 3 events)
  - MORPHO_BLUE_SELECTORS — 6 selectors A2-locked at write time + runtime
  - deriveMarketId(params) — keccak256(encodeAbiParameters(5-tuple)) per MarketParamsLib.sol
  - 6 encoders: encodeMorphoSupply / _Withdraw / _SupplyCollateral / _WithdrawCollateral / _Borrow / _Repay
  - decodeMorphoBlueCall — 7-arm discriminated union with marketId field re-derived
  - _morphoBlue ESM spy indirection
  - morpho-markets-ethereum.json — 25-entry top-by-TVL labeling registry
  - Fixtures V / W / X / Y — payload-fingerprint anchors
affects:
  - test/config-contracts.test.ts (MODIFY — +11 cases; 66 pre-existing untouched)
  - KNOWN_SPENDERS_ETHEREUM rows[N] (+1 'Morpho Blue' row)
tech-stack:
  added: []
  patterns:
    - "SDK rejected per CLAUDE.md SDK Scope-Probing Discipline (research § Topic 9): @morpho-org/blue-sdk + @morpho-org/morpho-blue-bundlers REJECTED."
    - "parseAbi inline as encoder/decoder SOT (Phase 28 Compound V3 precedent re-applied)."
    - "MORPHO_BLUE_RAW = Partial<Record<ChainId, Address>> sibling sub-table (NOT a widening of ContractsForChain) — Phase 28 § 3 precedent; structurally simpler than COMPOUND_COMETS_RAW (no per-base inner record)."
    - "exactlyOneZero invariant on supply/withdraw/borrow/repay encoders (research § Pitfall 1)."
    - "deriveMarketId re-derives marketId from decoded MarketParams in every decoder arm (research § Pattern 1 — on-wire calldata carries params, not id)."
    - "Hardcoded fingerprint literals (no beforeAll-snapshot) per CLAUDE.md Conventions."
    - "Cross-phase sibling-file fixture convention (Phase 28 fingerprint test BYTE-FROZEN; new sibling file for Morpho)."
key-files:
  created:
    - src/protocols/morpho-blue.ts
    - src/tokens/morpho-markets-ethereum.json
    - test/protocols-morpho-blue.test.ts
    - test/signing-fingerprint-morpho.test.ts
  modified:
    - src/config/contracts.ts
    - test/config-contracts.test.ts
decisions:
  - "Mirror Phase 28 § 3 sibling-const precedent for MORPHO_BLUE_RAW (simpler shape than COMPOUND_COMETS_RAW)."
  - "Use `whitelisted: true` filter in the GraphQL snapshot query — top 25 covers the highest-TVL real markets (collateralAsset != null, irmAddress != 0x0); excludes idle markets and unwhitelisted noise."
  - "Insert 'Morpho Blue' row in KNOWN_SPENDERS_ETHEREUM between 'Li.Fi Diamond' and '1inch Aggregation Router V6' (alphabetical M-after-L position; numerics-after-letters per existing file convention)."
  - "All 4 fixture fingerprint literals computed at write time via dist/ build; re-run verified byte-stable across two consecutive invocations."
  - "Filtered the GraphQL response in Python to drop idle / non-whitelisted markets before picking top 25; verified wstETH/USDC literal (research § Topic 3 anchor) lands at position 16/25 so the deriveMarketId regression cross-link holds."
metrics:
  duration: "~12 min wall time"
  completed: "2026-05-23"
  test_count_delta: +55  # 40 new in protocols-morpho-blue + 4 in signing-fingerprint-morpho + 11 new in config-contracts
---

# Phase 29 Plan 29-01: Morpho Blue SOT + Protocol Module + Market Registry + Fixtures V/W/X/Y Summary

Phase 29 Wave 1 prerequisite delivered — Morpho Blue contract SOT (chainId 1 only), 15-fragment ABI, 6 selectors (A2-locked), 6 encoders with exactlyOneZero invariant, 7-arm decoder with marketId re-derivation, 25-entry market labeling registry, and four hardcoded payload-fingerprint anchors. Plans 29-02 + 29-03 consume these artifacts unchanged.

## Tasks Completed

| # | Task                                                                                                                          | Commit    |
| - | ----------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1 | MORPHO_BLUE_RAW SOT + getMorphoBlueAddress + KNOWN_SPENDERS_ETHEREUM 'Morpho Blue' row                                        | `889d5ba` |
| 2 | morpho-blue.ts protocol module (15-fragment parseAbi, 6 selectors, deriveMarketId, 6 encoders, 7-arm decoder, _morphoBlue)    | `ee8b37c` |
| 3 | morpho-markets-ethereum.json — 25-entry top-by-TVL Morpho mainnet market registry snapshot                                    | `de64143` |
| 4 | A2 selector lock + deriveMarketId anchor + 7-arm decoder + JSON shape tests (40 + 11 cases across 2 files)                    | `236c2a4` |
| 5 | Fixtures V / W / X / Y — signing-fingerprint-morpho.test.ts hardcoded literal anchors (NEW sibling file; Phase 28 BYTE-FROZEN)| `a0df905` |

## Cryptographic-Binding Fixture Anchors (Fixtures V / W / X / Y)

Pinned at write time via `dist/` build and `computePayloadFingerprint` — verified byte-stable across two consecutive runs. Any drift in `src/signing/payload-fingerprint.ts` preimage assembly fails these exact assertions at PR-review time.

| Fixture | Operation                                                                          | Tx envelope                                                                | payloadFingerprint literal                                              |
| ------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| V       | `Morpho.supply(wstETH/USDC, 100e6 USDC, 0 shares, onBehalf, "0x")` (lender)        | `chainId=1, to=getMorphoBlueAddress(1)!, value=0n, data=<encoded>`         | `0x0324553236967490622dc8f9c073290508cfeb4f82acc8082db04641a7b3b1b0`    |
| W       | `Morpho.borrow(wstETH/USDC, 50e6 USDC, 0 shares, onBehalf, receiver)` (debt)       | same envelope shape                                                        | `0x38edb209009c27860acd9f5dc705b1314875646de33c0384820a4b828d58a078`    |
| X       | `Morpho.repay(wstETH/USDC, 0 assets, 1e9 mock borrowShares, onBehalf, "0x")` (repay-max share-based — research § Topic 5) | same envelope shape                          | `0x223f830e5d6bd6f544bd80bfd7afe90441c0038a7259a415e3af96127a9182a0`    |
| Y       | `Morpho.supplyCollateral(wstETH/USDC, 1e18 wstETH, onBehalf, "0x")` (collateral)   | same envelope shape                                                        | `0x95d629f91d33efb39048fc7f09ef24d4f7452c9a4ee88100f8cfc008ce4c0539`    |

Reproducer command lives in the file header comment of `test/signing-fingerprint-morpho.test.ts` for regeneration after any verified preimage change.

## Acceptance Criteria — All Green

- [x] `src/config/contracts.ts` has `MORPHO_BLUE_RAW` sibling sub-table + `getMorphoBlueAddress` + 1 new `KNOWN_SPENDERS_ETHEREUM` row referencing the SOT getter.
- [x] `src/protocols/morpho-blue.ts` exists with: `MORPHO_BLUE_ABI` (15-fragment parseAbi) + `MORPHO_BLUE_SELECTORS` (6 entries, A2-locked) + `deriveMarketId` + 6 encoders (exactlyOneZero on 4 share-bearing) + 7-arm `MorphoBlueDecoded` (marketId re-derived; isShareBased flag) + `decodeMorphoBlueCall` + `_morphoBlue` ESM spy.
- [x] `src/tokens/morpho-markets-ethereum.json` ships 25 entries × per-entry schema (marketId / loanToken {address, symbol, decimals} / collateralToken {address, symbol, decimals} / oracle / irm / lltv as decimal-string / label).
- [x] `test/protocols-morpho-blue.test.ts` has 40 cases all green: A2 6-selector lock + deriveMarketId regression anchor (+ negative case) + 6 encoder round-trips + exactlyOneZero (8 cases) + 7-arm decoder exhaustiveness + 4 unknown fall-through + ESM spy referential equality + ABI fragment shape coverage.
- [x] `test/config-contracts.test.ts` extended with 11 new Morpho cases (T1 byte-identity + T2a/b/c chain narrowing + T3 cross-view + T3b row-count + Bonus EIP-55 + T4 + T4a-T4g JSON shape). 66 pre-existing cases stay green.
- [x] `test/signing-fingerprint-morpho.test.ts` (NEW sibling) — Fixtures V / W / X / Y as `it(...)` blocks with hardcoded `0x...` payloadFingerprint literals. NO beforeAll-snapshot.
- [x] `npx tsc --noEmit` clean.
- [x] Full `npx vitest run` suite: **3284 passed | 1 skipped (3285)**.
- [x] **FROZEN-area zero-diff** — `git diff main -- src/signing/ src/tools/send_transaction.ts` → 0 lines.
- [x] **PRIOR-PHASE BYTE-FROZEN zero-diff** — `git diff main -- src/protocols/{aave-v3,compound-v3,erc20,weth9}.ts src/chains/compound-v3.ts test/signing-fingerprint*.test.ts src/tools/prepare_{compound,aave}_*.ts` → 0 lines.
- [x] `grep -rn "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" src/ | grep -v src/config/contracts.ts` → empty (format-fanout-sentinel clean).
- [x] `git diff main -- src/tools/register-all.ts` → 0 lines (Plan 29-01 registers no tools; that's Plan 29-02 / 29-03 concern).

## Deviations from Plan

### None

The plan was executed exactly as written. Two minor write-time refinements worth recording (not deviations, just choices the plan left to discretion):

**1. KNOWN_SPENDERS_ETHEREUM insertion position (write-time choice — plan said "compute at write time").**
Plan: "alphabetical insertion: 'Morpho Blue' lands between Lido/Compound rows; verify against current alphabetical state".
Actual current ordering is NOT strictly alphabetical (e.g. `1inch` follows `Li.Fi` because numerics sort after letters in the existing convention). Inserted Morpho Blue between `Li.Fi Diamond` and `1inch Aggregation Router V6` — the canonical M-after-L position. No `Lido` row exists in the current file (the plan's hypothetical anchor wasn't applicable).

**2. GraphQL filter refinement (write-time choice — plan said "snapshot top 20-30").**
Plan default query used `orderBy: "totalSupplyAssets"`. The current Morpho GraphQL schema rejects that ordering enum; the working query is `orderBy: SupplyAssetsUsd, orderDirection: Desc` (TVL in USD). Also added `whitelisted: true` filter + post-fetch filtering for `collateralAsset != null && irmAddress != 0x0` to drop idle / non-whitelisted noise markets. Result: 25 real whitelisted markets, with the wstETH/USDC anchor (research § Topic 3) landing at position 16/25 — preserves the deriveMarketId cross-link to `test/protocols-morpho-blue.test.ts T2`.

## Cross-Plan Wiring (Plan 29-02 + 29-03 Consumers)

- **Plan 29-02** imports `getMorphoBlueAddress(1)` (eth_call target) + the 3-fragment read surface from `MORPHO_BLUE_ABI` (`position` / `market` / `idToMarketParams`) + (optionally) the 3 event ABIs for getLogs-based market discovery. The position/market read primitives are LOCKED in this plan; 29-02 does NOT widen the ABI.
- **Plan 29-03** imports the 6 encoders + `decodeMorphoBlueCall` (via `_morphoBlue` spy) + `deriveMarketId` (for the intent-vs-reality gate cross-check via `idToMarketParams`) + the 25-entry registry (for preview_send DECODED ARGS labeling) + 1 KNOWN_SPENDERS_ETHEREUM row (for the user-approval label surface).
- **Format-fanout-sentinel held**: the Morpho Blue address literal `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` lives ONLY in `src/config/contracts.ts`. Downstream plans MUST import via `getMorphoBlueAddress` — verified clean today, regression test in 29-03 will lock it.

## Verification Commands (Self-Check)

```
$ git log --oneline -5
a0df905 feat(29-01): Fixtures V/W/X/Y — signing-fingerprint-morpho.test.ts hardcoded literal anchors
236c2a4 test(29-01): morpho-blue selector A2 lock + deriveMarketId anchor + 7-arm decoder + JSON shape
de64143 feat(29-01): morpho-markets-ethereum.json — 25-entry top-by-TVL registry snapshot
ee8b37c feat(29-01): morpho-blue.ts protocol module (6 selectors + 6 encoders + deriveMarketId + 7-arm decoder)
889d5ba feat(29-01): MORPHO_BLUE_RAW SOT + KNOWN_SPENDERS_ETHEREUM row + getMorphoBlueAddress

$ npx vitest run
Test Files  257 passed (257)
Tests       3284 passed | 1 skipped (3285)

$ npx tsc --noEmit
(no output — clean)

$ git diff main -- src/signing/ src/tools/send_transaction.ts | wc -l
0

$ git diff main -- src/protocols/aave-v3.ts src/protocols/compound-v3.ts src/protocols/erc20.ts src/protocols/weth9.ts src/chains/compound-v3.ts test/signing-fingerprint.test.ts test/signing-fingerprint-tron.test.ts test/signing-fingerprint-tron-19.test.ts test/signing-fingerprint-tron-20.test.ts test/signing-fingerprint-solana.test.ts | wc -l
0

$ grep -rn "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" src/ | grep -v src/config/contracts.ts
(none)

$ git diff main -- src/tools/register-all.ts | wc -l
0
```

## Self-Check: PASSED

All created files exist and all commits exist on the local branch (verified via `git log` + `ls`). Test suite passes 3284/3284 (1 unrelated pre-existing skip). FROZEN regions are byte-identical to `main`. Format-fanout-sentinel clean.

No PR opened — Phase 29 ships as ONE phase-level PR after Plans 29-02 + 29-03 land on the same branch per the repo's established Phase 23/26/27 cadence (per `gsd-pr-workflow` memory).
