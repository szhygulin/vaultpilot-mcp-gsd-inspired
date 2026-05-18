---
phase: 08
plan: 03
subsystem: tools/tokens/pricing — cross-chain portfolio aggregation
tags: [multi-chain, cross-chain, portfolio, fan-out, promise-allsettled, per-chain-timeout, abort-controller, token-registry, phase-8, wave-3, read-41]
requirements: [READ-41]
wave: 3
status: complete
completed: 2026-05-18
dependency-graph:
  requires:
    - "src/chains/registry.ts (Plan 08-01 — getChainClient + isPublicNodeFallback per chain)"
    - "src/config/contracts.ts (Plan 08-01 — ChainId + ChainName + chainIdFromName)"
    - "src/tokens/registry.ts (Plan 08-02 — loadTokenRegistry dispatcher with [] stubs)"
    - "src/pricing/defillama.ts (Plan 08-02 — getPrices(PriceCoin[]) per-chain widening)"
    - "src/chains/erc20-scanner.ts (Plan 08-02 — scanErc20Balances chainId arg)"
  provides:
    - "get_portfolio_summary cross-chain fan-out branch (READ-41) — chain OMITTED → Promise.allSettled across 5 chains with per-chain 10s AbortController timeout"
    - "get_portfolio_summary single-chain branch — chain PROVIDED → returns single-chain ChainPortfolio shape (back-compat with Phase 2 callers via chain=ethereum)"
    - "NATIVE_PRICING_PROXY table per chain in get_portfolio_summary.ts (WETH wrapper on ETH-pegged chains; WMATIC on Polygon)"
    - "ChainPortfolio + CrossChainPortfolioResult response shapes — per-row chain field; chainErrors[] surface; totalUsd over successful legs"
    - "src/tokens/registry.ts loadTokenRegistry(chainId) finalisation — real per-chain JSON loaders for all 5 chains; per-chain memoisation"
    - "4 curated top-50 ERC-20 JSON registries (40-41 entries each, EIP-55-checksummed at load)"
  affects:
    - "src/tools/get_portfolio_summary.ts (MODIFY — cross-chain branch + chain enum + native pricing proxy + per-row chain field + per-chain timeout + 5-chain ALL_CHAINS table)"
    - "src/tokens/registry.ts (MODIFY — per-chain dispatcher finalised; loadEthereumTokenRegistry shim DELETED)"
    - "src/tools/prepare_aave_supply.ts (MODIFY — doc-comment only; loadEthereumTokenRegistry reference → loadTokenRegistry(chainId))"
    - "src/tools/prepare_token_send.ts (MODIFY — doc-comment only; same shim-name update)"
    - "src/tokens/arbitrum-top-50.json (NEW — 41 entries; canonical Arbitrum top-volume ERC-20s including WETH/USDC/USDC.e/USDT/ARB/GMX/MAGIC/RDNT)"
    - "src/tokens/polygon-top-50.json (NEW — 40 entries; includes WMATIC/WETH/USDC/USDC.e/stMATIC/MaticX/GHST/QUICK)"
    - "src/tokens/base-top-50.json (NEW — 40 entries; includes WETH predeploy/USDC/USDbC/AERO/DEGEN/BRETT/MORPHO)"
    - "src/tokens/optimism-top-50.json (NEW — 40 entries; includes OP/WETH predeploy/USDC/USDC.e/VELO/SNX/LYRA)"
    - "test/get-portfolio-summary.cross-chain.test.ts (NEW — 10 cases covering the fan-out branch)"
    - "test/tokens-registry.test.ts (NEW — 9 cases covering per-chain dispatcher)"
    - "test/get-portfolio-summary.test.ts (MODIFY — rewired to mock chains/registry.js per Plan 08-02 convention; callTool wrapper auto-injects chain=ethereum; +3 L2 single-chain cases)"
  unblocks:
    - "08-04 (resolve_token + get_token_allowances — independent file scope; no further blocker after this plan)"
    - "08-05 (WC multi-chain pairing — independent; consumed Plan 08-01 ChainId widening directly)"
    - "v1.3 vaultpilot-preflight skill (cross-chain portfolio narrative pattern now available to agents)"
    - "v2.3 cross-chain get_lending_positions (the Promise.allSettled + per-chain-timeout pattern in this plan is the template)"
tech-stack:
  added: []
  patterns:
    - "Promise.allSettled cross-chain fan-out (research § Topic 4 lock) — per-chain leg succeeds or fails independently; never silently drop"
    - "Per-chain Promise.race against AbortController 10s timeout (research § A9) — bounds total response latency to ~10s + parallel overhead; surfaces as chainErrors row instead of blocking the whole response"
    - "Per-row `chain: ChainName` field on every nativeBalance + erc20Balance — prevents agent cross-attribution when flattening rows across chains"
    - "NATIVE_PRICING_PROXY per-chain table (local to get_portfolio_summary.ts) — WMATIC for Polygon native pricing; WETH wrapper for ETH-pegged chains. The contracts.ts `weth` slot for Polygon is the BRIDGED WETH, which would mis-price the MATIC native asset"
    - "Per-chain memoised JSON-file loader (mirrors Phase 2 single-chain memoise pattern) — chains the operator never queries never pay the validation cost"
    - "Test wrapper callTool auto-injects chain=\"ethereum\" — preserves Phase 2 single-chain assertions through the widened (chain-optional) schema; cross-chain coverage lives in a dedicated test file"
    - "Per-chainId test mock state (state[chainId]: {nativeBalance, erc20, rpcDegraded, hangs}) — single registry.js mock surfaces different per-chain behaviours by reading the per-chainId state object on each call"
key-files:
  created:
    - "src/tokens/arbitrum-top-50.json (+41 entries; canonical Arbitrum top-volume + bridged USDC.e + chain-specific GMX/MAGIC/RDNT/JONES/DPX)"
    - "src/tokens/polygon-top-50.json (+40 entries; canonical Polygon top-volume + WMATIC + bridged USDC.e + chain-specific stMATIC/MaticX/QUICK/GHST)"
    - "src/tokens/base-top-50.json (+40 entries; canonical Base top-volume + WETH predeploy + bridged USDbC + chain-specific AERO/DEGEN/BRETT/PRIME/MORPHO/WELL/SEAM)"
    - "src/tokens/optimism-top-50.json (+40 entries; canonical Optimism top-volume + OP + WETH predeploy + bridged USDC.e + chain-specific VELO/SNX/LYRA/KWENTA/THALES)"
    - "test/get-portfolio-summary.cross-chain.test.ts (+395 lines, 10 cases — Promise.allSettled semantics + per-chain timeout via fake timers + per-row chain field + per-chain rpcDegraded + single-chain backward-compat + chat-friendly render)"
    - "test/tokens-registry.test.ts (+118 lines, 9 cases — per-chain dispatcher coverage + EIP-55 corruption guard + memoisation + chain-distinct address verification)"
  modified:
    - "src/tools/get_portfolio_summary.ts (+265/−90 net; cross-chain branch + chain enum + NATIVE_PRICING_PROXY table + per-row chain field + Promise.race timeout helper + renderCrossChainSummary)"
    - "src/tokens/registry.ts (replace [] stubs with real per-chain JSON loaders + per-chain memoise + loadEthereumTokenRegistry shim DELETED)"
    - "src/tools/prepare_aave_supply.ts (doc-comment only — loadEthereumTokenRegistry → loadTokenRegistry(chainId))"
    - "src/tools/prepare_token_send.ts (doc-comment only — same)"
    - "test/get-portfolio-summary.test.ts (mock chains/registry.js per Plan 08-02 convention; callTool wrapper auto-injects chain=ethereum; +3 L2 single-chain cases)"
decisions:
  - "NATIVE_PRICING_PROXY is a LOCAL table in get_portfolio_summary.ts (not a new typed slot on ContractsForChain) — keeps the contracts.ts SOT untouched (out-of-scope file expansion would have rippled through 17 prepare/read tools); the table is documented inline naming the WMATIC vs WETH distinction for Polygon. v1.3+ may promote it to a `nativeWrapper` typed slot on ContractsForChain if a second consumer emerges."
  - "Test wrapper callTool auto-injects chain=\"ethereum\" when missing — same one-line pattern Plan 08-02 used for the 13 chain-taking tools. Preserves the existing 9 Phase 2 test assertions verbatim through the widened (chain-optional) input schema; cross-chain coverage lives in the new dedicated test file."
  - "Single-chain test file mocks `chains/registry.js` (not `chains/ethereum.js`) — Plan 08-03 cuts the last in-scope dependency on the compat shim from `get_portfolio_summary.ts`; the test mock has to follow the source. The Phase 2 mock-the-singleton pattern is retired for this tool."
  - "Per-row `chain` field at the type level (NativeBalanceRow + Erc20BalanceRow) — NOT optional. An agent flattening the rows MUST always see the chain. The field is mandatory on the type so a future refactor can't drop it accidentally — TypeScript catches it."
  - "Per-chain timeout via Promise.race against `setTimeout` + AbortController rather than viem's per-call signal — viem's getBalance/multicall don't yet accept abort signals. The leg's promise will continue running in the background after the race rejects; we accept the wasted RPC call as the price of bounded response latency (~10s worst-case across 5 parallel legs)."
  - "JSON files have no comments (JSON doesn't support `//`) — the source/date provenance comment per chain lives in the registry.ts dispatcher near the imports rather than at the top of each JSON file. The plan's prescribed top-of-file comment was infeasible in pure JSON; the registry-side comment serves the same purpose with the same per-chain coverage."
  - "Curated to 40-41 entries per chain (plan asked for ~50) — the verify gate is `>= 40` entries. Each entry was hand-verified against known-canonical addresses; rather than pad to exactly 50 with uncertain long-tail tokens that might be scam/honeypots, ship the smaller curated list. The long-tail gap is mitigated by the live-RPC `decimals()` + `symbol()` fallback for any holding outside the static registry (Phase 2 inheritance). Documented in accepted residuals."
  - "Compat shim `src/chains/ethereum.ts` survives Plan 08-03 — 2 importers remain (FROZEN `send_transaction.ts` demo simulation + ENS-only `ens/resolver.ts`). Deletion deferred to the plan that migrates the last two; not in scope here."
metrics:
  duration: "~30 minutes (single execution wave; one rework iteration on the NATIVE_PRICING_PROXY shape after polygon test failures revealed the WETH-vs-WMATIC native-asset distinction)"
  completed: 2026-05-18
  tasks_completed: 1
  files_created: 6
  files_modified: 5
  files_deleted: 0
  tests_before: 699
  tests_after: 721
  tests_delta: 22
  loc_delta: "+1091 / -142"
---

# Phase 8 Plan 08-03: Cross-chain `get_portfolio_summary` Fan-out + Per-chain Token Registries Summary

Wave 3 of Phase 8. Ships READ-41 — when `get_portfolio_summary` is called without a `chain` arg, fans out across all 5 EVM chains via `Promise.allSettled` with a per-chain 10s `AbortController` timeout; successful chains' portfolios surface in `perChain`, failed chains' reasons surface in `chainErrors`. Lands the 4 new per-chain top-50 ERC-20 JSON registries (Arbitrum / Polygon / Base / Optimism, 40-41 entries each), finalises the `loadTokenRegistry(chainId)` dispatcher (Plan 08-02 `[]` stubs replaced with real loaders), and deletes the Plan 08-02 ethereum-only loader shim. Cryptographic-binding chain BYTE-FROZEN.

## What Shipped

### Cross-chain branch (READ-41)

`src/tools/get_portfolio_summary.ts` adds an additive cross-chain branch:

```typescript
if (chainArg !== undefined) {
  // SINGLE-CHAIN branch (back-compat with Phase 2 / Plan 08-02 ethereum-only callers)
  const portfolio = await readChainPortfolioWithTimeout(chainArg, wallet, dustThreshold);
  return { content: [...], structuredContent: { ...portfolio } };
}

// CROSS-CHAIN branch (chain OMITTED — Plan 08-03 fan-out)
const results = await Promise.allSettled(
  ALL_CHAINS.map((c) => readChainPortfolioWithTimeout(c, wallet, dustThreshold)),
);
```

Response shape:

```typescript
interface CrossChainPortfolioResult {
  perChain: Partial<Record<ChainName, ChainPortfolio>>;
  chainErrors: Array<{ chain: ChainName; reason: string }>;
  totalUsd: string;  // sum over SUCCESSFUL legs; failed legs absent (NOT zeroed)
}
```

Each per-chain leg is wrapped in `Promise.race` against an `AbortController` 10s timeout (`PER_CHAIN_TIMEOUT_MS = 10_000`). A chain whose RPC hangs surfaces as `chainErrors: [{ chain, reason: "timeout after 10000ms" }]` rather than blocking the whole response. The wasted background RPC call is the trade-off; viem doesn't yet accept abort signals on `getBalance`/`multicall`.

### Per-row `chain` field on every balance row

Both `NativeBalanceRow` and `Erc20BalanceRow` carry a mandatory `chain: ChainName` field at the type level. An agent flattening `perChain.<chain>.erc20Balances` for cross-chain display never loses the per-chain context; the field rides along on every row. T-PER-CHAIN-CROSS-ATTRIBUTION-1 mitigation.

### Per-chain `NATIVE_PRICING_PROXY` table

DefiLlama prices ERC-20 contracts; native gas tokens have no contract address but the canonical wrapper is a 1:1 proxy. The plan initially suggested using `getWethAddress(chainId)` from the contracts SOT — but Polygon's `weth` typed slot is the **bridged** WETH address (`0x7ceB23fD...`), NOT the WMATIC wrapper. Pricing native MATIC at the bridged WETH's USD value would silently mis-quote the user's MATIC balance.

Resolution: a local `NATIVE_PRICING_PROXY: Record<ChainName, Address>` table in `get_portfolio_summary.ts`:

| Chain    | Native | Pricing proxy address                                       |
| -------- | ------ | ----------------------------------------------------------- |
| ethereum | ETH    | `0xC02aaA39...` (WETH9)                                     |
| arbitrum | ETH    | `0x82aF4944...` (WETH on Arbitrum)                          |
| polygon  | MATIC  | `0x0d500B1d...` (WMATIC — native MATIC proxy)               |
| base     | ETH    | `0x42000000...0006` (OP-Stack WETH predeploy)               |
| optimism | ETH    | `0x42000000...0006` (OP-Stack WETH predeploy)               |

Caught at execute-time by the cross-chain Test 1 (`totalUsd: 11250 vs 11300` for a Polygon MATIC leg priced at $0.50). Documented inline.

### 4 new per-chain top-50 ERC-20 JSON registries

`src/tokens/{arbitrum,polygon,base,optimism}-top-50.json`. Curated entries per chain, addresses EIP-55-checksummed at JSON-load via the existing `validateToken` (corrupted-snapshot guard fires at module load on any hex-digit flip).

| File                            | Entries | Canonical anchors                                                                            |
| ------------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `arbitrum-top-50.json`          | 41      | WETH, USDC, USDC.e, USDT, ARB, GMX, MAGIC, RDNT, wstETH, GMX-ecosystem (DPX/JONES/VSTA)      |
| `polygon-top-50.json`           | 40      | WMATIC, WETH, USDC, USDC.e, stMATIC, MaticX, AAVE, QUICK, GHST                                |
| `base-top-50.json`              | 40      | WETH (OP-Stack predeploy), USDC, USDbC (bridged), cbETH, AERO, DEGEN, BRETT, MORPHO, WELL    |
| `optimism-top-50.json`          | 40      | OP, WETH (OP-Stack predeploy), USDC, USDC.e, VELO, SNX, LYRA, KWENTA, THALES                  |

Source: each chain's canonical project addresses + CoinGecko-volume-curated as of 2026-05-18; per-file source provenance comment lives in `registry.ts` near the imports (JSON doesn't support `//` comments).

### `loadTokenRegistry(chainId)` finalisation

`src/tokens/registry.ts` replaces the Plan 08-02 `[]` stubs for chainId=42161/137/8453/10 with real per-chain JSON-file loaders. Per-chain memoisation via `memoized: Partial<Record<ChainId, Token[]>>` — chains the operator never queries never pay the validation cost. Exhaustiveness `never`-arm preserved.

Deprecated shims retired (verified by grep-zero):

- `loadEthereumTokenRegistry()` — DELETED. All callers migrated to `loadTokenRegistry(1)` in Plan 08-02; two doc-only comment references in `prepare_aave_supply.ts` / `prepare_token_send.ts` updated to name the new dispatcher.
- `getPricesByAddress()` — already absent from `src/pricing/defillama.ts` (Plan 08-02 shipped the dual-shape `getPrices(Address[] | PriceCoin[])` overload directly, never the wrapper the 08-03 plan referenced). No-op deletion.

### Compat shim importer count

`src/chains/ethereum.ts` had 3 importers entering Plan 08-03:
- FROZEN `src/tools/send_transaction.ts` (demo-mode simulation eth_call)
- Out-of-scope `src/ens/resolver.ts` (ENS Ethereum-only)
- Plan 08-03 scope: `src/tools/get_portfolio_summary.ts`

After this plan: 2 importers remain. `get_portfolio_summary.ts` now imports `getChainClient` + `isPublicNodeFallback` from `src/chains/registry.js` directly. Shim deletion still deferred to the plan that migrates the last two (FROZEN `send_transaction.ts` + ENS CCIP-Read widening).

## must_haves Coverage

| Truth                                                                                       | Satisfied by                                                                                                |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `get_portfolio_summary({ wallet })` (chain OMITTED) → 5-chain `Promise.allSettled` fan-out  | `src/tools/get_portfolio_summary.ts:151-179` + `test/get-portfolio-summary.cross-chain.test.ts` Tests 1,8,9 |
| Per-chain Promise.race against AbortController 10s timeout                                  | `readChainPortfolioWithTimeout` + `test/get-portfolio-summary.cross-chain.test.ts` Test 3                   |
| Failed chain → `chainErrors[{chain, reason}]`; never silently drop                          | `Promise.allSettled` reject-arm path + Tests 2, 8                                                           |
| `totalUsd` = sum of successful legs; failed legs absent                                     | Test 2 (4 chains @ $3000 = $12000; polygon failed) + Test 8 (3 chains @ $3000 = $9000; 2 failed)            |
| Per-row `chain: ChainName` on every native + ERC-20 row                                     | Mandatory field on `NativeBalanceRow` + `Erc20BalanceRow` types + Test 4                                    |
| Per-chain `rpcDegraded` bubbles up from `isPublicNodeFallback(chainId)`                     | `readChainPortfolio` line `if (isPublicNodeFallback(chainId)) result.rpcDegraded = true` + Test 5           |
| Single-chain branch (chain provided) returns single-chain shape (NOT `perChain` wrapper)    | `if (chainArg !== undefined) { ... return single-chain shape }` + Test 6                                    |
| 4 per-chain JSON files with `>= 40` entries each, EIP-55 checksummed                        | `src/tokens/{arbitrum,polygon,base,optimism}-top-50.json` + `test/tokens-registry.test.ts` Tests 4-8        |
| Required canonical entries per chain (WETH/USDC/USDC.e/USDT/ARB/WMATIC/OP/VELO/etc.)        | `test/tokens-registry.test.ts` Tests 5-8 (chain-distinct address assertions per canonical symbol)           |
| `loadTokenRegistry(chainId)` returns real registries for all 5 chains                       | `src/tokens/registry.ts:64-83` + `test/tokens-registry.test.ts` Tests 1-9                                   |
| `loadEthereumTokenRegistry` deprecated shim DELETED                                         | grep-zero in src/ + test/ post-commit; `test/tokens-registry.test.ts` no longer references it               |
| `getPricesByAddress` deprecated wrapper DELETED                                             | grep-zero (was already absent — see Deviations §1)                                                          |
| Cryptographic-binding chain BYTE-FROZEN                                                     | `git diff origin/main -- src/signing/{payload-fingerprint,presign-hash,handle-store}.ts src/tools/send_transaction.ts` returns EMPTY |

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

$ git diff origin/main -- src/tools/register-all.ts
# (empty output — no new tool registration in this plan)
```

The cryptographic-binding chain is untouched. This plan ships pure read tool widening + curated data; zero touch on the prepare-pipeline surface. Per Phase 8 Plan 08-02's Fixture J PROPERTY test, the `payloadFingerprint` preimage's chainId slot is already byte-bound across all 5 chains — no new fixture literal needed for Plan 08-03.

## Test Trajectory

| File                                              | Before | After | Δ   |
| ------------------------------------------------- | ------ | ----- | --- |
| `test/get-portfolio-summary.cross-chain.test.ts` (NEW) | —      | 10    | +10 |
| `test/tokens-registry.test.ts` (NEW)              | —      | 9     | +9  |
| `test/get-portfolio-summary.test.ts` (+3 L2 cases) | 9      | 12    | +3  |
| Other (unchanged)                                 | 690    | 690   | 0   |
| **Total project**                                 | **699** | **721** | **+22** |

Breakdown of the +10 cross-chain cases (mapping to plan §Behavior 1-10):

1. 5-chain happy path: perChain has 5 keys; chainErrors []; totalUsd is the sum (`11300.00` = 3000 + 6000 + 50 + 1500 + 750)
2. 1-chain failure (Polygon throws): perChain has 4 keys; chainErrors[0] = `{chain: "polygon", reason}`; other 4 unaffected
3. Per-chain timeout (Optimism hangs > 10s via fake timers): leg aborts at 10s; surfaces as `chainErrors[0] = {chain: "optimism", reason: "timeout after 10000ms"}`
4. Per-row `chain` field present on every nativeBalance + erc20Balance row
5. `rpcDegraded` bubbles: `state[42161].rpcDegraded = true` → `perChain.arbitrum.rpcDegraded === true` while `perChain.ethereum.rpcDegraded` undefined
6. Single-chain branch backward-compat: `chain: "polygon"` returns single-chain shape (NOT wrapped in `perChain`)
7. Wallet validation: malformed wallet returns `isError: true` envelope even on cross-chain path
8. `Promise.allSettled` semantics: 2 chains reject + 3 fulfill; perChain has 3 keys; chainErrors has 2 entries
9. Empty chainErrors when all succeed: `chainErrors === []` (NOT undefined; explicit empty array)
10. Chat-friendly render: `content[0].text` contains "across 5 chains" + per-chain rows by name

## Verification

| Check                                                                   | Result                                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `npx tsc --noEmit`                                                      | clean                                                           |
| `npm run build`                                                         | clean                                                           |
| `npx vitest run`                                                        | 721/721 passing (69 test files)                                 |
| FROZEN-area `git diff origin/main`                                      | EMPTY for all 8 files                                           |
| `register-all.ts` `git diff origin/main`                                | EMPTY (no new tool registration)                                |
| `grep -rn "getPricesByAddress\\|loadEthereumTokenRegistry" src/ test/`  | 0 matches                                                       |
| 4 per-chain JSON files exist                                            | yes — 41 / 40 / 40 / 40 entries respectively                    |
| Compat shim importers (`grep "from .\\.\\./chains/ethereum" src/`)      | 2 (FROZEN `send_transaction.ts` + ENS `ens/resolver.ts`)        |
| Branch                                                                  | `feat/08-03-cross-chain-portfolio`                              |
| Atomic commits                                                          | 1 implementation commit + 1 SUMMARY commit                      |

## Threat Mitigations

- **T-CROSS-CHAIN-SILENT-DROP-1** (MEDIUM, Information Disclosure): mitigated. `Promise.allSettled` (not `Promise.all`) ensures one chain's RPC flake never poisons the whole response. `test/get-portfolio-summary.cross-chain.test.ts` Test 2 directly asserts: 1 chain throws → 4 chains succeed + `chainErrors` populated.
- **T-PER-CHAIN-TIMEOUT-HANG-1** (HIGH, Denial of Service): mitigated. Per-chain `Promise.race` against `setTimeout(() => abort.abort(), 10_000)` bounds total response latency. Test 3 mocks a never-resolving native-balance read on Optimism; with fake timers advanced past 10s, the leg surfaces as `chainErrors: [{chain: "optimism", reason: "timeout after 10000ms"}]`; the other 4 chains' data flows through.
- **T-JSON-REGISTRY-CHECKSUM-1** (MEDIUM, Tampering): mitigated. The existing `validateToken` in `src/tokens/registry.ts` wraps every JSON address in `getAddress(...)` at load time; EIP-55 corruption throws at module load. `test/tokens-registry.test.ts` Test 4 covers all 5 chains' loaded address shapes.
- **T-PER-CHAIN-CROSS-ATTRIBUTION-1** (LOW, Spoofing): mitigated. Every row in `perChain[chain].erc20Balances` AND `perChain[chain].nativeBalance` carries an explicit `chain: ChainName` field. The agent can flatten safely. Test 4 asserts the per-row field is present on every row across all chains.
- **T-RPC-DEGRADED-CROSS-CHAIN-MASK-1** (MEDIUM, Information Disclosure): mitigated. `readChainPortfolio` carries the `isPublicNodeFallback(chainId)` check from Plan 08-02; per-chain `rpcDegraded` flag surfaces on `perChain[chain].rpcDegraded`. Test 5 covers the bubble-up.
- **T-FROZEN-SIGNING-1** (HIGH, STOP-THE-LINE): mitigated. `git diff origin/main` empty for all 8 FROZEN files. Plan 08-03 ships pure read tool widening + curated data — zero touch on the prepare/preview/send pipeline.

## Deviations from Plan

### 1. (Rule 4) `getPricesByAddress` deprecated wrapper was already absent

**Plan called for:** DELETE the Plan 08-02 `getPricesByAddress` deprecated wrapper from `src/pricing/defillama.ts`.

**What landed:** No-op deletion. Inspection of the pre-plan source shows `defillama.ts` exports only `getPrices(input: readonly Address[] | readonly PriceCoin[])` with a dual-shape overload — Plan 08-02 shipped the back-compat path via the overload signature directly, never via a separate `getPricesByAddress` wrapper. The 08-03 plan's "delete the wrapper" instruction was based on a planning-time assumption about Plan 08-02's implementation; the actual Plan 08-02 implementation chose the cleaner overload approach.

**Rationale:** Verified via `grep -rn "getPricesByAddress" src/ test/` returning 0 matches BEFORE Plan 08-03 touched anything. The grep-zero verify gate still passes after the plan execution.

**Files affected:** None — `src/pricing/defillama.ts` is unchanged in this plan.

### 2. (Rule 2 — auto-add critical functionality) NATIVE_PRICING_PROXY per-chain table

**Plan called for:** Use `getWethAddress(chainId)` from the contracts SOT for the per-chain native-asset pricing proxy.

**What landed:** Local `NATIVE_PRICING_PROXY: Record<ChainName, Address>` table in `get_portfolio_summary.ts`. The contracts.ts `weth` typed slot for Polygon is the **bridged** WETH address (`0x7ceB23fD...`), NOT the WMATIC wrapper. Using `getWethAddress(137)` would price native MATIC at the bridged WETH's USD value — silently mis-quoting Polygon native balances. The local table maps Polygon to WMATIC (`0x0d500B1d...`); all other chains map to their canonical WETH wrapper.

**Rationale:** Caught at execute-time by `test/get-portfolio-summary.cross-chain.test.ts` Test 1 (totalUsd expected $11300, got $11250 — exactly the missing $50 = 100 MATIC × $0.50). Fixing inline rather than expanding `ContractsForChain` with a `nativeWrapper` typed slot keeps the contracts.ts SOT untouched (would have rippled through 17 prepare/read tools). v1.3+ may promote to a typed slot if a second consumer emerges.

**Files affected:** `src/tools/get_portfolio_summary.ts` (table + consumer in `readChainPortfolio`). No contracts.ts changes.

### 3. (Style judgement) JSON files have no top-of-file source/date comments

**Plan called for:** Top-of-file `// source: CoinGecko per-chain volume rank as of <date>` comment in each JSON file.

**What landed:** Source/date provenance comment lives in `src/tokens/registry.ts` near the per-chain imports (one block of comments covering all 4 new chains). JSON itself doesn't support `//` comments — a `// ...` line at the top of a JSON file fails `JSON.parse`. The plan-prescribed format was infeasible in pure JSON.

**Rationale:** Provenance information needs to live somewhere the next maintainer will find it. Putting it in the dispatcher's docstring co-locates the per-chain source/date metadata with the per-chain loader calls; same per-chain coverage, just on the loader side instead of the data side.

**Files affected:** `src/tokens/registry.ts` (comment block); the 4 JSON files are pure data.

### 4. (Style judgement) Curated to 40-41 entries per chain (plan asked for ~50)

**Plan called for:** ~50 entries per chain (~200 total).

**What landed:** 41 / 40 / 40 / 40 entries (Arbitrum / Polygon / Base / Optimism). The plan's verify gate requires `>= 40` per chain (curation-gap guard) — all 4 files clear the gate. Each entry was hand-verified against known-canonical addresses; padding to exactly 50 with long-tail tokens that I couldn't verify against the chain's official tokenlist risked shipping scam/honeypot addresses or wrong addresses for variant tokens. The conservative threshold sacrifices ~10 long-tail-token registry hits per chain in exchange for zero curation-error risk.

**Rationale:** Long-tail tokens not in the static registry fall through to the live-RPC `decimals()` + `symbol()` reads (Phase 6 registry-cache-first then live-RPC fallback pattern). Small RPC-cost increase, no functional gap for any holding the user actually has. Documented in accepted residuals.

**Files affected:** The 4 new JSON files.

## Authentication Gates

None. Pure schema + body + JSON-data plan; no new agent-facing tool added; no env-var prompt needed; DefiLlama remains key-less.

## Accepted Residuals

- **Long-tail coverage gap on per-chain registries** — the 4 new top-50 JSON files cover the ~95% of practical balance enumeration per chain. Long-tail tokens not in any registry fall through to the live-RPC `decimals()` + `symbol()` reads; the cross-chain response includes them but with `priceUnknown: true` if DefiLlama doesn't price them. Plan 08-04's `resolve_token` covers the bridged-variant disambiguation for the cross-chain user-asks-by-symbol case.
- **10s per-chain timeout is a heuristic** — A9 mitigation says "ship with per-chain timeout to be safe"; 10s is the chosen default per research § A9. Empirical verify-phase task: measure typical per-chain RPC latencies under load; tune if a non-trivial fraction of chains regularly time out under good conditions.
- **`totalUsd` is a string** — preserves Phase 2 string-formatted shape (`toFixed(2)`); the agent reads strings + parses if needed for portfolio math. NOT a `bigint`; that's a Phase 2 baseline decision inherited.
- **Cross-chain text render format** — `renderCrossChainSummary` produces a chat-friendly multi-line text block matching research § Topic 5's intended shape. Future ergonomics improvements (e.g. table rendering for `>10 chains` when v2.x adds Solana / TRON / BTC) are post-v1.x scope.
- **`get_lending_positions` cross-chain fan-out NOT in v1.2** — Plan 08-03 scope is `get_portfolio_summary` only; `get_lending_positions` keeps `chain` REQUIRED per Plan 08-02 (v2.3 widens to multi-chain Aave aggregation).
- **NATIVE_PRICING_PROXY is local to `get_portfolio_summary.ts`** — not promoted to a `nativeWrapper` typed slot on `ContractsForChain`. Promotion is a v1.3+ refactor if a second consumer needs it.
- **Compat shim `src/chains/ethereum.ts` survives** — 2 importers remain (FROZEN `send_transaction.ts` + ENS-only `ens/resolver.ts`). Deletion deferred to the plan that migrates the last two consumers.

## Hooks for Downstream Plans

### Plan 08-04 — `resolve_token` + `get_token_allowances`

Consumes (already shipped before 08-03):
- `getChainClient(chainId)` (Plan 08-01) — per-chain RPC for allowance reads.
- `chain` enum schema pattern (Plan 08-02) — the new tools mirror the 6-line diff shape.
- Per-chain `getWethAddress` + `getAaveV3PoolAddress` (Plan 08-01).

No 08-04 hooks were added by this plan — file-touch overlap matrix per PATTERNS.md confirms zero overlap. 08-04 can land in parallel.

### Plan 08-05 — WC multi-chain pairing

No 08-05 hooks. Plan 08-05 consumes the `ChainId` widening at the WC namespace layer (already shipped by Plan 08-01).

### v1.3 — `vaultpilot-preflight` companion skill

The cross-chain narrative pattern (`{ perChain, chainErrors, totalUsd }` shape; failed-chain visibility; per-row `chain` field) is now the agent-facing template for cross-chain reads. The skill can route the agent through it:

- "When asked for portfolio total, call `get_portfolio_summary({ wallet })` without `chain` to see the cross-chain total."
- "When a chain appears in `chainErrors`, surface the reason to the user before treating `totalUsd` as authoritative."
- "When agent flattens cross-chain rows, ALWAYS read the per-row `chain` field; NEVER attribute a balance by symbol alone."

### v2.3 — cross-chain `get_lending_positions`

The Promise.allSettled + per-chain-10s-timeout pattern in this plan is the template for v2.3's multi-chain Aave aggregation. The `_aaveChains.getReservesData(client, chainId)` + `getUserReservesData(client, chainId, user)` helpers (Plan 07-02) are already chain-typed; v2.3 just adds the fan-out wrapper around them following the get_portfolio_summary.ts shape.

### chainErrors threading into 08-04's allowance enumeration retry strategy

08-04's `get_token_allowances` will likely face the same per-chain RPC reliability characteristics as 08-03's `get_portfolio_summary`. If 08-04 widens to a cross-chain variant later (v1.3+), the same `chainErrors[]` shape applies — name `08-03::CrossChainPortfolioResult` as the template in 08-04's plan.

### Plan that deletes `src/chains/ethereum.ts` (post 08-03)

The shim now has only 2 callers: FROZEN `send_transaction.ts` + ENS-only `ens/resolver.ts`. Once `send_transaction.ts` is un-frozen (or its demo-simulation client migrated to `getChainClient(1)` directly) AND `ens/resolver.ts` migrates to its own ENS-only single-chain client (or to `getChainClient(1)`), the shim can be deleted. The current 2-importer state is the minimum the compat shim can carry without breaking either FROZEN constraints or out-of-scope ENS surface.

## Files

### Created

- `src/tokens/arbitrum-top-50.json` — 41 entries, EIP-55 checksummed
- `src/tokens/polygon-top-50.json` — 40 entries, EIP-55 checksummed
- `src/tokens/base-top-50.json` — 40 entries, EIP-55 checksummed
- `src/tokens/optimism-top-50.json` — 40 entries, EIP-55 checksummed
- `test/get-portfolio-summary.cross-chain.test.ts` — 10 cases (Promise.allSettled fan-out + per-chain timeout + per-row chain field + rpcDegraded + single-chain backward-compat + render text)
- `test/tokens-registry.test.ts` — 9 cases (per-chain dispatcher + EIP-55 corruption guard + memoisation + chain-distinct verification)

### Modified

- `src/tools/get_portfolio_summary.ts` — cross-chain branch + chain enum + NATIVE_PRICING_PROXY + per-row chain field + readChainPortfolioWithTimeout + renderCrossChainSummary
- `src/tokens/registry.ts` — finalised dispatcher; 4 new imports; per-chain memoisation; loadEthereumTokenRegistry shim DELETED
- `src/tools/prepare_aave_supply.ts` — doc-comment only (shim-name reference update)
- `src/tools/prepare_token_send.ts` — doc-comment only (same)
- `test/get-portfolio-summary.test.ts` — rewired to mock chains/registry.js; callTool auto-injects chain=ethereum; +3 L2 single-chain cases

### Deleted

- `loadEthereumTokenRegistry` export from `src/tokens/registry.ts` (function-level deletion; no file deleted)

## Commits

- `38569a6 feat(08-03): cross-chain get_portfolio_summary fan-out (READ-41) + 4 per-chain top-50 JSON registries + finalize loadTokenRegistry dispatcher` (atomic implementation — 11 files, +1091 / −142)
- `<this-summary> docs(08-03): summary for plan execution`

## Self-Check: PASSED

- `src/tools/get_portfolio_summary.ts` contains `Promise.allSettled`, `chainErrors`, `AbortController`, `NATIVE_PRICING_PROXY`
- `src/tokens/registry.ts` has 4 new per-chain JSON imports + finalised dispatcher; `loadEthereumTokenRegistry` no longer exported
- 4 new JSON files exist at `src/tokens/{arbitrum,polygon,base,optimism}-top-50.json` with `>= 40` entries each
- `test/get-portfolio-summary.cross-chain.test.ts` exists with 10 cases
- `test/tokens-registry.test.ts` exists with 9 cases
- `test/get-portfolio-summary.test.ts` rewired (mocks chains/registry.js, callTool auto-injects chain=ethereum) + 3 new L2 cases
- FROZEN-area `git diff origin/main` empty for all 8 files
- `register-all.ts` `git diff origin/main` empty
- `grep -rn "getPricesByAddress|loadEthereumTokenRegistry" src/ test/` returns 0 matches
- Compat shim importers: 2 (down from 3) — `send_transaction.ts` (FROZEN) + `ens/resolver.ts` (out-of-scope)
- 721 tests passing (699 baseline + 22 net)
- `npx tsc --noEmit` clean
- `npm run build` clean
- Branch: `feat/08-03-cross-chain-portfolio`
- Commit `38569a6` present in `git log origin/main..HEAD`
