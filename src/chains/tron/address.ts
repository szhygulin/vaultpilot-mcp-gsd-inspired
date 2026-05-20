// src/chains/tron/address.ts — Phase 17 Plan 17-01.
//
// Pure helper module for TRON address + derivation-path manipulation. No
// SDK side effects beyond tronweb's static `utils.address` table (which
// runs in-process — no network).
//
// Three exports:
//
//   - `accountIndex(derivationPath)` — extracts the **account slot** (third
//     segment) from a 5-level BIP-44 path `m/44'/195'/<account>'/0/0`. The
//     `lastHardenedIndex(path)` helper in `src/tools/pair_solana_ledger.ts`
//     extracts the LAST segment, which on Solana's 3-level path IS the
//     account index, but on TRON's 5-level path is the address index
//     (`/0/0`) — always returning `"0"` for any account. Different
//     semantics, distinct helper.
//
//     **REGRESSION ANCHOR per research Pitfall 6**: if this implementation
//     ever regresses to `segments[segments.length - 1]`, the test
//     `accountIndex("44'/195'/3'/0/0") === "3"` fails — the regressed
//     helper returns `"0"`.
//
//   - `parseTronAddress(base58)` — delegates to
//     `TronWeb.utils.address.toHex` (returns the 0x41-prefixed 21-byte hex
//     string) and surfaces both hex + byte view for tests + Phase 18's
//     Protobuf `raw_data` work.
//
//   - `formatTronAddress(hex)` — delegates to
//     `TronWeb.utils.address.fromHex` (returns the base58check
//     T-prefixed string). Round-trip property
//     `formatTronAddress(parseTronAddress(addr).hex) === addr` proven in
//     tests.

import { utils as tronUtils } from "tronweb";

/**
 * Extract the account slot (third segment) from a 5-level BIP-44 path
 * `m/44'/195'/<account>'/0/0`. Tolerates a leading `"m/"` (the BIP-44
 * convention is `m/44'/195'/0'/0/0` — the `m/` is the master node
 * indicator; agents may or may not include it).
 *
 * Strips a trailing hardening apostrophe (e.g. `"0'"` → `"0"`).
 *
 * Defensive: returns the raw derivationPath string when the split shape
 * is unexpected (fewer than 3 segments after stripping `m/`). No throw —
 * the call site is template substitution; a defensive raw-return keeps
 * the verify-on-device block readable even on a malformed input rather
 * than killing the whole tool response.
 *
 * **REGRESSION ANCHOR per research Pitfall 6**: a reuse of
 * `lastHardenedIndex` from `src/tools/pair_solana_ledger.ts` on a TRON
 * path returns `"0"` from `"44'/195'/3'/0/0"` — that helper extracts
 * `segments[segments.length - 1]` (the address index), NOT
 * `segments[2]` (the account slot). The test
 * `accountIndex("44'/195'/3'/0/0") === "3"` fails loudly if this
 * implementation regresses to the segments-last shape.
 */
export function accountIndex(derivationPath: string): string {
  const stripped = derivationPath.startsWith("m/")
    ? derivationPath.slice(2)
    : derivationPath;
  const segments = stripped.split("/");
  if (segments.length < 3) return derivationPath;
  const raw = segments[2];
  if (raw === undefined) return derivationPath;
  return raw.endsWith("'") ? raw.slice(0, -1) : raw;
}

/**
 * Parse a base58check TRON address into its 0x41-prefixed hex form +
 * raw byte view. Delegates byte-decoding to `TronWeb.utils.address.toHex`
 * — NEVER hand-roll base58check (research § Topic 4 + Pitfall 4).
 *
 * Phase 18 needs the hex form for Protobuf `raw_data` assembly; Phase 17
 * exposes the byte view so tests can anchor against the hardcoded literal
 * `"41a614f803b6fd780986a42c78ec9c7f77e6ded13c"` (USDT-TRC20 contract,
 * verified live in research § Topic 4).
 */
export function parseTronAddress(base58: string): {
  hex: string;
  bytes: Uint8Array;
} {
  const hex = tronUtils.address.toHex(base58);
  // tronweb returns lowercase hex without a `0x` prefix; the 21-byte
  // payload encodes as 42 hex chars.
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return { hex, bytes };
}

/**
 * Format a 0x41-prefixed hex TRON address as its base58check
 * representation. Delegates byte-encoding to
 * `TronWeb.utils.address.fromHex` (research § Topic 4).
 *
 * Round-trip property:
 * `formatTronAddress(parseTronAddress(addr).hex) === addr`.
 */
export function formatTronAddress(hex: string): string {
  return tronUtils.address.fromHex(hex);
}
