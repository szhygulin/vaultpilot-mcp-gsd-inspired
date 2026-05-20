// MCP tool: prepare_tron_revoke_approval({ tokenAddress, spender, from? })
//
// Phase 19 — Plan 19-01 (TRON-W-03). Produces an unsigned TRC-20
// TriggerSmartContract transaction with `approve(spender, 0)` calldata —
// identical bytes to `prepare_tron_token_approve({ tokenAddress, spender, amount: "0" })`.
//
// D-01 byte-identity invariant: this tool imports and calls
// `prepareTronApproveInternal` with `rawAmount: "0"`, `amountWei: 0n`,
// `amountIsMax: false`. The calldata bytes are IDENTICAL to
// `prepare_tron_token_approve({ tokenAddress, spender, amount: "0" })` by
// construction — no separate encode path. T-TRON-REVOKE-DRIFT-1 asserts this.
//
// D-01c: DISTINCT named MCP tool registration (`prepare_tron_revoke_approval`)
// so the agent can route by user intent without amount reasoning.
//
// Input schema: NO `amount` field — the amount is always 0 by definition.
//   { tokenAddress: string, spender: string, from?: string }
//
// The `instructionSummary` kind is `"trc20-revoke"` (not `"trc20-approve"`)
// because `prepareTronApproveInternal` checks `rawAmount === "0"`.
//
// Sibling of `src/tools/prepare_revoke_approval.ts` (Phase 6 EVM analog).

import { utils as tronUtils } from "tronweb";

import { isDemoMode } from "../config/env.js";
import { getActiveTronPersona } from "../demo/state.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { findByAddress } from "../tokens/tron-top-25.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { prepareTronApproveInternal } from "./prepare_tron_token_approve.js";
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

// ============================================================================
// Description + Input Schema
// ============================================================================

const DESCRIPTION = [
  "Prepare an unsigned TRC-20 allowance revoke (approve with amount=0) from the paired TRON Ledger account.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to revoke a previously granted TRC-20 allowance.",
  "Do NOT use to set a non-zero allowance — call prepare_tron_token_approve instead.",
  "Do NOT use for TRC-20 transfers — that is prepare_tron_trc20_send.",
  "`tokenAddress` and `spender` MUST be valid TRON base58check addresses (T-prefixed, 34 chars).",
  "The resulting rawDataHex + payloadFingerprint are byte-identical to prepare_tron_token_approve({ tokenAddress, spender, amount: \"0\" }) by construction (D-01 byte-identity invariant).",
  "In demo mode, succeeds against the active TRON persona address.",
  "Returns { handle, chain: \"tron\", tokenAddress, spender, spenderLabel, amount: \"0\", amountResolved: \"0\", amountIsMax: false, payloadFingerprint, prepareReceipt, instructionSummary: [{ kind: \"trc20-revoke\", ... }] }.",
  "Failure modes: WALLET_NOT_PAIRED / WRONG_MODE / INVALID_INPUT (addresses malformed or token not in tron-top-25 registry) / INTERNAL_ERROR (RPC or encode failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    tokenAddress: {
      type: "string",
      description:
        "TRC-20 token contract address (TRON base58check T-prefixed, 34 chars). Example: \"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t\" (USDT-TRC20).",
    },
    spender: {
      type: "string",
      description:
        "Contract address whose allowance is being revoked (TRON base58check T-prefixed, 34 chars). Example: \"TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax\" (SunSwap V2 Router).",
    },
    from: {
      type: "string",
      description:
        "Override sender address (TRON base58check). Optional — omit to use the active TRON account or demo persona.",
    },
  },
  required: ["tokenAddress", "spender"],
  additionalProperties: false,
};

// ============================================================================
// Tool registration
// ============================================================================

registerTool(
  "prepare_tron_revoke_approval",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawTokenAddress =
        typeof args.tokenAddress === "string" ? args.tokenAddress : "";
      const rawSpender =
        typeof args.spender === "string" ? args.spender : "";

      // -----------------------------------------------------------------------
      // Step 1: Input validation — FIRES FIRST (before any state read).
      // -----------------------------------------------------------------------

      if (!tronUtils.address.isAddress(rawTokenAddress)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'tokenAddress': expected a valid TRON base58check address (T-prefixed, 34 chars), got "${rawTokenAddress}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'tokenAddress': "${rawTokenAddress}" is not a valid TRON base58check address`,
            "tokenAddress",
          ),
        };
      }

      if (!tronUtils.address.isAddress(rawSpender)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'spender': expected a valid TRON base58check address (T-prefixed, 34 chars), got "${rawSpender}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'spender': "${rawSpender}" is not a valid TRON base58check address`,
            "spender",
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 2: Token metadata lookup — still required for the encoder even
      // though we hard-code amountWei = 0n (tronweb ABI encoder needs the
      // uint256 param; the registry gives us decimals for the token metadata).
      // -----------------------------------------------------------------------
      const metadata = findByAddress(rawTokenAddress);
      if (!metadata) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: token not found in tron-top-25 registry for address "${rawTokenAddress}". ` +
                "Phase 19 revoke supports tokens in the tron-top-25 registry: USDT-TRC20, USDC-TRC20, USDD, TUSD, and others.",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `token not found in tron-top-25 registry: "${rawTokenAddress}"`,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 3: Demo/real-mode resolution — mirrors prepare_tron_trc20_send.ts.
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
                  "Call set_demo_wallet with a TRON persona slug (e.g. \"tron-whale\") before preparing demo-mode TRON revokes.",
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
            content: [
              {
                type: "text",
                text:
                  "error: no paired TRON account. Pair your Ledger TRON app via `pair_tron_ledger` before preparing TRC-20 revokes.",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired TRON account; call pair_tron_ledger first",
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
                text: "error: no paired TRON account (unreachable narrowing).",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired TRON account (unreachable narrowing)",
            ),
          };
        }
        fromAddress = account.address;
      }

      // Handle optional `from` override.
      const rawFrom = typeof args.from === "string" ? args.from : undefined;
      if (rawFrom !== undefined) {
        if (!tronUtils.address.isAddress(rawFrom)) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: invalid 'from': expected a valid TRON base58check address (T-prefixed, 34 chars), got "${rawFrom}"`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid 'from': "${rawFrom}" is not a valid TRON base58check address`,
              "from",
            ),
          };
        }
        fromAddress = rawFrom;
      }

      // -----------------------------------------------------------------------
      // Steps 4+: Delegate to shared byte-identity helper with amountWei=0n.
      // D-01: rawAmount: "0" causes prepareTronApproveInternal to use
      //   instructionSummary: [{ kind: "trc20-revoke", ... }].
      // -----------------------------------------------------------------------
      return await prepareTronApproveInternal({
        rawTokenAddress,
        rawSpender,
        rawAmount: "0",   // D-01: hard-coded "0" triggers trc20-revoke summary kind
        amountWei: 0n,    // D-01: zero amount in calldata = revoke
        amountIsMax: false,
        fromAddress,
        tokenDecimals: metadata.decimals,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_tron_revoke_approval failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_tron_revoke_approval failed",
          message,
        ),
      };
    }
  },
);
