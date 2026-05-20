// MCP tool: prepare_tron_stake_vote({ votes, srSource })
//
// TRON Stake 2.0 vote — TRON-W-06 (vote leg). Phase 19 — Plan 19-03.
//
// Allocates frozen TRX vote power to Super Representatives (SRs).
// Produces a VoteWitnessContract Protobuf transaction.
//
// Pipeline:
//   input-validation (`votes` non-empty array, no duplicate srAddress)
//     → demo-mode FIRST refusal (TRON persona via `getActiveTronPersona`)
//     → pairing check (`listAccounts({ chainFilter: "tron" })` non-empty in real mode)
//     → load SR registry via `_tronSrRegistry.loadSrRegistry(tronWeb)` (D-05 hybrid)
//     → annotate each vote with advisory label from registry (D-05c)
//     → call `_tronVote.encodeVoteWitness({ tronWeb, from, votes })` (T-VOTE-MAP critical)
//     → compute `payloadFingerprint` via `_tronFingerprint.computeTronPayloadFingerprint`
//     → `createHandle` with kind: "stake-vote"
//     → return PREPARE RECEIPT + per-SR labels block.
//
// D-05c SR label policy:
//   - Known SR (in registry): `(SR: <name> — vote rank <N>)`
//   - Unknown SR: `(unverified SR — confirm address)`
// The on-device `vote_address` (base58check) is the trust anchor; labels are advisory.
// `srSource: "live" | "snapshot-fallback"` ALWAYS surfaced in response per D-05b.
//
// Fixture Tron-19-C consumer re-anchor: the fixture inputs (FROM =
// TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t, SR1=TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH count=100,
// SR2=TE7hnUtWRRBz3SkFrX8JESWUmEvxxAhoPt count=200, pinned ref-block) produce the
// hardcoded literal `0x7e2402e3fdf03906c703c8bec9668412f6ae8bc5a483e12ff35cf157c6510d57`
// pinned in `test/signing-fingerprint-tron-19.test.ts`.

import { _tronRegistry } from "../chains/tron/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActiveTronPersona } from "../demo/state.js";
import {
  PREPARE_RECEIPT_TRON_VOTE_TEMPLATE,
  SR_LABEL_TRON_TEMPLATE,
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
import { _tronSrRegistry } from "../protocols/tron-sr-registry.js";
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
  "Prepare an unsigned TRON Stake 2.0 vote transaction (VoteWitnessContract) from the paired TRON Ledger account.",
  "Allocates your frozen TRX vote power to one or more Super Representatives (SRs).",
  "`votes` is an array of { srAddress, count } objects where `srAddress` is a base58check SR address and `count` is the vote power to allocate.",
  "Duplicate srAddress entries are rejected with INVALID_INPUT.",
  "SR labels are advisory only — the on-device vote_address (base58check) is the trust anchor.",
  "The SR registry is fetched live from the TRON network; a bundled snapshot is used as fallback if the RPC call fails.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Failure modes: WALLET_NOT_PAIRED (no paired TRON account), WRONG_MODE (demo mode but no TRON persona), INVALID_INPUT (empty votes or duplicate srAddress).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    votes: {
      type: "array",
      description: "Array of SR vote targets. Each entry must have `srAddress` (base58check) and `count` (vote power to allocate, positive integer).",
      items: {
        type: "object",
        properties: {
          srAddress: {
            type: "string",
            description: "Super Representative base58check address (T-prefixed, 34 chars). Trust anchor for this vote — verify on-device.",
          },
          count: {
            type: "number",
            description: "Vote power to allocate to this SR (positive integer).",
          },
        },
        required: ["srAddress", "count"],
        additionalProperties: false,
      },
      minItems: 1,
    },
    from: {
      type: "string",
      description: "Optional override for the TRON sender address (base58check). Defaults to the paired account.",
    },
  },
  required: ["votes"],
  additionalProperties: false,
};

registerTool(
  "prepare_tron_stake_vote",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // -----------------------------------------------------------------------
      // Step 1: Input validation — FIRES FIRST.
      // -----------------------------------------------------------------------
      const rawVotes = Array.isArray(args.votes) ? args.votes : [];

      if (rawVotes.length === 0) {
        return {
          isError: true,
          content: [{ type: "text", text: "error: 'votes' must be a non-empty array" }],
          structuredContent: errEnvelope("INVALID_INPUT", "'votes' array must contain at least one entry"),
        };
      }

      // Validate each vote entry and check for duplicates.
      const seenAddresses = new Set<string>();
      const votesTyped: Array<{ srAddress: string; count: number }> = [];
      for (const v of rawVotes) {
        const entry = v as Record<string, unknown>;
        const srAddress = typeof entry.srAddress === "string" ? entry.srAddress : "";
        const count = typeof entry.count === "number" ? entry.count : -1;

        if (!srAddress) {
          return {
            isError: true,
            content: [{ type: "text", text: "error: each vote entry must have a non-empty 'srAddress' string" }],
            structuredContent: errEnvelope("INVALID_INPUT", "each vote entry must have a non-empty 'srAddress' string"),
          };
        }
        if (!Number.isInteger(count) || count <= 0) {
          return {
            isError: true,
            content: [{ type: "text", text: `error: vote 'count' must be a positive integer, got: ${count}` }],
            structuredContent: errEnvelope("INVALID_INPUT", `vote 'count' must be a positive integer, got: ${count}`),
          };
        }
        if (seenAddresses.has(srAddress)) {
          return {
            isError: true,
            content: [{ type: "text", text: `error: duplicate srAddress in votes: "${srAddress}"` }],
            structuredContent: errEnvelope("INVALID_INPUT", `duplicate srAddress in votes: "${srAddress}"`),
          };
        }
        seenAddresses.add(srAddress);
        votesTyped.push({ srAddress, count });
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
      // Step 3: Get TronWeb instance.
      // -----------------------------------------------------------------------
      const tronWeb = _tronRegistry.getTronWeb();

      // -----------------------------------------------------------------------
      // Step 4: Load SR registry (D-05 hybrid: live primary, snapshot fallback).
      // srSource ALWAYS surfaced per D-05b.
      // -----------------------------------------------------------------------
      const srRegistry = await _tronSrRegistry.loadSrRegistry(tronWeb);
      const srSource = srRegistry.source;

      // -----------------------------------------------------------------------
      // Step 5: Annotate each vote with advisory SR label per D-05c.
      // -----------------------------------------------------------------------
      const annotatedVotes = votesTyped.map((v) => {
        const srEntry = _tronSrRegistry.lookupSr(srRegistry, v.srAddress);
        const label = srEntry
          ? `(SR: ${srEntry.name} — vote rank ${srEntry.rank})`
          : "(unverified SR — confirm address)";
        return { srAddress: v.srAddress, count: v.count, label };
      });

      // -----------------------------------------------------------------------
      // Step 6: Encode via protocol layer (T-VOTE-MAP critical: array→map).
      // -----------------------------------------------------------------------
      let encoded;
      try {
        encoded = await _tronVote.encodeVoteWitness({
          tronWeb,
          from: fromAddress,
          votes: annotatedVotes,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `error: failed to build VoteWitnessContract: ${cause}` }],
          structuredContent: errEnvelope("INTERNAL_ERROR", "failed to build VoteWitnessContract", cause),
        };
      }

      // -----------------------------------------------------------------------
      // Step 7: Compute binding payloadFingerprint.
      // -----------------------------------------------------------------------
      const payloadFingerprint = _tronFingerprint.computeTronPayloadFingerprint(
        { rawDataBytes: encoded.rawDataBytes },
      );

      // -----------------------------------------------------------------------
      // Step 8: Build PreparedTxTron + PrepareArgs.
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
        kind: "stake-vote",
        instructionSummary: encoded.instructionSummary,
        // contractAddress intentionally absent: Protobuf-native VoteWitnessContract.
      };

      const prepareArgs: PrepareArgs = {
        to: "", // sentinel — vote has no recipient
        valueWei: "0",
        refBlockBytes: encoded.refBlockBytes,
        refBlockHash: encoded.refBlockHash,
        expiration: String(encoded.expiration),
      };

      const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

      // -----------------------------------------------------------------------
      // Step 9: Build PREPARE RECEIPT + per-SR label rows.
      // -----------------------------------------------------------------------
      const summary0 = encoded.instructionSummary[0];
      const totalCount = summary0 && "totalCount" in summary0 ? summary0.totalCount : 0;

      const voteRows = annotatedVotes.map((v, idx) => {
        const srEntry = _tronSrRegistry.lookupSr(srRegistry, v.srAddress);
        const rank = srEntry ? String(srEntry.rank) : "unknown";
        return SR_LABEL_TRON_TEMPLATE
          .replace("{SR_RANK}", rank)
          .replace("{SR_ADDRESS}", v.srAddress)
          .replace("{SR_LABEL}", v.label)
          .replace("{SR_COUNT}", String(v.count));
      }).join("\n");

      const prepareReceipt = PREPARE_RECEIPT_TRON_VOTE_TEMPLATE
        .replace("{TOTAL_COUNT}", String(totalCount))
        .replace("{SR_SOURCE}", srSource)
        .replace("{REF_BLOCK_BYTES}", encoded.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", encoded.refBlockHash)
        .replace("{EXPIRATION}", String(encoded.expiration))
        .replace("{VOTE_ROWS}", voteRows);

      const responseText = [
        prepareReceipt,
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
          votes: annotatedVotes,
          totalCount,
          srSource,
          refBlockBytes: encoded.refBlockBytes,
          refBlockHash: encoded.refBlockHash,
          expiration: encoded.expiration,
          payloadFingerprint,
          prepareReceipt,
          txType: "tron" as const,
          kind: "stake-vote" as const,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `error: prepare_tron_stake_vote failed: ${message}` }],
        structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_tron_stake_vote failed", message),
      };
    }
  },
);
