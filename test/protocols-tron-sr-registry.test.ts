// `tron-sr-registry` unit tests. Phase 19 — Plan 19-03.
//
// Load-bearing invariants:
//
//   1. **Live-fetch happy path** — `loadSrRegistry(tronWeb)` with mocked
//      `listSuperRepresentatives()` returns `{ source: "live", srs: [...] }`.
//      SR entries are sorted by voteCount desc, rank assigned 1..N, name
//      heuristically derived from URL.
//
//   2. **RPC-failure fallback** — `listSuperRepresentatives()` throws →
//      returns `{ source: "snapshot-fallback", srs: [<from-tron-srs.json>] }`.
//
//   3. **Hex address normalization** — if `listSuperRepresentatives()` returns
//      `address: "0x41<hex>"` (edge case per RESEARCH §Topic 4 Pitfall 2),
//      the loader applies `formatTronAddress` to convert to base58check.
//
//   4. **ESM spy-affordance** — `_tronSrRegistry` indirection exposes
//      `loadSrRegistry` + `lookupSr`; `vi.spyOn` intercepts.
//
//   5. **tron-srs.json DOA validation** — snapshot file exists with ≥27 entries;
//      each entry has `address` (base58check), `name`, `rank`, `voteCount`, `url`.

import { describe, expect, it, vi } from "vitest";

import type { TronWeb } from "tronweb";

import {
  _tronSrRegistry,
  loadSrRegistry,
  lookupSr,
  type SrRegistryResult,
} from "../src/protocols/tron-sr-registry.js";

// ============================================================================
// Test 1: loadSrRegistry live-fetch happy path
// ============================================================================

describe("loadSrRegistry — live-fetch happy path", () => {
  it("returns source='live' with sorted srs when listSuperRepresentatives succeeds", async () => {
    const mockWitnesses = [
      {
        address: "TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy",
        voteCount: 1000,
        url: "https://kucoin.com",
        totalProduced: 100,
        totalMissed: 0,
        latestBlockNum: 1000,
        latestSlotNum: 1000,
        isJobs: true,
        pubKey: "abc",
      },
      {
        address: "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH",
        voteCount: 4000000000,
        url: "https://www.binance.com",
        totalProduced: 10000,
        totalMissed: 0,
        latestBlockNum: 2000,
        latestSlotNum: 2000,
        isJobs: true,
        pubKey: "def",
      },
      {
        address: "TE7hnUtWRRBz3SkFrX8JESWUmEvxxAhoPt",
        voteCount: 2000000000,
        url: "https://www.huobi.com",
        totalProduced: 5000,
        totalMissed: 1,
        latestBlockNum: 1500,
        latestSlotNum: 1500,
        isJobs: true,
        pubKey: "ghi",
      },
    ];

    const mockTronWeb = {
      trx: {
        listSuperRepresentatives: vi.fn().mockResolvedValue(mockWitnesses),
      },
    } as unknown as TronWeb;

    const result = await loadSrRegistry(mockTronWeb);

    expect(result.source).toBe("live");
    expect(result.srs).toHaveLength(3);

    // Sorted by voteCount desc → Binance first, Huobi second, KuCoin third
    expect(result.srs[0].address).toBe("TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH");
    expect(result.srs[0].rank).toBe(1);
    expect(result.srs[0].voteCount).toBe(4000000000);
    expect(result.srs[0].name).toMatch(/binance/i);

    expect(result.srs[1].address).toBe("TE7hnUtWRRBz3SkFrX8JESWUmEvxxAhoPt");
    expect(result.srs[1].rank).toBe(2);

    expect(result.srs[2].address).toBe("TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy");
    expect(result.srs[2].rank).toBe(3);

    expect(mockTronWeb.trx.listSuperRepresentatives).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Test 2: loadSrRegistry RPC-failure → snapshot fallback
// ============================================================================

describe("loadSrRegistry — RPC-failure fallback", () => {
  it("returns source='snapshot-fallback' when listSuperRepresentatives throws", async () => {
    const mockTronWeb = {
      trx: {
        listSuperRepresentatives: vi.fn().mockRejectedValue(new Error("TronGrid timeout")),
      },
    } as unknown as TronWeb;

    const result = await loadSrRegistry(mockTronWeb);

    expect(result.source).toBe("snapshot-fallback");
    expect(Array.isArray(result.srs)).toBe(true);
    expect(result.srs.length).toBeGreaterThan(0);
    // Snapshot entries should have all required fields
    const firstSr = result.srs[0];
    expect(typeof firstSr.address).toBe("string");
    expect(typeof firstSr.name).toBe("string");
    expect(typeof firstSr.rank).toBe("number");
    expect(typeof firstSr.voteCount).toBe("number");
    expect(typeof firstSr.url).toBe("string");
  });
});

// ============================================================================
// Test 3: Hex address normalization (RESEARCH §Topic 4 Pitfall 2)
// ============================================================================

describe("loadSrRegistry — hex address normalization", () => {
  it("converts 0x41-prefixed hex address to base58check via formatTronAddress", async () => {
    // TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH in 0x41-hex form
    const HEX_ADDRESS = "0x4178c842ee63b253f8f0d2955bbc582c661a078c9d";
    const EXPECTED_BASE58 = "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH";

    const mockWitnesses = [
      {
        address: HEX_ADDRESS,
        voteCount: 1000000,
        url: "https://www.binance.com",
        totalProduced: 100,
        totalMissed: 0,
        latestBlockNum: 1,
        latestSlotNum: 1,
        isJobs: true,
        pubKey: "abc",
      },
    ];

    const mockTronWeb = {
      trx: {
        listSuperRepresentatives: vi.fn().mockResolvedValue(mockWitnesses),
      },
    } as unknown as TronWeb;

    const result = await loadSrRegistry(mockTronWeb);

    expect(result.source).toBe("live");
    expect(result.srs).toHaveLength(1);
    // Should be base58check, not hex
    expect(result.srs[0].address).toBe(EXPECTED_BASE58);
    expect(result.srs[0].address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
  });

  it("also handles 41-prefixed (no 0x) hex address", async () => {
    const HEX_ADDRESS_NO_0X = "4178c842ee63b253f8f0d2955bbc582c661a078c9d";
    const EXPECTED_BASE58 = "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH";

    const mockWitnesses = [
      {
        address: HEX_ADDRESS_NO_0X,
        voteCount: 1000000,
        url: "https://kucoin.com",
        totalProduced: 100,
        totalMissed: 0,
        latestBlockNum: 1,
        latestSlotNum: 1,
        isJobs: true,
        pubKey: "xyz",
      },
    ];

    const mockTronWeb = {
      trx: {
        listSuperRepresentatives: vi.fn().mockResolvedValue(mockWitnesses),
      },
    } as unknown as TronWeb;

    const result = await loadSrRegistry(mockTronWeb);
    expect(result.source).toBe("live");
    expect(result.srs[0].address).toBe(EXPECTED_BASE58);
  });
});

// ============================================================================
// Test 4: _tronSrRegistry ESM spy-affordance
// ============================================================================

describe("_tronSrRegistry ESM spy-affordance", () => {
  it("exposes loadSrRegistry + lookupSr and vi.spyOn intercepts", async () => {
    const mockResult: SrRegistryResult = {
      source: "snapshot-fallback",
      srs: [
        {
          address: "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH",
          name: "Mocked SR",
          rank: 1,
          voteCount: 999,
          url: "https://mocked.sr",
        },
      ],
    };

    const mockTronWeb = {
      trx: {
        listSuperRepresentatives: vi.fn().mockRejectedValue(new Error("fail")),
      },
    } as unknown as TronWeb;

    const spy = vi
      .spyOn(_tronSrRegistry, "loadSrRegistry")
      .mockResolvedValue(mockResult);

    const result = await _tronSrRegistry.loadSrRegistry(mockTronWeb);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockResult);

    spy.mockRestore();
  });

  it("exposes lookupSr and correctly finds address in registry", () => {
    const registry: SrRegistryResult = {
      source: "live",
      srs: [
        {
          address: "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH",
          name: "Binance Staking",
          rank: 1,
          voteCount: 4000000000,
          url: "https://www.binance.com",
        },
        {
          address: "TE7hnUtWRRBz3SkFrX8JESWUmEvxxAhoPt",
          name: "Huobi",
          rank: 2,
          voteCount: 2000000000,
          url: "https://www.huobi.com",
        },
      ],
    };

    const found = _tronSrRegistry.lookupSr(registry, "TE7hnUtWRRBz3SkFrX8JESWUmEvxxAhoPt");
    expect(found).toBeDefined();
    expect(found!.name).toBe("Huobi");
    expect(found!.rank).toBe(2);

    const notFound = _tronSrRegistry.lookupSr(registry, "TUnknownAddressXXXXXXXXXXXXXXXXXX");
    expect(notFound).toBeUndefined();
  });
});

// ============================================================================
// Test 5: tron-srs.json DOA validation
// ============================================================================

describe("tron-srs.json snapshot — DOA validation + structure", () => {
  it("snapshot file loads without throwing (DOA validation passes at module load)", async () => {
    // If this import throws, the module-load DOA validation failed.
    const { loadSrRegistry: _loadFn } = await import("../src/protocols/tron-sr-registry.js");
    expect(typeof _loadFn).toBe("function");
  });

  it("snapshot has ≥27 entries (TRON elected SR count)", async () => {
    const mockTronWeb = {
      trx: {
        listSuperRepresentatives: vi.fn().mockRejectedValue(new Error("offline")),
      },
    } as unknown as TronWeb;

    const result = await loadSrRegistry(mockTronWeb);
    expect(result.source).toBe("snapshot-fallback");
    expect(result.srs.length).toBeGreaterThanOrEqual(27);
  });

  it("each snapshot entry has required fields with correct types", async () => {
    const mockTronWeb = {
      trx: {
        listSuperRepresentatives: vi.fn().mockRejectedValue(new Error("offline")),
      },
    } as unknown as TronWeb;

    const result = await loadSrRegistry(mockTronWeb);
    for (const sr of result.srs) {
      expect(typeof sr.address).toBe("string");
      expect(sr.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);  // base58check
      expect(typeof sr.name).toBe("string");
      expect(sr.name.length).toBeGreaterThan(0);
      expect(typeof sr.rank).toBe("number");
      expect(sr.rank).toBeGreaterThan(0);
      expect(typeof sr.voteCount).toBe("number");
      expect(sr.voteCount).toBeGreaterThanOrEqual(0);
      expect(typeof sr.url).toBe("string");
    }
  });
});

// ============================================================================
// lookupSr direct tests
// ============================================================================

describe("lookupSr", () => {
  const registry: SrRegistryResult = {
    source: "live",
    srs: [
      {
        address: "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH",
        name: "Binance Staking",
        rank: 1,
        voteCount: 4000000000,
        url: "https://www.binance.com",
      },
    ],
  };

  it("finds existing SR by address", () => {
    const found = lookupSr(registry, "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH");
    expect(found).toBeDefined();
    expect(found!.name).toBe("Binance Staking");
    expect(found!.rank).toBe(1);
  });

  it("returns undefined for unknown address", () => {
    const notFound = lookupSr(registry, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
    expect(notFound).toBeUndefined();
  });
});
