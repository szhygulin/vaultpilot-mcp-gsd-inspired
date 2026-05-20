// src/chains/solana/types.ts — Phase 11 Plan 11-02.
//
// Branded type aliases for Solana addresses + mint pubkeys. Mirrors viem's
// `Address` brand pattern — runtime values are plain strings, but the type
// system rejects ad-hoc string passing without a validation step
// (`assertSolanaAddress`). Keeps Solana / EVM namespaces type-safely
// distinct: a `SolanaAddress` cannot be passed where the EVM `Address`
// (`0x`-prefixed hex-checksum) is expected, and vice versa.
//
// Solana addresses are base58-encoded ed25519 pubkeys (32 bytes raw → 32-44
// base58 chars). The base58 alphabet excludes ambiguous glyphs `0OIl`,
// matching the standard Bitcoin alphabet — same regex the Solana
// foundation's web tooling uses for client-side validation. Server-side
// final validation still happens via `new PublicKey(...)` (the SDK's
// constructor performs the full byte-length + curve-point check); the
// regex is the fast first-line gate that lets agent input fail before we
// pay an exception unwind through the SDK.

/**
 * Branded base58 Solana wallet address (32-byte ed25519 pubkey, encoded as
 * 32-44 base58 chars). Functions that require a validated address accept
 * `SolanaAddress`, not `string` — the brand enforces an
 * `assertSolanaAddress` checkpoint at the type boundary.
 *
 * Mirrors the viem `Address` brand at `src/config/contracts.ts` (which
 * uses `getAddress(...)` as its validation gate).
 */
export type SolanaAddress = string & { readonly __brand: "solana-address" };

/**
 * Branded base58 SPL mint address. Same byte-encoding as `SolanaAddress`,
 * but a distinct brand so a wallet address cannot be passed where a mint
 * pubkey is expected (or vice versa). Plan 11-05 introduces the mint
 * registry that produces `SolanaMint`-branded values.
 */
export type SolanaMint = string & { readonly __brand: "solana-mint" };

/**
 * Base58 character class minus the Bitcoin-style ambiguous glyphs `0OIl`,
 * length-bounded to the 32-44-char range Solana ed25519 pubkeys produce.
 *
 * Anchored regex — full-string match. Falsy on leading/trailing whitespace
 * (the agent boundary trims at JSON parse, so anything reaching this gate
 * with whitespace is a contract violation, not a UX problem to paper
 * over).
 */
export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Assert a string is a syntactically-valid Solana address (base58 + length
 * range). Throws on miss — `assertSolanaAddress(s)` is `void` on success
 * and `never` on failure, so the type narrowing flows.
 *
 * NOT a full validation — does NOT confirm the bytes decode to a
 * curve-point. Production callers run this regex gate first (cheap,
 * synchronous), then pass to `new PublicKey(s)` in the SDK (which does the
 * full check). The regex is a first-line filter to reject obviously-bad
 * input before paying the exception cost.
 */
export function assertSolanaAddress(s: string): asserts s is SolanaAddress {
  if (!SOLANA_ADDRESS_RE.test(s)) {
    throw new Error(
      `Invalid Solana address: "${s}" does not match base58 32-44 char shape`,
    );
  }
}
