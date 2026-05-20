---
phase: 28
plan: 02
subsystem: protocols/compound-v3 + tools/prepare_compound_supply + tools/prepare_compound_withdraw + chains/compound-v3 (partial)
tags: [compound-v3, prepare, intent-gate, ledger-blind-sign, cmp-03, cmp-04]
requires: [28-01]
provides: [_compoundChains.deriveIntent, prepare_compound_supply, prepare_compound_withdraw, COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE, COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE]
affects: [register-all.ts, signing/blocks.ts]
tech_stack:
  added: []
  patterns: [ESM spy-affordance indirection, intent-vs-reality gate, structuredContent.hintTool refusal pattern]
key_files:
  created:
    - src/chains/compound-v3.ts
    - src/tools/prepare_compound_supply.ts
    - src/tools/prepare_compound_withdraw.ts
    - test/chains-compound-v3.test.ts
    - test/prepare-compound-supply.test.ts
    - test/prepare-compound-withdraw.test.ts
  modified:
    - src/signing/blocks.ts (+57 lines, append-only)
    - src/tools/register-all.ts (+2 imports)
    - test/signing-blocks.test.ts (+4 cases, 2 new template assertions)
decisions:
  - "D-supply-routing: supply gate refuses ONLY when asset === baseToken AND borrowBalance > 0 (existing debt). Zero-debt base-asset supply IS a valid lender position (T2 happy path)."
  - "D-withdraw-routing: withdraw gate refuses ONLY when asset === baseToken AND balanceOf === 0 (no supply position; the borrow disambiguation case). Base-asset withdraw against healthy supply IS a valid unwind."
  - "hint.tool plumbing: surfaced via structuredContent.hintTool at the per-tool level — keeps src/signing/error-codes.ts FROZEN (the locked 21-code union unchanged). Patterns § 11 FROZEN-area discipline wins over envelope-extension ergonomics."
  - "MAX_UINT256 acceptance: prepare_compound_withdraw accepts amount: 'max' (lowercase strict-equality T-MAX-SPELLING-1 → MAX_UINT256 literal); prepare_compound_supply does NOT (Compound's supply-base-MAX_UINT256 is the full-repay sentinel handled by prepare_compound_repay in Plan 28-03)."
metrics:
  duration: ~75min
  tasks_completed: 13
  files_changed: 9
  lines_added: 2208
  tests_added: 62
  total_tests: 1452
  completed_date: 2026-05-20
---

# Phase 28 Plan 28-02: prepare_compound_supply + prepare_compound_withdraw + deriveIntent shared helper Summary

**One-liner:** Forward-direction Compound V3 prepare tools (supply / withdraw) with a shared `_compoundChains.deriveIntent` helper that discriminates the 4 agent intents from the 2 calldata selectors via on-chain RPC reads, refusing intent-vs-reality mismatches with `INVALID_INPUT + structuredContent.hintTool` while keeping the 21-code error union FROZEN.

## What Shipped

### `src/chains/compound-v3.ts` (NEW, partial)

- `readBaseToken(client, comet)` — `Comet.baseToken()`
- `readBorrowBalance(client, comet, user)` — `Comet.borrowBalanceOf(user)`
- `readBaseBalance(client, comet, user)` — `Comet.balanceOf(user)` (lender position in base asset; collateral lives in `collateralBalanceOf` shipping in Plan 28-04)
- `deriveIntent(client, comet, user, selector, asset)` — 4-arm intent label (`supply-collateral` / `repay-debt` / `withdraw-collateral` / `borrow`). 1-2 RPC reads (cheap path: 1 read when `asset !== baseToken`).
- `_compoundChains` ESM spy indirection per CLAUDE.md.

Full `getCometState` + `getAllCometStates` multicall fan-out deferred to Plan 28-04.

### `src/tools/prepare_compound_supply.ts` (NEW, CMP-03)

Handler flow:
1. Validate `chain === "ethereum"` (v2.3 lock).
2. Validate `comet` / `asset` address shape.
3. **Cheap allowlist gate** — `getAllCompoundCometsForChain(1).includes(getAddress(comet))` BEFORE any RPC read.
4. `resolveFrom({ rawFrom, chainId })`.
5. **Intent-gate prologue** — `_compoundChains.deriveIntent("supply", ...)`. If `intent === "repay-debt"` → refuse with `INVALID_INPUT` + `structuredContent.hintTool: "prepare_compound_repay"` + message naming the correct tool.
6. Resolve decimals (registry-cache-first; live RPC fallback).
7. `parseAmountStrict(amount, decimals)` — rejects `"max"` as INVALID_INPUT kind format.
8. `encodeCompoundSupply(asset, amountWei)` from Plan 28-01.
9. `tx = { chainId: 1, to: comet, valueWei: 0n, data }`; `computePayloadFingerprint` + `createHandle`.
10. PREPARE RECEIPT with verbatim args.

### `src/tools/prepare_compound_withdraw.ts` (NEW, CMP-04)

Mirror of supply with:
- Selector: `withdraw`.
- Intent-gate: refuse on `intent === "borrow"` with `hintTool: "prepare_compound_borrow"`.
- `"max"` arm: strict-equality `rawAmount === "max"` → `MAX_UINT256`. Other spellings flow to `parseAmountStrict` and reject (T-MAX-SPELLING-1).
- RECEIPT renders `amount: max` VERBATIM (NOT the resolved hex) per CLAUDE.md PREPARE RECEIPT convention.

### `src/signing/blocks.ts` (MODIFY, append-only)

Two new PREPARE RECEIPT templates (`COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE` + `COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE`). 4-slot: chain + comet + asset + amount. Pre-existing templates byte-identical.

### `src/tools/register-all.ts` (MODIFY)

+2 side-effect imports after the `prepare_aave_*` block.

### Tests (+62 cases)

| File | Cases |
|------|-------|
| `test/chains-compound-v3.test.ts` | 12 — per-helper readContract shape; `deriveIntent` 4-arm × 6 scenarios; EIP-55 case-insensitivity; `_compoundChains` referential equality |
| `test/prepare-compound-supply.test.ts` | 14 — 2 happy paths (collateral + base-asset-no-debt); **intent-gate refusal → hintTool: prepare_compound_repay**; cheap Comet gate refusal; `"max"` rejection; format errors; demo refusal; WC-session refusal; **Fixture R fingerprint anchor (re-anchored from test/signing-fingerprint.test.ts:213)** |
| `test/prepare-compound-withdraw.test.ts` | 16 — 2 happy paths; **intent-gate refusal → hintTool: prepare_compound_borrow**; cheap Comet gate refusal; **`"max"` → MAX_UINT256 happy path + RECEIPT verbatim "max" rendering**; T-MAX-SPELLING-1 (MAX / unlimited / infinite); demo refusal; WC-session refusal; **Fixture S fingerprint anchor (re-anchored from test/signing-fingerprint.test.ts:232)** |
| `test/signing-blocks.test.ts` | +4 cases — byte-identity for 2 new templates; verbatim "max" substitution |

## Deviations from Plan

**None.** Plan executed exactly as written. One micro-correction during test development: the runtime refusal message renders `"not in canonical Compound V3 mainnet allowlist"` (no leading `"the"`); test expectation updated to match the actual message before commit.

## Cryptographic Anchors

- **Fixture R** (`supply(USDC, 100e6)` on cUSDCv3 chainId=1 value=0) → `0x09410c3060d1da3b7434450f172e9951928c22b838193be3f7b9956a603dfa9d`. Re-anchored at `test/prepare-compound-supply.test.ts` T9. Drift breaks BOTH this assertion AND `test/signing-fingerprint.test.ts:213`.
- **Fixture S** (`withdraw(USDC, 100e6)` on cUSDCv3) → `0x75d0cc3b899579ed4a7e2d8e6cb36386dc105ed97d326c73bcdafeed5dcfd70c`. Re-anchored at `test/prepare-compound-withdraw.test.ts` T9.

## FROZEN-Area Verification

`git diff origin/main` returns EMPTY for ALL of:
- `src/signing/payload-fingerprint.ts`
- `src/signing/presign-hash.ts`
- `src/signing/handle-store.ts`
- `src/tools/send_transaction.ts`
- `src/signing/error-codes.ts` (21-code locked union — NO new codes)
- `src/signing/payload-fingerprint-solana.ts`
- `src/signing/presign-hash-solana.ts`
- `src/signing/simulation-solana.ts`
- `src/config/contracts.ts` (consumes Plan 28-01's `COMPOUND_COMETS_RAW`)
- `src/protocols/compound-v3.ts` (consumes Plan 28-01's encoders)

## Phase 28 Boundary Discipline

NOT shipped here (intentional):
- `prepare_compound_borrow` / `prepare_compound_repay` → Plan 28-03.
- `get_compound_market_info` / `get_lending_positions` Compound arm / `LEDGER_NOTICE_COMPOUND_TEMPLATE` / `canonical-dispatch.ts` Compound allowlist → Plan 28-04.
- Full `getCometState` + `getAllCometStates` multicall fan-out → Plan 28-04.

## Self-Check: PASSED

- [x] `src/chains/compound-v3.ts` exists with the 4 helpers + `_compoundChains` spy.
- [x] `src/tools/prepare_compound_supply.ts` + `_withdraw.ts` exist and route through `_compoundChains.deriveIntent`.
- [x] Comet allowlist gate fires BEFORE any RPC read (asserted via spy in T4).
- [x] Intent-gate refusals use `INVALID_INPUT` + `structuredContent.hintTool` at per-tool level (`error-codes.ts` FROZEN).
- [x] `prepare_compound_supply` does NOT accept `"max"`; `prepare_compound_withdraw` accepts lowercase strict-equality only.
- [x] Both PREPARE RECEIPT templates appended (pre-existing templates byte-identical).
- [x] register-all.ts has the 2 new imports.
- [x] All 62 new test cases pass; full suite 1452/1452.
- [x] FROZEN-area zero-diff verified.
- [x] No inlined Comet addresses in `src/tools/`.
- [x] PR #86 opened with structured body covering Summary / Plan / Deviations / Test plan / Phase boundary.

**PR:** [#86](https://github.com/szhygulin/vaultpilot-mcp-gsd-inspired/pull/86)
**Commit:** cbd9d97
