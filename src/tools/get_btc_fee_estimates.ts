// src/tools/get_btc_fee_estimates.ts — Phase 22 Plan 22-03 Task 2
// (BTC-READ-05).
//
// MCP tool — projects Esplora's 24-key `/fee-estimates` response to the
// standard 5-target shape `{ "1", "2", "3", "6", "144" }` per ROADMAP
// SC #7. Values are sat/vB (satoshis-per-virtual-byte), preserved
// verbatim from Esplora.
//
// Anti-pattern (RESEARCH § Plan 22-03 risks): do NOT hit
// mempool.space's `/v1/fees/recommended` proprietary path — the
// canonical endpoint is Esplora-standard `/fee-estimates`, and
// mempool.space mirrors it at `/api/fee-estimates` with the same
// 24-key shape. The chain-shelf `fetchFeeEstimates` already enforces
// this by hitting `/fee-estimates`; this tool layers projection only.
//
// Locked errorCode set:
//   - ESPLORA_RATE_LIMITED — 429.
//   - ESPLORA_ERROR — 5xx / timeout / parse failure / missing keys.

import { fetchFeeEstimates } from "../chains/bitcoin/esplora-client.js";
import { registerTool } from "./index.js";

const TARGET_KEYS = ["1", "2", "3", "6", "144"] as const;

const DESCRIPTION = [
  "Returns the current sat/vB fee estimates for 1, 2, 3, 6, and 144 block confirmation targets.",
  "Use this BEFORE preparing a BTC send to suggest a fee rate.",
  "Sat/vB is satoshis-per-virtual-byte; multiply by tx vsize (Phase 23 will surface this) to get total fee in sats.",
  "Public Esplora endpoint (no API key); user may override `BTC_ESPLORA_URL` to mempool.space or self-hosted Esplora.",
  "Values projected from Esplora's 24-key /fee-estimates response to the standard 5-target shape per ROADMAP SC #7.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_btc_fee_estimates", DESCRIPTION, INPUT_SCHEMA, async () => {
  const result = await fetchFeeEstimates();

  if (result.kind === "rate-limited") {
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${result.message}` }],
      structuredContent: {
        errorCode: "ESPLORA_RATE_LIMITED",
        message: result.message,
      },
    };
  }

  if (
    result.kind === "error" ||
    result.kind === "not-applicable" ||
    result.kind === "not-found"
  ) {
    const message =
      result.kind === "error"
        ? result.message
        : `Esplora /fee-estimates returned kind:${result.kind}`;
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: { errorCode: "ESPLORA_ERROR", message },
    };
  }

  // result.kind === "ok" — project 24-key to 5-key shape.
  const feeEstimates: Record<string, number> = {};
  const missing: string[] = [];
  for (const key of TARGET_KEYS) {
    const v = result.estimates[key];
    if (typeof v === "number") {
      feeEstimates[key] = v;
    } else {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    const message = `Esplora /fee-estimates missing required keys: ${missing.join(", ")}`;
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: { errorCode: "ESPLORA_ERROR", message },
    };
  }

  const summary = TARGET_KEYS.map((k) => `${k}-block: ${feeEstimates[k]} sat/vB`).join(", ");

  return {
    content: [{ type: "text", text: summary }],
    structuredContent: {
      feeEstimates,
      units: "sat/vB",
    },
  };
});
