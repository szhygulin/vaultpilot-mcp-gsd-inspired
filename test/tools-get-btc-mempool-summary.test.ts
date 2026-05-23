// test/tools-get-btc-mempool-summary.test.ts — Phase 27 Plan 27-02 (BTC-FORENSIC-05).
//
// Unit tests for src/tools/get_btc_mempool_summary.ts — Bitcoin mempool census tool.
//
// Test seam: vi.stubGlobal("fetch", …) for Core RPC calls.
// Env seam: process.env.BITCOIN_CORE_RPC_URL / USER / PASS manipulation per test.
//
// PITFALL-6 DEFENSE anchor: assertions that fetch is NEVER called with method
// "getrawmempool" — only "getmempoolinfo" is acceptable.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/tools/get_btc_mempool_summary.js";
import { getRegisteredTool } from "../src/tools/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCoreRpcFetch(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let callCount = 0;
  return vi.fn().mockImplementation((_url: unknown, init?: RequestInit) => {
    const resp = responses[callCount];
    callCount++;
    if (!resp) {
      return Promise.resolve(new Response("unexpected call", { status: 500 }));
    }
    // Parse the method from the request body to check for Pitfall-6 violations.
    if (init?.body) {
      const body = JSON.parse(init.body as string) as { method?: string };
      if (body.method === "getrawmempool") {
        throw new Error("PITFALL-6 VIOLATION: getrawmempool must never be called");
      }
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

describe("get_btc_mempool_summary", () => {
  beforeEach(() => {
    delete process.env.BITCOIN_CORE_RPC_URL;
    delete process.env.BITCOIN_CORE_RPC_USER;
    delete process.env.BITCOIN_CORE_RPC_PASS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── core-not-configured (no env var) ─────────────────────────────────────

  it("returns core-not-configured with esploraFallbackAvailable: false when BITCOIN_CORE_RPC_URL is unset", async () => {
    const result = await invokeTool("get_btc_mempool_summary");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("core-not-configured");
    expect(sc.esploraFallbackAvailable).toBe(false);
    expect(typeof sc.message).toBe("string");
  });

  // ─── Core ok path ─────────────────────────────────────────────────────────

  it("returns ok with mempool census fields when Core is configured and returns 200", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    const mempoolInfoBody = {
      result: {
        loaded: true,
        size: 150000,
        bytes: 80_000_000,
        usage: 100_000_000,
        maxmempool: 300_000_000,
        mempoolminfee: 0.00001,
        minrelaytxfee: 0.00001,
        unbroadcastcount: 5,
      },
      error: null,
      id: "vaultpilot",
    };

    vi.stubGlobal("fetch", makeCoreRpcFetch([{ status: 200, body: mempoolInfoBody }]));

    const result = await invokeTool("get_btc_mempool_summary");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("ok");
    expect(sc.size).toBe(150000);
    expect(sc.bytes).toBe(80_000_000);
    expect(sc.mempoolminfee).toBe(0.00001);
    expect(sc.minrelaytxfee).toBe(0.00001);
    expect(sc.maxmempool).toBe(300_000_000);
    expect(sc.unbroadcastcount).toBe(5);
    expect(sc.feeHistogram).toBe("not-available-without-getrawmempool");
    expect(sc.source).toBe("bitcoin-core");
  });

  // ─── feeHistogram literal anchor (RESEARCH §PR #21422) ──────────────────

  it("feeHistogram field is the literal string 'not-available-without-getrawmempool' (RESEARCH §PR #21422 anchor)", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    vi.stubGlobal(
      "fetch",
      makeCoreRpcFetch([
        {
          status: 200,
          body: {
            result: {
              loaded: true,
              size: 1000,
              bytes: 500_000,
              usage: 1_000_000,
              maxmempool: 300_000_000,
              mempoolminfee: 0.000025,
              minrelaytxfee: 0.00001,
              unbroadcastcount: 0,
            },
            error: null,
            id: "vaultpilot",
          },
        },
      ]),
    );

    const result = await invokeTool("get_btc_mempool_summary");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("ok");
    expect(sc.feeHistogram).toBe("not-available-without-getrawmempool");
  });

  // ─── HTTP 500 RPC error ────────────────────────────────────────────────────

  it("returns rpc-error with BITCOIN_CORE_RPC_ERROR on HTTP 500", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

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

    const result = await invokeTool("get_btc_mempool_summary");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.errorCode).toBe("BITCOIN_CORE_RPC_ERROR");
  });

  // ─── Network timeout (AbortError) ─────────────────────────────────────────

  it("returns network-error with BITCOIN_CORE_NETWORK_ERROR on AbortError (timeout)", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        return Promise.reject(err);
      }),
    );

    const result = await invokeTool("get_btc_mempool_summary");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.errorCode).toBe("BITCOIN_CORE_NETWORK_ERROR");
  });

  // ─── URL secret-safety scrub (T-27-CORE-CRED-LEAK) ───────────────────────

  it("does not leak embedded credentials from BITCOIN_CORE_RPC_URL in response (T-27-CORE-CRED-LEAK)", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://secret:topsecret@localhost:8332";

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

    const result = await invokeTool("get_btc_mempool_summary");
    const serialized = JSON.stringify(result);

    expect(serialized.includes("topsecret")).toBe(false);
    expect(serialized.includes("secret:topsecret")).toBe(false);
  });

  // ─── PITFALL-6 DEFENSE: getrawmempool NEVER called ────────────────────────

  it("NEVER calls getrawmempool — only getmempoolinfo is sent to Core (RESEARCH §Pitfall 6 defense)", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

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
                size: 50000,
                bytes: 25_000_000,
                usage: 50_000_000,
                maxmempool: 300_000_000,
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

    await invokeTool("get_btc_mempool_summary");

    // Assertion: only "getmempoolinfo" was sent — never "getrawmempool".
    expect(calledMethods).toEqual(["getmempoolinfo"]);
    expect(calledMethods).not.toContain("getrawmempool");
  });
});
