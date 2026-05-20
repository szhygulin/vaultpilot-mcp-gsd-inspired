// MCP tool: prepare_tron_stake_unfreeze({ amount, resource })
//
// TRON Stake 2.0 unfreeze — TRON-W-05 (unfreeze leg). Phase 19 — Plan 19-02.
//
// Unfreezes TRX that was previously frozen for Energy or Bandwidth resources.
// Produces an UnfreezeBalanceV2Contract (Stake 2.0) Protobuf transaction.
// Initiates the 14-day waiting period; call `prepare_tron_withdraw_expire_unfreeze`
// after 14 days to actually receive the TRX back.
//
// Pipeline:
//   input-validation (`resource` strict-equality enum "ENERGY"|"BANDWIDTH")
//     → amount parse via `parseTronAmountStrict(amount, 6, "u64")`  (TRX = 6 decimals)
//     → demo-mode FIRST refusal (TRON persona via `getActiveTronPersona`)
//     → pairing check (`listAccounts({ chainFilter: "tron" })` non-empty in real mode)
//     → get `tronWeb` via `_tronRegistry.getTronWeb()` (ESM spy seam)
//     → call `_tronStake.encodeUnfreezeBalanceV2({ tronWeb, from, sun, resource })`
//         (overflow guard fires if sun > Number.MAX_SAFE_INTEGER — T-NUMBER-OVERFLOW)
//     → compute `payloadFingerprint` via `_tronFingerprint.computeTronPayloadFingerprint`
//     → `createHandle` with kind: "stake-unfreeze"
//     → return PREPARE RECEIPT + STAKE_RESOURCE_TRON_TEMPLATE + STAKE_WAITING_PERIOD_TRON_TEMPLATE.
//
// `amount` is HUMAN UNITS decimal TRX (e.g. "1000" for 1000 TRX = 1_000_000_000 SUN).
// Server converts via `parseTronAmountStrict(amount, 6, "u64")`.
//
// D-03b: single tool with `resource: "ENERGY" | "BANDWIDTH"` enum (NOT two sibling tools).
// Case variants ("energy", "BAND", etc.) → INVALID_INPUT refusal.
//
// ADVISORY: STAKE_WAITING_PERIOD_TRON_TEMPLATE is surfaced at prepare time (D-04a
// advisory). Mandatory Layer 0.7 refusal for withdrawing before expiry is enforced
// at preview time for `prepare_tron_withdraw_expire_unfreeze` (D-04b asymmetric).

import { _tronRegistry } from "../chains/tron/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActiveTronPersona } from "../demo/state.js";
import {
  InvalidAmountError,
  parseTronAmountStrict,
} from "../signing/amount-tron.js";
import {
  PREPARE_RECEIPT_TRON_STAKE_UNFREEZE_TEMPLATE,
  STAKE_RESOURCE_TRON_TEMPLATE,
  STAKE_WAITING_PERIOD_TRON_TEMPLATE,
} from "../signing/blocks-tron.js";
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
import { _tronStake } from "../protocols/tron-stake.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}

/** Resolve resource description for CHECKS PERFORMED block. */
function resourceDescription(resource: "ENERGY" | "BANDWIDTH"): string {
  return resource === "ENERGY"
    ? "ENERGY (consumed by TRC-20 transfers + contract calls — reduces gas costs)"
    : "BANDWIDTH (consumed by tx broadcast — reduces transaction fees)";
}

const DESCRIPTION = [
  "Prepare an unsigned TRON Stake 2.0 unfreeze transaction (UnfreezeBalanceV2Contract) from the paired TRON Ledger account.",
  "Unfreezes TRX that was previously frozen for Energy or Bandwidth resources.",
  "Initiates a 14-day waiting period after which `prepare_tron_withdraw_expire_unfreeze` must be called to receive TRX back.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "`amount` is the amount of TRX to unfreeze in human-readable decimal format (e.g. \"1000\" for 1000 TRX). Server converts to SUN internally.",
  "`resource` must be exactly \"ENERGY\" or \"BANDWIDTH\" (case-sensitive strict equality). Lowercase or variant forms are rejected with INVALID_INPUT.",
  "This tool uses Stake 2.0 (UnfreezeBalanceV2Contract) only. Stake 1.0 is deprecated by the TRON network and not supported.",
  "IMPORTANT: After calling this tool, the unfreeze is not immediate. You MUST wait 14 days and then call `prepare_tron_withdraw_expire_unfreeze` to complete the withdrawal. preview_send will refuse withdraw-expire if called before the waiting period expires (Layer 0.7 mandatory refusal).",
  "Failure modes: WALLET_NOT_PAIRED (no paired TRON account), WRONG_MODE (demo mode but no TRON persona), INVALID_INPUT (amount or resource malformed).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    amount: {
      type: "string",
      description:
        "Amount of TRX to unfreeze in human-readable decimal format (e.g. \"1000\" for 1000 TRX). Must be a whole number (no fractional TRX).",
    },
    resource: {
      type: "string",
      enum: ["ENERGY", "BANDWIDTH"],
      description:
        "Resource to unfreeze for. \"ENERGY\" (was frozen for TRC-20 transfer costs) or \"BANDWIDTH\" (was frozen for tx broadcast costs). Case-sensitive.",
    },
    from: {
      type: "string",
      description: "Optional override for the TRON sender address (base58check). Defaults to the paired account.",
    },
  },
  required: ["amount", "resource"],
  additionalProperties: false,
};

registerTool(
  "prepare_tron_stake_unfreeze",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawAmount = typeof args.amount === "string" ? args.amount : "";
      const rawResource = typeof args.resource === "string" ? args.resource : "";

      // -----------------------------------------------------------------------
      // Step 1: Input validation — FIRES FIRST.
      // -----------------------------------------------------------------------

      // Strict-equality enum per D-03b. Case variants → INVALID_INPUT.
      if (rawResource !== "ENERGY" && rawResource !== "BANDWIDTH") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'resource': expected "ENERGY" or "BANDWIDTH" (exact case), got "${rawResource}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'resource': "${rawResource}" is not a valid resource enum; use "ENERGY" or "BANDWIDTH" (exact case)`,
          ),
        };
      }
      const resource = rawResource as "ENERGY" | "BANDWIDTH";

      // Parse TRX amount → SUN via parseTronAmountStrict(amount, decimals=6, "u64").
      let sunAmount: bigint;
      try {
        sunAmount = parseTronAmountStrict(rawAmount, 6, "u64");
      } catch (err) {
        if (err instanceof InvalidAmountError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: invalid 'amount': ${err.message}`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid 'amount': ${err.message}`,
              err.kind,
            ),
          };
        }
        throw err;
      }

      // -----------------------------------------------------------------------
      // Step 2: Demo-mode FIRST refusal.
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
                  "Call set_demo_wallet with a TRON persona slug first.",
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
        const accounts = listAccounts({ chainFilter: "tron" });
        if (accounts.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "error: no paired TRON account. Call `pair_tron_ledger` first.",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired TRON account; call pair_tron_ledger first",
            ),
          };
        }
        const account = accounts[0];
        if (!account) {
          return {
            isError: true,
            content: [{ type: "text", text: "error: no paired TRON account (unreachable narrowing)." }],
            structuredContent: errEnvelope("WALLET_NOT_PAIRED", "no paired TRON account (unreachable narrowing)"),
          };
        }
        fromAddress = account.address;
      }

      // -----------------------------------------------------------------------
      // Step 3: Get TronWeb instance.
      // -----------------------------------------------------------------------
      const tronWeb = _tronRegistry.getTronWeb();

      // -----------------------------------------------------------------------
      // Step 4: Encode via protocol layer (overflow guard fires here if needed).
      // -----------------------------------------------------------------------
      let encoded;
      try {
        encoded = await _tronStake.encodeUnfreezeBalanceV2({
          tronWeb,
          from: fromAddress,
          sun: sunAmount,
          resource,
        });
      } catch (err) {
        // RangeError from overflow guard (T-NUMBER-OVERFLOW) → surface as INVALID_INPUT.
        if (err instanceof RangeError) {
          const msg = err.message;
          return {
            isError: true,
            content: [{ type: "text", text: `error: unfreeze amount exceeds safe integer range: ${msg}` }],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              "unfreeze amount exceeds JavaScript safe integer range",
              msg,
            ),
          };
        }
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `error: failed to build UnfreezeBalanceV2Contract: ${cause}` }],
          structuredContent: errEnvelope("INTERNAL_ERROR", "failed to build UnfreezeBalanceV2Contract", cause),
        };
      }

      // -----------------------------------------------------------------------
      // Step 5: Compute binding payloadFingerprint.
      // -----------------------------------------------------------------------
      const payloadFingerprint = _tronFingerprint.computeTronPayloadFingerprint(
        { rawDataBytes: encoded.rawDataBytes },
      );

      // -----------------------------------------------------------------------
      // Step 6: Build PreparedTxTron + PrepareArgs.
      // -----------------------------------------------------------------------
      const tx: PreparedTxTron = {
        txType: "tron",
        chainId: 0,
        to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        valueWei: 0n,
        data: "0x" as `0x${string}`,
        rawDataHex: encoded.rawDataHex,
        rawDataObject: encoded.rawDataObject,
        refBlockBytes: encoded.refBlockBytes,
        refBlockHash: encoded.refBlockHash,
        expiration: encoded.expiration,
        kind: "stake-unfreeze",
        instructionSummary: encoded.instructionSummary,
        // contractAddress intentionally absent: Protobuf-native, no contract_address field.
      };

      const prepareArgs: PrepareArgs = {
        to: "", // sentinel — stake-unfreeze has no recipient
        valueWei: "0",
        amount: rawAmount, // verbatim agent string (TRX in human units)
        refBlockBytes: encoded.refBlockBytes,
        refBlockHash: encoded.refBlockHash,
        expiration: String(encoded.expiration),
      };

      const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

      // -----------------------------------------------------------------------
      // Step 7: Build PREPARE RECEIPT + STAKE_RESOURCE_TRON_TEMPLATE + STAKE_WAITING_PERIOD_TRON_TEMPLATE.
      // -----------------------------------------------------------------------
      const prepareReceipt = PREPARE_RECEIPT_TRON_STAKE_UNFREEZE_TEMPLATE
        .replace("{RESOURCE}", resource)
        .replace("{SUN}", sunAmount.toString())
        .replace("{REF_BLOCK_BYTES}", encoded.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", encoded.refBlockHash)
        .replace("{EXPIRATION}", String(encoded.expiration));

      const resourceBlock = STAKE_RESOURCE_TRON_TEMPLATE
        .replace("{RESOURCE}", resource)
        .replace("{RESOURCE_DESCRIPTION}", resourceDescription(resource));

      // STAKE_WAITING_PERIOD_TRON_TEMPLATE — constant prose, no slots.
      const waitingPeriodBlock = STAKE_WAITING_PERIOD_TRON_TEMPLATE;

      const responseText = [
        prepareReceipt,
        "",
        resourceBlock,
        "",
        waitingPeriodBlock,
        "",
        `Handle: ${handle}`,
        `payloadFingerprint: ${payloadFingerprint}`,
        "",
        "Next step: pass this handle to preview_send.",
        "NOTE: After signing + broadcasting, you must wait 14 days before calling",
        "prepare_tron_withdraw_expire_unfreeze to complete the TRX withdrawal.",
      ].join("\n");

      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: {
          handle,
          chain: "tron" as const,
          resource,
          amount: rawAmount,
          sunAmount: sunAmount.toString(),
          refBlockBytes: encoded.refBlockBytes,
          refBlockHash: encoded.refBlockHash,
          expiration: encoded.expiration,
          payloadFingerprint,
          prepareReceipt,
          txType: "tron" as const,
          kind: "stake-unfreeze" as const,
          waitingPeriodDays: 14,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `error: prepare_tron_stake_unfreeze failed: ${message}` }],
        structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_tron_stake_unfreeze failed", message),
      };
    }
  },
);
