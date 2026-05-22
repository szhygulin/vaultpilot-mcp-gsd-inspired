// test/tools-get-litecoin-mempool-summary.test.ts — Phase 27 Plan 27-02 (LTC-FORENSIC-01 / mempool).
//
// Unit tests for src/tools/get_litecoin_mempool_summary.ts — Litecoin mempool census tool.
//
// Test seam: vi.stubGlobal("fetch", …) for Core RPC calls.
// Env seam: process.env.LITECOIN_CORE_RPC_URL / USER / PASS manipulation per test.
//
// MWEB field exclusion anchor: fictitious mweb_* fields injected in response body
// are absorbed by index signature and MUST NOT appear in structuredContent.
//
// PITFALL-6 DEFENSE anchor: getrawmempool NEVER called — only getmempoolinfo.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/tools/get_litecoin_mempool_summary.js";
import { getRegisteredTool } from "../src/tools/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("get_litecoin_mempool_summary", () => {
  beforeEach(() => {
    delete process.env.LITECOIN_CORE_RPC_URL;
    delete process.env.LITECOIN_CORE_RPC_USER;
    delete process.env.LITECOIN_CORE_RPC_PASS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── core-not-configured (no env var) ─────────────────────────────────────

  it("returns core-not-configured with esploraFallbackAvailable: false when LITECOIN_CORE_RPC_URL is unset", async () => {
    const result = await invokeTool("get_litecoin_mempool_summary");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("core-not-configured");
    expect(sc.esploraFallbackAvailable).toBe(false);
    expect(typeof sc.message).toBe("string");
  });

  // ─── Core ok path + MWEB field exclusion ──────────────────────────────────

  it("returns ok with standard fields and does NOT surface MWEB fields from Core response", async () => {
    process.env.LITECOIN_CORE_RPC_URL = "http://localhost:9332";

    // Include fictitious MWEB fields in the Core response body.
    // These MUST NOT appear in structuredContent (RESEARCH §Pitfall 5 anchor).
    const mempoolInfoBody = {
      result: {
        loaded: true,
        size: 5000,
        bytes: 2_000_000,
        usage: 5_000_000,
        maxmempool: 50_000_000,
        mempoolminfee: 0.00001,
        minrelaytxfee: 0.00001,
        unbroadcastcount: 0,
        // MWEB-specific fields — absorbed by index signature, NOT surfaced:
        mweb_usage: 100_000,
        mweb_size: 50,
      },
      error: null,
      id: "vaultpilot",
    };

    vi.stubGlobal("fetch", makeCoreRpcFetch([{ status: 200, body: mempoolInfoBody }]));

    const result = await invokeTool("get_litecoin_mempool_summary");
    const sc = result.structuredContent as Record<string, unknown>;

    // Standard fields present
    expect(sc.status).toBe("ok");
    expect(sc.size).toBe(5000);
    expect(sc.bytes).toBe(2_000_000);
    expect(sc.mempoolminfee).toBe(0.00001);
    expect(sc.source).toBe("litecoin-core");

    // MWEB fields NOT surfaced (RESEARCH §Pitfall 5 anchor)
    expect(sc).not.toHaveProperty("mweb_usage");
    expect(sc).not.toHaveProperty("mweb_size");

    // Serialized response also doesn't contain MWEB field names
    const serialized = JSON.stringify(sc);
    expect(serialized).not.toContain("mweb_usage");
    expect(serialized).not.toContain("mweb_size");
  });

  // ─── HTTP 500 RPC error ────────────────────────────────────────────────────

  it("returns rpc-error with LITECOIN_CORE_RPC_ERROR on HTTP 500", async () => {
    process.env.LITECOIN_CORE_RPC_URL = "http://localhost:9332";

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

    const result = await invokeTool("get_litecoin_mempool_summary");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.errorCode).toBe("LITECOIN_CORE_RPC_ERROR");
    // Sanity: distinct from BTC prefix
    expect(sc.errorCode).not.toBe("BITCOIN_CORE_RPC_ERROR");
  });

  // ─── URL secret-safety scrub (T-27-LTC-CRED-LEAK) ─────────────────────────

  it("does not leak LITECOIN_CORE_RPC_URL credentials in response (T-27-LTC-CRED-LEAK)", async () => {
    process.env.LITECOIN_CORE_RPC_URL = "http://ltcuser:ltcsecret@localhost:9332";

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

    const result = await invokeTool("get_litecoin_mempool_summary");
    const serialized = JSON.stringify(result);

    expect(serialized.includes("ltcsecret")).toBe(false);
    expect(serialized.includes("ltcuser:ltcsecret")).toBe(false);
  });

  // ─── PITFALL-6 DEFENSE: getrawmempool NEVER called ────────────────────────

  it("NEVER calls getrawmempool — only getmempoolinfo is sent to Core (RESEARCH §Pitfall 6 defense)", async () => {
    process.env.LITECOIN_CORE_RPC_URL = "http://localhost:9332";

    const calledMethods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
        if (init?.body) {
          const body = JSON.parse(init.body as string) as { method?: string };
          if (body.method) calledMethods.push(body.method);
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              result: {
                loaded: true,
                size: 5000,
                bytes: 2_000_000,
                usage: 5_000_000,
                maxmempool: 50_000_000,
                mempoolminfee: 0.00001,
                minrelaytxfee: 0.00001,
                unbroadcastcount: 0,
              },
              error: null,
              id: "vaultpilot",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }),
    );

    await invokeTool("get_litecoin_mempool_summary");

    expect(calledMethods).toEqual(["getmempoolinfo"]);
    expect(calledMethods).not.toContain("getrawmempool");
  });
});
