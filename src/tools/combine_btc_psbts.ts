// src/tools/combine_btc_psbts.ts — Phase 25 Plan 25-02 Task 2
//
// MCP tool: combine_btc_psbts({ psbts: string[] })
//
// Direct PSBT transform — NO handle, NO payloadFingerprint.
// Merges partially-signed PSBTs from multiple co-signers into a single
// combined PSBT, with an explicit pre-combine conflict scan that refuses
// on same-key/same-input signature conflicts before Psbt.combine() is
// ever called (BTC-PSBT-05, T-25-06).
//
// Trust pipeline:
//   input-validation (psbts array >= 2 non-empty strings)
//     → _btcPsbt.combineBtcPsbts (pre-combine conflict scan)
//     → conflict? → PSBT_COMBINE_CONFLICT structured error naming each
//                    conflict's inputIndex + pubkeyHex + both sig hexes
//     → error?    → INTERNAL_ERROR (malformed PSBT parse failure)
//     → ok        → { combinedPsbt: base64, ... }
//
// Design constraints:
//   - No createHandle / payloadFingerprint: combine is a pure PSBT transform.
//     The user passes the combined PSBT to sign_btc_multisig_psbt which owns
//     the prepare→preview→send pipeline.
//   - All conflict metadata (inputIndex, pubkeyHex, both sigHexes) is surfaced
//     in the error message so the agent can relay it to the user for debugging.
//   - Routing via _btcPsbt spy-affordance so tests can vi.spyOn the helper.
//
// FROZEN modules btc-fingerprint.ts + btc-sighash.ts are NOT imported here.

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
  "Merge an array of partially-signed PSBTs from co-signers into a single combined PSBT.",
  "Use this tool when you have collected PSBT base64 strings from multiple co-signers and want to merge their partial signatures before signing or finalizing.",
  "Provide at least 2 PSBT base64 strings in `psbts`. All PSBTs must represent the same unsigned transaction.",
  "The tool runs a per-input per-pubkey conflict scan BEFORE any merge: if two co-signers have signed the same input with the same pubkey but different signature bytes, the merge is refused with PSBT_COMBINE_CONFLICT naming the conflicting inputIndex, pubkey, and both signatures.",
  "Identical signature bytes on the same input/pubkey are treated as an idempotent re-submission and are NOT a conflict.",
  "On success, returns the merged PSBT base64 in `combinedPsbt`. Pass the result to sign_btc_multisig_psbt (to add your Ledger signature) or finalize_btc_psbt (if enough signatures are already present).",
  "Refusal cases: INVALID_INPUT (fewer than 2 PSBTs or non-string element), PSBT_COMBINE_CONFLICT (conflicting signatures detected — do NOT proceed silently), INTERNAL_ERROR (malformed PSBT base64).",
  "This tool does NOT check whether the combined PSBT has enough signatures to meet the multisig threshold — use finalize_btc_psbt for that.",
  "No Ledger device required. No handle is issued. This is a direct PSBT transform.",
].join(" ");

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    psbts: {
      type: "array",
      items: { type: "string" },
      description:
        "Array of PSBT base64 strings from co-signers. Must contain at least 2 elements. All PSBTs must represent the same unsigned transaction.",
      minItems: 2,
    },
  },
  required: ["psbts"],
  additionalProperties: false,
};

// ─── Handler ──────────────────────────────────────────────────────────────────

registerTool(
  "combine_btc_psbts",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // ── Step 1: Input validation ─────────────────────────────────────────
      const psbtArray = Array.isArray(args.psbts) ? (args.psbts as unknown[]) : [];
      if (psbtArray.length < 2) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: psbts must contain at least 2 PSBT base64 strings",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "psbts must contain at least 2 PSBT base64 strings",
          ),
        };
      }

      // Validate each element is a non-empty string.
      const psbtBase64s: string[] = [];
      for (let i = 0; i < psbtArray.length; i++) {
        const elem = psbtArray[i];
        if (typeof elem !== "string" || elem.trim() === "") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: psbts[${i}] must be a non-empty string`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `psbts[${i}] must be a non-empty string`,
            ),
          };
        }
        psbtBase64s.push(elem);
      }

      // ── Step 2: Combine via spy-affordance (testable seam) ───────────────
      const result = _btcPsbt.combineBtcPsbts(psbtBase64s);

      // ── Step 3: Map result discriminated union → MCP response ────────────
      if (result.kind === "conflict") {
        // Build a human-readable conflict summary naming each conflict.
        const conflictLines = result.conflicts.map(
          (c) =>
            `input[${c.inputIndex}] pubkey ${c.pubkeyHex}: ` +
            `sig0=${c.sigHex0.slice(0, 16)}… vs sig1=${c.sigHex1.slice(0, 16)}…`,
        );
        const conflictDetail = conflictLines.join("; ");
        const message =
          `PSBT combine refused: ${result.conflicts.length} conflict(s) detected. ` +
          `A co-signer's signature would be silently overwritten. Resolve conflicts before merging. ` +
          `Conflicts: ${conflictDetail}`;

        return {
          isError: true,
          content: [{ type: "text", text: `error: ${message}` }],
          structuredContent: errEnvelope("PSBT_COMBINE_CONFLICT", message),
        };
      }

      if (result.kind === "error") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to combine PSBTs: ${result.message}`,
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
            text: `Combined PSBT (${psbtBase64s.length} co-signer PSBTs merged):\n${result.psbtBase64}`,
          },
        ],
        structuredContent: {
          combinedPsbt: result.psbtBase64,
          chain: "bitcoin",
          inputCount: psbtBase64s.length,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: unexpected error in combine_btc_psbts: ${message}`,
          },
        ],
        structuredContent: errEnvelope("INTERNAL_ERROR", message),
      };
    }
  },
);
