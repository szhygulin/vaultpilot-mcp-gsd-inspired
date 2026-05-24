// prepare_uniswap_v3_rebalance tests — Phase 33 Plan 33-03 (UNI-09).
//
// Fingerprint regression anchor: test/signing-fingerprint.test.ts Fixture UNI-LP-F.
//
// Coverage:
//   - chain != 'ethereum'                  → INVALID_INPUT
//   - malformed tokenId                    → INVALID_INPUT
//   - ownerOf !== from                     → INVALID_INPUT (NFT-ownership)
//   - positions.liquidity == 0             → INVALID_INPUT (empty position)
//   - snap delta > 100 bps                 → INVALID_INPUT
//   - new tickLower >= tickUpper           → INVALID_INPUT (degenerate range)
//   - happy path → handle + composite calldata (3 inner calls, LOAD-BEARING)
//   - composeRebalanceCalldata SOT spy called exactly once
//   - PREPARE RECEIPT records composite intent ONLY (no inner-step args)
//   - LEDGER NOTICE present in 3-block response
//   - register-all wiring smoke

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, getAddress, type Address } from "viem";

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
import {
  MULTICALL_BYTES_ABI,
  UNISWAP_V3_LP_SELECTORS,
  _uniswapV3LpProtocol,
} from "../src/protocols/uniswap-v3-lp.js";

import "../src/tools/prepare_uniswap_v3_rebalance.js";

const NPM = getUniswapV3NonfungiblePositionManagerAddress(1)!;
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const PERSONA = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
const OTHER = getAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");

const PAIRED_STATUS = {
  paired: true as const,
  accounts: [PERSONA],
  activeAccount: PERSONA,
  address: PERSONA,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [PERSONA] } as Record<number, `0x${string}`[]>,
};

interface MockCfg {
  /** owner address returned from ownerOf — defaults to PERSONA (owned). */
  owner?: Address;
  /** Position liquidity — defaults non-zero. */
  liquidity?: bigint;
  /** Pool fee tier — defaults 500. */
  fee?: number;
  /** Old tickLower — defaults a USDC/WETH-typical narrow range. */
  oldTickLower?: number;
  /** Old tickUpper — defaults wider. */
  oldTickUpper?: number;
  /** token0 decimals (defaults 6 for USDC). */
  decimals0?: number;
  /** token1 decimals (defaults 18 for WETH). */
  decimals1?: number;
}

function setupMocks(cfg: MockCfg = {}): void {
  const owner = cfg.owner ?? PERSONA;
  const liquidity = cfg.liquidity ?? 1_000_000_000_000_000n;
  const fee = cfg.fee ?? 500;
  const oldTickLower = cfg.oldTickLower ?? -207000;
  const oldTickUpper = cfg.oldTickUpper ?? -202000;
  const decimals0 = cfg.decimals0 ?? 6;
  const decimals1 = cfg.decimals1 ?? 18;

  mockReadContract.mockImplementation((req: {
    address: Address;
    functionName: string;
    args?: readonly unknown[];
  }) => {
    if (req.functionName === "positions") {
      // 12-tuple per NPM_READ_ABI
      return Promise.resolve([
        0n, // nonce
        "0x0000000000000000000000000000000000000000", // operator
        USDC, // token0
        WETH, // token1
        fee, // fee
        oldTickLower, // tickLower
        oldTickUpper, // tickUpper
        liquidity, // liquidity
        0n, // feeGrowthInside0LastX128
        0n, // feeGrowthInside1LastX128
        0n, // tokensOwed0
        0n, // tokensOwed1
      ]);
    }
    if (req.functionName === "ownerOf") {
      return Promise.resolve(owner);
    }
    if (req.functionName === "decimals") {
      if (req.address === USDC) return Promise.resolve(decimals0);
      if (req.address === WETH) return Promise.resolve(decimals1);
      return Promise.resolve(18);
    }
    return Promise.resolve(0n);
  });
}

async function callTool(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_uniswap_v3_rebalance");
  if (!tool) throw new Error("prepare_uniswap_v3_rebalance not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged) as Promise<ToolHandlerResult>;
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

describe("prepare_uniswap_v3_rebalance — chain gate", () => {
  it("chain != 'ethereum' → INVALID_INPUT", async () => {
    const r = await callTool({
      chain: "polygon",
      tokenId: "12345",
      newPriceLower: "0.0004",
      newPriceUpper: "0.0006",
    });
    expect(r.isError).toBe(true);
    expect((r.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });
});

describe("prepare_uniswap_v3_rebalance — tokenId validation", () => {
  it("malformed tokenId → INVALID_INPUT", async () => {
    const r = await callTool({
      tokenId: "not-a-number",
      newPriceLower: "0.0004",
      newPriceUpper: "0.0006",
    });
    expect(r.isError).toBe(true);
  });
});

describe("prepare_uniswap_v3_rebalance — NFT-ownership pre-flight (T-FROM-INDEPENDENCE-UNI-LP)", () => {
  it("ownerOf !== from → INVALID_INPUT (not the position owner)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks({ owner: OTHER });

    const r = await callTool({
      tokenId: "12345",
      newPriceLower: "0.0004",
      newPriceUpper: "0.0006",
    });
    expect(r.isError).toBe(true);
    const sc = r.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect((r.content[0]?.text ?? "")).toMatch(/owned by/);
  });
});

describe("prepare_uniswap_v3_rebalance — empty-position pre-flight", () => {
  it("position.liquidity == 0 → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks({ liquidity: 0n });

    const r = await callTool({
      tokenId: "12345",
      newPriceLower: "0.0004",
      newPriceUpper: "0.0006",
    });
    expect(r.isError).toBe(true);
    const sc = r.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect((r.content[0]?.text ?? "")).toMatch(/zero liquidity/);
  });
});

describe("prepare_uniswap_v3_rebalance — snap-delta surfacing (D-03)", () => {
  it("CHECKS PERFORMED surfaces lower + upper snapDeltaBps values for agent audit", async () => {
    // The snap-delta refusal (> 100 bps) is essentially unreachable on the 4
    // canonical fee tiers — tick spacing 200 caps adjacent tick ratio at
    // ~1.0202 so the worst-case midpoint snap is ~100 bps. The threshold is
    // load-bearing as defense-in-depth; this test exercises the surfacing
    // path so the agent sees what snap delta actually occurred.
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks();

    const r = await callTool({
      tokenId: "12345",
      newPriceLower: "0.0004",
      newPriceUpper: "0.0006",
    });
    expect(r.isError).toBeFalsy();
    const checks = r.content[1]?.text ?? "";
    expect(checks).toMatch(/lower snapDeltaBps=\d+/);
    expect(checks).toMatch(/upper snapDeltaBps=\d+/);
  });
});

describe("prepare_uniswap_v3_rebalance — degenerate range", () => {
  it("newTickLower >= newTickUpper (post-snap) → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks();

    // Both prices snap to the same tick (or upper < lower).
    const r = await callTool({
      tokenId: "12345",
      newPriceLower: "0.0006",
      newPriceUpper: "0.0006",
    });
    expect(r.isError).toBe(true);
    const sc = r.structuredContent as { errorCode: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("prepare_uniswap_v3_rebalance — happy path (composite multicall shape)", () => {
  it("returns handle + composite calldata (selector 0xac9650d8 + 3 inner calls in LOAD-BEARING order)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks();

    const r = await callTool({
      tokenId: "12345",
      newPriceLower: "0.0004",
      newPriceUpper: "0.0006",
    });
    expect(r.isError).toBeFalsy();
    const sc = r.structuredContent as {
      handle: string;
      payloadFingerprint: string;
      to: string;
      data: `0x${string}`;
      newTickLower: number;
      newTickUpper: number;
      tokenId: string;
    };
    expect(sc.handle).toMatch(/^[0-9a-f-]+$/);
    expect(sc.payloadFingerprint).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sc.to).toBe(NPM);
    expect(sc.tokenId).toBe("12345");
    expect(sc.newTickLower).toBeLessThan(sc.newTickUpper);

    // Outer selector pin.
    expect(sc.data.slice(0, 10).toLowerCase()).toBe(
      UNISWAP_V3_LP_SELECTORS.multicallBytes,
    );
    expect(sc.data.slice(0, 10).toLowerCase()).toBe("0xac9650d8");

    // 3-inner-call shape with LOAD-BEARING order.
    const decoded = decodeFunctionData({
      abi: MULTICALL_BYTES_ABI,
      data: sc.data,
    });
    const [calls] = decoded.args as [readonly `0x${string}`[]];
    expect(calls.length).toBe(3);
    expect(calls[0]!.slice(0, 10).toLowerCase()).toBe(
      UNISWAP_V3_LP_SELECTORS.decreaseLiquidity,
    );
    expect(calls[1]!.slice(0, 10).toLowerCase()).toBe(
      UNISWAP_V3_LP_SELECTORS.collect,
    );
    expect(calls[2]!.slice(0, 10).toLowerCase()).toBe(
      UNISWAP_V3_LP_SELECTORS.mint,
    );
  });

  it("3-block response: PREPARE RECEIPT (composite intent only) + CHECKS PERFORMED + LEDGER NOTICE", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks();

    const r = await callTool({
      tokenId: "12345",
      newPriceLower: "0.0004",
      newPriceUpper: "0.0006",
    });
    expect(r.isError).toBeFalsy();
    expect(r.content.length).toBe(3);
    const receipt = r.content[0]?.text ?? "";
    const checks = r.content[1]?.text ?? "";
    const ledger = r.content[2]?.text ?? "";

    expect(receipt).toMatch(/PREPARE RECEIPT — Uniswap V3 rebalance/);
    expect(receipt).toMatch(/tokenId:\s+12345/);
    expect(receipt).toMatch(/newPriceLower:\s+0.0004/);
    expect(receipt).toMatch(/newPriceUpper:\s+0.0006/);
    expect(receipt).toMatch(/newTickLower:/);
    expect(receipt).toMatch(/newTickUpper:/);
    // Receipt records composite intent ONLY — no inner-step args baked in.
    expect(receipt).not.toMatch(/amount0Desired/);
    expect(receipt).not.toMatch(/decreaseLiquidity/);

    expect(checks).toMatch(/CHECKS PERFORMED/);
    expect(checks).toMatch(/outerSelector:\s+0xac9650d8/);
    expect(checks).toMatch(
      /innerSteps:\s+3 — decreaseLiquidity .* → collect .* → mint .*; LOAD-BEARING order/,
    );
    expect(checks).toMatch(/oldLiquidity:.*100% will be decreased/);

    expect(ledger).toMatch(
      /LEDGER NOTICE — Uniswap V3 LP operations blind-sign on device/,
    );
  });

  it("composeRebalanceCalldata SOT helper is called exactly once (Pitfall 7 — SOT discipline)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupMocks();

    const spy = vi.spyOn(_uniswapV3LpProtocol, "composeRebalanceCalldata");
    try {
      await callTool({
        tokenId: "12345",
        newPriceLower: "0.0004",
        newPriceUpper: "0.0006",
      });
      expect(spy).toHaveBeenCalledTimes(1);
      // tokenId BigInt + 100% existingLiquidity routed through the helper.
      const callArgs = spy.mock.calls[0]![0];
      expect(callArgs.tokenId).toBe(12345n);
      expect(callArgs.existingLiquidity).toBe(1_000_000_000_000_000n);
      expect(callArgs.collectRecipient).toBe(PERSONA);
      expect(callArgs.mintParams.recipient).toBe(PERSONA);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("prepare_uniswap_v3_rebalance — register-all wiring smoke", () => {
  it("is registered", () => {
    expect(listRegisteredTools().map((t) => t.name)).toContain(
      "prepare_uniswap_v3_rebalance",
    );
  });
});
