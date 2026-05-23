// test/tools-get-btc-blocks-recent.test.ts — Phase 27 Plan 27-01 (BTC-FORENSIC-04).
//
// Unit tests for src/tools/get_btc_blocks_recent.ts.
//
// Test seam: vi.stubGlobal("fetch", …) for Esplora + Core RPC calls.
// Env seam: process.env BITCOIN_CORE_RPC_URL manipulation per test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/tools/get_btc_blocks_recent.js";
import { getRegisteredTool } from "../src/tools/index.js";
import { _bitcoinRegistry } from "../src/chains/bitcoin/registry.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function invokeTool(args: Record<string, unknown>) {
  const tool = getRegisteredTool("get_btc_blocks_recent");
  if (!tool) throw new Error("Tool not found: get_btc_blocks_recent");
  return tool.handler(args);
}

const ESPLORA_BASE = "https://blockstream.info/api";

// ─── Mock Esplora /blocks response ───────────────────────────────────────────

function makeEsploraBlocksFetch(blocks: unknown[]): typeof fetch {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/blocks")) {
      return Promise.resolve(
        new Response(JSON.stringify(blocks), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
}

const MOCK_ESPLORA_BLOCKS = Array.from({ length: 10 }, (_, i) => ({
  id: `hash${i.toString().padStart(64, "0")}`,
  height: 850000 - i,
  tx_count: 100 + i,
  size: 900000 + i * 1000,
  timestamp: 1700000000 - i * 600,
}));

// ─── Mock Core RPC fetch ──────────────────────────────────────────────────────

function makeCoreRpcFetch(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    const resp = responses[callCount % responses.length];
    callCount++;
    return Promise.resolve(
      new Response(JSON.stringify(resp!.body), {
        status: resp!.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("get_btc_blocks_recent", () => {
  beforeEach(() => {
    delete process.env.BITCOIN_CORE_RPC_URL;
    vi.spyOn(_bitcoinRegistry, "getEsploraBaseUrl").mockReturnValue(ESPLORA_BASE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Input validation ──────────────────────────────────────────────────────

  it("returns INVALID_INPUT for count: 0", async () => {
    const result = await invokeTool({ count: 0 });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT for count: 51", async () => {
    const result = await invokeTool({ count: 51 });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT for count: '5' (string/non-integer)", async () => {
    const result = await invokeTool({ count: "5" });
    const sc = result.structuredContent as Record<string, unknown>;
    expect(sc.errorCode).toBe("INVALID_INPUT");
  });

  // ─── Esplora fallback ──────────────────────────────────────────────────────

  it("returns 10 blocks with null feePercentilesSatVb via Esplora when Core not configured", async () => {
    vi.stubGlobal("fetch", makeEsploraBlocksFetch(MOCK_ESPLORA_BLOCKS));

    const result = await invokeTool({ count: 10 });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("core-not-configured");
    expect(sc.esploraFallbackAvailable).toBe(true);
    expect(sc.feeFallback).toBe("not-available-without-core-rpc");
    expect(sc.source).toBe("esplora");

    const blocks = sc.blocks as Array<Record<string, unknown>>;
    expect(blocks.length).toBe(10);
    for (const b of blocks) {
      expect(b.feePercentilesSatVb).toBeNull();
      expect(b.segwitAdoptionPct).toBeNull();
    }
  });

  it("includes truncatedToCount: 10 when count > 10 and Esplora returns 10 blocks", async () => {
    vi.stubGlobal("fetch", makeEsploraBlocksFetch(MOCK_ESPLORA_BLOCKS));

    const result = await invokeTool({ count: 20 });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("core-not-configured");
    expect(sc.truncatedToCount).toBe(10);
  });

  // ─── Core path ─────────────────────────────────────────────────────────────

  it("returns blocks from Core with segwit and fee percentiles (count: 3)", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    // getblockchaininfo call returns tip=850000, then 3 getblockstats calls
    const BLOCK_STATS_BASE = {
      blockhash: "deadbeef",
      time: 1700000000,
      txs: 2000,
      swtxs: 1600,
      feerate_percentiles: [1, 2, 5, 10, 50] as [number, number, number, number, number],
      total_size: 1_500_000,
    };

    // Build responses: first is getblockchaininfo, then 3 getblockstats
    const responses = [
      {
        status: 200,
        body: {
          result: { chain: "main", blocks: 850000, bestblockhash: "abc" },
          error: null,
          id: "vaultpilot",
        },
      },
      ...([850000, 849999, 849998].map((h) => ({
        status: 200,
        body: {
          result: { ...BLOCK_STATS_BASE, height: h, blockhash: `hash${h}` },
          error: null,
          id: "vaultpilot",
        },
      }))),
    ];

    vi.stubGlobal("fetch", makeCoreRpcFetch(responses));

    const result = await invokeTool({ count: 3 });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("ok");
    expect(sc.source).toBe("bitcoin-core");

    const blocks = sc.blocks as Array<Record<string, unknown>>;
    expect(blocks.length).toBe(3);
    expect(blocks[0]!.height).toBe(850000);
    expect(blocks[1]!.height).toBe(849999);
    expect(blocks[2]!.height).toBe(849998);

    // Segwit adoption: 1600/2000 = 80%
    expect(blocks[0]!.segwitAdoptionPct).toBe(80);
  });

  it("handles partial failure: 1 of 3 getblockstats errors → that slot has error, others populated", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    const BLOCK_STATS_BASE = {
      blockhash: "deadbeef",
      time: 1700000000,
      txs: 2000,
      swtxs: 1800,
      feerate_percentiles: [1, 2, 5, 10, 50] as [number, number, number, number, number],
      total_size: 1_500_000,
    };

    let callIdx = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callIdx++;
      if (callIdx === 1) {
        // getblockchaininfo
        return Promise.resolve(
          new Response(
            JSON.stringify({
              result: { chain: "main", blocks: 850000, bestblockhash: "abc" },
              error: null,
              id: "vaultpilot",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      // Second call (height 850000) fails; third and fourth succeed
      if (callIdx === 2) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              result: null,
              error: { code: -32603, message: "Block not found" },
              id: "vaultpilot",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      const height = callIdx === 3 ? 849999 : 849998;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: { ...BLOCK_STATS_BASE, height, blockhash: `hash${height}` },
            error: null,
            id: "vaultpilot",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await invokeTool({ count: 3 });
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("ok");
    const blocks = sc.blocks as Array<Record<string, unknown>>;
    expect(blocks.length).toBe(3);

    // First block (height 850000) should have error field
    expect("error" in blocks[0]!).toBe(true);
    expect(blocks[0]!.height).toBe(850000);

    // Other two should be populated normally
    expect("error" in blocks[1]!).toBe(false);
    expect("error" in blocks[2]!).toBe(false);
  });
});
