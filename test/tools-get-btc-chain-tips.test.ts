// test/tools-get-btc-chain-tips.test.ts — Phase 27 Plan 27-01 (BTC-FORENSIC-04).
//
// Unit tests for src/tools/get_btc_chain_tips.ts — chain-tip + reorg detection.
//
// Test seam: vi.stubGlobal("fetch", …) at the OUTER network boundary.
// Env seam: process.env BITCOIN_CORE_RPC_URL manipulation per test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/tools/get_btc_chain_tips.js";
import { getRegisteredTool } from "../src/tools/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function invokeTool() {
  const tool = getRegisteredTool("get_btc_chain_tips");
  if (!tool) throw new Error("Tool not found: get_btc_chain_tips");
  return tool.handler({});
}

function makeRpcFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("get_btc_chain_tips", () => {
  beforeEach(() => {
    delete process.env.BITCOIN_CORE_RPC_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── core-not-configured ───────────────────────────────────────────────────

  it("returns core-not-configured with esploraFallbackAvailable: false when URL is unset", async () => {
    const result = await invokeTool();
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("core-not-configured");
    expect(sc.esploraFallbackAvailable).toBe(false);
  });

  // ─── Single active tip ─────────────────────────────────────────────────────

  it("returns ok with tips=[active] and empty reorgSignals for a single active tip", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    vi.stubGlobal(
      "fetch",
      makeRpcFetch(200, {
        result: [
          { hash: "abc123", height: 850000, branchlen: 0, status: "active" },
        ],
        error: null,
        id: "vaultpilot",
      }),
    );

    const result = await invokeTool();
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("ok");
    const tips = sc.tips as Array<Record<string, unknown>>;
    expect(tips.length).toBe(1);
    const reorgSignals = sc.reorgSignals as Array<Record<string, unknown>>;
    expect(reorgSignals.length).toBe(0);
    expect(sc.source).toBe("bitcoin-core");
  });

  // ─── Active + valid-fork ───────────────────────────────────────────────────

  it("detects reorg signal: active + valid-fork with branchlen 2", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    vi.stubGlobal(
      "fetch",
      makeRpcFetch(200, {
        result: [
          { hash: "abc123", height: 850000, branchlen: 0, status: "active" },
          { hash: "fork456", height: 849999, branchlen: 2, status: "valid-fork" },
        ],
        error: null,
        id: "vaultpilot",
      }),
    );

    const result = await invokeTool();
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("ok");
    const tips = sc.tips as Array<Record<string, unknown>>;
    expect(tips.length).toBe(2);

    const reorgSignals = sc.reorgSignals as Array<Record<string, unknown>>;
    expect(reorgSignals.length).toBe(1);
    expect(reorgSignals[0]!.status).toBe("valid-fork");
    expect(reorgSignals[0]!.branchlen).toBe(2);
  });

  // ─── branchlen === 0 on non-active tip → NOT a reorg signal ────────────────

  it("does NOT flag headers-only tip with branchlen === 0 as a reorg signal", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    vi.stubGlobal(
      "fetch",
      makeRpcFetch(200, {
        result: [
          { hash: "abc123", height: 850000, branchlen: 0, status: "active" },
          { hash: "same789", height: 850000, branchlen: 0, status: "headers-only" },
        ],
        error: null,
        id: "vaultpilot",
      }),
    );

    const result = await invokeTool();
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("ok");
    const reorgSignals = sc.reorgSignals as Array<Record<string, unknown>>;
    // branchlen === 0 means same-height alt-tip, NOT a reorg signal
    expect(reorgSignals.length).toBe(0);
  });

  // ─── HTTP 500 RPC error ────────────────────────────────────────────────────

  it("returns BITCOIN_CORE_RPC_ERROR on HTTP 500", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    vi.stubGlobal(
      "fetch",
      makeRpcFetch(500, {
        result: null,
        error: { code: -32601, message: "Method not found" },
        id: "vaultpilot",
      }),
    );

    const result = await invokeTool();
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

    const result = await invokeTool();
    const responseJson = JSON.stringify(result);

    expect(responseJson.includes("topsecret")).toBe(false);
    expect(responseJson.includes("secret:topsecret")).toBe(false);
  });
});
