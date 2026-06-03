// Bittensor preview-time dry-run classifier — Phase 47 / Plan 47-03
// (TAO-PREP-02). Layer 0.7 (Bittensor arm) of the preview pipeline.
//
// Sibling of `simulation-solana.ts`'s never-throws contract, with the OPPOSITE
// consumer posture: this is ADVISORY (EVM-style), NOT mandatory-refuse (Solana
// DF-4). The consumer (preview_send Bittensor arm) emits a CHECKS PERFORMED
// warning on a non-ok status but DOES NOT refuse preview. The real trust
// anchors are the chain-enforced CheckMetadataHash + the on-device blake2-256
// hash match (47-RESEARCH §Probe 4 / OQ-2). This helper CLASSIFIES; the
// consumer's policy is "surface, never block".
//
// OQ-2 RESOLVED: the unsigned dry-run uses `api.rpc.system.dryRun` when present
// (47-RESEARCH §Probe 4 — both `dryRun` and `taggedTransactionQueue.validateTransaction`
// are decorated on the live chain). Because the posture is advisory, the EXACT
// call is non-load-bearing — any failure (method absent, wrong-shape result,
// RPC down, unsigned-not-accepted) demotes to `status: "error"` and surfaces as
// a warning. The helper NEVER throws.
//
// ESM spy-affordance per CLAUDE.md — `_simulationBittensor` is the indirection
// the preview arm + tests route through. All api access is via
// `_bittensorRegistry.getApi` so tests spy there and NEVER open a live socket.

import { _bittensorRegistry } from "../chains/bittensor/registry.js";

/**
 * Classification of a Bittensor dry-run outcome (ADVISORY).
 *
 *   - `ok`           — the dry-run validated the extrinsic (would apply). The
 *                      consumer proceeds; the CHECKS PERFORMED block reports ok.
 *   - `invalid`      — the dry-run classified the extrinsic as invalid (e.g.
 *                      bad proof, stale, exhausts resources). The consumer
 *                      surfaces a WARNING but does NOT refuse (advisory).
 *   - `error`        — the dry-run could not be performed (method absent, RPC
 *                      down, unsigned not accepted). Advisory — surfaced as a
 *                      "dry-run unavailable" warning, NEVER a refusal. NEVER
 *                      thrown — the wrapper demotes to this.
 */
export type BittensorSimulationStatus = "ok" | "invalid" | "error";

export interface BittensorSimulationResult {
  /** Classified status — the consumer treats every non-ok as ADVISORY. */
  status: BittensorSimulationStatus;
  /** Human-readable detail on non-ok statuses; `null` on ok. */
  detail: string | null;
  /** Populated only on `status: "error"` — the RPC/availability error message. */
  rpcError?: string;
}

/**
 * Run an advisory preview-time dry-run for the prepared Bittensor extrinsic.
 * NEVER throws — every input/RPC shape returns a `BittensorSimulationResult`.
 *
 * The consumer (Plan 47-03 preview arm) surfaces the result in a CHECKS
 * PERFORMED block; a non-ok status is a WARNING, not a refusal (advisory
 * posture — 47-RESEARCH §Probe 4).
 */
export async function runBittensorPreviewSimulation(input: {
  signableBlob: Uint8Array;
}): Promise<BittensorSimulationResult> {
  void input;
  try {
    const api = (await _bittensorRegistry.getApi()) as unknown as {
      rpc?: {
        system?: {
          dryRun?: (extrinsic: unknown) => Promise<{
            isOk?: boolean;
            toJSON?: () => unknown;
          }>;
        };
      };
    };

    const dryRun = api.rpc?.system?.dryRun;
    if (typeof dryRun !== "function") {
      // Method not decorated on this chain — advisory unavailable.
      return {
        status: "error",
        detail: "dry-run RPC not available on this node",
        rpcError: "system.dryRun not decorated",
      };
    }

    // The unsigned signable blob is passed as the dry-run subject. The exact
    // accepted shape is non-load-bearing (advisory) — any rejection demotes
    // below. Pass the raw blob; the registry serializes.
    const result = await dryRun(input.signableBlob);

    // `dryRun` returns an ApplyExtrinsicResult; `isOk` true means it would
    // apply. Absence of a clear ok signal is classified `invalid` (advisory).
    if (result && typeof result === "object" && result.isOk === true) {
      return { status: "ok", detail: null };
    }
    return {
      status: "invalid",
      detail: "dry-run did not validate (advisory — not a refusal)",
    };
  } catch (err) {
    const rpcError = err instanceof Error ? err.message : String(err);
    // ADVISORY: an RPC/availability failure NEVER refuses preview.
    return {
      status: "error",
      detail: "dry-run could not be performed (advisory)",
      rpcError,
    };
  }
}

/**
 * ESM spy-affordance per CLAUDE.md. The preview arm + tests call through this
 * object so `vi.spyOn(_simulationBittensor, "runBittensorPreviewSimulation")`
 * applies without monkey-patching the named export.
 */
export const _simulationBittensor = { runBittensorPreviewSimulation };
