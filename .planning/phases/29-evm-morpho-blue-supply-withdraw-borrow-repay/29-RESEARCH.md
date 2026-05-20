# Phase 29: Research — Morpho Blue multi-market supply / withdraw / borrow / repay

**Researched:** 2026-05-20
**Status:** Complete
**Confidence:** HIGH (architecture, ABI, addresses, CAL coverage, market enumeration); MEDIUM (SDK adoption — verified via empirical install + .d.ts read, not Context7)

## Summary

Phase 29 is the second v2.3 protocol after Phase 28's Compound V3 — a Morpho Blue isolated-market lending integration on Ethereum mainnet. The architectural shape mirrors Phase 28 closely (per-protocol decoder + per-chain SOT slots + 4-tool prepare surface + pure-bigint health math) but with two structural inversions from Compound:

1. **Permissionless market creation.** Where Compound V3 has a curated handful of Comets per chain (6 on mainnet), Morpho Blue has 50+ active markets on mainnet and the registry grows continuously. Markets are keyed by `marketId = keccak256(abi.encode(loanToken, collateralToken, oracle, irm, lltv))` — a 32-byte hash that the agent passes per-call. Phase 29 ships a **curated known-market registry** of the top 10-20 markets by TVL; the agent CAN still call against any market-id, but uncurated markets surface as `[UNKNOWN MARKET — verify oracle + IRM externally]` in DECODED ARGS.

2. **Ledger CAL clear-sign coverage IS present.** Verified [LedgerHQ/clear-signing-erc7730-registry/registry/morpho/calldata-MorphoBlue.json](https://github.com/LedgerHQ/clear-signing-erc7730-registry/blob/master/registry/morpho/calldata-MorphoBlue.json) at research time: all 6 Morpho Blue functions (`supply` / `withdraw` / `supplyCollateral` / `withdrawCollateral` / `borrow` / `repay`) are clear-signed on Ethereum (chainId=1) AND Base (chainId=8453). **NO `LEDGER_NOTICE_MORPHO_TEMPLATE` REQUIRED.** This is the opposite of Phase 28 (where Compound had no CAL coverage and required a blind-sign notice).

A third structural difference shapes the prepare-tool surface: Morpho's writes use a **shared `MarketParams` struct** + the **`(assets, shares)` exactly-one-zero pattern** for amount specification. `repay({ amount: "max" })` resolves server-side to `shares = position.borrowShares` (NOT `assets = MAX_UINT256` — that is a Compound idiom; Morpho uses the shares-equals-current-borrow-shares pattern documented in the natspec). Tightly distinct from Phase 28.

**Primary recommendation:** Use `viem.parseAbi` inline for the calldata-encoding path (mirrors Phase 28 verdict). The SDK `@morpho-org/blue-sdk@6.0.0` + `@morpho-org/blue-sdk-viem@5.0.0` ARE adopted-compatible (viem-native, no ethers v5, no postinstall, MIT, 3 Morpho-team maintainers, published 2026-05-20) — but they ship `Market` / `MarketParams` data classes + `fetchMarket(id, client)` reader-helpers, NOT tx encoders. The vp pipeline ALREADY uses `viem.parseAbi` for every protocol it integrates; pulling the SDK in for two data classes adds 25 transitive deps for marginal value. **Inline parseAbi wins on stack-uniformity grounds.** Ethereum-mainnet-first per CONTEXT.md scope; multi-chain (Base + Polygon + Arbitrum + Optimism — all deployed) deferred to v2.3.x per the Phase 7→8 / Phase 28→28.x cadence.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MOR-01 | `get_morpho_positions({ wallet, chain? })` returns Morpho Blue positions keyed by market-id (loanToken + collateralToken + oracle + IRM + LLTV) | § Topic 4 (market enumeration) + § Topic 5 (Position struct read) + § Topic 7 (collateralization math) |
| MOR-02 | `prepare_morpho_supply({ chain, marketId, amount })` produces an unsigned Morpho contract call | § Topic 5 (`supply` signature + `(assets, shares)` exactly-one-zero) + § Topic 8 (NO LEDGER NOTICE — clear-signed) |
| MOR-03 | `prepare_morpho_withdraw` + `prepare_morpho_borrow` cover the supply/borrow lifecycle | § Topic 5 (4 user-facing functions; supplyCollateral vs supply LOAN distinction) + § Topic 8 |
| MOR-04 | `prepare_morpho_repay({ chain, marketId, amount })` accepts `amount: "max"` as full-position close (resolved server-side) | § Topic 6 (repay-max = shares-equal-currentBorrowShares pattern; NOT MAX_UINT256 on assets) |
| MOR-05 | Morpho Blue contract addresses + known-market registry (top 20-30 markets by TVL at planning time) sourced from `src/config/contracts.ts` per-chain table; canonical-dispatch allowlist Morpho arm wiring | § Topic 3 (canonical addresses) + § Topic 4 (top-20 enumeration via Morpho Blue API) + § Topic 10 (SOT extension + allowlist) |

## § Topic 1: Morpho Blue architecture overview

**HIGH confidence.** Verified against [docs.morpho.org](https://docs.morpho.org/morpho-blue) + [morpho-org/morpho-blue/src/Morpho.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/Morpho.sol) (canonical SOT) + [LedgerHQ clear-sign CAL registry deployments](https://github.com/LedgerHQ/clear-signing-erc7730-registry/blob/master/registry/morpho/calldata-MorphoBlue.json) (deployments cross-check at chainId=1 and 8453).

### Architectural model

Morpho Blue is a **permissionless lending primitive**. Every "market" is a tuple:

```solidity
struct MarketParams {
  address loanToken;        // the asset borrowers borrow / lenders supply
  address collateralToken;  // the asset borrowers post as collateral
  address oracle;           // price feed for collateralToken / loanToken
  address irm;              // interest rate model (almost always AdaptiveCurveIRM)
  uint256 lltv;             // liquidation loan-to-value, 1e18-scaled (e.g. 0.86e18 = 86%)
}
```

The market is identified by `marketId = keccak256(abi.encode(marketParams))` — a `bytes32` value. ANYONE can create a new market by calling `createMarket(marketParams)` against the Morpho contract. The set is therefore unbounded; Phase 29 ships a **curated subset** of the top-by-TVL markets and surfaces uncurated ones as `[UNKNOWN MARKET]`.

This differs sharply from Phase 28's Compound V3 model. There, each Comet is a separate proxy contract at a distinct address, and Compound governance ships ~6 mainnet Comets total. Morpho Blue's "comet equivalent" is the market-id, NOT a contract address — every market shares the same `Morpho` singleton contract on each chain.

### Critical architectural consequences for Phase 29

- **No proxy-per-market.** The `Morpho` contract address is the SINGLE canonical-dispatch target per chain. The Compound-style "is this Comet in my allowlist?" check at canonical-dispatch becomes "is `tx.to` the Morpho contract?". The agent MUST pass `marketId` as a per-call parameter — there is no per-market address to dispatch against.
- **Per-call decode against decoder = Morpho calldata + MarketParams.** The `MarketParams` struct is encoded inside the calldata (5 × 32 bytes — `loanToken`, `collateralToken`, `oracle`, `irm`, `lltv`). The server can recompute `marketId` from the decoded `MarketParams` and cross-check against the known-market registry. Mismatch = `[UNKNOWN MARKET]` flag.
- **DECODED ARGS surfaces the market identity, not just `marketId`.** The agent's user wants to know "I'm borrowing USDC against wstETH at 86.0% LLTV" — not "I'm calling marketId=0xe7e9694b…". The decoder surfaces the labeled collateral/loan symbols + LLTV.

**Decision lock:** Adopt. Permissionless market model is the load-bearing differentiator from Compound; Phase 29 surfaces curated + uncurated paths distinctly.

## § Topic 2: Morpho Blue SDK adoption (DF-1)

**HIGH confidence.** Empirical install + `lib/esm/**/*.d.ts` read at `/tmp/morpho-sdk-probe` and `/tmp/morpho-viem-probe`.

### Packages probed

| Package | Version | Stack | Postinstall | License | Maintainers | Verdict |
|---------|---------|-------|-------------|---------|-------------|---------|
| `@morpho-org/blue-sdk` [ASSUMED] | 6.0.0 (published 2026-05-20) | viem-native (`viem ^2.0.0` peerDep) | none | MIT | 3 × `@morpho.xyz` / `@morpho.org` Morpho-team | **OK on provenance** — see Audit |
| `@morpho-org/blue-sdk-viem` [ASSUMED] | 5.0.0 | viem-native (`viem ^2.0.0` peerDep + `@morpho-org/blue-sdk ^6.0.0`) | none | MIT | same | **OK on provenance** |
| `@morpho-org/blue-sdk-ethers` [ASSUMED] | 3.0.0 | ethers-v5 (REJECT-on-stack-incompatible) | n/a | n/a | n/a | **DO NOT ADOPT** — stack mismatch (vp is viem 2.x) |

slopcheck unavailable at research time (install denied by auto-mode classifier). Per package-legitimacy protocol, all three tagged `[ASSUMED]` regardless of registry presence. The viem-native pair is provenance-clean independently: published by `julien-devatom@morpho.xyz`, `morpho-rubilmax@morpho.org`, `shufflewtf@morpho.xyz`; homepage `github.com/morpho-org/sdks`; same multisig org as the Morpho Blue contract deployments. NOT a slopsquat candidate. The verdict below is on TECHNICAL-FIT grounds.

### SDK shape

`@morpho-org/blue-sdk@6.0.0` ships:
- **Data classes:** `MarketParams`, `Market`, `Position`, `User`, `Token`, `Vault` — TypeScript classes with `id` getters, math helpers (`liquidationPrice`, `healthFactor`, `apy`), and immutable params.
- **Addresses registry:** `_addressesRegistry` keyed by chainId; mainnet Morpho = `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` matches what we get from the Morpho docs + CAL deployments.
- **Constants:** `ORACLE_PRICE_SCALE = 1e36`, `LIQUIDATION_CURSOR = 0.30e18`, `SECONDS_PER_YEAR`, `MAX_LIQUIDATION_INCENTIVE_FACTOR = 1.15e18` — useful for the collateralization math.
- **NO `encodeFunctionData` / tx-build helpers** — these would be the broadcast pipeline, not the unsigned-tx output vp needs.

`@morpho-org/blue-sdk-viem@5.0.0` ships:
- **Reader helpers:** `fetchMarket(id, client)`, `fetchPosition(user, id, client)`, `fetchVault(...)`, `fetchUser(...)` — return `Market` / `Position` / `Vault` instances. Use `viem.PublicClient` directly.
- **Multicall via deployless reads** (per `DeploylessFetchParameters` type).
- **`MetaMorphoAction` namespace** for the curated-vault aggregator (out of scope per CONTEXT.md "Deferred Ideas").
- **NO signing / broadcasting** — clean shape for vp.
- **`abis.d.ts`** exports `permit2Abi`, `wstEthAbi`, `erc2612Abi` — useful for forward-compat (Phase 30 Lido + future permit2 work) but not load-bearing for Phase 29.

### Verdict: do NOT adopt for Phase 29 calldata encoding; viem.parseAbi inline wins

Reasons:

1. **Stack uniformity.** Every other vp protocol (Phase 6 ERC-20, Phase 6 WETH9, Phase 7 Aave V3, Phase 28 Compound V3) uses `viem.parseAbi` inline in `src/protocols/<name>.ts`. The bounded-diff mechanical-clone pattern (CLAUDE.md Conventions; Phase 6/7/28 retros) breaks if Phase 29 introduces a different ABI access pattern.

2. **The SDK is reader-oriented, not encoder-oriented.** vp's pipeline is: `prepare_*` (encode unsigned tx) → preview → user signs on Ledger → `send_transaction` (broadcast). The SDK's reader helpers `fetchMarket` / `fetchPosition` are useful for `get_morpho_positions` — but they wrap `multicall` calls that vp's `_chains.morphoBlue` reader module would write directly anyway, with byte-identical RPC cost and one fewer transitive dep tree.

3. **Transitive dep weight.** `@morpho-org/blue-sdk` pulls 25 packages (lodash, mergewith, isplainobject — for deep-merge address registry); `@morpho-org/blue-sdk-viem` adds another package layer + `@morpho-org/morpho-ts` peerDep. The vp bundle is 70-some packages total; doubling that for one protocol is wrong-sized per the package-legitimacy + bundle-discipline rules.

4. **Data classes don't survive the trust boundary.** vp surfaces opaque-string handles and plain-JSON RECEIPT blocks. A `Market` class with getters doesn't serialize through MCP cleanly without `.toJSON()`-style conversion. The bigint-on-plain-object shape vp uses is simpler.

### What WE STILL borrow from the SDK research (without depending on it)

- **Canonical addresses table** — the SDK's `_addressesRegistry` is the most current source of Morpho deployment addresses across chains. Phase 29 SOT seeds the Ethereum row from research § Topic 3; the planner can cross-check against the SDK at plan-write time. Other chain rows are forward-compat slots.
- **Per-market `liquidationPrice` formula** — surfacing the liquidation price (collateral price at which position becomes liquidatable) helps the agent reason about safety margins. The SDK's `liquidationPrice` getter on `Position` documents the formula. § Topic 7 ports this to vp's pure-bigint shape.
- **`AdaptiveCurveIRM`** is the de-facto IRM for every blue-chip market — verified via Morpho Blue API top-20 query (all 20 markets use IRM `0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC`). vp can seed this slot directly.

**Decision lock:** Adopt `viem.parseAbi` inline; SKIP `@morpho-org/blue-sdk` + `@morpho-org/blue-sdk-viem`. ABI fragment lives in NEW file `src/protocols/morpho-blue.ts` mirroring `src/protocols/compound-v3.ts` 1:1 (encoder-per-supported-function + selector table + decode discriminated union + `_morphoProtocols` ESM spy indirection). Net package install for Phase 29: **ZERO**.

## § Topic 3: Canonical Morpho Blue contract addresses

**HIGH confidence.** Three independent sources agree at every chain:

| Chain | chainId | Morpho Blue Address | Source 1 (CAL) | Source 2 (SDK) | Source 3 (docs) |
|-------|---------|---------------------|----------------|----------------|-----------------|
| Ethereum | 1 | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | [calldata-MorphoBlue.json](https://github.com/LedgerHQ/clear-signing-erc7730-registry/blob/master/registry/morpho/calldata-MorphoBlue.json) | `@morpho-org/blue-sdk` 6.0.0 `_addressesRegistry[1].morpho` | [docs.morpho.org/llms-full.txt](https://docs.morpho.org/llms-full.txt) |
| Base | 8453 | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | [calldata-MorphoBlue.json](https://github.com/LedgerHQ/clear-signing-erc7730-registry/blob/master/registry/morpho/calldata-MorphoBlue.json) | `@morpho-org/blue-sdk` 6.0.0 `_addressesRegistry[8453].morpho` | docs.morpho.org |
| Arbitrum | 42161 | `0x6c247b1F6182318877311737BaC0844bAa518F5e` | n/a (no CAL deployment entry) | `@morpho-org/blue-sdk` 6.0.0 `_addressesRegistry[42161].morpho` | docs.morpho.org |
| Polygon | 137 | `0xC11a53eE9B1eCc7a068D8e40F8F17926584F97Cf` | n/a | SDK `_addressesRegistry[137].morpho` | docs.morpho.org |
| Optimism | 10 | `0x6128b680b277Bf4Df80DFE9D8c55A498660870ef` | n/a | SDK `_addressesRegistry[10].morpho` | docs.morpho.org |

### Architectural commentary

- **Ethereum + Base share an address** (`0xBBBBBb…ffCb`) — the same canonical "0xBBBB" vanity-prefix deployment via CREATE2 / consistent salt. Multi-chain code that special-cases mainnet-vs-Base on this contract gets an architectural ease-of-test bonus.
- **Arbitrum / Polygon / Optimism have distinct addresses** — these chains' Morpho deployments came later and used different deployer keys. The address-book SOT must enumerate them per-chain (no shortcut).
- **TVL distribution** (verified via [DefiLlama Morpho Blue protocol page](https://api.llama.fi/protocol/morpho-blue), 2026-05-20): Ethereum $3.85B, Base $2.83B, Arbitrum $55.6M, Polygon $8.0M, Optimism $9.4M. Phase 29 Ethereum-only ships against 47% of total Morpho TVL; v2.3.x Base widening adds another 35%.

### Supporting infrastructure (mainnet, seed for forward-compat)

| Slot | Address | Source | Phase 29 use |
|------|---------|--------|--------------|
| AdaptiveCurveIRM | `0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC` | SDK `_addressesRegistry[1].adaptiveCurveIrm` + Morpho Blue API top-20 markets verification | KNOWN_GOOD_IRMS allowlist; uncurated markets with a different IRM surface `[UNKNOWN IRM]` |
| MetaMorpho Factory | `0x1897A8997241C1cD4bD0698647e4EB7213535c24` | SDK `_addressesRegistry[1].metaMorphoFactory` | NOT used in Phase 29 (MetaMorpho deferred per CONTEXT.md) — seed slot for v2.x follow-up |
| Bundler3 | `0x6566194141eefa99Af43Bb5Aa71460Ca2Dc90245` | SDK `_addressesRegistry[1].bundler3.bundler3` | NOT used in Phase 29 (multi-action batching deferred) — seed slot for v2.x follow-up. **NOT** added to canonical-dispatch allowlist in Phase 29 (single-canonical-target invariant per § Topic 10) |
| GeneralAdapter1 | `0x4A6c312ec70E8747a587EE860a0353cd42Be0aE0` | SDK `_addressesRegistry[1].bundler3.generalAdapter1` | NOT used in Phase 29 (same reasoning) |
| MetaMorpho Vaults | curated (out of scope) | n/a | NOT in Phase 29 |

**Decision lock:** Adopt. Ethereum-only ship in Phase 29; single canonical Morpho Blue mainnet address (`0xBBBBBb…ffCb`) seeded in SOT. AdaptiveCurveIRM seeded as the v1.x known-good IRM allowlist. Forward-compat L2 slots optional in SOT (sub-record pattern from Phase 28's `COMPOUND_COMETS_RAW`).

## § Topic 4: Market enumeration — top markets on Ethereum mainnet

**HIGH confidence (top 20 enumeration); MEDIUM confidence (curation cut at 10-20 entries — TVL ordering changes daily).** Empirically queried [blue-api.morpho.org/graphql](https://blue-api.morpho.org/graphql) 2026-05-20.

### Top 20 mainnet markets by `state.supplyAssetsUsd`

| Rank | Collateral | Loan | LLTV | Supply (USD) | marketId |
|---|---|---|---|---|---|
| 1 | BONDUSD | USR | 94.5% | $2,476.7M | `0x1dca6989b0d2b0a546530b3a739e91402eee2e1536a2d3ded4f5ce589a9cd1c2` |
| 2 | PAXG | USDC | 91.5% | $780.8M | `0x8eaf7b29f02ba8d8c1d7aeb587403dcb16e2e943e4e2f5f94b0963c2386406c9` |
| 3 | sdeUSD | USDC | 91.5% | $433.1M | `0x0f9563442d64ab3bd3bcb27058db0b0d4046a4c46f0acd811dacae9551d2b129` |
| 4 | cbBTC | USDC | 86.0% | $277.6M | `0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64` |
| 5 | wstETH | USDT | 86.0% | $176.8M | `0xe7e9694b754c4d4f7e21faf7223f6fa71abaeb10296a4c43a54a7977149687d2` |
| 6 | WBTC | USDC | 86.0% | $160.7M | `0x3a85e619751152991742810df6ec69ce473daef99e28a64ab2340d7b7ccfee49` |
| 7 | sUSDe | USDtb | 91.5% | $105.2M | `0x88a18b2f4d94e7ad27a381b15531c06abf05a7c99dd5d3c3679875fed6f7e742` |
| 8 | wstETH | WETH | 96.5% | $104.2M | `0xb8fc70e82bc5bb53e773626fcc6a23f7eefa036918d7ef216ecfb1950a94a85e` |
| 9 | sUSDS | USDT | 96.5% | $96.2M | `0x3274643db77a064abd3bc851de77556a4ad2e2f502f4f0c80845fa8f909ecf0b` |
| 10 | IDLE | RLUSD | 0.0% | $79.7M | `0xe655ea720bacc0f9...` (idle market — supply-only) |
| 11 | syrupUSDC | PYUSD | 91.5% | $75.0M | `0xc9629945524f3fde...` |
| 12 | weETH | PYUSD | 86.0% | $72.6M | `0x85d59152eeeab7ca...` |
| 13 | sUSDe | PYUSD | 91.5% | $65.9M | `0x90ef0c5a0dc7c4de...` |
| 14 | wsrUSD | USDC | 94.5% | $59.5M | `0x1590cb22d797e226...` |
| 15 | WBTC | USDT | 86.0% | $59.3M | `0xa921ef34e2fc7a27...` |
| 16 | USDT | USDT | 98.0% | $55.7M | `0xb74aae3bada73b0b...` |
| 17 | IDLE | WBTC | 0.0% | $54.6M | `0xa36e440fbc54d7ed...` (idle market) |
| 18 | AA_FalconXUSDC | USDC | 77.0% | $54.6M | `0xe83d72fa5b00dcd4...` |
| 19 | syrupUSDC | RLUSD | 91.5% | $52.5M | `0xc0ae375fd761ff19...` |
| 20 | weETH | RLUSD | 86.0% | $50.0M | `0xea4bfb18df0ee6bf...` |

### Curation strategy — planner's call between 10 and 20 entries

The top-20 list is dominated by exotic / synthetic-asset markets (BONDUSD, USR, sdeUSD, USDtb, USDtb, AA_FalconXUSDC). These represent real TVL but have:

- **Less-mature oracles** that the agent's user may not recognize
- **High LLTV ratios** (91.5%, 94.5%, 96.5%) that mean liquidation can be a few % away
- **Yield-bearing collateral** with rebase / mark-to-market mechanics that complicate the "what is my position worth" calculation

A "blue-chip safe" curation (recommended for Phase 29 default) would surface ~10 markets covering:

- **Major-asset / stablecoin pairs:** wstETH→USDC, wstETH→USDT, WBTC→USDC, WBTC→USDT, cbBTC→USDC, ETH-correlated stables → stables
- **wstETH→WETH** (looped staking — the most well-known Morpho strategy)
- **2 yield-bearing stable pairs** for users wanting LST yield: sUSDe→PYUSD, sUSDS→USDT
- **Skip idle markets** (LLTV = 0 — supply-only, can't borrow against — not a meaningful prepare_morpho_borrow target)

**Curation responsibility:** Planner's call per CONTEXT.md `<decisions>` "researcher to enumerate at execute time" + Claude's-discretion bullet ("whether the known-market registry ships at 20, 25, or 30 entries (curation over padding per CLAUDE.md)"). Recommended cut: **15 entries** — covers the major-asset + LST + stable-yield surface without long-tail exposure.

### Why curation > "top 20 by TVL"

CLAUDE.md "Documentation Style — concise, non-redundant, sharp" applied to the registry: "curation over padding". If the agent surfaces a market name to the user that the user doesn't recognize, the user's path-to-cancel is "I don't know what BONDUSD is — abort". A 15-market registry of recognizable pairs lets users say "yes, I want to borrow USDC against my wstETH" without hesitation. Uncurated markets are still callable — they just surface the `[UNKNOWN MARKET]` warning.

### Long-tail discovery (out of scope for Phase 29)

For users on uncurated markets, the v2.x follow-up should query Morpho Blue API directly at runtime and surface the loanToken/collateralToken/oracle/IRM/LLTV breakdown in DECODED ARGS — but with a stronger `[UNCURATED — verify oracle independently]` warning. Not Phase 29 scope.

**Decision lock:** Adopt 15-entry curated registry. Planner picks the specific 15 markets from the table above (recommended: ranks 2, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 18, 19 — substitute / extend based on freshness check at plan-write time). Hardcoded registry; the API is a one-time research-time query, NOT a runtime dep.

## § Topic 5: Morpho Blue supply / withdraw / borrow / repay function signatures

**HIGH confidence.** Verified against [morpho-org/morpho-blue/src/Morpho.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/Morpho.sol) verbatim + [IMorpho.sol interface](https://github.com/morpho-org/morpho-blue/blob/main/src/interfaces/IMorpho.sol) for struct definitions.

### Canonical function signatures

```solidity
// LOAN-token actions — `(assets, shares)` exactly-one-zero pattern
function supply(
  MarketParams memory marketParams,
  uint256 assets,
  uint256 shares,
  address onBehalf,
  bytes calldata data
) external returns (uint256, uint256);

function withdraw(
  MarketParams memory marketParams,
  uint256 assets,
  uint256 shares,
  address onBehalf,
  address receiver
) external returns (uint256, uint256);

function borrow(
  MarketParams memory marketParams,
  uint256 assets,
  uint256 shares,
  address onBehalf,
  address receiver
) external returns (uint256, uint256);

function repay(
  MarketParams memory marketParams,
  uint256 assets,
  uint256 shares,
  address onBehalf,
  bytes calldata data
) external returns (uint256, uint256);

// COLLATERAL-token actions — single `assets` arg, no shares (collateral is non-rebasing)
function supplyCollateral(
  MarketParams memory marketParams,
  uint256 assets,
  address onBehalf,
  bytes calldata data
) external;

function withdrawCollateral(
  MarketParams memory marketParams,
  uint256 assets,
  address onBehalf,
  address receiver
) external;
```

The `MarketParams` struct (5 × 32-byte words, ABI-encoded in-place):

```solidity
struct MarketParams {
  address loanToken;        // word 0
  address collateralToken;  // word 1
  address oracle;           // word 2
  address irm;              // word 3
  uint256 lltv;             // word 4
}
```

### LOAN vs COLLATERAL: two distinct calldata surfaces (NOT Compound's single-selector pattern)

This is the **key structural difference from Phase 28**. Compound V3 has ONE `supply(asset, amount)` selector that the contract routes by inspecting `asset` against `baseToken()`. Morpho has **TWO DISTINCT selectors**:

- `supply` deposits LOAN token (lender deposits the asset borrowers want)
- `supplyCollateral` deposits COLLATERAL token (borrower posts collateral to borrow against)

**Implication for the agent intent surface:**

| Agent intent | Morpho selector | LOAN or COLLATERAL? |
|---|---|---|
| `prepare_morpho_supply` (lender deposits to earn) | `supply(MarketParams, assets, 0, onBehalf, 0x)` | LOAN |
| `prepare_morpho_withdraw` (lender withdraws supply) | `withdraw(MarketParams, assets, 0, onBehalf, receiver)` | LOAN |
| `prepare_morpho_borrow` (borrower takes loan) | `borrow(MarketParams, assets, 0, onBehalf, receiver)` | LOAN (borrower receives loan token) |
| `prepare_morpho_repay` (borrower repays loan) | `repay(MarketParams, assets, 0, onBehalf, 0x)` OR `repay(MarketParams, 0, shares, onBehalf, 0x)` | LOAN |

**Phase 29 does NOT include collateral-side tools** (`prepare_morpho_supply_collateral` / `prepare_morpho_withdraw_collateral`) — the prompt scope is supply/withdraw/borrow/repay where "supply" means "supply LOAN token" and "withdraw" means "withdraw LOAN token". This matches MOR-01..05 requirement language ("Morpho Blue isolated-market positions and supply / withdraw / borrow / repay" — lifecycle of the LOAN side).

**This is a design fork.** Borrowers MUST `supplyCollateral` BEFORE they can `borrow`. If Phase 29 ships LOAN-only tools, the agent has no way to walk a new user through "post wstETH as collateral, then borrow USDC against it" in a single flow. **Recommended discuss-phase question:** does Phase 29 include `supplyCollateral` + `withdrawCollateral`? The natural answer is YES — they're symmetrical to LOAN tools, share the same `MarketParams` decoder, and the LLTV gate at `borrow` already enforces "must have collateral first". 6 prepare tools total (4 LOAN + 2 COLLATERAL).

For the research, I document BOTH paths and flag the LOAN-only vs 6-tool decision to the planner.

### `(assets, shares)` exactly-one-zero pattern

The contract enforces `UtilsLib.exactlyOneZero(assets, shares)` — exactly one of the two must be zero. Calldata semantics:

| Combo | Meaning |
|---|---|
| `(assets > 0, shares = 0)` | Deposit / withdraw / borrow / repay an EXACT amount of the loan token. Contract converts to shares internally at current rate. |
| `(assets = 0, shares > 0)` | Deposit / withdraw / borrow / repay an EXACT amount of SHARES. Contract converts to assets at current rate. This is the path used for repay-max (see § Topic 6). |

The agent-facing surface uses `assets` for normal operations (decimal-resolved amounts the user understands). `shares` is the server-internal path for repay-max.

### `onBehalf` and `receiver` parameters

- **`onBehalf`** — the account whose position is affected (for supply/borrow/repay, the account whose balance changes). vp pins to `from` (the agent's pinned wallet); no third-party-deposit support in v1.x.
- **`receiver`** (withdraw and borrow only) — the account that receives the funds. vp pins to `from`; mirror of Phase 7 Aave V3's `to`-pinning. T-MORPHO-RECEIVER-1: regression test asserts `receiver === from`.
- **`data`** (supply and repay only) — callback bytes for atomic multi-action flows (e.g., flash-loan repay). vp passes `0x` empty — flash-loan flows are out of scope.

**Decision lock:** Adopt 4-tool LOAN-side surface (`prepare_morpho_supply`, `_withdraw`, `_borrow`, `_repay`); **DISCUSS-PHASE QUESTION** on whether to add `_supplyCollateral` + `_withdrawCollateral` (recommendation: YES — completes the lifecycle, zero structural cost). All calls pass `onBehalf = from`, `receiver = from` (where applicable), `data = 0x`.

## § Topic 6: `repay({ amount: "max" })` semantics

**HIGH confidence.** Verified via [Morpho.sol::repay()](https://github.com/morpho-org/morpho-blue/blob/main/src/Morpho.sol) natspec + [IMorpho.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/interfaces/IMorpho.sol).

### Canonical natspec from Morpho source

> "To repay max, pass the `shares`'s balance of `onBehalf`."

This is the **load-bearing difference from Compound V3 + Aave V3 patterns** (where MAX_UINT256 on the assets arg is the sentinel):

| Protocol | Repay-max sentinel |
|---|---|
| Compound V3 (Phase 28) | `supply(baseToken, MAX_UINT256)` — contract clamps to `borrowBalanceOf(from)` |
| Aave V3 (Phase 7, not currently exposed) | `repay(asset, MAX_UINT256, rateMode, onBehalf)` — contract clamps to debt |
| **Morpho Blue (Phase 29)** | `repay(marketParams, 0, currentBorrowShares, onBehalf, 0x)` — `assets = 0`, `shares = position.borrowShares` |

### Why Morpho uses shares-not-assets

Borrow balance accrues continuously per-block (per the IRM rate). Between the user's prepare-time read and the broadcast time, the actual debt has grown by some tiny amount. If we pass `assets = exactDebt + buffer`, the contract may either:

1. Leave dust (under-repay if the debt grew faster than the buffer)
2. Over-repay (deposit surplus as supply)

**Compound's approach** (Phase 28): pass `MAX_UINT256` on assets; the contract internally clamps to `min(MAX_UINT256, borrowBalanceOf(from))` = `borrowBalanceOf(from)`. Works because Compound recomputes debt at the moment of the call.

**Morpho's approach:** the SHARES are fixed (`position.borrowShares` is a unit-share count that doesn't change with rate accrual). Passing `shares = position.borrowShares` means "close out my entire borrow position; the contract converts shares to assets at the current rate at execution time". Zero dust, zero surplus, exact.

### Documented attack: front-running with a tiny repay

Morpho natspec warns: **"An attacker can front-run a repay with a small repay making the transaction revert for underflow."** This is a real edge case:

- User A intends to repay-max via `shares = position.borrowShares` at block N
- Attacker B front-runs with `repay(marketParams, 0, 1, A, 0x)` at block N — reducing A's borrowShares by 1
- A's tx executes: tries to repay `position.borrowShares + 0` (off-by-one of stale snapshot), but A only has `position.borrowShares - 1` shares now. Underflow revert.

**Mitigation for Phase 29:**

The server-side resolution must NOT use `position.borrowShares` directly from a prepare-time read snapshot — that's the snapshot the attacker can invalidate. Instead, two options:

1. **Subtract 1 share from the read snapshot** as a small dust-tolerance margin: `shares = readSnapshot - 1`. Leaves 1 share unrepaid (~0 USD of dust); avoids underflow.
2. **Use `assets = MAX_UINT256` on the assets path** — wait, does Morpho support this? Checking the source...

After re-reading Morpho.sol::repay: the contract does NOT have a documented `MAX_UINT256` sentinel for `assets`. The `exactlyOneZero(assets, shares)` validation accepts any non-zero values; what happens at `MAX_UINT256` is "tries to repay 1e77 assets, balance check on the loan token transfer fails first → revert".

**Decision lock:** Adopt approach #1 — `shares = (position.borrowShares - 1n)`. Phase 29's `prepare_morpho_repay({ amount: "max" })` resolves server-side as:

```typescript
// pseudo-code in prepare_morpho_repay.ts
if (rawAmount === "max") {
  const position = await _morphoChains.readPosition(client, morphoAddr, marketId, from);
  if (position.borrowShares === 0n) {
    return refusal({ kind: "INVALID_INPUT", message: "no outstanding borrow on this market" });
  }
  // T-MORPHO-REPAY-FRONTRUN-1 mitigation: subtract 1 share to tolerate a front-run dust repay
  const sharesToRepay = position.borrowShares - 1n;
  const calldata = encodeMorphoRepay(marketParams, 0n, sharesToRepay, from, "0x");
  // DECODED ARGS surfaces "⚠ FULL POSITION CLOSE (shares = borrowShares - 1 — minus 1 share dust margin)"
} else {
  const amountWei = parseAmountStrict(rawAmount, loanDecimals);
  const calldata = encodeMorphoRepay(marketParams, amountWei, 0n, from, "0x");
}
```

The DECODED ARGS block makes the user aware that the call is a shares-based close (not an assets-based one): `⚠ FULL POSITION CLOSE (shares-path; protects against front-run)`.

### Sentinel-format strict-equality discipline (T-MAX-SPELLING-1 mirror)

Phase 6's `prepare_token_approve({ amount: "max" })` + Phase 28's `prepare_compound_repay({ amount: "max" })` both lock STRICT EQUALITY on `"max"` (lowercase). `"MAX"` / `"unlimited"` / `"infinite"` / `"all"` all reject via `parseAmountStrict`'s regex. Phase 29's `prepare_morpho_repay` inherits this discipline; `prepare_morpho_withdraw` does NOT accept "max" (the symmetrical "withdraw all my supply" pattern is risky on a position with active borrowing — a withdraw-max could trigger liquidation as it removes collateral. Out of scope; user can pass an explicit amount).

**Decision lock:** Adopt. `prepare_morpho_repay({ amount: "max" })` → `shares = borrowShares - 1n` resolved server-side. STRICT equality on `"max"` literal; non-canonical spellings reject.

## § Topic 7: Position health math — LLTV vs Aave's HF vs Compound's booleans

**HIGH confidence.** Verified against [IMorpho.sol Position struct](https://github.com/morpho-org/morpho-blue/blob/main/src/interfaces/IMorpho.sol) + [Morpho Blue `MorphoLib.sol`](https://github.com/morpho-org/morpho-blue/blob/main/src/libraries/MorphoLib.sol) + SDK `Position.healthFactor` reference implementation.

### On-chain position read

```solidity
struct Position {
  uint256 supplyShares;     // lender position
  uint128 borrowShares;     // borrower position (used by repay-max)
  uint128 collateral;       // borrower collateral (UNITS = collateralToken's smallest denomination)
}
```

Accessed via `morpho.position(marketId, user)` (single read returns the struct).

### Liquidation math

Morpho Blue uses a single per-market `LLTV` parameter (liquidation loan-to-value, 1e18-scaled, e.g. `0.86e18` = 86%). A position is liquidatable when:

```
borrowedAssets × PRICE_SCALE > collateral × oraclePrice × LLTV
```

where `PRICE_SCALE = 1e36` (the canonical Morpho price scale; see `ORACLE_PRICE_SCALE` constant in the SDK).

### Phase 29 health surface — Aave HF-style normalized ratio

Mirror Phase 28's "expose both raw on-chain signal + agent-friendly normalized ratio" decision. The Compound case had separate `isBorrowCollateralized` + `isLiquidatable` booleans + a derived ratio; Morpho has ONLY the math (no boolean predicates on the contract), so vp computes:

```typescript
interface MorphoHealth {
  // Direct on-chain reads
  collateralAssets: bigint;     // position.collateral
  borrowAssets: bigint;         // derived from borrowShares × currentRate (Market.totalBorrowAssets / totalBorrowShares)
  oraclePrice: bigint;          // morpho.oracle.price() — 1e36-scaled

  // Derived signals
  ltvScaled: bigint;            // current LTV: borrowAssets / (collateral × oraclePrice / PRICE_SCALE), 1e18-scaled
  lltvScaled: bigint;           // market's lltv constant, 1e18-scaled
  healthFactor: bigint | null;  // lltv / ltv — 1e18-scaled. > 1.0 = safe; null when noDebt
  liquidationRisk: "safe" | "warning" | "danger" | "noDebt";

  // Aave-parity totals
  collateralValueUsd: string;   // collateral × oraclePrice → USD if loanToken is USD-stable; ratio otherwise
  borrowValueUsd: string;
}
```

**Reuse `classifyLiquidationRisk` from `aave-health.ts`** — same 4-arm classifier (>= 1.50 safe, 1.10-1.50 warning, < 1.10 danger, null = noDebt). Phase 7 → Phase 28 → Phase 29 cross-protocol classifier reuse; the import line is `import { classifyLiquidationRisk, type LiquidationRisk, HF_SCALE } from "./aave-health.js"`.

### Oracle price denomination

Morpho oracles return `price` such that `assets_loanToken = assets_collateralToken × price / PRICE_SCALE`. For a wstETH→USDC market: `oraclePrice ≈ 3500e36 / 1e6 = 3.5e42` (wstETH-USD price × 1e36, adjusted for the 12-decimal difference between wstETH (18d) and USDC (6d)).

This denomination is **trickier than Aave's UiPoolDataProvider's "marketReferenceCurrency" path or Compound's 1e8 Chainlink-shape**. The math must respect the price encoding:

```typescript
// pure-bigint, mirrors signing/compound-collateralization.ts shape
const ltvScaled = (borrowAssets * PRICE_SCALE * 1e18n) / (collateralAssets * oraclePrice);
// → ltvScaled is 1e18-scaled; compare against lltvScaled
const healthFactor = lltvScaled * HF_SCALE / ltvScaled;  // > 1e18 = safe
```

**T-MORPHO-PRICE-SCALE-1 anchor:** the `PRICE_SCALE = 1e36` constant lives in NEW `src/signing/morpho-health.ts`. Regression-tested against a hand-computed expected-value: wstETH collateral = 5e18 (5 wstETH), oraclePrice = 3500e42, lltv = 0.965e18 (96.5% — wstETH→WETH market #8 from § Topic 4), borrowAssets = 4e18 (4 WETH borrowed) → ltv ≈ 0.2286e18, healthFactor ≈ 4.22e18 (safe). Pinned literal in `test/signing-morpho-health.test.ts`.

**Decision lock:** Adopt the Aave HF-style normalized ratio (same `HF_SCALE = 1e18`, same `classifyLiquidationRisk` import). Pure-bigint math; price-scale-aware. T-MORPHO-PRICE-SCALE-1 regression anchor pinned in test fixture.

## § Topic 8: Ledger CAL clear-sign coverage — `LEDGER_NOTICE_MORPHO_TEMPLATE` NOT REQUIRED

**HIGH confidence.** Verified 2026-05-20 via direct fetch of [LedgerHQ/clear-signing-erc7730-registry/registry/morpho/calldata-MorphoBlue.json](https://github.com/LedgerHQ/clear-signing-erc7730-registry/blob/master/registry/morpho/calldata-MorphoBlue.json).

### Coverage confirmation

The Morpho Blue CAL descriptor enumerates all 6 user-facing functions:

```
borrow
repay
supply
supplyCollateral
withdraw
withdrawCollateral
```

with detailed display formats (label per `MarketParams` field, label per arg, address-name resolution for token-addresses) at:

```json
"context": {
  "contract": {
    "deployments": [
      { "chainId": 1, "address": "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" },
      { "chainId": 8453, "address": "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" }
    ]
  }
}
```

So: **Ethereum + Base** both clear-signed; **NO** entries for Arbitrum / Polygon / Optimism (no impact for Phase 29 — Ethereum-only).

### Implication: NO LEDGER_NOTICE_MORPHO_TEMPLATE

Contrast with Phase 28: Compound had NO CAL coverage → `LEDGER_NOTICE_COMPOUND_TEMPLATE` is REQUIRED in every Compound `preview_send` to warn the user that the device will blind-sign.

Morpho is fully clear-signed → the device shows the user:

- "Borrow from Morpho Market" / "Supply on Morpho Market" / "Repay on Morpho Market" / etc. (intent label)
- Loan token address (resolved via address-book to symbol)
- Collateral token address (resolved)
- Oracle address (resolved if known, raw if not — DOM-friendly per CAL format)
- IRM address (resolved if known, raw if not)
- LLTV (raw uint256 — user sees the raw 1e18-scaled number)
- Assets (raw uint256)
- Shares (raw uint256)
- On Behalf (resolved as wallet)
- Receiver (resolved as wallet)
- Data (raw bytes — `0x` for vp's calls)

The device-side display is significantly more verbose than Aave V3's (which collapses to a higher-level "supply" / "withdraw" label per CAL descriptor). This is BETTER for users on critical operations (full visibility) but means the on-device confirmation flow takes more screen pages.

### Phase 29 surface: clear-sign discipline reinforced

- `preview_send.ts` selector dispatch grows from THREE-tier (ERC-20 → Aave → Compound) to FOUR-tier (ERC-20 → Aave → Compound → Morpho). NO new `LEDGER_NOTICE_*_TEMPLATE` — the only difference from Aave's coverage handling is the absence of a notice, mirroring Phase 7's "no notice" path.
- The DECODED ARGS block for Morpho calldata renders the same fields the device shows (per-MarketParams labels + assets/shares + intent). This is the cross-check: agent says one thing → server decodes the same thing → device shows the same thing. All three layers visible to the user.
- **Address-book resolution** — the CAL descriptor flags `loanToken` and `collateralToken` with `params: { types: ["token"] }` (token symbols expected to resolve). vp's `loadTokenRegistry(1)` should cover top-20-market loan/collateral assets — wstETH, USDC, USDT, USDS, WETH, WBTC, cbBTC, PAXG already in Phase 8's registry. Long-tail assets (sUSDe, sUSDS, sdeUSD, BONDUSD, USR, USDtb, syrupUSDC, weETH, wsrUSD, RLUSD, PYUSD, AA_FalconXUSDC) need additions to the registry per chosen curation — but these are read-only labels, not signing-pipeline targets. Plan 29-04 task: extend `src/tokens/registry.ts` Ethereum row with the curated-market collateral/loan symbols.

**Decision lock:** Adopt. NO LEDGER NOTICE for Morpho calldata. `preview_send.ts` four-tier dispatch (additive arm for Morpho); ERC-20 / Aave / Compound paths byte-identical. Token-registry extension to cover labeled curated-market assets in Plan 29-04.

## § Topic 9: Multi-chain availability

**HIGH confidence.** Verified via SDK `_addressesRegistry` + [DefiLlama Morpho Blue protocol](https://api.llama.fi/protocol/morpho-blue) chain enumeration.

| Chain | chainId | Morpho Blue address | TVL (2026-05-20) | Phase 29 scope |
|---|---|---|---|---|
| Ethereum | 1 | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | $3.85B | **IN SCOPE** |
| Base | 8453 | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | $2.83B | Deferred to v2.3.x (same address — straightforward widening) |
| Arbitrum | 42161 | `0x6c247b1F6182318877311737BaC0844bAa518F5e` | $55.6M | Deferred to v2.3.x |
| Polygon | 137 | `0xC11a53eE9B1eCc7a068D8e40F8F17926584F97Cf` | $8.0M | Deferred to v2.3.x |
| Optimism | 10 | `0x6128b680b277Bf4Df80DFE9D8c55A498660870ef` | $9.4M | Deferred to v2.3.x |

### Decision: Ethereum-only ship

Per CONTEXT.md `<decisions>` scope + the Phase 7 → 8 / Phase 28 → 28.x precedent:

- Phase 29 ships against 47% of total Morpho TVL on Ethereum
- v2.3.x widening adds another 35% via Base (same canonical 0xBBBB… address — bonus alignment with Phase 28's deferred Compound multi-chain expansion)
- Polygon / Arbitrum / Optimism each carry $5-55M TVL — useful but not critical-path

**Forward-compat seed in SOT** — mirror Phase 28's `COMPOUND_COMETS_RAW` pattern. The `MORPHO_BLUE_RAW` sub-table can have all 5 chain rows present from Plan 29-01 with only the Ethereum row consumed by Phase 29 code (other chain rows are dead-code-until-v2.3.x but cost zero to seed). Each address `getAddress`-wrapped at the literal site for EIP-55 corruption guard.

**Decision lock:** Adopt. Phase 29 ships Ethereum-only. SOT seeds all 5 chain rows for forward-compat. Multi-chain tools widening in v2.3.x.

## § Topic 10: FROZEN-area discipline

**HIGH confidence.** Reviewed Phase 7 + Phase 9 + Phase 28 SECURITY-ADJACENT files.

### v1.x signing-pipeline FROZEN areas (NO touch in Phase 29)

| File | Why FROZEN |
|---|---|
| `src/signing/payload-fingerprint.ts` | PREP-03 cryptographic binding. Phase 29 calldata flows through the SAME `computePayloadFingerprint(tx)` — no new domain tag, no new preimage shape. |
| `src/signing/presign-hash.ts` | LEDGER BLIND-SIGN HASH recompute. EIP-1559 serialization unchanged. |
| `src/signing/handle-store.ts` | Handle lifecycle + 15-min TTL. Phase 29 calls `createHandle` exactly as Phase 7/28. |
| `src/signing/amount.ts::parseAmountStrict` | T-PARSE-AMOUNT-1 mitigation. Phase 29's `"max"` arm extends LOCALLY in `src/tools/prepare_morpho_repay.ts` (mirror Phase 28's `prepare_compound_repay.ts` shape) — does NOT touch the strict-format core. |
| `src/security/canonical-dispatch.ts` | Phase 29 EXTENDS the per-chain allowlist (adds 1 Morpho Blue address for Ethereum), but does NOT change the gate shape (`checkDispatchTarget` signature unchanged). Additive single-membership only. |
| All existing fixtures A–F + Phase 28's R/S/T/U in `test/signing-fingerprint.test.ts` and `test/signing-presign-hash.test.ts` | Cryptographic regression anchors. Phase 29 ADDS new fixtures (T + U for Morpho supply + Morpho repay-max per ROADMAP plan 29-03) — does NOT modify existing. |
| `src/protocols/compound-v3.ts` + `src/chains/compound-v3.ts` + `src/signing/compound-collateralization.ts` + `src/tools/prepare_compound_*.ts` + `src/tools/get_compound_market_info.ts` + `src/tools/preview_send.ts` Compound arm | **Phase 28 surface FROZEN as of v2.3 ship.** Phase 29 does NOT modify any Compound code path. The `get_lending_positions.ts` discriminated-union widens from 2 protocols (aave-v3, compound-v3) to 3 (aave-v3, compound-v3, morpho-blue) — Aave + Compound rows BYTE-IDENTICAL. |
| `src/tools/simulate_position_change.ts` | EXTEND-only: add `protocol: "morpho-blue"` arm (mirror Phase 28's discriminated-union widening at the same file). Aave + Compound arms byte-identical. |

### Solana fingerprint module + TRON fingerprint module — domain-tag separation

`"VaultPilot-soltx-v1:"` + `"VaultPilot-trontx-v1:"` domain tags separate cross-chain streams by construction. Phase 29 EVM-side preimages cannot collide.

### Phase 29 NEW surfaces (additive only)

- `src/config/contracts.ts` — extend with `MORPHO_BLUE_RAW: Partial<Record<ChainId, Address>>` sub-table (mirror Phase 28's `COMPOUND_COMETS_RAW` pattern). Helper: `getMorphoBlueAddress(chainId): Address | null`. **Forward-compat:** all 5 chain rows populated; only Ethereum consumed. Plus `MORPHO_KNOWN_MARKETS_ETHEREUM`: curated 15-entry registry keyed by `marketId` → `{ label, loanToken, collateralToken, oracle, irm, lltv }`. Plus `MORPHO_KNOWN_IRMS_ETHEREUM`: 1-entry allowlist `[AdaptiveCurveIRM]`. Plus `KNOWN_SPENDERS_ETHEREUM` extension — 1 row `Morpho Blue` (Phase 28 added 6 Comet rows; Phase 29 adds 1 Morpho row).
- `src/protocols/morpho-blue.ts` — NEW file; mirror of `src/protocols/compound-v3.ts` shape verbatim. ABI fragment over Morpho (6 functions; the agent-LOAN 4 + the agent-COLLATERAL 2 if discuss-phase confirms; otherwise 4 LOAN-only). Selectors derived via `viem.toFunctionSelector` (planner regression-tests at execute time — mirror Phase 28 A2). Decoder discriminated union: `{ kind: "morpho-supply" | "morpho-withdraw" | "morpho-borrow" | "morpho-repay" [+ "morpho-supplyCollateral" | "morpho-withdrawCollateral"]; marketParams; assets; shares; onBehalf; ... }` + `{ kind: "unknown"; selector }`. `_morphoProtocols = { decodeMorphoCall }` ESM spy indirection.
- `src/chains/morpho-blue.ts` — NEW file; mirror of `src/chains/compound-v3.ts` shape. Helper functions:
  - `readMarketParams(client, marketId)` — reads `morpho.idToMarketParams(marketId)` for canonical resolution + market existence check
  - `readPosition(client, morphoAddr, marketId, user)` — single read of `Position` struct
  - `readMarket(client, morphoAddr, marketId)` — reads `Market` struct (`totalSupplyAssets`, `totalSupplyShares`, `totalBorrowAssets`, `totalBorrowShares`, `lastUpdate`, `fee`)
  - `readOraclePrice(client, oracleAddr)` — calls `oracle.price()` returns 1e36-scaled price
  - `getMarketSnapshot(client, marketId, user)` — composite reader; returns `{ marketParams, position, market, oraclePrice }` via multicall
  - `getAllKnownMarketSnapshots(client, chainId, user)` — fan-out across curated registry; mirrors Phase 28's `getAllCometStates`
  - `_morphoChains = { readMarketParams, readPosition, readMarket, readOraclePrice, getMarketSnapshot, getAllKnownMarketSnapshots }` ESM spy indirection
- `src/signing/morpho-health.ts` — NEW file; mirror of `src/signing/compound-collateralization.ts` shape. Pure-bigint. Exports `computeMorphoHealth(input)` returning `{ healthFactor, ltvScaled, lltvScaled, liquidationRisk, ... }`. Reuses `classifyLiquidationRisk` + `HF_SCALE` + `LiquidationRisk` type from `aave-health.ts`. T-MORPHO-PRICE-SCALE-1 regression anchor.
- `src/tools/get_morpho_positions.ts` — NEW tool; mirror of `get_compound_market_info.ts` + `get_compound_positions` (subsumed into `get_lending_positions` in Phase 28; mirror that pattern). Single-tool surface returning per-market snapshots for the curated registry; optional `chain?` arg (Phase 29: ignores non-Ethereum; future-proof for v2.3.x).
- `src/tools/get_lending_positions.ts` — EXTEND: discriminated-union widening to 3 protocols. Aave + Compound rows BYTE-IDENTICAL; new `MorphoLendingPositionRow` shape added. `sources.morpho.perMarket: Array<{ marketId, label, healthFactor, liquidationRisk, noDebt }>` summary. T-LENDING-MULTIPROTOCOL-2: Morpho-only mainnet wallet returns positions; Aave + Compound sources zero-anchored. Verify Aave + Compound assertions remain byte-identical post-Phase-29.
- `src/tools/prepare_morpho_supply.ts` / `_withdraw.ts` / `_borrow.ts` / `_repay.ts` — 4 NEW tools; mirror Phase 28 `prepare_compound_*.ts` shapes verbatim. **NO intent-vs-reality gates** (Morpho's distinct LOAN-side selectors = no calldata ambiguity — agent's tool name maps 1:1 to the calldata selector). But: input validation gates (market-id allowlist for Ethereum; marketId-not-found refusal with `INVALID_INPUT` + structured hint). `prepare_morpho_repay` accepts `"max"` (resolved server-side per § Topic 6). Optional: `prepare_morpho_supply_collateral.ts` + `_withdraw_collateral.ts` per discuss-phase decision.
- `src/tools/simulate_position_change.ts` — EXTEND: add `protocol: "morpho-blue"` arm to the existing 2-protocol discriminated-union dispatcher. Same TRUST-BOUNDARY INVARIANT (simulation is a usability signal, never a signing precondition).
- `src/security/canonical-dispatch.ts` — EDIT to add 1 Morpho Blue address to Ethereum-chain Set (additive). Other chains: when v2.3.x lands, the dispatch table extends per-chain.
- `src/signing/blocks.ts` — EDIT to add `MORPHO_SUPPLY_PREPARE_RECEIPT_TEMPLATE` + `_WITHDRAW_*` + `_BORROW_*` + `_REPAY_*` + DECODED_ARGS templates for each calldata selector + (per § Topic 8) **NO LEDGER NOTICE template** for Morpho. The DECODED_ARGS_TEMPLATE_MORPHO_* templates surface `marketParams` resolution (curated → label; uncurated → `[UNKNOWN MARKET]`) + assets/shares + intent.
- `src/tokens/registry.ts` — EDIT to add curated-market collateral/loan tokens (sUSDe, sUSDS, weETH, cbBTC, PAXG if missing, syrupUSDC, RLUSD, PYUSD) for DECODED ARGS address-name resolution.
- `src/tools/preview_send.ts` — EDIT: four-tier dispatch (ERC-20 → Aave → Compound → Morpho). Additive `_morphoProtocols.decodeMorphoCall` branch. Token-context resolution uses `decoded.marketParams.loanToken` (mirror Compound's T-COMPOUND-TX-TO-CONFUSION-1 fix — `record.tx.to` is the Morpho contract, NOT the token). NO LEDGER NOTICE conditional emission for Morpho (clear-signed; full bypass).

### Confirmation: NO compromise to FROZEN areas

All Phase 29 changes are ADDITIVE (new files) or ADDITIVE-MEMBER (extend interface, extend Set, extend tool dispatcher). The byte-identity of every existing fixture A–F + R/S/T/U MUST hold post-Phase-29 — the planner's success criteria includes `npm test test/signing-fingerprint.test.ts test/signing-presign-hash.test.ts` green AND a `git diff` byte-identity assertion on the Aave-related + Compound-related fixture lines.

**Decision lock:** Adopt. Phase 29 = additive. v1.x + v2.3 (Phase 28) signing-pipeline byte-identity preserved by construction.

## Package Legitimacy Audit

> slopcheck was not available at research time (auto-mode classifier denied the install attempt as out-of-scope agent-chosen package install). Per the graceful-degradation rule in the package-legitimacy protocol, ALL packages below are tagged `[ASSUMED]`. The planner MUST gate any `@morpho-org/*` reference (which Phase 29 will NOT install — see § Topic 2 verdict) behind a `checkpoint:human-verify` task before install IF that recommendation ever changes.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `viem` | npm | 3 yrs | ~5M/wk (current — already a project dep) | [github.com/wevm/viem](https://github.com/wevm/viem) | `[ASSUMED]` | Approved — existing project dep, no install needed |
| `@morpho-org/blue-sdk` | npm | created 2024-06-12, last published 2026-05-20 (fresh — published TODAY at research time) | LOW-MEDIUM (not a hot package) | [github.com/morpho-org/sdks](https://github.com/morpho-org/sdks) | `[ASSUMED]` | **DO NOT ADOPT** (§ Topic 2 — stack uniformity reasoning; not a legitimacy issue) |
| `@morpho-org/blue-sdk-viem` | npm | sibling to above, published same window | LOW-MEDIUM | same | `[ASSUMED]` | **DO NOT ADOPT** (§ Topic 2 — same reasoning) |
| `@morpho-org/blue-sdk-ethers` | npm | sibling | LOW | same | `[ASSUMED]` | **DO NOT ADOPT** (ethers-v5-locked; stack incompatible) |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck unavailable)
**Packages flagged as suspicious [SUS]:** none — `@morpho-org/blue-sdk` published by 3 verified Morpho-team addresses (`julien-devatom@morpho.xyz`, `morpho-rubilmax@morpho.org`, `shufflewtf@morpho.xyz`), no postinstall script, MIT license, homepage at the official Morpho org. Provenance solid. The "do not adopt" verdict is on TECHNICAL-FIT grounds (stack uniformity + reader-not-encoder shape + transitive dep weight), not legitimacy.

**Net package install for Phase 29: ZERO.** All Morpho Blue integration runs through `viem.parseAbi` against the existing `viem` 2.50.4 dependency.

## Architecture Patterns

### System Architecture Diagram

```
agent (Claude Code / Cursor / Desktop)
   │  prepare_morpho_supply({ chain, marketId, amount, from? })
   ▼
MCP tool dispatcher (src/tools/prepare_morpho_supply.ts)
   │  ├─ chainId from chain enum
   │  ├─ marketId allowlist check (curated registry + uncurated path with [UNKNOWN] flag)
   │  ├─ resolveFrom({ rawFrom, chainId })
   │  ├─ resolveDecimals(loanToken) — for assets-path amount parsing
   │  ├─ parseAmountStrict(amount, decimals) → amountWei  (OR shares-path for repay-max)
   │  ├─ encodeMorphoSupply(marketParams, amountWei, 0n, from, "0x") → data
   │  ├─ tx = { chainId, to: getMorphoBlueAddress(chainId), valueWei: 0n, data }
   │  ├─ payloadFingerprint = computePayloadFingerprint(tx)  [PREP-03 FROZEN]
   │  └─ createHandle({ args, tx, payloadFingerprint })       [TTL 15min]
   ▼
agent
   │  preview_send({ handle })
   ▼
preview_send (FOUR-tier dispatch — ERC-20 → Aave → Compound → MORPHO)
   │  ├─ Layer 0.5: checkDispatchTarget(chainId, tx.to) — Morpho address must be in allowlist
   │  ├─ decode via _morphoProtocols.decodeMorphoCall(data)
   │  ├─ DECODED ARGS block: marketParams (resolved labels) + assets + shares + intent
   │  ├─ NO LEDGER NOTICE (clear-signed via CAL — § Topic 8)
   │  ├─ LEDGER BLIND-SIGN HASH block (existing recompute — for user verification)
   │  └─ previewToken mint
   ▼
... user confirms on device — DEVICE SHOWS clear-signed labeled fields ...
   ▼
send_transaction (existing — unchanged)
```

### Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Market enumeration (curated registry) | `src/config/contracts.ts` SOT | — | Single source of truth per CLAUDE.md; format-fanout-sentinel discipline. Registry is static at compile time |
| Per-market reads (Position, Market, oracle) | `src/chains/morpho-blue.ts` | viem `multicall` against Morpho contract | Reader sibling-shelf pattern (mirror Phase 28's `src/chains/compound-v3.ts`) |
| Calldata encode/decode | `src/protocols/morpho-blue.ts` | viem `parseAbi` + `encodeFunctionData` | Protocol sibling-shelf pattern (mirror Phase 28's `src/protocols/compound-v3.ts`) |
| Position health math | `src/signing/morpho-health.ts` | — | Pure-bigint trust-shelf math (mirror Phase 28's `src/signing/compound-collateralization.ts`; reuses `classifyLiquidationRisk` from Phase 7 `aave-health.ts`) |
| MCP tool surface (4-6 prepare tools + 1 read tool) | `src/tools/prepare_morpho_*.ts` + `src/tools/get_morpho_positions.ts` | tool dispatcher (existing FROZEN) | Tool-handler shelf; mechanical-clone of Phase 28 shape |
| Canonical-dispatch allowlist | `src/security/canonical-dispatch.ts` | SOT helper | Additive Ethereum-arm entry; gate shape FROZEN |
| Decoded-args rendering | `src/signing/blocks.ts` | preview_send four-tier dispatch | Template SOT (mirror Phase 28's DECODED_ARGS_TEMPLATE_COMPOUND_*) |
| Address-name resolution | `src/tokens/registry.ts` extension | preview_send | Token symbols for curated-market collateral/loan tokens |

### Recommended Project Structure

```
src/
├── config/
│   └── contracts.ts            — EDIT: add MORPHO_BLUE_RAW sub-table + getter + 15-entry MORPHO_KNOWN_MARKETS_ETHEREUM + KNOWN_GOOD_IRMS_ETHEREUM + KNOWN_SPENDERS row
├── protocols/
│   ├── aave-v3.ts              — UNCHANGED (FROZEN)
│   ├── compound-v3.ts          — UNCHANGED (FROZEN — Phase 28)
│   └── morpho-blue.ts          — NEW (ABI + selectors + encoders + decoder + _morphoProtocols ESM spy)
├── chains/
│   ├── aave-v3.ts              — UNCHANGED (FROZEN)
│   ├── compound-v3.ts          — UNCHANGED (FROZEN — Phase 28)
│   └── morpho-blue.ts          — NEW (per-marketId readers + getMarketSnapshot + fan-out + _morphoChains ESM spy)
├── signing/
│   ├── aave-health.ts          — UNCHANGED (FROZEN; Phase 29 imports classifyLiquidationRisk + LiquidationRisk + HF_SCALE)
│   ├── compound-collateralization.ts — UNCHANGED (FROZEN)
│   ├── morpho-health.ts        — NEW (pure-bigint LTV/HF math; reuses classifier from aave-health)
│   └── blocks.ts               — EDIT: 4 PREPARE RECEIPT templates + 4 DECODED ARGS templates (no LEDGER NOTICE)
├── tools/
│   ├── get_morpho_positions.ts          — NEW (single-tool read; fan-out across curated registry)
│   ├── get_lending_positions.ts         — EDIT: discriminated-union widening (2 protocols → 3)
│   ├── prepare_morpho_supply.ts         — NEW
│   ├── prepare_morpho_withdraw.ts       — NEW
│   ├── prepare_morpho_borrow.ts         — NEW
│   ├── prepare_morpho_repay.ts          — NEW (with `amount: "max"` → shares = borrowShares - 1)
│   ├── [optional: prepare_morpho_supply_collateral.ts / _withdraw_collateral.ts — pending discuss-phase decision]
│   ├── simulate_position_change.ts      — EDIT: add `protocol: "morpho-blue"` arm
│   ├── preview_send.ts                  — EDIT: four-tier dispatch (ERC-20 → Aave → Compound → Morpho)
│   └── register-all.ts                  — EDIT: +5 (or +7) import lines
├── tokens/
│   └── registry.ts             — EDIT: extend Ethereum row with curated-market loan/collateral tokens
└── security/
    └── canonical-dispatch.ts   — EDIT: add 1 Morpho Blue address to Ethereum-chain Set
```

### Pattern 1: Calldata encoder for `MarketParams`-shaped tuple

```typescript
// src/protocols/morpho-blue.ts — mirror of src/protocols/compound-v3.ts shape
// Source: https://github.com/morpho-org/morpho-blue/blob/main/src/Morpho.sol verbatim
import { encodeFunctionData, decodeFunctionData, parseAbi, type Address, type Hex } from "viem";

export interface MorphoMarketParams {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

export const MORPHO_BLUE_ABI = parseAbi([
  "function supply((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data)",
  "function withdraw((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)",
  "function borrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)",
  "function repay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data)",
  // Reads (consumed by src/chains/morpho-blue.ts)
  "function idToMarketParams(bytes32 id) view returns ((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv))",
  "function position(bytes32 id, address user) view returns ((uint256 supplyShares, uint128 borrowShares, uint128 collateral))",
  "function market(bytes32 id) view returns ((uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee))",
]);

export const MORPHO_BLUE_SELECTORS = {
  supply: "0x..." as Hex,    // VERIFY at execute time via viem.toFunctionSelector
  withdraw: "0x..." as Hex,
  borrow: "0x..." as Hex,
  repay: "0x..." as Hex,
} as const;

export function encodeMorphoSupply(
  params: MorphoMarketParams,
  assets: bigint,
  shares: bigint,
  onBehalf: Address,
  data: Hex = "0x",
): Hex {
  return encodeFunctionData({
    abi: MORPHO_BLUE_ABI,
    functionName: "supply",
    args: [params, assets, shares, onBehalf, data],
  });
}

// + encodeMorphoWithdraw, encodeMorphoBorrow, encodeMorphoRepay — same shape

export type MorphoDecoded =
  | { kind: "morpho-supply"; marketParams: MorphoMarketParams; assets: bigint; shares: bigint; onBehalf: Address; data: Hex }
  | { kind: "morpho-withdraw"; marketParams: MorphoMarketParams; assets: bigint; shares: bigint; onBehalf: Address; receiver: Address }
  | { kind: "morpho-borrow"; marketParams: MorphoMarketParams; assets: bigint; shares: bigint; onBehalf: Address; receiver: Address }
  | { kind: "morpho-repay"; marketParams: MorphoMarketParams; assets: bigint; shares: bigint; onBehalf: Address; data: Hex; isMaxShares: boolean }
  | { kind: "unknown"; selector: Hex };

export function decodeMorphoCall(data: Hex): MorphoDecoded { /* selector dispatch + decodeFunctionData per kind */ }

export const _morphoProtocols = { decodeMorphoCall };
```

### Pattern 2: Position health math (pure-bigint, 1e36 oracle scale)

```typescript
// src/signing/morpho-health.ts
// Mirror src/signing/compound-collateralization.ts shape; oracle scale is 1e36 (NOT 1e8)
import { classifyLiquidationRisk, type LiquidationRisk, HF_SCALE } from "./aave-health.js";

export const ORACLE_PRICE_SCALE: bigint = 10n ** 36n;
export const LLTV_SCALE: bigint = 10n ** 18n;
export const LTV_SCALE: bigint = 10n ** 18n;

export interface MorphoHealthInput {
  collateralAssets: bigint;     // position.collateral
  borrowAssets: bigint;         // borrowShares × Market.totalBorrowAssets / Market.totalBorrowShares — converted upstream
  oraclePrice: bigint;          // oracle.price() — 1e36-scaled
  lltvScaled: bigint;           // MarketParams.lltv — 1e18-scaled
  loanDecimals: number;
  collateralDecimals: number;
}

export interface MorphoHealthOutput {
  ltvScaled: bigint;            // current LTV, 1e18-scaled
  lltvScaled: bigint;           // verbatim from input
  healthFactor: bigint | null;  // lltv / ltv, 1e18-scaled. > 1.0 = safe; null when noDebt
  liquidationRisk: LiquidationRisk;
  noDebt: boolean;
  collateralValueScaled: bigint; // collateral × oraclePrice (denominated in loanToken units, in 1e36-scaled form)
  borrowValueScaled: bigint;
}

export function computeMorphoHealth(input: MorphoHealthInput): MorphoHealthOutput {
  if (input.borrowAssets === 0n) {
    return {
      ltvScaled: 0n,
      lltvScaled: input.lltvScaled,
      healthFactor: null,
      liquidationRisk: classifyLiquidationRisk(null, true),
      noDebt: true,
      collateralValueScaled: 0n,
      borrowValueScaled: 0n,
    };
  }
  // collateralAssets × oraclePrice = collateralValueScaled (in 1e36-scaled loan-token units)
  const collateralValueScaled = input.collateralAssets * input.oraclePrice;
  // borrowAssets × ORACLE_PRICE_SCALE for unit-parity
  const borrowValueScaled = input.borrowAssets * ORACLE_PRICE_SCALE;
  // ltv = borrowValue / collateralValue, 1e18-scaled
  const ltvScaled = (borrowValueScaled * LTV_SCALE) / collateralValueScaled;
  // healthFactor = lltv / ltv, 1e18-scaled
  const healthFactor = (input.lltvScaled * HF_SCALE) / ltvScaled;
  return {
    ltvScaled,
    lltvScaled: input.lltvScaled,
    healthFactor,
    liquidationRisk: classifyLiquidationRisk(healthFactor, false),
    noDebt: false,
    collateralValueScaled,
    borrowValueScaled,
  };
}
```

### Anti-Patterns to Avoid

- **Hardcoding the Morpho Blue address** in tool implementations → use `getMorphoBlueAddress(chainId)` via SOT. Format-fanout-sentinel anchor: grep for `0xBBBBBb` should return EXACTLY 1 (the SOT line) — mirror Phase 28's Comet-address grep-zero discipline.
- **Hardcoding curated market-ids** in tool code → use the registry table in `src/config/contracts.ts` with a typed lookup helper. Phase 29 success criteria: grep `0x1dca6989\|0x8eaf7b29\|0x0f956344\|...` outside `src/config/contracts.ts` returns empty.
- **Computing health factor as float** → the Aave + Compound + Morpho health math is unified pure-bigint per Phase 7 retro. No `Number` casts on health-factor-path code.
- **Using `MAX_UINT256` on Morpho repay assets path** → does not work (Morpho uses shares-path for repay-max per § Topic 6). The strict typing of `prepare_morpho_repay`'s `amount` field rejects this; `"max"` resolves to shares-path server-side.
- **Skipping the `[UNKNOWN MARKET]` warning** on uncurated markets → uncurated markets MAY have malicious oracles. DECODED ARGS must surface the warning prominently when the marketId hash isn't in the registry. (See § Topic 4 curation rationale.)
- **Trusting an oracle without recomputing the marketId from the marketParams server-side.** Layer of defense-in-depth: server reads `morpho.idToMarketParams(marketId)`, then re-derives `marketId = keccak256(abi.encode(returned_params))`, and confirms it matches the agent's input. Catches "agent passed an invalid marketId or got socially engineered into a malicious lookup".

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ABI encoding for `MarketParams` tuple | Custom tuple encoder | `viem.parseAbi` + `encodeFunctionData` with embedded struct syntax | viem handles tuple ABI-encoding (5 × 32 bytes layout) automatically |
| Decimal-aware amount parsing | New regex per protocol | `parseAmountStrict` from `src/signing/amount.ts` (Phase 6) + LOCAL "max" arm per tool | T-PARSE-AMOUNT-1 mitigation already shipped; T-MAX-SPELLING-1 strict-equality |
| `keccak256(abi.encode(...))` marketId derivation | Hand-rolled hash | `viem.keccak256(viem.encodeAbiParameters(...))` for cross-check; `morpho.idToMarketParams(marketId)` as primary source | Use Morpho's own on-chain lookup as truth; cross-check the SDK math only at test time |
| Multicall batching | Manual sequential `eth_call` loops | `client.multicall({ allowFailure: true })` | Single RPC round-trip; `allowFailure: true` returns per-call status |
| Health-factor classification | New 4-arm classifier for Morpho | Reuse `classifyLiquidationRisk` from `aave-health.ts` | Same thresholds; same agent-facing arms; cross-protocol consistency |
| Position struct decoder | Custom packed-uint128 reader | viem's `multicall` returns structs as JS objects keyed by field name | Native ABI decode; bigint-native; no field-order mistakes |
| Per-chain Morpho Blue address table | Inline literals in tool code | Extend `src/config/contracts.ts` with `MORPHO_BLUE_RAW` sub-table | Format-fanout-sentinel + EIP-55 corruption guard; mirror `COMPOUND_COMETS_RAW` |
| Curated market-id allowlist | New gate module per protocol | Extend `src/config/contracts.ts` with `MORPHO_KNOWN_MARKETS_ETHEREUM` typed registry; helper `isKnownMorphoMarket(marketId)` returns labeled info or null | SOT discipline; uncurated path is still callable (warns user) |
| Canonical-dispatch allowlist extension | New gate module per protocol | Extend `CANONICAL_DISPATCH_TARGETS` Set per chain (additive) | Layer 0.5 already implemented; just add the Morpho address to Ethereum |

## Common Pitfalls

### Pitfall 1: Confusing `assets`-path vs `shares`-path for repay

**What goes wrong:** Agent calls `prepare_morpho_repay({ amount: "max" })`; server computes `position.borrowShares` at prepare time; between prepare and broadcast, the rate accrues and `position.borrowShares` is UNCHANGED but the borrow ASSETS value has grown. If server resolves to `assets = currentBorrowAssets`, the assets-path tx will leave dust (under-repay). If server resolves to `shares = position.borrowShares`, the shares-path tx exactly closes (but is vulnerable to the front-run attack per § Topic 6).

**Why it happens:** Morpho's exact-share-conversion-at-execution semantics differ from Compound's exact-asset-at-execution semantics.

**How to avoid:** Use shares-path for repay-max (per Morpho natspec); subtract 1 share to tolerate the front-run attack. The DECODED ARGS block makes the user aware: `⚠ FULL POSITION CLOSE (shares-path; minus 1 share dust margin)`.

**Warning signs:** Agent passes `amount: "max"` to `prepare_morpho_repay`; the test fixture should ANCHOR that calldata uses `shares = position.borrowShares - 1` and `assets = 0`. If `assets` is non-zero or `shares` matches the snapshot exactly without the `-1`, that's a regression.

### Pitfall 2: Trusting the agent's `marketId` without server-side market-params resolution

**What goes wrong:** Agent passes `marketId = 0xDEADBEEF…` (synthesized or socially-engineered). The server attempts to encode `morphoSupply` calldata using the agent's claimed marketParams (`{ loanToken: USDC, collateralToken: wstETH, oracle: maliciousOracle, ... }`). The Morpho contract doesn't validate the marketId on-chain (it derives the id from the params + processes the call against the corresponding market); if a market with `oracle: maliciousOracle` exists, the call succeeds against the wrong oracle.

**Why it happens:** Morpho's permissionless market model trusts the caller to pass the right marketParams. The contract only enforces `marketId === keccak256(abi.encode(params))` at the call boundary — not "params lead to a curated market".

**How to avoid:** Server-side does TWO lookups:

1. `morpho.idToMarketParams(marketId)` — returns the on-chain canonical params for `marketId`. Compare against the agent's claimed params; mismatch = REFUSE with `INVALID_INPUT`.
2. Check the resolved (server-trusted) params against `MORPHO_KNOWN_MARKETS_ETHEREUM` registry. If `marketId` is in the registry, surface the label in DECODED ARGS. If not, surface `[UNKNOWN MARKET — verify oracle: 0x... and IRM: 0x... independently before signing]` flag.

**Warning signs:** Decoded marketParams have an oracle address NOT in `KNOWN_GOOD_ORACLES` (Phase 29 ships an allowlist of curated-market oracles; uncurated oracle = warning). Decoded irm NOT equal to `AdaptiveCurveIRM` (`0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC`) = warning.

### Pitfall 3: Stale curated-registry market-id (post-rebrand or migration)

**What goes wrong:** Morpho DAO rebrands a market or deprecates one in the curated registry. The hardcoded marketId in `src/config/contracts.ts` no longer matches the canonical curated set. Agent calls against the stale market-id; server says `[UNKNOWN MARKET]` even though the user knows the market was canonical at SOT-write time.

**Why it happens:** Morpho's market parameters are immutable (`marketId` is fixed for a given `MarketParams`), but markets can be deprecated by the front-ends and replaced with a slightly different `lltv` / `oracle` value (creating a new marketId).

**How to avoid:** SOT slot in `src/config/contracts.ts` MUST be re-verified against [blue-api.morpho.org top-by-TVL query](https://blue-api.morpho.org/graphql) at every Phase 29-touching plan iteration. The address-book discipline from Aave V3 / Compound V3 applies here against the Morpho Blue API. Re-check freshness at plan-write time.

**Warning signs:** A market in the curated registry has near-zero TVL on the Morpho Blue API (recommended threshold: < $1M supplyAssetsUsd — flag for re-curation). The Phase 29 `npm test test/config-contracts.test.ts` adds a "market freshness" comment but does NOT runtime-check (avoid network dep in tests).

### Pitfall 4: Oracle price scale mismatch (1e36 vs 1e8 vs 1e18)

**What goes wrong:** vp's existing health-math infrastructure assumes Chainlink-shape 8-decimal prices (Compound's `getPrice`) or Aave's market-reference-currency (variable scale). Morpho uses 1e36-scaled prices. Off-by-multiple-orders-of-magnitude health-factor reading silently passes regression IF the test fixture matches the bug.

**Why it happens:** Morpho's `ORACLE_PRICE_SCALE = 1e36` is a load-bearing constant that doesn't appear in any other vp protocol math.

**How to avoid:** `src/signing/morpho-health.ts` exports `ORACLE_PRICE_SCALE = 10n ** 36n` and `LLTV_SCALE = 10n ** 18n` and `LTV_SCALE = 10n ** 18n` as named constants. Regression test asserts the three literals AND a hand-computed expected-output anchor (e.g., 5 wstETH @ oraclePrice 3500e42, lltv 0.965e18, borrow 4 WETH → expected HF ≈ 4.22e18). Mirror T-COMPOUND-RATIO-DRIFT-1 anchor pattern.

**Warning signs:** Health factor reads come out 1e18 × 1e10 = 1e28 (12 orders of magnitude off) or 1e18 / 1e10 = 1e8 (10 orders off) — flag for ORACLE_PRICE_SCALE error.

### Pitfall 5: `receiver` not pinned to `from` — leaking funds to attacker

**What goes wrong:** Agent passes `receiver: attackerWallet` to `prepare_morpho_borrow` or `prepare_morpho_withdraw`. The Morpho contract dispatches the loan tokens / withdrawn assets to the attacker's wallet. The user signs on Ledger; the device shows the receiver (clear-signed) but the user doesn't notice the recipient is wrong.

**Why it happens:** Morpho's `borrow` and `withdraw` accept arbitrary `receiver`. vp's pinning discipline (mirror Phase 7's `to`-pinning) doesn't extend automatically.

**How to avoid:** vp's `prepare_morpho_borrow` and `prepare_morpho_withdraw` HARD-PIN `receiver = from` server-side. No `receiver` arg in the input schema. The Ledger device DOES display the receiver in clear-sign — so the user has a final check — but the server-side pinning prevents the attack from reaching the device in the first place.

**Warning signs:** Schema-side: any `receiver` field in `prepare_morpho_*` input schemas → architectural smell. Should not exist.

## Runtime State Inventory

Phase 29 is a greenfield additive feature on the EVM stack — no rename, no refactor, no migration. **Skipping this section** (per researcher template guidance — rename/refactor phases only).

## Code Examples

Phase 29's per-pattern examples already appear inline above:
- § Topic 5: function signatures verbatim from Morpho.sol
- § Topic 6: `prepare_morpho_repay` repay-max resolution pseudocode
- § Topic 7: `MorphoHealth` math example with 1e36 price scale
- Architecture Patterns Pattern 1: `viem.parseAbi` ABI fragment + `_morphoProtocols` ESM spy
- Architecture Patterns Pattern 2: `computeMorphoHealth` pure-bigint implementation sketch

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Morpho Optimizer (Compound V2 / Aave V2 on-top-of) | Morpho Blue (standalone primitive) | 2024-01 (Morpho Blue mainnet) | Optimizer still operational but deprecated for new deposits. Phase 29 is Blue-only (per CONTEXT.md `<deferred>`). |
| Single-Comet / single-Pool curated lending | Permissionless market creation per `MarketParams` tuple | 2024-01 onward | Phase 29 must enumerate via API + curate; long-tail uncurated path warned |
| Aave-style global health factor | Per-market LLTV + per-market health ratio | 2024-01 onward | Phase 29 computes per-market HF; cross-market portfolio aggregation deferred (no equivalent of Aave's portfolio HF — each Morpho market is isolated) |
| Hand-rolled lending protocol SDK (compound-js with ethers v5) | viem-native data + reader SDK (`@morpho-org/blue-sdk-viem`) | 2024+ (viem dominance) | Phase 29 rejects the SDK on stack-uniformity grounds, but the SDK shape is correct for v2.x integration patterns |
| LedgerHQ ERC-7730 CAL ABSENT (Compound case) | LedgerHQ ERC-7730 CAL PRESENT (Morpho case) — clear-signed | ~2025+ (Morpho's CAL submission per ledger registry) | Phase 29's UX is significantly improved — device shows labeled fields; no blind-sign notice needed |

**Deprecated/outdated:**
- Morpho Optimizer (Compound V2 / Aave V2 on-top-of) — out of scope per CONTEXT.md deferred.
- MetaMorpho (curated-vault aggregator) — out of scope per CONTEXT.md deferred (v2.x follow-up if user demand justifies).
- `@morpho-org/blue-sdk-ethers` — ethers-v5-locked; stack incompatible.

## Open Questions

1. **Phase 29 prepare-tool count: 4 (LOAN-only) or 6 (LOAN + COLLATERAL)?** Per § Topic 5: Morpho's distinct LOAN-side vs COLLATERAL-side selectors mean the lifecycle is incomplete with just 4 tools — a new user can't `supplyCollateral` to start a borrowing position. Recommendation: ship 6 tools (`prepare_morpho_supply` + `_withdraw` + `_borrow` + `_repay` + `_supply_collateral` + `_withdraw_collateral`). Cost: ~250 LoC per additional tool (mechanical clone). Benefit: complete lifecycle in one phase. **Discuss-phase question.**

2. **Curated registry: 10, 15, 20 entries?** Per § Topic 4 + CONTEXT.md `<decisions>` Claude's-discretion. Recommendation: 15 entries (ranks 2, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 18, 19 plus 1 top-stable-pair). Planner re-verifies TVL freshness at plan-write time via Morpho Blue API.

3. **`prepare_morpho_withdraw_collateral({ amount: "max" })` semantics?** Phase 29's `prepare_morpho_repay` accepts `"max"`. Should `_withdraw_collateral` also? Withdraw-max-collateral on a position with active borrowing could trigger liquidation. Conservative recommendation: NO `"max"` on `_withdraw_collateral` (user passes explicit amount). User experience: borrow-close lifecycle is `_repay({ amount: "max" })` → `_withdraw_collateral({ amount: <explicit> })`.

4. **Morpho Blue API as a runtime dep?** Phase 29 uses the API at RESEARCH time to enumerate top markets. Should `get_morpho_positions` ever query the API at runtime (e.g., for long-tail market discovery)? Per CONTEXT.md scope — NO; static registry only. Long-tail discovery via API is a v2.x follow-up.

5. **Fixture letter assignment.** Per ROADMAP Phase 29 Plan 29-03: "Fixture T (Morpho supply) + Fixture U (Morpho repay-max)". Per Phase 28 ROADMAP retro: Phase 28 fixtures are R/S/T/U (Compound supply/withdraw/borrow/repay-max). **Conflict:** Phase 28 already used T/U. Phase 29 likely intends V/W (Morpho supply / Morpho repay-max) — or the ROADMAP language is from a draft predating Phase 28's final R/S/T/U scheme. **Planner confirms with retroactive read of Phase 28 fixture letters; recommend V/W for Phase 29.**

6. **Oracle allowlist scope.** Should Phase 29 ship a curated `KNOWN_GOOD_ORACLES_ETHEREUM` allowlist (in addition to `KNOWN_GOOD_IRMS_ETHEREUM`)? Markets with uncurated oracles are riskier; an oracle allowlist makes the warning more targeted. Recommendation: YES, ship a small allowlist (5-10 entries — Chainlink USD oracles, Lido stETH oracle, MakerDAO DSR oracle, etc., one per curated market). Discuss-phase decision.

## Environment Availability

Phase 29 is code-only; no new external runtime dependencies. Existing project deps (viem, vitest, @noble/hashes, @modelcontextprotocol/sdk, @walletconnect/sign-client, etc.) already cover all needs. **Skip block:** no external runtime dependencies for this phase.

## Validation Architecture

> `workflow.nyquist_validation` config not inspected at research time — assuming enabled per project default (vitest is the project test framework per CLAUDE.md).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (per project CLAUDE.md) |
| Config file | (existing — vp ships vitest config; no change needed) |
| Quick run command | `npm test -- test/protocols-morpho-blue.test.ts test/signing-morpho-health.test.ts -x` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MOR-01 | get_morpho_positions curated-registry multi-market read | unit + integration | `npm test -- test/get-morpho-positions.test.ts -x` | ❌ Wave 0 |
| MOR-01 (sub) | get_lending_positions Morpho branch — 3-protocol discriminated union; Aave + Compound rows byte-identical | unit | `npm test -- test/get-lending-positions.morpho.test.ts -x` | ❌ Wave 0 |
| MOR-02 | prepare_morpho_supply + assets-path + onBehalf-pinning + marketId-allowlist | unit | `npm test -- test/prepare-morpho-supply.test.ts -x` | ❌ Wave 0 |
| MOR-03 | prepare_morpho_withdraw + prepare_morpho_borrow + receiver-pinning | unit | `npm test -- test/prepare-morpho-withdraw.test.ts test/prepare-morpho-borrow.test.ts -x` | ❌ Wave 0 |
| MOR-04 | prepare_morpho_repay + assets-path + "max" → shares-path with -1 dust margin | unit | `npm test -- test/prepare-morpho-repay.test.ts -x` | ❌ Wave 0 |
| MOR-05 (sub) | SOT slots + curated registry + canonical-dispatch extension | unit | `npm test -- test/config-contracts.test.ts test/security-canonical-dispatch.test.ts -x` | partial (existing files; new assertions in Wave 0) |
| Cross | NO LEDGER NOTICE block emitted for Morpho calldata (negative assertion) | unit | `npm test -- test/preview-send.morpho.test.ts -x` | ❌ Wave 0 |
| Cross | Fixtures V + W in signing-fingerprint (Morpho supply + Morpho repay-max) | regression | `npm test -- test/signing-fingerprint.test.ts -x` | partial (file exists; new fixtures added) |
| Cross | viem.toFunctionSelector byte-identity for 4 (or 6) Morpho selectors | unit | `npm test -- test/protocols-morpho-blue.test.ts -x` | ❌ Wave 0 |
| Cross | Pure-bigint MorphoHealth math; ORACLE_PRICE_SCALE = 1e36 anchor | unit | `npm test -- test/signing-morpho-health.test.ts -x` | ❌ Wave 0 |
| Cross | marketId-derivation cross-check: agent-passed marketId === keccak256(abi.encode(server-resolved params)) | unit | `npm test -- test/morpho-marketid-derivation.test.ts -x` | ❌ Wave 0 |
| Cross | LiquidationRisk classifier reused from aave-health (no Morpho-specific re-classifier) | unit | `npm test -- test/signing-morpho-health.test.ts -x` (assertion inline) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** narrow test file matching the task's surface (`npm test -- test/<file>.test.ts -x`)
- **Per wave merge:** `npm test` full suite
- **Phase gate:** full suite green + grep-zero on Morpho-address inline literals (`grep -E "0xBBBBBb|0x870aC11D" src/ | grep -v config/contracts.ts | grep -v test/ → empty`) + grep-zero on hardcoded curated marketIds outside SOT

### Wave 0 Gaps
- [ ] `test/protocols-morpho-blue.test.ts` — selector regression + decode unit tests; 4 (or 6) selectors via `viem.toFunctionSelector`
- [ ] `test/chains-morpho-blue.test.ts` — multicall snapshot reader; mock client
- [ ] `test/signing-morpho-health.test.ts` — pure-bigint health math; ORACLE_PRICE_SCALE / LLTV_SCALE / LTV_SCALE literal anchors + deterministic input → expected-HF anchor (T-MORPHO-PRICE-SCALE-1)
- [ ] `test/get-morpho-positions.test.ts` — full reader integration; mocked multicall results
- [ ] `test/get-lending-positions.morpho.test.ts` — 3-protocol discriminated union; Aave + Compound rows byte-identical
- [ ] `test/prepare-morpho-supply.test.ts` — marketId allowlist gate; onBehalf pinning; assets-path-only
- [ ] `test/prepare-morpho-withdraw.test.ts` — receiver pinning; assets-path
- [ ] `test/prepare-morpho-borrow.test.ts` — receiver pinning; assets-path
- [ ] `test/prepare-morpho-repay.test.ts` — "max" → shares-path with -1 dust margin; T-MORPHO-REPAY-FRONTRUN-1; non-canonical-spelling rejection
- [ ] [optional: `test/prepare-morpho-supply-collateral.test.ts` + `test/prepare-morpho-withdraw-collateral.test.ts` — if 6-tool surface decision]
- [ ] Extension to `test/signing-fingerprint.test.ts` — fixtures V + W literal anchors (Morpho supply + Morpho repay-max)
- [ ] Extension to `test/signing-blocks.test.ts` — 4 (or 6) PREPARE RECEIPT templates + DECODED ARGS templates with marketParams labeling; verify NO LEDGER NOTICE template added
- [ ] Extension to `test/security-canonical-dispatch.test.ts` — 1 new Ethereum-chain Morpho address allowlist member
- [ ] Extension to `test/simulate-position-change.test.ts` — `protocol: "morpho-blue"` dispatcher arm
- [ ] `test/preview-send.morpho.test.ts` — selector-routed DECODED ARGS for Morpho 4 (or 6) functions; tokenContext from `decoded.marketParams.loanToken`; NO LEDGER NOTICE (negative assertion)
- [ ] `test/morpho-marketid-derivation.test.ts` — keccak256 cross-check at curated-registry entries

## Security Domain

Phase 29 inherits the v1.x trust-pipeline invariants verbatim (PREP-03 fingerprint, PREP-04 hash recompute, PREP-07/08 send-gates, SEC-35 dispatch-allowlist). No new ASVS categories activated.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | (no auth surface; Ledger device is the trust anchor) |
| V3 Session Management | no | WC session reused from PAIR-* |
| V4 Access Control | yes | Layer 0.5 dispatch-allowlist refuses non-canonical `tx.to`; `onBehalf` + `receiver` server-pinned to `from` |
| V5 Input Validation | yes | parseAmountStrict + marketId allowlist + curated-vs-uncurated path discrimination + onBehalf/receiver-pinning |
| V6 Cryptography | yes | viem (audited); keccak via @noble/hashes; no hand-rolled crypto; marketId derivation cross-check |

### Known Threat Patterns for Morpho Blue dispatch

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Malicious agent passes uncurated `marketId` with attacker-controlled oracle | Tampering | Server-side marketId → marketParams resolution + curated-registry lookup; uncurated path surfaces `[UNKNOWN MARKET]` warning in DECODED ARGS; user has final on-device verification (clear-signed) |
| Malicious agent forges `marketId` that doesn't match its claimed marketParams | Tampering | Server-side `morpho.idToMarketParams(marketId)` lookup + cross-check `marketId === keccak256(abi.encode(returned_params))` |
| Malicious agent sets `receiver` (borrow/withdraw) or `onBehalf` (supply/repay) to attacker wallet | Tampering | Server-side hard-pin both to `from` (no agent input for these fields); enforce at schema level |
| Stale curated-registry marketId (deprecated by Morpho DAO front-end) | Information disclosure (low — user gets `[UNKNOWN MARKET]` warning if curated → deprecated transition occurs) | Plan-write-time freshness re-check via Morpho Blue API; address-book discipline |
| Front-running attack on `repay({ amount: "max" })` (per Morpho natspec) | Denial of service (failed repay reverts) | Subtract 1 share from snapshot before encoding shares-path repay; DECODED ARGS surfaces `-1 share dust margin` rationale |
| `MAX_UINT256` sentinel passed on assets path (would attempt to repay 1e77 — revert) | DoS | Phase 29 server-side resolution to shares-path for "max"; agent literal `MAX_UINT256` is not a supported input (strict "max" string only) |
| Oracle manipulation outside vp's trust boundary | Tampering (external) | Out of vp's control; surface oracle address in DECODED ARGS so user can verify externally; `[UNKNOWN ORACLE]` warning if not in `KNOWN_GOOD_ORACLES_ETHEREUM` (if Open Question #6 ships YES) |

## Sources

### Primary (HIGH confidence)
- [morpho-org/morpho-blue/src/Morpho.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/Morpho.sol) — function signatures verbatim
- [morpho-org/morpho-blue/src/interfaces/IMorpho.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/interfaces/IMorpho.sol) — MarketParams, Position, Market struct definitions
- [morpho-org/morpho-blue/src/libraries/MarketParamsLib.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/libraries/MarketParamsLib.sol) — marketId derivation: `keccak256(abi.encode(MarketParams))`
- [LedgerHQ/clear-signing-erc7730-registry/registry/morpho/calldata-MorphoBlue.json](https://github.com/LedgerHQ/clear-signing-erc7730-registry/blob/master/registry/morpho/calldata-MorphoBlue.json) — confirmed CAL coverage for all 6 functions on chainId 1 + 8453
- [blue-api.morpho.org/graphql](https://blue-api.morpho.org/graphql) — top-by-TVL market enumeration; query at 2026-05-20
- [api.llama.fi/protocol/morpho-blue](https://api.llama.fi/protocol/morpho-blue) — chain TVL distribution
- `npm view @morpho-org/blue-sdk` — version, license, maintainers, scripts (no postinstall), publication time
- Empirical SDK install at `/tmp/morpho-sdk-probe` + `lib/esm/**/*.d.ts` read — confirms viem-native shape, reader-not-encoder orientation, no signing helpers

### Secondary (MEDIUM confidence)
- [docs.morpho.org/llms-full.txt](https://docs.morpho.org/llms-full.txt) — canonical address table (mainnet + Base + Arbitrum + Polygon + Optimism)
- [docs.morpho.org/morpho-blue](https://docs.morpho.org/morpho-blue) — architectural overview (nav-only content, but URL is the canonical doc landing)
- Existing vp source files: `src/protocols/compound-v3.ts`, `src/chains/compound-v3.ts`, `src/signing/compound-collateralization.ts`, `src/tools/get_lending_positions.ts`, `src/tools/prepare_compound_*.ts`, `src/tools/simulate_position_change.ts`, `src/security/canonical-dispatch.ts` — pattern mirror references (Phase 28 ships the canonical shape this phase mirrors)
- `npm view viem version` → 2.50.4 current; project pinned at `^2.48.0`

### Tertiary (LOW confidence — flagged for validation)
- TVL rankings shift daily — the top-20 enumeration in § Topic 4 is a 2026-05-20 snapshot. Planner re-verifies at plan-write time.
- IRM contract version: AdaptiveCurveIRM at `0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC` is the de-facto IRM for all 20 top markets sampled — but Morpho's permissionless market creation means SOMEONE could create a market with a different IRM. The KNOWN_GOOD_IRMS_ETHEREUM allowlist starts with 1 entry; v2.x adds more if blue-chip markets adopt alternative IRMs.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | All 4 selectors (`supply` / `withdraw` / `borrow` / `repay`) [+ optional `supplyCollateral` / `withdrawCollateral`] — to be regression-tested via `viem.toFunctionSelector` in `test/protocols-morpho-blue.test.ts` | Architecture Patterns Pattern 1 | MEDIUM — derived from canonical function signatures verified against Morpho.sol; the planner MUST add a `viem.toFunctionSelector` regression assertion in `test/protocols-morpho-blue.test.ts` to lock byte-identity. |
| A2 | Top-20 mainnet markets enumerated 2026-05-20 reflect current curation candidates | § Topic 4 | MEDIUM — TVL rankings shift daily; planner re-verifies at plan-write time via Morpho Blue API. The exact 15-market cut is Claude's-discretion per CONTEXT.md. |
| A3 | Repay-max via `shares = position.borrowShares - 1` is the correct mitigation against the front-run attack | § Topic 6 | MEDIUM — Morpho's natspec documents the attack but doesn't recommend a specific mitigation. The -1 dust margin is a conservative approach; an alternative is `shares × 0.9999` (0.01% dust margin). Both leave 1-share dust; the -1 form is cleaner to reason about. |
| A4 | `AdaptiveCurveIRM = 0x870aC11D…6BC` is the canonical Ethereum IRM for v1.x curated markets | § Topic 3 | LOW — verified via SDK addresses table + top-20 Morpho Blue API query (100% IRM coverage); v2.x may surface alternative IRMs |
| A5 | Morpho Blue calldata clear-signing coverage for Ethereum + Base extends to ALL 6 functions in production Ledger Live | § Topic 8 | LOW — verified directly via the calldata-MorphoBlue.json descriptor file. Ledger Live's actual rendering of the CAL descriptor SHOULD match — but Phase 29 success criteria + real-Ledger smoke verify-phase MUST confirm clear-sign behavior on-device. |
| A6 | The 4-tool LOAN-only Phase 29 surface is sufficient for MOR-01..05 (vs the 6-tool LOAN + COLLATERAL surface) | Open Question #1 | HIGH — strict reading of MOR-01..05 says "supply / withdraw / borrow / repay" which is LOAN-only. But the user-facing lifecycle is incomplete without collateral-side tools (user can't START a borrowing position without `supplyCollateral`). Discuss-phase MUST resolve. **Recommendation: 6 tools.** |
| A7 | Fixture letters V and W (NOT T and U per ROADMAP draft language) | Open Question #5 | LOW — Phase 28 used R/S/T/U; Phase 29 needs new letters. The ROADMAP language at plan 29-03 says "Fixture T (Morpho supply) + Fixture U (Morpho repay-max)" which conflicts with Phase 28's allocation. Planner confirms with retroactive read; recommend V/W. |
| A8 | slopcheck unavailable at research time → all `@morpho-org/*` packages [ASSUMED] | Package Legitimacy Audit | LOW — we're rejecting all three packages on technical-fit grounds anyway; legitimacy verification is moot. |

## Metadata

**Confidence breakdown:**
- Morpho Blue architecture: HIGH — primary source verified
- Function signatures + MarketParams struct: HIGH — verbatim from Morpho.sol + IMorpho.sol
- Canonical contract addresses: HIGH — 3 independent sources agree (CAL descriptor + SDK + docs)
- Market enumeration: HIGH (top-20 raw data); MEDIUM (curation cut at 15 — planner discretion)
- repay-max semantics: HIGH (natspec verbatim); MEDIUM (mitigation strategy is interpretation — discuss-phase confirms)
- Ledger CAL coverage: HIGH — direct registry fetch
- Multi-chain: HIGH — 3 sources agree on all 5 chain addresses
- FROZEN-area discipline: HIGH — direct file-pattern inspection
- SDK rejection: HIGH — empirical install + .d.ts read

**Research date:** 2026-05-20
**Valid until:** 2026-06-19 (30 days for stable protocol; Morpho DAO can deprecate / repoint curated markets and re-curate at the API level — re-verify SOT slots at plan-write time)
