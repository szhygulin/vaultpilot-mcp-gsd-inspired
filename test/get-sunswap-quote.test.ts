// `get_sunswap_quote` end-to-end regression. Phase 20 — Plan 20-01.
//
// Load-bearing invariants:
//   1. Quote shape returned verbatim from _sunswapClient.fetchSunswapQuote.
//   2. NEVER-throws: null fetchSunswapQuote → INTERNAL_ERROR (no crash).
//   3. INVALID_INPUT for malformed addresses + malformed amounts.
//   4. slippageBps defaults to 50 when omitted.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const WTRX = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";
const JST = "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9";

const { _sunswapClient, resetSunswapCacheForTesting } = await import("../src/clients/sunswap.js");
await import("../src/tools/register-all.js");

import { getRegisteredTool, type ToolHandlerResult } from "../src/tools/index.js";

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_sunswap_quote");
  if (!tool) throw new Error("get_sunswap_quote not registered");
  return tool.handler(args);
}

beforeEach(() => {
  resetSunswapCacheForTesting();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("get_sunswap_quote — happy path", () => {
  it("Test 1: returns Quote shape verbatim from fetchSunswapQuote", async () => {
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce({
      inAmount: 1_000_000n,
      outAmount: 950_000n,
      route: [USDT_TRC20, WTRX],
      priceImpactBps: 50,
      slippageBps: 50,
      source: "live",
    });

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      slippageBps: 50,
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.inAmount).toBe("1000000");
    expect(sc.outAmount).toBe("950000");
    expect(sc.route).toEqual([USDT_TRC20, WTRX]);
    expect(sc.priceImpactBps).toBe(50);
    expect(sc.slippageBps).toBe(50);
    expect(sc.source).toBe("live");
  });

  it("Test 2: slippageBps defaults to 50 when omitted", async () => {
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce({
      inAmount: 1_000_000n,
      outAmount: 950_000n,
      route: [USDT_TRC20, WTRX],
      priceImpactBps: 30,
      slippageBps: 50,
      source: "live",
    });

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      // slippageBps omitted — should default to 50
    });

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.slippageBps).toBe(50);
  });
});

describe("get_sunswap_quote — NEVER-throws contract", () => {
  it("Test 3: returns INTERNAL_ERROR when fetchSunswapQuote returns null", async () => {
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce(null);

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      slippageBps: 50,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INTERNAL_ERROR");
    expect(sc.cause).toMatch(/SunSwap quote unavailable/i);
  });

  it("Test 3b: returns INTERNAL_ERROR when fetchSunswapQuote rejects", async () => {
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockRejectedValueOnce(
      new Error("TronGrid unreachable"),
    );

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      slippageBps: 50,
    });

    expect(result.isError).toBe(true);
  });
});

describe("get_sunswap_quote — INVALID_INPUT", () => {
  it("Test 4a: invalid inputToken → INVALID_INPUT", async () => {
    const result = await callTool({
      inputToken: "not-a-tron-address",
      outputToken: WTRX,
      amount: "1",
      slippageBps: 50,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toMatch(/inputToken/i);
  });

  it("Test 4b: invalid outputToken → INVALID_INPUT", async () => {
    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: "bad-address",
      amount: "1",
      slippageBps: 50,
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.cause).toMatch(/outputToken/i);
  });

  it("Test 4c: inputToken not in tron-top-25 registry → INVALID_INPUT", async () => {
    // JST may or may not be in registry — use a clearly non-existent address
    const unknownToken = "TLyqzVGLV6srDMvCnSf5DLD6qMz3qAh1Vp";
    const result = await callTool({
      inputToken: unknownToken,
      outputToken: WTRX,
      amount: "1",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("Test 10 (amount validation): malformed amount → INVALID_INPUT", async () => {
    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "not-a-number",
    });

    expect(result.isError).toBe(true);
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });
});

describe("get_sunswap_quote — response text", () => {
  it("response text contains SUNSWAP V2 QUOTE block with key fields", async () => {
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce({
      inAmount: 1_000_000n,
      outAmount: 950_000n,
      route: [USDT_TRC20, WTRX],
      priceImpactBps: 150,
      slippageBps: 50,
      source: "live",
    });

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      slippageBps: 50,
    });

    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("SUNSWAP V2 QUOTE (TRON)");
    expect(text).toContain(USDT_TRC20);
    expect(text).toContain(WTRX);
    expect(text).toContain("950000");
    expect(text).toContain("live");
  });

  it("response text warns when priceImpactBps > 200 (2%)", async () => {
    vi.spyOn(_sunswapClient, "fetchSunswapQuote").mockResolvedValueOnce({
      inAmount: 1_000_000n,
      outAmount: 950_000n,
      route: [USDT_TRC20, WTRX],
      priceImpactBps: 350,
      slippageBps: 50,
      source: "live",
    });

    const result = await callTool({
      inputToken: USDT_TRC20,
      outputToken: WTRX,
      amount: "1",
      slippageBps: 50,
    });

    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain("exceeds 2%");
  });
});
