// Phase 36 Plan 36-02 (SAFE-01) — get_safe_positions integration tests.
//
// Stubbing strategy (per CLAUDE.md):
//   - Tx Service: `vi.stubGlobal("fetch", ...)` at the OUTER network boundary
//     (matches `src/clients/safe-tx-service.ts` test seam).
//   - On-chain reads: `vi.spyOn(_safeChains, "getOnchainSafeInfo")` +
//     `vi.spyOn(_safeChains, "getEnabledModules")` — the Task 1 ESM
//     indirection seam.
//   - Chain registry: vi.mock at module load time — same shape as
//     test/get-portfolio-summary.cross-chain.test.ts.
//
// Coverage: 19 behaviors from 36-02-PLAN Task 2.

import type { Address } from "vitest"; // type-only safeguard (will switch to viem)
import type { Address as ViemAddress, PublicClient } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChainId = 1 | 42161 | 137 | 8453 | 10;

// Per-chain mock registry — supports rpcDegraded toggling per test.
const chainState: Record<ChainId, { rpcDegraded: boolean }> = {
  1: { rpcDegraded: false },
  42161: { rpcDegraded: false },
  137: { rpcDegraded: false },
  8453: { rpcDegraded: false },
  10: { rpcDegraded: false },
};

vi.mock("../../src/chains/registry.js", () => {
  return {
    getChainClient: (_chainId: ChainId) =>
      ({
        multicall: vi.fn(),
        readContract: vi.fn(),
      }) as unknown as PublicClient,
    isPublicNodeFallback: (chainId: ChainId) => chainState[chainId].rpcDegraded,
    _resetChainRegistryForTesting: () => {},
    PUBLICNODE_RPC_URLS: { 1: "https://test.invalid" },
  };
});

import { _safeChains } from "../../src/chains/safe.js";
import {
  _resetSafeTxServiceCachesForTesting,
  _resetSafeTxServiceRateCounterForTesting,
} from "../../src/clients/safe-tx-service.js";
import {
  getRegisteredTool,
  type ToolHandlerResult,
} from "../../src/tools/index.js";
import "../../src/tools/register-all.js";

import {
  MULTISIG_TX_OK_FIXTURE,
  OWNER_A,
  OWNER_B,
  OWNER_C,
  PENDING_LIST_EMPTY_FIXTURE,
  PENDING_LIST_OK_FIXTURE,
  SAFE_ADDRESS_1OF1,
  SAFE_ADDRESS_2OF3,
  SAFE_INFO_2_OF_3_FIXTURE,
  SAFE_INFO_OK_FIXTURE,
} from "../fixtures/safe-tx-service-responses.js";

const WALLET: ViemAddress = OWNER_A as ViemAddress;
const SAFE_1: ViemAddress = SAFE_ADDRESS_1OF1 as ViemAddress;
const SAFE_2: ViemAddress = SAFE_ADDRESS_2OF3 as ViemAddress;
const MODULE_A: ViemAddress = "0xAaAaAAAAaaAAaAAaaAaAAAaAAaAAAAAAAaaaa001" as ViemAddress;
const SENTINEL: ViemAddress = "0x0000000000000000000000000000000000000001" as ViemAddress;

interface MockResponse {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
}

/**
 * Build a per-URL routing fetch stub. Maps URL substrings to JSON responses.
 * Default 404 if no rule matches.
 */
function buildFetchByUrl(rules: Array<{ match: string; status?: number; body?: unknown; retryAfter?: string; hang?: boolean; reject?: Error }>): ReturnType<typeof vi.fn> {
  // Endpoint-priority routing: rules that mention `/multisig-transactions/`
  // take precedence over `/safes/{addr}/` (which is a substring prefix of
  // the pending-tx URL `/safes/{addr}/multisig-transactions/`). Then rules
  // mentioning `/safes/{addr}/` win over `/owners/{addr}/safes/`.
  function priority(match: string): number {
    if (match.includes("multisig-transactions")) return 3;
    if (match.includes("/safes/") && !match.includes("/owners/")) return 2;
    if (match.includes("/owners/")) return 1;
    return 0;
  }
  const sortedRules = [...rules].sort((a, b) => priority(b.match) - priority(a.match));
  return vi.fn(async (input: string | URL, init?: { signal?: AbortSignal }) => {
    // Lowercase both sides — Safe addresses cross casing boundaries (EIP-55
    // checksummed entry from getAddress() vs raw fixture form). Match is a
    // substring contains check, case-insensitive.
    const url = input.toString().toLowerCase();
    const rule = sortedRules.find((r) => url.includes(r.match.toLowerCase()));
    if (!rule) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({ detail: "not found" }),
      } satisfies MockResponse;
    }
    if (rule.hang) {
      return new Promise<MockResponse>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }
    if (rule.reject) throw rule.reject;
    const status = rule.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "retry-after" && rule.retryAfter !== undefined
            ? rule.retryAfter
            : null,
      },
      json: async () => rule.body ?? {},
    } satisfies MockResponse;
  });
}

function callTool(args: Record<string, unknown>): Promise<ToolHandlerResult> {
  const tool = getRegisteredTool("get_safe_positions");
  if (!tool) throw new Error("get_safe_positions not registered");
  return Promise.resolve(tool.handler(args));
}

beforeEach(() => {
  _resetSafeTxServiceCachesForTesting();
  _resetSafeTxServiceRateCounterForTesting();
  // Reset rpcDegraded toggles.
  for (const k of Object.keys(chainState) as unknown as ChainId[]) {
    chainState[k].rpcDegraded = false;
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _resetSafeTxServiceCachesForTesting();
  _resetSafeTxServiceRateCounterForTesting();
});

describe("get_safe_positions :: single-chain happy paths", () => {
  it("Test 1: 1-of-1 Safe with no pending tx and no modules", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: `/owners/${WALLET}/safes/`, body: { safes: [SAFE_1] } },
        { match: `/safes/${SAFE_1}/`, body: SAFE_INFO_OK_FIXTURE },
        { match: "/multisig-transactions/", body: PENDING_LIST_EMPTY_FIXTURE },
      ]),
    );
    vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      owners: [WALLET],
      threshold: 1n,
      nonce: 5n,
      version: "1.4.1",
    });
    vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [],
      truncated: false,
      nextCursor: null,
    });

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      safesByChain: Array<{ chain: string; chainId: number; safes: Record<string, unknown>[] }>;
    };
    expect(sc.safesByChain).toHaveLength(1);
    expect(sc.safesByChain[0]?.chain).toBe("ethereum");
    expect(sc.safesByChain[0]?.chainId).toBe(1);
    expect(sc.safesByChain[0]?.safes).toHaveLength(1);
    const safe = sc.safesByChain[0]!.safes[0]!;
    expect(safe.safeAddress).toBe(SAFE_1);
    // EIP-55 normalization: compare lowercased (handler does getAddress() on
    // each owner — case differs but byte-identity holds).
    expect((safe.owners as string[]).map((o) => o.toLowerCase())).toEqual([WALLET.toLowerCase()]);
    expect(safe.threshold).toBe(1);
    expect(safe.nonce).toBe("5");
    expect(safe.version).toBe("1.4.1");
    expect(safe.enabledModules).toEqual([]);
    expect(safe.pendingTransactions).toEqual([]);
    expect(safe.txServiceDrift).toBe(false);
    expect(safe.driftReasons).toEqual([]);
  });

  it("Test 2: 2-of-3 Safe with one pending tx and one enabled module", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: `/owners/${WALLET}/safes/`, body: { safes: [SAFE_2] } },
        { match: `/safes/${SAFE_2}/`, body: SAFE_INFO_2_OF_3_FIXTURE },
        { match: "/multisig-transactions/", body: PENDING_LIST_OK_FIXTURE },
      ]),
    );
    vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      owners: [OWNER_A as ViemAddress, OWNER_B as ViemAddress, OWNER_C as ViemAddress],
      threshold: 2n,
      nonce: 12n,
      version: "1.4.1",
    });
    vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [MODULE_A],
      truncated: false,
      nextCursor: null,
    });

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    const sc = result.structuredContent as {
      safesByChain: Array<{ safes: Record<string, unknown>[] }>;
    };
    const safe = sc.safesByChain[0]!.safes[0]!;
    expect(safe.threshold).toBe(2);
    expect(safe.enabledModules).toEqual([MODULE_A]);
    const pending = safe.pendingTransactions as Array<Record<string, unknown>>;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.safeTxHash).toBe(MULTISIG_TX_OK_FIXTURE.safeTxHash);
    expect(pending[0]?.nonce).toBe("12");
    expect(pending[0]?.collectedSignatures).toBe(1);
    expect(pending[0]?.requiredSignatures).toBe(2);
    expect(pending[0]?.isExecutable).toBe(false);
  });
});

describe("get_safe_positions :: drift detection (semantic labels)", () => {
  it("Test 3: owners-set + threshold + version mismatches all surface in driftReasons", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: `/owners/${WALLET}/safes/`, body: { safes: [SAFE_1] } },
        {
          match: `/safes/${SAFE_1}/`,
          body: {
            ...SAFE_INFO_OK_FIXTURE,
            owners: [OWNER_A, OWNER_B],
            threshold: 1,
            version: "1.3.0",
          },
        },
        { match: "/multisig-transactions/", body: PENDING_LIST_EMPTY_FIXTURE },
      ]),
    );
    vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      owners: [OWNER_A as ViemAddress, OWNER_B as ViemAddress, OWNER_C as ViemAddress],
      threshold: 2n,
      nonce: 5n,
      version: "1.4.1",
    });
    vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [],
      truncated: false,
      nextCursor: null,
    });

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    const sc = result.structuredContent as {
      safesByChain: Array<{ safes: Array<{ owners: string[]; threshold: number; version: string; txServiceDrift: boolean; driftReasons: string[] }> }>;
    };
    const safe = sc.safesByChain[0]!.safes[0]!;
    // ON-CHAIN values surface in the row, NOT Tx Service. EIP-55 normalized
    // — compare lowercased.
    expect(safe.owners.map((o) => o.toLowerCase())).toEqual(
      [OWNER_A, OWNER_B, OWNER_C].map((o) => o.toLowerCase()),
    );
    expect(safe.threshold).toBe(2);
    expect(safe.version).toBe("1.4.1");
    expect(safe.txServiceDrift).toBe(true);
    expect(safe.driftReasons).toContain("owners-set-mismatch");
    expect(safe.driftReasons).toContain("threshold-mismatch");
    expect(safe.driftReasons).toContain("version-mismatch");
  });

  it("Test 4: nonce-stale only when delta > 3", async () => {
    // Sub-case A: delta=1 (no stale flag).
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: `/owners/${WALLET}/safes/`, body: { safes: [SAFE_1] } },
        { match: `/safes/${SAFE_1}/`, body: { ...SAFE_INFO_OK_FIXTURE, nonce: "5" } },
        { match: "/multisig-transactions/", body: PENDING_LIST_EMPTY_FIXTURE },
      ]),
    );
    vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      owners: [WALLET],
      threshold: 1n,
      nonce: 6n, // delta=1 → no stale flag
      version: "1.4.1",
    });
    vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [],
      truncated: false,
      nextCursor: null,
    });
    let result = await callTool({ chain: "ethereum", wallet: WALLET });
    let sc = result.structuredContent as { safesByChain: Array<{ safes: Array<{ driftReasons: string[] }> }> };
    expect(sc.safesByChain[0]!.safes[0]!.driftReasons).not.toContain("nonce-stale");

    // Sub-case B: delta=8 (stale flag).
    _resetSafeTxServiceCachesForTesting();
    _resetSafeTxServiceRateCounterForTesting();
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: `/owners/${WALLET}/safes/`, body: { safes: [SAFE_1] } },
        { match: `/safes/${SAFE_1}/`, body: { ...SAFE_INFO_OK_FIXTURE, nonce: "2" } },
        { match: "/multisig-transactions/", body: PENDING_LIST_EMPTY_FIXTURE },
      ]),
    );
    vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      owners: [WALLET],
      threshold: 1n,
      nonce: 10n, // delta=8 → stale flag
      version: "1.4.1",
    });
    vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [],
      truncated: false,
      nextCursor: null,
    });
    result = await callTool({ chain: "ethereum", wallet: WALLET });
    sc = result.structuredContent as { safesByChain: Array<{ safes: Array<{ driftReasons: string[] }> }> };
    expect(sc.safesByChain[0]!.safes[0]!.driftReasons).toContain("nonce-stale");
  });

  it("Test 16: unsupported-version (1.1.x) surfaces as a drift reason", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: `/owners/${WALLET}/safes/`, body: { safes: [SAFE_1] } },
        { match: `/safes/${SAFE_1}/`, body: { ...SAFE_INFO_OK_FIXTURE, version: "1.1.5" } },
        { match: "/multisig-transactions/", body: PENDING_LIST_EMPTY_FIXTURE },
      ]),
    );
    vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      owners: [WALLET],
      threshold: 1n,
      nonce: 5n,
      version: "1.1.5",
    });
    vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [],
      truncated: false,
      nextCursor: null,
    });

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    const sc = result.structuredContent as { safesByChain: Array<{ safes: Array<{ driftReasons: string[] }> }> };
    expect(sc.safesByChain[0]!.safes[0]!.driftReasons).toContain("unsupported-version");
  });
});

describe("get_safe_positions :: wallet-not-owner silent drop (CONTEXT lock)", () => {
  it("Test 5: Tx Service returns Safe, on-chain owners excludes wallet → row dropped silently", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: `/owners/${WALLET}/safes/`, body: { safes: [SAFE_1] } },
        { match: `/safes/${SAFE_1}/`, body: SAFE_INFO_OK_FIXTURE },
        { match: "/multisig-transactions/", body: PENDING_LIST_EMPTY_FIXTURE },
      ]),
    );
    vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      // WALLET is NOT in the on-chain owner set anymore.
      owners: [OWNER_B as ViemAddress, OWNER_C as ViemAddress],
      threshold: 1n,
      nonce: 5n,
      version: "1.4.1",
    });
    vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [],
      truncated: false,
      nextCursor: null,
    });

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { safesByChain: Array<{ safes: unknown[] }> };
    expect(sc.safesByChain[0]?.safes).toEqual([]);
  });
});

describe("get_safe_positions :: multi-chain fan-out", () => {
  it("Test 6: chain omitted → all 5 chains queried via Promise.allSettled", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        // every chain returns 0 safes; we just need 5 successful fan-out legs
        { match: `/owners/${WALLET}/safes/`, body: { safes: [] } },
      ]),
    );
    const onSpyChainInfo = vi.spyOn(_safeChains, "getOnchainSafeInfo");
    const onSpyMods = vi.spyOn(_safeChains, "getEnabledModules");

    const result = await callTool({ wallet: WALLET });
    const sc = result.structuredContent as { safesByChain: Array<{ chain: string }>; degradedChains: number[] };
    expect(sc.safesByChain).toHaveLength(5);
    const chainNames = sc.safesByChain.map((r) => r.chain);
    expect(chainNames).toEqual(["ethereum", "arbitrum", "polygon", "base", "optimism"]);
    expect(sc.degradedChains).toEqual([]);
    // No Safes returned → on-chain reads never invoked
    expect(onSpyChainInfo).not.toHaveBeenCalled();
    expect(onSpyMods).not.toHaveBeenCalled();
  });

  it("Test 7: partial multi-chain failure — 429 chains land in degradedChains; healthy chains in safesByChain", async () => {
    // Per-URL routing: chain shortname appears in URL; we route by shortname.
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: "/eth/api/v1/owners/", body: { safes: [] } }, // ethereum healthy
        { match: "/oeth/api/v1/owners/", body: { safes: [] } }, // optimism healthy
        { match: "/pol/api/v1/owners/", status: 429, retryAfter: "30" },
        { match: "/base/api/v1/owners/", status: 429, retryAfter: "30" },
        { match: "/arb1/api/v1/owners/", status: 429, retryAfter: "30" },
      ]),
    );

    const result = await callTool({ wallet: WALLET });
    const sc = result.structuredContent as {
      safesByChain: Array<{ chain: string; chainId: number; safes: unknown[] }>;
      degradedChains: number[];
      degradedReasons: Record<string, string>;
    };
    // 2 healthy (ethereum=1, optimism=10), 3 degraded (137 polygon, 8453 base, 42161 arbitrum).
    expect(sc.safesByChain).toHaveLength(2);
    expect(sc.degradedChains.sort()).toEqual([137, 8453, 42161].sort());
    for (const id of [137, 8453, 42161]) {
      expect(sc.degradedReasons[id]).toMatch(/429|rate/);
    }
  });

  it("Test 17: explicit chain arg → only that chain queried (no fan-out)", async () => {
    const fetchSpy = buildFetchByUrl([
      { match: "/pol/api/v1/owners/", body: { safes: [] } },
    ]);
    vi.stubGlobal("fetch", fetchSpy);

    const result = await callTool({ chain: "polygon", wallet: WALLET });
    const sc = result.structuredContent as { safesByChain: Array<{ chain: string }> };
    expect(sc.safesByChain).toHaveLength(1);
    expect(sc.safesByChain[0]?.chain).toBe("polygon");
    // Verify fetch was called only with the polygon endpoint, not the others.
    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).toContain("/pol/api/");
    }
  });
});

describe("get_safe_positions :: degradation surfacing", () => {
  it("Test 8: per-chain timeout — hanging fetch yields a 'timeout' entry in degradedChains", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        buildFetchByUrl([
          // hang every owners query — should hit per-chain timeout
          { match: "/owners/", hang: true },
        ]),
      );
      vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
        owners: [WALLET],
        threshold: 1n,
        nonce: 5n,
        version: "1.4.1",
      });
      vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
        modules: [],
        truncated: false,
        nextCursor: null,
      });
      const pending = callTool({ chain: "ethereum", wallet: WALLET });
      // Advance both timers: the safe-tx-service's 5s + the tool's 10s.
      await vi.advanceTimersByTimeAsync(15_000);
      const result = await pending;
      const sc = result.structuredContent as {
        degradedChains: number[];
        degradedReasons: Record<string, string>;
      };
      expect(sc.degradedChains).toContain(1);
      // The message may say "timeout" (tool-level) or "unreachable (timeout"
      // (client-level) — either flavor is correct.
      expect(sc.degradedReasons[1]).toMatch(/timeout|unreachable/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Test 9: unsupported-chain arm propagates into degradedChains", async () => {
    // Stub the client's getSafesByOwner directly at the module surface.
    const safeTxModule = await import("../../src/clients/safe-tx-service.js");
    vi.spyOn(safeTxModule, "getSafesByOwner").mockResolvedValue({
      kind: "unsupported-chain",
      chainId: 1,
    });
    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    const sc = result.structuredContent as {
      safesByChain: Array<{ safes: unknown[] }>;
      degradedChains: number[];
      degradedReasons: Record<string, string>;
    };
    expect(sc.safesByChain).toEqual([]);
    expect(sc.degradedChains).toEqual([1]);
    expect(sc.degradedReasons[1]).toMatch(/has no endpoint|unsupported/i);
  });

  it("Test 13: 404 from getSafesByOwner → empty safes (Pitfall 7), NOT an error", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        // 404 — no rule matches /owners/ explicitly, so it falls through to default 404
      ]),
    );
    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      safesByChain: Array<{ safes: unknown[] }>;
      degradedChains: number[];
    };
    expect(sc.safesByChain[0]?.safes).toEqual([]);
    expect(sc.degradedChains).toEqual([]);
  });

  it("Test 14: rpcDegraded surfaces on each Safe row when isPublicNodeFallback() is true", async () => {
    chainState[1].rpcDegraded = true;
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: `/owners/${WALLET}/safes/`, body: { safes: [SAFE_1] } },
        { match: `/safes/${SAFE_1}/`, body: SAFE_INFO_OK_FIXTURE },
        { match: "/multisig-transactions/", body: PENDING_LIST_EMPTY_FIXTURE },
      ]),
    );
    vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      owners: [WALLET],
      threshold: 1n,
      nonce: 5n,
      version: "1.4.1",
    });
    vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [],
      truncated: false,
      nextCursor: null,
    });

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    const sc = result.structuredContent as { safesByChain: Array<{ safes: Array<{ rpcDegraded?: boolean }> }> };
    expect(sc.safesByChain[0]!.safes[0]!.rpcDegraded).toBe(true);
  });
});

describe("get_safe_positions :: module + pendingTransactions list discipline", () => {
  it("Test 10: SENTINEL in on-chain module list is defensively filtered at consumer site", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: `/owners/${WALLET}/safes/`, body: { safes: [SAFE_1] } },
        { match: `/safes/${SAFE_1}/`, body: SAFE_INFO_OK_FIXTURE },
        { match: "/multisig-transactions/", body: PENDING_LIST_EMPTY_FIXTURE },
      ]),
    );
    vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      owners: [WALLET],
      threshold: 1n,
      nonce: 5n,
      version: "1.4.1",
    });
    // Pretend Task 1 leaked SENTINEL through (it shouldn't, but defense in depth).
    vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [MODULE_A, SENTINEL],
      truncated: false,
      nextCursor: null,
    });

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    const sc = result.structuredContent as { safesByChain: Array<{ safes: Array<{ enabledModules: string[] }> }> };
    expect(sc.safesByChain[0]!.safes[0]!.enabledModules).toEqual([MODULE_A]);
    expect(sc.safesByChain[0]!.safes[0]!.enabledModules).not.toContain(SENTINEL);
  });

  it("Test 11: enabledModulesTruncated + paginationCursor surfaces when Task 1 says truncated", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: `/owners/${WALLET}/safes/`, body: { safes: [SAFE_1] } },
        { match: `/safes/${SAFE_1}/`, body: SAFE_INFO_OK_FIXTURE },
        { match: "/multisig-transactions/", body: PENDING_LIST_EMPTY_FIXTURE },
      ]),
    );
    vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      owners: [WALLET],
      threshold: 1n,
      nonce: 5n,
      version: "1.4.1",
    });
    const cursor = "0xCCC0000000000000000000000000000000000000" as ViemAddress;
    vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [MODULE_A],
      truncated: true,
      nextCursor: cursor,
    });

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    const sc = result.structuredContent as {
      safesByChain: Array<{ safes: Array<{ enabledModulesTruncated: boolean; enabledModulesPaginationCursor?: string }> }>;
    };
    expect(sc.safesByChain[0]!.safes[0]!.enabledModulesTruncated).toBe(true);
    expect(sc.safesByChain[0]!.safes[0]!.enabledModulesPaginationCursor).toBe(cursor);
  });

  it("Test 12: pendingTransactionsTotalCount + truncated surface when count > 20", async () => {
    const manyResults = Array.from({ length: 20 }, (_v, i) => ({
      ...MULTISIG_TX_OK_FIXTURE,
      nonce: String(12 + i),
      safeTxHash: `0x${i.toString(16).padStart(64, "0")}`,
    }));
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: `/owners/${WALLET}/safes/`, body: { safes: [SAFE_2] } },
        { match: `/safes/${SAFE_2}/`, body: SAFE_INFO_2_OF_3_FIXTURE },
        {
          match: "/multisig-transactions/",
          body: { count: 47, results: manyResults },
        },
      ]),
    );
    vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      owners: [OWNER_A as ViemAddress, OWNER_B as ViemAddress, OWNER_C as ViemAddress],
      threshold: 2n,
      nonce: 12n,
      version: "1.4.1",
    });
    vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [],
      truncated: false,
      nextCursor: null,
    });

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    const sc = result.structuredContent as {
      safesByChain: Array<{ safes: Array<{ pendingTransactions: unknown[]; pendingTransactionsTotalCount: number; pendingTransactionsTruncated: boolean }> }>;
    };
    const safe = sc.safesByChain[0]!.safes[0]!;
    expect(safe.pendingTransactions).toHaveLength(20);
    expect(safe.pendingTransactionsTotalCount).toBe(47);
    expect(safe.pendingTransactionsTruncated).toBe(true);
  });
});

describe("get_safe_positions :: CRITICAL property (Test 15) — on-chain values, NOT Tx Service", () => {
  it("response fields come from the on-chain spy returns, NOT the Tx Service spy returns", async () => {
    vi.stubGlobal(
      "fetch",
      buildFetchByUrl([
        { match: `/owners/${WALLET}/safes/`, body: { safes: [SAFE_1] } },
        {
          match: `/safes/${SAFE_1}/`,
          body: {
            ...SAFE_INFO_OK_FIXTURE,
            owners: [OWNER_A], // Tx Service says 1-of-1
            threshold: 1,
            nonce: "999",
            version: "1.3.0",
          },
        },
        { match: "/multisig-transactions/", body: PENDING_LIST_EMPTY_FIXTURE },
      ]),
    );
    vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      // On-chain truth — completely diverged from Tx Service.
      owners: [OWNER_A as ViemAddress, OWNER_B as ViemAddress],
      threshold: 2n,
      nonce: 42n,
      version: "1.4.1",
    });
    vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [MODULE_A],
      truncated: false,
      nextCursor: null,
    });

    const result = await callTool({ chain: "ethereum", wallet: WALLET });
    const sc = result.structuredContent as { safesByChain: Array<{ safes: Array<Record<string, unknown>> }> };
    const safe = sc.safesByChain[0]!.safes[0]!;
    // Every field comes from the on-chain spy returns (EIP-55 normalized;
    // compare lowercased — byte-identity is the actual invariant):
    expect((safe.owners as string[]).map((o) => o.toLowerCase())).toEqual(
      [OWNER_A, OWNER_B].map((o) => o.toLowerCase()),
    ); // NOT [OWNER_A] (Tx Service)
    expect(safe.threshold).toBe(2); // NOT 1
    expect(safe.nonce).toBe("42"); // NOT "999"
    expect(safe.version).toBe("1.4.1"); // NOT "1.3.0"
    expect(safe.enabledModules).toEqual([MODULE_A]);
    expect(safe.txServiceDrift).toBe(true);
  });
});

describe("get_safe_positions :: input validation + register-all wiring", () => {
  it("Test 18: invalid wallet refusal envelope, no fan-out attempted", async () => {
    const fetchSpy = buildFetchByUrl([]);
    vi.stubGlobal("fetch", fetchSpy);

    const result = await callTool({ wallet: "not-an-address" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/wallet.*valid.*EVM/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Test 19: register-all.ts imports get_safe_positions side-effect", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(__dirname, "..", "..", "src", "tools", "register-all.ts"),
      "utf8",
    );
    expect(src).toMatch(/import\s+["'].\/get_safe_positions(\.js)?["']/);
  });
});
