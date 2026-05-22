// src/config/bitcoin-core-env.ts — Phase 27 Plan 27-01 (BTC-FORENSIC-01).
//
// Environment-variable readers for Bitcoin Core RPC and Litecoin Core RPC
// configuration. Mirrors the `getSolanaRpcUrl()` / `getTronRpcUrl()` shape
// in `src/config/env.ts` (lines 79–126).
//
// Security constraint (T-27-CORE-CRED-LEAK mitigation):
//   Credentials (BITCOIN_CORE_RPC_USER, BITCOIN_CORE_RPC_PASS,
//   LITECOIN_CORE_RPC_USER, LITECOIN_CORE_RPC_PASS) are consumed only by
//   `bitcoin-core-rpc.ts` internally; they NEVER appear in tool responses
//   or logs. The URL readers return string | null so consumers can gate
//   on null without leaking the URL itself in tool output.
//
// Note: this file is SELF-CONTAINED. The private `read()` helper is a
// copy of the one in `src/config/env.ts` (lines 31–36) — deliberately
// not cross-imported to keep credential-handling code colocated with the
// audit narrative for this threat surface.

// ─── Private helper ───────────────────────────────────────────────────────────

/**
 * Read a process.env variable, trim whitespace, and return undefined for
 * empty or missing values. Mirrors `read()` in src/config/env.ts verbatim.
 */
function read(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

// ─── Bitcoin Core RPC ─────────────────────────────────────────────────────────

/**
 * Returns the Bitcoin Core RPC base URL from BITCOIN_CORE_RPC_URL.
 * Returns null (not undefined) so callers can pattern-match with `=== null`.
 * Trims whitespace and returns null for empty or missing values.
 *
 * NEVER surface this value in tool responses or logs
 * (T-27-CORE-CRED-LEAK mitigation).
 */
export function getBitcoinCoreRpcUrl(): string | null {
  return read("BITCOIN_CORE_RPC_URL") ?? null;
}

/**
 * Returns the Bitcoin Core RPC username from BITCOIN_CORE_RPC_USER.
 * Returns undefined (not null) so the `user !== undefined` gate in
 * `callBitcoinCoreRpc` composes cleanly with the Basic-auth header logic.
 *
 * NEVER surface this value in tool responses or logs
 * (T-27-CORE-CRED-LEAK mitigation).
 */
export function getBitcoinCoreRpcUser(): string | undefined {
  return read("BITCOIN_CORE_RPC_USER");
}

/**
 * Returns the Bitcoin Core RPC password from BITCOIN_CORE_RPC_PASS.
 * Returns undefined (not null) — same semantics as getBitcoinCoreRpcUser().
 *
 * NEVER surface this value in tool responses or logs
 * (T-27-CORE-CRED-LEAK mitigation).
 */
export function getBitcoinCoreRpcPass(): string | undefined {
  return read("BITCOIN_CORE_RPC_PASS");
}

// ─── Litecoin Core RPC (Phase 27 Plan 27-02 consumers) ───────────────────────

/**
 * Returns the Litecoin Core RPC base URL from LITECOIN_CORE_RPC_URL.
 * Same shape as getBitcoinCoreRpcUrl().
 */
export function getLitecoinCoreRpcUrl(): string | null {
  return read("LITECOIN_CORE_RPC_URL") ?? null;
}

/**
 * Returns the Litecoin Core RPC username from LITECOIN_CORE_RPC_USER.
 * Same shape as getBitcoinCoreRpcUser().
 */
export function getLitecoinCoreRpcUser(): string | undefined {
  return read("LITECOIN_CORE_RPC_USER");
}

/**
 * Returns the Litecoin Core RPC password from LITECOIN_CORE_RPC_PASS.
 * Same shape as getBitcoinCoreRpcPass().
 */
export function getLitecoinCoreRpcPass(): string | undefined {
  return read("LITECOIN_CORE_RPC_PASS");
}
