// src/chains/solana/marginfi.ts
//
// MarginFi account decoder + PDA-presence read (D-02). Phase 13 — Plan 13-02.
// Sibling of `src/protocols/solana-spl.ts` / `src/chains/solana/sol-rpc-client.ts`
// shape, with a `_marginfiChain` ESM-indirection object (CLAUDE.md — internal
// cross-export calls route through it so tests can `vi.spyOn`).
//
// DECODER (D-02 — decode-only, NO signing surface):
//   The MarginfiAccount layout is large + versioned; we decode it via the
//   Anchor `BorshCoder` built from the SDK's bundled `MARGINFI_IDL` (the
//   canonical account schema). We do NOT hand-roll buffer slicing (Don't
//   Hand-Roll).
//
//   SDK-vs-Anchor skew (VERIFIED at build time): the SDK's own
//   `MarginfiAccount.decodeAccountRaw(encoded, idl)` calls
//   `coder.accounts.decode("marginfiAccount", …)` (lowercased via the SDK's
//   `AccountType` enum), but Anchor 0.30's `BorshAccountsCoder` registers the
//   account under the IDL name `"MarginfiAccount"` (PascalCase) — so the SDK
//   wrapper throws "Account not found: marginfiAccount" with the vendored IDL.
//   We therefore decode Anchor-DIRECT via `coder.accounts.decode(
//   "MarginfiAccount", buffer)`, which is still the SDK's IDL schema (D-02
//   honored — decode-only, no signing) but bypasses the broken name-casing in
//   the SDK's convenience wrapper. The Anchor coder decodes to snake_case field
//   names (`lending_account`, `bank_pk`, `asset_shares`, `liability_shares`).
//
// FIXED-POINT SEAM (Pitfall 6 — no BN/Number leak): `asset_shares` /
// `liability_shares` are `WrappedI80F48` (16-byte little-endian i128, value =
// shares × 2^48). We convert to `bigint` native units (>> 48) IMMEDIATELY at
// this seam — no BN / decimal.js / Number flows downstream. Note: these are
// SHARE counts; resolving the exact token amount requires the bank's
// `asset_share_value` (a per-bank read). v2.0 surfaces the share-derived
// quantity; the full bank + oracle resolution for a priced health figure is a
// verify-phase enrichment (the health module consumes resolved quantities +
// prices + weights — D-07).

import { PublicKey } from "@solana/web3.js";
import { BorshCoder } from "@coral-xyz/anchor";
import { MARGINFI_IDL } from "@mrgnlabs/marginfi-client-v2";

import {
  deriveMarginfiAccountPda,
  getMarginfiGroup,
} from "../../config/contracts.js";
import { _solanaRegistry } from "./registry.js";
import { SolanaRpcError } from "./sol-rpc-client.js";

/**
 * The Anchor BorshCoder built from the SDK's `MARGINFI_IDL`. Module-level
 * (immutable after load) — the IDL is a constant schema. Decode-only (D-02).
 */
const coder = new BorshCoder(MARGINFI_IDL as never);

/** Anchor account name (PascalCase — the name the coder registers; see header). */
const MARGINFI_ACCOUNT_NAME = "MarginfiAccount" as const;

/** A single decoded MarginFi balance position (bigint at the seam — Pitfall 6). */
export interface MarginfiBalance {
  /** Bank pubkey, base58. */
  bank: string;
  /** Supplied (deposit) share count as native bigint (asset_shares, scale-stripped). */
  supplied: bigint;
  /** Borrowed (liability) share count as native bigint (liability_shares, scale-stripped). */
  borrowed: bigint;
}

/** Decoded MarginfiAccount — authority + group + active bank-keyed balances. */
export interface DecodedMarginfiAccount {
  authority: string;
  group: string;
  balances: MarginfiBalance[];
}

/**
 * Convert a `WrappedI80F48` (16-byte little-endian i128, value = units × 2^48)
 * to native `bigint` units (>> 48). Pure. Reads the `.value` byte array the
 * Anchor coder produces for the `WrappedI80F48` defined type.
 *
 * Two-arm input: the Anchor coder yields `{ value: number[] }`; defensive on a
 * `Buffer`/`Uint8Array` value too.
 */
function wrappedI80F48ToBigintUnits(wrapped: { value: number[] | Uint8Array }): bigint {
  const bytes = wrapped.value;
  let acc = 0n;
  // Little-endian: most-significant byte is last.
  for (let i = 15; i >= 0; i--) {
    acc = (acc << 8n) | BigInt(bytes[i] ?? 0);
  }
  // i128 sign handling: the top bit of byte[15] marks negativity. Share counts
  // are non-negative on-chain, but stay correct for any signed value.
  const SIGN_BIT = 1n << 127n;
  if (acc >= SIGN_BIT) acc -= 1n << 128n;
  // Strip the 2^48 fractional scale → native units (truncating toward zero).
  return acc / (1n << 48n);
}

/**
 * Decode a raw MarginfiAccount buffer (account data, discriminator-prefixed)
 * into authority + group + active bank-keyed bigint balances. Pure given the
 * buffer. Inactive balance slots (active === 0) are skipped.
 *
 * Decodes Anchor-direct (see module header) — D-02 decode-only.
 */
export function decodeMarginfiAccount(buffer: Buffer): DecodedMarginfiAccount {
  const decoded = coder.accounts.decode(MARGINFI_ACCOUNT_NAME, buffer) as {
    group: PublicKey;
    authority: PublicKey;
    lending_account: {
      balances: Array<{
        active: number;
        bank_pk: PublicKey;
        asset_shares: { value: number[] };
        liability_shares: { value: number[] };
      }>;
    };
  };

  const balances: MarginfiBalance[] = [];
  for (const bal of decoded.lending_account.balances) {
    // `active` is a u8; nonzero = in use.
    if (!bal.active) continue;
    balances.push({
      bank: bal.bank_pk.toBase58(),
      supplied: wrappedI80F48ToBigintUnits(bal.asset_shares),
      borrowed: wrappedI80F48ToBigintUnits(bal.liability_shares),
    });
  }

  return {
    authority: decoded.authority.toBase58(),
    group: decoded.group.toBase58(),
    balances,
  };
}

/**
 * RPC read of a raw account's data. Routes through `_solanaRegistry.getConnection`
 * so the upstream test seam (`vi.spyOn(_marginfiChain, "getRawAccountInfo")`)
 * never opens a live Connection. Returns `{ data }` when the account exists,
 * `null` when absent. Rethrows transient RPC failures as `SolanaRpcError`.
 */
async function getRawAccountInfo(
  pubkeyBase58: string,
): Promise<{ data: Buffer } | null> {
  try {
    const connection = _solanaRegistry.getConnection();
    const info = await connection.getAccountInfo(new PublicKey(pubkeyBase58));
    if (info === null) return null;
    return { data: Buffer.from(info.data) };
  } catch (err) {
    throw new SolanaRpcError(err);
  }
}

/**
 * Result of `getMarginfiAccountInfo`. Drives the D-03 hard-refuse gate in
 * 13-03: `present === false` → the prepare tool refuses with NO handle minted.
 */
export interface MarginfiAccountInfo {
  /** The derived MarginfiAccount PDA, base58. */
  pda: string;
  /** True when the PDA account exists on-chain. */
  present: boolean;
  /** Decoded positions when present; null when absent. */
  account: DecodedMarginfiAccount | null;
}

/**
 * Derive the MarginfiAccount PDA for `authority` (accountIndex 0 — the default
 * single account per authority) and RPC-read it. Present → decode + surface
 * positions. Absent → `{ present: false, account: null }` (the D-03 driver).
 *
 * NO live Connection in tests — the RPC read routes through
 * `_marginfiChain.getRawAccountInfo` (spied in tests).
 */
export async function getMarginfiAccountInfo(
  authority: string,
): Promise<MarginfiAccountInfo> {
  const pda = deriveMarginfiAccountPda(authority, 0);
  const raw = await _marginfiChain.getRawAccountInfo(pda);
  if (raw === null) {
    return { pda, present: false, account: null };
  }
  return {
    pda,
    present: true,
    account: _marginfiChain.decodeMarginfiAccount(raw.data),
  };
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. Internal cross-export calls
 * (`getMarginfiAccountInfo` → `getRawAccountInfo` / `decodeMarginfiAccount`)
 * route through this object so tests can `vi.spyOn(_marginfiChain, …)` to mock
 * the RPC boundary (NO live Connection) without monkey-patching named exports
 * (ESM bindings are immutable). The group getter is re-exported for
 * convenience; production callers resolve it via the SOT.
 */
export const _marginfiChain = {
  getRawAccountInfo,
  decodeMarginfiAccount,
  getMarginfiAccountInfo,
  getMarginfiGroup,
};
