// src/protocols/bridge-decoders/index.ts — Phase 39 Plan 39-01 (BRIDGE-T1-06 skeleton).
//
// Tier-1 bridge selector→decoder registry for preview_send Layer 0.6 (Inv #6b EVM path).
//
// This file is the central dispatch point: given EVM calldata, it looks up
// the 4-byte selector in the TIER1_DECODERS map and delegates to the matching
// per-bridge decoder. Decoders extract the final-recipient field from the
// bridge calldata so preview_send can assert decoded === user-supplied.
//
// In Plan 39-01, TIER1_DECODERS is EMPTY — the registry skeleton exists but
// returns { kind: "no-match" } for every input. Plan 39-02 populates it with
// four decoders:
//   - Wormhole Token Bridge   (0xc5a5ebda — transferTokensWithPayload)
//   - Mayan Swift ETH entry   (0xb866e173 — createOrderWithEth)
//   - Mayan Swift token entry (0x8e8d142b — createOrderWithToken)
//   - NEAR OmniBridge         (0xdeb915b8 — initTransfer)
//   - Across V3 SpokePool     (0x7b939232 — depositV3)
//
// The registry is extensible for Tier-2 decoders (deBridge, Stargate, Hop,
// etc.) in Phase 40+ by adding entries to TIER1_DECODERS.
//
// ESM spy-affordance: `_bridgeTier1Decoders` is the mutable indirection object
// that preview_send.ts routes through, so tests can:
//   `vi.spyOn(_bridgeTier1Decoders, "decodeBridgeTier1FacetRecipient")`
// ESM named-export bindings are immutable; direct spies on named exports are
// no-ops for internal calls (CLAUDE.md Conventions).

import type { Hex } from "viem";

// ─── BridgeFacetDecodeResult ─────────────────────────────────────────────────

/**
 * Discriminated union result from the Tier-1 bridge facet decoder registry.
 *
 *   - `ok`       — Selector matched a known Tier-1 bridge; `finalRecipient` is
 *                  the address/account extracted from calldata. `bridge` is the
 *                  human-readable bridge name (e.g. "Across V3").
 *   - `no-match` — Selector did not match any registered Tier-1 bridge decoder
 *                  (or calldata was too short). Layer 0.6 passes through silently.
 *   - `error`    — Selector matched but ABI decode failed or normalization is
 *                  unsupported for the detected destination chain. Layer 0.6
 *                  converts this to a DECODED_RECIPIENT_DRIFT refusal.
 */
export type BridgeFacetDecodeResult =
  | { kind: "ok"; bridge: string; finalRecipient: string }
  | { kind: "no-match" }
  | { kind: "error"; bridge: string; message: string };

// ─── Internal decoder registry ───────────────────────────────────────────────

/**
 * Internal (NOT exported) map from 4-byte selector (lowercase, 0x-prefixed)
 * to a per-bridge decode function.
 *
 * In Plan 39-01 this map is EMPTY — `decodeBridgeTier1FacetRecipient` returns
 * `{ kind: "no-match" }` for every input.
 *
 * Plan 39-02 registers decoders here:
 */
// Plan 39-02 registers decoders here
const TIER1_DECODERS: ReadonlyMap<string, (data: Hex) => BridgeFacetDecodeResult> = new Map<
  string,
  (data: Hex) => BridgeFacetDecodeResult
>();

// ─── decodeBridgeTier1FacetRecipient ─────────────────────────────────────────

/**
 * Dispatch EVM calldata to the matching Tier-1 bridge decoder, extract the
 * final-recipient field, and return a typed result.
 *
 * Called by `preview_send` Layer 0.6 (Plan 39-03) on every EVM contract call
 * (data !== "0x") to check whether the calldata encodes a Tier-1 bridge
 * transfer with a spoofed recipient.
 *
 * Selector extraction: `data.slice(0, 10).toLowerCase()` — 10 chars = "0x" +
 * 8 hex digits = 4-byte function selector. Case-normalised so UPPERCASE
 * calldata (e.g. from some encoders) hits the same map entry.
 *
 * NEVER throws — all error paths return `{ kind: "error" | "no-match" }` to
 * satisfy the WR-02 NEVER-throws convention (decoders wrapped in try/catch
 * in their own modules).
 */
export function decodeBridgeTier1FacetRecipient(data: Hex): BridgeFacetDecodeResult {
  // Guard: calldata must be at least 10 characters ("0x" + 8 hex digits = 4-byte selector).
  if (data === "0x" || data.length < 10) {
    return { kind: "no-match" };
  }

  const selector = data.slice(0, 10).toLowerCase();
  const decoder = TIER1_DECODERS.get(selector);

  if (!decoder) {
    return { kind: "no-match" };
  }

  return decoder(data);
}

// ─── ESM spy-affordance seam ─────────────────────────────────────────────────

/**
 * ESM indirection object for `vi.spyOn` in tests (CLAUDE.md Conventions).
 *
 * `preview_send` (Plan 39-03) imports and calls
 * `_bridgeTier1Decoders.decodeBridgeTier1FacetRecipient(data)` rather than
 * the named export directly. This allows tests to intercept the call via:
 *
 *   `vi.spyOn(_bridgeTier1Decoders, "decodeBridgeTier1FacetRecipient")`
 *
 * Without this indirection, `vi.spyOn` on a named ESM export is a no-op
 * because ESM named-export bindings are immutable (see RESEARCH §Pitfall 7).
 */
export const _bridgeTier1Decoders = { decodeBridgeTier1FacetRecipient };
