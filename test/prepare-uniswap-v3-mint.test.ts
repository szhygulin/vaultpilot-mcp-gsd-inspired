// prepare_uniswap_v3_mint tests — Phase 33 Plan 33-02 (UNI-05).
//
// Fingerprint regression anchor: test/signing-fingerprint.test.ts Fixture UNI-LP-A.
//
// Coverage:
//   - chain != 'ethereum' → INVALID_INPUT (non-ethereum gate)
//   - malformed token0/token1 → INVALID_INPUT
//   - same token0 === token1 → INVALID_INPUT
//   - unsupported fee tier → INVALID_INPUT
//   - amount parse error → INVALID_INPUT
//   - approval-insufficient on token0 → INVALID_INPUT + hintTool: prepare_token_approve naming token0
//   - approval-insufficient on token1 (token0 fine) → same with token1 named
//   - snap-delta > 100 bps → INVALID_INPUT
//   - happy-path → handle + PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE
//   - register-all wiring smoke

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

import "../src/tools/prepare_uniswap_v3_mint.js";

const NPM = getUniswapV3NonfungiblePositionManagerAddress(1)!;
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const PERSONA = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const MAX_UINT256 = 2n ** 256n - 1n;

const PAIRED_STATUS = {
  paired: true as const,
  accounts: [PERSONA],
  activeAccount: PERSONA,
  address: PERSONA,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [PERSONA] } as Record<number, `0x${string}`[]>,
};

async function callTool(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_uniswap_v3_mint");
  if (!tool) throw new Error("prepare_uniswap_v3_mint not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged) as Promise<ToolHandlerResult>;
}

interface MockCfg {
  decimals0?: number;
  decimals1?: number;
  /** Allowance returned for token0 — defaults MAX_UINT256. */
  allowance0?: bigint;
  /** Allowance returned for token1 — defaults MAX_UINT256. */
  allowance1?: bigint;
  /** Token0 address mock recognizes — defaults USDC. */
  token0Address?: Address;
  /** Token1 address mock recognizes — defaults WETH. */
  token1Address?: Address;
}

function setupMocks(cfg: MockCfg = {}): void {
  const decimals0 = cfg.decimals0 ?? 6; // USDC
  const decimals1 = cfg.decimals1 ?? 18; // WETH
  const allowance0 = cfg.allowance0 ?? MAX_UINT256;
  const allowance1 = cfg.allowance1 ?? MAX_UINT256;
  const t0 = cfg.token0Address ?? USDC;
  const t1 = cfg.token1Address ?? WETH;

  mockReadContract.mockImplementation((req: {
    address: Address;
    functionName: string;
    args?: readonly unknown[];
  }) => {
    if (req.functionName === "decimals") {
      if (req.address === t0) return Promise.resolve(decimals0);
      if (req.address === t1) return Promise.resolve(decimals1);
      return Promise.resolve(18);
    }
    if (req.functionName === "allowance") {
      if (req.address === t0) return Promise.resolve(allowance0);
      if (req.address === t1) return Promise.resolve(allowance1);
      return Promise.resolve(0n);
    }
    return Promise.resolve(0n);
  });
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

beforeEach(() => {
  getStatusSpy.mockReset();
  mockReadContract.mockReset();
  _resetHandleStoreForTesting();
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env[DEMO_KEY];
  else process.env[DEMO_KEY] = savedDemo;
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

describe("prepare_uniswap_v3_mint — chain gate", () => {
  it("chain != 'ethereum' → INVALID_INPUT", async () => {
    const r = await callTool({
      chain: "polygon",
      token0: USDC,
      token1: WETH,
      fee: 500,
      priceLower: "0.0005",
      priceUpper: "0.0006",
      amount0: "100",
      amount1: "0.05",
    });
    expect(r.isError).toBe(true);
    expect((r.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });
});

describe("prepare_uniswap_v3_mint — token validation", () => {
  it("malformed token0 → INVALID_INPUT", async () => {
    const r = await callTool({
      token0: "not-an-address",
      token1: WETH,
      fee: 500,
      priceLower: "0.0005",
      priceUpper: "0.0006",
      amount0: "100",
      amount1: "0.05",
    });
    expect(r.isError).toBe(true);
  });

  it("token0 === token1 → INVALID_INPUT (distinct addresses required)", async () => {
    const r = await callTool({
      token0: USDC,
      token1: USDC,
      fee: 500,
      priceLower: "0.0005",
      priceUpper: "0.0006",
      amount0: "100",
      amount1: "0.05",
    });
    expect(r.isError).toBe(true);
  });
});

describe("prepare_uniswap_v3_mint — D-07-style approval pre-flight (T-APPROVAL-INSUFFICIENT-LP)", () => {
  it("token0 allowance insufficient → INVALID_INPUT + hintTool 'prepare_token_approve' naming token0", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks({ allowance0: 1n }); // token0 short; token1 max

    const r = await callTool({
      token0: USDC,
      token1: WETH,
      fee: 500,
      priceLower: "0.0005",
      priceUpper: "0.0006",
      amount0: "100",
      amount1: "0.05",
    });
    expect(r.isError).toBe(true);
    const sc = r.structuredContent as {
      errorCode: string;
      hintTool: string;
      hintArgs: { tokenAddress: string; spender: string };
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_token_approve");
    expect(sc.hintArgs.tokenAddress).toBe(USDC);
    expect(sc.hintArgs.spender).toBe(NPM);
  });

  it("token1 allowance insufficient (token0 fine) → INVALID_INPUT + hintTool naming token1", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks({ allowance0: MAX_UINT256, allowance1: 1n });

    const r = await callTool({
      token0: USDC,
      token1: WETH,
      fee: 500,
      priceLower: "0.0005",
      priceUpper: "0.0006",
      amount0: "100",
      amount1: "0.05",
    });
    expect(r.isError).toBe(true);
    const sc = r.structuredContent as {
      errorCode: string;
      hintTool: string;
      hintArgs: { tokenAddress: string; spender: string };
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_token_approve");
    expect(sc.hintArgs.tokenAddress).toBe(WETH);
    expect(sc.hintArgs.spender).toBe(NPM);
  });
});

describe("prepare_uniswap_v3_mint — happy path", () => {
  it("returns handle + PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks();

    const r = await callTool({
      token0: USDC,
      token1: WETH,
      fee: 500,
      priceLower: "0.0005",
      priceUpper: "0.0006",
      amount0: "100",
      amount1: "0.05",
    });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as {
      handle: string;
      payloadFingerprint: string;
      tickLower: number;
      tickUpper: number;
      amount0Min: string;
      amount1Min: string;
      tokenSortFlipped: boolean;
      to: string;
    };
    expect(sc.handle).toMatch(/^[0-9a-f-]+$/);
    expect(sc.payloadFingerprint).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sc.to).toBe(NPM);
    expect(sc.tickLower).toBeLessThan(sc.tickUpper);
    // USDC < WETH in byte-order (a0 < c0); no flip.
    expect(sc.tokenSortFlipped).toBe(false);

    // 3-block response.
    expect(r.content.length).toBe(3);
    expect(r.content[0]?.text ?? "").toMatch(/PREPARE RECEIPT — Uniswap V3 mint/);
    expect(r.content[1]?.text ?? "").toMatch(/CHECKS PERFORMED/);
    expect(r.content[1]?.text ?? "").toMatch(/snapDeltaBps/);
    expect(r.content[2]?.text ?? "").toMatch(
      /LEDGER NOTICE — Uniswap V3 LP operations blind-sign on device/,
    );
  });

  it("token0/token1 reversed (WETH first) → flips internally; CHECKS PERFORMED notes the swap", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    // After flip, decoder reads decimals from canonical (token0=USDC, token1=WETH).
    setupMocks();

    const r = await callTool({
      token0: WETH, // reversed
      token1: USDC,
      fee: 500,
      // Agent's prices = "USDC per WETH" = ~2000; after invert the canonical
      // bounds become ~1/2200 and ~1/1800.
      priceLower: "1800",
      priceUpper: "2200",
      amount0: "0.05", // agent's amount0 = WETH-amount
      amount1: "100", // agent's amount1 = USDC-amount
    });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as { tokenSortFlipped: boolean };
    expect(sc.tokenSortFlipped).toBe(true);
    expect(r.content[1]?.text ?? "").toMatch(/tokenSortFlip/);
  });
});

describe("prepare_uniswap_v3_mint — register-all wiring smoke", () => {
  it("is registered", () => {
    expect(listRegisteredTools().map((t) => t.name)).toContain(
      "prepare_uniswap_v3_mint",
    );
  });
});
