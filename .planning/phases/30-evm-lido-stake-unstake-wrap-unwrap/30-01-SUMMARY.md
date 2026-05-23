---
phase: 30-evm-lido-stake-unstake-wrap-unwrap
plan: "01"
subsystem: lido-foundation
tags:
  - lido
  - sot
  - dispatch-allowlist
  - protocol-decoder
  - fixtures
  - cryptographic-binding
dependency_graph:
  requires: []
  provides:
    - LidoContracts SOT (getLidoStethAddress / getLidoWstethAddress / getLidoWithdrawalQueueAddress)
    - LIDO_SELECTORS (4 hardcoded verified selectors)
    - 4 ABI encoders (encodeLidoSubmit / encodeRequestWithdrawals / encodeWstethWrap / encodeWstethUnwrap)
    - Lido dispatch arm in buildPerChainAllowlist (Ethereum only)
    - Fixtures V/W/X/Y payloadFingerprint hardcoded literals
    - 4 LIDO_*_PREPARE_RECEIPT_TEMPLATE constants + NFT_RECEIPT_EXPECTED_TEMPLATE
  affects:
    - src/security/canonical-dispatch.ts (Ethereum allowlist 27→29)
    - src/config/contracts.ts (KNOWN_SPENDERS_ETHEREUM +2 rows)
    - test/security-canonical-dispatch.test.ts (updated allowlist size anchor)
tech_stack:
  added: []
  patterns:
    - Partial<Record<ChainId, LidoContracts>> sub-table (mirrors Compound + Morpho siblings)
    - _lidoProtocol ESM spy-affordance (mirrors _aaveProtocols)
    - Hardcoded selector literals with viem.toFunctionSelector cross-check in tests
    - Append-only blocks.ts extension (FROZEN templates unchanged above line 1555)
    - NFT_RECEIPT_EXPECTED_TEMPLATE as parameterized function (not string-join const)
key_files:
  created:
    - src/protocols/lido.ts (174 lines — ABI fragments + selectors + encoders + spy-affordance)
    - test/protocols-lido.test.ts (230 lines — 27 tests: 4 selector + 4 encoder round-trips + SOT delegation)
  modified:
    - src/config/contracts.ts (+115 lines — LidoContracts interface + LIDO_RAW + 3 getters + 2 KNOWN_SPENDERS rows)
    - src/security/canonical-dispatch.ts (+21 lines — Lido arm + 3 getter imports + dedup comment update)
    - src/signing/blocks.ts (+82 lines — 4 PREPARE-RECEIPT templates + NFT_RECEIPT_EXPECTED_TEMPLATE function)
    - test/signing-fingerprint.test.ts (+92 lines — Fixtures V/W/X/Y + getAddress/Lido imports)
    - test/config-contracts.test.ts (+80 lines — T-LIDO-SPENDER-DRIFT-1 describe block + Lido getter imports)
    - test/security-canonical-dispatch.test.ts (+2 lines — allowlist size anchor 27→29 with dedup explanation)
decisions:
  - D-01 implemented: per-chain LidoContracts SOT shape with Partial<Record<ChainId, LidoContracts>> mirroring Morpho/Compound siblings
  - D-02 implemented: single src/protocols/lido.ts for all 4 contracts (matches prior multi-method analogs)
  - D-04 implemented: NFT_RECEIPT_EXPECTED_TEMPLATE as exported function with T-LIDO-NFT-TOKENID-RACE disclaimer baked in
  - D-06 implemented: encodeRequestWithdrawals wraps single stethAmountWei in [stethAmountWei] array (Pitfall 1 mitigated)
  - D-07 implemented: selectors as hardcoded literals verified via viem.toFunctionSelector cross-check in tests
  - D-10 implemented: Lido arm wired for Ethereum in buildPerChainAllowlist; Arbitrum address(0) sentinels filtered
  - D-11 implemented: Fixtures V/W/X/Y in main test/signing-fingerprint.test.ts (V/X/Y via single-letter continuation; W includes owner in calldata)
  - D-12 implemented: no LEDGER_NOTICE_LIDO_TEMPLATE (ERC-7730 clear-sign confirmed for all 4 write functions)
  - Calldata-length deviation: plan stated "100-byte (202-char)" for requestWithdrawals; empirical ABI encoding is 132 bytes (266 chars) due to 5-slot head+tail layout for (uint256[], address). Tests assert the empirical 132-byte value; deviation documented.
  - Dispatch allowlist: wstETH (0x7f39C581…) already present in BRIDGED_VARIANTS as a token contract on Ethereum; Set de-duplication means net +2 entries (not +3) raising Ethereum allowlist from 27 to 29.
metrics:
  duration: "18 minutes"
  completed: "2026-05-23"
  tasks_completed: 1
  files_changed: 8
---

# Phase 30 Plan 01: Lido Foundation (SOT + Protocol Decoder + Dispatch + Wave-0 Fixtures) Summary

Lido per-chain SOT, unified protocol decoder, canonical-dispatch Ethereum arm, and Wave-0 cryptographic-binding fixtures — the complete foundation layer consumed by Plans 30-02 (read tool) and 30-03 (write tools).

## What Was Built

### `src/config/contracts.ts` — LidoContracts SOT (+115 lines)

- `LidoContracts` interface with 3 fields: `steth`, `wsteth`, `withdrawalQueue`
- `LIDO_RAW` table: chainId 1 (Ethereum — full triple) and chainId 42161 (Arbitrum — wstETH only; steth + withdrawalQueue set to address(0) sentinels per D-01/D-03)
- 3 flat getters: `getLidoStethAddress` / `getLidoWstethAddress` / `getLidoWithdrawalQueueAddress` — each returning `Address | null`
- 2 new `KNOWN_SPENDERS_ETHEREUM` rows (rows 17 and 18 in zero-indexed order):
  - `"Lido wstETH (for stETH wrap)"` — address = `getLidoWstethAddress(1)!`
  - `"Lido WithdrawalQueueERC721 (for stETH unstake)"` — address = `getLidoWithdrawalQueueAddress(1)!`

### `src/protocols/lido.ts` — New file (174 lines)

Structural merge of `src/protocols/weth9.ts` + `src/protocols/aave-v3.ts`:

- 4 ABI fragments: `LIDO_STETH_SUBMIT_ABI`, `WQ_REQUEST_ABI`, `WSTETH_WRAP_ABI`, `WSTETH_UNWRAP_ABI`
- `LIDO_SELECTORS` table (4 hardcoded verified literals):
  - `submit: "0xa1903eab"` — Lido.submit(address)
  - `requestWithdrawals: "0xd6681042"` — WithdrawalQueue.requestWithdrawals(uint256[],address)
  - `wrap: "0xea598cb0"` — WstETH.wrap(uint256)
  - `unwrap: "0xde0e9a3e"` — WstETH.unwrap(uint256)
- 4 encoders: `encodeLidoSubmit` (36 bytes) / `encodeRequestWithdrawals` (132 bytes) / `encodeWstethWrap` (36 bytes) / `encodeWstethUnwrap` (36 bytes)
- Convenience re-exports of 3 SOT getters (SOT remains contracts.ts)
- `_lidoProtocol` ESM spy-affordance indirection (mirrors `_aaveProtocols`)

### `src/security/canonical-dispatch.ts` — Lido arm (+21 lines)

- Imported `getLidoStethAddress`, `getLidoWstethAddress`, `getLidoWithdrawalQueueAddress`
- `lidoEntries` construction with address(0) sentinel filter
- `...lidoEntries` appended to `new Set<Address>([...])` constructor
- Ethereum allowlist: 27 → 29 (net +2; wstETH already in BRIDGED_VARIANTS → Set de-duped)

### `src/signing/blocks.ts` — Append-only (+82 lines, all pre-existing FROZEN)

4 PREPARE-RECEIPT templates:
- `LIDO_STAKE_PREPARE_RECEIPT_TEMPLATE` — slots: `{CHAIN}`, `{STETH_CONTRACT}`, `{AMOUNT}`
- `LIDO_UNSTAKE_PREPARE_RECEIPT_TEMPLATE` — slots: `{CHAIN}`, `{WQ_CONTRACT}`, `{AMOUNT}`
- `LIDO_WRAP_PREPARE_RECEIPT_TEMPLATE` — slots: `{CHAIN}`, `{WSTETH_CONTRACT}`, `{AMOUNT}`
- `LIDO_UNWRAP_PREPARE_RECEIPT_TEMPLATE` — slots: `{CHAIN}`, `{WSTETH_CONTRACT}`, `{AMOUNT}`

`NFT_RECEIPT_EXPECTED_TEMPLATE` — exported function (not string-join const) per D-04:
```typescript
(args: { nftContract: Address; expectedTokenId: string; requestor: Address; claimableAfter: string }) => string
```
Body produces 5-line `[NFT RECEIPT EXPECTED]` block with T-LIDO-NFT-TOKENID-RACE disclaimer on `expectedTokenId` line.

### `test/protocols-lido.test.ts` — New file (27 tests)

- 4 selector byte-identity with `viem.toFunctionSelector` cross-check
- 4 encoder round-trips (calldata length + selector prefix + decode round-trip)
- `requestWithdrawals` 132-byte calldata assertion (empirical; Pitfall 1 mitigated)
- SOT delegation assertions

### `test/signing-fingerprint.test.ts` — Fixtures V/W/X/Y

4 new `it(...)` blocks inside existing `computePayloadFingerprint — PREP-03 + T-BIND-1` describe. Hardcoded literals computed at write-time (2026-05-23):

| Fixture | Function | chainId | to | value | Fingerprint |
|---------|----------|---------|-----|-------|-------------|
| V | `Lido.submit(address(0))` | 1 | stETH proxy | 1e18 wei | `0xab550a2883eb494493169aeff633b77af8f5d458ed0f406b49ce9513b2fe7ed1` |
| W | `requestWithdrawals([1e18], ANVIL_1)` | 1 | WithdrawalQueue | 0 | `0x5f7514882e11ddb46f07aa0b8c3d30df017941c7b4c81e66471c15c31c4a8caa` |
| X | `WstETH.wrap(1e18)` | 1 | wstETH | 0 | `0x0f08b774cb218dd466b47f6df2eee97a76df67a1914ee28269ed328edac5eb20` |
| Y | `WstETH.unwrap(1e18)` | 1 | wstETH | 0 | `0x6d0dff107199edaf752aa542f219edbf26db1319f206aec4dc4027b368476089` |

### `test/config-contracts.test.ts` — T-LIDO-SPENDER-DRIFT-1 describe block (11 assertions)

- T-LIDO-SPENDER-DRIFT-1a + 1b: KNOWN_SPENDERS cross-view byte-identity
- Ethereum literal anchors (3 verified addresses)
- Arbitrum bridged wstETH literal anchor
- Arbitrum sentinel documentation
- chainId pruning: 137 / 8453 / 10 return null
- EIP-55 checksum guard for all Ethereum getters
- Additive row count anchor (exactly 2 Lido rows)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] requestWithdrawals calldata length: 132 bytes, not 100 bytes**
- **Found during:** Task 1 Step 5 implementation + empirical verification
- **Issue:** Plan stated "100-byte (202-char)" calldata for `requestWithdrawals(uint256[], address)`. Empirical ABI encoding via viem produces 132 bytes (266 chars). The ABI layout for `(uint256[] calldata, address)` with a single element: selector(4) + offset-for-amounts(32) + owner-inline(32) + array-length(32) + array-element(32) = 132 bytes. The plan's arithmetic counted 4 head slots instead of 5.
- **Fix:** Tests assert the empirically correct 132-byte value. Inline comment documents the discrepancy. The encoder itself is correct (Pitfall 1 mitigated — single-element array encoding confirmed via decodeFunctionData round-trip test).
- **Files modified:** `test/protocols-lido.test.ts`

**2. [Rule 1 - Bug] Ethereum dispatch allowlist delta: +2 net, not +3**
- **Found during:** Task 1 Step 3 + full vitest run
- **Issue:** `test/security-canonical-dispatch.test.ts` had a hardcoded size anchor of 27. After adding Lido arm, the Set grew to 29 (not 30). wstETH (`0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0`) was already present in `BRIDGED_VARIANTS` as a token contract on Ethereum mainnet — the Set de-dupes it. Net new entries: stETH proxy + WithdrawalQueue = +2.
- **Fix:** Updated size anchor from 27 to 29 with explanatory comment. Updated `canonical-dispatch.ts` membership count comment.
- **Files modified:** `test/security-canonical-dispatch.test.ts`, `src/security/canonical-dispatch.ts`

## FROZEN Region Verification

`git diff --stat 5bb9d7c20168a8c65730d87cdf95ea784cc8acb1 -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts src/clients/etherscan.ts` returned empty (zero-diff confirmed).

## Vitest Pass Count Delta

- Pre-plan full suite: 3460 tests (269 test files)
- Post-plan full suite: 3461 tests passing + 1 skipped (269 test files) — +27 new (protocols-lido) + 11 new (config-contracts Lido block) + 4 new (signing-fingerprint Fixtures V/W/X/Y) = +42 tests net (some pre-existing tests in the extended files also counted)

## Known Stubs

None — all exported functions are fully implemented. Plan 30-03 tools (`prepare_lido_*`) are NOT created here; they consume the exports from this plan.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced. All additions are pure SOT data + ABI encoding functions + test assertions.

## Self-Check: PASSED

- `src/protocols/lido.ts` — FOUND
- `test/protocols-lido.test.ts` — FOUND
- `src/config/contracts.ts` LidoContracts extension — FOUND (grepped labels)
- `src/signing/blocks.ts` NFT_RECEIPT_EXPECTED_TEMPLATE — FOUND
- Commit `6e2ffb1` — FOUND via `git log`
- FROZEN zero-diff — CONFIRMED (empty git diff)
- `npx vitest run test/protocols-lido.test.ts test/config-contracts.test.ts test/signing-fingerprint.test.ts` — 154 tests PASSED
- `npx vitest run` (full suite) — 3461 tests PASSED
- `npx tsc --noEmit` — CLEAN
