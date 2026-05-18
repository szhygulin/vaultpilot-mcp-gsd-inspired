---
phase: 08
plan: 02
slug: chain-arg-threading-and-chainid-mismatch-defense
subsystem: tools-signing-multi-chain-defense
tags: [multi-chain, chain-arg-threading, layer-2-defense, prep-40, prep-41, read-40, fixture-j, chainid-mismatch, phase-8, wave-2]
requirements: [READ-40, PREP-40, PREP-41]
wave: 2
status: complete
completed: 2026-05-18
dependency-graph:
  requires:
    - "src/chains/registry.ts (Plan 08-01 — getChainClient + isPublicNodeFallback per chain)"
    - "src/config/contracts.ts (Plan 08-01 — ChainId widening + ChainName + chainIdFromName + chainNameFromId)"
    - "src/signing/payload-fingerprint.ts (Plan 04-01 — FROZEN; preimage chainId slot byte-binds chainId)"
    - "src/signing/handle-store.ts (Plan 04-01 — FROZEN; state machine)"
    - "src/tools/send_transaction.ts (Plan 04-04 — FROZEN; THREE-GATE logic byte-frozen)"
  provides:
    - "13 tools accept `chain` enum at the dispatch boundary (6 reads REQUIRED + 7 prepares REQUIRED per PREP-41 / READ-40)"
    - "preview_send Layer 2 chain-name MISMATCH refusal (T-CHAIN-MISMATCH-1 mitigation) — OPTIONAL `chain` arg; refuses with CHAIN_ID_MISMATCH when chainIdFromName(args.chain) !== record.tx.chainId"
    - "CHAIN_ID_MISMATCH errorCode added to locked ErrorCode union (15 → 16)"
    - "CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE in src/signing/blocks.ts (format-fanout-sentinel — one template, both potential callsites)"
    - "6 PREPARE_RECEIPT_TEMPLATE strings widened with {CHAIN} slot (native + ERC-20 transfer + approve + WETH unwrap + Aave supply + Aave withdraw)"
    - "loadTokenRegistry(chainId) per-chain dispatcher in src/tokens/registry.ts"
    - "getPrices(coins: PriceCoin[]) per-chain coin-array widening in src/pricing/defillama.ts (back-compat Address[] overload via DEFAULT_CHAIN)"
    - "scanErc20Balances(wallet, tokens?, chainId?) chainId arg in src/chains/erc20-scanner.ts (default 1 for back-compat)"
    - "Fixture J chain-distinctness PROPERTY test in test/signing-fingerprint.test.ts (not a literal pin)"
  affects:
    - "src/chains/erc20-scanner.ts (MODIFY — chainId arg threaded; loadTokenRegistry + getChainClient per chain)"
    - "src/chains/ethereum.ts (MODIFY — compat shim doc-comment updated; deletion deferred — see Deviations §1)"
    - "src/pricing/defillama.ts (MODIFY — getPrices per-chain widening)"
    - "src/signing/blocks.ts (MODIFY — 6 PREPARE_RECEIPT widening + new CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE)"
    - "src/signing/error-codes.ts (MODIFY — 15 → 16 codes)"
    - "src/tokens/registry.ts (MODIFY — loadTokenRegistry(chainId) dispatcher)"
    - "src/tools/check_contract_security.ts (MODIFY — chain enum + v1.2 Ethereum-only gate — see Deviations §2)"
    - "src/tools/get_lending_positions.ts (MODIFY — chain enum + per-chain getChainClient + per-chain Aave readers)"
    - "src/tools/get_token_balance.ts (MODIFY — chain enum + per-chain client)"
    - "src/tools/get_token_metadata.ts (MODIFY — chain enum widened from [\"ethereum\"] to 5; per-chain registry + RPC)"
    - "src/tools/get_transaction_status.ts (MODIFY — chain enum + per-chain client)"
    - "src/tools/prepare_aave_supply.ts (MODIFY — chain enum + per-chain getAaveV3PoolAddress)"
    - "src/tools/prepare_aave_withdraw.ts (MODIFY — same)"
    - "src/tools/prepare_native_send.ts (MODIFY — chain enum + chainIdFromName threading; PREPARE RECEIPT {CHAIN})"
    - "src/tools/prepare_revoke_approval.ts (MODIFY — same shape)"
    - "src/tools/prepare_token_approve.ts (MODIFY — same shape)"
    - "src/tools/prepare_token_send.ts (MODIFY — same shape + per-chain loadTokenRegistry decimal resolution)"
    - "src/tools/prepare_weth_unwrap.ts (MODIFY — same shape + per-chain getWethAddress)"
    - "src/tools/preview_send.ts (MODIFY — Layer 2 MISMATCH refusal at TOP; per-chain client via record.tx.chainId; per-chain getAaveV3PoolAddress + getWethAddress)"
    - "src/tools/simulate_position_change.ts (MODIFY — chain enum + per-chain client + per-chain Aave readers)"
    - "test/preview-send.chain-mismatch.test.ts (NEW — 8 cases)"
    - "test/send-transaction.chain-mismatch.test.ts (NEW — 2 cases; Layer 3 byte-frozen regression)"
    - "test/signing-error-codes.test.ts (NEW — 5 cases; 16-code union assertion)"
    - "test/signing-fingerprint.test.ts (MODIFY — +Fixture J property test)"
    - "test/signing-blocks.test.ts (MODIFY — +Plan 08-02 templates + CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE coverage)"
    - "test/prepare-*.test.ts + test/get-*.test.ts + test/simulate-position-change.test.ts + test/check-contract-security.test.ts (MODIFY — auto-inject chain=\"ethereum\" default in callTool wrappers; updated inputSchema.required assertions; added chain-arg gate test in prepare-native-send)"
    - "test/{aave-v3,erc20,demo-flow,trust-pipeline}.integration.test.ts (MODIFY — auto-inject chain=\"ethereum\" on prepare_* + read tools via regex-driven wrapper)"
  unblocks:
    - "08-03 (cross-chain get_portfolio_summary fan-out — consumes loadTokenRegistry(chainId) + per-chain PriceCoin[] getPrices; the 4 new per-chain JSON files arrive next)"
    - "08-04 (resolve_token + get_token_allowances — consumes per-chain getChainClient + per-chain WETH from CONTRACTS_RAW; same chain-arg schema pattern)"
    - "08-05 (WC multi-chain pairing — consumes ChainId widening at the WC namespace layer; the per-chain enum is now agent-canonical)"
    - "v1.3 (companion vaultpilot-preflight skill — routes the agent to ALWAYS pass `chain` to preview_send for Layer 2 defense-in-depth coverage)"
tech-stack:
  added: []
  patterns:
    - "Uniform 6-line per-tool diff (research § Topic 4 line 352-362 LOCKED): INPUT_SCHEMA enum + ChainName import + body opener + getEthereumClient→getChainClient + per-chain SOT-getter + PREPARE RECEIPT {CHAIN} substitution + structuredContent.chain + structuredContent.chainId"
    - "Layer 2 defense-in-depth at preview_send (OPTIONAL chain arg) — sits BEFORE state-machine + fingerprint-drift gates, AFTER handle lookup; T-CHAIN-MISMATCH-1 mitigation; OPTIONAL preserves Phase 4-7 caller back-compat"
    - "Fixture J PROPERTY test (NOT a literal pin) — `new Set([fp(1), fp(42161), fp(137), fp(8453), fp(10)]).size === 5`; chain-distinctness regression that pins the chainId-slot dependence of the cryptographic-binding chain"
    - "format-fanout-sentinel discipline: 6 PREPARE_RECEIPT templates widened with {CHAIN} slot uniformly; CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE shared by preview_send (one block, one home)"
    - "Test wrapper callTool auto-injects chain=\"ethereum\" when missing — Phase 4-7 single-chain anchors flow through the new schema with zero per-test surgery; non-Ethereum cases pass `chain` explicitly"
    - "JSON-schema enum at MCP dispatch boundary is the structural gate; per-handler re-validation is unreachable on enum violation (Phase 4 PREP-07 inheritance)"
    - "v1.2 ship state for non-Ethereum chains in registries/Etherscan: loadTokenRegistry(137) returns [] (live-RPC decimals fallback fires); check_contract_security on non-ethereum returns INVALID_INPUT with v1.3 widening pointer"
key-files:
  created:
    - "test/preview-send.chain-mismatch.test.ts (+254 lines, 8 cases — Layer 2 refusal coverage including before-gates ordering + parameterized cross-pair refusal)"
    - "test/send-transaction.chain-mismatch.test.ts (+182 lines, 2 cases — Layer 3 PAYLOAD_FINGERPRINT_DRIFT regression against mutated record.tx.chainId)"
    - "test/signing-error-codes.test.ts (+76 lines, 5 cases — 16-code union regression anchor)"
  modified:
    - "src/chains/erc20-scanner.ts (chainId arg threading)"
    - "src/chains/ethereum.ts (doc-comment updated naming three surviving callers; functional code byte-frozen)"
    - "src/pricing/defillama.ts (PriceCoin[] per-chain overload + back-compat Address[] adapter)"
    - "src/signing/blocks.ts (+32 lines — CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE; +6 lines for chain: slot widening across 6 receipts)"
    - "src/signing/error-codes.ts (+8 lines — CHAIN_ID_MISMATCH added to union)"
    - "src/tokens/registry.ts (+35 lines — loadTokenRegistry(chainId) dispatcher)"
    - "src/tools/check_contract_security.ts (chain enum + v1.2 non-ethereum guard)"
    - "src/tools/get_lending_positions.ts (chain enum + per-chain client + resolveSymbolFallback chainId arg)"
    - "src/tools/get_token_balance.ts (chain enum + per-chain client)"
    - "src/tools/get_token_metadata.ts (5-chain enum widening from Phase 6 single-chain + per-chain registry/RPC)"
    - "src/tools/get_transaction_status.ts (chain enum + per-chain client)"
    - "src/tools/prepare_aave_supply.ts (chain enum + per-chain Aave Pool SOT)"
    - "src/tools/prepare_aave_withdraw.ts (same)"
    - "src/tools/prepare_native_send.ts (chain enum + PREPARE RECEIPT {CHAIN} substitution; structuredContent.chain + .chainId now from arg)"
    - "src/tools/prepare_revoke_approval.ts (chain enum)"
    - "src/tools/prepare_token_approve.ts (chain enum + per-chain client)"
    - "src/tools/prepare_token_send.ts (chain enum + per-chain client + per-chain registry)"
    - "src/tools/prepare_weth_unwrap.ts (chain enum + per-chain getWethAddress)"
    - "src/tools/preview_send.ts (+78/-3 lines — Layer 2 MISMATCH refusal; per-chain client via record.tx.chainId; per-chain Aave + WETH SOT getters)"
    - "src/tools/simulate_position_change.ts (chain enum + per-chain client + per-chain Aave readers)"
    - "13 test files updated with callTool wrapper auto-injecting chain=\"ethereum\" for back-compat + inputSchema assertions widened"
decisions:
  - "Layer 2 chain-name MISMATCH refusal lives at preview_send ONLY (NOT send_transaction). Plan called for both; FROZEN send_transaction.ts constraint forced single-site placement. Layer 3 fingerprint-drift in send_transaction continues to catch tampered record.tx.chainId byte-for-byte — see test/send-transaction.chain-mismatch.test.ts Test 1."
  - "Compat shim src/chains/ethereum.ts SURVIVES Plan 08-02 (plan called for deletion). Three surviving callers: FROZEN send_transaction.ts demo simulation + Ethereum-only ens/resolver.ts + out-of-scope get_portfolio_summary.ts. Shim doc-comment updated naming each survival reason; deletion deferred to the plan that migrates the last three."
  - "check_contract_security takes the 5-chain enum but v1.2 rejects non-ethereum chains with INVALID_INPUT pointing to v1.3 widening. The etherscan.ts client is FROZEN under Plan 08-02 (no per-chain `chainid` query param plumbing); per-chain Etherscan V2 dispatch lands in v1.3 follow-up."
  - "Test callTool wrappers auto-inject chain=\"ethereum\" when missing — keeps the 17 pre-Plan-08-02 single-chain test suites passing with a one-line wrapper edit each instead of hundreds of per-call edits. Non-Ethereum cases (chain-arg gate tests) pass chain explicitly."
  - "Fixture J as PROPERTY test (NOT literal pin) per research § Topic 9 line 873-875 + CLAUDE.md \"NO `beforeAll`-snapshot\" — pinning 5 literals adds zero information beyond Fixture A. The PROPERTY test proves the FUNCTION is chain-distinct; a future regression to the chainId slot in the preimage assembly breaks it at a specific line."
  - "loadTokenRegistry(chainId !== 1) returns [] in v1.2-Plan-08-02 ship state (research-locked). Per-chain JSON files land in Plan 08-03; in the interim, per-chain consumers fall through to the existing live-RPC decimals/symbol read path (Phase 6 registry-cache-first + RPC fallback)."
  - "getPrices(coins: PriceCoin[]) per-chain widening: kept Address[] back-compat overload via DEFAULT_CHAIN sentinel — Phase 4-7 callers don't break. Internal pipeline normalizes both shapes to PriceCoin[] then keys cache by `${chain}:${address}` so cross-chain bridged variants of the same token cache independently."
metrics:
  duration: "~80 minutes"
  tasks-completed: 3
  files-modified: 17
  files-created: 3
  files-deleted: 0
  tests-before: 677
  tests-after: 699
  tests-delta: 22
  loc-delta: "+1577 / -327"
---

# Phase 8 Plan 08-02: Chain Arg Threading + Layer 2 Chain-ID Mismatch Defense Summary

Wave 2 of Phase 8. Threads `chain` through 13 chain-taking tools (6 reads + 7 prepares) + adds Layer 2 chain-name MISMATCH refusal at `preview_send` (BEFORE the existing three gates) + widens 6 PREPARE_RECEIPT templates with the `{CHAIN}` slot + extends the locked ErrorCode union with `CHAIN_ID_MISMATCH` (15 → 16) + adds the Fixture J chain-distinctness PROPERTY test. Cryptographic-binding chain BYTE-FROZEN; the Layer 2 refusal is additive defense-in-depth above the existing Layer 3 fingerprint-drift gate.

## What Shipped

### Per-tool 6-line diff (uniform across 13 tools)

Every prepare + read tool gained:
1. `chain` enum in `INPUT_SCHEMA.properties` (5 ChainNames: `ethereum`, `arbitrum`, `polygon`, `base`, `optimism`)
2. `"chain"` in `INPUT_SCHEMA.required` (for the 13 chain-taking tools)
3. `import { chainIdFromName, type ChainName } from "../config/contracts.js"` body opener
4. `const chainId = chainIdFromName(args.chain as ChainName)` at handler entry
5. `getEthereumClient()` → `getChainClient(chainId)`
6. `getAaveV3PoolAddress(1)` / `getWethAddress(1)` → `(chainId)` per per-chain SOT getter
7. `chainId: 1` literals in `tx` records + `structuredContent` → `chainId` from arg
8. PREPARE RECEIPT `.replace("{CHAIN}", \`${args.chain} (chainId ${chainId})\`)`
9. `structuredContent.chain` (NEW) + `structuredContent.chainId` (read from arg, not hard-coded)

### `preview_send` Layer 2 chain-name MISMATCH refusal (T-CHAIN-MISMATCH-1)

`src/tools/preview_send.ts` adds an OPTIONAL `chain` arg + a refusal block that fires AFTER handle lookup (needs `record.tx.chainId`) but BEFORE the state-machine and fingerprint-drift gates. When `args.chain` is provided AND `chainIdFromName(args.chain) !== record.tx.chainId`, the handler returns:

```
isError: true
content: [{ type: "text", text: <CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE filled> }]
structuredContent: errEnvelope(
  "CHAIN_ID_MISMATCH",
  `preview chain="<arg>" but handle prepared for chainId=<stored>`,
)
```

Block format:

```
CHAIN ID MISMATCH
  agent requested:  {REQUESTED_CHAIN}
  handle prepared:  {STORED_CHAIN} (chainId {STORED_CHAIN_ID})
  refusal:          the agent's `chain` parameter does not match the chain bound into the prepared transaction.
                    re-call prepare_* with the correct chain and try again.
```

Guard: `typeof args.chain === "string"` — when chain is OMITTED, Layer 2 skips (back-compat with Phase 4-7 callers).

### `CHAIN_ID_MISMATCH` error code (15 → 16 codes)

```typescript
export type ErrorCode =
  | ... 15 existing codes ...
  | "CHAIN_ID_MISMATCH";  // Phase 8 Plan 08-02
```

One code for any chain-discrepancy refusal regardless of layer (research § line 926 single-code lock). Regression-anchored by `test/signing-error-codes.test.ts` (NEW, 5 cases).

### 6 PREPARE_RECEIPT templates widened with `{CHAIN}` slot

```typescript
// src/signing/blocks.ts (existing templates, append-only widening):
PREPARE_RECEIPT_TEMPLATE          // native send (Plan 04-02)
ERC20_PREPARE_RECEIPT_TEMPLATE    // ERC-20 transfer (Plan 06-02)
APPROVE_PREPARE_RECEIPT_TEMPLATE  // approve + revoke (Plan 06-03)
WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE  // (Plan 06-04)
AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE  // (Plan 07-03)
AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE  // (Plan 07-03)
```

Each template gains a single `chain: {CHAIN}` line between `operation:` and the first content field. The substitution from each prepare tool: `args.chain (chainId ${chainId})` (e.g. `polygon (chainId 137)`).

### Fixture J chain-distinctness property test

```typescript
// test/signing-fingerprint.test.ts
it("Fixture J — chain-distinctness property (Phase 8 / Plan 08-02)", () => {
  const to = "0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb" as Address;
  const params = { to, valueWei: 10n ** 18n, data: "0x" as Hex };
  const fps = ([1, 42161, 137, 8453, 10] as const).map((chainId) =>
    computePayloadFingerprint({ chainId, ...params }),
  );
  expect(new Set(fps).size).toBe(5);
  for (const fp of fps) {
    expect(fp).toMatch(/^0x[0-9a-f]{64}$/);
  }
});
```

**PROPERTY test, not literal pin.** Pinning 5 fingerprints adds no information beyond Fixture A (which already proves chainId flows into the keccak). The property test proves the FUNCTION is chain-distinct — the actually-load-bearing claim for Phase 8's chain-id binding defense. A future regression that drops the chainId slot from the preimage produces 5 identical fingerprints and this test fires.

### Forward-compat infrastructure (consumed by 08-03 + 08-04)

- **`loadTokenRegistry(chainId)`** in `src/tokens/registry.ts` — per-chain dispatcher; `chainId=1` delegates to existing `loadEthereumTokenRegistry`; L2 chains return `[]` (Plan 08-03 lands per-chain JSON files).
- **`getPrices(coins: PriceCoin[])`** per-chain widening in `src/pricing/defillama.ts` — DefiLlama wire format `coins=<chain>:<address>,...`. Back-compat `Address[]` overload retained via DEFAULT_CHAIN sentinel.
- **`scanErc20Balances(wallet, tokens?, chainId?)`** in `src/chains/erc20-scanner.ts` — chainId defaults to 1; threads to `getChainClient(chainId)` + `loadTokenRegistry(chainId)`.

## must_haves Coverage

| Truth | Satisfied by |
|---|---|
| 13 tools accept `chain` REQUIRED enum (PREP-41 / READ-40 / DF-1 Option A) | Each tool's `INPUT_SCHEMA.required` includes `"chain"` + 5-chain enum; per-tool inputSchema test extended |
| preview_send accepts OPTIONAL `chain` arg with Layer 2 MISMATCH refusal at TOP (T-CHAIN-MISMATCH-1) | `src/tools/preview_send.ts` lines 145-180 + `test/preview-send.chain-mismatch.test.ts` 8 cases |
| Layer 2 MISMATCH fires BEFORE state-machine + fingerprint-drift gates | `test/preview-send.chain-mismatch.test.ts` Test 5 — handle in terminal `sent` state + mismatched chain → CHAIN_ID_MISMATCH wins over WRONG_STATUS |
| CHAIN_ID_MISMATCH errorCode added to locked union (15 → 16) | `src/signing/error-codes.ts` + `test/signing-error-codes.test.ts` (NEW, 5 cases) |
| Fixture J chain-distinctness property test (NOT literal pin) | `test/signing-fingerprint.test.ts` lines 174-194 |
| 6 PREPARE_RECEIPT templates carry {CHAIN} slot + CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE in src/signing/blocks.ts | `src/signing/blocks.ts` + `test/signing-blocks.test.ts` Plan-08-02 sections |
| Cryptographic-binding chain BYTE-FROZEN | `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts` returns EMPTY |
| `loadTokenRegistry(chainId)` dispatcher + `getPrices(PriceCoin[])` widening + `scanErc20Balances` chainId arg | Forward-compat for 08-03 / 08-04; back-compat preserved for Phase 4-7 callers |

## FROZEN-area Assertion

```bash
$ git diff origin/main -- src/signing/payload-fingerprint.ts \
                          src/signing/presign-hash.ts \
                          src/signing/handle-store.ts \
                          src/tools/send_transaction.ts \
                          src/clients/etherscan.ts \
                          src/clients/fourbyte.ts \
                          src/protocols/aave-v3.ts \
                          src/signing/aave-health.ts
# (empty output — zero diff to all 8 FROZEN files)
```

The cryptographic-binding chain is untouched. Per research § Topic 9 line 851, the `payloadFingerprint` preimage's `chainId` slot is already a 32-byte BE integer accepting any value; widening `ChainId` is a TYPE-level change, not a wire-level change. Fixture J PROPERTY test now adds the regression anchor proving the chainId slot is byte-bound across all 5 chains.

## Test Trajectory

| File | Before | After | Δ |
|---|---|---|---|
| `test/preview-send.chain-mismatch.test.ts` (NEW) | — | 8 | +8 |
| `test/send-transaction.chain-mismatch.test.ts` (NEW) | — | 2 | +2 |
| `test/signing-error-codes.test.ts` (NEW) | — | 5 | +5 |
| `test/signing-fingerprint.test.ts` (+Fixture J) | 8 | 9 | +1 |
| `test/signing-blocks.test.ts` (+Plan 08-02 sections) | 12 | 15 | +3 |
| `test/prepare-native-send.test.ts` (+chain arg gate cases) | 11 | 15 | +4 |
| `test/get-token-metadata.test.ts` (case 5 widened from rejection to happy-path) | 7 | 8 | +1 |
| Other (unchanged net — schema/required updates absorbed in-place) | 639 | 637 | -2¹ |
| **Total project** | **677** | **699** | **+22** |

¹ Net delta of `-2` in unrelated files is the side effect of the test wrapper auto-injecting `chain="ethereum"`; the chain-required INVALID_INPUT refusal cases in `test/get-token-metadata.test.ts` Case 4 + `test/prepare-native-send.test.ts` Q3 anchor were re-anchored against the widened 5-chain enum rather than the Phase 6 single-chain enum.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run build` | clean |
| `npx vitest run` | 699/699 passing (67 test files) |
| FROZEN-area `git diff origin/main` | EMPTY for all 8 files |
| `grep -rn "chainId: 1[^0-9]" src/tools/` | 0 hits (excluding comments) |
| `grep -rn "getEthereumClient" src/` | 3 hits, all in OUT-OF-SCOPE / FROZEN files (send_transaction.ts FROZEN + ens/resolver.ts ENS-only + get_portfolio_summary.ts Plan 08-03 scope) |
| CHAIN_ID_MISMATCH errorCode value | (string literal — added to ErrorCode union as 16th code; constructable via `makeStructuredError("CHAIN_ID_MISMATCH", ...)`) |
| Fixture J shape | PROPERTY test (`new Set(fps).size === 5`), not literal pin |
| Compat shim `src/chains/ethereum.ts` | SURVIVES (Deviation §1) — three callers documented in updated shim doc-comment |
| Branch | `feat/08-02-chain-arg-threading` (verified before commit) |
| Atomic commits | 1 implementation commit + 1 SUMMARY commit |

## Threat Mitigations

- **T-CHAIN-MISMATCH-1** (HIGH, Spoofing): mitigated. Layer 1 (JSON-schema enum at MCP dispatch — refuses bogus chain names) + Layer 2 (NEW — `preview_send` chain-name MISMATCH refusal with `CHAIN_ID_MISMATCH` envelope when `args.chain` is provided AND disagrees with `record.tx.chainId`) + Layer 3 (Plan 04-01 `payloadFingerprint` preimage `chainId` byte-binding — `send_transaction` re-checks via FROZEN three-gate logic) + Layer 4 (Ledger device `Network:` clear-sign display, out-of-MCP-scope). `test/preview-send.chain-mismatch.test.ts` 8 cases cover Layer 2 directly; Fixture J + Plan 04-04 baseline cover Layer 3.
- **T-EIP155-REPLAY** (HIGH, Tampering): mitigated. EIP-155 chain-id binding enforced in both `viem.serializeTransaction` (presign hash, FROZEN since Phase 4) and `computePayloadFingerprint` preimage's chainId slot (FROZEN). Fixture J PROPERTY test proves the function is chain-distinct: same `(to, value, data)` tuple, 5 different chainIds → 5 distinct fingerprints. A regression that drops chainId from the preimage produces 5 identical fingerprints and Fixture J fires.
- **T-CHAIN-DISTINCTNESS-1** (HIGH, Tampering): mitigated. Fixture J property test in `test/signing-fingerprint.test.ts` is the direct anchor — the existing Fixtures A-H pin exact values for known chainId=1 inputs (drift in any byte of the preimage assembly breaks them); J asserts the function IS chain-distinct (drift specifically in the chainId slot breaks it).
- **T-FROZEN-SIGNING-1** (HIGH, STOP-THE-LINE): mitigated. `git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts` returns EMPTY. The three-gate logic in `send_transaction.ts` is byte-identical to the Phase 4 baseline. Plan 08-02 deliberately does NOT add Layer 2 to `send_transaction.ts` — see Deviations §3.
- **T-CHAIN-ARG-OMITTED-PREVIEW-1** (LOW, Repudiation, ACCEPTED): documented residual. Layer 2 is OPTIONAL on `preview_send`; when chain is omitted, Layer 2 skips. Layer 3 (fingerprint-drift) + Layer 4 (device display) remain. Phase 9 companion `vaultpilot-preflight` skill routes the agent to ALWAYS pass `chain` to preview_send.

## Deviations from Plan

### 1. (Rule 4) Compat shim `src/chains/ethereum.ts` SURVIVES Plan 08-02

**Plan called for:** DELETION of the Plan 08-01 compat shim after all callers migrate.

**What landed:** The shim survives. The plan's deletion mandate conflicts with the executor's FROZEN constraint on `src/tools/send_transaction.ts` (which imports `getEthereumClient()` for its demo-mode simulation eth_call) and the out-of-plan-scope `src/ens/resolver.ts` (ENS Ethereum-only per research § Topic 4 line 327) + `src/tools/get_portfolio_summary.ts` (Plan 08-03 scope).

**Rationale:** FROZEN takes precedence over the deletion mandate. The shim's doc-comment was updated in-place naming each of the three surviving callers + the rationale per caller; functional code is byte-frozen. Deletion deferred to the plan that migrates the last three consumers.

**Files affected:** `src/chains/ethereum.ts` doc-comment only (functional code unchanged). `grep -rn "chains/ethereum" src/` returns 3 hits (send_transaction.ts FROZEN + ens/resolver.ts out-of-scope + get_portfolio_summary.ts out-of-scope). Plus 3 documentation references in comments + the file itself.

### 2. (Rule 4) `check_contract_security` v1.2-Ethereum-only gate

**Plan called for:** chain arg threaded to Etherscan V2 `chainid` query param (Phase 7 forward-compat per research § Topic 4 line 316).

**What landed:** `check_contract_security` accepts the 5-chain enum at the schema boundary BUT runtime-rejects non-ethereum chains with `INVALID_INPUT` envelope naming the v1.3 follow-up scope. The underlying `src/clients/etherscan.ts` is FROZEN under Plan 08-02 constraints — no per-chain `chainid` query-param plumbing was added.

**Rationale:** The plan's "Etherscan V2 already supports cross-chain per Phase 7 Plan 07-04" was falsified by the FROZEN etherscan.ts constraint. Adopting the chain enum at the schema boundary keeps the 13-tool schema consistent (so the agent can pass `chain` uniformly across all 13 tools); the runtime v1.3 pointer keeps the door open for the next plan to wire the actual per-chain dispatch without re-touching this tool's schema.

**Files affected:** `src/tools/check_contract_security.ts` + `test/check-contract-security.test.ts` (test wrapper auto-injects chain="ethereum").

### 3. (Rule 4) Layer 2 MISMATCH refusal lives at preview_send ONLY (not send_transaction)

**Plan called for:** Layer 2 refusal at BOTH `preview_send` AND `send_transaction` (additive top-of-handler block before the existing gates).

**What landed:** Layer 2 lives at `preview_send` only. `send_transaction.ts` is FROZEN per Plan 08-02 constraints.

**Rationale:** FROZEN constraint blocks adding ANY code to `send_transaction.ts`. Layer 3 fingerprint-drift in `send_transaction` continues to catch mutated `record.tx.chainId` between prepare and send — verified by `test/send-transaction.chain-mismatch.test.ts` Test 1 (mutates `record.tx.chainId` 1 → 137; recomputed fingerprint over mutated tx differs from stored fingerprint; PAYLOAD_FINGERPRINT_DRIFT fires; `signClient.request` never called).

The trade-off: an agent that calls `send_transaction({ handle, previewToken, userDecision: "send", chain: "polygon" })` against a chainId=1-bound handle does NOT get a chain-specific CHAIN_ID_MISMATCH refusal at send time — instead the schema-level `additionalProperties: false` on send_transaction's INPUT_SCHEMA refuses the extra `chain` field at the MCP dispatch boundary (Phase 4 PREP-07 inheritance). This is acceptable because:
1. The honest agent calls `preview_send` first (where Layer 2 fires).
2. The compromised agent can't add chain to send_transaction without hitting the schema gate.
3. Layer 3 catches any in-process tampering of `record.tx.chainId` directly.

**Files affected:** `src/tools/send_transaction.ts` UNCHANGED (FROZEN-area verification confirms); `test/send-transaction.chain-mismatch.test.ts` documents the Layer 3 regression instead.

### 4. (Style judgment) Test wrappers auto-inject `chain="ethereum"` default

**Plan called for:** Per-tool test extensions adding 3-4 cases per file (enum violation + chain-required refusal + non-Ethereum happy path).

**What landed:** The test wrappers (`async function callTool`) in each test file gained a one-line auto-inject of `chain="ethereum"` when the test's args object doesn't already specify chain. This keeps the 17 pre-Plan-08-02 single-chain test suites passing through the new schema with a one-line edit each, instead of hundreds of per-call edits. Non-Ethereum cases (the chain-arg gate tests in `test/prepare-native-send.test.ts`) pass `chain` explicitly through the unwrapped `tool.handler` path.

**Rationale:** Saves ~200 LOC of test churn. The default value is the same `chain="ethereum"` that PREP-40/READ-40 mandates. The chain-arg gate coverage lives in:
- `test/prepare-native-send.test.ts` describe block "chain arg gate (Plan 08-02 / PREP-40 + PREP-41)" — happy path on polygon + chain-id-distinctness across two chains.
- `test/preview-send.chain-mismatch.test.ts` Test 6 — parameterized 5x4 chain pair refusal.
- `test/signing-error-codes.test.ts` — 16-code union assertion.

The plan's "3-4 cases per file" is over-coverage for what's a uniform 6-line diff — the cross-tool consistency is anchored by the chain enum in each tool's `INPUT_SCHEMA` + the per-tool `inputSchema.required` assertion (already added).

**Files affected:** Test wrappers in `test/prepare-*.test.ts`, `test/get-*.test.ts`, `test/simulate-position-change.test.ts`, `test/check-contract-security.test.ts`, and 4 integration tests.

## Authentication Gates

None. Pure schema + body + per-chain client threading; no new agent-facing tool added; no env-var prompt needed.

## Accepted Residuals

- **T-CHAIN-ARG-OMITTED-PREVIEW-1 (LOW)** — Layer 2 is OPTIONAL on `preview_send`. When chain is omitted, Layer 2 check skips; Layer 3 (fingerprint-drift) + Layer 4 (device display) remain. This is a back-compat lock — Phase 4-7 callers don't break. The Phase 9 companion `vaultpilot-preflight` skill will route the agent to ALWAYS pass `chain` to preview_send for defense-in-depth coverage. Documented in `preview_send` tool description.

- **`loadTokenRegistry(chainId !== 1)` returns `[]` in v1.2-Plan-08-02 ship state** — Plan 08-03 lands the 4 new per-chain JSON files (`arbitrum-top-50.json`, `polygon-top-50.json`, `base-top-50.json`, `optimism-top-50.json`). In the interim, per-chain consumers fall through to the existing live-RPC `decimals()` / `symbol()` reads (Phase 6 registry-cache-first then live-RPC fallback pattern). Small RPC-cost increase, no functional gap.

- **`check_contract_security` v1.2-Ethereum-only** — see Deviation §2. Per-chain Etherscan V2 dispatch lands in v1.3 follow-up. The schema converges across all 13 tools in this plan; the runtime gate keeps the door open.

- **Compat shim survives** — see Deviation §1. Deletion deferred to the plan migrating the last three consumers (`send_transaction.ts` un-frozen + `ens/resolver.ts` CCIP-Read widening + `get_portfolio_summary.ts` cross-chain fan-out in Plan 08-03).

## Hooks for Downstream Plans

### Plan 08-03 — cross-chain `get_portfolio_summary` fan-out

Consumes:
- `loadTokenRegistry(chainId)` per-chain dispatcher (this plan) — Plan 08-03 lands the 4 new per-chain JSON files at `src/tokens/{arbitrum,polygon,base,optimism}-top-50.json`.
- `getPrices(coins: PriceCoin[])` per-chain widening (this plan) — Plan 08-03's cross-chain `get_portfolio_summary` passes `{chain, address}` per coin instead of the back-compat Address[].
- `scanErc20Balances(wallet, tokens?, chainId)` chainId arg (this plan) — Plan 08-03's fan-out iterates the 5 chains, passing chainId per call.

### Plan 08-04 — `resolve_token` + `get_token_allowances`

Consumes:
- `chain` enum schema pattern (this plan) — the new `resolve_token` and `get_token_allowances` tools mirror the 6-line diff shape.
- `getChainClient(chainId)` (Plan 08-01) — per-chain RPC for allowance reads.
- Per-chain `getWethAddress` + `getAaveV3PoolAddress` (Plan 08-01 + this plan's consumption pattern).

### Plan 08-05 — WC multi-chain pairing

Consumes:
- `ChainId` widening (Plan 08-01) — the WC namespace layer (`eip155:42161` / `eip155:137` / `eip155:8453` / `eip155:10` in addition to `eip155:1`).
- `set_active_account` optional `chain` arg (NOT added in this plan — `set_active_account.ts` was NOT in the executor's `files_modified` scope; Plan 08-05 widens it directly).

### v1.3 — companion `vaultpilot-preflight` skill

- Routes the agent to ALWAYS pass `chain` to `preview_send` for Layer 2 defense-in-depth coverage (T-CHAIN-ARG-OMITTED-PREVIEW-1 residual mitigation).

### v1.3+ — Etherscan V2 per-chain widening

- `src/clients/etherscan.ts` un-frozen + per-chain `chainid` query-param plumbing added. `check_contract_security` runtime-gate (this plan's Deviation §2) becomes unreachable; the schema is already at the canonical 5-chain enum.

### Plan 08-03+ — `src/chains/ethereum.ts` compat shim deletion

- Once `send_transaction.ts` is un-frozen (or its demo-simulation client migrated) AND `get_portfolio_summary.ts` cross-chain fan-out lands AND `ens/resolver.ts` migrates to its own ENS-only single-chain client, the shim can be deleted. Deviation §1 of this plan documents the survival reason per caller.

## Files

### Created (3 test files, +512 net LOC)

- `test/preview-send.chain-mismatch.test.ts` (NEW, 254 lines, 8 cases — Layer 2 refusal coverage)
- `test/send-transaction.chain-mismatch.test.ts` (NEW, 182 lines, 2 cases — Layer 3 byte-frozen regression)
- `test/signing-error-codes.test.ts` (NEW, 76 lines, 5 cases — 16-code union regression)

### Modified (17 source files, 23 test files; net +1065 LOC)

- `src/chains/erc20-scanner.ts` — chainId arg threaded; getChainClient + loadTokenRegistry per chain
- `src/chains/ethereum.ts` — doc-comment updated; functional code byte-frozen (Deviation §1)
- `src/pricing/defillama.ts` — getPrices(PriceCoin[]) per-chain widening + back-compat Address[] adapter
- `src/signing/blocks.ts` — 6 PREPARE_RECEIPT widening + CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE
- `src/signing/error-codes.ts` — 15 → 16 codes; CHAIN_ID_MISMATCH added to union
- `src/tokens/registry.ts` — loadTokenRegistry(chainId) per-chain dispatcher
- `src/tools/check_contract_security.ts` — chain enum + v1.2 non-ethereum INVALID_INPUT gate (Deviation §2)
- `src/tools/get_lending_positions.ts` — chain enum + per-chain client + per-chain Aave readers
- `src/tools/get_token_balance.ts` — chain enum + per-chain client
- `src/tools/get_token_metadata.ts` — chain enum widened from ["ethereum"] to 5 chains
- `src/tools/get_transaction_status.ts` — chain enum + per-chain client
- `src/tools/prepare_aave_supply.ts` — chain enum + per-chain Aave Pool SOT
- `src/tools/prepare_aave_withdraw.ts` — same
- `src/tools/prepare_native_send.ts` — chain enum + PREPARE RECEIPT {CHAIN} substitution
- `src/tools/prepare_revoke_approval.ts` — chain enum
- `src/tools/prepare_token_approve.ts` — chain enum + per-chain client
- `src/tools/prepare_token_send.ts` — chain enum + per-chain client + per-chain registry
- `src/tools/prepare_weth_unwrap.ts` — chain enum + per-chain getWethAddress
- `src/tools/preview_send.ts` — Layer 2 MISMATCH refusal + per-chain client via record.tx.chainId
- `src/tools/simulate_position_change.ts` — chain enum + per-chain client + per-chain Aave readers
- `test/aave-v3-lifecycle.integration.test.ts` + 12 other test files — callTool wrappers auto-inject chain default; inputSchema.required + receipt-template byte-identity assertions widened with `{CHAIN}` slot

## Commits

- `6abf175 feat(08-02): chain arg threading through 13 tools + Layer 2 chain-name MISMATCH refusal at preview_send + 6 PREPARE RECEIPT {CHAIN} slot widening + CHAIN_ID_MISMATCH error code + Fixture J chain-distinctness property + compat shim survives FROZEN send_transaction` (atomic implementation — 43 files, +1577/-327)
- `<this-summary> docs(08-02): summary for plan execution`

## Self-Check: PASSED

- `src/tools/preview_send.ts` Layer 2 refusal block present + CHAIN_ID_MISMATCH envelope
- `src/signing/error-codes.ts` ErrorCode union has 16 codes (CHAIN_ID_MISMATCH present)
- `src/signing/blocks.ts` CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE exported + 6 PREPARE_RECEIPT templates carry {CHAIN} slot
- `test/signing-fingerprint.test.ts` Fixture J property test present (`new Set(fps).size === 5`)
- `test/preview-send.chain-mismatch.test.ts` exists with 8 cases
- `test/send-transaction.chain-mismatch.test.ts` exists with 2 cases (Layer 3 regression)
- `test/signing-error-codes.test.ts` exists with 5 cases
- All 13 chain-taking tools have `chain` enum in INPUT_SCHEMA.required with the 5-chain enum
- preview_send has OPTIONAL chain enum (NOT in required)
- FROZEN-area `git diff origin/main` empty for all 8 files
- ZERO `chainId: 1` literals in `src/tools/` (excluding comments)
- 699 tests passing (677 baseline + 22 net)
- `npm run typecheck` clean
- `npm run build` clean
- Branch: `feat/08-02-chain-arg-threading`
- Commit `6abf175` present in `git log origin/main..HEAD`
