// Solana program-ID dispatch allowlist — Phase 12 / Plan 12-04.
//
// Layer 0.5 (Solana arm) of the preview pipeline. Sibling of
// `src/security/canonical-dispatch.ts` (EVM — per-chain contract addresses).
// Fires inside the Solana branch of `preview_send.ts` AFTER handle lookup +
// BEFORE the mandatory simulation gate (Layer 0.7). The check is over
// `record.tx.programIds` — every program ID present in the prepared message
// must appear in this allowlist or preview refuses with
// `DISPATCH_TARGET_REFUSED`. The refused-shape names the offending program
// IDs verbatim so the structured-error envelope can surface them for agent-
// side self-correction.
//
// **v1.x SCOPE — 3 program IDs ONLY**. Adding a program ID here without the
// corresponding decoder + clear-sign-coverage analysis defeats the Layer 0.5
// defense (the user would receive a "trusted by server" surface for a
// program whose calldata the device cannot decode, breaking the trust
// pipeline). Future phases widen:
//
//   - Phase 13 — MarginFi + Kamino lending program IDs.
//   - Phase 14 — Jupiter v6 aggregator program IDs.
//   - Phase 15 — Marinade + Jito staking + native Stake Program IDs.
//   - Phase 16 — LiFi-routed Solana bridging program IDs.
//
// Anti-pattern guard — NEVER add a "passthrough" or "any-program-id" branch.
// The allowlist is exhaustive by design; the only way a Solana tx reaches
// the simulation gate is by passing this check.
//
// DF-3 lock — durable-nonce program IDs (nonceInitialize / nonceAdvance /
// nonceWithdraw / nonceAuthorize) are EXPLICITLY NOT in this allowlist. They
// defer to v2.0.x. The Phase 12 simulation gate is the load-bearing defense
// against expired blockhash (re-fetches against current cluster state at
// preview time; the agent re-runs prepare to refresh).
//
// ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
// convention. `_canonicalDispatchSolana` is the mutable indirection object
// production callers (Plan 12-04 `preview_send.ts` Solana branch) route
// through so tests can `vi.spyOn(_canonicalDispatchSolana,
// "checkSolanaDispatchTarget")` to short-circuit the allowlist gate without
// monkey-patching the named export (ESM bindings are immutable; direct
// spies on named exports are no-ops for cross-export internal calls).

import { SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  getKaminoLendProgram,
  getMarginfiProgramId,
} from "../config/contracts.js";

/**
 * Solana program-ID dispatch allowlist for v1.x scope.
 *
 * Three entries:
 *   1. `SystemProgram.programId` — native SOL transfers (Plan 12-02).
 *   2. `TOKEN_PROGRAM_ID` — SPL TransferChecked (Plan 12-03).
 *   3. `ASSOCIATED_TOKEN_PROGRAM_ID` — createATA prepending for SPL transfers
 *      to recipients that don't yet hold the token (Plan 12-03 — paid by the
 *      sender as `feePayer`).
 *
 * Evaluated ONCE at module load. Subsequent `checkSolanaDispatchTarget`
 * calls are constant-time Set lookups against the frozen entries.
 *
 * Format-fanout-sentinel: the per-program-ID base58 strings live HERE
 * exactly once. No tool or test should inline these literals; consume via
 * `SOLANA_DISPATCH_ALLOWLIST.has(programId)` or `checkSolanaDispatchTarget`.
 */
export const SOLANA_DISPATCH_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  SystemProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),

  // Phase 13 Plan 13-01 (D-06, SOL-W-09) — lending program IDs built from the
  // contracts SOT getters (NO inlined base58 in this file; mirror of the
  // Compound `getAllCompoundCometsForChain(1).map(...)` dispatch
  // auto-extension pattern). MarginFi writes (13-03) + Kamino writes
  // (13-04..06) target these program IDs; an unknown program ID still refuses
  // at Layer 0.5.
  getMarginfiProgramId(),
  getKaminoLendProgram(),

  // AUXILIARY-PROGRAM SLOT — EXTENDED-IN-13-05. The Kamino refresh ceremony
  // (refreshReserve + refreshObligation) touches the Scope oracle / Pyth
  // receiver / Switchboard programs (Pitfall 5). Their exact program-ID set is
  // enumerated from the actual built Kamino instruction vector in 13-05 and
  // added here then — NOT guessed now. MarginFi lending ix touch no auxiliary
  // program, so the MarginFi batch (13-01..03) needs no addition beyond the
  // two lending program IDs above.
]);

/**
 * Discriminated-union result of `checkSolanaDispatchTarget`.
 *
 *   - `allowed` — every program ID in the input array is in the allowlist.
 *   - `refused` — at least one program ID is NOT in the allowlist. The
 *                 response carries the verbatim `offenders` list + the full
 *                 `allowlist` so the refusal envelope can name what the
 *                 server expected.
 */
export type SolanaDispatchCheckResult =
  | { kind: "allowed" }
  | { kind: "refused"; offenders: string[]; allowlist: string[] };

/**
 * Layer 0.5 (Solana arm) dispatch check. Returns `allowed` only when EVERY
 * program ID in the input array is in `SOLANA_DISPATCH_ALLOWLIST`. Mixed
 * inputs (some allowed, some not) refuse — the allowed entries do NOT
 * rescue the refusal.
 *
 * Empty `programIds` is `allowed` (no offenders by construction). The genuine
 * "empty instruction list" failure mode is caught at a different layer
 * (Plan 12-05 send-time recompute would surface a malformed-message refusal
 * earlier than this gate).
 *
 * Called from `src/tools/preview_send.ts` Solana branch (Plan 12-04) AFTER
 * handle lookup + BEFORE the Layer 0.7 simulation gate. The two layers
 * stack: dispatch refusal short-circuits before any RPC call to
 * `simulateTransaction`, so an unknown-program-ID handle never reaches the
 * simulation surface.
 */
export function checkSolanaDispatchTarget(
  programIds: string[],
): SolanaDispatchCheckResult {
  const offenders = programIds.filter(
    (pid) => !SOLANA_DISPATCH_ALLOWLIST.has(pid),
  );
  if (offenders.length === 0) return { kind: "allowed" };
  return {
    kind: "refused",
    offenders,
    allowlist: [...SOLANA_DISPATCH_ALLOWLIST],
  };
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. The indirection object is
 * the only seam for `vi.spyOn(_canonicalDispatchSolana,
 * "checkSolanaDispatchTarget")` — direct spies on the named export are
 * silent no-ops for cross-export internal calls (ESM bindings are
 * immutable). Production callers (`src/tools/preview_send.ts` Solana
 * branch) call through this object so the spy applies to them.
 */
export const _canonicalDispatchSolana = { checkSolanaDispatchTarget };
