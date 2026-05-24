// prepare_uniswap_v3_increase_liquidity tests — Phase 33 Plan 33-02 (UNI-06).
//
// Fingerprint regression anchor: test/signing-fingerprint.test.ts Fixture UNI-LP-B.

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

import "../src/tools/prepare_uniswap_v3_increase_liquidity.js";

const NPM = getUniswapV3NonfungiblePositionManagerAddress(1)!;
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const PERSONA = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const MAX_UINT256 = 2n ** 256n - 1n;
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
  const tool = getRegisteredTool("prepare_uniswap_v3_increase_liquidity");
  if (!tool) throw new Error("not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged) as Promise<ToolHandlerResult>;
}

function setupMocks(opts: { allowance0?: bigint; allowance1?: bigint } = {}): void {
  const allow0 = opts.allowance0 ?? MAX_UINT256;
  const allow1 = opts.allowance1 ?? MAX_UINT256;
  mockReadContract.mockImplementation((req: { address: Address; functionName: string }) => {
    if (req.functionName === "positions") {
      // 12-tuple: nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity, fg0, fg1, owed0, owed1
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
    if (req.functionName === "allowance") {
      if (req.address === USDC) return Promise.resolve(allow0);
      if (req.address === WETH) return Promise.resolve(allow1);
      return Promise.resolve(0n);
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

describe("prepare_uniswap_v3_increase_liquidity — chain + tokenId gates", () => {
  it("chain != 'ethereum' → INVALID_INPUT", async () => {
    const r = await callTool({
      chain: "polygon",
      tokenId: TOKEN_ID,
      amount0: "100",
      amount1: "0.05",
    });
    expect(r.isError).toBe(true);
  });

  it("malformed tokenId → INVALID_INPUT", async () => {
    const r = await callTool({
      tokenId: "not-a-number",
      amount0: "100",
      amount1: "0.05",
    });
    expect(r.isError).toBe(true);
  });
});

describe("prepare_uniswap_v3_increase_liquidity — approval pre-flight on both tokens", () => {
  it("token0 insufficient → hintTool 'prepare_token_approve' (token0)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks({ allowance0: 1n });

    const r = await callTool({
      tokenId: TOKEN_ID,
      amount0: "100",
      amount1: "0.05",
    });
    expect(r.isError).toBe(true);
    const sc = r.structuredContent as { hintTool: string; hintArgs: { tokenAddress: string } };
    expect(sc.hintTool).toBe("prepare_token_approve");
    expect(sc.hintArgs.tokenAddress).toBe(USDC);
  });

  it("token1 insufficient → hintTool (token1)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks({ allowance1: 1n });

    const r = await callTool({
      tokenId: TOKEN_ID,
      amount0: "100",
      amount1: "0.05",
    });
    expect(r.isError).toBe(true);
    const sc = r.structuredContent as { hintTool: string; hintArgs: { tokenAddress: string } };
    expect(sc.hintTool).toBe("prepare_token_approve");
    expect(sc.hintArgs.tokenAddress).toBe(WETH);
  });
});

describe("prepare_uniswap_v3_increase_liquidity — happy path", () => {
  it("returns handle + 3-block response (PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks();

    const r = await callTool({
      tokenId: TOKEN_ID,
      amount0: "100",
      amount1: "0.05",
    });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as {
      handle: string;
      payloadFingerprint: string;
      tokenId: string;
      to: string;
    };
    expect(sc.tokenId).toBe(TOKEN_ID);
    expect(sc.to).toBe(NPM);
    expect(sc.payloadFingerprint).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.content.length).toBe(3);
    expect(r.content[0]?.text ?? "").toMatch(/increaseLiquidity/);
    expect(r.content[2]?.text ?? "").toMatch(/LEDGER NOTICE — Uniswap V3 LP/);
  });
});

describe("prepare_uniswap_v3_increase_liquidity — register-all wiring smoke", () => {
  it("is registered", () => {
    expect(listRegisteredTools().map((t) => t.name)).toContain(
      "prepare_uniswap_v3_increase_liquidity",
    );
  });
});
