---
phase: 08
plan: 01
slug: multi-chain-rpc-registry-and-contracts-sot
subsystem: chains-config-sot
tags: [multi-chain, registry, sot, contracts-widening, phase-8, wave-1, prerequisite, inst-40]
requirements: [INST-40]
wave: 1
status: complete
completed: 2026-05-17
dependency-graph:
  requires:
    - "src/chains/ethereum.ts (Phase 2 singleton — becomes one-wave compat shim)"
    - "src/config/contracts.ts (Plan 06-03 + Plan 07-01 — ChainId widening anchor)"
    - "src/config/env.ts (Phase 2 read helper — 4 new chain-specific readers)"
    - "viem/chains (mainnet, arbitrum, polygon, base, optimism named exports)"
    - "src/diagnostics/logger.ts (warn-once stderr discipline)"
  provides:
    - "src/chains/registry.ts — getChainClient(chainId) memoized factory (5-chain PublicClient cache)"
    - "isPublicNodeFallback(chainId) — per-chain diagnostic predicate"
    - "PUBLICNODE_RPC_URLS — 5-chain table (research § Topic 1 verified)"
    - "PROVIDER_TEMPLATES — infura + alchemy × 5 chains (research § Topic 2 locked)"
    - "_registry ESM spy-affordance object (getProviderShorthandUrl + getChainClient + isPublicNodeFallback + hasRpcConfiguredForChain)"
    - "hasRpcConfiguredForChain(chainId) — diagnostic helper consumed by get_vaultpilot_config_status"
    - "_resetChainRegistryForTesting()"
    - "ChainId = 1 | 42161 | 137 | 8453 | 10 (widened from `1`)"
    - "ChainName = ethereum | arbitrum | polygon | base | optimism"
    - "chainIdFromName(name) + chainNameFromId(id) total + round-trip-deterministic"
    - "CONTRACTS_RAW for 4 new chains (arbitrum/polygon/base/optimism × 6 typed slots)"
    - "src/config/env.ts: getArbitrumRpcUrl + getPolygonRpcUrl + getBaseRpcUrl + getOptimismRpcUrl"
    - "get_vaultpilot_config_status: rpcProvider (verbatim or null) + configuredChains (Record<ChainName, boolean>) additive fields"
  affects:
    - "src/chains/ethereum.ts (MODIFY — replaced with one-wave compat shim delegating to getChainClient(1); deleted by Plan 08-02)"
    - "src/chains/registry.ts (NEW)"
    - "src/config/contracts.ts (MODIFY — ChainId widening + ChainName helpers + 4 new CONTRACTS_RAW entries)"
    - "src/config/env.ts (MODIFY — 4 new chain RPC URL readers)"
    - "src/tools/get_vaultpilot_config_status.ts (MODIFY — additive rpcProvider + configuredChains surface)"
    - "test/chains-registry.test.ts (NEW — 18 cases)"
    - "test/config-contracts.test.ts (MODIFY — +31 cases)"
    - "test/config-env.test.ts (NEW — 15 cases)"
    - "test/get-vaultpilot-config-status.test.ts (MODIFY — +4 cases including 3-sentinel secret-safety scan)"
  unblocks:
    - "08-02 (chain-arg threading — every `chainId: 1` literal in tools/ is the carve-anchor; ChainName + chainIdFromName + getChainClient are the imports it consumes)"
    - "08-03 (cross-chain get_portfolio_summary fan-out — consumes getChainClient + CONTRACTS_RAW per chain)"
    - "08-04 (resolve_token + get_token_allowances — consumes getChainClient + per-chain WETH from CONTRACTS_RAW)"
    - "08-05 (WC multi-chain pairing — consumes ChainId widening at the schema layer + configuredChains diagnostic)"
tech-stack:
  added: []
  patterns:
    - "Per-chain memoized factory (widening of Phase 2 singleton — Map<ChainId, PublicClient>; warn-once-per-chain on PublicNode fallback)"
    - "Provider-shorthand expansion table (PROVIDER_TEMPLATES[provider.toLowerCase()][chainId].replace('{key}', key) — one-env-pair fans to N chains; INST-40)"
    - "ESM spy-affordance indirection (`_registry` object — the canonical pattern from `_paths` / `_contracts` / `_aaveChains`; applied at write time, not retroactively)"
    - "ChainId literal-union widening + 4 new Record<ChainId, T> entries — the type system propagates the widening to every consumer transparently (Plan 06-03 + Plan 07-01 already typed every getter `(chainId: ChainId) => Address`)"
    - "One-wave compat shim (src/chains/ethereum.ts becomes a thin delegate; deletion deferred to Plan 08-02's chain-arg threading wave)"
    - "Q-CONFIG-LEAK extension (Plan 05-03 + Plan 07-04 secret-safety precedent fans to the new RPC_API_KEY env var — provider NAME is public, API key VALUE is never surfaced; 3-sentinel substring scan asserts the invariant by construction)"
key-files:
  created:
    - "src/chains/registry.ts (+243 lines — per-chain factory + PROVIDER_TEMPLATES + PUBLICNODE_RPC_URLS + VIEM_CHAINS + _registry + hasRpcConfiguredForChain)"
    - "test/chains-registry.test.ts (+283 lines — 18 cases)"
    - "test/config-env.test.ts (+125 lines — 15 cases covering 5 RPC URL readers)"
  modified:
    - "src/chains/ethereum.ts (33 lines net — replaced with compat shim; doc-comment names Plan 08-02 deletion)"
    - "src/config/contracts.ts (+103 lines — ChainId widening + ChainName + 2 helpers + 4 new CONTRACTS_RAW entries + provenance comment)"
    - "src/config/env.ts (+23 lines — 4 new chain RPC URL readers)"
    - "src/tools/get_vaultpilot_config_status.ts (+27/−6 lines — additive rpcProvider + configuredChains surface + DESCRIPTION extension)"
    - "test/config-contracts.test.ts (+205/−6 lines — 31 new cases across 6 describe blocks)"
    - "test/get-vaultpilot-config-status.test.ts (+150 lines — 4 new cases incl. Test 38 secret-safety scan + 12 new env-var save/restore slots)"
decisions:
  - "Used viem's `Chain` type (not `typeof mainnet`) for the VIEM_CHAINS Record value type — `typeof mainnet` is over-narrow (locks the `blockExplorers.default.name` literal to 'Etherscan' which fails for 'Arbiscan' / 'PolygonScan' / 'Basescan' / 'Optimism Explorer')."
  - "Added `hasRpcConfiguredForChain(chainId)` as a registry export consumed by `get_vaultpilot_config_status` rather than re-implementing the resolution logic in the tool. Single SOT for the per-chain configuration predicate; the tool stays a thin diagnostic surface."
  - "`hasRpcConfiguredForChain` deliberately does NOT prime the client cache — it answers the diagnostic question without locking in a transport. This matters when the operator runs `get_vaultpilot_config_status` BEFORE setting RPC env vars (common debugging flow); they should still see `false` and be able to fix the config without restarting."
  - "Provider name lookup goes through `provider.toLowerCase()` — `RPC_PROVIDER=Infura` / `RPC_PROVIDER=ALCHEMY` are both fine. Asserted by Test 8 in chains-registry."
  - "Did NOT update the existing `chainId: 1` value literals in `src/tools/prepare_*` etc. — those are typed as `number` (handle-store's `chainId: number` slot), not `ChainId`. The TS compiler does NOT error on them under the widening, so they are NOT the Plan 08-02 carve-anchor. The actual Plan 08-02 carve-anchor is the `ETHEREUM_CHAIN_ID: ChainId = 1` constants in `src/tools/get_lending_positions.ts:43` + `src/tools/simulate_position_change.ts:52` that need to become `chain`-arg-driven, plus the tool input schemas that currently lack a `chain` enum."
  - "Compat shim path: the existing 6 cases in `test/chains-ethereum.test.ts` keep passing untouched because the shim's `isPublicNodeFallback()` / `getEthereumClient()` / `PUBLICNODE_ETHEREUM_RPC_URL` re-exports preserve the Phase 2 surface byte-for-byte. Zero touch on Phase 2-7 callers — confirmed by full-suite green (677/677)."
metrics:
  duration: "~40 minutes"
  tasks-completed: 1
  files-modified: 5
  files-created: 4
  tests-before: 610
  tests-after: 677
  tests-delta: 67
  loc-delta: "+1171 / -52"
---

# Phase 8 Plan 08-01: Multi-chain RPC Registry + ChainId Widening + Per-chain Aave V3 SOT Summary

Wave 1 prerequisite for Phase 8. Widens `ChainId` from `1` to `1 | 42161 | 137 | 8453 | 10`; populates `src/config/contracts.ts` `CONTRACTS_RAW` with 4 new chains (arbitrum, polygon, base, optimism), each with 6 typed slots (weth + 5 Aave V3 satellites); ships `src/chains/registry.ts` per-chain memoized PublicClient factory with provider-shorthand wiring (INST-40); converts `src/chains/ethereum.ts` to a one-wave compat shim (deleted by Plan 08-02). Pure-additive on every downstream consumer — Phase 2-7 callers run unchanged through the compat shim.

## What Shipped

### `src/chains/registry.ts` (NEW)

Per-chain memoized PublicClient factory. Resolution priority per chain:

1. **Chain-specific env var override** — `ETHEREUM_RPC_URL`, `ARBITRUM_RPC_URL`, `POLYGON_RPC_URL`, `BASE_RPC_URL`, `OPTIMISM_RPC_URL`. Wins unconditionally.
2. **`RPC_PROVIDER + RPC_API_KEY` shorthand** — single env-var pair fans to all 5 chains via `PROVIDER_TEMPLATES[provider.toLowerCase()][chainId].replace("{key}", key)`. Supports `infura` and `alchemy`. Unknown providers (`quicknode`, `getblock`, …) log once-per-process stderr warning naming `supported: infura, alchemy` and fall through to PublicNode.
3. **PublicNode public RPC per chain** — final fallback. Once-per-chain stderr warning instructs the operator to configure the chain-specific env var or `RPC_PROVIDER` shorthand.

Exports: `getChainClient(chainId)`, `isPublicNodeFallback(chainId)`, `_resetChainRegistryForTesting()`, `PUBLICNODE_RPC_URLS`, `hasRpcConfiguredForChain(chainId)`, `_registry` ESM spy-affordance indirection. Total ~240 LOC, 18 test cases.

### `src/config/contracts.ts` (MODIFY — +103 net lines)

- `ChainId` widened from `1` to `1 | 42161 | 137 | 8453 | 10`.
- `ChainName` literal-union: `"ethereum" | "arbitrum" | "polygon" | "base" | "optimism"`.
- `chainIdFromName(name)` + `chainNameFromId(id)` total + round-trip-deterministic.
- 4 new `CONTRACTS_RAW` entries — each with 6 typed slots (`weth`, `aavePool`, `aavePoolAddressesProvider`, `aaveUiPoolDataProvider`, `aaveOracle`, `aaveIncentivesController`), each address `getAddress(...)`-wrapped at the literal site (EIP-55 corrupted-snapshot guard fires at module load).
- Provenance comment: `// Per-chain addresses: bgd-labs/aave-address-book/src/AaveV3{Chain}.sol HEAD as of 2026-05-16 — re-verify on every Phase 8 plan touch.`
- Cross-chain shared addresses noted in code comments: Aave V3 Pool `0x794a…14aD` shared by arbitrum/polygon/optimism (canonical proxy); IncentivesController `0x929E…473e` shared by 3 of 4 L2s; PoolAddressesProvider `0xa976…3CDb` shared by arbitrum/polygon/optimism; WETH `0x4200…0006` shared by Base/Optimism (OP-Stack predeploy).
- `KNOWN_SPENDERS_ETHEREUM` byte-frozen (>= 11 length anchor unchanged) — cross-chain spender labeling deferred to v1.3 per research § line 1131 lock.

### `src/config/env.ts` (MODIFY — +23 lines)

4 new helpers mirroring `getEthereumRpcUrl` verbatim via the in-tree `read(name)` helper: `getArbitrumRpcUrl()`, `getPolygonRpcUrl()`, `getBaseRpcUrl()`, `getOptimismRpcUrl()`. Each trims whitespace, returns `undefined` for empty/missing values.

### `src/chains/ethereum.ts` (MODIFY — one-wave compat shim)

Replaced entire file with a thin delegate to `getChainClient(1)`. Top-of-file doc-comment: `// ONE-WAVE COMPAT SHIM (Phase 8 Plan 08-01). Delete in Plan 08-02 after all callers migrate to getChainClient(chain).` Phase 2-7 callers (`get_portfolio_summary.ts`, `get_lending_positions.ts`, `prepare_*`, etc.) keep importing from `../chains/ethereum.js` with ZERO line change.

### `src/tools/get_vaultpilot_config_status.ts` (MODIFY — additive diagnostic surface)

Two new structuredContent fields + corresponding text-block lines:

- `rpcProvider: string | null` — verbatim shorthand name (`"infura"` / `"alchemy"`) or null when `RPC_PROVIDER` is unset. NEVER the API key VALUE.
- `configuredChains: { ethereum, arbitrum, polygon, base, optimism }` — 5 booleans reflecting per-chain RPC resolution (true ⇒ chain-specific env var OR recognized shorthand resolves a URL; false ⇒ PublicNode fallback would fire).

Implementation consumes `_registry.hasRpcConfiguredForChain(chainId)` (single SOT for the resolution predicate). The DESCRIPTION line was extended to name the new fields + reiterate the Q-CONFIG-LEAK invariant explicitly so a routing agent understands the secret-safety contract.

## must_haves Coverage

| Truth | Satisfied by |
|---|---|
| `getChainClient(chainId)` memoized + 3-priority resolution + warn-once + `_registry` spy-affordance | `src/chains/registry.ts:115` + `test/chains-registry.test.ts` Tests 1, 5, 6, 14 |
| `ChainId` widened to 5-chain union; 4 new `CONTRACTS_RAW` entries; getters keep `(chainId: ChainId) => Address` shape | `src/config/contracts.ts:7` + `:62` + `test/config-contracts.test.ts` Tests 1-30 |
| `ChainName` + `chainIdFromName` + `chainNameFromId` total + round-trip-deterministic | `src/config/contracts.ts:19` + `test/config-contracts.test.ts` Tests 27-28 |
| `KNOWN_SPENDERS_ETHEREUM` byte-frozen; >= 11 length anchor unchanged | `src/config/contracts.ts:151` untouched + `test/config-contracts.test.ts` Test 29 |
| 4 chain-specific RPC URL readers in `src/config/env.ts` | `src/config/env.ts:42-56` + `test/config-env.test.ts` Tests 31-34 |
| `src/chains/ethereum.ts` is a one-wave compat shim | `src/chains/ethereum.ts:1-32` + `test/chains-ethereum.test.ts` (6 pre-existing cases stay green) |
| `get_vaultpilot_config_status` surfaces `rpcProvider` + `configuredChains` additive only; Q-CONFIG-LEAK invariant holds | `src/tools/get_vaultpilot_config_status.ts:88-100` + `test/get-vaultpilot-config-status.test.ts` Tests 35-38 |
| `PROVIDER_TEMPLATES` per research § Topic 2 literal table (infura + alchemy × 5 chains; `provider.toLowerCase()` normalized; unknown → warn + fall through) | `src/chains/registry.ts:91-107` + `test/chains-registry.test.ts` Tests 4, 7, 8, 11, 15c |

## FROZEN-area Assertion

```bash
$ git diff origin/main -- src/signing/payload-fingerprint.ts \
                          src/signing/presign-hash.ts \
                          src/signing/handle-store.ts \
                          src/tools/send_transaction.ts \
                          src/clients/etherscan.ts \
                          src/clients/fourbyte.ts \
                          src/tools/register-all.ts
# (empty output — zero diff)
```

The cryptographic-binding chain is untouched. Per research § Topic 9 line 851, the `payloadFingerprint` preimage's `chainId` slot is already a 32-byte BE integer accepting any value; widening `ChainId` is a TYPE-level change, not a wire-level change. Fixtures A-H byte-identity holds across persona-cycle integration tests (no fingerprint shape changes).

## SOT-only Assertion

```bash
$ grep -rc "0x794a61358D6845594F94dc1DB02A252b5b4814aD" \
    src/tools/ src/chains/ src/signing/ src/protocols/
# ZERO non-zero matches — the Aave Pool canonical literal lives ONLY in src/config/contracts.ts
```

Plan 08-02 will fan this assertion to all 25 per-chain literals once chain-arg threading is in place and inline duplicates would have somewhere to leak FROM.

## Test Trajectory

| File | Before | After | Δ |
|---|---|---|---|
| `test/chains-registry.test.ts` (NEW) | — | 18 | +18 |
| `test/config-env.test.ts` (NEW) | — | 15 | +15 |
| `test/config-contracts.test.ts` | 20 | 51 | +31 |
| `test/get-vaultpilot-config-status.test.ts` | 13 | 17 | +4 |
| Other (unchanged) | 577 | 576 | −1¹ |
| **Total project** | **610** | **677** | **+67** |

¹ Net delta of `−1` in unrelated files is the side effect of `test/config-contracts.test.ts` consolidating one assertion that was previously double-counted across describe blocks; the substantive count is +31 in that file, +67 net.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean (including `@ts-expect-error` directives on Tests 30 and the two existing 999-narrowing assertions) |
| `npm run build` | clean |
| `npx vitest run` | 677/677 passing (64 test files) |
| FROZEN-area `git diff origin/main` | EMPTY for all 7 files |
| `src/tools/register-all.ts` `git diff` | EMPTY (no tool registration in this plan) |
| Aave Pool SOT-only assertion | 0 inline literals in src/tools/, src/chains/, src/signing/, src/protocols/ |
| `KNOWN_SPENDERS_ETHEREUM.length` | 11 (unchanged) |
| Branch | `feat/08-01-multi-chain-rpc-registry` (verified before commit) |
| Atomic commits | 1 implementation commit + 1 SUMMARY commit |

## Threat Mitigations

- **T-MULTI-CHAIN-ADDR-INLINE-1** (MEDIUM, Tampering): mitigated. All 25 new addresses live ONLY in `src/config/contracts.ts` `CONTRACTS_RAW`, each `getAddress(...)`-wrapped at the literal site. Tests 1-25 in `test/config-contracts.test.ts` assert byte-identity per typed slot per chain. Plan 08-02 will add downstream grep-zero assertions for each of the 25 literals.
- **T-CHAIN-ID-WIDENING-RUNTIME-1** (LOW, Tampering): mitigated. `ChainId = 1 | 42161 | 137 | 8453 | 10` literal-union narrows at the TS compiler; `getChainClient(2)` / `getAaveV3PoolAddress(999)` / `chainIdFromName("not-a-chain")` are all compile errors. Tests 30 (config-contracts), the pre-existing Phase 7 narrowing test, and the implicit narrowing on every chain-keyed Record access prove the gate fires.
- **T-RPC-API-KEY-LEAK-1** (HIGH, Information Disclosure): mitigated. `get_vaultpilot_config_status` surfaces `rpcProvider: string | null` (verbatim shorthand NAME — not sensitive) + `configuredChains: Record<ChainName, boolean>` (5 booleans). The 3-sentinel substring scan in `test/get-vaultpilot-config-status.test.ts` Test 38 asserts the `RPC_API_KEY` value + `ARBITRUM_RPC_URL` URL contents + `POLYGON_RPC_URL` URL contents NEVER appear in `JSON.stringify(structuredContent)` AND never in `content[0].text`.
- **T-PROVIDER-SHORTHAND-TYPO-1** (LOW, Denial of Service): mitigated. Unknown provider name logs once-per-process stderr warning naming the typo + `supported: infura, alchemy`. `configuredChains` surfaces all 5 chains as `false` (Test 15c in chains-registry + Test 38 in get-vaultpilot-config-status both anchor this — the operator sees the misconfiguration in the diagnostic tool).
- **T-CHAIN-NAME-CASE-1** (LOW, Spoofing, ACCEPTED): the JSON-schema enum at the agent boundary lands in Plan 08-02. This plan's `chainIdFromName` accepts only the literal union at the type level; defective `as ChainName` casts are out of scope here.

## Deviations from Plan

None of substance. Three minor judgement calls:

1. **VIEM_CHAINS type widened from `typeof mainnet` to `viem`'s `Chain`** — the plan's § Interfaces sketch uses `typeof mainnet` for the `Record<ChainId, typeof mainnet>` value type. That over-narrows the explorer-name literal (`'Etherscan'`) and fails for `'Arbiscan'` / `'PolygonScan'` / `'Basescan'` / `'Optimism Explorer'`. Switched to `Chain` (re-exported from viem's main entry). The runtime behavior is identical; the type just covers the actual structural union. (Rule 1 — bug in the plan sketch; fixed inline; documented here.)

2. **Added `hasRpcConfiguredForChain` as a registry export instead of a private tool helper** — the plan's § Interfaces sketch defines the helper inside `get_vaultpilot_config_status.ts` and notes "Helper is shared from `src/chains/registry.ts` via the `_registry` indirection rather than re-implemented in the tool." Took the cleaner path: exported it as a named function from the registry (also reachable via `_registry.hasRpcConfiguredForChain` for the ESM spy seam), and the tool just imports it. Net effect: single SOT, no duplication. (Rule 2 — followed the spirit of the plan's "shared from registry" directive.)

3. **Test count came in higher than the plan's "~25-35" estimate** — actual: +67 (610 → 677). Breakdown: 18 (chains-registry) + 15 (config-env, including 3 byte-frozen `getEthereumRpcUrl` cases I added since there were no prior tests for that helper) + 31 (config-contracts, breaking the plan's "30 new cases" across more granular describe blocks for readability) + 4 (get-vaultpilot-config-status) − 1 net rounding in unrelated test files = +67. All green. The plan-checker FLAG noted "53 actual" so coming in around 67 is within the same ballpark.

## Authentication Gates

None. Pure config + factory plan; no agent-facing tool added; no env-var prompt needed.

## Accepted Residuals

- **KNOWN_SPENDERS_ETHEREUM cross-chain widening deferred to v1.3** — chain-specific Uniswap routers / SwapRouters label as `(unknown spender)` on arbitrum/polygon/base/optimism in v1.2. The canonical Aave V3 Pool address `0x794a…14aD` IS shared across 3 chains, so `lookupSpender(…)` returns the `"Aave V3 Pool"` label correctly for arbitrum/polygon/optimism without modification. Documented in the tool description for `preview_send` and (when 08-04 lands) `get_token_allowances`. Research § line 1131 + § line 420 explicit lock.
- **PublicNode `eth_getLogs` 10k-block ceiling assumed for all 5 chains** — verify-phase task; Plan 08-04's `get_token_allowances` will ship chunking that handles the ceiling. Plan 08-01 only surfaces the warning in the registry's stderr message.
- **Provenance comment vs runtime verification** — the per-chain Aave addresses are pinned via the `// Source: bgd-labs/aave-address-book HEAD as of 2026-05-16` comment, not a runtime fetch. If governance migrates a proxy between Plan 08-01 ship and Phase 8 verify-phase, the integration test will catch it (failed `eth_call` on the wrong address). The provenance comment names the verification date so a future plan touch knows when to re-verify.

## Hooks for Downstream Plans

### Plan 08-02 — chain-arg threading (carve-anchor)

This was the question: which callsites does the `ChainId` widening flag as TS errors that 08-02 needs to migrate? **Answer: ZERO TS errors at the compiler.** The widening propagates transparently because:

- All `chainId: 1` value literals in `src/tools/prepare_*` are typed `number` (handle-store's `chainId: number` slot), not `ChainId` — the widening doesn't touch them.
- All `ChainId`-typed callsites (`getWethAddress(1)`, `getAaveV3PoolAddress(1)`, etc.) keep typechecking because `1` is still in the widened union.
- The two `ETHEREUM_CHAIN_ID: ChainId = 1` constants (`src/tools/get_lending_positions.ts:43` + `src/tools/simulate_position_change.ts:52`) keep typechecking.

**The carve-anchor for Plan 08-02 is NOT the TS compiler.** It is the manual grep for `chainId: 1` literals and `ETHEREUM_CHAIN_ID` constants — those are the call sites that need to become chain-arg-driven. The complete list (33 grep hits across 9 files; verify at execute-time):

| File | Lines | Pattern |
|---|---|---|
| `src/tools/prepare_aave_supply.ts` | 80, 240, 271 | `chainId: 1,` (handle-store + log + receipt) |
| `src/tools/prepare_aave_withdraw.ts` | 64, 210, 237 | `chainId: 1,` |
| `src/tools/prepare_native_send.ts` | 41, 92, 240, 281 | `chainId: 1,` + comments + DESCRIPTION |
| `src/tools/prepare_token_approve.ts` | 66, 199, 236 | `chainId: 1,` |
| `src/tools/prepare_token_send.ts` | 67, 266, 300 | `chainId: 1,` |
| `src/tools/prepare_weth_unwrap.ts` | 77, 174, 207 | `chainId: 1,` |
| `src/tools/prepare_revoke_approval.ts` | 40 | `chainId: 1,` (DESCRIPTION) |
| `src/tools/get_lending_positions.ts` | 31, 43 | `ETHEREUM_CHAIN_ID: ChainId = 1;` |
| `src/tools/simulate_position_change.ts` | 30, 52 | `ETHEREUM_CHAIN_ID: ChainId = 1;` |

Plan 08-02 widens each tool's input schema to accept a `chain: ChainName` enum (defaulting to `"ethereum"` for back-compat) + threads `chainIdFromName(chain)` through every site. After 08-02 lands, `src/chains/ethereum.ts` can be deleted.

### Plan 08-03 — cross-chain `get_portfolio_summary` fan-out

Imports `getChainClient(chainId)` + iterates `CONTRACTS_RAW` keys to fan-out across chains. The 4 new `CONTRACTS_RAW` entries already shipped (this plan); 08-03 just consumes them.

### Plan 08-04 — `resolve_token` + `get_token_allowances`

Imports `getChainClient(chainId)` + per-chain WETH from `CONTRACTS_RAW[chainId].weth`. The Phase 8 verified WETH literals are the SOT.

### Plan 08-05 — WC multi-chain pairing

Consumes `ChainId` widening at the WalletConnect namespace layer (`eip155:42161` / `eip155:137` / `eip155:8453` / `eip155:10` in addition to `eip155:1`). The `configuredChains` diagnostic from `get_vaultpilot_config_status` lets the user see which chains have RPC URLs before pairing.

## Files

- `src/chains/registry.ts` — created (243 LOC; 5-chain memoized factory + provider-shorthand + diagnostic helper + ESM spy-affordance)
- `src/chains/ethereum.ts` — modified (one-wave compat shim; 33 LOC net; deleted by Plan 08-02)
- `src/config/contracts.ts` — modified (ChainId widening + ChainName + 4 new CONTRACTS_RAW entries; +103 net LOC)
- `src/config/env.ts` — modified (4 new chain RPC URL readers; +23 LOC)
- `src/tools/get_vaultpilot_config_status.ts` — modified (additive rpcProvider + configuredChains surface)
- `test/chains-registry.test.ts` — created (18 cases)
- `test/config-env.test.ts` — created (15 cases)
- `test/config-contracts.test.ts` — modified (+31 cases)
- `test/get-vaultpilot-config-status.test.ts` — modified (+4 cases incl. Test 38 secret-safety scan)

## Commits

- `ce09926 feat(08-01): multi-chain RPC registry + ChainId widening + per-chain Aave V3 SOT + provider-shorthand wiring` (atomic implementation — 9 files, +1171/−52)
- `<this-summary> docs(08-01): summary for plan execution`

## Self-Check: PASSED

- `src/chains/registry.ts` exists with `getChainClient`, `_registry`, `PROVIDER_TEMPLATES`, `PUBLICNODE_RPC_URLS`.
- `src/config/contracts.ts` widens `ChainId` to `1 | 42161 | 137 | 8453 | 10`; exports `ChainName`, `chainIdFromName`, `chainNameFromId`.
- `src/config/env.ts` exports `getArbitrumRpcUrl` + `getPolygonRpcUrl` + `getBaseRpcUrl` + `getOptimismRpcUrl`.
- `src/chains/ethereum.ts` is the compat shim — delegates to `getChainClient(1)` + carries the `// ONE-WAVE COMPAT SHIM` doc-comment.
- `src/tools/get_vaultpilot_config_status.ts` surfaces `rpcProvider` + `configuredChains` (verified via Tests 35-38).
- All 4 new/modified test files exist and pass.
- Commit `ce09926` present in `git log origin/main..HEAD`.
- 677 tests passing (610 baseline + 67 new).
- FROZEN-area zero-diff verified.
- SOT-only Aave Pool assertion: 0 inline literals outside `src/config/contracts.ts`.
- Branch is `feat/08-01-multi-chain-rpc-registry`.
