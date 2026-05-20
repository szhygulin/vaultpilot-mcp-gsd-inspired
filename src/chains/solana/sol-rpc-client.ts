// src/chains/solana/sol-rpc-client.ts — Phase 11 Plan 11-02.
//
// Thin RPC wrapper around `@solana/web3.js@1.98.4`'s `Connection`. Three
// public helpers:
//
//   - `getNativeBalance(walletBase58)` — native SOL balance via
//     `Connection.getBalance`. Returns `{ lamports: bigint, sol: string }`
//     — `number` types never leak through to consumers (CLAUDE.md
//     decimal-string-at-the-boundary).
//   - `getSplTokenAccounts(walletBase58)` — SPL discovery via UNPARSED
//     `getTokenAccountsByOwner` + client-side `AccountLayout.decode`.
//     Returns `{ mint, amount, rawAccount }[]` rows. LOAD-BEARING: the
//     unparsed path is the only one the default public RPC supports.
//   - `getMintDecimals(mintBase58)` — single-RPC-round-trip decimals
//     lookup via `@solana/spl-token`'s `getMint`. Consumers in Plan 11-05
//     are responsible for caching the curated top-50 registry first.
//
// All three route their `Connection` access through
// `_solanaRegistry.getConnection()` — NEVER bare-import the connection
// (preserves the ESM spy seam for tests).
//
// **D-7 lock (LOAD-BEARING):** public RPCs (`api.mainnet-beta.solana.com`
// AND `solana.publicnode.com`) BOTH reject `getParsedTokenAccountsByOwner`
// with `-32601 Method not found`. SPL discovery MUST use UNPARSED
// `getTokenAccountsByOwner({ programId: TOKEN_PROGRAM_ID })` + client-side
// `AccountLayout.decode(Buffer.from(data, "base64"))`. DO NOT "fix" this
// back to the parsed method without re-probing both public RPCs — the
// silent-failure mode is that demo / zero-config installs error on first
// SPL discovery.

import { PublicKey } from "@solana/web3.js";
import {
  AccountLayout,
  TOKEN_PROGRAM_ID,
  getMint,
} from "@solana/spl-token";

import { _solanaRegistry } from "./registry.js";

/**
 * Solana RPC error envelope. Wraps all `Connection`-thrown errors with a
 * stable `errorCode` so tool handlers in Plan 11-05 can pattern-match
 * for the MCP error envelope without sniffing through nested SDK
 * exception types.
 *
 * Mirrors the v1.x error-class pattern at
 * `src/wallet/walletconnect-client.ts::MissingProjectIdError` (named
 * subclasses with a stable `errorCode` field).
 */
export class SolanaRpcError extends Error {
  readonly errorCode = "SOLANA_RPC_FAILED" as const;
  override readonly cause?: unknown;

  constructor(cause: unknown) {
    const causeMsg =
      cause instanceof Error ? cause.message : String(cause);
    super(`Solana RPC call failed: ${causeMsg}`);
    this.name = "SolanaRpcError";
    this.cause = cause;
  }
}

/**
 * Lamports → SOL conversion factor. 1 SOL = 1_000_000_000 lamports
 * (9 decimals, locked at the protocol level).
 */
const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Format `bigint` lamports as a decimal-string SOL amount. Pure —
 * deterministic on every input. Internal helper; the public surface
 * returns `{ lamports: bigint, sol: string }` so consumers don't pay the
 * formatting cost twice.
 *
 * Behavior:
 *   - `0n` → `"0"`
 *   - `1_000_000_000n` → `"1"`
 *   - `2_500_000_000n` → `"2.5"`
 *   - `1n` → `"0.000000001"`
 *   - Trailing zeros on the fractional part are trimmed; a fully-zero
 *     fractional part is dropped entirely (no trailing `.`).
 */
function formatLamportsToSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = lamports % LAMPORTS_PER_SOL;
  if (frac === 0n) return whole.toString();
  const fracPadded = frac.toString().padStart(9, "0");
  const fracTrimmed = fracPadded.replace(/0+$/, "");
  return `${whole.toString()}.${fracTrimmed}`;
}

/**
 * Read the native SOL balance for a wallet. Single-RPC round-trip.
 *
 * Returns `{ lamports: bigint, sol: string }`:
 *   - `lamports` is the on-chain `u64` widened to `bigint` (the SDK
 *     narrows the wire value to JS `number`; we widen back at this
 *     boundary so `number` cannot leak into JSON or downstream math —
 *     CLAUDE.md decimal-string-at-the-boundary).
 *   - `sol` is the decimal-string display value (e.g. `"2.5"` for
 *     2_500_000_000 lamports). Consumers pass this straight into the
 *     agent surface; no further formatting needed.
 *
 * Error envelope: rethrows as `SolanaRpcError` (errorCode
 * `SOLANA_RPC_FAILED`) on any failure — network error, invalid base58,
 * RPC-level error. The tool handler in Plan 11-05 translates this to the
 * MCP error envelope.
 */
export async function getNativeBalance(
  walletBase58: string,
): Promise<{ lamports: bigint; sol: string }> {
  try {
    const connection = _solanaRegistry.getConnection();
    const pubkey = new PublicKey(walletBase58);
    const lamportsNumber = await connection.getBalance(pubkey);
    const lamports = BigInt(lamportsNumber);
    return { lamports, sol: formatLamportsToSol(lamports) };
  } catch (e) {
    throw new SolanaRpcError(e);
  }
}

/**
 * Decoded SPL token account row. `mint` is the base58-encoded mint
 * pubkey (the discriminator across SPL tokens); `amount` is the raw
 * `u64` balance in mint-decimals (consumers in Plan 11-05 apply
 * decimals via the curated registry + `getMintDecimals` fallback).
 *
 * `rawAccount` is the 165-byte decoded `AccountLayout` buffer — kept on
 * the row so verify-phase / forensic flows can re-decode without a
 * second RPC round-trip.
 */
export interface SplTokenAccountRow {
  mint: string;
  amount: bigint;
  rawAccount: Buffer;
}

/**
 * Discover all SPL token accounts owned by a wallet. Single-RPC
 * round-trip + client-side decode loop.
 *
 * **UNPARSED PATH — D-7 LOAD-BEARING (research § Topic 5):**
 *
 * Both default public RPCs (`api.mainnet-beta.solana.com` AND
 * `solana.publicnode.com`) reject `getParsedTokenAccountsByOwner` with
 * `-32601 Method not found`. This function MUST use the UNPARSED
 * `getTokenAccountsByOwner({ programId: TOKEN_PROGRAM_ID })` API and
 * decode the base64 `account.data` client-side via
 * `AccountLayout.decode`.
 *
 * DO NOT "fix" this to the parsed method without re-probing both public
 * RPCs at the live cluster. Demo / zero-config installs depend on this
 * path working against the public fallback.
 *
 * Response-shape handling: the live RPC returns `account.data` as a
 * `["<base64>", "base64"]` tuple (research § Topic 6 verbatim probe). The
 * SDK may also surface it as a `Buffer` when the encoding is forced. We
 * handle BOTH shapes — `Buffer.isBuffer(data) ? data : Buffer.from(data[0], "base64")`
 * — so an SDK version bump or a private-RPC variant doesn't silently
 * break us.
 */
export async function getSplTokenAccounts(
  walletBase58: string,
): Promise<SplTokenAccountRow[]> {
  try {
    const connection = _solanaRegistry.getConnection();
    const owner = new PublicKey(walletBase58);
    const resp = await connection.getTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    });

    return resp.value.map(({ account }) => {
      const data = account.data as unknown;
      let raw: Buffer;
      if (Buffer.isBuffer(data)) {
        raw = data;
      } else if (
        Array.isArray(data) &&
        typeof data[0] === "string" &&
        data[1] === "base64"
      ) {
        raw = Buffer.from(data[0], "base64");
      } else {
        throw new Error(
          `Unexpected account.data shape from getTokenAccountsByOwner: ${JSON.stringify(data).slice(0, 80)}`,
        );
      }
      const decoded = AccountLayout.decode(raw);
      return {
        mint: new PublicKey(decoded.mint).toBase58(),
        amount: decoded.amount,
        rawAccount: raw,
      };
    });
  } catch (e) {
    throw new SolanaRpcError(e);
  }
}

/**
 * Look up an SPL mint's `decimals` via `@solana/spl-token`'s `getMint`.
 * Single-RPC round-trip — consumers in Plan 11-05 SHOULD short-circuit
 * via the curated top-50 mint registry first and only call this for
 * mints outside the registry.
 *
 * Decimals live on the Mint account, NOT on the Metaplex Token Metadata
 * PDA (research § Topic 6 — name/symbol/URI/creators live on the
 * metadata PDA; decimals are mint-level).
 *
 * Error envelope: rethrows as `SolanaRpcError` on network / RPC / decode
 * failure.
 */
export async function getMintDecimals(
  mintBase58: string,
): Promise<number> {
  try {
    const connection = _solanaRegistry.getConnection();
    const mintPubkey = new PublicKey(mintBase58);
    const mint = await getMint(connection, mintPubkey);
    return mint.decimals;
  } catch (e) {
    throw new SolanaRpcError(e);
  }
}

// Internal test surface — exposes `formatLamportsToSol` + the lamports
// constant for direct regression coverage. NOT a production export;
// consumers go through `getNativeBalance`.
export const _solRpcInternals = {
  LAMPORTS_PER_SOL,
  formatLamportsToSol,
};
