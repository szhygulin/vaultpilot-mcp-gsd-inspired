# Phase 8: Multi-EVM fan-out + token tooling — Research

**Researched:** 2026-05-16
**Domain:** Per-chain RPC client architecture + chain-id assertion in the trust pipeline + cross-chain `get_portfolio_summary` aggregation + bridged-token disambiguation + allowance enumeration via event-log scan + WalletConnect v2 multi-chain pairing
**Confidence:** HIGH (per-chain Aave V3 addresses cross-verified against `bgd-labs/aave-address-book` — 4 chains share the canonical proxy `0x794a61358D6845594F94dc1DB02A252b5b4814aD`; Base uses a different proxy; bridged USDC pairs verified for Polygon / Arbitrum / Optimism; chain-id flow through the cryptographic-binding chain empirically verified — preimage `tag ‖ chainId(32-byte BE) ‖ to ‖ value ‖ data` ALREADY accommodates Phase 8 with zero diff). MEDIUM on `get_token_allowances` execution path — Etherscan V2 does NOT expose a programmatic token-approvals endpoint (the website UI at `/tokenapprovalchecker` is unbacked by an API as of 2026-05); the only general-purpose path is event-log scan, which carries trade-offs documented in Topic 7.

## Summary

Phase 8 fans every existing tool out from Ethereum-only to 5 EVM chains (Ethereum / Arbitrum / Polygon / Base / Optimism), without touching the cryptographic-binding chain. The preimage `chainId` slot has been load-bearing since Phase 4 — the preimage assembly `DOMAIN_TAG ‖ chainId(32-byte BE) ‖ to ‖ value ‖ data` (`src/signing/payload-fingerprint.ts:36-49`) accepts any chain-id integer without code change. Fixtures A–H are anchored at `chainId=1` today; Phase 8 introduces a chain-id mismatch defense at preview + send (PREP-40 / PREP-41 requirements), with `payloadFingerprint` already binding chainId byte-for-byte. **Zero diff** to the FROZEN signing pipeline — no new fingerprint shapes, no `presignHash` change, no `handle-store.ts` state-machine change, no `send_transaction.ts` three-gate change.

New surface: (a) `src/chains/registry.ts` — per-chain config registry replacing the `src/chains/ethereum.ts` single-chain singleton, keyed on `ChainId` (widened from `1` to `1 | 42161 | 137 | 8453 | 10`); (b) per-chain Aave V3 SOT extension — `Record<ChainId, ContractsForChain>` grows 4 new entries; (c) `chain` parameter threading through ~13 existing tools (8 reads + 5 prepares), with the FROZEN signing pipeline reading `record.tx.chainId` unchanged; (d) `get_portfolio_summary` cross-chain aggregation via `Promise.allSettled` over per-chain reads; (e) `resolve_token` with a curated bridged-variant table (~15 commonly-disambiguated symbols across 5 chains); (f) `get_token_allowances` via ERC-20 `Approval` event-log scan with a configurable look-back window; (g) WalletConnect `requiredNamespaces.eip155.chains` driven by configured chains, replacing the hardcoded `["eip155:1"]` at `src/wallet/session-manager.ts:67`.

**Primary recommendation:**
- Replace the single `getEthereumClient()` singleton in `src/chains/ethereum.ts` with a per-chain registry `src/chains/registry.ts` — `getChainClient(chainId)` returns a memoized viem PublicClient. The existing `getEthereumClient()` becomes a thin shim `getChainClient(1)` for backward compat through one wave (Plan 08-01); after Plan 08-02 threads the `chain` param everywhere, the shim deletes.
- Widen `ChainId = 1` → `ChainId = 1 | 42161 | 137 | 8453 | 10` in `src/config/contracts.ts`. The `Record<ChainId, ContractsForChain>` shape was locked at Phase 6 Plan 06-03 specifically so Phase 8 widens cleanly without revisiting structure (Phase 6 retro line 150 — "Phase 8 widens the `ChainId` literal-union without revisiting the structure"). The TypeScript compiler error on every consumer of `ChainId` becomes the carve-anchor for Plan 08-02.
- **Chain-id assertion is defense-in-depth, NOT cryptography.** The `payloadFingerprint` already binds the prepared chainId at PREP-03 time (verified: chainId is BYTE 24-55 of the keccak preimage); the send-time re-check via `computePayloadFingerprint` (`src/tools/send_transaction.ts:295-300`) already detects a tampered chainId as `PAYLOAD_FINGERPRINT_DRIFT`. Phase 8's new layer is the **chain-name MISMATCH check at preview_send + send_transaction** — the agent claims `chain: "arbitrum"` in the user-facing args but the stored `record.tx.chainId` is `1`; the new gate refuses with `CHAIN_ID_MISMATCH` BEFORE re-emitting blocks the user might trust. This catches the case where an agent mis-states the chain in its natural-language explanation while the bytes are still byte-bound — the on-device hash would protect the user anyway, but the structured refusal surfaces the discrepancy at preview time, NOT at signing time.
- `get_portfolio_summary` cross-chain shape: when `chain` omitted, fan out via `Promise.allSettled` across the 5 chains; per-chain failures surface as a `chainErrors: Array<{chain, reason}>` field while successful chains aggregate into the `totalUsd`. Partial-result envelopes match the existing `priceUnknown` / `rpcDegraded` shape — never silently zero.
- `resolve_token` ships with a curated bridged-variant table (~15 symbols × 5 chains, hand-verified — USDC native vs USDC.e bridged on Polygon/Arbitrum/Optimism; USDbC on Base; USDT, DAI, WBTC variants where they differ). Origin-chain hints embedded per-row. NO third-party SDK; the table is `src/tokens/bridged-variants.ts` — a new occupant of the existing `src/tokens/` shelf.
- `get_token_allowances` uses event-log scan over the ERC-20 `Approval(owner, spender, value)` event topic, filtered by `topics[1] = wallet`, then current-state cross-check via `allowance(wallet, spender)` to filter revoked / spent allowances. **No archive node required** — a 1M-block look-back (~140 days on Ethereum, ~30 days on Arbitrum/Optimism, ~26 days on Polygon/Base) covers practical allowance scope; explicit `fromBlock` override for users who need deep history. Etherscan V2 does NOT expose a programmatic token-approvals endpoint (the `/tokenapprovalchecker` page is unbacked by an API as of 2026-05-16 — verified empirically against `docs.etherscan.io/etherscan-v2/api-endpoints/tokens` which lists only `tokensupply` and `tokenbalance`). Recommendation locked: event-log scan + current-state cross-check.
- WalletConnect `requiredNamespaces.eip155.chains` becomes `["eip155:1", "eip155:42161", "eip155:137", "eip155:8453", "eip155:10"]` (or the configured subset). The session's `namespaces.eip155.accounts` will then contain CAIP-10 entries per chain (`eip155:1:0x…`, `eip155:137:0x…`, …). The existing `sessionToStatus` parser in `session-manager.ts:613-646` REJECTS multi-chain sessions today (lines 626-632: "v1.x is mainnet-only"); Phase 8 widens this to accept and surface per-chain account sets.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-chain RPC client lookup | MCP server (`src/chains/registry.ts` — NEW) | viem `createPublicClient` + `viem/chains` | Per-chain memoized clients; one `createPublicClient` per (chainId, rpcUrl) tuple. The factory is module-local; consumers call `getChainClient(chainId)` and never construct clients directly. |
| Per-chain config resolution | MCP server (`src/config/env.ts` extensions) | env vars + config.json | `RPC_PROVIDER + RPC_API_KEY` shorthand (INST-40) compiles down to per-chain URLs via a `provider-shorthand-templates` table; per-chain explicit overrides (`ETHEREUM_RPC_URL`, `ARBITRUM_RPC_URL`, `POLYGON_RPC_URL`, `BASE_RPC_URL`, `OPTIMISM_RPC_URL`) take precedence; PublicNode fallback per chain. |
| Chain-id assertion at preview + send | MCP server (`src/tools/preview_send.ts` + `send_transaction.ts` — additive checks) | — | The cryptographic-binding chain ALREADY binds chainId via `payloadFingerprint`. Phase 8 adds a structured chain-NAME mismatch refusal as defense-in-depth — the new check fails LOUDLY on agent inconsistency before the device hash mismatch would catch it silently. |
| Canonical contract SOT (Aave Pool per chain) | MCP server (`src/config/contracts.ts` — widen) | bgd-labs/aave-address-book (citation) | `Record<ChainId, ContractsForChain>` widens from 1 entry to 5; per-chain getter functions stay byte-identical. Aave V3 Pool address is `0x794a61358D6845594F94dc1DB02A252b5b4814aD` on Arbitrum / Polygon / Optimism (identical canonical proxy); Base uses `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5`; Ethereum stays `0x87870Bca…`. |
| Cross-chain portfolio aggregation | MCP server (`src/tools/get_portfolio_summary.ts` extension) | per-chain RPC clients in parallel | `Promise.allSettled` fan-out; per-chain results aggregated by USD value; rejected chains surface as `chainErrors[]`. Sequential is wasteful (5 RPCs in parallel cap at the slowest chain's latency, ~1-2s typical). |
| Bridged-token disambiguation | MCP server (`src/tokens/bridged-variants.ts` — NEW) | — | Curated table; ~15 commonly-disambiguated symbols across 5 chains. NO third-party SDK (DefiLlama's `/tokens` endpoint is symbol→address but doesn't disambiguate bridged variants reliably; Circle's API doesn't expose a clean cross-chain canonical map). |
| Allowance enumeration | MCP server (`src/tools/get_token_allowances.ts` — NEW + viem `getLogs`) | viem `getLogs` + viem `multicall` | Event-log scan for `Approval` topic; per-(token,spender) `allowance()` cross-check via multicall to filter zero-current-allowance rows; `[SET-LEVEL ENUMERATION]` block emission for v1.3 Inv #14 dispatch-allowlist sourcing. |
| WalletConnect multi-chain pairing | MCP server (`src/wallet/session-manager.ts` extension) | WalletConnect v2 `requiredNamespaces` | The `eip155.chains` array drives Ledger Live's account picker per CAIP-2; multi-chain `accounts` array flows back into `LedgerStatus.accounts[]` and is consumed by `set_active_account` for cross-chain selection. |
| Ledger device behavior on multi-chain | Ledger Live + device firmware | — | Outside MCP scope. Ledger Live's account picker offers accounts only for chains enabled in Ledger Live → Manage Accounts; users on stale LL configs may see Ethereum-only even after Phase 8 ships (documented user-side prerequisite). |

## Topics

### Topic 1: Per-chain RPC client architecture (PLAN 08-01)

**Recommendation:** Replace `src/chains/ethereum.ts`'s single-chain singleton with a per-chain registry `src/chains/registry.ts`. Keep `getEthereumClient()` as a one-wave compat shim that delegates to `getChainClient(1)`; Plan 08-02 deletes the shim after threading the `chain` param everywhere.

**Shape** (closest analog: `src/chains/ethereum.ts:9-44` — the existing memoized singleton):

```typescript
// Source: src/chains/registry.ts (Plan 08-01 — sketch)
import { createPublicClient, http, type PublicClient } from "viem";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import {
  getArbitrumRpcUrl, getBaseRpcUrl, getEthereumRpcUrl,
  getOptimismRpcUrl, getPolygonRpcUrl,
} from "../config/env.js";
import type { ChainId } from "../config/contracts.js";
import { log } from "../diagnostics/logger.js";

const PUBLICNODE_RPC_URLS: Record<ChainId, string> = {
  1:     "https://ethereum-rpc.publicnode.com",
  42161: "https://arbitrum-one-rpc.publicnode.com",
  137:   "https://polygon-bor-rpc.publicnode.com",
  8453:  "https://base-rpc.publicnode.com",
  10:    "https://optimism-rpc.publicnode.com",
};

const VIEM_CHAINS: Record<ChainId, typeof mainnet> = {
  1: mainnet, 42161: arbitrum, 137: polygon, 8453: base, 10: optimism,
};

const RPC_URL_RESOLVERS: Record<ChainId, () => string | undefined> = {
  1:     getEthereumRpcUrl,
  42161: getArbitrumRpcUrl,
  137:   getPolygonRpcUrl,
  8453:  getBaseRpcUrl,
  10:    getOptimismRpcUrl,
};

const cachedClients = new Map<ChainId, PublicClient>();
const cachedFallbackByChain = new Map<ChainId, boolean>();
const warnedFallbackByChain = new Set<ChainId>();

export function getChainClient(chainId: ChainId): PublicClient {
  const cached = cachedClients.get(chainId);
  if (cached) return cached;

  const resolver = RPC_URL_RESOLVERS[chainId];
  const override = resolver();
  const providerShorthand = getProviderShorthandUrl(chainId);  // see Topic 2
  const url = override ?? providerShorthand ?? PUBLICNODE_RPC_URLS[chainId];
  const usedFallback = override === undefined && providerShorthand === undefined;
  cachedFallbackByChain.set(chainId, usedFallback);

  if (usedFallback && !warnedFallbackByChain.has(chainId)) {
    log("warn", `No RPC URL set for chain ${chainId} — using PublicNode public RPC (${PUBLICNODE_RPC_URLS[chainId]}); set the chain-specific env var or RPC_PROVIDER + RPC_API_KEY for production traffic`);
    warnedFallbackByChain.add(chainId);
  }

  const client = createPublicClient({
    chain: VIEM_CHAINS[chainId],
    transport: http(url),
  });
  cachedClients.set(chainId, client);
  return client;
}

export function isPublicNodeFallback(chainId: ChainId): boolean {
  if (!cachedClients.has(chainId)) getChainClient(chainId);
  return cachedFallbackByChain.get(chainId) ?? false;
}

export function _resetChainRegistryForTesting(): void {
  cachedClients.clear();
  cachedFallbackByChain.clear();
  warnedFallbackByChain.clear();
}
```

**`viem/chains` import paths** (verified — viem 2.48.11 already in repo per Phase 7 RESEARCH § SDK Probe; named exports from `viem/chains`):

- `mainnet` (chainId 1)
- `arbitrum` (chainId 42161)
- `polygon` (chainId 137)
- `base` (chainId 8453)
- `optimism` (chainId 10)

Each export is a `Chain` object (`{ id, name, nativeCurrency, rpcUrls, blockExplorers, contracts? }`) consumed by `createPublicClient({ chain, transport })`. [CITED: viem.sh/docs/chains/introduction]

**Backward-compat shim for Plan 08-01 wave**:
```typescript
// src/chains/ethereum.ts — one-wave shim. Deleted by Plan 08-02 after callers migrate.
import { getChainClient, isPublicNodeFallback as registryIsPublicNodeFallback } from "./registry.js";
export const PUBLICNODE_ETHEREUM_RPC_URL = "https://ethereum-rpc.publicnode.com";
export function getEthereumClient() { return getChainClient(1); }
export function isPublicNodeFallback() { return registryIsPublicNodeFallback(1); }
export function _resetEthereumClientForTesting() { /* delegate */ }
```

**Why shim, not big-bang**: Plan 08-01 lands the registry without touching the ~10 existing callers of `getEthereumClient()`. Plan 08-02 then threads `chain` through tools, replacing `getEthereumClient()` with `getChainClient(chain)` at the call site. Splitting the work this way keeps each plan's diff bounded and reviewable.

**`isPublicNodeFallback` signature change**: from `(): boolean` to `(chainId: ChainId): boolean`. This is the load-bearing breakage that Plan 08-02 fans out — `get_portfolio_summary.ts:219`, `get_lending_positions.ts`, and any other reader that surfaces `rpcDegraded`. The shim's parameterless overload at `src/chains/ethereum.ts` preserves the Phase 7 callers within one wave; Plan 08-02 widens them.

**Pitfall**: viem's `createPublicClient` requires the `chain` arg to use chain-specific features (eip-1559 detection, block tag handling). DO NOT pass `chain: mainnet` to a Polygon RPC URL — viem's internal `formatTransactionReceipt` may decode L1-specific fields differently from L2 ones (Polygon-specific tx fields like `effectiveGasPrice` ordering). The registry's `VIEM_CHAINS[chainId]` ensures the right chain object pairs with the right RPC URL.

**Sources:**
- [viem chains documentation](https://viem.sh/docs/chains/introduction) — official chain-object pattern
- [PublicNode public RPC list](https://www.publicnode.com) — free-tier RPC URLs for all 5 chains

### Topic 2: Provider-shorthand wiring (INST-40)

**Recommendation:** `RPC_PROVIDER + RPC_API_KEY` shorthand resolves to per-chain URL templates. The shorthand acts as a default URL builder; per-chain explicit overrides (`ETHEREUM_RPC_URL`, `ARBITRUM_RPC_URL`, …) take precedence at the chain level. PublicNode is the final fallback (already shipped for chainId 1; same pattern fans to other 4).

**URL templates** (verified against Infura + Alchemy public docs):

| Provider | Ethereum | Arbitrum | Polygon | Base | Optimism |
|----------|---------|----------|---------|------|----------|
| `infura` | `https://mainnet.infura.io/v3/${KEY}` | `https://arbitrum-mainnet.infura.io/v3/${KEY}` | `https://polygon-mainnet.infura.io/v3/${KEY}` | `https://base-mainnet.infura.io/v3/${KEY}` | `https://optimism-mainnet.infura.io/v3/${KEY}` |
| `alchemy` | `https://eth-mainnet.g.alchemy.com/v2/${KEY}` | `https://arb-mainnet.g.alchemy.com/v2/${KEY}` | `https://polygon-mainnet.g.alchemy.com/v2/${KEY}` | `https://base-mainnet.g.alchemy.com/v2/${KEY}` | `https://opt-mainnet.g.alchemy.com/v2/${KEY}` |

[CITED: docs.infura.io networks reference; docs.alchemy.com supported chains list — both verified against the providers' public network reference pages, 2026-05-16]

**Resolution priority** (locked at planning gate):

```
1. Chain-specific env var (e.g. ARBITRUM_RPC_URL) — wins unconditionally
2. RPC_PROVIDER + RPC_API_KEY shorthand — fans to all 5 chains in one shot
3. PublicNode public RPC (chain-specific URL) — final fallback; warned once-per-chain via stderr
```

**Shape** (closest analog: the existing `src/config/env.ts:30-55` env-reader helpers):

```typescript
// Source: src/config/env.ts — additions
export function getArbitrumRpcUrl(): string | undefined { return read("ARBITRUM_RPC_URL"); }
export function getPolygonRpcUrl():  string | undefined { return read("POLYGON_RPC_URL"); }
export function getBaseRpcUrl():     string | undefined { return read("BASE_RPC_URL"); }
export function getOptimismRpcUrl(): string | undefined { return read("OPTIMISM_RPC_URL"); }
// getEthereumRpcUrl + getRpcProvider + getRpcApiKey already exist (lines 37-47)

// Source: src/chains/registry.ts — provider-shorthand wiring
import { getRpcProvider, getRpcApiKey } from "../config/env.js";
import type { ChainId } from "../config/contracts.js";

const PROVIDER_TEMPLATES: Record<string, Record<ChainId, string>> = {
  infura: {
    1:     "https://mainnet.infura.io/v3/{key}",
    42161: "https://arbitrum-mainnet.infura.io/v3/{key}",
    137:   "https://polygon-mainnet.infura.io/v3/{key}",
    8453:  "https://base-mainnet.infura.io/v3/{key}",
    10:    "https://optimism-mainnet.infura.io/v3/{key}",
  },
  alchemy: {
    1:     "https://eth-mainnet.g.alchemy.com/v2/{key}",
    42161: "https://arb-mainnet.g.alchemy.com/v2/{key}",
    137:   "https://polygon-mainnet.g.alchemy.com/v2/{key}",
    8453:  "https://base-mainnet.g.alchemy.com/v2/{key}",
    10:    "https://opt-mainnet.g.alchemy.com/v2/{key}",
  },
};

function getProviderShorthandUrl(chainId: ChainId): string | undefined {
  const provider = getRpcProvider();
  const key = getRpcApiKey();
  if (!provider || !key) return undefined;
  const template = PROVIDER_TEMPLATES[provider.toLowerCase()]?.[chainId];
  if (!template) {
    log("warn", `RPC_PROVIDER="${provider}" not recognized for chain ${chainId} (supported: infura, alchemy); falling back to PublicNode`);
    return undefined;
  }
  return template.replace("{key}", key);
}
```

**Pitfall: provider-name typos**: `RPC_PROVIDER=Infura` (capitalized) should match `infura`. Lowercase the input. Unknown providers (e.g. `RPC_PROVIDER=quicknode` — out of scope for v1.2) log a warning and fall through to PublicNode; the agent sees `rpcDegraded: true` and can surface the misconfiguration to the user.

**Diagnostics surface**: `get_vaultpilot_config_status` reports `rpcProvider` (verbatim shorthand name OR `null` if unset) + `rpcApiKeyPresent` (boolean) + per-chain `customRpcConfigured` (5 booleans). Pattern matches the Phase 7 `etherscanApiKeyPresent` boolean addition.

**Sources:**
- [Infura networks reference](https://docs.infura.io/api/networks) — per-chain URL templates
- [Alchemy supported chains](https://docs.alchemy.com/reference/supported-chains) — per-chain URL templates
- [PublicNode RPC list](https://www.publicnode.com) — fallback URLs

### Topic 3: Chain-id resolution and assertion (PREP-40 / PREP-41 / Success Criterion #3)

**Recommendation:** Chain-id assertion is **defense-in-depth, not cryptography**. The `payloadFingerprint` already binds chainId byte-for-byte (verified empirically — the 32-byte big-endian chainId is bytes 24–55 of the keccak preimage, per `src/signing/payload-fingerprint.ts:43`). Phase 8 adds an **explicit chain-NAME mismatch refusal** at preview + send that fails LOUDLY before the user sees a wrong-chain block.

**The trust chain today**:

1. `prepare_*` tools record `chainId: 1` into `record.tx.chainId` (`src/tools/prepare_native_send.ts:240`).
2. `computePayloadFingerprint` includes chainId in the preimage (line 43 of `payload-fingerprint.ts`).
3. `preview_send` reads `record.tx.chainId` (line 274) and re-emits it in the LEDGER BLIND-SIGN HASH block context.
4. `send_transaction` recomputes the fingerprint over the STORED `record.tx.chainId` (line 296) — drift refusal fires if any layer mutated chainId between prepare and send.

**The Phase 8 gap** that the new gate closes:

- The agent calls `prepare_aave_supply({ asset, amount, chain: "polygon" })`.
- The MCP server records `record.tx.chainId = 137` (correct), `record.tx.to = polygonAavePool` (correct).
- A compromised / hallucinating agent then calls `preview_send({ handle })` and tells the user *"this is an Ethereum transaction"* in its natural-language preamble, even though the structured `chainId: 137` flows through.
- Today: the user's only defense is reading the structured `chainId` field and the LEDGER BLIND-SIGN HASH. The Ledger device will display `Network: Polygon` (clear-sign) OR a raw hash (blind-sign) — that's the trust anchor. But there's no preview-time refusal.

**Phase 8's chain-name MISMATCH gate** (additive to `preview_send` + `send_transaction`):

```typescript
// Source: src/tools/preview_send.ts (Plan 08-02 — sketch)
//
// New optional input field `chain?: ChainName` on preview_send. When provided,
// asserts record.tx.chainId === chainIdFromName(chain). Mismatch → structured
// CHAIN_NAME_MISMATCH refusal.
//
// NOT a new cryptographic gate — the fingerprint already binds chainId. This
// is a "the agent's natural-language story and the bytes diverge" advisory.

if (args.chain !== undefined) {
  const claimedChainId = chainIdFromName(args.chain);
  if (claimedChainId !== record.tx.chainId) {
    return {
      isError: true,
      content: [{ type: "text", text: `error: agent passed chain="${args.chain}" (chainId ${claimedChainId}) but the prepared tx is on chainId ${record.tx.chainId}; this is a defense-in-depth refusal — the bytes are still byte-bound, but the agent's story is inconsistent. Re-call prepare_* with the correct chain.` }],
      structuredContent: errEnvelope("CHAIN_NAME_MISMATCH", `agent claimed chain ${args.chain} (${claimedChainId}) but prepared tx is on chainId ${record.tx.chainId}`),
    };
  }
}
```

**Refusal-message shape** carries the canonical chain-name list (Success Criterion #2). On a missing or invalid `chain` arg to `prepare_*`:

```
error: `chain` parameter is required for prepare_* tools (no default-pick).
Supported chains: ethereum, arbitrum, polygon, base, optimism.
```

**ChainName ↔ ChainId mapping** (locked at planning gate):

```typescript
// Source: src/config/contracts.ts — addition
export type ChainName = "ethereum" | "arbitrum" | "polygon" | "base" | "optimism";

const CHAIN_ID_BY_NAME: Record<ChainName, ChainId> = {
  ethereum: 1,
  arbitrum: 42161,
  polygon:  137,
  base:     8453,
  optimism: 10,
};

export function chainIdFromName(name: ChainName): ChainId { return CHAIN_ID_BY_NAME[name]; }

const CHAIN_NAME_BY_ID: Record<ChainId, ChainName> = Object.fromEntries(
  Object.entries(CHAIN_ID_BY_NAME).map(([n, id]) => [id, n]),
) as Record<ChainId, ChainName>;

export function chainNameFromId(id: ChainId): ChainName { return CHAIN_NAME_BY_ID[id]; }
```

**EIP-155 replay protection implication**: chainId is bound into the EIP-1559 typed transaction (`src/signing/presign-hash.ts` already includes it in the RLP serialization — same as `payloadFingerprint`). The Ledger device validates chainId before signing — a transaction prepared with `chainId: 1` cannot be replayed on Polygon (chainId 137) because the device-side signature is over the EIP-155-protected pre-image. **Phase 8 does NOT need to change EIP-155 enforcement** — viem's `serializeTransaction` (Phase 4 PREP-04 / Phase 6 ERC-20 baseline) already does it correctly per chain.

**`payloadFingerprint` is `from`-independent AND `chain`-independent... in the preimage shape** — i.e. the preimage accommodates ANY chainId without changing the keccak structure. Fixtures A–H are chainId=1 anchors; Phase 8 introduces NO new fixtures because the preimage shape is invariant. (Compare: Phase 7 added Fixtures G + H for new `data` shapes; Phase 6 added D + E + F for new `data` shapes. Phase 8 adds no new `data` shape — `transfer(to, amount)` calldata on Polygon is the same 68-byte shape as on Ethereum.) See Topic 9 for the full fixture-implications discussion.

**Pitfall: chain-name spelling**. Strict-equality on the lowercase literal — `"Ethereum"` (capital E) and `"eth"` reject as `INVALID_INPUT`. Same discipline as Phase 6's T-MAX-SPELLING-1 mitigation (strict equality on `"max"` sentinel). The JSON-schema `enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"]` is the gate.

**Sources:**
- [EIP-155 replay protection](https://eips.ethereum.org/EIPS/eip-155) — canonical reference
- `src/signing/payload-fingerprint.ts:36-49` — empirical preimage shape (verified)

### Topic 4: `chain` parameter threading strategy (PLAN 08-02)

**Recommendation:** Required on every `prepare_*` (no default — Success Criterion #2); optional on every read tool with the "omitted → all 5 chains" semantics for `get_portfolio_summary` only (Success Criterion #4) and "omitted → required" for the other reads (no sensible default for a single-chain read).

**Tools that take `chain`** (13 total — 8 reads + 5 prepares — verified by listing `src/tools/`):

| Tool | `chain` arg | Default behavior | Notes |
|------|-------------|------------------|-------|
| `get_portfolio_summary` | optional | omitted → all 5 chains | Fan-out via Promise.allSettled (Topic 5) |
| `get_token_balance` | required | refuses w/ canonical list | Single-chain read; no sensible default |
| `get_transaction_status` | required | refuses w/ canonical list | `txHash` is chain-scoped |
| `get_token_metadata` | required | refuses w/ canonical list | Decimals are chain-scoped per token contract |
| `resolve_ens_name` / `reverse_resolve_ens` | NO chain arg | ethereum-only forever | ENS lives on Ethereum mainnet; no fan-out |
| `get_lending_positions` | required | refuses w/ canonical list | Aave V3 on 4 of 5 chains; Polygon excluded from Phase 8 Aave (no Aave V3 on Polygon in current address book — verified, both POLYGON and ARBITRUM share `0x794a61358D6845594F94dc1DB02A252b5b4814aD` so Aave V3 IS on Polygon; Phase 8 keeps all 4 enabled). [VERIFIED: bgd-labs/aave-address-book main branch.] |
| `simulate_position_change` | required | refuses w/ canonical list | Same Aave V3 coverage |
| `check_contract_security` | required | refuses w/ canonical list | Etherscan V2 already supports `chainid` param (Phase 7 forward-compat) |
| `resolve_token` | optional | omitted → return all 5 chains' entries | Cross-chain symbol discovery (Topic 6) |
| `get_token_allowances` | required | refuses w/ canonical list | Topic 7 |
| `prepare_native_send` | required | refuses w/ canonical list | PREP-41 |
| `prepare_token_send` | required | refuses w/ canonical list | PREP-41 |
| `prepare_token_approve` | required | refuses w/ canonical list | PREP-41 |
| `prepare_revoke_approval` | required | refuses w/ canonical list | PREP-41 |
| `prepare_weth_unwrap` | required | refuses w/ canonical list | PREP-41 |
| `prepare_aave_supply` / `prepare_aave_withdraw` | required | refuses w/ canonical list | PREP-41 |

**Tools that do NOT take `chain`**:
- `resolve_ens_name` / `reverse_resolve_ens` — ENS is Ethereum-mainnet-only.
- `pair_ledger_live` / `pair_ledger_live_start` / `pair_ledger_live_wait` / `get_ledger_status` / `set_active_account` — the WC namespace request covers all configured chains (Topic 8).
- `set_demo_wallet` / `get_demo_wallet` — persona registry is chain-agnostic.
- `get_vaultpilot_config_status` / `get_ledger_device_info` — diagnostic surface.
- `preview_send` / `send_transaction` / `get_tx_verification` — these read `record.tx.chainId` from the handle store (set at prepare time); `chain` is OPTIONAL on these as a defense-in-depth assertion (Topic 3).

**Refusal-message shape on missing/invalid `chain`**:

```
error: `chain` is required for prepare_token_send. Supported chains: ethereum, arbitrum, polygon, base, optimism.
```

vs.

```
error: `chain="foo"` is not a supported chain name. Supported: ethereum, arbitrum, polygon, base, optimism.
```

JSON-schema enum:
```json
{ "chain": { "type": "string", "enum": ["ethereum", "arbitrum", "polygon", "base", "optimism"] } }
```

The schema-level enum is the gate (mirror of Phase 4's `userDecision` enum-as-gate pattern); per-tool handlers do NOT re-validate the enum (it's unreachable on enum violation).

**Diff shape per tool** (bounded by Phase 6/7 mechanical-clone discipline):

```typescript
// 1. Input schema: add `chain` to INPUT_SCHEMA properties + required[]
// 2. Tool body: const chainId = chainIdFromName(args.chain as ChainName);
// 3. Replace getEthereumClient() with getChainClient(chainId)
// 4. Replace getAaveV3PoolAddress(1) with getAaveV3PoolAddress(chainId)  // etc.
// 5. Replace `chainId: 1` literal with chainId from arg
// 6. PREPARE RECEIPT template: add `{CHAIN}` slot
// 7. structuredContent: `chainId: <chainId>` instead of `chainId: 1`
```

**Format-fanout sentinel for templates**: every `PREPARE_RECEIPT_TEMPLATE` widens with a `{CHAIN}` slot. Existing receipts (Phase 4 native, Phase 6 ERC-20, Phase 7 Aave) all gain the slot — append-only addition before the final blank line. No new templates; widen existing. The format-fanout discipline (Phase 6 retro line 142) is preserved: every multi-line block is a `const` in `src/signing/blocks.ts`; no per-tool inline strings.

**Pitfall: TypeScript widening cascade**. `ChainId = 1` → `ChainId = 1 | 42161 | 137 | 8453 | 10` will surface tsc errors at every consumer that hardcoded `1`. The plan-checker dimension is exhaustive grep against `chainId: 1\|getAaveV3PoolAddress(1)\|getWethAddress(1)\|getChainClient(1)` literals in `src/` after Plan 08-02 lands. Phase 6 retro line 150 already locked this widening pattern for Phase 8; the TypeScript compiler is the regression anchor.

### Topic 5: Cross-chain aggregation for `get_portfolio_summary` (PLAN 08-03)

**Recommendation:** `Promise.allSettled` fan-out across 5 chains when `chain` omitted; per-chain failures surface as a `chainErrors[]` field; aggregated `totalUsd` sums across successful chains; per-chain rows tagged with their `chain` field for unambiguous routing.

**Response shape** (closest analog: current `get_portfolio_summary.ts:70-76` per-chain `PortfolioSummaryResult`):

```typescript
// Source: src/tools/get_portfolio_summary.ts (Plan 08-03 — sketch)
//
// When chain arg omitted: fan out across 5 chains. Each per-chain result
// matches the current single-chain shape; the cross-chain wrapper adds:
//   - perChain: Record<ChainName, ChainPortfolio | null>  (null on failure)
//   - chainErrors: Array<{chain, reason}>                   (failed legs)
//   - totalUsd: aggregated across successful legs
//
// When chain arg provided: return ONLY that chain's portfolio in the
// per-chain shape (preserves Phase 2 caller compatibility — same shape).

interface ChainPortfolio {
  chain: ChainName;                  // explicit per-row chain tag
  nativeBalance: NativeBalanceRow;
  erc20Balances: Erc20BalanceRow[];
  totalUsd: string;
  rpcDegraded?: boolean;
}

interface CrossChainPortfolioResult {
  perChain: Partial<Record<ChainName, ChainPortfolio>>;
  chainErrors: Array<{ chain: ChainName; reason: string }>;
  totalUsd: string;                  // sum of perChain[*].totalUsd
}
```

**Fan-out pattern**:

```typescript
// Source: src/tools/get_portfolio_summary.ts (Plan 08-03 — sketch)
const chainsToRead: ChainName[] = args.chain !== undefined
  ? [args.chain as ChainName]
  : ["ethereum", "arbitrum", "polygon", "base", "optimism"];

const results = await Promise.allSettled(
  chainsToRead.map((chain) => readChainPortfolio(chain, wallet, dustThreshold)),
);

const perChain: Partial<Record<ChainName, ChainPortfolio>> = {};
const chainErrors: Array<{ chain: ChainName; reason: string }> = [];
let totalUsdNum = 0;

for (let i = 0; i < results.length; i++) {
  const chain = chainsToRead[i]!;
  const result = results[i]!;
  if (result.status === "fulfilled") {
    perChain[chain] = result.value;
    totalUsdNum += parseFloat(result.value.totalUsd);
  } else {
    chainErrors.push({
      chain,
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  }
}
```

**Why `Promise.allSettled`, not `Promise.all`**: a single failed chain (e.g. Polygon RPC down) should NOT poison the whole response. Each chain's leg succeeds or fails independently; the agent sees both the successful results AND the failure reasons. This matches the existing `rpcDegraded` + `priceUnknown` shape — never silently drop, always surface.

**Per-chain Aave Pool fan-out for `get_lending_positions`** (Plan 08-03 secondary scope): same pattern, but with cross-chain Aave V3 support across 4 chains (Aave V3 deployed on Ethereum/Arbitrum/Polygon/Optimism — Base has Aave V3 as well; Topic 1 SOT covers all 5). `get_lending_positions({ chain: "arbitrum" })` reads `getAaveV3PoolAddressesProvider(42161)` + `getAaveV3UiPoolDataProvider(42161)`. No structural change — the `_aaveChains.getReservesData(client, chainId)` helper (existing — `src/chains/aave-v3.ts:102-104`) already takes a `chainId` arg and resolves addresses via the SOT.

**Top-50 ERC-20 registry per chain**: today, `src/tokens/registry.ts` loads `src/tokens/ethereum-top-50.json`. Phase 8 needs analogous JSON files per chain — recommendation: ship `arbitrum-top-50.json`, `polygon-top-50.json`, `base-top-50.json`, `optimism-top-50.json` and dispatch via `loadTokenRegistry(chainId)`. Each file curated from CoinGecko's per-chain top-volume list (manual selection — same discipline as the existing ethereum-top-50). Estimate ~250 lines of curated JSON per chain.

**Alternative considered + rejected — top-50 cross-chain unified registry**: a single JSON file with one row per (token, chain) pair. Rejected because: (a) the addresses for "USDC" on Polygon vs Arbitrum are different (bridged-variant disambiguation belongs in Topic 6, not the balance-scan list); (b) the per-chain top-50 differs significantly (Polygon has long-tail meme tokens that don't trade on Ethereum; Arbitrum has chain-specific yield tokens); (c) the current `loadEthereumTokenRegistry()` shape is locked from Phase 2 and per-chain JSON files preserve the simple-shape pattern.

**Pitfall: DefiLlama pricing per chain**. DefiLlama's `/coins/prices/current` endpoint accepts comma-separated CAIP-2-like keys: `ethereum:0xabc…,arbitrum:0xdef…`. The existing `src/pricing/defillama.ts:getPrices` takes only `Address[]` and assumes Ethereum. Plan 08-03 extends to `getPrices(addresses: Array<{chain: ChainName, address: Address}>)`. [CITED: api-docs.defillama.com — `coins.llama.fi/prices/current/{coins}`.]

**Partial-result envelope shape** in chat-friendly text:

```
wallet 0xabc…: portfolio across 5 chains = ~$1234.56 USD
  ethereum: 0.5 ETH + 3 ERC-20s = ~$987.65
  arbitrum: 0 ETH + 2 ERC-20s = ~$123.45
  polygon: 100 MATIC + 4 ERC-20s = ~$78.90
  base:     0.01 ETH + 1 ERC-20 = ~$44.56
  optimism: rpcError — Optimism RPC unreachable: timeout after 5000ms
(totalUsd sums only successful chains; check chainErrors[] for failures)
```

### Topic 6: Bridged-token landscape and `resolve_token` (READ-42)

**Recommendation:** Curated bridged-variant table in `src/tokens/bridged-variants.ts`. ~15 commonly-disambiguated symbols × 5 chains. Hand-verified against Circle's canonical address list, Optimism's docs, and Arbitrum's docs. NO third-party SDK — DefiLlama's `/tokens` endpoint exists but doesn't reliably tag bridged variants.

**The disambiguation problem**: when a user says "send 100 USDC on Polygon", the question "WHICH USDC?" has two answers:
1. **Native USDC** (Circle-issued, minted directly on Polygon — chain-native; Circle attests reserves directly).
2. **Bridged USDC** (USDC.e — wrapped USDC bridged from Ethereum via the Polygon PoS bridge; redeemable for Ethereum-mainnet USDC via the bridge, but NOT Circle-attested).

Both have non-trivial liquidity. Sending to the wrong one is irreversible (or at least requires a manual bridge round-trip). The disambiguation MUST surface at `resolve_token` time.

**Verified bridged-token table** (cross-checked against Circle docs + Optimism docs + Arbitrum docs + Polygon docs):

| Symbol | Chain | Address | Variant | Note |
|--------|-------|---------|---------|------|
| USDC | ethereum | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | canonical | Circle native |
| USDC | arbitrum | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | canonical | Circle native (launched 2023) |
| USDC.e | arbitrum | `0xff970a61a04b1ca14834a43f5de4533ebddb5cc8` | bridged | Originally "USDC", renamed when Circle launched native |
| USDC | polygon | `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359` | canonical | Circle native (launched 2023) |
| USDC.e | polygon | `0x2791bca1f2de4661ed88a30c99a7a9449aa84174` | bridged | Originally "USDC", renamed when Circle launched native |
| USDC | optimism | `0x0b2c639c533813f4aa9d7837caf62653d097ff85` | canonical | Circle native (launched 2023) |
| USDC.e | optimism | `0x7F5c764cBc14f9669B88837ca1490cCa17c31607` | bridged | Originally "USDC", renamed when Circle launched native |
| USDC | base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | canonical | Circle native |
| USDbC | base | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA` | bridged | Coinbase-naming for bridged USDC (USDC.e equivalent) |
| USDT | ethereum | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | canonical | Tether issuer |
| USDT | arbitrum | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | canonical | Tether-issued natively |
| USDT | polygon | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` | canonical | Tether-issued natively |
| USDT | optimism | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | canonical | Tether-issued natively |
| USDT | base | n/a | — | NOT widely deployed on Base as of 2026-05; bridged variants exist but none canonical |
| DAI | ethereum | `0x6B175474E89094C44Da98b954EedeAC495271d0F` | canonical | MakerDAO |
| DAI | arbitrum | `0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1` | canonical | MakerDAO official deployment |
| DAI | polygon | `0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063` | bridged | MakerDAO official cross-chain |
| DAI | optimism | `0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1` | canonical | MakerDAO official deployment |
| DAI | base | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` | canonical | MakerDAO official deployment |
| WBTC | ethereum | `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` | canonical | BitGo-issued |
| WBTC | arbitrum | `0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f` | bridged | Bridged via Arbitrum gateway |
| WBTC | polygon | `0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6` | bridged | Bridged variant |
| WBTC | base | `0x1cEb5cB57C4D4E2b2433641b95Dd330A33185A44` | bridged | Bridged variant; thinner liquidity |
| WETH | ethereum | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | canonical | Already in SOT (`getWethAddress(1)`) |
| WETH | arbitrum | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | canonical | Bedrock WETH; chain-native |
| WETH | polygon | `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619` | canonical | Polygon WETH |
| WETH | base | `0x4200000000000000000000000000000000000006` | canonical | OP-Stack predeploy |
| WETH | optimism | `0x4200000000000000000000000000000000000006` | canonical | OP-Stack predeploy |

[VERIFIED: cross-referenced against Circle docs, Optimism docs/tokenlist, Arbitrum docs, MakerDAO official deployments — 2026-05-16]

**Recommendation: scope ~15 symbols, document the rest**. Phase 8 v1.2 ships:
- USDC (5 chains, native + bridged where both exist)
- USDC.e / USDbC (3 + 1 bridged entries)
- USDT (4 chains; Base excluded — no canonical deployment)
- DAI (5 chains; Polygon flagged as bridged-from-MakerDAO)
- WETH (5 chains; chain-specific canonical wrapper)
- WBTC (4 chains; bridged where it differs from Ethereum)
- WMATIC (Polygon-native)
- ARB (Arbitrum-native)
- OP (Optimism-native)

**Response shape**:

```typescript
// Source: src/tools/resolve_token.ts (Plan 08-04 — sketch)
export interface BridgedVariantInfo {
  symbol: string;
  chain: ChainName;
  address: Address;
  variant: "canonical" | "bridged";
  variantNote: string;       // verbatim text for the agent to surface
  originChain?: ChainName;   // for bridged: where it bridged from
}

// Returns ALL matching variants when chain unspecified
// Returns ONE row when (symbol, chain) is unambiguous
// Returns 2 rows when (symbol, chain) has both canonical + bridged
```

**Example response — `resolve_token({ symbol: "USDC", chain: "polygon" })`**:

```json
{
  "matches": [
    {
      "symbol": "USDC",
      "chain": "polygon",
      "address": "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
      "variant": "canonical",
      "variantNote": "Circle-native USDC on Polygon. Launched 2023. Attested by Circle directly; redeemable 1:1 via Circle Mint."
    },
    {
      "symbol": "USDC.e",
      "chain": "polygon",
      "address": "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
      "variant": "bridged",
      "originChain": "ethereum",
      "variantNote": "Bridged USDC via Polygon PoS bridge from Ethereum. Originally named 'USDC' before Circle launched native USDC on Polygon (2023). Redeemable for ETH-mainnet USDC via the bridge, NOT Circle-attested directly."
    }
  ]
}
```

**Why curated vs. discovery**: DefiLlama's `/tokens` endpoint returns token metadata but does NOT consistently tag "canonical" vs "bridged". 1inch and OpenSea ship token-lists with `bridge: { origin }` fields, but the lists are fork-coupled to their UI and update irregularly. CoinGecko's per-chain token-lists are the closest authoritative source (their `platforms` field maps contract addresses across chains for the SAME logical asset), but doesn't distinguish bridge variants from canonical deployments cleanly. The hand-curated approach is small (~15 symbols × 5 chains = ~75 rows) and the failure mode is "uncovered symbol falls through to `not-found`" — agent then asks the user to supply the address directly.

**Pitfall: ARB and OP are governance tokens, NOT bridged variants of an Ethereum-side asset**. The table must distinguish "this symbol exists ONLY on this chain" (canonical-by-construction; no bridged variant possible) from "this symbol has both a native and bridged version on the same chain". ARB on Arbitrum is `0x912CE59144191C1204E64559FE8253a0e49E6548` and has NO bridged counterpart. Similarly OP on Optimism `0x4200000000000000000000000000000000000042`.

**Sources:**
- [Request Finance — Native vs USDC.e disambiguation](https://help.request.finance/en/articles/8793285) — explicit chain-by-chain table
- [Optimism docs — Bridged token addresses](https://docs.optimism.io/app-developers/reference/tokens/tokenlist) — canonical Optimism token list
- [Circle's native USDC launches](https://www.circle.com) — Polygon/Arbitrum/Optimism native USDC launch announcements

### Topic 7: `get_token_allowances` enumeration strategy (READ-43 / READ-44)

**Recommendation:** Event-log scan over the ERC-20 `Approval(address indexed owner, address indexed spender, uint256 value)` event, filtered by `topics[1] = wallet`, with a configurable block look-back; current-state cross-check via batched `multicall` to filter zero-current-allowance rows. **No archive node required** for the recommended 1M-block look-back. Etherscan V2 does NOT expose a programmatic token-approvals endpoint — empirically verified (Topic source). Event-log scan is the only general-purpose path.

**Etherscan V2 NEGATIVE finding** (load-bearing):

- The Etherscan website at `etherscan.io/tokenapprovalchecker` is a UI feature backed by Etherscan's internal indexer.
- The **API V2 endpoint list** at `docs.etherscan.io/etherscan-v2/api-endpoints/tokens` documents ONLY `tokensupply` and `tokenbalance` for the Tokens module. NO `tokenapprovalchecker` API endpoint exists.
- [VERIFIED: `docs.etherscan.io/etherscan-v2/api-endpoints/tokens` content empirically fetched 2026-05-16 — only `tokensupply` documented under Tokens.]
- This is a real gap: there's no shortcut via Etherscan's V2 API; the enumeration logic lives MCP-side.

**Recommended architecture** (event-log scan):

```typescript
// Source: src/tools/get_token_allowances.ts (Plan 08-04 — sketch)
//
// Two-step enumeration:
//   1. eth_getLogs scan for Approval(owner=wallet, spender=*, value=*) events
//      across the configurable look-back window. Each event yields a candidate
//      (tokenAddress, spender) pair. De-dupe via Map<`${token}:${spender}`>.
//   2. For each candidate pair, current-state cross-check via multicall
//      allowance(wallet, spender) reads. Filter out zero-current-allowance
//      pairs (revoked or fully-spent allowances).
//
// Step 1 output may include long-tail tokens not in the registry; Step 2 only
// keeps the ones where the user STILL has an active allowance. Output rows
// resolve token symbol/decimals via the registry, falling back to live RPC
// reads for off-list tokens.

const APPROVAL_EVENT_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925" as Hex;
// keccak256("Approval(address,address,uint256)") — universal ERC-20 selector

const DEFAULT_LOOKBACK_BLOCKS = 1_000_000n;  // ~140 days on Ethereum, ~26 days on Polygon/Base, ~30 days on Optimism/Arbitrum

async function scanApprovalEvents(
  client: PublicClient,
  wallet: Address,
  lookbackBlocks: bigint,
): Promise<Map<string, { token: Address; spender: Address; lastSeenBlock: bigint }>> {
  const latestBlock = await client.getBlockNumber();
  const fromBlock = latestBlock - lookbackBlocks > 0n ? latestBlock - lookbackBlocks : 0n;

  const logs = await client.getLogs({
    event: parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)"),
    args: { owner: wallet },
    fromBlock,
    toBlock: latestBlock,
  });

  const candidates = new Map<string, { token: Address; spender: Address; lastSeenBlock: bigint }>();
  for (const log of logs) {
    const key = `${log.address}:${log.args.spender}`;
    const prior = candidates.get(key);
    if (!prior || log.blockNumber > prior.lastSeenBlock) {
      candidates.set(key, {
        token: log.address,
        spender: log.args.spender!,
        lastSeenBlock: log.blockNumber,
      });
    }
  }
  return candidates;
}
```

**Step 2 — current-state cross-check via multicall** (filter zero-allowance pairs):

```typescript
async function filterActiveAllowances(
  client: PublicClient,
  wallet: Address,
  candidates: Array<{ token: Address; spender: Address; lastSeenBlock: bigint }>,
): Promise<Array<AllowanceRow>> {
  const calls = candidates.map((c) => ({
    address: c.token,
    abi: parseAbi(["function allowance(address owner, address spender) view returns (uint256)"]),
    functionName: "allowance" as const,
    args: [wallet, c.spender] as const,
  }));
  const results = await client.multicall({ contracts: calls, allowFailure: true });

  const active: AllowanceRow[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const result = results[i]!;
    if (result.status === "success" && result.result > 0n) {
      const c = candidates[i]!;
      active.push({
        token: c.token,
        spender: c.spender,
        amount: result.result,
        isUnlimited: result.result === MAX_UINT256,
        lastSeenBlock: c.lastSeenBlock,
        spenderLabel: lookupSpender(c.spender)?.label ?? "(unknown spender)",
      });
    }
  }
  return active;
}
```

**`[SET-LEVEL ENUMERATION]` block emission** (READ-44 verbatim shape — load-bearing for v1.3 Inv #14):

```
[SET-LEVEL ENUMERATION]
  scope:        wallet 0xabc…def123
  chain:        ethereum (chainId 1)
  fromBlock:    18234567
  toBlock:      19234567 (1,000,000 blocks)
  active rows:  3

  ┌──────────────────────────────────────┬──────────────────────────────────────┬───────────────┬──────────────┬─────────────┐
  │ token (symbol)                       │ spender (label)                      │ amount        │ isUnlimited  │ lastSeenBlk │
  ├──────────────────────────────────────┼──────────────────────────────────────┼───────────────┼──────────────┼─────────────┤
  │ 0xA0b8…eB48 (USDC)                   │ 0xE592…1564 (Uniswap V3 SwapRouter)  │ 1000000000    │ false        │ 19100100    │
  │ 0xdAC1…1ec7 (USDT)                   │ 0x1111…2A65 (1inch Aggregation V6)   │ MAX_UINT256   │ true ⚠       │ 19150200    │
  │ 0xC02a…56Cc (WETH9)                  │ 0x8787…fa4E2 (Aave V3 Pool)          │ 500000000000…│ false        │ 19200300    │
  └──────────────────────────────────────┴──────────────────────────────────────┴───────────────┴──────────────┴─────────────┘
[END SET-LEVEL ENUMERATION]
```

**This block is the source-of-truth for v1.3 Inv #14** (revoke-flow dispatch allowlist enforcement). The companion `vaultpilot-preflight` skill parses this verbatim text to assemble the outer-dispatch allowlist. Get the shape right NOW; v1.3 will pin its parser to this format.

**Look-back window trade-off**:

| Chain | 1M blocks ≈ | Practical coverage |
|-------|------------|--------------------|
| Ethereum | 140 days | Most active allowances are within ~1 year; longer tail exists |
| Arbitrum | 30 days | Faster chain; deeper history likely uninteresting (allowances rotate) |
| Polygon | 26 days | Same as Arbitrum |
| Base | 26 days | Newer chain; usually full history covers all allowances |
| Optimism | 30 days | Same as Arbitrum |

**Configurable `fromBlock` arg**: power-users can supply a deeper block to scan back further. Default 1M; user can pass `0` for full history (requires archive node OR a free-tier RPC that supports unbounded `getLogs` ranges — Alchemy/Infura paid plans typically support this).

**Pitfall: RPC `getLogs` range limits**:

- PublicNode (free): typically 10k blocks per request; would require chunking for 1M blocks. **The chain registry's PublicNode default is NOT viable for `get_token_allowances` deep scans on a busy wallet.** Surface this clearly in the tool description: "for `get_token_allowances` on PublicNode fallback, the `lookbackBlocks` ceiling is 10000; pass `RPC_PROVIDER + RPC_API_KEY` to scan deeper."
- Alchemy paid: 50k blocks per request without parameter; can chunk.
- Infura paid: ~10k blocks per request; can chunk.
- Self-hosted node: unlimited.

**Chunking strategy**: when `lookbackBlocks > 10000` on a public RPC, the implementation chunks into 10k-block windows and aggregates. Each chunk is one `eth_getLogs` call; the per-chain client uses viem's `getLogs` with `fromBlock`/`toBlock` per chunk. Cost: 100 RPC calls for a 1M-block scan with 10k chunks; on Alchemy paid, 20 calls with 50k chunks. Surface as a streaming-progress note via stderr: `getLogs scan: chunk 23/100 complete`.

**Rate-limit consideration**: an aggressive agent calling `get_token_allowances` repeatedly across chains could burn through Alchemy's free tier (300M compute units/month). The tool description routes the agent to NOT call this in tight loops — call ONCE per chain per session, cache the result client-side. The MCP server does NOT cache (no per-session state at this layer).

**Pitfall: Approval events from third parties**. The `topics[1]` filter pins `owner=wallet`, so other-people's-approval events don't pollute the scan. But the scan WILL include long-tail tokens the user has interacted with — including potential scam tokens that auto-`approve()` on transfer-in. Filter recommendation: surface ALL active allowances verbatim; let the agent (or user) decide which look suspicious. NEVER drop rows silently.

**Pitfall: Permit2-style approvals**. EIP-2612 / Permit2 approvals (Uniswap's universal-approval contract) are off-chain signed messages, NOT on-chain `Approval` events. They don't surface in this enumeration. The tool description must name this gap: "this tool enumerates ON-CHAIN allowances via `Approval` events. Off-chain Permit2 signatures are NOT covered (typed-data signing is v3.x scope per ROADMAP)."

**Sources:**
- [Revoke.cash GitHub](https://github.com/RevokeCash/revoke.cash) — open-source reference impl; uses viem + Etherscan/Covalent/Alchemy mix
- [viem getLogs documentation](https://viem.sh/docs/actions/public/getLogs) — canonical event-scan pattern
- [Etherscan V2 token endpoints](https://docs.etherscan.io/etherscan-v2/api-endpoints/tokens) — empirically verified: no token-approval API endpoint

### Topic 8: WalletConnect multi-chain pairing (PLAN 08-05)

**Recommendation:** Drive `REQUIRED_NAMESPACES.eip155.chains` from the configured-chain list (the chains that have a valid RPC URL after the resolution in Topic 2). Replace the hardcoded `["eip155:1"]` at `src/wallet/session-manager.ts:67`. Widen `sessionToStatus` to accept multi-chain `accounts` arrays (currently REFUSES at lines 626-632 — "v1.x is mainnet-only"). The resulting `LedgerStatus.accounts[]` flows through to `set_active_account` with per-chain context.

**WC v2 multi-chain pairing shape** (verified against WalletConnect Specs):

```typescript
// Source: src/wallet/session-manager.ts (Plan 08-05 — sketch)
const configuredChainIds = getConfiguredChainIds();  // returns ChainId[]
const eip155Chains = configuredChainIds.map((id) => `eip155:${id}`);

const REQUIRED_NAMESPACES = {
  eip155: {
    chains: eip155Chains,                              // e.g. ["eip155:1", "eip155:137", "eip155:42161", "eip155:8453", "eip155:10"]
    methods: ["eth_sendTransaction", "personal_sign"],
    events: ["accountsChanged", "chainChanged"],
  },
};
```

**Resulting session shape** (per WalletConnect Specs — namespaces.accounts is CAIP-10 per chain):

```typescript
// Source: session.namespaces.eip155.accounts after successful multi-chain approval
{
  eip155: {
    accounts: [
      "eip155:1:0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb",
      "eip155:137:0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb",
      "eip155:42161:0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb",
      "eip155:8453:0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb",
      "eip155:10:0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb",
    ],
    methods: [...],
    events: [...],
  },
}
```

[CITED: specs.walletconnect.com/2.0/specs/clients/sign/namespaces — multi-chain accounts shape]

**The `sessionToStatus` widening** (replaces lines 613-646 of `src/wallet/session-manager.ts`):

```typescript
// CURRENT (Phase 3 — mainnet-only):
function sessionToStatus(session: SessionTypes.Struct): LedgerStatus {
  const caipAccounts = session.namespaces.eip155?.accounts;
  // ...
  const parsed = caipAccounts.map((c) => parseEvmAccountId(c));
  const chainId = parsed[0]!.chainId;
  for (const entry of parsed) {
    if (entry.chainId !== chainId) {
      throw new Error(
        `paired session has accounts on multiple eip155 chains (${chainId} and ${entry.chainId}); v1.x is mainnet-only`,
      );  // ← Phase 8 removes this refusal
    }
  }
  // ...
}

// PHASE 8 — multi-chain accepted:
function sessionToStatus(session: SessionTypes.Struct): LedgerStatus {
  const caipAccounts = session.namespaces.eip155?.accounts;
  // ...
  const parsed = caipAccounts.map((c) => parseEvmAccountId(c));
  // Group by chainId
  const accountsByChain = new Map<number, Address[]>();
  for (const entry of parsed) {
    const list = accountsByChain.get(entry.chainId) ?? [];
    list.push(entry.address);
    accountsByChain.set(entry.chainId, list);
  }
  // Default activeAccount = accounts[0] on the FIRST chain (typically Ethereum mainnet)
  const firstChain = parsed[0]!.chainId;
  const firstAccount = parsed[0]!.address;
  const activeAccount = activeAccountByTopic.get(session.topic) ?? firstAccount;
  // ...
  return {
    paired: true,
    accountsByChain: Object.fromEntries(accountsByChain),   // NEW: per-chain accounts map
    accounts: [...new Set(parsed.map((p) => p.address))],   // unique addresses across chains (typically same single address)
    activeAccount,
    activeChainId: firstChain,                              // NEW: which chain is the "active" context
    address: activeAccount,
    chainId: firstChain,                                    // back-compat: previously the sole chain
    sessionTopicLast8: session.topic.slice(-8),
  };
}
```

**Multi-chain `LedgerStatus` shape extension**:

```typescript
export interface LedgerStatus {
  paired: true;
  // NEW: per-chain accounts map; same address typically appears on every chain
  // but Ledger Live MAY return different addresses if the user has explicitly
  // selected different accounts per chain. Preserve verbatim.
  accountsByChain: Record<number, Address[]>;
  // Unique addresses across all chains (typically one entry — Ledger Live uses
  // the same derived address per chain by default).
  accounts: Address[];
  // The currently-active account (the `from` for prepare_*).
  activeAccount: Address;
  // NEW: the currently-active chainId. `prepare_*` tools assert
  // chainIdFromName(args.chain) === activeChainId before authoring tx.
  activeChainId: number;
  // Back-compat aliases through Phase 8:
  address: Address;            // === activeAccount
  chainId: number;             // === activeChainId
  sessionTopicLast8: string;
}
```

**`set_active_account` cross-chain implications**: the existing `setActiveAccount(address)` walks ALL accounts (any chain); finds a match; sets the active address. Phase 8 adds optional `chain?` arg: `setActiveAccount({ address, chain? })`. If `chain` provided, restrict the match to that chain's account set. If not, search across all chains (back-compat). The active CHAIN ID becomes a separate concern from the active ACCOUNT — they're independent selectors.

**Pitfall: Ledger Live's account-picker UI**. As surfaced during physical-device testing (ROADMAP Plan 08-05 note), Ledger Live's pairing UI only offers Ethereum accounts IF the user hasn't enabled the L2 networks in Ledger Live → Manage Accounts. The MCP server requests the chains via `requiredNamespaces`, but the wallet decides which chains to approve. Result: the user MAY see a session approved only for Ethereum even when the MCP requested all 5 chains.

**Defense pattern**: after pairing, the server compares the requested chains to the approved chains. If less than the full set, log a stderr warning naming the missing chains AND surface `partiallyPaired: true` in `LedgerStatus`. The tool description for `pair_ledger_live` and `pair_ledger_live_wait` includes a one-line hint: "Before pairing, enable Base/Polygon/Arbitrum/Optimism in Ledger Live → Manage Accounts; otherwise you'll only get an Ethereum-account session."

**`optionalNamespaces` alternative considered + rejected**: WC v2 supports `optionalNamespaces` (best-effort chains that the wallet can choose to satisfy partially). Using `optionalNamespaces` for L2s and only `requiredNamespaces.eip155.chains: ["eip155:1"]` for Ethereum WOULD let the user pair even on a stale Ledger Live config — but it defeats the Phase 8 goal of "all 5 chains in one pairing". Recommendation locked: put ALL configured chains in `requiredNamespaces`; surface `partiallyPaired: true` on partial approval; tool description routes user to fix LL config.

**Sources:**
- [WalletConnect Specs — Namespaces](https://specs.walletconnect.com/2.0/specs/clients/sign/namespaces) — multi-chain shape, accounts CAIP-10 format
- [WalletConnect dapp usage docs](https://docs.walletconnect.network) — `connect({ requiredNamespaces, optionalNamespaces })` shape

### Topic 9: Fixture / cryptographic-binding implications

**Recommendation:** **Zero new fixtures. Zero diff to FROZEN signing pipeline.** The cryptographic-binding chain is `data`-shape-independent AND `chain`-independent (the preimage assembly already accommodates any chainId). Phase 8 does NOT introduce any new `data` shape: `transfer(to, amount)` calldata on Arbitrum is byte-identical to `transfer(to, amount)` calldata on Ethereum — only the `chainId` slot of the preimage changes, and Fixture B already proves the preimage shape is correct for arbitrary chainId values (the keccak preimage IS the regression — drift in any byte produces a different fingerprint).

**Empirical verification of the preimage shape** (`src/signing/payload-fingerprint.ts:36-49`):

```
Preimage = DOMAIN_TAG (23 bytes UTF-8) ‖ chainId(32-byte BE) ‖ to(20 bytes) ‖ value(32-byte BE) ‖ data(variable)
```

The `chainId` slot is `numberToBytes(input.chainId, { size: 32 })` — fixed-32-byte big-endian encoding. Any integer 0–2^256-1 fits without preimage-shape change. Fixtures A–H all use `chainId = 1` (`numberToBytes(1, { size: 32 })` = `0x000…0001`); Phase 8 passing `chainId = 137` (`0x000…0089`) produces a different keccak output WITHOUT changing the preimage byte-layout.

**What this means for Phase 8**:

- NO new `0x…` fixture literal needed.
- The existing Fixture A (native send) regression-tests prove that swapping chainId produces a different fingerprint — but the *shape* of the preimage is invariant. Same for B–H.
- A defense-in-depth test (RECOMMENDED, NOT a fixture):

```typescript
// Source: test/signing-fingerprint.test.ts (Plan 08-02 — addition)
//
// Phase 8 multi-chain validation: fingerprints differ across chains for the
// same (to, value, data) tuple. This is a *property*, not a fixture — we
// don't pin the values; we assert distinctness.
it("Fixture J — chain-distinctness property (Phase 8 / Plan 08-02)", () => {
  const params = { to: ANVIL_WALLET, valueWei: 10n ** 18n, data: "0x" as Hex };
  const fps = [1, 42161, 137, 8453, 10].map((chainId) =>
    computePayloadFingerprint({ chainId, ...params }),
  );
  // All 5 fingerprints distinct — chainId-dependence is load-bearing
  expect(new Set(fps).size).toBe(5);
});
```

**Why "property test" not "fixture"**: pinning each of 5 chains' fingerprints as literals doesn't add information — the existing Fixture A already proves that `chainId` flows into the keccak output. The new property test proves the *function* is chain-distinct, which is the actually-load-bearing claim for Phase 8's "chainId is bound at PREP-03 time" defense.

**FROZEN-area discipline assertion** (every Plan 08-XX MUST include in `<success_criteria>`):

- `src/signing/payload-fingerprint.ts` — byte-frozen. No preimage shape change.
- `src/signing/presign-hash.ts` — byte-frozen. EIP-1559 RLP already includes chainId per spec.
- `src/signing/handle-store.ts` state machine — byte-frozen. `record.tx.chainId` field already exists.
- `src/tools/send_transaction.ts` three gates (previewToken / userDecision / payloadFingerprint) — byte-frozen.
- `src/signing/error-codes.ts` — Phase 8 MAY add `CHAIN_ID_MISMATCH` / `CHAIN_NAME_MISMATCH` codes. The 15-code locked union widens by 1-2. (Plan-checker dimension: is this load-bearing extension warranted, or does `INVALID_INPUT` cover it? Recommendation: name the failure mode distinctly — `CHAIN_ID_MISMATCH` is structurally different from format-class refusals.)

**Cross-fixture continuity for Phase 6/7 persona-cycle tests**: the existing ERC-20 + Aave lifecycle integration tests assert byte-identical fingerprints across whale ↔ stable-saver ↔ defi-degen swaps on Ethereum mainnet. Phase 8 does NOT introduce new persona-cycle tests for multi-chain — the cross-chain shape is the user's responsibility (they pair Ledger to multiple chains via Ledger Live), not the cryptographic-binding chain's. The `from`-independence property continues to hold per-chain.

### Topic 10: Defense-in-depth for chain-id mismatch (PREP-40 success criterion #3)

**Recommendation:** Three layers of chain defense, listed in increasing trust-anchor priority:

1. **Schema-level enum gate** (Plan 08-02): JSON-schema `enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"]` on every `prepare_*` and read tool. Refuses bogus chain names at the dispatch boundary (before handler invocation), mirror of PREP-07's schema-gate pattern. **Catches: agent typos, hallucinated chain names.**

2. **Chain-name MISMATCH refusal at preview + send** (Plan 08-02): when the agent passes `chain` to `preview_send` or `send_transaction`, the server asserts `chainIdFromName(chain) === record.tx.chainId`. Refuses with `CHAIN_NAME_MISMATCH` envelope. **Catches: agent told user it's an Ethereum tx but prepared Polygon bytes.**

3. **`payloadFingerprint` drift refusal at send** (already shipped — Phase 4 PREP-08): the fingerprint preimage binds chainId. Any post-prepare mutation of `record.tx.chainId` breaks the recomputed fingerprint, fires `PAYLOAD_FINGERPRINT_DRIFT`. **Catches: compromised server / handle-store corruption mutating chainId between prepare and send.**

4. **Ledger device-side chain display** (already shipped — out of MCP scope): the Ledger device's clear-sign UI shows `Network: <chain name>` for transactions on plugin-supported chains; for blind-sign, the EIP-155-signed pre-image hash differs per chain so a wrong-chain hash can't match. **Trust anchor.** This is the canonical defense.

**Threat-model coverage** (mapping to PROJECT.md compromise model):

| Threat | Layer that catches it |
|--------|----------------------|
| Compromised MCP swaps `record.tx.chainId` between prepare and send | Layer 3 (fingerprint drift refusal) |
| Narrow agent mutates `prepare_*` args (passes wrong chain) | Layer 1 (schema enum) catches typo; Layer 2 (preview mismatch) catches inconsistency at preview-time |
| Honest model error: agent intends Ethereum, agent code-paths-through Polygon | Layer 2 fires at preview-time on `preview_send({ chain: "ethereum" })` vs `record.tx.chainId === 137` |
| WC peer impersonation forwards Ethereum signing request as Polygon to user | Layer 4 (device clear-sign or blind-sign hash mismatch) — the device computes its own pre-image hash; an attacker can't change chainId without changing the hash |
| Coordinated agent compromise: tells user "ethereum", prepares polygon, claims polygon in preview, claims polygon in PREPARE RECEIPT | Layer 4 only — Layers 1–3 are bypassed; the device shows `Network: Polygon`; user is responsible for matching against intent |

**The chain-mismatch threat is similar to the off-by-decimal threat from Phase 6**: the bytes are correctly bound, but the *natural-language story* the agent tells differs from the bytes. The Phase 6 mitigation is `parseAmountStrict` + on-device `Amount: 100.5 USDC` display; the Phase 8 mitigation is the chain-name MISMATCH refusal + on-device `Network: Polygon` display.

**`structuredContent.chain` extension**: every `prepare_*` response carries `chain: ChainName` alongside `chainId: ChainId`. The `PREPARE RECEIPT` block carries the chain name verbatim:

```
PREPARE RECEIPT
  operation:   ERC-20 transfer
  chain:       polygon (chainId 137)              ← NEW Phase 8 slot
  to:          0xrecipient…
  tokenAddress: 0xtoken…
  amount:      100
```

The `{CHAIN}` template slot widens every existing PREPARE_RECEIPT_TEMPLATE in `src/signing/blocks.ts`. Format-fanout: one slot widening, applied uniformly across all 6 existing receipt templates.

**Pitfall: chainId surfaces in multiple structured fields**. The response carries `chainId` AND `chain` (name) — the agent could relay one correctly and lie about the other. The PREPARE RECEIPT block surfaces BOTH (name + numeric ID); the user's read of the verbatim block + on-device display catches the inconsistency. Same defense pattern as Phase 4's `to` + `valueWei` in the receipt.

**No new error-code class needed beyond the 1-2 chain codes**. The Phase 4 error-codes union has 15 entries; Phase 8 widens by `CHAIN_ID_MISMATCH` + (possibly) `CHAIN_NAME_MISMATCH` (or fold both into one). Recommendation: ONE new code, `CHAIN_ID_MISMATCH`, used uniformly for any chain-discrepancy refusal regardless of which layer fires it.

## SDK Probe Verdicts

| Package | Installed Version | Call Surface Used | Verdict |
|---------|-------------------|-------------------|---------|
| `viem` | 2.48.11 (verified — Phase 7 SDK probe) | `viem/chains` named exports (mainnet, arbitrum, polygon, base, optimism), `createPublicClient` per-chain, `getLogs` for `Approval` event scan, `multicall` for batched `allowance` reads, `parseAbiItem` for event topic | **Adopt** — every Phase 8 chain client + log-scan operation uses already-installed viem. No new dep. |
| `@walletconnect/sign-client` | 2.23.9 (verified — Phase 3 SDK probe) | `connect({ requiredNamespaces })` with multi-chain `eip155.chains` array; `session.namespaces.eip155.accounts` parsing | **Adopt** — same SDK already wired; only the `chains: ["eip155:1"]` literal at session-manager.ts:67 changes |
| `@walletconnect/utils` | (transitive — verified Phase 3) | `parseEvmAccountId` already imported; no widening | **Adopt** — already used for CAIP-10 parsing; supports any chainId |
| `@aave/contract-helpers` | NOT INSTALLED (rejected Phase 7) | NOT USED | **Skip** — Phase 7 verdict carries: heavy SDK, only need 4 functions. Per-chain Aave V3 reads use the existing `_aaveChains.getReservesData(client, chainId)` helper (which already takes a chainId arg). |
| `@uniswap/token-lists` (third-party) | NOT INSTALLED | NOT USED | **Skip** — Uniswap's token list shape is similar to what we need for `bridged-variants.ts`, but the data is curated; pulling the package + transitive deps for a curated 75-row table isn't worth it. Hand-curate the table from the verified Topic 6 source list. |
| `etherscan-api` (npm package) | NOT INSTALLED | NOT USED | **Skip** — Phase 7 verdict carries: stale package (2023), no V2 support. Phase 8 doesn't add any new Etherscan endpoint anyway (only `chainid` param widening, which the existing Phase 7 `src/clients/etherscan.ts` should already accept). |
| DefiLlama coins-API per-chain | NOT INSTALLED (HTTP only) | Per-chain prices via `coins.llama.fi/prices/current/{chain}:{address},{chain}:{address}…` | **Adopt** — existing `src/pricing/defillama.ts` already uses HTTP. Plan 08-03 extends to per-chain keying. No new dep. |
| `viem/chains` Polygon's `polygonAmoy` (testnet) | N/A | NOT USED | **Skip** — Phase 8 is mainnets only. Testnet support is post-v1.x scope. |

## Assumptions Log

| ID | Claim | Section | Risk if Wrong |
|----|-------|---------|---------------|
| **A1** | Aave V3 Pool addresses on Arbitrum / Polygon / Optimism are byte-identical (`0x794a61358D6845594F94dc1DB02A252b5b4814aD` — canonical proxy across all 3 chains). | Topic 1, 4 | Wrong → SOT widening surfaces a wrong address for one chain; integration test would fail at Aave call time with `revert: pool not found` or similar. Recovery: re-verify per-chain via bgd-labs/aave-address-book and Etherscan. [VERIFIED 2026-05-16 against bgd-labs/aave-address-book main branch.] |
| **A2** | Base Aave V3 Pool address is `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` (different from the canonical proxy other chains share). | Topic 1 | Wrong → Base Aave reads fail. Recovery: re-verify. [VERIFIED 2026-05-16 against bgd-labs/aave-address-book + BaseScan.] |
| **A3** | Etherscan V2 does NOT expose a programmatic token-approvals enumeration endpoint (only `/tokenapprovalchecker` UI). | Topic 7 | Wrong → simpler enumeration path exists; event-log scan strategy is over-engineered. Recovery: rewrite `get_token_allowances` to use the Etherscan endpoint. [VERIFIED 2026-05-16 via empirical fetch of docs.etherscan.io/etherscan-v2/api-endpoints/tokens — only `tokensupply` and `tokenbalance` are documented; the website page at /tokenapprovalchecker is unbacked by an API.] |
| **A4** | PublicNode's per-chain free-tier RPCs have a 10000-block ceiling on `eth_getLogs` range queries. | Topic 7 | Wrong → `get_token_allowances` on PublicNode might support deeper scans without chunking. Recovery: drop the chunking note; allow deeper default look-back. [ASSUMED — based on common public RPC patterns; not empirically verified. Verify-phase task.] |
| **A5** | Ledger Live's pairing UI surfaces only accounts for chains enabled in Manage Accounts; absent L2-enable, only Ethereum accounts appear in the session. | Topic 8 | Wrong → `partiallyPaired` flag fires under different conditions than expected. Recovery: empirical Ledger Live testing during Phase 8 verify-phase. [ASSUMED — supported by ROADMAP Plan 08-05 note "surfaced during physical-device testing"; the assumption is the BEHAVIOR is what was observed.] |
| **A6** | WC v2 `requiredNamespaces.eip155.chains` with 5 chains is accepted by Ledger Live without partial-degradation; the wallet returns accounts for all 5 chains when all 5 are enabled. | Topic 8 | Wrong → pairing fails outright if Ledger Live can't satisfy the full `requiredNamespaces`. Recovery: switch to `optionalNamespaces` for L2s. Net: tested empirically as Phase 8 verify-phase. [ASSUMED — the WC v2 spec supports multi-chain `requiredNamespaces`; verified against the specs, not against the specific Ledger Live wallet behavior.] |
| **A7** | The bridged-token table (Topic 6) covers the practical ~95% of "user names a symbol on chain X" disambiguation queries. Long-tail symbols not in the table fall through to `not-found`. | Topic 6 | Wrong → too many `not-found` results, agent friction. Recovery: extend the table opportunistically based on real usage; or fall through to a CoinGecko-style lookup as a stretch goal. [ASSUMED — based on the named symbols being the canonical stablecoin + WETH + governance-token set that covers most DeFi interactions.] |
| **A8** | `viem/chains` exports `arbitrum`, `polygon`, `base`, `optimism` as named exports (chainId 42161, 137, 8453, 10 respectively). | Topic 1 | Wrong → import would fail at compile time; trivial fix. [VERIFIED via viem.sh/docs/chains/introduction — note: docs don't enumerate, but the package's `_types` folder is the SOT; verify by reading `node_modules/viem/_types/chains/index.d.ts` at execute-time per the project CLAUDE.md "SDK Scope-Probing Discipline".] |
| **A9** | `Promise.allSettled` semantics work for fan-out across the 5 chain reads; a single chain timing out at the RPC level produces a rejected promise (NOT a hang) within viem's default `pollingInterval` × `retryCount` budget. | Topic 5 | Wrong → cross-chain `get_portfolio_summary` hangs on one bad chain. Recovery: per-chain Promise.race against a timeout (~10s); the slow chain shows as a `chainError` instead of blocking the entire response. **Recommendation**: ship with per-chain timeout to be safe. [ASSUMED — viem's default timeouts may not surface fast enough for an MCP RPC budget; ship with explicit `Promise.race` against an AbortController per chain.] |
| **A10** | The `[SET-LEVEL ENUMERATION]` block shape (Topic 7) is the right level of detail for v1.3 Inv #14 to parse. | Topic 7 | Wrong → v1.3 needs more/different fields; block shape churns. Recovery: extend additively (verbose footers, never breaking changes to existing rows). [ASSUMED — v1.3 SEC-30..38 hasn't been planned yet; v1.2 is the producer, v1.3 is the consumer. Worth verifying alignment with v1.3 planning during Phase 8 verify-phase.] |

## Design Forks (DF-N) — resolved at planning gate

Applying the Phase 5/6/7 pattern — researcher reasonable-call locks the placement; surface to user ONLY genuine contradiction-of-prior-design forks. Phase 8 surfaces **two real forks** worth naming + locking explicitly; both have defensible defaults and clear cost differences.

### DF-1: `chain` parameter — required everywhere, or optional with sensible defaults?

**Options:**
- **Option A** *(recommended)*: `chain` REQUIRED on every `prepare_*` (PREP-41 requirement is explicit); REQUIRED on most reads; OPTIONAL on `get_portfolio_summary` with "omitted → all 5 chains" semantics + OPTIONAL on `resolve_token` with "omitted → return all matches across chains".
- **Option B**: `chain` REQUIRED on `prepare_*`; OPTIONAL on ALL reads with "omitted → Ethereum default" (current Phase 1-7 behavior preserved by default).
- **Option C**: `chain` REQUIRED on EVERYTHING (no defaults anywhere).

**Recommended default: Option A.**

**Why:**
- **Option A respects the requirement text verbatim**: READ-41 specifically says "aggregates across all 5 EVM chains when called with no `chain` param" — this is a `get_portfolio_summary`-specific behavior, NOT a global default. Option A honors it.
- **Option A surfaces ambiguity loudly**: `get_token_balance({ wallet, tokenAddress })` without `chain` is genuinely ambiguous — which chain's `tokenAddress`? A required `chain` arg forces the agent to be explicit. Refusing with the canonical chain-name list is the right UX.
- **Option B is silent failure waiting to happen**: an agent that worked in Phase 7 on Ethereum-only would silently continue defaulting to Ethereum after Phase 8 ships; users on Polygon would see Ethereum balances and not understand why.
- **Option C is too aggressive**: `get_portfolio_summary` cross-chain aggregation is genuinely useful and the explicit "omit `chain` = all chains" semantic is unambiguous.

**Cost difference:**
- Option A: ~13 tool descriptions explicitly name the required arg; agent learning curve "must pass chain". Test surface: schema-gate refusals on every prepare/read tool.
- Option B: 0 new agent friction but breaks the "no defaults" trust pattern; silent wrong-chain bugs become possible.
- Option C: more friction on `get_portfolio_summary` ("must enumerate all 5 chains to get cross-chain view"); requirement violation (READ-41 is explicit).

**Tradeoffs:**
- Option A surfaces the most explicit user/agent contract. Cost: slightly more verbose tool descriptions. Worth it.
- The chain-NAME mismatch defense (Topic 3, 10) layered on top works regardless of which option — even Option B's "Ethereum default" would benefit from the post-prepare mismatch check.

### DF-2: `get_token_allowances` look-back window — fixed default, or unbounded with chunking?

**Options:**
- **Option A** *(recommended)*: Fixed default `lookbackBlocks: 1_000_000n`; user can override; tool description names the trade-off ("for deeper scans, increase `lookbackBlocks` — requires paid RPC for large ranges").
- **Option B**: Unbounded by default (`fromBlock: 0`); auto-chunk into 10k-block windows on PublicNode; surface progress via stderr. Pricier-per-call but covers full history.
- **Option C**: Dynamic — query historical-allowance-block on a per-token basis (use the Approval event's earliest `blockNumber` for each token candidate).

**Recommended default: Option A.**

**Why:**
- **Option A is the right MVP** for v1.2: 1M blocks covers ~140 days on Ethereum and ~30 days on L2s; most active allowances are on this timescale. Users with stale allowances older than that explicitly opt into deeper scans via the override.
- **Option B is too expensive by default**: an aggressive agent calling `get_token_allowances` for every chain blows through Alchemy's free tier within a session. The configurable override gives users control.
- **Option C is too complex for v1.2**: the per-token Approval-event scan + cross-check + walk-back-to-earliest-event is a 2x RPC budget multiplier with marginal benefit; revisit at v1.3 if real usage shows incomplete enumeration.

**Cost difference:**
- Option A: ~10-100 RPC calls per `get_token_allowances` invocation depending on `lookbackBlocks` and chain. PublicNode-compatible by default on Ethereum + Arbitrum at the 1M default (chunked into 100 × 10k windows).
- Option B: order-of-magnitude more RPC calls; quota-burning by default; needs explicit user opt-in for "comprehensive" mode.
- Option C: ~2x Option A's RPC budget; complex implementation; marginal value at v1.2.

**Tradeoffs:**
- The `[SET-LEVEL ENUMERATION]` block carries `fromBlock` + `toBlock` verbatim — the user (and v1.3 Inv #14 consumer) sees the scan window explicitly. Option A is transparent about its coverage.
- Verify-phase task: empirical check that 1M blocks captures the practical-allowance scope for the 4 personas (Phase 5 demo). If coverage is too narrow for any persona, increase the default.

**No further forks** — all other placement choices have defensible reasonable-call defaults documented inline. Plan-checker may surface a third fork during their pass (especially around the `LedgerStatus.accountsByChain` shape vs flat array); surface via AskUserQuestion at planning gate if so.

## Project Constraints (from CLAUDE.md)

These directives carry through to every Phase 8 plan:

- **`src/config/contracts.ts`** is the SOT — widen `ChainId` literal-union; populate `Record<ChainId, ContractsForChain>` for 4 new chains; never inline addresses. Regression test asserts byte-identity for all 5 chains × 5 typed slots = 25 address-pin assertions.
- **Tool descriptions are agent routing prompts** — every modified tool's description names the `chain` arg, its required/optional status, and the canonical chain-name list verbatim. Refusal messages name the same canonical list.
- **`prepare_*` always returns a handle**; `PREPARE RECEIPT` carries verbatim args including the `chain` arg.
- **`payloadFingerprint`** computed at prepare time, re-checked at send time. Phase 8 changes ZERO bytes of the preimage; the chainId slot is already load-bearing.
- **`previewToken` + `userDecision: "send"`** required on every `send_transaction` — FROZEN; same three-gate refusal logic.
- **No private key material crosses any boundary** — Phase 8 expands chain coverage but signing remains WC-relayed Ledger blind-sign / clear-sign.
- **`src/config/contracts.ts` SOT** — Phase 8 widens; never inlined per-chain.
- **Stderr for diagnostics, stdout for MCP protocol** — per-chain RPC fallback warnings (Topic 1) go through `src/diagnostics/logger.ts`.
- **Decimal-aware arithmetic** — `parseAmountStrict` (Phase 6) consumed verbatim; chain doesn't change the parsing.
- **ESM spy-affordance indirection** — `src/chains/registry.ts` should export an `_registry` indirection for cross-export internal calls (mirrors `_paths` / `_contracts` / `_aaveChains` patterns). Specifically: any helper that one function in the module calls another for (e.g. `getProviderShorthandUrl` from `getChainClient`) needs the indirection for vi.spyOn coverage.
- **Cryptographic-binding fixtures pinned as hardcoded literals** — Phase 8 adds NO new fixture (Topic 9). The chain-distinctness property test is additive, NOT a fixture.

## Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| READ-40 | All v1.0/v1.1 read tools accept `chain` parameter | unit | `npx vitest run test/get-portfolio-summary.test.ts test/get-token-balance.test.ts test/get-token-metadata.test.ts test/get-lending-positions.test.ts test/get-transaction-status.test.ts test/check-contract-security.test.ts` | ✅ existing tests extended; Wave 0 widens schemas |
| READ-41 | `get_portfolio_summary` omits `chain` → aggregates 5 chains | integration | `npx vitest run test/get-portfolio-summary.cross-chain.test.ts` | ❌ Wave 0 — NEW |
| READ-42 | `resolve_token` with bridged variants | unit | `npx vitest run test/resolve-token.test.ts` | ❌ Wave 0 — NEW |
| READ-43 | `get_token_allowances` enumerates via event-log scan | unit + integration | `npx vitest run test/get-token-allowances.test.ts` | ❌ Wave 0 — NEW |
| READ-44 | `[SET-LEVEL ENUMERATION]` block emission | unit (block-shape) | `npx vitest run test/get-token-allowances.test.ts -t "set-level enumeration"` | ❌ Wave 0 — NEW |
| PREP-40 | Every `prepare_*` accepts `chain` | unit | `npx vitest run 'test/prepare-*.test.ts'` | ✅ existing tests extended |
| PREP-41 | `chain` required (refusal with canonical list) | unit | `npx vitest run 'test/prepare-*.test.ts' -t "chain required"` | ❌ Wave 0 — NEW test cases per prepare tool |
| INST-40 | `RPC_PROVIDER + RPC_API_KEY` wires 5 chains | unit | `npx vitest run test/chains-registry.test.ts -t "provider shorthand"` | ❌ Wave 0 — NEW |
| Plan 08-02 chain-id assertion | Preview + send reject chain mismatch | unit | `npx vitest run test/preview-send.chain-mismatch.test.ts test/send-transaction.chain-mismatch.test.ts` | ❌ Wave 0 — NEW |
| Plan 08-05 WC multi-chain | `requiredNamespaces.eip155.chains` from config | unit + integration | `npx vitest run test/session-manager.multi-chain.test.ts` | ❌ Wave 0 — NEW |

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (verified via package.json `"test": "vitest run"`) |
| Config file | `vitest.config.ts` at repo root |
| Quick run command | `npx vitest run --bail` |
| Full suite command | `npx vitest run` |

### Sampling Rate
- **Per task commit:** `npx vitest run path/to/affected/test.test.ts`
- **Per wave merge:** `npx vitest run` (full suite — Phase 7 baseline ~470 tests)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/chains-registry.test.ts` — per-chain client memoization + provider-shorthand resolution + PublicNode fallback per chain
- [ ] `test/get-portfolio-summary.cross-chain.test.ts` — covers READ-41 (5-chain fan-out + Promise.allSettled + chainErrors[] shape)
- [ ] `test/resolve-token.test.ts` — covers READ-42 (curated bridged-variant table + symbol disambiguation)
- [ ] `test/get-token-allowances.test.ts` — covers READ-43 + READ-44 (event-log scan + multicall cross-check + `[SET-LEVEL ENUMERATION]` block shape)
- [ ] `test/preview-send.chain-mismatch.test.ts` — chain-name mismatch refusal at preview time
- [ ] `test/send-transaction.chain-mismatch.test.ts` — chain-name mismatch refusal at send time
- [ ] `test/session-manager.multi-chain.test.ts` — multi-chain `requiredNamespaces` shape + multi-chain `accounts[]` parsing + `partiallyPaired` defense
- [ ] `test/config-contracts.test.ts` (extend) — 5 chains × 5 typed slots = 25 new address-pin assertions
- [ ] `test/signing-fingerprint.test.ts` (extend) — Fixture J chain-distinctness property test (NOT a literal fixture)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface — MCP stdio transport, no API auth tier |
| V3 Session Management | yes | WC v2 session management — multi-chain accounts widening (Topic 8); existing session-topic cross-check (PAIR-04) covers tamper-detection |
| V4 Access Control | yes | Schema-level enum gate on `chain` arg (Topic 4); `userDecision` + `previewToken` (Phase 4 inherited); chain-name mismatch refusal (Topic 3) |
| V5 Input Validation | yes | JSON-schema `enum` on `chain` field; `getAddress` checksum guard on every Address arg; `parseAmountStrict` decimal guard (Phase 6 inherited) |
| V6 Cryptography | yes | `payloadFingerprint` (Phase 4) + EIP-1559 RLP pre-sign hash (Phase 4) — NEVER hand-rolled keccak or RLP; viem is the SOT. Phase 8 changes ZERO crypto. |

### Known Threat Patterns for {Phase 8 stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent passes wrong `chain` (typo, hallucination) | Spoofing (the agent presents wrong claim) | Schema-level enum gate (Topic 4 Layer 1); chain-name mismatch refusal (Topic 3 Layer 2) |
| Agent prepares on chain X, claims chain Y in user-facing prose | Spoofing | Chain-name mismatch refusal at preview (Topic 3); device-side `Network:` display (out-of-MCP-scope trust anchor) |
| Cross-chain replay attack (signed tx replayed on different chain) | Tampering | EIP-155 chain-id binding in pre-sign hash (Phase 4 inherited); device validates chainId before signing |
| Bridged-token confusion (user sends USDC.e thinking it's native USDC) | Repudiation (user's intent ambiguous) | `resolve_token` surfaces canonical vs bridged variant + `variantNote` text (Topic 6); user reads PREPARE RECEIPT verbatim |
| Allowance enumeration tampering (agent omits a row, claims revoke is complete) | Information Disclosure | `[SET-LEVEL ENUMERATION]` block carries raw row dump in plain text; absence of block on real enumeration response is a tamper signal (READ-44); v1.3 companion skill validates the block shape |
| Stale allowance enumeration (look-back window too narrow, missing rows) | Information Disclosure | Configurable `fromBlock` override (Topic 7); default 1M-block window documented in tool description; verify-phase task confirms coverage |
| Cross-chain RPC compromise (one chain's RPC returns malicious data) | Tampering | Per-chain `rpcDegraded` flag (Topic 2); cross-chain results are tagged per-chain in `get_portfolio_summary` (Topic 5) — user sees which chain reported what |
| WalletConnect partial-pairing silent failure (Ledger Live only approves Ethereum) | Denial of Service / Information Disclosure | `partiallyPaired: true` flag in `LedgerStatus` (Topic 8); stderr warning naming missing chains |
| Multi-chain account confusion (user signs on wrong chain's address) | Spoofing | Per-chain `accountsByChain` map (Topic 8); device-side address display per chain (trust anchor) |

## Sources

### Primary (HIGH confidence)
- [bgd-labs/aave-address-book](https://github.com/bgd-labs/aave-address-book/tree/main/src) — verified per-chain Aave V3 addresses (Topic 1, Topic 4)
- [WalletConnect Specs — Namespaces](https://specs.walletconnect.com/2.0/specs/clients/sign/namespaces) — multi-chain `requiredNamespaces` shape (Topic 8)
- [viem documentation](https://viem.sh/docs/chains/introduction) — chain-object pattern + `viem/chains` exports (Topic 1)
- [EIP-155](https://eips.ethereum.org/EIPS/eip-155) — chain-id replay protection (Topic 3)
- `src/signing/payload-fingerprint.ts:36-49` (in-repo) — empirical chainId preimage placement (Topic 9)
- `src/wallet/session-manager.ts:613-646` (in-repo) — current sessionToStatus mainnet-only refusal (Topic 8)

### Secondary (MEDIUM confidence)
- [Request Finance — USDC vs USDC.e disambiguation](https://help.request.finance/en/articles/8793285) — bridged-variant table source cross-check (Topic 6)
- [Optimism docs — tokenlist](https://docs.optimism.io/app-developers/reference/tokens/tokenlist) — Optimism bridged tokens (Topic 6)
- [Infura networks reference](https://docs.infura.io) — per-chain URL templates (Topic 2)
- [Alchemy supported chains](https://docs.alchemy.com/reference/supported-chains) — per-chain URL templates (Topic 2)
- [Revoke.cash GitHub](https://github.com/RevokeCash/revoke.cash) — open-source allowance-enumeration reference (Topic 7)
- [Etherscan V2 API endpoints — Tokens](https://docs.etherscan.io/etherscan-v2/api-endpoints/tokens) — empirically verified: NO `tokenapprovalchecker` endpoint exists (Topic 7 NEGATIVE finding)

### Tertiary (LOW confidence — flagged for verify-phase)
- Ledger Live multi-chain pairing UI behavior (Topic 8 / A5) — needs empirical device confirmation
- PublicNode `eth_getLogs` 10k-block ceiling (Topic 7 / A4) — common public RPC pattern but not empirically verified for each of 5 chains

## Files Phase 8 Will Touch (preliminary scope inventory)

For the planner's mental model — confirm with pattern-mapper.

**New files:**
- `src/chains/registry.ts` — per-chain client memoization + provider-shorthand wiring (mirror of `src/chains/ethereum.ts` shape, widened)
- `src/tokens/bridged-variants.ts` — curated bridged-token table (NEW occupant of `src/tokens/` shelf)
- `src/tokens/arbitrum-top-50.json`, `polygon-top-50.json`, `base-top-50.json`, `optimism-top-50.json` — per-chain ERC-20 registries (curated; analog of `ethereum-top-50.json`)
- `src/tools/resolve_token.ts` — bridged-variant disambiguation tool (READ-42)
- `src/tools/get_token_allowances.ts` — event-log-scan allowance enumeration (READ-43 + READ-44)
- `test/chains-registry.test.ts` — per-chain client memoization + provider-shorthand + PublicNode fallback per chain
- `test/get-portfolio-summary.cross-chain.test.ts` — fan-out + Promise.allSettled + chainErrors[]
- `test/resolve-token.test.ts` — curated table coverage + symbol disambiguation
- `test/get-token-allowances.test.ts` — event scan + multicall cross-check + `[SET-LEVEL ENUMERATION]` block shape
- `test/preview-send.chain-mismatch.test.ts` — chain-name mismatch refusal at preview
- `test/send-transaction.chain-mismatch.test.ts` — chain-name mismatch refusal at send
- `test/session-manager.multi-chain.test.ts` — multi-chain `requiredNamespaces` + multi-chain `accounts[]`

**Extended files:**
- `src/config/contracts.ts` — widen `ChainId` literal-union to `1 | 42161 | 137 | 8453 | 10`; populate `Record<ChainId, ContractsForChain>` for 4 new entries; add `ChainName` type + `chainIdFromName`/`chainNameFromId` helpers; widen `KNOWN_SPENDERS_ETHEREUM` strategy — recommendation: KEEP `KNOWN_SPENDERS_ETHEREUM` Ethereum-only for v1.2 (v1.3 adds per-chain known-spender tables; the Aave Pool is on the same canonical address `0x794a61358D6845594F94dc1DB02A252b5b4814aD` across 3 chains anyway so cross-chain spender labeling is mostly "Aave V3 Pool — same address on 3 chains"). Phase 8 verify-phase task: confirm `lookupSpender` semantics for non-Ethereum chains; planning recommendation locked: NO per-chain `KNOWN_SPENDERS_*` tables in v1.2; the existing lookup runs across all chains (the canonical addresses are usually shared OR chain-specific-known like Uniswap's per-chain SwapRouter)
- `src/config/env.ts` — add 4 chain-specific RPC URL env-reader helpers; existing `getRpcProvider` + `getRpcApiKey` already shipped (Phase 7 forward-compat) — verify no changes needed
- `src/chains/ethereum.ts` — one-wave compat shim delegating to `getChainClient(1)`; Plan 08-02 deletes the file after callers migrate
- `src/chains/aave-v3.ts` — already takes `chainId: ChainId` arg (`getReservesData(client, chainId)`); only the `ChainId` literal-union widens to support new values (no signature change)
- `src/chains/erc20-scanner.ts` — accept `chainId` arg to drive `getChainClient(chainId)` + `loadTokenRegistry(chainId)` instead of hardcoded mainnet
- `src/tokens/registry.ts` — `loadTokenRegistry(chainId): Token[]` (replaces `loadEthereumTokenRegistry`) — per-chain dispatch over the 5 top-50 JSON files
- `src/pricing/defillama.ts` — `getPrices(coins: Array<{chain: ChainName, address: Address}>)` — per-chain CAIP-2-keyed lookups
- `src/wallet/session-manager.ts` — drive `REQUIRED_NAMESPACES.eip155.chains` from configured chains; widen `sessionToStatus` for multi-chain; add `accountsByChain` + `activeChainId` to `LedgerStatus`; add `partiallyPaired` flag
- `src/tools/get_portfolio_summary.ts` — cross-chain fan-out via `Promise.allSettled` (READ-41)
- `src/tools/get_token_balance.ts` + `get_transaction_status.ts` + `get_token_metadata.ts` + `get_lending_positions.ts` + `simulate_position_change.ts` + `check_contract_security.ts` — accept `chain` arg; thread through to `getChainClient(chain)` (READ-40)
- `src/tools/prepare_native_send.ts` + `prepare_token_send.ts` + `prepare_token_approve.ts` + `prepare_revoke_approval.ts` + `prepare_weth_unwrap.ts` + `prepare_aave_supply.ts` + `prepare_aave_withdraw.ts` — accept `chain` arg; thread to `record.tx.chainId`; widen PREPARE RECEIPT template with `{CHAIN}` slot (PREP-40 + PREP-41)
- `src/tools/preview_send.ts` — accept optional `chain` arg + chain-name mismatch refusal (Topic 3 Layer 2)
- `src/tools/send_transaction.ts` — accept optional `chain` arg + same chain-name mismatch refusal
- `src/tools/set_active_account.ts` — accept optional `chain` arg for cross-chain scope (Topic 8)
- `src/tools/get_vaultpilot_config_status.ts` — surface `rpcProvider` + per-chain `customRpcConfigured` + `configuredChains` (5 booleans)
- `src/signing/blocks.ts` — widen every `PREPARE_RECEIPT_TEMPLATE` with `{CHAIN}` slot (uniform append); add `CHAIN_ID_MISMATCH_REFUSAL_TEMPLATE` for the mismatch refusal text
- `src/signing/error-codes.ts` — add `CHAIN_ID_MISMATCH` to the locked union (15 → 16 codes)
- `test/config-contracts.test.ts` — 25 new address-pin assertions (5 chains × 5 typed slots) + `KNOWN_SPENDERS_ETHEREUM` semantics test
- `test/signing-fingerprint.test.ts` — Fixture J chain-distinctness property test
- Per-tool tests — extend with `chain` arg gate cases (JSON-schema enum + chain-name mismatch refusal at preview/send)

**Not touched (FROZEN):**
- `src/signing/payload-fingerprint.ts` — preimage shape invariant; chainId slot already widens to any integer
- `src/signing/presign-hash.ts` — EIP-1559 RLP already chain-aware via viem.serializeTransaction
- `src/signing/handle-store.ts` — state machine unchanged; `record.tx.chainId` field already exists
- `src/tools/send_transaction.ts` THREE-GATE logic — additive chain-mismatch check is BEFORE the three gates; the gates themselves are byte-identical
- `src/signing/simulation.ts` — wide `eth_call` simulation already takes the configured client (Phase 6 DF-1); plan should verify it switches client per chain via the new `getChainClient(chainId)`

## Open Questions (RESOLVED)

All resolved at planning gate (researcher reasonable-call locks per Phase 5/6/7 pattern). Items deferred to verify-phase listed in Assumptions Log (A4–A6 specifically: PublicNode log-range ceiling, Ledger Live UI behavior, WC multi-chain pairing behavior).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `viem` | All chain clients + log scanning | ✓ | 2.48.11 | — |
| `@walletconnect/sign-client` | Multi-chain pairing | ✓ | 2.23.9 | — |
| `vitest` | All unit + integration tests | ✓ | (per package.json) | — |
| PublicNode RPCs (5 chains) | Per-chain fallback | ✓ | n/a | — (configured RPC overrides take precedence) |
| Alchemy / Infura RPCs | Per-chain prod config | optional | n/a | PublicNode |
| Ledger device (multi-chain pairing) | Verify-phase task | required for verify | n/a | Documented as user prerequisite |
| Ledger Live with L2 networks enabled | Verify-phase task | required for verify | n/a | Documented as user prerequisite |

**No missing dependencies block planning.** Verify-phase tasks require user-side Ledger + LL configuration — surfaced in Phase 8 ship-gate runbook.

## Metadata

**Confidence breakdown:**
- Per-chain Aave V3 addresses (Topic 1): HIGH — bgd-labs/aave-address-book + Etherscan cross-verified for all 5 chains
- Per-chain RPC architecture (Topics 1, 2): HIGH — direct port of Phase 2's `src/chains/ethereum.ts` pattern per-chain
- Chain-id flow through trust pipeline (Topics 3, 9): HIGH — empirical verification of preimage shape; FROZEN-area zero-diff confirmed
- `chain` parameter threading (Topic 4): HIGH — bounded-diff mechanical extension of Phase 6/7 patterns
- Cross-chain portfolio aggregation (Topic 5): MEDIUM-HIGH — Promise.allSettled is standard; per-chain top-50 JSON files are curated work not yet done
- Bridged-token table (Topic 6): MEDIUM — addresses verified from multiple sources; coverage is "common ~95% of disambiguation queries" — long-tail uncovered
- `get_token_allowances` enumeration (Topic 7): MEDIUM — event-log scan strategy is standard (Revoke.cash precedent); Etherscan V2 negative finding shifts strategy to MCP-side enumeration; PublicNode range ceiling assumed
- WalletConnect multi-chain (Topic 8): MEDIUM — WC specs verified; Ledger Live behavior assumed based on physical-device testing report in ROADMAP
- Cryptographic-binding implications (Topic 9): HIGH — zero diff to FROZEN pipeline; preimage shape verified
- Defense-in-depth chain mismatch (Topic 10): HIGH — additive layer above existing fingerprint defense; clear threat-model mapping

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days for stable; verify Etherscan V2 token-approvals endpoint hasn't been added; verify Ledger Live multi-chain pairing behavior at verify-phase)
