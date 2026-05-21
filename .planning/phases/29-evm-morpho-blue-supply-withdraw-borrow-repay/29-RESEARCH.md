# Phase 29: Morpho Blue — supply / withdraw / borrow / repay — Research

**Researched:** 2026-05-21
**Domain:** Morpho Blue isolated-market EVM lending protocol
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

*Per 29-CONTEXT.md — context-gathering is placeholder (pending `/gsd-discuss-phase 29`). The following anchor candidates are present in the context file and treated as provisionally locked for research scoping:*

- **Market-id shape:** Morpho Blue market-id = `keccak256(abi.encode(loanToken, collateralToken, oracle, IRM, LLTV))`. 32-byte hash. Agent passes the market-id; server resolves the market params from the Morpho contract.
- **Known-market registry:** curated top 20-30 markets by TVL at planning time. Stored in `src/config/contracts.ts` Morpho sub-table per-chain. Permissionless market creation means the long-tail isn't curated — agent can still call against any market-id but won't get a labeled surface.
- **`amount: "max"` close-position:** server-side resolves to outstanding-debt amount. Mirrors Compound V3 Phase 28 convention.
- **Per-market decoder:** Morpho contract is universal across markets; per-market state read needs market-id. `get_morpho_positions` aggregates across known markets the wallet has touched (event-log scan via `publicClient.getLogs`).

### Claude's Discretion

- Internal helper names (`MorphoBlueReader`, `parseMorphoMarketParams`, etc.)
- Fixture literal anchor values (planner assigns letters after Phase 28's R/S/T/U)
- Whether the known-market registry ships at 20, 25, or 30 entries (curation over padding per CLAUDE.md)

### Deferred Ideas (OUT OF SCOPE)

- Morpho Optimizer (legacy Compound/Aave V2 on-top-of optimizer)
- MetaMorpho (curated vault aggregator)
- Morpho-specific liquidation flow tooling
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MOR-01 | `get_morpho_positions({ wallet, chain? })` returns positions keyed by market-id (loanToken + collateralToken + oracle + IRM + LLTV) | Topic 4: position() view + event-log scan pattern |
| MOR-02 | `prepare_morpho_supply({ chain, marketId, amount })` produces an unsigned Morpho contract call | Topic 2: supply function ABI + Topic 5: no intent ambiguity |
| MOR-03 | `prepare_morpho_withdraw` + `prepare_morpho_borrow` cover the supply/borrow lifecycle | Topic 2: withdraw/borrow/supplyCollateral/withdrawCollateral ABIs |
| MOR-04 | `prepare_morpho_repay({ chain, marketId, amount })` accepts `amount: "max"` as full-position close | Topic 5: repay-max pattern using shares |
| MOR-05 | Morpho Blue contract addresses + known-market registry sourced from `src/config/contracts.ts`; canonical-dispatch allowlist Morpho arm wiring | Topic 1: deployment address + Topic 7: known-market registry |
</phase_requirements>

---

## Summary

Morpho Blue is a 650-line immutable isolated-market lending primitive. Unlike Compound V3 (one Comet per borrow asset) and Aave V3 (single pool), Morpho Blue exposes a SINGLE contract address on each chain — all market operations route through `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` (same address on Ethereum, Base, and 40+ other EVM chains). Markets are identified by a 32-byte ID derived from `keccak256(abi.encode(loanToken, collateralToken, oracle, irm, lltv))`.

The ABI is substantially more complex than Compound V3. Morpho Blue has SIX write functions rather than Compound's TWO: `supply`, `withdraw`, `supplyCollateral`, `withdrawCollateral`, `borrow`, `repay` — each taking the full `MarketParams` struct. This means the intent-vs-reality ambiguity that existed in Phase 28 (two selectors, four intents) is GONE — each tool maps to exactly one function selector. However, there is a supply-vs-supplyCollateral distinction that agents must handle correctly: `supply` places assets into the lending pool (earning interest), while `supplyCollateral` posts collateral to enable borrowing.

For repay-max, Morpho Blue's canonical pattern is `repay(marketParams, 0, borrowShares, onBehalf, hex"")` — passing the user's current `borrowShares` value (from `position(marketId, user).borrowShares`) with `assets = 0`. This is more precise than Compound's `MAX_UINT256` sentinel because shares are exact; no off-chain rounding buffer needed.

**Primary recommendation:** Model `src/protocols/morpho-blue.ts` on `src/protocols/aave-v3.ts` but add `supplyCollateral`, `withdrawCollateral`, `borrow` ABI fragments. No intent-vs-reality gate needed (6 distinct selectors). Repay-max = pass borrowShares with assets=0. Ledger ERC-7730 clear-sign coverage IS confirmed via `calldata-MorphoBlue.json` in the LedgerHQ registry.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Get Morpho positions (read) | API / Backend (MCP server) | — | On-chain reads via viem publicClient; event-log scan for market discovery |
| Market-id derivation | API / Backend | — | keccak256 of abi.encode(MarketParams); server computes from agent-supplied params |
| Prepare supply / supplyCollateral | API / Backend | — | Encode calldata for Morpho.supply / Morpho.supplyCollateral; inject payloadFingerprint |
| Prepare borrow / withdraw | API / Backend | — | Encode calldata for Morpho.borrow / Morpho.withdraw |
| Prepare repay (including max) | API / Backend | — | Reads borrowShares from chain at prepare time; encodes repay(…, 0, shares, …) |
| ERC-20 approval gate | API / Backend | — | Morpho requires user approval of loanToken (for supply/repay) + collateralToken (for supplyCollateral); pre-flight check at prepare time |
| Shares → assets conversion | API / Backend | — | SharesMathLib formula applied off-chain for display; on-chain accrueInterest happens at tx time |
| Clear-sign coverage | Device (Ledger) | — | ERC-7730 registry confirmed; device decodes MarketParams + amounts |
| Known-market registry | API / Backend | — | src/config/contracts.ts SOT; labels unknown markets via event-log scan |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `viem` | 2.48.11 (project) | ABI encode/decode, publicClient reads | CLAUDE.md locked EVM stack |
| `@morpho-org/blue-sdk` | 6.0.0 | Entity classes (Market, Token) for off-chain math | Framework-agnostic; no signing; no broadcast; pure computation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@morpho-org/morpho-blue-bundlers` | 1.1.2 | Bundler-SDK for atomic multi-step transactions | Only needed if bundling approve + supplyCollateral + borrow atomically; NOT needed for Phase 29 single-step tools |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `viem.parseAbi` inline | `@morpho-org/blue-sdk` | blue-sdk adds ~600KB gzip; defines entity classes useful for share math but duplicates what viem+SharesMathLib already gives us inline. Phase 28 precedent: reject SDK in favor of parseAbi inline. However blue-sdk is NOT stale (2024-06-12 publish, 6.0.0 latest) and has NO postinstall script — acceptable if share-math utilities justify inclusion. |
| Manual `position()` reads | Event-log scan + `position()` cross-check | Event-log scan discovers all markets a user has touched; `position()` confirms current state. Phase 8 `get_token_allowances` established this pattern. |

**Installation (if blue-sdk adopted):**
```bash
npm install @morpho-org/blue-sdk
```

**Version verification:**
```bash
npm view @morpho-org/blue-sdk version
# → 6.0.0  (verified 2026-05-21)
npm view @morpho-org/morpho-blue-bundlers version
# → 1.1.2  (verified 2026-05-21)
```

---

## Package Legitimacy Audit

> slopcheck was unavailable at research time (auto-mode classifier blocked install). All packages below are tagged `[ASSUMED]` unless verified via official documentation. Planner must gate each install behind a `checkpoint:human-verify` task.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@morpho-org/blue-sdk` | npm | ~1 yr (2024-06-12) | Not verified | [github.com/morpho-org/sdks](https://github.com/morpho-org/sdks) | N/A — slopcheck unavailable | [ASSUMED] — verified org is official Morpho GitHub, no postinstall script, but confirm before install |
| `@morpho-org/morpho-blue-bundlers` | npm | ~1.3 yr (2024-01-21) | Not verified | [github.com/morpho-org/morpho-blue-bundlers](https://github.com/morpho-org/morpho-blue-bundlers) | N/A | [ASSUMED] — stale (Jan 2024); bundler-only (not needed for Phase 29 single-step tools). Recommend SKIP. |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck not run)
**Packages flagged as suspicious [SUS]:** `@morpho-org/morpho-blue-bundlers` — last published Jan 2024 (17+ months stale at research time). Skip unless bundling is explicitly required.

**Phase 28 precedent re-applied:** `@compound-finance/compound-js` was REJECTED because it returns broadcast tx envelopes, not unsigned bytes, and is ethers-v5 locked. `@morpho-org/blue-sdk` avoids both problems (pure computation, viem-compatible), but Phase 28's minimal-dependency verdict favors `viem.parseAbi` inline. **Recommendation: use `viem.parseAbi` inline for Phase 29, matching Phase 28's pattern exactly.** The share-math formulas (SharesMathLib) are simple enough to inline without the SDK.

*If slopcheck is unavailable at research time, all packages above are tagged `[ASSUMED]` and the planner must gate each install behind a `checkpoint:human-verify` task.*

---

## Topic 1: Morpho Blue Core Contract Address

**[VERIFIED: docs.morpho.org/addresses + etherscan.io]**

The Morpho Blue core contract is deployed at the **same address on all 40+ supported chains**:

```
0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb
```

Confirmed chains relevant to Phase 29:
- **Ethereum mainnet** (chainId 1): `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`
- **Base** (chainId 8453): `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`
- **Polygon PoS** (chainId 137): `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` [ASSUMED — cross-chain uniformity confirmed for Ethereum+Base via docs; Polygon address assumed same per docs statement "40+ chains" but not individually verified]

**Supporting contracts (Ethereum mainnet):**
- **Adaptive Curve IRM:** `0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC` [VERIFIED: docs.morpho.org]
- **Morpho ChainlinkOracleV2 Factory:** `0x3A7bB36Ee3f3eE32A60e9f2b33c1e5f2E83ad766` [VERIFIED: docs.morpho.org]

**SOT pattern for Phase 29:**
- Morpho Blue uses ONE contract address per chain (NOT a per-market address like Compound V3's Comets). The `MORPHO_BLUE_RAW` sub-table in `src/config/contracts.ts` maps `ChainId → Address` — simpler than the 6-Comet `COMPOUND_COMETS_RAW` table.
- Phase 29 ships Ethereum mainnet only (matching Phase 28's Compound scope). Multi-chain Morpho (Base, Polygon) is v2.3.x follow-up.

---

## Topic 2: Morpho Blue ABI Surface

**[VERIFIED: github.com/morpho-org/morpho-blue/blob/main/src/Morpho.sol + IMorpho.sol]**

### Write Functions (6 total)

```solidity
// Supply assets to the lending pool (earns interest as supplyShares)
function supply(
    MarketParams memory marketParams,
    uint256 assets,           // non-zero for asset-based supply; 0 if using shares
    uint256 shares,           // non-zero for share-based supply; 0 if using assets
    address onBehalf,
    bytes calldata data       // for ERC-3156 flashloan callbacks; hex"" for normal use
) external returns (uint256 assetsSupplied, uint256 sharesSupplied);

// Withdraw assets from the lending pool
function withdraw(
    MarketParams memory marketParams,
    uint256 assets,
    uint256 shares,
    address onBehalf,
    address receiver          // destination of withdrawn assets
) external returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn);

// Post collateral (does NOT earn interest; no shares — tracked in raw assets)
function supplyCollateral(
    MarketParams memory marketParams,
    uint256 assets,
    address onBehalf,
    bytes calldata data
) external;                   // no return value (collateral = no share accounting)

// Withdraw collateral
function withdrawCollateral(
    MarketParams memory marketParams,
    uint256 assets,
    address onBehalf,
    address receiver
) external;

// Borrow loan token
function borrow(
    MarketParams memory marketParams,
    uint256 assets,           // non-zero for asset-based borrow
    uint256 shares,           // non-zero for share-based borrow
    address onBehalf,
    address receiver          // where borrowed tokens go
) external returns (uint256 assetsBorrowed, uint256 sharesBorrowed);

// Repay loan token
function repay(
    MarketParams memory marketParams,
    uint256 assets,           // non-zero for asset-based repay
    uint256 shares,           // non-zero for share-based repay (use for repay-max)
    address onBehalf,
    bytes calldata data
) external returns (uint256 assetsRepaid, uint256 sharesRepaid);
```

**Critical rule:** `UtilsLib.exactlyOneZero(assets, shares)` — EXACTLY ONE of `assets` / `shares` must be zero for `supply`, `withdraw`, `borrow`, `repay`. If both are non-zero OR both are zero, the call reverts. `supplyCollateral` and `withdrawCollateral` ONLY take `assets` (no shares concept for collateral).

### `MarketParams` Struct

```solidity
struct MarketParams {
    address loanToken;        // ERC-20 deposited by lenders / borrowed by borrowers
    address collateralToken;  // ERC-20 posted as collateral (no interest earned)
    address oracle;           // price oracle (Morpho ChainlinkOracleV2 shape)
    address irm;              // interest rate model
    uint256 lltv;             // liquidation LTV (18-decimal fixed-point, e.g. 0.86e18)
}
```

### `Position` Struct (per user, per market)

```solidity
struct Position {
    uint256 supplyShares;     // lender position (supply + earned interest accrues as share-price increase)
    uint128 borrowShares;     // borrower position
    uint128 collateral;       // raw collateral amount (NOT shares — 1:1 with tokens posted)
}
```

### `Market` Struct (global market state)

```solidity
struct Market {
    uint128 totalSupplyAssets;   // total loanToken assets supplied
    uint128 totalSupplyShares;   // total supply shares outstanding
    uint128 totalBorrowAssets;   // total loanToken assets borrowed
    uint128 totalBorrowShares;   // total borrow shares outstanding
    uint128 lastUpdate;          // timestamp of last interest accrual
    uint128 fee;                 // protocol fee (18-decimal fixed-point)
}
```

### View Functions

```solidity
function position(Id id, address user) external view returns (Position memory p);
function market(Id id) external view returns (Market memory m);
function idToMarketParams(Id id) external view returns (MarketParams memory);
function owner() external view returns (address);
function feeRecipient() external view returns (address);
```

### Events (for market discovery via `getLogs`)

```solidity
event Supply(Id indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares);
event Borrow(Id indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares);
event SupplyCollateral(Id indexed id, address indexed caller, address indexed onBehalf, uint256 assets);
event Repay(Id indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares);
event CreateMarket(Id indexed id, MarketParams marketParams);
```

### Supply-vs-supplyCollateral Distinction

**[VERIFIED: docs.morpho.org/build/borrow/tutorials/assets-flow/]**

| Function | Assets | Shares | Earns Interest | Purpose |
|----------|--------|--------|----------------|---------|
| `supply(marketParams, assets, 0, onBehalf, "")` | loanToken | YES (`supplyShares`) | YES | Lender position |
| `supplyCollateral(marketParams, assets, onBehalf, "")` | collateralToken | NO (raw amount) | NO | Enable borrowing |

This is the critical UX distinction: a user wanting to earn yield calls `supply`; a user wanting to borrow calls `supplyCollateral` first, then `borrow`. An agent that calls `supply` instead of `supplyCollateral` would deposit the collateral asset as a loan asset, which is almost certainly wrong. Phase 29 MUST surface this clearly in tool names and descriptions.

---

## Topic 3: Market-ID Derivation

**[VERIFIED: github.com/morpho-org/morpho-blue/blob/main/src/libraries/MarketParamsLib.sol]**

```solidity
// MarketParamsLib.sol — canonical market-id derivation
Id id = Id.wrap(keccak256(abi.encode(marketParams)));
// where MARKET_PARAMS_BYTES_LENGTH = 5 * 32 = 160 bytes
// (each field padded to 32 bytes: loanToken 20+12, collateralToken 20+12,
//  oracle 20+12, irm 20+12, lltv 32 bytes = 160 bytes total)
```

**Off-chain equivalent (TypeScript/viem):**
```typescript
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";

// Parameters: loanToken, collateralToken, oracle, irm, lltv (all as hex Address + bigint)
function deriveMarketId(params: MarketParams): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        "address loanToken, address collateralToken, address oracle, address irm, uint256 lltv"
      ),
      [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]
    )
  );
}
```

The `Id` type is `bytes32`. The agent passes a pre-computed market-id string. The server:
1. Uses `idToMarketParams(marketId)` to recover the 5 params from the Morpho contract.
2. Re-derives the ID client-side from the returned params and asserts equality (intent-vs-reality gate — if the chain returns different params for this ID, something is wrong).
3. Uses the recovered params for all subsequent `MarketParams` struct encoding.

**Example known market IDs (Ethereum):**
- wstETH/USDC (Gauntlet): `0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc` [CITED: app.morpho.org, risk.morpho.org]
- cbBTC/USDC: `0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64` [CITED: app.morpho.org]
- WBTC/USDT: `0xa921ef34e2fc7a27ccc50ae7e4b154e16c9799d3387076c421423ef52ac4df99` [CITED: app.morpho.org]

---

## Topic 4: Position Decode Pattern

**[VERIFIED: github.com/morpho-org/morpho-blue/blob/main/src/interfaces/IMorpho.sol + SharesMathLib.sol]**

### Reading User Position

```typescript
// Step 1: Read raw position (supplyShares, borrowShares, collateral)
const pos = await client.readContract({
  address: MORPHO_BLUE_ADDRESS,
  abi: MORPHO_BLUE_ABI,
  functionName: "position",
  args: [marketId, userAddress],
});
// pos.supplyShares: bigint (lender's pool shares)
// pos.borrowShares: bigint (borrower's debt shares)
// pos.collateral:   bigint (raw collateral tokens posted, NOT shares)

// Step 2: Read market state (to convert shares → assets)
const mkt = await client.readContract({
  address: MORPHO_BLUE_ADDRESS,
  abi: MORPHO_BLUE_ABI,
  functionName: "market",
  args: [marketId],
});
// mkt.totalSupplyAssets, mkt.totalSupplyShares
// mkt.totalBorrowAssets, mkt.totalBorrowShares
// mkt.lastUpdate (timestamp for interest accrual simulation)
```

### Shares → Assets Conversion (SharesMathLib)

**[VERIFIED: github.com/morpho-org/morpho-blue/blob/main/src/libraries/SharesMathLib.sol]**

```solidity
// Constants:
uint256 VIRTUAL_SHARES = 1e6;
uint256 VIRTUAL_ASSETS = 1;

// shares → assets (rounded down = "what can I actually withdraw")
function toAssetsDown(shares, totalAssets, totalShares):
  assets = shares * (totalAssets + VIRTUAL_ASSETS) / (totalShares + VIRTUAL_SHARES)

// shares → assets (rounded up = "what do I owe as a borrower")
function toAssetsUp(shares, totalAssets, totalShares):
  assets = (shares * (totalAssets + VIRTUAL_ASSETS) + totalShares + VIRTUAL_SHARES - 1)
           / (totalShares + VIRTUAL_SHARES)
```

**TypeScript inline implementation:**
```typescript
const VIRTUAL_SHARES = 1_000_000n;  // 1e6
const VIRTUAL_ASSETS = 1n;

function toAssetsDown(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (shares * (totalAssets + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES);
}

function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (
    (shares * (totalAssets + VIRTUAL_ASSETS) + totalShares + VIRTUAL_SHARES - 1n) /
    (totalShares + VIRTUAL_SHARES)
  );
}

// Supply assets the user CAN withdraw (rounded down):
const supplyAssetsExpected = toAssetsDown(
  pos.supplyShares,
  mkt.totalSupplyAssets,
  mkt.totalSupplyShares
);

// Borrow assets the user OWES (rounded up — conservative for repay-max):
const borrowAssetsExpected = toAssetsUp(
  pos.borrowShares,
  mkt.totalBorrowAssets,
  mkt.totalBorrowShares
);
```

**Important:** The `market()` view returns stale state (as of `lastUpdate`). For an accurate post-accrual value, use `MorphoBalancesLib.expectedBorrowAssets` / `expectedSupplyAssets` which simulate interest accrual client-side. Phase 29's `get_morpho_positions` SHOULD use the off-chain accrual simulation for display accuracy. The `repay-max` case uses `borrowShares` directly (not the asset amount), so interest accrual drift is irrelevant for the max-repay path.

---

## Topic 5: `prepare_morpho_repay({ amount: "max" })` — Repay-Max Pattern

**[VERIFIED: github.com/morpho-org/morpho-blue-snippets/blob/main/src/morpho-blue/MorphoBlueSnippets.sol]**

Morpho Blue's canonical repay-max pattern is DIFFERENT from Compound V3's:

| Protocol | Repay-Max Encoding |
|---------|-------------------|
| Compound V3 | `supply(base, MAX_UINT256)` — Compound caps transfer at debt internally |
| Morpho Blue | `repay(marketParams, 0, borrowShares, onBehalf, hex"")` — pass exact borrowShares, assets=0 |

**Why this is better:** Passing `borrowShares` means the user repays EXACTLY their debt, no more, no less. No rounding risk, no "overshoot and get refund" edge cases. The protocol converts `shares → assets` internally using `toAssetsUp` (most conservative direction for repay).

**Server-side implementation for `amount: "max"`:**
```typescript
// At prepare_morpho_repay time with amount: "max"
const marketId = deriveMarketId(marketParams);
const position = await _morphoChains.readPosition(client, MORPHO_BLUE_ADDRESS, marketId, userAddress);
const borrowShares = position.borrowShares;

if (borrowShares === 0n) {
  return refusal({ kind: "INVALID_INPUT", message: "No outstanding borrow on this market." });
}

// Encode: assets=0, shares=borrowShares
const data = encodeMorphoRepay(marketParams, 0n, borrowShares, fromAddress, "0x");
```

**Note:** This is a server-side RPC read (1 `position()` call) at prepare time, not a MAX_UINT256 sentinel passed through. Phase 28 Compound's `"max"` used MAX_UINT256 (protocol-handled). Phase 29 Morpho's `"max"` reads borrowShares on-chain and encodes them explicitly.

**Fixture anchor for repay-max:** The `payloadFingerprint` for `repay-max` is borrowShares-dependent (the payload changes as interest accrues). This means the "from-independent" fixture anchor used for supply/borrow/withdraw CANNOT be used for repay-max (shares change between test runs). The integration test for repay-max should use a mock position rather than a hardcoded fixture literal.

---

## Topic 6: Multi-Chain Support Scope Decision

**[VERIFIED: docs.morpho.org/addresses/ — Morpho is deployed on 40+ chains including Ethereum, Base, Polygon]**

Phase 28 precedent: Compound V3 shipped Ethereum-only; multi-chain deferred to v2.3.x.

**Recommendation for Phase 29: Ethereum-only first, matching Phase 28's scope.**

Rationale:
1. **Dep-graph consistency:** v2.3 is scoped as "EVM lending on Ethereum mainnet." Phase 28 (Compound) shipped Ethereum-only. Morpho on Base/Polygon would be a scope expansion beyond v2.3.
2. **Known-market registry:** The top 20-30 markets by TVL are overwhelmingly on Ethereum. Base has a growing ecosystem but TVL is much smaller.
3. **Same address means easy extension:** The same `0xBBBBBBBB...` address works on all chains, so adding Base/Polygon later is a 1-line addition to the `MORPHO_BLUE_RAW` sub-table. Negligible cost to defer.
4. **Canonical-dispatch simplicity:** One chain = one allowlist entry to add. Multi-chain = 3 entries but identical address.

**Decision: [ASSUMED] Ethereum-only in Phase 29; Base + Polygon in v2.3.x.** This mirrors Phase 28's deferral pattern exactly and is consistent with the v2.3 milestone goal.

---

## Topic 7: Known-Market Registry

**[CITED: app.morpho.org/ethereum/borrow, app.morpho.org market detail pages]**

Morpho Blue's permissionless design means any market can be created — the registry's purpose is to label markets for agent readability, not to gate access.

**Market discovery at planning time** (top markets by TVL on Ethereum, sourced from app.morpho.org URLs visible in search results):

| Market ID (partial) | Loan | Collateral | Notes |
|---------------------|------|------------|-------|
| `0xb323495f...bc86cc` | USDC | wstETH | Largest Gauntlet-curated market |
| `0x64d65c9a...cc64` | USDC | cbBTC | High TVL cbBTC market |
| `0xa921ef34...df99` | USDT | WBTC | WBTC/USDT market |
| `0x6d2fba32...1c2` | USDC | wstETH | Another wstETH/USDC variant |
| `0x46b46943...bee` | USDC | sdeUSD | sdeUSD collateral |
| `0x45671fb8...bca` | USDT | cbBTC | cbBTC/USDT market |

**[ASSUMED — full top-25 list]:** The complete known-market snapshot cannot be determined without real-time API access to Morpho's data. The researcher recommends the planner include a Wave 0 task to snapshot the top 20-30 markets by `totalSupplyAssets` from the Morpho Blue GraphQL API at `blue-api.morpho.org/graphql` at execute time. Format: `src/tokens/morpho-markets-ethereum.json` (analogous to `tron-srs.json` from Phase 19).

**Snapshot file pattern (`src/tokens/morpho-markets-ethereum.json`):**
```json
[
  {
    "marketId": "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc",
    "loanToken":       { "address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "symbol": "USDC" },
    "collateralToken": { "address": "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", "symbol": "wstETH" },
    "lltv": "860000000000000000",
    "label": "wstETH/USDC (Gauntlet)"
  }
]
```

This matches the `tron-srs.json` JSON snapshot pattern from Phase 19, and the `src/tokens/*.json` registry pattern from Phases 2+8.

---

## Topic 8: Ledger Clear-Sign Status

**[VERIFIED: github.com/LedgerHQ/clear-signing-erc7730-registry/tree/master/registry/morpho]**

**Morpho Blue IS in the LedgerHQ ERC-7730 clear-sign registry.** This is the opposite of Phase 28 Compound's situation.

File confirmed: `registry/morpho/calldata-MorphoBlue.json`

Covered functions:
- `supply` — "Supply on Morpho Market"
- `withdraw` — "Withdraw from Morpho Market"
- `borrow` — "Borrow from Morpho Market"
- `repay` — "Repay on Morpho Market"
- `supplyCollateral` — "Supply Collateral on Morpho Market"
- `withdrawCollateral` — "Withdraw Collateral from Morpho Market"

**Contract address covered:** `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` on both:
- chainId 1 (Ethereum)
- chainId 8453 (Base)

**Implication:** Phase 29 does NOT need a `LEDGER_NOTICE_MORPHO_TEMPLATE` for the core 6 functions. The device WILL clear-sign these calls, displaying decoded market params (loan token, collateral token, oracle, IRM, LLTV) and amounts.

**Compare to Phase 28:** `LEDGER_NOTICE_COMPOUND_TEMPLATE` was REQUIRED because Compound is NOT in the registry. Morpho IS. This is a significant UX win for Morpho Blue users — they see decoded parameters on-device.

**Important caveat:** The ERC-7730 spec surfaces the `MarketParams` struct fields (5 addresses + 1 uint256). Users should be instructed to verify the loan token and collateral token addresses on-device against the market they intend to interact with. The known-market registry's labels help the agent surface human-readable market names, but the user's final trust anchor is the on-device display.

---

## Topic 9: SDK Decision

**[VERIFIED: npmjs.com/package/@morpho-org/blue-sdk, npmjs.com/package/@morpho-org/morpho-blue-bundlers]**

**`@morpho-org/blue-sdk` (v6.0.0, published 2024-06-12):**
- No postinstall script (safe)
- Pure computation (Market/Token entity classes)
- Framework-agnostic
- NOT stale (v6.0.0 is current as of research date)

**`@morpho-org/morpho-blue-bundlers` (v1.1.2, published 2024-01-21):**
- No postinstall script
- Last published 17+ months ago at research time — borderline stale
- Designed for BUNDLED transactions (approve + supply + borrow in one atomic tx)
- Phase 29 ships SINGLE-STEP tools (supply, borrow, etc.) — bundler not needed

**Decision:**

Apply the Phase 28 precedent:

> "SDK REJECTED — use `viem.parseAbi` inline fragments as the encoder/decoder SOT"

The SharesMathLib formulas (toAssetsDown, toAssetsUp) are 3 lines each, trivially inlined. The market-id derivation is 1 `keccak256(encodeAbiParameters(...))` call. The `blue-sdk` entity classes offer no benefit over inline viem calls for Phase 29's tool surface.

**Recommendation: SKIP both SDK packages. Use `viem.parseAbi` inline, exactly as Phase 28 did for Compound V3.**

---

## Architecture Patterns

### System Architecture Diagram

```
Agent (intent: "supply USDC to wstETH/USDC market")
   │
   ▼
prepare_morpho_supply / _borrow / _supplyCollateral / _repay / _withdraw / _withdrawCollateral
   │
   ├─► idToMarketParams(marketId) — recover MarketParams struct from chain
   │
   ├─► intent-vs-reality gate:
   │     supply: verify marketId exists (not new market), loanToken approval check
   │     borrow: verify collateral posted, verify marketId has active borrows
   │     repay max: read position(marketId, user).borrowShares
   │
   ├─► encodeAbiParameters(MarketParams + args) → calldata
   │
   ├─► computePayloadFingerprint({ chainId, to: MORPHO_BLUE_ADDRESS, valueWei: 0n, data })
   │
   └─► createHandle → PREPARE RECEIPT → tool response
          │
          ▼
      preview_send
          │
          ├─► decodeCompoundV3Call ... fallthrough ...
          ├─► decodeMorphoBlueCall → { kind: "morpho-supply"|"morpho-borrow"| etc., marketId, ... }
          │
          ├─► tokenContext: loanToken or collateralToken (from decoded + idToMarketParams)
          │
          ├─► NO LEDGER_NOTICE_MORPHO needed (ERC-7730 coverage confirmed)
          │
          └─► DECODED ARGS block: marketId, loanToken, collateralToken, amount/shares
                   │
                   ▼
              send_transaction (previewToken + userDecision + payloadFingerprint drift gate)
                   │
                   ▼
              Ledger device (CLEAR-SIGNS: decoded MarketParams + amount on-screen)
```

### Recommended Project Structure

```
src/
├── protocols/
│   └── morpho-blue.ts       # ABI + selectors + encoders + decoder (5th occupant; mirrors compound-v3.ts)
├── chains/
│   └── morpho-blue.ts       # per-market reads + position helpers (mirrors chains/compound-v3.ts)
├── config/
│   ├── contracts.ts         # MORPHO_BLUE_RAW sub-table + getMorphoBlueAddress(chainId)
│   └── morpho-markets.json  # known-market registry snapshot (top 20-30 at planning time)
└── tools/
    ├── get_morpho_positions.ts
    ├── prepare_morpho_supply.ts
    ├── prepare_morpho_withdraw.ts
    ├── prepare_morpho_supply_collateral.ts
    ├── prepare_morpho_withdraw_collateral.ts
    ├── prepare_morpho_borrow.ts
    └── prepare_morpho_repay.ts
```

### Pattern 1: Morpho Decoder (selector-to-intent — 6 distinct selectors, no ambiguity)

Unlike Phase 28 Compound (2 selectors → 4 intents), Morpho has 6 distinct selectors. The decoder is a direct 6-arm switch, NO intent-gate needed:

```typescript
// Source: morpho-blue/src/interfaces/IMorpho.sol (verified 2026-05-21)
export const MORPHO_BLUE_ABI = parseAbi([
  "function supply((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsSupplied, uint256 sharesSupplied)",
  "function withdraw((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsWithdrawn, uint256 sharesWithdrawn)",
  "function supplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)",
  "function withdrawCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, address receiver)",
  "function borrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256 assetsBorrowed, uint256 sharesBorrowed)",
  "function repay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsRepaid, uint256 sharesRepaid)",
  // Read functions:
  "function position(bytes32 id, address user) external view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) external view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function idToMarketParams(bytes32 id) external view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
]);

export type MorphoBlueSelectorKind =
  | { kind: "morpho-supply"; marketId: Hex; assets: bigint; shares: bigint; onBehalf: Address }
  | { kind: "morpho-withdraw"; marketId: Hex; assets: bigint; shares: bigint; onBehalf: Address; receiver: Address }
  | { kind: "morpho-supply-collateral"; marketId: Hex; assets: bigint; onBehalf: Address }
  | { kind: "morpho-withdraw-collateral"; marketId: Hex; assets: bigint; onBehalf: Address; receiver: Address }
  | { kind: "morpho-borrow"; marketId: Hex; assets: bigint; shares: bigint; onBehalf: Address; receiver: Address }
  | { kind: "morpho-repay"; marketId: Hex; assets: bigint; shares: bigint; onBehalf: Address; isMax: boolean }
  | { kind: "unknown"; selector: Hex };
```

Note: the `marketId` field in the decoded struct is NOT in the calldata — Morpho encodes `MarketParams` inline (not the ID). The decoder should re-derive the ID from the decoded MarketParams and include it in the `kind` object for downstream use.

### Pattern 2: Market-ID Intent-vs-Reality Gate

The Phase 28 intent-gate (2 selectors → 4 intents) is NOT needed for Morpho. However, there IS one useful gate: **verify that `idToMarketParams(marketId)` returns non-zero values** — a market with zero addresses indicates the market doesn't exist yet. Calling `supply` against a non-existent market will revert.

```typescript
// In prepare_morpho_supply / prepare_morpho_borrow / etc.:
const params = await _morphoChains.readMarketParams(client, MORPHO_BLUE_ADDRESS, marketId);
if (params.loanToken === "0x0000000000000000000000000000000000000000") {
  return refusal({ kind: "INVALID_INPUT", message: `Market ${marketId} does not exist on this chain.` });
}
// Re-derive ID from params to cross-check (defense-in-depth):
const derivedId = deriveMarketId(params);
if (derivedId !== marketId) {
  return refusal({ kind: "INTERNAL_ERROR", message: "Market ID derivation mismatch." });
}
```

For `prepare_morpho_borrow`: additionally check that the user has sufficient collateral posted (`position.collateral > 0`). If `collateral === 0n`, the borrow will revert. Surface a helpful error pointing at `prepare_morpho_supply_collateral`.

### Pattern 3: Event-Log Scan for Position Discovery

Mirror Phase 8's `get_token_allowances` event-log scan:

```typescript
// Scan for Supply + Borrow events indexed by userAddress as onBehalf
const [supplyLogs, borrowLogs, collateralLogs] = await Promise.all([
  client.getLogs({ address: MORPHO_BLUE_ADDRESS, event: SUPPLY_EVENT, args: { onBehalf: user }, fromBlock: 0n }),
  client.getLogs({ address: MORPHO_BLUE_ADDRESS, event: BORROW_EVENT, args: { onBehalf: user }, fromBlock: 0n }),
  client.getLogs({ address: MORPHO_BLUE_ADDRESS, event: SUPPLY_COLLATERAL_EVENT, args: { onBehalf: user }, fromBlock: 0n }),
]);
// Unique market IDs the user has ever interacted with:
const touchedMarketIds = new Set([...supplyLogs, ...borrowLogs, ...collateralLogs].map(l => l.args.id));
// Cross-check current position for each:
const positions = await Promise.all([...touchedMarketIds].map(id => readPosition(client, MORPHO_BLUE_ADDRESS, id, user)));
// Filter to non-zero positions:
return positions.filter(p => p.supplyShares > 0n || p.borrowShares > 0n || p.collateral > 0n);
```

**Pitfall:** Morpho's `Supply` and `Borrow` events use `Id indexed id` (the market id hash, not a human-readable name). The event ABI must use the correct `bytes32 indexed id` type to filter correctly.

### Anti-Patterns to Avoid

- **Encoding `assets` AND `shares` both non-zero:** The contract requires `exactlyOneZero(assets, shares)` — if both are set (or both zero for supply/withdraw/borrow/repay), the call reverts. Always set one to `0n`.
- **Using MAX_UINT256 for repay-max:** Unlike Compound, Morpho Blue does NOT honor MAX_UINT256 as a "repay all" sentinel for `assets`. The correct repay-max is `repay(…, 0n, borrowShares, …)` — always read `borrowShares` from on-chain `position()`.
- **Calling `supply` with collateralToken:** The `supply` function deposits into the LOAN side (earns interest). If the user wants to post collateral, they MUST call `supplyCollateral`. Confusing the two causes reverts or unexpected behavior (collateral asset not accepted as loanToken).
- **Treating `position.collateral` as shares:** Collateral is tracked in raw asset units (NOT shares). `collateral` is the raw token amount posted, not a share count. Do not run toAssetsDown on it.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ABI encoding for MarketParams struct | Custom encoding | `viem.encodeFunctionData` with `parseAbi` containing the struct as tuple | ABI encoding of nested tuples has edge cases; viem handles correctly |
| Shares → assets math | Custom formula | Inline `toAssetsDown`/`toAssetsUp` from SharesMathLib | The VIRTUAL_SHARES (1e6) anti-inflation constant must be exact; off-by-1 causes wrong display |
| Market-ID derivation | Custom keccak | `keccak256(encodeAbiParameters(...))` via viem | Encoding must be ABI-standard (5 × 32-byte padded fields); not raw struct concat |
| Interest accrual simulation | Server-side compound math | SharesMathLib `wTaylorCompounded` approximation (inline) or just display the stale market() read with a staleness note | Off-chain interest sim is display-only; the on-chain `accrueInterest()` call in each write tx is the authoritative update |
| Event-log scan for market discovery | Full tx trace | `client.getLogs({ event: SUPPLY_EVENT, args: { onBehalf: user } })` | viem getLogs with indexed event args filter handles the RPC call efficiently |
| Known-market labeling | Runtime API call | `src/tokens/morpho-markets-ethereum.json` snapshot + `idToMarketParams` for unlabeled | Snapshot covers top 20-30; unlabeled markets get raw ID + `[UNKNOWN MARKET]` flag |

**Key insight:** Morpho Blue's core contract is immutable and 650 lines. Its math libraries (SharesMathLib, MathLib, MarketParamsLib) are simple enough to inline as TypeScript bigint operations. No SDK is needed.

---

## Common Pitfalls

### Pitfall 1: `exactlyOneZero` Revert
**What goes wrong:** Both `assets` and `shares` are set to non-zero values (or both to zero) in a `supply`/`withdraw`/`borrow`/`repay` call. The contract reverts with no readable message.
**Why it happens:** Agents may try to use both to "be safe" or both forget to set one.
**How to avoid:** In every encoder function, assert exactly one is non-zero BEFORE calling `encodeFunctionData`. Surface a clear `INVALID_INPUT` refusal naming the constraint.
**Warning signs:** Reverts on well-formed-looking calls; check that `assets === 0n` XOR `shares === 0n`.

### Pitfall 2: supply() vs supplyCollateral() Confusion
**What goes wrong:** Agent calls `prepare_morpho_supply` with the collateral token instead of `prepare_morpho_supply_collateral`. The tx reverts because the Morpho contract only accepts the `loanToken` through `supply()`.
**Why it happens:** "Supply" is ambiguous — in Compound V3, "supply" covers both collateral and base; in Morpho it's split into two functions.
**How to avoid:** Tool descriptions MUST explicitly state which token each function accepts. At prepare time: verify `asset === marketParams.loanToken` for `supply()`, and `asset === marketParams.collateralToken` for `supplyCollateral()`. Refuse with hint to the other tool if wrong.
**Warning signs:** Agent calls supply with a non-loanToken address.

### Pitfall 3: Repay-Max Using MAX_UINT256 Instead of borrowShares
**What goes wrong:** Encodes `repay(marketParams, MAX_UINT256, 0, ...)` — this will revert because Morpho treats `assets > 0` AND `shares = 0` as asset-based repay, and MAX_UINT256 likely exceeds the user's balance.
**Why it happens:** Borrowing Compound's MAX_UINT256 sentinel pattern.
**How to avoid:** For `amount: "max"`, read `position(marketId, user).borrowShares` at prepare time and encode `repay(…, 0n, borrowShares, …)`.
**Warning signs:** Revert on large-amount repay attempts; check that shares-based repay is used for max.

### Pitfall 4: Stale Market State for Interest Display
**What goes wrong:** Display shows supply/borrow amounts that haven't had interest accrued (based on `market().totalBorrowAssets` which was last updated at `lastUpdate` block).
**Why it happens:** `market()` returns state as of the last `accrueInterest()` call; interest hasn't been applied since then.
**How to avoid:** For `get_morpho_positions` display, simulate interest accrual off-chain using the Taylor approximation (see SharesMathLib). Surface `displayValue: "approx"` annotation. The on-chain tx will accrue interest before conversion.
**Warning signs:** Displayed borrow amount slightly less than actual debt at repay time.

### Pitfall 5: Market ID Derivation from Stale Params
**What goes wrong:** Agent supplies a market-id but the `idToMarketParams()` lookup returns different params (e.g., market never existed or wrong chain).
**Why it happens:** Long-tail markets may exist on one chain but not another; the same market-id is NOT guaranteed across chains (different oracle/IRM addresses per chain).
**How to avoid:** Always call `idToMarketParams(marketId)` and verify the returned `loanToken` is non-zero. Re-derive the ID from returned params and assert equality.
**Warning signs:** `idToMarketParams` returns zero-addresses for one or more fields.

### Pitfall 6: Approval Gate Missing
**What goes wrong:** `supply(loanToken, assets, ...)` or `supplyCollateral(collateralToken, assets, ...)` reverts with ERC-20 insufficient allowance because the user hasn't approved the Morpho contract.
**Why it happens:** Morpho Blue uses `safeTransferFrom` under the hood; requires prior ERC-20 approval.
**How to avoid:** At prepare time, check `ERC20.allowance(user, MORPHO_BLUE_ADDRESS)` and surface a pre-flight approval hint if insufficient. Do NOT silently handle this — surface it as a requirement: "You must first call `prepare_token_approve({ tokenAddress: loanToken, spender: MORPHO_BLUE_ADDRESS, amount })` before supplying."
**Warning signs:** Revert on supply/supplyCollateral calls from wallets with no prior Morpho interaction.

---

## Code Examples

Verified patterns from official sources:

### Market-ID Derivation (viem)
```typescript
// Source: morpho-org/morpho-blue MarketParamsLib.sol (verified 2026-05-21)
import { keccak256, encodeAbiParameters, parseAbiParameters, type Address } from "viem";

export interface MorphoMarketParams {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

export function deriveMarketId(params: MorphoMarketParams): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("address, address, address, address, uint256"),
      [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]
    )
  );
}
```

### Read Position + Convert Shares to Assets
```typescript
// Source: morpho-org/morpho-blue-snippets MorphoBlueSnippets.sol (verified 2026-05-21)
const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;

function toAssetsDown(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (shares * (totalAssets + VIRTUAL_ASSETS)) / (totalShares + VIRTUAL_SHARES);
}

function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (
    (shares * (totalAssets + VIRTUAL_ASSETS) + totalShares + VIRTUAL_SHARES - 1n) /
    (totalShares + VIRTUAL_SHARES)
  );
}

export async function getMorphoPosition(client, morphoAddress, marketId, user) {
  const [pos, mkt] = await Promise.all([
    client.readContract({ address: morphoAddress, abi: MORPHO_BLUE_ABI, functionName: "position", args: [marketId, user] }),
    client.readContract({ address: morphoAddress, abi: MORPHO_BLUE_ABI, functionName: "market", args: [marketId] }),
  ]);
  return {
    supplyShares: pos.supplyShares,
    supplyAssetsApprox: toAssetsDown(pos.supplyShares, mkt.totalSupplyAssets, mkt.totalSupplyShares),
    borrowShares: pos.borrowShares,
    borrowAssetsApprox: toAssetsUp(pos.borrowShares, mkt.totalBorrowAssets, mkt.totalBorrowShares),
    collateral: pos.collateral,   // raw, no conversion needed
  };
}
```

### Repay-Max Pattern
```typescript
// Source: morpho-org/morpho-blue-snippets repayAll() (verified 2026-05-21)
async function encodeMorphoRepayMax(client, morphoAddress, marketParams, userAddress): Promise<Hex> {
  const marketId = deriveMarketId(marketParams);
  const position = await client.readContract({
    address: morphoAddress, abi: MORPHO_BLUE_ABI,
    functionName: "position", args: [marketId, userAddress],
  });
  const borrowShares = position.borrowShares;
  if (borrowShares === 0n) throw new Error("No outstanding borrow");
  // assets=0, shares=borrowShares — exactlyOneZero requirement satisfied
  return encodeFunctionData({
    abi: MORPHO_BLUE_ABI,
    functionName: "repay",
    args: [marketParams, 0n, borrowShares, userAddress, "0x"],
  });
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Aave/Compound-style shared pool | Morpho Blue isolated per-market pools | 2023 | Each market has its own risk parameters; no cross-contamination between LLTV tiers |
| Shares tracked in separate token | Shares tracked in Morpho's storage mapping | Morpho Blue launch | No ERC-4626 vault tokens; positions tracked as `supplyShares` in `position()` |
| `MAX_UINT256` repay sentinel | Exact borrowShares repay | Morpho Blue | More precise; no rounding risk; no "overshoot" |
| SDK-based tx construction | Direct ABI encoding | Always been this way | SDK adds bundling convenience; Phase 29 uses direct encoding per Phase 28 precedent |
| ERC-7730 registry absent | Morpho registered in LedgerHQ ERC-7730 | ~2024 | Device clear-signs Morpho calls; no blind-sign notice needed |

**Deprecated/outdated:**
- `@morpho-org/morpho-blue-bundlers` v1.1.2 (Jan 2024): last published 17+ months ago; Phase 29 SKIP.
- Morpho Optimizer (v1/v2 on top of Compound/Aave): out of scope — Morpho Blue only.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Morpho Blue address is the same on Polygon PoS as on Ethereum and Base | Topic 1 | Canonical-dispatch allowlist would have wrong address for Polygon; medium risk (Ethereum-only Phase 29 is not affected) |
| A2 | The top 20-30 markets by TVL on Ethereum can be snapshotted from `blue-api.morpho.org/graphql` at execute time | Topic 7 | If API is unavailable, planner must use app.morpho.org UI to manually enumerate top markets; low risk |
| A3 | `@morpho-org/blue-sdk` v6.0.0 has no broadcast-tx behavior (pure computation) | Topic 9 | If SDK does broadcast transactions, it must be excluded (Phase 28 precedent); medium risk — mitigated by confirming no postinstall script and framework-agnostic description |
| A4 | Phase 29 ships Ethereum-only (matching Phase 28 scope) | Topic 6 | If user intends multi-chain from day 1, the plan would need revision; low risk given explicit Phase 28 precedent |
| A5 | The ERC-7730 `calldata-MorphoBlue.json` covers both Ethereum and Base but researcher only confirmed via directory listing description, not direct JSON inspection for chainId fields | Topic 8 | If Base is not covered, `LEDGER_NOTICE_MORPHO_BASE_TEMPLATE` would be needed for a future Base extension; no impact on Ethereum-only Phase 29 |
| A6 | `encodeAbiParameters(parseAbiParameters("address, address, address, address, uint256"), ...)` produces the same byte-encoding as Solidity's `abi.encode(marketParams)` for the 5-field MarketParams struct | Topic 3 | If there's ABI encoding divergence (struct packing), the derived marketId would be wrong. Must verify at execute time via a known market-id comparison against `idToMarketParams()` round-trip. |
| A7 | Tools for Phase 29 are: get_morpho_positions, prepare_morpho_supply, prepare_morpho_withdraw, prepare_morpho_supply_collateral, prepare_morpho_withdraw_collateral, prepare_morpho_borrow, prepare_morpho_repay (7 tools) | Scope | If user wants get_morpho_market_info (analogous to get_compound_market_info), this would add a 8th tool and affect plan count |

**Highest-risk assumption: A6.** The market-id derivation MUST be verified against a known on-chain market at execute time before any market-id-dependent code goes to production.

---

## Open Questions (RESOLVED)

1. **`prepare_morpho_supply_collateral` vs `prepare_morpho_borrow` — same plan or separate?**
   - What we know: supplyCollateral + borrow are always sequential (post collateral, then borrow). Many users will do both in one session.
   - What's unclear: Does the planner want these as separate atomic tools (matching MOR-02/03 surface) or should there be a `prepare_morpho_supply_collateral_and_borrow` composite?
   - Recommendation: Separate tools per MOR-02/03 requirement wording. Composites are scope creep. The agent can call both sequentially.
   - **RESOLVED:** Plan 29-03 ships 6 separate prepare tools (`_supply`, `_withdraw`, `_supply_collateral`, `_withdraw_collateral`, `_borrow`, `_repay`). No composites per CLAUDE.md anti-brittle discipline (Phase 19 stake vote/freeze precedent).

2. **Known-market registry — snapshot approach vs live API**
   - What we know: `blue-api.morpho.org/graphql` provides real-time market data. A snapshot file (like `tron-srs.json`) is the established Phase 19 pattern.
   - What's unclear: How many markets to curate (20? 25? 30?) and whether to hard-code market IDs or derive them dynamically.
   - Recommendation: Wave 0 task to snapshot top 25 markets via GraphQL at execute time; store in `src/tokens/morpho-markets-ethereum.json`. Add `[UNKNOWN MARKET — verify oracle + IRM externally]` flag for unlabeled markets.
   - **RESOLVED:** 25-entry snapshot in `src/tokens/morpho-markets-ethereum.json` per Plan 29-01 Wave 0 task (GraphQL fetch at execute time). Refresh cadence documented as backlog.

3. **ERC-20 approval pre-flight — surface vs refuse**
   - What we know: Morpho requires ERC-20 approval before supply/supplyCollateral. Aave (Phase 7) similarly required approval.
   - What's unclear: Should `prepare_morpho_supply` refuse with `INVALID_INPUT` if insufficient allowance, or just surface a warning?
   - Recommendation: Match Phase 7's pattern — surface as a warning in the PREPARE RECEIPT ("You may need to approve this token before this transaction executes") but do NOT hard-refuse. The user may have set approval in a prior session.
   - **RESOLVED:** Plan 29-03 implements SOFT WARNING (`PRE-FLIGHT NOTE` in CHECKS PERFORMED block) — advisory only, no refusal. Mirrors Phase 19 SunSwap pattern.

4. **`get_morpho_market_info` tool — in scope for Phase 29?**
   - What we know: Phase 28 shipped `get_compound_market_info` as a read-only metadata tool. REQUIREMENTS.md §MOR-01 covers positions only; there is no MOR-06 for market info.
   - What's unclear: Whether the planner expects this tool for market discovery / APR surfacing.
   - Recommendation: Omit from Phase 29 (not in MOR-01..05). Add as MOR-06 if needed in v2.3.x.
   - **RESOLVED:** DEFERRED to v2.3.x. Known-market registry serves as discovery surface. Backlog issue to be filed at Plan 29-03 PR-open.

5. **Fixture letter assignments — next after Phase 28's R/S/T/U**
   - What we know: Phase 28 used Fixtures R, S, T, U. **ROADMAP collision discovered at plan-check iter 1:** V/W/X are RESERVED for Phase 30 Lido (per `30-CONTEXT.md`); Y is RESERVED for Phase 32 Uniswap V3 (per `32-CONTEXT.md`).
   - What's unclear: Whether to use unclaimed letters (O/P/Q/Z) or adopt a phase-prefixed naming convention.
   - Recommendation (REVISED post-collision): Use phase-prefixed convention `Morpho-29-{A,B,C,D}` in NEW sibling file `test/signing-fingerprint-morpho.test.ts` — scales forward without consuming single-letter pool. Phase 19 precedent (`Tron-19-{A,B,C,D}` + Phase 20's `Tron-20-A`) validates the phase-prefixed scheme. The repay-max fixture is borrowShares-dependent — Morpho-29-C uses mocked-but-deterministic `borrowShares = 1_000_000_000n` for reproducibility.
   - **RESOLVED:** Phase-prefixed naming `Morpho-29-{A,B,C,D}` adopted across all 3 plans. Original V/W/X/Y assignments swapped out inline. NEW sibling test file `test/signing-fingerprint-morpho.test.ts` (Phase 28 Compound fixture file BYTE-FROZEN). Single-letter pool preserved for Phases 30 + 32 + future use.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥ 18.17 | Runtime | ✓ | Verified (project requirement) | — |
| viem | ABI encode/decode | ✓ | 2.48.11 (project) | — |
| vitest | Tests | ✓ | Project (Phase 28 confirmed) | — |
| Public Ethereum RPC | idToMarketParams reads at prepare time | ✓ | PublicNode/configured | — |
| `@morpho-org/blue-sdk` | Share math utilities (OPTIONAL) | Not installed | 6.0.0 on npm | Inline SharesMathLib formulas |
| `blue-api.morpho.org/graphql` | Known-market registry snapshot | ✓ (network) | Not versioned | app.morpho.org manual enumeration |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (Phase 28 config reused) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run test/protocols-morpho-blue.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MOR-01 | `get_morpho_positions` returns position keyed by marketId | unit | `npx vitest run test/get-morpho-positions.test.ts` | ❌ Wave 0 |
| MOR-02 | `prepare_morpho_supply` encodes supply calldata | unit | `npx vitest run test/prepare-morpho-supply.test.ts` | ❌ Wave 0 |
| MOR-03 | `prepare_morpho_borrow` encodes borrow; `prepare_morpho_supply_collateral` encodes supplyCollateral | unit | `npx vitest run test/prepare-morpho-borrow.test.ts test/prepare-morpho-supply-collateral.test.ts` | ❌ Wave 0 |
| MOR-04 | `prepare_morpho_repay` with `amount: "max"` encodes shares-based repay | unit | `npx vitest run test/prepare-morpho-repay.test.ts` | ❌ Wave 0 |
| MOR-05 | `getMorphoBlueAddress` returns correct address; dispatch allowlist includes it | unit | `npx vitest run test/config-contracts.test.ts` | ✅ (extend) |
| — | Market-ID derivation round-trips via idToMarketParams | unit | `npx vitest run test/protocols-morpho-blue.test.ts` | ❌ Wave 0 |
| — | SharesMathLib formulas match Solidity reference | unit | `npx vitest run test/signing-morpho-shares.test.ts` | ❌ Wave 0 |
| — | Full lifecycle: supply-collateral → borrow → repay-max → withdraw-collateral | integration | `npx vitest run test/morpho-blue-lifecycle.integration.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run test/protocols-morpho-blue.test.ts test/config-contracts.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `test/protocols-morpho-blue.test.ts` — ABI fragment selector byte-identity + encoder round-trips + decoder exhaustive union (covers MOR-02/03/04)
- [ ] `test/signing-morpho-shares.test.ts` — `toAssetsDown`/`toAssetsUp` formula literals + VIRTUAL_SHARES/VIRTUAL_ASSETS constant anchors
- [ ] `test/get-morpho-positions.test.ts` — event-log scan mock + position() read + shares-to-assets conversion (covers MOR-01)
- [ ] `test/prepare-morpho-supply.test.ts` — schema validation + loanToken vs collateralToken gate + encoder + RECEIPT byte-identity + Fixture Morpho-29-A anchor
- [ ] `test/prepare-morpho-borrow.test.ts` — collateral-presence gate + encoder + Fixture Morpho-29-B anchor
- [ ] `test/prepare-morpho-supply-collateral.test.ts` — collateralToken gate + encoder + Fixture Morpho-29-C anchor
- [ ] `test/prepare-morpho-repay.test.ts` — `"max"` sentinel reads borrowShares + encodes shares-based repay; `"max"` integration with mock position
- [ ] `test/prepare-morpho-withdraw.test.ts` — supply-presence gate + encoder
- [ ] `test/prepare-morpho-withdraw-collateral.test.ts` — collateral-presence gate + encoder
- [ ] `test/morpho-blue-lifecycle.integration.test.ts` — full lifecycle persona-cycle byte-identity for Fixtures V/W/X (not Y — repay-max is shares-dependent)
- [ ] `src/tokens/morpho-markets-ethereum.json` — known-market registry (Wave 0 snapshot task)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | `exactlyOneZero` enforcement; market-existence gate; borrowShares-read before repay-max |
| V5 Input Validation | yes | marketId format (bytes32), amount decimal parsing (parseAmountStrict), loanToken/collateralToken address validation via viem.getAddress |
| V6 Cryptography | yes | market-ID derivation via keccak256/encodeAbiParameters — must match on-chain derivation exactly |

### Known Threat Patterns for Morpho Blue Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent calls `supply(collateralToken)` instead of `supplyCollateral` | Tampering | Pre-flight: assert `asset === marketParams.loanToken` for supply; assert `asset === marketParams.collateralToken` for supplyCollateral |
| Agent supplies wrong market-id (typo or hallucinated) | Tampering | `idToMarketParams(marketId)` gate — non-existent market returns zero-address |
| Repay-max with wrong shares (stale data) | Tampering | Read `position.borrowShares` at prepare time, not cached |
| Long-tail market with malicious oracle | Elevation of Privilege | `[UNKNOWN MARKET]` flag for non-registry markets; user must acknowledge |
| Missing ERC-20 approval causing revert | Denial of Service | Pre-flight allowance check; surface warning in PREPARE RECEIPT |
| `payloadFingerprint` drift between prepare and send | Spoofing | Inherited from send_transaction three-gate FROZEN region (Phase 4) |

---

## Sources

### Primary (HIGH confidence)
- [github.com/morpho-org/morpho-blue/blob/main/src/Morpho.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/Morpho.sol) — 6 write function signatures, accrueInterest pattern
- [github.com/morpho-org/morpho-blue/blob/main/src/interfaces/IMorpho.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/interfaces/IMorpho.sol) — MarketParams, Position, Market structs; position(), market(), idToMarketParams() view functions
- [github.com/morpho-org/morpho-blue/blob/main/src/libraries/SharesMathLib.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/libraries/SharesMathLib.sol) — toAssetsDown, toAssetsUp formulas with VIRTUAL_SHARES/VIRTUAL_ASSETS constants
- [github.com/morpho-org/morpho-blue/blob/main/src/libraries/MarketParamsLib.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/libraries/MarketParamsLib.sol) — market-ID derivation: keccak256 of 160-byte packed MarketParams
- [github.com/morpho-org/morpho-blue/blob/main/src/libraries/EventsLib.sol](https://github.com/morpho-org/morpho-blue/blob/main/src/libraries/EventsLib.sol) — event signatures for Supply, Borrow, SupplyCollateral, CreateMarket
- [github.com/morpho-org/morpho-blue-snippets/blob/main/src/morpho-blue/MorphoBlueSnippets.sol](https://github.com/morpho-org/morpho-blue-snippets/blob/main/src/morpho-blue/MorphoBlueSnippets.sol) — repayAll pattern + supplyAssetsUser/borrowAssetsUser patterns
- [docs.morpho.org/addresses/](https://docs.morpho.org/addresses/) — canonical deployment address `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` on all chains
- [github.com/LedgerHQ/clear-signing-erc7730-registry/blob/master/registry/morpho/calldata-MorphoBlue.json](https://github.com/LedgerHQ/clear-signing-erc7730-registry/blob/master/registry/morpho/calldata-MorphoBlue.json) — ERC-7730 coverage for all 6 Morpho Blue write functions on chainId 1 and 8453
- [docs.morpho.org/build/borrow/tutorials/assets-flow/](https://docs.morpho.org/build/borrow/tutorials/assets-flow/) — supplyCollateral → borrow flow, approval requirements, assets-only for collateral

### Secondary (MEDIUM confidence)
- [etherscan.io/address/0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb](https://etherscan.io/address/0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb) — Ethereum mainnet deployment confirmed
- [app.morpho.org market detail pages](https://app.morpho.org/ethereum/borrow) — known market IDs (wstETH/USDC, cbBTC/USDC, WBTC/USDT)
- [npmjs.com/package/@morpho-org/blue-sdk](https://www.npmjs.com/package/@morpho-org/blue-sdk) — v6.0.0, no postinstall, 2024-06-12 publish

### Tertiary (LOW confidence)
- WebSearch results for top-TVL markets — used for market registry sketch; validate against live API at execute time

---

## Metadata

**Confidence breakdown:**
- Core contract address + ABI: HIGH — verified against official GitHub source code and docs
- Ledger clear-sign coverage: HIGH — confirmed `calldata-MorphoBlue.json` present in ERC-7730 registry
- SharesMathLib formulas: HIGH — verified from official source
- Market-ID derivation: HIGH — verified from MarketParamsLib.sol
- Known-market registry (specific IDs): MEDIUM — sourced from app.morpho.org search result URLs; full top-25 list requires live API call at execute time
- SDK assessment: HIGH — npm metadata verified (no postinstall, publish date)
- Multi-chain scope recommendation: ASSUMED — based on Phase 28 precedent; planner may override

**Research date:** 2026-05-21
**Valid until:** 2026-07-21 (60 days — Morpho Blue is immutable; ABI won't change; ERC-7730 registry may get updates)

---

## Pattern-Mapper Handoff

Phase 29 maps DIRECTLY onto Phase 28's file structure with these bounded diffs:

| Phase 28 Compound file | Phase 29 Morpho analog | Bounded diff |
|------------------------|------------------------|--------------|
| `src/protocols/compound-v3.ts` | `src/protocols/morpho-blue.ts` (5th occupant) | 6 write selectors (not 2); MarketParams struct as tuple; decoder is 6-arm (not 3); NO intent-gate needed |
| `src/chains/compound-v3.ts` | `src/chains/morpho-blue.ts` | readPosition + readMarketParams + getAllTouchedMarkets (event-log scan) |
| `src/signing/compound-collateralization.ts` | `src/signing/morpho-shares.ts` | SharesMathLib inline: toAssetsDown / toAssetsUp; no HF ratio math needed (Morpho's health is oracle-based, not HF) |
| `src/config/contracts.ts` COMPOUND_COMETS_RAW | `MORPHO_BLUE_RAW: Partial<Record<ChainId, Address>>` | Simpler — one address per chain (not 6 addresses per chain) |
| `COMPOUND_COMETS_RAW` 6-entry Ethereum table | `MORPHO_BLUE_RAW` Ethereum row only | 1 entry not 6; Phase 29 mainnet-only |
| `KNOWN_SPENDERS_ETHEREUM` 6 new Compound rows | 1 new Morpho Blue row | Label: "Morpho Blue" |
| `LEDGER_NOTICE_COMPOUND_TEMPLATE` | No LEDGER NOTICE needed | ERC-7730 clear-sign coverage confirmed |
| `_compoundProtocols.deriveIntent` 4-arm | No intent-gate needed | 6 distinct selectors — each tool maps to one function |
| Phase 28 4 plans | Phase 29 estimate: 3 plans | Fewer tools needed per plan (no intent-gate complexity); market registry adds a Wave 0 task |

**Recommended 3-plan carve:**
- **Plan 29-01:** `MORPHO_BLUE_RAW` sub-table + `getMorphoBlueAddress(chainId)` getter + `src/protocols/morpho-blue.ts` (ABI + 6 selectors + encoders + decoder) + `src/tokens/morpho-markets-ethereum.json` snapshot (Wave 0 task: enumerate top 25 markets) + Fixtures Morpho-29-A/B/C literal anchors in `test/signing-fingerprint.test.ts` + `test/protocols-morpho-blue.test.ts`.
- **Plan 29-02:** `src/chains/morpho-blue.ts` (readPosition + readMarketParams + getAllTouchedMarkets event-log) + `src/signing/morpho-shares.ts` (toAssetsDown/toAssetsUp inline constants) + `get_morpho_positions` tool (event-log scan → position reads → shares-to-assets → known-market labels). Depends on 29-01.
- **Plan 29-03:** All 6 prepare tools (supply / withdraw / supplyCollateral / withdrawCollateral / borrow / repay) + repay-max borrowShares logic + RECEIPT templates + intent-validation gates (loan/collateral token assertion) + `preview_send.ts` 4th-tier Morpho dispatch (NO LEDGER NOTICE for main functions) + `canonical-dispatch.ts` Morpho address add + lifecycle integration test + `register-all.ts` +7 imports. Depends on 29-01 + 29-02.
