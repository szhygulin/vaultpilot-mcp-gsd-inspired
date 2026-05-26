// prepare_curve_swap tests — Phase 34 Plan 34-03 Task 2 (CRV-02).
//
// Coverage matrix:
//   T1:  chain gate — non-ethereum chain refuses (CHAIN_ID_MISMATCH)
//   T2:  pool not in registry → INVALID_INPUT
//   T3:  inputToken not in pool.coins → INVALID_INPUT
//   T4:  outputToken not in pool.coins → INVALID_INPUT
//   T5:  slippageBps out of range (0, 5001, -1) → INVALID_INPUT
//   T6:  decimal-string overflow via parseAmountStrict → INVALID_INPUT
//   T7:  legacy stETH/ETH ETH-in path (i=0, j=1) → valueWei === amountIn, selector 0x3df02124
//   T8:  legacy stETH/ETH stETH-in path (i=1, j=0) → valueWei === 0n, selector 0x3df02124
//   T9:  stable_ng path (PayPool i=0, j=1) → valueWei=0n, selector 0xddc1f59d, _receiver=fromAddress
//   T10: min_dy bigint math regression: quoted=1e18, slippageBps=50 → 995_000000000000000n
//   T11: Fixture CRV-B cross-link (LOAD-BEARING) → payloadFingerprint === FIXTURE_CRV_B_FP
//   T12: approval pre-flight surface: allowance=0n → CHECKS PERFORMED has "Approval required:"
//   T13: NO sandwich-MEV refusal: slippageBps=5000 (50%) still succeeds
//   T14: CHECKS PERFORMED contains literal MEV documentation line
//   T15: register-all wiring smoke

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address, type Hex } from "viem";

// ---------------------------------------------------------------------------
// Hoisted spies — must be declared before any imports that trigger module init
// ---------------------------------------------------------------------------
const { getStatusSpy, getCurveGetDySpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getCurveGetDySpy: vi.fn(),
}));

// Mock session-manager so resolveFrom resolves to our test persona
vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from prepare_curve_swap tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

// Mock getChainClient so readContract is controllable
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

// Mock _curveChain so we control getCurveGetDy without live RPC
vi.mock("../src/chains/curve.js", async () => {
  const actual = await vi.importActual<typeof import("../src/chains/curve.js")>(
    "../src/chains/curve.js",
  );
  return {
    ...actual,
    _curveChain: {
      getCurveGetDy: getCurveGetDySpy,
      getCurveCalcTokenAmount: vi.fn(),
      getCurveLpBalance: vi.fn(),
    },
  };
});

import {
  getCurvePoolByAddress,
} from "../src/config/contracts.js";
import { CURVE_SELECTORS } from "../src/protocols/curve.js";
import { computePayloadFingerprint } from "../src/signing/payload-fingerprint.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { FIXTURE_CRV_B_FP } from "./signing-fingerprint.test.js";

await import("../src/tools/prepare_curve_swap.js");

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------
const FIXTURE_PERSONA: Address = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

const STETH_ETH_POOL = getAddress("0xDC24316b9AE028F1497c275EB9192a3Ea0f67022"); // legacy
const PAY_POOL      = getAddress("0x383E6b4437b59fff47B619CBA855CA29342A8559"); // stable_ng PYUSD/USDC
const ETH_SENTINEL  = getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
const STETH_ADDR    = getAddress("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84");
const PYUSD_ADDR    = getAddress("0x6c3ea9036406852006290770BEdFcAbA0e23A0e8");
const USDC_ADDR     = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const NON_REGISTRY  = getAddress("0x1111111111111111111111111111111111111111");

const PAIRED_STATUS = {
  paired: true as const,
  accounts: [FIXTURE_PERSONA as `0x${string}`],
  activeAccount: FIXTURE_PERSONA as `0x${string}`,
  address: FIXTURE_PERSONA as `0x${string}`,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_curve_swap");
  if (!tool) throw new Error("prepare_curve_swap not registered");
  return tool.handler(args);
}

function setupStdMocks(quotedDy = 1_000_000_000_000_000_000n): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getCurveGetDySpy.mockResolvedValue(quotedDy);
  // readContract = allowance check (ERC-20 allowance)
  mockReadContract.mockResolvedValue(0n); // default: no allowance
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  _resetHandleStoreForTesting();
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  getStatusSpy.mockReset();
  getCurveGetDySpy.mockReset();
  mockReadContract.mockReset();
});

afterEach(() => {
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

// ===========================================================================
// T1: Chain gate
// ===========================================================================
describe("prepare_curve_swap — chain gate", () => {
  it("non-ethereum chain → isError + CHAIN_ID_MISMATCH", async () => {
    const result = await callTool({
      chain: "arbitrum",
      poolAddress: STETH_ETH_POOL,
      inputToken: STETH_ADDR,
      outputToken: ETH_SENTINEL,
      amount: "1.0",
      slippageBps: 100,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("CHAIN_ID_MISMATCH");
  });
});

// ===========================================================================
// T2: Pool not in registry
// ===========================================================================
describe("prepare_curve_swap — pool registry gate", () => {
  it("non-registry poolAddress → isError + INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: NON_REGISTRY,
      inputToken: USDC_ADDR,
      outputToken: STETH_ADDR,
      amount: "1.0",
      slippageBps: 100,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(String(sc.message || "")).toContain("not in curated Curve registry");
  });
});

// ===========================================================================
// T3 + T4: Token index resolution
// ===========================================================================
describe("prepare_curve_swap — token validation", () => {
  it("inputToken not in pool.coins → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      inputToken: STETH_ADDR, // not in PayPool (PYUSD/USDC pool)
      outputToken: USDC_ADDR,
      amount: "1.0",
      slippageBps: 100,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(String(sc.message || "")).toContain("inputToken");
  });

  it("outputToken not in pool.coins → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      inputToken: PYUSD_ADDR,
      outputToken: STETH_ADDR, // not in PayPool
      amount: "1.0",
      slippageBps: 100,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(String(sc.message || "")).toContain("outputToken");
  });
});

// ===========================================================================
// T5: slippageBps validation
// ===========================================================================
describe("prepare_curve_swap — slippageBps validation", () => {
  it("slippageBps=0 → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      inputToken: PYUSD_ADDR,
      outputToken: USDC_ADDR,
      amount: "1.0",
      slippageBps: 0,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("slippageBps=5001 → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      inputToken: PYUSD_ADDR,
      outputToken: USDC_ADDR,
      amount: "1.0",
      slippageBps: 5001,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("slippageBps=-1 → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      inputToken: PYUSD_ADDR,
      outputToken: USDC_ADDR,
      amount: "1.0",
      slippageBps: -1,
    });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// T6: Decimal-string overflow (parseAmountStrict)
// ===========================================================================
describe("prepare_curve_swap — decimal-string parse", () => {
  it("too many decimal places for 6-dec PYUSD → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      inputToken: PYUSD_ADDR,
      outputToken: USDC_ADDR,
      amount: "1.0000001", // 7 decimal places for 6-dec token
      slippageBps: 100,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

// ===========================================================================
// T7 + T8: Legacy stETH/ETH — abiVersion dispatch
// ===========================================================================
describe("prepare_curve_swap — legacy stETH/ETH abiVersion dispatch", () => {
  it("T7: ETH-in path (inputToken=ETH sentinel, i=0) → valueWei === amountIn, selector 0x3df02124", async () => {
    setupStdMocks(990_000_000_000_000_000n); // quoted 0.99 ETH
    // ETH-in: inputToken is ETH sentinel (coins[0])
    const result = await callTool({
      chain: "ethereum",
      poolAddress: STETH_ETH_POOL,
      inputToken: ETH_SENTINEL, // i=0
      outputToken: STETH_ADDR,  // j=1
      amount: "1.0",           // 1 ETH (18 decimals)
      slippageBps: 100,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    // ETH-in: valueWei === amountIn (1e18)
    expect(sc.valueWei).toBe("1000000000000000000");
    // Selector check
    expect(String(sc.data).slice(0, 10).toLowerCase()).toBe(CURVE_SELECTORS.exchangeLegacy);
    expect(sc.isEthIn).toBe(true);
    expect(sc.abiVersion).toBe("legacy");
  });

  it("T8: stETH-in path (inputToken=stETH, i=1) → valueWei === '0', selector 0x3df02124", async () => {
    setupStdMocks(990_000_000_000_000_000n); // quoted 0.99 stETH
    // stETH-in: inputToken is stETH (coins[1])
    const result = await callTool({
      chain: "ethereum",
      poolAddress: STETH_ETH_POOL,
      inputToken: STETH_ADDR,   // i=1
      outputToken: ETH_SENTINEL, // j=0
      amount: "1.0",            // 1 stETH
      slippageBps: 100,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    // stETH-in: valueWei === 0 (not payable ETH-in)
    expect(sc.valueWei).toBe("0");
    expect(String(sc.data).slice(0, 10).toLowerCase()).toBe(CURVE_SELECTORS.exchangeLegacy);
    expect(sc.isEthIn).toBe(false);
    expect(sc.abiVersion).toBe("legacy");
  });
});

// ===========================================================================
// T9: stable_ng path
// ===========================================================================
describe("prepare_curve_swap — stable_ng path", () => {
  it("T9: PayPool (PYUSD→USDC, i=0, j=1) → valueWei=0n, selector 0xddc1f59d, _receiver=fromAddress", async () => {
    setupStdMocks(99_000000n); // quoted 99 USDC
    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      inputToken: PYUSD_ADDR,  // i=0
      outputToken: USDC_ADDR,  // j=1
      amount: "100",           // 100 PYUSD (6 dec)
      slippageBps: 100,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.valueWei).toBe("0");
    expect(String(sc.data).slice(0, 10).toLowerCase()).toBe(CURVE_SELECTORS.exchangeNg);
    expect(sc.abiVersion).toBe("stable_ng");
    // _receiver = fromAddress (FIXTURE_PERSONA) embedded in calldata
    // Verify last 32 bytes of calldata contain the padded receiver address
    const dataHex = String(sc.data).toLowerCase();
    // FIXTURE_PERSONA without 0x, lowercased, padded to 32 bytes
    const personaHex = FIXTURE_PERSONA.toLowerCase().slice(2).padStart(64, "0");
    expect(dataHex.endsWith(personaHex)).toBe(true);
  });
});

// ===========================================================================
// T10: min_dy bigint math regression
// ===========================================================================
describe("prepare_curve_swap — min_dy bigint math", () => {
  it("T10: quoted=1e18, slippageBps=50 → minDy === 995_000000000000000n", async () => {
    setupStdMocks(1_000_000_000_000_000_000n);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: STETH_ETH_POOL,
      inputToken: STETH_ADDR,   // i=1
      outputToken: ETH_SENTINEL, // j=0
      amount: "1.0",
      slippageBps: 50,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.minDy).toBe("995000000000000000"); // 995_000000000000000n
  });
});

// ===========================================================================
// T11: Fixture CRV-B cross-link (LOAD-BEARING)
// ===========================================================================
describe("prepare_curve_swap — Fixture CRV-B cross-link (LOAD-BEARING)", () => {
  it("T11: PayPool, PYUSD→USDC, amount=100, minDy=99e6 with FIXTURE_PERSONA from → payloadFingerprint === FIXTURE_CRV_B_FP", async () => {
    // Fixture CRV-B: stable_ng exchange(i=0, j=1, dx=100e6 PYUSD, min_dy=99e6 USDC,
    // _receiver=FIXTURE_PERSONA) on PayPool.
    // getCurveGetDy returns exactly 99_000000n so minDy = 99_000000 * 9900/10000 = ...
    // Actually: minDy = (quoted * (10000-slippageBps)) / 10000
    // We need minDy = 99_000000n
    // So if slippageBps=0, minDy = quoted. But slippageBps must be >= 1.
    // Let's use slippageBps=100 and quoted=99_990000n (so minDy = 99_990000 * 9900/10000 = 98_990100n)
    // That won't match the fixture.
    //
    // Looking at the fixture: CRV-B has minDy=99e6 and dx=100e6.
    // To get minDy=99_000000n with slippageBps=100 (1%), quoted must be:
    //   99_000000 = quotedDy * 9900 / 10000
    //   quotedDy = 99_000000 * 10000 / 9900 = 100_000000n (approximately)
    //   100_000000 * 9900 / 10000 = 99_000000n ✓
    //
    // So: quotedDy = 100_000000n, slippageBps=100 → minDy = 99_000000n
    getCurveGetDySpy.mockResolvedValue(100_000000n);
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    mockReadContract.mockResolvedValue(1000000000n); // allowance high enough

    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      inputToken: PYUSD_ADDR,  // i=0
      outputToken: USDC_ADDR,  // j=1
      amount: "100",           // 100 PYUSD (6 dec) → 100_000000n
      slippageBps: 100,        // 1% → minDy = 99_000000n
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;

    // Verify decoded values
    expect(sc.amountIn).toBe("100000000");
    expect(sc.minDy).toBe("99000000");

    // LOAD-BEARING: byte-identity of payloadFingerprint vs Plan 34-01 anchor
    expect(sc.payloadFingerprint).toBe(FIXTURE_CRV_B_FP);
  });
});

// ===========================================================================
// T12: Approval pre-flight surface
// ===========================================================================
describe("prepare_curve_swap — approval pre-flight", () => {
  it("T12: allowance=0n → CHECKS PERFORMED contains 'Approval required:'", async () => {
    setupStdMocks(99_000000n);
    mockReadContract.mockResolvedValue(0n); // zero allowance

    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      inputToken: PYUSD_ADDR,
      outputToken: USDC_ADDR,
      amount: "100",
      slippageBps: 100,
    });
    expect(result.isError).toBeFalsy();
    const texts = (result.content as Array<{ type: string; text: string }>).map(c => c.text).join("\n");
    expect(texts).toContain("Approval required:");
  });

  it("approval pre-flight SKIPPED for ETH-in (no ERC-20 approval needed)", async () => {
    setupStdMocks(990_000_000_000_000_000n);
    // readContract should NOT be called for allowance when ETH-in
    const result = await callTool({
      chain: "ethereum",
      poolAddress: STETH_ETH_POOL,
      inputToken: ETH_SENTINEL, // ETH-in
      outputToken: STETH_ADDR,
      amount: "1.0",
      slippageBps: 100,
    });
    expect(result.isError).toBeFalsy();
    // mockReadContract should NOT have been called (no allowance check for ETH)
    expect(mockReadContract).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// T13: No sandwich-MEV refusal even at slippageBps=5000
// ===========================================================================
describe("prepare_curve_swap — no sandwich-MEV gate", () => {
  it("T13: slippageBps=5000 (50%) → success (NOT refused — asymmetric to Phase 32 UniV3)", async () => {
    setupStdMocks(99_000000n);
    mockReadContract.mockResolvedValue(1000000000n); // allowance ok

    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      inputToken: PYUSD_ADDR,
      outputToken: USDC_ADDR,
      amount: "100",
      slippageBps: 5000, // 50% — would trigger MEV gate on UniV3
    });
    // Must succeed, NOT return an error
    expect(result.isError).toBeFalsy();
  });
});

// ===========================================================================
// T14: CHECKS PERFORMED MEV documentation line
// ===========================================================================
describe("prepare_curve_swap — MEV documentation line", () => {
  it("T14: CHECKS PERFORMED contains literal 'Sandwich-MEV gate: not applied to Curve (low MEV exposure on stable pools)'", async () => {
    setupStdMocks(99_000000n);
    mockReadContract.mockResolvedValue(1000000000n);

    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      inputToken: PYUSD_ADDR,
      outputToken: USDC_ADDR,
      amount: "100",
      slippageBps: 100,
    });
    expect(result.isError).toBeFalsy();
    const texts = (result.content as Array<{ type: string; text: string }>).map(c => c.text).join("\n");
    expect(texts).toContain("Sandwich-MEV gate: not applied to Curve (low MEV exposure on stable pools)");
  });
});

// ===========================================================================
// T15: register-all wiring smoke
// ===========================================================================
describe("prepare_curve_swap — register-all wiring", () => {
  it("T15: tool is registered", () => {
    const tool = getRegisteredTool("prepare_curve_swap");
    expect(tool).toBeDefined();
    expect(tool?.handler).toBeTypeOf("function");
  });
});
