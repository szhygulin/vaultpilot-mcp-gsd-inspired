// MCP tool: prepare_bittensor_transfer_stake({ destinationColdkey, hotkey,
//                                               originNetuid, destinationNetuid, alpha })
//
// CUSTODY-CHANGING alpha transfer on Bittensor via subtensorModule.transfer_stake
// (Phase 48 — TAO-W-08). The alpha LEAVES your paired coldkey and lands under a
// DIFFERENT coldkey (`destinationColdkey`). WITHDRAWAL-GRADE: the destination
// coldkey is REQUIRED, SS58-validated, and echoed FULL/untruncated in the
// receipt + structuredContent; the preview emits a distinct
// [WITHDRAWAL — CUSTODY CHANGE] block (move/swap do NOT).
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
import { PREPARE_RECEIPT_BITTENSOR_TRANSFER_STAKE_TEMPLATE } from "../signing/blocks-bittensor.js";
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
  "Prepare an unsigned CUSTODY-CHANGING alpha transfer on Bittensor via subtensorModule.transfer_stake.",
  "WITHDRAWAL-GRADE: the alpha LEAVES your paired coldkey and is moved to a DIFFERENT coldkey owner (destinationColdkey). After this, you no longer own the alpha.",
  "This is DISTINCT from prepare_bittensor_move_stake (which keeps your ownership). The preview emits a [WITHDRAWAL — CUSTODY CHANGE] block with the full destination coldkey.",
  "Returns a handle the agent then passes to preview_send before send_transaction.",
  "Use ONLY when the user explicitly wants to transfer staked alpha to a DIFFERENT coldkey owner.",
  "`destinationColdkey` is REQUIRED — the prefix-42 SS58 coldkey (\"5…\") that will OWN the alpha after the transfer. It is echoed FULL/untruncated in the receipt.",
  "`hotkey` is the validator's prefix-42 SS58 hotkey (\"5…\"). `originNetuid` / `destinationNetuid` are subnet ids (0-65535).",
  "`alpha` is the amount to transfer as a decimal string in ALPHA units (the subnet token), NOT TAO.",
  "Requires a paired Bittensor Ledger (call pair_bittensor_ledger first).",
  "Returns `{ handle, destinationColdkey, hotkey, originNetuid, destinationNetuid, alpha, amountUnit, payloadFingerprint, txType: \"bittensor\" }` plus a PREPARE RECEIPT with the full destination coldkey.",
  "The agent MUST pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT (malformed destinationColdkey/hotkey/netuid/alpha), BROADCAST_FAILED.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    destinationColdkey: {
      type: "string",
      description:
        "Destination coldkey (the NEW owner) as a prefix-42 SS58 string (\"5…\"). REQUIRED — this is a custody change.",
      pattern: "^5[1-9A-HJ-NP-Za-km-z]{46,47}$",
    },
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
        "Amount of ALPHA to transfer as a decimal string. This is ALPHA (the subnet token), NOT TAO.",
    },
  },
  required: [
    "destinationColdkey",
    "hotkey",
    "originNetuid",
    "destinationNetuid",
    "alpha",
  ],
  additionalProperties: false,
};

registerTool(
  "prepare_bittensor_transfer_stake",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const destinationColdkey =
        typeof args.destinationColdkey === "string"
          ? args.destinationColdkey
          : "";
      const hotkey = typeof args.hotkey === "string" ? args.hotkey : "";
      const rawAlpha = typeof args.alpha === "string" ? args.alpha : "";
      const originNetuid =
        typeof args.originNetuid === "number" ? args.originNetuid : NaN;
      const destinationNetuid =
        typeof args.destinationNetuid === "number"
          ? args.destinationNetuid
          : NaN;

      // SS58-validate BOTH the destination coldkey (custody dest) and the hotkey.
      for (const [field, value] of [
        ["destinationColdkey", destinationColdkey],
        ["hotkey", hotkey],
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
          kind: "transfer-stake",
          destinationColdkey,
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
              text: `error: failed to build transfer_stake extrinsic: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "BROADCAST_FAILED",
            "failed to build transfer_stake extrinsic",
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
          to: destinationColdkey,
          valueWei: "0",
          alpha: rawAlpha,
          destinationColdkey,
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

      // destination_coldkey echoed FULL/untruncated (TAO-W-08 + no-truncation invariant).
      const receipt = PREPARE_RECEIPT_BITTENSOR_TRANSFER_STAKE_TEMPLATE.replace(
        "{DESTINATION_COLDKEY}",
        destinationColdkey,
      )
        .replace("{HOTKEY}", hotkey)
        .replace("{ORIGIN_NETUID}", String(originNetuid))
        .replace("{DESTINATION_NETUID}", String(destinationNetuid))
        .replace("{AMOUNT_ALPHA}", rawAlpha);

      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          handle,
          destinationColdkey,
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
            text: `error: prepare_bittensor_transfer_stake failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_bittensor_transfer_stake failed",
          message,
        ),
      };
    }
  },
);
