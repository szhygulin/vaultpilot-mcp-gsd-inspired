// src/chains/bitcoin/esplora-client.ts — Esplora HTTP client (Phase 22
// Plan 22-01 Task 2). NEVER-throws 5-arm discriminated union; mirror of
// `src/clients/etherscan.ts` shape adapted to single-call Esplora
// endpoints. Test seam: `vi.stubGlobal("fetch", ...)` at the OUTER
// network boundary (CLAUDE.md convention — external HTTP clients do NOT
// take the `_<scope>` indirection; the seam is the outer fetch).
//
// Coverage map:
//   fetchAddressInfo:
//     1. Happy-path returns kind:"ok" with confirmed = funded - spent
//     2. confirmed = chain_stats.funded_txo_sum - chain_stats.spent_txo_sum
//        (NOT raw funded — RESEARCH § Pitfall 3)
//     3. bigint at boundary — values can exceed Number.MAX_SAFE_INTEGER
//     4. unconfirmed delta from mempool_stats
//     5. txCount sums chain_stats.tx_count + mempool_stats.tx_count
//     6. 404 → kind:"not-found" with address field
//     7. 429 → kind:"rate-limited"
//     8. 5xx → kind:"error" with verbatim HTTP status message
//     9. AbortController timeout → kind:"error"
//    10. JSON parse failure → kind:"error"
//    11. Missing chain_stats in body → kind:"error"
//    12. LRU cache hit (single fetch on two identical calls)
//    13. LRU cache eviction at 256th distinct address
//    14. Uses _bitcoinRegistry.getEsploraBaseUrl() for URL construction
//   fetchAddressUtxos:
//    15. Happy-path returns kind:"ok" with utxos:UtxoRow[]
//    16. UTXO valueSats is bigint; confirmed maps from status.confirmed
//    WR-05. UTXO cache expires after 30s TTL (re-fetches on stale)
//   fetchAddressTxs:
//    17. Happy-path returns kind:"ok" with stripped-down rows
//    18. afterTxid pagination cursor appended to URL when provided
//   fetchFeeEstimates:
//    19. Happy-path returns kind:"ok" with estimates Record<string, number>
//    20. 24-key live shape preserved verbatim
//    WR-05. Fee-estimates cache expires after 60s TTL (re-fetches on stale)
//   reset:
//    21. _resetEsploraCacheForTesting clears all caches
//   contract:
//    22. NEVER-throws — no try/catch in test code; no exception escapes

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetBitcoinRegistryForTesting,
} from "../src/chains/bitcoin/registry.js";
import {
  _resetEsploraCacheForTesting,
  broadcastTx,
  fetchAddressInfo,
  fetchAddressTxs,
  fetchAddressUtxos,
  fetchFeeEstimates,
} from "../src/chains/bitcoin/esplora-client.js";

const VALID_SEGWIT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

// Live-probed Esplora /address/{addr} response (RESEARCH § Validation
// Architecture #2, captured 2026-05-21 against blockstream.info).
const LIVE_ADDRESS_INFO = {
  address: VALID_SEGWIT,
  chain_stats: {
    funded_txo_count: 101,
    funded_txo_sum: 16781533,
    spent_txo_count: 1,
    spent_txo_sum: 14293,
    tx_count: 102,
  },
  mempool_stats: {
    funded_txo_count: 0,
    funded_txo_sum: 0,
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 0,
  },
};

// Live-probed Esplora /fee-estimates response (24-key projection).
const LIVE_FEE_ESTIMATES = {
  "1": 1.013,
  "2": 1.013,
  "3": 1.013,
  "4": 1.013,
  "5": 1.013,
  "6": 1.013,
  "7": 1.013,
  "8": 1.013,
  "9": 1.013,
  "10": 0.99,
  "11": 0.99,
  "12": 0.99,
  "13": 0.99,
  "14": 0.99,
  "15": 0.99,
  "16": 0.99,
  "17": 0.99,
  "18": 0.99,
  "19": 0.99,
  "20": 0.91,
  "21": 0.91,
  "22": 0.91,
  "144": 0.684,
  "504": 0.684,
  "1008": 0.684,
};

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

function buildFetch(opts: {
  ok?: boolean;
  status?: number;
  payload?: unknown;
  reject?: Error;
  hang?: boolean;
}): ReturnType<typeof vi.fn> {
  return vi.fn(async (_input: unknown, init?: { signal?: AbortSignal }) => {
    if (opts.hang) {
      return new Promise<MockResponse>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("The user aborted a request.");
          err.name = "AbortError";
          reject(err);
        });
      });
    }
    if (opts.reject) throw opts.reject;
    const status = opts.status ?? (opts.ok === false ? 500 : 200);
    return {
      ok: opts.ok ?? true,
      status,
      json: async () => opts.payload,
    } satisfies MockResponse;
  });
}

beforeEach(() => {
  _resetEsploraCacheForTesting();
  _resetBitcoinRegistryForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  _resetEsploraCacheForTesting();
  _resetBitcoinRegistryForTesting();
});

describe("fetchAddressInfo — happy path (BTC-READ-01)", () => {
  it("Test 1 — returns kind:'ok' with confirmed = funded - spent (Pitfall 3 anchor)", async () => {
    const fetchMock = buildFetch({ payload: LIVE_ADDRESS_INFO });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressInfo(VALID_SEGWIT);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      // funded_txo_sum (16781533) - spent_txo_sum (14293) = 16767240
      expect(result.confirmedBalanceSats).toBe(16781533n - 14293n);
      expect(result.confirmedBalanceSats).toBe(16767240n);
      expect(result.unconfirmedBalanceSats).toBe(0n);
      expect(result.txCount).toBe(102);
      expect(result.address).toBe(VALID_SEGWIT);
    }
  });

  it("Test 2 — bigint type at the boundary handles values that exceed Number.MAX_SAFE_INTEGER", async () => {
    // Synthetic whale wallet with > Number.MAX_SAFE_INTEGER funded.
    const whaleSum = (2n ** 60n).toString();
    const fetchMock = buildFetch({
      payload: {
        chain_stats: {
          funded_txo_sum: Number(whaleSum),
          spent_txo_sum: 0,
          tx_count: 1,
        },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressInfo(VALID_SEGWIT);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(typeof result.confirmedBalanceSats).toBe("bigint");
    }
  });

  it("Test 3 — unconfirmed delta uses mempool_stats", async () => {
    const fetchMock = buildFetch({
      payload: {
        chain_stats: { funded_txo_sum: 100, spent_txo_sum: 0, tx_count: 1 },
        mempool_stats: { funded_txo_sum: 50, spent_txo_sum: 20, tx_count: 2 },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressInfo(VALID_SEGWIT);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.confirmedBalanceSats).toBe(100n);
      expect(result.unconfirmedBalanceSats).toBe(30n); // 50 - 20
      expect(result.txCount).toBe(3); // 1 + 2
    }
  });

  it("Test 4 — uses _bitcoinRegistry.getEsploraBaseUrl() for URL construction", async () => {
    process.env.BTC_ESPLORA_URL = "https://custom.esplora.example/api";
    const fetchMock = buildFetch({ payload: LIVE_ADDRESS_INFO });
    vi.stubGlobal("fetch", fetchMock);

    await fetchAddressInfo(VALID_SEGWIT);

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe(
      `https://custom.esplora.example/api/address/${VALID_SEGWIT}`,
    );
    delete process.env.BTC_ESPLORA_URL;
  });
});

describe("fetchAddressInfo — error arms (NEVER-throws contract)", () => {
  it("Test 5 — 404 → kind:'not-found' with address field", async () => {
    const fetchMock = buildFetch({ ok: false, status: 404, payload: {} });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressInfo(VALID_SEGWIT);
    expect(result.kind).toBe("not-found");
    if (result.kind === "not-found") {
      expect(result.address).toBe(VALID_SEGWIT);
    }
  });

  it("Test 6 — 429 → kind:'rate-limited'", async () => {
    const fetchMock = buildFetch({ ok: false, status: 429, payload: {} });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressInfo(VALID_SEGWIT);
    expect(result.kind).toBe("rate-limited");
    if (result.kind === "rate-limited") {
      expect(result.message).toMatch(/429/);
    }
  });

  it("Test 7 — 5xx → kind:'error' with verbatim HTTP status message", async () => {
    const fetchMock = buildFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressInfo(VALID_SEGWIT);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("Esplora returned HTTP 503");
    }
  });

  it("Test 8 — AbortController timeout → kind:'error' (timer fires at ESPLORA_TIMEOUT_MS)", async () => {
    vi.useFakeTimers();
    const fetchMock = buildFetch({ hang: true });
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchAddressInfo(VALID_SEGWIT);
    await vi.advanceTimersByTimeAsync(5001);
    const result = await promise;

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/timeout/);
    }
  });

  it("Test 9 — JSON parse failure → kind:'error'", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token in JSON");
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressInfo(VALID_SEGWIT);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/invalid JSON|Unexpected token/);
    }
  });

  it("Test 10 — Missing chain_stats in body → kind:'error'", async () => {
    const fetchMock = buildFetch({ payload: { address: VALID_SEGWIT } });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressInfo(VALID_SEGWIT);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/chain_stats/);
    }
  });

  it("Test 11 — Network unreachable → kind:'error' with verbatim upstream message", async () => {
    const fetchMock = buildFetch({ reject: new Error("getaddrinfo ENOTFOUND") });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressInfo(VALID_SEGWIT);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/ENOTFOUND/);
    }
  });
});

describe("fetchAddressInfo — LRU cache", () => {
  it("Test 12 — cache hit: second call returns same result without second fetch", async () => {
    const fetchMock = buildFetch({ payload: LIVE_ADDRESS_INFO });
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchAddressInfo(VALID_SEGWIT);
    const second = await fetchAddressInfo(VALID_SEGWIT);

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Test 13 — cache evicts at 257th distinct address", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      const addrMatch = url.match(/\/address\/([^/?]+)/);
      const addr = addrMatch?.[1] ?? "unknown";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          chain_stats: { funded_txo_sum: addr.length, spent_txo_sum: 0, tx_count: 1 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
    await fetchAddressInfo(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchAddressInfo(first);
    expect(fetchMock).toHaveBeenCalledTimes(1); // cache hit

    // Fill the remaining 255 cache slots with distinct addresses.
    for (let i = 0; i < 255; i++) {
      const addr = `bc1qaaa${i.toString().padStart(35, "0")}`;
      await fetchAddressInfo(addr);
    }
    expect(fetchMock).toHaveBeenCalledTimes(256);

    // Insert 257th distinct address → eviction of `first`.
    await fetchAddressInfo("bc1qbbb000000000000000000000000000000000000");
    expect(fetchMock).toHaveBeenCalledTimes(257);

    // `first` is no longer cached: re-fetches.
    await fetchAddressInfo(first);
    expect(fetchMock).toHaveBeenCalledTimes(258);
  });
});

describe("fetchAddressUtxos — happy path (BTC-READ-01, load-bearing for Phase 23 coin-selection)", () => {
  it("Test 14 — returns kind:'ok' with utxos:UtxoRow[] (bigint valueSats, confirmed bool)", async () => {
    const fetchMock = buildFetch({
      payload: [
        {
          txid: "abc123def456",
          vout: 0,
          value: 100000,
          status: { confirmed: true, block_height: 800000 },
        },
        {
          txid: "ghi789jkl012",
          vout: 1,
          value: 50000,
          status: { confirmed: false },
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressUtxos(VALID_SEGWIT);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.utxos).toHaveLength(2);
      expect(result.utxos[0]?.txid).toBe("abc123def456");
      expect(result.utxos[0]?.vout).toBe(0);
      expect(result.utxos[0]?.valueSats).toBe(100000n);
      expect(typeof result.utxos[0]?.valueSats).toBe("bigint");
      expect(result.utxos[0]?.confirmed).toBe(true);
      expect(result.utxos[0]?.blockHeight).toBe(800000);
      expect(result.utxos[0]?.address).toBe(VALID_SEGWIT);
      expect(result.utxos[1]?.confirmed).toBe(false);
      expect(result.utxos[1]?.blockHeight).toBeUndefined();
    }
  });

  it("Test 14b — 404 → kind:'not-found' on utxos endpoint", async () => {
    const fetchMock = buildFetch({ ok: false, status: 404, payload: {} });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressUtxos(VALID_SEGWIT);
    expect(result.kind).toBe("not-found");
  });

  it("Test 14c — empty array → kind:'ok' with utxos: []", async () => {
    const fetchMock = buildFetch({ payload: [] });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressUtxos(VALID_SEGWIT);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.utxos).toHaveLength(0);
    }
  });

  it("WR-05 — UTXO cache expires after 30s (stale TTL causes re-fetch)", async () => {
    const fetchMock = buildFetch({ payload: [] });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    await fetchAddressUtxos(VALID_SEGWIT); // populates cache
    vi.advanceTimersByTime(31_000); // advance past 30s TTL
    await fetchAddressUtxos(VALID_SEGWIT); // should re-fetch after TTL

    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("fetchAddressTxs — happy path (BTC-READ-04, pagination cursor)", () => {
  it("Test 15 — happy-path returns kind:'ok' with stripped-down rows", async () => {
    const fetchMock = buildFetch({
      payload: [
        {
          txid: "tx1",
          status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
          fee: 100,
          vin: [],
          vout: [],
        },
        {
          txid: "tx2",
          status: { confirmed: false },
          fee: 50,
          vin: [],
          vout: [],
        },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchAddressTxs(VALID_SEGWIT);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.txs).toHaveLength(2);
      expect(result.txs[0]?.txid).toBe("tx1");
      expect(result.txs[0]?.blockHeight).toBe(800000);
      expect(result.txs[0]?.confirmedAt).toBe(1700000000);
      expect(result.txs[0]?.fee).toBe(100n);
      expect(result.txs[1]?.blockHeight).toBeUndefined();
    }
  });

  it("Test 16 — afterTxid pagination cursor appended to URL", async () => {
    const fetchMock = buildFetch({ payload: [] });
    vi.stubGlobal("fetch", fetchMock);

    await fetchAddressTxs(VALID_SEGWIT, { afterTxid: "cursor-txid-abc" });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/\/address\/.*\/txs\/chain\/cursor-txid-abc$/);
  });

  it("Test 17 — no afterTxid uses default /txs path (no cursor segment)", async () => {
    const fetchMock = buildFetch({ payload: [] });
    vi.stubGlobal("fetch", fetchMock);

    await fetchAddressTxs(VALID_SEGWIT);

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/\/address\/.*\/txs$/);
    expect(url).not.toMatch(/chain\//);
  });
});

describe("fetchFeeEstimates — happy path (BTC-READ-05)", () => {
  it("Test 18 — returns kind:'ok' with estimates Record<string, number> verbatim (24-key shape)", async () => {
    const fetchMock = buildFetch({ payload: LIVE_FEE_ESTIMATES });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFeeEstimates();
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.estimates["1"]).toBe(1.013);
      expect(result.estimates["6"]).toBe(1.013);
      expect(result.estimates["144"]).toBe(0.684);
      expect(Object.keys(result.estimates).length).toBeGreaterThan(20);
    }
  });

  it("Test 19 — 5xx → kind:'error'", async () => {
    const fetchMock = buildFetch({ ok: false, status: 502 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFeeEstimates();
    expect(result.kind).toBe("error");
  });

  it("Test 20 — fee-estimates endpoint URL is /fee-estimates", async () => {
    const fetchMock = buildFetch({ payload: LIVE_FEE_ESTIMATES });
    vi.stubGlobal("fetch", fetchMock);

    await fetchFeeEstimates();
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toMatch(/\/fee-estimates$/);
  });

  it("Test 21 — fetchFeeEstimates result is cached under a literal key (single fetch on two calls)", async () => {
    const fetchMock = buildFetch({ payload: LIVE_FEE_ESTIMATES });
    vi.stubGlobal("fetch", fetchMock);

    await fetchFeeEstimates();
    await fetchFeeEstimates();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("WR-05 — fee-estimates cache expires after 60s (stale TTL causes re-fetch)", async () => {
    const fetchMock = buildFetch({ payload: LIVE_FEE_ESTIMATES });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    await fetchFeeEstimates(); // populates cache
    vi.advanceTimersByTime(61_000); // advance past 60s TTL
    _resetBitcoinRegistryForTesting(); // ensure URL helper still returns valid base
    await fetchFeeEstimates(); // should re-fetch after TTL

    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("Esplora client — never-throws contract (T-22-01)", () => {
  it("Test 22 — every error path returns a discriminated-union result (no exception escapes)", async () => {
    // Loop through several adversarial inputs; assert NONE throws.
    const adversarial = [
      buildFetch({ ok: false, status: 500 }),
      buildFetch({ reject: new Error("ECONNREFUSED") }),
      buildFetch({ payload: "not an object" }),
      buildFetch({ payload: null }),
    ];
    for (const f of adversarial) {
      vi.stubGlobal("fetch", f);
      _resetEsploraCacheForTesting();
      // Top-level `await` without try/catch: if any throws, test fails.
      const result = await fetchAddressInfo(VALID_SEGWIT);
      expect(["ok", "not-found", "rate-limited", "error", "not-applicable"]).toContain(
        result.kind,
      );
    }
  });
});

// ===========================================================================
// Phase 23 Plan 23-04 — broadcastTx tests
// ===========================================================================
//
// Test seam: vi.stubGlobal("fetch", ...) at the outer network boundary
// (CLAUDE.md convention for external HTTP clients).
// Coverage:
//   1. 200 OK with txid body → { kind: "ok", txid }
//   2. 400 Bad Request (mempool rejection) → { kind: "rejected", message }
//   3. Network error → { kind: "error", message }
//   4. AbortController timeout → { kind: "error", message: /timeout/ }
//   5. Non-200/400 HTTP status → { kind: "error", message }
//   6. broadcastTx NEVER throws (no exception escapes).

const RAW_TX_HEX_STUB = "02000000" + "aa".repeat(100);
const TXID_STUB = "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b";

describe("broadcastTx — Phase 23 Plan 23-04", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    _resetEsploraCacheForTesting();
  });

  it("Test 23 — 200 OK response → { kind: 'ok', txid }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => TXID_STUB + "\n", // Esplora may include trailing newline
      })),
    );

    const result = await broadcastTx(RAW_TX_HEX_STUB);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.txid).toBe(TXID_STUB); // trim() applied
    }
  });

  it("Test 24 — 400 response (mempool rejection) → { kind: 'rejected', message }", async () => {
    const rejectMsg = "min relay fee not met, 200 < 223";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => rejectMsg,
      })),
    );

    const result = await broadcastTx(RAW_TX_HEX_STUB);

    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") {
      expect(result.message).toBe(rejectMsg);
    }
  });

  it("Test 25 — network error → { kind: 'error', message contains ECONNREFUSED }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    const result = await broadcastTx(RAW_TX_HEX_STUB);

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/ECONNREFUSED/);
    }
  });

  it("Test 26 — 5xx HTTP status → { kind: 'error', message includes HTTP status }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        text: async () => "Service Unavailable",
      })),
    );

    const result = await broadcastTx(RAW_TX_HEX_STUB);

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/503/);
    }
  });

  it("Test 27 — broadcastTx NEVER throws (no exception escapes)", async () => {
    const adversarial = [
      vi.fn(async () => { throw new Error("ECONNREFUSED"); }),
      vi.fn(async () => ({ ok: false, status: 500, text: async () => "err" })),
      vi.fn(async () => { throw new Error("AbortError"); }),
    ];

    for (const fetchMock of adversarial) {
      vi.stubGlobal("fetch", fetchMock);
      // No try/catch: if broadcastTx throws, the test fails.
      const result = await broadcastTx(RAW_TX_HEX_STUB);
      expect(["ok", "rejected", "error"]).toContain(result.kind);
    }
  });
});
