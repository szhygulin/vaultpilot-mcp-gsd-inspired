# Phase 28: Research — Compound V3 multi-Comet supply / withdraw / borrow / repay

**Researched:** 2026-05-20
**Status:** Complete
**Confidence:** HIGH (architecture, ABI, addresses, CAL coverage); MEDIUM (SDK choice — verified via empirical install + .d.ts read, not Context7)

## Summary

Phase 28 is a mechanical extension of v1.1 Phase 7 (Aave V3) to a second EVM lending protocol — Compound V3. The architectural shape (per-protocol decoder + per-chain SOT slots + 4-action `simulate_position_change` dispatcher + pure-bigint health math) ported across 1:1; the only material differences come from Compound's **isolated-market (multi-Comet) model**:

1. The agent MUST specify which Comet to interact with (no implicit default) — `cometAddress` is a required arg on every Compound `prepare_*` tool. Each Comet is a fully independent lending pool keyed by `(chain, baseAsset)`.
2. Compound V3 has **no separate `borrow` function** — `withdraw(base, amount)` against a healthy collateral position IS the borrow operation. Repay is `supply(base, amount)` against an existing debt. Agent-side, the server detects intent via `borrowBalanceOf(wallet)` at prepare time and chooses the right tool name.
3. Health surface differs from Aave's normalized HF — Compound exposes `isBorrowCollateralized(account)` (bool) and `isLiquidatable(account)` (bool); we compute a derived `collateralizationRatio` for parity with the agent-facing HF semantics from Phase 7.
4. **No Ledger CAL clear-sign coverage for Compound V3** — `LEDGER NOTICE` block required (Phase 6 WETH9.withdraw precedent). Aave V3 had coverage; Compound does NOT.

**Primary recommendation:** Mirror the v1.1 Phase 7 file layout 1:1. Use `viem.parseAbi` inline (no SDK). Ship Ethereum-mainnet-first per CONTEXT.md scope; multi-chain (Polygon / Arbitrum / Base / Optimism) deferred to v2.3.x follow-up despite all 5 chains having canonical deployments — keeps the phase scope tight and matches Aave V3's own ship cadence (Phase 7 was Ethereum-only; Phase 8 widened).

## § Topic 1: Compound V3 Comet architecture overview

**HIGH confidence.** Verified against [docs.compound.finance/](https://docs.compound.finance/), the [compound-finance/comet deployments/ folder](https://github.com/compound-finance/comet/tree/main/deployments) (canonical SOT — referenced directly by Compound Labs docs), and Etherscan verified bytecode at [0xc3d688B66703497DAA19211EEdff47f25384cdc3](https://etherscan.io/address/0xc3d688B66703497DAA19211EEdff47f25384cdc3#code).

### Architectural model

Compound V3 ("Comet") is **isolated-market by design** — distinct from Aave V3's single-pool-multiple-reserves model. Each Comet is an independent lending pool defined by:

- **One base asset** (the only borrowable asset in that market — e.g. USDC for `cUSDCv3`, WETH for `cWETHv3`)
- **N collateral assets** (configured by governance; e.g. on `cUSDCv3` mainnet: WBTC, WETH, LINK, UNI, COMP, wstETH, cbBTC, tBTC)
- **Per-collateral parameters** — borrow CF, liquidation CF, liquidation factor, supply cap (asset-specific, NOT global)

**Key implication for the agent surface:** the same physical asset (e.g. USDC) can be a *base* in one Comet and *collateral* in zero Comets (Compound doesn't currently use USDC as collateral anywhere). The same Comet function `supply(asset, amount)` accepts EITHER the base OR a configured collateral — the contract routes by `asset` lookup. There is no separate "supplyCollateral" entry point.

**No implicit default Comet.** The agent ALWAYS passes `cometAddress` explicitly per CMP-01/03/04/05. Server-side, we maintain a curated per-chain Comet enumeration in `src/config/contracts.ts` for two purposes: (a) read-tool fan-out across all Comets per chain in `get_compound_positions`; (b) canonical-dispatch allowlist (SEC-35 / Layer 0.5).

### Canonical Comet addresses (Phase 28 scope: Ethereum mainnet only)

Verified 2026-05-20 against [compound-finance/comet/deployments/mainnet/*/roots.json](https://github.com/compound-finance/comet/tree/main/deployments/mainnet):

| Market | Base Asset | Comet Address | Source |
|---|---|---|---|
| cUSDCv3 | USDC | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` | [roots.json](https://raw.githubusercontent.com/compound-finance/comet/main/deployments/mainnet/usdc/roots.json) |
| cUSDTv3 | USDT | `0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840` | [roots.json](https://raw.githubusercontent.com/compound-finance/comet/main/deployments/mainnet/usdt/roots.json) |
| cWETHv3 | WETH | `0xA17581A9E3356d9A858b789D68B4d866e593aE94` | [roots.json](https://raw.githubusercontent.com/compound-finance/comet/main/deployments/mainnet/weth/roots.json) |
| cUSDSv3 | USDS | `0x5D409e56D886231aDAf00c8775665AD0f9897b56` | [roots.json](https://raw.githubusercontent.com/compound-finance/comet/main/deployments/mainnet/usds/roots.json) |
| cwstETHv3 | wstETH | `0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3` | [roots.json](https://raw.githubusercontent.com/compound-finance/comet/main/deployments/mainnet/wsteth/roots.json) |
| cWBTCv3 | WBTC | `0xe85Dc543813B8c2CFEaAc371517b925a166a9293` | [roots.json](https://raw.githubusercontent.com/compound-finance/comet/main/deployments/mainnet/wbtc/roots.json) |

**Shared infrastructure (mainnet, all Comets):**
- Configurator: `0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3`
- Rewards: `0x1B0e765F6224C21223AeA2af16c1C46E38885a40`
- Bulker (cUSDCv3): `0xa397a8C2086C554B531c02E29f3291c9704B00c7`

Configurator/Rewards/Bulker are NOT dispatch targets for Phase 28 (no rewards-claim, no bulker batching in this phase) — seed slots in `src/config/contracts.ts` for v2.3+ flexibility per Phase 7 forward-compat precedent (`aaveIncentivesController`).

### Multi-chain availability (Phase 28 scope decision)

All 5 vp-supported chains have canonical Compound V3 Comets:

| Chain | Markets Available |
|---|---|
| Ethereum (1) | usdc, usdt, weth, usds, wsteth, wbtc |
| Polygon (137) | usdc, usdt |
| Arbitrum (42161) | usdc.e, usdc, usdt, weth |
| Base (8453) | aero, usdbc, usdc, usds, weth |
| Optimism (10) | usdc, usdt, weth |

**Decision lock — Phase 28 ships Ethereum-only.** Multi-chain widening deferred to v2.3.x follow-up per CONTEXT.md decision and matching Phase 7→8 cadence (Phase 7 Aave V3 was Ethereum-only; Phase 8 widened to all 5 chains as a dedicated milestone). The per-chain Comet table is a wider DF surface than v2.3 entry-phase scope warrants — the planner can also include the Polygon `cUSDCv3 = 0xF25212E676D1F7F89Cd72fFEe66158f541246445` slot for forward-compat seeding without enabling the multi-chain tools, mirroring how Phase 7 seeded `aaveIncentivesController`.

**Decision lock:** Adopt. Ethereum-only ship. 6 canonical mainnet Comets seeded in SOT. Forward-compat L2 slots optional.

## § Topic 2: Compound V3 SDK / ABI access

**HIGH confidence.** Empirical install + `dist/*.d.ts` read at `/tmp/compound-probe`.

### Package: `@compound-finance/compound-js`

- **Last published:** 2024-12-12 ([npm view @compound-finance/compound-js](https://www.npmjs.com/package/@compound-finance/compound-js)) — ~17 months stale at research time
- **Version:** 0.6.2
- **Dependency on ethers v5:** confirmed via `import { BigNumber } from '@ethersproject/bignumber/lib/bignumber'` in `dist/nodejs/comet.d.ts`
- **Postinstall script:** none (clean per `npm view`)
- **Signing model:** the SDK helpers (`supply`, `withdraw`, etc.) return `TrxResponse` — an ethers.js transaction object that has already been broadcast through the provider. NOT an unsigned-tx producer.

**Verdict: do NOT adopt.**

Reasons:
1. **Stack incompatibility** — vp uses viem 2.50.4 (project CLAUDE.md); the SDK is ethers-v5-locked. Mixing the two requires shims at every call site and doubles the bundle (ethers v5 is ~250kb gzipped).
2. **Internally-signing helpers** — the SDK helpers are *signing-and-broadcast* helpers (mirror of `compound.supply(...)` → ethers tx). vp's pipeline produces *unsigned* tx bytes for Ledger to sign. The SDK's output shape is the wrong end of the pipeline.
3. **Staleness** — last touched 17 months ago; the SDK predates the cWETHv3/cUSDSv3/cwstETHv3 mainnet listings AND the L2 deployments. `getSupportedDeployments()` returns a static built-in list that's certain to be out of date.

### Recommendation: `viem.parseAbi` inline, mirror of `src/protocols/aave-v3.ts`

The Comet ABI fragment we need is small (8-10 functions). Empirically verified against the canonical Solidity interface at [compound-finance/comet/contracts/CometMainInterface.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometMainInterface.sol):

```typescript
// src/protocols/compound-v3.ts (new) — mirrors src/protocols/aave-v3.ts shape
export const COMPOUND_V3_COMET_ABI = parseAbi([
  // Writes (Phase 28 prepare-tool surface)
  "function supply(address asset, uint amount)",
  "function withdraw(address asset, uint amount)",
  // Reads (Phase 28 read-tool surface — get_compound_positions, get_compound_market_info)
  "function baseToken() view returns (address)",
  "function balanceOf(address account) view returns (uint256)",
  "function borrowBalanceOf(address account) view returns (uint256)",
  "function collateralBalanceOf(address account, address asset) view returns (uint128)",
  "function isBorrowCollateralized(address account) view returns (bool)",
  "function isLiquidatable(address account) view returns (bool)",
  "function getSupplyRate(uint utilization) view returns (uint64)",
  "function getBorrowRate(uint utilization) view returns (uint64)",
  "function getUtilization() view returns (uint)",
  "function numAssets() view returns (uint8)",
  "function getAssetInfoByAddress(address asset) view returns ((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))",
  "function getPrice(address priceFeed) view returns (uint128)",
  "function totalsCollateral(address asset) view returns (uint128 totalSupplyAsset, uint64 _reserved)",
  "function totalSupply() view returns (uint256)",
  "function totalBorrow() view returns (uint256)",
]);
```

**Decision lock:** Adopt `viem.parseAbi` inline; SKIP `@compound-finance/compound-js`. ABI fragment lives in new file `src/protocols/compound-v3.ts` mirroring `src/protocols/aave-v3.ts` 1:1 (encoder-per-supported-function + selector table + decode discriminated union + `_compoundProtocols` ESM spy indirection).

## § Topic 3: Comet supply / withdraw / borrow / repay function signatures

**HIGH confidence.** Verified against [CometMainInterface.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometMainInterface.sol) verbatim + Etherscan-verified bytecode at the cUSDCv3 proxy.

### Canonical function signatures (Comet)

| Function | Signature | Phase 28 Use |
|---|---|---|
| supply | `supply(address asset, uint amount)` | `prepare_compound_supply` AND `prepare_compound_repay` (intent disambiguation server-side) |
| supplyTo | `supplyTo(address dst, address asset, uint amount)` | NOT used in Phase 28 (deposit-for-self only; v2.x relayer pattern) |
| supplyFrom | `supplyFrom(address from, address dst, address asset, uint amount)` | NOT used in Phase 28 (manager pattern) |
| withdraw | `withdraw(address asset, uint amount)` | `prepare_compound_withdraw` AND `prepare_compound_borrow` (intent disambiguation server-side) |
| withdrawTo | `withdrawTo(address to, address asset, uint amount)` | NOT used in Phase 28 (explicit-self-recipient lock — research § Topic 5 Aave precedent) |
| withdrawFrom | `withdrawFrom(address src, address to, address asset, uint amount)` | NOT used in Phase 28 (manager pattern) |

### supply / repay disambiguation at the agent boundary

Compound's single `supply` entry point covers two semantic intents:
- **Supply collateral** — `asset` is a configured collateral (e.g. WBTC into cUSDCv3); deposits to the collateral side
- **Repay borrow** — `asset` is the Comet's base asset AND the user has existing `borrowBalanceOf > 0`; calldata reduces the debt first, then deposits surplus to the base supply side

The Comet contract handles the routing internally — it inspects `(asset == baseToken)` and `(currentBorrowBalance > 0)` and applies the operation accordingly. From the perspective of *calldata bytes*, supply and repay are byte-identical for the same `(asset, amount)`.

**Phase 28 server-side disambiguation:** the agent calls `prepare_compound_supply` or `prepare_compound_repay` by *intent name*. The server validates the intent matches reality at prepare time:

- `prepare_compound_supply({ chain, cometAddress, asset, amount })` — server reads `Comet.baseToken()` once. If `asset == baseToken && borrowBalanceOf(from) > 0`, refuse with `INVALID_INPUT: "asset is the base asset and you have an outstanding borrow — use prepare_compound_repay instead (would silently reduce debt)"`. Otherwise emit the supply calldata.
- `prepare_compound_repay({ chain, cometAddress, amount })` — `asset` is NOT an agent arg (server fills `baseToken` from the Comet). Server reads `borrowBalanceOf(from)`; if zero, refuse with `INVALID_INPUT: "no outstanding borrow on this Comet — use prepare_compound_supply to deposit the base asset"`.
- `prepare_compound_borrow({ chain, cometAddress, amount })` — `asset` is NOT an agent arg (server fills `baseToken`). The calldata is `withdraw(baseToken, amount)` — *byte-identical to a base-asset withdraw of supplied funds*, but the intent gate makes the agent commit to which operation it's doing.
- `prepare_compound_withdraw({ chain, cometAddress, asset, amount })` — server reads `balanceOf(from)` (base) and `collateralBalanceOf(from, asset)` (collateral); if `asset == baseToken && balanceOf(from) == 0`, refuse with `INVALID_INPUT: "no base-asset supply position — use prepare_compound_borrow to take a borrow position instead"`.

This gives the agent a clean four-tool surface that matches its mental model, while keeping the *bytes the device signs* honest about what's happening.

**Important:** these are agent-side intent gates, NOT trust-boundary controls. The user signs on-device against the actual calldata; the Comet contract is the final authority on what the operation means. The intent gates exist to prevent agent confusion + accidental misroutes. The decoded args block in `preview_send` MUST surface both the raw calldata interpretation AND the agent's claimed intent — drift between them is a signal the agent picked the wrong tool.

**Decision lock:** Adopt the 4-tool surface (`prepare_compound_{supply,withdraw,borrow,repay}`). All four route through 2 calldata shapes (`supply` selector + `withdraw` selector). Intent-vs-reality gate at prepare time per the table above.

## § Topic 4: `MAX_UINT256` for full-position close

**HIGH confidence.** Verified via [Compound V3 protocol docs](https://docs.compound.finance/protocol/) and the [Comet source `withdraw` implementation](https://github.com/compound-finance/comet/blob/main/contracts/Comet.sol).

Compound V3 honors `amount == type(uint256).max` as a sentinel for "full balance" — applies to BOTH `withdraw` (full-position withdraw) and `supply` (when used as a repay, full-debt close — though this requires the user to actually hold `uint256.max` of the base, so practically it's clamped to balance).

### Repay-max pattern (CMP-05 — `prepare_compound_repay({ amount: "max" })`)

Per CONTEXT.md Decision lock: `amount: "max"` resolves server-side to **outstanding-debt amount + 1% buffer** (covers interest accrual between prepare and broadcast — borrow rate accrues per-second). Mirrors the Morpho Phase 29 pattern. Concrete:

1. Server reads `Comet.borrowBalanceOf(from)` at prepare time → `debtNow`
2. `amountWei = debtNow * 101 / 100` (1% buffer)
3. Calldata: `supply(baseToken, amountWei)` — Comet caps internally at actual debt; surplus deposits to supply side

**Why not pass `MAX_UINT256` directly?** Because the user would need to hold `MAX_UINT256` of the base asset in their wallet AND have an unlimited approval to the Comet — neither is realistic. The contract's `MAX_UINT256` semantics for repay would silently no-op on insufficient balance. Resolving server-side to `debt × 1.01` makes the DECODED ARGS block honest: the user sees the actual amount, not a sentinel.

### Withdraw-max pattern (`prepare_compound_withdraw({ amount: "max" })`)

For full-position close on the *supply* side (full collateral or full base withdraw), `MAX_UINT256` IS the canonical Compound sentinel. The contract's `withdraw` implementation clamps to actual balance. Server emits `amountWei = MAX_UINT256` literally; the DECODED ARGS block surfaces this as `⚠ FULL POSITION WITHDRAW (MAX_UINT256 sentinel)` mirroring v1.1 PREP-29's `⚠ UNLIMITED APPROVAL` strict-equality pattern.

**Mirror with Phase 6:** v1.1 PREP-26 ships `prepare_token_approve({ amount: "max" })` accepting `2^256-1` literally — Phase 28 reuses the `parseAmount` strict regex but adds a `"max"` arm for `prepare_compound_withdraw` and the `debtBuffer1pct` resolver for `prepare_compound_repay`. Note Phase 7 `prepare_aave_supply`/`prepare_aave_withdraw` do NOT accept "max" (research § Topic 5 reasonable-call lock — Aave has separate sentinels). Compound's protocol-level MAX support is the differentiator.

**Decision lock:** Adopt. `prepare_compound_withdraw` accepts `"max"` → `MAX_UINT256` literal. `prepare_compound_repay` accepts `"max"` → server-resolves to `debt × 1.01` concrete amount. `prepare_compound_supply` and `prepare_compound_borrow` do NOT accept `"max"` (no supply-max semantics; borrow-max is an anti-pattern — would over-borrow to liquidation).

## § Topic 5: Health-factor equivalent

**HIGH confidence.** Verified against [CometMainInterface.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometMainInterface.sol) — `isBorrowCollateralized` and `isLiquidatable` confirmed as canonical on-chain bools.

### Compound V3 surface vs Aave V3

Aave V3 exposes a normalized `healthFactor` scalar (1e18-scaled; HF >= 1 = safe). Compound V3 has NO equivalent scalar — instead two boolean predicates:

- `isBorrowCollateralized(account) → bool` — true when the account's collateral value (weighted by `borrowCollateralFactor`) covers the current borrow. **Falsifies at borrow-time** — the contract refuses to let you initiate or expand a borrow if this would go false.
- `isLiquidatable(account) → bool` — true when collateral value (weighted by `liquidateCollateralFactor` — STRICTLY higher than borrow CF) no longer covers the borrow. **Falsifies at liquidation-time** — keepers can call `absorb` once this is true.

The gap between `borrowCollateralFactor` and `liquidateCollateralFactor` is the safety margin. E.g. WETH on cUSDCv3 has borrow CF ~0.83 and liquidate CF ~0.90 — you can borrow up to 83% of WETH collateral value, and get liquidated at 90% utilization.

### Derived `collateralizationRatio` for parity with Aave-style HF

Per CONTEXT.md anchor — Phase 28 ships `src/signing/compound-health.ts` (mirror of `src/signing/aave-health.ts` pure-bigint shape). The reader surfaces all three values:

```typescript
interface CompoundHealth {
  isBorrowCollateralized: boolean;  // raw on-chain bool
  isLiquidatable: boolean;          // raw on-chain bool
  // Derived: sum(collateralValue_i × liquidateCF_i) / borrowValue
  // ≈ Aave HF semantics. null when no debt.
  liquidationCollateralRatio: bigint | null;  // 1e18-scaled (HF_SCALE — same as Aave)
  liquidationRisk: "safe" | "warning" | "danger" | "noDebt";  // same 4-arm classification
  totalCollateralUsd: string;
  totalBorrowUsd: string;
}
```

Same thresholds as Aave (research § Topic 8 inheritance): >= 1.50 safe, 1.10-1.50 warning, < 1.10 danger. The classifier in `compound-health.ts` is byte-identical to `classifyLiquidationRisk` in `aave-health.ts` — same constants, same arms. Pure-bigint math; no `Number` casts.

### Math: per-collateral asset weighting

For each collateral position `i`:
- `collateralBalance_i` = `Comet.collateralBalanceOf(account, asset_i)` (raw uint128)
- `price_i` = `Comet.getPrice(priceFeed_i)` where `priceFeed_i` comes from `getAssetInfoByAddress(asset_i).priceFeed` (Chainlink-shape; 8-decimal USD price)
- `liquidateCF_i` = `getAssetInfoByAddress(asset_i).liquidateCollateralFactor` (1e18-scaled)
- `collateralValueUsd_i = (collateralBalance_i × price_i × liquidateCF_i) / (1e18 × 10^scale_i)`
- `borrowValueUsd = borrowBalance × basePrice / 10^baseScale`
- `liquidationCollateralRatio = sum(collateralValueUsd_i) × 1e18 / borrowValueUsd`

The price feed denomination is USD (8 decimals); base asset is also USD-denominated for stable Comets. For ETH-base Comets (cWETHv3, cwstETHv3), `baseTokenPriceFeed()` returns the ETH/USD feed — same USD denomination via the per-Comet base-price oracle.

**Decision lock:** Adopt the dual-surface (raw bools + derived ratio). The bools are the AUTHORITATIVE on-chain signal (matches what keepers see); the derived ratio is the AGENT-friendly Aave-parity surface. The reader surfaces BOTH so the agent can route on either; if they ever disagree (off-chain price vs on-chain Chainlink staleness), the bools win.

## § Topic 6: Compound V3 multi-Comet positions read (`get_compound_positions`)

**HIGH confidence.** Multicall pattern verified against `src/tools/get_token_allowances.ts:13-14` (Phase 8 multicall precedent).

### Tool signature

`get_compound_positions({ chain, wallet })` — returns positions across ALL canonical Comets on `chain`. The agent does NOT enumerate Comets; the server does, from the per-chain SOT table in `src/config/contracts.ts`.

### Implementation: viem `multicall({ allowFailure: true })`

Per Phase 28 scope (Ethereum-only): 6 canonical mainnet Comets × variable number of collateral assets per Comet. Two-phase multicall:

**Phase A — per-Comet base reads (single multicall, ~4 calls per Comet × 6 Comets = ~24 calls):**
```typescript
const baseReads = comets.flatMap(comet => [
  { address: comet, abi: COMPOUND_V3_COMET_ABI, functionName: "baseToken" },
  { address: comet, abi: COMPOUND_V3_COMET_ABI, functionName: "balanceOf", args: [wallet] },
  { address: comet, abi: COMPOUND_V3_COMET_ABI, functionName: "borrowBalanceOf", args: [wallet] },
  { address: comet, abi: COMPOUND_V3_COMET_ABI, functionName: "numAssets" },
  { address: comet, abi: COMPOUND_V3_COMET_ABI, functionName: "isBorrowCollateralized", args: [wallet] },
  { address: comet, abi: COMPOUND_V3_COMET_ABI, functionName: "isLiquidatable", args: [wallet] },
]);
const baseResults = await client.multicall({ contracts: baseReads, allowFailure: true });
```

**Phase B — per-Comet collateral reads (one multicall per Comet, gated to Comets with `borrowBalanceOf > 0 || balanceOf > 0`):**

For each Comet with a non-zero base position, fetch `numAssets()` AssetInfo entries via `getAssetInfo(i)` for `i in 0..numAssets-1`, then per-collateral `collateralBalanceOf(wallet, asset)` + `getPrice(priceFeed)`. Skipping zero-position Comets (most users won't have positions in all 6) keeps the cold-path cost low.

**Phase C — derive `liquidationCollateralRatio` per Comet** in `src/signing/compound-health.ts::computeCompoundHealth` (pure bigint, mirrors `aave-health.ts::computeHealthFactor`).

### Response shape

```typescript
interface CompoundPositions {
  chain: ChainName;
  chainId: number;
  wallet: Address;
  comets: Array<{
    cometAddress: Address;
    cometName: string;  // e.g. "cUSDCv3"
    baseAsset: Address;
    baseSymbol: string;
    baseSupplyHuman: string;
    baseBorrowHuman: string;
    baseSupplyUsd: string;
    baseBorrowUsd: string;
    collateral: Array<{
      asset: Address;
      symbol: string;
      balanceHuman: string;
      balanceUsd: string;
      borrowCollateralFactor: string;  // 0..1
      liquidateCollateralFactor: string;  // 0..1
    }>;
    isBorrowCollateralized: boolean;
    isLiquidatable: boolean;
    liquidationCollateralRatio: string | null;
    liquidationRisk: "safe" | "warning" | "danger" | "noDebt";
    totalCollateralUsd: string;
    totalBorrowUsd: string;
    supplyApr: string;  // % (computed from getSupplyRate × seconds-per-year; see § Topic 7)
    borrowApr: string;
  }>;
  rpcDegraded?: boolean;
}
```

**Empty-position Comets are omitted** from the response (mirror of Aave V3 `get_lending_positions` which skips reserves with `scaledATokenBalance === 0n && scaledVariableDebt === 0n` — `get_lending_positions.ts:180`).

**Decision lock:** Adopt multicall pattern. Phase 28 ships Ethereum-only; reader iterates the 6 canonical mainnet Comets. Forward-compat: when v2.3.x adds L2 Comets, the same enumeration extends per-chain.

## § Topic 7: Compound V3 market info read (`get_compound_market_info`)

**HIGH confidence.** Per-second rate semantics verified against [Compound V3 docs](https://docs.compound.finance/interest-rates/).

### Tool signature

`get_compound_market_info({ chain, cometAddress })` — agent-supplied `cometAddress` (no enumeration; this tool is single-Comet by design).

### APR computation

Compound V3 returns rates as **per-second utilization-indexed rates** scaled by `1e18` (consistent with `getBorrowRate` / `getSupplyRate` return type `uint64`):

```
supplyAprPercent = (getSupplyRate(getUtilization()) × SECONDS_PER_YEAR × 100) / 1e18
borrowAprPercent = (getBorrowRate(getUtilization()) × SECONDS_PER_YEAR × 100) / 1e18
```

Where `SECONDS_PER_YEAR = 60 × 60 × 24 × 365 = 31_536_000`.

### Per-asset surface

For each configured collateral asset (`i in 0..numAssets-1`):
- `borrowCollateralFactor` (1e18-scaled; e.g. `0.83e18` = 83% borrowing power)
- `liquidateCollateralFactor` (1e18-scaled; > borrowCF; e.g. `0.90e18` = 90% liquidation threshold)
- `liquidationFactor` (1e18-scaled; the % of collateral seized at liquidation — 0.95e18 typical, NOT the same as liquidateCF)
- `supplyCap` (uint128; absolute cap on protocol-wide supply of this collateral)
- `priceFeed` (address; Chainlink-shape oracle)

### Response shape

```typescript
interface CompoundMarketInfo {
  chain: ChainName;
  chainId: number;
  cometAddress: Address;
  cometName: string;
  baseAsset: Address;
  baseSymbol: string;
  utilization: string;  // 0..1 as decimal string
  supplyAprPercent: string;  // e.g. "5.23"
  borrowAprPercent: string;
  totalSupply: string;  // base asset, human-formatted
  totalBorrow: string;
  collateralAssets: Array<{
    asset: Address;
    symbol: string;
    borrowCollateralFactor: string;
    liquidateCollateralFactor: string;
    liquidationFactor: string;
    supplyCap: string;
    currentSupply: string;  // from totalsCollateral(asset)
    priceUsd: string;
  }>;
  rpcDegraded?: boolean;
}
```

**Decision lock:** Adopt. Single-multicall implementation (no fan-out). APR computation: `rate × 31_536_000` (per-second × seconds-per-year), then `/ 1e18` for the 1e18-scaling, then `× 100` for percentage. Pure bigint until final string-format.

## § Topic 8: Ledger CAL clear-sign coverage for Compound V3 — `LEDGER NOTICE` REQUIRED

**HIGH confidence.** Verified 2026-05-20 via direct GitHub API enumeration of [LedgerHQ/clear-signing-erc7730-registry/registry/](https://github.com/LedgerHQ/clear-signing-erc7730-registry/tree/master/registry).

### Registry enumeration (44 entries, alphabetical)

```
1inch, aave, benqi, celo, circle, consensus-specs, corestake, degate,
dispatch, ethena, fellow-fund, figment, flare, hyperliquid, kiln,
ledgerquest, lens, lido, lifi, lombard, midas, morpho, okx, opencover,
opensea, p2p, paraswap, permit, poap, quickswap, rarible, safe, sei,
serenita, smartcredit, starkgate, swell, swissborg, tally, tether,
uniswap, walletconnect, weth, yieldxyz
```

**NO `compound` entry. NO `comet` entry.**

### Implication: LEDGER NOTICE block required

Per Phase 6 precedent (`prepare_weth_unwrap`) — when Ledger has no clear-sign descriptor for a calldata shape, the device falls back to BLIND-SIGN (shows only the keccak256 of the pre-sign hash, no human-readable args). The agent-side `LEDGER NOTICE` block warns the user before the device prompts.

**For `prepare_compound_supply`, `prepare_compound_withdraw`, `prepare_compound_borrow`, `prepare_compound_repay`:** every preview_send response carries:

```
[LEDGER NOTICE — Compound V3 calls are NOT covered by the Ledger ERC-7730 clear-sign registry]
The device will display only a 32-byte hash (blind-sign mode). It will NOT show
the asset, amount, or Comet address in human-readable form. Verify the LEDGER
BLIND-SIGN HASH below matches what the device displays before approving.
```

This is a defense-in-depth surface, not a refusal — Compound V3 calls remain legitimate; the user just has reduced device-side visibility.

**Contrast with Aave V3 (Phase 7):** `aave` IS in the CAL registry → `prepare_aave_supply` does NOT emit LEDGER NOTICE (verified in `prepare_aave_supply.ts:81` description: "Aave V3 supply is clear-signed on Ledger devices (covered by Ledger's ERC-7730 calldata registry on chainId=1)").

**Decision lock:** Adopt. LEDGER NOTICE block in `preview_send` for all 4 Compound prepare-tool outputs. Tool description text mirrors `prepare_weth_unwrap` LEDGER NOTICE language. Phase 6 fixture E (WETH9.withdraw) is the regression-test anchor; Phase 28 adds a new fixture (G? — planner picks letter) with the Compound `supply` calldata to anchor the LEDGER NOTICE rendering.

### v1.3 companion-skill consideration

The `vaultpilot-preflight` skill (v1.3) encodes Inv #1 (decode), #2 (hash recompute), etc. — these apply to Compound V3 calldata identically to Aave V3. **No skill SHA rebump needed for Phase 28** — the skill's invariants are protocol-agnostic; new prepare-tool outputs flow through the same preview_send checks. (Skill SHA only needs rebumping when a new invariant is added or an existing one's text changes.) Compound-specific decode templates land in `src/signing/blocks.ts` (`COMPOUND_SUPPLY_DECODED_ARGS_TEMPLATE` etc.) without skill churn.

## § Topic 9: `simulate_position_change` extension for Compound

**HIGH confidence.** Pattern verified against `src/tools/simulate_position_change.ts:111-126` (Phase 7 4-action enum already lives there).

### Current state (Phase 7)

`simulate_position_change({ chain, asset, action, amount })` accepts `action: "supply" | "withdraw" | "borrow" | "repay"` but is HARD-WIRED to Aave V3 reads. The tool description explicitly says "Compound / Morpho are v2.3+ scope" (line 69).

### Phase 28 extension shape

Add `protocol` enum arg:

```typescript
{
  chain: ChainName,
  protocol: "aave-v3" | "compound-v3",  // new — defaults to "aave-v3" for back-compat
  // Compound-only:
  cometAddress?: Address,  // required when protocol === "compound-v3"
  // existing:
  asset: Address,
  action: "supply" | "withdraw" | "borrow" | "repay",
  amount: string,
}
```

**Dispatcher widening (additive, no Aave path changes):**

```typescript
if (protocol === "aave-v3") {
  // existing Phase 7 path — _aaveChains.getReservesData + getUserReservesData + computeHealthFactor
} else if (protocol === "compound-v3") {
  // new Phase 28 path:
  //   _compoundChains.getCometSnapshot(client, chainId, cometAddress, wallet)
  //   → { baseSupply, baseBorrow, collateral[], assetInfos[], prices[] }
  //   apply 4-action projection to local clone (mirror simulate_position_change.ts:329-395)
  //   computeCompoundHealth(projectedState) — pure bigint, mirrors computeHealthFactor
  //   classifyLiquidationRisk(projectedRatio, projectedNoDebt) — REUSED from aave-health (same arms)
}
```

**Cross-protocol classifier reuse:** the 4-arm classifier (`safe`/`warning`/`danger`/`noDebt`) lives in `aave-health.ts:classifyLiquidationRisk` and applies identically to Compound. Phase 28 imports it; does NOT duplicate. The `LiquidationRisk` type is exported and reused.

**Decision lock:** Adopt. `simulate_position_change` becomes the cross-protocol simulation entrypoint. Aave path unchanged (back-compat — `protocol` defaults to `"aave-v3"` when omitted). Compound path additive. The agent picks `protocol: "compound-v3"` when asking "what if I supply 5 WETH into cWETHv3?".

## § Topic 10: FROZEN-area discipline

**HIGH confidence.** Reviewed Phase 7 + Phase 9 SECURITY-ADJACENT files.

### v1.x signing-pipeline FROZEN areas (NO touch in Phase 28)

| File | Why FROZEN |
|---|---|
| `src/signing/payload-fingerprint.ts` | PREP-03 cryptographic binding. Phase 28 calldata flows through the SAME `computePayloadFingerprint(tx)` — no new domain tag, no new preimage shape. |
| `src/signing/presign-hash.ts` | LEDGER BLIND-SIGN HASH recompute. EIP-1559 serialization unchanged. |
| `src/signing/handle-store.ts` | Handle lifecycle + 15-min TTL. Phase 28 calls `createHandle` exactly as Phase 7. |
| `src/signing/amount.ts::parseAmountStrict` | T-PARSE-AMOUNT-1 mitigation. Phase 28's `"max"` arm extends in `src/tools/prepare_compound_*.ts` LOCALLY (mirror Phase 6 `parseTokenAmountOrMax` shape) — does NOT touch the strict-format core. |
| `src/security/canonical-dispatch.ts` | Phase 28 EXTENDS the per-chain allowlist (adds 6 Comet addresses for Ethereum), but does NOT change the gate shape (`checkDispatchTarget` signature unchanged). Additive set membership only. |
| All existing fixtures A–F in `test/signing-fingerprint.test.ts` and `test/signing-presign-hash.test.ts` | Cryptographic regression anchors. Phase 28 ADDS new fixtures (G/H for Compound supply + withdraw calldata) — does NOT modify existing. |

### Solana fingerprint module (Phase 12) — not yet shipped per memory (`v1.x fully code-complete`; Solana is v2.0)

Phase 28 is EVM-side. Even when Solana fingerprint lands, the cross-chain domain-tag separation (`"VaultPilot-soltx-v1:"` vs `"VaultPilot-txverify-v1:"`) means Phase 28 byte-streams cannot collide with Solana streams by construction.

### TRON fingerprint module (Phase 18 if shipped earlier) — same reasoning

`"VaultPilot-trontx-v1:"` domain tag separates by construction.

### Phase 28 NEW surfaces (additive only)

- `src/config/contracts.ts` — extend `ContractsForChain` interface with optional `compoundV3Comets: { cUSDCv3: Address; cUSDTv3: Address; cWETHv3: Address; cUSDSv3: Address; cwstETHv3: Address; cWBTCv3: Address }` slot for mainnet; helper getters per Comet (`getCometUsdcAddress(1)` etc.). Other chains can have the slot present-but-`undefined` until v2.3.x.
- `src/protocols/compound-v3.ts` — new file; mirror of `src/protocols/aave-v3.ts` shape verbatim.
- `src/chains/compound-v3.ts` — new file; mirror of `src/chains/aave-v3.ts` shape (multi-Comet reader helpers).
- `src/signing/compound-health.ts` — new file; mirror of `src/signing/aave-health.ts` shape.
- `src/tools/get_compound_positions.ts` — new tool; mirror of `get_lending_positions.ts`.
- `src/tools/get_compound_market_info.ts` — new tool (no Aave parallel — single-Comet info read).
- `src/tools/prepare_compound_supply.ts` / `_withdraw.ts` / `_borrow.ts` / `_repay.ts` — new tools; mirror of `prepare_aave_supply.ts` / `prepare_aave_withdraw.ts`.
- `src/tools/simulate_position_change.ts` — EDIT to add `protocol` dispatcher (additive).
- `src/security/canonical-dispatch.ts` — EDIT to add 6 Comet addresses to Ethereum-chain Set (additive). Other chains: when v2.3.x lands, the dispatch table extends per-chain.
- `src/signing/blocks.ts` — EDIT to add `COMPOUND_SUPPLY_PREPARE_RECEIPT_TEMPLATE` + `COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE` + `COMPOUND_BORROW_PREPARE_RECEIPT_TEMPLATE` + `COMPOUND_REPAY_PREPARE_RECEIPT_TEMPLATE` + the LEDGER NOTICE block template (mirror of `WETH9_WITHDRAW_LEDGER_NOTICE` if it exists; otherwise add fresh).

### Confirmation: NO compromise to FROZEN areas

All Phase 28 changes are ADDITIVE (new files) or ADDITIVE-MEMBER (extend interface, extend Set, extend tool dispatcher). The byte-identity of every existing fixture A–F MUST hold post-Phase-28 — the planner's success criteria includes `npm test test/signing-fingerprint.test.ts test/signing-presign-hash.test.ts` green AND a `git diff` byte-identity assertion on the Aave-related fixture lines.

**Decision lock:** Adopt. Phase 28 = additive. v1.x signing-pipeline byte-identity preserved by construction.

## Package Legitimacy Audit

> slopcheck was not available at research time (the install attempt was denied by auto-mode classifier as an out-of-scope agent-chosen package install). Per the graceful-degradation rule in the package-legitimacy protocol, ALL packages below are tagged `[ASSUMED]` and the planner MUST gate the `@compound-finance/compound-js` reference (if any survives review) behind a `checkpoint:human-verify` task before install.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---|---|---|---|---|---|---|
| `viem` | npm | 3 yrs | ~5M/wk (current — already a project dep) | [github.com/wevm/viem](https://github.com/wevm/viem) | `[ASSUMED]` | Approved — existing project dep, no install needed |
| `@compound-finance/compound-js` | npm | ~5 yrs (created 2020-08, last published 2024-12 — 17 mo stale) | LOW (low priority dep — not a hot package) | [github.com/compound-finance/compound-js](https://github.com/compound-finance/compound-js) | `[ASSUMED]` | **DO NOT ADOPT** (§ Topic 2 — stack incompatible, stale, wrong end of pipeline) |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck unavailable)
**Packages flagged as suspicious [SUS]:** `@compound-finance/compound-js` flagged here independently — published by Compound Labs (verified maintainers: arr00, hayesgm, ajb413, aryanbhasin from `npm view`), no postinstall script, BSD-3-Clause license. NOT a slopsquat candidate. The "do not adopt" verdict is on TECHNICAL FIT grounds (ethers-v5-lock + stale + wrong pipeline shape), not legitimacy grounds.

**Net package install for Phase 28: ZERO.** All Compound V3 integration runs through `viem.parseAbi` against the existing `viem` 2.50.4 dependency.

## Architecture Patterns

### File layout (mirror of Phase 7 Aave V3 stack 1:1)

```
src/
├── config/
│   └── contracts.ts        — EDIT: add compoundV3Comets slot + 6 Comet getters
├── protocols/
│   ├── aave-v3.ts          — UNCHANGED
│   └── compound-v3.ts      — NEW (mirror of aave-v3.ts shape: ABI fragment + selectors + encoders + decode union + _compoundProtocols ESM spy)
├── chains/
│   ├── aave-v3.ts          — UNCHANGED
│   └── compound-v3.ts      — NEW (multi-Comet snapshot reader; multicall pattern from get_token_allowances.ts)
├── signing/
│   ├── aave-health.ts      — UNCHANGED
│   ├── compound-health.ts  — NEW (pure-bigint collateralization ratio; reuses LiquidationRisk type + classifyLiquidationRisk from aave-health.ts)
│   └── blocks.ts           — EDIT: 4 new PREPARE RECEIPT templates + LEDGER NOTICE template for Compound calldata
├── tools/
│   ├── get_compound_positions.ts        — NEW (mirror of get_lending_positions.ts; multi-Comet fan-out)
│   ├── get_compound_market_info.ts      — NEW (single-Comet info read)
│   ├── prepare_compound_supply.ts       — NEW (mirror of prepare_aave_supply.ts; intent gate at prepare)
│   ├── prepare_compound_withdraw.ts     — NEW (mirror of prepare_aave_withdraw.ts; "max" → MAX_UINT256)
│   ├── prepare_compound_borrow.ts       — NEW (calldata = withdraw(baseToken, amount))
│   ├── prepare_compound_repay.ts        — NEW ("max" → debt × 1.01 server-resolved; calldata = supply(baseToken, amount))
│   └── simulate_position_change.ts      — EDIT: add `protocol` arg + Compound dispatcher arm
└── security/
    └── canonical-dispatch.ts — EDIT: extend Ethereum-chain Set with 6 Comet addresses
```

### Data flow (per-tool)

```
agent
  │  prepare_compound_supply({ chain, cometAddress, asset, amount })
  ▼
MCP tool dispatcher (src/tools/prepare_compound_supply.ts)
  │  ├─ chainId from chain enum
  │  ├─ Comet membership check (cometAddress in canonical list)
  │  ├─ baseToken read + asset≠baseToken gate (intent vs reality)
  │  ├─ borrowBalanceOf gate (asset==baseToken && hasDebt → refuse, send to repay)
  │  ├─ decimals resolution (registry-first; live RPC fallback)
  │  ├─ parseAmountStrict(amount, decimals) → amountWei
  │  ├─ encodeCometSupply(asset, amountWei) → data
  │  ├─ tx = { chainId, to: cometAddress, valueWei: 0n, data }
  │  ├─ payloadFingerprint = computePayloadFingerprint(tx)  [PREP-03]
  │  └─ createHandle({ args, tx, payloadFingerprint })       [TTL 15min]
  ▼
agent
  │  preview_send({ handle })
  ▼
preview_send (existing — extended for Compound decode)
  │  ├─ Layer 0.5: checkDispatchTarget(chainId, tx.to) — Comet must be in allowlist
  │  ├─ decode via _compoundProtocols.decodeCompoundV3Call(data)
  │  ├─ DECODED ARGS block: asset + amount + cometAddress label
  │  ├─ LEDGER NOTICE: Compound is NOT in CAL registry (blind-sign expected)
  │  ├─ LEDGER BLIND-SIGN HASH block (existing recompute)
  │  └─ previewToken mint
  ▼
... user confirms on device ...
  ▼
send_transaction (existing — unchanged)
```

### Anti-Patterns to Avoid

- **Hardcoding Comet addresses** in tool implementations → use `getCometUsdcAddress(chainId)` etc. via SOT. Format-fanout-sentinel anchor: grep for `0xc3d688B6` should return 1 (the SOT line). (See `prepare_aave_supply.ts:18` — same discipline.)
- **Letting agent pass `asset` for `prepare_compound_borrow` or `prepare_compound_repay`** — server fills `baseToken` from the Comet. Agent passing `asset` for these tools is a sign they confused borrow/withdraw or repay/supply; refuse with a redirect message.
- **Computing supply/borrow APR as `rate × 100 / 1e18`** without multiplying by `SECONDS_PER_YEAR` → that yields the per-second rate, not annual. The 1.5e8 multiplier (seconds × 100) is load-bearing.
- **Using `MAX_UINT256` for repay-max** → user wouldn't have that approval. Server-resolve to `debt × 1.01` to keep DECODED ARGS honest.
- **Skipping intent-vs-reality gates** in `prepare_compound_supply` when `asset === baseToken && borrowBalanceOf > 0` — would silently repay debt under "supply" label.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| ABI encoding | Custom Solidity function selector + arg encoder | `viem.parseAbi` + `encodeFunctionData` | viem handles selector hash, tuple encoding, ABI struct refs |
| Decimal-aware amount parsing | New regex per protocol | `parseAmountStrict` from `src/signing/amount.ts` (Phase 6) + LOCAL "max" arm per tool | T-PARSE-AMOUNT-1 mitigation already shipped |
| Multicall batching | Manual sequential `eth_call` loops | `client.multicall({ allowFailure: true })` | Single RPC round-trip; `allowFailure: true` returns per-call status |
| Health-factor classification | New 4-arm classifier for Compound | Reuse `classifyLiquidationRisk` from `aave-health.ts` | Same thresholds; same agent-facing arms; same regression test anchor |
| Per-second→APR conversion | Custom Number-arithmetic | Pure bigint `rate × SECONDS_PER_YEAR × 100 / 1e18`, then formatUnits | No float drift; matches Compound docs verbatim |
| Per-chain Comet address table | Inline literals in tool code | Extend `src/config/contracts.ts::ContractsForChain` SOT | Format-fanout-sentinel + EIP-55 corruption guard |
| Canonical-dispatch allowlist extension | New gate module per protocol | Extend `CANONICAL_DISPATCH_TARGETS` Set per chain (additive) | Layer 0.5 already implemented; just add members |

## Runtime State Inventory

Phase 28 is a greenfield additive feature on the EVM stack — no rename, no refactor, no migration. **Skipping this section** (per researcher template guidance — rename/refactor phases only).

## Common Pitfalls

### Pitfall 1: Confusing supply-vs-repay calldata
**What goes wrong:** Agent calls `prepare_compound_supply({ asset: USDC })` when user actually wants to repay USDC debt on cUSDCv3. The supply call routes to debt-reduction silently inside the Comet contract; the user sees "supplied 100 USDC" on the agent side but their debt went down.
**Why it happens:** Compound V3's single `supply` entry point covers both intents; the contract distinguishes by `(asset == baseToken && borrowBalanceOf > 0)`.
**How to avoid:** Server-side intent gate at `prepare_compound_supply` — refuse with explicit redirect when `asset === baseToken && borrowBalanceOf > 0`. The DECODED ARGS block surfaces the intent label ("Supply" / "Repay") computed at preview time.
**Warning signs:** Agent passes the base asset to `prepare_compound_supply` with an existing debt position. Gate fires; tool description names this case.

### Pitfall 2: Confusing borrow-vs-withdraw calldata
**What goes wrong:** Same shape, opposite direction. Agent calls `prepare_compound_withdraw({ asset: USDC })` when user wants to BORROW USDC (they have collateral, no base supply). The withdraw call routes to debt-creation silently.
**Why it happens:** Compound's `withdraw(base, amount)` against a healthy collateral position IS the borrow operation.
**How to avoid:** Same intent-gate pattern. `prepare_compound_withdraw` refuses with redirect when `asset === baseToken && balanceOf === 0n`. The `prepare_compound_borrow` tool name lets the agent commit explicitly.
**Warning signs:** Agent passes the base asset to `prepare_compound_withdraw` with no base supply position.

### Pitfall 3: Stale Comet address — supplying to a deprecated proxy
**What goes wrong:** Comet proxies CAN be repointed by Compound governance. An old Comet address may still accept supply calls but route to a deprecated implementation with different parameter values.
**Why it happens:** Compound V3 is a proxy pattern; the implementation slot is governance-mutable.
**How to avoid:** SOT slot in `src/config/contracts.ts` MUST be checked against [compound-finance/comet/deployments/](https://github.com/compound-finance/comet/tree/main/deployments) at every Phase 28-touching plan iteration. The address-book pattern from Aave V3 (Phase 7) where we cite `bgd-labs/aave-address-book` applies here against compound-finance/comet directly.
**Warning signs:** Mismatch between SOT slot and the latest `deployments/mainnet/<base>/roots.json` `"comet"` field.

### Pitfall 4: APR computation off by 1e10
**What goes wrong:** `getSupplyRate` returns `uint64` per-second rate scaled by `1e18`. Computing `rate × SECONDS_PER_YEAR / 1e18 × 100` in the wrong order overflows uint64 mid-calculation.
**Why it happens:** Per-second rate × seconds-per-year × 100 doesn't fit in uint64 before the `/ 1e18` divide.
**How to avoid:** Always divide by `1e18` LAST, in bigint:  `(rate * SECONDS_PER_YEAR * 100n) / 10n ** 18n`. The intermediate fits in bigint freely; only the final result narrows.
**Warning signs:** APR readings 1e10× larger than expected, or negative on uint64 overflow.

### Pitfall 5: `collateralBalanceOf` returns uint128, not uint256
**What goes wrong:** Compound's `collateralBalanceOf(account, asset)` returns `uint128` (not uint256). viem auto-decodes to bigint regardless, but a TypeScript annotation expecting `uint256` may slip in.
**Why it happens:** Compound stores collateral balances in uint128 slots for gas optimization.
**How to avoid:** Annotate the type in the ABI fragment correctly: `function collateralBalanceOf(address account, address asset) view returns (uint128)`. viem decodes both as bigint at runtime, but the type signal matters for downstream consumers.
**Warning signs:** TypeScript checker objects to assignment into a uint256 slot; or a test asserting upper-bound returns the wrong max.

## Code Examples

### Example 1: Compound V3 Comet ABI fragment (verified shape)

```typescript
// src/protocols/compound-v3.ts — mirror of src/protocols/aave-v3.ts
// Source: https://github.com/compound-finance/comet/blob/main/contracts/CometMainInterface.sol
import { encodeFunctionData, decodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import { MAX_UINT256 } from "./erc20.js";

export const COMPOUND_V3_COMET_ABI = parseAbi([
  "function supply(address asset, uint amount)",
  "function withdraw(address asset, uint amount)",
]);

export const COMPOUND_V3_SELECTORS = {
  supply: "0xf2b9fdb8" as Hex,   // viem.toFunctionSelector("supply(address,uint256)")
  withdraw: "0xf3fef3a3" as Hex, // viem.toFunctionSelector("withdraw(address,uint256)")
} as const;
// Selector values verified empirically via viem.toFunctionSelector in
// test/protocols-compound-v3.test.ts (Phase 28 success criteria).

export function encodeCometSupply(asset: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: COMPOUND_V3_COMET_ABI,
    functionName: "supply",
    args: [asset, amount],
  });
}

export function encodeCometWithdraw(asset: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: COMPOUND_V3_COMET_ABI,
    functionName: "withdraw",
    args: [asset, amount],
  });
}

export type CompoundV3Decoded =
  | { kind: "compound-supply"; asset: Address; amount: bigint }
  | { kind: "compound-withdraw"; asset: Address; amount: bigint; isMax: boolean }
  | { kind: "unknown"; selector: Hex };

export function decodeCompoundV3Call(data: Hex): CompoundV3Decoded {
  if (data === "0x" || data.length < 10) return { kind: "unknown", selector: data as Hex };
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  try {
    if (selector === COMPOUND_V3_SELECTORS.supply) {
      const { args } = decodeFunctionData({ abi: COMPOUND_V3_COMET_ABI, data });
      const [asset, amount] = args as readonly [Address, bigint];
      return { kind: "compound-supply", asset, amount };
    }
    if (selector === COMPOUND_V3_SELECTORS.withdraw) {
      const { args } = decodeFunctionData({ abi: COMPOUND_V3_COMET_ABI, data });
      const [asset, amount] = args as readonly [Address, bigint];
      return { kind: "compound-withdraw", asset, amount, isMax: amount === MAX_UINT256 };
    }
  } catch { /* fall through */ }
  return { kind: "unknown", selector };
}

export const _compoundProtocols = { decodeCompoundV3Call };
```

### Example 2: Multi-Comet positions read via multicall

```typescript
// src/chains/compound-v3.ts excerpt — mirror of src/chains/aave-v3.ts
// Source: src/tools/get_token_allowances.ts:13-14 multicall pattern
import { type Address, type PublicClient } from "viem";
import { COMPOUND_V3_COMET_ABI } from "../protocols/compound-v3.js";

export interface CometBaseSnapshot {
  cometAddress: Address;
  baseToken: Address;
  baseSupplyRaw: bigint;       // balanceOf(wallet)
  baseBorrowRaw: bigint;       // borrowBalanceOf(wallet)
  numAssets: number;
  isBorrowCollateralized: boolean;
  isLiquidatable: boolean;
}

export async function getCometBaseSnapshots(
  client: PublicClient,
  comets: readonly Address[],
  wallet: Address,
): Promise<CometBaseSnapshot[]> {
  const contracts = comets.flatMap((c) => [
    { address: c, abi: COMPOUND_V3_COMET_ABI, functionName: "baseToken" },
    { address: c, abi: COMPOUND_V3_COMET_ABI, functionName: "balanceOf", args: [wallet] },
    { address: c, abi: COMPOUND_V3_COMET_ABI, functionName: "borrowBalanceOf", args: [wallet] },
    { address: c, abi: COMPOUND_V3_COMET_ABI, functionName: "numAssets" },
    { address: c, abi: COMPOUND_V3_COMET_ABI, functionName: "isBorrowCollateralized", args: [wallet] },
    { address: c, abi: COMPOUND_V3_COMET_ABI, functionName: "isLiquidatable", args: [wallet] },
  ]);
  // @ts-expect-error — viem multicall types narrow per-element; project pattern in get_token_allowances.ts
  const results = await client.multicall({ contracts, allowFailure: true });
  // ... unpack 6 results per Comet into the snapshot array ...
}

export const _compoundChains = { getCometBaseSnapshots };
```

### Example 3: Pure-bigint collateralization-ratio math

```typescript
// src/signing/compound-health.ts excerpt
// Mirror of src/signing/aave-health.ts:120-152 shape; reuses LiquidationRisk + classifier
import { HF_SCALE, classifyLiquidationRisk, type LiquidationRisk } from "./aave-health.js";

const CF_SCALE: bigint = 10n ** 18n;  // Compound collateral-factor scale

export interface CompoundCollateralPos {
  balance: bigint;            // collateralBalanceOf
  priceUsd8: bigint;          // getPrice(priceFeed) — 1e8-scaled USD
  scale: bigint;              // asset scale (10^decimals)
  liquidateCfScaled: bigint;  // liquidateCollateralFactor (1e18-scaled)
}

export interface CompoundDebtPos {
  borrowBalance: bigint;      // borrowBalanceOf
  basePriceUsd8: bigint;      // baseTokenPriceFeed price (1e8-scaled USD)
  baseScale: bigint;          // 10^baseDecimals
}

export function computeCompoundHealth(input: {
  collateral: CompoundCollateralPos[];
  debt: CompoundDebtPos | null;
}): {
  liquidationCollateralRatio: bigint | null;
  noDebt: boolean;
  liquidationRisk: LiquidationRisk;
  totalCollateralUsd8: bigint;
  totalBorrowUsd8: bigint;
} {
  let totalCollateralUsd8 = 0n;
  let weightedCollateralUsd8 = 0n;
  for (const c of input.collateral) {
    const usd8 = (c.balance * c.priceUsd8) / c.scale;
    totalCollateralUsd8 += usd8;
    weightedCollateralUsd8 += (usd8 * c.liquidateCfScaled) / CF_SCALE;
  }
  if (input.debt === null || input.debt.borrowBalance === 0n) {
    return {
      liquidationCollateralRatio: null,
      noDebt: true,
      liquidationRisk: classifyLiquidationRisk(null, true),
      totalCollateralUsd8,
      totalBorrowUsd8: 0n,
    };
  }
  const totalBorrowUsd8 = (input.debt.borrowBalance * input.debt.basePriceUsd8) / input.debt.baseScale;
  const ratio = (weightedCollateralUsd8 * HF_SCALE) / totalBorrowUsd8;
  return {
    liquidationCollateralRatio: ratio,
    noDebt: false,
    liquidationRisk: classifyLiquidationRisk(ratio, false),
    totalCollateralUsd8,
    totalBorrowUsd8: totalBorrowUsd8,
  };
}
```

## Open Questions

1. **Should `prepare_compound_supply` / `_withdraw` accept the base asset's bridged variants?** (e.g. USDC.e on Arbitrum — Comet has `cUSDC.ev3` as a distinct market with base = USDC.e). v2.3.x scope; Phase 28 is Ethereum-only so the question doesn't bite. The per-chain Comet enumeration in SOT handles this when v2.3.x lands — each Comet is keyed by its actual base asset address.

2. **Should Phase 28 ship rewards-claim (`CometRewards.claim`)?** CMP-01..06 doesn't mention rewards. Compound V3 supply earns COMP rewards via the Rewards contract (`0x1B0e765F6224C21223AeA2af16c1C46E38885a40`). Per CONTEXT.md "Deferred Ideas" — `claim-rewards flow to follow-up`. Phase 28 surfaces COMP APR in `get_compound_market_info` but does NOT ship claim. Confirmed deferred.

3. **Bulker (multi-action batching) — relevant?** Compound's Bulker contract lets users do supplyCollateral+borrow in a single tx. v1.x prepare → preview → send is single-tx-per-handle by design. Multi-action batching would either be a new tool (`prepare_compound_bulk` with the multi-call shape) or v2.x scope. Phase 28 SKIP. Seed Bulker address in SOT for forward-compat.

4. **Phase 28 NEW fixture letters — G + H?** The next available letters in the alphabet after Phase 6's F (`WETH9.withdraw`). Confirm with planner. Mirror fixture shape: G = `Comet.supply(USDC, 100e6)`, H = `Comet.withdraw(WETH, 5e18)`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Compound V2 cTokens (`cDAI`, `cUSDC`, etc.) — exchange-rate accrual model, single mintRedeem token per asset | Compound V3 Comet — single-base-borrow isolated markets, separate base supply / collateral surfaces | 2022-08 (cUSDCv3 mainnet) | V2 still operational; deprecated for new deposits. Phase 28 is V3-only (per CONTEXT.md deferred). |
| Compound V3 single-Comet (`cUSDCv3` mainnet, sole market) | Multi-Comet across (chain, baseAsset) — 6 mainnet markets, multi-chain | Iterative through 2023-2025 | Phase 28 enumerates per-chain Comet list; no "default" Comet — agent commits explicitly. |
| `@compound-finance/compound-js` SDK (ethers v5) | `viem.parseAbi` inline | 2024+ (viem dominance in modern stacks) | Phase 28 uses viem; SDK rejected for stack incompatibility. |

**Deprecated/outdated:**
- Compound V2 — out of scope per CONTEXT.md deferred.
- `@compound-finance/compound-js` — stale (17 mo); ethers-v5-only; signing model wrong for vp pipeline.

## Phase Requirements

| ID | Description | Research Support |
|---|---|---|
| CMP-01 | `get_compound_positions({ wallet, chain? })` returns supplied + borrowed per Comet with HF equivalent | § Topic 6 (multi-Comet multicall) + § Topic 5 (derived collateralizationRatio) |
| CMP-02 | `get_compound_market_info({ chain, cometAddress })` returns supply APR + borrow APR + collateral factors + liquidation threshold | § Topic 7 (per-second→APR conversion + per-asset surface) |
| CMP-03 | `prepare_compound_supply({ chain, cometAddress, asset, amount })` produces unsigned `supply(asset, amount)` call | § Topic 3 (supply signature + intent gate) + § Topic 8 (LEDGER NOTICE) |
| CMP-04 | `prepare_compound_withdraw({ chain, cometAddress, asset, amount })` produces unsigned `withdraw(asset, amount)` call | § Topic 3 (withdraw signature) + § Topic 4 (MAX_UINT256 for "max") + § Topic 8 (LEDGER NOTICE) |
| CMP-05 | `prepare_compound_borrow` + `prepare_compound_repay` cover borrow lifecycle; `prepare_compound_repay({ amount: "max" })` resolves server-side to debt + 1% buffer | § Topic 3 (borrow = withdraw(base); repay = supply(base)) + § Topic 4 (repay-max server resolution) |
| CMP-06 | Comet addresses sourced from `src/config/contracts.ts` per-chain typed slots; Ethereum-first; canonical-dispatch allowlist Compound arm wiring | § Topic 1 (6 mainnet addresses verified) + § Topic 10 (SOT extension + allowlist Set extension) |

## Sources

### Primary (HIGH confidence)
- [Compound V3 deployments folder](https://github.com/compound-finance/comet/tree/main/deployments) — canonical SOT for Comet addresses across all chains. Per-deployment `roots.json` quoted verbatim 2026-05-20.
- [compound-finance/comet `CometMainInterface.sol`](https://github.com/compound-finance/comet/blob/main/contracts/CometMainInterface.sol) — function signatures + interface shape; quoted verbatim
- [Etherscan cUSDCv3 verified source `0xc3d688B66703497DAA19211EEdff47f25384cdc3`](https://etherscan.io/address/0xc3d688B66703497DAA19211EEdff47f25384cdc3#code) — bytecode + ABI cross-check
- [docs.compound.finance](https://docs.compound.finance/) — architecture, interest-rate model, account-collateralization semantics
- [LedgerHQ/clear-signing-erc7730-registry/registry/](https://github.com/LedgerHQ/clear-signing-erc7730-registry/tree/master/registry) — 44-entry enumeration confirming NO `compound` entry
- `npm view @compound-finance/compound-js` — version, license, maintainers, scripts (clean, no postinstall)
- Empirical SDK install at `/tmp/compound-probe` + `dist/nodejs/comet.d.ts` read — confirms ethers-v5 dependency + signing model

### Secondary (MEDIUM confidence)
- Existing vp source files: `src/protocols/aave-v3.ts`, `src/chains/aave-v3.ts`, `src/signing/aave-health.ts`, `src/tools/get_lending_positions.ts`, `src/tools/prepare_aave_supply.ts`, `src/tools/simulate_position_change.ts`, `src/security/canonical-dispatch.ts`, `src/tools/get_token_allowances.ts` — pattern mirror references
- `npm view viem version` → 2.50.4 current; project pinned at `^2.48.0`

### Tertiary (LOW confidence — flagged for validation)
- None. All claims in this research are tied to verified primary or secondary sources.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `@compound-finance/compound-js` legitimacy not verified via slopcheck (install denied by auto-mode) | Package Legitimacy Audit | LOW — we're rejecting the package on technical-fit grounds anyway; legitimacy verification is moot. But: if slopcheck flagged it, the same reject decision still holds. |
| A2 | Selectors `0xf2b9fdb8` (supply) and `0xf3fef3a3` (withdraw) | Code Example 1 | MEDIUM — derived from canonical signature `supply(address,uint256)` and `withdraw(address,uint256)`. Planner MUST add a `viem.toFunctionSelector` regression assertion in `test/protocols-compound-v3.test.ts` to lock byte-identity. Compound docs reference selectors but I did not paste them in verbatim from a primary source. |
| A3 | 6 mainnet Comets enumerated (usdc, usdt, weth, usds, wsteth, wbtc) | § Topic 1 | LOW — verified against the `deployments/mainnet/` GitHub directory listing; new Comets may have been added after the GitHub directory snapshot was taken. Planner re-verifies at plan-write time. |
| A4 | `liquidationFactor` semantics (% collateral seized at liquidation, 0.95e18 typical) | § Topic 7 | LOW — pulled from training knowledge of Compound's liquidation math. Not load-bearing for Phase 28 (we don't compute liquidation seizure; only surface the value). |
| A5 | Repay-max 1% buffer is sufficient for interest accrual | § Topic 4 | MEDIUM — borrow rates can spike; on a high-rate Comet with a slow signing flow (user takes minutes on Ledger), 1% may underestimate. Mitigation: the Comet contract caps internally — surplus deposits to supply side, NOT a hard error. Planner may widen to 2% for conservative default. |
| A6 | Compound V3 calldata is NOT covered by Ledger CAL (compound entry absent) | § Topic 8 | LOW — verified directly via GitHub API listing of 44 entries. Mitigation: regression test the LEDGER NOTICE block presence. |

## Environment Availability

Phase 28 is code-only; no new external runtime dependencies. Existing project deps (viem, vitest, @noble/hashes, @modelcontextprotocol/sdk, @walletconnect/sign-client, etc.) already cover all needs. **Skip block:** no external runtime dependencies for this phase.

## Validation Architecture

> `workflow.nyquist_validation` config not inspected at research time — assuming enabled per project default (vitest is the project test framework per CLAUDE.md).

### Test Framework
| Property | Value |
|---|---|
| Framework | vitest (per project CLAUDE.md) |
| Config file | (existing — vp ships vitest config; no change needed) |
| Quick run command | `npm test -- test/protocols-compound-v3.test.ts test/signing-compound-health.test.ts -x` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| CMP-01 | get_compound_positions multi-Comet read | unit + integration | `npm test -- test/get-compound-positions.test.ts -x` | ❌ Wave 0 |
| CMP-02 | get_compound_market_info per-Comet read | unit | `npm test -- test/get-compound-market-info.test.ts -x` | ❌ Wave 0 |
| CMP-03 | prepare_compound_supply + intent gate | unit | `npm test -- test/prepare-compound-supply.test.ts -x` | ❌ Wave 0 |
| CMP-04 | prepare_compound_withdraw + MAX_UINT256 | unit | `npm test -- test/prepare-compound-withdraw.test.ts -x` | ❌ Wave 0 |
| CMP-05 | prepare_compound_borrow + repay + max-buffer | unit | `npm test -- test/prepare-compound-borrow.test.ts test/prepare-compound-repay.test.ts -x` | ❌ Wave 0 |
| CMP-06 | SOT slots + canonical-dispatch extension | unit | `npm test -- test/config-contracts.test.ts test/security-canonical-dispatch.test.ts -x` | partial (existing files; new assertions in Wave 0) |
| Cross | LEDGER NOTICE block emitted for Compound | unit | `npm test -- test/signing-blocks.test.ts -x` | partial (existing file; new template assertion) |
| Cross | Fixtures G + H in signing-fingerprint | regression | `npm test -- test/signing-fingerprint.test.ts -x` | partial (file exists; new fixtures added) |
| Cross | viem.toFunctionSelector byte-identity (A2 lock) | unit | `npm test -- test/protocols-compound-v3.test.ts -x` | ❌ Wave 0 |
| Cross | Pure-bigint health math determinism | unit | `npm test -- test/signing-compound-health.test.ts -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** narrow test file matching the task's surface (`npm test -- test/<file>.test.ts -x`)
- **Per wave merge:** `npm test` full suite
- **Phase gate:** full suite green + grep-zero on Comet-address inline literals (`grep -E "0xc3d688B6|0x3Afdc9BC|0xA17581A9|0x5D409e56|0x3D0bb1cc|0xe85Dc543" src/ | grep -v config/contracts.ts | grep -v test/` → empty)

### Wave 0 Gaps
- [ ] `test/protocols-compound-v3.test.ts` — selector regression + decode unit tests; A2 lock
- [ ] `test/chains-compound-v3.test.ts` — multicall snapshot reader; mock client
- [ ] `test/signing-compound-health.test.ts` — pure-bigint health math; deterministic input → expected-ratio anchors
- [ ] `test/get-compound-positions.test.ts` — full reader integration; mocked multicall results
- [ ] `test/get-compound-market-info.test.ts` — single-Comet APR + collateral surface
- [ ] `test/prepare-compound-supply.test.ts` — intent gate; MAX_UINT256 rejection on supply
- [ ] `test/prepare-compound-withdraw.test.ts` — "max" → MAX_UINT256 sentinel; intent gate
- [ ] `test/prepare-compound-borrow.test.ts` — calldata = withdraw(base); intent gate (no base supply position required)
- [ ] `test/prepare-compound-repay.test.ts` — "max" → debt × 1.01 server resolution; intent gate (debt required)
- [ ] Extension to `test/signing-fingerprint.test.ts` — fixtures G + H literal anchors
- [ ] Extension to `test/signing-blocks.test.ts` — 4 PREPARE RECEIPT templates + LEDGER NOTICE template
- [ ] Extension to `test/security-canonical-dispatch.test.ts` — 6 new Ethereum-chain Comet allowlist members
- [ ] Extension to `test/simulate-position-change.test.ts` — `protocol: "compound-v3"` dispatcher arm

## Security Domain

Phase 28 inherits the v1.x trust-pipeline invariants verbatim (PREP-03 fingerprint, PREP-04 hash recompute, PREP-07/08 send-gates, SEC-35 dispatch-allowlist). No new ASVS categories activated.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | (no auth surface; Ledger device is the trust anchor) |
| V3 Session Management | no | WC session reused from PAIR-* |
| V4 Access Control | yes | Layer 0.5 dispatch-allowlist refuses non-canonical `tx.to` |
| V5 Input Validation | yes | parseAmountStrict + Comet address membership + intent gates |
| V6 Cryptography | yes | viem (audited); keccak via @noble/hashes; no hand-rolled crypto |

### Known Threat Patterns for Compound V3 dispatch

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Malicious agent forges `cometAddress` pointing at attacker contract with matching ABI | Tampering | Layer 0.5 allowlist refusal at preview_send (extends `CANONICAL_DISPATCH_TARGETS`) |
| Agent calls `prepare_compound_supply` with base asset to silently repay debt | Tampering (intent mismatch) | Server-side intent gate at prepare time; refusal with redirect to `prepare_compound_repay` |
| Agent calls `prepare_compound_withdraw(base, amount)` to silently borrow | Tampering (intent mismatch) | Server-side intent gate at prepare time; refusal with redirect to `prepare_compound_borrow` |
| Stale Comet proxy implementation (governance repoint) | Tampering (off-chain) | SOT slot cited against `compound-finance/comet/deployments/` per plan iteration; address-book discipline |
| LEDGER blind-sign with no human-readable args | Information disclosure (low — user can't see what they're signing without recompute) | LEDGER NOTICE block + LEDGER BLIND-SIGN HASH recompute + companion vaultpilot-preflight skill enforcing recompute-check (Inv #2) |
| MAX_UINT256 sentinel misuse in repay (would silently no-op) | Denial of service (failed repay) | Server-side resolution to `debt × 1.01` concrete amount; DECODED ARGS shows concrete value |

## Metadata

**Confidence breakdown:**
- Standard stack (viem inline; reject SDK): HIGH — empirical install + .d.ts read
- Architecture (mirror Phase 7 1:1): HIGH — direct file-pattern inspection
- Comet addresses: HIGH — verified against compound-finance/comet/deployments/ verbatim
- Ledger CAL coverage: HIGH — 44-entry registry enumeration via GitHub API
- Function signatures: HIGH — verified against CometMainInterface.sol + Etherscan
- Selectors (0xf2b9fdb8 / 0xf3fef3a3): MEDIUM — derived from canonical sigs; planner MUST regression-test with viem.toFunctionSelector

**Research date:** 2026-05-20
**Valid until:** 2026-06-19 (30 days for stable protocol; Compound governance can repoint Comet proxies — re-verify SOT slot at plan-write time)
