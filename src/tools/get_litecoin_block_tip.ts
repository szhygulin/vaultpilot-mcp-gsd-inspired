// src/tools/get_litecoin_block_tip.ts — Phase 27 Plan 27-02 (LTC-FORENSIC-01 / tip).
//
// MCP tool: get_litecoin_block_tip({}) — returns the current Litecoin chain tip.
//
// Near-verbatim clone of src/tools/get_btc_block_tip.ts (Plan 27-01) parameterized
// on Litecoin Core RPC env readers and litecoinspace.org Esplora fallback.
//
// Core path (preferred): 2-call sequence via Litecoin Core RPC
//   1. getblockchaininfo → height + bestblockhash + difficulty + mediantime
//   2. getblockheader(bestblockhash) → time (the tip block timestamp)
// NOTE: getblockchaininfo has NO "time" field (same RESEARCH §Pitfall 1 as BTC).
//
// Esplora fallback (when LITECOIN_CORE_RPC_URL is unset):
//   GET {esploraBase}/blocks/tip/height → plain-text integer
//   GET {esploraBase}/blocks/tip/hash   → plain-text hex string
//   litecoinspace.org is a mempool.space fork — /blocks/tip/* mirrors Esplora.
//   No difficulty or timestamp available via Esplora (surfaced as null).
//
// MWEB note: MimbleWimble Extension Blocks fields from Core responses are
//   absorbed via the index signature on GetBlockchainInfoResult and NOT surfaced.
//   Phase 27 surfaces standard UTXO-model chain data only (RESEARCH §Pitfall 5).
//
// ASSUMED A2: LTC Core's `chain` field value (e.g. "litecoin" or "main") is NOT
//   validated — the index signature makes the tool chain-field-agnostic.
//   The test "Response with chain: 'main'" anchors this regression.
//
// Error codes use LITECOIN_CORE_* prefix (distinct from BITCOIN_CORE_* prefix)
//   so the agent can route on errorCode pattern per RESEARCH §LTC Compat.
//
// Security: LITECOIN_CORE_RPC_URL, LITECOIN_CORE_RPC_USER, and
//   LITECOIN_CORE_RPC_PASS NEVER appear in structuredContent or content text
//   (T-27-LTC-CRED-LEAK mitigation).

import { callBitcoinCoreRpc } from "../clients/bitcoin-core-rpc.js";
import {
  getLitecoinCoreRpcUrl,
  getLitecoinCoreRpcUser,
  getLitecoinCoreRpcPass,
} from "../config/bitcoin-core-env.js";
import { _litecoinRegistry } from "../chains/litecoin/registry.js";
import { registerTool } from "./index.js";

// ─── Litecoin Core RPC result shapes ─────────────────────────────────────────

interface GetBlockchainInfoResult {
  // ASSUMED A2: the `chain` field value is NOT validated.
  // LTC Core may return "litecoin" or "main" — the index signature absorbs it.
  blocks: number;
  bestblockhash: string;
  difficulty: number;
  mediantime: number;
  // Index signature absorbs LTC-specific fields (MWEB, chain name variants, etc.)
  // without TypeScript strict-mode breakage (RESEARCH §Pitfall 5 + §A2).
  [key: string]: unknown;
}

interface GetBlockHeaderResult {
  time: number;
  mediantime: number;
  [key: string]: unknown;
}

// ─── Tool registration ────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Returns the current Litecoin chain tip — height + best block hash + difficulty + timestamp.",
  "If `LITECOIN_CORE_RPC_URL` is set, queries Litecoin Core (full data including difficulty + timestamp via a 2-call getblockchaininfo then getblockheader sequence).",
  "Otherwise degrades to litecoinspace.org `/blocks/tip/height` + `/blocks/tip/hash` (height + hash only; difficulty + timestamp null).",
  "NEVER throws — failure paths return a structured status field.",
  "MWEB (MimbleWimble Extension Blocks) fields are ignored — Phase 27 surfaces standard UTXO-model chain data only.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_litecoin_block_tip", DESCRIPTION, INPUT_SCHEMA, async () => {
  const coreUrl = getLitecoinCoreRpcUrl();

  if (coreUrl === null) {
    // ── Esplora fallback path ────────────────────────────────────────────────
    // litecoinspace.org is a mempool.space fork — /blocks/tip/* mirrors Esplora.
    const esploraBase = _litecoinRegistry.getEsploraBaseUrl();
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
    lines.push("Litecoin chain tip (litecoinspace.org Esplora fallback — Core RPC not configured)");
    if (tip !== null) {
      lines.push(`  height: ${tip.height}`);
      lines.push(`  hash: ${tip.hash}`);
      lines.push(`  difficulty: null (not available via Esplora)`);
      lines.push(`  timestamp: null (not available via Esplora)`);
      lines.push(`  source: esplora-litecoinspace`);
    } else {
      lines.push(`  status: esplora-error`);
      lines.push(`  error: ${esploraError ?? "unknown"}`);
    }
    lines.push(`  esploraFallbackAvailable: true`);
    lines.push(`  message: Set LITECOIN_CORE_RPC_URL to enable forensic reads (difficulty + timestamp unavailable via Esplora)`);

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        status: "core-not-configured",
        message:
          "Set LITECOIN_CORE_RPC_URL to enable forensic reads (difficulty + timestamp unavailable via Esplora)",
        esploraFallbackAvailable: true,
        tip: tip,
        ...(esploraError !== undefined ? { esploraError } : {}),
        source: "esplora-litecoinspace",
      },
    };
  }

  // ── Litecoin Core path ────────────────────────────────────────────────────
  // 2-call sequence: getblockchaininfo → getblockheader(bestblockhash)
  // Chain-agnostic client (callBitcoinCoreRpc) is reused with LTC URL + creds.
  const user = getLitecoinCoreRpcUser();
  const pass = getLitecoinCoreRpcPass();

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
        ? "LITECOIN_CORE_RPC_ERROR"
        : infoResult.kind === "rate-limited"
          ? "LITECOIN_CORE_RATE_LIMITED"
          : "LITECOIN_CORE_NETWORK_ERROR";

    const message =
      infoResult.kind !== "not-configured"
        ? (infoResult.message ?? "")
        : "";

    const code =
      infoResult.kind === "rpc-error"
        ? (infoResult as { code: number }).code
        : undefined;

    return {
      content: [
        {
          type: "text",
          text: `Litecoin Core RPC error (getblockchaininfo): ${errorCode} — ${message}`,
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
  // Same RESEARCH §Pitfall 1 as BTC: getblockchaininfo has NO "time" field.
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
  lines.push("Litecoin chain tip (Litecoin Core RPC)");
  lines.push(`  height: ${info.blocks}`);
  lines.push(`  hash: ${info.bestblockhash}`);
  lines.push(`  difficulty: ${info.difficulty}`);
  lines.push(`  timestamp: ${timestamp ?? "null (getblockheader failed)"}`);
  lines.push(`  source: litecoin-core`);
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
      source: "litecoin-core",
    },
  };
});
