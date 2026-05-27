// MCP tool: submit_safe_tx_signature({
//   chain, safeAddress, safeTxHash, signature, userDecision
// })
//
// Phase 37 Plan 37-02 (SAFE-07) — publishes a typed-data signature (from
// prepare_safe_tx_propose or prepare_safe_tx_approve) to the Safe Tx Service.
// NOT an on-chain tx — does NOT route through send_transaction. The trust-
// pipeline defenses for this tool live in two server-side cross-checks
// performed BEFORE any network call:
//
//   1. v-byte gate: signatures with v ∈ {0, 1} (EIP-1271 contract signatures /
//      pre-approved hashes) are refused with INVALID_SIGNATURE_MODE — Phase
//      37 ECDSA-only. (T-37-13 mitigation.)
//   2. ECDSA-recover the signer from `signature` over the RAW 32-byte
//      safeTxHash digest via viem.recoverAddress (NOT personal_sign wrapped —
//      RESEARCH Pitfall 8). Refuse if recovered signer is NOT a paired-Ledger
//      address (T-37-09 mitigation). Refuse if recovered signer is NOT an
//      on-chain Safe owner via _safeChains.getOnchainSafeInfo (T-37-11
//      mitigation against stale Tx Service state post-removeOwner).
//
// Handle correlation (optional): if a PreparedTxSafeTypedData handle exists
// in the store matching (chain, safeAddress, safeTxHash) via
// findHandlesBySafeTxHash, recompute payloadFingerprint over its tx fields
// and refuse PAYLOAD_FINGERPRINT_DRIFT on mismatch (T-37-14 mitigation). When
// no handle is found, surface `handleNotFound: true` informationally and
// proceed (Plan 37-02 CONTEXT lock — agent may have restarted between
// prepare and submit).
//
// State-machine transition: on a successful POST AND with a matching handle,
// bridge prepared → previewed → sent with sentinel pinned values, stamping
// safeTxHash as the record.txHash per Plan 37-01 widening. The Safe-typed-data
// flow doesn't route through preview_send, so the submit tool internally
// owns the full state-machine transition for this handle kind.
//
// userDecision: "cancel" path: looks up the handle, transitions to "cancelled"
// via transitionToCancelled, does NOT recover, does NOT POST. Schema-level
// required arg even though no on-chain tx (the user explicitly chose to
// publish their signature; mirror of send_transaction's gate).
//
// POST body: exactly {"signature":"0x..."} (no owner field, no signatureType
// field — server derives owner via server-side ECDSA recovery; T-37-15
// mitigation enforced at the client layer in safe-tx-service.ts).

import { recoverAddress, type Address, type Hex, getAddress } from "viem";

import { _safeChains } from "../chains/safe.js";
import { getChainClient } from "../chains/registry.js";
import * as safeTxService from "../clients/safe-tx-service.js";
import {
  chainIdFromName,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  findHandlesBySafeTxHash,
  transitionToCancelled,
  transitionToPreviewed,
  transitionToSent,
  type PreparedTxSafeTypedData,
} from "../signing/handle-store.js";
import { computeSafeTxPayloadFingerprint } from "../signing/payload-fingerprint.js";
import { getStatus } from "../wallet/session-manager.js";
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

const DESCRIPTION = [
  "Posts a typed-data signature (from prepare_safe_tx_propose or prepare_safe_tx_approve) to the Safe Tx Service.",
  "NOT an on-chain tx — does NOT route through send_transaction.",
  "ECDSA-recovers the signer locally and refuses BEFORE any network call if the recovered signer is not a paired Ledger OR not an on-chain Safe owner.",
  "Required args: chain, safeAddress, safeTxHash, signature (65-byte hex; v in {27, 28} for ECDSA or {31, 32} for Safe's eth_sign mode), userDecision ('send' or 'cancel').",
  "On 'send': v ∈ {0, 1} (EIP-1271 contract signatures / pre-approved hashes) are refused as INVALID_SIGNATURE_MODE. ECDSA + eth_sign modes proceed to recovery.",
  "On 'cancel': transitions the matching handle (if any) to cancelled; does NOT POST.",
  "Returns `{ recoveredSigner, txServiceResult, handleFound, handleNotFound?, duplicateRePost? }` plus PREPARE RECEIPT + CHECKS PERFORMED text blocks.",
  "Failure modes: INVALID_SIGNATURE_MODE (v in {0, 1}), INVALID_INPUT (recovery mismatch / Tx Service errors / sender-not-owner), PAYLOAD_FINGERPRINT_DRIFT (handle args drifted from prepare time), INTERNAL_ERROR.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description:
        "Chain identifier (required). Supported: ethereum, arbitrum, polygon, base, optimism.",
    },
    safeAddress: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "Safe proxy address.",
    },
    safeTxHash: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{64}$",
      description:
        "32-byte EIP-712 SafeTx digest — must match the safeTxHash from the prepare step + Tx Service record.",
    },
    signature: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{130}$",
      description:
        "65-byte typed-data signature (130 hex chars). v-byte (last byte) MUST be in {27, 28} for ECDSA or {31, 32} for Safe eth_sign mode.",
    },
    userDecision: {
      type: "string",
      enum: ["send", "cancel"],
      description:
        "User's explicit choice. 'send' publishes the signature; 'cancel' transitions the handle to cancelled without posting.",
    },
  },
  required: ["chain", "safeAddress", "safeTxHash", "signature", "userDecision"],
  additionalProperties: false,
};

registerTool(
  "submit_safe_tx_signature",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // Step 1 — schema defense-in-depth (the protocol-layer JSON-schema gate
      // catches most malformed input; direct handler invocation via tests can
      // bypass that gate).
      const chainArg = args.chain;
      if (
        typeof chainArg !== "string" ||
        !["ethereum", "arbitrum", "polygon", "base", "optimism"].includes(
          chainArg,
        )
      ) {
        const msg = `invalid 'chain': expected one of ethereum/arbitrum/polygon/base/optimism, got "${String(chainArg)}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const chainName = chainArg as ChainName;
      const chainId: ChainId = chainIdFromName(chainName);

      const rawSafeAddress =
        typeof args.safeAddress === "string" ? args.safeAddress : "";
      if (!/^0x[0-9a-fA-F]{40}$/.test(rawSafeAddress)) {
        const msg = `invalid 'safeAddress': expected 0x-prefixed 20-byte hex, got "${rawSafeAddress}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const safeAddress = getAddress(rawSafeAddress) as Address;

      const rawSafeTxHash =
        typeof args.safeTxHash === "string" ? args.safeTxHash : "";
      if (!/^0x[0-9a-fA-F]{64}$/.test(rawSafeTxHash)) {
        const msg = `invalid 'safeTxHash': expected 0x-prefixed 32-byte hex, got "${rawSafeTxHash}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const safeTxHash = rawSafeTxHash as Hex;

      const rawSignature =
        typeof args.signature === "string" ? args.signature : "";
      if (!/^0x[0-9a-fA-F]{130}$/.test(rawSignature)) {
        const msg = `invalid 'signature': expected 0x-prefixed 65-byte hex (130 hex chars), got length ${rawSignature.length}`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const signature = rawSignature as Hex;

      const userDecisionRaw = args.userDecision;
      if (userDecisionRaw !== "send" && userDecisionRaw !== "cancel") {
        const msg = `invalid 'userDecision': expected 'send' or 'cancel', got "${String(userDecisionRaw)}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const userDecision: "send" | "cancel" = userDecisionRaw;

      // Step 2 — userDecision: "cancel" short-circuit. Looks up the handle
      // (if any), transitions to cancelled, returns. Does NOT recover,
      // does NOT POST.
      if (userDecision === "cancel") {
        const matches = findHandlesBySafeTxHash(
          chainId,
          safeAddress,
          safeTxHash,
        );
        let cancelledHandle: string | null = null;
        const target = matches[0];
        if (target !== undefined) {
          const result = transitionToCancelled(target.handle);
          if (result.ok) {
            cancelledHandle = target.handle;
          }
        }
        const prepareReceipt = [
          "PREPARE RECEIPT",
          "  operation:        Safe multisig submit signature — CANCELLED",
          `  chain:            ${chainName} (chainId ${chainId})`,
          `  safe:             ${rawSafeAddress}`,
          `  safeTxHash:       ${safeTxHash}`,
          `  signature:        ${signature.slice(0, 8)}...${signature.slice(-6)}`,
          `  userDecision:     cancel`,
        ].join("\n");
        const checks = [
          "CHECKS PERFORMED",
          "  Signature submission cancelled at user's explicit request.",
          ...(cancelledHandle
            ? [`  Handle ${cancelledHandle} transitioned to 'cancelled'.`]
            : ["  No matching handle in store; nothing to cancel."]),
        ].join("\n");
        return {
          content: [
            { type: "text", text: [prepareReceipt, checks].join("\n\n") },
          ],
          structuredContent: {
            chain: chainName,
            chainId,
            safeAddress: rawSafeAddress,
            safeTxHash,
            userDecision,
            cancelled: true,
            handleFound: cancelledHandle !== null,
            ...(cancelledHandle === null ? { handleNotFound: true } : {}),
          },
        };
      }

      // Step 3 — v-byte gate (T-37-13 mitigation). Refuses v ∈ {0, 1}
      // BEFORE recovery — EIP-1271 contract sigs + pre-approved hashes are
      // deferred to v3.x. Phase 37 accepts ECDSA (27/28) + Safe eth_sign
      // mode (31/32 per RESEARCH §Pitfall 6).
      const vHex = signature.slice(130, 132);
      const vByte = parseInt(vHex, 16);
      if (vByte < 27) {
        const msg =
          `Only ECDSA signatures (v=27/28) or Safe eth_sign mode (v=31/32) accepted at this phase. ` +
          `Got v=${vByte} (${vByte === 0 ? "EIP-1271 contract signature" : "pre-approved hash"}). ` +
          `Contract signatures (v=0) and pre-approved hashes (v=1) deferred to v3.x.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_SIGNATURE_MODE", msg),
        };
      }

      // Step 4 — ECDSA-recover the signer. RAW 32-byte digest, NOT
      // personal_sign-wrapped (RESEARCH Pitfall 8 mitigation).
      let recoveredSigner: Address;
      try {
        recoveredSigner = await recoverAddress({
          hash: safeTxHash,
          signature,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: ECDSA-recovery failed for signature over safeTxHash ${safeTxHash}: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `ECDSA-recovery failed: ${message}`,
          ),
        };
      }
      const lcRecovered = recoveredSigner.toLowerCase();

      // Step 5 — Paired-wallet cross-check (T-37-09 mitigation). Refuses
      // BEFORE any POST when the recovered address isn't in the live WC
      // session's paired set.
      const status = await getStatus();
      if (status === null) {
        const msg =
          "no live Ledger session. Call pair_ledger_live to pair a Ledger via WalletConnect, then retry.";
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("WALLET_NOT_PAIRED", msg),
        };
      }
      const lcPairedSet = new Set(
        status.accounts.map((a) => a.toLowerCase()),
      );
      if (!lcPairedSet.has(lcRecovered)) {
        const msg =
          `Signature recovered to ${recoveredSigner}; not a paired wallet (paired: ${status.accounts.join(", ")}). ` +
          `Re-sign via the correct wallet.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

      // Step 6 — On-chain owner cross-check (T-37-11 mitigation against stale
      // Tx Service state after a recent removeOwner). Refuses BEFORE any POST.
      const client = getChainClient(chainId);
      let onchainInfo: Awaited<
        ReturnType<typeof _safeChains.getOnchainSafeInfo>
      >;
      try {
        onchainInfo = await _safeChains.getOnchainSafeInfo(
          client,
          chainId,
          safeAddress,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to read on-chain Safe state for ${safeAddress}: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            `failed to read on-chain Safe state for ${safeAddress}`,
            message,
          ),
        };
      }
      const lcOwners = new Set(
        onchainInfo.owners.map((o) => o.toLowerCase()),
      );
      if (!lcOwners.has(lcRecovered)) {
        const msg =
          `Recovered signer ${recoveredSigner} is not an owner of Safe ${safeAddress}. ` +
          `Current on-chain owners: ${onchainInfo.owners.join(", ")}.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

      // Step 7 — Handle correlation (optional). When a matching handle exists,
      // recompute payloadFingerprint from its tx fields and refuse on drift.
      // (T-37-14 mitigation.) When no match, surface handleNotFound: true and
      // proceed (Plan 37-02 CONTEXT lock).
      const matches = findHandlesBySafeTxHash(
        chainId,
        safeAddress,
        safeTxHash,
      );
      let matchedHandleId: string | null = null;
      let matchedTx: PreparedTxSafeTypedData | null = null;
      const target = matches[0];
      if (target !== undefined) {
        matchedHandleId = target.handle;
        // Narrow the discriminated union — findHandlesBySafeTxHash guarantees
        // safe-typed-data discriminator.
        matchedTx = target.record.tx as PreparedTxSafeTypedData;
        const recomputed = computeSafeTxPayloadFingerprint({
          chain: matchedTx.chain,
          safeAddress: matchedTx.safeAddress,
          safeVersion: matchedTx.safeVersion,
          safeTxHash: matchedTx.safeTxHash,
          nonce: matchedTx.safeNonce,
          operation: matchedTx.operation === "delegatecall" ? 1 : 0,
          to: matchedTx.safeTxTo,
          value: matchedTx.safeTxValue,
          data: matchedTx.safeTxData,
        });
        if (
          recomputed.toLowerCase() !==
          target.record.payloadFingerprint.toLowerCase()
        ) {
          const msg =
            `PAYLOAD_FINGERPRINT_DRIFT: handle ${target.handle} payloadFingerprint ` +
            `${target.record.payloadFingerprint} differs from recomputed ${recomputed}. ` +
            `Handle args drifted between prepare and submit — refuse and re-prepare.`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope(
              "PAYLOAD_FINGERPRINT_DRIFT",
              msg,
            ),
          };
        }
      }

      // Step 8 — POST to Tx Service. 6-arm DU dispatch.
      const postResult = await safeTxService.postSignature({
        chain: chainId,
        safeTxHash,
        signature,
      });

      if (postResult.kind === "not-found") {
        const msg =
          `SafeTx ${safeTxHash} not found in Tx Service. ` +
          `Run prepare_safe_tx_propose first to propose the SafeTx.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      if (postResult.kind === "unsupported-chain") {
        const msg = `Safe Tx Service has no endpoint for chain ${chainName}.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      if (postResult.kind === "rate-limited") {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${postResult.message}` }],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            postResult.message,
          ),
        };
      }
      if (postResult.kind === "error") {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${postResult.message}` }],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            postResult.message,
          ),
        };
      }

      // postResult.kind is "ok" or "duplicate" from here on.
      const txServiceArm: "ok" | "duplicate" = postResult.kind;

      // Step 9 — Handle transition. Bridge prepared → previewed → sent with
      // sentinel pinned values. Safe-typed-data handles don't route through
      // preview_send, so the submit tool owns the full transition for this
      // kind. transitionToSent stamps the SafeTx hash as record.txHash per
      // Plan 37-01 widening (txHash field is `string` — accommodates non-EVM
      // identifiers).
      let handleTransitionedToSent = false;
      if (matchedHandleId !== null) {
        const previewResult = transitionToPreviewed(matchedHandleId, {
          nonce: 0,
          gas: 0n,
          maxFeePerGas: 0n,
          maxPriorityFeePerGas: 0n,
          previewToken: "safe-typed-data-submit-bridge",
          presignHash: ("0x" + "00".repeat(32)) as Hex,
          selector: null,
        });
        if (previewResult.ok) {
          const sentResult = transitionToSent(matchedHandleId, safeTxHash);
          if (sentResult.ok) {
            handleTransitionedToSent = true;
          }
        }
      }

      // Step 10 — Compose response.
      const prepareReceipt = [
        "PREPARE RECEIPT",
        "  operation:        Safe multisig submit signature",
        `  chain:            ${chainName} (chainId ${chainId})`,
        `  safe:             ${rawSafeAddress}`,
        `  safeTxHash:       ${safeTxHash}`,
        `  signature:        ${signature.slice(0, 8)}...${signature.slice(-6)} (v=${vByte})`,
        `  userDecision:     send`,
      ].join("\n");

      const vMode =
        vByte === 27 || vByte === 28
          ? "ECDSA"
          : vByte === 31 || vByte === 32
            ? "Safe eth_sign"
            : `non-canonical v=${vByte}`;
      const checksPerformed = [
        "CHECKS PERFORMED",
        `  v-byte mode:      ${vMode} (v=${vByte})`,
        `  ECDSA recovered to: ${recoveredSigner}`,
        `  Recovered signer is a paired Ledger wallet (paired set length: ${status.accounts.length})`,
        `  Recovered signer is an on-chain Safe owner (current owners: ${onchainInfo.owners.length})`,
        `  Tx Service POST:  ${txServiceArm === "ok" ? "201 — first post" : "200 — idempotent re-post (duplicate)"}`,
        ...(matchedHandleId !== null
          ? [
              `  Handle correlation: ${matchedHandleId} payloadFingerprint matches re-derived value`,
              ...(handleTransitionedToSent
                ? [`  Handle transitioned to 'sent' with txHash=${safeTxHash}`]
                : ["  Handle transition skipped (handle already in terminal state)"]),
            ]
          : ["  Handle correlation: no matching handle in store (informational)"]),
      ].join("\n");

      const text = [prepareReceipt, checksPerformed].join("\n\n");

      return {
        content: [{ type: "text", text }],
        structuredContent: {
          chain: chainName,
          chainId,
          safeAddress: rawSafeAddress,
          safeTxHash,
          recoveredSigner,
          vByte,
          txServiceResult: txServiceArm,
          handleFound: matchedHandleId !== null,
          ...(matchedHandleId === null ? { handleNotFound: true } : {}),
          ...(txServiceArm === "duplicate" ? { duplicateRePost: true } : {}),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: submit_safe_tx_signature failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "submit_safe_tx_signature failed",
          message,
        ),
      };
    }
  },
);
