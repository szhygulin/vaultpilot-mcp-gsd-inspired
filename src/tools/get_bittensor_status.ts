// MCP tool: get_bittensor_status({}) — Phase 46 Plan 46-02 (TAO-PAIR-02).
//
// Read-only counterpart to `pair_bittensor_ledger`. Surfaces the persistent
// non-EVM store's Bittensor record as a structured `{ paired: false }` or
// `{ paired: true, address, derivationPath, rpcEndpoint, pairedAt,
//    staleAccountWarning? }` envelope. Verbatim mirror of get_solana_status.
//
// KEY DIVERGENCE from get_solana_status (Pitfall 5): `ApiPromise.create`
// opens a live WS socket on construction (unlike Solana's lazy
// `new Connection`). So `rpcEndpoint` is resolved from
// `_bittensorRegistry.getResolvedRpcUrl()`, which returns the
// env-or-fallback URL STRING WITHOUT calling `getApi()` — a status check on
// an unreachable RPC returns `{ paired: true, ... }` instead of hanging.
//
// `derivationPath` IS surfaced here (the caller explicitly asked for their
// own pairing status — they can see their own slot index). The
// shoulder-surfing defense (T-46-LEAK) applies to
// `list_paired_non_evm_accounts`, which iterates and would otherwise leak
// the per-chain BIP44 account index across the whole non-EVM surface.
//
// `staleAccountWarning: true` surfaces when `pairedAt` is more than 30 days
// old (the threshold lives in `non-evm-account-store.ts`); the agent
// prompts the user to re-pair so the cache `pairedAt` is fresh. The pairing
// itself is cryptographically still valid — operational hygiene, not a
// correctness signal.
//
// No error path: a missing record / disk-unavailable store both surface as
// `{ paired: false }`. The store's `listAccounts()` swallows IO errors with
// a stderr `warn` and returns `[]`, so the routing prompt stays simple:
// "call get_bittensor_status to check; never pattern-match on errors here."

import { _bittensorRegistry } from "../chains/bittensor/registry.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns the Bittensor Ledger pairing status: { paired: false } if no Bittensor account is in the persistent cache; { paired: true, address, derivationPath, rpcEndpoint, pairedAt, staleAccountWarning? } otherwise.",
  "Use this BEFORE any Bittensor read tool to confirm pairing.",
  "staleAccountWarning surfaces when pairedAt is older than 30 days — user should re-pair via pair_bittensor_ledger to refresh the cache.",
  "rpcEndpoint reflects the subtensor RPC URL the client resolves to (BITTENSOR_RPC_URL override or the public Finney fallback); it is resolved from the URL string WITHOUT opening a WS connection, so status never hangs on an unreachable RPC.",
  "Never errors — a missing record / disk-unavailable store both surface as paired:false.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_bittensor_status", DESCRIPTION, INPUT_SCHEMA, async () => {
  const records = listAccounts({ chainFilter: "bittensor" });

  if (records.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            "paired: false (no Bittensor Ledger pairing in the persistent cache; call pair_bittensor_ledger to pair)",
        },
      ],
      structuredContent: { paired: false },
    };
  }

  // Phase-scope: single Bittensor record per pair (saveAccount upserts on
  // the `(chain, address)` tuple). Multi-record handling deferred. Pick the
  // first record.
  const record = records[0]!;
  // Pitfall 5: resolve the URL STRING without forcing a live WS connection.
  const rpcEndpoint = _bittensorRegistry.getResolvedRpcUrl();

  const structuredContent: Record<string, unknown> = {
    paired: true,
    address: record.address,
    derivationPath: record.derivationPath,
    rpcEndpoint,
    pairedAt: record.pairedAt,
  };
  if (record.staleAccountWarning) {
    structuredContent.staleAccountWarning = true;
  }
  if (record.displayName) {
    structuredContent.displayName = record.displayName;
  }

  const lines = [
    `paired: true, address: ${record.address}`,
    `derivationPath: ${record.derivationPath}`,
    `rpcEndpoint: ${rpcEndpoint}`,
    `pairedAt: ${record.pairedAt}`,
  ];
  if (record.staleAccountWarning) {
    lines.push(
      "staleAccountWarning: true (pairedAt is older than 30 days; re-pair via pair_bittensor_ledger to refresh)",
    );
  }
  if (record.displayName) {
    lines.push(`displayName: ${record.displayName}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent,
  };
});
