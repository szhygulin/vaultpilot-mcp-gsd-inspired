// prepare_uniswap_v3_burn tests — Phase 33 Plan 33-02 (UNI-08).
//
// Fingerprint regression anchor: test/signing-fingerprint.test.ts Fixture UNI-LP-E.

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

import "../src/tools/prepare_uniswap_v3_burn.js";

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
  const tool = getRegisteredTool("prepare_uniswap_v3_burn");
  if (!tool) throw new Error("not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged) as Promise<ToolHandlerResult>;
}

function setupPositionMock(opts: {
  liquidity?: bigint;
  tokensOwed0?: bigint;
  tokensOwed1?: bigint;
} = {}): void {
  const liq = opts.liquidity ?? 0n;
  const owed0 = opts.tokensOwed0 ?? 0n;
  const owed1 = opts.tokensOwed1 ?? 0n;
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
        owed0,
        owed1,
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

describe("prepare_uniswap_v3_burn — pre-flight refusals (T-BURN-PRECONDITION)", () => {
  it("position with liquidity > 0 → INVALID_INPUT + hintTool 'prepare_uniswap_v3_decrease_liquidity'", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupPositionMock({ liquidity: 1000n });

    const r = await callTool({ tokenId: TOKEN_ID });
    expect(r.isError).toBe(true);
    const sc = r.structuredContent as { hintTool: string };
    expect(sc.hintTool).toBe("prepare_uniswap_v3_decrease_liquidity");
  });

  it("position with tokensOwed0 > 0 (liquidity==0) → INVALID_INPUT + hintTool 'prepare_uniswap_v3_collect'", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupPositionMock({ liquidity: 0n, tokensOwed0: 1n });

    const r = await callTool({ tokenId: TOKEN_ID });
    expect(r.isError).toBe(true);
    const sc = r.structuredContent as { hintTool: string };
    expect(sc.hintTool).toBe("prepare_uniswap_v3_collect");
  });

  it("position with tokensOwed1 > 0 → same hintTool 'prepare_uniswap_v3_collect'", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupPositionMock({ tokensOwed1: 1n });

    const r = await callTool({ tokenId: TOKEN_ID });
    expect(r.isError).toBe(true);
    const sc = r.structuredContent as { hintTool: string };
    expect(sc.hintTool).toBe("prepare_uniswap_v3_collect");
  });
});

describe("prepare_uniswap_v3_burn — fully-empty happy path", () => {
  it("liquidity=0 + tokensOwed=0/0 → returns handle + 3-block response", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupPositionMock(); // defaults: all zero

    const r = await callTool({ tokenId: TOKEN_ID });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as {
      handle: string;
      payloadFingerprint: string;
      to: string;
      tokenId: string;
      data: string;
    };
    expect(sc.tokenId).toBe(TOKEN_ID);
    expect(sc.to).toBe(NPM);
    // Selector prefix = NPM.burn (0x42966c68).
    expect(sc.data.slice(0, 10).toLowerCase()).toBe("0x42966c68");
    expect(r.content.length).toBe(3);
    expect(r.content[2]?.text ?? "").toMatch(/LEDGER NOTICE — Uniswap V3 LP/);
  });
});

describe("prepare_uniswap_v3_burn — register-all wiring smoke", () => {
  it("is registered", () => {
    expect(listRegisteredTools().map((t) => t.name)).toContain(
      "prepare_uniswap_v3_burn",
    );
  });
});
