import { getAddress, type Address } from "viem";

import { log } from "../diagnostics/logger.js";

/**
 * Per-row price quote returned by {@link getPrices}.
 *
 * `priceUnknown: true` means DefiLlama returned no price for the address. The
 * row is intentionally surfaced (not silently dropped, not zeroed) — zero
 * implies "no value", which is the wrong claim for a token whose price the
 * pricing source happens not to track. Aggregators must contribute 0 to USD
 * totals for these rows but list them in the response.
 *
 * `priceUsd` is a finite, non-negative number when present. Callers multiply
 * by the formatted decimal balance to get per-row USD; rounding is the
 * caller's concern (USD is a presentation field, not a math invariant).
 */
export interface PriceQuote {
  priceUsd?: number;
  priceUnknown?: true;
}

const DEFILLAMA_BASE_URL = "https://coins.llama.fi";
const CACHE_TTL_MS = 60_000; // 60-second in-memory cache per phase decision.
const CHAIN = "ethereum"; // v1.x is Ethereum-only; widening this is a Phase 8 concern.

interface CacheEntry {
  quote: PriceQuote;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Batch-fetches USD prices for a set of Ethereum mainnet addresses from
 * DefiLlama's `/prices/current/{coins}` endpoint.
 *
 * Behaviour:
 * - Addresses are normalised via `getAddress` (checksum) for cache keys; the
 *   wire format uses lowercase per DefiLlama convention.
 * - Cache entries live for 60 seconds; rapid-fire portfolio reads hit the
 *   in-process Map without touching the network.
 * - Addresses missing from the response carry `priceUnknown: true` (NOT zero
 *   and NOT absent from the result Map). Cached the same way — DefiLlama's
 *   price set is stable enough that a missing entry today is missing in 60s.
 * - On HTTP failure, every requested address is cached as `priceUnknown` for
 *   the TTL window; the failure is logged at warn level. This keeps an outage
 *   from cascading into per-call latency spikes.
 *
 * No new dependency: uses the global `fetch` from Node 18+.
 */
export async function getPrices(
  addresses: readonly Address[],
): Promise<Map<Address, PriceQuote>> {
  const result = new Map<Address, PriceQuote>();
  if (addresses.length === 0) return result;

  // Deduplicate by checksum and split cache hits vs misses.
  const now = Date.now();
  const toFetch: Address[] = [];
  const seen = new Set<string>();
  const checksummed: Address[] = [];

  for (const raw of addresses) {
    let addr: Address;
    try {
      addr = getAddress(raw);
    } catch {
      // Malformed address — surface as priceUnknown rather than throw; the
      // caller's wallet/token list shouldn't kill the whole portfolio fetch.
      result.set(raw, { priceUnknown: true });
      continue;
    }
    if (seen.has(addr)) continue;
    seen.add(addr);
    checksummed.push(addr);

    const cached = cache.get(cacheKey(addr));
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      result.set(addr, cached.quote);
    } else {
      toFetch.push(addr);
    }
  }

  if (toFetch.length === 0) {
    // Backfill the result for any duplicate input addresses that resolved
    // to the same checksum as an earlier entry (already populated above).
    return result;
  }

  // DefiLlama wants `chain:address` joined by commas, lowercase address.
  const coins = toFetch.map((addr) => `${CHAIN}:${addr.toLowerCase()}`).join(",");
  const url = `${DEFILLAMA_BASE_URL}/prices/current/${coins}`;

  let payload: DefiLlamaResponse | undefined;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    payload = (await response.json()) as DefiLlamaResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log("warn", `defillama: price fetch failed (${message}); ${toFetch.length} addresses marked priceUnknown for ${CACHE_TTL_MS / 1000}s`);
    // Cache the failure so we don't hammer DefiLlama on a sustained outage.
    for (const addr of toFetch) {
      const quote: PriceQuote = { priceUnknown: true };
      cache.set(cacheKey(addr), { quote, fetchedAt: now });
      result.set(addr, quote);
    }
    return result;
  }

  const coinsMap = (payload.coins ?? {}) as Record<string, { price?: unknown }>;
  for (const addr of toFetch) {
    const wireKey = `${CHAIN}:${addr.toLowerCase()}`;
    const entry = coinsMap[wireKey];
    let quote: PriceQuote;
    const price = entry?.price;
    if (typeof price === "number" && Number.isFinite(price) && price >= 0) {
      quote = { priceUsd: price };
    } else {
      quote = { priceUnknown: true };
    }
    cache.set(cacheKey(addr), { quote, fetchedAt: now });
    result.set(addr, quote);
  }

  // Defensive: ensure every requested address has an entry, even if the
  // DefiLlama response shape drifted (extra rows / missing rows).
  for (const addr of checksummed) {
    if (!result.has(addr)) {
      result.set(addr, { priceUnknown: true });
    }
  }

  return result;
}

/** Test-only: clears the in-memory price cache so the next call refetches. */
export function _resetPriceCacheForTesting(): void {
  cache.clear();
}

interface DefiLlamaResponse {
  coins?: Record<string, { price?: unknown; symbol?: string; decimals?: number; timestamp?: number; confidence?: number }>;
}

function cacheKey(address: Address): string {
  return `${CHAIN}:${address}`;
}
