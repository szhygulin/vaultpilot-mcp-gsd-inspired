// src/chains/bitcoin/change-index.ts — Phase 23 Plan 23-02 Task 2.
//
// Change-chain (m/.../1/k) next-unused-index tracking. Thin wrapper over
// the Phase 22 xpub gap-limit scanner (xpub-scan.ts), extended for chain 1.
//
// Design decision D-02 (RESEARCH Pattern 4): change goes to a fresh
// derived change-chain address — next unused on m/84'/0'/0'/1/k (segwit)
// or m/86'/0'/0'/1/k (taproot). The same gap-limit scan that covers chain 0
// (receive) now also covers chain 1 (change) via the additive `chain: 1`
// parameter introduced on `scanXpub` in Phase 23. Chosen over option (b)
// (persisted per-account change index) because an on-chain scan is
// self-correcting — if the user signs a change-creating tx outside
// VaultPilot, the cached index is automatically refreshed on the next scan.
//
// OQ-3 accepted residual (RESEARCH Pattern 4 caveat): two rapid
// `prepare_btc_send` calls both see the same next-unused change index
// because there is no on-chain confirmation between them. This is acceptable
// for Phase 23 (the user signs one tx at a time; an unused-but-derived
// change address is harmless — it just gets skipped on the next scan). A
// reservation system is deliberately NOT built here: it would reintroduce
// a mutable-state surface that can desync from on-chain reality.
//
// ESM spy-affordance per CLAUDE.md: export _changeIndex for vi.spyOn().

import { scanXpub } from "./xpub-scan.js";

/**
 * Find the next unused index on the change chain (chain 1) of the given
 * account-level xpub.
 *
 * "Next unused" is defined as: the first chain-1 index whose combined
 * `chain_stats.tx_count + mempool_stats.tx_count === 0` — exactly the
 * gap-limit scan's existing termination signal. This is the index where
 * the next fresh change address should be derived.
 *
 * The scan respects the BIP-44 gap-limit of 20 consecutive unused addresses
 * and the 5-minute TTL cache (keyed by `(xpub, scriptType, chain=1)`).
 *
 * @param xpub  Account-level extended public key (xpub or zpub).
 * @param scriptType  Script type of the change address ("p2wpkh" | "p2tr").
 * @returns The index of the next unused chain-1 address (0-based).
 */
export async function nextChangeIndex(
  xpub: string,
  scriptType: "p2wpkh" | "p2tr",
): Promise<number> {
  const result = await scanXpub(xpub, scriptType, 1);
  // The gap-limit scan's `activeAddresses` contains all indices that had
  // tx_count > 0. The first unused index is one past the last active one
  // (or 0 if there are no active addresses). We derive this by finding the
  // highest active index and adding 1. If no active addresses, return 0.
  //
  // NOTE: This is NOT just `activeAddresses.length` — addresses can have
  // gaps in index space (e.g. indices 0, 1, 5 active → next unused is 6,
  // not 3). We must use max(activeIndex) + 1.
  if (result.activeAddresses.length === 0) {
    return 0;
  }
  const maxIndex = result.activeAddresses.reduce(
    (max, entry) => (entry.index > max ? entry.index : max),
    -1,
  );
  return maxIndex + 1;
}

// ─── ESM spy-affordance (CLAUDE.md) ──────────────────────────────────────────

/** Indirection object for vi.spyOn across ESM module boundaries. */
export const _changeIndex = { nextChangeIndex };
