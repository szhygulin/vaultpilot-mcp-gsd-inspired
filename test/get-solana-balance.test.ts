// test/get-solana-balance.test.ts — Phase 11 Plan 11-05 (SOL-03).
//
// Mirrors test/get-token-balance.test.ts (the EVM analog): tool wrapper
// hits Plan 11-02's `getNativeBalance` via `_solanaRegistry.getConnection`
// — we mock the connection and let the SDK conversion run for real.
//
// Decimal-string-at-the-boundary regression: response `lamports` MUST be
// a STRING, not a number; `sol` MUST be a decimal string.

import type { Connection } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _solanaRegistry } from "../src/chains/solana/registry.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const FIXTURE_WALLET = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_solana_balance");
  if (!tool) throw new Error("get_solana_balance not registered");
  return tool.handler(args);
}

describe("get_solana_balance tool (Phase 11 Plan 11-05 SOL-03)", () => {
  it("happy path: 2.5 SOL → lamports as STRING, sol as decimal string", async () => {
    const stubConnection = {
      getBalance: vi.fn().mockResolvedValue(2_500_000_000),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    const result = await callTool({ wallet: FIXTURE_WALLET });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      wallet: FIXTURE_WALLET,
      lamports: "2500000000",
      sol: "2.5",
      decimals: 9,
      symbol: "SOL",
    });
  });

  it("decimal-string-at-the-boundary regression: lamports field MUST be a string (NOT a number)", async () => {
    const stubConnection = {
      getBalance: vi.fn().mockResolvedValue(1_000_000_000),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    const result = await callTool({ wallet: FIXTURE_WALLET });
    const out = result.structuredContent as { lamports: unknown; sol: unknown };
    expect(typeof out.lamports).toBe("string");
    expect(typeof out.sol).toBe("string");
    // Ensure no nested `number` either.
    for (const k of Object.keys(result.structuredContent as object)) {
      const v = (result.structuredContent as Record<string, unknown>)[k];
      if (k === "decimals") continue; // decimals is intentionally a number (9).
      expect(typeof v).not.toBe("number");
    }
  });

  it("zero balance returns lamports='0', sol='0'", async () => {
    const stubConnection = {
      getBalance: vi.fn().mockResolvedValue(0),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    const result = await callTool({ wallet: FIXTURE_WALLET });
    expect(result.isError).toBeUndefined();
    expect((result.structuredContent as { lamports: string }).lamports).toBe("0");
    expect((result.structuredContent as { sol: string }).sol).toBe("0");
  });

  it("RPC error → SOLANA_RPC_FAILED envelope", async () => {
    const stubConnection = {
      getBalance: vi.fn().mockRejectedValue(new Error("network down")),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    const result = await callTool({ wallet: FIXTURE_WALLET });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ errorCode: "SOLANA_RPC_FAILED" });
    expect(result.content[0]?.text).toMatch(/network down/);
  });

  it("invalid wallet input (empty string) returns INVALID_INPUT envelope", async () => {
    const result = await callTool({ wallet: "" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ errorCode: "INVALID_INPUT" });
  });

  it("text content surfaces the lamports count + decimal SOL amount", async () => {
    const stubConnection = {
      getBalance: vi.fn().mockResolvedValue(1_234_567_890),
    } as unknown as Connection;
    vi.spyOn(_solanaRegistry, "getConnection").mockReturnValue(stubConnection);

    const result = await callTool({ wallet: FIXTURE_WALLET });
    expect(result.content[0]?.text).toMatch(/1\.23456789 SOL/);
    expect(result.content[0]?.text).toMatch(/1234567890 lamports/);
  });
});
