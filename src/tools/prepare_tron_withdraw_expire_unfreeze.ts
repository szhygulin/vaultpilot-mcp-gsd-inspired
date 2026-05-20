// MCP tool: prepare_tron_withdraw_expire_unfreeze()
//
// TRON Stake 2.0 withdraw expired unfreeze — TRON-W-06. Phase 19 — Plan 19-02.
//
// Withdraws ALL expired-unfreeze records for the caller (WithdrawExpireUnfreezeContract).
// ZERO args — the protocol auto-withdraws all expired records; there is no `amount`
// or `resource` parameter (RESEARCH §Topic 3 Pitfall — the second arg to
// `withdrawExpireUnfreeze` in tronweb's API is `options?: TransactionCommonOptions`,
// NOT an amount).
//
// Pipeline:
//   demo-mode FIRST refusal (TRON persona via `getActiveTronPersona`)
//     → pairing check (`listAccounts({ chainFilter: "tron" })` non-empty in real mode)
//     → get `tronWeb` via `_tronRegistry.getTronWeb()` (ESM spy seam)
//     → call `_tronStake.encodeWithdrawExpireUnfreeze({ tronWeb, from })`
//     → compute `payloadFingerprint` via `_tronFingerprint.computeTronPayloadFingerprint`
//     → `createHandle` with kind: "stake-withdraw-expire"
//     → return PREPARE RECEIPT (TRON — Stake 2.0 withdraw expired unfreeze).
//
// D-04b: preview_send will enforce a MANDATORY Layer 0.7 refusal if no expired
// unfreeze records are found (checkWithdrawableBalance returns 0). This is an
// asymmetric gate — freeze/unfreeze use advisory NO_SIMULATION_AVAILABLE, but
// withdraw-expire uses mandatory refusal to prevent a user broadcasting a no-op tx.
//
// There is NO `amount` or `resource` in the tool's schema. The protocol contract
// withdraws all expired records atomically. If the user wants to withdraw only
// some, they must wait for individual records to expire separately (not a concern
// for this v1.x scope).

import { _tronRegistry } from "../chains/tron/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActiveTronPersona } from "../demo/state.js";
import {
  PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE,
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

const DESCRIPTION = [
  "Prepare an unsigned TRON Stake 2.0 withdraw-expired-unfreeze transaction (WithdrawExpireUnfreezeContract) from the paired TRON Ledger account.",
  "Withdraws ALL expired unfreeze records atomically — no amount or resource parameters; the protocol handles all eligible records.",
  "This is the THIRD step of the stake lifecycle: (1) prepare_tron_stake_freeze → (2) prepare_tron_stake_unfreeze (initiates 14-day wait) → (3) this tool (after 14 days).",
  "preview_send WILL REFUSE if no expired unfreeze records exist (Layer 0.7 mandatory refusal via on-chain balance check). Call this only after 14 days from the unfreeze transaction.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "No `amount` or `resource` parameters — the TRON network withdraws all eligible expired records automatically.",
  "Failure modes: WALLET_NOT_PAIRED (no paired TRON account), WRONG_MODE (demo mode but no TRON persona).",
  "NOTE: preview_send will check on-chain withdrawable balance and refuse with SIMULATION_REFUSED if withdrawable === 0 (D-04b mandatory gate).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    from: {
      type: "string",
      description: "Optional override for the TRON sender address (base58check). Defaults to the paired account.",
    },
  },
  required: [],
  additionalProperties: false,
};

registerTool(
  "prepare_tron_withdraw_expire_unfreeze",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // -----------------------------------------------------------------------
      // Step 1: Demo-mode FIRST refusal (no input validation needed — zero-arg tool).
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
      // Step 2: Get TronWeb instance.
      // -----------------------------------------------------------------------
      const tronWeb = _tronRegistry.getTronWeb();

      // -----------------------------------------------------------------------
      // Step 3: Encode via protocol layer.
      // Zero-arg: WithdrawExpireUnfreezeContract takes only the owner address.
      // -----------------------------------------------------------------------
      let encoded;
      try {
        encoded = await _tronStake.encodeWithdrawExpireUnfreeze({
          tronWeb,
          from: fromAddress,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `error: failed to build WithdrawExpireUnfreezeContract: ${cause}` }],
          structuredContent: errEnvelope("INTERNAL_ERROR", "failed to build WithdrawExpireUnfreezeContract", cause),
        };
      }

      // -----------------------------------------------------------------------
      // Step 4: Compute binding payloadFingerprint.
      // -----------------------------------------------------------------------
      const payloadFingerprint = _tronFingerprint.computeTronPayloadFingerprint(
        { rawDataBytes: encoded.rawDataBytes },
      );

      // -----------------------------------------------------------------------
      // Step 5: Build PreparedTxTron + PrepareArgs.
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
        kind: "stake-withdraw-expire",
        instructionSummary: encoded.instructionSummary,
        // contractAddress intentionally absent: Protobuf-native, no contract_address field.
      };

      const prepareArgs: PrepareArgs = {
        to: "", // sentinel — withdraw-expire has no recipient
        valueWei: "0",
        amount: "0", // sentinel — no amount for zero-arg withdraw
        refBlockBytes: encoded.refBlockBytes,
        refBlockHash: encoded.refBlockHash,
        expiration: String(encoded.expiration),
      };

      const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

      // -----------------------------------------------------------------------
      // Step 6: Build PREPARE RECEIPT.
      // NOTE: No resource/sun slots — zero-arg contract.
      // -----------------------------------------------------------------------
      const prepareReceipt = PREPARE_RECEIPT_TRON_WITHDRAW_EXPIRE_TEMPLATE
        .replace("{REF_BLOCK_BYTES}", encoded.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", encoded.refBlockHash)
        .replace("{EXPIRATION}", String(encoded.expiration));

      const responseText = [
        prepareReceipt,
        "",
        "NOTE: preview_send will check on-chain withdrawable balance.",
        "If no expired unfreeze records are found, preview will refuse (D-04b mandatory gate).",
        "",
        `Handle: ${handle}`,
        `payloadFingerprint: ${payloadFingerprint}`,
        "",
        "Next step: pass this handle to preview_send.",
      ].join("\n");

      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: {
          handle,
          chain: "tron" as const,
          refBlockBytes: encoded.refBlockBytes,
          refBlockHash: encoded.refBlockHash,
          expiration: encoded.expiration,
          payloadFingerprint,
          prepareReceipt,
          txType: "tron" as const,
          kind: "stake-withdraw-expire" as const,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `error: prepare_tron_withdraw_expire_unfreeze failed: ${message}` }],
        structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_tron_withdraw_expire_unfreeze failed", message),
      };
    }
  },
);
