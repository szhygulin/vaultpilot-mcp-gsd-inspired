// test/get-litecoin-balance.test.ts — Phase 26 Plan 26-01 (LTC-READ-01).
//
// MCP tool: single-address BalanceReport for L-prefix (legacy) or
// ltc1q… (segwit) LTC addresses. Pattern-matches on the 5-arm Esplora
// client union; NEVER throws. Decimal-string boundary for bigint litoshi
// amounts (CLAUDE.md "Decimal-aware arithmetic").
//
// Test seam: `vi.stubGlobal("fetch", ...)` at the OUTER network boundary
// (CLAUDE.md ESM spy-affordance convention for external HTTP clients).
//
// Coverage:
//   1. Happy path for ltc1q segwit → kind:"ok", balance > 0, utxos populated
//   2. Happy path for L-prefix legacy → kind:"ok"
//   3. 404 from Esplora → kind:"not-found" envelope (NOT errorCode error)
//   4. 429 → errorCode:"ESPLORA_RATE_LIMITED" envelope
//   5. 5xx → errorCode:"ESPLORA_ERROR" envelope
//   6. bigint litoshi amounts at boundary serialized as decimal STRING
//   7. Empty wallet input → INVALID_INPUT envelope
//   8. INPUT_SCHEMA pattern enforces ltc1q / L-prefix shape

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetLitecoinRegistryForTesting } from "../src/chains/litecoin/registry.js";
import { _resetEsploraCacheForTesting } from "../src/chains/litecoin/esplora-client.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const SEGWIT_ADDR = "ltc1q" + "a".repeat(38); // valid ltc1q pattern
const LEGACY_ADDR = "LXuMFER8KyoMon9HhWrDbyyHRtf2YXtdM3";

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

function buildFetch(opts: {
  status?: number;
  payload?: unknown;
  routes?: Array<{ match: string; status?: number; payload?: unknown }>;
}): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (opts.routes) {
      const utxoMatch = opts.routes.find((r) => r.match === "/utxo");
      if (utxoMatch && url.endsWith("/utxo")) {
        const status = utxoMatch.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => utxoMatch.payload,
        } satisfies MockResponse;
      }
      for (const route of opts.routes) {
        if (route.match !== "/utxo" && url.includes(route.match)) {
          const status = route.status ?? 200;
          return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => route.payload,
          } satisfies MockResponse;
        }
      }
    }
    const status = opts.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => opts.payload,
    } satisfies MockResponse;
  });
}

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
  const tool = getRegisteredTool("get_litecoin_balance");
  if (!tool) throw new Error("get_litecoin_balance not registered");
  return tool.handler(args);
}

describe("get_litecoin_balance (LTC-READ-01)", () => {
  it("happy path: ltc1q segwit → kind:'ok', confirmedBalanceSats > 0, utxos populated", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetch({
        routes: [
          {
            match: "/utxo",
            payload: [
              {
                txid: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
                vout: 0,
                value: 16767240,
                status: { confirmed: true, block_height: 2_500_000 },
              },
            ],
          },
          {
            match: `/address/${SEGWIT_ADDR}`,
            payload: {
              chain_stats: {
                funded_txo_sum: 16781533,
                spent_txo_sum: 14293,
                tx_count: 102,
              },
              mempool_stats: {
                funded_txo_sum: 0,
                spent_txo_sum: 0,
                tx_count: 0,
              },
            },
          },
        ],
      }),
    );

    const result = await callTool({ wallet: SEGWIT_ADDR });
    expect(result.isError).toBeUndefined();
    const s = result.structuredContent as Record<string, unknown>;
    expect(s.kind).toBe("ok");
    expect(s.address).toBe(SEGWIT_ADDR);
    expect(s.confirmedBalanceSats).toBe("16767240"); // bigint → string
    expect(s.unconfirmedBalanceSats).toBe("0");
    expect(s.txCount).toBe(102);
    expect(Array.isArray(s.utxos)).toBe(true);
    expect((s.utxos as unknown[]).length).toBe(1);
  });

  it("happy path: L-prefix legacy → kind:'ok'", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetch({
        routes: [
          { match: "/utxo", payload: [] },
          {
            match: `/address/${LEGACY_ADDR}`,
            payload: {
              chain_stats: { funded_txo_sum: 1000, spent_txo_sum: 0, tx_count: 1 },
              mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
            },
          },
        ],
      }),
    );

    const result = await callTool({ wallet: LEGACY_ADDR });
    expect(result.isError).toBeUndefined();
    const s = result.structuredContent as Record<string, unknown>;
    expect(s.kind).toBe("ok");
    expect(s.confirmedBalanceSats).toBe("1000");
  });

  it("404 from Esplora → kind:'not-found' envelope (NOT errorCode)", async () => {
    vi.stubGlobal("fetch", buildFetch({ status: 404, payload: {} }));

    const result = await callTool({ wallet: SEGWIT_ADDR });
    expect(result.isError).toBeUndefined(); // not-found is a normal arm
    const s = result.structuredContent as Record<string, unknown>;
    expect(s.kind).toBe("not-found");
    expect(s.address).toBe(SEGWIT_ADDR);
  });

  it("429 → errorCode:'ESPLORA_RATE_LIMITED' error envelope", async () => {
    vi.stubGlobal("fetch", buildFetch({ status: 429, payload: {} }));

    const result = await callTool({ wallet: SEGWIT_ADDR });
    expect(result.isError).toBe(true);
    const s = result.structuredContent as Record<string, unknown>;
    expect(s.errorCode).toBe("ESPLORA_RATE_LIMITED");
    expect(typeof s.message).toBe("string");
  });

  it("5xx → errorCode:'ESPLORA_ERROR' error envelope", async () => {
    vi.stubGlobal("fetch", buildFetch({ status: 500, payload: {} }));

    const result = await callTool({ wallet: SEGWIT_ADDR });
    expect(result.isError).toBe(true);
    const s = result.structuredContent as Record<string, unknown>;
    expect(s.errorCode).toBe("ESPLORA_ERROR");
  });

  it("bigint litoshi amounts serialize as decimal STRING (NOT number)", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetch({
        routes: [
          { match: "/utxo", payload: [] },
          {
            match: `/address/${SEGWIT_ADDR}`,
            payload: {
              chain_stats: { funded_txo_sum: 100, spent_txo_sum: 0, tx_count: 1 },
              mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
            },
          },
        ],
      }),
    );

    const result = await callTool({ wallet: SEGWIT_ADDR });
    const s = result.structuredContent as Record<string, unknown>;
    expect(typeof s.confirmedBalanceSats).toBe("string");
    expect(typeof s.unconfirmedBalanceSats).toBe("string");
  });

  it("empty wallet input → INVALID_INPUT envelope", async () => {
    const result = await callTool({ wallet: "" });
    expect(result.isError).toBe(true);
    expect((result.structuredContent as Record<string, unknown>).errorCode).toBe(
      "INVALID_INPUT",
    );
  });

  it("INPUT_SCHEMA pattern enforces ltc1q / L-prefix shape", () => {
    const tool = getRegisteredTool("get_litecoin_balance");
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.wallet?.pattern).toBe(
      "^(ltc1q[02-9ac-hj-np-z]{38}|L[1-9A-HJ-NP-Za-km-z]{26,33})$",
    );
  });
});
