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

let activePersona: Persona | null = null;

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
 * Test-only helper. Production code MUST NOT call this — the active
 * persona is process-local and intentionally non-resettable in normal
 * operation. Tests use this to restore isolation between cases.
 */
export function _resetActivePersonaForTesting(): void {
  activePersona = null;
}
