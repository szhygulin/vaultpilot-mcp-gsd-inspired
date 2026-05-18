import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 8 — Plan 08-02: tools migrated from src/chains/ethereum.js (compat
// shim) to src/chains/registry.js (per-chain factory). The mock seam moves
// to the registry; `getChainClient(chainId)` returns the per-chain client.
vi.mock("../src/chains/registry.js", () => {
  const client = {
    readContract: vi.fn(),
  };
  return {
    getChainClient: () => client,
    isPublicNodeFallback: () => true,
    _resetChainRegistryForTesting: () => {},
    // The Plan 08-01 compat shim at src/chains/ethereum.js still imports
    // PUBLICNODE_RPC_URLS — needed for the FROZEN send_transaction.ts +
    // ens/resolver.ts + get_portfolio_summary.ts callers that survive
    // Plan 08-02.
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
    __client: client,
  };
});

import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const mod = (await import("../src/chains/registry.js")) as unknown as {
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
  // Phase 8 — Plan 08-02: chain arg REQUIRED; default to "ethereum" for the
  // pre-Plan-08-02 Ethereum-only test invariants.
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
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
