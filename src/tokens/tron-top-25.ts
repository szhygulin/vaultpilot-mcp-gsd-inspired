// src/tokens/tron-top-25.ts — Phase 17 Plan 17-01 (loader scaffold +
// empty JSON stub). Plan 17-04 lands the curated 20-25 entries by
// replacing `tron-top-25.json` — the loader code in this file stays
// unchanged across that drop.
//
// Mirror of `src/tokens/solana-top-50.ts` byte-by-byte except:
//   - `mint` → `contractAddress` (TRC-20 uses contract addresses, not
//     ed25519 mints).
//   - `new PublicKey(r.mint)` → `TronWeb.utils.address.isAddress(r.contractAddress)`
//     gate (research Pitfall 4 — full base58check + checksum validation).
//   - Per-entry `decimals` is REQUIRED (no implicit fallback) — research
//     Pitfall 5 REGRESSION ANCHOR for Plan 17-04: TRC-20 decimals are
//     NOT a 6-decimal cluster default. USDT/USDC = 6; USDD = 18.
//     Defaulting to 6 silently corrupts USDD balances by 1e12.
//
// Why Wave 1 (this plan) ships the loader against an empty `[]` JSON
// (plan-check FLAG 4 fix Option A): Plan 17-03 (Wave 3) imports
// `findByAddress` from this module. Without the loader present in
// Wave 1, Plan 17-03's commit would not green `npm run build` until
// Plan 17-04 (Wave 4) lands the file. Mirror of Phase 11 11-01's
// `non-evm-account-store.ts` foundational-SOT-for-downstream-tool-
// registrations pattern. With zero entries the `.map` over `[]` is a
// no-op and the validator runs against nothing — sound stub-+-loader
// contract proven by `test/tron-top-25-stub.test.ts`.

import { utils as tronUtils } from "tronweb";

import raw from "./tron-top-25.json" with { type: "json" };

export interface TronTokenRegistryEntry {
  /** Base58check TRC-20 contract address (T-prefixed, 34 chars). */
  contractAddress: string;
  /** Display symbol (uppercase by convention, but the JSON value wins). */
  symbol: string;
  /**
   * Token decimals — load-bearing for amount math. REQUIRED on every
   * entry; no implicit fallback. Research Pitfall 5 REGRESSION ANCHOR
   * — USDT/USDC=6 but USDD=18; defaulting to 6 silently corrupts USDD
   * balances by 1e12.
   */
  decimals: number;
  /** Human-readable display name. */
  displayName: string;
}

/**
 * DOA validation at module load: a single malformed base58check
 * contract address throws here via `TronWeb.utils.address.isAddress`
 * — the corrupted-snapshot guard fires at import time, not at first
 * lookup. Mirror of `validateEntry` at
 * `src/tokens/solana-top-50.ts:43-68`.
 *
 * `decimals` integrity check rejects defaults: must be present, an
 * integer, and >= 0. The `r.decimals === undefined` arm is explicit —
 * Plan 17-04's filled-registry entries that omit `decimals` fail
 * loudly here rather than silently defaulting to 6.
 */
export function validateEntry(e: unknown): TronTokenRegistryEntry {
  if (e === null || typeof e !== "object") {
    throw new Error(`tron-top-25: invalid entry shape: ${JSON.stringify(e)}`);
  }
  const r = e as Record<string, unknown>;
  if (typeof r.contractAddress !== "string") {
    throw new Error(
      `tron-top-25: entry missing string \`contractAddress\`: ${JSON.stringify(e)}`,
    );
  }
  if (typeof r.symbol !== "string" || r.symbol.length === 0) {
    throw new Error(
      `tron-top-25: entry missing non-empty string \`symbol\`: ${JSON.stringify(e)}`,
    );
  }
  if (r.decimals === undefined) {
    throw new Error(
      `tron-top-25: entry missing required \`decimals\` field (NO implicit fallback — TRC-20 decimals are per-entry): ${JSON.stringify(e)}`,
    );
  }
  if (
    typeof r.decimals !== "number" ||
    !Number.isInteger(r.decimals) ||
    r.decimals < 0
  ) {
    throw new Error(
      `tron-top-25: entry has invalid \`decimals\` (must be non-negative integer): ${JSON.stringify(e)}`,
    );
  }
  if (typeof r.displayName !== "string" || r.displayName.length === 0) {
    throw new Error(
      `tron-top-25: entry missing non-empty string \`displayName\`: ${JSON.stringify(e)}`,
    );
  }
  // DOA base58check + checksum + 0x41-prefix validation: throws on
  // malformed contract address at MODULE LOAD.
  if (!tronUtils.address.isAddress(r.contractAddress)) {
    throw new Error(
      `tron-top-25: invalid base58check TRC-20 contract address: "${r.contractAddress}"`,
    );
  }
  return {
    contractAddress: r.contractAddress,
    symbol: r.symbol,
    decimals: r.decimals,
    displayName: r.displayName,
  };
}

const VALIDATED: readonly TronTokenRegistryEntry[] = (raw as unknown[]).map(
  (r, i) => {
    try {
      return validateEntry(r);
    } catch (e) {
      throw new Error(
        `tron-top-25.json entry ${i} invalid: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  },
);

// O(1) lookup by contract address. Built once at module load.
const byContract = new Map<string, TronTokenRegistryEntry>(
  VALIDATED.map((e) => [e.contractAddress, e]),
);

/**
 * Look up a curated TRC-20 entry by base58check contract address.
 * Returns `undefined` for any address outside the top-25 registry —
 * consumers (Plan 17-03's `get_tron_token_balance`) fall back to the
 * on-demand `decimals()` ABI call for unknown contracts and surface
 * `symbolUnknown: true` to the agent.
 *
 * Against the empty `[]` stub shipped in 17-01, returns `undefined`
 * for every input. Plan 17-04's filled registry restores positive
 * lookup behavior.
 */
export function findByAddress(
  contractAddress: string,
): TronTokenRegistryEntry | undefined {
  return byContract.get(contractAddress);
}

/**
 * List every curated TRC-20 entry. Read-only — consumers MUST NOT
 * mutate the returned array (it's the same reference as the validated
 * module-level cache). Returns `[]` against the empty `17-01` stub;
 * returns the curated 20-25 entries once Plan 17-04 lands them.
 */
export function listTronTokens(): readonly TronTokenRegistryEntry[] {
  return VALIDATED;
}
