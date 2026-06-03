// MCP tool: prepare_bittensor_remove_stake_limit({ hotkey, netuid, alpha, tolerancePct? })
//
// The DEFAULT slippage-guarded staking EXIT for the Phase 47 Bittensor trust
// pipeline (TAO-W-03). Unstakes ALPHA from a validator hotkey via
// subtensorModule.remove_stake_limit, with a chain-derived limit_price PRICE
// FLOOR (min RAO-per-alpha you'll accept). NEVER client-side x·y=k.
//
// UNIT: the unstaked `amount` is ALPHA (the subnet token) — a DISTINCT unit
// from TAO despite the shared 9-decimal scale (47-RESEARCH §Pitfall 3). The
// add-stake entry accepts TAO/RAO. One field never accepts both — this tool's
// amount field is named `alpha`, never `rao`.

import { buildBittensorUnsignedTx } from "../chains/bittensor/extrinsic-builder.js";
import { assertSs58Address } from "../chains/bittensor/types.js";
import { isDemoMode } from "../config/env.js";
import { getActiveBittensorPersona } from "../demo/state.js";
import {
  InvalidAmountError,
  parseBittensorAmountStrict,
} from "../signing/amount-bittensor.js";
import { PREPARE_RECEIPT_BITTENSOR_REMOVE_STAKE_TEMPLATE } from "../signing/blocks-bittensor.js";
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
  "Prepare an unsigned slippage-guarded UNSTAKE on Bittensor via subtensorModule.remove_stake_limit.",
  "This is the DEFAULT staking exit — the limit_price guard (min RAO-per-alpha price) protects against dTAO AMM slippage when converting alpha back to TAO.",
  "Returns a handle the agent then passes to preview_send before send_transaction.",
  "Use when the user wants to UNSTAKE alpha from a validator hotkey on a subnet back to TAO, from their paired Bittensor Ledger coldkey.",
  "Do NOT use for staking — that's prepare_bittensor_add_stake_limit. Do NOT use for native sends.",
  "`alpha` is the amount to UNSTAKE as a decimal string in ALPHA units (the subnet token) — this is ALPHA, NOT TAO. A distinct unit despite the shared 9-decimal scale.",
  "`hotkey` is the validator's prefix-42 SS58 hotkey (\"5…\"). `netuid` is the subnet id (0-65535).",
  "`tolerancePct` is the optional slippage tolerance percent (default 0.5); the server derives limit_price from the chain's simSwapAlphaForTao expected-out adjusted by this tolerance.",
  "Requires a paired Bittensor Ledger (call pair_bittensor_ledger first).",
  "Returns `{ handle, hotkey, netuid, alpha, limitPrice, payloadFingerprint, txType: \"bittensor\" }` plus a PREPARE RECEIPT text block (amount labeled ALPHA, full hotkey SS58, subnet identity).",
  "The agent MUST pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE (demo on, no persona), INVALID_INPUT (malformed hotkey/netuid/alpha), BROADCAST_FAILED (RPC build/sim failure).",
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
    alpha: {
      type: "string",
      description:
        "Amount of ALPHA to UNSTAKE as a decimal string. This is ALPHA (the subnet token), NOT TAO.",
    },
    tolerancePct: {
      type: "number",
      description:
        "Optional slippage tolerance percent (default 0.5). limit_price = chain price floor − this %.",
      minimum: 0,
    },
  },
  required: ["hotkey", "netuid", "alpha"],
  additionalProperties: false,
};

registerTool(
  "prepare_bittensor_remove_stake_limit",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const hotkey = typeof args.hotkey === "string" ? args.hotkey : "";
      const rawAlpha = typeof args.alpha === "string" ? args.alpha : "";
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

      // amount_unstaked is ALPHA (Pitfall 3 — labeled at the receipt; the field
      // is `alpha`, never `rao`). Parsed with the same 9-decimal scale.
      let amountUnstakedAlpha: bigint;
      try {
        amountUnstakedAlpha = parseBittensorAmountStrict(rawAlpha, 9);
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
          kind: "remove-stake-limit",
          hotkey,
          netuid,
          amountUnstakedAlpha,
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
              text: `error: failed to build remove_stake_limit extrinsic: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "BROADCAST_FAILED",
            "failed to build remove_stake_limit extrinsic",
            cause,
          ),
        };
      }

      const payloadFingerprint =
        _bittensorFingerprint.computeBittensorPayloadFingerprint({
          signableBytes: built.signableBlob,
        });

      const summary =
        built.instructionSummary.kind === "remove-stake-limit"
          ? built.instructionSummary
          : undefined;

      const handle = createHandle({
        args: {
          to: hotkey,
          valueWei: "0",
          alpha: rawAlpha,
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
      const receipt = PREPARE_RECEIPT_BITTENSOR_REMOVE_STAKE_TEMPLATE.replace(
        "{HOTKEY}",
        hotkey,
      )
        .replace("{NETUID}", String(netuid))
        .replace("{SUBNET}", summary?.netuidIdentity ?? "(unresolved)")
        .replace("{AMOUNT_ALPHA}", rawAlpha)
        .replace("{LIMIT_PRICE}", (built.limitPrice ?? 0n).toString())
        .replace("{TOLERANCE_PCT}", String(tolPct))
        .replace("{ALLOW_PARTIAL}", String(summary?.allowPartial ?? true));

      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          handle,
          hotkey,
          netuid,
          alpha: rawAlpha,
          limitPrice: (built.limitPrice ?? 0n).toString(),
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
            text: `error: prepare_bittensor_remove_stake_limit failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_bittensor_remove_stake_limit failed",
          message,
        ),
      };
    }
  },
);
