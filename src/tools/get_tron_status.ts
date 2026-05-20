// MCP tool: get_tron_status({}) — Phase 17 Plan 17-03 (TRON-PAIR-02).
//
// Read-only counterpart to `pair_tron_ledger`. Surfaces the persistent
// non-EVM store's TRON record as a structured `{ paired: false }` or
// `{ paired: true, address, derivationPath, rpcEndpoint, pairedAt,
//    staleAccountWarning? }` envelope.
//
// `derivationPath` IS surfaced here (the caller explicitly asked for their
// own pairing status — they can see their own slot index). The shoulder-
// surfing defense applies to `list_paired_non_evm_accounts`, which iterates
// and would otherwise leak the per-chain BIP44 account index across the
// whole non-EVM surface.
//
// `staleAccountWarning: true` surfaces when `pairedAt` is more than 30 days
// old (the threshold lives in `non-evm-account-store.ts`); the agent prompts
// the user to re-pair so the cache `pairedAt` is fresh. The pairing itself
// is cryptographically still valid — the warning is operational hygiene,
// not a correctness signal.
//
// No error path: a missing record / disk-unavailable store both surface as
// `{ paired: false }`. The store's `listAccounts()` swallows IO errors with
// stderr `warn` and returns `[]`, so the routing prompt stays simple: "call
// get_tron_status to check; never pattern-match on errors here."

import { _tronRegistry } from "../chains/tron/registry.js";
import {
  listAccounts,
  type NonEvmAccountView,
} from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns the TRON Ledger pairing status: { paired: false } if no TRON account is in the persistent cache; { paired: true, address, derivationPath, rpcEndpoint, pairedAt, staleAccountWarning? } otherwise.",
  "Use this BEFORE any TRON read tool to confirm pairing.",
  "staleAccountWarning surfaces when pairedAt is older than 30 days — user should re-pair via pair_tron_ledger to refresh the cache.",
  "rpcEndpoint reflects the URL the TRON client is constructed against (TRON_RPC_URL override or the public TronGrid fallback).",
  "Never errors — a missing record / disk-unavailable store both surface as paired:false.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_tron_status", DESCRIPTION, INPUT_SCHEMA, async () => {
  let records: NonEvmAccountView[];
  try {
    records = listAccounts({ chainFilter: "tron" });
  } catch {
    // Defensive: the store's listAccounts() swallows IO errors internally,
    // but we still want a tolerant outer arm so a future schema-change
    // throw cannot break the whole tool surface.
    records = [];
  }

  if (records.length === 0) {
    return {
      content: [
        {
          type: "text",
          text:
            "paired: false (no TRON Ledger pairing in the persistent cache; call pair_tron_ledger to pair)",
        },
      ],
      structuredContent: { paired: false },
    };
  }

  // Phase-scope: single TRON record per pair (saveAccount upserts on the
  // `(chain, address)` tuple). Multi-record handling deferred to v2.1.x.
  // Pick the first record.
  const record = records[0]!;
  const rpcEndpoint = _tronRegistry.getResolvedRpcUrl();

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
      "staleAccountWarning: true (pairedAt is older than 30 days; re-pair via pair_tron_ledger to refresh)",
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
