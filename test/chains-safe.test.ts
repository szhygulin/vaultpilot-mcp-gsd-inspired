// Phase 36 Plan 36-02 (SAFE-01) — `src/chains/safe.ts` unit tests.
//
// Mirror of `test/chains-aave-v3.test.ts` shape:
//   - parseAbi struct-ref inspection (named-returns assertion — Pitfall 10)
//   - `vi.fn()` mocked `PublicClient.multicall` / `readContract`
//   - `_safeChains` ESM spy round-trip assertion
//
// Anchors:
//   - SAFE_SENTINEL_MODULES literal — exact `0x0...0001` (Pitfall 4)
//   - getOnchainSafeInfo — 4-call multicall, `allowFailure: false`
//   - getEnabledModules — single readContract, SENTINEL filter, truncation flag
//     (Pitfalls 4 + 5), pageSize=100n, start=SENTINEL

import type { Address, PublicClient } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _safeChains,
  getEnabledModules,
  getOnchainSafeInfo,
  SAFE_SENTINEL_MODULES,
  safeSingletonAbi,
} from "../src/chains/safe.js";

const SAFE: Address = "0x1234567890123456789012345678901234567890";
const OWNER_A: Address = "0xAaAaAaaAaAaAaAaAaAaaAAAAAAaAaAAAAaaaAaAa";
const OWNER_B: Address = "0xBbBbBBbbbBbBBBbBBbbBBBBbbbBbBBbBBbbBBBBb";
const MOD_1: Address = "0xMod1ModmodModmodModmodModmodModmodMod0001" as Address;
const MOD_2: Address = "0xMod2ModmodModmodModmodModmodModmodMod0002" as Address;
const CURSOR: Address = "0xCursor00000000000000000000000000000000003" as Address;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chains/safe::safeSingletonAbi (parseAbi struct-ref resolution; Pitfall 10 named returns)", () => {
  it("parses 5 function fragments — all view-state, all named returns", () => {
    expect(Array.isArray(safeSingletonAbi)).toBe(true);
    const fnFragments = safeSingletonAbi.filter((f) => f.type === "function");
    expect(fnFragments).toHaveLength(5);
    for (const fn of fnFragments) {
      expect(fn.type).toBe("function");
      expect(fn.stateMutability).toBe("view");
    }
  });

  it("getModulesPaginated has named returns (modules, next) — Pitfall 10 anchor", () => {
    const fn = safeSingletonAbi.find(
      (f): f is Extract<typeof safeSingletonAbi[number], { type: "function" }> =>
        f.type === "function" && f.name === "getModulesPaginated",
    );
    expect(fn).toBeDefined();
    expect(fn?.inputs).toHaveLength(2);
    expect(fn?.inputs[0]?.type).toBe("address");
    expect(fn?.inputs[1]?.type).toBe("uint256");
    expect(fn?.outputs).toHaveLength(2);
    expect(fn?.outputs[0]?.type).toBe("address[]");
    expect(fn?.outputs[0]?.name).toBe("modules");
    expect(fn?.outputs[1]?.type).toBe("address");
    expect(fn?.outputs[1]?.name).toBe("next");
  });

  it("getOwners / getThreshold / nonce / VERSION signatures match safe-smart-account v1.4.1", () => {
    const byName = (n: string) =>
      safeSingletonAbi.find(
        (f): f is Extract<typeof safeSingletonAbi[number], { type: "function" }> =>
          f.type === "function" && f.name === n,
      );
    expect(byName("getOwners")?.outputs?.[0]?.type).toBe("address[]");
    expect(byName("getThreshold")?.outputs?.[0]?.type).toBe("uint256");
    expect(byName("nonce")?.outputs?.[0]?.type).toBe("uint256");
    expect(byName("VERSION")?.outputs?.[0]?.type).toBe("string");
  });
});

describe("chains/safe::SAFE_SENTINEL_MODULES (Pitfall 4 — exact 40-hex-char anchor)", () => {
  it("equals 0x0000000000000000000000000000000000000001 verbatim", () => {
    expect(SAFE_SENTINEL_MODULES).toBe("0x0000000000000000000000000000000000000001");
    // 0x + 40 hex chars
    expect(SAFE_SENTINEL_MODULES.length).toBe(42);
  });
});

describe("chains/safe::getOnchainSafeInfo — multicall 4 reads, allowFailure: false", () => {
  it("returns { owners, threshold, nonce, version } from a single multicall round-trip", async () => {
    const multicall = vi
      .fn()
      .mockResolvedValue([[OWNER_A, OWNER_B], 2n, 5n, "1.4.1"]);
    const mockClient = { multicall } as unknown as PublicClient;

    const result = await getOnchainSafeInfo(mockClient, 1, SAFE);

    expect(multicall).toHaveBeenCalledOnce();
    const call = multicall.mock.calls[0]?.[0] as {
      contracts: Array<{ address: Address; functionName: string }>;
      allowFailure: boolean;
    };
    expect(call.allowFailure).toBe(false);
    expect(call.contracts).toHaveLength(4);
    expect(call.contracts.map((c) => c.functionName)).toEqual([
      "getOwners",
      "getThreshold",
      "nonce",
      "VERSION",
    ]);
    for (const c of call.contracts) {
      expect(c.address).toBe(SAFE);
    }

    expect(result.owners).toEqual([OWNER_A, OWNER_B]);
    expect(result.threshold).toBe(2n);
    expect(result.nonce).toBe(5n);
    expect(result.version).toBe("1.4.1");
  });
});

describe("chains/safe::getEnabledModules — single readContract, SENTINEL filter, truncation flag", () => {
  it("empty modules + SENTINEL next → { modules: [], truncated: false, nextCursor: null }", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValue([[], SAFE_SENTINEL_MODULES]);
    const mockClient = { readContract } as unknown as PublicClient;

    const result = await getEnabledModules(mockClient, 1, SAFE);

    expect(result.modules).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("module list with SENTINEL embedded → SENTINEL filtered out (Pitfall 4 belt-and-suspenders)", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValue([[MOD_1, SAFE_SENTINEL_MODULES, MOD_2], SAFE_SENTINEL_MODULES]);
    const mockClient = { readContract } as unknown as PublicClient;

    const result = await getEnabledModules(mockClient, 1, SAFE);

    expect(result.modules).toEqual([MOD_1, MOD_2]);
    expect(result.modules).not.toContain(SAFE_SENTINEL_MODULES);
    expect(result.truncated).toBe(false);
  });

  it("next != SENTINEL → truncated: true + nextCursor surfaces verbatim (Pitfall 5)", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValue([[MOD_1, MOD_2], CURSOR]);
    const mockClient = { readContract } as unknown as PublicClient;

    const result = await getEnabledModules(mockClient, 1, SAFE);

    expect(result.modules).toEqual([MOD_1, MOD_2]);
    expect(result.truncated).toBe(true);
    expect(result.nextCursor).toBe(CURSOR);
  });

  it("pageSize is the literal 100n bigint, start is SENTINEL", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValue([[], SAFE_SENTINEL_MODULES]);
    const mockClient = { readContract } as unknown as PublicClient;

    await getEnabledModules(mockClient, 1, SAFE);

    expect(readContract).toHaveBeenCalledOnce();
    const call = readContract.mock.calls[0]?.[0] as {
      address: Address;
      functionName: string;
      args: readonly [Address, bigint];
    };
    expect(call.address).toBe(SAFE);
    expect(call.functionName).toBe("getModulesPaginated");
    expect(call.args[0]).toBe(SAFE_SENTINEL_MODULES);
    expect(call.args[1]).toBe(100n);
  });

  it("case-insensitive SENTINEL match — uppercase tail still recognized as end-of-list", async () => {
    const readContract = vi
      .fn()
      .mockResolvedValue([[MOD_1], "0x0000000000000000000000000000000000000001"]);
    const mockClient = { readContract } as unknown as PublicClient;

    const result = await getEnabledModules(mockClient, 1, SAFE);
    expect(result.truncated).toBe(false);
    expect(result.nextCursor).toBeNull();
  });
});

describe("chains/safe::_safeChains ESM spy-affordance (CLAUDE.md mandatory convention)", () => {
  it("vi.spyOn(_safeChains, 'getOnchainSafeInfo') intercepts internal calls", async () => {
    const spy = vi.spyOn(_safeChains, "getOnchainSafeInfo").mockResolvedValue({
      owners: [OWNER_A],
      threshold: 1n,
      nonce: 0n,
      version: "1.4.1",
    });

    const mockClient = { multicall: vi.fn(), readContract: vi.fn() } as unknown as PublicClient;
    const result = await _safeChains.getOnchainSafeInfo(mockClient, 1, SAFE);

    expect(spy).toHaveBeenCalledOnce();
    expect(result.owners).toEqual([OWNER_A]);
    expect(result.threshold).toBe(1n);
  });

  it("vi.spyOn(_safeChains, 'getEnabledModules') intercepts internal calls", async () => {
    const spy = vi.spyOn(_safeChains, "getEnabledModules").mockResolvedValue({
      modules: [MOD_1],
      truncated: false,
      nextCursor: null,
    });

    const mockClient = { readContract: vi.fn() } as unknown as PublicClient;
    const result = await _safeChains.getEnabledModules(mockClient, 1, SAFE);

    expect(spy).toHaveBeenCalledOnce();
    expect(result.modules).toEqual([MOD_1]);
    expect(result.truncated).toBe(false);
  });
});
