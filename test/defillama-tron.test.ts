// test/defillama-tron.test.ts — Phase 17 Plan 17-04.
//
// Mirror of the Solana DefiLlama sibling tests embedded in
// get-portfolio-summary.solana.test.ts (case-sensitive `solana:<mint>`
// keying) but for the TRON sibling path: `getTronPrices(addresses)` returns
// a `Map<addr, PriceQuote>` keyed by the input base58check contract
// address, fetching from DefiLlama's `coins.llama.fi/prices/current/`
// endpoint with `tron:<base58check>` keys.
//
// Coverage:
//   1. Happy path — known TRC-20 returns priceUsd.
//   2. URL key format — case-sensitive `tron:` prefix; DO NOT lowercase.
//   3. Multi-address batch — comma-joined URL keys; returned Map carries
//      all entries.
//   4. Empty input — short-circuit; no fetch.
//   5. Cache hit — second call within TTL window does not invoke fetch.
//   6. Missing-price fallback — DefiLlama omits a row → priceUnknown.
//   7. Network failure — surfaces priceUnknown (graceful-degradation).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetPriceCacheForTesting,
  getTronPrices,
} from "../src/pricing/defillama.js";

// Required TRC-20s — all OFAC-clean (research § Topic 6) + DefiLlama-covered.
const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const USDC_TRC20 = "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8";
const USDD = "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn";
const WTRX = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

function buildFetch(
  payload: unknown,
  opts?: { ok?: boolean; status?: number },
): { fetchMock: ReturnType<typeof vi.fn> } {
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

describe("getTronPrices — DefiLlama TRON sibling (Phase 17 Plan 17-04)", () => {
  it("Test 1 — happy path: returns priceUsd for a known TRC-20 (USDT)", async () => {
    const { fetchMock } = buildFetch({
      coins: {
        [`tron:${USDT_TRC20}`]: {
          price: 0.999,
          symbol: "USDT",
          decimals: 6,
          confidence: 0.99,
        },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTronPrices([USDT_TRC20]);

    expect(result.size).toBe(1);
    expect(result.get(USDT_TRC20)).toEqual({ priceUsd: 0.999 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Test 2 — URL key format: case-sensitive `tron:<base58check>` (NOT lowercased; NOT `Tron:`)", async () => {
    const { fetchMock } = buildFetch({
      coins: { [`tron:${USDT_TRC20}`]: { price: 1.0 } },
    });
    vi.stubGlobal("fetch", fetchMock);

    await getTronPrices([USDT_TRC20]);

    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("https://coins.llama.fi/prices/current/");
    // Case-preserved: T-prefix stays uppercase.
    expect(calledUrl).toContain(`tron:${USDT_TRC20}`);
    // Defense against accidental lowercasing.
    expect(calledUrl).not.toContain(`tron:${USDT_TRC20.toLowerCase()}`);
    expect(calledUrl).not.toContain(`Tron:`);
  });

  it("Test 3 — multi-address batch: comma-joined URL keys; returned Map has all entries", async () => {
    const { fetchMock } = buildFetch({
      coins: {
        [`tron:${USDT_TRC20}`]: { price: 1.0 },
        [`tron:${USDC_TRC20}`]: { price: 1.0 },
        [`tron:${USDD}`]: { price: 0.998 },
        [`tron:${WTRX}`]: { price: 0.357 },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTronPrices([USDT_TRC20, USDC_TRC20, USDD, WTRX]);

    expect(result.size).toBe(4);
    expect(result.get(USDT_TRC20)).toEqual({ priceUsd: 1.0 });
    expect(result.get(USDC_TRC20)).toEqual({ priceUsd: 1.0 });
    expect(result.get(USDD)).toEqual({ priceUsd: 0.998 });
    expect(result.get(WTRX)).toEqual({ priceUsd: 0.357 });

    const url = fetchMock.mock.calls[0]?.[0] as string;
    // All 4 keys comma-joined in the URL path.
    expect(url).toContain(`tron:${USDT_TRC20}`);
    expect(url).toContain(`tron:${USDC_TRC20}`);
    expect(url).toContain(`tron:${USDD}`);
    expect(url).toContain(`tron:${WTRX}`);
  });

  it("Test 4 — empty input: no fetch invoked; returns empty Map", async () => {
    const { fetchMock } = buildFetch({ coins: {} });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTronPrices([]);

    expect(result.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Test 5 — cache hit: second call within TTL window does not invoke fetch", async () => {
    const { fetchMock } = buildFetch({
      coins: { [`tron:${USDT_TRC20}`]: { price: 1.0 } },
    });
    vi.stubGlobal("fetch", fetchMock);

    await getTronPrices([USDT_TRC20]);
    await getTronPrices([USDT_TRC20]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Test 6 — missing-price fallback: DefiLlama omits a row → that address surfaces priceUnknown (NOT zero)", async () => {
    const { fetchMock } = buildFetch({
      coins: {
        [`tron:${USDT_TRC20}`]: { price: 1.0 },
        // USDC deliberately omitted from the response.
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTronPrices([USDT_TRC20, USDC_TRC20]);

    expect(result.get(USDT_TRC20)).toEqual({ priceUsd: 1.0 });
    // Missing → priceUnknown, NOT zero, NOT undefined.
    expect(result.get(USDC_TRC20)).toEqual({ priceUnknown: true });
  });

  it("Test 7 — network failure: HTTP error surfaces priceUnknown for every requested address (graceful degradation)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTronPrices([USDT_TRC20, USDC_TRC20]);

    expect(result.get(USDT_TRC20)).toEqual({ priceUnknown: true });
    expect(result.get(USDC_TRC20)).toEqual({ priceUnknown: true });
  });

  it("Test 8 — WTRX as native-TRX pricing proxy: WTRX `tron:TNUC...FR` returns priceUsd (NATIVE_PRICING_PROXY.tron lookup proxy)", async () => {
    const { fetchMock } = buildFetch({
      coins: {
        [`tron:${WTRX}`]: { price: 0.357, symbol: "WTRX", decimals: 6 },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getTronPrices([WTRX]);

    expect(result.get(WTRX)).toEqual({ priceUsd: 0.357 });
  });
});
