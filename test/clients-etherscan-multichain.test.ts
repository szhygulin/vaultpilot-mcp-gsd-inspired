// Phase 35 Plan 35-01 Task 1 — multi-chain Etherscan V2 + `fetchEtherscanAbi`
// (CUSTOM-02 supporting client).
//
// Asserts:
//   - The 4-arm DU `EtherscanAbiResult` (ok / not-verified / rate-limited /
//     error) — `not-verified` NEVER collapses with generic `error` arms
//     (Pitfall 6).
//   - Per-chain cache (T-35-01-C): same address on chainId=1 vs chainId=137
//     fires TWO network calls.
//   - Per-chain URL: the fetched URL carries `chainid=${N}` for each
//     supported chain.
//   - Per-chain sourceCodeUrl: the per-chain explorer table resolves to
//     etherscan.io / arbiscan.io / polygonscan.com / basescan.org /
//     optimistic.etherscan.io.
//   - Shared rate counter across chains (Etherscan V2 enforces per API key,
//     not per chain — T-35-01-B): mixed chain calls drain the single
//     `agentSessionCallCount` counter shared with `checkContractSecurity`.
//   - Cache hit avoids fetch + rate-counter increment.
//   - Parse-once memoization: ABI returned is the parsed `viem.Abi` array,
//     not a JSON string.
//   - HTTP 5xx + AbortError → error arm with verbatim message.
//   - Pre-existing chainid widening: `checkContractSecurity` still works
//     correctly with the new `chainId` first positional arg (single round
//     trip from Test 9).
//
// Fetch is stubbed via `vi.stubGlobal("fetch", ...)` at the network
// boundary per CLAUDE.md (external network clients use stubGlobal NOT
// internal indirection).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";

import {
  _resetEtherscanAbiCacheForTesting,
  _resetEtherscanCacheForTesting,
  _resetEtherscanRateCounterForTesting,
  checkContractSecurity,
  fetchEtherscanAbi,
  getCachedEtherscanAbi,
  type EtherscanAbiResult,
} from "../src/clients/etherscan.js";
import type { ChainId } from "../src/config/contracts.js";

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

const VERIFIED_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address; // USDC
const SECOND_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F" as Address;  // DAI

// Canonical 1-entry ABI used across happy-path tests.
const ABI_JSON = JSON.stringify([
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
]);

interface AbiFetchOpts {
  ok?: boolean;
  status?: number;
  abiPayload?: unknown;
  reject?: Error;
  hang?: boolean;
}

function buildAbiFetch(opts: AbiFetchOpts): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: unknown, init?: { signal?: AbortSignal }) => {
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
    void input;
    return {
      ok: opts.ok ?? true,
      status: opts.status,
      json: async () => opts.abiPayload,
    } satisfies MockResponse;
  });
}

beforeEach(() => {
  _resetEtherscanAbiCacheForTesting();
  _resetEtherscanCacheForTesting();
  _resetEtherscanRateCounterForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  _resetEtherscanAbiCacheForTesting();
  _resetEtherscanCacheForTesting();
  _resetEtherscanRateCounterForTesting();
});

// ---------------------------------------------------------------------------
// Test 1 — multi-chain cache miss: chain 1 and chain 137 both fire fetches.
// ---------------------------------------------------------------------------
describe("fetchEtherscanAbi — per-chain cache (T-35-01-C)", () => {
  it("Test 1 — same address on chainId=1 and chainId=137 issues TWO fetches", async () => {
    const fetchMock = buildAbiFetch({
      abiPayload: { status: "1", message: "OK", result: ABI_JSON },
    });
    vi.stubGlobal("fetch", fetchMock);

    const r1 = await fetchEtherscanAbi(1, VERIFIED_ADDRESS, "test-key");
    const r137 = await fetchEtherscanAbi(137, VERIFIED_ADDRESS, "test-key");

    expect(r1.kind).toBe("ok");
    expect(r137.kind).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — per-chain URL: chainid param threads through to the request URL.
// ---------------------------------------------------------------------------
describe("fetchEtherscanAbi — per-chain URL (chainid widening)", () => {
  it("Test 2 — chainid=42161 fires when chainId arg is 42161", async () => {
    const fetchMock = buildAbiFetch({
      abiPayload: { status: "1", message: "OK", result: ABI_JSON },
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEtherscanAbi(42161, VERIFIED_ADDRESS, "test-key");

    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("chainid=42161");
    expect(calledUrl).not.toContain("chainid=1&");
  });

  it("Test 2b — chainid=137 fires when chainId arg is 137", async () => {
    const fetchMock = buildAbiFetch({
      abiPayload: { status: "1", message: "OK", result: ABI_JSON },
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEtherscanAbi(137, VERIFIED_ADDRESS, "test-key");

    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain("chainid=137");
  });
});

// ---------------------------------------------------------------------------
// Test 3 — ok arm: per-chain sourceCodeUrl table resolves to the right
// block explorer for each ChainId.
// ---------------------------------------------------------------------------
describe("fetchEtherscanAbi — ok arm + per-chain sourceCodeUrl", () => {
  const EXPECTED_DOMAINS: Array<[ChainId, string]> = [
    [1, "etherscan.io"],
    [42161, "arbiscan.io"],
    [137, "polygonscan.com"],
    [8453, "basescan.org"],
    [10, "optimistic.etherscan.io"],
  ];

  for (const [chainId, domain] of EXPECTED_DOMAINS) {
    it(`Test 3 — chainId=${chainId} → sourceCodeUrl uses ${domain}`, async () => {
      const fetchMock = buildAbiFetch({
        abiPayload: { status: "1", message: "OK", result: ABI_JSON },
      });
      vi.stubGlobal("fetch", fetchMock);

      const result = await fetchEtherscanAbi(chainId, VERIFIED_ADDRESS, "test-key");

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.sourceCodeUrl).toBe(`https://${domain}/address/${VERIFIED_ADDRESS}#code`);
        expect(result.rawAbiJson).toBe(ABI_JSON);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Test 4 — not-verified arm (Pitfall 6 disambiguation).
// ---------------------------------------------------------------------------
describe("fetchEtherscanAbi — not-verified vs error disambiguation (Pitfall 6)", () => {
  it("Test 4 — result === 'Contract source code not verified' → kind: 'not-verified'", async () => {
    const fetchMock = buildAbiFetch({
      abiPayload: {
        status: "0",
        message: "NOTOK",
        result: "Contract source code not verified",
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEtherscanAbi(1, VERIFIED_ADDRESS, "test-key");

    expect(result.kind).toBe("not-verified");
  });
});

// ---------------------------------------------------------------------------
// Test 5 — error arm: other status="0" payloads surface as `error` verbatim.
// ---------------------------------------------------------------------------
describe("fetchEtherscanAbi — generic getabi failure → error arm (NOT not-verified)", () => {
  it("Test 5 — status='0' + arbitrary result text → kind: 'error' with verbatim message", async () => {
    const fetchMock = buildAbiFetch({
      abiPayload: {
        status: "0",
        message: "NOTOK",
        result: "Invalid Address format",
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEtherscanAbi(1, VERIFIED_ADDRESS, "test-key");

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("Etherscan getabi failed");
      expect(result.message).toContain("Invalid Address format");
    }
  });
});

// ---------------------------------------------------------------------------
// Test 6 — rate-limited arm fires WITHOUT calling fetch.
// ---------------------------------------------------------------------------
describe("fetchEtherscanAbi — per-session rate-limit (T-35-01-B / T-ETHERSCAN-RATE-1)", () => {
  it("Test 6 — 6th uncached call returns rate-limited WITHOUT a fetch", async () => {
    const fetchMock = buildAbiFetch({
      abiPayload: { status: "1", message: "OK", result: ABI_JSON },
    });
    vi.stubGlobal("fetch", fetchMock);

    for (let i = 0; i < 5; i++) {
      const addr = `0x${i.toString(16).padStart(40, "0")}` as Address;
      await fetchEtherscanAbi(1, addr, "test-key");
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const sixthAddr = "0x0000000000000000000000000000000000000099" as Address;
    const result = await fetchEtherscanAbi(1, sixthAddr, "test-key");

    expect(result.kind).toBe("rate-limited");
    if (result.kind === "rate-limited") {
      expect(result.message).toContain("per-session limit (5 calls) exceeded");
    }
    // 6th call short-circuited BEFORE fetch — counter still at 5 calls.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — shared rate counter across `fetchEtherscanAbi` and
// `checkContractSecurity` (Etherscan V2 enforces per API key, not per
// chain — T-35-01-B).
// ---------------------------------------------------------------------------
describe("fetchEtherscanAbi + checkContractSecurity — shared per-session counter (T-35-01-B)", () => {
  it("Test 7 — interleaved ABI + security calls drain the SAME counter", async () => {
    // Single fetch stub that handles BOTH endpoints (getabi +
    // getsourcecode + getcontractcreation). Each `checkContractSecurity`
    // call fires 2 fetches (Promise.all) but increments the counter
    // ONCE — the budget gate is at the per-call level, not the per-HTTP-
    // request level (verified by reading the implementation).
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("action=getabi")) {
        return {
          ok: true,
          json: async () => ({ status: "1", message: "OK", result: ABI_JSON }),
        } satisfies MockResponse;
      }
      if (url.includes("action=getsourcecode")) {
        return {
          ok: true,
          json: async () => ({
            status: "1",
            message: "OK",
            result: [
              {
                SourceCode: "contract X {}",
                ABI: ABI_JSON,
                ContractName: "X",
                CompilerVersion: "v0.8.20",
                Proxy: "0",
                Implementation: "",
              },
            ],
          }),
        } satisfies MockResponse;
      }
      // getcontractcreation
      return {
        ok: true,
        json: async () => ({
          status: "1",
          message: "OK",
          result: [
            {
              contractCreator: "0x1111111111111111111111111111111111111111",
              txHash: "0x" + "aa".repeat(32),
              timestamp: String(Math.floor(Date.now() / 1000) - 100 * 86400),
            },
          ],
        }),
      } satisfies MockResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    // Burn 4 ABI calls across 4 distinct (chain, address) tuples — counter
    // is now at 4.
    await fetchEtherscanAbi(1, "0x0000000000000000000000000000000000000001" as Address, "test-key");
    await fetchEtherscanAbi(42161, "0x0000000000000000000000000000000000000002" as Address, "test-key");
    await fetchEtherscanAbi(137, "0x0000000000000000000000000000000000000003" as Address, "test-key");
    await fetchEtherscanAbi(8453, "0x0000000000000000000000000000000000000004" as Address, "test-key");

    // 5th call: one `checkContractSecurity` — counter goes to 5.
    const securityResult = await checkContractSecurity(
      1,
      "0x0000000000000000000000000000000000000005" as Address,
      "test-key",
    );
    expect(securityResult.kind).toBe("ok");

    // 6th call (mixed-chain ABI lookup) — must hit rate-limited.
    const result = await fetchEtherscanAbi(
      10,
      "0x0000000000000000000000000000000000000006" as Address,
      "test-key",
    );
    expect(result.kind).toBe("rate-limited");
  });
});

// ---------------------------------------------------------------------------
// Test 8 — cache hit on second call avoids fetch + rate-counter increment.
// ---------------------------------------------------------------------------
describe("fetchEtherscanAbi — LRU cache hit", () => {
  it("Test 8 — second call with same (chainId, address) hits cache, no extra fetch", async () => {
    const fetchMock = buildAbiFetch({
      abiPayload: { status: "1", message: "OK", result: ABI_JSON },
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchEtherscanAbi(1, VERIFIED_ADDRESS, "test-key");
    const second = await fetchEtherscanAbi(1, VERIFIED_ADDRESS, "test-key");

    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Test 8b — cached hits do NOT consume the per-session budget", async () => {
    const fetchMock = buildAbiFetch({
      abiPayload: { status: "1", message: "OK", result: ABI_JSON },
    });
    vi.stubGlobal("fetch", fetchMock);

    // 5 distinct calls + 5 cache hits to the same addresses.
    for (let i = 0; i < 5; i++) {
      const addr = `0x${i.toString(16).padStart(40, "0")}` as Address;
      await fetchEtherscanAbi(1, addr, "test-key");
      await fetchEtherscanAbi(1, addr, "test-key"); // cache hit
    }

    expect(fetchMock).toHaveBeenCalledTimes(5);

    // 6th distinct uncached address still rate-limits — cache hits did
    // not consume the budget.
    const sixth = "0x0000000000000000000000000000000000000099" as Address;
    const result = await fetchEtherscanAbi(1, sixth, "test-key");
    expect(result.kind).toBe("rate-limited");
  });
});

// ---------------------------------------------------------------------------
// Test 9 — chainid widening of existing checkContractSecurity surface.
// ---------------------------------------------------------------------------
describe("checkContractSecurity — chainid widening + per-chain cache key", () => {
  it("Test 9 — same address on different chains caches independently", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("action=getsourcecode")) {
        return {
          ok: true,
          json: async () => ({
            status: "1",
            message: "OK",
            result: [
              {
                SourceCode: "contract X {}",
                ABI: ABI_JSON,
                ContractName: "X",
                CompilerVersion: "v0.8.20",
                Proxy: "0",
                Implementation: "",
              },
            ],
          }),
        } satisfies MockResponse;
      }
      return {
        ok: true,
        json: async () => ({
          status: "1",
          message: "OK",
          result: [
            {
              contractCreator: "0x1111111111111111111111111111111111111111",
              txHash: "0x" + "aa".repeat(32),
              timestamp: String(Math.floor(Date.now() / 1000) - 1 * 86400),
            },
          ],
        }),
      } satisfies MockResponse;
    });
    vi.stubGlobal("fetch", fetchMock);

    // chainId=1 — fires 2 fetches (Promise.all).
    await checkContractSecurity(1, VERIFIED_ADDRESS, "test-key");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // chainId=42161 SAME address — must NOT hit the chainId=1 cache. New
    // pair of fetches.
    await checkContractSecurity(42161, VERIFIED_ADDRESS, "test-key");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // chainId=1 again, same address — cache hit, no new fetches.
    await checkContractSecurity(1, VERIFIED_ADDRESS, "test-key");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // URL of the second fetch round should carry chainid=42161.
    const arbUrl = String(fetchMock.mock.calls[2]?.[0]);
    expect(arbUrl).toContain("chainid=42161");
  });
});

// ---------------------------------------------------------------------------
// Test 10 — parse-once memoization at the client layer.
// ---------------------------------------------------------------------------
describe("fetchEtherscanAbi — parse-once at client layer", () => {
  it("Test 10 — ok.abi is a parsed Array, not a JSON string", async () => {
    const fetchMock = buildAbiFetch({
      abiPayload: { status: "1", message: "OK", result: ABI_JSON },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEtherscanAbi(1, VERIFIED_ADDRESS, "test-key");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(Array.isArray(result.abi)).toBe(true);
      expect(result.abi.length).toBe(1);
      // Verify the rawAbiJson is also surfaced for consumers that need
      // the original wire-format JSON (e.g. signature hashing).
      expect(result.rawAbiJson).toBe(ABI_JSON);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 11 — HTTP non-2xx → error arm.
// ---------------------------------------------------------------------------
describe("fetchEtherscanAbi — HTTP 5xx never collapses to not-verified", () => {
  it("Test 11 — fetch returns ok=false, status=503 → kind: 'error' with verbatim status", async () => {
    const fetchMock = buildAbiFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchEtherscanAbi(1, VERIFIED_ADDRESS, "test-key");

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("Etherscan V2 returned HTTP 503");
    }
  });
});

// ---------------------------------------------------------------------------
// Test 12 — AbortController timeout → error arm.
// ---------------------------------------------------------------------------
describe("fetchEtherscanAbi — AbortError on timeout", () => {
  it("Test 12 — fetch hangs past 3s → kind: 'error' with verbatim timeout message", async () => {
    vi.useFakeTimers();
    const fetchMock = buildAbiFetch({ hang: true });
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchEtherscanAbi(1, VERIFIED_ADDRESS, "test-key");
    await vi.advanceTimersByTimeAsync(3001);

    const result: EtherscanAbiResult = await promise;

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("Etherscan V2 unreachable (timeout 3000ms)");
    }
  });
});

// ---------------------------------------------------------------------------
// Test 13 — getCachedEtherscanAbi: cache-only lookup for preview_send
// (Plan 35-03 preview-time decode helper). Returns null on miss without
// any network call.
// ---------------------------------------------------------------------------
describe("getCachedEtherscanAbi — preview-time cache lookup", () => {
  it("Test 13 — returns null on miss without firing fetch", () => {
    const fetchMock = buildAbiFetch({
      abiPayload: { status: "1", message: "OK", result: ABI_JSON },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = getCachedEtherscanAbi(1, VERIFIED_ADDRESS);
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("Test 13b — returns the cached ok arm after a successful fetchEtherscanAbi", async () => {
    const fetchMock = buildAbiFetch({
      abiPayload: { status: "1", message: "OK", result: ABI_JSON },
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchEtherscanAbi(1, SECOND_ADDRESS, "test-key");

    const cached = getCachedEtherscanAbi(1, SECOND_ADDRESS);
    expect(cached).not.toBeNull();
    expect(cached?.kind).toBe("ok");
    // No new fetch from the cache-only call.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
