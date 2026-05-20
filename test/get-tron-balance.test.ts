// test/get-tron-balance.test.ts — Phase 17 Plan 17-03 (TRON-READ-01).
//
// Mirrors test/get-solana-balance.test.ts shape: tool wrapper hits
// `getNativeBalance` via the `_tronRegistry.getTronWeb()` spy seam. We
// stub the TronWeb instance with a `trx.getBalance` mock and let the
// sun→TRX conversion run through `formatSunToTrx` for real.
//
// Decimal-string-at-the-boundary regression: response `sun` MUST be a
// STRING, not a number; `trx` MUST be a decimal string. `decimals` MUST be
// 6 (NOT 9 like SOL — research § Topic 6).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _tronRegistry } from "../src/chains/tron/registry.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const FIXTURE_WALLET = "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  void _resetRegistryForTesting;
});

async function callTool(
  args: Record<string, unknown>,
): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_tron_balance");
  if (!tool) throw new Error("get_tron_balance not registered");
  return tool.handler(args);
}

function makeStubTronWeb(balanceSun: number | bigint): {
  tw: object;
  getBalance: ReturnType<typeof vi.fn>;
} {
  const getBalance = vi.fn().mockResolvedValue(balanceSun);
  const tw = {
    trx: { getBalance },
  };
  return { tw, getBalance };
}

describe("get_tron_balance tool (Phase 17 Plan 17-03 TRON-READ-01)", () => {
  it("happy path: 1.5 TRX → sun as STRING, trx as decimal string, decimals=6 (NOT 9)", async () => {
    const { tw } = makeStubTronWeb(1_500_000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({ wallet: FIXTURE_WALLET });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      wallet: FIXTURE_WALLET,
      sun: "1500000",
      trx: "1.5",
      decimals: 6,
      symbol: "TRX",
    });
  });

  it("decimals=6 regression anchor — NOT 9 like SOL (research § Topic 6)", async () => {
    const { tw } = makeStubTronWeb(1_000_000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({ wallet: FIXTURE_WALLET });
    const sc = result.structuredContent as { decimals: number };
    expect(sc.decimals).toBe(6);
    expect(sc.decimals).not.toBe(9);
  });

  it("decimal-string-at-the-boundary regression: sun field MUST be a string (NOT a number)", async () => {
    const { tw } = makeStubTronWeb(1_000_000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({ wallet: FIXTURE_WALLET });
    const out = result.structuredContent as { sun: unknown; trx: unknown };
    expect(typeof out.sun).toBe("string");
    expect(typeof out.trx).toBe("string");
    // Ensure no nested `number` either — `decimals` is intentionally a
    // number (6).
    for (const k of Object.keys(result.structuredContent as object)) {
      const v = (result.structuredContent as Record<string, unknown>)[k];
      if (k === "decimals") continue;
      expect(typeof v).not.toBe("number");
    }
  });

  it("zero balance returns sun='0', trx='0'", async () => {
    const { tw } = makeStubTronWeb(0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({ wallet: FIXTURE_WALLET });
    expect(result.isError).toBeUndefined();
    expect((result.structuredContent as { sun: string }).sun).toBe("0");
    expect((result.structuredContent as { trx: string }).trx).toBe("0");
  });

  it("RPC error → TRON_RPC_FAILED envelope", async () => {
    const getBalance = vi.fn().mockRejectedValue(new Error("network down"));
    const tw = { trx: { getBalance } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({ wallet: FIXTURE_WALLET });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ errorCode: "TRON_RPC_FAILED" });
    expect(result.content[0]?.text).toMatch(/network down/);
  });

  it("invalid wallet input (empty string) returns INVALID_INPUT envelope", async () => {
    const result = await callTool({ wallet: "" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ errorCode: "INVALID_INPUT" });
  });

  it("text content surfaces the sun count + decimal TRX amount", async () => {
    const { tw } = makeStubTronWeb(1_234_567);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(_tronRegistry, "getTronWeb").mockReturnValue(tw as any);

    const result = await callTool({ wallet: FIXTURE_WALLET });
    expect(result.content[0]?.text).toMatch(/1\.234567 TRX/);
    expect(result.content[0]?.text).toMatch(/1234567 sun/);
  });
});
