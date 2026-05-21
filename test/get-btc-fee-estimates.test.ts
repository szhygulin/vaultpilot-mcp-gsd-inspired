// test/get-btc-fee-estimates.test.ts — Phase 22 Plan 22-03 Task 2 (BTC-READ-05).
//
// MCP tool: returns Esplora `/fee-estimates` projected to 5-key shape
// { "1", "2", "3", "6", "144" } sat/vB per ROADMAP SC #7.
//
// Coverage:
//   1. Happy path: 24-key Esplora response → 5-key projection
//   2. sat/vB values match Esplora response (no unit conversion)
//   3. rate-limited → ESPLORA_RATE_LIMITED envelope
//   4. 5xx → ESPLORA_ERROR envelope
//   5. INPUT_SCHEMA is empty object (no args)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetBitcoinRegistryForTesting } from "../src/chains/bitcoin/registry.js";
import { _resetEsploraCacheForTesting } from "../src/chains/bitcoin/esplora-client.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

// Live-shape 24-key Esplora /fee-estimates response (captured 2026-05-21
// against blockstream.info).
const LIVE_FEE_ESTIMATES_24KEY = {
  "1": 12.5,
  "2": 11.3,
  "3": 10.2,
  "4": 9.5,
  "5": 8.7,
  "6": 7.9,
  "7": 7.5,
  "8": 7.0,
  "9": 6.5,
  "10": 6.0,
  "11": 5.5,
  "12": 5.0,
  "13": 4.5,
  "14": 4.0,
  "15": 3.5,
  "16": 3.0,
  "17": 2.5,
  "18": 2.2,
  "19": 2.0,
  "20": 1.8,
  "21": 1.5,
  "22": 1.2,
  "144": 1.013,
  "504": 1.013,
  "1008": 1.013,
};

beforeEach(() => {
  _resetEsploraCacheForTesting();
  _resetBitcoinRegistryForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetEsploraCacheForTesting();
  _resetBitcoinRegistryForTesting();
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_btc_fee_estimates");
  if (!tool) throw new Error("get_btc_fee_estimates not registered");
  return tool.handler(args);
}

describe("get_btc_fee_estimates (BTC-READ-05)", () => {
  it("happy path: 24-key Esplora response → 5-key projection {1,2,3,6,144}", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => LIVE_FEE_ESTIMATES_24KEY,
    } satisfies MockResponse)));

    const result = await callTool({});
    expect(result.isError).toBeUndefined();
    const s = result.structuredContent as Record<string, unknown>;
    const fees = s.feeEstimates as Record<string, unknown>;
    expect(Object.keys(fees).sort()).toEqual(["1", "144", "2", "3", "6"]);
    expect(fees["1"]).toBe(12.5);
    expect(fees["2"]).toBe(11.3);
    expect(fees["3"]).toBe(10.2);
    expect(fees["6"]).toBe(7.9);
    expect(fees["144"]).toBe(1.013);
  });

  it("rate-limited → ESPLORA_RATE_LIMITED envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
    } satisfies MockResponse)));

    const result = await callTool({});
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>).errorCode).toBe(
      "ESPLORA_RATE_LIMITED",
    );
  });

  it("5xx → ESPLORA_ERROR envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    } satisfies MockResponse)));

    const result = await callTool({});
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>).errorCode).toBe(
      "ESPLORA_ERROR",
    );
  });

  it("sat/vB unit preserved (no conversion to sat/byte or BTC/kvB)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => LIVE_FEE_ESTIMATES_24KEY,
    } satisfies MockResponse)));

    const result = await callTool({});
    const s = result.structuredContent as Record<string, unknown>;
    expect(s.units).toBe("sat/vB");
  });

  it("INPUT_SCHEMA: empty object (no args)", () => {
    const tool = getRegisteredTool("get_btc_fee_estimates");
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as Record<string, unknown>;
    expect(schema.properties).toEqual({});
    expect(schema.additionalProperties).toBe(false);
  });
});
