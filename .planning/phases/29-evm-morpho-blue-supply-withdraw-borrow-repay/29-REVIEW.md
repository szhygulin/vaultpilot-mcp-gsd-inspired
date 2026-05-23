---
phase: 29-evm-morpho-blue-supply-withdraw-borrow-repay
reviewed: 2026-05-23T07:50:00Z
depth: standard
files_reviewed: 35
files_reviewed_list:
  - src/chains/morpho-blue.ts
  - src/config/contracts.ts
  - src/protocols/morpho-blue.ts
  - src/security/canonical-dispatch.ts
  - src/signing/blocks.ts
  - src/signing/morpho-shares-math.ts
  - src/tokens/morpho-markets-ethereum.json
  - src/tools/get_lending_positions.ts
  - src/tools/get_morpho_positions.ts
  - src/tools/prepare_morpho_borrow.ts
  - src/tools/prepare_morpho_repay.ts
  - src/tools/prepare_morpho_supply.ts
  - src/tools/prepare_morpho_supply_collateral.ts
  - src/tools/prepare_morpho_withdraw.ts
  - src/tools/prepare_morpho_withdraw_collateral.ts
  - src/tools/preview_send.ts
  - src/tools/register-all.ts
  - test/chains-morpho-blue.test.ts
  - test/config-contracts.test.ts
  - test/get-lending-positions.test.ts
  - test/get-morpho-positions.test.ts
  - test/lifecycle-tron-stake-19.integration.test.ts
  - test/morpho-blue-lifecycle.integration.test.ts
  - test/prepare-morpho-borrow.test.ts
  - test/prepare-morpho-repay.test.ts
  - test/prepare-morpho-supply-collateral.test.ts
  - test/prepare-morpho-supply.test.ts
  - test/prepare-morpho-withdraw-collateral.test.ts
  - test/prepare-morpho-withdraw.test.ts
  - test/preview-send.dispatch-allowlist.test.ts
  - test/preview-send.morpho.test.ts
  - test/protocols-morpho-blue.test.ts
  - test/security-canonical-dispatch.test.ts
  - test/signing-blocks.test.ts
  - test/signing-fingerprint-morpho.test.ts
  - test/signing-morpho-shares-math.test.ts
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 29: Code Review Report — Morpho Blue Supply/Withdraw/Borrow/Repay

**Reviewed:** 2026-05-23
**Depth:** standard
**Files Reviewed:** 35
**Status:** issues_found

## Summary

Phase 29 adds 6 `prepare_morpho_*` tools, 1 read tool (`get_morpho_positions`), Morpho-Blue extension of `get_lending_positions`, decoder/encoder primitives, and a 6-arm `preview_send` Morpho dispatch. Critical security invariants all hold: `exactlyOneZero`, `deriveMarketId` shape (5×32-byte ABI-encode), asset-match gates with `hintTool`, intent-vs-reality gate + defense-in-depth marketId re-derivation, repay-max via share-based encoding (NOT MAX_UINT256, with explicit anti-pattern rejection), SharesMathLib constants pinned, `args: { onBehalf }` event-log filter, `_morphoChains` / `_morphoBlue` ESM spy indirections, SOT-only Morpho address resolution, no inline Morpho address outside `src/config/contracts.ts`, no new npm dep (package.json/lock byte-identical to `main`), and Phase-29 BYTE_FROZEN scope correction in `lifecycle-tron-stake-19.integration.test.ts` is documented and reasonable.

Three Warnings and two Info notes. No Critical/Blocker findings.

## Warnings

### WR-01: `get_lending_positions.ts` Morpho row missing `displayValue` stale-market annotation

**File:** `src/tools/get_lending_positions.ts:146-159, 502-515`

**Issue:** `MorphoLendingPositionRow` defines `marketId`, `marketLabel`, `supplyShares`, `supplyAssetsExpected`, `borrowShares`, `borrowAssetsExpected`, `collateral`, `isUnlabeled` — but **no `displayValue` field**. Compare with `get_morpho_positions.ts:157` which emits `displayValue: "approx (stale market state; on-chain accrueInterest happens at tx time)"` on every row.

The same `supplyAssetsExpected` / `borrowAssetsExpected` values flow from the same `_morphoChains.computeExpectedSupplyAssets` / `computeExpectedBorrowAssets` helpers, against the same stale `market()` snapshot, but only one of the two consumer tools annotates the staleness. Per the additional context severity rubric: "Missing annotation → Warning (UX integrity concern)".

A user who queries `get_lending_positions` sees a precise-looking decimal but no signal that it under/over-reports the true on-chain figure at tx time.

**Fix:** Add `displayValue: string` to `MorphoLendingPositionRow` (line 146-159) and populate at the row construction site (line 502-515):

```typescript
const row: MorphoLendingPositionRow = {
  protocol: "morpho-blue",
  marketId: id,
  // ... existing fields ...
  isUnlabeled,
  displayValue:
    "approx (stale market state; on-chain accrueInterest happens at tx time)",
};
```

---

### WR-02: `readMorphoPositionsForWallet` swallows all per-market errors silently — fidelity loss vs `get_morpho_positions`

**File:** `src/tools/get_lending_positions.ts:444-451, 517-521`

**Issue:** When a per-market `Promise.all([readPosition, readMarket, readMarketParams])` rejects, the helper returns `null` (line 521) and the row is dropped from the response (line 525 `.filter`). The user sees the wallet as having ZERO positions on that market, with no `rpcDegraded` flag or per-market degraded row to indicate that fidelity was lost.

Compare with `get_morpho_positions.ts:257-265` which emits a `{ marketId, rpcDegraded: true, reason }` degraded-row sentinel preserved through to `structuredContent.positions`. The same wallet calling `get_lending_positions` vs `get_morpho_positions` may see DIFFERENT positions because the former silently drops degraded markets.

Additionally, the event-log scan failure path (line 447-451) returns `{ rows: [], summary: { marketsTouched: 0, marketsActive: 0 } }` with NO `rpcDegraded: true` propagation. The outer handler's `isPublicNodeFallback` check only fires when the public-node fallback URL is in use — a primary-RPC scan failure that bypassed the fallback path produces a silent zero-anchor with no degraded signal.

**Fix:** Either (a) propagate per-market degraded rows + a `rpcDegraded` flag through the `MorphoSourceSummary` so the outer handler can set `result.rpcDegraded = true`, or (b) re-throw and let the outer `Promise.all` catch surface it. Recommend (a) for parity with `get_morpho_positions`. Concretely, extend `MorphoSourceSummary` with `marketsDegraded: number` and propagate `result.rpcDegraded = true` when `marketsDegraded > 0` or when the event-log scan itself failed.

---

### WR-03: `prepare_morpho_repay` `assetsForApprovalThreshold` for repay-max uses `toAssetsUp` but encodes share-based — pre-flight note threshold has no operational meaning

**File:** `src/tools/prepare_morpho_repay.ts:408-417, 440-443, 502`

**Issue:** The repay-max branch computes `assetsForApprovalThreshold = toAssetsUp(borrowShares, totals)` and uses that as the required-allowance figure (lines 411-416, 442). But the calldata encodes `repay(params, 0n, borrowShares, ...)` — share-based — so the on-chain `safeTransferFrom` pulls the ACTUAL `assetsRepaid` returned by the share-to-assets conversion AT TX TIME (after `accrueInterest`), not the stale `toAssetsUp` figure.

Two consequences:

1. **`amountWei` field in `structuredContent` is misleading.** Line 502: `amountWei: amountWei.toString()` carries `assetsForApprovalThreshold` (the stale toAssetsUp value), not the actual on-chain transfer amount. The agent / downstream tooling reading `amountWei` against a share-based repay-max will see a value that is neither the encoded shares nor the actual asset transfer.
2. **The pre-flight note threshold may understate the actual requirement.** Between prepare time and tx time, `accrueInterest` adds interest — the actual `assetsRepaid` is slightly more than the prepare-time `toAssetsUp` figure. `toAssetsUp` is conservative (rounds up), but it's against STALE totals. A user who satisfies `allowance >= toAssetsUp(stale)` may still hit revert on `allowance < assetsRepaid(fresh)` for accruing markets.

The CHECKS PERFORMED block (lines 480-484) does annotate "on-chain accrueInterest at tx time may add small additional debt — share-based encoding closes the position exactly", so the user has *some* signal, but the surfaced numeric threshold underestimates the worst case.

**Fix:** Recommend approach: for the repay-max path, change the comparison gate to `allowance < MAX_UINT256` (encouraging the canonical max-approval idiom which is the documented Morpho repay-max pattern), and update the pre-flight note's prose to be explicit that share-based repay-max needs a max-approval (or at minimum a safety-margin padded approval) because the asset amount at tx time is post-accrual. Additionally, document in `structuredContent` the semantic of `amountWei` for the share-based repay-max path (currently the field name implies it's the encoded value, but it isn't — it's the pre-flight approval-threshold estimate).

## Info

### IN-01: `void RATIO_SCALE` import-anchor pattern in `get_lending_positions.ts`

**File:** `src/tools/get_lending_positions.ts:51, 730`

**Issue:** Line 51 imports `RATIO_SCALE` from `compound-collateralization.js`; line 730 uses `void RATIO_SCALE;` to suppress unused-import warning. The comment at lines 727-730 explains the import is kept "on the import path so a single edit doesn't cascade through the type chain" — but `RATIO_SCALE` is a value export, not a type. The `void` statement is dead code and the import is unused.

**Fix:** Either remove the `RATIO_SCALE` import and the `void` statement, or convert to a type-only re-export if the cascade rationale truly applies to type narrowing elsewhere. If kept, the comment should explain *which* downstream test or consumer relies on this import chain.

---

### IN-02: Inconsistent `marketLabel` null fallback string between PREPARE RECEIPT and `structuredContent`

**File:** Six `prepare_morpho_*` tools, e.g. `src/tools/prepare_morpho_borrow.ts:72, 380, 396`

**Issue:** `lookupMarketLabel()` returns `"(unlabeled market)"` for unknown markets and is used in the PREPARE RECEIPT text (line 380). But `structuredContent.marketLabel` carries `REGISTRY.get(marketId.toLowerCase())?.label ?? null` (line 396) — `null` for unlabeled, NOT the human-friendly `"(unlabeled market)"` literal.

A downstream consumer parsing only `structuredContent.marketLabel` sees `null` and may treat the market as missing/erroneous; a consumer parsing the RECEIPT text sees a sentinel string. Same data, two contradictory representations. Repeats across all 6 prepare tools.

**Fix:** Pick one canonical representation. If `null` is the SOT (preferred — it's a true absence signal), update the receipt rendering to handle `null → "(unlabeled market)"` at the formatting boundary only. Don't double-encode at two layers.

---

_Reviewed: 2026-05-23_
_Reviewer: Claude (gsd-code-reviewer, returned inline; persisted by orchestrator)_
_Depth: standard_
