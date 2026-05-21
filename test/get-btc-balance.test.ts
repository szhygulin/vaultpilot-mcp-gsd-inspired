// test/get-btc-balance.test.ts — Phase 22 Plan 22-03 Task 2 (BTC-READ-01).
//
// MCP tool: single-address BalanceReport for bc1q… (segwit) or bc1p…
// (taproot). Pattern-matches on the 5-arm Esplora client union; NEVER
// throws. Decimal-string boundary for bigint sat amounts (CLAUDE.md
// "Decimal-aware arithmetic").
//
// Test seam: `vi.stubGlobal("fetch", ...)` at the OUTER network boundary
// (CLAUDE.md ESM spy-affordance convention for external HTTP clients).
//
// Coverage:
//   1. Happy path for bc1q segwit → kind:"ok", balance > 0, utxos populated
//   2. Happy path for bc1p taproot → kind:"ok"
//   3. 404 from Esplora → kind:"not-found" envelope (NOT errorCode error)
//   4. 429 → errorCode:"ESPLORA_RATE_LIMITED" envelope
//   5. 5xx → errorCode:"ESPLORA_ERROR" envelope
//   6. bigint at boundary serialized as decimal STRING
//   7. Schema-rejects malformed address (pattern mismatch surfaces INVALID_INPUT)
//   8. Empty wallet input → INVALID_INPUT envelope

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetBitcoinRegistryForTesting } from "../src/chains/bitcoin/registry.js";
import { _resetEsploraCacheForTesting } from "../src/chains/bitcoin/esplora-client.js";
import {
  _resetRegistryForTesting,
  getRegisteredTool,
  type ToolHandlerResult,
} from "../src/tools/index.js";
import "../src/tools/register-all.js";

const SEGWIT_ADDR = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const TAPROOT_ADDR =
  "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

function buildFetch(opts: {
  status?: number;
  payload?: unknown;
  // Map of URL substring → response. Lets a single fetch mock distinguish
  // /address/{addr} from /address/{addr}/utxo.
  routes?: Array<{ match: string; status?: number; payload?: unknown }>;
}): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (opts.routes) {
      // /utxo is the most specific (it's a suffix path); test it first.
      // /address/{addr} matches the bare endpoint without /utxo.
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
  const tool = getRegisteredTool("get_btc_balance");
  if (!tool) throw new Error("get_btc_balance not registered");
  return tool.handler(args);
}

describe("get_btc_balance (BTC-READ-01)", () => {
  it("happy path: bc1q segwit → kind:'ok', confirmedBalanceSats > 0, utxos populated", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetch({
        routes: [
          {
            match: "/utxo", // longer than /address/{addr} → sorts first below
            // Sentinel: prefix with a unique long marker so the
            // length-sort below resolves /utxo before /address/{addr}.
            payload: [
              {
                txid: "f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16",
                vout: 0,
                value: 16767240,
                status: { confirmed: true, block_height: 800_000 },
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

  it("happy path: bc1p taproot → kind:'ok'", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetch({
        routes: [
          { match: "/utxo", payload: [] },
          {
            match: `/address/${TAPROOT_ADDR}`,
            payload: {
              chain_stats: { funded_txo_sum: 1000, spent_txo_sum: 0, tx_count: 1 },
              mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
            },
          },
        ],
      }),
    );

    const result = await callTool({ wallet: TAPROOT_ADDR });
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

  it("bigint sat amounts serialize as decimal STRING (NOT number)", async () => {
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

  it("INPUT_SCHEMA pattern enforces bc1q/bc1p shape", () => {
    const tool = getRegisteredTool("get_btc_balance");
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.wallet?.pattern).toBe(
      "^bc1(q[02-9ac-hj-np-z]{38}|p[02-9ac-hj-np-z]{58})$",
    );
  });
});
