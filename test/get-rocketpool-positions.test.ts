// test/get-rocketpool-positions.test.ts
//
// Unit tests for MCP tool `get_rocketpool_positions` — Phase 31 Plan 31-03 (RP-01).
//
// Cases:
//   (1) Happy path: 1 rETH × 1.1 ETH/rETH → 1.1 ETH equivalent; structured
//       content carries the full 6-field shape + chain/chainId metadata.
//   (2) Zero-balance path: rethBalance=0n → summary line "No Rocket Pool
//       positions found for {wallet}".
//   (3) Non-Ethereum chain refusal → CHAIN_ID_MISMATCH (errorCode 15).
//   (4) Invalid wallet → INVALID_INPUT (errorCode 1).
//   (5) Default chain — omitting `chain` defaults to "ethereum".

import type { Address, PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadContract = vi.fn();
const mockClient = { readContract: mockReadContract } as unknown as PublicClient;
let publicNodeFallback = false;

vi.mock("../src/chains/registry.js", () => {
  return {
    getChainClient: () => mockClient,
    isPublicNodeFallback: () => publicNodeFallback,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
  };
});

import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const RETH_BALANCE_1 = 1_000_000_000_000_000_000n; // 1 rETH
const EXCHANGE_RATE_1_1 = 1_100_000_000_000_000_000n; // 1.1 ETH/rETH
const ETH_EQUIVALENT_1_1 = 1_100_000_000_000_000_000n; // 1.1 ETH

beforeEach(() => {
  _resetRegistryForTesting();
  vi.resetModules();
  mockReadContract.mockReset();
  publicNodeFallback = false;
});

afterEach(() => {
  _resetRegistryForTesting();
});

function setupReadMocks(
  rethBalance: bigint = RETH_BALANCE_1,
  exchangeRate: bigint = EXCHANGE_RATE_1_1,
) {
  mockReadContract.mockImplementation(
    ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "balanceOf":
          return Promise.resolve(rethBalance);
        case "getExchangeRate":
          return Promise.resolve(exchangeRate);
        default:
          return Promise.resolve(0n);
      }
    },
  );
}

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const { getRegisteredTool: freshGet, _resetRegistryForTesting: reset } = await import(
    "../src/tools/index.js"
  );
  reset();
  await import("../src/tools/register-all.js");
  const tool = freshGet("get_rocketpool_positions");
  if (!tool) throw new Error("get_rocketpool_positions not registered");
  return tool.handler(args) as Promise<ToolHandlerResult>;
}

describe("get_rocketpool_positions", () => {
  it("(1) Ethereum happy path — 1 rETH × 1.1 ETH/rETH → 1.1 ETH equivalent + full structured content", async () => {
    setupReadMocks();

    const result = await callTool({ chain: "ethereum", wallet: WALLET });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("ethereum");
    expect(sc.chainId).toBe(1);
    expect(sc.wallet).toBe(WALLET);
    expect(sc.rethBalance).toBe(RETH_BALANCE_1.toString());
    expect(sc.exchangeRate).toBe(EXCHANGE_RATE_1_1.toString());
    expect(sc.ethEquivalent).toBe(ETH_EQUIVALENT_1_1.toString());
    expect(sc.rethBalanceHuman).toBe("1");
    expect(sc.exchangeRateHuman).toBe("1.1");
    expect(sc.ethEquivalentHuman).toBe("1.1");

    // Rocket Pool does NOT surface `approx` (contrast with Lido).
    expect(sc.approx).toBeUndefined();

    // Summary text shape.
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(`Rocket Pool positions for ${WALLET}`);
    expect(text).toContain("rETH balance");
    expect(text).toContain("Current exchange rate");
    expect(text).toContain("ETH-equivalent value");
  });

  it("(2) Zero balance — emits 'No Rocket Pool positions found' summary line", async () => {
    setupReadMocks(0n, EXCHANGE_RATE_1_1);

    const result = await callTool({ chain: "ethereum", wallet: WALLET });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.rethBalance).toBe("0");
    expect(sc.ethEquivalent).toBe("0");

    const text = result.content[0]?.text ?? "";
    expect(text).toBe(`No Rocket Pool positions found for ${WALLET}.`);
  });

  it("(3) Non-Ethereum chain → CHAIN_ID_MISMATCH", async () => {
    const result = await callTool({ chain: "arbitrum", wallet: WALLET });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc as { errorCode: string }).errorCode).toBe("CHAIN_ID_MISMATCH");
    expect(String(sc.error ?? sc.message ?? "")).toContain("Rocket Pool");
  });

  it("(4) Malformed wallet → INVALID_INPUT", async () => {
    const result = await callTool({ chain: "ethereum", wallet: "not-an-address" });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect((sc as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
  });

  it("(5) Default chain — omitting `chain` defaults to 'ethereum'", async () => {
    setupReadMocks();

    const result = await callTool({ wallet: WALLET });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("ethereum");
    expect(sc.chainId).toBe(1);
  });

  it("(6) rpcDegraded surfaces when isPublicNodeFallback returns true", async () => {
    publicNodeFallback = true;
    setupReadMocks();

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.rpcDegraded).toBe(true);
  });
});
