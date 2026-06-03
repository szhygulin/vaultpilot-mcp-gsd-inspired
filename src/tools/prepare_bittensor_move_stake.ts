// MCP tool: prepare_bittensor_move_stake({ originHotkey, destinationHotkey,
//                                           originNetuid, destinationNetuid, alpha })
//
// SAME-OWNER alpha reallocation on Bittensor via subtensorModule.move_stake
// (Phase 48 — TAO-W-07). Re-delegates alpha to a DIFFERENT hotkey AND/OR a
// DIFFERENT subnet while keeping the SAME coldkey owner. This is NOT a custody
// change (contrast prepare_bittensor_transfer_stake).
//
// UNIT: `alpha` is ALPHA (the subnet token) — 47-RESEARCH §Pitfall 3.

import { buildBittensorUnsignedTx } from "../chains/bittensor/extrinsic-builder.js";
import { assertSs58Address } from "../chains/bittensor/types.js";
import { isDemoMode } from "../config/env.js";
import { getActiveBittensorPersona } from "../demo/state.js";
import {
  InvalidAmountError,
  parseBittensorAmountStrict,
} from "../signing/amount-bittensor.js";
import { PREPARE_RECEIPT_BITTENSOR_MOVE_STAKE_TEMPLATE } from "../signing/blocks-bittensor.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { _bittensorFingerprint } from "../signing/payload-fingerprint-bittensor.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

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

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const U16_MAX = 65_535;

const DESCRIPTION = [
  "Prepare an unsigned SAME-OWNER alpha reallocation on Bittensor via subtensorModule.move_stake.",
  "Moves alpha to a DIFFERENT validator hotkey and/or a DIFFERENT subnet while keeping the SAME coldkey owner — your ownership does NOT change.",
  "This is NOT a custody change. To move alpha to a DIFFERENT coldkey owner, use prepare_bittensor_transfer_stake (withdrawal-grade).",
  "Returns a handle the agent then passes to preview_send before send_transaction.",
  "Use when the user wants to re-delegate staked alpha between hotkeys/subnets they own.",
  "`originHotkey` / `destinationHotkey` are prefix-42 SS58 hotkeys (\"5…\"). `originNetuid` / `destinationNetuid` are subnet ids (0-65535).",
  "`alpha` is the amount to move as a decimal string in ALPHA units (the subnet token), NOT TAO.",
  "Requires a paired Bittensor Ledger (call pair_bittensor_ledger first).",
  "Returns `{ handle, originHotkey, destinationHotkey, originNetuid, destinationNetuid, alpha, amountUnit, payloadFingerprint, txType: \"bittensor\" }` plus a PREPARE RECEIPT.",
  "The agent MUST pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT, BROADCAST_FAILED.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    originHotkey: {
      type: "string",
      description: "Origin validator hotkey as a prefix-42 SS58 string (\"5…\").",
      pattern: "^5[1-9A-HJ-NP-Za-km-z]{46,47}$",
    },
    destinationHotkey: {
      type: "string",
      description: "Destination validator hotkey as a prefix-42 SS58 string (\"5…\").",
      pattern: "^5[1-9A-HJ-NP-Za-km-z]{46,47}$",
    },
    originNetuid: {
      type: "integer",
      description: "Origin subnet id (0-65535).",
      minimum: 0,
      maximum: 65535,
    },
    destinationNetuid: {
      type: "integer",
      description: "Destination subnet id (0-65535).",
      minimum: 0,
      maximum: 65535,
    },
    alpha: {
      type: "string",
      description:
        "Amount of ALPHA to move as a decimal string. This is ALPHA (the subnet token), NOT TAO.",
    },
  },
  required: [
    "originHotkey",
    "destinationHotkey",
    "originNetuid",
    "destinationNetuid",
    "alpha",
  ],
  additionalProperties: false,
};

registerTool(
  "prepare_bittensor_move_stake",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const originHotkey =
        typeof args.originHotkey === "string" ? args.originHotkey : "";
      const destinationHotkey =
        typeof args.destinationHotkey === "string"
          ? args.destinationHotkey
          : "";
      const rawAlpha = typeof args.alpha === "string" ? args.alpha : "";
      const originNetuid =
        typeof args.originNetuid === "number" ? args.originNetuid : NaN;
      const destinationNetuid =
        typeof args.destinationNetuid === "number"
          ? args.destinationNetuid
          : NaN;

      for (const [field, value] of [
        ["originHotkey", originHotkey],
        ["destinationHotkey", destinationHotkey],
      ] as const) {
        try {
          assertSs58Address(value);
        } catch {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: invalid '${field}': expected prefix-42 SS58 ("5…"), got "${value}"`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid '${field}': ${value}`,
            ),
          };
        }
      }

      for (const [field, value, raw] of [
        ["originNetuid", originNetuid, args.originNetuid],
        ["destinationNetuid", destinationNetuid, args.destinationNetuid],
      ] as const) {
        if (!Number.isInteger(value) || value < 0 || value > U16_MAX) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: invalid '${field}': expected u16 (0-${U16_MAX}), got ${String(raw)}`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid '${field}': ${String(raw)}`,
            ),
          };
        }
      }

      const demoActive = isDemoMode();
      let ss58Address: string;
      if (demoActive) {
        const persona = getActiveBittensorPersona();
        if (!persona) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: demo mode is on but no Bittensor persona is set. " +
                  "Call set_demo_wallet with a Bittensor persona slug first.",
              },
            ],
            structuredContent: errEnvelope(
              "WRONG_MODE",
              "demo mode is on but no Bittensor persona is set; call set_demo_wallet first",
            ),
          };
        }
        ss58Address = persona.ss58Address;
      } else {
        const accounts = listAccounts({ chainFilter: "bittensor" });
        if (accounts.length === 0 || !accounts[0]) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "error: no paired Bittensor account. Call pair_bittensor_ledger first.",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired Bittensor account; call pair_bittensor_ledger first",
            ),
          };
        }
        ss58Address = accounts[0].address;
      }

      // alpha_amount is ALPHA (Pitfall 3).
      let alphaAmount: bigint;
      try {
        alphaAmount = parseBittensorAmountStrict(rawAlpha, 9);
      } catch (err) {
        if (err instanceof InvalidAmountError) {
          return {
            isError: true,
            content: [
              { type: "text", text: `error: invalid 'alpha': ${err.message}` },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid 'alpha': ${err.message}`,
              err.kind,
            ),
          };
        }
        throw err;
      }

      let built;
      try {
        built = await buildBittensorUnsignedTx({
          kind: "move-stake",
          originHotkey,
          destinationHotkey,
          originNetuid,
          destinationNetuid,
          alphaAmount,
          ss58Address,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to build move_stake extrinsic: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "BROADCAST_FAILED",
            "failed to build move_stake extrinsic",
            cause,
          ),
        };
      }

      const payloadFingerprint =
        _bittensorFingerprint.computeBittensorPayloadFingerprint({
          signableBytes: built.signableBlob,
        });

      const handle = createHandle({
        args: {
          to: destinationHotkey,
          valueWei: "0",
          alpha: rawAlpha,
          originHotkey,
          destinationHotkey,
          originNetuid: String(originNetuid),
          destinationNetuid: String(destinationNetuid),
        },
        tx: {
          txType: "bittensor",
          chainId: 0,
          to: ZERO_ADDRESS,
          valueWei: 0n,
          data: "0x",
          signableBlob: built.signableBlob,
          signerPayloadJSON: built.signerPayloadJSON,
          ss58Address: built.ss58Address,
          section: built.section,
          method: built.method,
          mode: built.mode,
          metadataHash: built.metadataHash,
          instructionSummary: built.instructionSummary,
        },
        payloadFingerprint,
      });

      const receipt = PREPARE_RECEIPT_BITTENSOR_MOVE_STAKE_TEMPLATE.replace(
        "{ORIGIN_HOTKEY}",
        originHotkey,
      )
        .replace("{DESTINATION_HOTKEY}", destinationHotkey)
        .replace("{ORIGIN_NETUID}", String(originNetuid))
        .replace("{DESTINATION_NETUID}", String(destinationNetuid))
        .replace("{AMOUNT_ALPHA}", rawAlpha);

      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          handle,
          originHotkey,
          destinationHotkey,
          originNetuid,
          destinationNetuid,
          alpha: rawAlpha,
          amountUnit: "ALPHA",
          payloadFingerprint,
          txType: "bittensor" as const,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_bittensor_move_stake failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_bittensor_move_stake failed",
          message,
        ),
      };
    }
  },
);
