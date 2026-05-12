// MCP tool: get_demo_wallet() — Plan 05-01 / DEMO-03.
//
// Lists the curated demo persona registry from `src/demo/personas.ts`.
// The agent calls this to decide whether to recommend `set_demo_wallet`,
// or to know which slugs are valid.
//
// NO `isDemoMode()` gate — listing personas is read-only and works in any
// mode. An agent in real-mode might still call this to surface the demo
// menu to the user ("if you want to try the simulation flows, here are
// the personas available").

import { PERSONAS } from "../demo/personas.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "List the curated demo wallet personas (4 entries) the user can activate via set_demo_wallet.",
  "Use this when the user wants to try VaultPilot's simulation flows without pairing a real Ledger, or when answering 'what personas are available?'.",
  "Works in any mode (demo or real) — listing is read-only and surfaces the menu the agent then offers the user.",
  "Do NOT use this for the user's actual portfolio in real mode — that's get_portfolio_summary against a paired Ledger's address (call get_ledger_status first).",
  "Returns `{ personas: [{ slug, address, description, rehearsableFlows }, ...] }` plus a DEMO WALLETS text block.",
  "Each persona's `rehearsableFlows` array names the read tools that exercise interesting behavior against that wallet (e.g. ERC-20 enumeration, ENS resolution).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_demo_wallet", DESCRIPTION, INPUT_SCHEMA, () => {
  const lines: string[] = ["DEMO WALLETS"];
  for (const p of PERSONAS) {
    // Trim description to first 60 chars for the text block. The full
    // description ships in structuredContent — agents that need the
    // long-form read structured; humans reading the chat see the
    // compact form here.
    const shortDesc =
      p.description.length > 60 ? `${p.description.slice(0, 60)}…` : p.description;
    lines.push(`  ${p.slug.padEnd(14)} ${p.address}  ${shortDesc}`);
  }
  lines.push("");
  lines.push("Activate one via `set_demo_wallet({ persona: \"<slug>\" })`.");

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      personas: PERSONAS.map((p) => ({
        slug: p.slug,
        address: p.address,
        description: p.description,
        rehearsableFlows: p.rehearsableFlows,
      })),
    },
  };
});
