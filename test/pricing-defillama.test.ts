import type { Address } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetPriceCacheForTesting, getPrices } from "../src/pricing/defillama.js";

const USDC: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const DAI: Address = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const WETH: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

function buildFetch(payload: unknown, opts?: { ok?: boolean; status?: number }): {
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const fetchMock = vi.fn(async (): Promise<MockResponse> => ({
    ok: opts?.ok ?? true,
    status: opts?.status,
    json: async () => payload,
  }));
  return { fetchMock };
}

beforeEach(() => {
  _resetPriceCacheForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetPriceCacheForTesting();
});

describe("getPrices — DefiLlama batch pricing client", () => {
  it("returns priceUsd for known addresses", async () => {
    const { fetchMock } = buildFetch({
      coins: {
        [`ethereum:${USDC.toLowerCase()}`]: { price: 1.0001, symbol: "USDC", decimals: 6 },
        [`ethereum:${DAI.toLowerCase()}`]: { price: 0.9998, symbol: "DAI", decimals: 18 },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPrices([USDC, DAI]);

    expect(result.size).toBe(2);
    expect(result.get(USDC)).toEqual({ priceUsd: 1.0001 });
    expect(result.get(DAI)).toEqual({ priceUsd: 0.9998 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("https://coins.llama.fi/prices/current/");
    expect(calledUrl).toContain(`ethereum:${USDC.toLowerCase()}`);
    expect(calledUrl).toContain(`ethereum:${DAI.toLowerCase()}`);
  });

  it("hits the cache on the second call within the TTL window", async () => {
    const { fetchMock } = buildFetch({
      coins: {
        [`ethereum:${USDC.toLowerCase()}`]: { price: 1.0 },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    await getPrices([USDC]);
    await getPrices([USDC]);

    // Second call must NOT hit the network — cached entry served it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("only fetches the cache-miss subset on a partial-overlap query", async () => {
    // Prime the cache with USDC.
    const { fetchMock: firstFetch } = buildFetch({
      coins: {
        [`ethereum:${USDC.toLowerCase()}`]: { price: 1.0 },
      },
    });
    vi.stubGlobal("fetch", firstFetch);
    await getPrices([USDC]);

    // Second call asks for [USDC, DAI]; only DAI must hit the wire.
    const secondFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        coins: {
          [`ethereum:${DAI.toLowerCase()}`]: { price: 1.0 },
        },
      }),
    }));
    vi.stubGlobal("fetch", secondFetch);

    const result = await getPrices([USDC, DAI]);
    expect(secondFetch).toHaveBeenCalledTimes(1);
    const url = secondFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain(`ethereum:${DAI.toLowerCase()}`);
    expect(url).not.toContain(`ethereum:${USDC.toLowerCase()}`);
    expect(result.get(USDC)).toEqual({ priceUsd: 1.0 });
    expect(result.get(DAI)).toEqual({ priceUsd: 1.0 });
  });

  it("flags missing prices as priceUnknown (not zero, not absent)", async () => {
    // DefiLlama returned only USDC; DAI was requested but absent from coins.
    const { fetchMock } = buildFetch({
      coins: {
        [`ethereum:${USDC.toLowerCase()}`]: { price: 1.0 },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPrices([USDC, DAI]);

    expect(result.get(USDC)).toEqual({ priceUsd: 1.0 });
    expect(result.get(DAI)).toEqual({ priceUnknown: true });
  });

  it("returns an empty Map when given an empty input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPrices([]);
    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks every requested address priceUnknown on HTTP failure", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPrices([USDC, WETH]);
    expect(result.get(USDC)).toEqual({ priceUnknown: true });
    expect(result.get(WETH)).toEqual({ priceUnknown: true });
  });

  it("treats non-numeric / negative price fields as priceUnknown", async () => {
    const { fetchMock } = buildFetch({
      coins: {
        [`ethereum:${USDC.toLowerCase()}`]: { price: "not-a-number" },
        [`ethereum:${DAI.toLowerCase()}`]: { price: -1 },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPrices([USDC, DAI]);
    expect(result.get(USDC)).toEqual({ priceUnknown: true });
    expect(result.get(DAI)).toEqual({ priceUnknown: true });
  });

  it("normalises mixed-case input addresses to checksum keys", async () => {
    const lower = USDC.toLowerCase() as Address;
    const { fetchMock } = buildFetch({
      coins: {
        [`ethereum:${USDC.toLowerCase()}`]: { price: 1.0 },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPrices([lower]);
    // Result keyed by checksum form regardless of input case.
    expect(result.get(USDC)).toEqual({ priceUsd: 1.0 });
  });
});
