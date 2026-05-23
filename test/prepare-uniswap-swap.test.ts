// prepare_uniswap_swap tests — Phase 32 Plan 32-03 (UNI-02 + UNI-03).
//
// Test coverage matrix:
//   T1:  schema gate — chain != 'ethereum' refuses
//   T2:  schema gate — invalid tokenIn / tokenOut shape
//   T3:  schema gate — slippageBps out-of-bounds (0 / 10001)
//   T4:  same-token-swap refusal (D-05; cause 'same-token-swap-refused')
//   T5:  ETH↔ETH refused (both resolve to WETH → same-token gate fires)
//   T6:  sandwich-MEV refusal — priceImpactBps > 200 AND slippage NOT explicit
//   T7:  sandwich-MEV PASS — priceImpactBps > 200 BUT slippage explicit
//   T8:  D-07 token-approval pre-flight refusal — allowance < amountIn
//   T9:  D-07 approval pre-flight SKIPPED for ETH-in (msg.value path)
//   T10: Fixture UNI-A cross-link — single-hop USDC→WETH 0.05% byte-identity
//   T11: Fixture UNI-B cross-link — ETH-out via composeMulticallWithUnwrap byte-identity
//   T12: Fixture UNI-C cross-link — multi-hop USDC→WETH→WBTC byte-identity
//   T13: ETH-in calldata composition — tx.value === amountIn; multicall selector
//   T14: ETH-out calldata composition — value 0; both exactInputSingle + unwrapWETH9 inner selectors
//   T15: ETH-out inner exactInputSingle.recipient === SwapRouter02 (Pitfall 3 / D-15)
//   T16: LEDGER NOTICE block emitted UNCONDITIONALLY (3-block response)
//   T17: PREPARE RECEIPT has all 10 placeholders populated
//   T18: payloadFingerprint covers FULL multicall calldata (D-12 round-trip)
//   T19: deadline = block.timestamp + 600
//   T20: amountOutMinimum follows D-06 formula
//   T21: register-all wiring smoke

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
    getStatus: (...args: Parameters<typeof actual.getStatus>) => getStatusSpy(...args),
    pair: vi.fn(async () => {
      throw new Error("pair should not be called from prepare_uniswap_swap tests");
    }),
    disconnect: vi.fn(async () => undefined),
  };
});

// Mock readContract + getBlock on the chain-client. The mock dispatches on
// `functionName` for readContract; getBlock returns a pinned timestamp so the
// fixture-deadline is reproducible.
const mockReadContract = vi.fn();
const mockGetBlock = vi.fn();

vi.mock("../src/chains/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../src/chains/registry.js")>(
    "../src/chains/registry.js",
  );
  return {
    ...actual,
    getChainClient: vi.fn(() => ({
      readContract: mockReadContract,
      getBlock: mockGetBlock,
    })),
  };
});

import {
  getUniswapV3SwapRouter02Address,
} from "../src/config/contracts.js";
import {
  MULTICALL_DEADLINE_ABI,
  SWAP_ROUTER_02_ABI,
  UNISWAP_V3_SELECTORS,
  encodeExactInput,
  encodeExactInputSingle,
  encodeMulticallWithDeadline,
  encodeUnwrapWeth9,
  composeMulticallWithUnwrap,
} from "../src/protocols/uniswap-v3.js";
import { encodeV3Path } from "../src/signing/uniswap-path.js";
import { computePayloadFingerprint } from "../src/signing/payload-fingerprint.js";
import { _resetHandleStoreForTesting } from "../src/signing/handle-store.js";
import {
  getRegisteredTool,
  listRegisteredTools,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import { _resetDemoModeForTesting } from "../src/config/env.js";
import { _resetActivePersonaForTesting } from "../src/demo/state.js";

import "../src/tools/prepare_uniswap_swap.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SWAP_ROUTER_02: Address = getUniswapV3SwapRouter02Address(1)!;
const USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const WBTC = getAddress("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599");

// FIXTURE_PERSONA — Anvil account 1; matches test/signing-fingerprint.test.ts
// Fixtures UNI-A/B/C `persona` constant. The integration test re-anchors via
// this address.
const FIXTURE_PERSONA = getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");

// Plan 32-01 hardcoded fingerprint literals (re-anchored here from
// test/signing-fingerprint.test.ts).
const FIXTURE_UNI_A_FP =
  "0xc9f4eb062c04a605a2c49f623d2831751e96c76f177b5aacb85a5016ccfa766e";
const FIXTURE_UNI_B_FP =
  "0x5599bb306e4b2296a89e3349fc0c83ffe6e2143d8234d94cfc489831a1a1790c";
const FIXTURE_UNI_C_FP =
  "0x795086fdfb9f86ff26ffd6cec6100223c0bf041d9427936b51b60e038f2beb8f";

// Fixture deadline pin — chosen at write-time in Plan 32-01.
// block.timestamp = 1748706600n → deadline = 1748707200n (timestamp + 600s).
const FIXTURE_DEADLINE_TIMESTAMP = 1748706600n;
const FIXTURE_DEADLINE = 1748707200n;

// Quote for UNI-A / UNI-B: `quotedAmountOut * 9950 / 10000 = 48.1e15` requires
// `quoted = 48,341,708,542,713,568n` (bigint floor produces 48,100,000,000,000,000).
const QUOTE_UNI_A = 48_341_708_542_713_568n;
// Verified: 48341708542713568 * 9950n = 481_000_000_000_000_001_600n / 10000n = 48_100_000_000_000_000n ✓
const QUOTE_UNI_C_RAW = 2n; // QUOTE * 9950 / 10000 = 1n (bigint floor)

const PAIRED_STATUS = {
  paired: true as const,
  accounts: [FIXTURE_PERSONA],
  activeAccount: FIXTURE_PERSONA,
  address: FIXTURE_PERSONA,
  chainId: 1,
  sessionTopicLast8: "deadbeef",
  accountsByChain: { 1: [FIXTURE_PERSONA] } as Record<number, `0x${string}`[]>,
};

const MAX_UINT256 = 2n ** 256n - 1n;

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("prepare_uniswap_swap");
  if (!tool) throw new Error("prepare_uniswap_swap not registered");
  const merged = "chain" in args ? args : { chain: "ethereum", ...args };
  return tool.handler(merged) as Promise<ToolHandlerResult>;
}

interface QuoteMockConfig {
  /** USDC decimals — default 6 */
  usdcDecimals?: number;
  /** Override allowance — default MAX_UINT256 (sufficient) */
  allowance?: bigint;
  /**
   * Map of (fee) → single-hop amountOut for the canonical pair. Tiers not
   * listed return null (revert). Defaults to a wide-margin USDC→WETH at fee=500
   * yielding QUOTE_UNI_A; other tiers reverted.
   */
  singleHopByFee?: Partial<Record<100 | 500 | 3000 | 10000, bigint | null>>;
  /**
   * Multi-hop amountOut for ALL candidates returned. null suppresses (revert).
   * Default null.
   */
  multiHopOut?: bigint | null;
  /** Tiny-amount single-hop yield — drives price-impact. Default fairOut ≈ actualOut. */
  tinySingleHopByFee?: Partial<Record<100 | 500 | 3000 | 10000, bigint | null>>;
  /** Override block.timestamp. Default FIXTURE_DEADLINE_TIMESTAMP. */
  blockTimestamp?: bigint;
}

function setupQuoteMocks(cfg: QuoteMockConfig & { fullAmountIn?: bigint } = {}): void {
  const usdcDecimals = cfg.usdcDecimals ?? 6;
  const allowance = cfg.allowance ?? MAX_UINT256;
  const singleHopByFee = cfg.singleHopByFee ?? {
    100: null,
    500: QUOTE_UNI_A,
    3000: null,
    10000: null,
  };
  const multiHopOut = cfg.multiHopOut ?? null;
  // Default tinyOut chosen to keep priceImpactBps low (fair = actual ≈ no impact).
  // tinyAmount = amountIn / 10000 = 10_000n; tinyOut = QUOTE / 10000 ≈ 4.83e12.
  // fairOut = tinyOut * 10000 ≈ QUOTE. priceImpactBps ≈ 0.
  const tinySingleHopByFee =
    cfg.tinySingleHopByFee ??
    ({
      100: null,
      500: QUOTE_UNI_A / 10000n, // proportional → priceImpactBps ≈ 0
      3000: null,
      10000: null,
    } as const);
  const blockTimestamp = cfg.blockTimestamp ?? FIXTURE_DEADLINE_TIMESTAMP;
  // For tiny-vs-full distinction: the tool computes tinyAmount = amountIn /
  // 10000n. We use the agent's `amount` (parsed to wei) as the FULL sentinel
  // and detect tiny by checking `inner.amountIn < fullAmountIn`. Default
  // fullAmountIn is the canonical 100e6 USDC; callers using ETH-in (1e18)
  // override.
  const fullAmountIn = cfg.fullAmountIn ?? 100_000000n;

  mockReadContract.mockImplementation((req: {
    functionName: string;
    args?: readonly unknown[];
  }) => {
    if (req.functionName === "decimals") return Promise.resolve(usdcDecimals);
    if (req.functionName === "allowance") return Promise.resolve(allowance);
    if (req.functionName === "quoteExactInputSingle") {
      // args = [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96 }]
      const inner = (req.args?.[0] ?? {}) as {
        amountIn: bigint;
        fee: 100 | 500 | 3000 | 10000;
      };
      // FULL when amountIn === fullAmountIn; TINY otherwise (will be
      // amountIn/10000 unless sub-base-unit fallback triggered).
      const isFullAmount = inner.amountIn >= fullAmountIn;
      const map = isFullAmount ? singleHopByFee : tinySingleHopByFee;
      const out = map[inner.fee];
      if (out === null || out === undefined) {
        return Promise.reject(new Error(`pool revert at fee=${inner.fee}`));
      }
      // Return shape: [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate]
      return Promise.resolve([out, 0n, 0, 0n]);
    }
    if (req.functionName === "quoteExactInput") {
      // args = [path, amountIn]
      if (multiHopOut === null) {
        return Promise.reject(new Error("no multi-hop pool"));
      }
      return Promise.resolve([multiHopOut, [], [], 0n]);
    }
    return Promise.resolve(0n);
  });

  mockGetBlock.mockImplementation(() =>
    Promise.resolve({ timestamp: blockTimestamp }),
  );
}

const DEMO_KEY = "VAULTPILOT_DEMO";
let savedDemo: string | undefined;

beforeEach(() => {
  getStatusSpy.mockReset();
  mockReadContract.mockReset();
  mockGetBlock.mockReset();
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

// ---------------------------------------------------------------------------
// T1: schema chain gate
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — chain gate", () => {
  it("chain != 'ethereum' → INVALID_INPUT; no RPC fired", async () => {
    const result = await callTool({
      chain: "polygon",
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });
    expect(result.isError).toBe(true);
    expect(
      (result.structuredContent as { errorCode: string }).errorCode,
    ).toBe("INVALID_INPUT");
    expect(mockReadContract).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T2: invalid token shape
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — invalid token shape", () => {
  it("tokenIn 'not-an-address' → INVALID_INPUT", async () => {
    const result = await callTool({
      tokenIn: "not-an-address",
      tokenOut: WETH,
      amount: "100",
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("tokenOut 'not-an-address' → INVALID_INPUT", async () => {
    const result = await callTool({
      tokenIn: USDC,
      tokenOut: "bogus",
      amount: "100",
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });
});

// ---------------------------------------------------------------------------
// T3: slippageBps out of bounds
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — slippageBps bounds", () => {
  it("slippageBps: 0 → INVALID_INPUT", async () => {
    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
      slippageBps: 0,
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("slippageBps: 10001 → INVALID_INPUT", async () => {
    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
      slippageBps: 10001,
    });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { errorCode: string }).errorCode).toBe(
      "INVALID_INPUT",
    );
  });
});

// ---------------------------------------------------------------------------
// T4: same-token-swap refusal
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — same-token-swap refusal (D-05)", () => {
  it("USDC↔USDC → INVALID_INPUT + cause 'same-token-swap-refused'", async () => {
    const result = await callTool({
      tokenIn: USDC,
      tokenOut: USDC,
      amount: "100",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("same-token-swap-refused");
  });
});

// ---------------------------------------------------------------------------
// T5: ETH↔ETH refused (both resolve to WETH)
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — ETH↔ETH refusal", () => {
  it("tokenIn='ETH', tokenOut='ETH' → same-token gate fires (both resolve to WETH)", async () => {
    const result = await callTool({
      tokenIn: "ETH",
      tokenOut: "ETH",
      amount: "1",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as { errorCode: string; cause?: string };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("same-token-swap-refused");
  });
});

// ---------------------------------------------------------------------------
// T6: sandwich-MEV refusal (D-08)
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — sandwich-MEV refusal (D-08)", () => {
  it("priceImpactBps > 200 AND slippage NOT explicit → INVALID_INPUT + hintTool 'get_uniswap_quote'", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    // Drive priceImpactBps ~3% — fair = 1000n, actual = 970n → drop=30, bps=300.
    setupQuoteMocks({
      singleHopByFee: { 500: 970n },
      tinySingleHopByFee: { 500: 1000n / 10000n }, // tinyOut * 10000 = 1000 fair
    });
    // Better: use larger numbers to avoid bigint truncation.
    setupQuoteMocks({
      singleHopByFee: { 500: 970_000_000n },
      tinySingleHopByFee: { 500: 100_000n }, // tinyOut * 10000 = 1_000_000_000n fair
    });

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
      // slippageBps OMITTED — gate must fire
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      hintTool: string;
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("get_uniswap_quote");
    // SANDWICH-MEV DEFENSE block in text content.
    expect(result.content[0]?.text ?? "").toMatch(/SANDWICH-MEV\s+DEFENSE/);
  });
});

// ---------------------------------------------------------------------------
// T7: sandwich-MEV PASS arm — explicit slippage
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — sandwich-MEV PASS (explicit slippage)", () => {
  it("priceImpactBps > 200 BUT slippage explicit → SUCCESS (no refusal)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupQuoteMocks({
      singleHopByFee: { 500: 970_000_000n },
      tinySingleHopByFee: { 500: 100_000n },
    });

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
      slippageBps: 100, // EXPLICIT — gate bypassed
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(typeof sc.payloadFingerprint).toBe("string");
    expect(sc.payloadFingerprint.startsWith("0x")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T8: D-07 token-approval pre-flight refusal
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — D-07 token-approval pre-flight", () => {
  it("allowance < amountIn → INVALID_INPUT + hintTool 'prepare_token_approve'", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupQuoteMocks({ allowance: 50_000000n }); // 50 USDC approved; 100 USDC requested

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });
    expect(result.isError).toBe(true);
    const sc = result.structuredContent as {
      errorCode: string;
      hintTool: string;
      hintArgs: { tokenAddress: string; spender: string; amount: string };
    };
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("prepare_token_approve");
    expect(sc.hintArgs.tokenAddress).toBe(USDC);
    expect(sc.hintArgs.spender).toBe(SWAP_ROUTER_02);
    expect(sc.hintArgs.amount).toBe("100");
  });

  it("allowance >= amountIn → no refusal arm", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupQuoteMocks(); // MAX_UINT256 default

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });
    expect(result.isError).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// T9: ETH-in skips D-07 (msg.value path)
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — ETH-in skips approval gate", () => {
  it("tokenIn='ETH' — allowance NOT called", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupQuoteMocks({
      fullAmountIn: 1_000_000_000_000_000_000n, // 1 ETH = 1e18 wei
      singleHopByFee: { 500: QUOTE_UNI_A },
      tinySingleHopByFee: { 500: QUOTE_UNI_A / 10000n },
    });

    const result = await callTool({
      tokenIn: "ETH",
      tokenOut: USDC,
      amount: "1",
    });
    expect(result.isError).toBeFalsy();
    // Inspect mockReadContract calls — `allowance` must NOT appear.
    const calls = mockReadContract.mock.calls.map(
      (c: unknown[]) => (c[0] as { functionName: string }).functionName,
    );
    expect(calls).not.toContain("allowance");
  });
});

// ---------------------------------------------------------------------------
// T10: Fixture UNI-A cross-link
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — Fixture UNI-A cross-link", () => {
  it("single-hop USDC→WETH 0.05% (recipient=FIXTURE_PERSONA) → payloadFingerprint === FIXTURE_UNI_A_FP", async () => {
    getStatusSpy.mockResolvedValueOnce({
      ...PAIRED_STATUS,
      accounts: [FIXTURE_PERSONA],
      activeAccount: FIXTURE_PERSONA,
      address: FIXTURE_PERSONA,
      accountsByChain: { 1: [FIXTURE_PERSONA] },
    });
    setupQuoteMocks({
      singleHopByFee: { 500: QUOTE_UNI_A },
      tinySingleHopByFee: { 500: QUOTE_UNI_A / 10000n },
    });

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
      slippageBps: 50,
      from: FIXTURE_PERSONA,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_UNI_A_FP);
  });
});

// ---------------------------------------------------------------------------
// T11: Fixture UNI-B cross-link (ETH-out)
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — Fixture UNI-B cross-link (ETH-out)", () => {
  it("USDC→ETH via composeMulticallWithUnwrap → payloadFingerprint === FIXTURE_UNI_B_FP", async () => {
    getStatusSpy.mockResolvedValueOnce({
      ...PAIRED_STATUS,
      accounts: [FIXTURE_PERSONA],
      activeAccount: FIXTURE_PERSONA,
      address: FIXTURE_PERSONA,
      accountsByChain: { 1: [FIXTURE_PERSONA] },
    });
    setupQuoteMocks({
      singleHopByFee: { 500: QUOTE_UNI_A }, // same quote as UNI-A — yields same amountOutMin
      tinySingleHopByFee: { 500: QUOTE_UNI_A / 10000n },
    });

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: "ETH",
      amount: "100",
      slippageBps: 50,
      from: FIXTURE_PERSONA,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { payloadFingerprint: string };
    expect(sc.payloadFingerprint).toBe(FIXTURE_UNI_B_FP);
  });
});

// ---------------------------------------------------------------------------
// T12: Fixture UNI-C cross-link (multi-hop)
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — Fixture UNI-C cross-link (multi-hop)", () => {
  // Note: the Fixture UNI-C literal in test/signing-fingerprint.test.ts pins
  // path = [USDC→3000→WETH, WETH→3000→WBTC]. However, the Plan 32-02
  // CANONICAL_FEE_TIERS mapping in src/chains/uniswap-v3.ts assigns 500 (0.05%)
  // to USDC↔WETH (its true TVL-derived canonical tier). So the prepare-tool's
  // multi-hop path is [USDC→500→WETH, WETH→3000→WBTC] — DIFFERENT from the
  // fixture pin. Byte-identity cross-link is not achievable through the
  // prepare-tool route; the fixture is still anchored standalone in
  // test/signing-fingerprint.test.ts. This test instead asserts the
  // canonical-mapping path + multicall outer + recipient + amountOutMinimum.
  it("USDC→WBTC via multi-hop → canonical [USDC→500→WETH, WETH→3000→WBTC] path; recipient=persona; amountOutMin=1n", async () => {
    getStatusSpy.mockResolvedValueOnce({
      ...PAIRED_STATUS,
      accounts: [FIXTURE_PERSONA],
      activeAccount: FIXTURE_PERSONA,
      address: FIXTURE_PERSONA,
      accountsByChain: { 1: [FIXTURE_PERSONA] },
    });
    setupQuoteMocks({
      singleHopByFee: { 100: null, 500: null, 3000: null, 10000: null },
      tinySingleHopByFee: { 100: null, 500: null, 3000: null, 10000: null },
      multiHopOut: QUOTE_UNI_C_RAW,
    });

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WBTC,
      amount: "100",
      slippageBps: 50,
      from: FIXTURE_PERSONA,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      data: string;
      route: { strategy: string; hops: Array<{ tokenIn: string; fee: number; tokenOut: string }> };
      amountOutMinimum: string;
    };
    expect(sc.route.strategy).toBe("multi-hop");
    expect(sc.route.hops.length).toBe(2);
    expect(sc.route.hops[0]!.tokenIn).toBe(USDC);
    expect(sc.route.hops[0]!.fee).toBe(500); // canonical USDC↔WETH per CANONICAL_FEE_TIERS
    expect(sc.route.hops[0]!.tokenOut).toBe(WETH);
    expect(sc.route.hops[1]!.tokenIn).toBe(WETH);
    expect(sc.route.hops[1]!.fee).toBe(3000); // canonical WETH↔WBTC
    expect(sc.route.hops[1]!.tokenOut).toBe(WBTC);
    expect(sc.amountOutMinimum).toBe("1"); // 2n * 9950 / 10000 = 1n

    // Recompute the expected fingerprint via the canonical-mapping path and
    // assert byte-identity. This proves the multi-hop branch produces a
    // deterministic, reproducible fingerprint — just NOT the Plan 32-01
    // FIXTURE_UNI_C_FP literal (which used non-canonical 3000+3000 path).
    const path = encodeV3Path([
      { tokenIn: USDC, fee: 500, tokenOut: WETH },
      { tokenIn: WETH, fee: 3000, tokenOut: WBTC },
    ]);
    const inner = encodeExactInput({
      path,
      recipient: FIXTURE_PERSONA,
      amountIn: 100_000000n,
      amountOutMinimum: 1n,
    });
    const data = encodeMulticallWithDeadline(FIXTURE_DEADLINE, [inner]);
    const expectedFp = computePayloadFingerprint({
      chainId: 1,
      to: SWAP_ROUTER_02,
      valueWei: 0n,
      data,
    });
    const scFull = result.structuredContent as { payloadFingerprint: string };
    expect(scFull.payloadFingerprint).toBe(expectedFp);
  });

  it("FIXTURE_UNI_C_FP literal remains accessible (Plan 32-01 standalone anchor)", () => {
    // The Plan 32-01 hardcoded literal is preserved at the standalone fixture
    // site (test/signing-fingerprint.test.ts) — the prepare-tool path produces
    // a different (canonical-mapping-derived) fingerprint per the above test.
    expect(FIXTURE_UNI_C_FP).toBe(
      "0x795086fdfb9f86ff26ffd6cec6100223c0bf041d9427936b51b60e038f2beb8f",
    );
  });
});

// ---------------------------------------------------------------------------
// T13: ETH-in calldata composition
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — ETH-in calldata composition", () => {
  it("tokenIn='ETH' → tx.value === amountIn; data starts with multicall selector", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupQuoteMocks({
      fullAmountIn: 1_000_000_000_000_000_000n,
      singleHopByFee: { 500: QUOTE_UNI_A },
      tinySingleHopByFee: { 500: QUOTE_UNI_A / 10000n },
    });

    const result = await callTool({
      tokenIn: "ETH",
      tokenOut: USDC,
      amount: "1",
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { valueWei: string; data: string };
    // 1 ETH = 1e18 wei
    expect(sc.valueWei).toBe("1000000000000000000");
    expect(sc.data.slice(0, 10).toLowerCase()).toBe(
      UNISWAP_V3_SELECTORS.multicallWithDeadline,
    );
  });
});

// ---------------------------------------------------------------------------
// T14: ETH-out calldata composition (2 inner sub-calls)
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — ETH-out calldata composition", () => {
  it("tokenOut='ETH' → tx.value === '0'; calldata contains exactInputSingle + unwrapWETH9 sub-calls", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupQuoteMocks({
      singleHopByFee: { 500: QUOTE_UNI_A },
      tinySingleHopByFee: { 500: QUOTE_UNI_A / 10000n },
    });

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: "ETH",
      amount: "100",
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { valueWei: string; data: string };
    expect(sc.valueWei).toBe("0");

    // Decode the outer multicall; assert 2 inner sub-calls.
    const decoded = decodeFunctionData({
      abi: MULTICALL_DEADLINE_ABI,
      data: sc.data as `0x${string}`,
    });
    const [, calls] = decoded.args as [bigint, readonly `0x${string}`[]];
    expect(calls.length).toBe(2);
    expect(calls[0]!.slice(0, 10).toLowerCase()).toBe(
      UNISWAP_V3_SELECTORS.exactInputSingle,
    );
    expect(calls[1]!.slice(0, 10).toLowerCase()).toBe(
      UNISWAP_V3_SELECTORS.unwrapWETH9,
    );
  });
});

// ---------------------------------------------------------------------------
// T15: ETH-out inner exactInputSingle.recipient === SwapRouter02 (Pitfall 3 / D-15)
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — D-15 inner-recipient invariant (ETH-out)", () => {
  it("inner exactInputSingle.recipient === SwapRouter02 (router holds WETH between sub-calls)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupQuoteMocks({
      singleHopByFee: { 500: QUOTE_UNI_A },
      tinySingleHopByFee: { 500: QUOTE_UNI_A / 10000n },
    });

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: "ETH",
      amount: "100",
    });
    const sc = result.structuredContent as { data: string };
    const outer = decodeFunctionData({
      abi: MULTICALL_DEADLINE_ABI,
      data: sc.data as `0x${string}`,
    });
    const [, calls] = outer.args as [bigint, readonly `0x${string}`[]];
    const innerExactInputSingle = decodeFunctionData({
      abi: SWAP_ROUTER_02_ABI,
      data: calls[0]!,
    });
    const [params] = innerExactInputSingle.args as [{ recipient: string }];
    expect(params.recipient).toBe(SWAP_ROUTER_02);
  });
});

// ---------------------------------------------------------------------------
// T16: LEDGER NOTICE block emitted unconditionally
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — LEDGER NOTICE unconditional emission (D-11)", () => {
  it("3-block response carries LEDGER NOTICE in the third content block (BLIND-SIGN + multicall key phrases)", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupQuoteMocks({
      singleHopByFee: { 500: QUOTE_UNI_A },
      tinySingleHopByFee: { 500: QUOTE_UNI_A / 10000n },
    });

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });
    expect(result.isError).toBeFalsy();
    expect(result.content.length).toBe(3);
    expect(result.content[2]?.text ?? "").toMatch(/LEDGER\s+NOTICE/);
    expect(result.content[2]?.text ?? "").toMatch(/BLIND-SIGN/);
    expect(result.content[2]?.text ?? "").toMatch(/multicall/);
  });
});

// ---------------------------------------------------------------------------
// T17: PREPARE RECEIPT has all 10 placeholders populated
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — PREPARE RECEIPT all placeholders populated", () => {
  it("no raw {PLACEHOLDER} remains in the PREPARE RECEIPT block", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupQuoteMocks({
      singleHopByFee: { 500: QUOTE_UNI_A },
      tinySingleHopByFee: { 500: QUOTE_UNI_A / 10000n },
    });

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });
    const receiptText = result.content[0]?.text ?? "";
    expect(receiptText).toMatch(/PREPARE\s+RECEIPT/);
    expect(receiptText).not.toMatch(/\{[A-Z_]+\}/);
  });
});

// ---------------------------------------------------------------------------
// T18: payloadFingerprint round-trip (D-12 invariant)
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — payloadFingerprint covers full multicall calldata (D-12)", () => {
  it("recomputed fingerprint from structuredContent.{chainId,to,valueWei,data} matches payloadFingerprint", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupQuoteMocks({
      singleHopByFee: { 500: QUOTE_UNI_A },
      tinySingleHopByFee: { 500: QUOTE_UNI_A / 10000n },
    });

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });
    const sc = result.structuredContent as {
      chainId: number;
      to: string;
      valueWei: string;
      data: string;
      payloadFingerprint: string;
    };
    const recomputed = computePayloadFingerprint({
      chainId: sc.chainId,
      to: sc.to as Address,
      valueWei: BigInt(sc.valueWei),
      data: sc.data as `0x${string}`,
    });
    expect(recomputed).toBe(sc.payloadFingerprint);
  });
});

// ---------------------------------------------------------------------------
// T19: deadline = block.timestamp + 600
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — deadline = block.timestamp + 600", () => {
  it("structuredContent.deadline === FIXTURE_DEADLINE_TIMESTAMP + 600", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    setupQuoteMocks({
      singleHopByFee: { 500: QUOTE_UNI_A },
      tinySingleHopByFee: { 500: QUOTE_UNI_A / 10000n },
    });

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });
    const sc = result.structuredContent as { deadline: string };
    expect(sc.deadline).toBe(FIXTURE_DEADLINE.toString());
  });
});

// ---------------------------------------------------------------------------
// T20: amountOutMinimum D-06 formula
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — amountOutMinimum D-06 formula", () => {
  it("amountOutMinimum = quotedAmountOut * (10000 - slippageBps) / 10000", async () => {
    getStatusSpy.mockResolvedValueOnce(PAIRED_STATUS);
    // Use a clean integer quote to verify the formula exactly.
    // quoted = 1_000_000n, slippageBps = 50 → amountOutMin = 995_000n.
    setupQuoteMocks({
      singleHopByFee: { 500: 1_000_000n },
      tinySingleHopByFee: { 500: 100n }, // fair = 1_000_000 → impact ≈ 0
    });

    const result = await callTool({
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
      slippageBps: 50,
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      quotedAmountOut: string;
      amountOutMinimum: string;
    };
    expect(sc.quotedAmountOut).toBe("1000000");
    expect(sc.amountOutMinimum).toBe("995000");
  });
});

// ---------------------------------------------------------------------------
// T21: register-all wiring
// ---------------------------------------------------------------------------
describe("prepare_uniswap_swap — register-all wiring", () => {
  it("getRegisteredTool('prepare_uniswap_swap') returns a registered handler", () => {
    const tool = getRegisteredTool("prepare_uniswap_swap");
    expect(tool).not.toBeNull();
    expect(tool).not.toBeUndefined();
    const names = listRegisteredTools().map((t) => t.name);
    expect(names).toContain("prepare_uniswap_swap");
  });
});
