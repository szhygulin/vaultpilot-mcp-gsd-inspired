// test/tools-get-litecoin-block-tip.test.ts — Phase 27 Plan 27-02 (LTC-FORENSIC-01 / tip).
//
// Unit tests for src/tools/get_litecoin_block_tip.ts — Litecoin chain-tip forensic tool.
//
// Test seam: vi.stubGlobal("fetch", …) for Esplora calls + Core RPC calls.
// Spy seam: vi.spyOn(_litecoinRegistry, "getEsploraBaseUrl") for Esplora base URL.
// Env seam: process.env.LITECOIN_CORE_RPC_URL / USER / PASS manipulation per test.
//
// ASSUMED A2 regression anchor: the tool must NOT validate the `chain` field from
// getblockchaininfo — the index signature absorbs it regardless of value.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/tools/get_litecoin_block_tip.js";
import { getRegisteredTool } from "../src/tools/index.js";
import { _litecoinRegistry } from "../src/chains/litecoin/registry.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEsploraFetch(
  heightStatus: number,
  heightBody: string,
  hashStatus: number,
  hashBody: string,
): typeof fetch {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/blocks/tip/height")) {
      return Promise.resolve(new Response(heightBody, { status: heightStatus }));
    }
    if (url.includes("/blocks/tip/hash")) {
      return Promise.resolve(new Response(hashBody, { status: hashStatus }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
}

function makeCoreRpcFetch(
  responses: Array<{ status: number; body: unknown }>,
): typeof fetch {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    const resp = responses[callCount];
    callCount++;
    if (!resp) {
      return Promise.resolve(new Response("unexpected call", { status: 500 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(resp.body), {
        status: resp.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

async function invokeTool(name: string, args: Record<string, unknown> = {}) {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool.handler(args);
}

const LTC_ESPLORA_BASE = "https://litecoinspace.org/api";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("get_litecoin_block_tip", () => {
  beforeEach(() => {
    delete process.env.LITECOIN_CORE_RPC_URL;
    delete process.env.LITECOIN_CORE_RPC_USER;
    delete process.env.LITECOIN_CORE_RPC_PASS;
    vi.spyOn(_litecoinRegistry, "getEsploraBaseUrl").mockReturnValue(LTC_ESPLORA_BASE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Esplora fallback path ─────────────────────────────────────────────────

  it("returns core-not-configured with Esplora tip when LITECOIN_CORE_RPC_URL is unset", async () => {
    vi.stubGlobal(
      "fetch",
      makeEsploraFetch(
        200,
        "2750000",
        200,
        "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      ),
    );

    const result = await invokeTool("get_litecoin_block_tip");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("core-not-configured");
    expect(sc.esploraFallbackAvailable).toBe(true);
    expect(sc.source).toBe("esplora-litecoinspace");

    const tip = sc.tip as Record<string, unknown> | null;
    expect(tip).not.toBeNull();
    expect(tip!.height).toBe(2750000);
    expect(tip!.hash).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
    expect(tip!.difficulty).toBeNull();
    expect(tip!.timestamp).toBeNull();
  });

  // ─── WR-04 anchor: strict integer regex rejects digit-prefixed garbage ─────
  // litecoinspace.org is operator-configurable for LTC; mirror the BTC fix.

  it("WR-04: rejects digit-prefixed garbage from Esplora /blocks/tip/height (e.g. '2750000<html>')", async () => {
    vi.stubGlobal(
      "fetch",
      makeEsploraFetch(200, "2750000<html>", 200, "abc123"),
    );

    const result = await invokeTool("get_litecoin_block_tip");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("core-not-configured");
    expect(sc.tip).toBeNull();
    expect(typeof sc.esploraError).toBe("string");
    expect(sc.esploraError as string).toMatch(/non-integer/);
    expect(sc.esploraError as string).toContain("2750000<html>");
  });

  // ─── Litecoin Core path ────────────────────────────────────────────────────

  it("returns ok with height/difficulty/timestamp from Core 2-call sequence", async () => {
    process.env.LITECOIN_CORE_RPC_URL = "http://localhost:9332";

    const mockFetch = makeCoreRpcFetch([
      // First call: getblockchaininfo
      {
        status: 200,
        body: {
          result: {
            chain: "litecoin",
            blocks: 2750000,
            bestblockhash: "ltchash00000001",
            difficulty: 25e6,
            mediantime: 1700000000,
          },
          error: null,
          id: "vaultpilot",
        },
      },
      // Second call: getblockheader
      {
        status: 200,
        body: {
          result: { time: 1700000099, mediantime: 1700000000 },
          error: null,
          id: "vaultpilot",
        },
      },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    const result = await invokeTool("get_litecoin_block_tip");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("ok");
    expect(sc.source).toBe("litecoin-core");

    const tip = sc.tip as Record<string, unknown>;
    expect(tip.height).toBe(2750000);
    expect(tip.difficulty).toBe(25e6);
    expect(tip.timestamp).toBe(1700000099);
    expect(tip.hash).toBe("ltchash00000001");
  });

  // ─── ASSUMED A2 regression anchor: chain field NOT validated ──────────────

  it("succeeds regardless of chain field value (ASSUMED A2 — index signature absorbs chain: 'main')", async () => {
    process.env.LITECOIN_CORE_RPC_URL = "http://localhost:9332";

    // If LTC Core returns chain: "main" instead of "litecoin", the tool
    // MUST NOT fail or validate the field — index signature absorbs it.
    const mockFetch = makeCoreRpcFetch([
      {
        status: 200,
        body: {
          result: {
            chain: "main", // "main" instead of "litecoin" — must be absorbed
            blocks: 2750001,
            bestblockhash: "ltchash00000002",
            difficulty: 26e6,
            mediantime: 1700001000,
          },
          error: null,
          id: "vaultpilot",
        },
      },
      {
        status: 200,
        body: {
          result: { time: 1700001099, mediantime: 1700001000 },
          error: null,
          id: "vaultpilot",
        },
      },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    const result = await invokeTool("get_litecoin_block_tip");
    const sc = result.structuredContent as Record<string, unknown>;

    // Tool MUST succeed — NOT reject because chain is "main" instead of "litecoin"
    expect(sc.status).toBe("ok");
    const tip = sc.tip as Record<string, unknown>;
    expect(tip.height).toBe(2750001);
    expect(tip.difficulty).toBe(26e6);
  });

  // ─── RPC error path ────────────────────────────────────────────────────────

  it("returns rpc-error with LITECOIN_CORE_RPC_ERROR (distinct from BITCOIN_CORE_* prefix) on HTTP 500", async () => {
    process.env.LITECOIN_CORE_RPC_URL = "http://localhost:9332";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            result: null,
            error: { code: -28, message: "Verifying blocks..." },
            id: "vaultpilot",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await invokeTool("get_litecoin_block_tip");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.errorCode).toBe("LITECOIN_CORE_RPC_ERROR");
    // Sanity: distinct from BTC prefix
    expect(sc.errorCode).not.toBe("BITCOIN_CORE_RPC_ERROR");
  });

  // ─── URL secret-safety scrub (T-27-LTC-CRED-LEAK) ─────────────────────────

  it("does not leak LITECOIN_CORE_RPC_URL credentials in response (T-27-LTC-CRED-LEAK)", async () => {
    process.env.LITECOIN_CORE_RPC_URL = "http://secret:ltcpassword@localhost:9332";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            result: null,
            error: { code: -32603, message: "Internal error" },
            id: "vaultpilot",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const result = await invokeTool("get_litecoin_block_tip");
    const serialized = JSON.stringify(result);

    expect(serialized.includes("ltcpassword")).toBe(false);
    expect(serialized.includes("secret:ltcpassword")).toBe(false);
  });
});
