// MCP tool: set_active_account({ address }) — switch which approved
// account `prepare_*` uses as `from` for the current WC session.
//
// Handler invariants:
//   1. **Demo-mode check FIRST** — set_active_account is a real-mode tool.
//      The demo flow uses `set_demo_wallet` to pick a curated persona; in
//      demo mode there is no WC session to consult. Returns WRONG_MODE
//      (matches `set_demo_wallet`'s inverse refusal — WRONG_MODE is the
//      locked code for "called in the wrong mode").
//   2. **Schema-level address shape** — the inputSchema enforces a
//      0x-prefixed 20-byte hex shape (`^0x[0-9a-fA-F]{40}$`); malformed
//      input rejects at the protocol boundary. The in-handler defense-
//      in-depth check below is for direct invocation (test path).
//   3. **No state mutation on refusal** — every error path bails out
//      BEFORE `setActiveAccount` is called.
//
// The Ledger device still signs whichever address the user confirms on
// screen; this is a server-side convenience selector, not a security
// boundary. The success text re-states that explicitly.

import { chainIdFromName, type ChainName } from "../config/contracts.js";
import { isDemoMode } from "../config/env.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  AccountNotInSessionError,
  NotPairedError,
  getStatus,
  setActiveAccount,
} from "../wallet/session-manager.js";
import { registerTool } from "./index.js";

const CHAIN_ENUM = ["ethereum", "arbitrum", "polygon", "base", "optimism"] as const;

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}

const DESCRIPTION = [
  "Switch which approved Ledger account `prepare_*` / `preview_send` / `send_transaction` use as `from` for the current WalletConnect session.",
  "Use this when the user pairs a Ledger that approved multiple accounts (visible in `get_ledger_status.accounts`) and wants the next signing flow to use a non-default account.",
  "Do NOT use in demo mode — refuses with WRONG_MODE. Demo personas are switched via `set_demo_wallet`.",
  "Do NOT use for read-only flows (`get_portfolio_summary`, `get_token_balance`, etc.) — those take the address as a parameter directly; the active-account selection only affects signing.",
  "The address MUST be one of the accounts the WC session approved; an unknown address returns INVALID_ACCOUNT with the in-session list surfaced for self-correction.",
  "Optional `chain` arg (Plan 08-05): when provided, restrict the lookup to that chain's account set (`get_ledger_status.accountsByChain[chainId]`). When omitted, search across all chains (back-compat). Use the chain scope when Ledger Live derived different addresses per chain.",
  "The Ledger device still signs whichever account the user confirms on-screen — this is a server-side convenience selector, not a security boundary.",
  "Returns `{ address, accounts }` plus a confirmation text block.",
  "Failure modes: WRONG_MODE in demo mode, WALLET_NOT_PAIRED if no live session, INVALID_ACCOUNT if the address is not in the approved set (or not in the per-chain set when `chain` provided), INVALID_INPUT for malformed input.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    address: {
      type: "string",
      description:
        "Account address to make active — 0x-prefixed 20-byte hex. Must be one of the accounts listed in `get_ledger_status.accounts`.",
      pattern: "^0x[0-9a-fA-F]{40}$",
    },
    chain: {
      type: "string",
      enum: CHAIN_ENUM,
      description:
        "Optional per-chain scope (Plan 08-05). When provided, the address must be in `get_ledger_status.accountsByChain[<chainId>]`. When omitted, the lookup searches all chains in `accounts` (back-compat).",
    },
  },
  required: ["address"],
  additionalProperties: false,
};

registerTool("set_active_account", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // T-MODE-1 mitigation: demo-mode check FIRST, BEFORE touching the
    // session-manager. A future contributor that reorders this below the
    // setActiveAccount call would silently throw NotPairedError when
    // running in demo mode (no WC session exists) — the user would see
    // WALLET_NOT_PAIRED when the actual root cause is "wrong mode."
    if (isDemoMode()) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: set_active_account only works in real mode. In demo mode, switch personas via `set_demo_wallet({ persona })`.",
          },
        ],
        structuredContent: errEnvelope(
          "WRONG_MODE",
          "set_active_account requires real mode; demo mode active",
        ),
      };
    }

    // Defense-in-depth regex (the schema gate at src/server.ts rejects
    // malformed hex at the protocol boundary; this branch is reachable
    // only via direct handler invocation, e.g. test paths).
    const address = typeof args.address === "string" ? args.address : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'address': expected 0x-prefixed 20-byte hex, got "${address}"`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'address': ${address}`,
        ),
      };
    }

    // Plan 08-05 — per-chain scope (T-SET-ACTIVE-ACCOUNT-CHAIN-SCOPE-BYPASS-1
    // anchor). When `args.chain` is provided, the address MUST appear in
    // that chain's account set; cross-chain matches don't satisfy the
    // per-chain scope. When `args.chain` is OMITTED, the lookup falls
    // through to the existing `setActiveAccount` cross-chain search
    // (Phase 5 quick-task `wc-multi-account-session` back-compat preserved).
    const chainArg =
      typeof args.chain === "string" ? args.chain : undefined;
    if (chainArg !== undefined) {
      if (!(CHAIN_ENUM as readonly string[]).includes(chainArg)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'chain': expected one of ${CHAIN_ENUM.join(", ")}, got "${chainArg}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'chain': ${chainArg}`,
          ),
        };
      }
      const chainId = chainIdFromName(chainArg as ChainName);
      const preStatus = await getStatus();
      if (preStatus === null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: no live Ledger session. Call `pair_ledger_live` to pair via WalletConnect, then retry.",
            },
          ],
          structuredContent: errEnvelope(
            "WALLET_NOT_PAIRED",
            "no live Ledger session",
          ),
        };
      }
      const chainAccounts = preStatus.accountsByChain[chainId] ?? [];
      const lowered = address.toLowerCase();
      const match = chainAccounts.find(
        (a) => a.toLowerCase() === lowered,
      );
      if (!match) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: address ${address} is not in the current Ledger session for chain "${chainArg}" (chainId ${chainId}). ` +
                `Approved accounts on this chain: ${chainAccounts.length > 0 ? chainAccounts.join(", ") : "(none — chain not covered by current session)"}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_ACCOUNT",
            `address not in session for chain ${chainArg} (chainId ${chainId}); chain accounts: ${chainAccounts.join(",")}`,
          ),
        };
      }
      // Per-chain check passed — fall through to setActiveAccount, which
      // will checksum-normalize and persist the selection. The
      // cross-chain check inside setActiveAccount is a superset of ours,
      // so it will not re-refuse.
    }

    let status;
    try {
      status = await setActiveAccount(address);
    } catch (err) {
      if (err instanceof NotPairedError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: no live Ledger session. Call `pair_ledger_live` to pair via WalletConnect, then retry.",
            },
          ],
          structuredContent: errEnvelope(
            "WALLET_NOT_PAIRED",
            "no live Ledger session",
          ),
        };
      }
      if (err instanceof AccountNotInSessionError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: address ${err.requested} is not in the current Ledger session. Approved accounts: ${err.accounts.join(", ")}.`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_ACCOUNT",
            `address not in session; approved: ${err.accounts.join(", ")}`,
          ),
        };
      }
      throw err;
    }

    return {
      content: [
        {
          type: "text",
          text: [
            `active account set to: ${status.activeAccount}`,
            "Note: the Ledger screen remains the source of truth at signing time — verify the address on-device before approving.",
          ].join("\n"),
        },
      ],
      structuredContent: {
        address: status.activeAccount,
        accounts: status.accounts,
      },
    };
  } catch (err) {
    // Defensive catch-all (matches set_demo_wallet precedent).
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: set_active_account failed: ${message}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "set_active_account failed",
        message,
      ),
    };
  }
});
