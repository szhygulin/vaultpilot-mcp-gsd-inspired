# Phase 36: Safe positions + Tx Service API integration — Pattern Map

**Mapped:** 2026-05-27
**Files analyzed:** 11 new source/test files + 3 extended files
**Analogs found:** 14 / 14 (every file has an in-tree analog)

> **Wave structure:**
> - **Wave 1 (Plan 36-01):** foundation — Safe Tx Service client + `SafeContracts` SOT + canonical-dispatch arm
> - **Wave 2 (Plan 36-02):** consumers — Safe Singleton state reader + `get_safe_positions` + `get_safe_transaction` tools
>
> Phase 36 is **read-only**. FROZEN gates (`src/signing/payload-fingerprint.ts`, `src/signing/presign-hash.ts`, `src/signing/handle-store.ts`, `src/tools/send_transaction.ts`, `src/tools/preview_send.ts`) receive ZERO diff. Asserted at `/gsd-verify-work` via `git diff --stat` against those paths.

---

## File Classification

### New files (11)

| File | Plan | Role | Data Flow | Closest Analog | Match Quality |
|------|------|------|-----------|----------------|---------------|
| `src/clients/safe-tx-service.ts` | 36-01 | external HTTP client | request-response (5-arm DU, never-throws, LRU cache, per-session counter, auth-header) | `src/clients/etherscan.ts` (whole-file shape; `fetchEtherscanAbi` for the per-endpoint method shape) | **exact** |
| `src/chains/safe.ts` | 36-02 | per-chain on-chain reader | request-response (multicall over Singleton ABI) | `src/chains/aave-v3.ts` (parseAbi struct refs + `_<scope>` ESM spy indirection) | **exact** |
| `src/tools/get_safe_positions.ts` | 36-02 | MCP read tool | request-response with multi-chain `Promise.allSettled` fan-out + per-chain `AbortController` timeout | `src/tools/get_portfolio_summary.ts` (cross-chain fan-out shape) + `src/tools/get_lending_positions.ts` (single-chain handler scaffolding + per-position row builder) | **exact** |
| `src/tools/get_safe_transaction.ts` | 36-02 | MCP read tool | request-response (single Tx-Service fetch + best-effort cached ABI decode) | `src/tools/get_transaction_status.ts` (single-tx-hash chain-required shape) + `src/tools/check_contract_security.ts` (discriminated-union response surface + cause-naming refusal) | **role-match** (no exact "Safe-tx detail" analog; merges two patterns) |
| `test/clients-safe-tx-service.test.ts` | 36-01 | unit test | `vi.stubGlobal("fetch", …)` seam — NO ESM indirection | `test/clients-etherscan.test.ts` (`buildFetch` factory + 5-arm coverage + cache + rate-counter resets + key-leak scan) | **exact** |
| `test/chains-safe.test.ts` | 36-02 | unit test | `vi.fn()` mocked `PublicClient.multicall` + parseAbi struct-ref inspection | `test/chains-aave-v3.test.ts` (parseAbi struct inspection + SOT cross-import assertion + `_<scope>` spy round-trip) | **exact** |
| `test/security-canonical-dispatch-safe.test.ts` | 36-01 | unit test | property test (per-chain loop) | `test/security-canonical-dispatch.test.ts` (per-chain × per-canonical-entry containment + `checkDispatchTarget` 2-arm coverage) | **exact** |
| `test/integration/safe-positions.test.ts` | 36-02 | integration test | stubbed `fetch` + stubbed multicall | `test/aave-v3-lifecycle.integration.test.ts` (`vi.hoisted` mock holders + stubbed viem actions + persona cycle) + `test/get-portfolio-summary.cross-chain.test.ts` (multi-chain fan-out fixture pattern — if present) | **role-match** |
| `test/integration/safe-get-transaction.test.ts` | 36-02 | integration test | stubbed `fetch` + stubbed cached-ABI lookup | `test/integration/escape-hatch.test.ts` (Phase 35 cached-ABI consumer integration shape — closest existing user of `getCachedEtherscanAbi`) | **role-match** |
| `test/fixtures/safe-tx-service-responses.ts` | 36-01 | typed fixture helper | typed JSON fixture exports | `test/clients-etherscan.test.ts` `sourcePayloadVerified` / `creationPayloadVerified` factory pattern | **role-match** |
| (Wave 0 only) `test/config-contracts.test.ts` extension | 36-01 | unit test extension | property test: `SafeContracts` SOT EIP-55 checksum + cross-arm byte-identity | `test/config-contracts.test.ts` existing `LIDO_RAW` / `UNISWAP_V3_RAW` / `CURVE_RAW` containment assertions | **exact** |

### Extended files (3)

| File | Plan | Extension type | Closest precedent |
|------|------|----------------|-------------------|
| `src/config/contracts.ts` | 36-01 | new `SafeContracts` interface + `SAFE_CONTRACTS_RAW: Partial<Record<ChainId, SafeContracts>>` + 6 getters (`getSafeSingletonAddresses(chainId): Address[]` + 5 per-role single-address getters) | `LidoContracts` (lines 384-438) + `UniswapV3Contracts` (lines 741-791) + `CurvePoolEntry` (lines 842-1042) — same sibling-sub-table shape |
| `src/security/canonical-dispatch.ts` | 36-01 | additive `safeSingletonEntries` spread into `buildPerChainAllowlist` per-chain Set (lines 117-221 region) | Phase 34 Curve arm at line 200-205 (`getAllCurvePoolsForChain(chainId).map((p) => p.address)`) + Phase 33 Uniswap NPM arm at lines 187-199 (single-address null-filter spread) |
| `src/tools/register-all.ts` | 36-02 | two new `import "./get_safe_positions.js"` + `import "./get_safe_transaction.js"` side-effect lines | Every existing `register-all.ts` line (e.g. lines 113-115 Curve / lines 116-117 Phase 35 escape-hatch) |
| `src/tools/get_vaultpilot_config_status.ts` | 36-01 (optional, discretion) | add `safeTxServiceApiKeyPresent: boolean` to response | `etherscanApiKeyPresent` at line 126: `Boolean(process.env.ETHERSCAN_API_KEY)` |
| `src/config/env.ts` | 36-01 | add `getSafeTxServiceApiKey()` lazy reader | `getEtherscanApiKey()` at line 177-179: `return read("ETHERSCAN_API_KEY")` (exact one-line mirror) |

---

## Pattern Assignments

### `src/clients/safe-tx-service.ts` — Wave 1, Plan 36-01

**Primary analog:** `src/clients/etherscan.ts` (lines 1-624)

**Read first** (planner should embed in `<read_first>` of every task touching this file):
- `src/clients/etherscan.ts:1-100` — file-header docstring + 5-arm DU + module-scope cache + per-session counter declarations
- `src/clients/etherscan.ts:198-367` — `checkContractSecurity` end-to-end (auth check → cache check → rate-budget check → AbortController timeout → fetch → status branching → cache insert)
- `src/clients/etherscan.ts:369-396` — `cacheInsert` LRU eviction + `_resetEtherscanCacheForTesting` / `_resetEtherscanRateCounterForTesting` test-only resets
- `src/clients/etherscan.ts:420-615` — `fetchEtherscanAbi` (the second per-endpoint method, mirror the multi-method shape) + `getCachedEtherscanAbi` (cache-only read for `get_safe_transaction`'s sibling decode path)

**Imports pattern** (mirror lines 35-38 verbatim):
```typescript
import { type Address } from "viem";
import { type ChainId } from "../config/contracts.js";
import { log } from "../diagnostics/logger.js";
import { getSafeTxServiceApiKey } from "../config/env.js"; // NEW — Plan 36-01 adds this getter
```

**5-arm DU shape** (mirror `EtherscanResult` at lines 46-65; new Phase 36 type adds a 5th `unsupported-chain` arm not present in Etherscan):
```typescript
export type SafeInfoResult =
  | { kind: "ok"; safe: SafeInfoResponseDecoded }
  | { kind: "not-found" }
  | { kind: "rate-limited"; message: string; retryAfterMs?: number }
  | { kind: "error"; message: string }
  | { kind: "unsupported-chain"; chainId: ChainId };
```
The `unsupported-chain` arm has NO existing analog (`etherscan.ts` is multi-chain but every supported chain has an endpoint). The shape mirrors `DispatchCheckResult` from `src/security/canonical-dispatch.ts:258-260` for the "refusal-shape with chainId verbatim" pattern.

**Module-scope state** (mirror lines 88-99):
```typescript
const safeInfoCache = new Map<string, SafeInfoResult>();   // key: `${chainId}:${safeAddress}`, max ~32
const safeTxCache = new Map<string, SafeTxResult>();       // key: `${chainId}:${safeTxHash}`, max ~64
let agentSessionCallCount = 0;                              // soft ceiling ~30 (tune)
const SAFE_INFO_CACHE_MAX = 32;
const SAFE_TX_CACHE_MAX = 64;
const PER_SESSION_CALL_LIMIT = 30;
const SAFE_TX_SERVICE_TIMEOUT_MS = 5000; // 2× etherscan's 3000ms — Tx Service latency is higher
```

**Per-chain endpoint table** (NEW — no existing analog at the client level; format-fanout-sentinel mirrors `CONTRACTS_RAW` shape from `src/config/contracts.ts:87`):
```typescript
const SAFE_TX_SERVICE_BASE = "https://api.safe.global/tx-service";
const SAFE_TX_SERVICE_ENDPOINTS: Record<ChainId, string> = {
  1:     `${SAFE_TX_SERVICE_BASE}/eth/api`,
  10:    `${SAFE_TX_SERVICE_BASE}/oeth/api`,
  137:   `${SAFE_TX_SERVICE_BASE}/pol/api`,
  8453:  `${SAFE_TX_SERVICE_BASE}/base/api`,
  42161: `${SAFE_TX_SERVICE_BASE}/arb1/api`,
};
```
(Shortname mapping from `36-RESEARCH.md:601-607` — verbatim from `@safe-global/api-kit@main/utils/config.ts`.)

**Endpoint handler body** (mirror `checkContractSecurity` at lines 198-367):
```typescript
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
    return { kind: "rate-limited", message: `per-session limit (${PER_SESSION_CALL_LIMIT}) exceeded; resets at MCP restart` };
  }
  agentSessionCallCount += 1;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAFE_TX_SERVICE_TIMEOUT_MS);

  // Lazy auth-header probe — never log the key (T-SAFE-KEY-LEAK-1; mirror of T-ETHERSCAN-KEY-LEAK-1 at line 222-223)
  const apiKey = getSafeTxServiceApiKey();
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
      log("warn", `Safe Tx Service lookup failed for chain=${chainId} safe=${safe}: ${result.message}`);
    } else {
      // JSON parse + shape validate; on parse failure → kind: "error"
      // ...
    }
  } catch (err) {
    const errorObj = err as Error;
    if (errorObj?.name === "AbortError") {
      result = { kind: "error", message: `Safe Tx Service unreachable (timeout ${SAFE_TX_SERVICE_TIMEOUT_MS}ms)` };
    } else {
      result = { kind: "error", message: `Safe Tx Service unreachable: ${errorObj?.message ?? String(err)}` };
    }
    log("warn", `Safe Tx Service lookup failed for chain=${chainId} safe=${safe}: ${result.message}`);
  } finally {
    clearTimeout(timer);
  }
  cacheInsert(safeInfoCache, SAFE_INFO_CACHE_MAX, cacheKey, result);
  return result;
}
```

**Endpoints** (verbatim paths from `36-RESEARCH.md:621-629`):
```
GET ${endpoint}/v1/owners/{ownerAddress}/safes/
GET ${endpoint}/v1/safes/{safeAddress}/
GET ${endpoint}/v2/safes/{safeAddress}/multisig-transactions/?executed=false&nonce__gte={N}&ordering=nonce&limit=20
GET ${endpoint}/v2/multisig-transactions/{safeTxHash}/
```

**LRU eviction helper** (generic-over-cache version of `cacheInsert` at lines 369-377):
```typescript
function cacheInsert<T>(cache: Map<string, T>, max: number, key: string, value: T): void {
  if (cache.size >= max) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, value);
}
```

**Test-only resets** (mirror lines 383-395):
```typescript
export function _resetSafeTxServiceCachesForTesting(): void {
  safeInfoCache.clear();
  safeTxCache.clear();
}
export function _resetSafeTxServiceRateCounterForTesting(): void {
  agentSessionCallCount = 0;
}
```

**Critical discipline carried verbatim from `etherscan.ts`:**
- NEVER log the URL or the `Authorization` header — log `chainId + safe + status code` only (T-SAFE-KEY-LEAK-1 mirror of T-ETHERSCAN-KEY-LEAK-1 at lines 222-223)
- Counter increments BEFORE the network call; cached hits do NOT consume budget (lines 209-217)
- `AbortController` timer in `finally`-clear to prevent event-loop leak (lines 358-362)
- Cache ALL arms (including `not-found`, `error`) — not just `ok`; mirrors lines 365-366

---

### `src/chains/safe.ts` — Wave 2, Plan 36-02

**Primary analog:** `src/chains/aave-v3.ts` (lines 1-148)

**Read first**:
- `src/chains/aave-v3.ts:1-43` — file-header docstring + `parseAbi` struct-ref ABI declaration
- `src/chains/aave-v3.ts:100-138` — `getReservesData` / `getUserReservesData` SOT-getter consumption (`getAaveV3UiPoolDataProvider` + `getAaveV3PoolAddressesProvider`)
- `src/chains/aave-v3.ts:141-148` — `_aaveChains = { getReservesData, getUserReservesData }` ESM spy indirection (mandatory per CLAUDE.md "ESM spy-affordance" convention)

**Imports pattern** (mirror lines 12-18):
```typescript
import { type Address, type PublicClient, parseAbi } from "viem";
import { type ChainId } from "../config/contracts.js";
```

**Sentinel constant + parseAbi block** (mirror lines 37-43 shape; surface from `36-RESEARCH.md:579-587`):
```typescript
export const SAFE_SENTINEL_MODULES: Address = "0x0000000000000000000000000000000000000001";

export const safeSingletonAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] modules, address next)",
]);
```
**Named-return discipline** (Pitfall 10 from RESEARCH § lines 556-564): every `returns (...)` clause uses NAMED parameters so viem multicall typing infers correctly. NO unnamed-tuple returns.

**Reader function: 4-call multicall** (mirror `getReservesData` at lines 100-113 — `client.readContract` shape; widen to `client.multicall` per `get_token_allowances.ts:275` precedent — RESEARCH § lines 706-725):
```typescript
export async function getOnchainSafeInfo(
  client: PublicClient,
  chainId: ChainId,
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

**Module enumeration** (NEW — no Aave analog; uses `getModulesPaginated` single-call cap-at-100 per Pitfall 5 from RESEARCH § lines 506-514):
```typescript
export async function getEnabledModules(
  client: PublicClient,
  chainId: ChainId,
  safe: Address,
): Promise<{ modules: Address[]; truncated: boolean; nextCursor: Address | null }> {
  const result = await client.readContract({
    address: safe,
    abi: safeSingletonAbi,
    functionName: "getModulesPaginated",
    args: [SAFE_SENTINEL_MODULES, 100n],
  });
  const [rawModules, next] = result as unknown as readonly [readonly Address[], Address];
  // SENTINEL filter (Pitfall 4 — RESEARCH § lines 496-504)
  const modules = rawModules.filter((m) => m.toLowerCase() !== SAFE_SENTINEL_MODULES.toLowerCase());
  const truncated = next.toLowerCase() !== SAFE_SENTINEL_MODULES.toLowerCase();
  return { modules, truncated, nextCursor: truncated ? next : null };
}
```

**ESM spy indirection** (mirror line 148 — MANDATORY per CLAUDE.md; written at file-creation time, not retroactive):
```typescript
export const _safeChains = { getOnchainSafeInfo, getEnabledModules };
```
Consumers (`src/tools/get_safe_positions.ts`) MUST call `_safeChains.getOnchainSafeInfo(...)`, NOT the bare named export.

---

### `src/config/contracts.ts` extension — Wave 1, Plan 36-01

**Primary analog:** `LidoContracts` (lines 384-438) — closest single-sub-table-with-multi-role-fields shape.
**Secondary analog:** `UniswapV3Contracts` (lines 741-791) — for the `Partial<Record<ChainId, X>>` pattern + per-role getter shape.

**Read first**:
- `src/config/contracts.ts:381-438` — `LidoContracts` interface + `LIDO_RAW: Partial<Record<ChainId, LidoContracts>>` + 3 getters returning `Address | null`
- `src/config/contracts.ts:738-791` — `UniswapV3Contracts` interface + `UNISWAP_V3_RAW` + 3 getters
- `src/config/contracts.ts:1-95` — file header convention: `getAddress`-wrapped literals at the literal site (format-fanout-sentinel)

**SafeContracts interface** (mirror `LidoContracts` shape at lines 384-388 — multi-role per chain; shape pre-locked in RESEARCH § lines 890-903):
```typescript
export interface SafeContracts {
  /** Up to 4 singleton variants (v1.3.0-L1, v1.3.0-L2, v1.4.1-L1, v1.4.1-L2). RESEARCH § Pitfall 2. */
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
```

**`SAFE_CONTRACTS_RAW`** (mirror `LIDO_RAW` at lines 390-405 — `Partial<Record<ChainId, ...>>`; per-chain entries from RESEARCH § lines 870-886). All 5 chains share the SAME addresses (safe-deployments JSON canonical-across-eip155):
```typescript
const SAFE_CONTRACTS_RAW: Partial<Record<ChainId, SafeContracts>> = {
  1: {
    singletons: {
      v130L1: getAddress("0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552"),
      v130L2: getAddress("0x3E5c63644E683549055b9Be8653de26E0B4CD36E"),
      v141L1: getAddress("0x41675C099F32341bf84BFc5382aF534df5C7461a"),
      v141L2: getAddress("0x29fcB43b46531BcA003ddC8FCB67FFE91900C762"),
    },
    proxyFactoryV130: getAddress("0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2"),
    proxyFactoryV141: getAddress("0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67"),
    multiSendV130: getAddress("0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761"),
    multiSendV141: getAddress("0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526"),
    multiSendCallOnlyV130: getAddress("0x40A2aCCbd92BCA938b02010E17A5b8929b49130D"),
    multiSendCallOnlyV141: getAddress("0x9641d764fc13c8B624c04430C7356C1C7C8102e2"),
    signMessageLibV130: getAddress("0xA65387F16B013cf2Af4605Ad8aA5ec25a2cbA3a2"),
    signMessageLibV141: getAddress("0xd53cd0aB83D845Ac265BE939c57F53AD838012c9"),
    compatibilityFallbackHandlerV130: getAddress("0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4"),
    compatibilityFallbackHandlerV141: getAddress("0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99"),
  },
  // 42161 / 137 / 8453 / 10 — same address set for each chain per safe-deployments JSON.
  // (Repeat the same object 4 more times; researcher confirmed identical addresses across eip155.)
};
```

**Getters** (mirror `getLidoStethAddress` at lines 414-416 for the single-address shape; new `getSafeSingletonAddresses` returns `Address[]` per RESEARCH § lines 905-909 because the canonical-dispatch arm needs up to 4 entries per chain):
```typescript
export function getSafeSingletonAddresses(chainId: ChainId): Address[] {
  const c = SAFE_CONTRACTS_RAW[chainId];
  if (!c) return [];
  return [c.singletons.v130L1, c.singletons.v130L2, c.singletons.v141L1, c.singletons.v141L2];
}

export function getSafeProxyFactoryAddresses(chainId: ChainId): Address[] {
  const c = SAFE_CONTRACTS_RAW[chainId];
  if (!c) return [];
  return [c.proxyFactoryV130, c.proxyFactoryV141];
}
// ... mirror per role (multiSend, multiSendCallOnly, signMessageLib, compatibilityFallbackHandler).
```

---

### `src/security/canonical-dispatch.ts` extension — Wave 1, Plan 36-01

**Primary analog:** Phase 34 Curve arm at lines 200-205 (most-recent-precedent additive arm).
**Secondary analog:** Phase 33 Uniswap NPM arm at lines 187-199 (single-getter null-filter spread shape).

**Read first**:
- `src/security/canonical-dispatch.ts:1-77` — file-header docstring (allowlist purpose, format-fanout-sentinel discipline, ESM spy convention)
- `src/security/canonical-dispatch.ts:117-221` — `buildPerChainAllowlist` function — extend the spread list at line 219 (between `...uniswapV3LpEntries` and `...curveEntries`)
- `src/security/canonical-dispatch.ts:238-246` — `CANONICAL_DISPATCH_TARGETS` Record + per-chain count comments at lines 233-237 (UPDATE these line counts in the same diff)

**Wiring pattern** (mirror Curve arm at lines 200-205 — single-line additive extension):
```typescript
// Phase 36 Plan 36-01 — Safe Singleton dispatch allowlist arm. Each chain may
// carry up to 4 singleton variants (v1.3.0-L1, v1.3.0-L2, v1.4.1-L1, v1.4.1-L2).
// Phase 37 prepare_safe_tx_propose / approve / execute consume this gate — Phase 36
// wires it without a live producer (no Safe handle yet exists).
// Non-Ethereum chains: getSafeSingletonAddresses returns up to 4 entries per chain
// (safe-deployments canonical across eip155 — same addresses on every supported chain).
const safeSingletonEntries: Address[] = getSafeSingletonAddresses(chainId);
```

**Spread into the per-chain Set** (add new line at the end of the existing list at line 219):
```typescript
return new Set<Address>([
  getAaveV3PoolAddress(chainId),
  getWethAddress(chainId),
  ONEINCH_V6_ROUTER_ALL_CHAINS,
  LIFI_DIAMOND_ALL_CHAINS,
  ...tokenContracts,
  ...compoundComets,
  ...morphoEntries,
  ...lidoEntries,
  ...eigenEntries,
  ...rocketEntries,
  ...uniswapEntries,
  ...uniswapV3LpEntries,
  ...curveEntries,
  ...safeSingletonEntries,   // ← NEW Phase 36
]);
```

**Import addition** (extend the existing import block at lines 60-77):
```typescript
import {
  // ... existing imports
  getSafeSingletonAddresses,   // ← NEW Phase 36
  type ChainId,
} from "../config/contracts.js";
```

**Per-chain count comments** (UPDATE lines 233-237 — Ethereum 40→44, Arbitrum 21→25, Polygon 22→26, Base 8→12, Optimism 17→21 per RESEARCH § Architecture diagram + § lines 885 `4 × 5 = 20 new entries total`).

---

### `src/tools/get_safe_positions.ts` — Wave 2, Plan 36-02

**Primary analog:** `src/tools/get_portfolio_summary.ts` (lines 280-422) for the cross-chain fan-out pattern.
**Secondary analog:** `src/tools/get_lending_positions.ts` (lines 610-720) for the single-chain handler + per-Safe row builder scaffolding.

**Read first**:
- `src/tools/get_lending_positions.ts:27-91` — imports + DESCRIPTION array + INPUT_SCHEMA shape (mirror the `chain` enum + `wallet` regex pattern)
- `src/tools/get_lending_positions.ts:610-720` — handler scaffolding (`registerTool` body — chainName/chainId resolution → wallet validation → reader call → result assembly)
- `src/tools/get_portfolio_summary.ts:280-422` — multi-chain branch (`Promise.allSettled` + per-chain `AbortController` + `chainErrors` per-chain failure surface)
- `src/tools/get_portfolio_summary.ts:438-460` — `readChainPortfolioWithTimeout` `Promise.race` against AbortController (the per-chain timeout wrapper)

**Imports pattern** (mirror `get_lending_positions.ts:27-54`):
```typescript
import { getAddress, isAddress, type Address } from "viem";

import { _safeChains } from "../chains/safe.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import * as safeTxService from "../clients/safe-tx-service.js";
import {
  chainIdFromName,
  chainNameFromId,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { getConfiguredChainIds } from "../config/env.js";
import { registerTool } from "./index.js";
```

**INPUT_SCHEMA pattern** (mirror `get_lending_positions.ts:73-90` — but `chain` becomes OPTIONAL per CONTEXT lock):
```typescript
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description: "OPTIONAL. Omit to fan out across all 5 configured EVM chains (per-chain 10s timeout). Pass one to narrow.",
    },
    wallet: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "EVM wallet address (EIP-55 not required; case-insensitive).",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};
```

**Per-chain fan-out pattern** (mirror `get_portfolio_summary.ts:346-409` shape verbatim):
```typescript
const PER_CHAIN_TIMEOUT_MS = 10_000;
const ALL_CHAIN_NAMES: readonly ChainName[] = ["ethereum", "arbitrum", "polygon", "base", "optimism"];

registerTool("get_safe_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
    return { isError: true, content: [{ type: "text", text: "error: `wallet` must be a valid 0x-prefixed EVM address" }] };
  }
  const wallet: Address = getAddress(walletRaw);

  const chainArgRaw = args.chain;
  const targetChains: ChainName[] =
    chainArgRaw === undefined ? [...ALL_CHAIN_NAMES] : [chainArgRaw as ChainName];

  const perChainResults = await Promise.allSettled(
    targetChains.map((chainName) => readSafesForChainWithTimeout(chainName, wallet)),
  );

  const safesByChain: Array<{ chain: ChainName; chainId: ChainId; safes: SafePositionRow[] }> = [];
  const degradedChains: ChainId[] = [];
  const degradedReasons: Record<number, string> = {};

  perChainResults.forEach((r, i) => {
    const chainName = targetChains[i]!;
    const chainId = chainIdFromName(chainName);
    if (r.status === "fulfilled") {
      safesByChain.push({ chain: chainName, chainId, safes: r.value });
    } else {
      degradedChains.push(chainId);
      degradedReasons[chainId] = r.reason instanceof Error ? r.reason.message : String(r.reason);
    }
  });

  const result = { wallet, safesByChain, degradedChains, degradedReasons /* + optional safeTxServiceApiKeyPresent */ };
  return { content: [{ type: "text", text: renderSummary(result) }], structuredContent: { ...result } };
});

async function readSafesForChainWithTimeout(chainName: ChainName, wallet: Address): Promise<SafePositionRow[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PER_CHAIN_TIMEOUT_MS);
  try {
    return await Promise.race<SafePositionRow[]>([
      readSafesForChain(chainName, wallet, abort.signal),
      new Promise<SafePositionRow[]>((_, reject) => {
        abort.signal.addEventListener("abort", () => reject(new Error(`timeout after ${PER_CHAIN_TIMEOUT_MS}ms`)));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
```

**Per-Safe row builder** (NEW shape — mirrors `buildRow` from `get_lending_positions.ts` at lines 880-912 for the structure):
```typescript
interface SafePositionRow {
  safeAddress: Address;
  owners: readonly Address[];          // ON-CHAIN values per CONTEXT lock (NOT Tx Service)
  threshold: number;                    // ON-CHAIN
  nonce: string;                        // ON-CHAIN bigint → decimal string
  version: string;                      // ON-CHAIN VERSION() return
  enabledModules: Address[];            // sentinel-filtered
  enabledModulesTruncated: boolean;
  pendingTransactions: PendingTxCompact[];  // top 20 lowest-nonce; max 20
  pendingTransactionsTruncated: boolean;
  pendingTransactionsTotalCount: number;
  txServiceDrift: boolean;
  driftReasons: string[];               // RESEARCH § OQ #2: ["owners-set-mismatch", "threshold-mismatch", "version-mismatch", ...]
  rpcDegraded?: boolean;                // mirror get_lending_positions surfacing
}
interface PendingTxCompact {
  safeTxHash: string;
  nonce: string;
  collectedSignatures: number;
  requiredSignatures: number;
  isExecutable: boolean;
}
```

**Wallet-not-owner silent-drop** (CONTEXT lock — defensive against stale Tx Service):
```typescript
const onchainInfo = await _safeChains.getOnchainSafeInfo(client, chainId, safe);
if (!onchainInfo.owners.some((o) => o.toLowerCase() === wallet.toLowerCase())) {
  return null; // silently dropped from output
}
```

**Drift detection** (RESEARCH § A7: prefer VERSION() string compare over singleton-address compare):
```typescript
const driftReasons: string[] = [];
if (txServiceInfo.owners.length !== onchainInfo.owners.length /* + member compare */) driftReasons.push("owners-set-mismatch");
if (Number(txServiceInfo.threshold) !== Number(onchainInfo.threshold)) driftReasons.push("threshold-mismatch");
if (txServiceInfo.version !== onchainInfo.version) driftReasons.push("version-mismatch");
// nonce stale tolerated up to +3 per RESEARCH § OQ #2; > 3 → "nonce-stale"
```

---

### `src/tools/get_safe_transaction.ts` — Wave 2, Plan 36-02

**Primary analog:** `src/tools/get_transaction_status.ts` (entire file, 136 lines) — single-tx-hash + chain-required shape.
**Secondary analog:** `src/tools/check_contract_security.ts` (lines 1-120) — discriminated-union response surface + cause-naming refusal envelope.

**Read first**:
- `src/tools/get_transaction_status.ts:1-136` — entire file (DESCRIPTION → INPUT_SCHEMA → handler — same chain+hash schema we need)
- `src/tools/check_contract_security.ts:33-120` — DESCRIPTION array + INPUT_SCHEMA + response shape + error-envelope discipline
- `src/clients/etherscan.ts:609-615` — `getCachedEtherscanAbi` cache-only read (NO network call; mirror at lines 609-615 — this is the load-bearing seam Phase 36 reuses for best-effort decode)

**Imports pattern**:
```typescript
import { getAddress, isAddress, decodeFunctionData, type Address, type Hex } from "viem";

import * as safeTxService from "../clients/safe-tx-service.js";
import { getCachedEtherscanAbi } from "../clients/etherscan.js";
import { chainIdFromName, type ChainName } from "../config/contracts.js";
import { registerTool } from "./index.js";
```

**INPUT_SCHEMA** (mirror `get_transaction_status.ts:20-37`; `chain` is REQUIRED here per CONTEXT lock):
```typescript
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"] },
    safeAddress: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    safeTxHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
  },
  required: ["chain", "safeAddress", "safeTxHash"],
  additionalProperties: false,
};
```

**Response shape**:
```typescript
interface SafeTransactionResult {
  chain: ChainName;
  chainId: number;
  safe: Address;
  safeTxHash: string;
  to: Address;
  value: string;                       // STRING per Tx Service wire shape (Pitfall 3)
  data: Hex;                           // calldata; "0x" for value-only
  operation: "call" | "delegatecall";  // CONTEXT lock — semantic discriminator NOT raw 0/1
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: Address;
  refundReceiver: Address;
  nonce: string;
  collectedSignatures: number;
  requiredSignatures: number;
  isExecutable: boolean;
  confirmations: Array<{ owner: Address; signature: string; signatureType: string }>;  // (tx.confirmations ?? []) per Pitfall 6
  decodedOperation: string | null;     // cache HIT → "transfer(0x..., 1000)" style; MISS → null
}
```

**Best-effort decoded operation** (NEW pattern; uses Phase 35's `getCachedEtherscanAbi` per RESEARCH § A5 — cache-only, no network I/O):
```typescript
function decodeSafeTxOperation(chainId: ChainId, to: Address, data: Hex): string | null {
  if (data === "0x" || data.length < 10) return null;
  const cached = getCachedEtherscanAbi(chainId, to);
  if (!cached || cached.kind !== "ok") return null; // miss or non-ok arm → null per CONTEXT lock
  try {
    const decoded = decodeFunctionData({ abi: cached.abi, data });
    const args = decoded.args?.map((a) => String(a)).join(", ") ?? "";
    return `${decoded.functionName}(${args})`;
  } catch {
    return null;
  }
}
```

**Handler error envelope** (mirror `check_contract_security.ts:108-128` discriminated-union refusal shape — never throws):
```typescript
const txResult = await safeTxService.getMultisigTransaction(chainId, safeTxHash);
if (txResult.kind === "unsupported-chain") {
  return { isError: true, content: [{ type: "text", text: `error: Safe Tx Service has no endpoint for chain ${chainName}` }] };
}
if (txResult.kind === "not-found") {
  return { isError: true, content: [{ type: "text", text: `error: SafeTx hash ${safeTxHash} not registered in Tx Service` }] };
}
if (txResult.kind === "rate-limited") { /* surface verbatim retry-after */ }
if (txResult.kind === "error") { /* surface verbatim upstream message */ }
// txResult.kind === "ok" → decode + assemble response
```

---

## Shared Patterns

### Format-fanout-sentinel (every hardcoded address)

**Source:** `src/config/contracts.ts:85-95` (file-header convention)
**Apply to:** every new `Address` literal in `src/config/contracts.ts` and `src/security/canonical-dispatch.ts`
**Pattern:** every `0x...` literal wrapped in `getAddress(...)` at the literal site — corrupted snapshot throws EIP-55 at module load.
```typescript
import { getAddress } from "viem";
const FOO_ADDRESS: Address = getAddress("0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552");
```

### Never-throws external HTTP client invariant

**Source:** `src/clients/etherscan.ts:198-367` (entire `checkContractSecurity` body)
**Apply to:** `src/clients/safe-tx-service.ts` every exported method
**Pattern:** every code path returns one of the DU arms; the only `throw` is the abort-signal one viem itself raises (caught in the `catch` → `kind: "error"` branch).
```typescript
// All these surface as DU arms — NEVER throw:
//   - AbortController timeout
//   - Network unreachable
//   - JSON parse failure
//   - HTTP 4xx (non-404, non-429)
//   - HTTP 5xx
//   - Schema validation failure
```

### `vi.stubGlobal("fetch", …)` test seam (NO ESM indirection for network clients)

**Source:** `test/clients-etherscan.test.ts:43-64` (`buildFetch` factory) + lines 134-141 (per-test stub install)
**Apply to:** `test/clients-safe-tx-service.test.ts`
**Pattern:** the test seam is at the OUTER `fetch` edge — per CLAUDE.md "external network clients" convention, NO `_<scope>` indirection inside `safe-tx-service.ts`.
```typescript
function buildFetch(opts: { ok?: boolean; status?: number; payload?: unknown; reject?: Error; hang?: boolean }) {
  return vi.fn(async (input: unknown, init?: { signal?: AbortSignal }) => {
    if (opts.hang) return new Promise<MockResponse>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("aborted"); err.name = "AbortError"; reject(err);
      });
    });
    if (opts.reject) throw opts.reject;
    return { ok: opts.ok ?? true, status: opts.status, json: async () => opts.payload };
  });
}
// Per-test:
vi.stubGlobal("fetch", buildFetch({ payload: SAFE_INFO_OK_FIXTURE }));
```

### ESM spy-affordance `_<scope>` indirection (for `chains/*` reader modules)

**Source:** `src/chains/aave-v3.ts:148` (`_aaveChains` export) + `test/chains-aave-v3.test.ts:117-135` (spy round-trip assertion)
**Apply to:** `src/chains/safe.ts` MUST export `_safeChains = { getOnchainSafeInfo, getEnabledModules }`. Consumers (`get_safe_positions.ts`) MUST call through this object.
**Pattern:**
```typescript
// src/chains/safe.ts (end of file)
export const _safeChains = { getOnchainSafeInfo, getEnabledModules };

// src/tools/get_safe_positions.ts (consumer)
import { _safeChains } from "../chains/safe.js";
// ...
const info = await _safeChains.getOnchainSafeInfo(client, chainId, safe);

// test/integration/safe-positions.test.ts
vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({ owners: [...], threshold: 2n, ... });
```

### Per-session call-counter test rituals

**Source:** `test/clients-etherscan.test.ts:119-130` (`beforeEach`/`afterEach` reset blocks)
**Apply to:** `test/clients-safe-tx-service.test.ts`
**Pattern:**
```typescript
beforeEach(() => {
  _resetSafeTxServiceCachesForTesting();
  _resetSafeTxServiceRateCounterForTesting();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetSafeTxServiceCachesForTesting();
  _resetSafeTxServiceRateCounterForTesting();
});
```

### API key leak audit test (`T-SAFE-KEY-LEAK-1` regression anchor)

**Source:** `test/clients-etherscan.test.ts` Tests at the key-leak section + `src/clients/etherscan.ts:222-223` discipline comment
**Apply to:** `test/clients-safe-tx-service.test.ts` — last test asserts NO `Authorization` / `Bearer` / `apiKey` substring leaks into `log()` calls.
**Pattern:** spy on `logger.log`, run a 401-producing fetch with `SAFE_TX_SERVICE_API_KEY` set, assert no spy-call argument contains the key value or `Bearer` substring.

### Per-chain canonical-dispatch property test (`T-SAFE-SINGLETON-DISPATCH-COVERAGE-1`)

**Source:** `test/security-canonical-dispatch.test.ts:86-116` (per-chain × per-canonical-entry membership)
**Apply to:** `test/security-canonical-dispatch-safe.test.ts`
**Pattern:**
```typescript
const CHAIN_IDS: readonly ChainId[] = [1, 42161, 137, 8453, 10] as const;

describe("CANONICAL_DISPATCH_TARGETS — Safe Singleton variants per chain", () => {
  it("every Safe Singleton variant ∈ allowlist (4 variants × 5 chains = 20 assertions)", () => {
    for (const chainId of CHAIN_IDS) {
      const singletons = getSafeSingletonAddresses(chainId);
      expect(singletons.length).toBe(4);
      for (const singleton of singletons) {
        expect(CANONICAL_DISPATCH_TARGETS[chainId].has(singleton)).toBe(true);
      }
    }
  });
});
```

### Per-chain count bump in `canonical-dispatch.ts` doc-comment

**Source:** `src/security/canonical-dispatch.ts:228-237` (Phase 33 count comments)
**Apply to:** UPDATE those line counts in the Phase 36 diff. Ethereum 40→44, Arbitrum 21→25, Polygon 22→26, Base 8→12, Optimism 17→21 (each +4 singleton variants).

### `register-all.ts` insertion site

**Source:** `src/tools/register-all.ts:113-117` (most-recent Phase 34/35 additions)
**Apply to:** Add two adjacent lines AFTER line 117 (after `prepare_custom_call.js`):
```typescript
import "./get_safe_positions.js";    // Phase 36 Plan 36-02 (SAFE-01) — Safe positions multi-chain fan-out + on-chain cross-check
import "./get_safe_transaction.js";  // Phase 36 Plan 36-02 (SAFE-02) — Safe Tx full detail + best-effort calldata decode
```

---

## FROZEN-area Zero-Diff Assertion (Plan 36-02 close-out task)

Phase 36 is read-only. The following paths MUST show ZERO diff at `/gsd-verify-work`:

| FROZEN path | Why it stays untouched |
|-------------|------------------------|
| `src/signing/payload-fingerprint.ts` | No new tx shape — Phase 37 introduces Fixture SAFE-A |
| `src/signing/presign-hash.ts` | No new presign assembly |
| `src/signing/handle-store.ts` | No new handle kind — Phase 36 produces no handles |
| `src/tools/send_transaction.ts` | Three-gate region locked; no new dispatch verbs |
| `src/tools/preview_send.ts` | Layer 0.5 gate consumes `CANONICAL_DISPATCH_TARGETS` via existing `checkDispatchTarget` — the extension to the Set is read transparently, no `preview_send.ts` line changes |
| `test/signing-fingerprint.test.ts` | No new fixture row at Phase 36 (Phase 37 adds SAFE-A) |
| `test/signing-presign-hash.test.ts` | Same |

**Plan 36-02 final task:** run `git diff --stat -- src/signing/ src/tools/send_transaction.ts src/tools/preview_send.ts test/signing-*.test.ts` and assert empty output.

---

## No Analog Found

| File | Role | Reason | Planner Guidance |
|------|------|--------|------------------|
| `SAFE_TX_SERVICE_ENDPOINTS` per-chain table (inside `safe-tx-service.ts`) | per-chain string-template registry | No existing client maintains a per-chain endpoint URL table — `etherscan.ts` is single-base-URL with `chainid=${N}` query | RESEARCH § lines 590-615 provides the verbatim shortname mapping; mirror `CONTRACTS_RAW` literal-table style |
| `unsupported-chain` arm | DU arm for "chain not in endpoint table" | Etherscan's 5-arm DU has no parallel arm (every supported chain has an endpoint) | Use `DispatchCheckResult` from `canonical-dispatch.ts:258-260` as the shape template (`{ kind, chainId }` minimal payload) |
| `txServiceDrift: boolean` + `driftReasons: string[]` | per-Safe drift detection surface | No existing tool cross-checks an off-chain source against on-chain | RESEARCH § OQ #2 enumerates the semantic labels (`"owners-set-mismatch"`, `"threshold-mismatch"`, `"version-mismatch"`, `"modules-set-mismatch"`, `"nonce-stale"`). Wave 0 test stubs anchor each label. |
| Cross-chain test for `get_safe_positions` fan-out | integration | No existing read-tool has a multi-chain integration test with stubbed-fetch + stubbed-multicall composition | `test/get-portfolio-summary.cross-chain.test.ts` is the closest (different domain but same `Promise.allSettled` fan-out shape); planner extracts the per-chain timeout fixture pattern |

---

## Metadata

**Analog search scope:** `src/clients/`, `src/chains/`, `src/security/`, `src/config/`, `src/tools/`, `test/`, `test/integration/`
**Files scanned (full read or targeted-section read):** 11
- `src/clients/etherscan.ts` (623 lines, full read)
- `src/chains/aave-v3.ts` (148 lines, full read)
- `src/security/canonical-dispatch.ts` (298 lines, full read)
- `src/config/contracts.ts` (1376 lines, lines 1-100 + 381-438 + 738-791 targeted)
- `src/tools/get_lending_positions.ts` (959 lines, lines 1-220 + 600-720 + 880-959 targeted)
- `src/tools/get_portfolio_summary.ts` (1095 lines, lines 335-460 targeted via grep)
- `src/tools/get_transaction_status.ts` (136 lines, full read)
- `src/tools/get_vaultpilot_config_status.ts` (285 lines, lines 1-130 targeted)
- `src/tools/check_contract_security.ts` (267 lines, lines 1-120 targeted)
- `src/tools/index.ts` + `src/tools/register-all.ts` (full read both)
- `src/config/env.ts` (319 lines, lines 1-180 targeted)

**Test analogs scanned:** `test/clients-etherscan.test.ts` (lines 1-200), `test/security-canonical-dispatch.test.ts` (lines 1-120), `test/chains-aave-v3.test.ts` (full read), `test/aave-v3-lifecycle.integration.test.ts` (lines 1-150)

**Pattern extraction date:** 2026-05-27

---

*Phase: 36-safe-positions-tx-service*
*Pattern mapping (gsd-pattern-mapper) — 2026-05-27*
