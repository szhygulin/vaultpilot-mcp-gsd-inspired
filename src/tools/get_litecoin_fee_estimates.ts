// src/tools/get_litecoin_fee_estimates.ts — Phase 26 Plan 26-01 (LTC-READ-02).
//
// MCP tool — returns the standard 5-target sat/vB shape
// `{ "1", "2", "3", "6", "144" }` via litecoinspace.org.
//
// NOTE: Unlike the BTC analog which projects Esplora's 24-key
// `/fee-estimates` response, the LTC esplora-client's `fetchFeeEstimates`
// already maps litecoinspace.org's mempool.space-style
// `/v1/fees/recommended` response to the 5-key shape INTERNALLY. The
// tool's `for (const key of TARGET_KEYS)` projection loop therefore
// works unchanged — no re-mapping needed here.
//
// Locked errorCode set:
//   - ESPLORA_RATE_LIMITED — 429.
//   - ESPLORA_ERROR — 5xx / timeout / parse failure / missing keys.

import { fetchFeeEstimates } from "../chains/litecoin/esplora-client.js";
import { registerTool } from "./index.js";

const TARGET_KEYS = ["1", "2", "3", "6", "144"] as const;

const DESCRIPTION = [
  "Returns the current sat/vB fee estimates for 1, 2, 3, 6, and 144 block confirmation targets via litecoinspace.org.",
  "Use this BEFORE preparing an LTC send to suggest a fee rate.",
  "Sat/vB is satoshis-per-virtual-byte (litoshis-per-virtual-byte); multiply by tx vsize to get total fee in litoshis.",
  "Public Esplora endpoint (no API key); user may override `LITECOIN_ESPLORA_URL` to a self-hosted instance.",
  "Values mapped from litecoinspace.org's mempool.space-style /v1/fees/recommended endpoint to the standard 5-target shape.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool("get_litecoin_fee_estimates", DESCRIPTION, INPUT_SCHEMA, async () => {
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
        : `Esplora /v1/fees/recommended returned kind:${result.kind}`;
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: { errorCode: "ESPLORA_ERROR", message },
    };
  }

  // result.kind === "ok" — project to 5-key shape.
  // The LTC esplora-client already maps mempool.space → {1,2,3,6,144}
  // internally, so this loop is a passthrough-projection only.
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
    const message = `Esplora /v1/fees/recommended missing required keys: ${missing.join(", ")}`;
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
