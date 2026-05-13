// src/chains/aave-v3.ts
//
// Sibling-shelf helper for Aave V3 UiPoolDataProviderV3 reads. Mirror of
// src/chains/erc20-scanner.ts shape — exports the helpers BOTH consumers
// (`get_lending_positions` in Plan 07-02 + `simulate_position_change` in Plan
// 07-03) import. Keeps the read path testable and reusable.
//
// The ABI uses viem's `parseAbi` with struct refs — empirically verified in
// research § Topic 2 that `parseAbi` resolves nested struct refs into named-
// tuple components, so the `readContract` result is fully typed.

import { type Address, type PublicClient, parseAbi } from "viem";

import {
  getAaveV3PoolAddressesProvider,
  getAaveV3UiPoolDataProvider,
  type ChainId,
} from "../config/contracts.js";

/**
 * UiPoolDataProviderV3 ABI fragment. Two functions consumed in v1.1:
 *   - `getReservesData(provider)` — returns all reserves config + indices + per-reserve price
 *   - `getUserReservesData(provider, user)` — returns user-specific scaled balances + scaled debts + per-user eMode category
 *
 * The `provider` arg is the `PoolAddressesProvider`, NOT the Pool itself
 * (verified in research § Topic 2 against the on-chain UiPoolDataProviderV3
 * implementation). The reader resolves both addresses via Plan 07-01's
 * typed-slot SOT — NEVER inline.
 *
 * Trim notes: the AggregatedReserveData struct in the FULL Aave contract has
 * ~30 fields; this fragment ships the ~20 Phase 7 actually consumes (config +
 * indices + price + token addresses + flags). The ABI fragment must match the
 * contract layout in ORDER for viem's decoder to align — fields kept in
 * declaration order. `test/chains-aave-v3.test.ts` asserts the destructured
 * field types via `parseAbi` runtime inspection.
 */
export const aaveV3UiPoolAbi = parseAbi([
  "struct AggregatedReserveData { address underlyingAsset; string name; string symbol; uint256 decimals; uint256 baseLTVasCollateral; uint256 reserveLiquidationThreshold; uint256 reserveLiquidationBonus; uint256 reserveFactor; bool usageAsCollateralEnabled; bool borrowingEnabled; bool isActive; bool isFrozen; uint128 liquidityIndex; uint128 variableBorrowIndex; uint128 liquidityRate; uint128 variableBorrowRate; uint40 lastUpdateTimestamp; address aTokenAddress; address variableDebtTokenAddress; uint256 priceInMarketReferenceCurrency; }",
  "struct UserReserveData { address underlyingAsset; uint256 scaledATokenBalance; bool usageAsCollateralEnabledOnUser; uint256 scaledVariableDebt; }",
  "struct BaseCurrencyInfo { uint256 marketReferenceCurrencyUnit; int256 marketReferenceCurrencyPriceInUsd; int256 networkBaseTokenPriceInUsd; uint8 networkBaseTokenPriceDecimals; }",
  "function getReservesData(address provider) view returns (AggregatedReserveData[], BaseCurrencyInfo)",
  "function getUserReservesData(address provider, address user) view returns (UserReserveData[], uint8 userEModeCategoryId)",
]);

/**
 * Decoded `AggregatedReserveData` row — viem returns `bigint` for any
 * `uint*` field and a JS number for `uint8` (the only narrowed integer
 * type). `lastUpdateTimestamp` is `uint40` → viem decodes as `number`
 * (fits in a JS number; under-2^53 always).
 */
export interface AggregatedReserveDataDecoded {
  underlyingAsset: Address;
  name: string;
  symbol: string;
  decimals: bigint;
  baseLTVasCollateral: bigint;
  reserveLiquidationThreshold: bigint;
  reserveLiquidationBonus: bigint;
  reserveFactor: bigint;
  usageAsCollateralEnabled: boolean;
  borrowingEnabled: boolean;
  isActive: boolean;
  isFrozen: boolean;
  liquidityIndex: bigint;
  variableBorrowIndex: bigint;
  liquidityRate: bigint;
  variableBorrowRate: bigint;
  lastUpdateTimestamp: number;
  aTokenAddress: Address;
  variableDebtTokenAddress: Address;
  priceInMarketReferenceCurrency: bigint;
}

export interface UserReserveDataDecoded {
  underlyingAsset: Address;
  scaledATokenBalance: bigint;
  usageAsCollateralEnabledOnUser: boolean;
  scaledVariableDebt: bigint;
}

export interface BaseCurrencyInfoDecoded {
  /**
   * Aave V3 baseCurrency unit (e.g. 1e8 on mainnet = USD with 8 decimals).
   * `priceInMarketReferenceCurrency` per reserve is denominated in this unit.
   */
  marketReferenceCurrencyUnit: bigint;
  marketReferenceCurrencyPriceInUsd: bigint;
  networkBaseTokenPriceInUsd: bigint;
  networkBaseTokenPriceDecimals: number;
}

/**
 * Read all Aave V3 reserves (system-wide configuration + indices + per-reserve
 * price) from UiPoolDataProviderV3 on the given chain. Single RPC round-trip.
 *
 * Address resolution: ALWAYS via Plan 07-01's typed-slot SOT — both
 * `uiPool` (the call target) and `provider` (the `provider` argument) come
 * from `src/config/contracts.ts`. Never inline an address here.
 */
export async function getReservesData(
  client: PublicClient,
  chainId: ChainId,
): Promise<{ reserves: readonly AggregatedReserveDataDecoded[]; baseCurrency: BaseCurrencyInfoDecoded }> {
  const provider = getAaveV3PoolAddressesProvider(chainId);
  const uiPool = getAaveV3UiPoolDataProvider(chainId);
  const result = (await client.readContract({
    address: uiPool,
    abi: aaveV3UiPoolAbi,
    functionName: "getReservesData",
    args: [provider],
  })) as unknown as readonly [readonly AggregatedReserveDataDecoded[], BaseCurrencyInfoDecoded];
  return { reserves: result[0], baseCurrency: result[1] };
}

/**
 * Read a user's per-reserve scaled balances + scaled debts + eMode category
 * from UiPoolDataProviderV3 on the given chain. Single RPC round-trip.
 *
 * The `userEModeCategoryId` is `0` for the default (no eMode) configuration;
 * non-zero values are surfaced verbatim by `get_lending_positions`. v1.1
 * health-factor math uses the per-asset liquidation threshold regardless
 * (research § Topic 3 A3 — v2.3 widens to per-category override).
 */
export async function getUserReservesData(
  client: PublicClient,
  chainId: ChainId,
  user: Address,
): Promise<{ userReserves: readonly UserReserveDataDecoded[]; userEModeCategoryId: number }> {
  const provider = getAaveV3PoolAddressesProvider(chainId);
  const uiPool = getAaveV3UiPoolDataProvider(chainId);
  const result = (await client.readContract({
    address: uiPool,
    abi: aaveV3UiPoolAbi,
    functionName: "getUserReservesData",
    args: [provider, user],
  })) as unknown as readonly [readonly UserReserveDataDecoded[], number];
  return { userReserves: result[0], userEModeCategoryId: result[1] };
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * Consumers (`get_lending_positions.ts`, Plan 07-03's `simulate_position_change.ts`)
 * import `_aaveChains` and call `_aaveChains.getReservesData(...)` so tests can
 * `vi.spyOn(_aaveChains, ...)` to intercept the RPC calls. Added at write time
 * — ESM named-export bindings are immutable; direct spies are no-ops for
 * internal calls.
 */
export const _aaveChains = { getReservesData, getUserReservesData };
