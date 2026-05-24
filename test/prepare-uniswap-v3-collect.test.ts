// prepare_uniswap_v3_collect tests — Phase 33 Plan 33-02 (UNI-07).
//
// Fingerprint regression anchor: test/signing-fingerprint.test.ts Fixture UNI-LP-D.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address } from "viem";

const { getStatusSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...a: Parameters<typeof actual.getStatus>) => getStatusSpy(...a),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

const mockReadContract = vi.fn();
vi.mock("../src/chains/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../src/chains/registry.js")>(
    "../src/chains/registry.js",
  );
  return {
    ...actual,
    getChainClient: vi.fn(() => ({
      readContract: mockReadContract,
    })),
  };
});

import {
  getUniswapV3NonfungiblePositionManagerAddress,
} from "../src/config/contracts.js";
import { MAX_UINT128 } from "../src/protocols/uniswap-v3-lp.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";

import "../src/tools/prepare_uniswap_v3_collect.js";

const NPM = getUniswapV3NonfungiblePositionManagerAddress(1)!;
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const PERSONA = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const TOKEN_ID = "12345";

const PAIRED_STATUS = {
  paired: true as const,
  accounts: [PERSONA],
  activeAccount: PERSONA,
  address: PERSONA,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [PERSONA] } as Record<number, `0x${string}`[]>,
};

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_uniswap_v3_collect");
  if (!tool) throw new Error("not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged) as Promise<ToolHandlerResult>;
}

function setupMocks(): void {
  mockReadContract.mockImplementation((req: { address: Address; functionName: string }) => {
    if (req.functionName === "positions") {
      return Promise.resolve([
        0n,
        PERSONA,
        USDC,
        WETH,
        500,
        -60,
        60,
        1000n,
        0n,
        0n,
        0n,
        0n,
      ]);
    }
    if (req.functionName === "decimals") {
      if (req.address === USDC) return Promise.resolve(6);
      if (req.address === WETH) return Promise.resolve(18);
      return Promise.resolve(18);
    }
    return Promise.resolve(0n);
  });
}

beforeEach(() => {
  getStatusSpy.mockReset();
  mockReadContract.mockReset();
  _resetHandleStoreForTesting();
  process.env["VAULTPILOT_DEMO"] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

describe("prepare_uniswap_v3_collect — MAX_UINT128 sentinel default (T-MAX-UINT128-SENTINEL)", () => {
  it("amount0Max + amount1Max omitted → MAX_UINT128 sentinel; CHECKS PERFORMED notes 'collect everything'", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks();

    const r = await callTool({ tokenId: TOKEN_ID });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as {
      amount0Max: string;
      amount1Max: string;
      amount0MaxIsSentinel: boolean;
      amount1MaxIsSentinel: boolean;
    };
    expect(sc.amount0Max).toBe(MAX_UINT128.toString());
    expect(sc.amount1Max).toBe(MAX_UINT128.toString());
    expect(sc.amount0MaxIsSentinel).toBe(true);
    expect(sc.amount1MaxIsSentinel).toBe(true);
    // CHECKS PERFORMED notes sentinel + collect-everything.
    expect(r.content[1]?.text ?? "").toMatch(/MAX_UINT128/);
    expect(r.content[1]?.text ?? "").toMatch(/collect everything/);
    // LEDGER NOTICE always present.
    expect(r.content[2]?.text ?? "").toMatch(/LEDGER NOTICE — Uniswap V3 LP/);
  });

  it("explicit amount0Max='10.5' → parses via token decimals; sentinel flag false", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks();

    const r = await callTool({ tokenId: TOKEN_ID, amount0Max: "10.5" });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as {
      amount0Max: string;
      amount1Max: string;
      amount0MaxIsSentinel: boolean;
      amount1MaxIsSentinel: boolean;
    };
    // USDC decimals = 6 → 10.5 USDC = 10_500_000 raw.
    expect(sc.amount0Max).toBe("10500000");
    expect(sc.amount0MaxIsSentinel).toBe(false);
    // amount1Max still sentinel.
    expect(sc.amount1MaxIsSentinel).toBe(true);
  });
});

describe("prepare_uniswap_v3_collect — gates", () => {
  it("chain != 'ethereum' → INVALID_INPUT", async () => {
    const r = await callTool({ chain: "polygon", tokenId: TOKEN_ID });
    expect(r.isError).toBe(true);
  });

  it("malformed tokenId → INVALID_INPUT", async () => {
    const r = await callTool({ tokenId: "abc" });
    expect(r.isError).toBe(true);
  });
});

describe("prepare_uniswap_v3_collect — register-all wiring smoke", () => {
  it("is registered", () => {
    expect(listRegisteredTools().map((t) => t.name)).toContain(
      "prepare_uniswap_v3_collect",
    );
  });
});
