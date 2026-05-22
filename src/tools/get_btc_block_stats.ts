// src/tools/get_btc_block_stats.ts — Phase 27 Plan 27-01 (BTC-FORENSIC-03).
//
// MCP tool: get_btc_block_stats({ blockHeight }) — returns per-block transaction
// stats, fee percentiles, vsize, and segwit adoption for a given block height.
//
// Core-only — getblockstats has no Esplora equivalent. Returns
// core-not-configured envelope when BITCOIN_CORE_RPC_URL is unset.
//
// Key computed fields:
//   - segwitAdoptionPct = (swtxs / txs) * 100 (DERIVED — not a direct field)
//   - taprootAdoption = "not-available-via-getblockstats" as const
//     (RESEARCH §Pitfall 3 — taproot is NOT a direct getblockstats field)
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

// ─── Bitcoin Core getblockstats result shape ──────────────────────────────────

interface GetBlockStatsResult {
  blockhash: string;
  height: number;
  time: number;
  mediantime: number;
  txs: number;
  swtxs: number;
  feerate_percentiles: [number, number, number, number, number]; // [p10, p25, p50, p75, p90] sat/vB
  total_size: number;
  total_weight: number;
  // Index signature absorbs LTC MWEB fields and any other optional fields
  // (RESEARCH §Pitfall 5 — keeps the type chain-agnostic).
  [key: string]: unknown;
}

// ─── Tool registration ────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Returns per-block transaction count, fee percentiles (10/25/50/75/90 sat/vB), total vsize, and segwit adoption (DERIVED from swtxs/txs) for a given block height.",
  "Taproot adoption is NOT available via Bitcoin Core's getblockstats — the response surfaces it as the literal 'not-available-via-getblockstats'.",
  "Core-only — returns core-not-configured envelope when BITCOIN_CORE_RPC_URL is unset (no Esplora fallback for getblockstats).",
  "Use this when the agent needs to characterize block-level fee market activity or congestion.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    blockHeight: {
      type: "integer",
      minimum: 0,
      description: "Bitcoin block height (>= 0).",
    },
  },
  required: ["blockHeight"],
  additionalProperties: false,
};

registerTool(
  "get_btc_block_stats",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args: unknown) => {
    const input = args as { blockHeight?: unknown };

    // ── Input validation ───────────────────────────────────────────────────
    const blockHeight = input.blockHeight;
    if (
      typeof blockHeight !== "number" ||
      !Number.isInteger(blockHeight) ||
      blockHeight < 0
    ) {
      return {
        content: [
          { type: "text", text: `error: blockHeight must be a non-negative integer` },
        ],
        structuredContent: {
          status: "invalid-input",
          errorCode: "INVALID_INPUT",
          message: "blockHeight must be a non-negative integer",
        },
      };
    }

    // ── Core URL check ─────────────────────────────────────────────────────
    const coreUrl = getBitcoinCoreRpcUrl();
    if (coreUrl === null) {
      return {
        content: [
          {
            type: "text",
            text: "Bitcoin Core RPC not configured — set BITCOIN_CORE_RPC_URL to enable per-block forensic stats (Esplora has no equivalent endpoint)",
          },
        ],
        structuredContent: {
          status: "core-not-configured",
          message:
            "Set BITCOIN_CORE_RPC_URL to enable per-block forensic stats (Esplora has no equivalent endpoint)",
          esploraFallbackAvailable: false,
        },
      };
    }

    // ── Bitcoin Core getblockstats call ────────────────────────────────────
    const user = getBitcoinCoreRpcUser();
    const pass = getBitcoinCoreRpcPass();

    const statsResult = await callBitcoinCoreRpc<GetBlockStatsResult>(
      coreUrl,
      user,
      pass,
      "getblockstats",
      [blockHeight],
    );

    if (statsResult.kind !== "ok") {
      const errorCode =
        statsResult.kind === "rpc-error"
          ? "BITCOIN_CORE_RPC_ERROR"
          : statsResult.kind === "rate-limited"
            ? "BITCOIN_CORE_RATE_LIMITED"
            : "BITCOIN_CORE_NETWORK_ERROR";

      const message =
        statsResult.kind !== "not-configured"
          ? (statsResult.message ?? "")
          : "";

      const code =
        statsResult.kind === "rpc-error"
          ? (statsResult as { code: number }).code
          : undefined;

      return {
        content: [
          {
            type: "text",
            text: `Bitcoin Core RPC error (getblockstats height=${blockHeight}): ${errorCode} — ${message}`,
          },
        ],
        structuredContent: {
          status: statsResult.kind,
          message,
          errorCode,
          ...(code !== undefined ? { code } : {}),
        },
      };
    }

    const stats = statsResult.result;

    // ── Derived fields ──────────────────────────────────────────────────────
    // segwitAdoptionPct = (swtxs / txs) * 100, rounded to 1 decimal.
    // Handle txs === 0 edge case to avoid divide-by-zero.
    const segwitAdoptionPct =
      stats.txs > 0
        ? Math.round((stats.swtxs / stats.txs) * 1000) / 10
        : 0;

    // taprootAdoption: NOT a direct getblockstats field in any Bitcoin Core version.
    // Surface as literal string per RESEARCH §Pitfall 3 — NEVER omit this field.
    const taprootAdoption = "not-available-via-getblockstats" as const;

    const lines: string[] = [];
    lines.push(`Bitcoin block stats (height=${stats.height})`);
    lines.push(`  blockhash: ${stats.blockhash}`);
    lines.push(`  timestamp: ${stats.time}`);
    lines.push(`  txCount: ${stats.txs}`);
    lines.push(`  segwitTxCount: ${stats.swtxs}`);
    lines.push(`  segwitAdoptionPct: ${segwitAdoptionPct}%`);
    lines.push(`  taprootAdoption: ${taprootAdoption}`);
    lines.push(
      `  feePercentiles: p10=${stats.feerate_percentiles[0]} p25=${stats.feerate_percentiles[1]} p50=${stats.feerate_percentiles[2]} p75=${stats.feerate_percentiles[3]} p90=${stats.feerate_percentiles[4]} sat/vB`,
    );
    lines.push(`  totalSizeVbytes: ${stats.total_size}`);
    lines.push(`  source: bitcoin-core`);

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        status: "ok",
        blockHeight: stats.height,
        blockhash: stats.blockhash,
        timestamp: stats.time,
        txCount: stats.txs,
        segwitTxCount: stats.swtxs,
        segwitAdoptionPct,
        taprootAdoption,
        feePercentilesSatVb: {
          p10: stats.feerate_percentiles[0],
          p25: stats.feerate_percentiles[1],
          p50: stats.feerate_percentiles[2],
          p75: stats.feerate_percentiles[3],
          p90: stats.feerate_percentiles[4],
        },
        totalSizeVbytes: stats.total_size,
        source: "bitcoin-core",
      },
    };
  },
);
