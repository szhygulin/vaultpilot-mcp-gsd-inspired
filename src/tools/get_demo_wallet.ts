// MCP tool: get_demo_wallet() — Plan 05-01 / DEMO-03 + Plan 11-06 + Plan 17-05.
//
// Lists the curated demo persona registries — 4 EVM + 1 Solana + 1 TRON.
// The agent calls this to decide whether to recommend `set_demo_wallet`,
// or to know which slugs are valid.
//
// NO `isDemoMode()` gate — listing personas is read-only and works in any
// mode. An agent in real-mode might still call this to surface the demo
// menu to the user ("if you want to try the simulation flows, here are
// the personas available").
//
// Plan 17-05 widens the response to add a `tronPersonas` array and an
// `activeTronPersona` slug; EVM, Solana, and TRON active personas are
// INDEPENDENT — all three stay active simultaneously.

import { listBtcPersonas } from "../demo/bitcoin-persona.js";
import { PERSONAS } from "../demo/personas.js";
import { listSolanaPersonas } from "../demo/solana-persona.js";
import { listTronPersonas } from "../demo/tron-persona.js";
import {
  getActiveBtcPersona,
  getActivePersona,
  getActiveSolanaPersona,
  getActiveTronPersona,
} from "../demo/state.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "List the curated demo wallet personas (4 EVM + 1 Solana + 1 TRON + 1 BTC) the user can activate via set_demo_wallet.",
  "Use this when the user wants to try VaultPilot's simulation flows without pairing a real Ledger, or when answering 'what personas are available?'.",
  "Works in any mode (demo or real) — listing is read-only and surfaces the menu the agent then offers the user.",
  "Do NOT use this for the user's actual portfolio in real mode — that's get_portfolio_summary against a paired Ledger's address (call get_ledger_status / get_solana_status / get_tron_status / get_btc_status first).",
  "Returns `{ evmPersonas: [{ chain, slug, address, description, rehearsableFlows }, ...], solanaPersonas: [{ chain, slug, solanaAddress, description, rehearsableFlows }, ...], tronPersonas: [{ chain, slug, tronAddress, description, rehearsableFlows }, ...], btcPersonas: [{ chain, slug, btcSegwitAddress, btcTaprootAddress, description, rehearsableFlows }, ...], activeEvmPersona, activeSolanaPersona, activeTronPersona, activeBtcPersona, personas }` plus a DEMO WALLETS text block. The legacy `personas` array stays at the 4 EVM entries for back-compat. BTC entries carry BOTH segwit and taproot addresses — sibling-interface widening for the dual-script-type pairing surface.",
  "Each persona's `rehearsableFlows` array names the read tools that exercise interesting behavior against that wallet.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_demo_wallet", DESCRIPTION, INPUT_SCHEMA, () => {
  const solanaPersonas = listSolanaPersonas();
  const tronPersonas = listTronPersonas();
  const btcPersonas = listBtcPersonas();
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
  lines.push("  TRON:");
  for (const p of tronPersonas) {
    const shortDesc =
      p.description.length > 60 ? `${p.description.slice(0, 60)}…` : p.description;
    lines.push(`    ${p.slug.padEnd(14)} ${p.tronAddress}  ${shortDesc}`);
  }
  lines.push("  BTC:");
  for (const p of btcPersonas) {
    const shortDesc =
      p.description.length > 60 ? `${p.description.slice(0, 60)}…` : p.description;
    // BTC carries TWO addresses — surface segwit on the headline line
    // (canonical witness) and taproot on a continuation line so both
    // are visible in the text block.
    lines.push(`    ${p.slug.padEnd(14)} ${p.btcSegwitAddress}  ${shortDesc}`);
    lines.push(`    ${"".padEnd(14)} ${p.btcTaprootAddress}  (taproot)`);
  }
  lines.push("");
  lines.push("Activate one via `set_demo_wallet({ persona: \"<slug>\" })`.");

  const activeEvm = getActivePersona();
  const activeSolana = getActiveSolanaPersona();
  const activeTron = getActiveTronPersona();
  const activeBtc = getActiveBtcPersona();

  // Legacy `personas` array kept for back-compat with v1.x consumers —
  // stays at the 4 EVM entries (per Plan 11-06 back-compat decision; the
  // dedicated `evmPersonas` + `solanaPersonas` + `tronPersonas` +
  // `btcPersonas` arrays carry the chain-native shape). EVM `address`
  // is `Address` viem-branded; Solana `solanaAddress` is base58; TRON
  // `tronAddress` is base58check T-prefixed; BTC carries TWO addresses
  // (segwit bech32 + taproot bech32m).
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
      tronPersonas: tronPersonas.map((p) => ({
        chain: p.chain,
        slug: p.slug,
        tronAddress: p.tronAddress,
        description: p.description,
        rehearsableFlows: p.rehearsableFlows,
      })),
      btcPersonas: btcPersonas.map((p) => ({
        chain: p.chain,
        slug: p.slug,
        btcSegwitAddress: p.btcSegwitAddress,
        btcTaprootAddress: p.btcTaprootAddress,
        description: p.description,
        rehearsableFlows: p.rehearsableFlows,
      })),
      activeEvmPersona: activeEvm?.slug ?? null,
      activeSolanaPersona: activeSolana?.slug ?? null,
      activeTronPersona: activeTron?.slug ?? null,
      activeBtcPersona: activeBtc?.slug ?? null,
    },
  };
});
