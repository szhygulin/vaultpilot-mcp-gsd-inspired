// test/get-uniswap-quote.test.ts — Phase 32 Plan 32-02 (UNI-01).
//
// Tool-handler regression for get_uniswap_quote.
//
// Strategy: mock `getChainClient` at the registry boundary to return a fake
// PublicClient whose `readContract` returns scripted responses keyed on
// `functionName` + `args[0].fee` (single-hop) / `args[0]` (multi-hop path).
//
// The tool calls `_uniswapV3Chain.quoteAllSingleHopFeeTiers` /
// `quoteMultiHopCandidates`, which themselves consult
// `getUniswapV3QuoterV2Address(1)` and call `client.readContract`. We mock the
// client at the registry layer (the boundary _just_ outside the chain
// module), keeping the chain-client logic in the test envelope.
//
// Fixture UNI-A cross-link: the USDC→WETH single-hop happy path mirrors
// Plan 32-01's Fixture UNI-A calldata shape; this test exercises the Quoter
// V2 read leg + envelope shape for the same swap.

import type { Address, PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadContract = vi.fn();
const mockClient = { readContract: mockReadContract } as unknown as PublicClient;

vi.mock("../src/chains/registry.js", () => {
  return {
    getChainClient: () => mockClient,
    isPublicNodeFallback: () => false,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
  };
});

import "../src/tools/register-all.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

// Token constants — Ethereum mainnet.
const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT: Address = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const DAI: Address = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WBTC: Address = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";

async function callTool(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_uniswap_quote");
  if (!tool) throw new Error("get_uniswap_quote not registered");
  return tool.handler(args) as Promise<ToolHandlerResult>;
}

/**
 * Mock helper: returns the same Quoter V2 response for every fee tier on
 * single-hop AND every multi-hop candidate. Decimals read returns 6 (USDC).
 *
 * `singleHopOut`: amountOut at every single-hop tier.
 * `multiHopOut`: amountOut at every multi-hop candidate (use 0n to suppress).
 * `tinyOut`: amountOut at the tiny-amount call (drives price-impact); when
 *   not specified, defaults to singleHopOut / 10000 (yielding 0 bps).
 */
function setupMocks(opts: {
  decimals?: number;
  singleHopOut: bigint;
  multiHopOut?: bigint;
  tinyOut?: bigint;
  amountIn: bigint;
}) {
  const {
    decimals = 6,
    singleHopOut,
    multiHopOut = 0n,
    amountIn,
  } = opts;
  // Default tiny-out: singleHopOut scaled down 10000x → impact = 0bps.
  const tinyOut =
    opts.tinyOut !== undefined ? opts.tinyOut : singleHopOut / 10000n;

  mockReadContract.mockImplementation(
    ({
      functionName,
      args,
    }: {
      functionName: string;
      args: ReadonlyArray<unknown>;
    }) => {
      if (functionName === "decimals") {
        return Promise.resolve(decimals);
      }
      if (functionName === "quoteExactInputSingle") {
        const params = args[0] as { amountIn: bigint };
        // Tiny-amount call distinguished by amountIn !== full amountIn.
        if (params.amountIn !== amountIn) {
          return Promise.resolve([tinyOut, 0n, 0, 0n]);
        }
        return Promise.resolve([singleHopOut, 0n, 0, 0n]);
      }
      if (functionName === "quoteExactInput") {
        if (multiHopOut === 0n) {
          return Promise.reject(new Error("no multi-hop liquidity"));
        }
        return Promise.resolve([multiHopOut, [], [], 0n]);
      }
      return Promise.resolve(0n);
    },
  );
}

beforeEach(() => {
  mockReadContract.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Happy-path envelope shape (Fixture UNI-A cross-link)
// ---------------------------------------------------------------------------

describe("get_uniswap_quote — happy-path envelope (Fixture UNI-A cross-link: USDC→WETH fee=500 amountIn=100e6)", () => {
  it("Test 1: envelope shape stable — single-hop USDC→WETH at fee=500", async () => {
    setupMocks({
      decimals: 6,
      singleHopOut: 50_000_000_000_000_000n, // 0.05 WETH
      amountIn: 100_000_000n, // 100 USDC
    });

    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.inputToken).toBe(USDC);
    expect(sc.outputToken).toBe(WETH);
    expect(sc.inAmount).toBe("100000000");
    expect(sc.outAmount).toBe("50000000000000000");
    expect(sc.source).toBe("uniswap-v3-quoter-v2");
    expect(sc.chain).toBe("ethereum");
    expect(sc.chainId).toBe(1);
    expect(sc.slippageBps).toBe(50); // default per D-06
    expect(typeof sc.priceImpactBps).toBe("number");
    // Mock returns same outAmount for all 4 tiers → the FIRST non-null tier
    // wins (the selection-loop's > comparator does not update on equality).
    // Fee tier ordering at the chain client is [100, 500, 3000, 10000] so
    // fee=100 wins this tie. Tighter mocks in subsequent tests exercise the
    // per-tier-output selection (see Test 2).
    expect(sc.fee).toBe(100);
    const route = sc.route as { strategy: string; hops: unknown[] };
    expect(route.strategy).toBe("single-hop");
    expect(route.hops).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Auto-fee-tier selection
// ---------------------------------------------------------------------------

describe("get_uniswap_quote — auto-fee-tier selection (D-04 step 1+2)", () => {
  it("Test 2: picks max amountOut across 4 single-hop tiers", async () => {
    mockReadContract.mockImplementation(
      ({
        functionName,
        args,
      }: {
        functionName: string;
        args: ReadonlyArray<unknown>;
      }) => {
        if (functionName === "decimals") return Promise.resolve(6);
        if (functionName === "quoteExactInputSingle") {
          const params = args[0] as { amountIn: bigint; fee: number };
          // Different per-tier outputs at full amountIn.
          if (params.amountIn === 100_000_000n) {
            if (params.fee === 100) return Promise.resolve([100n, 0n, 0, 0n]);
            if (params.fee === 500) return Promise.resolve([300n, 0n, 0, 0n]);
            if (params.fee === 3000)
              return Promise.resolve([200n, 0n, 0, 0n]);
            if (params.fee === 10000)
              return Promise.resolve([50n, 0n, 0, 0n]);
          }
          // tiny-amount call returns 0n drop reference (impact 0bps).
          return Promise.resolve([0n, 0n, 0, 0n]);
        }
        if (functionName === "quoteExactInput") {
          return Promise.reject(new Error("no multi-hop"));
        }
        return Promise.resolve(0n);
      },
    );

    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.fee).toBe(500); // best tier (300 > 200 > 100 > 50)
    expect(sc.outAmount).toBe("300");
  });
});

// ---------------------------------------------------------------------------
// Multi-hop vs single-hop threshold (D-04 step 4)
// ---------------------------------------------------------------------------

describe("get_uniswap_quote — multi-hop wins/loses by 0.5% threshold (D-04 step 4)", () => {
  it("Test 3: multi-hop wins when 1% better than single-hop", async () => {
    setupMocks({
      decimals: 6,
      singleHopOut: 1000n,
      multiHopOut: 1010n, // 1% better — > 0.5% threshold
      amountIn: 100_000_000n,
    });

    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDT,
      tokenOut: DAI,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.outAmount).toBe("1010");
    const route = sc.route as { strategy: string };
    expect(route.strategy).toBe("multi-hop");
    expect(sc.fee).toBeUndefined(); // multi-hop has no single-fee
  });

  it("Test 4: multi-hop loses when only 0.3% better than single-hop", async () => {
    setupMocks({
      decimals: 6,
      singleHopOut: 1000n,
      multiHopOut: 1003n, // 0.3% better — below 0.5% threshold
      amountIn: 100_000_000n,
    });

    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDT,
      tokenOut: DAI,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.outAmount).toBe("1000");
    const route = sc.route as { strategy: string };
    expect(route.strategy).toBe("single-hop");
  });

  it("Test 5: multi-hop wins unconditionally when all single-hop tiers revert", async () => {
    mockReadContract.mockImplementation(
      ({
        functionName,
      }: {
        functionName: string;
      }) => {
        if (functionName === "decimals") return Promise.resolve(6);
        if (functionName === "quoteExactInputSingle") {
          return Promise.reject(new Error("no single-hop pool"));
        }
        if (functionName === "quoteExactInput") {
          return Promise.resolve([2000n, [], [], 0n]);
        }
        return Promise.resolve(0n);
      },
    );

    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDT,
      tokenOut: DAI,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    const route = sc.route as { strategy: string };
    expect(route.strategy).toBe("multi-hop");
  });
});

// ---------------------------------------------------------------------------
// D-04a no-liquidity refusal
// ---------------------------------------------------------------------------

describe("get_uniswap_quote — D-04a no-liquidity refusal", () => {
  it("Test 6: all single-hop tiers + all multi-hop candidates revert → INVALID_INPUT + hintTool: 'request_capability'", async () => {
    mockReadContract.mockImplementation(
      ({ functionName }: { functionName: string }) => {
        if (functionName === "decimals") return Promise.resolve(6);
        return Promise.reject(new Error("no pool"));
      },
    );

    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDC,
      tokenOut: WBTC,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.hintTool).toBe("request_capability");
    expect(String(sc.message)).toMatch(/no Uniswap V3 liquidity/i);
  });
});

// ---------------------------------------------------------------------------
// Same-token-swap refusal (D-05)
// ---------------------------------------------------------------------------

describe("get_uniswap_quote — same-token-swap refusal (D-05)", () => {
  it("Test 7: tokenIn === tokenOut → INVALID_INPUT + cause: 'same-token-swap-refused'", async () => {
    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDC,
      tokenOut: USDC,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("same-token-swap-refused");
  });

  it("Test 7b: ETH ↔ ETH refused (both sentinels resolve to WETH)", async () => {
    const result = await callTool({
      chain: "ethereum",
      tokenIn: "ETH",
      tokenOut: "ETH",
      amount: "1",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("same-token-swap-refused");
  });

  it("Test 7c: ETH ↔ WETH refused (sentinel collapses to same address)", async () => {
    const result = await callTool({
      chain: "ethereum",
      tokenIn: "ETH",
      tokenOut: WETH,
      amount: "1",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toBe("same-token-swap-refused");
  });
});

// ---------------------------------------------------------------------------
// ETH sentinel resolution
// ---------------------------------------------------------------------------

describe("get_uniswap_quote — ETH sentinel resolution (D-05)", () => {
  it("Test 8: tokenIn = 'ETH' resolves to WETH for the Quoter call; envelope echoes 'ETH'", async () => {
    setupMocks({
      decimals: 18, // ETH/WETH decimals; mock won't be called for decimals since sentinel hardcodes 18
      singleHopOut: 100_000_000n,
      amountIn: 1_000_000_000_000_000_000n, // 1 ETH
    });

    const result = await callTool({
      chain: "ethereum",
      tokenIn: "ETH",
      tokenOut: USDC,
      amount: "1",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.inputToken).toBe("ETH"); // echoed back
    expect(sc.outputToken).toBe(USDC);
    expect(sc.inAmount).toBe("1000000000000000000");

    // Assert the Quoter V2 readContract was called with WETH (not 'ETH') as
    // the tokenIn — sentinel resolved server-side.
    const quoterCalls = mockReadContract.mock.calls.filter(
      ([{ functionName }]) => functionName === "quoteExactInputSingle",
    );
    expect(quoterCalls.length).toBeGreaterThan(0);
    const firstQuoterCall = quoterCalls[0]![0] as {
      args: ReadonlyArray<Record<string, unknown>>;
    };
    expect(firstQuoterCall.args[0]!.tokenIn).toBe(WETH);
  });

  it("Test 9: tokenOut = 'ETH' resolves to WETH for the Quoter call; envelope echoes 'ETH'", async () => {
    setupMocks({
      decimals: 6,
      singleHopOut: 50_000_000_000_000_000n, // 0.05 WETH
      amountIn: 100_000_000n, // 100 USDC
    });

    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDC,
      tokenOut: "ETH",
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.inputToken).toBe(USDC);
    expect(sc.outputToken).toBe("ETH");

    const quoterCalls = mockReadContract.mock.calls.filter(
      ([{ functionName }]) => functionName === "quoteExactInputSingle",
    );
    expect(quoterCalls.length).toBeGreaterThan(0);
    const firstQuoterCall = quoterCalls[0]![0] as {
      args: ReadonlyArray<Record<string, unknown>>;
    };
    expect(firstQuoterCall.args[0]!.tokenOut).toBe(WETH);
  });
});

// ---------------------------------------------------------------------------
// Sandwich-MEV warning (D-08 — quote time)
// ---------------------------------------------------------------------------

describe("get_uniswap_quote — sandwich-MEV warning at priceImpactBps > 200 (D-08)", () => {
  it("Test 10: priceImpactBps > 200 → text response contains warning string", async () => {
    // Drive a > 2% drop: tiny-amount × 10000 yields fairOut=1_000_000_000n;
    // actual yields 950_000_000n → drop=50_000_000; bps=(5e7 * 1e4)/1e9=500.
    setupMocks({
      decimals: 6,
      singleHopOut: 950_000_000n,
      tinyOut: 100_000n, // tinyOut * 10000 = 1_000_000_000n (the fair-price reference)
      amountIn: 100_000_000n,
    });

    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.priceImpactBps).toBeGreaterThan(200);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("⚠ Price impact");
    expect(text).toContain("2% sandwich-MEV threshold");
  });

  it("Test 11: priceImpactBps <= 200 → no warning string", async () => {
    // Drive a < 2% drop: tinyOut * 10000 = 1_000_000n (fair reference);
    // actual = 999_000n → drop=1000; bps=(1000 * 10000)/1_000_000=10 (0.10%).
    setupMocks({
      decimals: 6,
      singleHopOut: 999_000n,
      tinyOut: 100n, // tinyOut * 10000 = 1_000_000n
      amountIn: 100_000_000n,
    });

    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).not.toContain("⚠ Price impact");
  });
});

// ---------------------------------------------------------------------------
// Decimal-amount + slippage bounds errors
// ---------------------------------------------------------------------------

describe("get_uniswap_quote — input validation errors", () => {
  it("Test 12: amount fractional-overflow → INVALID_INPUT", async () => {
    setupMocks({ decimals: 6, singleHopOut: 1000n, amountIn: 100_000_000n });

    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100.1234567", // 7 decimals — USDC has 6
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("Test 13: slippageBps = 0 → INVALID_INPUT (below lower bound)", async () => {
    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
      slippageBps: 0,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("Test 14: slippageBps = 10001 → INVALID_INPUT (above upper bound)", async () => {
    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
      slippageBps: 10001,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("Test 15: default slippageBps = 50 when omitted (D-06)", async () => {
    setupMocks({ decimals: 6, singleHopOut: 1000n, amountIn: 100_000_000n });

    const result = await callTool({
      chain: "ethereum",
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.slippageBps).toBe(50);
  });

  it("Test 16: chain != 'ethereum' → INVALID_INPUT (Phase 32 Ethereum-only)", async () => {
    const result = await callTool({
      chain: "polygon",
      tokenIn: USDC,
      tokenOut: WETH,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("Test 17: invalid tokenIn address → INVALID_INPUT", async () => {
    const result = await callTool({
      chain: "ethereum",
      tokenIn: "not-an-address",
      tokenOut: WETH,
      amount: "100",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------
// Fixture UNI-A cross-link comment-only assertion
// ---------------------------------------------------------------------------

describe("get_uniswap_quote — Fixture UNI-A cross-link", () => {
  it("Test 18: USDC→WETH fee=500 amountIn=100e6 — canonical Fixture UNI-A inputs (see test/signing-fingerprint.test.ts)", () => {
    // Cross-link anchor only: Fixture UNI-A in test/signing-fingerprint.test.ts
    // pins the cryptographic-binding payloadFingerprint for the calldata
    // shape `multicall(deadline, [exactInputSingle(USDC, WETH, fee=500,
    // recipient=<persona>, amountIn=100_000_000, amountOutMinimum=..., 0)])`.
    // The quote tool exercised by Tests 1–17 above produces the inputs the
    // prepare tool (Plan 32-03) will hand to that fixture's calldata
    // encoder.
    expect(true).toBe(true);
  });
});
