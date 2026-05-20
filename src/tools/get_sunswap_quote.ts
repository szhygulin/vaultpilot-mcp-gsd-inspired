// MCP tool: get_sunswap_quote({ inputToken, outputToken, amount, slippageBps? })
//
// Phase 20 — Plan 20-01 (TRON-W-09). Read-only quote from SunSwap V2 on TRON.
//
// D-01a/c: NEVER-throws contract; returns `Quote | null` from `fetchSunswapQuote`.
//   Quote-not-available → `INTERNAL_ERROR` with cause "SunSwap quote unavailable".
// D-01b: Quote computed on-chain via `router.getAmountsOut(amountIn, path)`.
// D-01c: `Quote.source` is always "live" (on-chain truth; no fallback snapshot).
//
// Per CLAUDE.md decimal-aware arithmetic: `inAmount` + `outAmount` are bigint
//   internally; serialized as decimal strings at the agent boundary (structuredContent).
// Per CLAUDE.md "tool descriptions are agent routing prompts": description names
//   exactly when to use this tool and what it returns.

import { utils as tronUtils } from "tronweb";

import { _sunswapClient } from "../clients/sunswap.js";
import {
  InvalidAmountError,
  parseTronAmountStrict,
} from "../signing/amount-tron.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { findByAddress } from "../tokens/tron-top-25.js";
import { registerTool } from "./index.js";

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<
    string,
    unknown
  > &
    StructuredError;
}

// ============================================================================
// Description + Input Schema
// ============================================================================

const DESCRIPTION = [
  "Get a SunSwap V2 quote on TRON for a token swap.",
  "Returns the expected output amount, price impact (basis points), route, and slippage tolerance.",
  "Quote source is always 'live' (on-chain getAmountsOut via TronGrid — no fallback snapshot).",
  "Use before prepare_sunswap_swap to get priceImpactBps and decide whether to explicitly supply slippageBps.",
  "When priceImpactBps > 200 (2%), you MUST pass slippageBps explicitly to prepare_sunswap_swap (sandwich-MEV defense per D-03b).",
  "`inputToken` and `outputToken` MUST be valid TRON base58check addresses (T-prefixed, 34 chars).",
  "`amount` is a DECIMAL STRING in human units (e.g. '100.5' for 100.5 USDT).",
  "`slippageBps` defaults to 50 (0.5%). Acceptable range: 0–10000 (0%–100%).",
  "Returns { inAmount, outAmount, route, priceImpactBps, slippageBps, source } verbatim from the SunSwap V2 router.",
  "Failure modes: INVALID_INPUT (addresses malformed, amount malformed, or token not in tron-top-25 registry) / INTERNAL_ERROR (RPC failure or pair not found).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    inputToken: {
      type: "string",
      description:
        "Input TRC-20 token contract address (TRON base58check T-prefixed, 34 chars). Example: \"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t\" (USDT-TRC20).",
    },
    outputToken: {
      type: "string",
      description:
        "Output TRC-20 token contract address (TRON base58check T-prefixed, 34 chars). Example: \"TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR\" (WTRX).",
    },
    amount: {
      type: "string",
      description:
        "Input amount in HUMAN UNITS as a decimal string (e.g. \"1\" for 1 USDT; server resolves decimals via tron-top-25 registry).",
    },
    slippageBps: {
      type: "number",
      description:
        "Slippage tolerance in basis points (integer, 0–10000). Default: 50 (0.5%). This value is included in the returned quote for use in prepare_sunswap_swap.",
    },
  },
  required: ["inputToken", "outputToken", "amount"],
  additionalProperties: false,
};

// ============================================================================
// Tool registration
// ============================================================================

registerTool(
  "get_sunswap_quote",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawInputToken =
        typeof args.inputToken === "string" ? args.inputToken : "";
      const rawOutputToken =
        typeof args.outputToken === "string" ? args.outputToken : "";
      const rawAmount =
        typeof args.amount === "string" ? args.amount : "";
      const rawSlippageBps =
        typeof args.slippageBps === "number" ? args.slippageBps : 50;

      // -----------------------------------------------------------------------
      // Step 1: Address validation — FIRES FIRST.
      // -----------------------------------------------------------------------
      if (!tronUtils.address.isAddress(rawInputToken)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'inputToken': expected a valid TRON base58check address (T-prefixed, 34 chars), got "${rawInputToken}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'inputToken': "${rawInputToken}" is not a valid TRON base58check address`,
            "inputToken",
          ),
        };
      }

      if (!tronUtils.address.isAddress(rawOutputToken)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'outputToken': expected a valid TRON base58check address (T-prefixed, 34 chars), got "${rawOutputToken}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'outputToken': "${rawOutputToken}" is not a valid TRON base58check address`,
            "outputToken",
          ),
        };
      }

      // Validate slippageBps range
      if (
        !Number.isInteger(rawSlippageBps) ||
        rawSlippageBps < 0 ||
        rawSlippageBps > 10000
      ) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'slippageBps': expected an integer in [0, 10000], got ${rawSlippageBps}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'slippageBps': ${rawSlippageBps} is not an integer in [0, 10000]`,
            "slippageBps",
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 2: Token metadata lookup for input token decimals.
      // -----------------------------------------------------------------------
      const inputMetadata = findByAddress(rawInputToken);
      if (!inputMetadata) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: token not found in tron-top-25 registry for inputToken "${rawInputToken}". ` +
                "Phase 20 get_sunswap_quote supports tokens in the tron-top-25 registry.",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `token not found in tron-top-25 registry: inputToken "${rawInputToken}"`,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 3: Amount parsing — decimal-aware per CLAUDE.md.
      // -----------------------------------------------------------------------
      let inAmount: bigint;
      try {
        inAmount = parseTronAmountStrict(rawAmount, inputMetadata.decimals, "u256");
      } catch (err) {
        if (err instanceof InvalidAmountError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: invalid 'amount': ${err.message}`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid 'amount': ${err.message}`,
              err.kind,
            ),
          };
        }
        throw err;
      }

      // -----------------------------------------------------------------------
      // Step 4: Fetch quote via _sunswapClient (NEVER-throws per D-01a).
      // Path computation server-side (direct OR hop-through-WTRX).
      // -----------------------------------------------------------------------
      const quote = await _sunswapClient.fetchSunswapQuote({
        inputToken: rawInputToken,
        outputToken: rawOutputToken,
        amount: inAmount,
        slippageBps: rawSlippageBps,
      });

      if (quote === null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: SunSwap quote unavailable — RPC failure or pair not found. " +
                "Check that both tokens have a SunSwap V2 liquidity pool and TronGrid is reachable.",
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            "SunSwap quote unavailable (RPC failure or pair not found)",
            "SunSwap quote unavailable — RPC failure or pair not found",
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 5: Return Quote shape. bigint → string at agent boundary per CLAUDE.md.
      // -----------------------------------------------------------------------
      const responseText = [
        "SUNSWAP V2 QUOTE (TRON)",
        `  inputToken:     ${rawInputToken}`,
        `  outputToken:    ${rawOutputToken}`,
        `  inAmount:       ${quote.inAmount.toString()} (raw, scaled per input token decimals)`,
        `  outAmount:      ${quote.outAmount.toString()} (raw, scaled per output token decimals)`,
        `  priceImpactBps: ${quote.priceImpactBps} (${(quote.priceImpactBps / 100).toFixed(2)}%)`,
        `  slippageBps:    ${quote.slippageBps}`,
        `  route:          ${quote.route.join(" → ")}`,
        `  source:         ${quote.source}`,
        "",
        quote.priceImpactBps > 200
          ? `⚠ Price impact (${(quote.priceImpactBps / 100).toFixed(2)}%) exceeds 2% sandwich-MEV threshold. ` +
            "Pass slippageBps explicitly to prepare_sunswap_swap to confirm acceptance."
          : "Price impact is within normal range (<= 2%).",
      ].join("\n");

      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: {
          inAmount: quote.inAmount.toString(),
          outAmount: quote.outAmount.toString(),
          route: quote.route,
          priceImpactBps: quote.priceImpactBps,
          slippageBps: quote.slippageBps,
          source: quote.source,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: get_sunswap_quote failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "get_sunswap_quote failed",
          message,
        ),
      };
    }
  },
);
