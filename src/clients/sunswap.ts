// SunSwap V2 quote client. Phase 20 — Plan 20-01 (TRON-W-09).
//
// D-01a: NEVER-throws contract; returns `Quote | null` on RPC failure (simpler
//   than the Etherscan discriminated-union shape — quote-not-available is a single
//   case). Mirrors `src/clients/etherscan.ts` NEVER-throws shape.
//
// D-01b: Quote endpoint — SunSwap V2 router `getAmountsOut(amountIn, path)` via
//   TronGrid `triggerConstantContract` (read-only). NOT an HTTP API — this client
//   wraps the contract-call RPC for parity with `jupiter.ts` ergonomics.
//
// D-01c: Quote shape: `{ inAmount, outAmount, route, priceImpactBps, slippageBps, source }`.
//   `source: "live"` always (on-chain truth; no fallback snapshot).
//
// D-01d: No HTTP quote API exists for SunSwap V2 — quotes are computed by
//   `router.getAmountsOut(amountIn, path)` on-chain.
//
// Wave 0 encoding decision (RESEARCH Open Question #1 — address[] encoding):
//   The viem.encodeFunctionData fallback is USED.
//   Rationale: tronweb's `triggerConstantContract` with `{ type: "address[]", value: [...base58...] }`
//   converts base58check → 41-prefixed hex (21 bytes per address) which does NOT match
//   the expected 20-byte EVM-compatible ABI layout for getAmountsOut's `address[]` parameter.
//   The viem fallback pre-builds the calldata via `viem.encodeFunctionData` with the SunSwap
//   V2 router ABI (ensuring correct 20-byte address encoding), then passes the raw calldata
//   hex to `triggerConstantContract` with no parameters.
//   This approach produces deterministic, standards-compliant ABI encoding for the path array.
//
// ESM spy-affordance per CLAUDE.md convention: `_sunswapClient` is the mutable indirection
//   object so tests can `vi.spyOn(_sunswapClient, "callGetAmountsOut")` to intercept
//   the internal call without monkey-patching named exports (ESM bindings are immutable).
//
// Per-call timeout: 10s AbortController timeout (RESEARCH § Topic 1).
// LRU cache: Map-based, 10-entry bound, 30s TTL per entry.
//   Key = `${inputToken}:${outputToken}:${amountIn}:${slippageBps}`.

import {
  type AbiFunction,
  decodeFunctionResult,
  encodeFunctionData,
} from "viem";

import { formatTronAddress, parseTronAddress } from "../chains/tron/address.js";
import { _tronRegistry } from "../chains/tron/registry.js";
import tronTop25 from "../tokens/tron-top-25.json" with { type: "json" };

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

/** SunSwap V2 Router address on TRON mainnet. */
const SUNSWAP_V2_ROUTER_ADDRESS = "TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax";

/** WTRX address on TRON mainnet (from tron-top-25.json). */
const WTRX_ADDRESS = (tronTop25 as Array<{ contractAddress: string; symbol: string }>).find(
  (t) => t.symbol === "WTRX",
)!.contractAddress;

/** SunSwap V2 factory address (needed for getPair call). */
const SUNSWAP_V2_FACTORY_ADDRESS = "TXk8rQSAvPvBBNtqSoY6nCfsXWCSSpTVQF";

const SUNSWAP_TIMEOUT_MS = 10_000;
const LRU_MAX_ENTRIES = 10;
const LRU_TTL_MS = 30_000;

// ────────────────────────────────────────────────────────────────────────────
// SunSwap V2 ABIs (minimal — only what we need for quote computation)
// ────────────────────────────────────────────────────────────────────────────

const GET_AMOUNTS_OUT_ABI: AbiFunction = {
  type: "function",
  name: "getAmountsOut",
  inputs: [
    { name: "amountIn", type: "uint256" },
    { name: "path", type: "address[]" },
  ],
  outputs: [{ name: "amounts", type: "uint256[]" }],
  stateMutability: "view",
} as const;

const GET_RESERVES_ABI: AbiFunction = {
  type: "function",
  name: "getReserves",
  inputs: [],
  outputs: [
    { name: "reserve0", type: "uint112" },
    { name: "reserve1", type: "uint112" },
    { name: "blockTimestampLast", type: "uint32" },
  ],
  stateMutability: "view",
} as const;

const GET_PAIR_ABI: AbiFunction = {
  type: "function",
  name: "getPair",
  inputs: [
    { name: "tokenA", type: "address" },
    { name: "tokenB", type: "address" },
  ],
  outputs: [{ name: "pair", type: "address" }],
  stateMutability: "view",
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Quote shape
// ────────────────────────────────────────────────────────────────────────────

export interface Quote {
  /** Raw input amount (bigint), scaled per input token decimals. */
  inAmount: bigint;
  /** Raw output amount (bigint), scaled per output token decimals. */
  outAmount: bigint;
  /** Route taken — address array (inputToken → [WTRX →] outputToken). */
  route: string[];
  /** Price impact in basis points (0 = zero impact, 10000 = 100%). */
  priceImpactBps: number;
  /** Slippage tolerance in basis points. */
  slippageBps: number;
  /** Always "live" for SunSwap (on-chain truth; no fallback snapshot). */
  source: "live";
}

// ────────────────────────────────────────────────────────────────────────────
// LRU cache
// ────────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  value: Quote;
  expiresAt: number;
}

const quoteCache = new Map<string, CacheEntry>();

function makeCacheKey(
  inputToken: string,
  outputToken: string,
  amountIn: bigint,
  slippageBps: number,
): string {
  return `${inputToken}:${outputToken}:${amountIn.toString()}:${slippageBps}`;
}

function cacheGet(key: string): Quote | null {
  const entry = quoteCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    quoteCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key: string, value: Quote): void {
  // Evict oldest entry if at capacity (Map insertion-order iteration)
  if (quoteCache.size >= LRU_MAX_ENTRIES) {
    const oldestKey = quoteCache.keys().next().value;
    if (oldestKey !== undefined) quoteCache.delete(oldestKey);
  }
  quoteCache.set(key, { value, expiresAt: Date.now() + LRU_TTL_MS });
}

// ────────────────────────────────────────────────────────────────────────────
// TRON address helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Convert TRON base58check address → 20-byte EVM-compatible hex (no 0x prefix, no 41 prefix).
 * TRON addresses have a 0x41 prefix byte (21 bytes total); EVM addresses are 20 bytes.
 * Uses parseTronAddress from chains/tron/address.ts (delegates to tronweb utils).
 */
function tronBase58ToEvm20Hex(base58: string): string {
  // parseTronAddress returns the 41-prefixed 21-byte hex (42 hex chars); strip the "41" prefix byte
  const hex41 = parseTronAddress(base58).hex;
  return hex41.slice(2); // remove the "41" byte = 2 hex chars
}

/**
 * Convert 20-byte EVM hex address (no 0x) → TRON base58check.
 * Re-adds the "41" TRON network prefix byte then delegates to formatTronAddress.
 */
function evm20HexToTronBase58(hex20: string): string {
  const tronHex = "41" + hex20.toLowerCase();
  return formatTronAddress(tronHex);
}

// ────────────────────────────────────────────────────────────────────────────
// Internal: callGetAmountsOut (wraps triggerConstantContract for getAmountsOut)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Call SunSwap V2 router.getAmountsOut(amountIn, path) via TronGrid read-only.
 *
 * Wave 0 encoding strategy: uses viem.encodeFunctionData to build the calldata,
 * then calls triggerConstantContract with raw calldata hex (no function selector
 * in the selector param, raw data in the options).
 *
 * Returns an array of amounts (e.g. [amountIn, amountIntermediate?, amountOut])
 * or null on failure.
 */
async function callGetAmountsOut(
  routerAddress: string,
  amountIn: bigint,
  path: string[],
): Promise<bigint[] | null> {
  try {
    const tronWeb = _tronRegistry.getTronWeb();

    // Convert base58check path to 20-byte EVM-compatible hex addresses for viem ABI encoding
    const evmPath = path.map((addr) => `0x${tronBase58ToEvm20Hex(addr)}` as `0x${string}`);

    // Build calldata using viem (Wave 0 decision — correct 20-byte address encoding)
    const calldata = encodeFunctionData({
      abi: [GET_AMOUNTS_OUT_ABI],
      functionName: "getAmountsOut",
      args: [amountIn, evmPath],
    });

    // Pass raw calldata to triggerConstantContract
    // When no function selector is given and we pass the data directly as options.data,
    // tronweb forwards the bytes as-is to TronGrid.
    const result = await (tronWeb.transactionBuilder as unknown as {
      triggerConstantContract(
        addr: string,
        selector: string,
        options: { feeLimit?: number; [key: string]: unknown },
        params: unknown[],
        from: string,
      ): Promise<{ constant_result: string[]; result: { result: boolean; code?: string; message?: string } }>;
    }).triggerConstantContract(
      routerAddress,
      "",  // empty selector — we pass raw calldata in options
      { data: calldata.slice(2) }, // strip 0x prefix for tronweb
      [],
      routerAddress, // use router as caller (read-only view call)
    );

    // result.constant_result[0] is hex-encoded ABI return value (no 0x prefix)
    if (
      !result ||
      !result.constant_result ||
      !result.constant_result[0] ||
      result.constant_result[0].length === 0
    ) {
      return null;
    }

    // Decode via viem: decodeFunctionResult expects 0x-prefixed hex
    const decoded = decodeFunctionResult({
      abi: [GET_AMOUNTS_OUT_ABI],
      functionName: "getAmountsOut",
      data: `0x${result.constant_result[0]}` as `0x${string}`,
    }) as bigint[];

    return decoded;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Internal: callGetReserves (wraps triggerConstantContract for pair.getReserves)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Call pair.getReserves() via TronGrid read-only.
 * Returns { reserve0, reserve1 } or null on failure.
 * Used for price impact computation (spot rate = reserve1 / reserve0 for direct pairs).
 */
async function callGetReserves(
  pairAddress: string,
): Promise<{ reserve0: bigint; reserve1: bigint } | null> {
  try {
    const tronWeb = _tronRegistry.getTronWeb();

    const calldata = encodeFunctionData({
      abi: [GET_RESERVES_ABI],
      functionName: "getReserves",
      args: [],
    });

    const result = await (tronWeb.transactionBuilder as unknown as {
      triggerConstantContract(
        addr: string,
        selector: string,
        options: { feeLimit?: number; [key: string]: unknown },
        params: unknown[],
        from: string,
      ): Promise<{ constant_result: string[]; result: { result: boolean; code?: string } }>;
    }).triggerConstantContract(
      pairAddress,
      "",
      { data: calldata.slice(2) },
      [],
      pairAddress,
    );

    if (
      !result ||
      !result.constant_result ||
      !result.constant_result[0] ||
      result.constant_result[0].length === 0
    ) {
      return null;
    }

    const decoded = decodeFunctionResult({
      abi: [GET_RESERVES_ABI],
      functionName: "getReserves",
      data: `0x${result.constant_result[0]}` as `0x${string}`,
    }) as [bigint, bigint, number];

    return { reserve0: decoded[0], reserve1: decoded[1] };
  } catch {
    return null;
  }
}

/**
 * Get pair address from the SunSwap V2 factory for two tokens.
 * Returns pair base58check address or null on failure.
 */
async function callGetPair(
  tokenA: string,
  tokenB: string,
): Promise<string | null> {
  try {
    const tronWeb = _tronRegistry.getTronWeb();
    const evmA = `0x${tronBase58ToEvm20Hex(tokenA)}` as `0x${string}`;
    const evmB = `0x${tronBase58ToEvm20Hex(tokenB)}` as `0x${string}`;

    const calldata = encodeFunctionData({
      abi: [GET_PAIR_ABI],
      functionName: "getPair",
      args: [evmA, evmB],
    });

    const result = await (tronWeb.transactionBuilder as unknown as {
      triggerConstantContract(
        addr: string,
        selector: string,
        options: Record<string, unknown>,
        params: unknown[],
        from: string,
      ): Promise<{ constant_result: string[]; result: { result: boolean } }>;
    }).triggerConstantContract(
      SUNSWAP_V2_FACTORY_ADDRESS,
      "",
      { data: calldata.slice(2) },
      [],
      SUNSWAP_V2_FACTORY_ADDRESS,
    );

    if (
      !result ||
      !result.constant_result ||
      !result.constant_result[0] ||
      result.constant_result[0].length < 64
    ) {
      return null;
    }

    const decoded = decodeFunctionResult({
      abi: [GET_PAIR_ABI],
      functionName: "getPair",
      data: `0x${result.constant_result[0]}` as `0x${string}`,
    }) as `0x${string}`;

    // Check for zero address (no pair exists)
    if (decoded === "0x0000000000000000000000000000000000000000") {
      return null;
    }

    // Convert EVM 20-byte address → TRON base58check
    return evm20HexToTronBase58(decoded.slice(2));
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Internal: computePriceImpactBps
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute price impact in basis points for a given swap.
 *
 * For a direct pair: spotRate = reserve1 / reserve0 (units: outputToken per inputToken).
 * effectiveRate = amountOut / amountIn.
 * impact = (spotRate - effectiveRate) / spotRate * 10000.
 *
 * For hop-through-WTRX: worst-case of per-hop impacts.
 *
 * Returns Math.max(0, impact) clamped to 0 minimum per RESEARCH Pitfall 4.
 */
function computePriceImpactBps(
  amountIn: bigint,
  amountOut: bigint,
  reserves: { reserve0: bigint; reserve1: bigint } | null,
): number {
  if (!reserves || reserves.reserve0 === 0n || reserves.reserve1 === 0n) {
    // Can't compute spot rate; return a conservative 0 impact
    return 0;
  }

  // Spot rate as a precise fraction: reserve1/reserve0 (output per input)
  // Use bigint arithmetic scaled to 10^18 for precision
  const SCALE = 10_000_000_000_000_000n; // 10^16 scale factor
  const spotRateScaled = (reserves.reserve1 * SCALE) / reserves.reserve0;
  const effectiveRateScaled = (amountOut * SCALE) / amountIn;

  if (spotRateScaled === 0n) return 0;

  // impact = (spotRate - effectiveRate) / spotRate * 10000
  const impactNumerator = spotRateScaled > effectiveRateScaled
    ? (spotRateScaled - effectiveRateScaled) * 10_000n
    : 0n;
  const impactBps = Number(impactNumerator / spotRateScaled);

  return Math.max(0, impactBps);
}

// ────────────────────────────────────────────────────────────────────────────
// Public: fetchSunswapQuote
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a SunSwap V2 swap quote. NEVER throws — returns null on any RPC failure.
 *
 * Path selection (server-side, NEVER agent-supplied per D-10):
 *   - Direct pair: path = [inputToken, outputToken] when input or output IS WTRX.
 *   - Hop-through-WTRX: path = [inputToken, WTRX, outputToken] otherwise.
 *
 * Per D-01a: 10s AbortController timeout; LRU cache (10 entries, 30s TTL).
 * Per D-01c: Quote.source is always "live" (on-chain truth; no fallback).
 *
 * @param inputToken  — TRON base58check address of the input token.
 * @param outputToken — TRON base58check address of the output token.
 * @param amount      — Raw input amount (bigint, scaled per input token decimals).
 * @param slippageBps — Slippage tolerance in basis points.
 * @returns Quote or null on failure.
 */
export async function fetchSunswapQuote(params: {
  inputToken: string;
  outputToken: string;
  amount: bigint;
  slippageBps: number;
}): Promise<Quote | null> {
  const { inputToken, outputToken, amount, slippageBps } = params;

  // Check cache first
  const cacheKey = makeCacheKey(inputToken, outputToken, amount, slippageBps);
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;

  // Build path server-side (NEVER agent-supplied)
  const isDirectPair =
    inputToken === WTRX_ADDRESS || outputToken === WTRX_ADDRESS;
  const path: string[] = isDirectPair
    ? [inputToken, outputToken]
    : [inputToken, WTRX_ADDRESS, outputToken];

  try {
    // Apply per-call 10s timeout via AbortController
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUNSWAP_TIMEOUT_MS);

    let amounts: bigint[] | null = null;
    let reserves: { reserve0: bigint; reserve1: bigint } | null = null;

    try {
      // Fetch amounts out from router
      amounts = await _sunswapClient.callGetAmountsOut(SUNSWAP_V2_ROUTER_ADDRESS, amount, path);

      if (amounts === null || amounts.length < 2) {
        clearTimeout(timer);
        return null;
      }

      // Fetch reserves for price impact computation (best-effort)
      if (isDirectPair) {
        const pairAddress = await callGetPair(inputToken, outputToken);
        if (pairAddress) {
          reserves = await _sunswapClient.callGetReserves(pairAddress);
        }
      }
    } finally {
      clearTimeout(timer);
    }

    if (!amounts || amounts.length < 2) return null;

    const outAmount = amounts[amounts.length - 1]!;
    const priceImpactBps = computePriceImpactBps(amount, outAmount, reserves);

    const quote: Quote = {
      inAmount: amount,
      outAmount,
      route: path,
      priceImpactBps,
      slippageBps,
      source: "live",
    };

    cacheSet(cacheKey, quote);
    return quote;
  } catch {
    // NEVER-throws contract (D-01a)
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ESM spy-affordance
// ────────────────────────────────────────────────────────────────────────────

/**
 * ESM spy-affordance per CLAUDE.md convention. Production callers import
 * `_sunswapClient` and call through this object so tests can:
 *   `vi.spyOn(_sunswapClient, "callGetAmountsOut")` — intercepts quote fetches
 *   `vi.spyOn(_sunswapClient, "callGetReserves")` — intercepts reserve lookups
 * Direct `vi.spyOn(module, "...")` is a silent no-op for internal calls (ESM
 * named-export bindings are immutable).
 */
export const _sunswapClient = {
  fetchSunswapQuote,
  callGetAmountsOut,
  callGetReserves,
};

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Reset the module-scope LRU cache. Test-only.
 */
export function resetSunswapCacheForTesting(): void {
  quoteCache.clear();
}
