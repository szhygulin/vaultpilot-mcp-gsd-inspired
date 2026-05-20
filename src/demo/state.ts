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

import { PERSONAS, type Persona } from "./personas.js";
import { findSolanaPersona } from "./solana-persona.js";

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

let activePersona: Persona | null = null;
let activeSolanaPersona: SolanaPersona | null = null;

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
 * Test-only helper. Production code MUST NOT call this — the active
 * persona is process-local and intentionally non-resettable in normal
 * operation. Tests use this to restore isolation between cases.
 */
export function _resetActivePersonaForTesting(): void {
  activePersona = null;
  activeSolanaPersona = null;
}
