// test/get-curve-positions.test.ts — Phase 34 Plan 34-02 (CRV-01)
//
// Tests for get_curve_positions MCP tool.
//
// Coverage:
//   1. READ-ONLY-by-construction grep guard (T-34-02-A mitigate)
//   2. Chain gate — non-Ethereum refusal → CHAIN_ID_MISMATCH (T-34-02-C mitigate)
//   3. Invalid wallet refusal → INVALID_INPUT
//   4. Default chain path — omitting `chain` defaults to "ethereum"
//   5. Zero-filter — pools with lpBalance === 0n excluded from positions[]
//   6. Promise.allSettled rejection arm → rpcDegraded: true (T-34-02-D mitigate)
//   7. structuredContent shape — per-pool entry fields validated
//   8. lpToken vs pool.address regression (Pitfall 3 anchor) — T-34-02-B mitigate
//
// Analogs: test/simulate-position-change.test.ts (READ-ONLY guard pattern)
//          test/get-eigenlayer-positions.test.ts (module-mock + getRegisteredTool pattern)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type PublicClient } from "viem";

// ---------------------------------------------------------------------------
// Module-level mocks (applied before the tool module is imported).
// ---------------------------------------------------------------------------

let publicNodeFallback = false;
const mockClient = {} as unknown as PublicClient;

vi.mock("../src/chains/registry.js", () => ({
  getChainClient: () => mockClient,
  isPublicNodeFallback: () => publicNodeFallback,
}));

// _curveChain mock — tests override getCurveLpBalance per-test via spy.
import * as curveChainModule from "../src/chains/curve.js";

// Import tool registry utilities + trigger tool registration via side-effect import.
import {
  getRegisteredTool,
  _resetRegistryForTesting,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/get_curve_positions.js";

// ---------------------------------------------------------------------------
// Pool address constants (from src/config/contracts.ts SOT).
// ---------------------------------------------------------------------------

// Legacy stETH/ETH pool.
const STETH_POOL_ADDR = getAddress("0xDC24316b9AE028F1497c275EB9192a3Ea0f67022");
const STETH_LP_TOKEN  = getAddress("0x06325440D014e39736583c165C2963BA99fAf14E"); // SEPARATE from pool.address

// PayPool stable_ng (PYUSD/USDC) — lpToken === pool.address for stable_ng.
const PAY_POOL_ADDR = getAddress("0x383E6b4437b59fff47B619CBA855CA29342A8559");

// ---------------------------------------------------------------------------
// Helper: call the registered tool handler.
// ---------------------------------------------------------------------------

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_curve_positions");
  if (!tool) throw new Error("get_curve_positions not registered — side-effect import missing?");
  return tool.handler(args) as Promise<ToolHandlerResult>;
}

beforeEach(() => {
  publicNodeFallback = false;
  vi.spyOn(curveChainModule._curveChain, "getCurveLpBalance").mockResolvedValue(0n);
});

afterEach(() => {
  vi.restoreAllMocks();
  publicNodeFallback = false;
});

// ---------------------------------------------------------------------------
// 1. READ-ONLY-by-construction grep guard (T-34-02-A)
// ---------------------------------------------------------------------------

describe("get_curve_positions — READ-ONLY-by-construction invariant (T-34-02-A)", () => {
  it("module source does NOT import createHandle (READ-ONLY-by-construction invariant)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/tools/get_curve_positions.ts", "utf8");
    expect(source).not.toMatch(/import .*createHandle/);
    expect(source).not.toMatch(/from .*handle-store/);
    expect(source).not.toMatch(/computePayloadFingerprint/);
  });
});

// ---------------------------------------------------------------------------
// 2. Chain gate — non-Ethereum refusal → CHAIN_ID_MISMATCH (T-34-02-C)
// ---------------------------------------------------------------------------

describe("get_curve_positions — chain gate (T-34-02-C)", () => {
  it("refuses non-ethereum chain with CHAIN_ID_MISMATCH", async () => {
    const result = await callTool({ wallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", chain: "polygon" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("CHAIN_ID_MISMATCH");
  });

  it("refuses 'arbitrum' with CHAIN_ID_MISMATCH", async () => {
    const result = await callTool({ wallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", chain: "arbitrum" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("CHAIN_ID_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// 3. Invalid wallet refusal → INVALID_INPUT
// ---------------------------------------------------------------------------

describe("get_curve_positions — wallet validation", () => {
  it("refuses non-address wallet with INVALID_INPUT", async () => {
    const result = await callTool({ wallet: "not-an-address" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("refuses missing wallet with INVALID_INPUT", async () => {
    const result = await callTool({ wallet: undefined as unknown as string });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("refuses empty string wallet with INVALID_INPUT", async () => {
    const result = await callTool({ wallet: "" });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------
// 4. Default chain path — omitting `chain` defaults to "ethereum"
// ---------------------------------------------------------------------------

describe("get_curve_positions — default chain", () => {
  it("omitting chain defaults to ethereum (no CHAIN_ID_MISMATCH)", async () => {
    // All balances are 0n by default (via beforeEach spy). Test verifies no chain refusal.
    const result = await callTool({ wallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" });
    // Should not be a chain error.
    if ((result.structuredContent as Record<string, unknown>).errorCode) {
      expect((result.structuredContent as Record<string, unknown>).errorCode).not.toBe("CHAIN_ID_MISMATCH");
    }
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("ethereum");
  });
});

// ---------------------------------------------------------------------------
// 5. Zero-filter — pools with lpBalance === 0n excluded from positions[]
// ---------------------------------------------------------------------------

describe("get_curve_positions — zero-filter", () => {
  it("pools with lpBalance = 0n are excluded; only non-zero pools appear in positions[]", async () => {
    // Only the legacy stETH/ETH pool (queried via its lpToken) returns non-zero.
    vi.spyOn(curveChainModule._curveChain, "getCurveLpBalance").mockImplementation(
      async (_client, lpTokenAddress) => {
        if (lpTokenAddress === STETH_LP_TOKEN) {
          return 1_000_000_000_000_000_000n; // 1 LP token
        }
        return 0n;
      },
    );

    const result = await callTool({
      wallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      chain: "ethereum",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    const positions = sc.positions as unknown[];
    expect(positions).toHaveLength(1);

    const entry = positions[0] as Record<string, unknown>;
    expect(entry.displayName).toBe("stETH/ETH (legacy)");
    expect(entry.poolAddress).toBe(STETH_POOL_ADDR);
  });
});

// ---------------------------------------------------------------------------
// 6. Promise.allSettled rejection arm → rpcDegraded: true (T-34-02-D)
// ---------------------------------------------------------------------------

describe("get_curve_positions — rpcDegraded surfacing (T-34-02-D)", () => {
  it("one pool read rejection sets rpcDegraded and omits the failing pool", async () => {
    vi.spyOn(curveChainModule._curveChain, "getCurveLpBalance").mockImplementation(
      async (_client, lpTokenAddress) => {
        if (lpTokenAddress === PAY_POOL_ADDR) {
          throw new Error("RPC timeout");
        }
        if (lpTokenAddress === STETH_LP_TOKEN) {
          return 2_000_000_000_000_000_000n; // 2 LP tokens
        }
        return 0n;
      },
    );

    const result = await callTool({
      wallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      chain: "ethereum",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.rpcDegraded).toBe(true);

    // The failing pool (PayPool) should NOT appear in positions[].
    const positions = sc.positions as Array<Record<string, unknown>>;
    const failingPoolInPositions = positions.some((p) => p.poolAddress === PAY_POOL_ADDR);
    expect(failingPoolInPositions).toBe(false);

    // stETH/ETH should still appear.
    const stEthInPositions = positions.some((p) =>
      (p.displayName as string).includes("stETH"),
    );
    expect(stEthInPositions).toBe(true);
  });

  it("isPublicNodeFallback=true sets rpcDegraded even with all reads succeeding", async () => {
    publicNodeFallback = true;
    // beforeEach already stubs all balances to 0n.

    const result = await callTool({
      wallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      chain: "ethereum",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.rpcDegraded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. structuredContent shape — per-pool entry fields validated
// ---------------------------------------------------------------------------

describe("get_curve_positions — structuredContent shape", () => {
  it("non-zero stable_ng pool entry has all required fields", async () => {
    const expectedBalance = 500_000_000_000_000_000n; // 0.5 LP

    vi.spyOn(curveChainModule._curveChain, "getCurveLpBalance").mockImplementation(
      async (_client, lpTokenAddress) => {
        // PayPool stable_ng: lpToken === pool.address
        if (lpTokenAddress === PAY_POOL_ADDR) {
          return expectedBalance;
        }
        return 0n;
      },
    );

    const result = await callTool({
      wallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      chain: "ethereum",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.chain).toBe("ethereum");
    expect(sc.chainId).toBe(1);
    expect(sc.wallet).toBe(getAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"));

    const positions = sc.positions as Array<Record<string, unknown>>;
    expect(positions).toHaveLength(1);

    const entry = positions[0]!;
    expect(entry.poolAddress).toBe(PAY_POOL_ADDR);
    expect(entry.displayName).toBeTruthy();
    expect(entry.abiVersion).toBe("stable_ng");
    expect(typeof entry.lpBalance).toBe("string");
    expect(entry.lpBalance).toBe(expectedBalance.toString());
    expect(entry.lpDecimals).toBe(18);
    expect(Array.isArray(entry.coins)).toBe(true);

    const coins = entry.coins as Array<Record<string, unknown>>;
    expect(coins.length).toBeGreaterThan(0);
    for (const coin of coins) {
      expect(coin.address).toBeTruthy();
      expect(typeof coin.decimals).toBe("number");
    }
  });

  it("legacy stETH/ETH pool entry has abiVersion 'legacy'", async () => {
    vi.spyOn(curveChainModule._curveChain, "getCurveLpBalance").mockImplementation(
      async (_client, lpTokenAddress) => {
        if (lpTokenAddress === STETH_LP_TOKEN) {
          return 1_000_000_000_000_000_000n;
        }
        return 0n;
      },
    );

    const result = await callTool({
      wallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      chain: "ethereum",
    });

    const sc = result.structuredContent as Record<string, unknown>;
    const positions = sc.positions as Array<Record<string, unknown>>;
    expect(positions).toHaveLength(1);

    const entry = positions[0]!;
    expect(entry.poolAddress).toBe(STETH_POOL_ADDR);
    expect(entry.abiVersion).toBe("legacy");
    expect(entry.lpDecimals).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// 8. lpToken vs pool.address regression — Pitfall 3 anchor (T-34-02-B)
// ---------------------------------------------------------------------------

describe("get_curve_positions — Pitfall 3: lpToken !== pool.address for legacy pool (T-34-02-B)", () => {
  it("legacy stETH/ETH pool: getCurveLpBalance called with lpToken (0x06325440...) NOT pool address (0xDC24316...)", async () => {
    const spy = vi.spyOn(curveChainModule._curveChain, "getCurveLpBalance").mockResolvedValue(0n);

    await callTool({
      wallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      chain: "ethereum",
    });

    // The call for the legacy pool MUST use the separate lpToken address.
    const callsWithLpToken = spy.mock.calls.filter(([_c, lpAddr]) => lpAddr === STETH_LP_TOKEN);
    expect(callsWithLpToken.length).toBe(1);

    // The pool address itself (0xDC24316...) must NOT appear as an lpTokenAddress arg.
    const callsWithPoolAddr = spy.mock.calls.filter(([_c, lpAddr]) => lpAddr === STETH_POOL_ADDR);
    expect(callsWithPoolAddr.length).toBe(0);
  });

  it("stable_ng PayPool: getCurveLpBalance called with pool address (lpToken === pool.address for stable_ng)", async () => {
    const spy = vi.spyOn(curveChainModule._curveChain, "getCurveLpBalance").mockResolvedValue(0n);

    await callTool({
      wallet: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      chain: "ethereum",
    });

    // For the PayPool stable_ng entry, lpToken === pool.address → same address passed.
    const callsForPayPool = spy.mock.calls.filter(([_c, lpAddr]) => lpAddr === PAY_POOL_ADDR);
    expect(callsForPayPool.length).toBe(1);
  });
});
