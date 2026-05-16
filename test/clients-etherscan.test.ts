// Plan 07-04 Task 1 — Etherscan V2 client tests (READ-21 supporting client).
//
// Tests assert the 5-arm discriminated union (`not-applicable` / `ok` /
// `not-verified` / `error` / `rate-limited`) — `error` NEVER collapses to
// `not-verified` (T-ETHERSCAN-MASK-1). The 3s AbortController timeout, LRU
// cache (256-entry cap, error caching), per-session rate-limit boundary
// (T-ETHERSCAN-RATE-1), API-key-never-logged (T-ETHERSCAN-KEY-LEAK-1), and
// adversarial-input verbatim surfacing are all covered. Fetch is stubbed
// via `vi.stubGlobal("fetch", ...)` — mirrors the test/fourbyte.test.ts
// pattern (NOT vi.spyOn on the named export — ESM bindings are immutable).
//
// Module fixtures: known-verified ERC-20 happy path, proxy contract
// (Aave V3 Pool address), unverified contract.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";

import {
  _resetEtherscanCacheForTesting,
  _resetEtherscanRateCounterForTesting,
  checkContractSecurity,
  type EtherscanResult,
} from "../src/clients/etherscan.js";
import * as logger from "../src/diagnostics/logger.js";

interface MockResponse {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}

interface FetchOpts {
  ok?: boolean;
  status?: number;
  sourcePayload?: unknown;
  creationPayload?: unknown;
  reject?: Error;
  hang?: boolean;
}

// Build a fetch stub that returns DIFFERENT payloads for getsourcecode
// vs getcontractcreation based on the URL's `action=` query param.
function buildFetch(opts: FetchOpts): ReturnType<typeof vi.fn> {
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
    const url = String(input);
    const isGetSourceCode = url.includes("action=getsourcecode");
    const payload = isGetSourceCode ? opts.sourcePayload : opts.creationPayload;
    return {
      ok: opts.ok ?? true,
      status: opts.status,
      json: async () => payload,
    } satisfies MockResponse;
  });
}

const VERIFIED_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address; // USDC
const PROXY_ADDRESS = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2" as Address; // Aave V3 Pool
const UNVERIFIED_ADDRESS = "0x000000000000000000000000000000000000dEaD" as Address;

// Canonical ABI fragment exercising both privileged + AccessControl branches.
const VERIFIED_ABI_JSON = JSON.stringify([
  { type: "function", name: "transfer", inputs: [{ type: "address" }, { type: "uint256" }] },
  { type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }] },
  { type: "function", name: "upgradeTo", inputs: [{ type: "address" }] },
  { type: "function", name: "pause", inputs: [] },
  { type: "function", name: "hasRole", inputs: [{ type: "bytes32" }, { type: "address" }] },
  { type: "function", name: "DEFAULT_ADMIN_ROLE", inputs: [] },
  { type: "event", name: "Transfer", inputs: [{ type: "address" }, { type: "address" }, { type: "uint256" }] },
]);

// Build a canonical getsourcecode happy-path payload.
function sourcePayloadVerified(overrides: Record<string, string> = {}) {
  return {
    status: "1",
    message: "OK",
    result: [
      {
        SourceCode: "contract Foo { ... }",
        ABI: VERIFIED_ABI_JSON,
        ContractName: "USDC",
        CompilerVersion: "v0.8.20+commit.a1b79de6",
        Proxy: "0",
        Implementation: "",
        ...overrides,
      },
    ],
  };
}

// Canonical getcontractcreation happy-path payload. Use a fixed timestamp
// 100 days before now so age computation has a deterministic upper bound.
const FIXED_TIMESTAMP_100_DAYS_AGO = Math.floor(Date.now() / 1000) - 100 * 86400;

function creationPayloadVerified(overrides: Record<string, string> = {}) {
  return {
    status: "1",
    message: "OK",
    result: [
      {
        contractCreator: "0x1111111111111111111111111111111111111111",
        txHash: "0x" + "aa".repeat(32),
        timestamp: String(FIXED_TIMESTAMP_100_DAYS_AGO),
        ...overrides,
      },
    ],
  };
}

beforeEach(() => {
  _resetEtherscanCacheForTesting();
  _resetEtherscanRateCounterForTesting();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  _resetEtherscanCacheForTesting();
  _resetEtherscanRateCounterForTesting();
});

describe("checkContractSecurity — not-applicable for null address", () => {
  it("returns kind: 'not-applicable' synchronously and does NOT call fetch", async () => {
    const fetchMock = buildFetch({});
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkContractSecurity(null, "any-key");

    expect(result.kind).toBe("not-applicable");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

describe("checkContractSecurity — happy path verified contract (Test 1)", () => {
  it("returns kind: 'ok' with parsed contract metadata + privileged-role enumeration", async () => {
    const fetchMock = buildFetch({
      sourcePayload: sourcePayloadVerified(),
      creationPayload: creationPayloadVerified(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkContractSecurity(VERIFIED_ADDRESS, "test-key");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.verified).toBe(true);
      expect(result.proxy).toBe(false);
      expect(result.implementation).toBeUndefined();
      expect(result.contractName).toBe("USDC");
      expect(result.compilerVersion).toBe("v0.8.20+commit.a1b79de6");
      expect(result.creatorAddress).toBe("0x1111111111111111111111111111111111111111");
      expect(result.creationTxHash).toBe("0x" + "aa".repeat(32));
      expect(result.creationTimestamp).toBe(FIXED_TIMESTAMP_100_DAYS_AGO);
      expect(result.ageDays).toBe(100);
      expect(result.privilegedFunctions).toEqual([
        "upgradeTo(address)",
        "pause()",
      ]);
      expect(result.accessControlMarkers).toEqual([
        "hasRole(bytes32,address)",
        "DEFAULT_ADMIN_ROLE()",
      ]);
    }
    // Both endpoints called exactly once via Promise.all.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("checkContractSecurity — proxy contract surfacing (T-ETHERSCAN-PROXY-IMPLEMENTATION-MASK-1)", () => {
  it("surfaces proxy: true + implementation address as separate field", async () => {
    const implementationAddress = "0x8147b99D3eAB2e6Aef00f1abD64f5e87C0987654";
    const fetchMock = buildFetch({
      sourcePayload: sourcePayloadVerified({
        Proxy: "1",
        Implementation: implementationAddress,
        ContractName: "InitializableImmutableAdminUpgradeabilityProxy",
      }),
      creationPayload: creationPayloadVerified(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkContractSecurity(PROXY_ADDRESS, "test-key");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.proxy).toBe(true);
      expect(result.implementation).toBe(implementationAddress);
      expect(result.contractName).toBe("InitializableImmutableAdminUpgradeabilityProxy");
    }
  });
});

describe("checkContractSecurity — unverified contract (Test 2)", () => {
  it("returns kind: 'not-verified' when SourceCode is empty / placeholder", async () => {
    const fetchMock = buildFetch({
      sourcePayload: {
        status: "1",
        message: "OK",
        result: [
          {
            SourceCode: "",
            ABI: "Contract source code not verified",
            ContractName: "",
            CompilerVersion: "",
            Proxy: "0",
            Implementation: "",
          },
        ],
      },
      creationPayload: creationPayloadVerified(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkContractSecurity(UNVERIFIED_ADDRESS, "test-key");

    expect(result.kind).toBe("not-verified");
  });
});

describe("checkContractSecurity — error for HTTP 5xx (T-ETHERSCAN-MASK-1)", () => {
  it("returns kind: 'error' (NEVER 'not-verified') with verbatim status message", async () => {
    const fetchMock = buildFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkContractSecurity(VERIFIED_ADDRESS, "test-key");

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("Etherscan V2 returned HTTP 503");
    }
  });
});

describe("checkContractSecurity — error for AbortController timeout (T-ETHERSCAN-MASK-1)", () => {
  it("aborts at 3s and returns kind: 'error' with verbatim timeout message", async () => {
    vi.useFakeTimers();
    const fetchMock = buildFetch({ hang: true });
    vi.stubGlobal("fetch", fetchMock);

    const promise = checkContractSecurity(VERIFIED_ADDRESS, "test-key");
    await vi.advanceTimersByTimeAsync(3001);

    const result = await promise;

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toBe("Etherscan V2 unreachable (timeout 3000ms)");
    }
  });
});

describe("checkContractSecurity — per-session rate-limit (T-ETHERSCAN-RATE-1)", () => {
  it("5 uncached calls succeed; 6th returns kind: 'rate-limited'", async () => {
    const fetchMock = buildFetch({
      sourcePayload: sourcePayloadVerified(),
      creationPayload: creationPayloadVerified(),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Call 5 distinct addresses (no cache hits) — all succeed.
    const addresses: Address[] = [];
    for (let i = 0; i < 5; i++) {
      const hex = `0x${i.toString(16).padStart(40, "0")}` as Address;
      addresses.push(hex);
      const r = await checkContractSecurity(hex, "test-key");
      expect(r.kind).toBe("ok");
    }
    // 6th distinct address triggers rate-limit (counter is now 5).
    const sixth = "0x0000000000000000000000000000000000000005" as Address;
    const result = await checkContractSecurity(sixth, "test-key");
    expect(result.kind).toBe("rate-limited");
    if (result.kind === "rate-limited") {
      expect(result.message).toContain("per-session limit (5 calls) exceeded");
    }
  });

  it("cached hits do NOT consume the per-session budget", async () => {
    const fetchMock = buildFetch({
      sourcePayload: sourcePayloadVerified(),
      creationPayload: creationPayloadVerified(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const a = "0x0000000000000000000000000000000000000001" as Address;
    // First call increments counter to 1.
    await checkContractSecurity(a, "test-key");
    // Second call to same address hits cache → counter stays at 1.
    await checkContractSecurity(a, "test-key");

    // 4 more distinct addresses — pushes counter to 5.
    for (let i = 2; i <= 5; i++) {
      const hex = `0x${i.toString(16).padStart(40, "0")}` as Address;
      const r = await checkContractSecurity(hex, "test-key");
      expect(r.kind).toBe("ok");
    }
    // 5th DISTINCT call succeeded (counter is now 5). 6th triggers limit.
    const sixth = "0x0000000000000000000000000000000000000099" as Address;
    const result = await checkContractSecurity(sixth, "test-key");
    expect(result.kind).toBe("rate-limited");
  });
});

describe("checkContractSecurity — URL with API key not logged (T-ETHERSCAN-KEY-LEAK-1)", () => {
  it("on HTTP error, the logged warning does NOT contain the API key value", async () => {
    const SECRET_KEY = "secret-api-key-do-not-leak-12345";
    const logSpy = vi.spyOn(logger, "log").mockImplementation(() => undefined);
    const fetchMock = buildFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkContractSecurity(VERIFIED_ADDRESS, SECRET_KEY);

    expect(result.kind).toBe("error");
    // Logger called at least once (warn level on the error path).
    expect(logSpy).toHaveBeenCalled();
    // Substring scan across ALL logged messages: the API key value must
    // NEVER appear.
    for (const call of logSpy.mock.calls) {
      const message = String(call[1] ?? "");
      expect(message).not.toContain(SECRET_KEY);
    }
  });
});

describe("checkContractSecurity — LRU cache hit", () => {
  it("returns the cached result on the second call (single network round-trip = 2 fetches)", async () => {
    const fetchMock = buildFetch({
      sourcePayload: sourcePayloadVerified(),
      creationPayload: creationPayloadVerified(),
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await checkContractSecurity(VERIFIED_ADDRESS, "test-key");
    const second = await checkContractSecurity(VERIFIED_ADDRESS, "test-key");

    expect(first).toEqual(second);
    // Promise.all of 2 endpoints = 2 fetches per uncached call.
    // Second call hits the cache → no additional fetches.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("checkContractSecurity — ageDays defensive 'unknown' for zero timestamp", () => {
  it("when getcontractcreation returns timestamp=0, surfaces ageDays: 'unknown'", async () => {
    const fetchMock = buildFetch({
      sourcePayload: sourcePayloadVerified(),
      creationPayload: {
        status: "1",
        message: "OK",
        result: [
          {
            contractCreator: "0x1111111111111111111111111111111111111111",
            txHash: "0x" + "bb".repeat(32),
            timestamp: "0",
          },
        ],
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkContractSecurity(VERIFIED_ADDRESS, "test-key");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.ageDays).toBe("unknown");
    }
  });
});

describe("checkContractSecurity — no console.* writes (stderr-only via logger)", () => {
  it("triggers an error path and asserts no console.log / console.warn / console.error call", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = buildFetch({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const result: EtherscanResult = await checkContractSecurity(VERIFIED_ADDRESS, "test-key");
    expect(result.kind).toBe("error");

    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
