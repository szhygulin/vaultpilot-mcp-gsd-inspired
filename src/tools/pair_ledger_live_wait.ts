// MCP tool: pair_ledger_live_wait({ pairingHandle })
//
// Phase-2 of the two-phase pairing flow. Takes the `pairingHandle` returned
// by `pair_ledger_live_start`, retrieves the parked WC `approval` promise,
// races it against a 60s timeout, and returns the full session envelope
// (VERIFY-ON-DEVICE block + structuredContent) once the user approves in
// Ledger Live.
//
// Non-negotiables:
//
//   1. The VERIFY-ON-DEVICE block is the output of this tool, NOT of
//      `pair_ledger_live_start`. The VERIFY_ON_DEVICE_TEMPLATE const is
//      imported from `pair_ledger_live.ts` (single source of truth — format-
//      fanout-regex-sync rule). Tests that assert the block appear in the
//      wait response import the same const.
//
//   2. `isDemoMode()` is checked FIRST (T-DEMO-1 extension — both tools in
//      the two-phase flow refuse demo mode unconditionally).
//
//   3. The locked wait-side errorCode set:
//        DEMO_MODE_REFUSED   — demo mode active
//        INVALID_HANDLE      — stale/unknown pairingHandle
//        APPROVAL_TIMEOUT    — 60s budget elapsed without approval
//        USER_REJECTED       — user declined in Ledger Live
//        INTERNAL_ERROR      — defensive catch-all (not in locked set)
//
//   4. `pairingHandle` is required (non-optional in the input schema).

import { isDemoMode } from "../config/env.js";
import {
  ApprovalTimeoutError,
  InvalidPairingHandleError,
  UserRejectedPairingError,
  pairWait,
} from "../wallet/session-manager.js";
import { registerTool } from "./index.js";
import { VERIFY_ON_DEVICE_TEMPLATE } from "./pair_ledger_live.js";

const DESCRIPTION = [
  "Phase-2 of the two-phase Ledger pairing flow. Call this AFTER `pair_ledger_live_start` once the user has pasted the URI into Ledger Live and approved on-device.",
  "Blocks up to 60s waiting for WalletConnect session approval. Returns `{ wcUri, address, chainId, sessionTopicLast8 }` plus a VERIFY-ON-DEVICE block when approved.",
  "The VERIFY-ON-DEVICE block instructs the user to confirm the surfaced address matches Ledger Live → Settings → Connected Apps — if it does not match, a MITM may be active.",
  "Pass the `pairingHandle` exactly as returned by `pair_ledger_live_start`. A stale or unknown handle returns `errorCode: INVALID_HANDLE`.",
  "DO NOT use for read-only flows (get_portfolio_summary, get_token_balance, etc.) — those work without pairing.",
  "Not available in demo mode; use `set_demo_wallet` instead.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    pairingHandle: {
      type: "string",
      description:
        "Opaque handle returned by `pair_ledger_live_start`. Pass it verbatim.",
    },
  },
  required: ["pairingHandle"],
  additionalProperties: false,
};

registerTool("pair_ledger_live_wait", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // T-DEMO-1 extension: demo-mode check FIRST.
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

  const handle = typeof args.pairingHandle === "string" ? args.pairingHandle : "";
  if (!handle) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: pairingHandle is required; call pair_ledger_live_start first to obtain one",
        },
      ],
      structuredContent: { errorCode: "INVALID_HANDLE" },
    };
  }

  try {
    const status = await pairWait(handle);
    const { address, chainId, sessionTopicLast8 } = status;
    const verifyBlock = VERIFY_ON_DEVICE_TEMPLATE
      .replace("{ADDRESS}", address)
      .replace("{SESSION_TOPIC_LAST8}", sessionTopicLast8);
    return {
      content: [{ type: "text", text: verifyBlock }],
      structuredContent: { address, chainId, sessionTopicLast8 },
    };
  } catch (err) {
    if (err instanceof InvalidPairingHandleError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: pairing handle is no longer active; call pair_ledger_live_start to obtain a fresh handle",
          },
        ],
        structuredContent: { errorCode: "INVALID_HANDLE" },
      };
    }

    if (err instanceof ApprovalTimeoutError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: Ledger Live did not approve the pairing within 60 seconds; re-call pair_ledger_live_start to retry",
          },
        ],
        structuredContent: { errorCode: "APPROVAL_TIMEOUT" },
      };
    }

    if (err instanceof UserRejectedPairingError) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: user rejected the pairing in Ledger Live; re-call pair_ledger_live_start when ready to approve on the device",
          },
        ],
        structuredContent: { errorCode: "USER_REJECTED" },
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: pair_ledger_live_wait failed: ${message}` }],
      structuredContent: { errorCode: "INTERNAL_ERROR" },
    };
  }
});
