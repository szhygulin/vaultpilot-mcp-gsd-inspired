// MCP tool: get_demo_wallet() — Plan 05-01 / DEMO-03 + Plan 11-06.
//
// Lists the curated demo persona registries — 4 EVM + 1 Solana (Plan 11-06).
// The agent calls this to decide whether to recommend `set_demo_wallet`,
// or to know which slugs are valid.
//
// NO `isDemoMode()` gate — listing personas is read-only and works in any
// mode. An agent in real-mode might still call this to surface the demo
// menu to the user ("if you want to try the simulation flows, here are
// the personas available").
//
// Plan 11-06 widens the response to include both `evmPersonas` and
// `solanaPersonas` arrays and surfaces both active slugs. EVM and Solana
// active personas are INDEPENDENT — both stay active simultaneously.

import { PERSONAS } from "../demo/personas.js";
import { listSolanaPersonas } from "../demo/solana-persona.js";
import {
  getActivePersona,
  getActiveSolanaPersona,
} from "../demo/state.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "List the curated demo wallet personas (4 EVM + 1 Solana) the user can activate via set_demo_wallet.",
  "Use this when the user wants to try VaultPilot's simulation flows without pairing a real Ledger, or when answering 'what personas are available?'.",
  "Works in any mode (demo or real) — listing is read-only and surfaces the menu the agent then offers the user.",
  "Do NOT use this for the user's actual portfolio in real mode — that's get_portfolio_summary against a paired Ledger's address (call get_ledger_status / get_solana_status first).",
  "Returns `{ evmPersonas: [{ chain, slug, address, description, rehearsableFlows }, ...], solanaPersonas: [{ chain, slug, solanaAddress, description, rehearsableFlows }, ...], activeEvmPersona, activeSolanaPersona, personas }` plus a DEMO WALLETS text block. The legacy `personas` array combines both for back-compat.",
  "Each persona's `rehearsableFlows` array names the read tools that exercise interesting behavior against that wallet.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_demo_wallet", DESCRIPTION, INPUT_SCHEMA, () => {
  const solanaPersonas = listSolanaPersonas();
  const lines: string[] = ["DEMO WALLETS"];
  lines.push("  EVM:");
  for (const p of PERSONAS) {
    // Trim description to first 60 chars for the text block. The full
    // description ships in structuredContent — agents that need the
    // long-form read structured; humans reading the chat see the
    // compact form here.
    const shortDesc =
      p.description.length > 60 ? `${p.description.slice(0, 60)}…` : p.description;
    lines.push(`    ${p.slug.padEnd(14)} ${p.address}  ${shortDesc}`);
  }
  lines.push("  Solana:");
  for (const p of solanaPersonas) {
    const shortDesc =
      p.description.length > 60 ? `${p.description.slice(0, 60)}…` : p.description;
    lines.push(`    ${p.slug.padEnd(14)} ${p.solanaAddress}  ${shortDesc}`);
  }
  lines.push("");
  lines.push("Activate one via `set_demo_wallet({ persona: \"<slug>\" })`.");

  const activeEvm = getActivePersona();
  const activeSolana = getActiveSolanaPersona();

  // Combined `personas` array kept for back-compat with v1.x consumers.
  // EVM entries surface as `{ chain: "ethereum", slug, address, ... }`;
  // Solana entries as `{ chain: "solana", slug, address: solanaAddress, ... }`.
  // The dedicated `evmPersonas` + `solanaPersonas` arrays carry the
  // chain-native shape (EVM `address` is `Address` viem-branded;
  // Solana `solanaAddress` is base58).
  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      personas: PERSONAS.map((p) => ({
        slug: p.slug,
        address: p.address,
        description: p.description,
        rehearsableFlows: p.rehearsableFlows,
      })),
      evmPersonas: PERSONAS.map((p) => ({
        chain: "ethereum",
        slug: p.slug,
        address: p.address,
        description: p.description,
        rehearsableFlows: p.rehearsableFlows,
      })),
      solanaPersonas: solanaPersonas.map((p) => ({
        chain: p.chain,
        slug: p.slug,
        solanaAddress: p.solanaAddress,
        description: p.description,
        rehearsableFlows: p.rehearsableFlows,
      })),
      activeEvmPersona: activeEvm?.slug ?? null,
      activeSolanaPersona: activeSolana?.slug ?? null,
    },
  };
});
