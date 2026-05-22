// test/change-index.test.ts — Phase 23 Plan 23-02 Task 2.
//
// Regression suite for:
//   - src/chains/bitcoin/change-index.ts (nextChangeIndex)
//   - src/chains/bitcoin/xpub-scan.ts (additive chain parameter — back-compat)
//
// Mock strategy: vi.spyOn(esploraClient, "fetchAddressInfo") — same pattern
// as the existing chains-bitcoin-xpub-scan.test.ts suite.
// The esplora-client uses an internal _esplora indirection object for fetch;
// intercepting at the fetchAddressInfo level is the established seam.
//
// Coverage:
//   1. chain-1 scan returns the first chain-1 index with tx_count === 0.
//   2. chain-0 and chain-1 scans of the same xpub do NOT collide in the TTL
//      cache — a chain-1 result does NOT return a cached chain-0 address.
//   3. gap-limit-20 termination still holds on chain-1.
//   4. The chain parameter defaults to 0 — existing callers unchanged (back-compat).
//
// OQ-3 caveat (documented in change-index.ts header): two rapid prepare calls
// both see the same next-unused index. Accepted residual — NOT tested here.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as esploraClient from "../src/chains/bitcoin/esplora-client.js";
import { nextChangeIndex, _changeIndex } from "../src/chains/bitcoin/change-index.js";
import {
  scanXpub,
  _resetXpubScanCacheForTesting,
  BIP44_GAP_LIMIT,
} from "../src/chains/bitcoin/xpub-scan.js";

// ─── Test Vector xpub ─────────────────────────────────────────────────────────
// BIP-84 Test Vector 1 (mnemonic: "abandon abandon ... about").
const PINNED_BIP84_ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

// BIP-86 Test Vector 1 (taproot).
const PINNED_BIP86_XPUB =
  "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";

// ─── Mock helpers (mirror chains-bitcoin-xpub-scan.test.ts pattern) ───────────

function okResult(address: string, txCount: number): esploraClient.EsploraAddressResult {
  return {
    kind: "ok",
    address,
    confirmedBalanceSats: txCount > 0 ? 10_000n : 0n,
    unconfirmedBalanceSats: 0n,
    txCount,
  };
}

function emptyResult(address: string): esploraClient.EsploraAddressResult {
  return { kind: "ok", address, confirmedBalanceSats: 0n, unconfirmedBalanceSats: 0n, txCount: 0 };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _resetXpubScanCacheForTesting();
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  _resetXpubScanCacheForTesting();
});

// ─── Test 1: chain-1 scan returns first unused index ─────────────────────────

describe("nextChangeIndex — returns first unused chain-1 index", () => {
  it("returns index 0 when the first chain-1 address is unused", async () => {
    // All fetched addresses return txCount: 0 → gap-limit immediately fires → index 0.
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(async (addr: string) =>
      emptyResult(addr),
    );

    const idx = await _changeIndex.nextChangeIndex(PINNED_BIP84_ZPUB, "p2wpkh");
    expect(idx).toBe(0);
  });

  it("skips used chain-1 addresses and returns first unused", async () => {
    // chain-1 indices 0 and 1 are used (txCount > 0); index 2 is unused.
    let callCount = 0;
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(async (addr: string) => {
      const count = callCount < 2 ? 1 : 0;
      callCount++;
      return okResult(addr, count);
    });

    const idx = await _changeIndex.nextChangeIndex(PINNED_BIP84_ZPUB, "p2wpkh");
    // Indices 0 and 1 used → next unused is 2.
    expect(idx).toBe(2);
  });
});

// ─── Test 2: chain-0 and chain-1 cache isolation ─────────────────────────────

describe("chain-0 and chain-1 cache isolation", () => {
  it("chain-0 and chain-1 scans produce independent results (no cache collision)", async () => {
    const fetchAddressInfoSpy = vi
      .spyOn(esploraClient, "fetchAddressInfo")
      .mockImplementation(async (addr: string) => emptyResult(addr));

    // First: scan chain-0 (receive chain via scanXpub with default chain param).
    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");
    const chain0CallCount = fetchAddressInfoSpy.mock.calls.length;

    // Reset call count.
    fetchAddressInfoSpy.mockClear();

    // Second: scan chain-1 (change chain via nextChangeIndex).
    // If the cache key doesn't incorporate `chain`, the second scan would
    // return the cached chain-0 result WITHOUT making new Esplora calls.
    await nextChangeIndex(PINNED_BIP84_ZPUB, "p2wpkh");
    const chain1CallCount = fetchAddressInfoSpy.mock.calls.length;

    // chain-1 scan must make its own Esplora calls (not hit chain-0 cache).
    expect(chain1CallCount).toBeGreaterThan(0);
    // chain-0 scan also made calls.
    expect(chain0CallCount).toBeGreaterThan(0);
  });
});

// ─── Test 3: gap-limit-20 termination on chain-1 ─────────────────────────────

describe("nextChangeIndex — gap-limit-20 termination", () => {
  it("terminates after 20 consecutive unused chain-1 addresses", async () => {
    const fetchAddressInfoSpy = vi
      .spyOn(esploraClient, "fetchAddressInfo")
      .mockImplementation(async (addr: string) => emptyResult(addr));

    const idx = await nextChangeIndex(PINNED_BIP84_ZPUB, "p2wpkh");

    // First unused index is 0 (all unused).
    expect(idx).toBe(0);
    // Scan must terminate after exactly BIP44_GAP_LIMIT calls (20 consecutive empty).
    expect(fetchAddressInfoSpy.mock.calls.length).toBe(BIP44_GAP_LIMIT);
  });
});

// ─── Test 4: back-compat — chain parameter defaults to 0 ─────────────────────

describe("scanXpub — back-compat: chain parameter defaults to 0", () => {
  it("scanXpub(xpub, scriptType) without chain arg behaves exactly as chain=0", async () => {
    const seen0: string[] = [];
    const seen0explicit: string[] = [];

    // First: call without chain parameter (old API).
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(async (addr: string) => {
      seen0.push(addr);
      return emptyResult(addr);
    });
    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");
    _resetXpubScanCacheForTesting();
    vi.restoreAllMocks();

    // Second: call with explicit chain=0.
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(async (addr: string) => {
      seen0explicit.push(addr);
      return emptyResult(addr);
    });
    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh", 0);

    // Both calls must derive the same receive-chain addresses.
    expect(seen0.length).toBe(seen0explicit.length);
    expect(seen0.length).toBe(BIP44_GAP_LIMIT);
    // First 5 addresses must be identical.
    for (let i = 0; i < Math.min(5, seen0.length); i++) {
      expect(seen0[i]).toBe(seen0explicit[i]);
    }
  });

  it("scanXpub with chain=1 derives different addresses from chain=0", async () => {
    const chain0Addresses: string[] = [];
    const chain1Addresses: string[] = [];

    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(async (addr: string) => {
      chain0Addresses.push(addr);
      return emptyResult(addr);
    });
    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh", 0);
    _resetXpubScanCacheForTesting();
    vi.restoreAllMocks();

    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(async (addr: string) => {
      chain1Addresses.push(addr);
      return emptyResult(addr);
    });
    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh", 1);

    // chain-0 and chain-1 addresses must differ (different derivation paths).
    expect(chain0Addresses[0]).not.toBe(chain1Addresses[0]);
  });
});

// ─── Module exports ───────────────────────────────────────────────────────────

describe("change-index module exports", () => {
  it("exports nextChangeIndex as a named export", () => {
    expect(typeof nextChangeIndex).toBe("function");
  });

  it("exports _changeIndex indirection object", () => {
    expect(typeof _changeIndex).toBe("object");
    expect(typeof _changeIndex.nextChangeIndex).toBe("function");
  });
});
