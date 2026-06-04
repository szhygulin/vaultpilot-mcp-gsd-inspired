// Phase 16 Plan 16-02 — fetchLifiQuote sibling tests (SOL-W-21 outbound client).
//
// NO-LIVE-HTTP: vi.stubGlobal("fetch", …) at the network boundary (CLAUDE.md
// "For external network clients … prefer vi.stubGlobal(\"fetch\", …)").
//
// fetchLifiQuote NEVER throws — asserts the discriminated union across:
//   200 ok        → kind:"ok" carrying transactionRequest + action.toAddress +
//                   fromChainId/toChainId
//   404           → kind:"not-found"
//   429           → kind:"rate-limited"
//   network error → kind:"error"
//   timeout/abort → kind:"error"
//   bad JSON      → kind:"error"
// Response-injection (T-26-13): inject extra body fields → assert discarded.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchLifiQuote } from "../src/clients/lifi.js";

const PARAMS = {
  fromChain: "SOL",
  fromToken: "11111111111111111111111111111111",
  fromAddress: "7gxcsRkHzkbqfQwjV2eDdmCkK8gPjVf9YpY5fG5L8aBc",
  fromAmount: "1000000000",
  toChain: "ARB",
  toToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  toAddress: "0x1111111111111111111111111111111111111111",
};

function okBody(extra: Record<string, unknown> = {}): unknown {
  return {
    action: {
      toAddress: PARAMS.toAddress,
      fromChainId: 1151111081099710,
      toChainId: 42161,
      // injected extra fields that MUST be discarded (T-26-13)
      slippage: 0.005,
      fromToken: { secretField: "leak-me" },
    },
    transactionRequest: {
      to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
      data: "0xdeadbeef",
      value: "0",
      gasLimit: "500000", // injected — must be discarded
    },
    estimate: { feeCosts: [] }, // injected top-level — must be discarded
    ...extra,
  };
}

function stubFetch(resp: {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: resp.ok,
      status: resp.status,
      json: resp.json ?? (async () => ({})),
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchLifiQuote — NEVER throws discriminated union", () => {
  it("200 ok → kind:ok with whitelisted fields only (T-26-13 discard)", async () => {
    stubFetch({ ok: true, status: 200, json: async () => okBody() });

    const result = await fetchLifiQuote(PARAMS);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");
    expect(result.quote.action.toAddress).toBe(PARAMS.toAddress);
    expect(result.quote.fromChainId).toBe(1151111081099710);
    expect(result.quote.toChainId).toBe(42161);
    expect(result.quote.transactionRequest.to).toBe(
      "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
    );
    expect(result.quote.transactionRequest.data).toBe("0xdeadbeef");
    expect(result.quote.transactionRequest.value).toBe("0");
    // Injected fields are NOT present on the extracted shape.
    expect((result.quote.transactionRequest as Record<string, unknown>).gasLimit).toBeUndefined();
    expect((result.quote as Record<string, unknown>).estimate).toBeUndefined();
    expect((result.quote.action as Record<string, unknown>).slippage).toBeUndefined();
  });

  it("404 → kind:not-found (no throw)", async () => {
    stubFetch({ ok: false, status: 404 });
    const result = await fetchLifiQuote(PARAMS);
    expect(result.kind).toBe("not-found");
  });

  it("429 → kind:rate-limited (no throw)", async () => {
    stubFetch({ ok: false, status: 429 });
    const result = await fetchLifiQuote(PARAMS);
    expect(result.kind).toBe("rate-limited");
  });

  it("500 → kind:error (no throw)", async () => {
    stubFetch({ ok: false, status: 500 });
    const result = await fetchLifiQuote(PARAMS);
    expect(result.kind).toBe("error");
  });

  it("network rejection → kind:error (no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await fetchLifiQuote(PARAMS);
    expect(result.kind).toBe("error");
  });

  it("AbortError → kind:error (no throw)", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortErr));
    const result = await fetchLifiQuote(PARAMS);
    expect(result.kind).toBe("error");
  });

  it("invalid JSON → kind:error (no throw)", async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad json");
      },
    });
    const result = await fetchLifiQuote(PARAMS);
    expect(result.kind).toBe("error");
  });

  it("missing required field → kind:error (no throw)", async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: async () => ({ action: {}, transactionRequest: {} }),
    });
    const result = await fetchLifiQuote(PARAMS);
    expect(result.kind).toBe("error");
  });
});
