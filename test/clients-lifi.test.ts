// test/clients-lifi.test.ts — Phase 26 Plan 26-03 (BTC-LIFI-01).
//
// Unit tests for src/clients/lifi.ts — the NEVER-throws LiFi /v1/quote HTTP client.
//
// Test seam: vi.stubGlobal("fetch", …) at the OUTER network boundary per
// CLAUDE.md convention (same pattern as test/clients-fourbyte.test.ts +
// test/tools-get-btc-balance.test.ts).
//
// NO _lifiClient indirection — tests intercept at the fetch() boundary.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIFI_BTC_CHAIN_ID,
  fetchBtcLifiQuote,
  type LifiBtcQuote,
} from "../src/clients/lifi.js";

// ─── Test fixture ─────────────────────────────────────────────────────────────

const MOCK_QUOTE: LifiBtcQuote = {
  action: {
    toAddress: "0xDeAdBeEf00000000000000000000000000000001",
  },
  transactionRequest: {
    to: "bc1qvaultaddress0000000000000000000000test",
    data: "70736274ff0001020304" + "00".repeat(50), // fake PSBT hex starting with psbt magic
    value: "980000",
  },
};

// Minimal LiFi API response body — contains more fields than we care about.
// mapLifiResponse should extract ONLY the three fields above (T-26-13 mitigation).
const MOCK_LIFI_BODY = {
  id: "mock-quote-id",
  type: "CROSS_CHAIN",
  tool: "chainflip",
  toolDetails: { key: "chainflip", name: "Chainflip", logoURI: "https://..." },
  action: {
    fromChainId: "20000000000001",
    toChainId: 1,
    fromToken: { address: "bitcoin", symbol: "BTC" },
    toToken: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH" },
    fromAmount: "1000000",
    toAmount: "45000000000000000",
    slippage: 0.005,
    fromAddress: "bc1qtest000000000000000000000000000000test",
    toAddress: MOCK_QUOTE.action.toAddress,
    extraFields: "should be ignored by mapLifiResponse", // T-26-13: unexpected field
  },
  estimate: {
    tool: "chainflip",
    approvalAddress: "0x...",
    toAmountMin: "44000000000000000",
    executionDuration: 600,
    fromAmountUSD: "1000",
    toAmountUSD: "990",
    toAmountMinUSD: "980",
    feeCosts: [],
    gasCosts: [],
  },
  transactionRequest: {
    chainId: "20000000000001",
    to: MOCK_QUOTE.transactionRequest.to,
    from: "bc1qtest000000000000000000000000000000test",
    data: MOCK_QUOTE.transactionRequest.data,
    value: MOCK_QUOTE.transactionRequest.value,
    gasPrice: null,
    gasLimit: null,
    unexpectedField: "also ignored by mapLifiResponse", // T-26-13
  },
  includedSteps: [],
};

const DEFAULT_PARAMS = {
  btcAddress: "bc1qtest000000000000000000000000000000test",
  amountSatoshi: 1_000_000n,
  toChain: "ETH",
  toToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  toAddress: "0xDeAdBeEf00000000000000000000000000000001",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockFetch(
  status: number,
  body?: unknown,
  abortAfterMs?: number,
): typeof fetch {
  return vi.fn().mockImplementation(
    (_url: RequestInfo | URL, opts?: RequestInit) =>
      new Promise((resolve, reject) => {
        // Simulate abort signal.
        const signal = opts?.signal as AbortSignal | undefined;
        if (abortAfterMs !== undefined) {
          const timer = setTimeout(() => {
            const err = new DOMException("The operation was aborted.", "AbortError");
            reject(err);
          }, abortAfterMs);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            const err = new DOMException("The operation was aborted.", "AbortError");
            reject(err);
          });
        } else {
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
          } as Response);
        }
      }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("fetchBtcLifiQuote — NEVER-throws discriminated union", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Happy path — 200 OK
  // ──────────────────────────────────────────────────────────────────────────
  it("returns { kind: 'ok', quote } on a stubbed 200 response", async () => {
    vi.stubGlobal("fetch", makeMockFetch(200, MOCK_LIFI_BODY));

    const resultPromise = fetchBtcLifiQuote(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // Verify the extracted fields match the mock body.
    expect(result.quote.action.toAddress).toBe(MOCK_QUOTE.action.toAddress);
    expect(result.quote.transactionRequest.to).toBe(MOCK_QUOTE.transactionRequest.to);
    expect(result.quote.transactionRequest.data).toBe(MOCK_QUOTE.transactionRequest.data);
    expect(result.quote.transactionRequest.value).toBe(MOCK_QUOTE.transactionRequest.value);
  });

  it("quote carries action.toAddress + transactionRequest.data/to/value fields", async () => {
    vi.stubGlobal("fetch", makeMockFetch(200, MOCK_LIFI_BODY));

    const resultPromise = fetchBtcLifiQuote(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // action.toAddress must be a string.
    expect(typeof result.quote.action.toAddress).toBe("string");
    // transactionRequest has all three fields.
    expect(typeof result.quote.transactionRequest.to).toBe("string");
    expect(typeof result.quote.transactionRequest.data).toBe("string");
    expect(typeof result.quote.transactionRequest.value).toBe("string");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // URL construction
  // ──────────────────────────────────────────────────────────────────────────
  it("builds the URL with fromChain=BTC, fromToken=bitcoin (NOT 'BTC'), integrator=vaultpilot-mcp", async () => {
    const fetchSpy = makeMockFetch(200, MOCK_LIFI_BODY);
    vi.stubGlobal("fetch", fetchSpy);

    const resultPromise = fetchBtcLifiQuote(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = String((fetchSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    const parsed = new URL(calledUrl);

    expect(parsed.searchParams.get("fromChain")).toBe("BTC");
    expect(parsed.searchParams.get("fromToken")).toBe("bitcoin"); // token-address form, NOT "BTC"
    expect(parsed.searchParams.get("integrator")).toBe("vaultpilot-mcp");
    expect(parsed.searchParams.get("fromAddress")).toBe(DEFAULT_PARAMS.btcAddress);
    expect(parsed.searchParams.get("fromAmount")).toBe(DEFAULT_PARAMS.amountSatoshi.toString());
    expect(parsed.searchParams.get("toChain")).toBe(DEFAULT_PARAMS.toChain);
    expect(parsed.searchParams.get("toToken")).toBe(DEFAULT_PARAMS.toToken);
    expect(parsed.searchParams.get("toAddress")).toBe(DEFAULT_PARAMS.toAddress);
    expect(parsed.hostname).toBe("li.quest");
    expect(parsed.pathname).toBe("/v1/quote");
  });

  it("LIFI_BTC_CHAIN_ID constant is '20000000000001'", () => {
    expect(LIFI_BTC_CHAIN_ID).toBe("20000000000001");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 404 → not-found
  // ──────────────────────────────────────────────────────────────────────────
  it("returns { kind: 'not-found' } on a stubbed 404", async () => {
    vi.stubGlobal("fetch", makeMockFetch(404));

    const resultPromise = fetchBtcLifiQuote(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.kind).toBe("not-found");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 429 → rate-limited
  // ──────────────────────────────────────────────────────────────────────────
  it("returns { kind: 'rate-limited' } on a stubbed 429", async () => {
    vi.stubGlobal("fetch", makeMockFetch(429));

    const resultPromise = fetchBtcLifiQuote(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.kind).toBe("rate-limited");
    if (result.kind !== "rate-limited") return;
    expect(typeof result.message).toBe("string");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 500 → error
  // ──────────────────────────────────────────────────────────────────────────
  it("returns { kind: 'error' } on a stubbed 500", async () => {
    vi.stubGlobal("fetch", makeMockFetch(500));

    const resultPromise = fetchBtcLifiQuote(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain("500");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Invalid JSON → error
  // ──────────────────────────────────────────────────────────────────────────
  it("returns { kind: 'error' } on invalid JSON in the 200 response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    } as Partial<Response>);
    vi.stubGlobal("fetch", fetchSpy);

    const resultPromise = fetchBtcLifiQuote(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toMatch(/invalid JSON/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AbortError (timeout) → error, NEVER throws
  // ──────────────────────────────────────────────────────────────────────────
  it("returns { kind: 'error' } on AbortError (timeout) — never throws", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(
      Object.assign(new Error("The operation was aborted."), { name: "AbortError" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const resultPromise = fetchBtcLifiQuote(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    // Does not throw — the error is in the discriminated union arm.
    expect(typeof result.message).toBe("string");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Network error → error, NEVER throws
  // ──────────────────────────────────────────────────────────────────────────
  it("returns { kind: 'error' } on network error — never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const resultPromise = fetchBtcLifiQuote(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toContain("ECONNREFUSED");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Missing required fields → error (T-26-13 mapLifiResponse strict extraction)
  // ──────────────────────────────────────────────────────────────────────────
  it("returns { kind: 'error' } when action.toAddress is missing from the response", async () => {
    const bodyMissingToAddress = {
      ...MOCK_LIFI_BODY,
      action: { ...MOCK_LIFI_BODY.action, toAddress: undefined },
    };
    vi.stubGlobal("fetch", makeMockFetch(200, bodyMissingToAddress));

    const resultPromise = fetchBtcLifiQuote(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.kind).toBe("error");
  });

  it("returns { kind: 'error' } when transactionRequest.data is missing", async () => {
    const bodyMissingData = {
      ...MOCK_LIFI_BODY,
      transactionRequest: { ...MOCK_LIFI_BODY.transactionRequest, data: undefined },
    };
    vi.stubGlobal("fetch", makeMockFetch(200, bodyMissingData));

    const resultPromise = fetchBtcLifiQuote(DEFAULT_PARAMS);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.kind).toBe("error");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // BTC→SOL destination works the same as BTC→ETH
  // ──────────────────────────────────────────────────────────────────────────
  it("BTC→SOL destination produces the same result shape as BTC→ETH", async () => {
    const solBody = {
      ...MOCK_LIFI_BODY,
      action: {
        ...MOCK_LIFI_BODY.action,
        toAddress: "3FZbgi29cpjq2GjdwV8eyHuJJnkLtktZc5",
        toChainId: "SOL",
      },
      transactionRequest: {
        ...MOCK_LIFI_BODY.transactionRequest,
        to: "bc1qsolvaultaddress00000000000000000test",
      },
    };
    vi.stubGlobal("fetch", makeMockFetch(200, solBody));

    const resultPromise = fetchBtcLifiQuote({
      ...DEFAULT_PARAMS,
      toChain: "SOL",
      toToken: "So11111111111111111111111111111111111111112",
      toAddress: "3FZbgi29cpjq2GjdwV8eyHuJJnkLtktZc5",
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.quote.action.toAddress).toBe("3FZbgi29cpjq2GjdwV8eyHuJJnkLtktZc5");
  });
});
