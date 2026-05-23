import type { Address, PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the chain registry BEFORE importing anything that resolves it.
// Two distinct client instances are created so that per-call assertions can
// distinguish Ethereum vs Arbitrum readContract invocations (Pitfall 5
// mitigation — test 3).
let publicNodeFallback = false;

// Separate mock clients for each chain so we can assert Pitfall 5 (stEthPerToken
// called against the Ethereum client, not the Arbitrum client).
const mockEthReadContract = vi.fn();
const mockArbReadContract = vi.fn();

const mockEthClient = { readContract: mockEthReadContract } as unknown as PublicClient;
const mockArbClient = { readContract: mockArbReadContract } as unknown as PublicClient;

vi.mock("../src/chains/registry.js", () => {
  return {
    getChainClient: (chainId: number) => {
      if (chainId === 1) return mockEthClient;
      if (chainId === 42161) return mockArbClient;
      return mockEthClient; // fallback
    },
    isPublicNodeFallback: () => publicNodeFallback,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid", 42161: "https://test.invalid" },
  };
});

import { _lidoChains } from "../src/chains/lido.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

// Known Lido contract addresses from contracts.ts SOT (for Pitfall 5 assertion)
const ETH_WSTETH_ADDR = "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0";
const ARB_WSTETH_ADDR = "0x5979D7b546E38E414F7E9822514be443A4800529";

// Test wallet (EIP-55 checksummed vitalik.eth)
const WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

// Mock return values (1e18 round numbers for clean assertions)
//   stETH.balanceOf(wallet)  → 1_000_000_000_000_000_000n (1 stETH)
//   stETH.sharesOf(wallet)   → 950_000_000_000_000_000n  (0.95 shares — diff = 0.05e18 rewards)
//   wstETH.balanceOf(wallet) → 1_000_000_000_000_000_000n (1 wstETH)
//   wstETH.stEthPerToken()   → 1_050_000_000_000_000_000n (1.05 stETH per wstETH)
const MOCK_STETH_BALANCE = 1_000_000_000_000_000_000n;
const MOCK_STETH_SHARES = 950_000_000_000_000_000n;
const MOCK_WSTETH_BALANCE = 1_000_000_000_000_000_000n;
const MOCK_CONVERSION_RATE = 1_050_000_000_000_000_000n;
const EXPECTED_REWARDS = MOCK_STETH_BALANCE - MOCK_STETH_SHARES; // 50_000_000_000_000_000n

beforeEach(() => {
  _resetRegistryForTesting();
  // Re-import register-all after reset
  vi.resetModules();
  publicNodeFallback = false;
  mockEthReadContract.mockReset();
  mockArbReadContract.mockReset();
});

afterEach(() => {
  _resetRegistryForTesting();
});

/**
 * Configure the Ethereum mock client to return appropriate values for each
 * readContract call based on the function name.
 */
function setupEthMocks() {
  mockEthReadContract.mockImplementation(
    ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "balanceOf":
          return Promise.resolve(MOCK_STETH_BALANCE);
        case "sharesOf":
          return Promise.resolve(MOCK_STETH_SHARES);
        case "stEthPerToken":
          return Promise.resolve(MOCK_CONVERSION_RATE);
        default:
          return Promise.resolve(0n);
      }
    },
  );
}

/**
 * Configure the Arbitrum mock client to return appropriate values.
 * Only `balanceOf` is called on the Arbitrum client — stEthPerToken
 * MUST go through the Ethereum client (Pitfall 5).
 */
function setupArbMocks() {
  mockArbReadContract.mockImplementation(
    ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "balanceOf":
          return Promise.resolve(MOCK_WSTETH_BALANCE);
        default:
          return Promise.resolve(0n);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Helper to call the registered tool after re-importing register-all
// ---------------------------------------------------------------------------
async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  // Re-import to pick up fresh registry after reset
  const { getRegisteredTool: freshGet } = await import("../src/tools/index.js");
  await import("../src/tools/register-all.js");
  const tool = freshGet("get_lido_positions");
  if (!tool) throw new Error("get_lido_positions not registered");
  return tool.handler(args) as Promise<ToolHandlerResult>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("get_lido_positions", () => {
  it("(1) Ethereum happy path — all 5 numeric fields populated + approx: true", async () => {
    setupEthMocks();

    const { _resetRegistryForTesting: reset, getRegisteredTool: get } = await import(
      "../src/tools/index.js"
    );
    reset();
    await import("../src/tools/register-all.js");
    const tool = get("get_lido_positions");
    expect(tool).toBeDefined();

    const result = (await tool!.handler({
      chain: "ethereum",
      wallet: WALLET,
    })) as ToolHandlerResult;

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc).toBeDefined();

    // D-08 field assertions (decimal string form)
    expect(sc.stethBalance).toBe(MOCK_STETH_BALANCE.toString());
    expect(sc.stethShares).toBe(MOCK_STETH_SHARES.toString());
    expect(sc.wstethBalance).toBe(MOCK_WSTETH_BALANCE.toString());
    expect(sc.conversionRate).toBe(MOCK_CONVERSION_RATE.toString());
    expect(sc.accruedRebaseRewards).toBe(EXPECTED_REWARDS.toString());

    // D-09 load-bearing: approx: true must be EXACTLY true (not truthy)
    expect(sc.approx).toBe(true);

    // Chain metadata
    expect(sc.chain).toBe("ethereum");
    expect(sc.chainId).toBe(1);
    expect(sc.wallet).toBe(WALLET);
  });

  it("(2) Arbitrum happy path — wstETH-only: stethBalance + stethShares + accruedRebaseRewards all null", async () => {
    setupArbMocks();
    setupEthMocks(); // ethClient also queried for stEthPerToken

    const { _resetRegistryForTesting: reset, getRegisteredTool: get } = await import(
      "../src/tools/index.js"
    );
    reset();
    await import("../src/tools/register-all.js");
    const tool = get("get_lido_positions");
    expect(tool).toBeDefined();

    const result = (await tool!.handler({
      chain: "arbitrum",
      wallet: WALLET,
    })) as ToolHandlerResult;

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc).toBeDefined();

    // Arbitrum-specific: stETH fields are null
    expect(sc.stethBalance).toBeNull();
    expect(sc.stethShares).toBeNull();
    expect(sc.accruedRebaseRewards).toBeNull();
    expect(sc.stethBalanceHuman).toBeNull();
    expect(sc.accruedRebaseRewardsHuman).toBeNull();

    // wstETH fields are populated
    expect(sc.wstethBalance).toBe(MOCK_WSTETH_BALANCE.toString());
    // conversionRate from Ethereum L1 (Pitfall 5)
    expect(sc.conversionRate).toBe(MOCK_CONVERSION_RATE.toString());

    // D-09 approx: true still present even when accruedRebaseRewards is null
    expect(sc.approx).toBe(true);

    // Chain metadata
    expect(sc.chain).toBe("arbitrum");
    expect(sc.chainId).toBe(42161);
  });

  it("(3) Arbitrum cross-chain read assertion — stEthPerToken called against Ethereum L1 client NOT Arbitrum client (Pitfall 5)", async () => {
    setupArbMocks();
    setupEthMocks();

    const { _resetRegistryForTesting: reset, getRegisteredTool: get } = await import(
      "../src/tools/index.js"
    );
    reset();
    await import("../src/tools/register-all.js");
    const tool = get("get_lido_positions");

    await tool!.handler({
      chain: "arbitrum",
      wallet: WALLET,
    });

    // Pitfall 5 assertion: stEthPerToken call must go to the Ethereum mainnet
    // client (mockEthReadContract), NOT the Arbitrum client (mockArbReadContract).
    //
    // The Arbitrum bridged wstETH (0x5979D7b546E38E414F7E9822514be443A4800529)
    // does NOT implement stEthPerToken() — calling it would REVERT on Arbitrum.
    // The rate is read from Ethereum mainnet wstETH (0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0).
    //
    // Verify by checking:
    //   - ethClient has a call with functionName "stEthPerToken" AND address = ETH_WSTETH_ADDR
    //   - arbClient has calls ONLY for balanceOf with address = ARB_WSTETH_ADDR

    const ethCalls = mockEthReadContract.mock.calls as Array<[{ address: string; functionName: string }]>;
    const arbCalls = mockArbReadContract.mock.calls as Array<[{ address: string; functionName: string }]>;

    // The Ethereum client must have a stEthPerToken call against the L1 wstETH address
    const ethStEthPerTokenCalls = ethCalls.filter(
      ([{ address, functionName }]) =>
        functionName === "stEthPerToken" &&
        address.toLowerCase() === ETH_WSTETH_ADDR.toLowerCase(),
    );
    expect(ethStEthPerTokenCalls.length).toBeGreaterThanOrEqual(1);

    // The Arbitrum client must have a balanceOf call against the bridged wstETH address
    const arbBalanceOfCalls = arbCalls.filter(
      ([{ address, functionName }]) =>
        functionName === "balanceOf" &&
        address.toLowerCase() === ARB_WSTETH_ADDR.toLowerCase(),
    );
    expect(arbBalanceOfCalls.length).toBeGreaterThanOrEqual(1);

    // The Arbitrum client must NOT have any stEthPerToken calls
    const arbStEthPerTokenCalls = arbCalls.filter(
      ([{ functionName }]) => functionName === "stEthPerToken",
    );
    expect(arbStEthPerTokenCalls.length).toBe(0);
  });

  it("(4) Invalid wallet address → INVALID_INPUT (errorCode=INVALID_INPUT, isError=true)", async () => {
    const { _resetRegistryForTesting: reset, getRegisteredTool: get } = await import(
      "../src/tools/index.js"
    );
    reset();
    await import("../src/tools/register-all.js");
    const tool = get("get_lido_positions");

    const result = (await tool!.handler({
      chain: "ethereum",
      wallet: "not-an-address",
    })) as ToolHandlerResult;

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc?.errorCode).toBe("INVALID_INPUT");
  });

  it("(5) Unsupported chain (polygon) → INVALID_INPUT even though polygon is valid in get_lending_positions", async () => {
    const { _resetRegistryForTesting: reset, getRegisteredTool: get } = await import(
      "../src/tools/index.js"
    );
    reset();
    await import("../src/tools/register-all.js");
    const tool = get("get_lido_positions");

    const result = (await tool!.handler({
      chain: "polygon",
      wallet: WALLET,
    })) as ToolHandlerResult;

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc?.errorCode).toBe("INVALID_INPUT");
  });

  it("tool is registered and has correct input schema (register-all.ts wire check)", async () => {
    const { _resetRegistryForTesting: reset, getRegisteredTool: get } = await import(
      "../src/tools/index.js"
    );
    reset();
    await import("../src/tools/register-all.js");
    const tool = get("get_lido_positions");

    expect(tool).toBeDefined();
    expect(tool!.name).toBe("get_lido_positions");
    // Chain enum narrowed to exactly 2 options (not 5 like lending)
    const schema = tool!.inputSchema as {
      properties: { chain: { enum: string[] } };
    };
    expect(schema.properties.chain.enum).toEqual(["ethereum", "arbitrum"]);
  });
});
