import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phase 8 — Plan 08-02: tools migrated to src/chains/registry.js per-chain
// factory. Mock seam moves to the registry; `isPublicNodeFallback(chainId)`
// now takes a chainId arg (the per-test override doesn't differentiate by
// chain — every chain returns the same fallback flag in this test suite).
vi.mock("../src/chains/registry.js", () => {
  const client = {
    readContract: vi.fn(),
  };
  let fallback = false;
  return {
    getChainClient: () => client,
    isPublicNodeFallback: () => fallback,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
    __client: client,
    __setFallback: (v: boolean) => {
      fallback = v;
    },
  };
});

import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";
import "../src/tools/register-all.js";

const mod = (await import("../src/chains/registry.js")) as unknown as {
  __client: { readContract: ReturnType<typeof vi.fn> };
  __setFallback: (v: boolean) => void;
};
const stubClient = mod.__client;
const setFallback = mod.__setFallback;

// Canonical top-50 entries — pinned for cache-hit assertions.
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // decimals=6, USDC
const USDC_LOWER = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

// Off-list address (random checksummed hex, NOT in ethereum-top-50.json).
const OFF_LIST = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

beforeEach(() => {
  stubClient.readContract.mockReset();
  setFallback(false);
});

afterEach(() => {
  setFallback(false);
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_token_metadata");
  if (!tool) throw new Error("get_token_metadata not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged);
}

describe("get_token_metadata tool — PREP-22 (decimals lookup + registry cache + RPC fallback)", () => {
  it("case 1: cache hit (USDC) → no RPC calls, returns registry decimals/symbol/name", async () => {
    const result = await callTool({ chain: "ethereum", address: USDC });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      decimals: 6,
      symbol: "USDC",
      name: "USD Coin",
    });
    // Load-bearing performance invariant: registry hits MUST NOT hit RPC.
    expect(stubClient.readContract).toHaveBeenCalledTimes(0);
  });

  it("case 2: cache hit with mixed-case input → checksummed before lookup, same result", async () => {
    const result = await callTool({ chain: "ethereum", address: USDC_LOWER });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      decimals: 6,
      symbol: "USDC",
      name: "USD Coin",
    });
    expect(stubClient.readContract).toHaveBeenCalledTimes(0);
  });

  it("case 3: cache miss + live RPC → exactly 3 readContract calls (decimals + symbol + name)", async () => {
    stubClient.readContract.mockImplementation(async (params: { functionName: string }) => {
      switch (params.functionName) {
        case "decimals":
          return 18;
        case "symbol":
          return "OFF";
        case "name":
          return "Off List";
        default:
          throw new Error(`unexpected functionName: ${params.functionName}`);
      }
    });

    const result = await callTool({ chain: "ethereum", address: OFF_LIST });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      decimals: 18,
      symbol: "OFF",
      name: "Off List",
    });
    expect(stubClient.readContract).toHaveBeenCalledTimes(3);
  });

  it("case 4: invalid address → INVALID_INPUT envelope, no RPC calls", async () => {
    const result = await callTool({ chain: "ethereum", address: "0xnotanaddress" });

    expect(result.isError).toBe(true);
    expect(stubClient.readContract).not.toHaveBeenCalled();
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe("INVALID_INPUT");
  });

  it("case 5: live RPC failure on cache miss → INTERNAL_ERROR + rpcDegraded: true", async () => {
    stubClient.readContract.mockRejectedValue(new Error("PublicNode 503"));

    const result = await callTool({ chain: "ethereum", address: OFF_LIST });

    expect(result.isError).toBe(true);
    const env = result.structuredContent as {
      errorCode: string;
      cause: string;
      rpcDegraded: boolean;
    };
    expect(env.errorCode).toBe("INTERNAL_ERROR");
    expect(env.rpcDegraded).toBe(true);
    expect(env.cause).toMatch(/PublicNode 503/);
  });

  it("case 6: rpcDegraded bubbles through cache hit when fallback in use (defense-in-depth)", async () => {
    setFallback(true);

    const result = await callTool({ chain: "ethereum", address: USDC });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      decimals: 6,
      symbol: "USDC",
      name: "USD Coin",
      rpcDegraded: true,
    });
    expect(stubClient.readContract).toHaveBeenCalledTimes(0);
  });

  it("Phase 8 — Plan 08-02: accepts `polygon` (5-chain enum widening); registry cache miss falls through to live RPC", async () => {
    // v1.2-Plan-08-02 ship state: loadTokenRegistry(137) returns []; the
    // tool falls through to live RPC (registry-cache-first + RPC fallback).
    // Mock RPC reads to anchor the new accepted chain.
    stubClient.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
      if (functionName === "decimals") return 6;
      if (functionName === "symbol") return "USDC.e";
      if (functionName === "name") return "USD Coin (PoS)";
      throw new Error(`unexpected ${functionName}`);
    });
    const result = await callTool({ chain: "polygon", address: USDC });

    // No longer an error post-Plan-08-02 — chain is in the widened enum.
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { symbol: string; decimals: number };
    expect(sc.symbol).toBe("USDC.e");
    expect(sc.decimals).toBe(6);
  });
});

describe("register-all.ts wiring — get_token_metadata registered (smoke)", () => {
  it("getRegisteredTool('get_token_metadata') is defined after register-all import", () => {
    const tool = getRegisteredTool("get_token_metadata");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("get_token_metadata");
    // Description ≥ 100 chars (registerTool() warning threshold).
    expect((tool?.description.length ?? 0) >= 100).toBe(true);
  });
});
