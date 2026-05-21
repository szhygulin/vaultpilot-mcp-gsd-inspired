// test/chains-bitcoin-xpub-scan.test.ts — Phase 22 Plan 22-03 Task 1.
//
// Gap-limit-respecting xpub scanner. Greenfield component — no direct
// analog in the codebase. Closest reference is `getSplTokenAccounts` in
// `sol-rpc-client.ts:163-199` for client-side fan-out shape.
//
// Hardcoded literal address anchors per CLAUDE.md cryptographic-binding-
// fixture convention extended to deterministic xpub→address derivations
// (PATTERNS Meta-Decision 3). The literals below originate from BIP-84
// Test Vector 1 (mnemonic = "abandon abandon ... about") and BIP-86 Test
// Vector 1 (same mnemonic). Drift in bitcoinjs-lib's derivation OR in the
// payment helpers (p2wpkh / p2tr) fails at a specific line — NOT against
// a self-snapshot.
//
// Coverage map:
//   1. BIP-32 Test Vector anchor — pinned BIP-84 zpub → 5 hardcoded
//      `bc1q…` literals at m/0/i for i=0..4 (segwit P2WPKH).
//   2. BIP-32 Test Vector anchor — pinned BIP-86 xpub → 5 hardcoded
//      `bc1p…` literals at m/0/i for i=0..4 (taproot P2TR).
//   3. Gap-limit-20 termination — 20 consecutive empties → scan stops.
//   4. Gap-limit boundary — `fetchAddressInfo` called EXACTLY 20 times.
//   5. Combined tx_count termination — chain_stats + mempool_stats == 0
//      (NOT just chain_stats — RESEARCH § Plan 22-03 risks).
//   6. Active address at i=21 — scan continues through 20-empty window.
//   7. Concurrency cap of 5 — batches of ≤5 parallel fetches.
//   8. Per-xpub TTL cache — second scan within 5min returns cached.
//   9. Cache miss after TTL — advance timer 5min+; second scan re-fetches.
//  10. `_resetXpubScanCacheForTesting` clears cache.
//  11. Aggregation — sum of confirmedBalanceSats across active addresses.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as esploraClient from "../src/chains/bitcoin/esplora-client.js";
import {
  BIP44_GAP_LIMIT,
  _resetXpubScanCacheForTesting,
  scanXpub,
} from "../src/chains/bitcoin/xpub-scan.js";

// ───────────────────────── BIP-84 / BIP-86 Test Vector pins ──────────
//
// Source mnemonic: "abandon abandon abandon abandon abandon abandon
// abandon abandon abandon abandon abandon about" (canonical BIP-39
// "all-zero seed" — referenced in BIP-84 + BIP-86 spec).

/** BIP-84 account-level zpub at `m/84'/0'/0'` — BIP-84 spec Test Vector 1. */
const PINNED_BIP84_ZPUB =
  "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

/** BIP-86 account-level xpub at `m/86'/0'/0'` — BIP-86 spec Test Vector 1. */
const PINNED_BIP86_XPUB =
  "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";

// Expected first-5 P2WPKH derivations from PINNED_BIP84_ZPUB (m/0/i, i=0..4).
// Computed via bitcoinjs-lib payments.p2wpkh after zpub→xpub version-byte swap.
const EXPECTED_SEGWIT_ADDRESSES = [
  "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", // m/0/0
  "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g", // m/0/1
  "bc1qp59yckz4ae5c4efgw2s5wfyvrz0ala7rgvuz8z", // m/0/2
  "bc1qgl5vlg0zdl7yvprgxj9fevsc6q6x5dmcyk3cn3", // m/0/3
  "bc1qm97vqzgj934vnaq9s53ynkyf9dgr05rargr04n", // m/0/4
];

// Expected first-5 P2TR derivations from PINNED_BIP86_XPUB (m/0/i, i=0..4).
// i=0 matches BIP-86 spec directly (the spec documents
// `bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr` as
// `m/86'/0'/0'/0/0`).
const EXPECTED_TAPROOT_ADDRESSES = [
  "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr", // m/0/0 (BIP-86 spec)
  "bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh", // m/0/1
  "bc1p0d0rhyynq0awa9m8cqrcr8f5nxqx3aw29w4ru5u9my3h0sfygnzs9khxz8", // m/0/2
  "bc1py0vryk8aqusz65yzuudypggvswzkcpwtau8q0sjm0stctwup0xlqkkxler", // m/0/3
  "bc1pjpp8nwqvhkx6kdna6vpujdqglvz2304twfd308ve5ppyxpmcjufs7k6xyr", // m/0/4
];

// ───────────────────────── Helpers: Esplora result shapers ───────────

function okResult(
  address: string,
  funded: bigint,
  spent: bigint,
  chainTxCount: number,
  mempoolTxCount: number = 0,
): esploraClient.EsploraAddressResult {
  return {
    kind: "ok",
    address,
    confirmedBalanceSats: funded - spent,
    unconfirmedBalanceSats: 0n,
    txCount: chainTxCount + mempoolTxCount,
  };
}

function emptyResult(address: string): esploraClient.EsploraAddressResult {
  return {
    kind: "ok",
    address,
    confirmedBalanceSats: 0n,
    unconfirmedBalanceSats: 0n,
    txCount: 0,
  };
}

beforeEach(() => {
  _resetXpubScanCacheForTesting();
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  _resetXpubScanCacheForTesting();
});

// ───────────────────────── BIP-84 anchor (hardcoded literals) ────────

describe("scanXpub — BIP-84 Test Vector 1 anchor (p2wpkh)", () => {
  it("derives the canonical first-5 `bc1q…` addresses from the BIP-84 spec zpub", async () => {
    const seen: string[] = [];
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        seen.push(addr);
        return emptyResult(addr);
      },
    );

    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");

    // First 5 fetched addresses MUST match the hardcoded literals.
    for (let i = 0; i < EXPECTED_SEGWIT_ADDRESSES.length; i++) {
      expect(seen[i]).toBe(EXPECTED_SEGWIT_ADDRESSES[i]);
    }
  });
});

// ───────────────────────── BIP-86 anchor (hardcoded literals) ────────

describe("scanXpub — BIP-86 Test Vector 1 anchor (p2tr)", () => {
  it("derives the canonical first-5 `bc1p…` addresses from the BIP-86 spec xpub", async () => {
    const seen: string[] = [];
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        seen.push(addr);
        return emptyResult(addr);
      },
    );

    await scanXpub(PINNED_BIP86_XPUB, "p2tr");

    for (let i = 0; i < EXPECTED_TAPROOT_ADDRESSES.length; i++) {
      expect(seen[i]).toBe(EXPECTED_TAPROOT_ADDRESSES[i]);
    }
  });

  it("first-derivation matches BIP-86 spec Test Vector 1 literal", async () => {
    // BIP-86 spec documents this address as m/86'/0'/0'/0/0. Locked
    // anchor — drift in bitcoinjs-lib's taproot key-tweak path would
    // fail this assertion at a specific line.
    const seen: string[] = [];
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        seen.push(addr);
        return emptyResult(addr);
      },
    );

    await scanXpub(PINNED_BIP86_XPUB, "p2tr");

    expect(seen[0]).toBe(
      "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
    );
  });
});

// ───────────────────────── Gap-limit termination (BIP-44) ────────────

describe("scanXpub — gap-limit-20 termination (BIP-44)", () => {
  it("terminates at 20 consecutive empties — `fetchAddressInfo` called EXACTLY 20 times", async () => {
    const callCount = { n: 0 };
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        callCount.n += 1;
        return emptyResult(addr);
      },
    );

    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");

    expect(callCount.n).toBe(BIP44_GAP_LIMIT);
    expect(callCount.n).toBe(20);
  });

  it("`BIP44_GAP_LIMIT` constant === 20 (BIP-44 standard)", () => {
    expect(BIP44_GAP_LIMIT).toBe(20);
  });

  it("uses COMBINED `chain_stats.tx_count + mempool_stats.tx_count` (NOT just chain_stats)", async () => {
    // Address with pending receive: chain_stats.tx_count=0 but
    // mempool_stats.tx_count=1. MUST be classified as "in use", NOT
    // counted toward gap-limit empties.
    let callIdx = 0;
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        // i=0: chain=0 + mempool=1 → in-use (NOT empty)
        // i=1..20: empty
        // i=21: still empty (scan should have stopped at i=20 since the
        //   first empty was i=1 and we need 20 in a row → stop after i=20)
        const here = callIdx;
        callIdx += 1;
        if (here === 0) {
          return okResult(addr, 0n, 0n, 0, 1); // chain=0, mempool=1
        }
        return emptyResult(addr);
      },
    );

    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");

    // 1 in-use + 20 consecutive empties = 21 total fetches.
    expect(callIdx).toBe(21);
  });

  it("does NOT stop at first empty — continues through a sub-gap-limit empty window to discover an active address at i=20 (Pitfall 4 anchor)", async () => {
    // Mock: active at i=0, empty i=1..19 (19 empties), active at i=20.
    // The naive "stop at first empty" approach misses i=20. BIP-44
    // requires 20 CONSECUTIVE empties — 19 in a row is NOT a stop.
    let callIdx = 0;
    let i20Hit = false;
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        const here = callIdx;
        callIdx += 1;
        if (here === 0 || here === 20) {
          if (here === 20) i20Hit = true;
          return okResult(addr, 100_000n, 0n, 1);
        }
        return emptyResult(addr);
      },
    );

    const out = await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");

    // i=20 fetch DOES happen (counter resets on i=0 active; 19 empties
    // in a row at i=1..19 does NOT terminate; the active at i=20
    // resets the counter again).
    expect(i20Hit).toBe(true);
    expect(out.activeAddresses.length).toBe(2);
    expect(out.activeAddresses[1]?.index).toBe(20);
  });
});

// ───────────────────────── Concurrency cap ───────────────────────────

describe("scanXpub — concurrency cap of 5 parallel fetches", () => {
  it("fires fetches in batches of <=5 — never more than 5 in-flight at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        inFlight += 1;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        // Yield to allow other concurrent fetches to start.
        await new Promise((r) => setTimeout(r, 0));
        inFlight -= 1;
        return emptyResult(addr);
      },
    );

    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");

    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1); // sanity: parallelism is happening
  });
});

// ───────────────────────── Per-xpub TTL cache ────────────────────────

describe("scanXpub — per-xpub TTL cache (5 minutes)", () => {
  it("second scan within TTL returns cached result without re-fetching", async () => {
    let callCount = 0;
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        callCount += 1;
        return emptyResult(addr);
      },
    );

    const first = await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");
    const firstCallCount = callCount;

    const second = await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");

    expect(callCount).toBe(firstCallCount); // no new fetches
    expect(second).toEqual(first); // cached value returned
  });

  it("cache miss after TTL expiry — fetches re-fire", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-21T00:00:00Z"));

    let callCount = 0;
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        callCount += 1;
        return emptyResult(addr);
      },
    );

    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");
    const firstCallCount = callCount;

    // Advance > TTL (5 min + 1 sec).
    vi.setSystemTime(new Date("2026-05-21T00:05:01Z"));

    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");

    expect(callCount).toBeGreaterThan(firstCallCount); // re-fetched
  });

  it("`_resetXpubScanCacheForTesting()` clears the cache", async () => {
    let callCount = 0;
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        callCount += 1;
        return emptyResult(addr);
      },
    );

    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");
    const firstCallCount = callCount;

    _resetXpubScanCacheForTesting();

    await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");
    expect(callCount).toBeGreaterThan(firstCallCount); // re-fetched
  });

  it("cache is keyed per (xpub, scriptType) — different scriptType re-fetches", async () => {
    let callCount = 0;
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        callCount += 1;
        return emptyResult(addr);
      },
    );

    await scanXpub(PINNED_BIP86_XPUB, "p2wpkh");
    const firstCallCount = callCount;

    await scanXpub(PINNED_BIP86_XPUB, "p2tr");

    expect(callCount).toBeGreaterThan(firstCallCount); // different cache key
  });
});

// ───────────────────────── Aggregation ───────────────────────────────

describe("scanXpub — aggregate confirmedBalanceSats", () => {
  it("sums confirmedBalanceSats across all active derived addresses", async () => {
    // i=0: 100_000 sat, i=1: 50_000 sat, i=2..21: empty (gap-limit
    // terminates after 20 empties starting at i=2; scan touches indices
    // 0..21 inclusive).
    let callIdx = 0;
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => {
        const here = callIdx;
        callIdx += 1;
        if (here === 0) return okResult(addr, 100_000n, 0n, 1);
        if (here === 1) return okResult(addr, 50_000n, 0n, 1);
        return emptyResult(addr);
      },
    );

    const out = await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");

    expect(out.totalConfirmedSats).toBe(150_000n);
    expect(out.activeAddresses.length).toBe(2);
    expect(out.activeAddresses[0]?.index).toBe(0);
    expect(out.activeAddresses[0]?.confirmedBalanceSats).toBe(100_000n);
    expect(out.activeAddresses[1]?.index).toBe(1);
    expect(out.activeAddresses[1]?.confirmedBalanceSats).toBe(50_000n);
  });

  it("returns `addressesScanned` count", async () => {
    vi.spyOn(esploraClient, "fetchAddressInfo").mockImplementation(
      async (addr: string) => emptyResult(addr),
    );

    const out = await scanXpub(PINNED_BIP84_ZPUB, "p2wpkh");
    expect(out.addressesScanned).toBe(20); // 20 consecutive empties
  });
});
