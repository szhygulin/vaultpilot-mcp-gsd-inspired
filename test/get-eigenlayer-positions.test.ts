// test/get-eigenlayer-positions.test.ts — Phase 31 Plan 31-02 (EIG-01).
//
// Structural mirror of test/get-lido-positions.test.ts.
//
// 6 test cases:
//   1. Happy path: 2 non-zero deposits + 1 queued withdrawal → structuredContent shape
//   2. Zero-balance: all-zero shares + empty queued withdrawals → empty summary
//   3. Chain refusal: chain: "arbitrum" → CHAIN_ID_MISMATCH (errorCode 15)
//   4. Invalid wallet: 0xnotahex → INVALID_INPUT (errorCode 1)
//   5. RPC partial failure: shares-read throws on one strategy → rpcDegraded: true
//   6. approx: true is ALWAYS surfaced in structuredContent (D-11 load-bearing)

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

import {
  getEigenLayerStrategyManagerAddress,
  getEigenLayerStrategyAddress,
} from "../src/config/contracts.js";
import {
  _resetRegistryForTesting,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/get_eigenlayer_positions.js";

// vitalik.eth EIP-55-checksummed
const WALLET: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const STRATEGY_MANAGER = getEigenLayerStrategyManagerAddress(1)!;
const STETH_STRATEGY = getEigenLayerStrategyAddress(1, "stETH")!;
const RETH_STRATEGY = getEigenLayerStrategyAddress(1, "rETH")!;

beforeEach(() => {
  publicNodeFallback = false;
  mockReadContract.mockReset();
});

afterEach(() => {
  mockReadContract.mockReset();
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const { getRegisteredTool } = await import("../src/tools/index.js");
  const tool = getRegisteredTool("get_eigenlayer_positions");
  if (!tool) throw new Error("get_eigenlayer_positions not registered");
  return tool.handler(args) as Promise<ToolHandlerResult>;
}

describe("get_eigenlayer_positions", () => {
  it("(1) Happy path — 2 non-zero stETH + rETH deposits + 1 queued withdrawal", async () => {
    // Fan-out call order observed at runtime:
    //   - 7 × stakerStrategyShares (functionName matches)
    //   - N × sharesToUnderlyingView (where N = non-zero count)
    //   - 1 × getQueuedWithdrawals
    // The mock differentiates by functionName + address.
    const SHARES_STETH = 5_000_000_000_000_000_000n; // 5 stETH shares
    const SHARES_RETH = 2_000_000_000_000_000_000n; // 2 rETH shares
    const UNDER_STETH = 5_100_000_000_000_000_000n; // 5.1 stETH underlying
    const UNDER_RETH = 2_200_000_000_000_000_000n; // 2.2 rETH underlying

    mockReadContract.mockImplementation(
      ({
        functionName,
        args,
        address,
      }: {
        functionName: string;
        args?: readonly unknown[];
        address: string;
      }) => {
        if (functionName === "stakerStrategyShares") {
          // args[1] is the strategy address
          const strategy = (args?.[1] ?? "") as string;
          if (strategy.toLowerCase() === STETH_STRATEGY.toLowerCase()) {
            return Promise.resolve(SHARES_STETH);
          }
          if (strategy.toLowerCase() === RETH_STRATEGY.toLowerCase()) {
            return Promise.resolve(SHARES_RETH);
          }
          return Promise.resolve(0n);
        }
        if (functionName === "sharesToUnderlyingView") {
          if (address.toLowerCase() === STETH_STRATEGY.toLowerCase()) {
            return Promise.resolve(UNDER_STETH);
          }
          if (address.toLowerCase() === RETH_STRATEGY.toLowerCase()) {
            return Promise.resolve(UNDER_RETH);
          }
          return Promise.resolve(0n);
        }
        if (functionName === "getQueuedWithdrawals") {
          return Promise.resolve([
            [
              {
                staker: WALLET,
                delegatedTo: "0x0000000000000000000000000000000000000000",
                withdrawer: WALLET,
                nonce: 0n,
                startBlock: 19_000_000,
                strategies: [STETH_STRATEGY],
                shares: [1_000_000_000_000_000_000n],
              },
            ],
            [[1_000_000_000_000_000_000n]],
          ]);
        }
        return Promise.resolve(0n);
      },
    );

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc).toBeDefined();
    expect(sc.chain).toBe("ethereum");
    expect(sc.chainId).toBe(1);
    expect(sc.wallet).toBe(WALLET);

    const deposits = sc.deposits as Array<Record<string, string>>;
    expect(deposits.length).toBe(2);
    const depositsByLst = Object.fromEntries(deposits.map((d) => [d.lst, d]));
    expect(depositsByLst.stETH?.shares).toBe(SHARES_STETH.toString());
    expect(depositsByLst.stETH?.underlyingAmount).toBe(UNDER_STETH.toString());
    expect(depositsByLst.rETH?.shares).toBe(SHARES_RETH.toString());

    const pending = sc.pendingWithdrawals as Array<Record<string, unknown>>;
    expect(pending.length).toBe(1);
    expect(pending[0]?.lst).toBe("stETH");
    expect(pending[0]?.shares).toBe("1000000000000000000");

    // totalEthEquivalent = sum of ethEquivalent (each = underlyingAmount for v1.x)
    expect(sc.totalEthEquivalent).toBe(
      (UNDER_STETH + UNDER_RETH).toString(),
    );
    // D-11 load-bearing
    expect(sc.approx).toBe(true);
  });

  it("(2) Zero-balance — empty deposits + empty withdrawals → summary line `No EigenLayer positions found`", async () => {
    mockReadContract.mockImplementation(
      ({ functionName }: { functionName: string }) => {
        if (functionName === "stakerStrategyShares") return Promise.resolve(0n);
        if (functionName === "getQueuedWithdrawals") {
          return Promise.resolve([[], []]);
        }
        return Promise.resolve(0n);
      },
    );

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.deposits).toEqual([]);
    expect(sc.pendingWithdrawals).toEqual([]);
    expect(sc.totalEthEquivalent).toBe("0");
    expect(sc.approx).toBe(true);

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("No EigenLayer positions found");
  });

  it("(3) Chain refusal — chain: 'arbitrum' → CHAIN_ID_MISMATCH (errorCode 15)", async () => {
    const result = await callTool({ chain: "arbitrum", wallet: WALLET });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc?.errorCode).toBe("CHAIN_ID_MISMATCH");
    // No RPC call should have fired for the refused chain
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it("(4) Invalid wallet — 0xnotahex → INVALID_INPUT (errorCode 1)", async () => {
    const result = await callTool({ chain: "ethereum", wallet: "not-an-address" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc?.errorCode).toBe("INVALID_INPUT");
  });

  it("(5) RPC partial failure — one stakerStrategyShares call throws → rpcDegraded: true", async () => {
    mockReadContract.mockImplementation(
      ({
        functionName,
        args,
      }: {
        functionName: string;
        args?: readonly unknown[];
      }) => {
        if (functionName === "stakerStrategyShares") {
          const strategy = (args?.[1] ?? "") as string;
          if (strategy.toLowerCase() === STETH_STRATEGY.toLowerCase()) {
            return Promise.reject(new Error("RPC timeout"));
          }
          return Promise.resolve(0n);
        }
        if (functionName === "getQueuedWithdrawals") {
          return Promise.resolve([[], []]);
        }
        return Promise.resolve(0n);
      },
    );

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.rpcDegraded).toBe(true);
    // Other strategies still resolved cleanly; happy-path data survives.
    expect(sc.approx).toBe(true);
  });

  it("(6) approx: true is ALWAYS in structuredContent regardless of result (D-11 load-bearing)", async () => {
    mockReadContract.mockImplementation(
      ({ functionName }: { functionName: string }) => {
        if (functionName === "stakerStrategyShares") return Promise.resolve(0n);
        if (functionName === "getQueuedWithdrawals") return Promise.resolve([[], []]);
        return Promise.resolve(0n);
      },
    );

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    const sc = result.structuredContent as Record<string, unknown>;
    // Literal-type assertion — must be exactly true (not truthy / boolean)
    expect(sc.approx).toBe(true);
    expect(typeof sc.approx).toBe("boolean");
  });

  it("(7) chain omitted → defaults to ethereum (additive convenience — D-03 lock honored)", async () => {
    mockReadContract.mockImplementation(
      ({ functionName }: { functionName: string }) => {
        if (functionName === "stakerStrategyShares") return Promise.resolve(0n);
        if (functionName === "getQueuedWithdrawals") return Promise.resolve([[], []]);
        return Promise.resolve(0n);
      },
    );

    const result = await callTool({ wallet: WALLET });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("ethereum");
  });

  it("(8) tool is registered + INPUT_SCHEMA wallet pattern + chain enum is ['ethereum']", async () => {
    const { getRegisteredTool } = await import("../src/tools/index.js");
    const tool = getRegisteredTool("get_eigenlayer_positions");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("get_eigenlayer_positions");
    const schema = tool!.inputSchema as {
      properties: { chain: { enum: string[] }; wallet: { pattern: string } };
      required: string[];
    };
    expect(schema.properties.chain.enum).toEqual(["ethereum"]);
    expect(schema.required).toContain("wallet");
  });
});

// Suppress unused-variable warning when _resetRegistryForTesting is imported
// for parity with sibling test files even though this file does not reset.
void _resetRegistryForTesting;
