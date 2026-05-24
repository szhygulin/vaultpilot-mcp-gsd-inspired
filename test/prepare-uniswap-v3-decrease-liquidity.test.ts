// prepare_uniswap_v3_decrease_liquidity tests — Phase 33 Plan 33-02 (UNI-06).
//
// Fingerprint regression anchor: test/signing-fingerprint.test.ts Fixture UNI-LP-C.

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
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";

import "../src/tools/prepare_uniswap_v3_decrease_liquidity.js";

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
  const tool = getRegisteredTool("prepare_uniswap_v3_decrease_liquidity");
  if (!tool) throw new Error("not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged) as Promise<ToolHandlerResult>;
}

function setupPositionMock(opts: { liquidity?: bigint } = {}): void {
  const liq = opts.liquidity ?? 1000n;
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
        liq,
        0n,
        0n,
        0n,
        0n,
      ]);
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

describe("prepare_uniswap_v3_decrease_liquidity — parameter mode XOR", () => {
  it("BOTH liquidityPercent and liquidityDelta supplied → INVALID_INPUT", async () => {
    const r = await callTool({
      tokenId: TOKEN_ID,
      liquidityPercent: 50,
      liquidityDelta: "500",
    });
    expect(r.isError).toBe(true);
  });

  it("NEITHER supplied → INVALID_INPUT", async () => {
    const r = await callTool({ tokenId: TOKEN_ID });
    expect(r.isError).toBe(true);
  });

  it("liquidityPercent out of bounds → INVALID_INPUT", async () => {
    const r = await callTool({ tokenId: TOKEN_ID, liquidityPercent: 101 });
    expect(r.isError).toBe(true);
  });

  it("malformed liquidityDelta → INVALID_INPUT", async () => {
    const r = await callTool({
      tokenId: TOKEN_ID,
      liquidityDelta: "1.5",
    });
    expect(r.isError).toBe(true);
  });
});

describe("prepare_uniswap_v3_decrease_liquidity — happy paths", () => {
  it("liquidityPercent=50 with mocked positions.liquidity=1000 → liquidityDelta=500", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupPositionMock({ liquidity: 1000n });

    const r = await callTool({ tokenId: TOKEN_ID, liquidityPercent: 50 });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as { liquidityDelta: string };
    expect(sc.liquidityDelta).toBe("500");
  });

  it("liquidityDelta='1000' → exact pass-through", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupPositionMock();

    const r = await callTool({ tokenId: TOKEN_ID, liquidityDelta: "1000" });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as { liquidityDelta: string };
    expect(sc.liquidityDelta).toBe("1000");
  });

  it("happy-path response includes T-DECREASE-DOES-NOT-TRANSFER notice in PREPARE RECEIPT + LEDGER NOTICE", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupPositionMock({ liquidity: 1000n });

    const r = await callTool({ tokenId: TOKEN_ID, liquidityPercent: 100 });
    expect(r.isError).toBeFalsy();
    expect(r.content.length).toBe(3);
    // The verbatim "does NOT transfer" sentence baked into the template.
    expect(r.content[0]?.text ?? "").toMatch(
      /decreaseLiquidity does NOT transfer tokens to your wallet/,
    );
    expect(r.content[0]?.text ?? "").toMatch(/prepare_uniswap_v3_collect/);
    expect(r.content[2]?.text ?? "").toMatch(/LEDGER NOTICE — Uniswap V3 LP/);

    const sc = r.structuredContent as { to: string };
    expect(sc.to).toBe(NPM);
  });

  it("liquidityPercent=50 with positions.liquidity=0 → INVALID_INPUT (nothing to decrease)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupPositionMock({ liquidity: 0n });

    const r = await callTool({ tokenId: TOKEN_ID, liquidityPercent: 50 });
    expect(r.isError).toBe(true);
  });
});

describe("prepare_uniswap_v3_decrease_liquidity — register-all wiring smoke", () => {
  it("is registered", () => {
    expect(listRegisteredTools().map((t) => t.name)).toContain(
      "prepare_uniswap_v3_decrease_liquidity",
    );
  });
});
