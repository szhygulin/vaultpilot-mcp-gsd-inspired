// MCP tool: pair_ledger_live({ force? })
//
// Wires the WC pairing flow (Plan 03-01's session-manager) to the MCP
// surface. The handler is registered at module top level via the
// side-effect-import pattern that Phase 2 establishes.
//
// Two non-negotiables, both asserted by `test/pair-ledger-live.test.ts`:
//
//   1. The exported `VERIFY_ON_DEVICE_TEMPLATE` const is the SINGLE SOURCE
//      OF TRUTH for the on-device cross-check block (PAIR-03). Tests import
//      the const + substitute placeholders the same way the handler does,
//      so the block can't drift between prod and test (format-fanout-regex-
//      sync rule). Plain `string` — NOT a tagged template / function — so
//      the test's `.includes(expectedSubstituted)` check works against a
//      raw runtime substitution.
//
//      This const is also imported by `pair_ledger_live_wait.ts` — keeping
//      it here as the single source of truth means neither the wait tool
//      nor its tests can drift from the production block.
//
//   2. `isDemoMode()` is checked FIRST in the handler, BEFORE any call to
//      session-manager.pair(). Demo mode is the only state under which
//      pairing is unconditionally refused; the session manager must remain
//      untouched (T-DEMO-1 mitigation — asserted by `toHaveBeenCalledTimes(0)`
//      on the mocked `pair` spy in the demo-mode test).
//
// The five locked `errorCode` envelopes — MISSING_PROJECT_ID,
// APPROVAL_TIMEOUT, USER_REJECTED, PAIRING_IN_PROGRESS, DEMO_MODE_REFUSED —
// are the agent's only routable signal. `INTERNAL_ERROR` is the defensive
// catch-all for an unexpected `Error` from session-manager (e.g. relay
// unreachable mid-handshake); it is NOT in the locked-five set and is
// documented as the unstructured fallback.
//
// ROUTING NOTE: for interactive use where the user must paste the WC URI
// into Ledger Live, use the two-phase flow instead:
//   1. `pair_ledger_live_start` — returns wcUri immediately.
//   2. `pair_ledger_live_wait`  — blocks for approval, returns VERIFY-ON-DEVICE.
// `pair_ledger_live` is kept as a single-shot wrapper (useful when the URI
// does not need surfacing, e.g. automated tests, CI, or cached-session checks).

import { isDemoMode } from "../config/env.js";
import {
  ApprovalTimeoutError,
  PendingPairingError,
  UserRejectedPairingError,
  pair,
} from "../wallet/session-manager.js";
import { MissingProjectIdError } from "../wallet/walletconnect-client.js";
import { registerTool } from "./index.js";

/**
 * Verbatim VERIFY-ON-DEVICE block (PAIR-03). Source-of-truth for the
 * on-device cross-check the user reads against Ledger Live → Settings →
 * Connected Apps. Placeholders `{ADDRESS}` and `{SESSION_TOPIC_LAST8}` are
 * substituted at runtime via plain `String.prototype.replace`.
 *
 * Format-fanout-regex-sync rule (global CLAUDE.md): the test file imports
 * THIS const, substitutes placeholders the same way the handler does, and
 * asserts the substituted block appears in `result.content[0].text`. Do
 * NOT duplicate the string into the test file.
 *
 * `pair_ledger_live_wait.ts` imports this const so the wait tool's
 * VERIFY-ON-DEVICE output stays in sync without a second copy.
 */
export const VERIFY_ON_DEVICE_TEMPLATE: string = [
  "VERIFY-ON-DEVICE",
  "  Address: {ADDRESS}",
  "  Session topic (last 8): {SESSION_TOPIC_LAST8}",
  "",
  "In Ledger Live → Settings → Connected Apps:",
  "  - Confirm the address shown for this app matches the address above.",
  "  - Confirm the session topic (last 8 hex chars) matches.",
  "  - If either doesn't match, DO NOT proceed with any signing flow.",
  "    Treat it as a tamper signal and re-pair with force: true.",
].join("\n");

const DESCRIPTION = [
  "Single-shot Ledger pairing via WalletConnect — blocks up to 60s for approval before returning.",
  "PREFER the two-phase flow for interactive use where the user must paste the URI into Ledger Live: call `pair_ledger_live_start` to get the URI immediately, then `pair_ledger_live_wait` to collect the session.",
  "Use `pair_ledger_live` only when the URI does not need surfacing (e.g. re-using a cached session, automated tests, or CI).",
  "DO NOT use this for read-only flows (get_portfolio_summary, get_token_balance, get_transaction_status, resolve_ens_name) — those work without pairing.",
  "Returns `{ wcUri, address, chainId, sessionTopicLast8 }` plus a VERIFY-ON-DEVICE block.",
  "Pass `force: true` to disconnect any existing session and pair from scratch (e.g. after switching accounts in Ledger Live).",
  "The VERIFY-ON-DEVICE block instructs the user to confirm the surfaced address matches Ledger Live → Settings → Connected Apps; mismatch is a tamper signal.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    force: {
      type: "boolean",
      description:
        "Disconnect any existing session and re-pair from scratch. Default false (return cached session).",
    },
  },
  additionalProperties: false,
};

registerTool("pair_ledger_live", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // T-DEMO-1 mitigation: demo-mode check FIRST, BEFORE session-manager.
  // The mocked `pair` spy must observe zero invocations in this branch.
  if (isDemoMode()) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: demo mode is active; use `set_demo_wallet` to select a curated persona instead of pairing a real Ledger",
        },
      ],
      structuredContent: { errorCode: "DEMO_MODE_REFUSED" },
    };
  }

  // JSON-schema gates the type to boolean; the literal `=== true` guard is
  // defense-in-depth against future schema relaxations.
  const force = args.force === true;

  try {
    const result = await pair({ force });
    const { wcUri } = result;
    const { address, chainId, sessionTopicLast8 } = result.status;
    const verifyBlock = VERIFY_ON_DEVICE_TEMPLATE
      .replace("{ADDRESS}", address)
      .replace("{SESSION_TOPIC_LAST8}", sessionTopicLast8);
    return {
      content: [{ type: "text", text: verifyBlock }],
      structuredContent: { wcUri, address, chainId, sessionTopicLast8 },
    };
  } catch (err) {
    // Catch ladder ordered most-specific-first. Each branch hard-codes its
    // user-facing text so a future tweak to the underlying error class's
    // `.message` can't reshape the wire response — the wire contract lives
    // here.

    // T-WC-INIT-1: env var unset. Text MUST name the env var AND the WC
    // dashboard URL (asserted by Test 2).
    if (err instanceof MissingProjectIdError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: WALLETCONNECT_PROJECT_ID env var is not set. Register a project at https://cloud.walletconnect.com to obtain one, then re-run with the env var set.",
          },
        ],
        structuredContent: { errorCode: "MISSING_PROJECT_ID" },
      };
    }

    // T-TIMEOUT-1: 60s budget elapsed in the upstream session-manager.
    if (err instanceof ApprovalTimeoutError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: Ledger Live did not approve the pairing within 60 seconds; re-call pair_ledger_live to retry",
          },
        ],
        structuredContent: { errorCode: "APPROVAL_TIMEOUT" },
      };
    }

    // T-USER-REJECT-1: user said no on Ledger Live. We never leak `.cause`
    // (could contain WC-internal codes).
    if (err instanceof UserRejectedPairingError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: user rejected the pairing in Ledger Live; re-call pair_ledger_live when ready to approve on the device",
          },
        ],
        structuredContent: { errorCode: "USER_REJECTED" },
      };
    }

    // T-PEND-1: concurrent pair() in flight. Surface `force: true` as the
    // escape hatch (asserted by Test 5's regex on `/force:\s+true/`).
    if (err instanceof PendingPairingError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: a pairing is already in progress; wait for the current Ledger Live prompt or re-call with force: true to cancel and retry",
          },
        ],
        structuredContent: { errorCode: "PAIRING_IN_PROGRESS" },
      };
    }

    // Defensive catch-all. NOT in the locked-five errorCode set — this is
    // the unstructured fallback for unexpected Errors (e.g. relay
    // unreachable, malformed session response, future SDK additions).
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: pair_ledger_live failed: ${message}` }],
      structuredContent: { errorCode: "INTERNAL_ERROR" },
    };
  }
});
