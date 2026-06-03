// MCP tool: prepare_bittensor_add_stake({ hotkey, netuid, rao })
//
// PLAIN unguarded TAO stake on Bittensor via subtensorModule.add_stake (Phase
// 48 — TAO-W-06). NO limit_price — the dTAO AMM is concentrated-liquidity, so
// this can slip/sandwich; the preview emits a [NOTICE — no slippage guard]
// steering to prepare_bittensor_add_stake_limit (the guarded DEFAULT).
//
// UNIT: the staked `amount` is TAO/RAO (NOT alpha — 47-RESEARCH §Pitfall 3).
// Field is named `rao`. Clone of prepare_bittensor_add_stake_limit minus the
// tolerancePct/limitPrice/simSwap guard plumbing.

import { buildBittensorUnsignedTx } from "../chains/bittensor/extrinsic-builder.js";
import { assertSs58Address } from "../chains/bittensor/types.js";
import { isDemoMode } from "../config/env.js";
import { getActiveBittensorPersona } from "../demo/state.js";
import {
  InvalidAmountError,
  parseBittensorAmountStrict,
} from "../signing/amount-bittensor.js";
import { PREPARE_RECEIPT_BITTENSOR_ADD_STAKE_PLAIN_TEMPLATE } from "../signing/blocks-bittensor.js";
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
  "Prepare an unsigned PLAIN TAO stake on Bittensor via subtensorModule.add_stake.",
  "This is the UNGUARDED variant — there is NO limit_price slippage protection. On the concentrated-liquidity dTAO AMM a large stake can slip or be sandwiched.",
  "PREFER prepare_bittensor_add_stake_limit (the slippage-guarded DEFAULT) unless the user explicitly wants the plain call.",
  "Returns a handle the agent then passes to preview_send before send_transaction.",
  "Use when the user wants to STAKE TAO to a validator hotkey on a subnet with NO slippage guard.",
  "Do NOT use for unstaking — that's prepare_bittensor_remove_stake. Do NOT use for native sends.",
  "`rao` is the amount to STAKE as a decimal string in TAO units (e.g. \"2\" = 2 TAO) — this is TAO/RAO, NOT alpha.",
  "`hotkey` is the validator's prefix-42 SS58 hotkey (\"5…\"). `netuid` is the subnet id (0-65535).",
  "Requires a paired Bittensor Ledger (call pair_bittensor_ledger first).",
  "Returns `{ handle, hotkey, netuid, rao, amountUnit, payloadFingerprint, txType: \"bittensor\" }` plus a PREPARE RECEIPT (amount labeled TAO/RAO, full hotkey SS58).",
  "The agent MUST pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE (demo on, no persona), INVALID_INPUT (malformed hotkey/netuid/rao), BROADCAST_FAILED (RPC build failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    hotkey: {
      type: "string",
      description: "Validator hotkey as a prefix-42 SS58 string (\"5…\").",
      pattern: "^5[1-9A-HJ-NP-Za-km-z]{46,47}$",
    },
    netuid: {
      type: "integer",
      description: "Subnet id (0-65535).",
      minimum: 0,
      maximum: 65535,
    },
    rao: {
      type: "string",
      description:
        "Amount of TAO to STAKE as a decimal string (\"2\" = 2 TAO). This is TAO/RAO, NOT alpha.",
    },
  },
  required: ["hotkey", "netuid", "rao"],
  additionalProperties: false,
};

registerTool(
  "prepare_bittensor_add_stake",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const hotkey = typeof args.hotkey === "string" ? args.hotkey : "";
      const rawRao = typeof args.rao === "string" ? args.rao : "";
      const netuid = typeof args.netuid === "number" ? args.netuid : NaN;

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

      if (!Number.isInteger(netuid) || netuid < 0 || netuid > U16_MAX) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'netuid': expected u16 (0-${U16_MAX}), got ${String(args.netuid)}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'netuid': ${String(args.netuid)}`,
          ),
        };
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

      // amount_staked is TAO/RAO (Pitfall 3 — labeled at the receipt).
      let amountStakedRao: bigint;
      try {
        amountStakedRao = parseBittensorAmountStrict(rawRao, 9);
      } catch (err) {
        if (err instanceof InvalidAmountError) {
          return {
            isError: true,
            content: [
              { type: "text", text: `error: invalid 'rao': ${err.message}` },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid 'rao': ${err.message}`,
              err.kind,
            ),
          };
        }
        throw err;
      }

      let built;
      try {
        built = await buildBittensorUnsignedTx({
          kind: "add-stake",
          hotkey,
          netuid,
          amountStakedRao,
          ss58Address,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to build add_stake extrinsic: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "BROADCAST_FAILED",
            "failed to build add_stake extrinsic",
            cause,
          ),
        };
      }

      const payloadFingerprint =
        _bittensorFingerprint.computeBittensorPayloadFingerprint({
          signableBytes: built.signableBlob,
        });

      const summary =
        built.instructionSummary.kind === "add-stake"
          ? built.instructionSummary
          : undefined;

      const handle = createHandle({
        args: {
          to: hotkey,
          valueWei: "0",
          rao: rawRao,
          hotkey,
          netuid: String(netuid),
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

      const receipt = PREPARE_RECEIPT_BITTENSOR_ADD_STAKE_PLAIN_TEMPLATE.replace(
        "{HOTKEY}",
        hotkey,
      )
        .replace("{NETUID}", String(netuid))
        .replace("{SUBNET}", summary?.netuidIdentity ?? "(unresolved)")
        .replace("{AMOUNT_RAO}", rawRao);

      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          handle,
          hotkey,
          netuid,
          rao: rawRao,
          amountUnit: "TAO/RAO",
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
            text: `error: prepare_bittensor_add_stake failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_bittensor_add_stake failed",
          message,
        ),
      };
    }
  },
);
