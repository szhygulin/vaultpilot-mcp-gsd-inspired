// src/tokens/solana-top-50.ts — Phase 11 Plan 11-05.
//
// Typed loader for the curated top-volume SPL token registry. Mirrors the
// shape of the per-chain EVM registries (`src/tokens/{ethereum,arbitrum,
// polygon,base,optimism}-top-50.json`) but with the Solana shape:
//
//   { mint, symbol, decimals, displayName }
//
// DOA validation: every `mint` is run through `new PublicKey(mint)` at
// module load. A single base58-broken or 33-byte mint throws at import
// time — the corrupted-snapshot guard fires before any caller sees a bad
// address. Mirrors the `getAddress(...)` re-checksum discipline in
// `src/tokens/registry.ts`.
//
// Curation SOT (planner-time): Jupiter strict token list
// (https://token.jup.ag/strict) + Solana token registry. Re-rank by volume
// is deferred to a v2.0.x maintenance phase per CONTEXT.md `<decisions>`.

import { PublicKey } from "@solana/web3.js";

import raw from "./solana-top-50.json" with { type: "json" };

export interface SolanaTokenRegistryEntry {
  /** Base58-encoded SPL mint pubkey. */
  mint: string;
  /** Display symbol (uppercase by convention, but the JSON value wins). */
  symbol: string;
  /** Mint decimals — load-bearing for amount math. */
  decimals: number;
  /** Human-readable display name. */
  displayName: string;
}

/**
 * DOA validation at module load: a single malformed base58 mint throws
 * here via `new PublicKey(mint)` — the corrupted-snapshot guard fires at
 * import time, not at first lookup. Mirrors the `getAddress(...)`
 * re-checksum discipline in `src/tokens/registry.ts`.
 *
 * No `decimals` sanity check beyond "is a number" — the JSON shape is
 * planner-curated and re-validated whenever the file changes.
 */
function validateEntry(e: unknown): SolanaTokenRegistryEntry {
  if (e === null || typeof e !== "object") {
    throw new Error(`solana-top-50: invalid entry shape: ${JSON.stringify(e)}`);
  }
  const r = e as Record<string, unknown>;
  if (typeof r.mint !== "string") {
    throw new Error(`solana-top-50: entry missing string \`mint\`: ${JSON.stringify(e)}`);
  }
  if (typeof r.symbol !== "string") {
    throw new Error(`solana-top-50: entry missing string \`symbol\`: ${JSON.stringify(e)}`);
  }
  if (typeof r.decimals !== "number" || !Number.isInteger(r.decimals) || r.decimals < 0) {
    throw new Error(`solana-top-50: entry has invalid \`decimals\`: ${JSON.stringify(e)}`);
  }
  if (typeof r.displayName !== "string") {
    throw new Error(`solana-top-50: entry missing string \`displayName\`: ${JSON.stringify(e)}`);
  }
  // DOA base58: throws on malformed pubkey at MODULE LOAD.
  new PublicKey(r.mint);
  return {
    mint: r.mint,
    symbol: r.symbol,
    decimals: r.decimals,
    displayName: r.displayName,
  };
}

const validated: readonly SolanaTokenRegistryEntry[] = (raw as unknown[]).map(validateEntry);

// O(1) lookup by mint. Built once at module load.
const byMint = new Map<string, SolanaTokenRegistryEntry>(
  validated.map((e) => [e.mint, e]),
);

/**
 * Look up a curated SPL entry by base58 mint. Returns `undefined` for any
 * mint outside the top-50 registry — consumers (Plan 11-05 read tools)
 * fall back to the on-demand `getMintDecimals` path for unknown mints and
 * surface `symbolUnknown: true` to the agent.
 */
export function findByMint(mint: string): SolanaTokenRegistryEntry | undefined {
  return byMint.get(mint);
}

/**
 * List every curated SPL entry. Read-only — consumers MUST NOT mutate the
 * returned array (it's the same reference as the validated module-level
 * cache).
 */
export function listSolanaTokens(): readonly SolanaTokenRegistryEntry[] {
  return validated;
}
