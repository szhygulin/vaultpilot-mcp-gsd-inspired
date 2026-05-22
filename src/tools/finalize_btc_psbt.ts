// src/tools/finalize_btc_psbt.ts — Phase 25 Plan 25-03
//
// MCP tool: finalize_btc_psbt({ psbt: string, threshold: number })
//
// Direct PSBT transform — NO handle, NO payloadFingerprint.
// Enforces that every input in the PSBT has >= M partial signatures before
// calling bitcoinjs-lib finalizeAllInputs(). Returns the finalized PSBT base64
// and the raw tx hex ready for broadcast.
//
// Trust pipeline:
//   input-validation (psbt: non-empty string, threshold: integer >= 1)
//     → _btcPsbt.finalizeBtcPsbt(psbt, threshold)
//     → threshold-not-met? → PSBT_THRESHOLD_NOT_MET naming under-threshold indices
//     → error?            → INTERNAL_ERROR (malformed PSBT parse failure)
//     → ok                → { finalPsbtBase64, txHex, ... }
//
// Design constraints:
//   - NEVER creates a handle or computes a payloadFingerprint: this is a pure
//     PSBT transform. The user passes the finalized PSBT to their own broadcast
//     path or to any standard BTC node/explorer that accepts raw tx hex.
//   - The threshold argument is the M from the multisig descriptor — the caller
//     (agent or user) must know their wallet's M value and pass it explicitly.
//     The tool does not look up the registry; that keeps it descriptor-agnostic.
//   - Routing via _btcPsbt spy-affordance so tests can vi.spyOn the helper.
//
// FROZEN modules btc-fingerprint.ts + btc-sighash.ts are NOT imported here.
// Threat model: T-25-11 (under-threshold broadcast) — mitigated here.

import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { _btcPsbt } from "../protocols/btc-psbt.js";
import { registerTool } from "./index.js";

// ─── Error envelope boundary cast ─────────────────────────────────────────────

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<
    string,
    unknown
  > &
    StructuredError;
}

// ─── Tool description ─────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Finalize a partially-signed multisig Bitcoin PSBT, producing the final PSBT base64 and a raw transaction hex ready for broadcast.",
  "Requires that every input in the PSBT has at least `threshold` (M) partial signatures.",
  "`psbt` is a PSBT v0 base64 string (e.g. from combine_btc_psbts after collecting co-signer signatures).",
  "`threshold` is the M value for the multisig wallet (e.g. 2 for a 2-of-3 wallet).",
  "If any input has fewer than M signatures, the tool refuses with PSBT_THRESHOLD_NOT_MET and lists the under-threshold input indices.",
  "On success, returns `{ finalPsbtBase64, txHex, chain: \"bitcoin\" }`.",
  "The `txHex` can be broadcast to a Bitcoin node via `POST /tx` on Esplora/mempool.space, or by any standard BTC relay.",
  "Refusal cases: INVALID_INPUT (missing or empty psbt, threshold < 1 or not a number),",
  "PSBT_THRESHOLD_NOT_MET (under-signed inputs — collect more co-signer signatures first),",
  "INTERNAL_ERROR (malformed PSBT base64 or finalizer threw unexpectedly).",
  "This tool does NOT require a Ledger device, does NOT broadcast, and does NOT issue a handle.",
  "Use sign_btc_multisig_psbt to sign your Ledger contribution; use combine_btc_psbts to merge co-signer PSBTs first.",
].join(" ");

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    psbt: {
      type: "string",
      description:
        "PSBT v0 base64 string with co-signer partial signatures already present. Must have >= threshold signatures per input.",
    },
    threshold: {
      type: "number",
      description:
        "The M value for the multisig wallet (e.g. 2 for a 2-of-3 wallet). Must be >= 1.",
    },
  },
  required: ["psbt", "threshold"],
  additionalProperties: false,
};

// ─── Handler ──────────────────────────────────────────────────────────────────

registerTool(
  "finalize_btc_psbt",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // ── Step 1: Input validation ─────────────────────────────────────────
      const rawPsbt = typeof args.psbt === "string" ? args.psbt.trim() : "";
      if (!rawPsbt) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: psbt must be a non-empty PSBT v0 base64 string",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "psbt must be a non-empty PSBT v0 base64 string",
          ),
        };
      }

      const rawThreshold = args.threshold;
      if (
        typeof rawThreshold !== "number" ||
        !Number.isInteger(rawThreshold) ||
        rawThreshold < 1
      ) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: threshold must be an integer >= 1, got ${rawThreshold ?? "undefined"}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `threshold must be an integer >= 1, got ${rawThreshold ?? "undefined"}`,
          ),
        };
      }
      const threshold = rawThreshold;

      // ── Step 2: Finalize via spy-affordance (testable seam) ──────────────
      const result = _btcPsbt.finalizeBtcPsbt(rawPsbt, threshold);

      // ── Step 3: Map result discriminated union → MCP response ────────────
      if (result.kind === "threshold-not-met") {
        const indices = [...result.underThresholdInputs].sort((a, b) => a - b).join(", ");
        const message =
          `PSBT finalize refused: ${result.underThresholdInputs.length} input(s) have fewer than ` +
          `${threshold} signature(s). Collect more co-signer signatures before finalizing. ` +
          `Under-threshold inputs: [${indices}]`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${message}` }],
          structuredContent: errEnvelope("PSBT_THRESHOLD_NOT_MET", message),
        };
      }

      if (result.kind === "error") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to finalize PSBT: ${result.message}`,
            },
          ],
          structuredContent: errEnvelope("INTERNAL_ERROR", result.message),
        };
      }

      // ── Step 4: Success ──────────────────────────────────────────────────
      return {
        content: [
          {
            type: "text",
            text:
              `Finalized PSBT (threshold=${threshold}):\n${result.finalPsbtBase64}\n\n` +
              `Raw transaction hex (ready for broadcast):\n${result.txHex}`,
          },
        ],
        structuredContent: {
          finalPsbtBase64: result.finalPsbtBase64,
          txHex: result.txHex,
          chain: "bitcoin",
          threshold,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: unexpected error in finalize_btc_psbt: ${message}`,
          },
        ],
        structuredContent: errEnvelope("INTERNAL_ERROR", message),
      };
    }
  },
);
