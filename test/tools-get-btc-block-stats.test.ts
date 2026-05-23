// test/tools-get-btc-block-stats.test.ts — Phase 27 Plan 27-01 (BTC-FORENSIC-03).
//
// Unit tests for src/tools/get_btc_block_stats.ts — per-block forensic stats tool.
//
// Test seam: vi.stubGlobal("fetch", …) at the OUTER network boundary.
// Env seam: process.env BITCOIN_CORE_RPC_URL manipulation per test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/tools/get_btc_block_stats.js";
import { getRegisteredTool } from "../src/tools/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRpcFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

async function invokeTool(args: Record<string, unknown>) {
  const tool = getRegisteredTool("get_btc_block_stats");
  if (!tool) throw new Error("Tool not found: get_btc_block_stats");
  return tool.handler(args);
}

// ─── Standard getblockstats response fixture ─────────────────────────────────

const MOCK_BLOCK_STATS = {
  blockhash: "00000000000000000beefbeefbeefbeef000000000000000000000000000dead",
  height: 850000,
  time: 1700000000,
  mediantime: 1699999900,
  txs: 2000,
  swtxs: 1800,
  feerate_percentiles: [1, 2, 5, 10, 50] as [number, number, number, number, number],
  total_size: 1_500_000,
  total_weight: 4_000_000,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("get_btc_block_stats", () => {
  beforeEach(() => {
    delete process.env.BITCOIN_CORE_RPC_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Input validation ──────────────────────────────────────────────────────

  it("returns INVALID_INPUT for blockHeight: -1", async () => {
    const result = await invokeTool({ blockHeight: -1 });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
    expect(sc.status).toBe("invalid-input");
  });

  it("returns INVALID_INPUT for blockHeight: 1.5 (non-integer)", async () => {
    const result = await invokeTool({ blockHeight: 1.5 });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT for blockHeight: 'abc' (string)", async () => {
    const result = await invokeTool({ blockHeight: "abc" });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT when blockHeight is missing", async () => {
    const result = await invokeTool({});
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  // ─── core-not-configured ───────────────────────────────────────────────────

  it("returns core-not-configured when BITCOIN_CORE_RPC_URL is unset", async () => {
    const result = await invokeTool({ blockHeight: 850000 });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.status).toBe("core-not-configured");
    expect(sc.esploraFallbackAvailable).toBe(false);
  });

  // ─── ok path ──────────────────────────────────────────────────────────────

  it("returns ok with correct segwitAdoptionPct and taprootAdoption literal", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    vi.stubGlobal(
      "fetch",
      makeRpcFetch(200, {
        result: MOCK_BLOCK_STATS,
        error: null,
        id: "vaultpilot",
      }),
    );

    const result = await invokeTool({ blockHeight: 850000 });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("ok");
    expect(sc.blockHeight).toBe(850000);
    expect(sc.txCount).toBe(2000);
    expect(sc.segwitTxCount).toBe(1800);
    // 1800/2000 = 0.9 → 90.0% (rounded to 1 decimal)
    expect(sc.segwitAdoptionPct).toBe(90);
    // RESEARCH §Pitfall 3 anchor — MUST be this exact literal string
    expect(sc.taprootAdoption).toBe("not-available-via-getblockstats");
    expect(sc.source).toBe("bitcoin-core");

    const fees = sc.feePercentilesSatVb as Record<string, unknown>;
    expect(fees.p10).toBe(1);
    expect(fees.p25).toBe(2);
    expect(fees.p50).toBe(5);
    expect(fees.p75).toBe(10);
    expect(fees.p90).toBe(50);
  });

  it("returns segwitAdoptionPct: 0 when txs === 0 (no divide-by-zero)", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    vi.stubGlobal(
      "fetch",
      makeRpcFetch(200, {
        result: { ...MOCK_BLOCK_STATS, txs: 0, swtxs: 0 },
        error: null,
        id: "vaultpilot",
      }),
    );

    const result = await invokeTool({ blockHeight: 850000 });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("ok");
    expect(sc.segwitAdoptionPct).toBe(0);
  });

  it("returns segwitAdoptionPct: 90 for 1800/2000 (RESEARCH §getblockstats derivation)", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    vi.stubGlobal(
      "fetch",
      makeRpcFetch(200, {
        result: { ...MOCK_BLOCK_STATS, txs: 2000, swtxs: 1800 },
        error: null,
        id: "vaultpilot",
      }),
    );

    const result = await invokeTool({ blockHeight: 850000 });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.segwitAdoptionPct).toBe(90);
  });

  // ─── RPC error path ────────────────────────────────────────────────────────

  it("returns BITCOIN_CORE_RPC_ERROR errorCode on HTTP 500 rpc error", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    vi.stubGlobal(
      "fetch",
      makeRpcFetch(500, {
        result: null,
        error: { code: -32601, message: "Method not found" },
        id: "vaultpilot",
      }),
    );

    const result = await invokeTool({ blockHeight: 850000 });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.errorCode).toBe("BITCOIN_CORE_RPC_ERROR");
    expect(sc.status).toBe("rpc-error");
  });

  // ─── Credential-leak scrub test (T-27-02) ─────────────────────────────────

  it("does not leak BITCOIN_CORE_RPC_URL credentials in response (T-27-02)", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://secret:topsecret@localhost:8332";

    vi.stubGlobal(
      "fetch",
      makeRpcFetch(500, {
        result: null,
        error: { code: -32601, message: "Method not found" },
        id: "vaultpilot",
      }),
    );

    const result = await invokeTool({ blockHeight: 850000 });
    const responseJson = JSON.stringify(result);

    expect(responseJson.includes("topsecret")).toBe(false);
    expect(responseJson.includes("secret:topsecret")).toBe(false);
  });
});
