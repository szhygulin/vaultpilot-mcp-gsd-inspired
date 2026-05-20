// src/chains/compound-v3.ts
//
// Sibling-shelf helper for Compound V3 Comet reads — Phase 28 Plan 28-02
// (PARTIAL surface; the full `getCometState` + `getAllCometStates` multicall
// fan-out lands in Plan 28-04). Structural mirror of `src/chains/aave-v3.ts`:
// helper-per-read + `_compoundChains` ESM spy indirection.
//
// Plan 28-02 ships the MINIMUM surface the 4 prepare tools need for their
// intent-vs-reality gates:
//   - `readBaseToken(client, comet)`                — Comet.baseToken()
//   - `readBorrowBalance(client, comet, user)`      — Comet.borrowBalanceOf(user)
//   - `readBaseBalance(client, comet, user)`        — Comet.balanceOf(user)
//   - `deriveIntent(client, comet, user, sel, ast)` — 4-arm intent label
//
// The 4-arm intent label is the central abstraction (research § Topic 3):
// Compound V3's 2 calldata selectors (supply / withdraw) cover 4 agent
// intents (supply-collateral / repay-debt / withdraw-collateral / borrow).
// The discriminator is `(asset === baseToken, user-position-shape)`; this
// helper IS that discriminator.
//
// Cryptographic-binding chain is FROZEN — this module reads RPC, computes
// nothing the device signs. The prepare tools that consume `deriveIntent`
// branch on its return value BEFORE encoding calldata, so an intent mismatch
// short-circuits the prepare envelope (no handle created).

import { type Address, type PublicClient, getAddress } from "viem";

import { getAllCompoundCometsForChain, type ChainId } from "../config/contracts.js";
import { COMPOUND_V3_COMET_ABI } from "../protocols/compound-v3.js";

/**
 * Read `Comet.baseToken()` — the canonical base asset of a Compound V3 Comet
 * (the ONLY borrowable asset in that market; all other configured assets are
 * collateral-only). Single RPC round-trip.
 *
 * The Comet ABI fragment lives in `src/protocols/compound-v3.ts` (Plan 28-01).
 * Cross-import sentinel: any future second consumer that needs the same read
 * MUST import this helper, NOT inline `client.readContract({ functionName:
 * "baseToken" })` — the format-fanout-sentinel discipline.
 */
export async function readBaseToken(
  client: PublicClient,
  comet: Address,
): Promise<Address> {
  const result = await client.readContract({
    address: comet,
    abi: COMPOUND_V3_COMET_ABI,
    functionName: "baseToken",
  });
  return result as Address;
}

/**
 * Read `Comet.borrowBalanceOf(user)` — the user's outstanding base-asset debt
 * on a Compound V3 Comet. Returns `0n` when the user has no debt. Single RPC
 * round-trip.
 *
 * The intent-vs-reality gate for `prepare_compound_supply` consumes this:
 * agent passes the base asset AND `borrowBalanceOf > 0n` → the real intent is
 * repay, not supply (refusal with hint pointing at prepare_compound_repay).
 */
export async function readBorrowBalance(
  client: PublicClient,
  comet: Address,
  user: Address,
): Promise<bigint> {
  const result = await client.readContract({
    address: comet,
    abi: COMPOUND_V3_COMET_ABI,
    functionName: "borrowBalanceOf",
    args: [user],
  });
  return result as bigint;
}

/**
 * Read `Comet.balanceOf(user)` — the user's supplied BASE-asset balance on a
 * Compound V3 Comet. NOTE: Compound V3's `balanceOf` is the lender position
 * in the base asset, NOT a generic ERC-20 balance; collateral positions live
 * in `collateralBalanceOf(user, asset)` (Plan 28-04 surface). Single RPC
 * round-trip.
 *
 * The intent-vs-reality gate for `prepare_compound_withdraw` consumes this:
 * agent passes the base asset AND `balanceOf === 0n` → the real intent is
 * borrow, not withdraw (refusal with hint pointing at prepare_compound_borrow).
 */
export async function readBaseBalance(
  client: PublicClient,
  comet: Address,
  user: Address,
): Promise<bigint> {
  const result = await client.readContract({
    address: comet,
    abi: COMPOUND_V3_COMET_ABI,
    functionName: "balanceOf",
    args: [user],
  });
  return result as bigint;
}

/**
 * 4-arm intent label returned by `deriveIntent`. Compound V3's 2 calldata
 * selectors (`supply`, `withdraw`) cover all 4 agent intents:
 *
 *   - `supply-collateral`   — supply selector + (asset !== baseToken OR
 *                             asset === baseToken + zero debt). Both the
 *                             collateral-supply path AND the lender-position
 *                             base-asset supply collapse to this label
 *                             because the calldata + on-chain behavior are
 *                             identical (Compound treats the deposit as a
 *                             pure ADD with no repay component when debt = 0).
 *   - `repay-debt`          — supply selector + asset === baseToken +
 *                             borrowBalance > 0. The protocol applies the
 *                             deposit against the debt first, then any
 *                             remainder lands in the lender position.
 *   - `withdraw-collateral` — withdraw selector + (asset !== baseToken OR
 *                             asset === baseToken + supply > 0). Both the
 *                             collateral-withdraw path AND the base-asset
 *                             unwind collapse here.
 *   - `borrow`              — withdraw selector + asset === baseToken +
 *                             supply === 0. Withdrawing the base asset
 *                             AGAINST zero supply IS the borrow operation
 *                             at the protocol level — the protocol mints
 *                             debt to satisfy the transfer (collateralized
 *                             by other assets the wallet has supplied).
 *
 * The prepare-tool gates branch on this label: `supply` tool refuses on
 * `repay-debt` (hint: prepare_compound_repay); `withdraw` tool refuses on
 * `borrow` (hint: prepare_compound_borrow); the reverse-direction tools
 * (`borrow` / `repay`, Plan 28-03) refuse on the complementary mismatches.
 */
export type CompoundIntent =
  | "supply-collateral"
  | "repay-debt"
  | "withdraw-collateral"
  | "borrow";

/**
 * Derive the real agent intent given the selector the prepare tool is about
 * to encode + the asset arg. Makes 1-2 RPC reads:
 *
 *   - Always: `readBaseToken(client, comet)` to check `asset === baseToken`.
 *   - Conditionally: `readBorrowBalance(client, comet, user)` for the supply
 *     selector when `asset === baseToken`; `readBaseBalance(client, comet,
 *     user)` for the withdraw selector when `asset === baseToken`.
 *
 * When `asset !== baseToken`, only the 1 baseToken read fires — the
 * collateral-shape arms don't need user-position lookups. Cost discipline:
 * the cheap path stays cheap; the expensive path runs only when the gate
 * needs to discriminate repay-vs-supply or borrow-vs-withdraw.
 *
 * All address comparisons go through `viem.getAddress` to normalize EIP-55
 * checksums — caller may pass mixed-case input.
 *
 * NEVER throws on a well-formed RPC; the bubbling-up `Error` from the
 * underlying `readContract` is the caller's signal to surface
 * `INTERNAL_ERROR`. The 4 prepare tools wrap `deriveIntent` in their own
 * try/catch per their existing scaffold pattern.
 */
export async function deriveIntent(
  client: PublicClient,
  comet: Address,
  user: Address,
  selector: "supply" | "withdraw",
  asset: Address,
): Promise<CompoundIntent> {
  const baseToken = await _compoundChains.readBaseToken(client, comet);
  const isBase = getAddress(asset) === getAddress(baseToken);
  if (selector === "supply") {
    if (!isBase) return "supply-collateral";
    const debt = await _compoundChains.readBorrowBalance(client, comet, user);
    return debt > 0n ? "repay-debt" : "supply-collateral";
  }
  // selector === "withdraw"
  if (!isBase) return "withdraw-collateral";
  const supplied = await _compoundChains.readBaseBalance(client, comet, user);
  return supplied > 0n ? "withdraw-collateral" : "borrow";
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * Both `prepare_compound_supply` + `prepare_compound_withdraw` (this plan) AND
 * `prepare_compound_borrow` + `prepare_compound_repay` (Plan 28-03) import
 * `_compoundChains` and route their intent-derivation through
 * `_compoundChains.deriveIntent(...)`. Tests `vi.spyOn(_compoundChains, ...)`
 * to intercept RPC reads without monkey-patching the production import path.
 *
 * Plan 28-04 EXTENDS this object with `getCometState` + `getAllCometStates`
 * for the read-tool branch (`get_compound_market_info` + `get_lending_positions`
 * Compound arm). All consumers go through `_compoundChains.<fn>`, not the
 * named exports — ESM named-export bindings are immutable; direct spies are
 * no-ops for internal cross-export calls.
 */
// ---------------------------------------------------------------------------
// Plan 28-04 — read-tool surface additions (APPEND-ONLY).
// Plan 28-02's `readBaseToken` / `readBorrowBalance` / `readBaseBalance` /
// `deriveIntent` above stay byte-identical. The additions below back:
//   - `get_compound_market_info` (per-Comet metadata; no wallet arg).
//   - `get_lending_positions` Compound branch (multi-Comet positions).
//   - `simulate_position_change` Compound dispatcher arm (4-action projection).
// All multicalls use the same `COMPOUND_V3_COMET_ABI` parseAbi const (Plan
// 28-01 + 28-04 additive). FROZEN cryptographic-binding chain unaffected —
// these are read-only helpers.
// ---------------------------------------------------------------------------

/**
 * Decoded per-Comet `getAssetInfo` row. Mirrors the `parseAbi` named-tuple
 * the on-chain `getAssetInfo` returns; viem decodes the tuple as a struct.
 *
 * `offset` is a tightly-packed index into the Comet's `userCollateral` mapping
 * (research § Topic 6); we don't use it here, but surface it for downstream
 * cross-checks.
 *
 * `priceFeed` is the Chainlink-compatible feed address; `scale` is the asset's
 * own ERC-20 decimal scale (10^decimals). `borrowCollateralFactor` /
 * `liquidateCollateralFactor` / `liquidationFactor` are all 18-decimal scaled
 * (`COLLATERAL_FACTOR_SCALE = 10n ** 18n`).
 */
export interface CompoundAssetInfo {
  offset: number;
  asset: Address;
  priceFeed: Address;
  scale: bigint;
  borrowCollateralFactor: bigint;
  liquidateCollateralFactor: bigint;
  liquidationFactor: bigint;
  supplyCap: bigint;
}

/**
 * Per-Comet collateral position row — one per non-zero collateral asset.
 * Consumed by `get_lending_positions` (Compound branch) and
 * `simulate_position_change` (Compound dispatcher arm).
 *
 * `balance` is the raw collateral wei (10^assetDecimals); `priceUsd` is the
 * Chainlink price (PRICE_FEED_SCALE = 10^8 — research § Topic 5).
 */
export interface CompoundCollateralRow {
  asset: Address;
  balance: bigint;
  priceUsd: bigint;
  priceFeed: Address;
  scale: bigint;
  decimals: number;
  borrowCollateralFactor: bigint;
  liquidateCollateralFactor: bigint;
  liquidationFactor: bigint;
  supplyCap: bigint;
}

/**
 * Per-Comet state snapshot. Combines the user-position reads (`balanceOf` /
 * `borrowBalanceOf` / `isBorrowCollateralized` / `isLiquidatable`) with the
 * market reads (`baseToken` / supply + borrow rates / utilization / total
 * supply + borrow / `numAssets`). The collateral array is OPTIONAL because the
 * second-tier per-asset read is gated on the user having a non-zero base or
 * collateral position (cost discipline — most wallets touch 0-2 Comets).
 */
export interface CometStateDecoded {
  comet: Address;
  baseToken: Address;
  /** User's base-asset supply (`balanceOf`). Zero when no supply position. */
  baseSupplied: bigint;
  /** User's base-asset debt (`borrowBalanceOf`). Zero when no debt. */
  baseBorrowed: bigint;
  /** On-chain `isBorrowCollateralized(user)` (Compound canonical). */
  isBorrowCollateralized: boolean;
  /** On-chain `isLiquidatable(user)` (Compound canonical). */
  isLiquidatable: boolean;
  /** Per-second supply rate (10^18 scale). */
  supplyRate: bigint;
  /** Per-second borrow rate (10^18 scale). */
  borrowRate: bigint;
  /** Market utilization scaled by 10^18. */
  utilization: bigint;
  /** Total base-asset supplied to the Comet. */
  totalSupply: bigint;
  /** Total base-asset borrowed from the Comet. */
  totalBorrow: bigint;
  /** Number of collateral assets configured on the Comet. */
  numAssets: number;
  /** Base-asset Chainlink price-feed address. */
  baseTokenPriceFeed: Address;
  /** Base-asset USD price (10^8 scale). */
  baseTokenPriceUsd: bigint;
  /** Per-collateral positions; populated on demand. */
  collateral: CompoundCollateralRow[];
}

/**
 * Per-Comet metadata snapshot. Consumed by `get_compound_market_info` — no
 * wallet arg; metadata-only. Mirror of `CometStateDecoded` minus the user
 * position fields, plus a populated `collateralAssets` array (all configured
 * collateral assets surface even with zero `currentSupply`).
 */
export interface CometMarketInfoDecoded {
  comet: Address;
  baseToken: Address;
  supplyRate: bigint;
  borrowRate: bigint;
  utilization: bigint;
  totalSupply: bigint;
  totalBorrow: bigint;
  numAssets: number;
  baseTokenPriceFeed: Address;
  baseTokenPriceUsd: bigint;
  collateralAssets: Array<{
    asset: Address;
    priceFeed: Address;
    priceUsd: bigint;
    scale: bigint;
    borrowCollateralFactor: bigint;
    liquidateCollateralFactor: bigint;
    liquidationFactor: bigint;
    supplyCap: bigint;
    currentSupply: bigint;
  }>;
}

/**
 * Read a single Comet's `(market state, user position)` snapshot. Single
 * multicall fan-out via `Promise.all`. The per-Comet `getUtilization()` call
 * is shared between `getSupplyRate` and `getBorrowRate` (Compound's rate
 * functions take the utilization explicitly).
 *
 * NEVER throws on a well-formed RPC. Per-individual read failure bubbles up;
 * callers (`get_lending_positions` Compound branch) catch + surface
 * `INTERNAL_ERROR`.
 *
 * `collateral` defaults to `[]`; populated separately via
 * `getCometCollateralPositions` when the wallet has a non-zero position.
 */
export async function getCometState(
  client: PublicClient,
  comet: Address,
  user: Address,
): Promise<CometStateDecoded> {
  // Phase 1 — concurrent market + user reads (8 reads).
  const [
    baseToken,
    baseSupplied,
    baseBorrowed,
    isBorrowCollateralizedResult,
    isLiquidatableResult,
    utilization,
    numAssetsRaw,
    baseTokenPriceFeed,
  ] = await Promise.all([
    client.readContract({ address: comet, abi: COMPOUND_V3_COMET_ABI, functionName: "baseToken" }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "balanceOf",
      args: [user],
    }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "borrowBalanceOf",
      args: [user],
    }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "isBorrowCollateralized",
      args: [user],
    }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "isLiquidatable",
      args: [user],
    }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "getUtilization",
    }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "numAssets",
    }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "baseTokenPriceFeed",
    }),
  ]);

  // Phase 2 — rate + total reads (rates depend on Phase 1's utilization; the
  // totals + base price are independent reads that fan out in parallel).
  const [supplyRate, borrowRate, totalSupply, totalBorrow, baseTokenPriceUsd] = await Promise.all([
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "getSupplyRate",
      args: [utilization as bigint],
    }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "getBorrowRate",
      args: [utilization as bigint],
    }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "totalSupply",
    }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "totalBorrow",
    }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "getPrice",
      args: [baseTokenPriceFeed as Address],
    }),
  ]);

  return {
    comet,
    baseToken: baseToken as Address,
    baseSupplied: baseSupplied as bigint,
    baseBorrowed: baseBorrowed as bigint,
    isBorrowCollateralized: isBorrowCollateralizedResult as boolean,
    isLiquidatable: isLiquidatableResult as boolean,
    supplyRate: supplyRate as bigint,
    borrowRate: borrowRate as bigint,
    utilization: utilization as bigint,
    totalSupply: totalSupply as bigint,
    totalBorrow: totalBorrow as bigint,
    numAssets: Number(numAssetsRaw),
    baseTokenPriceFeed: baseTokenPriceFeed as Address,
    baseTokenPriceUsd: baseTokenPriceUsd as bigint,
    collateral: [],
  };
}

/**
 * Per-Comet collateral positions for a user. Iterates `0..numAssets-1` calling
 * `getAssetInfo(i)` + `collateralBalanceOf(user, asset)` + `getPrice(priceFeed)`
 * concurrently. Returns ONLY non-zero collateral rows — zero balances are
 * filtered out (consumers don't render zero rows).
 *
 * NOTE: the asset's ERC-20 `decimals` is recovered from `assetInfo.scale` via
 * a log10 inversion. `scale` is always a power of 10 (per Comet design); we
 * count trailing zeros in bigint.
 */
export async function getCometCollateralPositions(
  client: PublicClient,
  comet: Address,
  user: Address,
  numAssets: number,
): Promise<CompoundCollateralRow[]> {
  if (numAssets === 0) return [];
  const indices = Array.from({ length: numAssets }, (_, i) => i);
  // Per-asset: 3 reads (assetInfo + collateralBalanceOf + getPrice). Fan all
  // out via Promise.all to a single batch.
  const assetInfos = await Promise.all(
    indices.map((i) =>
      client.readContract({
        address: comet,
        abi: COMPOUND_V3_COMET_ABI,
        functionName: "getAssetInfo",
        args: [i],
      }),
    ),
  );

  const rows: CompoundCollateralRow[] = [];
  await Promise.all(
    assetInfos.map(async (raw, i) => {
      const info = raw as CompoundAssetInfo;
      const [balance, priceUsd] = await Promise.all([
        client.readContract({
          address: comet,
          abi: COMPOUND_V3_COMET_ABI,
          functionName: "collateralBalanceOf",
          args: [user, info.asset],
        }),
        client.readContract({
          address: comet,
          abi: COMPOUND_V3_COMET_ABI,
          functionName: "getPrice",
          args: [info.priceFeed],
        }),
      ]);
      const balanceBig = balance as bigint;
      if (balanceBig === 0n) return; // skip zero rows.
      rows[i] = {
        asset: info.asset,
        balance: balanceBig,
        priceUsd: priceUsd as bigint,
        priceFeed: info.priceFeed,
        scale: info.scale,
        decimals: scaleToDecimals(info.scale),
        borrowCollateralFactor: info.borrowCollateralFactor,
        liquidateCollateralFactor: info.liquidateCollateralFactor,
        liquidationFactor: info.liquidationFactor,
        supplyCap: info.supplyCap,
      };
    }),
  );
  return rows.filter((r): r is CompoundCollateralRow => r !== undefined);
}

/**
 * Read every Compound V3 Comet deployed on `chainId` for a user.
 * Phase 28 scope: `chainId === 1` (Ethereum mainnet — 6 Comets). Other
 * chains return `[]` (v2.3.x widens).
 *
 * Returns an entry PER Comet — including empty-position Comets (consumers
 * filter; mirror Aave V3 `get_lending_positions` skip-zero-reserves discipline).
 * Collateral arrays are populated ONLY for Comets where the user has a
 * non-zero base position OR a non-zero collateral position (cost discipline —
 * the per-collateral fan-out is the expensive read).
 */
export async function getAllCometStates(
  client: PublicClient,
  chainId: ChainId,
  user: Address,
): Promise<CometStateDecoded[]> {
  const comets = getAllCompoundCometsForChain(chainId);
  if (comets.length === 0) return [];

  // Phase 1 — fan out state reads across every Comet on the chain.
  const states = await Promise.all(
    comets.map((comet) => _compoundChains.getCometState(client, comet, user)),
  );

  // Phase 2 — for Comets with any base position, fan out the per-collateral
  // reads. Even on a no-debt no-supply Comet, a wallet MAY have collateral
  // alone (research § Topic 6); we read collateral whenever numAssets > 0
  // AND we don't already know the wallet has zero everything. For Phase 28
  // simplicity: read collateral for every Comet with `numAssets > 0` — the
  // batch is 6 × ~3 reads max (~18 RPC reads), all in flight via
  // `Promise.all`. Filtering out zero rows happens in the reader.
  await Promise.all(
    states.map(async (state) => {
      if (state.numAssets === 0) return;
      state.collateral = await _compoundChains.getCometCollateralPositions(
        client,
        state.comet,
        user,
        state.numAssets,
      );
    }),
  );

  return states;
}

/**
 * Per-Comet metadata read — no wallet arg. Consumed by
 * `get_compound_market_info`. Fan-out shape:
 *   Phase 1 (concurrent): baseToken + getUtilization + numAssets +
 *     baseTokenPriceFeed + totalSupply + totalBorrow.
 *   Phase 2 (concurrent, depends on Phase 1 utilization + priceFeed):
 *     getSupplyRate(utilization) + getBorrowRate(utilization) + getPrice(feed).
 *   Phase 3 (per-collateral fan-out): getAssetInfo(i) + getPrice(assetFeed) +
 *     totalsCollateral(asset).
 */
export async function getCometMarketInfo(
  client: PublicClient,
  comet: Address,
): Promise<CometMarketInfoDecoded> {
  // Phase 1
  const [baseToken, utilization, numAssetsRaw, baseTokenPriceFeed, totalSupply, totalBorrow] =
    await Promise.all([
      client.readContract({
        address: comet,
        abi: COMPOUND_V3_COMET_ABI,
        functionName: "baseToken",
      }),
      client.readContract({
        address: comet,
        abi: COMPOUND_V3_COMET_ABI,
        functionName: "getUtilization",
      }),
      client.readContract({
        address: comet,
        abi: COMPOUND_V3_COMET_ABI,
        functionName: "numAssets",
      }),
      client.readContract({
        address: comet,
        abi: COMPOUND_V3_COMET_ABI,
        functionName: "baseTokenPriceFeed",
      }),
      client.readContract({
        address: comet,
        abi: COMPOUND_V3_COMET_ABI,
        functionName: "totalSupply",
      }),
      client.readContract({
        address: comet,
        abi: COMPOUND_V3_COMET_ABI,
        functionName: "totalBorrow",
      }),
    ]);

  // Phase 2
  const [supplyRate, borrowRate, baseTokenPriceUsd] = await Promise.all([
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "getSupplyRate",
      args: [utilization as bigint],
    }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "getBorrowRate",
      args: [utilization as bigint],
    }),
    client.readContract({
      address: comet,
      abi: COMPOUND_V3_COMET_ABI,
      functionName: "getPrice",
      args: [baseTokenPriceFeed as Address],
    }),
  ]);

  // Phase 3 — per-collateral surface.
  const numAssets = Number(numAssetsRaw);
  const collateralAssets: CometMarketInfoDecoded["collateralAssets"] = [];
  if (numAssets > 0) {
    const indices = Array.from({ length: numAssets }, (_, i) => i);
    const assetInfos = await Promise.all(
      indices.map((i) =>
        client.readContract({
          address: comet,
          abi: COMPOUND_V3_COMET_ABI,
          functionName: "getAssetInfo",
          args: [i],
        }),
      ),
    );
    await Promise.all(
      assetInfos.map(async (raw) => {
        const info = raw as CompoundAssetInfo;
        const [priceUsd, totalsResult] = await Promise.all([
          client.readContract({
            address: comet,
            abi: COMPOUND_V3_COMET_ABI,
            functionName: "getPrice",
            args: [info.priceFeed],
          }),
          client.readContract({
            address: comet,
            abi: COMPOUND_V3_COMET_ABI,
            functionName: "totalsCollateral",
            args: [info.asset],
          }),
        ]);
        // viem decodes named-tuple as a tuple — `totalsCollateral` returns
        // `(uint128 totalSupplyAsset, uint64 _reserved)`; we grab index 0.
        const totals = totalsResult as readonly [bigint, bigint];
        collateralAssets.push({
          asset: info.asset,
          priceFeed: info.priceFeed,
          priceUsd: priceUsd as bigint,
          scale: info.scale,
          borrowCollateralFactor: info.borrowCollateralFactor,
          liquidateCollateralFactor: info.liquidateCollateralFactor,
          liquidationFactor: info.liquidationFactor,
          supplyCap: info.supplyCap,
          currentSupply: totals[0],
        });
      }),
    );
  }

  return {
    comet,
    baseToken: baseToken as Address,
    supplyRate: supplyRate as bigint,
    borrowRate: borrowRate as bigint,
    utilization: utilization as bigint,
    totalSupply: totalSupply as bigint,
    totalBorrow: totalBorrow as bigint,
    numAssets,
    baseTokenPriceFeed: baseTokenPriceFeed as Address,
    baseTokenPriceUsd: baseTokenPriceUsd as bigint,
    collateralAssets,
  };
}

/**
 * Count trailing zeros in a power-of-ten bigint — yields the asset's ERC-20
 * decimal count. `getAssetInfo.scale` is always a power of 10 per Comet design
 * (e.g. WBTC scale = 1e8, WETH scale = 1e18). Pure bigint — no `Math.log10`.
 */
function scaleToDecimals(scale: bigint): number {
  if (scale <= 0n) return 0;
  let n = scale;
  let decimals = 0;
  while (n > 1n) {
    if (n % 10n !== 0n) break;
    n /= 10n;
    decimals += 1;
  }
  return decimals;
}

export const _compoundChains = {
  readBaseToken,
  readBorrowBalance,
  readBaseBalance,
  deriveIntent,
  // Plan 28-04 additions:
  getCometState,
  getCometCollateralPositions,
  getAllCometStates,
  getCometMarketInfo,
};
