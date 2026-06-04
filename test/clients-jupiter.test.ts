// Plan 14-01 Task 1 (Wave 0) — never-throws 3-arm Jupiter v6 HTTP client.
//
// Stubs the network boundary with vi.stubGlobal("fetch", …) per CLAUDE.md
// (external clients stub fetch at the OUTER edge — NOT an internal _jupiter
// indirection). NO live HTTP, NO live RPC. Asserts:
//   - getQuote / getSwapTransaction return the 3-arm union (ok | rate-limited | error)
//   - the client NEVER throws (every case wrapped in expect(...).resolves)
//   - BOTH endpoints ALWAYS send asLegacyTransaction=true (query param on GET
//     /quote; body field on POST /swap) — the FROZEN-compat invariant
//   - the keyless default host is lite-api.jup.ag/swap/v1
//   - JUPITER_API_KEY flips the host to api.jup.ag/swap/v1 AND attaches the key header

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetJupiter_ForTesting,
  getQuote,
  getSwapTransaction,
} from "../src/clients/jupiter.js";

// ---------------------------------------------------------------------------
// Fixtures — canned Jupiter v6 quote + swap envelopes.
// ---------------------------------------------------------------------------
const QUOTE_JSON = {
  inputMint: "So11111111111111111111111111111111111111112",
  inAmount: "100000000",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  outAmount: "17057460",
  otherAmountThreshold: "16886885",
  swapMode: "ExactIn",
  slippageBps: 50,
  priceImpactPct: "0.0001",
  routePlan: [
    {
      swapInfo: {
        ammKey: "amm1",
        label: "Orca",
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        inAmount: "100000000",
        outAmount: "17057460",
        feeAmount: "100",
        feeMint: "So11111111111111111111111111111111111111112",
      },
      percent: 100,
    },
  ],
  contextSlot: 0,
};

const SWAP_JSON = { swapTransaction: "QmFzZTY0U3dhcFR4Qnl0ZXM=" };

const QUOTE_PARAMS = {
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amount: "100000000",
  slippageBps: 50,
};

function okFetch(json: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => json,
  })) as unknown as typeof fetch;
}

function statusFetch(status: number): typeof fetch {
  return vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({}),
  })) as unknown as typeof fetch;
}

let savedKey: string | undefined;

describe("src/clients/jupiter.ts — never-throws 3-arm Jupiter v6 HTTP client", () => {
  beforeEach(() => {
    _resetJupiter_ForTesting();
    savedKey = process.env.JUPITER_API_KEY;
    delete process.env.JUPITER_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.JUPITER_API_KEY;
    else process.env.JUPITER_API_KEY = savedKey;
  });

  // ----- (a) 200 OK /quote -----
  it("getQuote: 200 OK → { kind: 'ok', quote } with the v6 envelope", async () => {
    vi.stubGlobal("fetch", okFetch(QUOTE_JSON));
    const result = await getQuote(QUOTE_PARAMS);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.quote.outAmount).toBe("17057460");
    expect(result.quote.priceImpactPct).toBe("0.0001");
    expect(result.quote.routePlan[0].swapInfo.label).toBe("Orca");
  });

  // ----- (b) 200 OK /swap -----
  it("getSwapTransaction: 200 OK → { kind: 'ok', swapTransaction }", async () => {
    vi.stubGlobal("fetch", okFetch(SWAP_JSON));
    const result = await getSwapTransaction(QUOTE_JSON, "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.swapTransaction).toBe("QmFzZTY0U3dhcFR4Qnl0ZXM=");
  });

  // ----- asLegacyTransaction invariant on /quote -----
  it("getQuote ALWAYS sends asLegacyTransaction=true (query param)", async () => {
    const spy = okFetch(QUOTE_JSON);
    vi.stubGlobal("fetch", spy);
    await getQuote(QUOTE_PARAMS);
    const url = String((spy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    expect(url).toContain("asLegacyTransaction=true");
    expect(url).toContain("/quote");
  });

  // ----- asLegacyTransaction invariant on /swap -----
  it("getSwapTransaction ALWAYS sends asLegacyTransaction:true (POST body) + wrapAndUnwrapSol:true", async () => {
    const spy = okFetch(SWAP_JSON);
    vi.stubGlobal("fetch", spy);
    await getSwapTransaction(QUOTE_JSON, "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
    const init = (spy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.asLegacyTransaction).toBe(true);
    expect(body.wrapAndUnwrapSol).toBe(true);
    expect(body.userPublicKey).toBe("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
  });

  // ----- (c) HTTP 429 → rate-limited (both endpoints) -----
  it("getQuote: HTTP 429 → { kind: 'rate-limited' } (never throws)", async () => {
    vi.stubGlobal("fetch", statusFetch(429));
    await expect(getQuote(QUOTE_PARAMS)).resolves.toEqual({ kind: "rate-limited" });
  });

  it("getSwapTransaction: HTTP 429 → { kind: 'rate-limited' } (never throws)", async () => {
    vi.stubGlobal("fetch", statusFetch(429));
    await expect(
      getSwapTransaction(QUOTE_JSON, "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"),
    ).resolves.toEqual({ kind: "rate-limited" });
  });

  // ----- (d) HTTP 5xx → error -----
  it("getQuote: HTTP 500 → { kind: 'error' } (never throws)", async () => {
    vi.stubGlobal("fetch", statusFetch(500));
    const result = await getQuote(QUOTE_PARAMS);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toMatch(/500/);
  });

  // ----- (d) network throw → error -----
  it("getQuote: network throw → { kind: 'error' } (never throws)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    );
    const result = await getQuote(QUOTE_PARAMS);
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toMatch(/ECONNREFUSED/);
  });

  // ----- (d) JSON-parse failure → error -----
  it("getQuote: JSON-parse failure → { kind: 'error' } (never throws)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected token < in JSON");
        },
      })) as unknown as typeof fetch,
    );
    const result = await getQuote(QUOTE_PARAMS);
    expect(result.kind).toBe("error");
  });

  it("getSwapTransaction: HTTP 503 → { kind: 'error' } (never throws)", async () => {
    vi.stubGlobal("fetch", statusFetch(503));
    const result = await getSwapTransaction(
      QUOTE_JSON,
      "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
    );
    expect(result.kind).toBe("error");
  });

  // ----- env seam: keyless default host -----
  it("default (no JUPITER_API_KEY) → keyless lite-api.jup.ag/swap/v1 host, NO key header", async () => {
    const spy = okFetch(QUOTE_JSON);
    vi.stubGlobal("fetch", spy);
    await getQuote(QUOTE_PARAMS);
    const calls = (spy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const url = String(calls[0]);
    const init = (calls[1] ?? {}) as RequestInit;
    expect(url).toContain("lite-api.jup.ag/swap/v1");
    // The keyed host is "https://api.jup.ag" — the keyless host "https://lite-api…"
    // does NOT contain that prefix (the `https://` boundary excludes the lite- form).
    expect(url).not.toContain("https://api.jup.ag");
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["x-api-key"]).toBeUndefined();
  });

  // ----- env seam: JUPITER_API_KEY flips host + attaches key -----
  it("JUPITER_API_KEY set → api.jup.ag/swap/v1 host + x-api-key header (read at call time)", async () => {
    process.env.JUPITER_API_KEY = "test-key-123";
    const spy = okFetch(QUOTE_JSON);
    vi.stubGlobal("fetch", spy);
    await getQuote(QUOTE_PARAMS);
    const calls = (spy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const url = String(calls[0]);
    const init = (calls[1] ?? {}) as RequestInit;
    expect(url).toContain("https://api.jup.ag/swap/v1");
    expect(url).not.toContain("lite-api.jup.ag");
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key-123");
  });

  it("JUPITER_API_KEY also flips the /swap POST host + attaches the key", async () => {
    process.env.JUPITER_API_KEY = "swap-key-456";
    const spy = okFetch(SWAP_JSON);
    vi.stubGlobal("fetch", spy);
    await getSwapTransaction(QUOTE_JSON, "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
    const calls = (spy as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const url = String(calls[0]);
    const init = (calls[1] ?? {}) as RequestInit;
    expect(url).toContain("https://api.jup.ag/swap/v1/swap");
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["x-api-key"]).toBe("swap-key-456");
  });
});
