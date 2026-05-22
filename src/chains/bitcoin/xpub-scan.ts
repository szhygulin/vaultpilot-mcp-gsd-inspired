// src/chains/bitcoin/xpub-scan.ts — Phase 22 Plan 22-03 Task 1.
//
// Gap-limit-respecting xpub scanner. The only greenfield component of
// Phase 22 — RESEARCH § Don't-Hand-Roll + § Plan 22-03 #4 provide the
// algorithm; PATTERNS § Plan 22-03 says no direct in-tree analog
// (`getSplTokenAccounts` in `sol-rpc-client.ts:163-199` is the closest
// fan-out reference).
//
// Carved here under `src/chains/bitcoin/` (NOT `src/wallet/`) because it
// reads from `esplora-client.ts` and surfaces a chain-shelf shape; the
// tool layer (`get_btc_account_balance.ts`) consumes it directly.
//
// Algorithm (BIP-44 standard):
//   1. Derive child pubkeys at `m/0/i` from the account-level xpub.
//   2. Compute the address via bitcoinjs-lib `payments.p2wpkh` (segwit)
//      OR `payments.p2tr` (taproot, x-only internal pubkey).
//   3. Query Esplora `/address/{addr}` for each derived address.
//   4. Stop after 20 *consecutive* unused addresses (NOT first-unused —
//      RESEARCH § Pitfall 4: naive scan stops too early).
//   5. Aggregate confirmedBalanceSats across active addresses.
//
// Gap-limit termination invariant: an "unused" address has COMBINED
// `chain_stats.tx_count + mempool_stats.tx_count === 0` — the
// `esplora-client.ts` `fetchAddressInfo` already sums these into a
// single `txCount`. Using just `chain_stats.tx_count` would misclassify
// a freshly-derived address with a pending receive (mempool-only) as
// unused (RESEARCH § Plan 22-03 risks).
//
// Concurrency cap of 5 parallel Esplora fetches — well below
// mempool.space's 60/min free-tier rate limit; blockstream.info
// publishes no documented rate limit but anecdotally tolerates ~10
// req/s. A scan of 20 addresses thus completes in 4 batches.
//
// Per-xpub TTL cache (5 min). Keyed by `(xpub, scriptType, chain)` so
// segwit and taproot scopes from the same account xpub cache independently,
// AND chain-0 (receive) and chain-1 (change) scans do NOT collide.
// Phase 23 extended the cache key to include `chain` (D-02 change-index).
// Test seam: `_resetXpubScanCacheForTesting()` clears the cache.
//
// BIP-84 zpub support: the account-level extended key for BIP-84
// derivations is encoded as `zpub…` (mainnet) — version bytes
// `0x04B24746` instead of xpub's `0x0488B21E`. The `bip32@^5.0.1`
// `fromBase58` rejects unknown versions; we transparently swap the
// version bytes at scan entry so `zpub6r…` and the equivalent `xpub6…`
// produce the same derivation tree.
//
// CLAUDE.md compliance: NO private key material ever crosses any
// boundary. The xpub is by construction public — `BIP32Interface`
// returns only `publicKey` (privateKey is undefined for neutered xpubs).

import { BIP32Factory } from "bip32";
import bs58checkModule from "bs58check";
import { networks, payments } from "bitcoinjs-lib";
import * as tinySecp256k1 from "tiny-secp256k1";

import { fetchAddressInfo } from "./esplora-client.js";
import "./types.js"; // ensure initEccLib() fires for taproot derivations

// ESM/CJS interop shim — bs58check@4 exports a default object; under
// NodeNext ESM, the module may be reached as either the default or the
// namespace itself depending on bundler resolution.
const bs58check = (bs58checkModule as unknown as { default?: typeof bs58checkModule })
  .default ?? bs58checkModule;

const bip32 = BIP32Factory(tinySecp256k1);

/** BIP-44 standard gap-limit — 20 *consecutive* unused addresses. */
export const BIP44_GAP_LIMIT = 20;

/** Concurrency cap for parallel Esplora fetches (rate-limit defense). */
export const SCAN_CONCURRENCY = 5;

/** Per-xpub cache TTL (5 minutes). */
export const SCAN_TTL_MS = 5 * 60 * 1000;

/** xpub mainnet version bytes (0x0488B21E). */
const XPUB_VERSION_BYTES = new Uint8Array([0x04, 0x88, 0xb2, 0x1e]);

export interface ScanXpubResult {
  readonly totalConfirmedSats: bigint;
  readonly addressesScanned: number;
  readonly activeAddresses: ReadonlyArray<{
    readonly index: number;
    readonly address: string;
    readonly confirmedBalanceSats: bigint;
  }>;
}

interface CacheEntry {
  result: ScanXpubResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Normalize a `zpub…` extended public key to its equivalent `xpub…` by
 * swapping the 4 version bytes. Pure base58check operation — the
 * derivation tree is identical, only the encoding format differs.
 *
 * `bip32@^5.0.1`'s `fromBase58` accepts only the canonical xpub mainnet
 * version (`0x0488B21E`). BIP-84's `zpub…` (`0x04B24746`) and BIP-49's
 * `ypub…` (`0x049D7CB2`) are valid bs58check-encoded extended public
 * keys with different version prefixes but identical 78-byte payloads
 * (the version bytes are metadata; the chain code + public key are the
 * same).
 *
 * If the input already starts with `xpub`, return it unchanged.
 */
function normalizeToXpub(extended: string): string {
  if (extended.startsWith("xpub")) return extended;
  const decoded = bs58check.decode(extended);
  // bs58check decode returns a Uint8Array (or Buffer in some envs); the
  // first 4 bytes are the version. Copy into a fresh Uint8Array so we
  // never mutate the source.
  const bytes = new Uint8Array(decoded.length);
  bytes.set(decoded);
  bytes.set(XPUB_VERSION_BYTES, 0);
  return bs58check.encode(bytes);
}

/**
 * Derive the `i`-th child address from the given chain of the account-level
 * extended public key, formatted as the requested script type.
 *
 * - `chain = 0`: receive chain (BIP-44 external chain, the pre-Phase-23 default)
 * - `chain = 1`: change chain (BIP-44 internal chain — added Phase 23 D-02)
 * - `p2wpkh` (BIP-84 segwit): `bc1q…` — full compressed pubkey input.
 * - `p2tr` (BIP-86 taproot): `bc1p…` — x-only internal pubkey (drop
 *   the first byte of the 33-byte compressed pubkey per BIP-340).
 */
function deriveAddress(
  xpub: string,
  index: number,
  scriptType: "p2wpkh" | "p2tr",
  chain: 0 | 1 = 0,
): string {
  const node = bip32.fromBase58(xpub);
  const child = node.derive(chain).derive(index);
  const pubkey = child.publicKey;
  if (scriptType === "p2wpkh") {
    const { address } = payments.p2wpkh({ pubkey, network: networks.bitcoin });
    if (!address) {
      throw new Error(`xpub-scan: p2wpkh derived no address at m/${chain}/${index}`);
    }
    return address;
  }
  // p2tr — x-only internal pubkey is bytes [1..33] of the compressed
  // pubkey (drop the 0x02/0x03 prefix per BIP-340).
  const internalPubkey = pubkey.slice(1, 33);
  const { address } = payments.p2tr({
    internalPubkey,
    network: networks.bitcoin,
  });
  if (!address) {
    throw new Error(`xpub-scan: p2tr derived no address at m/${chain}/${index}`);
  }
  return address;
}

/**
 * Scan an account-level xpub (BIP-84 zpub or BIP-86 xpub) for funded
 * derived addresses. Stops when 20 *consecutive* derived addresses are
 * unused (BIP-44 gap-limit). Returns aggregate confirmed balance +
 * per-address breakdown for active addresses.
 *
 * Caches the result per `(xpub, scriptType, chain)` for 5 minutes; the
 * second scan within the TTL window returns the cached result without
 * touching Esplora. The cache key incorporates `chain` so receive-chain
 * (chain 0) and change-chain (chain 1) scans do NOT collide.
 *
 * `chain` defaults to `0` (receive chain) for full back-compatibility with
 * all Phase 22 callers. Pass `chain: 1` to scan the change chain (D-02).
 *
 * NEVER throws on Esplora rate-limit / error responses — the caller
 * sees an aggregate that reflects only the addresses that returned
 * successfully. (The 5-arm union `{ kind: "ok"|"not-found"|... }` from
 * `fetchAddressInfo` collapses to "treat non-ok as empty"; an upstream
 * outage thus produces a zero-balance scan rather than throwing.) The
 * `get_btc_account_balance` tool wraps `bip32.fromBase58` in try/catch
 * at the tool boundary — invalid xpubs surface as INVALID_XPUB
 * envelopes (Task 2).
 */
export async function scanXpub(
  xpub: string,
  scriptType: "p2wpkh" | "p2tr",
  chain: 0 | 1 = 0,
): Promise<ScanXpubResult> {
  const cacheKey = `${xpub}::${scriptType}::${chain}`;
  const now = Date.now();

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.result;
  }

  const normalizedXpub = normalizeToXpub(xpub);

  let totalConfirmedSats = 0n;
  const activeAddresses: Array<{
    index: number;
    address: string;
    confirmedBalanceSats: bigint;
  }> = [];

  let consecutiveEmpty = 0;
  let nextIndex = 0;
  let addressesScanned = 0;
  // Anti-pattern defense (RESEARCH § Pitfall 4): the scan MUST observe
  // 20 consecutive empty addresses in a row before terminating — NOT
  // stop at the first unused address. `consecutiveEmpty` resets to 0
  // every time an in-use address is encountered.
  outer: while (consecutiveEmpty < BIP44_GAP_LIMIT) {
    // Build a batch of up to SCAN_CONCURRENCY=5 indices.
    const batchSize = Math.min(
      SCAN_CONCURRENCY,
      BIP44_GAP_LIMIT - consecutiveEmpty,
    );
    const batchIndices: number[] = [];
    const batchAddresses: string[] = [];
    for (let k = 0; k < batchSize; k++) {
      const idx = nextIndex + k;
      batchIndices.push(idx);
      batchAddresses.push(deriveAddress(normalizedXpub, idx, scriptType, chain));
    }
    nextIndex += batchSize;

    // Fire the batch in parallel.
    const responses = await Promise.all(
      batchAddresses.map((addr) => fetchAddressInfo(addr)),
    );

    // Process responses IN ORDER so consecutive-empty math stays
    // monotonically index-aligned. A batch member that comes back as
    // in-use resets the streak; a member that comes back empty
    // increments it. If the streak hits BIP44_GAP_LIMIT mid-batch, the
    // remaining batch members are still counted (they were already
    // fetched) but we terminate without firing another batch.
    for (let k = 0; k < responses.length; k++) {
      const idx = batchIndices[k];
      const addr = batchAddresses[k];
      const resp = responses[k];
      addressesScanned += 1;

      // Treat non-ok arms as "unable to fetch" → count as empty (we'd
      // rather conservatively stop the scan than loop on a flapping
      // endpoint). `kind: "not-found"` is genuinely empty.
      // `resp.kind === "ok"` is the only arm that exposes txCount +
      // confirmedBalanceSats; all others (`not-found`, `rate-limited`,
      // `error`, `not-applicable`) and `undefined` collapse to empty.
      if (
        resp !== undefined &&
        resp.kind === "ok" &&
        resp.txCount > 0 &&
        idx !== undefined &&
        addr !== undefined
      ) {
        consecutiveEmpty = 0;
        const balance = resp.confirmedBalanceSats;
        totalConfirmedSats += balance;
        activeAddresses.push({
          index: idx,
          address: addr,
          confirmedBalanceSats: balance,
        });
      } else {
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= BIP44_GAP_LIMIT) {
          break outer;
        }
      }
    }
  }

  const result: ScanXpubResult = {
    totalConfirmedSats,
    addressesScanned,
    activeAddresses,
  };

  cache.set(cacheKey, { result, expiresAt: now + SCAN_TTL_MS });
  return result;
}

/**
 * Test-only — clears the per-xpub cache. Mirror of
 * `_resetEsploraCacheForTesting` shape from `esplora-client.ts`.
 */
export function _resetXpubScanCacheForTesting(): void {
  cache.clear();
}
