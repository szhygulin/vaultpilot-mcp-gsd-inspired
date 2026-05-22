// src/tools/get_btc_block_tip.ts — Phase 27 Plan 27-01 (BTC-FORENSIC-02).
//
// MCP tool: get_btc_block_tip({}) — returns the current Bitcoin chain tip.
//
// Core path (preferred): 2-call sequence via Bitcoin Core RPC
//   1. getblockchaininfo → height + bestblockhash + difficulty
//   2. getblockheader(bestblockhash) → time (the tip block timestamp)
// NOTE: getblockchaininfo has NO "time" field (RESEARCH §Pitfall 1).
//       The tip block's actual timestamp requires a follow-up getblockheader call.
//
// Esplora fallback (when BITCOIN_CORE_RPC_URL is unset):
//   GET {esploraBase}/blocks/tip/height → plain-text integer
//   GET {esploraBase}/blocks/tip/hash   → plain-text hex string
//   No difficulty or timestamp available via Esplora (surfaced as null).
//
// NEVER throws — all failure paths return a structured status field.
//
// Security: BITCOIN_CORE_RPC_URL, BITCOIN_CORE_RPC_USER, and
//   BITCOIN_CORE_RPC_PASS NEVER appear in structuredContent or content text
//   (T-27-02 mitigation). URL is used only in the RPC client call; credentials
//   are not echoed.

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
  chain: string;
  blocks: number;
  bestblockhash: string;
  difficulty: number;
  mediantime: number;
  // Note: NO "time" field in getblockchaininfo (RESEARCH §Pitfall 1).
}

interface GetBlockHeaderResult {
  time: number;
  mediantime: number;
  [key: string]: unknown;
}

// ─── Tool registration ────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Returns the current Bitcoin chain tip — height + best block hash + difficulty + timestamp.",
  "If BITCOIN_CORE_RPC_URL is set, queries Bitcoin Core (full data including difficulty + timestamp via a 2-call getblockchaininfo then getblockheader sequence).",
  "Otherwise degrades to Esplora /blocks/tip/height + /blocks/tip/hash (height + hash only; difficulty + timestamp null).",
  "NEVER throws — failure paths return a structured status field.",
  "Use this when the agent needs to confirm chain liveness or detect tip lag before reporting forensic anomalies.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_btc_block_tip", DESCRIPTION, INPUT_SCHEMA, async () => {
  const coreUrl = getBitcoinCoreRpcUrl();

  if (coreUrl === null) {
    // ── Esplora fallback path ────────────────────────────────────────────────
    // Fetch height + hash in parallel from Esplora /blocks/tip/* endpoints.
    // Difficulty and timestamp are not available via Esplora (surfaced as null).
    const esploraBase = _bitcoinRegistry.getEsploraBaseUrl();
    let tip: { height: number; hash: string; difficulty: null; timestamp: null } | null = null;
    let esploraError: string | undefined;

    try {
      const [heightResp, hashResp] = await Promise.all([
        fetch(`${esploraBase}/blocks/tip/height`),
        fetch(`${esploraBase}/blocks/tip/hash`),
      ]);

      if (!heightResp.ok || !hashResp.ok) {
        const failedStatus = !heightResp.ok ? heightResp.status : hashResp.status;
        esploraError = `Esplora /blocks/tip endpoint returned HTTP ${failedStatus}`;
      } else {
        const heightText = await heightResp.text();
        const hashText = await hashResp.text();
        const height = parseInt(heightText.trim(), 10);
        if (isNaN(height)) {
          esploraError = `Esplora /blocks/tip/height returned non-integer: ${heightText.slice(0, 20)}`;
        } else {
          tip = {
            height,
            hash: hashText.trim(),
            difficulty: null,
            timestamp: null,
          };
        }
      }
    } catch (e) {
      esploraError = `Esplora fetch failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    const lines: string[] = [];
    lines.push("Bitcoin chain tip (Esplora fallback — Core RPC not configured)");
    if (tip !== null) {
      lines.push(`  height: ${tip.height}`);
      lines.push(`  hash: ${tip.hash}`);
      lines.push(`  difficulty: null (not available via Esplora)`);
      lines.push(`  timestamp: null (not available via Esplora)`);
      lines.push(`  source: esplora`);
    } else {
      lines.push(`  status: esplora-error`);
      lines.push(`  error: ${esploraError ?? "unknown"}`);
    }
    lines.push(`  esploraFallbackAvailable: true`);
    lines.push(`  message: Set BITCOIN_CORE_RPC_URL to enable forensic reads (difficulty + timestamp unavailable via Esplora)`);

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        status: "core-not-configured",
        message:
          "Set BITCOIN_CORE_RPC_URL to enable forensic reads (difficulty + timestamp unavailable via Esplora)",
        esploraFallbackAvailable: true,
        tip: tip,
        ...(esploraError !== undefined ? { esploraError } : {}),
        source: "esplora",
      },
    };
  }

  // ── Bitcoin Core path ──────────────────────────────────────────────────────
  // 2-call sequence: getblockchaininfo → getblockheader(bestblockhash)
  const user = getBitcoinCoreRpcUser();
  const pass = getBitcoinCoreRpcPass();

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

    const message = infoResult.kind !== "not-configured"
      ? (infoResult.message ?? "")
      : "";

    const code =
      infoResult.kind === "rpc-error" ? (infoResult as { code: number }).code : undefined;

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
        ...(code !== undefined ? { code } : {}),
      },
    };
  }

  const info = infoResult.result;

  // Second call: getblockheader to get the actual block timestamp.
  // getblockchaininfo returns mediantime (median of last 11 blocks), NOT the
  // tip block's timestamp. We need getblockheader(bestblockhash).time.
  const headerResult = await callBitcoinCoreRpc<GetBlockHeaderResult>(
    coreUrl,
    user,
    pass,
    "getblockheader",
    [info.bestblockhash],
  );

  const timestamp: number | null =
    headerResult.kind === "ok" ? headerResult.result.time : null;
  const headerError: string | undefined =
    headerResult.kind !== "ok" && headerResult.kind !== "not-configured"
      ? (headerResult as { message?: string }).message
      : undefined;

  const lines: string[] = [];
  lines.push("Bitcoin chain tip (Bitcoin Core RPC)");
  lines.push(`  height: ${info.blocks}`);
  lines.push(`  hash: ${info.bestblockhash}`);
  lines.push(`  difficulty: ${info.difficulty}`);
  lines.push(`  timestamp: ${timestamp ?? "null (getblockheader failed)"}`);
  lines.push(`  source: bitcoin-core`);
  if (headerError !== undefined) {
    lines.push(`  headerError: ${headerError}`);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      status: "ok",
      tip: {
        height: info.blocks,
        hash: info.bestblockhash,
        difficulty: info.difficulty,
        timestamp,
      },
      ...(headerError !== undefined ? { headerError } : {}),
      source: "bitcoin-core",
    },
  };
});
