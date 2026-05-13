// MCP tool: prepare_revoke_approval({ tokenAddress, spender })
//
// Phase 6 — Plan 06-03 (PREP-27). Distinct tool name producing
// `approve(spender, 0)` calldata; the agent routes by user intent
// (research § Topic 8 — "revoke that approval" reads more cleanly than
// `prepare_token_approve({ amount: "0" })`).
//
// Internally delegates to `prepareApproveInternal` from prepare_token_approve.ts.
// The cross-tool import is the byte-identity guarantor:
// prepare_revoke_approval({T, S}) produces byte-identical tx.data AND
// payloadFingerprint to prepare_token_approve({T, S, amount: "0"}). Drift
// in either tool breaks the byte-identity assertion in
// test/prepare-revoke-approval.test.ts at PR review.

import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { registerTool } from "./index.js";
import { prepareApproveInternal } from "./prepare_token_approve.js";

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> &
    StructuredError;
}

const DESCRIPTION = [
  "Revoke an existing ERC-20 approval by setting the allowance to 0 for a specific spender on Ethereum mainnet. Returns a handle the agent passes to preview_send before send_transaction.",
  "Produces an `approve(spender, 0)` call against the token contract — byte-identical calldata to prepare_token_approve({ ..., amount: \"0\" }); the distinct tool name routes by user intent.",
  "Use when the user wants to revoke a prior approval (defensive hygiene — e.g. after a deprecated dApp interaction; after seeing a `⚠ UNLIMITED APPROVAL` line in preview_send's DECODED ARGS block).",
  "Do NOT use to set a NEW non-zero approval — that's prepare_token_approve.",
  "Do NOT use for ERC-20 transfers / native ETH / WETH unwrap / other contract calls — each has a dedicated prepare_* tool.",
  "`tokenAddress` is the ERC-20 contract address (0x-prefixed 20-byte hex). `spender` is the contract whose allowance should be revoked.",
  "Requires a paired Ledger (call pair_ledger_live first if get_ledger_status shows paired: false). In demo mode, succeeds against the active persona's address as `from`; send_transaction returns a simulation envelope instead of broadcasting.",
  "Returns the same shape as prepare_token_approve (`{ handle, chainId: 1, from, spender, tokenAddress, amount: \"0\", amountWei: \"0\", payloadFingerprint }`) plus the PREPARE RECEIPT and DECODED ARGS surface in preview_send.",
  "Failure modes: WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode is on but no persona set, INVALID_INPUT if tokenAddress/spender malformed.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    tokenAddress: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "ERC-20 contract address (0x-prefixed 20-byte hex). NOT a wallet address.",
    },
    spender: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Contract address whose allowance is being revoked (0x-prefixed 20-byte hex). NOT a wallet address.",
    },
  },
  required: ["tokenAddress", "spender"],
  additionalProperties: false,
};

registerTool("prepare_revoke_approval", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // Validate tokenAddress shape — defense BEFORE any state read.
    const rawTokenAddress = typeof args.tokenAddress === "string" ? args.tokenAddress : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawTokenAddress)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'tokenAddress': expected 0x-prefixed 20-byte hex, got "${rawTokenAddress}"`,
          },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'tokenAddress': ${rawTokenAddress}`),
      };
    }

    // Validate spender shape.
    const rawSpender = typeof args.spender === "string" ? args.spender : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawSpender)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'spender': expected 0x-prefixed 20-byte hex, got "${rawSpender}"`,
          },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'spender': ${rawSpender}`),
      };
    }

    // Revoke is approve(spender, 0n). Delegate to the shared helper for
    // byte-identity with prepare_token_approve({ ..., amount: "0" }).
    return await prepareApproveInternal({
      rawTokenAddress,
      rawSpender,
      rawAmount: "0",
      amountWei: 0n,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_revoke_approval failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_revoke_approval failed", message),
    };
  }
});
