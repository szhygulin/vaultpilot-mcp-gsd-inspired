// test/clients-bitcoin-core-rpc.test.ts — Phase 27 Plan 27-01 (BTC-FORENSIC-01).
//
// Unit tests for src/clients/bitcoin-core-rpc.ts — the NEVER-throws Bitcoin Core
// JSON-RPC HTTP client.
//
// Test seam: vi.stubGlobal("fetch", …) at the OUTER network boundary per
// CLAUDE.md convention. NO _bitcoinCoreRpcClient indirection — the seam is
// at the global fetch boundary (same as clients-lifi.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BITCOIN_CORE_RPC_TIMEOUT_MS,
  callBitcoinCoreRpc,
  type BitcoinCoreRpcResult,
} from "../src/clients/bitcoin-core-rpc.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock fetch that returns the given status + JSON body. */
function makeJsonFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

/** Build a mock fetch that returns the given status + text body. */
function makeTextFetch(status: number, body: string): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(body, { status, headers: { "Content-Type": "text/plain" } }),
  );
}

/** Build a mock fetch that throws a network error. */
function makeThrowFetch(err: Error): typeof fetch {
  return vi.fn().mockRejectedValue(err);
}

/** Build a mock fetch that aborts (simulates AbortController timeout). */
function makeAbortFetch(): typeof fetch {
  return vi.fn().mockImplementation((_url: RequestInfo | URL, opts?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = opts?.signal as AbortSignal | undefined;
      if (signal) {
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
        });
      }
    });
  });
}

const CORE_URL = "http://localhost:8332";
const USER = "alice";
const PASS = "bobsecret";

// Base64 of "alice:bobsecret" — verifiable: btoa("alice:bobsecret") = "YWxpY2U6Ym9ic2VjcmV0"
const EXPECTED_AUTH_HEADER = "Basic YWxpY2U6Ym9ic2VjcmV0";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("callBitcoinCoreRpc", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Test 1: url null → not-configured without fetch ───────────────────────

  it("returns not-configured when url is null without invoking fetch", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await callBitcoinCoreRpc(null, USER, PASS, "getblockchaininfo", []);

    expect(result.kind).toBe("not-configured");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ─── Test 2: HTTP 200 + success body → ok ──────────────────────────────────

  it("returns ok result on HTTP 200 with valid JSON-RPC success body", async () => {
    vi.stubGlobal(
      "fetch",
      makeJsonFetch(200, { result: { chain: "main", blocks: 850000 }, error: null, id: "vaultpilot" }),
    );

    const result = await callBitcoinCoreRpc<{ chain: string; blocks: number }>(
      CORE_URL, USER, PASS, "getblockchaininfo", [],
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.result.chain).toBe("main");
      expect(result.result.blocks).toBe(850000);
    }
  });

  // ─── Test 3: HTTP 200 + error body → rpc-error ─────────────────────────────

  it("returns rpc-error when HTTP 200 body has non-null error field", async () => {
    vi.stubGlobal(
      "fetch",
      makeJsonFetch(200, {
        result: null,
        error: { code: -32601, message: "Method not found" },
        id: "vaultpilot",
      }),
    );

    const result = await callBitcoinCoreRpc(CORE_URL, USER, PASS, "unknownMethod", []);

    expect(result.kind).toBe("rpc-error");
    if (result.kind === "rpc-error") {
      expect(result.code).toBe(-32601);
      expect(result.message).toBe("Method not found");
    }
  });

  // ─── Test 4: HTTP 500 + parseable rpc-error body → rpc-error ───────────────
  // CRITICAL anchor for RESEARCH §Pitfall 2 — HTTP 500 is the RPC-error path.

  it("parses rpc-error from HTTP 500 JSON body (RESEARCH §Pitfall 2 anchor)", async () => {
    vi.stubGlobal(
      "fetch",
      makeJsonFetch(500, {
        result: null,
        error: { code: -28, message: "Verifying blocks..." },
        id: "vaultpilot",
      }),
    );

    const result = await callBitcoinCoreRpc(CORE_URL, USER, PASS, "getblockchaininfo", []);

    expect(result.kind).toBe("rpc-error");
    if (result.kind === "rpc-error") {
      expect(result.code).toBe(-28);
      expect(result.message).toBe("Verifying blocks...");
    }
  });

  // ─── Test 5: HTTP 500 + unparseable body → rpc-error fallback ──────────────

  it("returns rpc-error with status code fallback on HTTP 500 with unparseable body", async () => {
    vi.stubGlobal("fetch", makeTextFetch(500, "not json"));

    const result = await callBitcoinCoreRpc(CORE_URL, USER, PASS, "getblockchaininfo", []);

    expect(result.kind).toBe("rpc-error");
    if (result.kind === "rpc-error") {
      expect(result.code).toBe(500);
      expect(result.message).toBe("HTTP 500");
    }
  });

  // ─── Test 6: HTTP 429 → rate-limited ───────────────────────────────────────

  it("returns rate-limited on HTTP 429", async () => {
    vi.stubGlobal("fetch", makeTextFetch(429, "Too Many Requests"));

    const result = await callBitcoinCoreRpc(CORE_URL, USER, PASS, "getblockchaininfo", []);

    expect(result.kind).toBe("rate-limited");
    if (result.kind === "rate-limited") {
      expect(result.message).toMatch(/429/);
    }
  });

  // ─── Test 7: fetch throws non-Abort → network-error unreachable ────────────

  it("returns network-error with 'unreachable' when fetch throws a non-Abort error", async () => {
    vi.stubGlobal("fetch", makeThrowFetch(new Error("ECONNREFUSED")));

    const result = await callBitcoinCoreRpc(CORE_URL, USER, PASS, "getblockchaininfo", []);

    expect(result.kind).toBe("network-error");
    if (result.kind === "network-error") {
      expect(result.message).toMatch(/unreachable/);
      expect(result.message).toContain("ECONNREFUSED");
    }
  });

  // ─── Test 8: AbortController setTimeout → controller.abort() → fetch rejects via signal ───
  // Drives the client's REAL internal timeout chain end-to-end with fake timers
  // (per WR-02): the single makeAbortFetch() stub honors opts.signal — when the
  // client's own setTimeout fires after BITCOIN_CORE_RPC_TIMEOUT_MS, the
  // controller.abort() event triggers the fetch to reject with an AbortError,
  // and the client's catch arm classifies it as network-error/timeout.

  it("returns network-error with 'timeout' when AbortController fires", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", makeAbortFetch());

    const promise = callBitcoinCoreRpc(CORE_URL, USER, PASS, "getblockchaininfo", []);
    await vi.advanceTimersByTimeAsync(BITCOIN_CORE_RPC_TIMEOUT_MS + 1);
    const result = await promise;

    expect(result.kind).toBe("network-error");
    if (result.kind === "network-error") {
      expect(result.message).toMatch(/timeout/);
    }
    vi.useRealTimers();
  });

  // ─── Test 9: user+pass set → correct Authorization header ──────────────────

  it("sends correct Basic auth header when both user and pass are set", async () => {
    const mockFetch = makeJsonFetch(200, {
      result: { chain: "main", blocks: 1 },
      error: null,
      id: "vaultpilot",
    });
    vi.stubGlobal("fetch", mockFetch);

    await callBitcoinCoreRpc(CORE_URL, USER, PASS, "getblockchaininfo", []);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(EXPECTED_AUTH_HEADER);
  });

  // ─── Test 10: user only → no Authorization header ──────────────────────────

  it("omits Authorization header when only user is set (pass is undefined)", async () => {
    const mockFetch = makeJsonFetch(200, { result: {}, error: null, id: "vaultpilot" });
    vi.stubGlobal("fetch", mockFetch);

    await callBitcoinCoreRpc(CORE_URL, USER, undefined, "getblockchaininfo", []);

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("omits Authorization header when only pass is set (user is undefined)", async () => {
    const mockFetch = makeJsonFetch(200, { result: {}, error: null, id: "vaultpilot" });
    vi.stubGlobal("fetch", mockFetch);

    await callBitcoinCoreRpc(CORE_URL, undefined, PASS, "getblockchaininfo", []);

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("omits Authorization header when both user and pass are undefined", async () => {
    const mockFetch = makeJsonFetch(200, { result: {}, error: null, id: "vaultpilot" });
    vi.stubGlobal("fetch", mockFetch);

    await callBitcoinCoreRpc(CORE_URL, undefined, undefined, "getblockchaininfo", []);

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  // ─── Test 11: Request body shape ───────────────────────────────────────────

  it("sends correct JSON-RPC 1.0 request body shape", async () => {
    const mockFetch = makeJsonFetch(200, { result: {}, error: null, id: "vaultpilot" });
    vi.stubGlobal("fetch", mockFetch);

    await callBitcoinCoreRpc(CORE_URL, USER, PASS, "getblockchaininfo", []);

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, RequestInit];
    const body = JSON.parse(init?.body as string) as unknown;
    expect(body).toEqual({
      jsonrpc: "1.0",
      id: "vaultpilot",
      method: "getblockchaininfo",
      params: [],
    });
  });

  // ─── Test 12: URL method=POST ───────────────────────────────────────────────

  it("sends request as HTTP POST", async () => {
    const mockFetch = makeJsonFetch(200, { result: {}, error: null, id: "vaultpilot" });
    vi.stubGlobal("fetch", mockFetch);

    await callBitcoinCoreRpc(CORE_URL, USER, PASS, "getblockchaininfo", []);

    const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CORE_URL);
    expect(init?.method).toBe("POST");
  });

  // ─── Test 13: Content-Type header ──────────────────────────────────────────

  it("sends Content-Type: application/json header", async () => {
    const mockFetch = makeJsonFetch(200, { result: {}, error: null, id: "vaultpilot" });
    vi.stubGlobal("fetch", mockFetch);

    await callBitcoinCoreRpc(CORE_URL, USER, PASS, "getblockchaininfo", []);

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
