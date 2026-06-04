// src/tools/get_jupiter_quote.ts
//
// MCP tool: get_jupiter_quote — Phase 14 Plan 14-01 (SOL-W-11).
//
// Read-only Jupiter v6 quote on Solana mainnet-beta. Returns the v6 quote
// envelope (inAmount / outAmount / otherAmountThreshold / priceImpactPct /
// slippageBps / routePlan) via the never-throws `src/clients/jupiter.ts` client
// (always sends asLegacyTransaction:true — FROZEN-compat).
//
// Sandwich-MEV posture (SOL-W-13, WARNING-at-quote half):
//   - Solana is single-cluster — a SINGLE { defaultSlippageBps: 50,
//     priceImpactRefusalPct: 2.0 } constant, mirroring the EVM ethereum-arm SOT.
//     Do NOT import the per-chain EVM `sandwich-mev-thresholds.ts` map (keyed on
//     ChainId; Solana has no EVM ChainId).
//   - priceImpactPct is a STRING FRACTION (e.g. "0.025" = 2.5%), NOT bps — compute
//     percent as `Number(priceImpactPct) * 100` (Pitfall 2). When > 2.0% emit a
//     sandwich-MEV WARNING block (the hard REFUSAL lives in prepare_jupiter_swap,
//     14-02 — WARNING here, REFUSAL there; mirror the get-uniswap-quote D-08 posture).
//   - ALWAYS emit an [AGENT TASK] price-impact recheck line (RESEARCH Pattern 3 —
//     impact moves with pool state; re-fetch the quote before the user confirms).

import { _jupiter } from "../clients/jupiter.js";
import {
  type ErrorCode,
  makeStructuredError,
} from "../signing/error-codes.js";
import { registerTool } from "./index.js";

// Solana single-cluster sandwich-MEV constant — mirror of the EVM ethereum-arm
// { defaultSlippageBps: 50, priceImpactRefusalPct: 2.0 } SOT (NOT the per-chain map).
const SOLANA_DEFAULT_SLIPPAGE_BPS = 50;
const SOLANA_PRICE_IMPACT_REFUSAL_PCT = 2.0;

const BASE58_PUBKEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function errEnvelope(code: ErrorCode, message: string, cause?: string): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown>;
}

function refusal(code: ErrorCode, message: string, cause?: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `error: ${message}` }],
    structuredContent: errEnvelope(code, message, cause),
  };
}

const DESCRIPTION = [
  "Get a Jupiter v6 aggregator quote on Solana mainnet-beta for a token swap.",
  "Returns the expected output amount, minimum-out threshold (after slippage), price impact, slippage tolerance, and the route plan (which DEX pools Jupiter routes through).",
  "Use BEFORE prepare_jupiter_swap to read the price impact and decide whether to explicitly supply slippageBps.",
  "When the price impact exceeds 2%, you MUST pass slippageBps explicitly to prepare_jupiter_swap or it REFUSES (sandwich-MEV defense, SOL-W-13). This tool only WARNS; the hard refusal is at prepare time.",
  "`inputMint` / `outputMint` are SPL mint base58 pubkeys (e.g. SOL = So11111111111111111111111111111111111111112, USDC = EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v).",
  "`amount` is the RAW base-unit amount as a decimal string for the input mint (resolve decimals via get_solana_token_metadata first if needed).",
  "`slippageBps` is optional (integer 1–10000); defaults to 50 (0.5%).",
  "The route forces legacy-transaction compatibility (asLegacyTransaction) for hardware-wallet signing — exotic long-tail pairs may route slightly less optimally than a v0 route.",
  "Do NOT use for Ethereum DEX swaps (get_uniswap_quote / get_curve_positions) or TRON (get_sunswap_quote).",
  "Failure modes: INVALID_INPUT (malformed mint/amount/slippage), BROADCAST_FAILED (Jupiter rate-limited or HTTP/network error).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    inputMint: {
      type: "string",
      description:
        "Input SPL mint base58 pubkey (e.g. SOL = So11111111111111111111111111111111111111112).",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    outputMint: {
      type: "string",
      description:
        "Output SPL mint base58 pubkey (e.g. USDC = EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v).",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    amount: {
      type: "string",
      description:
        "RAW base-unit amount as a decimal string for the input mint (e.g. \"100000000\" for 0.1 SOL at 9 decimals).",
    },
    slippageBps: {
      type: "number",
      description:
        "Slippage tolerance in basis points (integer, 1–10000). Default: 50 (0.5%). When omitted AND price impact > 2%, prepare_jupiter_swap will REFUSE.",
    },
  },
  required: ["inputMint", "outputMint", "amount"],
  additionalProperties: false,
};

registerTool("get_jupiter_quote", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const inputMint = typeof args.inputMint === "string" ? args.inputMint : "";
    if (!BASE58_PUBKEY_REGEX.test(inputMint)) {
      return refusal("INVALID_INPUT", `invalid 'inputMint': expected base58 pubkey, got "${inputMint}"`);
    }
    const outputMint = typeof args.outputMint === "string" ? args.outputMint : "";
    if (!BASE58_PUBKEY_REGEX.test(outputMint)) {
      return refusal("INVALID_INPUT", `invalid 'outputMint': expected base58 pubkey, got "${outputMint}"`);
    }
    const amount = typeof args.amount === "string" ? args.amount : "";
    if (!/^[0-9]+$/.test(amount) || amount === "0") {
      return refusal("INVALID_INPUT", `invalid 'amount': expected a positive base-unit integer string, got "${amount}"`);
    }

    let slippageBps: number;
    if (args.slippageBps === undefined) {
      slippageBps = SOLANA_DEFAULT_SLIPPAGE_BPS;
    } else if (
      typeof args.slippageBps !== "number" ||
      !Number.isInteger(args.slippageBps) ||
      args.slippageBps < 1 ||
      args.slippageBps > 10000
    ) {
      return refusal("INVALID_INPUT", `invalid 'slippageBps': expected integer in [1, 10000], got ${String(args.slippageBps)}`);
    } else {
      slippageBps = args.slippageBps;
    }

    const result = await _jupiter.getQuote({ inputMint, outputMint, amount, slippageBps });
    if (result.kind === "rate-limited") {
      return refusal("BROADCAST_FAILED", "Jupiter quote API is rate-limited; retry shortly (set JUPITER_API_KEY for higher limits)");
    }
    if (result.kind === "error") {
      return refusal("BROADCAST_FAILED", "failed to fetch Jupiter quote", result.message);
    }

    const quote = result.quote;
    // Pitfall 2 — priceImpactPct is a STRING FRACTION; ×100 for percent.
    const impactPct = Number(quote.priceImpactPct) * 100;
    const impactExceeds = impactPct > SOLANA_PRICE_IMPACT_REFUSAL_PCT;

    const routeLabels = quote.routePlan.map((s) => s.swapInfo.label).join(" → ");

    const lines: string[] = [
      "JUPITER V6 QUOTE (Solana mainnet-beta)",
      `  inputMint:            ${quote.inputMint}`,
      `  outputMint:           ${quote.outputMint}`,
      `  inAmount:             ${quote.inAmount} (raw base units)`,
      `  outAmount:            ${quote.outAmount} (raw base units)`,
      `  otherAmountThreshold: ${quote.otherAmountThreshold} (minimum out after slippage)`,
      `  priceImpactPct:       ${impactPct.toFixed(4)}%`,
      `  slippageBps:          ${quote.slippageBps ?? slippageBps}`,
      `  route:                ${routeLabels || "(direct)"}`,
      "",
    ];

    if (impactExceeds) {
      lines.push(
        `⚠ sandwich-MEV WARNING: price impact (${impactPct.toFixed(4)}%) exceeds the ${SOLANA_PRICE_IMPACT_REFUSAL_PCT}% threshold. ` +
          "Pass slippageBps explicitly to prepare_jupiter_swap to acknowledge — otherwise it will REFUSE (SANDWICH_MEV_REFUSED).",
      );
    } else {
      lines.push(`Price impact is within normal range (<= ${SOLANA_PRICE_IMPACT_REFUSAL_PCT}%).`);
    }

    // RESEARCH Pattern 3 — ALWAYS emit the recheck instruction (impact moves with
    // pool state; the agent re-fetches before the user confirms).
    lines.push(
      "[AGENT TASK] Re-fetch this quote (call get_jupiter_quote again) immediately before asking the user to confirm — Solana price impact drifts with pool state between quote and signature.",
    );

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        otherAmountThreshold: quote.otherAmountThreshold,
        priceImpactPct: quote.priceImpactPct,
        priceImpactPercent: impactPct,
        slippageBps: quote.slippageBps ?? slippageBps,
        routePlan: quote.routePlan,
        sandwichMevWarning: impactExceeds,
        source: "jupiter-v6",
        chain: "solana",
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return refusal("INTERNAL_ERROR", "get_jupiter_quote failed", message);
  }
});
