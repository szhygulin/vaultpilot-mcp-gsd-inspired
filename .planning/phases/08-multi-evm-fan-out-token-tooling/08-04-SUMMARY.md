---
phase: 08
plan: 04
subsystem: tools/tokens/signing — bridged-token disambiguation + allowance enumeration + SET-LEVEL block
tags: [multi-chain, bridged-variants, usdc, usdc-e, allowances, event-logs, getlogs, multicall, set-level-enumeration, dispatch-allowlist, phase-8, wave-3, read-42, read-43, read-44, v1.3-preflight]
requirements: [READ-42, READ-43, READ-44]
wave: 3
status: complete
completed: 2026-05-18
dependency-graph:
  requires:
    - "src/chains/registry.ts (Plan 08-01 — getChainClient + isPublicNodeFallback per chain)"
    - "src/config/contracts.ts (Plan 08-01 — ChainId + ChainName + chainIdFromName + chainNameFromId + lookupSpender)"
    - "src/protocols/erc20.ts (Plan 06-02 — MAX_UINT256 sentinel)"
    - "src/signing/error-codes.ts (Plan 04-* + 08-02 — makeStructuredError + INVALID_INPUT + INTERNAL_ERROR codes)"
    - "src/tools/index.ts (Phase 2 — registerTool / getRegisteredTool)"
  provides:
    - "MCP tool resolve_token (READ-42) — curated-table lookup; chain OPTIONAL → ALL chains' rows; chain PROVIDED → 1 or 2 rows depending on bridged-variant existence"
    - "MCP tool get_token_allowances (READ-43 + READ-44) — two-step Approval-event scan + multicall cross-check; per-row { token, spender, spenderLabel, amount, isUnlimited, lastSeenBlock }"
    - "`[SET-LEVEL ENUMERATION]` text block in content[0].text — verbatim shape consumed by v1.3 vaultpilot-preflight skill for outer dispatch-allowlist enforcement (Inv #14)"
    - "src/tokens/bridged-variants.ts (NEW — 73 EIP-55-checksummed rows × 23 unique symbols × 5 chains; lookupBridgedVariant getter + _bridgedVariants spy-affordance)"
    - "src/signing/blocks.ts SET_LEVEL_ENUMERATION_TEMPLATE (additive — existing 8 templates BYTE-FROZEN)"
    - "T-LOGS-CEILING-1 PublicNode chunking + rpcDegraded surfacing in get_token_allowances response"
    - "APPROVAL_EVENT_TOPIC single-SOT constant in get_token_allowances.ts (cross-checked at test time against runtime keccak256)"
  affects:
    - "src/tokens/bridged-variants.ts (NEW)"
    - "src/tools/resolve_token.ts (NEW)"
    - "src/tools/get_token_allowances.ts (NEW)"
    - "src/signing/blocks.ts (MODIFY — additive SET_LEVEL_ENUMERATION_TEMPLATE append)"
    - "src/tools/register-all.ts (MODIFY — +2 import lines at line 5-6 carve)"
    - "test/bridged-variants.test.ts (NEW — 17 cases)"
    - "test/resolve-token.test.ts (NEW — 12 cases)"
    - "test/get-token-allowances.test.ts (NEW — 17 cases)"
  unblocks:
    - "08-05 (WC multi-chain pairing — independent file scope; trivial register-all rebase)"
    - "Phase 8 code-completion (08-04 + 08-05 finish the phase; retrospective is the final task)"
    - "v1.3 vaultpilot-preflight skill (consumes [SET-LEVEL ENUMERATION] block verbatim for outer dispatch-target allowlist enforcement — Inv #14)"
    - "v1.3 per-chain known-spender tables (current Ethereum-only lookupSpender labels non-Ethereum spenders as '(unknown spender)' — documented residual)"
tech-stack:
  added: []
  patterns:
    - "Hand-curated multi-chain disambiguation table (mirror of KNOWN_SPENDERS_ETHEREUM shape) — typed BridgedVariant interface + readonly BRIDGED_VARIANTS[] + filtered getter + spy-affordance"
    - "Per-row variantNote text as load-bearing scam-prevention signal — bridged variants name the bridge mechanism explicitly so the agent surfaces both sides of USDC vs USDC.e ambiguity to the user"
    - "Two-step ERC-20 allowance enumeration: client.getLogs(Approval, owner=wallet) → per-(token, spender) dedupe → client.multicall(allowFailure) for current-allowance cross-check; zero-allowance rows filtered as revoked/spent"
    - "PublicNode 10k-block getLogs chunking when isPublicNodeFallback(chainId) && lookback > 10k — explicit chunksScanned + rpcDegraded surfacing + verbatim warning text"
    - "ESM spy-affordance _logs = { scanApprovalEvents, filterActiveAllowances } for test seam (vi.spyOn intercepts via the indirection — direct ESM named-export spies are no-ops)"
    - "Format-fanout-sentinel SET_LEVEL_ENUMERATION_TEMPLATE in src/signing/blocks.ts (one block, one home; the substitution helper renderSetLevelBlock lives in get_token_allowances.ts)"
    - "Per-row line-stable text format for the {TABLE} slot (`  │  <field>: <value>`) — parser-friendly; never truncates uint256 amounts; v1.3 preflight skill splits on `: ` and strips leading whitespace"
    - "APPROVAL_EVENT_TOPIC hardcoded as the SOT constant + runtime keccak256 self-check at test time (Test 7) — drift in the keccak preimage fails the assertion before the constant is consumed in production"
key-files:
  created:
    - "src/tokens/bridged-variants.ts (+595 lines, 73 BridgedVariant rows × 23 unique symbols × 5 chains where applicable; getAddress()-checksummed at literal site; lookupBridgedVariant + _bridgedVariants)"
    - "src/tools/resolve_token.ts (+157 lines, READ-42 — curated-table lookup; NO RPC call; chain optional per DF-1 Option A)"
    - "src/tools/get_token_allowances.ts (+437 lines, READ-43 + READ-44 — two-step enumeration; APPROVAL_EVENT_TOPIC + DEFAULT_LOOKBACK_BLOCKS + PUBLICNODE_LOG_CHUNK_BLOCKS constants; _logs spy-affordance; renderSetLevelBlock helper)"
    - "test/bridged-variants.test.ts (+178 lines, 17 cases — table coverage anchor + curated-table integrity + variant↔originChain semantic invariant + case-insensitivity + variantSymbol match + spy round-trip)"
    - "test/resolve-token.test.ts (+158 lines, 12 cases — T-USDC-USDC.E anchor + chain-omitted all-chains + INVALID_INPUT + JSON-schema enum gate + register-all wiring + canonical ChainName field + verbatim variantNote text)"
    - "test/get-token-allowances.test.ts (+413 lines, 17 cases — schema gates + happy path + READ-44 byte-level fixture + isUnlimited + spenderLabel resolution + APPROVAL_EVENT_TOPIC keccak self-check + T-LOGS-CEILING-1 chunking + custom lookbackBlocks + full-history scan + getBlockNumber failure surfacing + empty results + _logs spy round-trip)"
  modified:
    - "src/signing/blocks.ts (+47 lines — SET_LEVEL_ENUMERATION_TEMPLATE additive append; existing 8 PREPARE_RECEIPT + DECODED_ARGS templates + Plan 08-02 CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE byte-frozen)"
    - "src/tools/register-all.ts (+2 lines at line 5-6 — `./resolve_token.js` + `./get_token_allowances.js` inserted AFTER `./check_contract_security.js` per PATTERNS.md § 3 carve; non-conflicting with Plan 08-05's set_active_account widening)"
decisions:
  - "Curated 73 rows across 23 unique symbols (plan asked for ~75 / ~15). Test threshold `>= 70` rows + `>= 15` unique symbols comfortably anchored. The 8 extras (MKR, CRV, SUSHI, GMX, BAL + their cross-chain bridged variants) cover Ethereum-anchored governance / DEX tokens that recur in v1.x agent prompts; uncovered long-tail tokens still fall through to get_token_metadata({ address, chain }) per the tool description."
  - "`{TABLE}` slot is per-row line-stable format (`  ┌─ row N` + 6 `  │  <field>: <value>` lines), NOT a Unicode-box-drawing column-aligned table. Plan-prescribed columnar layout was infeasible — fitting a full address + spenderLabel + 78-digit MAX_UINT256 amount in 44/26-char columns truncates load-bearing data (the v1.3 preflight parser needs full addresses + full amounts). The chosen line-stable format keeps the parser shape simple (split on `: `, strip leading whitespace) and never truncates."
  - "spenderLabel for non-Ethereum + unknown rows is `(unknown spender — no prior interaction recorded)` (matches existing Phase 6 string from DECODED_ARGS_TEMPLATE_APPROVE) — single canonical fallback rather than a chain-specific variant. Cross-chain known-spender labeling deferred to v1.3 per Plan 08-01 lock."
  - "APPROVAL_EVENT_TOPIC is an exported const (not a private constant) so the test can compare against `keccak256(toBytes(\"Approval(...)\"))` at runtime. Single-SOT discipline holds via the grep regression check (`grep -c \"0x8c5be1e5...\"` returns 1 across src/)."
  - "ESM spy-affordance `_logs` exposes BOTH scanApprovalEvents AND filterActiveAllowances. This was the documented PATTERNS.md § 2 recommendation — added at write time, not retroactively. Tests use the indirection to short-circuit viem getLogs + multicall plumbing while still exercising the real substitution + warning-text + structured-content surface."
  - "Optional lookbackBlocks input takes precedence over the 1M-block default — coerced to bigint via BigInt(Math.floor(arg)) since JSON-schema number type can carry decimals (defensive Math.floor). Plan-prescribed DF-2 default = 1_000_000n covers ~140d Ethereum / ~30d L2s."
  - "T-LOGS-CEILING-1 warning text appears AFTER the SET-LEVEL ENUMERATION block (not inside) — keeps the block parseable in isolation by the v1.3 preflight skill. The block has a clean [END SET-LEVEL ENUMERATION] terminator; the warning is on a separate line after a blank line."
  - "rpcDegraded surfaces on BOTH chunking branches AND the no-chunking-but-PublicNode branch — defense-in-depth for parity with other read tools (get_token_metadata, get_portfolio_summary, etc.). The chunking branch additionally surfaces chunksScanned + the warning text."
metrics:
  duration: "~25 minutes (single execution wave; no rework iterations — typecheck + full suite green on first build)"
  completed: 2026-05-18
  tasks_completed: 1
  files_created: 6
  files_modified: 2
  files_deleted: 0
  tests_before: 721
  tests_after: 767
  tests_delta: 46
  loc_delta: "+2423"
---

# Phase 8 Plan 08-04: `resolve_token` + `get_token_allowances` + Bridged-Variants Curated Table + `SET_LEVEL_ENUMERATION_TEMPLATE` Summary

Wave 3 of Phase 8. Ships READ-42 (ERC-20 symbol disambiguation), READ-43 (outstanding-allowance enumeration), and READ-44 (`[SET-LEVEL ENUMERATION]` block) as two new MCP read tools backed by a curated bridged-token table + an additive signing-block template. Cryptographic-binding chain BYTE-FROZEN. The `[SET-LEVEL ENUMERATION]` block is load-bearing for v1.3 Inv #14 (vaultpilot-preflight outer dispatch-allowlist enforcement) — the verbatim shape lands here as the source-of-truth.

## What Shipped

### Curated bridged-variants table (READ-42 data layer)

`src/tokens/bridged-variants.ts` — 73 hand-curated rows × 23 unique canonical symbols × 5 chains where the symbol exists. Mirror of the `src/config/contracts.ts` `KNOWN_SPENDERS_ETHEREUM` shape: typed `BridgedVariant` interface + `readonly BRIDGED_VARIANTS[]` + `lookupBridgedVariant(symbol, chainId?)` getter + `_bridgedVariants = { lookupBridgedVariant }` ESM spy-affordance.

```typescript
export interface BridgedVariant {
  canonicalSymbol: string;          // e.g. "USDC" (what the user typed)
  variantSymbol: string;            // e.g. "USDC.e" (bridged variant rename) or "USDC" (canonical)
  address: Address;                 // getAddress-checksummed at literal site
  chainId: ChainId;
  variant: "canonical" | "bridged";
  variantNote: string;              // verbatim text for the agent to surface
  originChain?: ChainName;          // for bridged: where it bridged from
}
```

Symbols covered: **USDC** (5 chains canonical + 3 bridged USDC.e + USDbC on Base), **USDT** (4 canonical), **DAI** (3 canonical + 1 bridged on Polygon), **WETH** (5 canonical incl. OP-Stack predeploy), **WBTC** (1 canonical + 3 bridged), **WMATIC**, **ARB**, **OP**, **cbETH**, **stMATIC**, **MaticX**, **LINK** (3 canonical + 1 bridged), **UNI** (1 canonical + 3 bridged), **AAVE** (1 canonical + 3 bridged), **FRAX**, **LDO** (1 canonical + 2 bridged), **wstETH**, **rETH**, **MKR** (1 canonical + 1 bridged), **CRV** (1 canonical + 3 bridged), **SUSHI** (1 canonical + 2 bridged), **GMX**, **BAL** (1 canonical + 2 bridged).

Each row's `address` is wrapped in `getAddress(...)` at the literal site — a corrupted snapshot throws EIP-55 at module load before any caller sees a bad address (mirror of `src/config/contracts.ts` discipline).

### `resolve_token` (READ-42)

`src/tools/resolve_token.ts` — curated-table lookup with **NO RPC call**. Per the DF-1 Option A lock at planning gate: when `chain` is OMITTED, returns ALL chains' rows for the symbol; when `chain` is PROVIDED, returns rows for that chain only (1 row for unambiguous symbols, 2 rows where a bridged variant exists).

```typescript
// Response shape (structuredContent):
{
  symbol: "USDC",
  rows: [
    {
      canonicalSymbol: "USDC",
      variantSymbol: "USDC",
      address: "0x3c499c542cEF5E3811e1192cE70d8cC03d5c3359",
      chain: "polygon",
      variant: "canonical",
      variantNote: "Circle-native USDC on Polygon. Launched 2023. ..."
    },
    {
      canonicalSymbol: "USDC",
      variantSymbol: "USDC.e",
      address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      chain: "polygon",
      variant: "bridged",
      originChain: "ethereum",
      variantNote: "Bridged USDC via Polygon PoS bridge from Ethereum. ..."
    }
  ]
}
```

The `content[0].text` is a one-line-per-row human-readable summary the agent can surface directly to the user.

### `get_token_allowances` (READ-43 + READ-44)

`src/tools/get_token_allowances.ts` — two-step ERC-20 allowance enumeration per research § Topic 7:

1. **Event scan** — `client.getLogs({ event: Approval(owner=wallet, ...), fromBlock, toBlock })` over a configurable look-back window. Default `lookbackBlocks: 1_000_000n` (DF-2 Option A — ~140 days Ethereum / ~30 days L2s). On PublicNode fallback the scan chunks into 10000-block windows (research § Topic 7 line 697 + § A4). Per-(token, spender) dedupe via `Map<\`${token}:${spender}\`>`; keep latest `blockNumber` per pair.

2. **Multicall cross-check** — per-(token, spender) `allowance(wallet, spender)` reads via `client.multicall({ allowFailure: true })`. Zero-allowance rows (revoked or fully-spent since the event) are filtered out; non-zero rows surface with the CURRENT on-chain value (not the historical event value). `spenderLabel` via `lookupSpender(spender)` — Ethereum-only labels in v1.2 per Plan 08-01 lock; non-Ethereum + unknown rows label as `(unknown spender — no prior interaction recorded)` (matches existing Phase 6 Plan 06-03 string for cross-tool consistency).

Per-row response shape: `{ token, spender, spenderLabel, amount, isUnlimited, lastSeenBlock }` (READ-43 spec). `isUnlimited` is **strict equality** to `MAX_UINT256` (mirrors Phase 6 Plan 06-03 invariant — no fuzzy `> 1e30` thresholds).

`APPROVAL_EVENT_TOPIC` is hardcoded as the SOT constant (`0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925`) and cross-checked against runtime `keccak256(toBytes("Approval(address,address,uint256)"))` in Test 7 — drift in the keccak preimage fails the assertion before the constant is consumed in production. The constant lives in exactly one file (`grep -c` returns 1 across `src/`).

### `[SET-LEVEL ENUMERATION]` block (READ-44)

The `content[0].text` of every `get_token_allowances` response is the verbatim `[SET-LEVEL ENUMERATION]` block. **LOAD-BEARING for v1.3 Inv #14** — the companion `vaultpilot-preflight` skill parses this exact text shape to assemble the outer dispatch-allowlist for revoke-flow enforcement. Drift in this template breaks the v1.3 parser at PR-review time.

`SET_LEVEL_ENUMERATION_TEMPLATE` lives in `src/signing/blocks.ts` (format-fanout-sentinel: one block, one home). The 6 existing `PREPARE_RECEIPT_*` templates + the 4 `DECODED_ARGS_*` templates + Plan 08-02's `CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE` are BYTE-FROZEN — this is an append-only addition.

Example rendered block (3-row fixture from Test 4):

```text
[SET-LEVEL ENUMERATION]
  scope:        0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  chain:        ethereum (chainId 1)
  fromBlock:    17000000
  toBlock:      18000000 (1000000 blocks)
  active rows:  3

  ┌─ row 1
  │  token:         0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
  │  spender:       0xE592427A0AEce92De3Edee1F18E0157C05861564
  │  spenderLabel:  Uniswap V3 SwapRouter
  │  amount:        1000000
  │  isUnlimited:   no
  │  lastSeenBlock: 18000000
  ┌─ row 2
  │  token:         0x6B175474E89094C44Da98b954EedeAC495271d0F
  │  spender:       0x111111125421cA6dc452d289314280a0F8842A65
  │  spenderLabel:  1inch Aggregation Router V6
  │  amount:        115792089237316195423570985008687907853269984665640564039457584007913129639935
  │  isUnlimited:   yes
  │  lastSeenBlock: 18100000
  ┌─ row 3
  │  token:         0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
  │  spender:       0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
  │  spenderLabel:  Uniswap V2 Router 02
  │  amount:        500000000000000000
  │  isUnlimited:   no
  │  lastSeenBlock: 17900000
[END SET-LEVEL ENUMERATION]
```

Empty enumerations render the verbatim placeholder `  (no active allowances within scan window)` inside the `{TABLE}` slot — the parser handles both shapes uniformly.

### T-LOGS-CEILING-1 PublicNode chunking warning

When `isPublicNodeFallback(chainId) === true` AND `lookbackBlocks > 10_000`, the scan iterates in `PUBLICNODE_LOG_CHUNK_BLOCKS = 10_000n` windows and the response surfaces:

- `structuredContent.chunksScanned: <N>` (100 for a 1M-block scan)
- `structuredContent.rpcDegraded: true`
- A verbatim warning appended AFTER the `[SET-LEVEL ENUMERATION]` block (separated by `\n\n` so the block stays parseable in isolation):

```text
⚠ Look-back scan on PublicNode RPC chunked into 100 × 10k-block windows (100 RPC calls). For faster scans set RPC_PROVIDER + RPC_API_KEY (Alchemy 50k chunks; Infura 10k; self-hosted unlimited).
```

Test 8 in `test/get-token-allowances.test.ts` is the T-LOGS-CEILING-1 anchor — asserts (a) `_logs.scanApprovalEvents` called with `useChunking === true`; (b) `chunksScanned === 100`; (c) `rpcDegraded === true`; (d) warning text present.

### `register-all.ts` insertion carve

The 2 new imports land AFTER `./check_contract_security.js` (line 5) and BEFORE `./get_transaction_status.js` (line 6) per PATTERNS.md § 3 line 432-443 verbatim carve:

```typescript
import "./check_contract_security.js";
import "./resolve_token.js";              // NEW Plan 08-04
import "./get_token_allowances.js";       // NEW Plan 08-04
import "./get_transaction_status.js";
```

Non-conflicting with Plan 08-05 — that plan modifies the EXISTING `./set_active_account.js` line at `:26` (no new import); trivial-rebase only.

## FROZEN-Area Assertion

`git diff origin/main -- src/signing/payload-fingerprint.ts src/signing/presign-hash.ts src/signing/handle-store.ts src/tools/send_transaction.ts` returns EMPTY (verified post-commit). The cryptographic-binding chain is untouched — Plan 08-04 ships pure read tools + curated data + additive blocks template.

`git diff origin/main -- src/signing/blocks.ts` shows ONLY the additive `SET_LEVEL_ENUMERATION_TEMPLATE` append (47 lines). The 6 existing `PREPARE_RECEIPT_*` templates + 4 `DECODED_ARGS_*` templates + Plan 08-02's `CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE` are byte-identical.

`APPROVAL_EVENT_TOPIC` single-SOT verified: `grep -rc "0x8c5be1e5...c3b925" src/tools/ src/chains/ src/signing/ src/protocols/` returns exactly 1 (in `src/tools/get_token_allowances.ts`).

## Test Trajectory

**Before:** 721 tests across 69 files.
**After:** 767 tests across 72 files (`+46` new).

Breakdown of new tests:
- `test/bridged-variants.test.ts` — 17 cases (table coverage anchor + curated-table integrity / T-BRIDGED-TABLE-SCAM-1 anchor + variant↔originChain semantic invariant + case-insensitivity + variantSymbol match + spy round-trip).
- `test/resolve-token.test.ts` — 12 cases (T-USDC-USDC.E anchor / verbatim variantNote text + chain-omitted all-chains + INVALID_INPUT + JSON-schema enum gate + register-all wiring + canonical ChainName field).
- `test/get-token-allowances.test.ts` — 17 cases (schema gates + happy path 3-row + READ-44 byte-level fixture / T-SET-LEVEL-BLOCK-DRIFT-1 anchor + isUnlimited MAX_UINT256 + spenderLabel resolution + APPROVAL_EVENT_TOPIC keccak self-check + T-LOGS-CEILING-1 chunking + custom lookbackBlocks + full-history scan + getBlockNumber RPC failure + empty results + ESM spy round-trip).

The plan-checker FLAG'd the estimated `+35-50` range as "actual likely ~30 (FLAG'd lower)"; actual delivery is `+46` — comfortably in the planned range. Typecheck + build + full suite green.

## Threat Mitigations Verified

- **T-USDC-USDC.E (HIGH)** — `test/resolve-token.test.ts` Test 1 (returns 2 rows for `{ symbol: "USDC", chain: "polygon" }`) + Test 6 (verbatim variantNote text from research § Topic 6 line 538-546).
- **T-LOGS-MISS (MEDIUM)** — `test/get-token-allowances.test.ts` Tests 8 + 9 + 10 (lookbackBlocks + fromBlock + toBlock surface explicitly; user sees scan window verbatim and can override).
- **T-LOGS-CEILING-1 (HIGH)** — `test/get-token-allowances.test.ts` Test 8 (PublicNode + 1M lookback → chunksScanned: 100 + rpcDegraded: true + warning text).
- **T-SET-LEVEL-BLOCK-DRIFT-1 (HIGH)** — `test/get-token-allowances.test.ts` Test 4 byte-level fixture (drift in `SET_LEVEL_ENUMERATION_TEMPLATE` or substitution logic fails the literal at PR-review time).
- **T-BRIDGED-TABLE-SCAM-1 (MEDIUM)** — `test/bridged-variants.test.ts` Test 5 (curated-table-integrity assertions; every row has non-empty variantNote + EIP-55 round-trip + valid ChainId).
- **T-PERMIT2-UNCOVERED-1 (LOW, accepted)** — documented in tool description: "Off-chain Permit2 / EIP-2612 typed-data signatures are NOT covered (v3.x scope per ROADMAP)."
- **T-FROZEN-SIGNING-1 (HIGH, STOP-THE-LINE)** — zero-diff assertion on the 4 frozen files (verified post-commit).

## Deviations from Plan

None. The plan executed atomically — single Wave 3 task → single implementation commit → SUMMARY commit. No deviation rules fired; no auto-fix attempts beyond the single design choice noted below.

### Design choice noted in decisions (not a deviation)

The `{TABLE}` slot landed as a per-row line-stable shape (`  ┌─ row N` + 6 `  │  <field>: <value>` lines) rather than the plan-prescribed Unicode-box-drawing columnar table. Rationale: fitting `address(42) + spenderLabel(~30) + uint256-decimal-amount(up to 78)` into 44/26-char columns truncates load-bearing data. The v1.3 preflight parser needs full addresses + full uint256 amounts intact — the chosen line-stable shape keeps the parser shape simple (split on `: `, strip leading whitespace) and never truncates. The block opens with `[SET-LEVEL ENUMERATION]` and closes with `[END SET-LEVEL ENUMERATION]` exactly as the plan specified; only the inner `{TABLE}` body shape differs.

## Hooks for 08-05

- **`register-all.ts`** — Plan 08-04 inserted 2 lines at the line 5-6 carve. Plan 08-05 modifies the EXISTING line at `:26` (`./set_active_account.js`); no new import; no same-line conflict.
- **WC multi-chain `accountsByChain`** — when Plan 08-05 widens `LedgerStatus.accountsByChain: Record<number, Address[]>`, the per-chain allowance-enumeration flow in this plan composes naturally: the agent reads `accountsByChain[chainId]` to drive `get_token_allowances({ wallet, chain })` per (chain, wallet) pair.
- **v1.3 vaultpilot-preflight skill** — the `[SET-LEVEL ENUMERATION]` block shape shipped here is the SOT. The skill will read the block from `content[0].text` of `get_token_allowances` responses, split on `: ` for each `  │  <field>: <value>` line, and assemble the outer-dispatch allowlist. Future plans MUST extend the block additively (verbose footers, never breaking changes to existing field shapes).
- **Per-chain known-spender tables (v1.3)** — non-Ethereum spenders currently label as `(unknown spender — no prior interaction recorded)`. v1.3 widens `lookupSpender` to per-chain tables; the `get_token_allowances` substitution site is the only consumer in this plan (single change in v1.3).

## Accepted Residuals

- **`lookbackBlocks: 1_000_000` default coverage gap** — covers ~140 days Ethereum / ~30 days L2s. Allowances older than the window are missed; the response surfaces the scan window verbatim (`fromBlock` / `toBlock` / `lookbackBlocks`) so the user can opt into deeper scans via `lookbackBlocks: 0` (full history; requires paid RPC).
- **`spenderLabel: "(unknown spender — no prior interaction recorded)"` for non-Ethereum chains in v1.2** — per Plan 08-01 lock (research § line 1131). The spender address still surfaces verbatim in the row; the user can decode via Etherscan / Arbiscan / Optimistic Etherscan / Basescan / Polygonscan. v1.3 widens to per-chain known-spender tables.
- **No tool-side caching of allowance enumeration results** — tool description routes the agent to "Call ONCE per chain per session — caching is the agent's responsibility; the MCP server does NOT cache (no per-session state at this layer)." An aggressive agent calling repeatedly across chains could burn through paid-RPC quota; the agent's discipline is the mitigation.
- **PublicNode 10k-block ceiling assumption** — assumed across all 5 chains. The chunking strategy handles the ceiling; the warning text names the cost (100 RPC calls for a 1M-block scan). v1.3+ may discover chain-specific ceiling differences; the constant is a single literal that can be tuned.
- **Long-tail symbol coverage in `resolve_token`** — 23 unique symbols × 5 chains covers the stablecoin + wrapped-asset + governance + LST + DEX-governance set. Long-tail tokens (newer launches, niche assets) fall through to INVALID_INPUT with the supported-set named in the cause; user supplies the address directly via `get_token_metadata({ address, chain })`. Future v1.3+ may extend opportunistically based on real usage.

## Self-Check: PASSED

- `src/tokens/bridged-variants.ts` exists (73 rows; 23 unique canonical symbols; lookupBridgedVariant + _bridgedVariants exported)
- `src/tools/resolve_token.ts` exists (registers `resolve_token`; consumes lookupBridgedVariant)
- `src/tools/get_token_allowances.ts` exists (registers `get_token_allowances`; APPROVAL_EVENT_TOPIC + SET_LEVEL_ENUMERATION_TEMPLATE consumed; _logs spy-affordance exported)
- `src/signing/blocks.ts` modified (SET_LEVEL_ENUMERATION_TEMPLATE additive append; existing templates byte-frozen verified via git diff)
- `src/tools/register-all.ts` modified (+2 import lines at the line 5-6 carve)
- 3 new test files exist (17 + 12 + 17 = 46 cases)
- FROZEN-area zero-diff verified
- APPROVAL_EVENT_TOPIC single-SOT verified (grep returns 1)
- Test suite: 721 → 767 green
- Typecheck + build clean
- Implementation commit landed: `3743f61` on branch `feat/08-04-resolve-token-and-allowances`
