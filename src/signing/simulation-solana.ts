// Solana preview-time simulation helper. DF-4 LOCKED — research § Topic 4
// (mandatory simulation gate). Sibling of `src/signing/simulation.ts` (EVM —
// ADVISORY simulation).
//
// CRITICAL DISTINCTION from the EVM analog: the EVM helper's TRUST-BOUNDARY
// INVARIANT documents simulation as a USABILITY signal — preview_send emits
// the SIMULATION block but DOES NOT refuse on revert. Solana takes the
// opposite posture: `preview_send` Solana branch (Plan 12-04) PROMOTES any
// non-`ok` status to a `SIMULATION_REFUSED` refusal envelope. This helper
// CLASSIFIES; the consumer ENFORCES.
//
// The classifier-vs-consumer split keeps the never-throws contract uniform
// with the EVM helper (RPC failures demote to `status: "error"`; the helper
// NEVER throws) while letting the consumer choose its refusal posture.
//
// Cross-ref: research § Topic 4 (DF-4 mandatory simulation lock) + Topic 9
// (envelope shape — `value.err` discrimination).

import type { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";

/**
 * Classification of a Solana `simulateTransaction` envelope.
 *
 *   - `ok`                    — `value.err === null` (transaction would
 *                              succeed). Consumer proceeds to preview emit.
 *   - `program-error`         — `value.err !== null` with a generic program
 *                              error shape (InstructionError, etc.).
 *                              Consumer refuses with SIMULATION_REFUSED.
 *   - `insufficient-lamports` — Specific sub-status when the err shape
 *                              signals insufficient SOL for rent / fees.
 *                              Consumer surfaces the lamports-needed hint
 *                              in the refusal envelope.
 *   - `error`                 — RPC failure (network down, timeout,
 *                              unreachable). Consumer treats this as a
 *                              simulation refusal AT THE SAME GATE as a
 *                              program-error per DF-4 — the user MUST NOT
 *                              be asked to blind-sign a tx whose outcome
 *                              we could not classify. NEVER thrown — the
 *                              wrapper demotes to this envelope.
 */
export type SolanaSimulationStatus =
  | "ok"
  | "program-error"
  | "insufficient-lamports"
  | "error";

export interface SolanaSimulationResult {
  /** Classified status — consumer (preview_send Solana branch) enforces. */
  status: SolanaSimulationStatus;
  /** Stringified `value.err` shape on non-ok statuses; `null` on ok / error. */
  err: string | null;
  /** Forwarded verbatim from `value.logs`; empty array on RPC error. */
  logs: string[];
  /** Compute-units consumed (if surfaced); `null` when unavailable. */
  unitsConsumed: number | null;
  /** Populated only on `status: "error"` — the RPC-layer error message. */
  rpcError?: string;
}

/**
 * Heuristic match for the `insufficient-lamports` sub-status. `value.err`
 * shapes vary across SDK versions and program implementations; the two
 * stable signals are the string `"InsufficientFundsForRent"` (SystemProgram
 * rent-exemption refusal) and the `"insufficient lamports"` substring
 * (general fee-payer underfunding). Either match promotes the status from
 * `program-error` to `insufficient-lamports` so the consumer can surface the
 * specific remediation hint.
 */
function isInsufficientLamports(errString: string): boolean {
  return (
    errString.includes("InsufficientFundsForRent") ||
    /insufficient lamports/i.test(errString)
  );
}

/**
 * Run a preview-time `simulateTransaction` against the configured Solana RPC
 * for the prepared transaction. NEVER throws — every input shape returns a
 * `SolanaSimulationResult`.
 *
 * The consumer (Plan 12-04 `preview_send` Solana branch) enforces DF-4:
 * `status !== "ok"` → `SIMULATION_REFUSED` refusal envelope. This helper
 * stays a pure classifier; the consumer owns the policy.
 *
 * Uses the legacy `simulateTransaction(transaction, signers, includeAccounts)`
 * overload per RESEARCH Topic 4 — pass empty signers + `includeAccounts=false`
 * since the prepare tool already pinned `recentBlockhash` and we do not need
 * account-state in the envelope. `sigVerify` defaults to `false` on this
 * overload (no signers required), and `replaceRecentBlockhash` is implicitly
 * disabled — the prepared blockhash is the canonical preimage of the
 * payloadFingerprint, so swapping it here would invalidate the binding.
 */
export async function runSolanaPreviewSimulation(input: {
  connection: Connection;
  transaction: Transaction | VersionedTransaction;
}): Promise<SolanaSimulationResult> {
  try {
    // `simulateTransaction` overloads differ by Transaction vs VersionedTransaction.
    // For legacy Transaction (v1.x scope per RESEARCH OQ-1 lock): the
    // 3-arg form is `(transaction, signers, includeAccounts)`. Cast to
    // `any` only for the call shape — the input type is statically narrowed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (input.connection as any).simulateTransaction(
      input.transaction,
      [],
      false,
    );

    const value = response?.value ?? {};
    const logs: string[] = Array.isArray(value.logs) ? value.logs : [];
    const unitsConsumed: number | null =
      typeof value.unitsConsumed === "number" ? value.unitsConsumed : null;

    if (value.err === null || value.err === undefined) {
      return {
        status: "ok",
        err: null,
        logs,
        unitsConsumed,
      };
    }

    const errString =
      typeof value.err === "string" ? value.err : JSON.stringify(value.err);

    if (isInsufficientLamports(errString)) {
      return {
        status: "insufficient-lamports",
        err: errString,
        logs,
        unitsConsumed,
      };
    }

    return {
      status: "program-error",
      err: errString,
      logs,
      unitsConsumed,
    };
  } catch (err) {
    // NEVER-THROWS contract (mirrors `simulation.ts:16-19` TRUST-BOUNDARY
    // INVARIANT — the wrapper is best-effort; classification is the
    // consumer's job). RPC failures demote to `status: "error"`; the
    // consumer still refuses preview at the DF-4 gate.
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      err: null,
      logs: [],
      unitsConsumed: null,
      rpcError: message,
    };
  }
}

/**
 * ESM spy-affordance per CLAUDE.md convention. Plan 12-04's `preview_send`
 * Solana branch imports `_simulationSolana` and calls
 * `_simulationSolana.runSolanaPreviewSimulation(input)` so tests can spy on
 * the call without monkey-patching the production import path.
 */
export const _simulationSolana = { runSolanaPreviewSimulation };
