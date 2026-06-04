// Plan 14-01 Task 1 (Wave 0) — get_jupiter_quote (SOL-W-11) read companion.
//
// Spies the _jupiter client indirection (getQuote) so the tool test is
// decoupled from HTTP — NO live fetch, NO live Connection. Asserts:
//   (a) ok quote → structuredContent surfaces inAmount/outAmount/
//       otherAmountThreshold/priceImpactPct/slippageBps/routePlan
//   (b) priceImpactPct "0.025" (2.5%) → sandwich-MEV WARNING block + [AGENT TASK]
//       recheck line (the priceImpactPct*100 conversion — Pitfall 2 anchor)
//   (c) priceImpactPct "0.001" (0.1%) → NO WARNING block (the *100 pair)
//   (d) client { kind:"rate-limited" } → structured error
//   (e) client { kind:"error" } → structured error

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _jupiter } from "../src/clients/jupiter.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";

await import("../src/tools/register-all.js");

function makeQuote(priceImpactPct: string) {
  return {
    inputMint: "So11111111111111111111111111111111111111112",
    inAmount: "100000000",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    outAmount: "17057460",
    otherAmountThreshold: "16886885",
    swapMode: "ExactIn",
    slippageBps: 50,
    priceImpactPct,
    routePlan: [
      {
        swapInfo: {
          ammKey: "amm1",
          label: "Orca",
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          inAmount: "100000000",
          outAmount: "17057460",
          feeAmount: "100",
          feeMint: "So11111111111111111111111111111111111111112",
        },
        percent: 100,
      },
    ],
    contextSlot: 0,
  };
}

const ARGS = {
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  // RAW base-unit amount forwarded verbatim to Jupiter (0.1 SOL @ 9 decimals).
  amount: "100000000",
};

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_jupiter_quote");
  if (!tool) throw new Error("get_jupiter_quote not registered");
  return tool.handler(args);
}

describe("get_jupiter_quote (SOL-W-11)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) ok quote → structuredContent surfaces the v6 envelope fields", async () => {
    vi.spyOn(_jupiter, "getQuote").mockResolvedValue({
      kind: "ok",
      quote: makeQuote("0.0001"),
    });
    const res = await callTool(ARGS);
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc.inAmount).toBe("100000000");
    expect(sc.outAmount).toBe("17057460");
    expect(sc.otherAmountThreshold).toBe("16886885");
    expect(sc.priceImpactPct).toBe("0.0001");
    expect(sc.slippageBps).toBe(50);
    expect(Array.isArray(sc.routePlan)).toBe(true);
  });

  it("(b) priceImpactPct 0.025 (2.5%) → sandwich-MEV WARNING + [AGENT TASK] recheck (×100 fires)", async () => {
    vi.spyOn(_jupiter, "getQuote").mockResolvedValue({
      kind: "ok",
      quote: makeQuote("0.025"),
    });
    const res = await callTool(ARGS);
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    // priceImpactPct "0.025" * 100 = 2.5% > 2.0% threshold → WARNING.
    expect(text).toMatch(/sandwich/i);
    expect(text).toMatch(/2\.5/);
    expect(text).toMatch(/\[AGENT TASK\]/);
  });

  it("(c) priceImpactPct 0.001 (0.1%) → NO WARNING block (×100 = 0.1% < 2.0%)", async () => {
    vi.spyOn(_jupiter, "getQuote").mockResolvedValue({
      kind: "ok",
      quote: makeQuote("0.001"),
    });
    const res = await callTool(ARGS);
    expect(res.isError).toBeFalsy();
    const text = (res.content[0] as { text: string }).text;
    expect(text).not.toMatch(/sandwich-MEV WARNING/i);
    // [AGENT TASK] recheck is ALWAYS present (Pattern 3 — recommended, confirmed).
    expect(text).toMatch(/\[AGENT TASK\]/);
  });

  it("(d) client rate-limited → structured error envelope", async () => {
    vi.spyOn(_jupiter, "getQuote").mockResolvedValue({ kind: "rate-limited" });
    const res = await callTool(ARGS);
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.errorCode).toBe("string");
  });

  it("(e) client error → structured error envelope", async () => {
    vi.spyOn(_jupiter, "getQuote").mockResolvedValue({
      kind: "error",
      message: "Jupiter /quote returned HTTP 500",
    });
    const res = await callTool(ARGS);
    expect(res.isError).toBe(true);
    const sc = res.structuredContent as Record<string, unknown>;
    expect(typeof sc.errorCode).toBe("string");
  });

  it("refuses INVALID_INPUT on a malformed inputMint", async () => {
    const res = await callTool({ ...ARGS, inputMint: "not-base58!!" });
    expect(res.isError).toBe(true);
    expect((res.structuredContent as Record<string, unknown>).errorCode).toBe(
      "INVALID_INPUT",
    );
  });
});
