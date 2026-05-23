// test/tools-get-btc-block-tip.test.ts — Phase 27 Plan 27-01 (BTC-FORENSIC-02).
//
// Unit tests for src/tools/get_btc_block_tip.ts — the Bitcoin chain-tip forensic tool.
//
// Test seam: vi.stubGlobal("fetch", …) for Esplora calls + Core RPC calls.
// Spy seam: vi.spyOn(_bitcoinRegistry, "getEsploraBaseUrl") for Esplora base URL.
// Env seam: process.env BITCOIN_CORE_RPC_URL / USER / PASS manipulation per test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../src/tools/get_btc_block_tip.js";
import { getRegisteredTool } from "../src/tools/index.js";
import { _bitcoinRegistry } from "../src/chains/bitcoin/registry.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mock fetch that returns plain-text responses for /blocks/tip/* */
function makeEsploraFetch(heightStatus: number, heightBody: string, hashStatus: number, hashBody: string): typeof fetch {
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

/** Build Core RPC fetch mock — returns the given JSON bodies in sequence */
function makeCoreRpcFetch(responses: Array<{ status: number; body: unknown }>): typeof fetch {
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

/** Invoke a tool with given args. */
async function invokeTool(name: string, args: Record<string, unknown> = {}) {
  const tool = getRegisteredTool(name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool.handler(args);
}

const ESPLORA_BASE = "https://blockstream.info/api";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("get_btc_block_tip", () => {
  beforeEach(() => {
    // Reset env and spies before each test.
    delete process.env.BITCOIN_CORE_RPC_URL;
    delete process.env.BITCOIN_CORE_RPC_USER;
    delete process.env.BITCOIN_CORE_RPC_PASS;
    vi.spyOn(_bitcoinRegistry, "getEsploraBaseUrl").mockReturnValue(ESPLORA_BASE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Esplora fallback path ─────────────────────────────────────────────────

  it("returns core-not-configured with Esplora tip when BITCOIN_CORE_RPC_URL is unset", async () => {
    vi.stubGlobal(
      "fetch",
      makeEsploraFetch(200, "850000", 200, "00000000000000000deadbeef0000000000000000000000000000000000000001"),
    );

    const result = await invokeTool("get_btc_block_tip");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("core-not-configured");
    expect(sc.esploraFallbackAvailable).toBe(true);
    expect(sc.source).toBe("esplora");

    const tip = sc.tip as Record<string, unknown> | null;
    expect(tip).not.toBeNull();
    expect(tip!.height).toBe(850000);
    expect(tip!.hash).toBe("00000000000000000deadbeef0000000000000000000000000000000000000001");
    expect(tip!.difficulty).toBeNull();
    expect(tip!.timestamp).toBeNull();
  });

  it("returns core-not-configured with tip null and esploraError when Esplora height returns 500", async () => {
    vi.stubGlobal(
      "fetch",
      makeEsploraFetch(500, "Internal Server Error", 200, "abc123"),
    );

    const result = await invokeTool("get_btc_block_tip");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("core-not-configured");
    expect(sc.esploraFallbackAvailable).toBe(true);
    expect(sc.tip).toBeNull();
    expect(typeof sc.esploraError).toBe("string");
    expect((sc.esploraError as string).length).toBeGreaterThan(0);
  });

  // ─── WR-04 anchor: strict integer regex rejects digit-prefixed garbage ─────
  // parseInt("850000<html>", 10) returns 850000 silently. A misbehaving
  // upstream Esplora returning an HTML error page with a leading digit would
  // have leaked garbage past the validation gate. Require ^\d+$ end-to-end.

  it("WR-04: rejects digit-prefixed garbage from Esplora /blocks/tip/height (e.g. '850000<html>')", async () => {
    vi.stubGlobal(
      "fetch",
      makeEsploraFetch(200, "850000<html>", 200, "abc123"),
    );

    const result = await invokeTool("get_btc_block_tip");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("core-not-configured");
    expect(sc.tip).toBeNull();
    expect(typeof sc.esploraError).toBe("string");
    expect(sc.esploraError as string).toMatch(/non-integer/);
    expect(sc.esploraError as string).toContain("850000<html>");
  });

  // ─── Bitcoin Core path ─────────────────────────────────────────────────────

  it("returns ok with height/difficulty/timestamp from Core 2-call sequence", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    const mockFetch = makeCoreRpcFetch([
      // First call: getblockchaininfo
      {
        status: 200,
        body: {
          result: {
            chain: "main",
            blocks: 850000,
            bestblockhash: "abc123def456",
            difficulty: 90e12,
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
          result: { time: 1700000123, mediantime: 1700000000 },
          error: null,
          id: "vaultpilot",
        },
      },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    const result = await invokeTool("get_btc_block_tip");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("ok");
    expect(sc.source).toBe("bitcoin-core");

    const tip = sc.tip as Record<string, unknown>;
    expect(tip.height).toBe(850000);
    expect(tip.difficulty).toBe(90e12);
    expect(tip.timestamp).toBe(1700000123);
    expect(tip.hash).toBe("abc123def456");
  });

  it("calls fetch exactly twice on the Core ok path (2-call sequence anchor)", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

    const mockFetch = makeCoreRpcFetch([
      {
        status: 200,
        body: {
          result: {
            chain: "main",
            blocks: 850000,
            bestblockhash: "abc123",
            difficulty: 90e12,
            mediantime: 1700000000,
          },
          error: null,
          id: "vaultpilot",
        },
      },
      {
        status: 200,
        body: { result: { time: 1700000123, mediantime: 1700000000 }, error: null, id: "vaultpilot" },
      },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    await invokeTool("get_btc_block_tip");

    expect((mockFetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("returns rpc-error status with errorCode BITCOIN_CORE_RPC_ERROR on HTTP 500 auth failure", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://localhost:8332";

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

    const result = await invokeTool("get_btc_block_tip");
    const sc = result.structuredContent as Record<string, unknown>;

    expect(sc.status).toBe("rpc-error");
    expect(sc.errorCode).toBe("BITCOIN_CORE_RPC_ERROR");
  });

  // ─── Credential-leak scrub test (T-27-02) ─────────────────────────────────

  it("does not leak BITCOIN_CORE_RPC_URL credentials in response (T-27-02)", async () => {
    process.env.BITCOIN_CORE_RPC_URL = "http://secret:topsecret@localhost:8332";

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

    const result = await invokeTool("get_btc_block_tip");
    const responseJson = JSON.stringify(result);

    expect(responseJson.includes("topsecret")).toBe(false);
    expect(responseJson.includes("secret:topsecret")).toBe(false);
  });
});
