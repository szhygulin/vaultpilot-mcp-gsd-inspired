// MCP tool: get_ledger_status({})
//
// Read-only counterpart to pair_ledger_live. Surfaces the
// `LedgerStatus | null` from the session-manager as a structured
// `{ paired: false }` or `{ paired: true, address, chainId,
// sessionTopicLast8 }` envelope.
//
// No error path: a missing project ID / unreachable relay / un-init'd
// SignClient all surface as `paired: false` (the session-manager's
// `getStatus()` short-circuits to `null` BEFORE triggering relay traffic
// when the client is uninitialized — see 03-01). This keeps the agent's
// routing-prompt contract simple: "call get_ledger_status to check; never
// pattern-match on errors here."

import { getStatus } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Check whether a Ledger hardware wallet is currently paired via WalletConnect, returning the paired address + chain + session-topic-last-8 (or `paired: false` if no session).",
  "Use this BEFORE calling pair_ledger_live to avoid a redundant re-pair if a session already exists. Also use after a prepare_* failure to confirm the session is still live (the user may have disconnected from Ledger Live).",
  "Returns `{ paired: false }` when no session, or `{ paired: true, address, chainId, sessionTopicLast8 }` when paired. Never errors — a missing project ID / unreachable relay simply means no session exists, so `paired: false`.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_ledger_status", DESCRIPTION, INPUT_SCHEMA, async () => {
  const status = await getStatus();
  if (status === null) {
    return {
      content: [
        {
          type: "text",
          text: "paired: false (no Ledger session active; call pair_ledger_live to pair)",
        },
      ],
      structuredContent: { paired: false },
    };
  }
  const { address, chainId, sessionTopicLast8 } = status;
  return {
    content: [
      {
        type: "text",
        text: `paired: true, address: ${address}, chainId: ${chainId}, sessionTopicLast8: ${sessionTopicLast8}`,
      },
    ],
    structuredContent: { paired: true, address, chainId, sessionTopicLast8 },
  };
});
