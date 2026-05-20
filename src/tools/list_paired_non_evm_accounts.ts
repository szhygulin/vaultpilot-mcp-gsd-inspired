// MCP tool: list_paired_non_evm_accounts({}) — Plan 11-04 (PAIR-NEV-05).
//
// Iterates the non-EVM account store and surfaces chain + address +
// pairedAt + optional staleAccountWarning + optional displayName for
// every paired record (Solana / TRON / BTC / LTC).
//
// SHOULDER-SURFING DEFENSE — derivationPath MUST NOT appear in any tool
// response. See test/list-paired-non-evm-accounts.test.ts Test 5 for the
// 3-sentinel substring-scan regression (mirrors the Q-CONFIG-LEAK pattern
// in test/get-vaultpilot-config-status.test.ts Test 2).
//
// The derivation path leaks the BIP44 account index — a weak entropy
// signal, but a real surface. `get_solana_status` is the per-chain read
// where the caller explicitly asked for their own slot; the list iterator
// is the cross-chain surface where exfiltration would be cheap, so the
// path stays internal here.

import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Lists all paired non-EVM Ledger accounts (Solana / TRON / BTC / LTC) by chain + address + pairedAt timestamp, plus an optional staleAccountWarning when pairedAt is older than 30 days.",
  "Use this when the user wants an inventory of all paired non-EVM accounts across chains.",
  "NEVER surfaces derivation paths — the BIP44 account index leak is a documented shoulder-surfing concern (the iterator across the whole non-EVM surface would otherwise expose every slot across every chain in one response).",
  "Returns { accounts: Array<{ chain, address, pairedAt, staleAccountWarning?, displayName? }> }. For per-chain detail including the derivation path, use the chain-specific status tool (e.g. get_solana_status).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool(
  "list_paired_non_evm_accounts",
  DESCRIPTION,
  INPUT_SCHEMA,
  async () => {
    const records = listAccounts();

    // SHOULDER-SURFING DEFENSE: project to a fixed allow-list of fields.
    // We do NOT spread the record (a spread would carry derivationPath
    // through silently). Explicit field-by-field copy ensures a future
    // schema addition to NonEvmAccountView does NOT leak by default.
    const accounts = records.map((r) => {
      const out: Record<string, unknown> = {
        chain: r.chain,
        address: r.address,
        pairedAt: r.pairedAt,
      };
      if (r.staleAccountWarning) out.staleAccountWarning = true;
      if (r.displayName) out.displayName = r.displayName;
      return out;
    });

    // Text block is line-per-record; same allow-list discipline.
    const lines: string[] = [];
    if (accounts.length === 0) {
      lines.push("paired non-EVM accounts: (none)");
    } else {
      lines.push(`paired non-EVM accounts: ${accounts.length}`);
      for (const a of accounts) {
        const parts = [
          `  ${a.chain as string}`,
          `address: ${a.address as string}`,
          `pairedAt: ${a.pairedAt as string}`,
        ];
        if (a.staleAccountWarning) parts.push("staleAccountWarning: true");
        if (a.displayName) parts.push(`displayName: ${a.displayName as string}`);
        lines.push(parts.join(", "));
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: { accounts },
    };
  },
);
