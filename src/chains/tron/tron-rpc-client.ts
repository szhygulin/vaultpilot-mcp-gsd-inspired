// src/chains/tron/tron-rpc-client.ts — Phase 17 Plan 17-01.
//
// Thin RPC wrapper around `tronweb@6.3.0`'s `TronWeb` instance. Three
// public helpers:
//
//   - `getNativeBalance(walletBase58)` — native TRX balance via
//     `tw.trx.getBalance`. Returns `{ sun: bigint, trx: string }` —
//     `number` types never leak through to consumers (CLAUDE.md
//     decimal-string-at-the-boundary + research Pitfall 1 — TronGrid's
//     wire shape returns `number`, which loses precision above
//     Number.MAX_SAFE_INTEGER sun; we widen to bigint at this boundary).
//   - `getBlockTip()` — chain head via `tw.trx.getCurrentBlock`. Returns
//     `{ number, timestamp, blockHash }`. Defensive on schema drift —
//     missing `block_header.raw_data` returns the zero-tuple rather than
//     throwing (wire-shape stability beats fail-loud here; the upstream
//     SDK has rotated this shape before).
//   - `getTrc20Balance(walletBase58, contractBase58)` — TRC-20
//     `balanceOf` via tronweb's contract loader. Returns `bigint` (the
//     SDK surfaces a BigNumber-like object; we cast through `.toString()`
//     to a bigint at the boundary to match the rest of the codebase's
//     decimal-string-at-the-boundary discipline).
//
// All three route their `TronWeb` access through
// `_tronRegistry.getTronWeb()` — NEVER bare-import the registry's
// production export (preserves the ESM spy seam for tests).
//
// Native units: TRX has **6 decimals** (1 TRX = 1_000_000 sun), NOT 9
// like SOL. `SUN_PER_TRX = 1_000_000n` literal is anchored in
// `_trxRpcInternals` for regression coverage.

import { _tronRegistry } from "./registry.js";

/**
 * TRON RPC error envelope. Wraps all `TronWeb`-thrown errors with a
 * stable `errorCode` so tool handlers in Plan 17-03 can pattern-match
 * for the MCP error envelope without sniffing through nested SDK
 * exception types.
 *
 * Mirrors `SolanaRpcError` at `chains/solana/sol-rpc-client.ts:50-61`.
 */
export class TronRpcError extends Error {
  readonly errorCode = "TRON_RPC_FAILED" as const;
  override readonly cause?: unknown;

  constructor(cause: unknown) {
    const causeMsg =
      cause instanceof Error ? cause.message : String(cause);
    super(`TRON RPC call failed: ${causeMsg}`);
    this.name = "TronRpcError";
    this.cause = cause;
  }
}

/**
 * Sun → TRX conversion factor. 1 TRX = 1_000_000 sun (6 decimals, locked
 * at the protocol level). Mirror of `LAMPORTS_PER_SOL` at
 * `chains/solana/sol-rpc-client.ts:67` — distinct value (6 decimals vs
 * 9) per research § Topic 6 (TRX is 6-decimal protocol-wide).
 */
const SUN_PER_TRX = 1_000_000n;

/**
 * Format `bigint` sun as a decimal-string TRX amount. Pure —
 * deterministic on every input. Mirror of `formatLamportsToSol` at
 * `chains/solana/sol-rpc-client.ts:83-90` (adjusted from 9-pad to 6-pad).
 *
 * Behavior:
 *   - `0n` → `"0"`
 *   - `1_000_000n` → `"1"`
 *   - `1_500_000n` → `"1.5"`
 *   - `1n` → `"0.000001"`
 *   - Trailing zeros on the fractional part are trimmed; a fully-zero
 *     fractional part is dropped entirely (no trailing `.`).
 */
function formatSunToTrx(sun: bigint): string {
  const whole = sun / SUN_PER_TRX;
  const frac = sun % SUN_PER_TRX;
  if (frac === 0n) return whole.toString();
  const fracPadded = frac.toString().padStart(6, "0");
  const fracTrimmed = fracPadded.replace(/0+$/, "");
  return `${whole.toString()}.${fracTrimmed}`;
}

/**
 * Read the native TRX balance for a wallet. Single-RPC round-trip.
 *
 * Returns `{ sun: bigint, trx: string }`:
 *   - `sun` is the on-chain `int64` widened to `bigint`. The SDK narrows
 *     the wire value to JS `number` (research Pitfall 1 — `getBalance`
 *     returns `number`); we widen back at this boundary so `number` cannot
 *     leak into JSON or downstream math. **REGRESSION ANCHOR**: a
 *     wallet with > `Number.MAX_SAFE_INTEGER` sun (≈9e15 sun ≈ 9 billion
 *     TRX) loses precision without this widening.
 *   - `trx` is the decimal-string display value (e.g. `"1.5"` for
 *     1_500_000 sun). Consumers pass this straight into the agent
 *     surface; no further formatting needed.
 *
 * Error envelope: rethrows as `TronRpcError` (errorCode
 * `TRON_RPC_FAILED`) on any failure. The tool handler in Plan 17-03
 * translates this to the MCP error envelope.
 */
export async function getNativeBalance(
  walletBase58: string,
): Promise<{ sun: bigint; trx: string }> {
  try {
    const tw = _tronRegistry.getTronWeb();
    const sunNumber = await tw.trx.getBalance(walletBase58);
    // Pitfall 1: TronGrid returns `number`; widen to bigint at the
    // boundary so wallets > Number.MAX_SAFE_INTEGER sun don't lose
    // precision in downstream math. `BigInt(number)` throws on
    // non-integer / non-finite — defensive narrow first.
    const sun = BigInt(sunNumber);
    return { sun, trx: formatSunToTrx(sun) };
  } catch (e) {
    throw new TronRpcError(e);
  }
}

/**
 * Chain head shape. `number` is the block height, `timestamp` is
 * milliseconds since epoch (TRON's block timestamps are millisecond-
 * precision, unlike Bitcoin/EVM seconds), `blockHash` is the 64-char hex
 * block ID with leading zeros preserved (no `0x` prefix per tronweb's
 * convention).
 */
export interface BlockTip {
  number: number;
  timestamp: number;
  blockHash: string;
}

/**
 * Read the current chain head. Single-RPC round-trip via
 * `tw.trx.getCurrentBlock()`. Defensive on schema drift — if a future
 * SDK version returns `block_header` undefined or missing fields,
 * surface the zero-tuple rather than throwing. Wire-shape stability
 * beats fail-loud for a diagnostic-only read; the operator sees the
 * zeros and knows to investigate, vs. losing the whole tool surface to
 * a TypeError.
 */
export async function getBlockTip(): Promise<BlockTip> {
  try {
    const tw = _tronRegistry.getTronWeb();
    const block = await tw.trx.getCurrentBlock();
    return {
      number: block?.block_header?.raw_data?.number ?? 0,
      timestamp: block?.block_header?.raw_data?.timestamp ?? 0,
      blockHash: block?.blockID ?? "",
    };
  } catch (e) {
    throw new TronRpcError(e);
  }
}

/**
 * Read a TRC-20 token balance via the contract's `balanceOf(address)`
 * view method. Two-RPC pattern in tronweb 6.x — the contract loader
 * fetches the ABI from the chain in step 1, then the `.call()` is the
 * second round-trip. (Plan 17-03's tool short-circuits this by using a
 * minimal inline ABI rather than the chain-side ABI fetch.)
 *
 * Returns `bigint` — converts the SDK's BigNumber-like return through
 * `.toString()` at the boundary. This matches the bigint-at-boundary
 * discipline (research Pitfall 1) and keeps `number` out of downstream
 * math.
 */
export async function getTrc20Balance(
  walletBase58: string,
  contractBase58: string,
): Promise<bigint> {
  try {
    const tw = _tronRegistry.getTronWeb();
    // Minimal `balanceOf` ABI — tronweb's `contract(abi, addr)` accepts a
    // human-readable signature string array.
    const contract = await tw.contract(
      [
        {
          constant: true,
          inputs: [{ name: "owner", type: "address" }],
          name: "balanceOf",
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
          type: "function",
        },
      ],
      contractBase58,
    );
    const result = await contract.methods.balanceOf(walletBase58).call();
    // tronweb returns a BigNumber-like for uint256; `.toString()` yields
    // the raw decimal digits; `BigInt(...)` of that yields the bigint.
    return BigInt(result.toString());
  } catch (e) {
    throw new TronRpcError(e);
  }
}

/**
 * Internal test surface — exposes `formatSunToTrx` + the sun-per-TRX
 * constant for direct regression coverage. NOT a production export;
 * consumers go through `getNativeBalance`. Mirror of `_solRpcInternals`
 * at `chains/solana/sol-rpc-client.ts:230-233`.
 */
export const _trxRpcInternals = {
  SUN_PER_TRX,
  formatSunToTrx,
};
