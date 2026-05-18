import { getAddress, type Address } from "viem";

import type { ChainId } from "../config/contracts.js";

// Per-chain top-50 ERC-20 registries (Phase 8 Plan 08-03 finalization).
//
// Each file's address list is curated from CoinGecko's per-chain top-volume
// ranking + cross-verified against the chain's official tokenlist:
//   - ethereum:  ethereum-top-50.json (Phase 2 — original)
//   - arbitrum:  arbitrum-top-50.json (curated 2026-05-18; CoinGecko + Arbitrum bridge tokenlist)
//   - polygon:   polygon-top-50.json  (curated 2026-05-18; CoinGecko + Polygon official tokenlist)
//   - base:      base-top-50.json     (curated 2026-05-18; CoinGecko + Base predeploys + Base ecosystem)
//   - optimism:  optimism-top-50.json (curated 2026-05-18; CoinGecko + Optimism predeploys + OP Stack)
//
// Every address is `getAddress`-checksummed at load time via `validateToken`;
// a single hex-digit flip in any snapshot throws EIP-55 at module load —
// the corrupted-snapshot guard fires before any caller sees a bad address.
import arbitrumTopFifty from "./arbitrum-top-50.json" with { type: "json" };
import baseTopFifty from "./base-top-50.json" with { type: "json" };
import ethereumTopFifty from "./ethereum-top-50.json" with { type: "json" };
import optimismTopFifty from "./optimism-top-50.json" with { type: "json" };
import polygonTopFifty from "./polygon-top-50.json" with { type: "json" };

export interface Token {
  /** Checksummed ERC-20 contract address. */
  address: Address;
  /** ERC-20 `symbol()` (cached, not re-read on load). */
  symbol: string;
  /** ERC-20 `decimals()` — load-bearing for amount math. Wrong value = wrong balance. */
  decimals: number;
  /** Human-readable token name. */
  name: string;
}

/**
 * Per-chain raw registry table. The JSON files are typed as `unknown` here
 * (the `with { type: "json" }` import gives Node's `any`/`unknown` value);
 * `validateRegistry` re-validates + checksums every entry at load time.
 */
const RAW_REGISTRIES: Record<ChainId, unknown> = {
  1: ethereumTopFifty,
  42161: arbitrumTopFifty,
  137: polygonTopFifty,
  8453: baseTopFifty,
  10: optimismTopFifty,
};

/**
 * Per-chain memoised parsed registry. `loadTokenRegistry(chainId)` populates
 * the slot on first call; subsequent calls return the cached array. Parsing
 * + re-checksumming is intentionally lazy — chains the operator never queries
 * never pay the validation cost.
 */
const memoized: Partial<Record<ChainId, Token[]>> = {};

/**
 * Phase 8 — Plan 08-03 finalization. Per-chain token registry loader.
 * Returns the curated top-50 ERC-20 registry for the given chain, parsed +
 * re-checksummed via {@link validateRegistry}. The result is memoised per
 * chain; subsequent calls return the cached array.
 *
 * Plan 08-02 shipped the dispatcher with `[]` stubs for the 4 L2 chains;
 * this plan replaces the stubs with real loaders for `arbitrum-top-50.json`,
 * `polygon-top-50.json`, `base-top-50.json`, `optimism-top-50.json`. The
 * Plan 08-02 ethereum-only loader shim is DELETED — all callers migrated to
 * `loadTokenRegistry(chainId)`.
 *
 * Total + chainId-typed: TypeScript narrowing forces the caller to pass a
 * `ChainId`-typed value; the `default` arm narrows to `never` for exhaustive-
 * ness against the 5-chain union.
 */
export function loadTokenRegistry(chainId: ChainId): Token[] {
  const cached = memoized[chainId];
  if (cached) return cached;
  switch (chainId) {
    case 1:
    case 42161:
    case 137:
    case 8453:
    case 10: {
      const loaded = validateRegistry(RAW_REGISTRIES[chainId]);
      memoized[chainId] = loaded;
      return loaded;
    }
    default: {
      const _exhaustive: never = chainId;
      throw new Error(`loadTokenRegistry: unsupported chainId ${String(_exhaustive)}`);
    }
  }
}

/** Validates the parsed JSON shape; throws with a descriptive message on the first malformed entry. */
function validateRegistry(parsed: unknown): Token[] {
  if (!Array.isArray(parsed)) {
    throw new Error(`token registry: expected JSON array, got ${typeof parsed}`);
  }
  if (parsed.length === 0) {
    throw new Error("token registry: empty array");
  }
  return parsed.map((entry, idx) => validateToken(entry, idx));
}

function validateToken(entry: unknown, idx: number): Token {
  if (entry === null || typeof entry !== "object") {
    throw new Error(
      `token registry[${idx}]: expected object, got ${entry === null ? "null" : typeof entry}`,
    );
  }
  const obj = entry as Record<string, unknown>;
  const address = obj.address;
  const symbol = obj.symbol;
  const decimals = obj.decimals;
  const name = obj.name;

  if (typeof address !== "string") {
    throw new Error(`token registry[${idx}]: address must be string`);
  }
  if (typeof symbol !== "string" || symbol.length === 0) {
    throw new Error(`token registry[${idx}]: symbol must be non-empty string`);
  }
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(
      `token registry[${idx}] (${symbol}): decimals must be integer in [0, 36], got ${String(decimals)}`,
    );
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`token registry[${idx}] (${symbol}): name must be non-empty string`);
  }

  // getAddress validates + re-checksums; throws if malformed.
  let checksummed: Address;
  try {
    checksummed = getAddress(address);
  } catch (err) {
    throw new Error(
      `token registry[${idx}] (${symbol}): invalid address ${address} — ${(err as Error).message}`,
    );
  }

  return { address: checksummed, symbol, decimals, name };
}

/** Test-only: clears every per-chain memoised registry so the next call reparses. */
export function _resetRegistryCacheForTesting(): void {
  for (const k of Object.keys(memoized)) {
    delete memoized[Number(k) as ChainId];
  }
}
