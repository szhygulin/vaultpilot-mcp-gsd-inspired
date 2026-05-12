import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/chains/ethereum.js", () => {
  const client = {
    readContract: vi.fn(),
  };
  return {
    getEthereumClient: () => client,
    isPublicNodeFallback: () => true,
    __client: client,
  };
});

import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const mod = (await import("../src/chains/ethereum.js")) as unknown as {
  __client: { readContract: ReturnType<typeof vi.fn> };
};
const stubClient = mod.__client;

const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // checksummed
const WALLET_LOWER = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

beforeEach(() => {
  stubClient.readContract.mockReset();
});

afterEach(() => {
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_token_balance");
  if (!tool) throw new Error("get_token_balance not registered");
  return tool.handler(args);
}

describe("get_token_balance tool", () => {
  it("returns balance + decimals + symbol on the happy path", async () => {
    // Three readContract calls in parallel: balanceOf, decimals, symbol.
    stubClient.readContract.mockImplementation(async (params: { functionName: string }) => {
      switch (params.functionName) {
        case "balanceOf":
          return 1_234_567_890n; // raw 6-decimal USDC = 1234.56789 USDC
        case "decimals":
          return 6;
        case "symbol":
          return "USDC";
        default:
          throw new Error(`unexpected functionName: ${params.functionName}`);
      }
    });

    const result = await callTool({ wallet: WALLET_LOWER, tokenAddress: USDC });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      balance: "1234.56789",
      decimals: 6,
      symbol: "USDC",
      rpcDegraded: true, // mock declares fallback active
    });
    expect(stubClient.readContract).toHaveBeenCalledTimes(3);
    // Address normalized to checksum form.
    const balanceCall = stubClient.readContract.mock.calls.find(
      ([p]) => (p as { functionName: string }).functionName === "balanceOf",
    );
    expect((balanceCall?.[0] as { args: unknown[] }).args).toEqual([WALLET]);
  });

  it("returns isError when the underlying read throws", async () => {
    stubClient.readContract.mockRejectedValueOnce(new Error("contract reverted"));
    // Parallel.all rejects on first throw; subsequent calls may or may not fire.
    stubClient.readContract.mockResolvedValue(0); // safety net for the others

    const result = await callTool({ wallet: WALLET, tokenAddress: USDC });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/contract reverted/);
  });

  it("rejects malformed wallet input", async () => {
    const result = await callTool({ wallet: "0xnope", tokenAddress: USDC });
    expect(result.isError).toBe(true);
    expect(stubClient.readContract).not.toHaveBeenCalled();
  });

  it("rejects malformed token address input", async () => {
    const result = await callTool({ wallet: WALLET, tokenAddress: "not-an-address" });
    expect(result.isError).toBe(true);
    expect(stubClient.readContract).not.toHaveBeenCalled();
  });

  it("formats a zero balance as `0`", async () => {
    stubClient.readContract.mockImplementation(async (params: { functionName: string }) => {
      switch (params.functionName) {
        case "balanceOf":
          return 0n;
        case "decimals":
          return 18;
        case "symbol":
          return "WETH";
        default:
          throw new Error("unexpected");
      }
    });

    const result = await callTool({ wallet: WALLET, tokenAddress: USDC });
    expect(result.isError).toBeUndefined();
    expect((result.structuredContent as { balance: string }).balance).toBe("0");
  });
});
