# Phase 8: Multi-EVM fan-out + token tooling — Pattern Map

**Mapped:** 2026-05-16
**Phase scope:** READ-40, READ-41, READ-42, READ-43, READ-44, PREP-40, PREP-41, INST-40, plus Plan 08-05 WC multi-chain
**Files in scope:** 2 new src files + 4 new JSON registries + 2 new tools + ~14 modified src files + 7-ish new test files + ~10 extended tests
**Analogs found:** every new file has an exact-shape analog already in tree; every modified file is a self-extension (widening type-union, adding `chain` arg, fan-out via `Promise.allSettled`) — NO greenfield item

## Executive Summary — phase shape is STRUCTURAL EXTENSION, not mechanical clone

Phase 6 and Phase 7 were "mechanical-clone of `prepare_*`": a new tool was a near-byte-identical sibling of an existing one with a bounded diff (encoder + `tx.to` + RECEIPT template). Phase 8 is **structurally different in carve shape**: most plans modify MANY files with a SMALL diff per file. The dominant primitives:

- **Zod / JSON-schema enum widening** (`chain: enum ["ethereum","arbitrum","polygon","base","optimism"]`) — applied uniformly across ~13 tools.
- **`ChainId` literal-union widening** (`1` → `1 | 42161 | 137 | 8453 | 10`) — the TypeScript compiler error at every consumer is the carve-anchor for Plan 08-02.
- **`getEthereumClient()` → `getChainClient(chain)`** — sed-shape replacement across every read tool.
- **WC namespace widening** — `["eip155:1"]` becomes `eip155Chains` computed from configured-chains; two surgical edits at `session-manager.ts:67` and `:626-632` (the multi-chain refusal).
- **Cross-chain fan-out** (`Promise.allSettled`) only in ONE place: `get_portfolio_summary`. New tools (`resolve_token`, `get_token_allowances`) reuse the existing single-chain shapes via the new `getChainClient(chain)` primitive.

Implications for executor coordination:
- **Many touched files per plan, small diff each.** A plan-checker grep against `getEthereumClient(\|getAaveV3PoolAddress(1\|getWethAddress(1\|chainId: 1` post-Plan-08-02 is the regression anchor (Phase 6 retro line 150 already named this widening).
- **No new `prepare_*` mechanical clones this phase.** Existing 7 `prepare_*` tools all gain a `chain` arg (PREP-41); the `prepare_aave_supply / withdraw` 2-tool diff sits squarely in the existing Phase 7 shape.
- **FROZEN-area discipline holds end-to-end.** RESEARCH § Topic 9 + § Topic 10 together prove the cryptographic-binding chain is `chain`-independent — the preimage `chainId` slot is already a 32-byte big-endian integer accepting any value; widening the literal-union is a TYPE-level change, not a wire-level change.

## 1. File-to-Analog Mapping

### New files

| New File | Role | Data Flow | Closest Analog | Match Quality | Bounded Diffs |
|---|---|---|---|---|---|
| `src/chains/registry.ts` (Plan 08-01) | chain / config-resolution | request-response (memoized factory) | `src/chains/ethereum.ts:9-44` (`getEthereumClient` singleton) | exact — widens singleton to a `Record<ChainId, PublicClient>` | Lazy-init per chain; per-chain `isPublicNodeFallback(chainId)`; `_resetChainRegistryForTesting` mirrors the existing reset helper |
| `src/tokens/bridged-variants.ts` (Plan 08-04) | tokens / config (curated table) | constants | `src/config/contracts.ts:151-207` (`KNOWN_SPENDERS_ETHEREUM` curated array) | exact — same shape: typed `BridgedVariant` interface + `readonly BridgedVariant[]` + `lookupBridgedVariant(symbol)` getter + `_resetForTesting`-style export | Per-row `{ canonicalSymbol, address, chainId, source }`; ~15 rows × 5 chains; `getAddress`-checksummed at literal site |
| `src/tokens/arbitrum-top-50.json`, `polygon-top-50.json`, `base-top-50.json`, `optimism-top-50.json` (Plan 08-03) | tokens / config (curated registry) | static data | `src/tokens/ethereum-top-50.json` | exact | Per-chain top-50 ERC-20s in identical schema; loaded via the `loadTokenRegistry(chainId)` dispatcher |
| `src/tools/resolve_token.ts` (Plan 08-04 — READ-42) | tool (read) | request-response | `src/tools/get_token_metadata.ts` (registry-cache-first read tool with chain-enum schema) | exact role | Input `{ symbol, chain? }`; output rows from `bridged-variants.ts`; `chain` omitted → return all 5 entries (mirror of `get_portfolio_summary`'s "omit → all-chains" pattern from Topic 4) |
| `src/tools/get_token_allowances.ts` (Plan 08-04 — READ-43 + READ-44) | tool (read) | request-response + event-log scan + multicall cross-check | `src/chains/erc20-scanner.ts:39-65` (`scanErc20Balances` multicall pattern) for the cross-check leg + RESEARCH § Topic 7 sketch for the event-scan leg | role-match + greenfield event-scan layer | Two-step: (1) `client.getLogs({ event: Approval, args: { owner: wallet }, fromBlock, toBlock })` with 10k-block chunking on PublicNode; (2) per-(token,spender) `allowance()` cross-check via `client.multicall` to filter zero rows; emits the verbatim `[SET-LEVEL ENUMERATION]` block from RESEARCH § Topic 7 (V1.3 Inv #14 SOT) |

### Modified (existing) files

| Modified File | Role | Data Flow | Self-Extension Shape | Bounded Diffs |
|---|---|---|---|---|
| `src/config/contracts.ts` (Plan 08-01) | SOT extension | static data | Widen `ChainId` literal-union; populate 4 new `Record<ChainId, ContractsForChain>` entries; add `ChainName` type + `chainIdFromName` / `chainNameFromId` helpers | `ChainId = 1` → `1 \| 42161 \| 137 \| 8453 \| 10`; the existing `CONTRACTS_RAW`, `getWethAddress`, `getAaveV3PoolAddress`, `getAaveV3UiPoolDataProvider` byte-frozen at the function-signature level (callsites widen) |
| `src/config/env.ts` (Plan 08-01) | config | environment resolution | Add 4 per-chain RPC-URL readers (`getArbitrumRpcUrl`, `getPolygonRpcUrl`, `getBaseRpcUrl`, `getOptimismRpcUrl`); existing `getEthereumRpcUrl` + `getRpcProvider` + `getRpcApiKey` byte-frozen | RESEARCH § Topic 2 lock: provider-shorthand templates compile down to URLs; explicit per-chain overrides take precedence; PublicNode fallback per chain |
| `src/chains/ethereum.ts` (Plan 08-01) | chain | factory shim | **One-wave compat shim**: re-exports `getEthereumClient = () => getChainClient(1)`. Plan 08-02 **deletes the file** after all callers migrate to `getChainClient(chain)` | RESEARCH § Topic 1 sketch; the file's `isPublicNodeFallback` signature also widens from `(): boolean` to `(chainId: ChainId): boolean` — the load-bearing breakage that Plan 08-02 fans out |
| `src/chains/aave-v3.ts` (Plan 08-01) | chain | helper | Signature already takes `chainId: ChainId`; **literal-union widening only — NO signature change** | `getReservesData(client, chainId)` and `getUserReservesData(client, chainId, user)` already chain-typed (Phase 7 forward-compat — see `src/chains/aave-v3.ts:100,124,148`) |
| `src/chains/erc20-scanner.ts` (Plan 08-02) | chain | scanner | Accept `chainId` arg; thread to `getChainClient(chainId)` + `loadTokenRegistry(chainId)` | Replace `getEthereumClient()` at `src/chains/erc20-scanner.ts:46` with `getChainClient(chainId)`; replace `loadEthereumTokenRegistry()` at `:43` with `loadTokenRegistry(chainId)` |
| `src/tokens/registry.ts` (Plan 08-02) | tokens | config | Add `loadTokenRegistry(chainId): Token[]` — per-chain dispatch over 5 JSON files; deprecate `loadEthereumTokenRegistry` to a one-wave shim `() => loadTokenRegistry(1)` | Existing `Token` validator + checksummed-on-load discipline byte-frozen; only the dispatch layer widens |
| `src/pricing/defillama.ts` (Plan 08-02) | pricing | external API | `getPrices(coins: Array<{chain: ChainName, address: Address}>)` — per-chain CAIP-2-keyed lookups | Existing single-chain `getPrices(addresses)` becomes a thin wrapper; DefiLlama's API keys URLs by `coins=<chain>:<address>,<chain>:<address>` already |
| `src/wallet/session-manager.ts` (Plan 08-05) | wallet | session | Drive `REQUIRED_NAMESPACES.eip155.chains` from configured chains; widen `sessionToStatus` to allow multi-chain `accounts[]`; add `accountsByChain` + `activeChainId` + `partiallyPaired` to `LedgerStatus` | Two surgical edits (lines 67 + 626-632); see § Modification Touchpoints below for the exact diff shape |
| `src/tools/get_portfolio_summary.ts` (Plan 08-03 — READ-41) | tool (read) | cross-chain fan-out | `chain` arg optional; omitted → `Promise.allSettled` fan-out across 5 chains; per-chain `chainErrors[]` | Wraps the existing single-chain body in a per-chain helper, calls 5× via allSettled; result-shape gains `chains: PortfolioByChain[]` + `chainErrors: ChainError[]`; the single-chain branch path stays byte-identical |
| `src/tools/get_token_balance.ts`, `get_transaction_status.ts`, `get_token_metadata.ts`, `get_lending_positions.ts`, `simulate_position_change.ts`, `check_contract_security.ts` (Plan 08-02 — READ-40) | tool (read) | request-response | Accept `chain` arg (required, enum-gated); thread to `getChainClient(chain)` | Bounded 6-line diff per tool — see § Pattern Assignments below |
| `src/tools/prepare_native_send.ts`, `prepare_token_send.ts`, `prepare_token_approve.ts`, `prepare_revoke_approval.ts`, `prepare_weth_unwrap.ts`, `prepare_aave_supply.ts`, `prepare_aave_withdraw.ts` (Plan 08-02 — PREP-40 + PREP-41) | tool (prepare) | request-response | Accept `chain` arg (required); thread to `record.tx.chainId`; widen PREPARE RECEIPT with `{CHAIN}` slot | RESEARCH § Topic 4 sketch — 7 bounded edits, ~7 lines each |
| `src/tools/preview_send.ts` (Plan 08-02 — Topic 3 Layer 2) | tool (preview) | trust pipeline | Optional `chain` arg; if present, assert `chainIdFromName(chain) === record.tx.chainId`; refuse with `CHAIN_ID_MISMATCH` envelope | Additive check BEFORE the three existing gates (lookup → state-machine → fingerprint-drift); the gates themselves are byte-identical |
| `src/tools/send_transaction.ts` (Plan 08-02 — Topic 3 Layer 2) | tool (send) | trust pipeline | Same chain-name MISMATCH refusal as preview_send | RESEARCH § Topic 10 line 894; **the three send-time gates remain byte-frozen** — the new check fires BEFORE the gates |
| `src/tools/set_active_account.ts` (Plan 08-05) | tool | wallet | Optional `chain` arg for cross-chain scope | Mirror `setActiveAccount(address, chainId?)` semantics; verify `address` is in `session.namespaces.eip155.accounts` for that chain |
| `src/tools/get_vaultpilot_config_status.ts` (Plan 08-01) | tool | diagnostic | Surface `rpcProvider` + per-chain `customRpcConfigured` + `configuredChains` (5 booleans) | Additive structuredContent fields; existing diagnostic surface byte-frozen |
| `src/signing/blocks.ts` (Plan 08-02) | format SOT | static templates | Widen every existing `PREPARE_RECEIPT_TEMPLATE` with `{CHAIN}` slot; add `CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE` | Append-only widening (uniform `{CHAIN}` slot across 6 templates); no existing template body deleted |
| `src/signing/error-codes.ts` (Plan 08-02) | format SOT | union extension | Add `CHAIN_ID_MISMATCH` to the locked 15-code union (→ 16 codes) | Plan-checker dimension: RESEARCH § Topic 9 line 883 weighs this as load-bearing; surface refusal at preview + send |
| `src/tools/register-all.ts` (Plan 08-04) | bootstrap | side-effect imports | +2 import lines (`resolve_token`, `get_token_allowances`) | Sequential-by-plan-wave carve (see § 3 below) |

### NOT TOUCHED (FROZEN — zero-diff expected, asserted by test)

| File | Asserted By |
|---|---|
| `src/signing/payload-fingerprint.ts` | Fixture J chain-distinctness property test (`test/signing-fingerprint.test.ts` extension — NOT a literal pin, see § 4 below) + existing Fixtures A-H byte-identity holds |
| `src/signing/presign-hash.ts` | Existing Fixture C (`test/signing-presign-hash.test.ts:7-16`) byte-identity holds; viem.serializeTransaction's EIP-1559 RLP already chain-aware |
| `src/signing/handle-store.ts` state machine | `record.tx.chainId` field already exists; state machine `prepared → previewed → sent \| cancelled` byte-frozen |
| `src/tools/send_transaction.ts` THREE-GATE logic | Schema gate + state-machine gate + payloadFingerprint-drift gate byte-identical (the new chain-mismatch check fires BEFORE the three gates as defense-in-depth — Layer 2 of RESEARCH § Topic 10) |
| `src/signing/simulation.ts` | `runPreviewSimulation({ client, sender, tx })` already takes the configured client (Phase 6 DF-1 lock); plan should verify it switches per-chain by passing `getChainClient(record.tx.chainId)` from `preview_send.ts` |

## 2. Pattern Assignments — Concrete Code to Copy

### `src/chains/registry.ts` (Plan 08-01) — analog: `src/chains/ethereum.ts:9-44`

**Imports + memoization pattern** (copy and widen):
```typescript
// Phase 8 — Plan 08-01. Per-chain memoized client registry. Mirror of the
// Phase 2 `src/chains/ethereum.ts` singleton shape, widened to a per-chain
// Record keyed by ChainId.

import { createPublicClient, http, type PublicClient } from "viem";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";

import {
  getArbitrumRpcUrl, getBaseRpcUrl, getEthereumRpcUrl,
  getOptimismRpcUrl, getPolygonRpcUrl,
} from "../config/env.js";
import type { ChainId } from "../config/contracts.js";
import { log } from "../diagnostics/logger.js";

const PUBLICNODE_RPC_URLS: Record<ChainId, string> = { /* 5 URLs */ };
const VIEM_CHAINS: Record<ChainId, typeof mainnet> = {
  1: mainnet, 42161: arbitrum, 137: polygon, 8453: base, 10: optimism,
};

const cachedClients = new Map<ChainId, PublicClient>();
const cachedUsedFallback = new Map<ChainId, boolean>();

export function getChainClient(chainId: ChainId): PublicClient { /* mirror ethereum.ts:13-33 */ }
export function isPublicNodeFallback(chainId: ChainId): boolean { /* mirror ethereum.ts:35-38 */ }
export function _resetChainRegistryForTesting(): void { /* mirror ethereum.ts:40-44 */ }
```
Mirror of `src/chains/ethereum.ts:9-44` verbatim — every existing primitive widens from `cachedClient: PublicClient | undefined` to `cachedClients: Map<ChainId, PublicClient>`. The `warnedFallback` per-chain state mirrors the existing `cachedUsedFallback` discipline at `src/chains/ethereum.ts:18-26`.

---

### `src/tools/get_portfolio_summary.ts` widening (Plan 08-03 — READ-41) — self-extension

**Current single-chain shape** (`src/tools/get_portfolio_summary.ts:109-125`):
```typescript
try {
  [nativeBalanceRaw, erc20Balances] = await Promise.all([
    client.getBalance({ address: wallet }),
    scanErc20Balances(wallet),
  ]);
} catch (err) { /* ... */ }
```

**Phase 8 widening** — wrap the existing body in a per-chain helper, fan out via `Promise.allSettled`:
```typescript
async function getPortfolioForChain(chainId: ChainId, wallet: Address): Promise<PortfolioSummaryResult> {
  const client = getChainClient(chainId);
  const [nativeBalanceRaw, erc20Balances] = await Promise.all([
    client.getBalance({ address: wallet }),
    scanErc20Balances(wallet, chainId),  // erc20-scanner.ts now takes chainId
  ]);
  // ... existing single-chain body ...
}

// Top-level fan-out (when chain omitted):
const chainResults = await Promise.allSettled(
  CONFIGURED_CHAINS.map((id) => getPortfolioForChain(id, wallet)),
);
const chains: PortfolioSummaryResult[] = [];
const chainErrors: Array<{ chain: ChainName; error: string }> = [];
for (let i = 0; i < CONFIGURED_CHAINS.length; i++) {
  const r = chainResults[i]!;
  if (r.status === "fulfilled") chains.push(r.value);
  else chainErrors.push({ chain: chainNameFromId(CONFIGURED_CHAINS[i]!), error: String(r.reason) });
}
```
RESEARCH § Topic 5 lock. `Promise.allSettled` so one chain's RPC flake doesn't drop the other 4 (the catch-block at `:114-125` is preserved per-chain inside `getPortfolioForChain`).

---

### `src/tools/resolve_token.ts` (Plan 08-04 — READ-42) — analog: `src/tools/get_token_metadata.ts`

**Tool wrapper shape** — copy `get_token_metadata.ts:25-58` (DESCRIPTION + INPUT_SCHEMA shape):
```typescript
const DESCRIPTION = [
  "Resolve an ERC-20 symbol (e.g. \"USDC\", \"WETH\") to its canonical contract address(es) across supported chains.",
  "Call BEFORE prepare_token_send / prepare_token_approve when the user names a token by symbol — bridged variants (USDC vs USDC.e) disambiguate via the curated table.",
  "Returns rows of `{ symbol, chain, address, source }`; omitting `chain` returns ALL chains' rows for the symbol.",
  "Failure modes: INVALID_INPUT for an unrecognized symbol, INVALID_INPUT for an unsupported chain name.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    symbol: { type: "string", description: "ERC-20 symbol; case-insensitive." },
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description: "Omit to return rows for ALL chains.",
    },
  },
  required: ["symbol"],
  additionalProperties: false,
};
```

Body: load `bridged-variants.ts` curated table, filter by `symbol.toLowerCase()`, optionally narrow by `chain`. NO RPC call needed — the table IS the SOT. Mirror of `get_token_metadata.ts:99-117` registry-cache-first shape (but no live-RPC fallback; uncovered symbols return `INVALID_INPUT` with the canonical list).

---

### `src/tools/get_token_allowances.ts` (Plan 08-04 — READ-43 + READ-44) — analog: `src/chains/erc20-scanner.ts:39-65` (multicall) + RESEARCH § Topic 7 (event-scan)

**Event-scan + multicall cross-check pattern** (RESEARCH § Topic 7 lines 590-658 verbatim sketch):
```typescript
const APPROVAL_EVENT_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925" as Hex;
const DEFAULT_LOOKBACK_BLOCKS = 1_000_000n;
const PUBLICNODE_LOG_CHUNK_BLOCKS = 10_000n;  // RESEARCH § Topic 7 line 697

async function scanApprovalEvents(client, wallet, lookbackBlocks) {
  // Chunked getLogs when on PublicNode fallback; single call otherwise.
  // Mirror erc20-scanner.ts:46-65 for the client.* call style.
  const logs = await client.getLogs({
    event: parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)"),
    args: { owner: wallet },
    fromBlock, toBlock,
  });
  // ... dedupe via Map<`${token}:${spender}`> ...
}

async function filterActiveAllowances(client, wallet, candidates) {
  // Mirror erc20-scanner.ts:46-65 multicall shape — allowFailure:true; per-row error preserved.
  const calls = candidates.map((c) => ({
    address: c.token,
    abi: parseAbi(["function allowance(address owner, address spender) view returns (uint256)"]),
    functionName: "allowance" as const,
    args: [wallet, c.spender] as const,
  }));
  const results = await client.multicall({ contracts: calls, allowFailure: true });
  // Filter zero-allowance rows; map MAX_UINT256 → isUnlimited: true
}
```

**ESM spy-affordance** (CLAUDE.md Conventions): the event-scan + multicall surface is internal to the tool; if other tools later consume `scanApprovalEvents`, wrap in `_logs = { scanApprovalEvents, filterActiveAllowances }` so tests can `vi.spyOn(_logs, ...)`. **Plan-checker dimension**: pattern-mapper recommends ship the indirection now (per CLAUDE.md "Add at write time, not retroactively"); v1.3's `vaultpilot-preflight` skill may consume the helper.

**`[SET-LEVEL ENUMERATION]` block emission** — VERBATIM shape from RESEARCH § Topic 7 lines 664-678 (load-bearing for v1.3 Inv #14). Lives in `src/signing/blocks.ts` per format-fanout discipline (NOT inlined in the tool); template name suggestion `SET_LEVEL_ENUMERATION_TEMPLATE`. Test asserts byte-identical block shape (`test/get-token-allowances.test.ts -t "set-level enumeration"`).

---

### Chain-param-threading bounded diff (PLAN 08-02, applied to 6 reads + 7 prepares)

**Generic 6-line diff per tool** (RESEARCH § Topic 4 lines 352-362). Applied across `get_token_balance`, `get_transaction_status`, `get_token_metadata`, `get_lending_positions`, `simulate_position_change`, `check_contract_security`, all 7 `prepare_*` tools:

```typescript
// 1. Input schema: add `chain` to properties + required[]
chain: {
  type: "string",
  enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
  description: "Chain identifier.",
},
// 2. Tool body: const chainId = chainIdFromName(args.chain as ChainName);
// 3. Replace getEthereumClient() with getChainClient(chainId)
// 4. Replace getAaveV3PoolAddress(1) with getAaveV3PoolAddress(chainId)
// 5. Replace `chainId: 1` literal with chainId from arg
// 6. PREPARE RECEIPT template: add `{CHAIN}` slot substitution
// 7. structuredContent: `chainId: <chainId>` instead of `chainId: 1`
```

**Canonical insertion sites** (per existing analog):

- `get_token_metadata.ts:33-51` — INPUT_SCHEMA already declares `chain: { enum: ["ethereum"] }` (Phase 6 Plan 06-01 foresight); Plan 08-02 widens the enum to the canonical 5.
- `prepare_native_send.ts:98-115` — INPUT_SCHEMA adds the `chain` property; the `chainId: 1` hard-code at `:240` reads from the arg; the receipt template at `:273-275` adds `.replace("{CHAIN}", args.chain)`.
- `get_token_metadata.ts:62-76` — current refusal text on non-ethereum chain becomes the canonical "Supported: ethereum, arbitrum, polygon, base, optimism." (Phase 6 already shipped the structured refusal envelope verbatim).

---

### Chain-mismatch refusal at preview + send (Plan 08-02 — Topic 3 Layer 2)

**`preview_send.ts` extension** — the additive check fires AT THE TOP of the handler, BEFORE the existing handle lookup at `:129`:
```typescript
// Phase 8 — Plan 08-02. Defense-in-depth chain-name MISMATCH refusal (Topic 3
// Layer 2). The cryptographic-binding chain (Layer 3) catches mutations of
// record.tx.chainId between prepare and send; this Layer 2 check catches an
// inconsistent agent-supplied `chain` arg BEFORE the device hash mismatch
// would catch it silently.
if (typeof args.chain === "string") {
  const claimedChainId = chainIdFromName(args.chain as ChainName);
  if (claimedChainId !== record.tx.chainId) {
    return {
      isError: true,
      content: [{ type: "text", text: `error: chain mismatch — preview requested for "${args.chain}" but handle prepared for chainId ${record.tx.chainId}` }],
      structuredContent: errEnvelope("CHAIN_ID_MISMATCH", `preview chain="${args.chain}" but handle prepared for chainId=${record.tx.chainId}`),
    };
  }
}
```

**`send_transaction.ts` extension** — same shape, same position (BEFORE the three gates at the top of the handler). Test fixture: `test/preview-send.chain-mismatch.test.ts` + `test/send-transaction.chain-mismatch.test.ts`. RESEARCH § line 1037 names both files as Wave 0 NEW.

---

### WalletConnect multi-chain widening (Plan 08-05) — surgical edits at session-manager.ts

**Current `REQUIRED_NAMESPACES`** (`src/wallet/session-manager.ts:63-71`):
```typescript
const REQUIRED_NAMESPACES: {
  eip155: { chains: string[]; methods: string[]; events: string[] };
} = {
  eip155: {
    chains: ["eip155:1"],                            // ← Plan 08-05 widens
    methods: ["eth_sendTransaction", "personal_sign"],
    events: ["accountsChanged", "chainChanged"],
  },
};
```
Phase 8 widening — drive from configured chains (RESEARCH § Topic 8 lines 723-733):
```typescript
const configuredChainIds = getConfiguredChainIds();  // from src/config/env.ts
const eip155Chains = configuredChainIds.map((id) => `eip155:${id}`);

const REQUIRED_NAMESPACES = {
  eip155: { chains: eip155Chains, methods: [...], events: [...] },
};
```

**Current `sessionToStatus` multi-chain refusal** (`src/wallet/session-manager.ts:620-632`):
```typescript
// Parse every CAIP-10 entry and enforce a single chainId across them.
// A multi-chain session would require Phase 8's chain-registry; v1.x is
// mainnet-only and a mixed-chain session here is a sign that the
// namespace negotiation is wrong.
const parsed = caipAccounts.map((c) => parseEvmAccountId(c));
const chainId = parsed[0]!.chainId;
for (const entry of parsed) {
  if (entry.chainId !== chainId) {
    throw new Error(
      `paired session has accounts on multiple eip155 chains (${chainId} and ${entry.chainId}); v1.x is mainnet-only`,
    );
  }
}
```
**Phase 8 widening** — replace the single-chain enforcement with multi-chain accounting:
```typescript
const parsed = caipAccounts.map((c) => parseEvmAccountId(c));
const accountsByChain = new Map<ChainId, Address[]>();
for (const entry of parsed) {
  const existing = accountsByChain.get(entry.chainId as ChainId) ?? [];
  existing.push(entry.address);
  accountsByChain.set(entry.chainId as ChainId, existing);
}
// activeChainId defaults to the FIRST configured chain that's in the session
// (Plan 08-05 lock — research § Topic 8 line 717).
const activeChainId = pickActiveChainId(accountsByChain);
// partiallyPaired: true when configured chains ⊄ session.chains (Ledger Live
// may approve a subset if some chains are disabled in the user's LL config)
const partiallyPaired = configuredChainIds.some((id) => !accountsByChain.has(id));
```

**`LedgerStatus` interface widening** (`src/wallet/session-manager.ts:75-97`):
```typescript
export interface LedgerStatus {
  paired: true;
  accounts: Address[];                                    // EXISTING — flat list (active chain)
  activeAccount: Address;                                 // EXISTING
  address: Address;                                       // EXISTING (alias retained for back-compat)
  chainId: number;                                        // EXISTING (now = activeChainId)
  sessionTopicLast8: string;                              // EXISTING
  // Phase 8 — Plan 08-05 additions:
  accountsByChain: Record<number, Address[]>;             // NEW
  activeChainId: ChainId;                                 // NEW
  partiallyPaired: boolean;                               // NEW
}
```

Test fixture: `test/session-manager.multi-chain.test.ts` (RESEARCH § Topic 8 lock).

---

### `src/tokens/bridged-variants.ts` (Plan 08-04) — analog: `src/config/contracts.ts:151-207` (KNOWN_SPENDERS_ETHEREUM)

**Curated table shape** — copy `contracts.ts:138-207` structurally:
```typescript
// src/tokens/bridged-variants.ts — curated bridged-token disambiguation table.
// New occupant of src/tokens/ shelf. Mirror of KNOWN_SPENDERS_ETHEREUM shape.

import { getAddress, type Address } from "viem";
import type { ChainId } from "../config/contracts.js";

export interface BridgedVariant {
  canonicalSymbol: string;     // e.g. "USDC"
  variantSymbol: string;       // e.g. "USDC.e" on Polygon (bridged from Ethereum)
  address: Address;            // checksummed at literal site
  chainId: ChainId;
  source: string;              // citation URL
}

/**
 * ~15 commonly-disambiguated symbols × 5 chains.
 * Format-fanout-sentinel: every address `getAddress(...)`-checksummed at the
 * literal site (corrupted-snapshot guard — mirror of contracts.ts:153).
 */
export const BRIDGED_VARIANTS: readonly BridgedVariant[] = [
  {
    canonicalSymbol: "USDC",
    variantSymbol: "USDC",
    address: getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"),
    chainId: 1,
    source: "https://www.circle.com/blog/usdc-now-available-on-arbitrum",
  },
  // ... ~75 rows: USDC, USDT, WETH, WBTC, DAI × 5 chains ...
];

export function lookupBridgedVariant(symbol: string, chainId?: ChainId): BridgedVariant[] {
  const needle = symbol.toLowerCase();
  return BRIDGED_VARIANTS.filter(
    (v) =>
      (v.canonicalSymbol.toLowerCase() === needle || v.variantSymbol.toLowerCase() === needle) &&
      (chainId === undefined || v.chainId === chainId),
  );
}

// ESM spy-affordance per CLAUDE.md convention.
export const _bridgedVariants = { lookupBridgedVariant };
```

**Regression test pattern** — `test/resolve-token.test.ts` mirrors `test/config-contracts.test.ts` discipline: hardcode `lookupBridgedVariant("USDC", 1)[0].address === "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"` byte-for-byte.

## 3. Modification Touchpoints

### `src/config/contracts.ts` — Plan 08-01

**Current state** (`src/config/contracts.ts:18`):
```typescript
export type ChainId = 1; // Phase 8 widens this
```

**Phase 8 extension** — widen the literal-union + populate 4 new entries + add `ChainName` helpers:
```typescript
export type ChainId = 1 | 42161 | 137 | 8453 | 10;
export type ChainName = "ethereum" | "arbitrum" | "polygon" | "base" | "optimism";

const CHAIN_ID_BY_NAME: Record<ChainName, ChainId> = {
  ethereum: 1, arbitrum: 42161, polygon: 137, base: 8453, optimism: 10,
};
export function chainIdFromName(name: ChainName): ChainId { return CHAIN_ID_BY_NAME[name]; }
export function chainNameFromId(id: ChainId): ChainName { /* reverse lookup */ }

const CONTRACTS_RAW: Record<ChainId, ContractsForChain> = {
  1: { /* existing — byte-frozen */ },
  42161: {
    weth: getAddress("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"),  // Arbitrum WETH
    aavePool: getAddress("0x794a61358D6845594F94dc1DB02A252b5b4814aD"),  // shared across 3 chains
    // ... 5 typed Aave slots ...
  },
  // 137, 8453, 10 follow same shape
};
```

**KNOWN_SPENDERS_ETHEREUM strategy** — RESEARCH § line 1131 locks: KEEP Ethereum-only for v1.2. The Aave Pool canonical address `0x794a61358D6845594F94dc1DB02A252b5b4814aD` is shared across Arbitrum / Polygon / Optimism, so `lookupSpender` matches it on those chains regardless. v1.3 adds per-chain known-spender tables; v1.2 leaves the existing 11-entry array in place. **NO test churn** — the existing `length >= 11` regression-anchor (`test/config-contracts.test.ts:44`) holds.

---

### `src/wallet/session-manager.ts` — Plan 08-05

Two surgical edits (already detailed in § 2 above): lines 67 (`chains: ["eip155:1"]` → `eip155Chains`) and 620-632 (multi-chain refusal → multi-chain accounting). `LedgerStatus` interface widens at lines 75-97. **The pair / pairStart / pairWait flow stays byte-frozen** — multi-chain pairing is automatic once `REQUIRED_NAMESPACES.eip155.chains` reflects the configured set.

---

### `src/tools/register-all.ts` — Plan 08-04 register-all carve

**Current shape** (`src/tools/register-all.ts:1-29`) — 28 import lines, grouped roughly by category. The Phase 7 PATTERNS.md recommended an "insertion-position carve per plan" to avoid trivial same-line conflicts during parallel execution. Phase 8 carve:

- **Plan 08-04 (resolve_token + get_token_allowances)**: insert AFTER `./check_contract_security.js` (line 5), in the read-tool group:
  ```typescript
  import "./check_contract_security.js";    // line 5 (existing)
  import "./resolve_token.js";              // NEW Phase 8 Plan 08-04
  import "./get_token_allowances.js";       // NEW Phase 8 Plan 08-04
  import "./get_transaction_status.js";     // line 6 (existing)
  ```
- **Plan 08-05 widening of `set_active_account`** — modifies the existing `import "./set_active_account.js"` line at `:26` (the chain-param widening is internal to the file; the import line is byte-identical).

No same-line conflicts. RESEARCH § Topic 4 + § Plan Carve Recommendation (implicit in the Architectural Responsibility Map) align with this carve.

## 4. Reusable Primitives — Phase 8 MUST Consume, NOT Reimplement

Per CLAUDE.md "no inline contract addresses" + the FROZEN-area discipline.

| Primitive | Source | Phase 8 caller(s) | Notes |
|---|---|---|---|
| `computePayloadFingerprint({ chainId, to, valueWei, data })` | `src/signing/payload-fingerprint.ts:36-49` | All 7 `prepare_*` tools (unchanged callsite — chainId now reads from arg, not hard-coded `1`) | **FROZEN**. Preimage shape `tag ‖ chainId(32B) ‖ to ‖ value ‖ data` accommodates any chainId. Fixture A-H byte-identity holds; Fixture J asserts chain-distinctness (property test) |
| `computePresignHash({ chainId, nonce, ..., data })` | `src/signing/presign-hash.ts:34-57` | `preview_send.ts` (unchanged callsite) | **FROZEN**. viem.serializeTransaction's EIP-1559 RLP already chain-aware; the chainId slot flows through unmodified |
| `createHandle({ args, tx, payloadFingerprint })` | `src/signing/handle-store.ts` | All 7 `prepare_*` tools | **FROZEN** state machine. `PrepareArgs` may widen with optional `chain?: string` field (additive — Phase 6 06-02 precedent for optional widening) |
| `getChainClient(chainId)` | `src/chains/registry.ts` — NEW Plan 08-01 | All read tools + `preview_send` (for simulation client) | One-line replacement of `getEthereumClient()`. The simulation passthrough at `preview_send.ts:395-399` (`_simulation.runPreviewSimulation({ client, ... })`) widens to pass `getChainClient(record.tx.chainId)` |
| `chainIdFromName(name)` / `chainNameFromId(id)` | `src/config/contracts.ts` — NEW Plan 08-01 | Every `chain`-taking tool | The enum gate in the schema is the primary defense (mirror of `userDecision` enum-as-gate from Phase 4); the helpers are unreachable on enum violation |
| `loadTokenRegistry(chainId)` | `src/tokens/registry.ts` — Plan 08-02 widening | `erc20-scanner`, `prepare_token_send` decimals resolution, `preview_send` registry lookup, `resolve_token` | One-line replacement of `loadEthereumTokenRegistry()` |
| `getAaveV3PoolAddress(chainId)` + `getAaveV3UiPoolDataProvider(chainId)` | `src/config/contracts.ts:83,101` (existing — signature already chain-typed) | `prepare_aave_supply`, `prepare_aave_withdraw`, `get_lending_positions`, `simulate_position_change` | **Signature byte-frozen** — the literal-union widening propagates to the callsites |
| `_aaveChains.getReservesData(client, chainId)` | `src/chains/aave-v3.ts:148` (existing — signature already chain-typed) | `get_lending_positions`, `simulate_position_change` | **Signature byte-frozen** — Phase 7 forward-compat |
| `lookupBridgedVariant(symbol, chainId?)` | `src/tokens/bridged-variants.ts` — NEW Plan 08-04 | `resolve_token` only | New primitive; v1.3's `vaultpilot-preflight` skill may consume |
| `lookupSpender(spender)` | `src/config/contracts.ts:223-226` (existing) | `get_token_allowances` row labeling + `preview_send` decoded-args block (existing) | **No change for v1.2** — Ethereum-only; cross-chain rows label as `(unknown spender)` until v1.3 adds per-chain known-spender tables |
| `getStatus()` (WC) | `src/wallet/session-manager.ts:517-524` (existing) | All 7 `prepare_*` real-mode branches | **No change to the prepare-tool callsite** — `status.activeAccount` widens to a per-chain selector via Plan 08-05, but the prepare-tool reads `status.activeAccount` byte-identically |

## 5. Anti-Patterns Phase 8 MUST NOT Repeat (from Phase 1-7 retros)

1. **No inline contract addresses** (CLAUDE.md). 25 new addresses (5 chains × 5 typed slots) live in `src/config/contracts.ts` ONLY, `getAddress`-checksummed at the literal site. Regression-tested via `test/config-contracts.test.ts` extension (25 new pin assertions per RESEARCH § line 1148).
2. **No fixture-snapshot self-reference** (CLAUDE.md). Fixture J is a PROPERTY TEST (`expect(new Set(fps).size).toBe(5)`) — NOT a `beforeAll`-snapshot. The existing Fixtures A-H with hardcoded `0x...` literals remain the byte-identity anchors. RESEARCH § Topic 9 line 875 explicit lock.
3. **No mechanical-clone shape this phase** (Phase 6 retro line 141 conditional). Phase 8's diffs are STRUCTURAL EXTENSION (enum widening + chain-arg threading), not new prepare-tool clones. Same `prepare_*` files, additive 6-line diff per file. Plan-checker dimension: any same-shape new prepare tool added in Phase 8 should fail review (no such tool is in scope per RESEARCH § line 1141).
4. **ESM spy-affordance pre-emptively** (CLAUDE.md). `src/tokens/bridged-variants.ts` ships `export const _bridgedVariants = { lookupBridgedVariant };` from the first commit; `src/tools/get_token_allowances.ts` ships `_logs = { scanApprovalEvents, filterActiveAllowances }` if any callsite is internal to the module.
5. **FROZEN-area discipline in every Plan's `<success_criteria>`** (Phase 6 retro line 142, Phase 7 PATTERNS § Cryptographic-Binding Chain Delta). Each Phase 8 Plan asserts zero-diff on: `src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/signing/handle-store.ts` state machine, `src/tools/send_transaction.ts` THREE gates. RESEARCH § Topic 9 lines 879-883 explicit lock.
6. **No widening of `KNOWN_SPENDERS_ETHEREUM` to per-chain in v1.2** (RESEARCH § line 1131 lock). v1.3 task. The existing 11-entry array stays Ethereum-only; cross-chain spender labeling deferred.
7. **No silent fallback in `get_token_allowances`** (CLAUDE.md "no silent fallbacks"). PublicNode 10k-block range ceiling surfaces as an explicit `RPC_DEGRADED` advisory in the tool description AND as `rpcDegraded: true` on the result. Chunking is a STATED behavior; the tool description names the 100-chunk worst-case (RESEARCH § Topic 7 line 702).
8. **`payloadFingerprint` preimage stays byte-frozen across all 5 chains** (RESEARCH § Topic 9 + § Topic 10 Layer 3). NO new field in the preimage. The chainId slot's existing 32-byte BE encoding is the load-bearing defense; Phase 8 verifies via Fixture J property test rather than adding new fixtures.

## 6. Cryptographic-Binding Chain Delta

### What Phase 8 changes

- **`record.tx.chainId`** reads from the agent's `chain` arg via `chainIdFromName(args.chain)` instead of the hard-coded `1`. The handle-store record shape itself is unchanged — `chainId: number` already accepts any integer.
- **`PREPARE RECEIPT`** templates widen with a `{CHAIN}` slot. Uniform append across `PREPARE_RECEIPT_TEMPLATE`, `WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE`, `AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE`, etc. — 6 templates in `src/signing/blocks.ts`.
- **`structuredContent.chainId`** reads the chosen chain; **`structuredContent.chain`** (NEW) carries the canonical chain name for downstream verification.
- **`preview_send.ts` + `send_transaction.ts`** gain an additive chain-name MISMATCH refusal BEFORE the existing gates (RESEARCH § Topic 10 Layer 2).
- **`error-codes.ts`** locked union widens by ONE entry (`CHAIN_ID_MISMATCH`) — 15 → 16 codes.

### What Phase 8 does NOT touch (FROZEN — assertion in every Plan)

- `src/signing/payload-fingerprint.ts` — preimage shape `DOMAIN_TAG ‖ chainId ‖ to ‖ value ‖ data` byte-frozen. The 32-byte BE chainId slot already accepts any integer.
- `src/signing/presign-hash.ts` — `viem.serializeTransaction` (`type: "eip1559", chainId: input.chainId`) already chain-aware.
- `src/signing/handle-store.ts` — state machine `prepared → previewed → sent | cancelled` byte-frozen. `record.tx.chainId` field already exists.
- `src/tools/send_transaction.ts` — three-gate refusal logic byte-frozen. The new chain-mismatch check fires BEFORE the three gates as defense-in-depth; the gates themselves are unchanged.
- **Fixtures A-H** byte-identity holds across the persona-cycle integration tests. NO new persona-cycle fixtures this phase.

### Fixture J — chain-distinctness property test (RESEARCH § Topic 9 line 865)

Add to `test/signing-fingerprint.test.ts` (NOT a literal pin):
```typescript
it("Fixture J — chain-distinctness property (Phase 8 / Plan 08-02)", () => {
  const params = { to: ANVIL_WALLET, valueWei: 10n ** 18n, data: "0x" as Hex };
  const fps = [1, 42161, 137, 8453, 10].map((chainId) =>
    computePayloadFingerprint({ chainId, ...params }),
  );
  expect(new Set(fps).size).toBe(5);
});
```
**Why property not literal**: pinning 5 fingerprints adds no information beyond Fixture A — the existing fixture already proves chainId flows into the keccak. Fixture J proves the FUNCTION is chain-distinct, which is the actually-load-bearing claim for Phase 8. RESEARCH § lines 873-875 explicit lock.

## 7. Test Surface Notes

### New test files (RESEARCH § line 1122-1128)

| Test File | Scope | Mirrors |
|---|---|---|
| `test/chains-registry.test.ts` | Per-chain client memoization + provider-shorthand wiring + per-chain `isPublicNodeFallback` | Phase 2 `src/chains/ethereum.ts` test (does not exist as a dedicated test today — the existing `get_portfolio_summary` test exercises the singleton indirectly; new dedicated coverage warranted) |
| `test/get-portfolio-summary.cross-chain.test.ts` | `Promise.allSettled` fan-out + `chainErrors[]` surface + per-chain row aggregation | `test/get-portfolio-summary.test.ts` (mock client setup) |
| `test/resolve-token.test.ts` | Curated table coverage + symbol disambiguation + omit-chain → all-chains | `test/get-token-metadata.test.ts` (tool wrapper shape) + `test/config-contracts.test.ts` (curated-table assertions) |
| `test/get-token-allowances.test.ts` | Event scan + multicall cross-check + `[SET-LEVEL ENUMERATION]` block shape + PublicNode chunking | `test/fourbyte.test.ts` (fetch-stub pattern) + multicall mocking from `test/get-portfolio-summary.test.ts` |
| `test/preview-send.chain-mismatch.test.ts` | Layer-2 refusal at preview with `CHAIN_ID_MISMATCH` envelope | `test/preview-send.test.ts` (existing scaffolding) |
| `test/send-transaction.chain-mismatch.test.ts` | Layer-2 refusal at send (BEFORE the three gates) | `test/send-transaction.test.ts` (existing scaffolding) |
| `test/session-manager.multi-chain.test.ts` | `REQUIRED_NAMESPACES.eip155.chains` from config + `sessionToStatus` multi-chain accounting + `accountsByChain` + `partiallyPaired` flag | `test/session-manager.test.ts` (existing scaffolding) |

### Extended test files

| Test File | Extension |
|---|---|
| `test/signing-fingerprint.test.ts` | **Fixture J chain-distinctness property test** (NOT a literal pin) — `expect(new Set(fps).size).toBe(5)`. RESEARCH § Topic 9 line 865 explicit shape |
| `test/config-contracts.test.ts` | 25 new address-pin assertions (5 chains × 5 typed slots); `chainIdFromName` / `chainNameFromId` round-trip; `KNOWN_SPENDERS_ETHEREUM` length anchor unchanged at `length >= 11` |
| `test/{prepare-*,get-*}.test.ts` (~13 files) | Add `chain` arg gate cases: JSON-schema enum violation refusal + chain-name mismatch refusal at preview/send. RESEARCH § Phase Requirements → Test Map lines 1029-1037 |

### Fetch-stub mock applicability

The pattern-mapping prompt asked whether new clients land this phase. **Answer: no new HTTP-client modules.** RESEARCH § Topic 6 lock: bridged-variants is a curated static table — NO fetch boundary. The allowance event-scan uses viem's `client.getLogs` + `client.multicall` (internal RPC, mocked via mockPublicHolder / spy on `_logs.scanApprovalEvents` per the new indirection). `test/fourbyte.test.ts` and `test/clients-etherscan.test.ts` fetch-stub patterns remain the precedent for any HTTP-client work that may emerge in v1.3.

## 8. Parallelism Opportunities + Wave Structure Recommendation

The pattern-mapper validates the prompt's proposed wave structure with a refinement based on file-touch overlap analysis.

### Recommended carve order: 08-01 → 08-02 → (08-03 ∥ 08-04) → 08-05

- **Plan 08-01** — Foundation. Touches `src/chains/registry.ts` (NEW), `src/config/contracts.ts` (widen `ChainId` + populate 4 entries + `ChainName` helpers), `src/config/env.ts` (4 per-chain RPC readers), `src/tools/get_vaultpilot_config_status.ts` (surface `configuredChains`), `src/chains/ethereum.ts` (compat shim). Sequential prerequisite: every other plan depends on `ChainId` widening + `getChainClient` existence.

- **Plan 08-02** — Chain-param threading (PREP-40, PREP-41, READ-40 minus get_portfolio_summary fan-out, defense-in-depth Layer 2 at preview + send). Touches 6 read tools + 7 prepare tools + `preview_send.ts` + `send_transaction.ts` + `src/signing/blocks.ts` (6 template widenings) + `src/signing/error-codes.ts` (+1 code) + `src/chains/erc20-scanner.ts` + `src/tokens/registry.ts` (`loadTokenRegistry(chainId)`) + `src/pricing/defillama.ts` + per-tool tests (~13). Many files, small diff each. **Largest plan.** Deletes `src/chains/ethereum.ts` shim at the end.

- **Plan 08-03** — `get_portfolio_summary` cross-chain fan-out (READ-41). Touches `src/tools/get_portfolio_summary.ts` (additive cross-chain branch) + 4 new per-chain JSON registries (`arbitrum-top-50.json`, `polygon-top-50.json`, `base-top-50.json`, `optimism-top-50.json`) + `test/get-portfolio-summary.cross-chain.test.ts`. **Can run parallel to 08-04** — file-touch overlap is empty: 08-04 only touches `resolve_token.ts` + `get_token_allowances.ts` + `bridged-variants.ts` + `register-all.ts`.

- **Plan 08-04** — New tools (READ-42, READ-43, READ-44). Touches `src/tools/resolve_token.ts` (NEW) + `src/tools/get_token_allowances.ts` (NEW) + `src/tokens/bridged-variants.ts` (NEW) + `src/signing/blocks.ts` (additive `SET_LEVEL_ENUMERATION_TEMPLATE`) + `src/tools/register-all.ts` (+2 import lines) + 2 new test files. **Parallel-safe with 08-03** (only `register-all.ts` overlaps potentially; the carve in § 3 above places 08-04 inserts in the read-tool group, distant from any 08-03 line region — but **08-03 does not touch register-all.ts at all**, so the carve is conflict-free by construction).

- **Plan 08-05** — WC multi-chain (PLAN 08-05). Touches `src/wallet/session-manager.ts` (lines 67 + 620-632 surgical edits + `LedgerStatus` widening) + `src/tools/set_active_account.ts` (optional `chain` arg) + `test/session-manager.multi-chain.test.ts`. Independent of 08-02/08-03/08-04. **Could run parallel to 08-03 ∥ 08-04 if executor capacity permits**, but the global CLAUDE.md "phase resource-intensive parallel work sequentially" rule recommends 2-way parallelism cap; pattern-mapper recommends 08-05 lands AFTER (08-03 ∥ 08-04) close-out — the wallet-session changes interact with tests that depend on the `chain` arg threading (any test using `prepare_*` in real mode loads the WC session manager, so a green 08-05 wants 08-02 already merged).

### File-touch overlap matrix (load-bearing for parallelism)

| | 08-01 | 08-02 | 08-03 | 08-04 | 08-05 |
|---|---|---|---|---|---|
| 08-01 | — | depends-on | depends-on | depends-on | depends-on |
| 08-02 | | — | overlaps on `get_portfolio_summary.ts` IF 08-03 starts before 08-02 lands | none | none |
| 08-03 | | | — | **none** ✓ parallel-safe | none |
| 08-04 | | | **none** ✓ parallel-safe | — | none |
| 08-05 | | overlaps on `set_active_account.ts` widening | none | none | — |

**Conclusion**: 08-03 ∥ 08-04 is the safe parallel boundary. 08-05 lands sequentially after 08-02 to avoid the `set_active_account.ts` overlap (08-02 widens it with the `chain` arg; 08-05 adds the per-chain-scope semantics; merging both at once invites a same-file rebase).

### Resource-cost note (global CLAUDE.md rule)

Plan 08-02 is the largest plan (touches ~14 src files + ~13 test files). The TypeScript compiler is the regression anchor — `tsc` after each touched file ensures the cascade is caught early. Pattern-mapper recommends executor checkpoint after the schema-widening pass + after the chain-arg-threading pass, before moving to receipt-template widening. Three logical sub-waves within Plan 08-02:
- Sub-wave 1: `ChainName` enum + JSON-schema `chain` property on all 13 tools.
- Sub-wave 2: `getEthereumClient()` → `getChainClient(chainId)` replacement across 6 reads + 7 prepares + `preview_send` + `erc20-scanner`.
- Sub-wave 3: PREPARE RECEIPT `{CHAIN}` slot widening + `CHAIN_ID_MISMATCH` defense-in-depth at preview + send.

Each sub-wave is `tsc`-green at a clean checkpoint. RESEARCH § Topic 4 line 366 ("Pitfall: TypeScript widening cascade") locks this discipline.

## Metadata

**Analog search scope:** `src/tools/*.ts`, `src/chains/*.ts`, `src/protocols/*.ts`, `src/signing/*.ts`, `src/clients/*.ts`, `src/wallet/*.ts`, `src/config/*.ts`, `src/tokens/*.ts`, `src/pricing/*.ts`, `test/*.ts`, `.planning/phases/06-*/06-PATTERNS.md`, `.planning/phases/07-*/07-PATTERNS.md`
**Files scanned:** 18 source files (full read on 9; targeted reads on 9) + 4 test files + 2 prior PATTERNS.md + 08-RESEARCH.md (full)
**Pattern extraction date:** 2026-05-16
**No-analog items:** 0 — every Phase 8 file extends an existing pattern
**FROZEN-area assertion files:** 4 (`payload-fingerprint.ts`, `presign-hash.ts`, `handle-store.ts` state machine, `send_transaction.ts` three gates) — RESEARCH § Topic 9 lines 879-883 explicit lock; Fixture J is a property test (`new Set(fps).size === 5`), NOT a literal pin
**Wave-parallelism boundary:** 08-03 ∥ 08-04 (zero file-touch overlap)
