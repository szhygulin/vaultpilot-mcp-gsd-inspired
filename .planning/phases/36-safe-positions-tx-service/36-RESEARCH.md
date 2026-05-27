# Phase 36: Safe positions + Tx Service API integration + `get_safe_positions` — Research

**Researched:** 2026-05-27
**Domain:** Safe (Gnosis) multisig read surface + Safe Transaction Service HTTP client + on-chain Singleton cross-check
**Confidence:** HIGH — every Safe Tx Service endpoint path is verified against the live `@safe-global/api-kit` source on `main` (SafeApiKit.ts); every singleton address verified against the in-tree-published `safe-deployments` repo JSON. ONE load-bearing finding contradicts CONTEXT.md and is flagged explicitly: the Safe Tx Service URL pattern in CONTEXT.md (`https://safe-transaction-<chain>.safe.global`) has been migrated to `https://api.safe.global/tx-service/<shortname>/api` and the public free-tier URL now redirects (308) AND requires an API key for any meaningful production usage.

## Summary

Phase 36 ships the read-side foundation for v2.5 Safe multisig support: two MCP tools (`get_safe_positions`, `get_safe_transaction`) + one new external HTTP client (`src/clients/safe-tx-service.ts`) + one new on-chain reader module (`src/chains/safe.ts`) + a `SafeContracts` SOT extension in `src/config/contracts.ts` + a `SAFE_SINGLETON_DISPATCH_ALLOWLIST` arm in `src/security/canonical-dispatch.ts`. The on-chain cross-check (owners/threshold/nonce/version/modules read via multicall against the Safe Singleton ABI) is the load-bearing concept — it is what makes the v2.5 trust pipeline defensible in Phase 37+ (the user trusts what the Ledger screen shows ONLY because the read surface in Phase 36 has already proven on-chain truth independent of Tx Service).

The 5-arm discriminated union for the HTTP client mirrors `etherscan.ts` exactly: `ok | not-found | rate-limited | error | unsupported-chain`. The 5th arm (`unsupported-chain`) short-circuits before any network call. Cache + per-session call counter + `fetch`-stub test seam all follow the established `etherscan.ts` / `fourbyte.ts` patterns. NO new npm package is strictly required — addresses are pinnable as literals — but `@safe-global/safe-deployments@1.37.56` is a clean (slopcheck `[OK]`, 3+ years old, safe-global official org, minimal `semver` dep) optional source for the SOT seed values.

Two load-bearing findings the planner MUST address before writing plans:

1. **Safe Tx Service URL migration (CONTRADICTS CONTEXT.md):** The five endpoints in CONTEXT.md (`https://safe-transaction-{mainnet,arbitrum,polygon,base,optimism}.safe.global`) issue 308 redirects to `https://api.safe.global/tx-service/{shortname}/api/v1/...` and the new endpoint family **requires an API key (`Authorization: Bearer X`)** for production usage. The unauthenticated tier is rate-limited to 2 req/s + 5,000 monthly requests total. Plan 36-01 must (a) use the new URL pattern, (b) add a lazy `SAFE_TX_SERVICE_API_KEY` env probe + `safeTxServiceApiKeyPresent` boolean in `get_vaultpilot_config_status`, (c) emit a once-per-session stderr NOTICE when the key is absent (mirrors `etherscanApiKeyPresent` precedent), (d) still degrade gracefully (`{ kind: "error", message: ... }`) when the key is absent + a 401 lands.

2. **Safe v1.3.0 has TWO live singletons (L1 vs L2 variant):** The L1 singleton `0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552` is the original GnosisSafe v1.3.0; the L2 variant `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` (GnosisSafeL2) emits per-tx events for L2 indexers and is the dominant deployment on Polygon/Arbitrum/Base/Optimism. Both addresses must be in `SAFE_SINGLETON_DISPATCH_ALLOWLIST[chain]` per chain where both exist. v1.4.1 has the same L1/L2 split (`0x41675C099F32341bf84BFc5382aF534df5C7461a` L1, `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` L2). That's up to **4 singleton addresses per chain** in the allowlist (researcher-confirmed: Phase 37 EIP-712 typed-data signing routes the same way for both L1 and L2 variants — same domain separator structure).

**Primary recommendation:** Implement the 2-plan structure from CONTEXT.md verbatim, with the URL migration + auth-header threading rolled into Plan 36-01's scope (no new plan needed — the change is mechanical and stays within the client-shape locked by CONTEXT). Do NOT install `@safe-global/safe-deployments` as a runtime dep — pin addresses as literals in `src/config/contracts.ts` (matches Aave V3 / Uniswap V3 / Curve SOT discipline). Researcher consulted the `safe-deployments` JSON files via GitHub `raw.githubusercontent.com` to capture the literals — provenance documented inline in the proposed SOT table.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Two read-only tools:** `get_safe_positions({ wallet, chain? })` (chain OPTIONAL — fan-out across configured chains) + `get_safe_transaction({ chain, safeAddress, safeTxHash })` (chain REQUIRED — a safeTxHash is chain-scoped).
- **Multi-chain default scope:** `get_safe_positions` fans out via `Promise.allSettled` + per-chain `AbortController` 10s timeout (mirrors Phase 8 `get_portfolio_summary` pattern). Per-chain failures surface in `degradedChains: ChainId[]` + `degradedReasons: { [chainId]: "rate-limited" | "error" | "timeout" }`. Partial results never throw.
- **Safe Tx Service per-chain endpoint registry:** Hardcoded per-chain table in `src/clients/safe-tx-service.ts` (no env-override at this phase). 5-arm discriminated union: `ok | not-found | rate-limited | error | unsupported-chain`. Per-session call counter (soft ceiling ~30, researcher tunes). Never throws. `fetch`-based with `vi.stubGlobal("fetch", …)` test seam. Per-`(chainId, safeAddress)` Safe-info LRU (max ~32) + per-`(chainId, safeTxHash)` SafeTx LRU (max ~64), both reset on MCP server restart.
- **Safe Singleton + ProxyFactory address SOT:** New `SafeContracts` sub-table in `src/config/contracts.ts`, matching the `AaveV3Contracts` / `UniswapV3Contracts` / `CurvePools` curated-registry pattern. Per-chain fields: `singleton`, `proxyFactory`, `multiSend`, `multiSendCallOnly`, `signMessageLib`, `compatibilityFallbackHandler`.
- **Canonical-dispatch Safe arm:** New `SAFE_SINGLETON_DISPATCH_ALLOWLIST` per-chain table in `src/security/canonical-dispatch.ts`. Allowlist entries: every `singleton` address from `SafeContracts` per chain (researcher confirms — see Finding #2 in Summary — up to 4 singletons per chain: v1.3.0-L1 + v1.3.0-L2 + v1.4.1-L1 + v1.4.1-L2).
- **Safe-finding strategy:** `GET /api/v1/owners/{address}/safes/` enumeration + mandatory on-chain cross-check via multicall against Singleton ABI (`getOwners()`, `getThreshold()`, `nonce()`, `getModulesPaginated(SENTINEL, 100)`, `VERSION()`). Per-Safe output uses the on-chain values, not Tx Service values. Mismatch → `txServiceDrift: true` + `driftReasons: string[]`. Wallet-not-owner Safes silently dropped.
- **Pending-transactions surface depth (compact vs full):** `get_safe_positions` per-Safe `pendingTransactions[]` is COMPACT (only `safeTxHash + nonce + collectedSignatures + requiredSignatures + isExecutable`). Length-capped at 20; larger queues surface `pendingTransactionsTruncated: true` + `pendingTransactionsTotalCount: number`. Full decoded operation only via explicit `get_safe_transaction`.
- **Module list surface depth:** `enabledModules[]` from `getModulesPaginated(SENTINEL, 100)`. Addresses only at Phase 36. NO `check_contract_security` integration (deferred to Phase 38). Module sentinel address `0x0...001` filtered out.
- **`get_safe_transaction` shape:** Full Safe Tx Service tx record. Operation discriminator surfaced as `operation: "call" | "delegatecall"` (NOT raw 0/1). `confirmations[]` returned as-is. Best-effort `decodedOperation` via per-session ABI cache from Phase 35 (`fetchEtherscanAbi` / `getCachedEtherscanAbi`) — HIT → `decodedFunctionName(args...)` string. MISS → `null` (no blocking probe).
- **Safe ABI sourcing:** `src/chains/safe.ts` — new per-chain Safe state reader. Imports Singleton ABI from `viem.parseAbi` literal (precedent: `src/chains/aave-v3.ts`). Phase 36 surface: `getOwners() / getThreshold() / nonce() / VERSION() / getModulesPaginated(address,uint256)`.
- **NO cryptographic-binding fixture at Phase 36:** Phase 36 is read-only. NO `payloadFingerprint` / `presignHash` surface added. Phase 37 introduces Fixture SAFE-A (EIP-712 typed-data digest).

### Claude's Discretion

- Internal helper names (`SafeTxServiceClient`, `SafeStateReader`, `crossCheckSafe`, `decodeSafeTxOperation`) — at executor's call.
- Exact LRU sizes (~32 / ~64); per-session call ceiling (~30) — researcher / executor tunes.
- Whether `get_safe_positions` surfaces a top-level `txServiceConfigured: boolean` field. **Researcher recommendation (RESOLVED, LIFTS-RELATED):** YES — surface `safeTxServiceApiKeyPresent: boolean` at the top of the response AND in `get_vaultpilot_config_status`. This becomes load-bearing in v2.5 once the public-tier sunset takes effect (the user needs to see at-a-glance whether the response set is bounded by 2 req/s + 5k/month limits or runs on a paid tier). Mirrors `etherscanApiKeyPresent` pattern from Plan 07-04 verbatim.
- Exact field ordering in per-Safe output (cosmetic).
- Whether the canonical-dispatch Safe arm uses flat `Set<Address>` or `Address[]` — **researcher recommendation (RESOLVED):** mirror the existing `buildPerChainAllowlist(chainId)` shape in `src/security/canonical-dispatch.ts:117-221` (flat Set built from a per-chain SOT helper call), the dominant convention.

### Deferred Ideas (OUT OF SCOPE)

- SafeTx hash computation (Phase 37)
- Typed-data signing flow via Ledger ETH app (Phase 37)
- `prepare_safe_tx_propose / _approve / _execute` (Phase 37)
- `submit_safe_tx_signature` (Phase 37)
- `enableModule` + `delegateCall: true` hard-trigger second-LLM check (Phase 38)
- Safe creation via ProxyFactory (v3.x — users create Safes via the Safe UI)
- ENS-resolved owner labels in `get_safe_positions` output (v3.x portfolio enhancement)
- LP-style aggregate Safe portfolio value (v3.x)
- Private Safe Tx Service deployments / `SAFE_TX_SERVICE_URL` env override (v3.x)
- Safe v1.1.x and older — NOT supported; surfaces as `txServiceDrift: true` + `driftReasons: ["unsupported-version"]`
- `check_contract_security` integration on module addresses (Phase 38)
- Persistent (cross-session) Safe-info cache (per-session LRU suffices)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SAFE-01 | `get_safe_positions({ wallet, chain? })` returns Safes where wallet is an owner; per-Safe surfaces address + owners[] + threshold + nonce + pendingTransactions[] + enabledModules[] | Topic 1 (Safe Tx Service v1 endpoints), Topic 3 (Singleton ABI + SENTINEL), Topic 4 (pagination + executed=false), Topic 6 (txServiceDrift mechanics), Topic 10 (1-of-1 + k-of-n) |
| SAFE-02 | `get_safe_transaction({ chain, safeAddress, safeTxHash })` returns full tx detail + collected signatures + required threshold | Topic 1 (`/v1/multisig-transactions/{hash}/`), Topic 7 (confirmations shape), Topic 8 (operation discriminator + gasToken surfacing), Topic 9 (best-effort ABI decode via Phase 35 cache) |
| SAFE-03 | Safe Tx Service API client (`src/clients/safe-tx-service.ts`) mirrors `etherscan.ts` shape per-chain (5 endpoints documented at safe-global.com) | Topic 1 (endpoint URL migration to `api.safe.global/tx-service/{shortname}/api`), Topic 4 (per-session rate limits + auth header), `src/clients/etherscan.ts:33-100` (mirror pattern) |
| SAFE-04 | Safe ProxyFactory + Singleton addresses sourced from `src/config/contracts.ts` per-chain table; canonical-dispatch allowlist Safe arm wiring | Topic 2 (4 singleton variants per chain), `src/config/contracts.ts:741` (`UniswapV3Contracts` mirror pattern), `src/security/canonical-dispatch.ts:117-221` (allowlist builder pattern) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Safe Tx Service HTTP client | `src/clients/safe-tx-service.ts` (NEW; network boundary) | — | Mirrors `etherscan.ts` / `fourbyte.ts` pattern; never-throws contract; cache + rate counter live here; `fetch`-stub test seam at the network boundary |
| Per-session Safe info + SafeTx LRU caches | `src/clients/safe-tx-service.ts` (module-scope `Map`s) | — | Process-scoped; cache key `${chainId}:${safeAddress}` for Safe-info, `${chainId}:${safeTxHash}` for SafeTx detail — matches Etherscan multi-chain cache key shape |
| Safe Singleton state reader | `src/chains/safe.ts` (NEW) | `src/chains/registry.ts` (`getChainClient` consumer) | Mirror of `src/chains/aave-v3.ts` shape — parseAbi struct refs, ESM `_safeChains` spy indirection per CLAUDE.md convention |
| On-chain cross-check vs Tx Service | `src/tools/get_safe_positions.ts` (NEW; orchestration tier) | `src/chains/safe.ts` (data) + `src/clients/safe-tx-service.ts` (data) | Composition layer — fan-out across chains, multicall on-chain reads, compare against Tx Service values, set `txServiceDrift` flag, never throws |
| Canonical-dispatch Safe Singleton allowlist | `src/security/canonical-dispatch.ts` (NEW per-chain SOT-getter call + builder extension) | `src/config/contracts.ts` (`SafeContracts` SOT) | Layer 0.5 (FROZEN gate, additive per-chain extension) — mirror Phase 32/33/34 dispatch arm additions (uniswapEntries / uniswapV3LpEntries / curveEntries spread into the per-chain Set) |
| `SafeContracts` SOT extension | `src/config/contracts.ts` (NEW sibling sub-table) | — | Mirror `UniswapV3Contracts` / `CurvePools` shape; `Partial<Record<ChainId, SafeContracts>>`; researcher-confirmed addresses from safe-deployments JSON |
| `get_safe_positions` MCP tool | `src/tools/get_safe_positions.ts` (NEW) | `src/clients/safe-tx-service.ts` + `src/chains/safe.ts` + `src/chains/registry.ts` | Closest analog: `src/tools/get_lending_positions.ts` (Promise.allSettled fan-out, per-position row builder, sources summary) |
| `get_safe_transaction` MCP tool | `src/tools/get_safe_transaction.ts` (NEW) | `src/clients/safe-tx-service.ts` + (optional) `src/clients/etherscan.ts:getCachedEtherscanAbi` | Read-only single-Safe-tx detail; best-effort calldata decode via existing per-session ABI cache from Phase 35 |
| Tool registration | `src/tools/index.ts` (`registerTool` add) | — | Standard 2-tool add at the v2.5 register-all surface |

## Project Constraints (from CLAUDE.md)

| Constraint | Application to Phase 36 |
|------------|------------------------|
| `prepare_*` always returns a handle | NOT APPLICABLE — Phase 36 ships TWO `get_*` (read-only) tools. No handle creation. |
| `PREPARE RECEIPT` block in every `prepare_*` response | NOT APPLICABLE — no prepare tools. |
| `payloadFingerprint` computed at prepare time | NOT APPLICABLE — no prepare tools, no signing surface added. Phase 37 introduces Fixture SAFE-A. |
| `previewToken` + `userDecision: "send"` required on `send_transaction` | NO CHANGE — Phase 36 does NOT touch `send_transaction.ts`. FROZEN three-gate region unchanged. |
| No private key material crosses any boundary | NO CHANGE — Phase 36 is read-only; never touches signature material. |
| `src/config/contracts.ts` is the single source of truth | EXTENDED — new `SafeContracts` sub-table; getters per CLAUDE.md convention (`getSafeSingleton(chainId)`, `getSafeProxyFactory(chainId)`, etc.). NEVER inline a Safe contract address in tool implementations. |
| Stderr for diagnostics, stdout for MCP protocol | All new diagnostics route through `src/diagnostics/logger.ts` (`log()`). NEVER `console.*`. |
| Decimal-aware arithmetic (token amounts as strings) | NOT APPLICABLE — Phase 36 doesn't deal with token amounts (read-only Safe metadata). |
| ESM spy-affordance for cross-export internal calls | `src/chains/safe.ts` exports `_safeChains = { getSafeInfo, ... }` mirror of `_aaveChains`. For `src/clients/safe-tx-service.ts`, test seam is `vi.stubGlobal("fetch", …)` at the OUTER edge per CLAUDE.md "external network clients" convention — NO internal indirection needed. |
| Cryptographic-binding fixtures pinned as hardcoded literals | NOT APPLICABLE at Phase 36 (no fingerprint shape added). Phase 37 introduces SAFE-A (EIP-712 typed-data digest) — first cryptographic fixture in v2.5. |
| FROZEN cryptographic-binding chain | UNCHANGED — `payload-fingerprint.ts` / `presign-hash.ts` / `handle-store.ts` / `send_transaction.ts` three gates all FROZEN. Phase 36 touches `preview_send.ts` ZERO times. Asserted via `git diff` empty for those paths. |

## Standard Stack

### Core (already in tree)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `viem` | `^2.48.0` (in tree per package.json) | `parseAbi` struct refs for Singleton ABI; `PublicClient.multicall` for batched on-chain reads; `Address` type | Project EVM client; matches Aave V3 / Uniswap V3 / Curve reader modules |
| `zod` (via JSON-Schema) | (in tree) | Input schema for `get_safe_positions` + `get_safe_transaction` | Match existing tool schemas (`get_lending_positions.ts:73-90`) — JSON-Schema object literal pattern |

### Supporting (already in tree)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `src/chains/registry.ts:getChainClient` | n/a | Per-chain memoized PublicClient for multicall reads | `get_safe_positions` consumer |
| `src/chains/registry.ts:isPublicNodeFallback` | n/a | Surfaces `rpcDegraded: true` when public-node fallback is in use | `get_safe_positions` consumer (mirror Aave/Compound surfacing) |
| `src/clients/etherscan.ts:getCachedEtherscanAbi` | n/a | Per-session ABI cache (Phase 35 surface) for best-effort SafeTx decode | `get_safe_transaction` calldata decode — cache HIT is sub-ms (zero network I/O); MISS surfaces `decodedOperation: null` |
| `src/diagnostics/logger.ts:log` | n/a | stderr-only diagnostics | All new client logs |
| `src/config/contracts.ts:chainIdFromName / chainNameFromId` | n/a | ChainName ↔ ChainId conversion | Chain-arg schema enum decoding |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hardcoded `SafeContracts` literals in `contracts.ts` | `@safe-global/safe-deployments@1.37.56` npm dep | Package is clean ([OK] slopcheck, 3 yrs old, official safe-global org, 578 transitive deps via `semver`-only direct dep is misleading — the install pulls a full SDK transitive graph). Hardcoded literals match Aave/Uniswap/Curve discipline + give us EIP-55 module-load integrity check via `getAddress(...)` wrap. **Recommendation: hardcoded literals.** Researcher fetched JSON from `safe-deployments` repo on `main` (verified 2026-05-27) for the seed values. |
| Single LRU cache for Safe-info + SafeTx | Two separate LRU caches | Two caches keep the surface bounded; SafeTx detail is larger than Safe info (multiple sig blobs); separate caps (~32 Safes vs ~64 txs) match access patterns. CONTEXT pre-locks. |
| `getParsedTokenAccountsByOwner` / cache-only / on-chain-only enumeration | Tx Service `/v1/owners/{address}/safes/` + on-chain cross-check | The on-chain alternative (scan every Safe-creation event across all 5 chains) is infeasible — Tx Service is the only practical enumeration source. Cross-check the values it returns against on-chain Singleton ABI; defends against compromised Tx Service. CONTEXT pre-locks the dual-source pattern. |
| Auth-header threading in client | Skip API key entirely | Public tier sunset on 2025-10-27 + 2 req/s + 5k/month cap → at v2.5 ship, users with > 1 active Safe + medium tx history will hit rate limits within a few read calls. Threading the auth header is a one-line lazy `getSafeTxServiceApiKey()` env probe + conditional `Authorization: Bearer ${key}` — strictly safer than skipping. **Recommendation: thread it now, in Plan 36-01.** |

**Installation:**

No new runtime npm packages required.

**Version verification:** None new — Phase 36 reuses `viem` already pinned in package.json.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@safe-global/safe-deployments` | npm | 3+ yrs (created 2023-02-23) | High (Safe SDK foundational) | https://github.com/safe-global/safe-deployments | [OK] | **NOT INSTALLED** — researcher fetched JSON via `raw.githubusercontent.com` and pinned literals in `src/config/contracts.ts`. Slopcheck performed as defensive due-diligence even though no install. |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

Provenance for the SOT literals: all 24 addresses (4 singleton variants × 5 chains + ProxyFactory v1.3.0 + ProxyFactory v1.4.1 + 4 MultiSend variants + 4 MultiSendCallOnly variants + 2 SignMessageLib + 2 CompatibilityFallbackHandler; deduped across canonical=eip155 to one slot per role) sourced from `github.com/safe-global/safe-deployments@main/src/assets/v1.{3.0,4.1}/*.json` via WebFetch, captured in Section "Standard Stack: SafeContracts SOT Literals" below.

## Architecture Patterns

### System Architecture Diagram

```
Agent (Claude Code / Cursor / Desktop)
   │ stdio (MCP protocol)
   ▼
┌─────────────────────────────────────────────────────────────────┐
│ Phase 36 surfaces (NEW)                                         │
│                                                                 │
│  get_safe_positions(wallet, chain?)                             │
│    │                                                            │
│    ├─→ if chain: single-chain path                              │
│    └─→ else: Promise.allSettled across configuredChains         │
│         │                                                       │
│         ▼                                                       │
│    Per-chain leg (with AbortController 10s timeout):            │
│      1. safeTxService.getSafesByOwner(chainId, wallet)          │
│           → { kind: "ok", safes: Address[] }                    │
│      2. For each safe: multicall against Singleton ABI          │
│           getOwners / getThreshold / nonce / VERSION /          │
│           getModulesPaginated(SENTINEL=0x...001, 100)           │
│      3. safeTxService.getPendingTransactions(chainId, safe)     │
│           → top 20 by nonce, executed=false                     │
│      4. Compare Tx-Service-Safe-info vs on-chain reads          │
│           → set txServiceDrift + driftReasons per Safe          │
│      5. Filter Safes where on-chain getOwners() !includes wallet│
│                                                                 │
│  get_safe_transaction(chain, safeAddress, safeTxHash)           │
│    │                                                            │
│    ▼                                                            │
│    safeTxService.getMultisigTransaction(chainId, safeTxHash)    │
│      → { kind: "ok", tx: SafeMultisigTransactionResponse }      │
│    Best-effort decoded:                                         │
│      getCachedEtherscanAbi(chainId, tx.to)                      │
│        HIT  → viem.decodeFunctionData → decodedOperation string │
│        MISS → decodedOperation: null                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────────┐
│ Foundation extensions (NEW)                                     │
│                                                                 │
│ src/clients/safe-tx-service.ts (NEW)                            │
│   getSafesByOwner(chainId, wallet) → SafesByOwnerResult         │
│   getSafeInfo(chainId, safe) → SafeInfoResult                   │
│   getPendingTransactions(chainId, safe, opts?) → PendingResult  │
│   getMultisigTransaction(chainId, safeTxHash) → SafeTxResult    │
│     │                                                           │
│     ▼ 5-arm DU: ok | not-found | rate-limited | error |         │
│                  unsupported-chain                              │
│     Module-scope state:                                         │
│       SAFE_TX_SERVICE_ENDPOINTS: Record<ChainId, string>        │
│         (hardcoded — api.safe.global/tx-service/{sn}/api)       │
│       safeInfoCache: Map<`${chainId}:${address}`, SafeInfoResult>│
│         (LRU max ~32)                                           │
│       safeTxCache: Map<`${chainId}:${hash}`, SafeTxResult>      │
│         (LRU max ~64)                                           │
│       agentSessionCallCount (soft ceiling ~30)                  │
│     Auth: lazy getSafeTxServiceApiKey() env → Bearer header     │
│                                                                 │
│ src/chains/safe.ts (NEW)                                        │
│   safeSingletonAbi = parseAbi([...])  // Phase 36 minimal       │
│   getOnchainSafeInfo(client, chainId, safe) → OnchainInfo       │
│     // multicall: getOwners + getThreshold + nonce + VERSION    │
│   getEnabledModules(client, chainId, safe) → Address[]          │
│     // getModulesPaginated(SENTINEL, 100), drop sentinel        │
│   export const _safeChains = { getOnchainSafeInfo, getEnabled… }│
│                                                                 │
│ src/config/contracts.ts (EXTENDED)                              │
│   SAFE_CONTRACTS_RAW: Partial<Record<ChainId, SafeContracts>>   │
│   getSafeSingletonAddresses(chainId) → Address[] (1..4 per chain)│
│   getSafeProxyFactoryAddress(chainId) → Address | null          │
│   ... + getters per role                                        │
│                                                                 │
│ src/security/canonical-dispatch.ts (EXTENDED, ADDITIVE)         │
│   getSafeSingletonAddresses(chainId)[*] spread into per-chain   │
│   Set inside buildPerChainAllowlist (existing builder)          │
│   Bump per-chain entry counts: Ethereum 40→44, Arb 21→25,       │
│   Polygon 22→26, Base 8→12, Optimism 17→21                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── clients/
│   ├── safe-tx-service.ts         # NEW — 5-arm DU HTTP client
│   ├── etherscan.ts               # UNCHANGED (consumer reads getCachedEtherscanAbi for SafeTx decode)
│   ├── fourbyte.ts                # UNCHANGED
│   └── ...
├── chains/
│   ├── safe.ts                    # NEW — Singleton ABI reader (mirror aave-v3.ts)
│   ├── registry.ts                # UNCHANGED (getChainClient consumer)
│   ├── aave-v3.ts                 # UNCHANGED (pattern template)
│   └── ...
├── config/
│   └── contracts.ts               # EXTENDED — SafeContracts sub-table + getters
├── security/
│   └── canonical-dispatch.ts      # EXTENDED — Safe Singleton arm wired into buildPerChainAllowlist
├── tools/
│   ├── get_safe_positions.ts      # NEW — multi-chain fan-out + cross-check
│   ├── get_safe_transaction.ts    # NEW — single-tx detail + best-effort decode
│   ├── get_vaultpilot_config_status.ts  # EXTENDED — add safeTxServiceApiKeyPresent boolean
│   ├── index.ts                   # EXTENDED — registerTool for both new tools
│   └── ...
└── config/
    └── env.ts                     # EXTENDED — getSafeTxServiceApiKey() lazy reader

test/
├── clients-safe-tx-service.test.ts        # NEW — fetch-stub 5-arm coverage + cache + ceiling
├── chains-safe.test.ts                    # NEW — parseAbi struct refs + multicall mock
├── security-canonical-dispatch-safe.test.ts # NEW — property test: every singleton in allowlist
├── integration/
│   ├── safe-positions.test.ts             # NEW — 1-of-1, 2-of-3, drift-fixture Safes
│   └── safe-get-transaction.test.ts       # NEW — call + delegatecall + decoded + undecoded
└── ...
```

### Pattern 1: Never-throws external HTTP client with 5-arm DU + cache + per-session rate counter

**What:** External network client (Safe Tx Service) wrapped in a `Promise`-returning function that never throws. Returns a discriminated union the caller pattern-matches.

**When to use:** Any external network dependency in this codebase. Mandatory per CLAUDE.md (`no silent fallbacks` rule).

**Example (template — adapt from `src/clients/etherscan.ts:46-65`):**

```typescript
// Source: src/clients/etherscan.ts (verbatim shape; verified in-tree 2026-05-27)
export type SafeInfoResult =
  | { kind: "ok"; safe: SafeInfoResponseDecoded }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string; retryAfterMs?: number }
  | { kind: "error"; message: string }
  | { kind: "unsupported-chain"; chainId: ChainId };

const safeInfoCache = new Map<string, SafeInfoResult>();
let agentSessionCallCount = 0;
const PER_SESSION_CALL_LIMIT = 30; // CONTEXT discretion; tune at execute time

export async function getSafeInfo(
  chainId: ChainId,
  safe: Address,
): Promise<SafeInfoResult> {
  const endpoint = SAFE_TX_SERVICE_ENDPOINTS[chainId];
  if (!endpoint) return { kind: "unsupported-chain", chainId };

  const cacheKey = `${chainId}:${safe}`;
  const cached = safeInfoCache.get(cacheKey);
  if (cached) return cached;

  if (agentSessionCallCount >= PER_SESSION_CALL_LIMIT) {
    return { kind: "rate-limited", message: "per-session limit exceeded; resets at MCP restart" };
  }
  agentSessionCallCount += 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAFE_TX_SERVICE_TIMEOUT_MS);
  const apiKey = getSafeTxServiceApiKey();  // lazy env probe; returns string | undefined
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let result: SafeInfoResult;
  try {
    const resp = await fetch(`${endpoint}/v1/safes/${safe}/`, { headers, signal: controller.signal });
    if (resp.status === 404) {
      result = { kind: "not-found" };
    } else if (resp.status === 429) {
      const retryAfter = resp.headers.get("retry-after");
      result = {
        kind: "rate-limited",
        message: `Safe Tx Service returned HTTP 429${retryAfter ? ` (retry-after: ${retryAfter})` : ""}`,
        retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : undefined,
      };
    } else if (!resp.ok) {
      result = { kind: "error", message: `Safe Tx Service returned HTTP ${resp.status}` };
    } else {
      // ... parse JSON, validate shape, return { kind: "ok", safe: ... }
    }
  } catch (err) {
    // AbortError + network unreachable + JSON parse failure all → error arm verbatim
    result = { kind: "error", message: ... };
  } finally {
    clearTimeout(timer);
  }
  cacheInsert(cacheKey, result);
  return result;
}
```

### Pattern 2: parseAbi struct-ref Singleton ABI module

**What:** Minimal ABI surface defined via `viem.parseAbi` with struct refs; consumed by the read tool via `_safeChains` spy indirection.

**When to use:** Any new per-chain on-chain reader module. Mirrors `src/chains/aave-v3.ts:37-43` exactly.

**Example:**

```typescript
// Source: src/chains/aave-v3.ts (pattern verbatim 2026-05-27); src/chains/safe.ts will mirror.
import { type Address, type PublicClient, parseAbi } from "viem";

export const SAFE_SENTINEL_MODULES: Address = "0x0000000000000000000000000000000000000001";

export const safeSingletonAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] modules, address next)",
]);

export async function getOnchainSafeInfo(
  client: PublicClient,
  chainId: ChainId,
  safe: Address,
): Promise<{ owners: readonly Address[]; threshold: bigint; nonce: bigint; version: string }> {
  // multicall: 4 parallel reads against the Singleton (proxied through `safe`)
  const [owners, threshold, nonceVal, version] = await client.multicall({
    contracts: [
      { address: safe, abi: safeSingletonAbi, functionName: "getOwners" },
      { address: safe, abi: safeSingletonAbi, functionName: "getThreshold" },
      { address: safe, abi: safeSingletonAbi, functionName: "nonce" },
      { address: safe, abi: safeSingletonAbi, functionName: "VERSION" },
    ],
    allowFailure: false,
  });
  return { owners, threshold, nonce: nonceVal, version };
}

export async function getEnabledModules(
  client: PublicClient,
  chainId: ChainId,
  safe: Address,
): Promise<Address[]> {
  const result = await client.readContract({
    address: safe,
    abi: safeSingletonAbi,
    functionName: "getModulesPaginated",
    args: [SAFE_SENTINEL_MODULES, 100n],
  });
  // result[0] is the modules array; filter out sentinel if present
  const [modules /* , next */] = result as unknown as readonly [readonly Address[], Address];
  return modules.filter((m) => m.toLowerCase() !== SAFE_SENTINEL_MODULES.toLowerCase());
}

export const _safeChains = { getOnchainSafeInfo, getEnabledModules };
```

### Pattern 3: Multi-chain Promise.allSettled fan-out with per-chain AbortController

**What:** Parallel fan-out across `configuredChains` with per-chain 10s timeout; per-chain failures surface in `degradedChains`/`degradedReasons` rather than killing the response.

**When to use:** Any read tool with `chain?` optional and multi-chain default. Verbatim mirror of Phase 8 `get_portfolio_summary` pattern.

**Example (sketch — adapt from `src/tools/get_portfolio_summary.ts` per Phase 8 Plan 08-03):**

```typescript
const FAN_OUT_TIMEOUT_MS = 10_000;
const targetChains: ChainId[] = chainArg ? [chainIdFromName(chainArg)] : configuredChains;

const perChainResults = await Promise.allSettled(
  targetChains.map(async (chainId) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FAN_OUT_TIMEOUT_MS);
    try {
      return await getSafesForChain(chainId, wallet, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }),
);

const safesByChain: { chainId: ChainId; safes: SafePositionRow[] }[] = [];
const degradedChains: ChainId[] = [];
const degradedReasons: Record<number, string> = {};
perChainResults.forEach((r, i) => {
  const chainId = targetChains[i]!;
  if (r.status === "fulfilled") {
    safesByChain.push({ chainId, safes: r.value });
  } else {
    degradedChains.push(chainId);
    degradedReasons[chainId] = r.reason instanceof Error ? r.reason.message : String(r.reason);
  }
});
```

### Anti-Patterns to Avoid

- **Returning Tx Service values as the per-Safe surface without on-chain cross-check.** Trust-pipeline-defeating. Always use on-chain values; Tx Service values are advisory and feed `txServiceDrift` detection.
- **Throwing on Tx Service 401/404/429/5xx.** Violates CLAUDE.md never-throws-clients invariant. All error paths surface as DU arms.
- **Inline literal Safe singleton/proxyfactory addresses in `src/tools/*.ts`.** Violates SOT discipline. Always read from `src/config/contracts.ts` getters.
- **Single Safe singleton address per chain in canonical-dispatch allowlist.** L1 + L2 variants × v1.3.0 + v1.4.1 means up to 4 singletons per chain. Hard-coding one address per chain silently breaks v1.3.0-L2 + v1.4.1-L2 dispatches (which dominate on Polygon/Arbitrum/Base/Optimism).
- **`getParsedTokenAccountsByOwner`-style "single source of truth" Tx Service trust.** The Tx Service can be compromised, stale, or rate-limit-degraded. Always cross-check on-chain.
- **Module-list enumeration without filtering SENTINEL (0x...001) out.** Sentinel address is the linked-list anchor; surfacing it as a "module" is a bug.
- **Network I/O at `preview_send` time for Safe Tx decode.** Best-effort decode in `get_safe_transaction` is cache-only (the per-session ABI cache populated by Phase 35's `fetchEtherscanAbi`); never trigger a fresh Etherscan call from within `get_safe_transaction`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP retry / rate-limit / cache infra | Custom retry-with-backoff loop, separate cache module | Mirror `src/clients/etherscan.ts` pattern verbatim | Existing pattern handles all 5 arms, LRU eviction, per-session counter, and is battle-tested across Phase 4/7/35 |
| EVM multicall batching | Multi-RPC roundtrip with manual aggregation | `viem.PublicClient.multicall({ contracts, allowFailure })` | viem multicall hits the deterministic Multicall3 deployment at `0xcA11bde05977b3631167028862bE2a173976CA11` on all 5 chains — one round-trip for getOwners + getThreshold + nonce + VERSION |
| Safe contract address SOT | Inline hex literals + manual EIP-55 checksumming | Pin in `src/config/contracts.ts` with `getAddress(...)` literal-site wraps | Format-fanout-sentinel rule: corrupted snapshot (single hex digit flip) throws at module load instead of silently dispatching to wrong target |
| EIP-712 typed-data digest | Hand-roll keccak preimage | NOT NEEDED at Phase 36 (read-only). Phase 37 uses `viem.hashTypedData` + Safe domain separator. | Save until Phase 37; Fixture SAFE-A then anchors it |
| Safe Singleton ABI | Hand-define interface | `viem.parseAbi([...])` literal block | Phase 36 needs FIVE functions only (getOwners/getThreshold/nonce/VERSION/getModulesPaginated); parseAbi is the project convention |
| Sentinel-linked-list pagination loop | Multi-page recursive walk | Single `getModulesPaginated(SENTINEL, 100)` call + drop sentinel | 100-module Safes are extreme outliers; Phase 36 hard-caps at 100 and surfaces remainder as info; v3.x adds full pagination |

**Key insight:** Every external surface in this phase (HTTP client, ABI module, multicall batching, contract SOT) already has a battle-tested pattern in-tree. Building custom infra would diverge from established CLAUDE.md conventions and silently re-introduce defects (e.g. hand-rolled cache without eviction policy → memory leak; missing 5th `unsupported-chain` arm → schema accepts chain Tx Service can't service).

## Runtime State Inventory

Not applicable — Phase 36 is a greenfield read surface. No rename / refactor / migration / string replacement. No existing Safe code in the repo to migrate.

(`grep -rn "safe-tx-service\|SafeContracts\|SAFE_SINGLETON" src/ test/` returns ZERO hits as of 2026-05-27 — verified.)

## Common Pitfalls

### Pitfall 1: Stale CONTEXT.md Safe Tx Service URL pattern (CRITICAL)

**What goes wrong:** Using `https://safe-transaction-mainnet.safe.global/api/v1/...` produces 308 redirects to the new authenticated endpoint; without an API key, requests hit the 2 req/s + 5k/month unauthenticated tier limit immediately under any real workload.

**Why it happens:** Safe migrated the API to `api.safe.global/tx-service/{shortname}/api/` in 2025. The public free tier is being sunsetted on 2025-10-27; usage past that date requires an API key.

**How to avoid:** Use the new URL pattern in Plan 36-01 from day one. Thread `getSafeTxServiceApiKey()` + `Authorization: Bearer ${key}` header. Surface `safeTxServiceApiKeyPresent: boolean` in `get_vaultpilot_config_status`. Emit a once-per-session stderr NOTICE when the key is absent.

**Warning signs:** 308 status code in client logs; sudden bursts of 429 responses; users reporting "Safe queries timing out" with no other error pattern.

### Pitfall 2: Safe v1.3.0 / v1.4.1 L1-vs-L2 variant confusion (CRITICAL)

**What goes wrong:** Hardcoding a single singleton address per chain in `SAFE_SINGLETON_DISPATCH_ALLOWLIST` silently refuses dispatch to the OTHER variant. The L2 variant (`0x3E5c6364…` for v1.3.0; `0x29fcB43b…` for v1.4.1) dominates on Polygon/Arbitrum/Base/Optimism because L2 indexers depend on its per-tx event emission.

**Why it happens:** safe-deployments treats both as canonical. Safe UI silently creates L2 Safes on L2 chains. The L1 variant is the older deployment. Users with Safes created post-2022 on L2 chains are likely on the L2 variant.

**How to avoid:** `SafeContracts` per-chain table stores BOTH variants per version. `getSafeSingletonAddresses(chainId): Address[]` returns up to 4 entries (v1.3.0-L1 + v1.3.0-L2 + v1.4.1-L1 + v1.4.1-L2). `buildPerChainAllowlist(chainId)` spreads all of them into the Set.

**Warning signs:** `txServiceDrift: true { driftReasons: ["singleton-not-in-allowlist"] }` in Phase 37+ on L2 chains; canonical-dispatch refusal at preview time for what looks like a valid Safe dispatch.

### Pitfall 3: Tx Service `nonce` field is a **string**, not bigint

**What goes wrong:** Decoding `safeInfo.nonce` as `BigInt` directly or comparing to on-chain bigint `nonce()` without type coercion produces silent type errors at runtime.

**Why it happens:** Safe Tx Service v1 returns numeric fields (`nonce`, `safeTxGas`, `baseGas`, `gasPrice`) as JSON strings to preserve precision across the wire (JS Number max-safe-integer is 2^53, EVM uint256 exceeds it). On-chain reads via viem return native `bigint`.

**How to avoid:** Decode all Tx Service numeric fields explicitly: `BigInt(safeInfoResp.nonce)`. Compare `BigInt(txServiceNonce) === onchainNonce`. Document the type at the SOT boundary.

**Warning signs:** Drift-detection false-positives when Tx Service and on-chain agree; `NaN` comparisons; `nonce: "5"` literal strings leaking into the response surface.

### Pitfall 4: `getModulesPaginated` returns sentinel as a "module" in `modules[]`

**What goes wrong:** Surfacing the SENTINEL_MODULES address (`0x0000000000000000000000000000000000000001`) in `enabledModules[]` is a bug — that address is the linked-list anchor, never a real module.

**Why it happens:** When the Safe has 0 modules, the linked list is `SENTINEL -> SENTINEL`; some agent code reads the `modules[]` length as a "0 modules" sentinel of its own. When the Safe has modules, the result `modules[]` does NOT include sentinel (only `next` does), but defensive filtering is mandatory in case of ABI quirks across versions.

**How to avoid:** Always filter `modules.filter((m) => m.toLowerCase() !== SAFE_SENTINEL_MODULES.toLowerCase())` before returning.

**Warning signs:** `enabledModules` length is N+1 of what the Safe UI shows; sentinel address appearing in module listings.

### Pitfall 5: 100-module hard cap silently truncates exotic Safes

**What goes wrong:** Phase 36 caps `getModulesPaginated(SENTINEL, 100)` — Safes with > 100 modules silently lose modules from the returned list.

**Why it happens:** Single-call simplicity. Most Safes have 0-2 modules; > 100 is an extreme outlier.

**How to avoid:** When `result.next !== SENTINEL`, set `enabledModulesTruncated: true` + `enabledModulesPaginationCursor: Address` on the per-Safe row so the agent + user are aware. Phase 38 hard-trigger logic re-reads with full pagination when surfacing module-changing operations.

**Warning signs:** Real Safes in the wild rarely hit this (researcher could not find a documented case of > 10 modules). Defensive surface is cheap insurance.

### Pitfall 6: `confirmations[]` field is `undefined` (NOT empty array) for un-signed pending Safe txs

**What goes wrong:** `tx.confirmations.length` throws TypeError when no confirmations exist.

**Why it happens:** Safe Tx Service returns `confirmations: undefined` (per `SafeMultisigTransactionResponse` type) when no signatures have been collected. The field is optional in the response shape.

**How to avoid:** `(tx.confirmations ?? []).length` everywhere. Document `collectedSignatures` as `number` (always present), `confirmations` as `Array | undefined` in the surfaced shape.

**Warning signs:** TypeErrors in production logs at the `tx.confirmations.length` access site.

### Pitfall 7: Tx Service "Safe not found" can mean "wallet is not an owner" OR "Safe doesn't exist" OR "Tx Service hasn't indexed it yet"

**What goes wrong:** Returning 404 from `/v1/owners/{address}/safes/` does not mean the user has no Safes — it could mean Tx Service indexer hasn't caught up to a recent on-chain Safe creation.

**Why it happens:** Tx Service is an off-chain index; lag of seconds-to-minutes is normal after Safe creation. For very fresh wallets, an empty response is indistinguishable from "no Safes" without additional context.

**How to avoid:** Surface 404 as `{ safes: [] }` in the response (treat empty + 404 identically — both mean "no Safes known to Tx Service for this wallet"). Document in the tool description that recently-created Safes may take seconds to appear.

**Warning signs:** User reports "I just created a Safe but it doesn't show up" — usually resolves within a minute.

### Pitfall 8: Safe Tx Service ordering default is `-created`, not `-nonce`

**What goes wrong:** Querying `/v1/safes/{addr}/multisig-transactions/?executed=false&limit=20` without explicit ordering returns the 20 most-recently-CREATED pending txs, not the 20 LOWEST-NONCE pending txs. For a Safe with backlog, this can hide critical low-nonce queue head items.

**Why it happens:** Default ordering in Safe Tx Service is `-created` (descending creation timestamp) per the `GetMultisigTransactionsOptions` type. The CONTEXT.md "20 lowest-nonce" intent is NOT the default.

**How to avoid:** Always pass `ordering=nonce` (ascending by nonce). Combine with `executed=false` + `nonce__gte={currentOnchainNonce}` to scope to actionable pending items.

**Warning signs:** `pendingTransactions[]` showing recently-created proposals while the actual next-to-execute tx (lowest pending nonce) is missing.

### Pitfall 9: Bearer-token API key in URL or logs (CREDENTIAL LEAK)

**What goes wrong:** Logging the URL or Authorization header verbatim leaks the API key. The key is a JWT — long-lived credentials in logs are a compliance issue.

**Why it happens:** Stdlib `fetch` logging tools sometimes default to logging headers. Stderr `log()` calls that include `error.message` may include the URL.

**How to avoid:** NEVER log the URL or the Authorization header. Log the chainId + endpoint name + status code only. Mirror Etherscan's `T-ETHERSCAN-KEY-LEAK-1` discipline (verified in `src/clients/etherscan.ts:223`).

**Warning signs:** API key appearing in CI logs; CI failure messages including `Bearer ...` substrings.

### Pitfall 10: viem `parseAbi` requires `getModulesPaginated`'s named returns

**What goes wrong:** Defining the function as `"function getModulesPaginated(address,uint256) view returns (address[], address)"` (no named returns) breaks struct-ref decoding and forces tuple-index access.

**Why it happens:** parseAbi accepts unnamed returns but downstream consumers (viem multicall typing) prefer named returns for type inference.

**How to avoid:** Always name returns: `"function getModulesPaginated(address start, uint256 pageSize) view returns (address[] modules, address next)"`. Mirror the named-args pattern in `src/chains/aave-v3.ts:42`.

**Warning signs:** `unknown` types leaking into the reader function; TypeScript errors about tuple index access.

## Code Examples

Verified patterns from official sources + in-tree references:

### `parseAbi` Safe Singleton ABI definition (Phase 36 minimal surface)

```typescript
// Source: src/chains/aave-v3.ts:37-43 pattern verbatim (verified in-tree 2026-05-27);
//         function signatures cross-verified against
//         github.com/safe-global/safe-smart-account base/OwnerManager.sol +
//         base/ModuleManager.sol on the v1.4.1 branch.
import { parseAbi, type Address } from "viem";

export const SAFE_SENTINEL: Address = "0x0000000000000000000000000000000000000001";

export const safeSingletonAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] modules, address next)",
]);
```

### Safe Tx Service URL builder (NEW pattern — per-chain endpoint dispatch)

```typescript
// Source: derived from github.com/safe-global/safe-core-sdk/packages/api-kit/src/utils/config.ts
//         (verified 2026-05-27 — current main branch); chain shortnames + URL pattern verbatim.
const SAFE_TX_SERVICE_BASE = "https://api.safe.global/tx-service";

/**
 * Per-chain shortnames matching the api-kit config. The URL template
 * `{base}/{shortname}/api/v1/{endpoint}/` produces the live endpoint.
 */
const SAFE_CHAIN_SHORTNAMES: Record<ChainId, string> = {
  1: "eth",
  10: "oeth",
  137: "pol",
  8453: "base",
  42161: "arb1",
};

const SAFE_TX_SERVICE_ENDPOINTS: Record<ChainId, string> = {
  1: `${SAFE_TX_SERVICE_BASE}/eth/api`,
  10: `${SAFE_TX_SERVICE_BASE}/oeth/api`,
  137: `${SAFE_TX_SERVICE_BASE}/pol/api`,
  8453: `${SAFE_TX_SERVICE_BASE}/base/api`,
  42161: `${SAFE_TX_SERVICE_BASE}/arb1/api`,
};
```

### Safe Tx Service endpoint paths (verbatim from safe-core-sdk@main/api-kit/src/SafeApiKit.ts 2026-05-27)

```
GET  ${base}/v1/owners/{ownerAddress}/safes/
       → { safes: string[] }                       — list Safes for owner (404 if none)
GET  ${base}/v1/safes/{safeAddress}/
       → SafeInfoResponse                          — Safe info: owners/threshold/nonce/modules/version
GET  ${base}/v2/safes/{safeAddress}/multisig-transactions/?executed=false&nonce__gte={N}&ordering=nonce&limit=20
       → SafeMultisigTransactionListResponse       — pending txs (NOTE: v2 path)
GET  ${base}/v2/multisig-transactions/{safeTxHash}/
       → SafeMultisigTransactionResponse           — single tx detail (NOTE: v2 path)
GET  ${base}/v1/modules/{moduleAddress}/safes/    — list Safes using a specific module (NOT needed for Phase 36)
```

**Important — v1 vs v2 mix:** The list-by-owner + safe-info endpoints are at `/v1/`. Multisig-transactions read endpoints (list + single) are at `/v2/` per the live api-kit source. Cache key shape unaffected.

### Decoded SafeInfoResponse shape

```typescript
// Source: github.com/safe-global/safe-core-sdk/packages/api-kit/src/types/safeTransactionServiceTypes.ts
//         (verified 2026-05-27)
export type SafeInfoResponse = {
  readonly address: string;
  readonly nonce: string;            // STRING (uint256 wire-shape)
  readonly threshold: number;        // JS number — safe (max 256)
  readonly owners: string[];         // checksummed addresses
  readonly singleton: string;        // the singleton implementation address
  readonly modules: string[];        // enabled modules (sentinel filtered)
  readonly fallbackHandler: string;
  readonly guard: string;
  readonly version: string;          // e.g. "1.4.1" or "1.3.0+L2"
};
```

### Decoded SafeMultisigTransactionResponse shape

```typescript
// Source: github.com/safe-global/safe-core-sdk/packages/types-kit/src/types.ts:244-278
//         (verified 2026-05-27)
export type SafeMultisigTransactionResponse = {
  readonly safe: string;
  readonly to: string;
  readonly value: string;            // STRING
  readonly data?: string;            // hex; undefined for value-only txs
  readonly operation: number;        // 0 = Call, 1 = DelegateCall
  readonly gasToken: string;         // 0x0...0 for native gas
  readonly safeTxGas: string;        // STRING
  readonly baseGas: string;
  readonly gasPrice: string;
  readonly refundReceiver?: string;
  readonly nonce: string;            // STRING
  readonly executionDate: string | null;
  readonly submissionDate: string;
  readonly modified: string;
  readonly blockNumber: number | null;
  readonly transactionHash: string | null;    // on-chain tx hash (null until executed)
  readonly safeTxHash: string;       // EIP-712 digest — the cryptographic anchor
  readonly executor: string | null;
  readonly proposer: string | null;
  readonly proposedByDelegate: string | null;
  readonly isExecuted: boolean;
  readonly isSuccessful: boolean | null;
  readonly ethGasPrice: string | null;
  readonly maxFeePerGas: string | null;
  readonly maxPriorityFeePerGas: string | null;
  readonly gasUsed: number | null;
  readonly fee: string | null;
  readonly origin: string;
  readonly dataDecoded?: DataDecoded;         // Tx Service's best-effort decode (separate from Phase 35 cache hit)
  readonly confirmationsRequired: number;
  readonly confirmations?: SafeMultisigConfirmationResponse[];  // OPTIONAL (undefined if no sigs)
  readonly trusted: boolean;
  readonly signatures: string | null;         // packed signatures bytes if any
};

export type SafeMultisigConfirmationResponse = {
  readonly owner: string;
  readonly submissionDate: string;
  readonly transactionHash?: string;
  readonly confirmationType?: string;
  readonly signature: string;
  readonly signatureType: SignatureType;     // "EOA" | "ETH_SIGN" | "CONTRACT_SIGNATURE" | "APPROVED_HASH"
};
```

### Multicall for on-chain Safe info (Phase 36 cross-check)

```typescript
// Source: src/tools/get_token_allowances.ts:275 pattern verbatim (multicall with allowFailure)
import type { Address, PublicClient } from "viem";
import { safeSingletonAbi } from "./safe.js";

export async function readSafeOnchain(
  client: PublicClient,
  safe: Address,
): Promise<{ owners: readonly Address[]; threshold: bigint; nonce: bigint; version: string }> {
  const [owners, threshold, nonceVal, version] = await client.multicall({
    contracts: [
      { address: safe, abi: safeSingletonAbi, functionName: "getOwners" },
      { address: safe, abi: safeSingletonAbi, functionName: "getThreshold" },
      { address: safe, abi: safeSingletonAbi, functionName: "nonce" },
      { address: safe, abi: safeSingletonAbi, functionName: "VERSION" },
    ],
    allowFailure: false,
  });
  return { owners, threshold, nonce: nonceVal, version };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `https://safe-transaction-{network}.safe.global` per-chain hostnames | `https://api.safe.global/tx-service/{shortname}/api/...` single-host shortname pattern | 2025 (deprecation), 2025-10-27 (sunset of unauthenticated public tier) | All Phase 36 client code uses NEW URL pattern; auth header threaded; rate limit awareness |
| `/v1/multisig-transactions/{hash}/` + `/v1/safes/{addr}/multisig-transactions/` | `/v2/multisig-transactions/{hash}/` + `/v2/safes/{addr}/multisig-transactions/` (list + single tx detail) | Mid-2024 SDK migration | Phase 36 client uses `/v2/` for multisig-transactions endpoints; `/v1/` for owners/safe-info |
| Public API key not required | API key required for production usage (`Authorization: Bearer X`) | 2025 (recommendation), 2025-10-27 (enforcement) | `getSafeTxServiceApiKey()` lazy env probe; `safeTxServiceApiKeyPresent` diagnostic boolean; once-per-session stderr NOTICE |
| Single Safe Singleton variant per chain | Up to 4 variants per chain (v1.3.0-L1, v1.3.0-L2, v1.4.1-L1, v1.4.1-L2) | 2021 (v1.3.0-L2 split), 2023 (v1.4.1) | `SafeContracts` SOT carries Address[] for singleton role per chain; allowlist spreads all variants |

**Deprecated/outdated:**
- Safe `safe-service-client` npm package — superseded by `@safe-global/api-kit` (only the latter is maintained on `main`)
- Safe v1.0.x/v1.1.x — explicitly NOT supported in v2.5; surfaces as `txServiceDrift: true { driftReasons: ["unsupported-version"] }` (CONTEXT lock)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@safe-global/api-kit@main` is the authoritative source for endpoint URL patterns + auth-header conventions (researcher fetched SafeApiKit.ts + httpRequests.ts + config.ts 2026-05-27 from `raw.githubusercontent.com`) | Topic 1 + Standard Stack | LOW — files are short, unambiguous, freshly committed |
| A2 | Safe v1.3.0 L1 singleton `0xd9Db270c…` AND L2 singleton `0x3E5c6364…` are BOTH actively used in production on each of Ethereum/Arbitrum/Polygon/Base/Optimism | Pitfall 2 + Standard Stack | MEDIUM — researcher verified both addresses on Etherscan; could not confirm exact split by usage volume per chain. Safest default: allowlist BOTH on every chain. |
| A3 | Per-session call ceiling of 30 is sufficient for typical agent workflow (1-3 Safes per user × 1 Safe info + 1 pending list + 1 modules pagination = 9 calls per user-query; 3 user-queries per session = 27 calls) | Locked Decisions | LOW — soft ceiling; refusal arm surfaces verbatim if hit; tunable at execute time |
| A4 | Safe Tx Service `nonce__gte={currentOnchainNonce}` filter combined with `executed=false` correctly bounds pending-tx surface to actionable items (i.e. no executed-but-not-yet-finalized races) | Pitfall 8 + Topic 4 | LOW — verified semantics in `safe-core-sdk getPendingTransactions` (SafeApiKit.ts:739-742 reads `currentNonce || (await getSafeInfo).nonce` then filters `?executed=false&nonce__gte=${nonce}`) |
| A5 | Phase 35's per-session ABI cache (`getCachedEtherscanAbi`) is reachable from Phase 36 tools without import-cycle risk | Topic 9 | LOW — `getCachedEtherscanAbi` is exported from `src/clients/etherscan.ts:609` and is cache-only (no network call); read-only consumer pattern is import-safe |
| A6 | Phase 36 does NOT need to handle Safe v1.0.x/v1.1.x — CONTEXT pre-locks treatment as `txServiceDrift` | Deferred Ideas | LOW — explicit CONTEXT decision; researcher concurs (those versions are deprecated upstream) |
| A7 | The `singleton` field returned by Tx Service `/v1/safes/{addr}/` reflects the on-chain Safe's implementation pointer accurately (i.e. comparing this against on-chain `MASTER_COPY_LOCATION` storage slot — or against `VERSION()` return — gives correct drift detection) | Topic 6 | MEDIUM — researcher did not exhaustively verify Tx Service `singleton` field semantics across all 4 variants. Safest default: drift-detect via `VERSION()` string comparison rather than singleton-address comparison (string compare is robust against new singleton deployments). |
| A8 | Safe Tx Service per-IP rate limit of 2 req/s for unauthenticated requests is per-IP (not per-key) | Pitfall 1 | LOW — explicit Safe docs lock at developer dashboard sign-up page |
| A9 | Sentinel-linked-list pagination cap of 100 modules covers > 99.99% of real-world Safes | Pitfall 5 | LOW — researcher could not find a documented Safe with > 10 modules; 100 is generous |

## Open Questions

1. **Whether Phase 36 emits a NOTICE block when `safeTxServiceApiKeyPresent: false` AND the public-tier sunset date (2025-10-27) has passed.**
   - What we know: Public tier is rate-capped at 2 req/s + 5k/month; sunset announced for 2025-10-27.
   - What's unclear: As of research date (2026-05-27), sunset has passed but observation that endpoints still resolve under unauthenticated tier needs runtime confirmation.
   - Recommendation: Plan 36-01 emits a `VAULTPILOT NOTICE — Safe Tx Service API key not configured` block when `getSafeTxServiceApiKey()` returns undefined AND the first Tx Service call returns 401/429. Mirror `VAULTPILOT NOTICE — Preflight skill not installed` shape. NEVER block — surface and proceed.

2. **Whether `txServiceDrift` should distinguish "minor drift" (nonce off by ≤3) from "major drift" (owners/threshold/version mismatch).**
   - What we know: Tx Service typically lags on-chain by seconds for nonce (recently-executed tx not yet indexed); owners/threshold/version drift is a tamper/version-skew signal.
   - What's unclear: How agents should react differently. CONTEXT says agent-readable signal only; no MCP refusal.
   - Recommendation: Surface `driftReasons: string[]` with semantic labels (`"nonce-stale"`, `"owners-set-mismatch"`, `"threshold-mismatch"`, `"version-mismatch"`, `"modules-set-mismatch"`). Agent reads the array, decides UX accordingly. Phase 37+ may consume per-reason in dispatch logic.

3. **Multicall3 availability on PublicNode RPC.**
   - What we know: Multicall3 is deployed at `0xcA11bde0…` deterministically on Ethereum/Arbitrum/Polygon/Base/Optimism; viem `client.multicall` uses it transparently.
   - What's unclear: Whether PublicNode (project's default fallback per `src/chains/registry.ts:59`) exposes the multicall RPC method (`eth_call` to multicall contract works universally; the question is whether `client.multicall` viem helper routes correctly).
   - Recommendation: Add a smoke test at Plan 36-02 integration-test scope: `client.multicall({ contracts: [singleton.getOwners], allowFailure: false })` against a real mainnet PublicNode RPC + a known mainnet Safe (e.g. `0x4f8AD938eBA0CD19155a835f617317a6E788c868` — Safe DAO treasury 5-of-8). If multicall fails on PublicNode, fall back to 4 sequential `readContract` calls (per-Safe ~120ms vs ~30ms — acceptable degradation).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥ 18.17 | Project runtime + native `fetch` for client | ✓ | (project requirement) | — |
| `viem ^2.48.0` | `parseAbi`, `multicall`, `Address` type, `PublicClient` | ✓ | 2.48.0 (per package.json) | — |
| PublicNode RPC endpoints | Per-chain on-chain reads (multicall) | ✓ | (HTTP only, no version) | RPC_PROVIDER (infura/alchemy) — already wired Phase 8 |
| Safe Tx Service (`api.safe.global/tx-service/*`) | `get_safe_positions` / `get_safe_transaction` Tx Service queries | ✓ (live) | v1 + v2 API mix | NO viable fallback — Tx Service is the only Safe enumeration source. Degrade gracefully via 5-arm DU. |
| `@safe-global/safe-deployments` (research source — NOT installed) | SOT seed values for SafeContracts | ✓ (npm package available; not installed) | 1.37.56 | Researcher fetched JSON via raw.githubusercontent.com — NO runtime dep |

**Missing dependencies with no fallback:** none

**Missing dependencies with fallback:** none

**Documented external service risk:** Safe Tx Service public tier is sunsetted (2025-10-27); users without an API key will hit aggressive rate limits. Plan 36-01 must surface this state via diagnostic boolean + once-per-session NOTICE. NOT a hard blocker for Phase 36 (the client handles 429 gracefully).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (already in tree per package.json) |
| Config file | `vitest.config.ts` at repo root (verified in-tree 2026-05-27) |
| Quick run command | `npm test -- --run test/clients-safe-tx-service.test.ts` (per-file) |
| Full suite command | `npm test -- --run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SAFE-01 | `get_safe_positions` returns Safes where wallet is owner (1-of-1 fixture) | integration | `npm test -- --run test/integration/safe-positions.test.ts -t "1-of-1"` | ❌ Wave 0 |
| SAFE-01 | `get_safe_positions` returns Safes (2-of-3 fixture with pending tx + module) | integration | `npm test -- --run test/integration/safe-positions.test.ts -t "2-of-3"` | ❌ Wave 0 |
| SAFE-01 | `get_safe_positions` surfaces `txServiceDrift: true` when on-chain disagrees with Tx Service | integration | `npm test -- --run test/integration/safe-positions.test.ts -t "drift"` | ❌ Wave 0 |
| SAFE-01 | Multi-chain fan-out via `Promise.allSettled`; per-chain timeout → degradedChains entry | integration | `npm test -- --run test/integration/safe-positions.test.ts -t "fan-out"` | ❌ Wave 0 |
| SAFE-02 | `get_safe_transaction` returns full tx for call operation + decoded args (cached ABI) | integration | `npm test -- --run test/integration/safe-get-transaction.test.ts -t "call"` | ❌ Wave 0 |
| SAFE-02 | `get_safe_transaction` returns full tx for delegatecall operation + `operation: "delegatecall"` | integration | `npm test -- --run test/integration/safe-get-transaction.test.ts -t "delegatecall"` | ❌ Wave 0 |
| SAFE-02 | `get_safe_transaction` returns `decodedOperation: null` on ABI cache miss (no blocking probe) | integration | `npm test -- --run test/integration/safe-get-transaction.test.ts -t "cache-miss"` | ❌ Wave 0 |
| SAFE-03 | Safe Tx Service client returns `ok` on 200 + parsed Safe info | unit | `npm test -- --run test/clients-safe-tx-service.test.ts -t "ok"` | ❌ Wave 0 |
| SAFE-03 | Safe Tx Service client returns `not-found` on 404 | unit | `npm test -- --run test/clients-safe-tx-service.test.ts -t "not-found"` | ❌ Wave 0 |
| SAFE-03 | Safe Tx Service client returns `rate-limited` on 429 + parses `retry-after` | unit | `npm test -- --run test/clients-safe-tx-service.test.ts -t "rate-limited"` | ❌ Wave 0 |
| SAFE-03 | Safe Tx Service client returns `error` on 5xx + verbatim message | unit | `npm test -- --run test/clients-safe-tx-service.test.ts -t "error"` | ❌ Wave 0 |
| SAFE-03 | Safe Tx Service client returns `unsupported-chain` for chainId not in endpoints (short-circuit) | unit | `npm test -- --run test/clients-safe-tx-service.test.ts -t "unsupported-chain"` | ❌ Wave 0 |
| SAFE-03 | Cache hit on second call (same chainId + safeAddress) does NOT consume per-session counter | unit | `npm test -- --run test/clients-safe-tx-service.test.ts -t "cache-hit"` | ❌ Wave 0 |
| SAFE-03 | Per-session call counter exceeded → `rate-limited` arm with descriptive message | unit | `npm test -- --run test/clients-safe-tx-service.test.ts -t "ceiling"` | ❌ Wave 0 |
| SAFE-03 | `Authorization: Bearer` header added when `SAFE_TX_SERVICE_API_KEY` env present; omitted otherwise | unit | `npm test -- --run test/clients-safe-tx-service.test.ts -t "auth-header"` | ❌ Wave 0 |
| SAFE-03 | API key NEVER leaks to logger.log output (3-sentinel substring scan; T-SAFE-KEY-LEAK-1) | unit | `npm test -- --run test/clients-safe-tx-service.test.ts -t "key-leak"` | ❌ Wave 0 |
| SAFE-04 | Every `SafeContracts[chain].singleton` ∈ `SAFE_SINGLETON_DISPATCH_ALLOWLIST[chain]` (property test loop over `configuredChains` + per-version variants) | unit | `npm test -- --run test/security-canonical-dispatch-safe.test.ts` | ❌ Wave 0 |
| SAFE-04 | `SafeContracts` SOT addresses are EIP-55 checksummed (module-load `getAddress` integrity guard) | unit | `npm test -- --run test/chains-aave-v3.test.ts` (existing pattern) extended | ❌ Wave 0 (extension) |
| SAFE-04 | `chains/safe.ts` parseAbi struct refs decode multicall result correctly | unit | `npm test -- --run test/chains-safe.test.ts -t "multicall"` | ❌ Wave 0 |
| SAFE-04 | `getEnabledModules` filters out SENTINEL from returned array | unit | `npm test -- --run test/chains-safe.test.ts -t "sentinel-filter"` | ❌ Wave 0 |
| SAFE-04 | `getEnabledModules` surfaces `next !== SENTINEL` as `enabledModulesTruncated: true` (Pitfall 5) | unit | `npm test -- --run test/chains-safe.test.ts -t "truncation"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- --run test/clients-safe-tx-service.test.ts test/chains-safe.test.ts test/security-canonical-dispatch-safe.test.ts` (3 unit files, ~20s)
- **Per wave merge:** `npm test -- --run` (full suite — pre-Phase-36 baseline ~890 tests + Phase 36 estimated +35 = ~925)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/clients-safe-tx-service.test.ts` — covers SAFE-03 (8 sub-tests)
- [ ] `test/chains-safe.test.ts` — covers SAFE-04 (3 sub-tests including parseAbi, sentinel, truncation)
- [ ] `test/security-canonical-dispatch-safe.test.ts` — covers SAFE-04 (1 property test loop)
- [ ] `test/integration/safe-positions.test.ts` — covers SAFE-01 (4 fixture variants: 1-of-1, 2-of-3, drift, fan-out)
- [ ] `test/integration/safe-get-transaction.test.ts` — covers SAFE-02 (3 variants: call, delegatecall, cache-miss)
- [ ] Shared fixtures helper: `test/fixtures/safe-tx-service-responses.ts` (typed Tx Service response shapes — SafeInfoResponse + SafeMultisigTransactionResponse + OwnerResponse — for fetch-stub use)
- [ ] Framework install: none needed (vitest in tree)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (for Safe Tx Service auth-header threading) | Bearer-token JWT via `Authorization` header — never URL-embedded, never logged (mirror `T-ETHERSCAN-KEY-LEAK-1` discipline in `src/clients/etherscan.ts:223`) |
| V3 Session Management | no | Phase 36 is request-scoped reads; no session state outside per-session in-memory LRU caches (dies with process) |
| V4 Access Control | partial | The wallet-not-owner silent-drop is an access boundary: returned Safes are filtered to those where `wallet ∈ getOwners()` on-chain (CONTEXT lock) — prevents Tx Service stale ownership from leaking false-positive Safes |
| V5 Input Validation | yes | Wallet + safeAddress + safeTxHash schema validation at boundary; isAddress runtime check; chain enum gating |
| V6 Cryptography | no | Phase 36 ships ZERO cryptographic operations (no fingerprint, no signature, no hash). Phase 37 introduces SafeTx EIP-712 hash. |
| V8 Data Protection | yes | API key never logged (T-SAFE-KEY-LEAK-1); per-session cache resets on restart (no persistence of sensitive data) |
| V10 Malicious Code | yes (indirect) | Canonical-dispatch allowlist wiring prepares Layer 0.5 for Phase 37 — every Safe operation hits an allowlisted singleton or refuses |
| V11 Business Logic | yes | `txServiceDrift` is the cheap observable for a compromised Tx Service; surfaces as agent-readable signal — defense-in-depth against a tampered API |
| V14 Configuration | yes | `SAFE_TX_SERVICE_API_KEY` lazy env probe matches existing pattern (`ETHERSCAN_API_KEY`, `WALLETCONNECT_PROJECT_ID`) — no hardcoded secrets |

### Known Threat Patterns for Phase 36 (Safe Tx Service + on-chain cross-check)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Compromised Safe Tx Service returns wrong owner set | Tampering | On-chain cross-check via Singleton ABI — per-Safe output uses on-chain values, never Tx Service values. `txServiceDrift: true` flag surfaces mismatch verbatim. |
| Compromised Safe Tx Service returns wrong pending-tx hashes | Tampering | Phase 36: surface verbatim (no protection — read-only). Phase 37+: `get_safe_transaction` re-fetches; user verifies on Ledger screen at signing time. |
| Stale Tx Service ownership records (wallet recently removed) | Tampering / Spoofing | Wallet-not-owner Safes silently dropped via on-chain `getOwners()` filter at the `get_safe_positions` aggregator level |
| API key leak in logs / error messages | Information Disclosure | Never log URL or Authorization header; log chainId + endpoint name + status code only (mirror Etherscan T-ETHERSCAN-KEY-LEAK-1) |
| Rate-limit DoS via aggressive client retries | DoS (self-inflicted) | Per-session call counter (soft ceiling ~30) + 429 surfaces verbatim with retry-after; client never retries automatically |
| Misuse of singleton variant (L1 vs L2) for canonical dispatch | Elevation of Privilege (Layer 0.5 bypass) | Allowlist includes ALL singleton variants per chain (4 max: v1.3.0-L1 + v1.3.0-L2 + v1.4.1-L1 + v1.4.1-L2); construction prevents silent refusal of legitimate L2 Safes |
| SENTINEL leakage into enabledModules surface | Information Disclosure (UX-level confusion) | Mandatory filter `modules.filter(m !== SAFE_SENTINEL)` in `getEnabledModules` |
| ABI cache poisoning via Phase 35 cross-tool reach | Tampering | Read-only consumer pattern (cache only — no writes); Phase 35 cache is process-local; integrity inherited from Phase 35's existing trust model |
| Cross-chain confusion (SafeTxHash from chain X queried on chain Y) | Spoofing | `get_safe_transaction` requires explicit `chain` argument (CONTEXT lock — no fan-out); per-chain DU and `unsupported-chain` arm short-circuit before network call |

### SafeContracts SOT Literals (Phase 36 SOT seed values)

Provenance: github.com/safe-global/safe-deployments@main/src/assets/v1.{3.0,4.1}/*.json (researcher-fetched 2026-05-27).

**Per-chain table (canonical across Ethereum / Arbitrum / Polygon / Base / Optimism — all 5 chains share the same addresses for each role/version, per safe-deployments JSON):**

| Role | v1.3.0 L1 | v1.3.0 L2 | v1.4.1 L1 | v1.4.1 L2 |
|------|----------|----------|----------|----------|
| Singleton | `0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552` | `0x3E5c63644E683549055b9Be8653de26E0B4CD36E` | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` |
| ProxyFactory | `0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2` | (same — proxy factory is version-shared) | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | (same) |
| MultiSend | `0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761` | (same) | `0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526` | (same) |
| MultiSendCallOnly | `0x40A2aCCbd92BCA938b02010E17A5b8929b49130D` | (same) | `0x9641d764fc13c8B624c04430C7356C1C7C8102e2` | (same) |
| SignMessageLib | `0xA65387F16B013cf2Af4605Ad8aA5ec25a2cbA3a2` | (same) | `0xd53cd0aB83D845Ac265BE939c57F53AD838012c9` | (same) |
| CompatibilityFallbackHandler | `0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4` | (same) | `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` | (same) |

**Allowlist count per chain:** 4 singleton addresses per chain × 5 chains = **20 new entries total** in `SAFE_SINGLETON_DISPATCH_ALLOWLIST`. (NOT 10 as CONTEXT.md initial estimate suggested — researcher correction: BOTH L1 and L2 variants must be allowlisted per chain.)

**Proposed `SafeContracts` shape** (sibling to `UniswapV3Contracts` in `src/config/contracts.ts`):

```typescript
export interface SafeContracts {
  /** Up to 4 singleton variants (v1.3.0-L1, v1.3.0-L2, v1.4.1-L1, v1.4.1-L2). */
  singletons: { v130L1: Address; v130L2: Address; v141L1: Address; v141L2: Address };
  proxyFactoryV130: Address;
  proxyFactoryV141: Address;
  multiSendV130: Address;
  multiSendV141: Address;
  multiSendCallOnlyV130: Address;
  multiSendCallOnlyV141: Address;
  signMessageLibV130: Address;
  signMessageLibV141: Address;
  compatibilityFallbackHandlerV130: Address;
  compatibilityFallbackHandlerV141: Address;
}

export function getSafeSingletonAddresses(chainId: ChainId): Address[] {
  const c = SAFE_CONTRACTS_RAW[chainId];
  if (!c) return [];
  return [c.singletons.v130L1, c.singletons.v130L2, c.singletons.v141L1, c.singletons.v141L2];
}
```

## Sources

### Primary (HIGH confidence)

- `src/clients/etherscan.ts` (in-tree, read 2026-05-27 lines 1-624) — 5-arm DU pattern, cache shape, per-session counter, lazy env probe — VERBATIM template for `src/clients/safe-tx-service.ts`
- `src/clients/fourbyte.ts` (in-tree, read 2026-05-27 lines 1-168) — never-throws contract + `fetch`-stub seam — supplementary template
- `src/chains/aave-v3.ts` (in-tree, read 2026-05-27 lines 1-148) — parseAbi struct refs + `_safeChains` indirection pattern — VERBATIM template for `src/chains/safe.ts`
- `src/tools/get_lending_positions.ts` (in-tree, read 2026-05-27 lines 1-960) — Promise.allSettled fan-out + per-position row builder + sources summary pattern — closest tool analog
- `src/security/canonical-dispatch.ts` (in-tree, read 2026-05-27 lines 1-298) — builder pattern for per-chain allowlist Set; spread idiom for new arms
- `src/config/contracts.ts` (in-tree, read 2026-05-27 lines 1-1376) — `UniswapV3Contracts` / `CurvePools` sibling-sub-table pattern
- `github.com/safe-global/safe-core-sdk@main/packages/api-kit/src/SafeApiKit.ts` (fetched 2026-05-27) — authoritative endpoint URL paths (line-numbered grep results)
- `github.com/safe-global/safe-core-sdk@main/packages/api-kit/src/utils/config.ts` (fetched 2026-05-27) — per-chain URL pattern + shortname mapping
- `github.com/safe-global/safe-core-sdk@main/packages/api-kit/src/utils/httpRequests.ts` (fetched 2026-05-27) — Authorization Bearer header format
- `github.com/safe-global/safe-core-sdk@main/packages/api-kit/src/types/safeTransactionServiceTypes.ts` (fetched 2026-05-27) — SafeInfoResponse + OwnerResponse type shapes
- `github.com/safe-global/safe-core-sdk@main/packages/types-kit/src/types.ts` (fetched 2026-05-27) — SafeMultisigTransactionResponse + SafeMultisigConfirmationResponse type shapes
- `github.com/safe-global/safe-deployments@main/src/assets/v1.{3.0,4.1}/*.json` (fetched 2026-05-27) — Singleton, ProxyFactory, MultiSend, MultiSendCallOnly, SignMessageLib, CompatibilityFallbackHandler addresses

### Secondary (MEDIUM confidence)

- [docs.safe.global How to Use API Keys](https://docs.safe.global/core-api/how-to-use-api-keys) — Bearer-token JWT format, 2 RPS / 5k monthly unauthenticated tier, 401/429 responses
- [Safe Help Center: Migrate to Safe's API New Endpoint](https://help.safe.global/en/articles/395657-action-needed-migrate-to-safe-s-api-new-endpoint) — public API retirement on 2025-10-27 announcement
- [github.com/mds1/multicall3 README](https://github.com/mds1/multicall3) — Multicall3 deterministic deployment at `0xcA11bde0…` across 250+ chains; gas requirements; pre-signed transaction caveats
- [OpenZeppelin zkSync Safe Assessment](https://blog.openzeppelin.com/zksync-gnosissafezk-assessment-1) — `SENTINEL_MODULES = address(0x1)` lock; `getModulesPaginated(start, pageSize)` return shape

### Tertiary (LOW confidence — verified against primary where possible)

- [pkqs90: Gnosis Safe Smart Contract Walkthrough](https://pkqs90.github.io/posts/gnosis-safe-walkthrough/) — module + owner linked-list architecture overview (cross-verified against OpenZeppelin assessment)

### Cross-Phase Anchors

- Phase 35 RESEARCH.md (`.planning/phases/35-evm-escape-hatch-custom-call-abi-read/35-RESEARCH.md`) — Etherscan multi-chain widening precedent + per-session ABI cache layer (consumed by Phase 36 `get_safe_transaction` decoded-operation surface)
- Phase 7 RESEARCH.md (`.planning/phases/07-aave-v3-ethereum/07-RESEARCH.md`) — `src/clients/etherscan.ts` foundational shape (Plan 07-04)
- Phase 8 Plan 08-01 (`.planning/phases/08-multi-evm-fanout-token-tooling/08-01-PLAN.md`) — `Record<ChainId, ...>` per-chain SOT extension pattern
- Phase 9 Plan 09-04 (`.planning/phases/09-hardening-skill-verification-tools-dispatch-allowlist/09-04-PLAN.md`) — `CANONICAL_DISPATCH_TARGETS` per-chain table wiring pattern (extended additively by Phase 36)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all surfaces are in-tree mirrors; no new npm packages
- Architecture: HIGH — direct adaptation of Phase 7 (Aave) + Phase 35 (Etherscan multi-chain) patterns; CONTEXT.md pre-locks structural choices
- Pitfalls: HIGH for #1 (URL migration — researcher contradicts CONTEXT with primary-source evidence), #2 (L1/L2 split — verified against safe-deployments JSON); MEDIUM for #3-#10 (derived from SDK source + on-chain semantics; not stress-tested in our codebase yet)
- Safe Tx Service endpoint paths: HIGH — verbatim from `safe-core-sdk@main/api-kit/src/SafeApiKit.ts` grep output (lines 418-742)
- Singleton address pinning: HIGH — verbatim from `safe-deployments@main/v1.{3.0,4.1}/*.json` reads
- Validation architecture: HIGH — every requirement maps to a concrete test command; Wave 0 gaps explicitly enumerated

**Research date:** 2026-05-27
**Valid until:** 2026-06-26 (30 days for stable; flag for re-validation if Safe announces another API migration before this date)

## RESEARCH COMPLETE
