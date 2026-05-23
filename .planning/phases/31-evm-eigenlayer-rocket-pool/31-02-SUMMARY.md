---
phase: 31-evm-eigenlayer-rocket-pool
plan: 02
subsystem: eigenlayer
tags:
  - eigenlayer
  - prepare-tool
  - read-tool
  - ledger-notice
  - fixture-Z
  - blind-sign
  - curated-registry

requires:
  - phase: 31-evm-eigenlayer-rocket-pool
    plan: 01
    provides: "EigenLayer per-chain SOT (StrategyManager + DelegationManager + curated 7-LST strategies/lstTokens), 5 SOT getters, canonical-dispatch Ethereum-arm extension with all 7 strategy proxies"
  - phase: 30-lido-stake-unstake-wrap-unwrap
    provides: "PREPARE RECEIPT template shape (LIDO_WRAP_PREPARE_RECEIPT_TEMPLATE analog); D-05 allowance pre-flight pattern; src/chains/lido.ts per-chain read service shape"
  - phase: 6-erc20
    provides: "LEDGER_NOTICE_WETH_UNWRAP_TEMPLATE — the LEDGER NOTICE template precedent that D-13 mirrors"

provides:
  - "src/protocols/eigenlayer.ts — 3 ABI fragments + 5 hardcoded EIGENLAYER_SELECTORS literals + encodeDepositIntoStrategy encoder + getter re-exports + _eigenLayerProtocol spy-affordance"
  - "src/signing/eigenlayer-shares.ts — SHARES_SCALE + convertSharesToUnderlying pure-bigint math + approx:true literal-type guard + _eigenLayerShares spy-affordance"
  - "src/chains/eigenlayer.ts — readEthereumPositions 3-pass fan-out + EIGENLAYER_WITHDRAWAL_DELAY_BLOCKS constant + _eigenLayerChains spy-affordance"
  - "src/tools/get_eigenlayer_positions.ts — MCP tool (EIG-01)"
  - "src/tools/prepare_eigenlayer_deposit.ts — MCP tool (EIG-02) with D-05 + D-06 pre-flights + D-13 LEDGER NOTICE + D-10 slashing line"
  - "src/signing/blocks.ts APPEND-ONLY: LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE + EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE + DECODED_ARGS_TEMPLATE_EIGENLAYER_DEPOSIT + EigenLayerDecoded interface + buildEigenLayerDecodedArgsBlock helper"
  - "Fixture Z hardcoded payloadFingerprint literal — 0x2c36a77f8e39c8d0f8d276f88169608e1a247bb288117da00f90b1f7dd158684"
  - "src/tools/register-all.ts — get_eigenlayer_positions + prepare_eigenlayer_deposit side-effect imports"

affects:
  - "preview_send DECODED ARGS dispatch layer (Plan 31-03 wires the EigenLayer arm using buildEigenLayerDecodedArgsBlock)"
  - "send_transaction blind-sign path (LEDGER NOTICE re-emitted at preview/send time once Plan 31-03 wires the preview_send arm)"
  - "Future v2.x: operator delegation, EigenPod native ETH restaking, claim flows — Phase 31 ships deposit only"

tech-stack:
  added: []
  patterns:
    - "Curated-registry schema enum (D-04 + Pitfall 3 mitigation): agent passes `lst: \"stETH\"` not raw addresses; server resolves (strategy, lstToken) via SOT — off-list LSTs refuse with hintTool: request_capability"
    - "MAX_UINT256 sentinel guard for cap pre-flight (Pitfall 6): check the 2^256-1 sentinel BEFORE the `currentTotalShares >= cap` arithmetic; defensive `.catch(() => MAX_UINT256)` on the maxTotalDeposits RPC call"
    - "LEDGER NOTICE template + emission pattern (D-13 — first absent-from-ERC-7730 prepare tool since Phase 6 WETH unwrap): template constant in blocks.ts; tool emits as separate content[] text block"
    - "3-block response shape: PREPARE RECEIPT + CHECKS PERFORMED (with verbatim D-10 informational line) + LEDGER NOTICE — each as a separate content[] item for future renderer styling"

key-files:
  created:
    - "src/protocols/eigenlayer.ts (189 lines) — protocol decoder"
    - "src/signing/eigenlayer-shares.ts (126 lines) — pure-bigint helper"
    - "src/chains/eigenlayer.ts (292 lines) — Ethereum read service"
    - "src/tools/get_eigenlayer_positions.ts (181 lines) — MCP read tool (EIG-01)"
    - "src/tools/prepare_eigenlayer_deposit.ts (403 lines) — MCP write tool (EIG-02)"
    - "test/protocols-eigenlayer.test.ts (144 lines / 12 tests)"
    - "test/signing-eigenlayer-shares.test.ts (82 lines / 7 tests)"
    - "test/get-eigenlayer-positions.test.ts (269 lines / 8 tests)"
    - "test/prepare-eigenlayer-deposit.test.ts (541 lines / 18 tests)"
  modified:
    - "src/signing/blocks.ts (+120 lines) — Phase 31 APPEND-ONLY EigenLayer templates"
    - "test/signing-fingerprint.test.ts (+35 lines) — Fixture Z hardcoded literal anchor"
    - "src/tools/register-all.ts (+2 lines) — wires the 2 new tool side-effect imports"

key-decisions:
  - "D-04 enforced at TWO layers: JSON-schema enum (\"lst\": [\"stETH\",\"rETH\",\"cbETH\",\"ETHx\",\"wBETH\",\"sfrxETH\",\"mETH\"]) at the protocol boundary + defensive runtime CURATED_LSTS_SET check in the handler. Off-list refuses with INVALID_INPUT + hintTool: request_capability + feature mentioning the requested LST symbol so the agent can self-correct via request_capability without a second tool round-trip."
  - "Pitfall 6 (MAX_UINT256 cap sentinel) mitigated by ordering the sentinel check BEFORE the comparison. `if (maxTotalDeposits !== MAX_UINT256 && currentTotalShares >= maxTotalDeposits) refuse(...)`. Defensive `.catch(() => MAX_UINT256)` on maxTotalDeposits RPC also handles strategies that revert on the call."
  - "D-05 spender slot is StrategyManager (NOT the per-strategy proxy). The StrategyManager pulls the LST via ERC-20 transferFrom; approving the strategy proxy would NOT enable the deposit. hintArgs.spender === getEigenLayerStrategyManagerAddress(1) anchors this."
  - "Pitfall 4 stETH-rebase nuance surfaced at the user-facing error text — when lst === 'stETH' AND allowance is insufficient, recommend `prepare_token_approve` with `amount: 'max'` to avoid drift between approve-block and deposit-block. Other curated LSTs are non-rebasing — no rebase note emitted."
  - "Fixture Z literal computed at write-time (`node -e \"...\"`) and pinned as `0x2c36a77f8e39c8d0f8d276f88169608e1a247bb288117da00f90b1f7dd158684`. NO beforeAll-snapshot per CLAUDE.md — drift in the preimage assembly fails at THIS line, not against a self-referencing snapshot. Cross-link from test/prepare-eigenlayer-deposit.test.ts re-anchors the byte-identity via the prepare-tool flow path AND independent encodeDepositIntoStrategy + computePayloadFingerprint recomputation."
  - "register-all wiring deferred from Task 1 Step 7 to Task 3 (plan-sanctioned alternative). The plan explicitly offers this — `Alternative: include this Step in Task 3 instead.` — to avoid leaving the vitest suite in a transient 117-failure state between Task 1 and Tasks 2 + 3. Empirically vitest reorders test files but the IMPORT graph fails synchronously when register-all references missing tool modules. Deferral keeps every per-task commit's vitest suite green."

metrics:
  duration: "~20min"
  completed: "2026-05-23"

requirements-completed:
  - EIG-01
  - EIG-02
---

# Phase 31 Plan 31-02: EigenLayer Reads + Deposit — Summary

**Ethereum-mainnet-only EigenLayer half: per-strategy read tool (`get_eigenlayer_positions`) + LST deposit prepare tool (`prepare_eigenlayer_deposit`) with curated 7-LST schema enum, D-05 LST-allowance pre-flight (StrategyManager spender), D-06 cap pre-flight with MAX_UINT256 sentinel guard (Pitfall 6), D-10 slashing-risk informational line, D-13 LEDGER NOTICE emission (no ERC-7730 coverage), and Fixture Z cryptographic-binding anchor.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3 of 3 completed atomically (one commit per task)
- **Files created:** 9 (5 src/ + 4 test/)
- **Files modified:** 3 (blocks.ts +120, signing-fingerprint.test.ts +35, register-all.ts +2)

## Accomplishments

- **Protocol decoder:** `src/protocols/eigenlayer.ts` ships 3 viem `parseAbi` fragments (STRATEGY_MANAGER_ABI / STRATEGY_BASE_ABI / DELEGATION_MANAGER_ABI) + `EIGENLAYER_SELECTORS` table with 5 hardcoded `Hex` literals + `encodeDepositIntoStrategy` encoder (100-byte calldata) + getter re-exports + `_eigenLayerProtocol` spy-affordance. Mirrors `src/protocols/lido.ts` (Phase 30 analog).
- **Pure-math helper:** `src/signing/eigenlayer-shares.ts` exports `SHARES_SCALE` (10n ** 18n) + `convertSharesToUnderlying` with the load-bearing `approx: true` literal-type output. NO side effects, NO RPC, NO module-load state.
- **Chain reader:** `src/chains/eigenlayer.ts` implements a 3-pass fan-out: (1) 7 × `stakerStrategyShares` via `Promise.allSettled` across the curated registry, (2) per-non-zero × `sharesToUnderlyingView`, (3) single `DelegationManager.getQueuedWithdrawals` decomposed into a flat row array. Partial failures flip `rpcDegraded: true`; happy-path data survives.
- **MCP read tool (EIG-01):** `get_eigenlayer_positions({ wallet, chain?: 'ethereum' })` returns `{deposits[], pendingWithdrawals[], totalEthEquivalent, approx:true, rpcDegraded?}` structured content + human-readable summary lines. Refuses non-Ethereum chain with `CHAIN_ID_MISMATCH` errorCode 15. Refuses malformed wallet with `INVALID_INPUT` errorCode 1.
- **MCP write tool (EIG-02):** `prepare_eigenlayer_deposit({ chain, lst, amount, from? })` produces a handle whose `tx.to === getEigenLayerStrategyManagerAddress(1)`, `tx.valueWei === 0n`, `tx.data === encodeDepositIntoStrategy(strategy, lstToken, amountWei)`. Three-block response: PREPARE RECEIPT (verbatim agent args) + CHECKS PERFORMED (3 pre-flight outcomes + D-10 slashing-risk line) + LEDGER NOTICE (verbatim 10-line block per D-13).
- **`src/signing/blocks.ts`:** APPEND-ONLY +120 lines after line 1771. Phase 4 / 6 / 7 / 8 / 9 / 28 / 29 / 30 templates above line 1771 byte-identical (verified).
- **Fixture Z anchor:** Hardcoded payloadFingerprint literal `0x2c36a77f8e39c8d0f8d276f88169608e1a247bb288117da00f90b1f7dd158684` in `test/signing-fingerprint.test.ts` pinning `StrategyManager.depositIntoStrategy(stETH-Strategy, stETH, 1e18)`. Cross-linked from `test/prepare-eigenlayer-deposit.test.ts` (re-anchor via the prepare-tool flow + independent encoder + fingerprint recomputation).
- **Selector cross-anchoring:** `0xe7a050aa` appears as a load-bearing literal in 4 distinct source files (`src/protocols/eigenlayer.ts`, `src/tools/prepare_eigenlayer_deposit.ts`, `test/protocols-eigenlayer.test.ts`, `test/signing-fingerprint.test.ts`). Drift in any one fails the binding chain at a specific assertion line.
- **Full vitest suite green: 3577 → 3623 (+46 net tests)**. Strict `tsc --noEmit` clean. FROZEN regions (`payload-fingerprint.ts` / `presign-hash.ts` / `handle-store.ts` / `send_transaction.ts` / `clients/etherscan.ts`) byte-identical to baseline `origin/main`.

## Task Commits

Each task was committed atomically with its own conventional-commit message:

1. **Task 1: Protocol decoder + pure-math + Wave 0 fixtures** — `5e93a2e` (feat)
   Files: `src/protocols/eigenlayer.ts` (NEW), `src/signing/eigenlayer-shares.ts` (NEW), `src/signing/blocks.ts` (+120), `test/protocols-eigenlayer.test.ts` (NEW), `test/signing-eigenlayer-shares.test.ts` (NEW), `test/signing-fingerprint.test.ts` (+35 Fixture Z).
2. **Task 2: get_eigenlayer_positions read tool + chain reader** — `c71e763` (feat)
   Files: `src/chains/eigenlayer.ts` (NEW), `src/tools/get_eigenlayer_positions.ts` (NEW), `test/get-eigenlayer-positions.test.ts` (NEW).
3. **Task 3: prepare_eigenlayer_deposit + Fixture Z cross-link + register-all wiring** — `93f1a65` (feat)
   Files: `src/tools/prepare_eigenlayer_deposit.ts` (NEW), `test/prepare-eigenlayer-deposit.test.ts` (NEW), `src/tools/register-all.ts` (+2).

## Files Created/Modified

### Created

| Path | Lines | Purpose |
|------|-------|---------|
| `src/protocols/eigenlayer.ts` | 189 | 3 ABI fragments + 5 hardcoded selector literals + encoder + spy-affordance |
| `src/signing/eigenlayer-shares.ts` | 126 | Pure-bigint SHARES_SCALE + convertSharesToUnderlying + spy-affordance |
| `src/chains/eigenlayer.ts` | 292 | readEthereumPositions 3-pass fan-out + EIGENLAYER_WITHDRAWAL_DELAY_BLOCKS |
| `src/tools/get_eigenlayer_positions.ts` | 181 | MCP read tool (EIG-01) |
| `src/tools/prepare_eigenlayer_deposit.ts` | 403 | MCP write tool (EIG-02) — D-05 + D-06 + D-10 + D-13 |
| `test/protocols-eigenlayer.test.ts` | 144 | 12 tests — 5 selectors + 3 ABI surfaces + 4 encoder shape |
| `test/signing-eigenlayer-shares.test.ts` | 82 | 7 tests — constants + degenerate-zero + 1:1 + 1.1x + approx-literal + truncation |
| `test/get-eigenlayer-positions.test.ts` | 269 | 8 tests — happy path + zero + chain refusal + invalid wallet + RPC partial + approx-always + chain-default + schema-pin |
| `test/prepare-eigenlayer-deposit.test.ts` | 541 | 18 tests — happy + Fixture Z cross-link + chain + LST off-list + D-05 (+rebase note) + D-06 (sentinel + at-cap + revert-fallback) + invalid amount + LEDGER NOTICE verbatim + D-10 verbatim + from-independence + register-all + INPUT_SCHEMA + handle store + PREPARE RECEIPT verbatim |

### Modified

| Path | Δ | Purpose |
|------|---|---------|
| `src/signing/blocks.ts` | +120 | APPEND-ONLY after line 1771 — LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE + EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE + DECODED_ARGS_TEMPLATE_EIGENLAYER_DEPOSIT + EigenLayerDecoded interface + buildEigenLayerDecodedArgsBlock |
| `test/signing-fingerprint.test.ts` | +35 | Fixture Z hardcoded payloadFingerprint literal anchor + cross-link comment |
| `src/tools/register-all.ts` | +2 | Side-effect imports for get_eigenlayer_positions + prepare_eigenlayer_deposit (after Phase 30 Lido imports) |

## The 5 Verified EigenLayer Selectors (Source-Pinned Constants)

```typescript
export const EIGENLAYER_SELECTORS = {
  depositIntoStrategy:    "0xe7a050aa" as Hex,
  stakerStrategyShares:   "0x7a7e0d92" as Hex,
  sharesToUnderlyingView: "0x7a8b2637" as Hex,
  userUnderlyingView:     "0x553ca5f8" as Hex,
  getQueuedWithdrawals:   "0x5dd68579" as Hex,
} as const;
```

Each cross-asserted in `test/protocols-eigenlayer.test.ts` against `viem.toFunctionSelector(...)`. Drift in any one fails the corresponding `it(...)` block AND, downstream, the Fixture Z payloadFingerprint regression.

## Fixture Z Hardcoded Fingerprint Literal

```
0x2c36a77f8e39c8d0f8d276f88169608e1a247bb288117da00f90b1f7dd158684
```

Inputs (resolved via SOT getters — NEVER inlined):

- `to`: `getEigenLayerStrategyManagerAddress(1)` = `0x858646372CC42E1A627fcE94aa7A7033e7CF075A`
- `strategy`: `getEigenLayerStrategyAddress(1, "stETH")` = `0x93c4b944D05dfe6df7645A86cd2206016c51564D`
- `lstToken`: `getEigenLayerLstTokenAddress(1, "stETH")` = `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84`
- `valueWei`: `0n` (deposit is NOT payable; LST consumed as ERC-20)
- `amount`: `1_000_000_000_000_000_000n` (1 stETH)
- `data`: `encodeDepositIntoStrategy(strategy, lstToken, amount)` — 202-char, prefix `0xe7a050aa`

Computed once at write-time via a `node`-eval one-shot (resolved viem package in the worktree); pinned as a hardcoded literal in `test/signing-fingerprint.test.ts` per CLAUDE.md "NO beforeAll-snapshot" rule. Cross-link from `test/prepare-eigenlayer-deposit.test.ts` re-anchors the byte-identity via the prepare-tool flow AND independent recomputation.

## LEDGER NOTICE Template (D-13 — 10 Lines)

```
LEDGER NOTICE
  EigenLayer depositIntoStrategy is NOT covered by the Ledger Ethereum app's clear-sign plugins.
  Your device will BLIND-SIGN this transaction (display a raw hash, no decoded args).
  If your device refuses with "Blind signing is not enabled":
    1. Open the Ethereum app on your device
    2. Settings → Blind signing → Enabled
    3. Retry send_transaction
  After send_transaction fires, compare the PREDICTED hash below to the
  value your hardware device displays — character-for-character. This
  on-device match is the cryptographic anchor.
```

Defined as `LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE` in `src/signing/blocks.ts` (line ~1782); emitted verbatim by `prepare_eigenlayer_deposit` as the third content block of the response.

## D-10 Slashing-Risk Informational Line (Verbatim — Surfaced in CHECKS PERFORMED)

> "EigenLayer restaking: deposited LST shares are subject to slashing by AVS operators the user later delegates to. Phase 31 ships deposit only — operator delegation is a separate tool (deferred to v2.x). Informational; no enforcement gate."

The line is informational (no enforcement gate) — the user signs the deposit despite the risk; the agent surface is the disclosure path. `preview_send` will re-emit via the EigenLayer DECODED ARGS arm once Plan 31-03 wires the selector dispatch (out of scope for this plan).

## Curated 7-LST Registry (D-04 — As Committed)

```
stETH    rETH    cbETH    ETHx    wBETH    sfrxETH    mETH
```

All 18 decimals (RESEARCH § Topic 1). Both layers enforce: JSON-schema enum + defensive `CURATED_LSTS_SET.has(...)` runtime check in the handler. Off-list refuses with `INVALID_INPUT` + `hintTool: "request_capability"` + `hintArgs.feature: "EigenLayer {lst} strategy support"`.

## D-05 LST-Allowance Pre-flight Pattern

```typescript
const allowance: bigint = await client.readContract({
  address: lstTokenAddr,
  abi: erc20Abi,
  functionName: "allowance",
  args: [fromAddress, strategyManagerAddr], // spender = StrategyManager
});
if (allowance < amountWei) {
  // refuse with INVALID_INPUT + hintTool: "prepare_token_approve" +
  //   hintArgs.spender === strategyManagerAddr (NOT per-strategy proxy)
  //   stETH-specific Pitfall 4 rebase note appended when lst === "stETH"
}
```

Spender slot is StrategyManager because the StrategyManager pulls the ERC-20 via `transferFrom` — approving the per-strategy proxy would NOT enable the deposit. Anchored in `test/prepare-eigenlayer-deposit.test.ts` T5a (`sc.hintArgs.spender).toBe(STRATEGY_MANAGER)`).

## D-06 Cap Pre-flight + MAX_UINT256 Sentinel Guard (Pitfall 6 Mitigation)

```typescript
const MAX_UINT256 = 2n ** 256n - 1n;

const [allowance, currentTotalShares, maxTotalDeposits] = await Promise.all([
  /* ... */,
  client.readContract({ ..., functionName: "totalShares" }),
  (client.readContract({ ..., functionName: "maxTotalDeposits" }) as Promise<bigint>)
    .catch(() => MAX_UINT256), // defensive — some strategies revert on the call
]);

// Sentinel check FIRST — raw comparison without the guard treats unlimited
// (returning 2^256-1) as "at cap". Pitfall 6 mitigated.
if (maxTotalDeposits !== MAX_UINT256 && currentTotalShares >= maxTotalDeposits) {
  // refuse with INVALID_INPUT + hintTool: "request_capability" + feature mentions LST
}
```

Three test arms anchor the mitigation:
- T6 sentinel skip: `maxTotalDeposits === 2^256-1` → proceeds; CHECKS PERFORMED text mentions `MAX_UINT256` / `unlimited`.
- T7 finite-cap-at-cap: `cap=1000, totalShares=1000` → refuses.
- T9 revert fallback: `maxTotalDeposits` throws → treated as `MAX_UINT256` (defensive).

## Test-File Count Trajectory

| Stage | Test files | Tests | Net delta |
|-------|----:|----:|----:|
| Pre-task baseline (post-31-01) | 276 | 3577 | — |
| Post-Task-1 (3 test files; protocols-eigenlayer +12, signing-eigenlayer-shares +7, signing-fingerprint +1 Fixture Z) | 278 | 3597 | +20 |
| Post-Task-2 (+ get-eigenlayer-positions test file with 8 tests) | 279 | 3605 | +28 |
| Post-Task-3 (+ prepare-eigenlayer-deposit test file with 18 tests) | 280 | 3623 | +46 |

## Threat Mitigations Wired

| Threat ID | Mitigation Wired | Verification Anchor |
|-----------|------------------|---------------------|
| T-EIGENLAYER-STRATEGY-MISMATCH | Curated 7-LST schema enum + defensive runtime check; server resolves (strategy, lstToken) via SOT — agent never passes raw addresses (Pitfall 3) | `test/prepare-eigenlayer-deposit.test.ts` T4 (off-list refusal + hintTool: request_capability) |
| T-EIGENLAYER-APPROVAL-DRIFT-1 | D-05 LST allowance pre-flight refuses INVALID_INPUT + hintTool: prepare_token_approve with spender = StrategyManager (NOT per-strategy proxy); Pitfall 4 stETH-rebase note in error text | `test/prepare-eigenlayer-deposit.test.ts` T5a (spender + rebase note) + T5b (non-stETH no rebase note) |
| T-EIGENLAYER-CAP-OVERFLOW-1 | D-06 MAX_UINT256 sentinel guard fires BEFORE arithmetic; defensive `.catch(() => MAX_UINT256)` on maxTotalDeposits RPC | `test/prepare-eigenlayer-deposit.test.ts` T6 (sentinel skip) + T7 (at-cap refusal) + T9 (revert fallback) |
| T-LEDGER-NOTICE-EIGENLAYER-1 | LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE emitted verbatim as 3rd content block; user cannot reach send_transaction without seeing the blind-sign warning | `test/prepare-eigenlayer-deposit.test.ts` T10 (LEDGER NOTICE verbatim assertion); Phase 31 cryptographic anchor remains the on-device blind-sign hash match against the `LEDGER BLIND-SIGN HASH` block at preview/send time (Plan 31-03 wires the preview_send arm) |
| T-EIGENLAYER-SHARES-STALENESS | `approx: true` literal type on convertSharesToUnderlying + always-set `approx: true` on get_eigenlayer_positions structuredContent | `test/signing-eigenlayer-shares.test.ts` 7 tests + `test/get-eigenlayer-positions.test.ts` T6 (approx always) |
| T-FROZEN-31 | Zero-diff invariant on FROZEN files asserted by `git diff --stat origin/main -- ...` returning empty | Verified in this summary's verification section |

## D-XX CONTEXT.md Decisions Addressed

| Decision | Resolution |
|----------|------------|
| D-01 (separate src/protocols/eigenlayer.ts) | Honored — separate file, sibling to src/protocols/lido.ts |
| D-02 (separate-file confirmation) | Honored — matches D-01 |
| D-03 (chain enum locked to 'ethereum') | Honored — JSON-schema enum [\"ethereum\"] + defensive runtime gate |
| D-04 (curated 7-LST schema enum + server-resolved (strategy, lstToken)) | Honored — both schema layer + runtime CURATED_LSTS_SET; agent never passes raw addresses |
| D-05 (LST-approval pre-flight) | Honored — D-05 refusal arm with hintTool: prepare_token_approve + spender = StrategyManager + Pitfall 4 stETH rebase note |
| D-06 (cap pre-flight with sentinel check) | Honored — MAX_UINT256 guard fires BEFORE arithmetic; defensive `.catch(() => MAX_UINT256)` |
| D-09 (no NFT receipt — standard PREPARE RECEIPT layout) | Honored — no NFT block emitted; structuredContent has no expectedTokenId / nftContract fields |
| D-10 (slashing-risk informational line) | Honored — verbatim line in CHECKS PERFORMED |
| D-11 (deposits + pendingWithdrawals shape; approx:true flag) | Honored — get_eigenlayer_positions always returns approx: true |
| D-13 (LEDGER NOTICE template for EigenLayer) | Honored — LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE in blocks.ts + emission as 3rd content block in prepare_eigenlayer_deposit |
| D-14 (Fixture Z assignment) | Honored — hardcoded literal in test/signing-fingerprint.test.ts + cross-link in test/prepare-eigenlayer-deposit.test.ts |

## Verification

- **vitest suite:** `npx vitest run` → 280 files, 3623 tests passing, 1 skipped. Exit 0.
- **TypeScript:** `npx tsc --noEmit` → exit 0.
- **Selector cross-anchor:** `grep -nE "0xe7a050aa" src/protocols/eigenlayer.ts test/protocols-eigenlayer.test.ts test/signing-fingerprint.test.ts src/tools/prepare_eigenlayer_deposit.ts` → matches in all 4 files.
- **LEDGER NOTICE verbatim:** `grep -c "EigenLayer depositIntoStrategy is NOT covered" src/signing/blocks.ts test/prepare-eigenlayer-deposit.test.ts` → 1 each. `prepare_eigenlayer_deposit.ts` imports and uses `LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE` by name (Format-fanout-sentinel pattern — verbatim text lives ONLY in the template constant; tool emits the constant verbatim).
- **D-10 verbatim:** `grep -c "EigenLayer restaking: deposited LST shares are subject to slashing" src/tools/prepare_eigenlayer_deposit.ts test/prepare-eigenlayer-deposit.test.ts` → 1 each.
- **register-all wired:** `grep -c "prepare_eigenlayer_deposit\|get_eigenlayer_positions" src/tools/register-all.ts` → 2.
- **hintTool refusal arms:** `grep -cE 'hintTool.*"prepare_token_approve"|hintTool.*"request_capability"' src/tools/prepare_eigenlayer_deposit.ts` → 5 (D-05 + D-06 finite-cap + LST off-list + multiple text contexts).
- **MAX_UINT256 sentinel:** `grep -cE "2n \*\* 256n - 1n|MAX_UINT256" src/tools/prepare_eigenlayer_deposit.ts` → 9.
- **eigenlayer.ts exports:** `grep -c "^export " src/protocols/eigenlayer.ts` → 8 (3 ABI fragments + selector table + encoder + 5 getter re-exports + 2 type exports + indirection are split across `export {}` lists and individual `export` statements).
- **FROZEN region zero-diff:** `git diff --stat origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts` → empty output. Confirmed byte-identical.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Tooling correction] String.replace single-match semantics for {LST_SYMBOL} slot used twice in the same template**

- **Found during:** Task 1 Step 3 (`buildEigenLayerDecodedArgsBlock` implementation) + Task 3 (PREPARE RECEIPT block assembly).
- **Issue:** The DECODED ARGS + PREPARE RECEIPT templates both use `{LST_SYMBOL}` twice (header row + amount row). `String.prototype.replace` with a string pattern replaces only the FIRST occurrence; the second `{LST_SYMBOL}` placeholder would leak through to the user-facing text verbatim.
- **Fix:** Use `/\{LST_SYMBOL\}/g` regex form to replace BOTH occurrences in one pass. Documented inline with a "STRING.replace replaces FIRST occurrence only with a string pattern; use /g regex" comment.
- **Files modified:** `src/signing/blocks.ts` (`buildEigenLayerDecodedArgsBlock`), `src/tools/prepare_eigenlayer_deposit.ts` (PREPARE RECEIPT assembly).
- **Verification:** `test/prepare-eigenlayer-deposit.test.ts` "PREPARE RECEIPT verbatim" test re-renders the template with the SAME regex form and asserts byte-identity against the tool's output.
- **Committed in:** `5e93a2e` (Task 1 — blocks.ts edit) + `93f1a65` (Task 3 — tool edit).

**2. [Rule 3 — Sequencing] register-all.ts wiring deferred from Task 1 Step 7 to Task 3**

- **Found during:** Task 1 verification — adding the two side-effect imports for not-yet-created tool files at Task 1 caused 117 vitest test files to fail at import resolution (the vite transform resolves `./get_eigenlayer_positions.js` synchronously and fails before any individual test runs). This was discovered while running the full suite as a smoke test mid-Task-1.
- **Issue:** The plan's Step 7 explicitly notes this risk: "TypeScript will compile-fail on this register-all line until those files exist, but vitest reorders execution so each task's tests pass independently once that task lands. (Alternative: include this Step in Task 3 instead. Default: keep here for sequence clarity.)" Empirically vitest does NOT reorder around the failing import — the whole vitest run fails.
- **Fix:** Apply the plan-sanctioned alternative — defer register-all wiring to Task 3, where both consumed files (`get_eigenlayer_positions.ts` + `prepare_eigenlayer_deposit.ts`) exist.
- **Files modified:** `src/tools/register-all.ts` (+2 lines wired in Task 3 commit `93f1a65` instead of Task 1 commit).
- **Verification:** Each per-task commit's vitest suite is green end-to-end (no transient failure window). Full suite at HEAD: 3623 tests passing.
- **No security regression:** The wiring is mechanical side-effect imports; the deferred ordering does not affect the cryptographic-binding chain, the SOT, or any of the threat mitigations. The plan's `must_haves.truths` includes "preview_send selector dispatch routes 0xe7a050aa + tx.to === StrategyManager to the EigenLayer DECODED ARGS arm" — that is out of scope for Plan 31-02 (Plan 31-03 wires preview_send).

## Threat Flags

No new security-relevant surface introduced outside the plan's `<threat_model>` register. All new files map to threats already enumerated.

## Self-Check: PASSED

- `src/protocols/eigenlayer.ts` — FOUND
- `src/signing/eigenlayer-shares.ts` — FOUND
- `src/chains/eigenlayer.ts` — FOUND
- `src/tools/get_eigenlayer_positions.ts` — FOUND
- `src/tools/prepare_eigenlayer_deposit.ts` — FOUND
- `test/protocols-eigenlayer.test.ts` — FOUND
- `test/signing-eigenlayer-shares.test.ts` — FOUND
- `test/get-eigenlayer-positions.test.ts` — FOUND
- `test/prepare-eigenlayer-deposit.test.ts` — FOUND
- `src/signing/blocks.ts` (modified) — FOUND
- `test/signing-fingerprint.test.ts` (modified — Fixture Z literal at line ~416) — FOUND
- `src/tools/register-all.ts` (modified — 2 new side-effect imports) — FOUND
- Commit `5e93a2e` (Task 1) — FOUND in git log
- Commit `c71e763` (Task 2) — FOUND in git log
- Commit `93f1a65` (Task 3) — FOUND in git log
