// MCP tool: prepare_tron_native_send({ to, sun })
//
// First step of the Phase 18 TRON trust pipeline (TRON-W-01 / TRON-PREP-01
// consumer / TRON-PREP-02 scaffolding). TRON sibling of
// `src/tools/prepare_solana_native_send.ts` (Phase 12 / Plan 12-02 — Solana
// native send) and `src/tools/prepare_native_send.ts` (Phase 4 / Plan 04-02
// — EVM native send).
//
// Composes Plan 18-01's signing primitives + Plan 18-02's encoder:
//
//   input-validation (`to` TRON base58check + `sun` strict-decimal parse)
//     → demo-mode FIRST refusal (Plan 17-05 TRON persona — `getActiveTronPersona`)
//     → pairing check (`listAccounts({ chainFilter: "tron" })` non-empty in real mode)
//     → get `tronWeb` via `_tronRegistry.getTronWeb()` (ESM spy seam)
//     → call `_tronNative.encodeTronTransfer(...)` (wraps sendTrx + extendExpiration(tx, 900))
//     → compute `payloadFingerprint` via `_tronFingerprint.computeTronPayloadFingerprint`
//     → `createHandle` with RAW agent strings on `args` + TRON-typed on `tx`
//     → return PREPARE RECEIPT via `PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE` substitution
//       plus `{ handle, chain: "tron", to, sun, refBlockBytes, refBlockHash, expiration,
//               payloadFingerprint, prepareReceipt }`.
//
// Three load-bearing invariants asserted by `test/prepare-tron-native-send.test.ts`:
//
//   1. **INVALID_INPUT check FIRES FIRST** — `to` validated via
//      `tronUtils.address.isAddress` before any state read; `sun` validated via
//      `parseTronAmountStrict(sun, 0, "u64")` before any RPC call.
//      Defense-in-depth: schema-level Zod/JSON-schema rejects first,
//      but structured-error path is still reachable if schema loosens.
//
//   2. **PREPARE RECEIPT is VERBATIM** (PREP-02) — the block reads from
//      `args.to` + `args.sun` (RAW agent strings). No base58 normalization,
//      no decimal scaling at the receipt layer.
//
//   3. **Fixture M consumer re-anchor** — the canonical Fixture M inputs
//      (tron-whale persona sender + canonical recipient + 1_000_000 sun +
//      pinned ref-block) produce the hardcoded literal
//      `0xaa8305509481b97e50acb9e4d582bb53a1db1c99f9c357febe1fbf7389ffd4fa`
//      pinned in `test/signing-fingerprint-tron.test.ts`. Drift in preimage
//      assembly fails at BOTH sites — load-bearing redundancy per CLAUDE.md
//      fixture discipline + CONTEXT D-08d.
//
// `sun` is RAW SUN (decimals=0) — NOT decimal TRX. Off-by-decimal is the most
// common user-facing bug class per project CLAUDE.md "Decimal-aware arithmetic".
// `parseTronAmountStrict(sun, 0, "u64")` rejects "1.5" with kind: "fractional-
// overflow" so the agent gets a specific, actionable error message.
//
// NO `chain` field — TRON is single-chain (CONTEXT D-10 lock, mirrors the
// Solana tool's no-chain shape). NO user-facing `expiration` arg —
// `extendExpiration(tx, 900)` is always applied internally (RESEARCH §Topic 5).

import { utils as tronUtils } from "tronweb";

import { _tronRegistry } from "../chains/tron/registry.js";
import { isDemoMode } from "../config/env.js";
import {
  getActiveTronPersona,
} from "../demo/state.js";
import {
  InvalidAmountError,
  parseTronAmountStrict,
} from "../signing/amount-tron.js";
import { PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE } from "../signing/blocks-tron.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  type PrepareArgs,
  type PreparedTxTron,
  createHandle,
} from "../signing/handle-store.js";
import { _tronFingerprint } from "../signing/payload-fingerprint-tron.js";
import { _tronNative } from "../protocols/tron-native.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

// The shared `ToolHandlerResult.structuredContent` type is
// `Record<string, unknown>`; `StructuredError` is an explicit interface
// without an index signature. Cast at the boundary so
// `makeStructuredError(...)` stays the canonical envelope constructor
// without modifying the tool-handler contract.
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

const DESCRIPTION = [
  "Prepare an unsigned native TRX transfer (TransferContract Protobuf) from the paired TRON Ledger account.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to send native TRX.",
  "Do NOT use for TRC-20 transfers — that is `prepare_tron_trc20_send`.",
  "Do NOT use for staking, SunSwap, or LiFi — those are Phase 19/20.",
  "`sun` is the amount in raw sun (10^6 sun = 1 TRX) as a decimal string — never pass human-readable TRX amounts (off-by-decimal is the most common user-facing bug class).",
  "`to` is the recipient TRON address as a base58check T-prefixed string (34 chars).",
  "Requires a paired TRON Ledger (call `pair_tron_ledger` first if `get_tron_status` shows `paired: false`).",
  "Returns `{ handle, chain: \"tron\", to, sun, refBlockBytes, refBlockHash, expiration, payloadFingerprint, prepareReceipt }`.",
  "The agent MUST pass the handle to preview_send next — without preview + the resulting previewToken, send_transaction refuses.",
  "In demo mode, succeeds against the active TRON persona address (set via set_demo_wallet); send_transaction returns a simulation envelope instead of broadcasting.",
  "Failure modes: WALLET_NOT_PAIRED (real mode, no paired TRON account), WRONG_MODE (demo mode but no TRON persona set), INVALID_INPUT (to/sun malformed or `to` not a valid base58check TRON address).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    to: {
      type: "string",
      description:
        "Recipient TRON address (base58check T-prefixed, 34 chars). Example: \"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t\".",
    },
    sun: {
      type: "string",
      description:
        "Amount in raw sun (10^6 sun = 1 TRX) as a decimal string. Example: \"1000000\" for 1 TRX. Do NOT pass decimal TRX — off-by-decimal is the most common user-facing bug class.",
    },
  },
  required: ["to", "sun"],
  additionalProperties: false,
};

registerTool(
  "prepare_tron_native_send",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawTo = typeof args.to === "string" ? args.to : "";
      const rawSun = typeof args.sun === "string" ? args.sun : "";

      // -----------------------------------------------------------------------
      // Step 1: Input validation — FIRES FIRST (before any state read).
      // Defense-in-depth: JSON-schema rejects at dispatch but structured-error
      // path must still work if schema loosens in a future refactor.
      // -----------------------------------------------------------------------

      // Validate TRON address via `tronweb.utils.address.isAddress` per
      // RESEARCH §Topic 6 — NEVER hand-roll base58check validation.
      if (!tronUtils.address.isAddress(rawTo)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'to' address: expected a valid TRON base58check address (T-prefixed, 34 chars), got "${rawTo}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'to' address: "${rawTo}" is not a valid TRON base58check address`,
          ),
        };
      }

      // Validate + parse `sun` via parseTronAmountStrict(sun, 0, "u64").
      // decimals=0 because sun is already the raw integer unit (1 TRX = 1_000_000 sun;
      // the agent passes raw sun, not human-readable TRX). "u64" bound matches
      // TransferContract.amount field (int64 on-wire, positive values bounded by u64).
      let sun: bigint;
      try {
        sun = parseTronAmountStrict(rawSun, 0, "u64");
      } catch (err) {
        if (err instanceof InvalidAmountError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: invalid 'sun': ${err.message}`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid 'sun': ${err.message}`,
              err.kind,
            ),
          };
        }
        // Defense: unexpected error class. Re-throw to the outer catch-all.
        throw err;
      }

      // -----------------------------------------------------------------------
      // Step 2: Demo-mode FIRST refusal — read TRON persona registry.
      // Mirrors the Solana tool's `getActiveSolanaPersona()` pattern.
      // Real-mode pairing check happens AFTER the demo branch so `listAccounts`
      // is NEVER called in demo mode.
      // -----------------------------------------------------------------------
      const demoActive = isDemoMode();
      const tronPersona = getActiveTronPersona();

      let fromAddress: string;
      if (demoActive) {
        if (!tronPersona) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: demo mode is on but no TRON persona is set. " +
                  "Call set_demo_wallet with a TRON persona slug (e.g. \"tron-whale\") before preparing demo-mode TRON sends.",
              },
            ],
            structuredContent: errEnvelope(
              "WRONG_MODE",
              "demo mode is on but no TRON persona is set; call set_demo_wallet first",
            ),
          };
        }
        fromAddress = tronPersona.tronAddress;
      } else {
        // Real mode — consult the persistent non-EVM account store.
        const accounts = listAccounts({ chainFilter: "tron" });
        if (accounts.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: no paired TRON account. Pair your Ledger TRON app via `pair_tron_ledger` before preparing TRX transfers.",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired TRON account; call pair_tron_ledger first",
            ),
          };
        }
        // Single-account scope per v1.x; multi-account dispatch deferred to v2.x.
        const account = accounts[0];
        if (!account) {
          // Unreachable defense-in-depth: length-check above guarantees accounts[0].
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "error: no paired TRON account (unreachable narrowing).",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired TRON account (unreachable narrowing)",
            ),
          };
        }
        fromAddress = account.address;
      }

      // -----------------------------------------------------------------------
      // Step 3: Get TronWeb instance via the ESM spy seam.
      // -----------------------------------------------------------------------
      const tronWeb = _tronRegistry.getTronWeb();

      // -----------------------------------------------------------------------
      // Step 4: Encode the TransferContract tx via the protocol layer.
      // `encodeTronTransfer` calls sendTrx + extendExpiration(tx, 900).
      // -----------------------------------------------------------------------
      let encoded;
      try {
        encoded = await _tronNative.encodeTronTransfer({
          tronWeb,
          from: fromAddress,
          to: rawTo,
          sun,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to build TRON TransferContract: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            "failed to build TRON TransferContract",
            cause,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 5: Compute the binding payloadFingerprint at prepare time.
      // Plan 18-04 re-runs this at send time; drift → PAYLOAD_FINGERPRINT_DRIFT.
      // Fixture M cross-link: known inputs → known fingerprint literal
      // (`test/signing-fingerprint-tron.test.ts:Fixture M`).
      // -----------------------------------------------------------------------
      const payloadFingerprint = _tronFingerprint.computeTronPayloadFingerprint(
        { rawDataBytes: encoded.rawDataBytes },
      );

      // -----------------------------------------------------------------------
      // Step 6: Build PreparedTxTron + PrepareArgs shapes.
      // PREP-02 + T-PREP-RCPT-1: `args` carries RAW agent strings; `tx` carries
      // typed values. Receipt below reads EXCLUSIVELY from `args` so normalization
      // is impossible at the storage boundary (PrepareArgs types are `string`).
      // -----------------------------------------------------------------------
      const tx: PreparedTxTron = {
        txType: "tron",
        // EVM-shape sentinel fields — rationale in handle-store.ts next to
        // PreparedTxTron definition. EVM call paths hitting a TRON handle will
        // fail at Layer 0.5 canonical-dispatch-tron refusal before reading these.
        chainId: 0,
        to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        valueWei: 0n,
        data: "0x" as `0x${string}`,
        // TRON-specific cryptographic-binding fields.
        rawDataHex: encoded.rawDataHex,
        rawDataObject: encoded.rawDataObject,
        refBlockBytes: encoded.refBlockBytes,
        refBlockHash: encoded.refBlockHash,
        expiration: encoded.expiration,
        kind: "native",
        instructionSummary: encoded.instructionSummary,
      };

      const prepareArgs: PrepareArgs = {
        to: rawTo, // verbatim agent string
        valueWei: "0", // sentinel for non-EVM
        sun: rawSun, // verbatim agent string
        refBlockBytes: encoded.refBlockBytes,
        refBlockHash: encoded.refBlockHash,
        expiration: String(encoded.expiration),
      };

      const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

      // -----------------------------------------------------------------------
      // Step 7: Build PREPARE RECEIPT from format-fanout-sentinel const.
      // The test imports the SAME `PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE` and
      // substitutes identically, asserting byte-identity. Re-declaring this
      // multi-line string here (or in the test) would violate the format-fanout-
      // regex-sync invariant (CLAUDE.md).
      // -----------------------------------------------------------------------
      const prepareReceipt = PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE
        .replace("{TO}", rawTo)
        .replace("{SUN}", rawSun)
        .replace("{REF_BLOCK_BYTES}", encoded.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", encoded.refBlockHash)
        .replace("{EXPIRATION}", String(encoded.expiration));

      const responseText = `${prepareReceipt}\n\nHandle: ${handle}\npayloadFingerprint: ${payloadFingerprint}\n\nNext step: pass this handle to preview_send.`;

      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: {
          handle,
          chain: "tron" as const,
          to: rawTo,
          sun: rawSun,
          refBlockBytes: encoded.refBlockBytes,
          refBlockHash: encoded.refBlockHash,
          expiration: encoded.expiration,
          payloadFingerprint,
          prepareReceipt,
          txType: "tron" as const,
        },
      };
    } catch (err) {
      // Defensive catch-all — explicit refusal paths above cover all expected
      // failures. INTERNAL_ERROR is the unstructured fallback.
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_tron_native_send failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_tron_native_send failed",
          message,
        ),
      };
    }
  },
);
