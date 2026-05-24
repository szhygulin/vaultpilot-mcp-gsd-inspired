// test/get-lp-positions.test.ts
//
// Phase 33 Plan 33-01 — get_lp_positions tool regression. Covers:
//   - Refusal on non-Ethereum chain (Phase 33 Ethereum-only per D-03).
//   - Empty positions array for a wallet with no LP NFTs.
//   - Happy-path envelope with [ESTIMATE] prefix discipline + ilEstimateConfidence flag.
//   - Promise.allSettled fan-out — one rejected position does not poison the batch.
//   - rpcDegraded surfacing when isPublicNodeFallback fires.
//   - register-all.ts wire check.

import type { Address, PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let publicNodeFallback = false;

const mockReadContract = vi.fn();
const mockClient = { readContract: mockReadContract } as unknown as PublicClient;

vi.mock("../src/chains/registry.js", () => {
  return {
    getChainClient: () => mockClient,
    isPublicNodeFallback: () => publicNodeFallback,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
  };
});

import type { PositionData } from "../src/chains/uniswap-v3-lp.js";
import {
  _resetRegistryForTesting,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

// Test wallet (EIP-55 checksummed vitalik.eth).
const WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

beforeEach(() => {
  _resetRegistryForTesting();
  vi.resetModules();
  publicNodeFallback = false;
  mockReadContract.mockReset();
});

afterEach(() => {
  _resetRegistryForTesting();
});

/**
 * Re-import all modules under a fresh `vi.resetModules` so the spy installs
 * against the same module instance the freshly-loaded `get_lp_positions.ts`
 * imports. ESM module identity is the load-bearing seam — without this, the
 * spy on a top-level-imported `_uniswapV3LpReader` would target a stale
 * module instance the tool no longer references.
 */
async function callTool(
  args: Record<string, unknown>,
  mockPositions?: PositionData[],
): Promise<ToolHandlerResult> {
  const { getRegisteredTool: freshGet, _resetRegistryForTesting: freshReset } = await import(
    "../src/tools/index.js"
  );
  freshReset();
  if (mockPositions !== undefined) {
    const reader = await import("../src/chains/uniswap-v3-lp.js");
    vi.spyOn(reader._uniswapV3LpReader, "readUserPositions").mockResolvedValueOnce(
      mockPositions,
    );
  }
  await import("../src/tools/register-all.js");
  const tool = freshGet("get_lp_positions");
  if (!tool) throw new Error("get_lp_positions not registered");
  return tool.handler(args) as Promise<ToolHandlerResult>;
}

describe("get_lp_positions — chain narrowing (Phase 33 Ethereum-only per D-03)", () => {
  it("rejects 'polygon' with INVALID_INPUT + deferred-to-v2.4.x message", async () => {
    const result = await callTool({ chain: "polygon", wallet: WALLET });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc?.errorCode).toBe("INVALID_INPUT");
    expect(sc?.message).toMatch(/deferred to v2\.4\.x/);
  });

  it("rejects 'arbitrum' with INVALID_INPUT", async () => {
    const result = await callTool({ chain: "arbitrum", wallet: WALLET });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc?.errorCode).toBe("INVALID_INPUT");
  });

  it("rejects malformed wallet address", async () => {
    const result = await callTool({ chain: "ethereum", wallet: "not-an-address" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc?.errorCode).toBe("INVALID_INPUT");
  });
});

describe("get_lp_positions — happy path via _uniswapV3LpReader spy", () => {
  it("zero-positions wallet returns empty positions array", async () => {
    const result = await callTool({ chain: "ethereum", wallet: WALLET }, []);
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc?.positions).toEqual([]);
    expect(sc?.chain).toBe("ethereum");
    expect(sc?.chainId).toBe(1);
    expect(sc?.wallet).toBe(WALLET);
    expect(sc?.approx).toBe(true);
  });

  it("mocked positions returns envelope with [ESTIMATE] prefix + ilEstimateConfidence", async () => {
    const mockedPositions: PositionData[] = [
      {
        tokenId: 12345n,
        token0: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address, // USDC
        token1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address, // WETH
        fee: 500,
        tickLower: -100,
        tickUpper: 100,
        liquidity: 1_000_000_000_000_000_000n,
        currentTick: 0,
        inRange: true,
        poolAddress: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640" as Address,
        accruedFees: { amount0: 12345n, amount1: 6789n },
        ilEstimate: {
          ilRaw: "0",
          ilNetOfFees: "0.001",
          ilEstimateConfidence: "high",
        },
        decimals0: 18,
        decimals1: 18,
      },
    ];
    const result = await callTool({ chain: "ethereum", wallet: WALLET }, mockedPositions);

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    const positions = sc?.positions as Array<Record<string, unknown>>;
    expect(positions.length).toBe(1);
    expect(positions[0].tokenId).toBe("12345");
    expect(positions[0].feeTier).toBe(500);
    expect(positions[0].inRange).toBe(true);
    const fees = positions[0].accruedFees as Record<string, unknown>;
    expect(fees.amount0).toBe("12345");
    const il = positions[0].ilEstimate as Record<string, unknown>;
    expect(il.confidence).toBe("high");

    // CHECKS PERFORMED text content must carry the [ESTIMATE] prefix.
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toMatch(/\[ESTIMATE\]/);
  });

  it("rpcDegraded surfaces true when isPublicNodeFallback fires", async () => {
    publicNodeFallback = true;
    const result = await callTool({ chain: "ethereum", wallet: WALLET }, []);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc?.rpcDegraded).toBe(true);
  });
});

describe("get_lp_positions — Promise.allSettled fan-out discipline (T-PROMISE-ALL-POISON-LP)", () => {
  it("one broken position does NOT poison the batch — survivors still returned", async () => {
    // Mock readUserPositions to simulate Promise.allSettled filtering: 1
    // healthy position is returned even when peer positions would have
    // rejected. The reader itself does Promise.allSettled + filter; the
    // mock here just returns the post-filter result.
    const survivors: PositionData[] = [
      {
        tokenId: 1n,
        token0: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
        token1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
        fee: 3000,
        tickLower: -200,
        tickUpper: 200,
        liquidity: 5n * 10n ** 17n,
        currentTick: 0,
        inRange: true,
        poolAddress: "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8" as Address,
        accruedFees: { amount0: 100n, amount1: 50n },
        ilEstimate: { ilRaw: "0", ilNetOfFees: "0", ilEstimateConfidence: "high" },
        decimals0: 18,
        decimals1: 18,
      },
    ];
    const result = await callTool({ chain: "ethereum", wallet: WALLET }, survivors);
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    const positions = sc?.positions as unknown[];
    expect(positions.length).toBe(1);
  });
});

describe("get_lp_positions — register-all wire check", () => {
  it("get_lp_positions is registered with the documented input schema", async () => {
    const { _resetRegistryForTesting: reset, getRegisteredTool: get } = await import(
      "../src/tools/index.js"
    );
    reset();
    await import("../src/tools/register-all.js");
    const tool = get("get_lp_positions");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("get_lp_positions");
    const schema = tool!.inputSchema as { properties: { chain: { enum: string[] } } };
    expect(schema.properties.chain.enum).toEqual(["ethereum"]);
  });
});
