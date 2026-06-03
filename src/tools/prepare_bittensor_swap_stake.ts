// MCP tool: prepare_bittensor_swap_stake({ hotkey, originNetuid,
//                                           destinationNetuid, alpha })
//
// SAME-OWNER alpha subnet-swap on Bittensor via subtensorModule.swap_stake
// (Phase 48 — TAO-W-07). Moves alpha BETWEEN subnets for the SAME hotkey,
// keeping the SAME coldkey owner. NOT a custody change.
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
import { PREPARE_RECEIPT_BITTENSOR_SWAP_STAKE_TEMPLATE } from "../signing/blocks-bittensor.js";
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
  "Prepare an unsigned SAME-OWNER alpha subnet-swap on Bittensor via subtensorModule.swap_stake.",
  "Moves alpha BETWEEN subnets for the SAME validator hotkey while keeping the SAME coldkey owner — your ownership does NOT change.",
  "This is NOT a custody change, and the hotkey is unchanged (use prepare_bittensor_move_stake to also change hotkey; use prepare_bittensor_transfer_stake to change owner).",
  "Returns a handle the agent then passes to preview_send before send_transaction.",
  "Use when the user wants to move their staked alpha from one subnet to another on the same validator.",
  "`hotkey` is the validator's prefix-42 SS58 hotkey (\"5…\"). `originNetuid` / `destinationNetuid` are subnet ids (0-65535).",
  "`alpha` is the amount to swap as a decimal string in ALPHA units (the subnet token), NOT TAO.",
  "Requires a paired Bittensor Ledger (call pair_bittensor_ledger first).",
  "Returns `{ handle, hotkey, originNetuid, destinationNetuid, alpha, amountUnit, payloadFingerprint, txType: \"bittensor\" }` plus a PREPARE RECEIPT.",
  "The agent MUST pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT, BROADCAST_FAILED.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    hotkey: {
      type: "string",
      description: "Validator hotkey as a prefix-42 SS58 string (\"5…\").",
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
        "Amount of ALPHA to swap as a decimal string. This is ALPHA (the subnet token), NOT TAO.",
    },
  },
  required: ["hotkey", "originNetuid", "destinationNetuid", "alpha"],
  additionalProperties: false,
};

registerTool(
  "prepare_bittensor_swap_stake",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const hotkey = typeof args.hotkey === "string" ? args.hotkey : "";
      const rawAlpha = typeof args.alpha === "string" ? args.alpha : "";
      const originNetuid =
        typeof args.originNetuid === "number" ? args.originNetuid : NaN;
      const destinationNetuid =
        typeof args.destinationNetuid === "number"
          ? args.destinationNetuid
          : NaN;

      try {
        assertSs58Address(hotkey);
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'hotkey': expected prefix-42 SS58 ("5…"), got "${hotkey}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'hotkey': ${hotkey}`,
          ),
        };
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
          kind: "swap-stake",
          hotkey,
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
              text: `error: failed to build swap_stake extrinsic: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "BROADCAST_FAILED",
            "failed to build swap_stake extrinsic",
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
          to: hotkey,
          valueWei: "0",
          alpha: rawAlpha,
          hotkey,
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

      const receipt = PREPARE_RECEIPT_BITTENSOR_SWAP_STAKE_TEMPLATE.replace(
        "{HOTKEY}",
        hotkey,
      )
        .replace("{ORIGIN_NETUID}", String(originNetuid))
        .replace("{DESTINATION_NETUID}", String(destinationNetuid))
        .replace("{AMOUNT_ALPHA}", rawAlpha);

      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          handle,
          hotkey,
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
            text: `error: prepare_bittensor_swap_stake failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_bittensor_swap_stake failed",
          message,
        ),
      };
    }
  },
);
