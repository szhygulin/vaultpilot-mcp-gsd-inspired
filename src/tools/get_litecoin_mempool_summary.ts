// src/tools/get_litecoin_mempool_summary.ts — Phase 27 Plan 27-02 (LTC-FORENSIC-01 / mempool).
//
// MCP tool: get_litecoin_mempool_summary({}) — returns the Litecoin mempool census.
//
// Near-verbatim clone of src/tools/get_btc_mempool_summary.ts (Task 1) parameterized
// on Litecoin Core RPC env readers.
//
// Core-only — litecoinspace.org has no mempool-census endpoint. Returns
// core-not-configured envelope with esploraFallbackAvailable: false when
// LITECOIN_CORE_RPC_URL is unset.
//
// MWEB (MimbleWimble Extension Blocks) fields: LTC Core's getmempoolinfo response
//   may include MWEB-specific fields (e.g. mweb_usage, mweb_size). These are absorbed
//   by the index signature on GetMempoolInfoResult but NOT surfaced in the response
//   (RESEARCH §Pitfall 5 — out of Phase 27 scope).
//
// RESEARCH §Pitfall 6 anchor: NEVER call getrawmempool. This tool uses getmempoolinfo ONLY.
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
import { registerTool } from "./index.js";

// ─── Litecoin Core getmempoolinfo result shape ────────────────────────────────

interface GetMempoolInfoResult {
  loaded: boolean;
  size: number;
  bytes: number;
  usage: number;
  maxmempool: number;
  mempoolminfee: number;
  minrelaytxfee: number;
  unbroadcastcount: number;
  // Index signature absorbs LTC MWEB-specific fields (e.g. mweb_usage, mweb_size)
  // without TypeScript strict-mode breakage (RESEARCH §Pitfall 5 — MWEB fields
  // absorbed but NOT surfaced in the response).
  [key: string]: unknown;
}

// ─── Tool registration ────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Returns the current Litecoin mempool census — total transaction count + total vsize + `mempoolminfee`.",
  "Core-only — litecoinspace.org has no mempool-census endpoint.",
  "Returns `coreNotConfigured` envelope when `LITECOIN_CORE_RPC_URL` is unset.",
  "MWEB (MimbleWimble Extension Blocks) fields in the mempool entry are absorbed via the response-type index signature but NOT surfaced (RESEARCH §Pitfall 5 — out of Phase 27 scope).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool(
  "get_litecoin_mempool_summary",
  DESCRIPTION,
  INPUT_SCHEMA,
  async () => {
    const coreUrl = getLitecoinCoreRpcUrl();

    if (coreUrl === null) {
      return {
        content: [
          {
            type: "text",
            text: "Litecoin Core RPC not configured — set LITECOIN_CORE_RPC_URL to enable mempool forensics (litecoinspace.org does not expose full mempool census)",
          },
        ],
        structuredContent: {
          status: "core-not-configured",
          message:
            "Set LITECOIN_CORE_RPC_URL to enable mempool forensics (litecoinspace.org does not expose full mempool census)",
          esploraFallbackAvailable: false,
        },
      };
    }

    const user = getLitecoinCoreRpcUser();
    const pass = getLitecoinCoreRpcPass();

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
          ? "LITECOIN_CORE_RPC_ERROR"
          : result.kind === "rate-limited"
            ? "LITECOIN_CORE_RATE_LIMITED"
            : "LITECOIN_CORE_NETWORK_ERROR";
      const message =
        result.kind !== "not-configured" ? (result.message ?? "") : "";

      return {
        content: [
          {
            type: "text",
            text: `Litecoin Core RPC error (getmempoolinfo): ${errorCode} — ${message}`,
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

    // MWEB field exclusion: only the standard fields are surfaced.
    // r.mweb_usage, r.mweb_size etc. are absorbed by [key: string]: unknown
    // and intentionally not forwarded (RESEARCH §Pitfall 5).
    const lines: string[] = [];
    lines.push("Litecoin mempool summary (getmempoolinfo, source: litecoin-core)");
    lines.push(`  size: ${r.size} txs`);
    lines.push(`  bytes: ${r.bytes}`);
    lines.push(`  mempoolminfee: ${r.mempoolminfee}`);
    lines.push(`  minrelaytxfee: ${r.minrelaytxfee}`);
    lines.push(`  maxmempool: ${r.maxmempool}`);
    lines.push(`  unbroadcastcount: ${r.unbroadcastcount}`);
    lines.push(`  feeHistogram: not-available-without-getrawmempool`);
    lines.push(`  source: litecoin-core`);

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
        source: "litecoin-core",
      },
    };
  },
);
