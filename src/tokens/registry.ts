import { getAddress, type Address } from "viem";

import type { ChainId } from "../config/contracts.js";
import topFifty from "./ethereum-top-50.json" with { type: "json" };

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

let cached: Token[] | undefined;

/**
 * Loads the static top-50 Ethereum mainnet ERC-20 token registry.
 *
 * Result is memoised; the JSON is parsed and re-checksummed once per process.
 * Re-checksumming on load defends against a corrupted snapshot file (an attacker
 * who flips a single hex digit in the file is caught by the checksum re-check).
 *
 * Phase 8 — Plan 08-02: still the canonical Ethereum-only loader; existing
 * Phase 4-7 callers continue to use it byte-frozen. New Phase 8 per-chain
 * consumers prefer `loadTokenRegistry(chainId)` below.
 */
export function loadEthereumTokenRegistry(): Token[] {
  if (cached) return cached;
  cached = validateRegistry(topFifty);
  return cached;
}

/**
 * Phase 8 — Plan 08-02. Per-chain token registry dispatcher. v1.2-Plan-08-02
 * ship state: only `chainId=1` returns a populated registry; the 4 L2 chains
 * return an empty array. Plan 08-03 lands `src/tokens/{arbitrum,polygon,base,
 * optimism}-top-50.json` and wires them through here; until then, per-chain
 * consumers fall through to the live-RPC `decimals()`/`symbol()` reads (Phase 6
 * registry-cache-first then live-RPC fallback pattern). The fall-through is a
 * small RPC-cost increase but no functional gap.
 *
 * Total + chainId-typed: TypeScript narrowing forces the caller to pass a
 * `ChainId`-typed value; the switch is exhaustive against the 5-chain union.
 */
export function loadTokenRegistry(chainId: ChainId): Token[] {
  switch (chainId) {
    case 1:
      return loadEthereumTokenRegistry();
    case 42161:
    case 137:
    case 8453:
    case 10:
      // v1.2-Plan-08-02 ship state: empty per-chain registries; Plan 08-03
      // lands the JSON. Per-chain consumers fall through to live-RPC reads.
      return [];
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

/** Test-only: clears the memoised registry so the next call reparses. */
export function _resetRegistryCacheForTesting(): void {
  cached = undefined;
}
