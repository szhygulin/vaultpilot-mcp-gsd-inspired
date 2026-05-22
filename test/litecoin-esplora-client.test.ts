// test/litecoin-esplora-client.test.ts — Phase 26 Plan 26-01 (LTC-READ-01 / LTC-READ-02).
//
// Tests for `src/chains/litecoin/esplora-client.ts`:
//   - fetchFeeEstimates maps mempool.space body to 5-key shape
//   - fetchAddressUtxos returns { kind: "ok", utxos } on 200; never throws on 500
//   - fetchFeeEstimates calls URL ending in /v1/fees/recommended (NOT /fee-estimates)
//
// Test seam: `vi.stubGlobal("fetch", ...)` at OUTER network boundary per
// CLAUDE.md fetch-stub convention (NOT an internal indirection).
//
// Coverage per plan <behavior>:
//   1. fetchFeeEstimates maps { fastestFee, halfHourFee, hourFee, economyFee, minimumFee }
//      to { "1", "2", "3", "6", "144" }
//   2. fetchAddressUtxos returns { kind: "ok", utxos } on a 200 response
//   3. fetchAddressUtxos returns { kind: "error" } on a 500 (never throws)
//   4. fetchFeeEstimates calls the URL ending in /v1/fees/recommended (NOT /fee-estimates)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchAddressUtxos,
  fetchAddressTxs,
  fetchAddressInfo,
  fetchFeeEstimates,
  _resetEsploraCacheForTesting,
} from "../src/chains/litecoin/esplora-client.js";
import {
  _litecoinRegistry,
  _resetLitecoinRegistryForTesting,
} from "../src/chains/litecoin/registry.js";

// ───────────────────── Test helpers ──────────────────────────────────

type MockFetchHandler = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text?: () => Promise<string>;
}>;

function buildFetchMock(routes: Array<{
  match: string;
  status?: number;
  payload?: unknown;
  text?: string;
}>): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const route of routes) {
      if (url.includes(route.match) || url.endsWith(route.match)) {
        const status = route.status ?? 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => route.payload,
          text: async () => route.text ?? "",
        };
      }
    }
    // Default: 404
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => "",
    };
  }) as unknown as ReturnType<typeof vi.fn>;
}

// ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _resetEsploraCacheForTesting();
  _resetLitecoinRegistryForTesting();
  // Override the registry to point to a test base URL to avoid hitting live API
  vi.spyOn(_litecoinRegistry, "getEsploraBaseUrl").mockReturnValue("https://litecoinspace.org/api");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetEsploraCacheForTesting();
  _resetLitecoinRegistryForTesting();
});

// ───────────────────── fetchFeeEstimates ─────────────────────────────

describe("fetchFeeEstimates — LTC mempool.space fee mapping", () => {
  it("maps { fastestFee, halfHourFee, hourFee, economyFee, minimumFee } to { '1', '2', '3', '6', '144' }", async () => {
    vi.stubGlobal("fetch", buildFetchMock([{
      match: "/v1/fees/recommended",
      status: 200,
      payload: {
        fastestFee: 10,
        halfHourFee: 5,
        hourFee: 3,
        economyFee: 2,
        minimumFee: 1,
      },
    }]));

    const result = await fetchFeeEstimates();

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.estimates["1"]).toBe(10);  // fastestFee
    expect(result.estimates["2"]).toBe(5);   // halfHourFee
    expect(result.estimates["3"]).toBe(3);   // hourFee
    expect(result.estimates["6"]).toBe(2);   // economyFee
    expect(result.estimates["144"]).toBe(1); // minimumFee
  });

  it("maps live litecoinspace.org shape where all fees are 1 (low-traffic)", async () => {
    // Source: Live litecoinspace.org API test 2026-05-22
    vi.stubGlobal("fetch", buildFetchMock([{
      match: "/v1/fees/recommended",
      status: 200,
      payload: {
        fastestFee: 1,
        halfHourFee: 1,
        hourFee: 1,
        economyFee: 1,
        minimumFee: 1,
      },
    }]));

    const result = await fetchFeeEstimates();

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.estimates["1"]).toBe(1);
    expect(result.estimates["2"]).toBe(1);
    expect(result.estimates["3"]).toBe(1);
    expect(result.estimates["6"]).toBe(1);
    expect(result.estimates["144"]).toBe(1);
    // Exactly 5 keys
    expect(Object.keys(result.estimates)).toHaveLength(5);
  });

  it("calls URL ending in /v1/fees/recommended — NEVER /fee-estimates (Pitfall 1 REGRESSION ANCHOR)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        fastestFee: 5,
        halfHourFee: 3,
        hourFee: 2,
        economyFee: 2,
        minimumFee: 1,
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchFeeEstimates();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    // MUST end with /v1/fees/recommended
    expect(calledUrl).toMatch(/\/v1\/fees\/recommended$/);
    // MUST NOT call the BTC-only /fee-estimates endpoint
    expect(calledUrl).not.toMatch(/\/fee-estimates$/);
  });

  it("returns { kind: 'rate-limited' } on 429 (never throws)", async () => {
    vi.stubGlobal("fetch", buildFetchMock([{
      match: "/v1/fees/recommended",
      status: 429,
    }]));

    const result = await fetchFeeEstimates();

    expect(result.kind).toBe("rate-limited");
    expect(() => fetchFeeEstimates()).not.toThrow();
  });

  it("returns { kind: 'error' } on 500 (never throws)", async () => {
    vi.stubGlobal("fetch", buildFetchMock([{
      match: "/v1/fees/recommended",
      status: 500,
    }]));

    const result = await fetchFeeEstimates();

    expect(result.kind).toBe("error");
  });
});

// ───────────────────── fetchAddressUtxos ────────────────────────────

const LTC_ADDR = "ltc1q" + "a".repeat(38); // synthetic ltc1q shape (passes regex)

describe("fetchAddressUtxos", () => {
  it("returns { kind: 'ok', utxos } on a 200 response with UTXO array", async () => {
    vi.stubGlobal("fetch", buildFetchMock([{
      match: `/address/${LTC_ADDR}/utxo`,
      status: 200,
      payload: [
        {
          txid: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          vout: 0,
          value: 500000,
          status: { confirmed: true, block_height: 2500000 },
        },
      ],
    }]));

    const result = await fetchAddressUtxos(LTC_ADDR);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.utxos).toHaveLength(1);
    expect(result.utxos[0]?.valueSats).toBe(500000n);
    expect(result.utxos[0]?.confirmed).toBe(true);
    expect(result.utxos[0]?.blockHeight).toBe(2500000);
    expect(result.utxos[0]?.address).toBe(LTC_ADDR);
  });

  it("returns { kind: 'ok', utxos: [] } on a 200 response with empty array", async () => {
    vi.stubGlobal("fetch", buildFetchMock([{
      match: `/address/${LTC_ADDR}/utxo`,
      status: 200,
      payload: [],
    }]));

    const result = await fetchAddressUtxos(LTC_ADDR);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.utxos).toHaveLength(0);
  });

  it("returns { kind: 'error' } on 500 (NEVER throws)", async () => {
    vi.stubGlobal("fetch", buildFetchMock([{
      match: `/address/${LTC_ADDR}/utxo`,
      status: 500,
    }]));

    // NEVER-throws guarantee
    let result: Awaited<ReturnType<typeof fetchAddressUtxos>>;
    expect(async () => {
      result = await fetchAddressUtxos(LTC_ADDR);
    }).not.toThrow();

    result = await fetchAddressUtxos(LTC_ADDR);
    expect(result.kind).toBe("error");
  });

  it("returns { kind: 'not-found' } on 404", async () => {
    vi.stubGlobal("fetch", buildFetchMock([{
      match: `/address/${LTC_ADDR}/utxo`,
      status: 404,
    }]));

    const result = await fetchAddressUtxos(LTC_ADDR);

    expect(result.kind).toBe("not-found");
  });

  it("returns { kind: 'rate-limited' } on 429", async () => {
    vi.stubGlobal("fetch", buildFetchMock([{
      match: `/address/${LTC_ADDR}/utxo`,
      status: 429,
    }]));

    const result = await fetchAddressUtxos(LTC_ADDR);

    expect(result.kind).toBe("rate-limited");
  });
});

// ───────────────────── fetchAddressInfo ──────────────────────────────

describe("fetchAddressInfo", () => {
  it("returns { kind: 'ok' } with balance on a 200 response", async () => {
    vi.stubGlobal("fetch", buildFetchMock([{
      match: `/address/${LTC_ADDR}`,
      status: 200,
      payload: {
        chain_stats: {
          funded_txo_sum: 1000000,
          spent_txo_sum: 500000,
          tx_count: 5,
        },
        mempool_stats: {
          funded_txo_sum: 0,
          spent_txo_sum: 0,
          tx_count: 0,
        },
      },
    }]));

    const result = await fetchAddressInfo(LTC_ADDR);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.confirmedBalanceSats).toBe(500000n); // funded - spent
    expect(result.unconfirmedBalanceSats).toBe(0n);
    expect(result.txCount).toBe(5);
  });

  it("returns { kind: 'error' } on 500 (NEVER throws)", async () => {
    vi.stubGlobal("fetch", buildFetchMock([{
      match: `/address/${LTC_ADDR}`,
      status: 500,
    }]));

    const result = await fetchAddressInfo(LTC_ADDR);
    expect(result.kind).toBe("error");
  });
});

// ───────────────────── fetchAddressTxs ──────────────────────────────

describe("fetchAddressTxs", () => {
  it("returns { kind: 'ok', txs } on a 200 response with tx array", async () => {
    vi.stubGlobal("fetch", buildFetchMock([{
      match: `/address/${LTC_ADDR}/txs`,
      status: 200,
      payload: [
        {
          txid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          status: { confirmed: true, block_height: 2500001, block_time: 1700000000 },
          fee: 1000,
        },
      ],
    }]));

    const result = await fetchAddressTxs(LTC_ADDR);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.txs).toHaveLength(1);
    expect(result.txs[0]?.fee).toBe(1000n);
    expect(result.txs[0]?.blockHeight).toBe(2500001);
    expect(result.txs[0]?.confirmedAt).toBe(1700000000);
  });

  it("pagination: passes /chain/<cursor> segment when afterTxid is provided", async () => {
    const cursor = "c".repeat(64);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchAddressTxs(LTC_ADDR, { afterTxid: cursor });

    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain(`/chain/${cursor}`);
  });

  it("returns { kind: 'error' } on 500 (NEVER throws)", async () => {
    vi.stubGlobal("fetch", buildFetchMock([{
      match: `/address/${LTC_ADDR}/txs`,
      status: 500,
    }]));

    const result = await fetchAddressTxs(LTC_ADDR);
    expect(result.kind).toBe("error");
  });
});
