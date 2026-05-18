import { getAddress, type Address } from "viem";

import type { ChainName } from "../config/contracts.js";
import { log } from "../diagnostics/logger.js";

/**
 * Phase 8 — Plan 08-02. Per-chain coin reference for {@link getPrices}.
 * DefiLlama keys URLs by `coins=<chain>:<address>,<chain>:<address>` —
 * passing this shape directly preserves the API contract without forcing
 * downstream cross-chain consumers (Plan 08-03 cross-chain
 * `get_portfolio_summary`) to coalesce by chain client-side.
 *
 * Existing single-chain callers continue to pass `Address[]` via the
 * back-compat overload; the implementation maps both shapes to the same
 * internal per-coin pipeline.
 */
export interface PriceCoin {
  chain: ChainName;
  address: Address;
}

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
const DEFAULT_CHAIN: ChainName = "ethereum"; // legacy `Address[]` overload assumes ethereum

interface CacheEntry {
  quote: PriceQuote;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Type-guard for the Phase 8 per-chain `PriceCoin[]` overload — both shapes
 * fall into the same internal pipeline below.
 */
function isPriceCoinArray(
  input: readonly Address[] | readonly PriceCoin[],
): input is readonly PriceCoin[] {
  return input.length > 0 && typeof (input[0] as PriceCoin)?.chain === "string";
}

/**
 * Batch-fetches USD prices from DefiLlama's `/prices/current/{coins}`
 * endpoint. Two-shape input contract:
 *
 *   - `getPrices(addresses: Address[])` — legacy single-chain shape; coins
 *     default to `ethereum:{address}`. Phase 4-7 callers continue to use this.
 *   - `getPrices(coins: PriceCoin[])` — Phase 8 per-chain shape;
 *     `ethereum:{address}`, `polygon:{address}`, etc. interleaved. Plan 08-03's
 *     cross-chain `get_portfolio_summary` consumes this.
 *
 * The result Map keys by checksummed address regardless of input shape — for
 * the per-chain overload, two different chains' rows for the same token
 * address collapse to one entry (DefiLlama's price set is per-token, not per-
 * chain at the contract level; bridged variants live at distinct addresses).
 *
 * Cache keys are CAIP-2-prefixed (`<chain>:<address>`) so the same address on
 * different chains caches independently. Cache entries live for 60 seconds;
 * rapid-fire portfolio reads hit the in-process Map without touching the
 * network. On HTTP failure, every requested coin is cached as `priceUnknown`
 * for the TTL window; the failure is logged at warn level. This keeps an
 * outage from cascading into per-call latency spikes.
 *
 * No new dependency: uses the global `fetch` from Node 18+.
 */
export async function getPrices(
  input: readonly Address[] | readonly PriceCoin[],
): Promise<Map<Address, PriceQuote>> {
  const result = new Map<Address, PriceQuote>();
  if (input.length === 0) return result;

  // Normalize to PriceCoin[] internally — both shapes flow through one path.
  const coinsInput: PriceCoin[] = isPriceCoinArray(input)
    ? input.map((c) => ({ chain: c.chain, address: c.address }))
    : input.map((address) => ({ chain: DEFAULT_CHAIN, address }));

  // Deduplicate by `(chain, checksum)` and split cache hits vs misses.
  const now = Date.now();
  const toFetch: PriceCoin[] = [];
  const seen = new Set<string>();
  const checksummed: PriceCoin[] = [];

  for (const raw of coinsInput) {
    let addr: Address;
    try {
      addr = getAddress(raw.address);
    } catch {
      // Malformed address — surface as priceUnknown rather than throw; the
      // caller's wallet/token list shouldn't kill the whole portfolio fetch.
      result.set(raw.address, { priceUnknown: true });
      continue;
    }
    const key = `${raw.chain}:${addr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const coin: PriceCoin = { chain: raw.chain, address: addr };
    checksummed.push(coin);

    const cached = cache.get(key);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      result.set(addr, cached.quote);
    } else {
      toFetch.push(coin);
    }
  }

  if (toFetch.length === 0) {
    // Backfill the result for any duplicate input addresses that resolved
    // to the same checksum as an earlier entry (already populated above).
    return result;
  }

  // DefiLlama wants `chain:address` joined by commas, lowercase address.
  const coins = toFetch
    .map((c) => `${c.chain}:${c.address.toLowerCase()}`)
    .join(",");
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
    for (const coin of toFetch) {
      const quote: PriceQuote = { priceUnknown: true };
      cache.set(cacheKey(coin), { quote, fetchedAt: now });
      result.set(coin.address, quote);
    }
    return result;
  }

  const coinsMap = (payload.coins ?? {}) as Record<string, { price?: unknown }>;
  for (const coin of toFetch) {
    const wireKey = `${coin.chain}:${coin.address.toLowerCase()}`;
    const entry = coinsMap[wireKey];
    let quote: PriceQuote;
    const price = entry?.price;
    if (typeof price === "number" && Number.isFinite(price) && price >= 0) {
      quote = { priceUsd: price };
    } else {
      quote = { priceUnknown: true };
    }
    cache.set(cacheKey(coin), { quote, fetchedAt: now });
    result.set(coin.address, quote);
  }

  // Defensive: ensure every requested address has an entry, even if the
  // DefiLlama response shape drifted (extra rows / missing rows).
  for (const coin of checksummed) {
    if (!result.has(coin.address)) {
      result.set(coin.address, { priceUnknown: true });
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

function cacheKey(coin: PriceCoin): string {
  return `${coin.chain}:${coin.address}`;
}
