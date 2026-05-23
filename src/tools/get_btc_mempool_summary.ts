// src/tools/get_btc_mempool_summary.ts — Phase 27 Plan 27-02 (BTC-FORENSIC-05).
//
// MCP tool: get_btc_mempool_summary({}) — returns the Bitcoin mempool census.
//
// Core-only — Esplora has no mempool-census endpoint. Returns core-not-configured
// envelope with esploraFallbackAvailable: false when BITCOIN_CORE_RPC_URL is unset.
//
// RESEARCH §Pitfall 6 anchor: NEVER call getrawmempool (response can be tens of MB
// on a production node). This tool uses getmempoolinfo ONLY.
//
// RESEARCH §PR #21422 anchor: fee histogram is NOT available in getmempoolinfo
// (PR #21422 closed without merge). The feeHistogram field surfaces as the literal
// "not-available-without-getrawmempool" — this is the public RESEARCH anchor, not
// an error. Do NOT call getrawmempool to populate a histogram.
//
// Security: BITCOIN_CORE_RPC_URL, BITCOIN_CORE_RPC_USER, and BITCOIN_CORE_RPC_PASS
//   NEVER appear in structuredContent or content text (T-27-CORE-CRED-LEAK mitigation).

import { callBitcoinCoreRpc } from "../clients/bitcoin-core-rpc.js";
import {
  getBitcoinCoreRpcUrl,
  getBitcoinCoreRpcUser,
  getBitcoinCoreRpcPass,
} from "../config/bitcoin-core-env.js";
import { registerTool } from "./index.js";

// ─── Bitcoin Core getmempoolinfo result shape ─────────────────────────────────

interface GetMempoolInfoResult {
  loaded: boolean;
  size: number;
  bytes: number;
  usage: number;
  maxmempool: number;
  mempoolminfee: number;
  minrelaytxfee: number;
  unbroadcastcount: number;
  // Index signature absorbs any extra fields (including LTC MWEB fields when
  // this type is reused in get_litecoin_mempool_summary). RESEARCH §Pitfall 5.
  [key: string]: unknown;
}

// ─── Tool registration ────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Returns the current Bitcoin mempool census — total transaction count, total vsize (bytes), and `mempoolminfee` (the minimum fee rate Core's policy accepts for relay).",
  "Core-only — Esplora has no mempool-census endpoint.",
  "Returns `coreNotConfigured` with `esploraFallbackAvailable: false` when `BITCOIN_CORE_RPC_URL` is unset.",
  "Fee-rate histogram is NOT included (no built-in histogram in `getmempoolinfo`; PR #21422 closed without merge).",
  "Use this when the agent needs to detect mempool spikes for incident-report aggregation or to choose a fee rate above the relay floor.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_btc_mempool_summary", DESCRIPTION, INPUT_SCHEMA, async () => {
  const coreUrl = getBitcoinCoreRpcUrl();

  if (coreUrl === null) {
    return {
      content: [
        {
          type: "text",
          text: "Bitcoin Core RPC not configured — set BITCOIN_CORE_RPC_URL to enable mempool forensics (Esplora does not expose full mempool census)",
        },
      ],
      structuredContent: {
        status: "core-not-configured",
        message:
          "Set BITCOIN_CORE_RPC_URL to enable mempool forensics (Esplora does not expose full mempool census)",
        esploraFallbackAvailable: false,
      },
    };
  }

  const user = getBitcoinCoreRpcUser();
  const pass = getBitcoinCoreRpcPass();

  // PITFALL-6 DEFENSE: call getmempoolinfo ONLY — never getrawmempool.
  // getrawmempool(verbose=true) can return tens of MB on a production node.
  const result = await callBitcoinCoreRpc<GetMempoolInfoResult>(
    coreUrl,
    user,
    pass,
    "getmempoolinfo",
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
          text: `Bitcoin Core RPC error (getmempoolinfo): ${errorCode} — ${message}`,
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

  const r = result.result;

  const lines: string[] = [];
  lines.push("Bitcoin mempool summary (getmempoolinfo, source: bitcoin-core)");
  lines.push(`  size: ${r.size} txs`);
  lines.push(`  bytes: ${r.bytes}`);
  lines.push(`  mempoolminfee: ${r.mempoolminfee}`);
  lines.push(`  minrelaytxfee: ${r.minrelaytxfee}`);
  lines.push(`  maxmempool: ${r.maxmempool}`);
  lines.push(`  unbroadcastcount: ${r.unbroadcastcount}`);
  lines.push(`  feeHistogram: not-available-without-getrawmempool`);
  lines.push(`  source: bitcoin-core`);

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    structuredContent: {
      status: "ok",
      size: r.size,
      bytes: r.bytes,
      mempoolminfee: r.mempoolminfee,
      minrelaytxfee: r.minrelaytxfee,
      maxmempool: r.maxmempool,
      unbroadcastcount: r.unbroadcastcount,
      feeHistogram: "not-available-without-getrawmempool" as const,
      source: "bitcoin-core",
    },
  };
});
