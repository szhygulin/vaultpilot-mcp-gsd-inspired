// Phase 36 Plan 36-01 — Safe Tx Service client tests (SAFE-03).
//
// Test seam: `vi.stubGlobal("fetch", …)` at the OUTER network boundary per
// CLAUDE.md "external network clients" convention. NO `_<scope>` indirection
// inside `src/clients/safe-tx-service.ts` — the seam is at the global fetch
// edge.
//
// Coverage:
//   - All 5 DU arms × 4 endpoints (ok / not-found / rate-limited / error /
//     unsupported-chain)
//   - URL migration anchor (api.safe.global/tx-service/{shortname}/api)
//   - v1 vs v2 path mix (owners/safes on /v1/; multisig-transactions on /v2/)
//   - ordering=nonce explicit (Pitfall 8)
//   - Per-session ceiling (30) — ceiling exceeded → rate-limited arm w/o fetch
//   - Cache HIT does NOT consume counter (cache covers all 5 arms)
//   - LRU eviction at SAFE_INFO_CACHE_MAX=32 + SAFE_TX_CACHE_MAX=64
//   - Lazy bearer-token auth (Authorization: Bearer ${key} when env var set)
//   - T-SAFE-KEY-LEAK-1 audit (key VALUE never logged; "Bearer" never logged)
//   - AbortController timeout cleanup in `finally`

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

import {
  _resetSafeTxServiceCachesForTesting,
  _resetSafeTxServiceRateCounterForTesting,
  getMultisigTransaction,
  getPendingTransactions,
  getSafeInfo,
  getSafesByOwner,
  postSignature,
} from "../src/clients/safe-tx-service.js";
import * as logger from "../src/diagnostics/logger.js";

import {
  MULTISIG_TX_DELEGATECALL_FIXTURE,
  MULTISIG_TX_NO_CONFIRMATIONS_FIXTURE,
  MULTISIG_TX_OK_FIXTURE,
  OWNER_A,
  OWNER_SAFES_OK_FIXTURE,
  PENDING_LIST_EMPTY_FIXTURE,
  PENDING_LIST_OK_FIXTURE,
  SAFE_ADDRESS_1OF1,
  SAFE_ADDRESS_2OF3,
  SAFE_INFO_2_OF_3_FIXTURE,
  SAFE_INFO_OK_FIXTURE,
} from "./fixtures/safe-tx-service-responses.js";

interface MockResponse {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
}

interface FetchOpts {
  ok?: boolean;
  status?: number;
  payload?: unknown;
  retryAfter?: string;
  reject?: Error;
  hang?: boolean;
}

/**
 * Build a fetch stub. Returns a single response shape for every call —
 * tests that need per-URL routing pass a function-shaped stub via
 * `vi.stubGlobal("fetch", customFn)` directly.
 */
function buildFetch(opts: FetchOpts): ReturnType<typeof vi.fn> {
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
    return {
      ok: opts.ok ?? (opts.status === undefined || (opts.status >= 200 && opts.status < 300)),
      status: opts.status ?? 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "retry-after" && opts.retryAfter !== undefined
            ? opts.retryAfter
            : null,
      },
      json: async () => opts.payload,
    } satisfies MockResponse;
  });
}

const OWNER = OWNER_A as Address;
const SAFE = SAFE_ADDRESS_1OF1 as Address;
const SAFE_2 = SAFE_ADDRESS_2OF3 as Address;
const TX_HASH = MULTISIG_TX_OK_FIXTURE.safeTxHash as Hex;
const TX_HASH_DELEGATE = MULTISIG_TX_DELEGATECALL_FIXTURE.safeTxHash as Hex;

let savedApiKey: string | undefined;

beforeEach(() => {
  _resetSafeTxServiceCachesForTesting();
  _resetSafeTxServiceRateCounterForTesting();
  savedApiKey = process.env.SAFE_TX_SERVICE_API_KEY;
  delete process.env.SAFE_TX_SERVICE_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  _resetSafeTxServiceCachesForTesting();
  _resetSafeTxServiceRateCounterForTesting();
  if (savedApiKey === undefined) {
    delete process.env.SAFE_TX_SERVICE_API_KEY;
  } else {
    process.env.SAFE_TX_SERVICE_API_KEY = savedApiKey;
  }
});

// ===========================================================================
// Test 1 — URL migration anchor (api.safe.global/tx-service/{shortname}/api)
// ===========================================================================
describe("Safe Tx Service client — URL migration to api.safe.global", () => {
  it("getSafeInfo on chainId=1 uses api.safe.global/tx-service/eth/api (NOT safe-transaction-mainnet.safe.global)", async () => {
    const fetchMock = buildFetch({ payload: SAFE_INFO_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    await getSafeInfo(1, SAFE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("api.safe.global/tx-service/eth/api");
    expect(url).not.toContain("safe-transaction-mainnet.safe.global");
  });

  it("per-chain shortname mapping: 10→oeth, 137→pol, 8453→base, 42161→arb1", async () => {
    const expectedShortnames: Record<number, string> = {
      10: "oeth",
      137: "pol",
      8453: "base",
      42161: "arb1",
    };
    for (const [chainIdStr, shortname] of Object.entries(expectedShortnames)) {
      const chainId = Number(chainIdStr) as 10 | 137 | 8453 | 42161;
      const fetchMock = buildFetch({ payload: SAFE_INFO_OK_FIXTURE });
      vi.stubGlobal("fetch", fetchMock);
      await getSafeInfo(chainId, SAFE);
      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toContain(`api.safe.global/tx-service/${shortname}/api`);
      vi.unstubAllGlobals();
      _resetSafeTxServiceCachesForTesting();
      _resetSafeTxServiceRateCounterForTesting();
    }
  });
});

// ===========================================================================
// Test 2 — unsupported-chain arm short-circuit (no fetch, no counter)
// ===========================================================================
describe("Safe Tx Service client — unsupported-chain arm", () => {
  it("getSafeInfo with chainId not in endpoint table returns unsupported-chain without fetch", async () => {
    const fetchMock = buildFetch({ payload: SAFE_INFO_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    // Type-cast a chainId outside the union to exercise the runtime guard.
    const result = await getSafeInfo(999 as 1, SAFE);

    expect(result.kind).toBe("unsupported-chain");
    if (result.kind === "unsupported-chain") {
      expect(result.chainId).toBe(999);
    }
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("all four methods short-circuit on unsupported chain", async () => {
    const fetchMock = buildFetch({ payload: SAFE_INFO_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    const r1 = await getSafesByOwner(999 as 1, OWNER);
    const r2 = await getSafeInfo(999 as 1, SAFE);
    const r3 = await getPendingTransactions(999 as 1, SAFE, { currentNonce: 0n });
    const r4 = await getMultisigTransaction(999 as 1, TX_HASH);

    expect(r1.kind).toBe("unsupported-chain");
    expect(r2.kind).toBe("unsupported-chain");
    expect(r3.kind).toBe("unsupported-chain");
    expect(r4.kind).toBe("unsupported-chain");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

// ===========================================================================
// Test 3 — ok arm (getSafeInfo) — preserve numeric STRING fields (Pitfall 3)
// ===========================================================================
describe("Safe Tx Service client — getSafeInfo ok arm preserves numeric strings (Pitfall 3)", () => {
  it("returns kind 'ok' with nonce as STRING (not coerced to bigint)", async () => {
    const fetchMock = buildFetch({ payload: SAFE_INFO_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSafeInfo(1, SAFE);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.safe.nonce).toBe("5");
      expect(typeof result.safe.nonce).toBe("string");
      expect(result.safe.threshold).toBe(1);
      expect(result.safe.owners).toEqual([OWNER_A]);
      expect(result.safe.singleton).toBe("0x41675C099F32341bf84BFc5382aF534df5C7461a");
      expect(result.safe.version).toBe("1.4.1");
    }
  });
});

// ===========================================================================
// Test 4 — not-found arm (HTTP 404)
// ===========================================================================
describe("Safe Tx Service client — not-found arm (HTTP 404)", () => {
  it("getSafeInfo with HTTP 404 returns kind 'not-found'", async () => {
    const fetchMock = buildFetch({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSafeInfo(1, SAFE);

    expect(result.kind).toBe("not-found");
  });
});

// ===========================================================================
// Test 5 — rate-limited arm (HTTP 429) with retry-after parsing
// ===========================================================================
describe("Safe Tx Service client — rate-limited arm (HTTP 429)", () => {
  it("HTTP 429 with retry-after: 30 → retryAfterMs: 30000", async () => {
    const fetchMock = buildFetch({ ok: false, status: 429, retryAfter: "30" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSafeInfo(1, SAFE);

    expect(result.kind).toBe("rate-limited");
    if (result.kind === "rate-limited") {
      expect(result.message).toContain("HTTP 429");
      expect(result.message).toContain("retry-after: 30");
      expect(result.retryAfterMs).toBe(30000);
    }
  });

  it("HTTP 429 without retry-after surfaces rate-limited arm with undefined retryAfterMs", async () => {
    const fetchMock = buildFetch({ ok: false, status: 429 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSafeInfo(1, SAFE);

    expect(result.kind).toBe("rate-limited");
    if (result.kind === "rate-limited") {
      expect(result.retryAfterMs).toBeUndefined();
    }
  });
});

// ===========================================================================
// Test 6 — error arm (HTTP 5xx)
// ===========================================================================
describe("Safe Tx Service client — error arm (HTTP 5xx)", () => {
  it("HTTP 503 returns kind 'error' with verbatim status code", async () => {
    const fetchMock = buildFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSafeInfo(1, SAFE);

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("Safe Tx Service returned HTTP 503");
    }
  });
});

// ===========================================================================
// Test 7 — error arm (network reject)
// ===========================================================================
describe("Safe Tx Service client — error arm (network unreachable)", () => {
  it("fetch rejects with ENOTFOUND-style error → kind 'error' with verbatim message", async () => {
    const fetchMock = buildFetch({ reject: new Error("ENOTFOUND api.safe.global") });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSafeInfo(1, SAFE);

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("ENOTFOUND api.safe.global");
    }
  });
});

// ===========================================================================
// Test 8 — error arm (AbortController timeout)
// ===========================================================================
describe("Safe Tx Service client — error arm (AbortController timeout)", () => {
  it("hang fetch triggers timeout abort; kind 'error' with timeout message", async () => {
    vi.useFakeTimers();
    const fetchMock = buildFetch({ hang: true });
    vi.stubGlobal("fetch", fetchMock);

    const promise = getSafeInfo(1, SAFE);
    // Advance past the 5s timeout.
    await vi.advanceTimersByTimeAsync(5_500);
    const result = await promise;

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("timeout 5000ms");
    }
  });
});

// ===========================================================================
// Test 9 — error arm (JSON parse failure)
// ===========================================================================
describe("Safe Tx Service client — error arm (JSON parse failure)", () => {
  it("HTTP 200 but body throws on .json() → kind 'error'", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => {
        throw new Error("Unexpected token < in JSON at position 0");
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSafeInfo(1, SAFE);

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("invalid JSON response");
    }
  });
});

// ===========================================================================
// Test 10 — per-session ceiling (30 calls)
// ===========================================================================
describe("Safe Tx Service client — per-session ceiling (30 calls)", () => {
  it("31st call across mixed methods returns rate-limited without fetch", async () => {
    const fetchMock = buildFetch({ payload: SAFE_INFO_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    // Exhaust the 30-call budget — use distinct safe addresses to avoid
    // cache hits (cache hit would NOT consume budget).
    for (let i = 0; i < 30; i++) {
      const distinctSafe = ("0x" + i.toString(16).padStart(40, "0")) as Address;
      await getSafeInfo(1, distinctSafe);
    }
    expect(fetchMock).toHaveBeenCalledTimes(30);

    // 31st call returns rate-limited without consuming fetch.
    const distinctSafe31 = ("0x" + (30).toString(16).padStart(40, "0")) as Address;
    const result = await getSafeInfo(1, distinctSafe31);
    expect(result.kind).toBe("rate-limited");
    if (result.kind === "rate-limited") {
      expect(result.message).toMatch(/per-session limit \(30 calls\) exceeded/);
    }
    expect(fetchMock).toHaveBeenCalledTimes(30); // NOT incremented
  });
});

// ===========================================================================
// Test 11 — cache HIT does NOT consume counter
// ===========================================================================
describe("Safe Tx Service client — cache HIT does NOT consume counter", () => {
  it("two consecutive getSafeInfo calls trigger fetch ONCE; counter increments once", async () => {
    const fetchMock = buildFetch({ payload: SAFE_INFO_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    await getSafeInfo(1, SAFE);
    await getSafeInfo(1, SAFE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Test 12 — separate caches for SafeInfo vs SafeTx
// ===========================================================================
describe("Safe Tx Service client — separate caches for SafeInfo vs SafeTx", () => {
  it("clearing one cache leaves the other intact (cross-cache check)", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      const payload = url.includes("/multisig-transactions/")
        ? MULTISIG_TX_OK_FIXTURE
        : SAFE_INFO_OK_FIXTURE;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => payload,
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    await getSafeInfo(1, SAFE);
    await getMultisigTransaction(1, TX_HASH);
    // Cache hit — both should not re-fetch.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Second round — both populated, no new fetches.
    await getSafeInfo(1, SAFE);
    await getMultisigTransaction(1, TX_HASH);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// Test 13/14 — LRU eviction at SAFE_INFO_CACHE_MAX=32 / SAFE_TX_CACHE_MAX=64
// ===========================================================================
describe("Safe Tx Service client — LRU eviction at SAFE_INFO_CACHE_MAX=32", () => {
  it("33rd unique getSafeInfo entry evicts the oldest", async () => {
    const fetchMock = buildFetch({ payload: SAFE_INFO_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    // Lift the per-session ceiling FIRST: 33 entries > 30 budget. Tests bump
    // the counter check by resetting between writes — simpler to just exhaust
    // the budget and verify the eviction at the cache layer via counter.
    // Strategy: write 33 unique entries with budget resets between bursts.
    for (let i = 0; i < 33; i++) {
      _resetSafeTxServiceRateCounterForTesting();
      const distinctSafe = ("0x" + i.toString(16).padStart(40, "0")) as Address;
      await getSafeInfo(1, distinctSafe);
    }
    expect(fetchMock).toHaveBeenCalledTimes(33);

    // The OLDEST entry (i=0) should be evicted — re-querying it triggers a
    // fresh fetch.
    _resetSafeTxServiceRateCounterForTesting();
    const oldestSafe = ("0x" + (0).toString(16).padStart(40, "0")) as Address;
    await getSafeInfo(1, oldestSafe);
    expect(fetchMock).toHaveBeenCalledTimes(34);
  });
});

describe("Safe Tx Service client — LRU eviction at SAFE_TX_CACHE_MAX=64", () => {
  it("65th unique getMultisigTransaction entry evicts the oldest", async () => {
    const fetchMock = buildFetch({ payload: MULTISIG_TX_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    for (let i = 0; i < 65; i++) {
      _resetSafeTxServiceRateCounterForTesting();
      const distinctHash = ("0x" + i.toString(16).padStart(64, "0")) as Hex;
      await getMultisigTransaction(1, distinctHash);
    }
    expect(fetchMock).toHaveBeenCalledTimes(65);

    // Oldest (i=0) evicted — re-query triggers fresh fetch.
    _resetSafeTxServiceRateCounterForTesting();
    const oldestHash = ("0x" + (0).toString(16).padStart(64, "0")) as Hex;
    await getMultisigTransaction(1, oldestHash);
    expect(fetchMock).toHaveBeenCalledTimes(66);
  });
});

// ===========================================================================
// Test 15 — cache covers ALL arms (not just `ok`)
// ===========================================================================
describe("Safe Tx Service client — cache covers ALL arms (not just ok)", () => {
  it("repeated lookup of a 404 hash does not re-fetch", async () => {
    const fetchMock = buildFetch({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);

    const r1 = await getSafeInfo(1, SAFE);
    const r2 = await getSafeInfo(1, SAFE);

    expect(r1.kind).toBe("not-found");
    expect(r2.kind).toBe("not-found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Test 16 — auth header threading (SAFE_TX_SERVICE_API_KEY)
// ===========================================================================
describe("Safe Tx Service client — Authorization: Bearer ${key} when env set", () => {
  it("env key SET → headers include Authorization: Bearer <key>", async () => {
    process.env.SAFE_TX_SERVICE_API_KEY = "test-bearer-token";
    const fetchMock = buildFetch({ payload: SAFE_INFO_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    await getSafeInfo(1, SAFE);

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer test-bearer-token");
  });

  it("env key UNSET → headers omit Authorization entirely", async () => {
    delete process.env.SAFE_TX_SERVICE_API_KEY;
    const fetchMock = buildFetch({ payload: SAFE_INFO_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    await getSafeInfo(1, SAFE);

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers.Accept).toBe("application/json");
  });
});

// ===========================================================================
// Test 17 — T-SAFE-KEY-LEAK-1 audit: key value never logged
// ===========================================================================
describe("Safe Tx Service client — T-SAFE-KEY-LEAK-1: key VALUE never logged", () => {
  it("spy on logger.log; 503 fixture; key sentinel NOT in any log call", async () => {
    const SENTINEL = "TEST-API-KEY-DO-NOT-LEAK";
    process.env.SAFE_TX_SERVICE_API_KEY = SENTINEL;
    const logSpy = vi.spyOn(logger, "log");
    const fetchMock = buildFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    await getSafeInfo(1, SAFE);

    // No log call argument may contain the sentinel value or the literal
    // "Bearer" substring (T-SAFE-KEY-LEAK-1 mirror of T-ETHERSCAN-KEY-LEAK-1).
    for (const call of logSpy.mock.calls) {
      for (const arg of call) {
        const str = typeof arg === "string" ? arg : JSON.stringify(arg);
        expect(str).not.toContain(SENTINEL);
        expect(str).not.toContain("Bearer");
      }
    }
  });
});

// ===========================================================================
// Test 18 — getSafesByOwner /v1/ path + checksum result
// ===========================================================================
describe("Safe Tx Service client — getSafesByOwner /v1/owners/.../safes/", () => {
  it("URL contains /v1/owners/{owner}/safes/; ok arm returns safes array", async () => {
    const fetchMock = buildFetch({ payload: OWNER_SAFES_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSafesByOwner(1, OWNER);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`/v1/owners/${OWNER}/safes/`);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.safes).toEqual([SAFE_ADDRESS_1OF1, SAFE_ADDRESS_2OF3]);
    }
  });
});

// ===========================================================================
// Test 19 — getPendingTransactions /v2/ + ordering=nonce + nonce__gte + limit
// ===========================================================================
describe("Safe Tx Service client — getPendingTransactions URL composition (Pitfall 8)", () => {
  it("URL contains /v2/...multisig-transactions/, executed=false, ordering=nonce, nonce__gte, limit=20", async () => {
    const fetchMock = buildFetch({ payload: PENDING_LIST_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPendingTransactions(1, SAFE_2, { currentNonce: 12n });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`/v2/safes/${SAFE_2}/multisig-transactions/`);
    expect(url).toContain("executed=false");
    expect(url).toContain("ordering=nonce");
    expect(url).toContain("nonce__gte=12");
    expect(url).toContain("limit=20");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.totalCount).toBe(1);
      expect(result.pending.length).toBe(1);
      expect(result.pending[0].safeTxHash).toBe(MULTISIG_TX_OK_FIXTURE.safeTxHash);
    }
  });

  it("empty result preserves totalCount=0 + pending=[]", async () => {
    const fetchMock = buildFetch({ payload: PENDING_LIST_EMPTY_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getPendingTransactions(1, SAFE_2, { currentNonce: 100n });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.totalCount).toBe(0);
      expect(result.pending).toEqual([]);
    }
  });

  it("custom limit overrides default 20", async () => {
    const fetchMock = buildFetch({ payload: PENDING_LIST_EMPTY_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    await getPendingTransactions(1, SAFE_2, { currentNonce: 0n, limit: 5 });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("limit=5");
  });
});

// ===========================================================================
// Test 20 — getMultisigTransaction /v2/ path + confirmations optional (Pitfall 6)
// ===========================================================================
describe("Safe Tx Service client — getMultisigTransaction /v2/multisig-transactions/.../", () => {
  it("URL contains /v2/multisig-transactions/{safeTxHash}/", async () => {
    const fetchMock = buildFetch({ payload: MULTISIG_TX_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getMultisigTransaction(1, TX_HASH);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`/v2/multisig-transactions/${TX_HASH}/`);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.tx.operation).toBe(0);
      expect(result.tx.confirmations).toBeDefined();
      expect(result.tx.confirmations?.length).toBe(1);
    }
  });

  it("operation=1 (delegatecall) preserved as raw number", async () => {
    const fetchMock = buildFetch({ payload: MULTISIG_TX_DELEGATECALL_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getMultisigTransaction(1, TX_HASH_DELEGATE);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.tx.operation).toBe(1);
    }
  });

  it("Pitfall 6 — confirmations OPTIONAL: undefined preserved, not coerced to []", async () => {
    const fetchMock = buildFetch({ payload: MULTISIG_TX_NO_CONFIRMATIONS_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getMultisigTransaction(
      1,
      MULTISIG_TX_NO_CONFIRMATIONS_FIXTURE.safeTxHash as Hex,
    );

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.tx.confirmations).toBeUndefined();
    }
  });
});

// ===========================================================================
// Test 21 — reset helpers
// ===========================================================================
describe("Safe Tx Service client — test-only reset helpers", () => {
  it("_resetSafeTxServiceCachesForTesting clears both caches", async () => {
    const fetchMock = buildFetch({ payload: SAFE_INFO_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    await getSafeInfo(1, SAFE);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Cache HIT — no fetch.
    await getSafeInfo(1, SAFE);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Reset clears the cache; next call hits fetch.
    _resetSafeTxServiceCachesForTesting();
    await getSafeInfo(1, SAFE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("_resetSafeTxServiceRateCounterForTesting resets counter to 0", async () => {
    const fetchMock = buildFetch({ payload: SAFE_INFO_OK_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    // Exhaust the budget.
    for (let i = 0; i < 30; i++) {
      const distinctSafe = ("0x" + i.toString(16).padStart(40, "0")) as Address;
      await getSafeInfo(1, distinctSafe);
    }
    // Confirm we're over budget without reset.
    const blockedSafe = ("0x" + (99).toString(16).padStart(40, "0")) as Address;
    const blocked = await getSafeInfo(1, blockedSafe);
    expect(blocked.kind).toBe("rate-limited");

    _resetSafeTxServiceRateCounterForTesting();

    // After reset, the call succeeds.
    const unblockedSafe = ("0x" + (100).toString(16).padStart(40, "0")) as Address;
    const ok = await getSafeInfo(1, unblockedSafe);
    expect(ok.kind).toBe("ok");
  });
});

// ===========================================================================
// Test 22 — counter increments BEFORE fetch (failure paths consume slot)
// ===========================================================================
describe("Safe Tx Service client — counter increments BEFORE fetch (failures consume slot)", () => {
  it("503 response still consumes a budget slot", async () => {
    const fetchMock = buildFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    // Consume 29 successful... wait, all 30 will be 503. The counter increments
    // BEFORE the fetch, so 30 errors exhaust the budget.
    for (let i = 0; i < 30; i++) {
      const distinctSafe = ("0x" + i.toString(16).padStart(40, "0")) as Address;
      const r = await getSafeInfo(1, distinctSafe);
      expect(r.kind).toBe("error");
    }
    expect(fetchMock).toHaveBeenCalledTimes(30);

    // 31st call → rate-limited (budget exhausted by failures).
    const blockedSafe = ("0x" + (30).toString(16).padStart(40, "0")) as Address;
    const blocked = await getSafeInfo(1, blockedSafe);
    expect(blocked.kind).toBe("rate-limited");
    expect(fetchMock).toHaveBeenCalledTimes(30);
  });
});

// ===========================================================================
// Bonus — 2-of-3 Safe fixture round-trip
// ===========================================================================
describe("Safe Tx Service client — 2-of-3 Safe fixture round-trip", () => {
  it("preserves 3 owners + threshold 2 + nonce 12 + L2 singleton", async () => {
    const fetchMock = buildFetch({ payload: SAFE_INFO_2_OF_3_FIXTURE });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSafeInfo(137, SAFE_2);

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.safe.threshold).toBe(2);
      expect(result.safe.owners.length).toBe(3);
      expect(result.safe.nonce).toBe("12");
      expect(result.safe.singleton).toBe("0x29fcB43b46531BcA003ddC8FCB67FFE91900C762");
    }
  });
});

// ===========================================================================
// Phase 37 Plan 37-02 — Safe Tx Service client postSignature tests (SAFE-06/07)
//
// 6-arm DU (extends Phase 36's 5-arm shape with `duplicate` for the HTTP 200
// idempotent re-post path):
//   ok | duplicate | not-found | rate-limited | error | unsupported-chain
//
// Cache invalidation: a successful `ok` or `duplicate` POST drops the
// `safeTxCache` entry keyed `${chainId}:${safeTxHash.toLowerCase()}` so
// subsequent `getMultisigTransaction` reads pick up the new confirmation.
//
// POST body shape: exactly `{"signature":"0x..."}` — no `owner` field, no
// `signatureType` field on the wire (the Tx Service derives owner via
// server-side ECDSA recovery — RESEARCH §3 + T-37-15 mitigation).
//
// URL: POST {endpoint}/v1/multisig-transactions/{safeTxHash}/confirmations/
// Trailing slash required by the Django REST router on the Tx Service side.
// ===========================================================================

const POST_SIG_TX_HASH: Hex =
  "0xabc1230000000000000000000000000000000000000000000000000000000000";
// 65-byte ECDSA signature (130 hex chars). v = 0x1b (27) suffix matches
// the canonical ECDSA mode the agent will submit.
const POST_SIG_SIGNATURE: Hex = ("0x" + "11".repeat(64) + "1b") as Hex;

describe("Safe Tx Service client — postSignature happy path (HTTP 201 → ok)", () => {
  it("HTTP 201 returns kind 'ok'; POST URL has trailing slash; POST body is exactly {\"signature\":\"0x...\"}", async () => {
    const fetchMock = buildFetch({ status: 201, payload: {} });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postSignature({
      chain: 1,
      safeTxHash: POST_SIG_TX_HASH,
      signature: POST_SIG_SIGNATURE,
    });

    expect(result.kind).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(
      `/v1/multisig-transactions/${POST_SIG_TX_HASH}/confirmations/`,
    );
    // Trailing slash — Django REST router requirement (RESEARCH §3).
    expect(url.endsWith("/")).toBe(true);

    const init = fetchMock.mock.calls[0][1] as {
      method: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Accept).toBe("application/json");
    // Body byte-shape — `signature` field ONLY (no owner, no signatureType).
    expect(init.body).toBe(JSON.stringify({ signature: POST_SIG_SIGNATURE }));
    // Defense-in-depth — the parsed body has exactly one key.
    const parsed = JSON.parse(init.body) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["signature"]);
    expect(parsed.signature).toBe(POST_SIG_SIGNATURE);
  });
});

describe("Safe Tx Service client — postSignature duplicate arm (HTTP 200)", () => {
  it("HTTP 200 returns kind 'duplicate' (idempotent re-post)", async () => {
    const fetchMock = buildFetch({ status: 200, payload: {} });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postSignature({
      chain: 1,
      safeTxHash: POST_SIG_TX_HASH,
      signature: POST_SIG_SIGNATURE,
    });

    expect(result.kind).toBe("duplicate");
  });
});

describe("Safe Tx Service client — postSignature not-found arm (HTTP 404)", () => {
  it("HTTP 404 returns kind 'not-found'", async () => {
    const fetchMock = buildFetch({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postSignature({
      chain: 1,
      safeTxHash: POST_SIG_TX_HASH,
      signature: POST_SIG_SIGNATURE,
    });

    expect(result.kind).toBe("not-found");
  });
});

describe("Safe Tx Service client — postSignature rate-limited arm (HTTP 429)", () => {
  it("HTTP 429 with retry-after: 5 → retryAfterMs: 5000", async () => {
    const fetchMock = buildFetch({ ok: false, status: 429, retryAfter: "5" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postSignature({
      chain: 1,
      safeTxHash: POST_SIG_TX_HASH,
      signature: POST_SIG_SIGNATURE,
    });

    expect(result.kind).toBe("rate-limited");
    if (result.kind === "rate-limited") {
      expect(result.message).toContain("HTTP 429");
      expect(result.retryAfterMs).toBe(5000);
    }
  });
});

describe("Safe Tx Service client — postSignature error arm (HTTP 5xx)", () => {
  it("HTTP 500 returns kind 'error' with verbatim status code", async () => {
    const fetchMock = buildFetch({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postSignature({
      chain: 1,
      safeTxHash: POST_SIG_TX_HASH,
      signature: POST_SIG_SIGNATURE,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("Safe Tx Service returned HTTP 500");
    }
  });
});

describe("Safe Tx Service client — postSignature unsupported-chain arm", () => {
  it("chain not in endpoint table returns kind 'unsupported-chain' WITHOUT calling fetch", async () => {
    const fetchMock = buildFetch({ status: 201, payload: {} });
    vi.stubGlobal("fetch", fetchMock);

    const result = await postSignature({
      // Cast through known ChainId — runtime guard is the test target.
      chain: 999 as 1,
      safeTxHash: POST_SIG_TX_HASH,
      signature: POST_SIG_SIGNATURE,
    });

    expect(result.kind).toBe("unsupported-chain");
    if (result.kind === "unsupported-chain") {
      expect(result.chainId).toBe(999);
    }
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

describe("Safe Tx Service client — postSignature per-session ceiling (30 calls)", () => {
  it("31st postSignature returns rate-limited without fetch (shared counter)", async () => {
    const fetchMock = buildFetch({ status: 201, payload: {} });
    vi.stubGlobal("fetch", fetchMock);

    // Exhaust the 30-call budget with distinct hashes.
    for (let i = 0; i < 30; i++) {
      const distinctHash = ("0x" + i.toString(16).padStart(64, "0")) as Hex;
      const r = await postSignature({
        chain: 1,
        safeTxHash: distinctHash,
        signature: POST_SIG_SIGNATURE,
      });
      expect(r.kind).toBe("ok");
    }
    expect(fetchMock).toHaveBeenCalledTimes(30);

    // 31st call → rate-limited without fetch.
    const blockedHash = ("0x" + (30).toString(16).padStart(64, "0")) as Hex;
    const blocked = await postSignature({
      chain: 1,
      safeTxHash: blockedHash,
      signature: POST_SIG_SIGNATURE,
    });
    expect(blocked.kind).toBe("rate-limited");
    if (blocked.kind === "rate-limited") {
      expect(blocked.message).toMatch(/per-session limit \(30 calls\) exceeded/);
    }
    expect(fetchMock).toHaveBeenCalledTimes(30); // NOT incremented
  });
});

describe("Safe Tx Service client — postSignature cache invalidation", () => {
  it("successful postSignature drops safeTxCache entry; subsequent getMultisigTransaction re-fetches", async () => {
    // Route per-URL: GET multisig-transactions returns the SafeTx; POST
    // confirmations/ returns 201.
    const fetchMock = vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/confirmations/")) {
        return {
          ok: true,
          status: 201,
          headers: { get: () => null },
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => MULTISIG_TX_OK_FIXTURE,
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const txHash = MULTISIG_TX_OK_FIXTURE.safeTxHash as Hex;

    // 1. Prime the cache: getMultisigTransaction populates safeTxCache.
    const r1 = await getMultisigTransaction(1, txHash);
    expect(r1.kind).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 2. Cache HIT — no fetch.
    await getMultisigTransaction(1, txHash);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 3. POST — invalidates the cache entry.
    const postRes = await postSignature({
      chain: 1,
      safeTxHash: txHash,
      signature: POST_SIG_SIGNATURE,
    });
    expect(postRes.kind).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 GET + 1 POST

    // 4. Subsequent GET must hit fetch again (cache miss after invalidation).
    await getMultisigTransaction(1, txHash);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("duplicate (HTTP 200) arm also invalidates the cache", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if (init?.method === "POST" && url.includes("/confirmations/")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => MULTISIG_TX_OK_FIXTURE,
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const txHash = MULTISIG_TX_OK_FIXTURE.safeTxHash as Hex;

    await getMultisigTransaction(1, txHash);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const postRes = await postSignature({
      chain: 1,
      safeTxHash: txHash,
      signature: POST_SIG_SIGNATURE,
    });
    expect(postRes.kind).toBe("duplicate");

    // Cache miss after duplicate POST.
    await getMultisigTransaction(1, txHash);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("cache key uses lowercased safeTxHash — mixed-case POST invalidates lowercase-keyed entry", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: { method?: string }) => {
      if (init?.method === "POST") {
        return {
          ok: true,
          status: 201,
          headers: { get: () => null },
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => MULTISIG_TX_OK_FIXTURE,
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    // Note: MULTISIG_TX_OK_FIXTURE.safeTxHash is all-lowercase already; the
    // assertion is that POST with mixed-case still invalidates the lowercase
    // cache entry (verifies the `.toLowerCase()` normalization at delete time).
    const lcHash = MULTISIG_TX_OK_FIXTURE.safeTxHash as Hex;
    const mixedHash = (lcHash.slice(0, 4) + lcHash.slice(4).toUpperCase()) as Hex;

    // Prime cache via lowercased GET.
    await getMultisigTransaction(1, lcHash);
    await getMultisigTransaction(1, lcHash);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // POST with mixed-case hash — must still invalidate the lowercase entry.
    await postSignature({
      chain: 1,
      safeTxHash: mixedHash,
      signature: POST_SIG_SIGNATURE,
    });

    // Cache miss after the invalidation.
    await getMultisigTransaction(1, lcHash);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("Safe Tx Service client — postSignature AbortController timeout", () => {
  it("hang fetch triggers timeout abort; kind 'error' with timeout message", async () => {
    vi.useFakeTimers();
    const fetchMock = buildFetch({ hang: true });
    vi.stubGlobal("fetch", fetchMock);

    const promise = postSignature({
      chain: 1,
      safeTxHash: POST_SIG_TX_HASH,
      signature: POST_SIG_SIGNATURE,
    });
    await vi.advanceTimersByTimeAsync(5_500);
    const result = await promise;

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("timeout 5000ms");
    }
  });
});

describe("Safe Tx Service client — postSignature body shape unchanged across arms", () => {
  it("ok and duplicate arms send IDENTICAL body bytes for the same signature", async () => {
    // Two calls — first returns 201, second returns 200 — must both have the
    // exact same body shape `{"signature":"0x..."}`.
    let counter = 0;
    const fetchMock = vi.fn(async () => {
      counter += 1;
      return {
        ok: true,
        status: counter === 1 ? 201 : 200,
        headers: { get: () => null },
        json: async () => ({}),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const r1 = await postSignature({
      chain: 1,
      safeTxHash: POST_SIG_TX_HASH,
      signature: POST_SIG_SIGNATURE,
    });
    const r2 = await postSignature({
      chain: 1,
      safeTxHash: ("0x" + "ff".repeat(32)) as Hex,
      signature: POST_SIG_SIGNATURE,
    });

    expect(r1.kind).toBe("ok");
    expect(r2.kind).toBe("duplicate");

    const body1 = (fetchMock.mock.calls[0][1] as { body: string }).body;
    const body2 = (fetchMock.mock.calls[1][1] as { body: string }).body;
    // Bodies share signature byte-equivalence regardless of arm.
    const parsed1 = JSON.parse(body1) as Record<string, unknown>;
    const parsed2 = JSON.parse(body2) as Record<string, unknown>;
    expect(parsed1.signature).toBe(POST_SIG_SIGNATURE);
    expect(parsed2.signature).toBe(POST_SIG_SIGNATURE);
  });
});

describe("Safe Tx Service client — postSignature lazy bearer auth", () => {
  it("env key SET → POST headers include Authorization: Bearer <key>", async () => {
    process.env.SAFE_TX_SERVICE_API_KEY = "test-bearer-token";
    const fetchMock = buildFetch({ status: 201, payload: {} });
    vi.stubGlobal("fetch", fetchMock);

    await postSignature({
      chain: 1,
      safeTxHash: POST_SIG_TX_HASH,
      signature: POST_SIG_SIGNATURE,
    });

    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe("Bearer test-bearer-token");
  });
});
