// src/chains/bittensor/types.ts — Phase 46 Plan 46-01.
//
// Branded `Ss58Address` + the prefix-42 checksum gate. The agent boundary
// passes raw `wallet` strings into the read tools (46-03); this module is
// the V5 Input Validation gate that rejects wrong-prefix / look-alike /
// bad-checksum addresses BEFORE any RPC round-trip (T-46-01 Spoofing
// mitigation).
//
// SS58 has a prefix-dependent blake2-256 checksum — hand-rolling base58check
// silently accepts wrong-prefix addresses (CLAUDE.md "Don't Hand-Roll").
// The full-checksum gate is `@polkadot/util-crypto`'s `decodeAddress`,
// which throws on a malformed / bad-checksum string. We do NOT pass the
// optional `ss58Format` arg to `decodeAddress` (it would accept any prefix
// then re-encode); instead we accept any structurally-valid SS58 the
// device could produce and rely on the device-displayed SS58 as the
// trusted display (the prefix-42 encode is proven deterministic by the
// hardcoded vectors in test/chains-bittensor-ss58.test.ts).

import { decodeAddress } from "@polkadot/util-crypto";

/**
 * Bittensor SS58 network prefix. Subtensor coldkeys encode to the "5…"
 * canonical Substrate shape under prefix 42 (milestone-locked decision;
 * RESEARCH §User Constraints). The device returns the address pre-encoded
 * under this prefix via `getAddressEd25519(path, 42)`.
 */
export const BITTENSOR_SS58_PREFIX = 42;

/**
 * Canonical Bittensor SS58 shape. Prefix-42 addresses encode to a base58
 * string beginning with "5" (the standard Substrate generic-prefix shape),
 * 47-48 chars. This regex is a cheap schema-level pre-filter; the
 * authoritative gate is `assertSs58Address` (full blake2 checksum).
 */
export const SS58_ADDRESS_RE = /^5[1-9A-HJ-NP-Za-km-z]{46,47}$/;

/**
 * Branded SS58 address. A plain string nominal-typed so a raw `string`
 * cannot be passed where a checksum-validated address is required —
 * forces callers through `assertSs58Address`. Mirror of the viem
 * `Address` branding intent (a validated value, not any string).
 */
export type Ss58Address = string & { readonly __brand: "Ss58Address" };

/**
 * Full-checksum SS58 validation gate. Throws on a wrong-checksum /
 * look-alike / malformed address (V5 Input Validation; T-46-01). On
 * success, returns the input narrowed to the branded `Ss58Address` type.
 *
 * `decodeAddress` performs the prefix-dependent blake2-256 checksum
 * verification — a single-byte flip in the address fails here, before any
 * RPC. Call this in every read handler before the round-trip.
 */
export function assertSs58Address(addr: string): Ss58Address {
  // decodeAddress throws on malformed / bad-checksum input. We do not
  // suppress — the throw IS the rejection (the caller wraps it into the
  // MCP error envelope).
  decodeAddress(addr);
  return addr as Ss58Address;
}
