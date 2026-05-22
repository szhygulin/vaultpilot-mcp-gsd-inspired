// src/tools/get_btc_chain_tips.ts — Phase 27 Plan 27-01 (BTC-FORENSIC-04).
//
// MCP tool: get_btc_chain_tips({}) — returns all known Bitcoin chain tips
// and derives reorg signals from fork tips.
//
// Core-only — Esplora has no multi-tip endpoint. Returns core-not-configured
// envelope when BITCOIN_CORE_RPC_URL is unset.
//
// Reorg signal detection: any tip with status !== "active" and branchlen >= 1
// (RESEARCH §getchaintips). A "valid-fork" or "valid-headers" tip with branchlen >= 1
// indicates a recent fork branch — surfaced separately in reorgSignals.
//
// NEVER throws — all failure paths return a structured status field.
//
// Security: credentials NEVER appear in tool responses (T-27-02 mitigation).

import { callBitcoinCoreRpc } from "../clients/bitcoin-core-rpc.js";
import {
  getBitcoinCoreRpcUrl,
  getBitcoinCoreRpcUser,
  getBitcoinCoreRpcPass,
} from "../config/bitcoin-core-env.js";
import { registerTool } from "./index.js";

// ─── Bitcoin Core getchaintips result shape ───────────────────────────────────

interface ChainTip {
  hash: string;
  height: number;
  branchlen: number;
  status: "active" | "valid-fork" | "valid-headers" | "headers-only" | "invalid";
}

// ─── Tool registration ────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Returns all known Bitcoin chain tips — the active tip and any fork tips Core has seen but not built on.",
  "Each tip carries { hash, height, branchlen, status } where status ∈ active | valid-fork | valid-headers | headers-only | invalid.",
  "A valid-fork or valid-headers tip with branchlen >= 1 indicates a recent reorg signal — surfaced separately as reorgSignals for the agent to relay.",
  "Core-only — Esplora has no multi-tip endpoint.",
  "Returns core-not-configured envelope when BITCOIN_CORE_RPC_URL is unset.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_btc_chain_tips", DESCRIPTION, INPUT_SCHEMA, async () => {
  const coreUrl = getBitcoinCoreRpcUrl();

  if (coreUrl === null) {
    return {
      content: [
        {
          type: "text",
          text: "Bitcoin Core RPC not configured — set BITCOIN_CORE_RPC_URL to enable chain-tip forensics (Esplora has no multi-tip endpoint)",
        },
      ],
      structuredContent: {
        status: "core-not-configured",
        message:
          "Set BITCOIN_CORE_RPC_URL to enable chain-tip forensics (Esplora has no multi-tip endpoint)",
        esploraFallbackAvailable: false,
      },
    };
  }

  const user = getBitcoinCoreRpcUser();
  const pass = getBitcoinCoreRpcPass();

  const result = await callBitcoinCoreRpc<ChainTip[]>(
    coreUrl,
    user,
    pass,
    "getchaintips",
    [],
  );

  if (result.kind !== "ok") {
    const errorCode =
      result.kind === "rpc-error"
        ? "BITCOIN_CORE_RPC_ERROR"
        : result.kind === "rate-limited"
          ? "BITCOIN_CORE_RATE_LIMITED"
          : "BITCOIN_CORE_NETWORK_ERROR";
    const message =
      result.kind !== "not-configured" ? (result.message ?? "") : "";

    return {
      content: [
        {
          type: "text",
          text: `Bitcoin Core RPC error (getchaintips): ${errorCode} — ${message}`,
        },
      ],
      structuredContent: {
        status: result.kind,
        message,
        errorCode,
        ...(result.kind === "rpc-error" ? { code: result.code } : {}),
      },
    };
  }

  const tips = result.result;

  // Derive reorg signals: any non-active tip with branchlen >= 1.
  // branchlen === 0 on a non-active tip means a same-height alt-tip (e.g. headers-only
  // with no fork branch) — NOT a reorg signal per RESEARCH §getchaintips.
  const reorgSignals = tips.filter(
    (t) => t.status !== "active" && t.branchlen >= 1,
  );

  const activeTip = tips.find((t) => t.status === "active");
  const lines: string[] = [];
  lines.push(`Bitcoin chain tips (getchaintips, source: bitcoin-core)`);
  lines.push(`  totalTips: ${tips.length}`);
  lines.push(`  activeTip: height=${activeTip?.height ?? "?"} hash=${activeTip?.hash ?? "?"}`);
  if (reorgSignals.length > 0) {
    lines.push(`  reorgSignals: ${reorgSignals.length} fork tip(s) detected`);
    for (const sig of reorgSignals) {
      lines.push(`    height=${sig.height} branchlen=${sig.branchlen} status=${sig.status} hash=${sig.hash}`);
    }
  } else {
    lines.push(`  reorgSignals: none`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      status: "ok",
      tips,
      reorgSignals,
      source: "bitcoin-core",
    },
  };
});
