// prepare_curve_add_liquidity tests — Phase 34 Plan 34-03 Task 3 (CRV-03).
//
// Coverage matrix:
//   T1:  chain gate → CHAIN_ID_MISMATCH
//   T2:  pool not in registry → INVALID_INPUT
//   T3:  legacy stETH/ETH pool → INVALID_INPUT "deferred to v2.4.x" (LOAD-BEARING refusal)
//   T4:  amounts.length mismatch (2-coin pool, 3 amounts) → INVALID_INPUT naming both lengths (Pitfall 5)
//   T5:  one element fails parseAmountStrict → INVALID_INPUT identifies failing index
//   T6:  slippageBps out of range → INVALID_INPUT
//   T7:  happy path stable_ng: selector 0xb72df5de, valueWei=0n, minMintAmount math correct
//   T8:  Fixture CRV-C cross-link (LOAD-BEARING) → payloadFingerprint === FIXTURE_CRV_C_FP
//   T9:  per-coin approval surface: coins[0] shortfall → hint; coins[1] sufficient → no hint
//   T10: CHECKS PERFORMED contains literal MEV documentation line
//   T11: register-all wiring smoke

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress, type Address } from "viem";

// ---------------------------------------------------------------------------
// Hoisted spies
// ---------------------------------------------------------------------------
const { getStatusSpy, getCurveCalcTokenAmountSpy } = vi.hoisted(() => ({
  getStatusSpy: vi.fn(),
  getCurveCalcTokenAmountSpy: vi.fn(),
}));

vi.mock("../src/wallet/session-manager.js", async () => {
  const actual = await vi.importActual<typeof import("../src/wallet/session-manager.js")>(
    "../src/wallet/session-manager.js",
  );
  return {
    ...actual,
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from prepare_curve_add_liquidity tests");
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

vi.mock("../src/chains/curve.js", async () => {
  const actual = await vi.importActual<typeof import("../src/chains/curve.js")>(
    "../src/chains/curve.js",
  );
  return {
    ...actual,
    _curveChain: {
      getCurveGetDy: vi.fn(),
      getCurveCalcTokenAmount: getCurveCalcTokenAmountSpy,
      getCurveLpBalance: vi.fn(),
    },
  };
});

import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";
import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";
import { CURVE_SELECTORS } from "../src/protocols/curve.js";
import { FIXTURE_CRV_C_FP } from "./signing-fingerprint.test.js";

await import("../src/tools/prepare_curve_add_liquidity.js");

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------
const FIXTURE_PERSONA: Address = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

const STETH_ETH_POOL = getAddress("0xDC24316b9AE028F1497c275EB9192a3Ea0f67022"); // legacy — must be refused
const PAY_POOL      = getAddress("0x383E6b4437b59fff47B619CBA855CA29342A8559"); // stable_ng PYUSD/USDC
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
  const tool = getRegisteredTool("prepare_curve_add_liquidity");
  if (!tool) throw new Error("prepare_curve_add_liquidity not registered");
  return tool.handler(args);
}

function setupStdMocks(quotedLp = 100_000000000000000000n): void {
  getStatusSpy.mockResolvedValue(PAIRED_STATUS);
  getCurveCalcTokenAmountSpy.mockResolvedValue(quotedLp);
  mockReadContract.mockResolvedValue(0n); // default: no allowance
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

beforeEach(() => {
  // Pin to real-mode deterministically (see commit c537628 / #140).
  savedDemo = process.env[DEMO_KEY];
  process.env[DEMO_KEY] = "false";
  _resetHandleStoreForTesting();
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
  getStatusSpy.mockReset();
  getCurveCalcTokenAmountSpy.mockReset();
  mockReadContract.mockReset();
});

afterEach(() => {
  if (savedDemo === undefined) {
    process.env[DEMO_KEY] = "false";
  } else {
    process.env[DEMO_KEY] = savedDemo;
  }
  _resetDemoModeForTesting();
  _resetActivePersonaForTesting();
});

// ===========================================================================
// T1: Chain gate
// ===========================================================================
describe("prepare_curve_add_liquidity — chain gate", () => {
  it("T1: non-ethereum chain → CHAIN_ID_MISMATCH", async () => {
    const result = await callTool({
      chain: "polygon",
      poolAddress: PAY_POOL,
      amounts: ["50", "50"],
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
describe("prepare_curve_add_liquidity — pool registry gate", () => {
  it("T2: non-registry poolAddress → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: NON_REGISTRY,
      amounts: ["50", "50"],
      slippageBps: 100,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

// ===========================================================================
// T3: Legacy refusal (LOAD-BEARING)
// ===========================================================================
describe("prepare_curve_add_liquidity — legacy refusal", () => {
  it("T3: legacy stETH/ETH pool → INVALID_INPUT 'deferred to v2.4.x' (LOAD-BEARING)", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: STETH_ETH_POOL, // legacy pool
      amounts: ["50", "50"],
      slippageBps: 100,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    const msg = String(sc.message || "");
    expect(msg).toContain("deferred to v2.4.x");
    // cause should identify the refusal
    const cause = String((sc as Record<string, unknown>).cause || "");
    expect(cause).toContain("legacy-add-liquidity-refused");
  });
});

// ===========================================================================
// T4: amounts.length mismatch (Pitfall 5 anchor)
// ===========================================================================
describe("prepare_curve_add_liquidity — amounts.length validation", () => {
  it("T4: 2-coin pool, 3 amounts → INVALID_INPUT naming both lengths (Pitfall 5)", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL, // 2-coin stable_ng
      amounts: ["50", "50", "50"], // 3 amounts for 2-coin pool
      slippageBps: 100,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    const msg = String(sc.message || "");
    // Must name both lengths
    expect(msg).toContain("3");
    expect(msg).toContain("2");
  });

  it("T4b: 2-coin pool, 1 amount → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      amounts: ["50"], // 1 amount for 2-coin pool
      slippageBps: 100,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

// ===========================================================================
// T5: Per-element parseAmountStrict failure with index identification
// ===========================================================================
describe("prepare_curve_add_liquidity — per-element parse failure", () => {
  it("T5: amounts[1] has too many decimals → INVALID_INPUT names failing index", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL, // coinDecimals: [6, 6]
      amounts: ["50", "50.1234567"], // 7 decimals for 6-dec USDC
      slippageBps: 100,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    const msg = String(sc.message || "");
    expect(msg).toContain("amounts[1]");
  });
});

// ===========================================================================
// T6: slippageBps out of range
// ===========================================================================
describe("prepare_curve_add_liquidity — slippageBps validation", () => {
  it("T6: slippageBps=0 → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      amounts: ["50", "50"],
      slippageBps: 0,
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("T6b: slippageBps=5001 → INVALID_INPUT", async () => {
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      amounts: ["50", "50"],
      slippageBps: 5001,
    });
    expect(result.isError).toBe(true);
  });
});

// ===========================================================================
// T7: Happy path stable_ng
// ===========================================================================
describe("prepare_curve_add_liquidity — happy path", () => {
  it("T7: PayPool stable_ng, amounts=['100','100'], slippageBps=100 → selector 0xb72df5de, valueWei=0", async () => {
    setupStdMocks(100_000000000000000000n); // quoted 100e18 LP
    mockReadContract.mockResolvedValue(1000000000n); // sufficient allowance

    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      amounts: ["100", "100"],
      slippageBps: 100, // 1% → minMintAmount = 100e18 * 9900 / 10000 = 99e18
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.valueWei).toBe("0");
    expect(String(sc.data).slice(0, 10).toLowerCase()).toBe(CURVE_SELECTORS.addLiquidityNg);
    // minMintAmount = 100e18 * 9900 / 10000 = 99e18
    expect(sc.minMintAmount).toBe("99000000000000000000");
  });

  it("T7b: minMintAmount bigint math: quoted=100e18, slippageBps=100 → 99e18", async () => {
    setupStdMocks(100_000000000000000000n);
    mockReadContract.mockResolvedValue(1000000000n);

    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      amounts: ["100", "100"],
      slippageBps: 100,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(BigInt(sc.minMintAmount as string)).toBe(99_000000000000000000n);
  });
});

// ===========================================================================
// T8: Fixture CRV-C cross-link (LOAD-BEARING)
// ===========================================================================
describe("prepare_curve_add_liquidity — Fixture CRV-C cross-link (LOAD-BEARING)", () => {
  it("T8: PayPool, amounts=['50','50'], minMintAmount=99e18 with FIXTURE_PERSONA → payloadFingerprint === FIXTURE_CRV_C_FP", async () => {
    // Fixture CRV-C: stable_ng add_liquidity([50e6 PYUSD, 50e6 USDC], min_mint=99e18)
    // on PayPool (0x383E6b4437b59fff47B619CBA855CA29342A8559).
    //
    // To get minMintAmount = 99_000000000000000000n with slippageBps=100:
    //   quotedLp * 9900 / 10000 = 99e18
    //   quotedLp = 99e18 * 10000 / 9900 = 100e18
    getCurveCalcTokenAmountSpy.mockResolvedValue(100_000000000000000000n);
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    mockReadContract.mockResolvedValue(1000000000n); // sufficient allowance

    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      amounts: ["50", "50"], // [50 PYUSD, 50 USDC] → [50_000000n, 50_000000n] (6 dec each)
      slippageBps: 100,      // 1% → minMintAmount = 99_000000000000000000n
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;

    // Verify parsed amounts
    expect(sc.parsedAmounts).toEqual(["50000000", "50000000"]);
    expect(sc.minMintAmount).toBe("99000000000000000000");

    // LOAD-BEARING: byte-identity of payloadFingerprint vs Plan 34-01 anchor
    expect(sc.payloadFingerprint).toBe(FIXTURE_CRV_C_FP);
  });
});

// ===========================================================================
// T9: Per-coin approval surface
// ===========================================================================
describe("prepare_curve_add_liquidity — per-coin approval surface", () => {
  it("T9: coins[0] allowance=0n → 'Approval required:' hint; coins[1] sufficient → no hint for coins[1]", async () => {
    getCurveCalcTokenAmountSpy.mockResolvedValue(100_000000000000000000n);
    getStatusSpy.mockResolvedValue(PAIRED_STATUS);
    // readContract called once per non-zero coin: first=0n (shortfall), second=MAX allowance
    mockReadContract
      .mockResolvedValueOnce(0n)           // coins[0] allowance = 0 (shortfall)
      .mockResolvedValueOnce(BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")); // coins[1] = MAX

    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      amounts: ["50", "50"],
      slippageBps: 100,
    });
    expect(result.isError).toBeFalsy();
    const texts = (result.content as Array<{ type: string; text: string }>).map(c => c.text).join("\n");

    // coins[0] (PYUSD) should have approval hint
    expect(texts).toContain("Approval required:");
    expect(texts).toContain(PYUSD_ADDR.toLowerCase());
    // coins[1] (USDC) should NOT have approval hint — sufficient allowance
    const pyusdHintIndex = texts.indexOf("Approval required:");
    const usdcApprovalIndex = texts.indexOf("Approval required:", pyusdHintIndex + 1);
    // Only one "Approval required:" hint
    expect(usdcApprovalIndex).toBe(-1);
  });
});

// ===========================================================================
// T10: CHECKS PERFORMED MEV documentation line
// ===========================================================================
describe("prepare_curve_add_liquidity — MEV documentation line", () => {
  it("T10: CHECKS PERFORMED contains literal 'Sandwich-MEV gate: not applied to Curve ...'", async () => {
    setupStdMocks();
    mockReadContract.mockResolvedValue(1000000000n);

    const result = await callTool({
      chain: "ethereum",
      poolAddress: PAY_POOL,
      amounts: ["50", "50"],
      slippageBps: 100,
    });
    expect(result.isError).toBeFalsy();
    const texts = (result.content as Array<{ type: string; text: string }>).map(c => c.text).join("\n");
    expect(texts).toContain("Sandwich-MEV gate: not applied to Curve (low MEV exposure on stable pools)");
  });
});

// ===========================================================================
// T11: register-all wiring
// ===========================================================================
describe("prepare_curve_add_liquidity — register-all wiring", () => {
  it("T11: tool is registered", () => {
    const tool = getRegisteredTool("prepare_curve_add_liquidity");
    expect(tool).toBeDefined();
    expect(tool?.handler).toBeTypeOf("function");
  });
});
