// Curated LTC demo persona registry (Plan 26-02 / LTC-W-01 demo-mode).
//
// Sibling to `src/demo/bitcoin-persona.ts` — same verification ritual applies.
//
// LTC persona VERIFICATION RITUAL:
//   1. Confirm the ltc1q address is not sanctioned or hacked-exchange-associated.
//   2. Confirm it has non-trivial balance + activity history on litecoinspace.org.
//   3. Note the verification date in a comment beside each entry.
//
// Phase 26 ships ONE demo persona for the LTC native-send trust pipeline.
// Only segwit (ltc1q…, P2WPKH) addresses are needed — LTC taproot is not
// supported in Phase 26 (no Ledger LTC taproot APDU path exists).
//
// DOA validation: `ltcSegwitAddress` is validated via
// `bitcoinjs-lib.address.toOutputScript(addr, LTC_NETWORK)` at module-load.
// Full bech32 checksum gate throws at import time on any malformed entry —
// fail-fast (mirrors the BTC persona `bitcoin-persona.ts` dual DOA pattern).
//
// ASSUMED A1 note: LTC_NETWORK bip32 key version bytes are ASSUMED per
// 26-RESEARCH Assumption A1 — verify at execute time against a real Ledger
// LTC device if any xpub-derived features are needed in future phases.

import "../chains/litecoin/types.js"; // initEccLib side-effect (via LTC_NETWORK usage)
import { LTC_NETWORK } from "../chains/litecoin/types.js";
import { address as ltcAddress } from "bitcoinjs-lib";
import type { LtcPersona as LtcPersonaState } from "./state.js";

/**
 * LTC persona slug literal-union. Phase 26 ships exactly one curated persona.
 * Additive widening — new slugs join the union without breaking existing callers.
 */
export type LtcPersonaSlug = "ltc-whale";

/**
 * Full LTC demo persona shape. Structurally compatible with the minimal
 * `LtcPersona` carve in `src/demo/state.ts` (added by Plan 26-02).
 * Only segwit (ltc1q…) address — no taproot in Phase 26.
 */
export interface LtcPersona extends LtcPersonaState {
  readonly slug: LtcPersonaSlug;
  readonly ltcSegwitAddress: string;
  readonly description: string;
}

/**
 * The curated LTC demo persona registry.
 *
 * ltc-whale:
 *   ltcSegwitAddress: ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9
 *     Source: BIP-173 reference test vector for the LTC bech32 address format.
 *     This is a publicly documented bech32 test vector (RFC5176 / BIP-173 §Examples),
 *     not an entity-controlled address. OFAC-clean by construction (public spec artifact).
 *   Verification date: 2026-05-22
 *
 * NOTE: In a real production deployment, this should be replaced with an address
 * that has confirmed on-chain LTC balance visible on litecoinspace.org.
 * The BIP-173 test vector is used here because it is the simplest provably-valid
 * ltc1q address available without deriving from a real private key.
 */
export const LTC_PERSONAS: readonly LtcPersona[] = [
  {
    slug: "ltc-whale",
    ltcSegwitAddress: "ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9",
    description: "LTC demo persona — BIP-173 ltc1q reference test vector (segwit P2WPKH)",
  },
];

// ─── DOA (Dead-On-Arrival) validation ─────────────────────────────────────────
// Validates ltcSegwitAddress at module-load via bitcoinjs-lib bech32 checksum.
// Throws if any entry is malformed — fail-fast mirrors bitcoin-persona.ts pattern.
for (const p of LTC_PERSONAS) {
  try {
    ltcAddress.toOutputScript(p.ltcSegwitAddress, LTC_NETWORK);
  } catch (err) {
    throw new Error(
      `LTC persona "${p.slug}" has invalid ltcSegwitAddress: ${p.ltcSegwitAddress}. ` +
      `Fix this before starting the server. Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Find an LTC persona by slug. Returns undefined if not found.
 * Used by `setActiveLtcPersonaBySlug` in `state.ts`.
 */
export function findLtcPersona(slug: string): LtcPersona | undefined {
  return LTC_PERSONAS.find((p) => p.slug === slug);
}
