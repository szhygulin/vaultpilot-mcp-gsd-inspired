// test/get-litecoin-fee-estimates.test.ts — Phase 26 Plan 26-01 (LTC-READ-02).
//
// MCP tool: returns 5-key sat/vB fee estimates via litecoinspace.org's
// mempool.space-style `/v1/fees/recommended` endpoint. The LTC esplora
// client maps the mempool.space shape → 5-key object internally, so
// the tool layer's projection loop is a passthrough.
//
// Coverage:
//   1. Happy path: mempool.space-shape response → 5-key projection {1,2,3,6,144}
//   2. sat/vB values match response (no unit conversion)
//   3. rate-limited → ESPLORA_RATE_LIMITED envelope
//   4. 5xx → ESPLORA_ERROR envelope
//   5. INPUT_SCHEMA is empty object (no args)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetLitecoinRegistryForTesting } from "../src/chains/litecoin/registry.js";
import { _resetEsploraCacheForTesting } from "../src/chains/litecoin/esplora-client.js";
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

// mempool.space-style response from litecoinspace.org /api/v1/fees/recommended.
// Source: Live litecoinspace.org API test 2026-05-22 (RESEARCH Pattern 1).
const LIVE_MEMPOOL_FEE_RESPONSE = {
  fastestFee: 12,
  halfHourFee: 8,
  hourFee: 5,
  economyFee: 3,
  minimumFee: 1,
};

beforeEach(() => {
  _resetEsploraCacheForTesting();
  _resetLitecoinRegistryForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetEsploraCacheForTesting();
  _resetLitecoinRegistryForTesting();
  void _resetRegistryForTesting;
});

async function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_litecoin_fee_estimates");
  if (!tool) throw new Error("get_litecoin_fee_estimates not registered");
  return tool.handler(args);
}

describe("get_litecoin_fee_estimates (LTC-READ-02)", () => {
  it("happy path: mempool.space response → 5-key projection {1,2,3,6,144}", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => LIVE_MEMPOOL_FEE_RESPONSE,
    } satisfies MockResponse)));

    const result = await callTool({});
    expect(result.isError).toBeUndefined();
    const s = result.structuredContent as Record<string, unknown>;
    const fees = s.feeEstimates as Record<string, unknown>;
    expect(Object.keys(fees).sort()).toEqual(["1", "144", "2", "3", "6"]);
    expect(fees["1"]).toBe(12);   // fastestFee
    expect(fees["2"]).toBe(8);    // halfHourFee
    expect(fees["3"]).toBe(5);    // hourFee
    expect(fees["6"]).toBe(3);    // economyFee
    expect(fees["144"]).toBe(1);  // minimumFee
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

  it("sat/vB unit preserved (no conversion to sat/byte or LTC/kvB)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => LIVE_MEMPOOL_FEE_RESPONSE,
    } satisfies MockResponse)));

    const result = await callTool({});
    const s = result.structuredContent as Record<string, unknown>;
    expect(s.units).toBe("sat/vB");
  });

  it("INPUT_SCHEMA: empty object (no args)", () => {
    const tool = getRegisteredTool("get_litecoin_fee_estimates");
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as Record<string, unknown>;
    expect(schema.properties).toEqual({});
    expect(schema.additionalProperties).toBe(false);
  });
});
