// src/chains/tron/types.ts — Phase 17 Plan 17-01.
//
// Branded type aliases for TRON wallet addresses + TRC-20 contract
// addresses. Mirror of `src/chains/solana/types.ts` shape, but adapted to
// TRON's base58check encoding:
//
//   - 21-byte payload (0x41 prefix + 20-byte hex address); base58check
//     encodes to a fixed 34-character string starting with `"T"`.
//   - Distinct from Solana's 32-byte ed25519 pubkeys (32-44 base58 chars)
//     AND from EVM `0x`-prefixed 20-byte hex.
//
// Two-gate validation per research § Topic 4 + Pitfall 4: the regex is a
// cheap synchronous first-line gate; `TronWeb.utils.address.isAddress`
// runs the full base58check + checksum + 0x41-prefix validation. NEVER
// use regex alone — regex misses bad-checksum input (the corrupted-last-
// char of a valid address still passes the regex; the checksum check
// catches it).
//
// `TronContractAddress` is a distinct brand so a wallet cannot be passed
// where a TRC-20 contract is expected (or vice versa) — compile-time
// rejection. The byte-encoding is identical to `TronAddress`; only the
// type brand differs.

import { utils as tronUtils } from "tronweb";

/**
 * Branded base58check TRON wallet address. 34 chars, T-prefixed. Functions
 * that require a validated address accept `TronAddress`, not `string` —
 * the brand enforces an `assertTronAddress` checkpoint at the type
 * boundary. Mirror of `SolanaAddress` at `chains/solana/types.ts`.
 */
export type TronAddress = string & { readonly __brand: "tron-address" };

/**
 * Branded base58check TRC-20 contract address. Same byte-encoding as
 * `TronAddress`, but a distinct brand so a wallet address cannot be
 * passed where a TRC-20 contract is expected. Plan 17-04 ships the curated
 * registry which produces `TronContractAddress`-branded values.
 */
export type TronContractAddress = string & {
  readonly __brand: "tron-contract-address";
};

/**
 * TRON base58check shape: leading `T`, then 33 base58 characters (the
 * base58 alphabet excludes the ambiguous glyphs `0OIl`). 34 chars total.
 *
 * Verified via live USDT-TRC20 probe `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`
 * in research § Topic 4. Anchored full-string match — falsy on leading or
 * trailing whitespace; the agent boundary trims at JSON parse so anything
 * reaching this gate with whitespace is a contract violation.
 */
export const TRON_ADDRESS_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/**
 * Assert a value is a syntactically-and-semantically valid TRON address.
 * Two-gate check (research § Topic 4 + Pitfall 4 REGRESSION ANCHOR):
 *
 *   1. Regex gate — fast-path syntactic shape (T-prefix + 33 base58 chars).
 *   2. `TronWeb.utils.address.isAddress(s)` — full base58check + checksum
 *      + 0x41-prefix validation. The corrupted-last-char of a valid address
 *      passes the regex; ONLY this gate catches the bad checksum.
 *
 * Throws `TypeError` on either gate failure; on success the type narrows
 * to `TronAddress` so downstream `string` callers can pass through
 * type-safely.
 */
export function assertTronAddress(s: unknown): asserts s is TronAddress {
  if (typeof s !== "string" || !TRON_ADDRESS_RE.test(s)) {
    throw new TypeError(
      `Not a valid TRON address: ${typeof s === "string" ? `"${s}"` : String(s)} does not match T-prefixed 34-char base58 shape`,
    );
  }
  if (!tronUtils.address.isAddress(s)) {
    throw new TypeError(
      `Not a valid TRON address: "${s}" failed base58check/checksum validation`,
    );
  }
}

/**
 * Distinct-brand sibling for TRC-20 contract addresses. Same byte-shape
 * as `assertTronAddress`; the brand carved here means a wallet address
 * cannot be passed where a contract is expected. Plan 17-04 ships the
 * `tron-top-25.ts` registry which produces `TronContractAddress` values.
 */
export function assertTronContractAddress(
  s: unknown,
): asserts s is TronContractAddress {
  if (typeof s !== "string" || !TRON_ADDRESS_RE.test(s)) {
    throw new TypeError(
      `Not a valid TRON contract address: ${typeof s === "string" ? `"${s}"` : String(s)} does not match T-prefixed 34-char base58 shape`,
    );
  }
  if (!tronUtils.address.isAddress(s)) {
    throw new TypeError(
      `Not a valid TRON contract address: "${s}" failed base58check/checksum validation`,
    );
  }
}
