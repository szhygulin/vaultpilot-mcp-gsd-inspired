// TRON Super-Representative registry hybrid loader. Phase 19 — Plan 19-03.
//
// D-05 hybrid policy (LOCKED):
//   Primary:  `tronWeb.trx.listSuperRepresentatives()` live fetch.
//   Fallback: bundled `src/tokens/tron-srs.json` snapshot on RPC failure.
//
// The `srSource: "live" | "snapshot-fallback"` is ALWAYS surfaced in the CHECKS
// PERFORMED block so the user knows whether labels came from live data or fallback.
//
// Labels are ADVISORY per D-05c:
//   - Known SR (in registry):  `(SR: <name> — vote rank <N>)` at tool layer.
//   - Unknown SR:              `(unverified SR — confirm address)`.
// The on-device `vote_address` (base58check) is the trust anchor for user approval.
//
// SURPRISE #5 (PATTERNS.md): `listSuperRepresentatives()` may return `address`
// as 0x41-prefixed hex (TRON internal representation). The loader ALWAYS applies
// `formatTronAddress` defensively to normalize to base58check before storing.
// The snapshot file uses base58 T-prefixed addresses — normalization is consistent.
//
// ESM spy-affordance per CLAUDE.md convention. `_tronSrRegistry` indirection is
// the test seam: `vi.spyOn(_tronSrRegistry, "loadSrRegistry")` intercepts.
//
// Snapshot curation discipline (D-05b):
//   - `src/tokens/tron-srs.json` contains top-30 SRs by voteCount at snapshot time.
//   - Snapshot timestamp: 2026-05-20 (Plan 19-03 execute time).
//   - Name field: heuristically derived from `url` domain (e.g. "https://www.binance.com" → "Binance").
//     Known SRs: "Binance Staking", "Huobi", "KuCoin" (exact names for top 3).
//     SR-4..SR-30: placeholder names — live fetch provides better labels.
//   - Refresh at each TRON-touching phase release via live `listSuperRepresentatives()`.
//   - DOA validation at module load catches malformed entries before any lookup.

import { utils as tronUtils } from "tronweb";
import type { TronWeb } from "tronweb";

import { formatTronAddress } from "../chains/tron/address.js";
import snapshotRaw from "../tokens/tron-srs.json" with { type: "json" };

// ============================================================================
// Types
// ============================================================================

/**
 * Per-SR entry in the registry. Fields match `tron-srs.json` schema.
 * `address` is always base58check (T-prefixed, 34 chars) regardless of source.
 */
export interface SrRegistryEntry {
  /** SR base58check address (T-prefixed, 34 chars). */
  address: string;
  /** Human-readable name — advisory only. */
  name: string;
  /** Vote rank (1 = highest voteCount). */
  rank: number;
  /** SR vote count (from `listSuperRepresentatives()` or snapshot). */
  voteCount: number;
  /** SR website URL. */
  url: string;
}

/**
 * Result returned by `loadSrRegistry`. `source` reveals whether the labels
 * came from a live fetch or the bundled snapshot — always surfaced in output
 * per D-05b.
 */
export interface SrRegistryResult {
  source: "live" | "snapshot-fallback";
  srs: SrRegistryEntry[];
}

// ============================================================================
// DOA validation — runs at module load
// ============================================================================

/**
 * Validate a single snapshot entry. Throws if malformed.
 * Mirrors `validateEntry` in `src/tokens/tron-top-25.ts`.
 */
function validateSnapshotEntry(e: unknown): SrRegistryEntry {
  if (e === null || typeof e !== "object") {
    throw new Error(`tron-srs: invalid entry shape: ${JSON.stringify(e)}`);
  }
  const r = e as Record<string, unknown>;

  if (typeof r.address !== "string" || r.address.length === 0) {
    throw new Error(`tron-srs: entry missing string \`address\`: ${JSON.stringify(e)}`);
  }
  if (!tronUtils.address.isAddress(r.address)) {
    throw new Error(`tron-srs: invalid base58check SR address: "${r.address}"`);
  }
  if (typeof r.name !== "string" || r.name.length === 0) {
    throw new Error(`tron-srs: entry missing non-empty string \`name\`: ${JSON.stringify(e)}`);
  }
  if (typeof r.rank !== "number" || !Number.isInteger(r.rank) || r.rank < 1) {
    throw new Error(`tron-srs: entry has invalid \`rank\` (must be positive integer): ${JSON.stringify(e)}`);
  }
  if (typeof r.voteCount !== "number" || r.voteCount < 0) {
    throw new Error(`tron-srs: entry has invalid \`voteCount\` (must be non-negative number): ${JSON.stringify(e)}`);
  }
  if (typeof r.url !== "string" || r.url.length === 0) {
    throw new Error(`tron-srs: entry missing non-empty string \`url\`: ${JSON.stringify(e)}`);
  }

  return {
    address: r.address,
    name: r.name,
    rank: r.rank,
    voteCount: r.voteCount,
    url: r.url,
  };
}

// DOA validation at module load — throws on any malformed entry.
// Mirrors `tron-top-25.ts` pattern.
const SNAPSHOT_SRS: SrRegistryEntry[] = (snapshotRaw as unknown[]).map(validateSnapshotEntry);

// ============================================================================
// URL-to-name heuristic
// ============================================================================

/**
 * Derive a human-readable SR name from its `url` field.
 *
 * Algorithm:
 *   1. Strip protocol (`https://`, `http://`).
 *   2. Strip leading `www.`.
 *   3. Take the first segment (before first `.`).
 *   4. Capitalize first letter.
 *   5. Fall back to `"SR-" + address.slice(0, 6)` if URL parsing fails.
 *
 * Why heuristic: `listSuperRepresentatives()` does not return a `name` field —
 * only `url`. The snapshot file pre-computes known names for top SRs. The
 * heuristic covers SR candidates whose names we don't know in advance.
 */
function nameFromUrl(url: string, address: string): string {
  try {
    const stripped = url
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "");
    const domain = stripped.split("/")[0] ?? "";
    const firstSegment = domain.split(".")[0] ?? "";
    if (!firstSegment) {
      return `SR-${address.slice(0, 6)}`;
    }
    return firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1).toLowerCase();
  } catch {
    return `SR-${address.slice(0, 6)}`;
  }
}

// ============================================================================
// Address normalization
// ============================================================================

/**
 * Normalize a TRON SR address to base58check format.
 *
 * `listSuperRepresentatives()` returns `address: string` as per the BaseWitness
 * interface. In practice, `address` is typically base58check already, but some
 * tronweb edge cases return 0x41-prefixed hex. This function normalizes both:
 *   - base58check (T-prefixed, 34 chars): returned unchanged.
 *   - 0x41-prefixed hex or plain 41-prefixed hex: converted via `formatTronAddress`.
 *   - If conversion fails: returns original string (defensive; address will be
 *     treated as unknown SR by the lookup).
 */
function normalizeToBase58(address: string): string {
  // Already base58check (starts with T and is 34 chars)
  if (address.startsWith("T") && address.length === 34) {
    return address;
  }
  // Hex-format (0x41... or 41...) — convert to base58check
  // `fromHex` (underlying `formatTronAddress`) requires the raw 41-prefixed hex
  // WITHOUT a leading `0x`. Strip `0x` first before calling.
  try {
    const hex = address.startsWith("0x") ? address.slice(2) : address;
    if (hex.startsWith("41") && hex.length === 42) {
      return formatTronAddress(hex);
    }
  } catch {
    // Fall through to original
  }
  return address;
}

// ============================================================================
// Core functions
// ============================================================================

/**
 * Load the SR registry using the D-05 hybrid policy.
 *
 * Primary: `tronWeb.trx.listSuperRepresentatives()` live fetch.
 * Fallback: bundled `src/tokens/tron-srs.json` snapshot on any RPC failure.
 *
 * SR list is sorted by `voteCount` desc; `rank` is assigned 1..N.
 * Address fields are normalized to base58check via `normalizeToBase58`.
 * SR `name` is heuristically derived from `url` per `nameFromUrl`.
 *
 * `source` is ALWAYS set so callers can surface it in CHECKS PERFORMED per D-05b.
 */
export async function loadSrRegistry(tronWeb: TronWeb): Promise<SrRegistryResult> {
  try {
    const witnesses = await tronWeb.trx.listSuperRepresentatives();

    // Sort by voteCount desc → assign rank 1..N
    const sorted = [...witnesses].sort((a, b) => b.voteCount - a.voteCount);

    const srs: SrRegistryEntry[] = sorted.map((witness, idx) => {
      const normalizedAddress = normalizeToBase58(witness.address);
      const name = nameFromUrl(witness.url, normalizedAddress);
      return {
        address: normalizedAddress,
        name,
        rank: idx + 1,
        voteCount: witness.voteCount,
        url: witness.url,
      };
    });

    return { source: "live", srs };
  } catch (_err) {
    // RPC failure → demote to snapshot fallback. Any error (network, timeout,
    // rate-limit, unexpected response shape) catches here.
    return { source: "snapshot-fallback", srs: SNAPSHOT_SRS };
  }
}

/**
 * Look up an SR by exact base58check address match.
 *
 * Returns the `SrRegistryEntry` if found, or `undefined` for unknown SRs.
 * Unknown SRs should surface `"(unverified SR — confirm address)"` in the
 * tool response per D-05c.
 */
export function lookupSr(registry: SrRegistryResult, srAddress: string): SrRegistryEntry | undefined {
  return registry.srs.find((sr) => sr.address === srAddress);
}

// ============================================================================
// ESM spy-affordance (CLAUDE.md convention)
// ============================================================================

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * Tools and tests import `_tronSrRegistry` and call through the indirection
 * so `vi.spyOn(_tronSrRegistry, "loadSrRegistry")` intercepts correctly.
 * Direct `vi.spyOn` on named exports is a silent no-op for ESM (immutable bindings).
 */
export const _tronSrRegistry = {
  loadSrRegistry,
  lookupSr,
};
