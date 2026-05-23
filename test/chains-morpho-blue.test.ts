// test/chains-morpho-blue.test.ts — Phase 29 Plan 29-02.
//
// Unit tests for per-market Morpho Blue reads + market-discovery event-log
// scan. Mirror of test/chains-compound-v3.test.ts shape: mocked PublicClient,
// vi.spyOn on readContract / getLogs, assertion on call shape + return
// passthrough.
//
// Anchors (mapped to plan tests):
//   T1: readPosition — readContract shape ({ position, [marketId, user] })
//   T2: readMarket — readContract shape ({ market, [marketId] })
//   T3: readMarketParams — readContract shape ({ idToMarketParams, [marketId] })
//   T4: scanTouchedMarkets — CRITICAL EVENT-LOG-FILTER SHAPE — `args: { onBehalf }`
//       (research § Pattern 3 Pitfall). 3 event types, deduplication via Set.
//   T5: computeExpectedSupplyAssets — numerical correctness against
//       SharesMathLib reference value (pinned literal)
//   T6: computeExpectedBorrowAssets — rounding direction (Up >= Down)
//   T7: _morphoChains ESM spy referential equality (CLAUDE.md spy hygiene)

import type { Address, Hex, PublicClient } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _morphoChains,
  computeExpectedBorrowAssets,
  computeExpectedSupplyAssets,
  readMarket,
  readMarketParams,
  readPosition,
  scanTouchedMarkets,
} from "../src/chains/morpho-blue.js";
import { getMorphoBlueAddress } from "../src/config/contracts.js";
import { MORPHO_BLUE_ABI } from "../src/protocols/morpho-blue.js";

const WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const MORPHO = getMorphoBlueAddress(1)!;
// wstETH/USDC marketId — Plan 29-01's anchor (research § Topic 3). Cited from
// app.morpho.org/ethereum/markets. Used here for read-shape assertions only —
// the marketId LITERAL stays out of `src/` per the Plan 29-02 grep guard.
const MARKET_ID: Hex =
  "0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc";
const OTHER_MARKET_ID: Hex =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chains/morpho-blue::readPosition — readContract shape (T1)", () => {
  it("calls readContract with { address: morpho, abi: MORPHO_BLUE_ABI, functionName: 'position', args: [marketId, user] } and returns named object", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValue([123n, 45n, 67n] as readonly [bigint, bigint, bigint]);
    const mockClient = { readContract } as unknown as PublicClient;

    const result = await readPosition(mockClient, MORPHO, MARKET_ID, WALLET);

    expect(readContract).toHaveBeenCalledOnce();
    const call = readContract.mock.calls[0]?.[0] as {
      address: Address;
      abi: typeof MORPHO_BLUE_ABI;
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.address).toBe(MORPHO);
    expect(call.abi).toBe(MORPHO_BLUE_ABI);
    expect(call.functionName).toBe("position");
    expect(call.args).toEqual([MARKET_ID, WALLET]);
    expect(result).toEqual({ supplyShares: 123n, borrowShares: 45n, collateral: 67n });
  });
});

describe("chains/morpho-blue::readMarket — readContract shape (T2)", () => {
  it("calls readContract with functionName: 'market', args: [marketId] and returns named object", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValue([
        1_000_000_000_000n,
        1_000_000_000n,
        500_000_000_000n,
        500_000_000n,
        1700000000n,
        0n,
      ] as readonly [bigint, bigint, bigint, bigint, bigint, bigint]);
    const mockClient = { readContract } as unknown as PublicClient;

    const result = await readMarket(mockClient, MORPHO, MARKET_ID);

    expect(readContract).toHaveBeenCalledOnce();
    const call = readContract.mock.calls[0]?.[0] as {
      address: Address;
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.address).toBe(MORPHO);
    expect(call.functionName).toBe("market");
    expect(call.args).toEqual([MARKET_ID]);
    expect(result).toEqual({
      totalSupplyAssets: 1_000_000_000_000n,
      totalSupplyShares: 1_000_000_000n,
      totalBorrowAssets: 500_000_000_000n,
      totalBorrowShares: 500_000_000n,
      lastUpdate: 1700000000n,
      fee: 0n,
    });
  });
});

describe("chains/morpho-blue::readMarketParams — readContract shape (T3)", () => {
  it("calls readContract with functionName: 'idToMarketParams', args: [marketId] and returns named object", async () => {
    const loanToken: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const collateralToken: Address = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
    const oracle: Address = "0x48F7E36EB6B826B2dF4B2E630B62Cd25e89E40e2";
    const irm: Address = "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC";
    const readContract = vi
      .fn()
      .mockResolvedValue([
        loanToken,
        collateralToken,
        oracle,
        irm,
        860000000000000000n,
      ] as readonly [Address, Address, Address, Address, bigint]);
    const mockClient = { readContract } as unknown as PublicClient;

    const result = await readMarketParams(mockClient, MORPHO, MARKET_ID);

    expect(readContract).toHaveBeenCalledOnce();
    const call = readContract.mock.calls[0]?.[0] as {
      address: Address;
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.address).toBe(MORPHO);
    expect(call.functionName).toBe("idToMarketParams");
    expect(call.args).toEqual([MARKET_ID]);
    expect(result).toEqual({
      loanToken,
      collateralToken,
      oracle,
      irm,
      lltv: 860000000000000000n,
    });
  });
});

describe("chains/morpho-blue::scanTouchedMarkets — event-log filter shape (T4 — CRITICAL REGRESSION, research § Pattern 3 Pitfall)", () => {
  it("issues 3 getLogs calls, one per event type (Supply / Borrow / SupplyCollateral), each with args: { onBehalf: wallet }", async () => {
    const getLogs = vi.fn().mockResolvedValue([]);
    const getBlockNumber = vi.fn().mockResolvedValue(20_000_000n);
    const mockClient = { getLogs, getBlockNumber } as unknown as PublicClient;

    await scanTouchedMarkets(mockClient, WALLET);

    // 3 event types × 1 chunk (lookback 1M / chunk 100k = 10 chunks, but the
    // assertion below tolerates the chunk multiplicity by counting unique
    // event names rather than total call count).
    const callShapes = getLogs.mock.calls.map(
      (c) =>
        c[0] as {
          address: Address;
          event: { name: string; type: string };
          args: Record<string, unknown>;
          fromBlock: bigint;
          toBlock: bigint;
        },
    );
    expect(callShapes.length).toBeGreaterThanOrEqual(3);
    const eventNames = new Set(callShapes.map((c) => c.event.name));
    expect(eventNames.has("Supply")).toBe(true);
    expect(eventNames.has("Borrow")).toBe(true);
    expect(eventNames.has("SupplyCollateral")).toBe(true);
    // EVERY call must filter by onBehalf — the critical regression anchor.
    // A wrong-filter implementation (e.g. `args: { caller: wallet }` or no
    // args at all) would silently scan unrelated wallets / the entire log.
    for (const c of callShapes) {
      expect(c.args).toMatchObject({ onBehalf: WALLET });
      expect(c.address).toBe(MORPHO);
    }
  });

  it("deduplicates marketIds across the 3 event types via Set", async () => {
    // Two markets touched: MARKET_ID (via Supply + SupplyCollateral) and
    // OTHER_MARKET_ID (via Borrow only). Expected Set size = 2.
    const getLogs = vi.fn().mockImplementation((args: { event: { name: string } }) => {
      if (args.event.name === "Supply") return [{ args: { id: MARKET_ID } }];
      if (args.event.name === "Borrow") return [{ args: { id: OTHER_MARKET_ID } }];
      if (args.event.name === "SupplyCollateral") return [{ args: { id: MARKET_ID } }];
      return [];
    });
    const getBlockNumber = vi.fn().mockResolvedValue(20_000_000n);
    const mockClient = { getLogs, getBlockNumber } as unknown as PublicClient;

    const result = await scanTouchedMarkets(mockClient, WALLET, {
      fromBlock: 19_000_000n,
      toBlock: 19_000_500n, // single chunk to keep test deterministic
    });

    expect(result.size).toBe(2);
    expect(result.has(MARKET_ID)).toBe(true);
    expect(result.has(OTHER_MARKET_ID)).toBe(true);
  });

  it("returns an empty Set when no events match", async () => {
    const getLogs = vi.fn().mockResolvedValue([]);
    const getBlockNumber = vi.fn().mockResolvedValue(20_000_000n);
    const mockClient = { getLogs, getBlockNumber } as unknown as PublicClient;

    const result = await scanTouchedMarkets(mockClient, WALLET, {
      fromBlock: 19_000_000n,
      toBlock: 19_000_500n,
    });

    expect(result.size).toBe(0);
  });
});

describe("chains/morpho-blue::computeExpectedSupplyAssets — numerical correctness (T5)", () => {
  it("returns toAssetsDown(supplyShares, totalSupplyAssets, totalSupplyShares) — pinned literal", () => {
    // Same inputs as test/signing-morpho-shares-math.test.ts T2 regression
    // anchor: shares=1e9, totalAssets=1e12, totalShares=1e9 → 999000999001n.
    const pos = { supplyShares: 1_000_000_000n };
    const mkt = {
      totalSupplyAssets: 1_000_000_000_000n,
      totalSupplyShares: 1_000_000_000n,
    };
    expect(computeExpectedSupplyAssets(pos, mkt)).toBe(999_000_999_001n);
  });

  it("returns 0n when supplyShares is 0n (no lender position)", () => {
    expect(
      computeExpectedSupplyAssets(
        { supplyShares: 0n },
        { totalSupplyAssets: 1_000_000_000_000n, totalSupplyShares: 1_000_000_000n },
      ),
    ).toBe(0n);
  });
});

describe("chains/morpho-blue::computeExpectedBorrowAssets — rounding direction (T6)", () => {
  it("returns toAssetsUp(borrowShares, totalBorrowAssets, totalBorrowShares) — pinned literal", () => {
    const pos = { borrowShares: 1_000_000_000n };
    const mkt = {
      totalBorrowAssets: 1_000_000_000_000n,
      totalBorrowShares: 1_000_000_000n,
    };
    expect(computeExpectedBorrowAssets(pos, mkt)).toBe(999_000_999_002n);
  });

  it("Up >= Down for identical operands (conservative debt over-reporting)", () => {
    const down = computeExpectedSupplyAssets(
      { supplyShares: 1_000_000_000n },
      { totalSupplyAssets: 1_000_000_000_000n, totalSupplyShares: 1_000_000_000n },
    );
    const up = computeExpectedBorrowAssets(
      { borrowShares: 1_000_000_000n },
      { totalBorrowAssets: 1_000_000_000_000n, totalBorrowShares: 1_000_000_000n },
    );
    expect(up).toBeGreaterThanOrEqual(down);
  });
});

describe("chains/morpho-blue::_morphoChains — ESM spy referential equality (T7 — CLAUDE.md spy hygiene)", () => {
  it("_morphoChains.readPosition === named export readPosition", () => {
    expect(_morphoChains.readPosition).toBe(readPosition);
  });
  it("_morphoChains.readMarket === named export readMarket", () => {
    expect(_morphoChains.readMarket).toBe(readMarket);
  });
  it("_morphoChains.readMarketParams === named export readMarketParams", () => {
    expect(_morphoChains.readMarketParams).toBe(readMarketParams);
  });
  it("_morphoChains.scanTouchedMarkets === named export scanTouchedMarkets", () => {
    expect(_morphoChains.scanTouchedMarkets).toBe(scanTouchedMarkets);
  });
  it("_morphoChains.computeExpectedSupplyAssets === named export computeExpectedSupplyAssets", () => {
    expect(_morphoChains.computeExpectedSupplyAssets).toBe(computeExpectedSupplyAssets);
  });
  it("_morphoChains.computeExpectedBorrowAssets === named export computeExpectedBorrowAssets", () => {
    expect(_morphoChains.computeExpectedBorrowAssets).toBe(computeExpectedBorrowAssets);
  });
});
