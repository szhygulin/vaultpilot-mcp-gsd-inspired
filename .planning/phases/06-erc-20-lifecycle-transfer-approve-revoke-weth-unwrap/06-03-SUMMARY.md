---
phase: 06
plan: 03
subsystem: tools/erc20
tags: [erc-20, approve, revoke, unlimited-approval, known-spender, contracts-sot]
requires: [06-02]
provides:
  - src/config/contracts.ts (SOT — getWethAddress + KNOWN_SPENDERS_ETHEREUM + lookupSpender; ChainId + ContractsForChain)
  - src/tools/prepare_token_approve.ts + prepareApproveInternal shared helper
  - src/tools/prepare_revoke_approval.ts (delegates to prepareApproveInternal)
  - APPROVE_PREPARE_RECEIPT_TEMPLATE + DECODED_ARGS_TEMPLATE_APPROVE in src/signing/blocks.ts
  - approve branch in buildDecodedArgsBlock with ⚠ UNLIMITED APPROVAL strict-equality + spender-label surfacing + revoke hint
affects:
  - src/tools/preview_send.ts (passes record.tx.to to buildDecodedArgsBlock)
  - src/tools/register-all.ts (+2 import lines)
tech-stack:
  added: []
  patterns:
    - "SOT contracts module per project CLAUDE.md (mirror of src/tokens/registry.ts re-checksum pattern)"
    - "ESM spy-affordance indirection: _contracts object in src/config/contracts.ts"
    - "Shared internal helper pattern for byte-identity (prepareApproveInternal consumed by two distinct registerTool side effects)"
    - "Strict-equality unlimited threshold (no fuzzy > 1e30 — industry consensus per research § Topic 6)"
key-files:
  created:
    - src/config/contracts.ts
    - src/tools/prepare_token_approve.ts
    - src/tools/prepare_revoke_approval.ts
    - test/config-contracts.test.ts
    - test/prepare-token-approve.test.ts
    - test/prepare-revoke-approval.test.ts
  modified:
    - src/signing/blocks.ts
    - src/tools/preview_send.ts
    - src/tools/register-all.ts
    - test/preview-send.erc20.test.ts
    - test/signing-fingerprint.test.ts
decisions:
  - "11 KnownSpender entries seeded — research § Topic 7's 12-candidate list duplicated Aave; verified count is 11. Regression test asserts >= 11 so Phase 7 can extend without churn."
  - "Each KnownSpender address wrapped in getAddress(...) at the literal site — module-load validation catches a single hex-digit flip at rest."
  - "Strict-equality unlimited threshold: decodeErc20Call returns isUnlimited === (amount === MAX_UINT256). Fuzzy thresholds (> 1e30) explicitly rejected per research § Topic 6."
  - "Shared internal helper (prepareApproveInternal exported from prepare_token_approve.ts) over a separate module — keeps the cross-tool import surface minimal (one named export); revoke's distinct tool name routes by intent per research § Topic 8."
  - "PrepareArgs.to set to empty string for approve/revoke. Plan 06-02 made `to` REQUIRED (string, not optional); empty string is type-legal and the APPROVE_PREPARE_RECEIPT_TEMPLATE doesn't reference {TO}, so no presentation drift."
  - "buildDecodedArgsBlock signature widened to take recordTxTo: Address (3rd arg). Used in approve's TOKEN slot when tokenContext is null (off-list token at the approve target). Transfer branch unchanged (still uses tokenContext.symbol or '(off-list token)')."
  - "APPROVE_PREPARE_RECEIPT_TEMPLATE is distinct from ERC20_PREPARE_RECEIPT_TEMPLATE — approves have no `to:` slot, only `spender:`. Format-fanout-sentinel rule: one block, one shape, one home."
metrics:
  duration: "~50 min"
  completed: "2026-05-13"
  tasks_completed: 1
  tasks_total: 1
  tests_before: 397
  tests_after: 440
  tests_added: 43
---

# Phase 6 Plan 03: prepare_token_approve + prepare_revoke_approval + known-spender SOT + unlimited-approval surfacing — Summary

`prepare_token_approve` (PREP-26) and `prepare_revoke_approval` (PREP-27) ship over a shared `prepareApproveInternal` helper that guarantees byte-identical calldata + `payloadFingerprint` between `revoke({T, S})` and `approve({T, S, amount: "0"})`. `src/config/contracts.ts` lands as the SOT for canonical contract addresses (project CLAUDE.md-mandated location) with 11 seeded `KnownSpender` entries. `preview_send`'s DECODED ARGS block now surfaces `⚠ UNLIMITED APPROVAL` at strict equality to `MAX_UINT256` (per research § Topic 6 industry consensus — no fuzzy thresholds) plus a one-line revoke-path hint pointing the agent at `prepare_revoke_approval`.

## What shipped

- `src/config/contracts.ts` — NEW. `ChainId = 1` (Phase 8 will widen); `ContractsForChain { weth }` (Phase 7 will add `aavePool`); `getWethAddress(1)` type-safe accessor; 11 `KnownSpender` rows (Aave V3 Pool, CowSwap GPv2Settlement, Li.Fi Diamond, 1inch Aggregation Router V6, OpenSea Conduit, OpenSea Seaport 1.5, Uniswap Permit2, Uniswap V2 Router 02, Uniswap V3 SwapRouter, Uniswap V3 SwapRouter02, WETH9). Every address wrapped in `getAddress(...)` at the literal site so a corrupted snapshot throws at module load (mirror of `src/tokens/registry.ts`). `lookupSpender(spender)` is checksum-normalized before strict-equality match (T-SPENDER-CASE-1 mitigation). Exports an `_contracts` indirection for ESM spy affordance per the project CLAUDE.md convention codified in PR #26.

- `src/tools/prepare_token_approve.ts` — NEW (PREP-26). Three-arg input: `{ tokenAddress, spender, amount }`. `amount === "max"` (lowercase only) sets `amountWei = MAX_UINT256` and SKIPS `parseAmountStrict`. ANY other case (`"MAX"`, `"unlimited"`, `"infinite"`) flows through `parseAmountStrict` and gets `INVALID_INPUT` (T-MAX-SPELLING-1, strict-mode parity with `userDecision: "send"`'s enum lock). Exports `prepareApproveInternal({ rawTokenAddress, rawSpender, rawAmount, amountWei })` — the helper consumed by `prepare_revoke_approval`. Demo-mode-first sender resolution mirrors `prepare_token_send` byte-for-byte.

- `src/tools/prepare_revoke_approval.ts` — NEW (PREP-27). Two-arg input: `{ tokenAddress, spender }`. Internally delegates to `prepareApproveInternal({ ..., rawAmount: "0", amountWei: 0n })`. The cross-tool import is the byte-identity guarantor — both registered tools share ONE code path for transaction construction.

- `src/signing/blocks.ts` — MODIFIED. Adds `APPROVE_PREPARE_RECEIPT_TEMPLATE` (three-slot template: `tokenAddress / spender / amount`) and `DECODED_ARGS_TEMPLATE_APPROVE`. Replaces Plan 06-02's `kind: "approve"` TODO stub in `buildDecodedArgsBlock` with the real template. Signature widened to take `recordTxTo: Address` so the approve template's `TOKEN` slot has a canonical fallback (transfer branch unaffected). The approve branch:
  - `spenderLabel`: `_contracts.lookupSpender(decoded.spender)?.label ?? "(unknown spender — no prior interaction recorded)"` (PREP-30 literal fallback — tested as a verbatim string).
  - `amount`: `"⚠ UNLIMITED APPROVAL"` iff `decoded.isUnlimited === true` (which `decodeErc20Call` sets at STRICT equality to `MAX_UINT256` per `src/protocols/erc20.ts:158`). Bounded path uses `formatUnits(amount, decimals) + " " + symbol` when `tokenContext` known, raw bigint + "(decimals unknown — call get_token_metadata)" otherwise.
  - `revokeHint`: `"  (call prepare_revoke_approval with the same tokenAddress + spender to revoke)"` iff unlimited, else empty (filtered out via `.split("\n").filter(line => line !== "").join("\n")`).

- `src/tools/preview_send.ts` — single-line update: passes `record.tx.to` as the third arg to `buildDecodedArgsBlock`.

- `src/tools/register-all.ts` — +2 import lines (`./prepare_token_approve.js` + `./prepare_revoke_approval.js`).

## Fixture E

Hardcoded literal anchor for WETH `approve(Uniswap V3 SwapRouter, MAX_UINT256)` — computed once at execute-time, pinned forever in `test/signing-fingerprint.test.ts` AND cross-referenced in `test/prepare-token-approve.test.ts`:

```
0x46e20ff806defcabda8eb090f6cba368cb5b84ad058ff9eefd08c662185a8f5a
```

Inputs:
- `chainId: 1`
- `to: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` (WETH)
- `valueWei: 0n`
- `data: 0x095ea7b3 + 0...e592427a0aece92de3edee1f18e0157c05861564 + 64 hex `f`s`

Drift in `payload-fingerprint.ts` preimage assembly for `approve`-shape data fails this exact assertion at PR-review time.

## Byte-identity invariant

`test/prepare-revoke-approval.test.ts` Test "BYTE-IDENTITY INVARIANT (T-REVOKE-DRIFT-1)" asserts in a single test setup:

```
prepare_revoke_approval({ tokenAddress: USDC, spender: UniV3 })
  .structuredContent.payloadFingerprint
===
prepare_token_approve({ tokenAddress: USDC, spender: UniV3, amount: "0" })
  .structuredContent.payloadFingerprint
```

AND `record.tx.data` byte-identical AND `tx.to` / `tx.valueWei` / `tx.chainId` byte-identical AND both `amountWei === "0"`. The shared `prepareApproveInternal` helper has ONE code path for `tx` construction; drift in either top-level tool fails this exact assertion.

## ⚠ UNLIMITED APPROVAL — strict-equality only

Per research § Topic 6 (Etherscan / Revoke.cash / OpenZeppelin industry consensus): `decoded.isUnlimited = (amount === MAX_UINT256)`. No fuzzy `> 1e30` threshold. `test/preview-send.erc20.test.ts` includes the explicit strict-equality guard test "DECODED ARGS approve(spender, MAX_UINT256 - 1n) — bounded (T-UNLIMITED-THRESHOLD-DRIFT-1)" — the max-minus-one input surfaces as a numeric amount, NOT the unlimited label.

## 11 KnownSpender entries (alphabetical-by-label)

| # | Label | Address |
|---|-------|---------|
| 1 | Aave V3 Pool | 0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2 |
| 2 | CowSwap GPv2Settlement | 0x9008D19f58AAbD9eD0D60971565AA8510560ab41 |
| 3 | Li.Fi Diamond | 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE |
| 4 | 1inch Aggregation Router V6 | 0x111111125421cA6dc452d289314280a0F8842A65 |
| 5 | OpenSea Conduit | 0x1E0049783F008A0085193E00003D00cd54003c71 |
| 6 | OpenSea Seaport 1.5 | 0x00000000006c3852cbEf3e08E8dF289169EdE581 |
| 7 | Uniswap Permit2 | 0x000000000022D473030F116dDEE9F6B43aC78BA3 |
| 8 | Uniswap V2 Router 02 | 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D |
| 9 | Uniswap V3 SwapRouter | 0xE592427A0AEce92De3Edee1F18E0157C05861564 |
| 10 | Uniswap V3 SwapRouter02 | 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45 |
| 11 | WETH9 (canonical wETH) | 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 |

Each address `getAddress(...)`-wrapped at the literal site; module-load throws on bad checksum. Regression test asserts `length >= 11` so Phase 7 (additional bridges / lending) can extend without test churn.

## Test counts

| Stage | Count |
|-------|-------|
| Baseline (06-02 head) | 397 |
| After 06-03 | 440 |
| Delta | +43 |

Breakdown of new tests:
- `test/config-contracts.test.ts` — 13 cases (SOT regression, byte-identity per row, case-insensitive lookup, Phase 8 narrowing)
- `test/prepare-token-approve.test.ts` — 16 cases (pair-required, demo + null-persona, INVALID_INPUT branches, `"max"` happy, `"MAX"` / `"unlimited"` rejected, Fixture E anchor, verbatim PREPARE RECEIPT, handle stored shape, register-all wiring)
- `test/prepare-revoke-approval.test.ts` — 8 cases (happy path, pair-required, INVALID_INPUT, byte-identity invariant, register-all wiring)
- `test/preview-send.erc20.test.ts` — +5 cases (unlimited DECODED ARGS, max-minus-one bounded, USDC bounded with token context, unknown spender fallback, case-insensitive spender lookup)
- `test/signing-fingerprint.test.ts` — +1 case (Fixture E)

## FROZEN-area verification

```
src/signing/payload-fingerprint.ts:   0 diff lines vs origin/main
src/signing/presign-hash.ts:          0 diff lines vs origin/main
src/signing/handle-store.ts:          0 diff lines vs origin/main
src/tools/send_transaction.ts:        0 diff lines vs origin/main
```

`handle-store.ts` UN-changed in Wave 3 — Plan 06-02 already widened `PrepareArgs` with the optional `tokenAddress` / `amount` / `spender` fields; this plan consumes them without further modification.

`src/tools/register-all.ts` diff: exactly 2 added lines (`+import "./prepare_token_approve.js";` + `+import "./prepare_revoke_approval.js";`).

## Deviations from Plan

None of substance. Two mechanical decisions documented inline (also captured in `decisions:` frontmatter):

1. **Spender-label literal accepts viem's EIP-55 output even when calldata was decoded from lowercase bytes.** `viem.decodeFunctionData` returns the spender address in canonical checksummed form regardless of the on-the-wire byte case; `lookupSpender` checksums input via `getAddress` before strict-equality match. Both layers normalize independently, so the integration-path test ("case-insensitive spender lookup" in `test/preview-send.erc20.test.ts`) is a regression anchor rather than testing a new behavior.

2. **`APPROVE_PREPARE_RECEIPT_TEMPLATE` distinct from `ERC20_PREPARE_RECEIPT_TEMPLATE`.** The plan's § Behavior step 5 enumerated two options ("(a) new template" vs "(b) reuse with mislabeled slot") and recommended (a). Adopted (a) — format-fanout-sentinel: approve receipts are semantically a different shape from transfer receipts (no recipient; only a spender); the template separation matches 06-PATTERNS.md line 97's "token-aware receipts are semantically different" guidance.

## Threat Flags

None — the threat-model register in 06-03-PLAN.md covers every new surface introduced by this plan (T-MAX-SPELLING-1, T-UNLIMITED-THRESHOLD-DRIFT-1, T-SPENDER-CASE-1, T-SPENDER-LABEL-INJECTION-1, T-REVOKE-DRIFT-1, T-UNLIMITED-AGENT-DECEPTION-1, T-CONFIG-LITERAL-MIGRATION-1). Each `mitigate`-disposition row is asserted by an explicit test:

| Threat ID | Asserted by |
|-----------|-------------|
| T-MAX-SPELLING-1 | `test/prepare-token-approve.test.ts` Tests "amount: MAX rejected" + "amount: unlimited rejected" |
| T-UNLIMITED-THRESHOLD-DRIFT-1 | `test/preview-send.erc20.test.ts` Test "approve(spender, MAX_UINT256 - 1n) — bounded" (no unlimited label) |
| T-SPENDER-CASE-1 | `test/config-contracts.test.ts` case-insensitive lookup tests + `test/preview-send.erc20.test.ts` "case-insensitive spender lookup" |
| T-SPENDER-LABEL-INJECTION-1 | `test/config-contracts.test.ts` per-row checksum invariant + Aave V3 Pool / Uniswap V3 hardcoded literal anchors |
| T-REVOKE-DRIFT-1 | `test/prepare-revoke-approval.test.ts` "BYTE-IDENTITY INVARIANT" test |
| T-UNLIMITED-AGENT-DECEPTION-1 | `test/preview-send.erc20.test.ts` "⚠ UNLIMITED APPROVAL label + revoke hint" verbatim assertion |
| T-CONFIG-LITERAL-MIGRATION-1 | `test/config-contracts.test.ts` "getWethAddress(1) byte-identical to get_portfolio_summary.ts:17" cross-link |

## Self-Check: PASSED

- **Files created:** all 6 NEW files present (`src/config/contracts.ts`, `src/tools/prepare_token_approve.ts`, `src/tools/prepare_revoke_approval.ts`, `test/config-contracts.test.ts`, `test/prepare-token-approve.test.ts`, `test/prepare-revoke-approval.test.ts`).
- **Files modified:** all 5 MODIFY files have diffs as planned (`src/signing/blocks.ts`, `src/tools/preview_send.ts`, `src/tools/register-all.ts`, `test/preview-send.erc20.test.ts`, `test/signing-fingerprint.test.ts`).
- **Commit:** `97f962e` (`feat(06-03): prepare_token_approve + prepare_revoke_approval + known-spender SOT + unlimited-approval surfacing`).
- **Build:** `npm run build` exits 0.
- **Typecheck:** `npm run typecheck` clean.
- **Tests:** 440/440 passing (was 397; +43 across new + extended test files).
- **FROZEN-area zero-diff:** confirmed against `origin/main` for all four protected files.
- **`register-all.ts`:** exactly 2 added lines.
- **`blocks.ts` approve stub:** removed (zero occurrences of the Plan 06-02 placeholder).
- **`⚠ UNLIMITED APPROVAL` strict-equality:** confirmed via `decodeErc20Call.isUnlimited = (amount === MAX_UINT256)` in `src/protocols/erc20.ts:158`; no fuzzy threshold introduced anywhere.
