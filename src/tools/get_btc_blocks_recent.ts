// src/tools/get_btc_blocks_recent.ts — Phase 27 Plan 27-01 (BTC-FORENSIC-04).
//
// MCP tool: get_btc_blocks_recent({ count }) — returns the last N block summaries.
//
// Core path: getblockchaininfo for tip height, then parallel getblockstats calls
// (capped at 10 concurrent) for each block in the window. Includes fee percentiles
// + segwit adoption per block.
//
// Esplora fallback (when BITCOIN_CORE_RPC_URL is unset): GET {esploraBase}/blocks
// returns the last 10 blocks with basic stats (no fee percentiles). Esplora's
// /blocks endpoint returns up to 10 blocks; pagination is out of scope for Phase 27.
// If count > 10, response includes truncatedToCount: 10 and feeFallback.
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
import { _bitcoinRegistry } from "../chains/bitcoin/registry.js";
import { registerTool } from "./index.js";

// ─── Bitcoin Core RPC result shapes ──────────────────────────────────────────

interface GetBlockchainInfoResult {
  blocks: number;
  bestblockhash: string;
  [key: string]: unknown;
}

interface GetBlockStatsResult {
  blockhash: string;
  height: number;
  time: number;
  txs: number;
  swtxs: number;
  feerate_percentiles: [number, number, number, number, number];
  total_size: number;
  [key: string]: unknown;
}

// ─── Esplora /blocks response shape ──────────────────────────────────────────

interface EsploraBlock {
  id?: string;
  height?: number;
  tx_count?: number;
  size?: number;
  timestamp?: number;
  [key: string]: unknown;
}

// ─── Tool registration ────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Returns the last N block summaries (height, hash, txCount, size, timestamp).",
  "Core path (preferred) calls getblockstats per height to include fee percentiles + segwit adoption; Esplora fallback uses /blocks and surfaces feeFallback: 'not-available-without-core-rpc' because Esplora's /blocks endpoint does not expose per-block fee percentiles.",
  "Esplora fallback is limited to the last 10 blocks — if count > 10, truncatedToCount: 10 is surfaced (Esplora pagination is out of scope for Phase 27).",
  "Use this when the agent needs a short window of recent block activity for anomaly detection.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    count: {
      type: "integer",
      minimum: 1,
      maximum: 50,
      description: "Number of recent blocks to return (1–50).",
    },
  },
  required: ["count"],
  additionalProperties: false,
};

registerTool(
  "get_btc_blocks_recent",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args: unknown) => {
    const input = args as { count?: unknown };

    // ── Input validation ───────────────────────────────────────────────────
    const count = input.count;
    if (
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 50
    ) {
      return {
        content: [{ type: "text", text: "error: count must be an integer between 1 and 50" }],
        structuredContent: {
          status: "invalid-input",
          errorCode: "INVALID_INPUT",
          message: "count must be an integer between 1 and 50",
        },
      };
    }

    const coreUrl = getBitcoinCoreRpcUrl();

    if (coreUrl === null) {
      // ── Esplora fallback ─────────────────────────────────────────────────
      const esploraBase = _bitcoinRegistry.getEsploraBaseUrl();
      let blocks: Array<Record<string, unknown>> = [];
      let esploraError: string | undefined;

      try {
        const resp = await fetch(`${esploraBase}/blocks`);
        if (!resp.ok) {
          esploraError = `Esplora /blocks returned HTTP ${resp.status}`;
        } else {
          const raw = (await resp.json()) as EsploraBlock[];
          if (!Array.isArray(raw)) {
            esploraError = "Esplora /blocks returned non-array response";
          } else {
            blocks = raw.slice(0, 10).map((b) => ({
              height: b.height ?? null,
              hash: b.id ?? null,
              txCount: b.tx_count ?? null,
              size: b.size ?? null,
              timestamp: b.timestamp ?? null,
              feePercentilesSatVb: null,
              segwitAdoptionPct: null,
            }));
          }
        }
      } catch (e) {
        esploraError = `Esplora fetch failed: ${e instanceof Error ? e.message : String(e)}`;
      }

      const lines: string[] = [];
      lines.push(`Bitcoin recent blocks (Esplora fallback — last 10 max, count=${count})`);
      lines.push(`  source: esplora`);
      lines.push(`  feeFallback: not-available-without-core-rpc`);
      lines.push(`  blocksReturned: ${blocks.length}`);
      if (count > 10) {
        lines.push(`  truncatedToCount: 10 (Esplora /blocks returns at most 10; pagination out of scope)`);
      }
      if (esploraError) {
        lines.push(`  esploraError: ${esploraError}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: {
          status: "core-not-configured",
          message:
            "Set BITCOIN_CORE_RPC_URL to enable per-block fee percentiles (Esplora fallback provides basic stats only)",
          esploraFallbackAvailable: true,
          feeFallback: "not-available-without-core-rpc",
          ...(count > 10 ? { truncatedToCount: 10 } : {}),
          ...(esploraError !== undefined ? { esploraError } : {}),
          blocks,
          source: "esplora",
        },
      };
    }

    // ── Bitcoin Core path ──────────────────────────────────────────────────
    const user = getBitcoinCoreRpcUser();
    const pass = getBitcoinCoreRpcPass();

    // Step 1: get chain tip height.
    const infoResult = await callBitcoinCoreRpc<GetBlockchainInfoResult>(
      coreUrl,
      user,
      pass,
      "getblockchaininfo",
      [],
    );

    if (infoResult.kind !== "ok") {
      const errorCode =
        infoResult.kind === "rpc-error"
          ? "BITCOIN_CORE_RPC_ERROR"
          : infoResult.kind === "rate-limited"
            ? "BITCOIN_CORE_RATE_LIMITED"
            : "BITCOIN_CORE_NETWORK_ERROR";
      const message =
        infoResult.kind !== "not-configured" ? (infoResult.message ?? "") : "";
      return {
        content: [
          {
            type: "text",
            text: `Bitcoin Core RPC error (getblockchaininfo): ${errorCode} — ${message}`,
          },
        ],
        structuredContent: {
          status: infoResult.kind,
          message,
          errorCode,
          ...(infoResult.kind === "rpc-error" ? { code: infoResult.code } : {}),
        },
      };
    }

    const tipHeight = infoResult.result.blocks;

    // Step 2: fetch getblockstats for each height in the window.
    // Heights from tip down to tip-count+1. Parallelized in batches of 10
    // to avoid stressing the Core node.
    const heights: number[] = [];
    for (let h = tipHeight; h > tipHeight - count && h >= 0; h--) {
      heights.push(h);
    }

    const BATCH_SIZE = 10;
    const blockResults: Array<
      | { height: number; hash: string; timestamp: number; txCount: number; size: number; segwitAdoptionPct: number; feePercentilesSatVb: { p10: number; p25: number; p50: number; p75: number; p90: number } }
      | { height: number; error: string }
    > = [];

    for (let i = 0; i < heights.length; i += BATCH_SIZE) {
      const batch = heights.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (height) => {
          const statsResult = await callBitcoinCoreRpc<GetBlockStatsResult>(
            coreUrl,
            user,
            pass,
            "getblockstats",
            [height],
          );

          if (statsResult.kind !== "ok") {
            const msg =
              statsResult.kind !== "not-configured"
                ? (statsResult.message ?? `${statsResult.kind}`)
                : "not-configured";
            return { height, error: msg };
          }

          const s = statsResult.result;
          const segwitAdoptionPct =
            s.txs > 0 ? Math.round((s.swtxs / s.txs) * 1000) / 10 : 0;

          return {
            height: s.height,
            hash: s.blockhash,
            timestamp: s.time,
            txCount: s.txs,
            size: s.total_size,
            segwitAdoptionPct,
            feePercentilesSatVb: {
              p10: s.feerate_percentiles[0],
              p25: s.feerate_percentiles[1],
              p50: s.feerate_percentiles[2],
              p75: s.feerate_percentiles[3],
              p90: s.feerate_percentiles[4],
            },
          };
        }),
      );
      blockResults.push(...batchResults);
    }

    const lines: string[] = [];
    lines.push(`Bitcoin recent blocks (last ${count}, source: bitcoin-core)`);
    for (const b of blockResults) {
      if ("error" in b) {
        lines.push(`  height=${b.height}: error: ${b.error}`);
      } else {
        lines.push(`  height=${b.height} txCount=${b.txCount} segwit=${b.segwitAdoptionPct}% p50=${b.feePercentilesSatVb.p50}sat/vB`);
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        status: "ok",
        blocks: blockResults,
        source: "bitcoin-core",
      },
    };
  },
);
