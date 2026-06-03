// MCP tool: prepare_bittensor_add_stake_limit({ hotkey, netuid, rao, tolerancePct? })
//
// The DEFAULT slippage-guarded staking ENTRY for the Phase 47 Bittensor trust
// pipeline (TAO-W-02). Stakes TAO into a validator hotkey on a subnet via
// subtensorModule.add_stake_limit, with a chain-derived limit_price PRICE
// CEILING (max RAO-per-alpha you'll pay) protecting against the dTAO AMM
// sandwich/slippage. NEVER client-side x·y=k.
//
// UNIT: the staked `amount` is TAO/RAO (NOT alpha — 47-RESEARCH §Pitfall 3).
// The remove-stake exit accepts ALPHA. One field never accepts both.
//
//   demo-mode FIRST refusal → SS58 hotkey checksum + netuid u16 range
//     → pairing check → buildBittensorUnsignedTx (limit_price via simSwapTaoForAlpha − tolerance)
//     → payloadFingerprint → createHandle (section:subtensorModule, method:addStakeLimit camelCase)
//     → PREPARE RECEIPT with the amount LABELED "TAO/RAO" + full hotkey SS58 + netuid identity.

import { buildBittensorUnsignedTx } from "../chains/bittensor/extrinsic-builder.js";
import { assertSs58Address } from "../chains/bittensor/types.js";
import { isDemoMode } from "../config/env.js";
import { getActiveBittensorPersona } from "../demo/state.js";
import {
  InvalidAmountError,
  parseBittensorAmountStrict,
} from "../signing/amount-bittensor.js";
import { PREPARE_RECEIPT_BITTENSOR_ADD_STAKE_TEMPLATE } from "../signing/blocks-bittensor.js";
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
  "Prepare an unsigned slippage-guarded TAO stake on Bittensor via subtensorModule.add_stake_limit.",
  "This is the DEFAULT staking entry — the limit_price guard (max RAO-per-alpha price) protects against dTAO AMM slippage/sandwich.",
  "Returns a handle the agent then passes to preview_send before send_transaction.",
  "Use when the user wants to STAKE TAO to a validator hotkey on a subnet from their paired Bittensor Ledger coldkey.",
  "Do NOT use for unstaking — that's prepare_bittensor_remove_stake_limit. Do NOT use for native sends.",
  "`rao` is the amount to STAKE as a decimal string in TAO units (e.g. \"2\" = 2 TAO) — this is TAO/RAO, NOT alpha.",
  "`hotkey` is the validator's prefix-42 SS58 hotkey (\"5…\"). `netuid` is the subnet id (0-65535).",
  "`tolerancePct` is the optional slippage tolerance percent (default 0.5 = 0.50%); the server derives limit_price from the chain's simSwapTaoForAlpha expected-out adjusted by this tolerance.",
  "Requires a paired Bittensor Ledger (call pair_bittensor_ledger first).",
  "Returns `{ handle, hotkey, netuid, rao, limitPrice, payloadFingerprint, txType: \"bittensor\" }` plus a PREPARE RECEIPT text block (amount labeled TAO/RAO, full hotkey SS58, subnet identity).",
  "The agent MUST pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE (demo on, no persona), INVALID_INPUT (malformed hotkey/netuid/rao), BROADCAST_FAILED (RPC build/sim failure).",
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
    tolerancePct: {
      type: "number",
      description:
        "Optional slippage tolerance percent (default 0.5). limit_price = chain price ceiling + this %.",
      minimum: 0,
    },
  },
  required: ["hotkey", "netuid", "rao"],
  additionalProperties: false,
};

registerTool(
  "prepare_bittensor_add_stake_limit",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const hotkey = typeof args.hotkey === "string" ? args.hotkey : "";
      const rawRao = typeof args.rao === "string" ? args.rao : "";
      const netuid = typeof args.netuid === "number" ? args.netuid : NaN;
      const tolerancePct =
        typeof args.tolerancePct === "number" ? args.tolerancePct : undefined;

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
          kind: "add-stake-limit",
          hotkey,
          netuid,
          amountStakedRao,
          tolerancePct,
          ss58Address,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to build add_stake_limit extrinsic: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "BROADCAST_FAILED",
            "failed to build add_stake_limit extrinsic",
            cause,
          ),
        };
      }

      const payloadFingerprint =
        _bittensorFingerprint.computeBittensorPayloadFingerprint({
          signableBytes: built.signableBlob,
        });

      const summary =
        built.instructionSummary.kind === "add-stake-limit"
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

      const tolPct = tolerancePct ?? 0.5;
      const receipt = PREPARE_RECEIPT_BITTENSOR_ADD_STAKE_TEMPLATE.replace(
        "{HOTKEY}",
        hotkey,
      )
        .replace("{NETUID}", String(netuid))
        .replace("{SUBNET}", summary?.netuidIdentity ?? "(unresolved)")
        .replace("{AMOUNT_RAO}", rawRao)
        .replace("{LIMIT_PRICE}", (built.limitPrice ?? 0n).toString())
        .replace("{TOLERANCE_PCT}", String(tolPct))
        .replace("{ALLOW_PARTIAL}", String(summary?.allowPartial ?? true));

      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          handle,
          hotkey,
          netuid,
          rao: rawRao,
          limitPrice: (built.limitPrice ?? 0n).toString(),
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
            text: `error: prepare_bittensor_add_stake_limit failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_bittensor_add_stake_limit failed",
          message,
        ),
      };
    }
  },
);
