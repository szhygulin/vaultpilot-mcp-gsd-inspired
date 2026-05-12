// MCP tool: pair_ledger_live_start({ force? })
//
// Phase-1 of the two-phase pairing flow introduced to fix the WC URI
// deadlock: `pair_ledger_live` (single-shot) blocks for up to 60s awaiting
// approval before returning anything, meaning the WC URI that the user must
// paste into Ledger Live is never surfaced to the agent.
//
// This tool calls `pairStart()` which issues `client.connect()`, captures
// the URI and parks the `approval` promise, then returns immediately with
// `{ wcUri, pairingHandle }`. The agent surfaces `wcUri` to the user, who
// pastes it into Ledger Live → Settings → WalletConnect → Connect. The
// agent then calls `pair_ledger_live_wait({ pairingHandle })` to collect
// the session once the user approves on-device.
//
// Two non-negotiables inherited from `pair_ledger_live`:
//
//   1. `isDemoMode()` is checked FIRST, BEFORE any session-manager call
//      (T-DEMO-1 mitigation — asserted by `toHaveBeenCalledTimes(0)` on
//      the mocked `pairStart` spy in the demo-mode test).
//
//   2. The `PAIRING_IN_PROGRESS` errorCode is surfaced when
//      `PendingPairingError` is thrown (a concurrent start is already in
//      flight). The `force: true` escape hatch text must appear in the
//      error message (asserted by Test 4).
//
// The `wcUri` is empty when a cached live session already exists (returned
// with `pairingHandle: "cached"`). The tool description instructs the agent
// to call `get_ledger_status` instead when `wcUri` is empty — no need to
// proceed to `pair_ledger_live_wait`.

import { isDemoMode } from "../config/env.js";
import {
  PendingPairingError,
  pairStart,
} from "../wallet/session-manager.js";
import { MissingProjectIdError } from "../wallet/walletconnect-client.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Phase-1 of the two-phase Ledger pairing flow. Call this FIRST to obtain the WalletConnect URI that the user pastes into Ledger Live → Settings → WalletConnect → Connect.",
  "Returns `{ wcUri, pairingHandle }` immediately — does NOT block waiting for approval.",
  "If `wcUri` is empty, a live session is already cached; call `get_ledger_status` instead of proceeding to `pair_ledger_live_wait`.",
  "After surfacing `wcUri` to the user, call `pair_ledger_live_wait({ pairingHandle })` to block until the user approves on-device and receive the VERIFY-ON-DEVICE block.",
  "Pass `force: true` to disconnect any existing session and pair from scratch (e.g. after switching accounts in Ledger Live).",
  "DO NOT use for read-only flows (get_portfolio_summary, get_token_balance, etc.) — those work without pairing.",
  "Not available in demo mode; use `set_demo_wallet` instead.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    force: {
      type: "boolean",
      description:
        "Disconnect any existing session and re-pair from scratch. Default false.",
    },
  },
  additionalProperties: false,
};

registerTool("pair_ledger_live_start", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // T-DEMO-1 mitigation: demo-mode check FIRST, BEFORE session-manager.
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

  const force = args.force === true;

  try {
    const result = await pairStart({ force });
    return {
      content: [
        {
          type: "text",
          text:
            result.wcUri === ""
              ? "A live Ledger session is already cached. Call `get_ledger_status` to verify it, or call `pair_ledger_live_start` with `force: true` to re-pair."
              : `Paste this URI into Ledger Live → Settings → WalletConnect → Connect, then call pair_ledger_live_wait with the pairingHandle.\n\nURI: ${result.wcUri}`,
        },
      ],
      structuredContent: { wcUri: result.wcUri, pairingHandle: result.pairingHandle },
    };
  } catch (err) {
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

    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: pair_ledger_live_start failed: ${message}` }],
      structuredContent: { errorCode: "INTERNAL_ERROR" },
    };
  }
});
