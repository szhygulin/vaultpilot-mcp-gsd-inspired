// Process-local active-persona state (Plan 05-01 / DEMO-04).
//
// Module-scoped `let activePersona` mutated only via `setActivePersona`.
// State is PROCESS-LOCAL by construction — no disk persistence; a process
// restart drops the active persona. T-NO-PERSIST-1 (research § STRIDE) is
// accepted-as-correct-by-design rather than mitigated.
//
// Consumers (Plan 05-02 + 05-03):
//   - Plan 05-02's `prepare_native_send` reads `getActivePersona()?.address`
//     to set the `from` field when demo mode is active.
//   - Plan 05-02's `send_transaction` reads `getActivePersona()?.address`
//     as the `account` arg to viem's `call()` for the demo simulation arm.
//
// Producer:
//   - `src/tools/set_demo_wallet.ts` calls `setActivePersona(slug)` after
//     the `WRONG_MODE` + `INVALID_INPUT` gates pass.
//   - `src/config/env.ts::resolveDemoMode()` seeds `whale` as a side
//     effect on the auto-demo arm (Q-AUTO-DEMO-PERSONA-DEFAULT lock) so
//     the first read tool call works out of the box.

import { findBittensorPersona } from "./bittensor-persona.js";
import { findBtcPersona } from "./bitcoin-persona.js";
import { findLtcPersona } from "./litecoin-persona.js";
import { PERSONAS, type Persona } from "./personas.js";
import { findSolanaPersona } from "./solana-persona.js";
import { findTronPersona } from "./tron-persona.js";

/**
 * Phase 11 — Plan 11-05 carve. The full `SolanaPersona` interface +
 * registry ship in Plan 11-06 (`src/demo/solana-persona.ts`); Plan 11-05
 * defines the minimal shape here so the `get_portfolio_summary` Solana
 * leg's demo-mode address resolver (per 11-PLAN-CHECK § FLAG-3) compiles
 * against a stable contract. Plan 11-06 widens the `slug` literal-union
 * + adds the rehearsable-flows array; the `solanaAddress` field is the
 * load-bearing contract for the resolver.
 */
export interface SolanaPersona {
  readonly slug: string;
  /** Base58-encoded Solana wallet address. */
  readonly solanaAddress: string;
  readonly description?: string;
}

/**
 * Phase 17 — Plan 17-04 carve. The full `TronPersona` interface +
 * registry ship in Plan 17-05 (`src/demo/tron-persona.ts`); Plan 17-04
 * defines the minimal shape here so the `get_portfolio_summary` TRON
 * leg's demo-mode address resolver compiles against a stable contract
 * before 17-05 lands. Mirror of the 11-05 → 11-06 Solana split:
 * 11-05 added the minimal `SolanaPersona` shape + `activeSolanaPersona`
 * state to this file so the Solana resolver compiled before 11-06's
 * registry. Plan 17-05 widens the slug literal-union via its own
 * `setActiveTronPersona`/`setActiveTronPersonaBySlug` setters (additive).
 */
export interface TronPersona {
  readonly slug: string;
  /** Base58check-encoded TRON wallet address (T-prefixed, 34 chars). */
  readonly tronAddress: string;
  readonly description?: string;
}

/**
 * Phase 26 — Plan 26-02 carve. The full `LtcPersona` interface +
 * registry ship in `src/demo/litecoin-persona.ts`; this file defines the
 * minimal shape so `prepare_litecoin_native_send`'s demo-mode address
 * resolver compiles against a stable contract. Mirrors the BTC carve pattern
 * (Plan 22-04). LTC only carries ONE address (ltc1q segwit P2WPKH) —
 * no taproot in Phase 26.
 */
export interface LtcPersona {
  readonly slug: string;
  /** bech32-encoded segwit (P2WPKH) LTC address — ltc1q prefix, 43 chars. */
  readonly ltcSegwitAddress: string;
  readonly description?: string;
}

/**
 * Phase 22 — Plan 22-04 carve. The full `BtcPersona` interface +
 * registry ship in `src/demo/bitcoin-persona.ts`; this file defines the
 * minimal shape so `set_demo_wallet`'s BTC slug routing compiles against
 * a stable contract. Plan 22-04's `setActiveBtcPersona` accepts any
 * value matching this carved shape; `bitcoin-persona.ts` hands it
 * values from `BTC_PERSONAS` which satisfy both. Mirror of the 17-04
 * TRON carve. BTC carries TWO addresses (segwit + taproot) — both are
 * load-bearing for the dual-address PAIR-NEV-* multi-record-per-chain
 * surface.
 */
export interface BtcPersona {
  readonly slug: string;
  /** bech32-encoded segwit (P2WPKH) address — bc1q prefix, 42 chars. */
  readonly btcSegwitAddress: string;
  /** bech32m-encoded taproot (P2TR) address — bc1p prefix, 62 chars. */
  readonly btcTaprootAddress: string;
  readonly description?: string;
}

/**
 * Phase 46 — Plan 46-01 carve. The full `BittensorPersona` interface +
 * registry ship in `src/demo/bittensor-persona.ts`; this file defines the
 * minimal shape so `set_demo_wallet`'s Bittensor slug routing + the
 * read-tool demo-mode address resolvers compile against a stable contract.
 * Mirror of the 11-05 → 11-06 Solana split. The `bittensor-persona.ts`
 * registry uses `import type` for this interface, so there is no runtime
 * import cycle from this file's import of `findBittensorPersona`.
 */
export interface BittensorPersona {
  readonly slug: string;
  /** Prefix-42 SS58 coldkey. */
  readonly ss58Address: string;
  readonly description?: string;
}

let activePersona: Persona | null = null;
let activeSolanaPersona: SolanaPersona | null = null;
let activeTronPersona: TronPersona | null = null;
let activeBtcPersona: BtcPersona | null = null;
let activeLtcPersona: LtcPersona | null = null;
let activeBittensorPersona: BittensorPersona | null = null;

/**
 * Returns the currently active persona, or `null` if none has been set.
 * Used by Plan 05-02's prepare/preview/send tools to source the `from`
 * address in demo mode, and by Plan 05-03's `get_vaultpilot_config_status`
 * to surface the active slug to the agent.
 */
export function getActivePersona(): Persona | null {
  return activePersona;
}

/**
 * Activate a persona by slug. Throws on unknown slug as defense-in-depth
 * behind the JSON-Schema enum gate at `src/tools/set_demo_wallet.ts` —
 * unreachable in production through the MCP protocol boundary, but
 * defensible when called from tests or from a hypothetical future caller.
 */
export function setActivePersona(slug: Persona["slug"]): Persona {
  const persona = PERSONAS.find((p) => p.slug === slug);
  if (!persona) {
    throw new Error(`unknown persona slug: ${String(slug)}`);
  }
  activePersona = persona;
  return persona;
}

/**
 * Returns the currently active Solana persona, or `null` if none has been
 * set. Phase 11 Plan 11-05 surface; Plan 11-06 wires the registry +
 * `set_demo_wallet` setter. Consumed by `get_portfolio_summary`'s
 * `resolveSolanaWalletForFanOut` (per 11-PLAN-CHECK § FLAG-3 — demo-mode
 * fallback path when no paired Solana record is in the account store).
 */
export function getActiveSolanaPersona(): SolanaPersona | null {
  return activeSolanaPersona;
}

/**
 * Activate a Solana persona. Phase 11 Plan 11-06 surface — the setter is
 * exposed here so Plan 11-05's resolver can compile against a stable
 * `getActiveSolanaPersona()` contract before Plan 11-06 lands the
 * `set_demo_wallet` widening.
 *
 * Defense-in-depth shape: throws if `persona` is falsy. The persona
 * registry validation lives in `src/demo/solana-persona.ts` (Plan 11-06);
 * this function is the registry-agnostic state setter.
 */
export function setActiveSolanaPersona(persona: SolanaPersona): SolanaPersona {
  if (!persona || typeof persona.solanaAddress !== "string") {
    throw new Error("setActiveSolanaPersona: persona must have a solanaAddress");
  }
  activeSolanaPersona = persona;
  return persona;
}

/**
 * Activate a Solana persona by slug — Plan 11-06 surface. Resolves the
 * slug against the `SOLANA_PERSONAS` registry in
 * `src/demo/solana-persona.ts`, then delegates to `setActiveSolanaPersona`.
 *
 * Throws on unknown slug as defense-in-depth behind the JSON-Schema enum
 * gate at `src/tools/set_demo_wallet.ts` — unreachable in production
 * through the MCP protocol boundary, but defensible when called from
 * tests or from a hypothetical future caller. Mirrors the EVM
 * `setActivePersona(slug)` shape (line 58).
 *
 * The `solana-persona.ts` registry uses `import type` for `SolanaPersona`,
 * so there's no runtime cycle from this file's import of `findSolanaPersona`.
 */
export function setActiveSolanaPersonaBySlug(slug: string): SolanaPersona {
  const persona = findSolanaPersona(slug);
  if (!persona) {
    throw new Error(`unknown Solana persona slug: ${String(slug)}`);
  }
  return setActiveSolanaPersona(persona);
}

/**
 * Returns the currently active TRON persona, or `null` if none has been
 * set. Phase 17 Plan 17-04 surface; Plan 17-05 wires the registry +
 * `set_demo_wallet` setter. Consumed by `get_portfolio_summary`'s
 * `resolveTronWalletForFanOut` (demo-mode fallback when no paired TRON
 * record exists in the account store).
 */
export function getActiveTronPersona(): TronPersona | null {
  return activeTronPersona;
}

/**
 * Activate a TRON persona. Phase 17 Plan 17-05 surface — the setter is
 * exposed here so Plan 17-04's resolver can compile against a stable
 * `getActiveTronPersona()` contract before Plan 17-05 lands the full
 * `tron-persona.ts` registry + `set_demo_wallet` widening.
 *
 * Defense-in-depth shape: throws if `persona` is falsy or missing the
 * `tronAddress` field. The persona registry validation lives in
 * `src/demo/tron-persona.ts` (Plan 17-05); this function is the
 * registry-agnostic state setter.
 */
export function setActiveTronPersona(persona: TronPersona): TronPersona {
  if (!persona || typeof persona.tronAddress !== "string") {
    throw new Error(
      "setActiveTronPersona: persona must have a tronAddress",
    );
  }
  activeTronPersona = persona;
  return persona;
}

/**
 * Activate a TRON persona by slug — Plan 17-05 surface. Resolves the slug
 * against the `TRON_PERSONAS` registry in `src/demo/tron-persona.ts`,
 * then delegates to `setActiveTronPersona`.
 *
 * Throws on unknown slug as defense-in-depth behind the JSON-Schema enum
 * gate at `src/tools/set_demo_wallet.ts` — unreachable in production
 * through the MCP protocol boundary, but defensible when called from
 * tests or from a hypothetical future caller. Mirrors the Solana
 * `setActiveSolanaPersonaBySlug` shape.
 *
 * The `tron-persona.ts` registry uses `import type` for `TronPersona`,
 * so there's no runtime cycle from this file's import of `findTronPersona`.
 */
export function setActiveTronPersonaBySlug(slug: string): TronPersona {
  const persona = findTronPersona(slug);
  if (!persona) {
    throw new Error(`unknown TRON persona slug: ${String(slug)}`);
  }
  return setActiveTronPersona(persona);
}

/**
 * Returns the currently active BTC persona, or `null` if none has been
 * set. Phase 22 Plan 22-04 surface. Mirror of Tron / Solana shape.
 */
export function getActiveBtcPersona(): BtcPersona | null {
  return activeBtcPersona;
}

/**
 * Activate a BTC persona. Phase 22 Plan 22-04 surface — the setter is
 * exposed here so consumers can compile against a stable
 * `getActiveBtcPersona()` contract.
 *
 * Defense-in-depth shape: throws if `persona` is falsy or missing
 * EITHER address. BTC carries TWO load-bearing addresses (segwit +
 * taproot) — both must be present (sibling-interface widening; the
 * single-string check used for TRON/Solana would not catch a
 * missing-taproot bug). The persona registry validation lives in
 * `src/demo/bitcoin-persona.ts` (Plan 22-04 — full bech32/bech32m
 * checksum gate via `address.toOutputScript`); this function is the
 * registry-agnostic state setter and only validates field-shape.
 */
export function setActiveBtcPersona(persona: BtcPersona): BtcPersona {
  if (!persona || typeof persona.btcSegwitAddress !== "string") {
    throw new Error(
      "setActiveBtcPersona: persona must have a btcSegwitAddress",
    );
  }
  if (typeof persona.btcTaprootAddress !== "string") {
    throw new Error(
      "setActiveBtcPersona: persona must have a btcTaprootAddress",
    );
  }
  activeBtcPersona = persona;
  return persona;
}

/**
 * Activate a BTC persona by slug — Plan 22-04 surface. Resolves the
 * slug against the `BTC_PERSONAS` registry in
 * `src/demo/bitcoin-persona.ts`, then delegates to
 * `setActiveBtcPersona`.
 *
 * Throws on unknown slug as defense-in-depth behind the JSON-Schema
 * enum gate at `src/tools/set_demo_wallet.ts` — unreachable in
 * production through the MCP protocol boundary, but defensible when
 * called from tests or from a hypothetical future caller. Mirrors the
 * TRON `setActiveTronPersonaBySlug` shape.
 *
 * The `bitcoin-persona.ts` registry uses `import type` for `BtcPersona`,
 * so there's no runtime cycle from this file's import of
 * `findBtcPersona`.
 */
export function setActiveBtcPersonaBySlug(slug: string): BtcPersona {
  const persona = findBtcPersona(slug);
  if (!persona) {
    throw new Error(`unknown BTC persona slug: ${String(slug)}`);
  }
  return setActiveBtcPersona(persona);
}

/**
 * Returns the currently active LTC persona, or `null` if none has been
 * set. Phase 26 Plan 26-02 surface. Mirror of BTC / TRON / Solana shape.
 */
export function getActiveLtcPersona(): LtcPersona | null {
  return activeLtcPersona;
}

/**
 * Activate an LTC persona. Phase 26 Plan 26-02 surface.
 * Defense-in-depth: throws if persona is falsy or missing ltcSegwitAddress.
 */
export function setActiveLtcPersona(persona: LtcPersona): LtcPersona {
  if (!persona || typeof persona.ltcSegwitAddress !== "string") {
    throw new Error(
      "setActiveLtcPersona: persona must have a ltcSegwitAddress",
    );
  }
  activeLtcPersona = persona;
  return persona;
}

/**
 * Activate an LTC persona by slug — Plan 26-02 surface. Resolves the
 * slug against the `LTC_PERSONAS` registry in
 * `src/demo/litecoin-persona.ts`, then delegates to
 * `setActiveLtcPersona`.
 */
export function setActiveLtcPersonaBySlug(slug: string): LtcPersona {
  const persona = findLtcPersona(slug);
  if (!persona) {
    throw new Error(`unknown LTC persona slug: ${String(slug)}`);
  }
  return setActiveLtcPersona(persona);
}

/**
 * Returns the currently active Bittensor persona, or `null` if none has
 * been set. Phase 46 Plan 46-01 surface — consumed by the Bittensor
 * read-tool demo-mode address resolvers (Plan 46-03) as the fallback when
 * no paired `chain:"bittensor"` record is in the account store. Mirror of
 * `getActiveSolanaPersona`.
 */
export function getActiveBittensorPersona(): BittensorPersona | null {
  return activeBittensorPersona;
}

/**
 * Activate a Bittensor persona. The registry-agnostic state setter; the
 * persona registry validation (module-load DOA) lives in
 * `src/demo/bittensor-persona.ts`. Defense-in-depth: throws if `persona`
 * is falsy or lacks an `ss58Address`. Mirror of `setActiveSolanaPersona`.
 */
export function setActiveBittensorPersona(
  persona: BittensorPersona,
): BittensorPersona {
  if (!persona || typeof persona.ss58Address !== "string") {
    throw new Error(
      "setActiveBittensorPersona: persona must have an ss58Address",
    );
  }
  activeBittensorPersona = persona;
  return persona;
}

/**
 * Activate a Bittensor persona by slug. Resolves the slug against the
 * `BITTENSOR_PERSONAS` registry in `src/demo/bittensor-persona.ts`, then
 * delegates to `setActiveBittensorPersona`. Throws on unknown slug as
 * defense-in-depth behind the JSON-Schema enum gate at
 * `src/tools/set_demo_wallet.ts`. Mirror of `setActiveSolanaPersonaBySlug`.
 *
 * The `bittensor-persona.ts` registry uses `import type` for
 * `BittensorPersona`, so there is no runtime cycle from this file's import
 * of `findBittensorPersona`.
 */
export function setActiveBittensorPersonaBySlug(
  slug: string,
): BittensorPersona {
  const persona = findBittensorPersona(slug);
  if (!persona) {
    throw new Error(`unknown Bittensor persona slug: ${String(slug)}`);
  }
  return setActiveBittensorPersona(persona);
}

/**
 * Test-only helper. Production code MUST NOT call this — the active
 * persona is process-local and intentionally non-resettable in normal
 * operation. Tests use this to restore isolation between cases.
 */
export function _resetActivePersonaForTesting(): void {
  activePersona = null;
  activeSolanaPersona = null;
  activeTronPersona = null;
  activeBtcPersona = null;
  activeLtcPersona = null;
  activeBittensorPersona = null;
}
