// MCP tool: prepare_tron_stake_claim_rewards()
//
// TRON Stake 2.0 claim rewards — TRON-W-07 (claim leg). Phase 19 — Plan 19-03.
//
// Withdraws accumulated staking rewards (voting rewards) from the TRON network.
// Produces a WithdrawBalanceContract Protobuf transaction — zero-arg.
//
// Pipeline:
//   demo-mode FIRST refusal (TRON persona via `getActiveTronPersona`)
//     → pairing check (`listAccounts({ chainFilter: "tron" })` non-empty in real mode)
//     → get `tronWeb` via `_tronRegistry.getTronWeb()`
//     → advisory reward estimate via `tronWeb.trx.getReward(from)` (D-06c — may fail; null OK)
//     → call `_tronVote.encodeWithdrawBalanceContract({ tronWeb, from })` (zero-arg)
//     → compute `payloadFingerprint` via `_tronFingerprint.computeTronPayloadFingerprint`
//     → `createHandle` with kind: "stake-claim-rewards"
//     → return PREPARE RECEIPT + advisory REWARD_ESTIMATE_TRON_TEMPLATE (if estimate available).
//
// D-06c: NO intent-vs-reality gate on claim rewards. The calldata is zero-arg;
// `estimatedRewardSun` is ADVISORY ONLY. null estimate is always valid and never
// blocks the prepare flow.
//
// Fixture Tron-19-D consumer re-anchor: the fixture inputs (FROM =
// TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t, pinned ref-block) produce the hardcoded
// literal `0x041642262b24aa7605340383696bb8b9905d07041945ecc53673e1f55f748724`
// pinned in `test/signing-fingerprint-tron-19.test.ts`.

import { _tronRegistry } from "../chains/tron/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActiveTronPersona } from "../demo/state.js";
import {
  PREPARE_RECEIPT_TRON_CLAIM_REWARDS_TEMPLATE,
  REWARD_ESTIMATE_TRON_TEMPLATE,
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
import { _tronVote } from "../protocols/tron-vote.js";
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
  "Prepare an unsigned TRON Stake 2.0 claim rewards transaction (WithdrawBalanceContract) from the paired TRON Ledger account.",
  "Withdraws accumulated TRON staking rewards (voting rewards distributed by Super Representatives) to the paired account.",
  "This transaction takes no additional arguments — it automatically claims all pending rewards for the paired address.",
  "An advisory estimated reward amount (in SUN) is fetched from the TRON network and surfaced in the response for information purposes only.",
  "The estimate is advisory (D-06c) and does not block the prepare flow if unavailable.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Failure modes: WALLET_NOT_PAIRED (no paired TRON account), WRONG_MODE (demo mode but no TRON persona).",
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
  "prepare_tron_stake_claim_rewards",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // -----------------------------------------------------------------------
      // Step 1: Demo-mode FIRST refusal.
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
            content: [{ type: "text", text: "error: no paired TRON account. Call `pair_tron_ledger` first." }],
            structuredContent: errEnvelope("WALLET_NOT_PAIRED", "no paired TRON account; call pair_tron_ledger first"),
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
      // Step 3: Advisory reward estimate (D-06c — may fail; null OK; never blocks).
      // -----------------------------------------------------------------------
      let estimatedRewardSun: bigint | null = null;
      try {
        const rewardRaw = await tronWeb.trx.getReward(fromAddress);
        // getReward returns the reward in SUN as a number.
        if (typeof rewardRaw === "number" && rewardRaw >= 0) {
          estimatedRewardSun = BigInt(Math.trunc(rewardRaw));
        } else if (typeof rewardRaw === "string") {
          const parsed = parseInt(rewardRaw, 10);
          if (!isNaN(parsed) && parsed >= 0) {
            estimatedRewardSun = BigInt(parsed);
          }
        }
      } catch {
        // D-06c: advisory fetch failure → null (never blocks prepare flow)
        estimatedRewardSun = null;
      }

      // -----------------------------------------------------------------------
      // Step 4: Encode via protocol layer (zero-arg WithdrawBalanceContract).
      // -----------------------------------------------------------------------
      let encoded;
      try {
        encoded = await _tronVote.encodeWithdrawBalanceContract({
          tronWeb,
          from: fromAddress,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `error: failed to build WithdrawBalanceContract: ${cause}` }],
          structuredContent: errEnvelope("INTERNAL_ERROR", "failed to build WithdrawBalanceContract", cause),
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

      // Patch estimatedRewardSun into instructionSummary[0] if we fetched a value.
      // The encoder always returns null; the tool layer populates it here.
      const instructionSummary = [...encoded.instructionSummary];
      if (instructionSummary[0] && instructionSummary[0].kind === "stake-claim-rewards" && estimatedRewardSun !== null) {
        instructionSummary[0] = { ...instructionSummary[0], estimatedRewardSun };
      }

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
        kind: "stake-claim-rewards",
        instructionSummary,
        // contractAddress intentionally absent: Protobuf-native WithdrawBalanceContract.
      };

      const prepareArgs: PrepareArgs = {
        to: "", // sentinel — claim-rewards has no recipient
        valueWei: "0",
        refBlockBytes: encoded.refBlockBytes,
        refBlockHash: encoded.refBlockHash,
        expiration: String(encoded.expiration),
      };

      const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

      // -----------------------------------------------------------------------
      // Step 7: Build PREPARE RECEIPT + advisory reward estimate block.
      // -----------------------------------------------------------------------
      const prepareReceipt = PREPARE_RECEIPT_TRON_CLAIM_REWARDS_TEMPLATE
        .replace("{REF_BLOCK_BYTES}", encoded.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", encoded.refBlockHash)
        .replace("{EXPIRATION}", String(encoded.expiration));

      // Advisory reward estimate block — emitted only when estimate available.
      const rewardBlock = estimatedRewardSun !== null
        ? REWARD_ESTIMATE_TRON_TEMPLATE
            .replace("{ESTIMATED_REWARD_SUN}", estimatedRewardSun.toString())
        : "";

      const responseText = [
        prepareReceipt,
        ...(rewardBlock ? [rewardBlock] : []),
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
          estimatedRewardSun: estimatedRewardSun !== null ? estimatedRewardSun.toString() : null,
          refBlockBytes: encoded.refBlockBytes,
          refBlockHash: encoded.refBlockHash,
          expiration: encoded.expiration,
          payloadFingerprint,
          prepareReceipt,
          txType: "tron" as const,
          kind: "stake-claim-rewards" as const,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `error: prepare_tron_stake_claim_rewards failed: ${message}` }],
        structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_tron_stake_claim_rewards failed", message),
      };
    }
  },
);
