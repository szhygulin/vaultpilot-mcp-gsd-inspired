// MCP tool: prepare_bittensor_native_send({ to, rao })
//
// First user-facing step of the Phase 47 Bittensor trust pipeline (TAO-W-01 /
// TAO-PREP-01 consumer). Bittensor sibling of `prepare_solana_native_send.ts`.
//
//   demo-mode FIRST refusal (Phase 46 Bittensor persona — getActiveBittensorPersona)
//     → input validation (`to` SS58 prefix-42 checksum + `rao` strict-decimal parse)
//     → pairing check (`listAccounts({ chainFilter: "bittensor" })` non-empty in real mode)
//     → build unsigned balances.transferKeepAlive via the extrinsic-builder
//     → compute payloadFingerprint via computeBittensorPayloadFingerprint over signableBlob
//     → createHandle with RAW agent strings on `args` + PreparedTxBittensor on `tx`
//     → return { handle, to, rao, payloadFingerprint, txType: "bittensor" }
//       plus a PREPARE RECEIPT (Bittensor — native transfer) text block.
//
// `rao` is RAW RAO as a decimal string (NOT decimal TAO). Off-by-decimal is the
// most common user-facing bug class per CLAUDE.md "Decimal-aware arithmetic";
// `parseBittensorAmountStrict(rao, 9)` accepts decimal TAO like "1.5" (→
// 1_500_000_000n) but rejects > 9 fractional digits + u64-overflow.

import { buildBittensorUnsignedTx } from "../chains/bittensor/extrinsic-builder.js";
import { assertSs58Address } from "../chains/bittensor/types.js";
import { isDemoMode } from "../config/env.js";
import { getActiveBittensorPersona } from "../demo/state.js";
import {
  InvalidAmountError,
  parseBittensorAmountStrict,
} from "../signing/amount-bittensor.js";
import { PREPARE_RECEIPT_BITTENSOR_NATIVE_TEMPLATE } from "../signing/blocks-bittensor.js";
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

// EVM-shape sentinels for the PreparedTxBittensor handle (rationale lives next
// to the interface in handle-store.ts).
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const DESCRIPTION = [
  "Prepare an unsigned native TAO transfer on Bittensor (subtensor / Finney) via balances.transferKeepAlive.",
  "Returns a handle the agent then passes to preview_send before send_transaction.",
  "Use when the user wants to send native TAO from their paired Bittensor Ledger coldkey.",
  "Do NOT use for staking — that's prepare_bittensor_add_stake_limit / _remove_stake_limit.",
  "Do NOT use for other chains.",
  "`rao` is the amount as a decimal string in TAO units (e.g. \"1.5\" = 1.5 TAO = 1500000000 RAO).",
  "`to` is the recipient prefix-42 SS58 address (\"5…\").",
  "Requires a paired Bittensor Ledger (call pair_bittensor_ledger first if get_bittensor_status shows paired: false).",
  "Returns `{ handle, to, rao, payloadFingerprint, txType: \"bittensor\" }` plus a PREPARE RECEIPT text block surfacing verbatim args.",
  "The agent MUST pass the handle to preview_send next — without preview + the resulting previewToken, send_transaction refuses.",
  "In demo mode, succeeds against the active Bittensor persona's address; send_transaction returns a simulation envelope instead of broadcasting.",
  "Failure modes: WALLET_NOT_PAIRED if no Bittensor account paired (real mode), WRONG_MODE if demo mode is on but no Bittensor persona is set, INVALID_INPUT if to/rao malformed, BROADCAST_FAILED if the RPC extrinsic build fails.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    to: {
      type: "string",
      description:
        "Recipient Bittensor address as a prefix-42 SS58 string (\"5…\"). Example: \"5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9\".",
      pattern: "^5[1-9A-HJ-NP-Za-km-z]{46,47}$",
    },
    rao: {
      type: "string",
      description:
        "Amount of TAO as a decimal string (\"1.5\" = 1.5 TAO). 9 decimals max; off-by-decimal is the most common user-facing bug class.",
    },
  },
  required: ["to", "rao"],
  additionalProperties: false,
};

registerTool(
  "prepare_bittensor_native_send",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const to = typeof args.to === "string" ? args.to : "";
      const rawRao = typeof args.rao === "string" ? args.rao : "";

      // SS58 checksum validation BEFORE any state read (T-47-05). decodeAddress
      // throws on wrong-checksum / look-alike — wrap into INVALID_INPUT.
      try {
        assertSs58Address(to);
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'to' address: expected prefix-42 SS58 ("5…"), got "${to}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'to' address: ${to}`,
          ),
        };
      }

      // Demo-mode FIRST refusal — read the Bittensor persona registry. demo
      // mode with no Bittensor persona set is WRONG_MODE. listAccounts is NEVER
      // called in the demo branch (defense against accidental store reads).
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
                  "Call set_demo_wallet with a Bittensor persona slug (e.g. \"bittensor-whale\") before preparing demo-mode Bittensor sends.",
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
        if (accounts.length === 0) {
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
        const account = accounts[0];
        if (!account) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "error: no paired Bittensor account (unreachable narrowing).",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired Bittensor account (unreachable narrowing)",
            ),
          };
        }
        ss58Address = account.address;
      }

      // Amount parse — `rao` is decimal TAO (decimals=9). Throws
      // InvalidAmountError → wrap into INVALID_INPUT.
      let rao: bigint;
      try {
        rao = parseBittensorAmountStrict(rawRao, 9);
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

      // Build the unsigned tx + the byte-stable signable blob. Routes through
      // the registry seam — RPC failure (e.g. accountNextIndex) → BROADCAST_FAILED.
      let built;
      try {
        built = await buildBittensorUnsignedTx({
          kind: "native",
          to,
          rao,
          ss58Address,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to build Bittensor extrinsic: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "BROADCAST_FAILED",
            "failed to build Bittensor extrinsic",
            cause,
          ),
        };
      }

      // TAO-PREP-01: compute the binding fingerprint at prepare time over the
      // signable blob. Plan 47-04's send handler re-runs this on the rebuilt
      // blob and asserts equality (drift gate). Fixture TAO-A cross-link.
      const payloadFingerprint =
        _bittensorFingerprint.computeBittensorPayloadFingerprint({
          signableBytes: built.signableBlob,
        });

      const handle = createHandle({
        args: {
          to,
          valueWei: "0",
          rao: rawRao,
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

      const receipt = PREPARE_RECEIPT_BITTENSOR_NATIVE_TEMPLATE.replace(
        "{TO}",
        to,
      ).replace("{RAO}", rawRao);

      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          handle,
          to,
          rao: rawRao,
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
            text: `error: prepare_bittensor_native_send failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_bittensor_native_send failed",
          message,
        ),
      };
    }
  },
);
