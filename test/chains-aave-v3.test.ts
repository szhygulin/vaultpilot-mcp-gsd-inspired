import type { Address, PublicClient } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _aaveChains,
  aaveV3UiPoolAbi,
  getReservesData,
  getUserReservesData,
} from "../src/chains/aave-v3.js";
import {
  getAaveV3PoolAddressesProvider,
  getAaveV3UiPoolDataProvider,
} from "../src/config/contracts.js";

const WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chains/aave-v3::aaveV3UiPoolAbi (parseAbi struct-ref resolution; research § Topic 2)", () => {
  it("parses without throw — resolves the 3 struct refs into named tuples", () => {
    expect(Array.isArray(aaveV3UiPoolAbi)).toBe(true);
    // 2 function fragments — the 3 struct refs are inlined as `tuple` component
    // schemas, not surfaced as top-level entries.
    const fnFragments = aaveV3UiPoolAbi.filter((f) => f.type === "function");
    expect(fnFragments).toHaveLength(2);
  });

  it("getReservesData function fragment: returns (AggregatedReserveData[], BaseCurrencyInfo)", () => {
    const fn = aaveV3UiPoolAbi.find(
      (f): f is Extract<typeof aaveV3UiPoolAbi[number], { type: "function" }> =>
        f.type === "function" && f.name === "getReservesData",
    );
    expect(fn).toBeDefined();
    expect(fn?.inputs).toHaveLength(1);
    expect(fn?.inputs[0]?.type).toBe("address");
    // outputs: (tuple[] AggregatedReserveData, tuple BaseCurrencyInfo)
    expect(fn?.outputs).toHaveLength(2);
    expect(fn?.outputs[0]?.type).toBe("tuple[]");
    expect(fn?.outputs[1]?.type).toBe("tuple");
    // Components on the tuple[] arm — proves parseAbi expanded the struct.
    const aggregatedComponents = (fn?.outputs[0] as { components?: Array<{ name?: string; type: string }> })
      .components;
    expect(aggregatedComponents).toBeDefined();
    const aggregatedNames = aggregatedComponents?.map((c) => c.name);
    expect(aggregatedNames).toContain("underlyingAsset");
    expect(aggregatedNames).toContain("reserveLiquidationThreshold");
    expect(aggregatedNames).toContain("liquidityIndex");
    expect(aggregatedNames).toContain("variableBorrowIndex");
    expect(aggregatedNames).toContain("priceInMarketReferenceCurrency");
    expect(aggregatedNames).toContain("isFrozen");
    expect(aggregatedNames).toContain("isActive");
  });

  it("getUserReservesData function fragment: returns (UserReserveData[], uint8 userEModeCategoryId)", () => {
    const fn = aaveV3UiPoolAbi.find(
      (f): f is Extract<typeof aaveV3UiPoolAbi[number], { type: "function" }> =>
        f.type === "function" && f.name === "getUserReservesData",
    );
    expect(fn).toBeDefined();
    expect(fn?.inputs).toHaveLength(2);
    expect(fn?.inputs[0]?.type).toBe("address"); // provider
    expect(fn?.inputs[1]?.type).toBe("address"); // user
    expect(fn?.outputs).toHaveLength(2);
    expect(fn?.outputs[0]?.type).toBe("tuple[]");
    expect(fn?.outputs[1]?.type).toBe("uint8");
    expect(fn?.outputs[1]?.name).toBe("userEModeCategoryId");
    const userComponents = (fn?.outputs[0] as { components?: Array<{ name?: string; type: string }> })
      .components;
    expect(userComponents).toBeDefined();
    const userNames = userComponents?.map((c) => c.name);
    expect(userNames).toEqual([
      "underlyingAsset",
      "scaledATokenBalance",
      "usageAsCollateralEnabledOnUser",
      "scaledVariableDebt",
    ]);
  });
});

describe("chains/aave-v3::getReservesData / getUserReservesData — SOT cross-import (Plan 07-01)", () => {
  it("getReservesData calls readContract with uiPool address + provider arg from SOT (NEVER inlined)", async () => {
    const readContract = vi.fn().mockResolvedValue([[], { marketReferenceCurrencyUnit: 100000000n }]);
    const mockClient = { readContract } as unknown as PublicClient;
    await getReservesData(mockClient, 1);

    expect(readContract).toHaveBeenCalledOnce();
    const call = readContract.mock.calls[0]?.[0] as {
      address: Address;
      functionName: string;
      args: readonly unknown[];
    };
    // Cross-import assertion — addresses MUST come from Plan 07-01's SOT, not inlined.
    expect(call.address).toBe(getAaveV3UiPoolDataProvider(1));
    expect(call.functionName).toBe("getReservesData");
    expect(call.args[0]).toBe(getAaveV3PoolAddressesProvider(1));
  });

  it("getUserReservesData calls readContract with uiPool + (provider, user) args from SOT", async () => {
    const readContract = vi.fn().mockResolvedValue([[], 0]);
    const mockClient = { readContract } as unknown as PublicClient;
    await getUserReservesData(mockClient, 1, WALLET);

    expect(readContract).toHaveBeenCalledOnce();
    const call = readContract.mock.calls[0]?.[0] as {
      address: Address;
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.address).toBe(getAaveV3UiPoolDataProvider(1));
    expect(call.functionName).toBe("getUserReservesData");
    expect(call.args[0]).toBe(getAaveV3PoolAddressesProvider(1));
    expect(call.args[1]).toBe(WALLET);
  });

  it("_aaveChains ESM spy-affordance: vi.spyOn intercepts internal calls", async () => {
    const spy = vi
      .spyOn(_aaveChains, "getReservesData")
      .mockResolvedValue({
        reserves: [],
        baseCurrency: {
          marketReferenceCurrencyUnit: 100000000n,
          marketReferenceCurrencyPriceInUsd: 100000000n,
          networkBaseTokenPriceInUsd: 100000000n,
          networkBaseTokenPriceDecimals: 8,
        },
      });

    const mockClient = { readContract: vi.fn() } as unknown as PublicClient;
    const result = await _aaveChains.getReservesData(mockClient, 1);
    expect(spy).toHaveBeenCalledOnce();
    expect(result.reserves).toEqual([]);
    expect(result.baseCurrency.marketReferenceCurrencyUnit).toBe(100000000n);
  });
});
