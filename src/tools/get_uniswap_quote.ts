// src/tools/get_uniswap_quote.ts
//
// MCP tool: get_uniswap_quote — Phase 32 Plan 32-02 (UNI-01).
//
// Read-only Uniswap V3 quote on Ethereum mainnet. Auto-fee-tier selection
// across 4 standard tiers (100 / 500 / 3000 / 10000) + canonical-mapped
// multi-hop candidates (WETH / USDC anchors per RESEARCH § Topic 10) +
// Quoter-midpoint price-impact computation (D-04b).
//
// Returns the standard quote envelope cloned from Phase 20 SunSwap shape with
// EVM-specific fields:
//   {
//     inputToken, outputToken,
//     inAmount, outAmount,             (decimal strings — CLAUDE.md decimal-at-boundary)
//     fee?, route,                     (fee on single-hop only; route always present)
//     priceImpactBps, slippageBps,
//     source: "uniswap-v3-quoter-v2",
//     chain: "ethereum", chainId: 1,
//   }
//
// Per CONTEXT.md:
//   D-04   — auto-fee-tier (single-hop max + multi-hop with 0.5% improvement threshold)
//   D-04a  — no-liquidity refusal via INVALID_INPUT + hintTool: "request_capability"
//   D-04b  — Quoter-midpoint price-impact (tiny-amount fair reference)
//   D-05   — ETH-in/ETH-out sentinel resolution to WETH; same-token-swap refused
//   D-06   — default slippageBps = 50 (0.5%); bounds 1..10000
//   D-08   — sandwich-MEV WARNING at priceImpactBps > 200 (REFUSAL block lives
//            in Plan 32-03 prepare time, NOT here at quote time)
//   D-16   — decimal-aware amount at agent boundary (parseAmountStrict)
//
// Per CLAUDE.md "tool descriptions are agent routing prompts": DESCRIPTION
// states when to use vs not (route to prepare_uniswap_swap next; do NOT use
// for non-Ethereum chains or non-Uniswap DEXes).

import {
  type Address,
  type PublicClient,
  erc20Abi,
  formatUnits,
  getAddress,
  isAddress,
} from "viem";

import { _uniswapV3Chain } from "../chains/uniswap-v3.js";
import { getChainClient } from "../chains/registry.js";
import { getUniswapV3QuoterV2Address } from "../config/contracts.js";
import {
  InvalidAmountError,
  parseAmountStrict,
} from "../signing/amount.js";
import {
  type ErrorCode,
  makeStructuredError,
} from "../signing/error-codes.js";
import { registerTool } from "./index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WETH_ETHEREUM: Address = getAddress(
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
);

/** D-06 default slippage when agent omits the field. */
const DEFAULT_SLIPPAGE_BPS = 50;

/** D-08 sandwich-MEV WARNING threshold (2.00%). */
const SANDWICH_MEV_WARNING_THRESHOLD_BPS = 200;

/** Quote envelope source-field literal — pinned per Plan 32-02 verified_values. */
const QUOTE_SOURCE = "uniswap-v3-quoter-v2";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errEnvelope(
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { ...makeStructuredError(code, message), ...(extra ?? {}) };
}

function refusal(
  code: ErrorCode,
  message: string,
  extra?: Record<string, unknown>,
) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `error: ${message}` }],
    structuredContent: errEnvelope(code, message, extra),
  };
}

// Lazy decimals resolution — agent input may be the "ETH" sentinel (decimals
// 18; WETH-equivalent at the protocol layer) OR an EIP-55 address.
async function resolveDecimals(
  client: PublicClient,
  tokenAddr: Address,
  isEthSentinel: boolean,
): Promise<number> {
  if (isEthSentinel) {
    // ETH sentinel resolves to WETH (18 decimals) per D-05.
    return 18;
  }
  const decimals = (await client.readContract({
    address: tokenAddr,
    abi: erc20Abi,
    functionName: "decimals",
  })) as number;
  return decimals;
}

// ---------------------------------------------------------------------------
// Description + Input Schema
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  "Get a Uniswap V3 quote on Ethereum mainnet for a token swap.",
  "Returns the expected output amount, auto-selected fee tier (best of 0.01% / 0.05% / 0.30% / 1.00% pools), route (single-hop or multi-hop via WETH/USDC anchor), price impact (basis points), and slippage tolerance.",
  "Quote source is always 'uniswap-v3-quoter-v2' (on-chain readContract via the Quoter V2 contract — no fallback snapshot).",
  "Use before prepare_uniswap_swap to get priceImpactBps and decide whether to explicitly supply slippageBps.",
  "When priceImpactBps > 200 (2%), you MUST pass slippageBps explicitly to prepare_uniswap_swap (sandwich-MEV defense per D-08).",
  "Native ETH supported via tokenIn or tokenOut = 'ETH' sentinel; server resolves to WETH internally for the Quoter call but echoes 'ETH' back in the envelope inputToken/outputToken.",
  "Phase 32: Ethereum mainnet only. Other EVM chains coming in v2.5+ via Phase 8 multi-chain surface.",
  "Failure modes: INVALID_INPUT (chain not ethereum, malformed tokenIn/tokenOut, same-token-swap, decimal-overflow, slippageBps out of bounds, no Uniswap V3 liquidity at any standard fee tier with hintTool: 'request_capability'); INTERNAL_ERROR (RPC failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier. Phase 32 supports 'ethereum' only. Other chains refuse with INVALID_INPUT.",
    },
    tokenIn: {
      type: "string",
      description:
        "Input token: EIP-55 address (0x + 40 hex) OR the literal 'ETH' sentinel (server resolves to WETH for the Quoter call; transaction will carry msg.value at prepare time).",
    },
    tokenOut: {
      type: "string",
      description:
        "Output token: EIP-55 address (0x + 40 hex) OR the literal 'ETH' sentinel (server uses WETH internally and wraps the swap in multicall + unwrapWETH9 at prepare time).",
    },
    amount: {
      type: "string",
      description:
        "Input amount in HUMAN UNITS as a decimal string (e.g. '100' or '100.5'). Server resolves tokenIn decimals via ERC-20 decimals readContract (18 for ETH/WETH sentinel).",
    },
    slippageBps: {
      type: "number",
      description:
        "Slippage tolerance in basis points (integer, 1–10000). Default: 50 (0.5%). When omitted AND priceImpactBps > 200, prepare_uniswap_swap will REFUSE (sandwich-MEV gate).",
    },
  },
  required: ["chain", "tokenIn", "tokenOut", "amount"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

registerTool(
  "get_uniswap_quote",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // Step 1 — Chain validation (defense-in-depth; the schema enum gates
      // most cases).
      const chainRaw = typeof args.chain === "string" ? args.chain : "";
      if (chainRaw !== "ethereum") {
        return refusal(
          "INVALID_INPUT",
          "chain must be 'ethereum' (Phase 32 is Ethereum-mainnet-only)",
        );
      }

      // Step 2 — Token sentinel handling + EIP-55 validation.
      const tokenInRaw =
        typeof args.tokenIn === "string" ? args.tokenIn : "";
      const tokenOutRaw =
        typeof args.tokenOut === "string" ? args.tokenOut : "";

      const tokenInIsEth = tokenInRaw === "ETH";
      const tokenOutIsEth = tokenOutRaw === "ETH";

      if (!tokenInIsEth && !isAddress(tokenInRaw)) {
        return refusal(
          "INVALID_INPUT",
          `invalid tokenIn: expected EIP-55 address or 'ETH', got "${tokenInRaw}"`,
        );
      }
      if (!tokenOutIsEth && !isAddress(tokenOutRaw)) {
        return refusal(
          "INVALID_INPUT",
          `invalid tokenOut: expected EIP-55 address or 'ETH', got "${tokenOutRaw}"`,
        );
      }

      const tokenInAddr: Address = tokenInIsEth
        ? WETH_ETHEREUM
        : getAddress(tokenInRaw);
      const tokenOutAddr: Address = tokenOutIsEth
        ? WETH_ETHEREUM
        : getAddress(tokenOutRaw);

      // Step 3 — Same-token-swap refusal (after sentinel resolution per D-05).
      // ETH↔ETH or address↔ETH where address is WETH both collapse to WETH↔WETH.
      if (tokenInAddr === tokenOutAddr) {
        return refusal(
          "INVALID_INPUT",
          "same-token-swap refused: tokenIn and tokenOut resolve to the same address (ETH/WETH or address equivalence)",
          { cause: "same-token-swap-refused" },
        );
      }

      // Step 4 — slippageBps bounds (1..10000); default 50 when omitted.
      let slippageBps: number;
      if (args.slippageBps === undefined) {
        slippageBps = DEFAULT_SLIPPAGE_BPS;
      } else if (
        typeof args.slippageBps !== "number" ||
        !Number.isInteger(args.slippageBps) ||
        args.slippageBps < 1 ||
        args.slippageBps > 10000
      ) {
        return refusal(
          "INVALID_INPUT",
          `invalid slippageBps: expected integer in [1, 10000], got ${args.slippageBps}`,
        );
      } else {
        slippageBps = args.slippageBps;
      }

      // Step 5 — Resolve decimals + parse amount (decimal-strict per D-16).
      const client = getChainClient(1);
      let decimals: number;
      try {
        decimals = await resolveDecimals(client, tokenInAddr, tokenInIsEth);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        return refusal(
          "INTERNAL_ERROR",
          `failed to resolve tokenIn decimals: ${message}`,
        );
      }

      const rawAmount = typeof args.amount === "string" ? args.amount : "";
      let amountIn: bigint;
      try {
        amountIn = parseAmountStrict(rawAmount, decimals);
      } catch (err) {
        if (err instanceof InvalidAmountError) {
          return refusal(
            "INVALID_INPUT",
            `invalid amount: ${err.message}`,
            { cause: err.kind },
          );
        }
        throw err;
      }

      if (amountIn <= 0n) {
        return refusal(
          "INVALID_INPUT",
          `invalid amount: must be > 0, got "${rawAmount}"`,
        );
      }

      // Step 6 — Defensive Quoter V2 SOT presence check (D-13a — Phase 32
      // Ethereum slot is populated; null here indicates SOT corruption).
      const quoterV2 = getUniswapV3QuoterV2Address(1);
      if (quoterV2 === null) {
        return refusal(
          "INTERNAL_ERROR",
          "Quoter V2 address unavailable from SOT (src/config/contracts.ts)",
        );
      }

      // Step 7 — Run quote primitives in parallel.
      //
      // tinyAmount: amountIn / 10000n per RESEARCH § Topic 5; sub-base-unit
      // fallback at the CALLER level — when tinyAmount === 0n we fall back to
      // amountIn itself (the fair-price reference IS the spot price; impact
      // reads as ~0 for sub-base-unit amounts).
      let tinyAmount = amountIn / 10000n;
      let tinyScaleFactor = 10000n;
      if (tinyAmount === 0n) {
        tinyAmount = amountIn;
        tinyScaleFactor = 1n;
      }

      const [singleHopResults, multiHopResults, tinySingleHopResults] =
        await Promise.all([
          _uniswapV3Chain.quoteAllSingleHopFeeTiers(client, {
            tokenIn: tokenInAddr,
            tokenOut: tokenOutAddr,
            amountIn,
          }),
          _uniswapV3Chain.quoteMultiHopCandidates(client, {
            tokenIn: tokenInAddr,
            tokenOut: tokenOutAddr,
            amountIn,
          }),
          _uniswapV3Chain.quoteAllSingleHopFeeTiers(client, {
            tokenIn: tokenInAddr,
            tokenOut: tokenOutAddr,
            amountIn: tinyAmount,
          }),
        ]);

      // Step 8 — Select best single-hop.
      let bestSingleHop: { fee: 100 | 500 | 3000 | 10000; amountOut: bigint } | null =
        null;
      for (const r of singleHopResults) {
        if (r !== null && (bestSingleHop === null || r.amountOut > bestSingleHop.amountOut)) {
          bestSingleHop = r;
        }
      }

      // Step 9 — Select best multi-hop.
      let bestMultiHop: (typeof multiHopResults)[number] = null;
      for (const r of multiHopResults) {
        if (r !== null && (bestMultiHop === null || r.amountOut > bestMultiHop.amountOut)) {
          bestMultiHop = r;
        }
      }

      // Step 10 — D-04a no-liquidity refusal: all single-hop tiers AND all
      // multi-hop candidates reverted. Use INVALID_INPUT + hintTool:
      // "request_capability" to keep the 21-code errorCode union FROZEN.
      if (bestSingleHop === null && bestMultiHop === null) {
        const tokenInLabel = tokenInIsEth ? "ETH" : tokenInAddr;
        const tokenOutLabel = tokenOutIsEth ? "ETH" : tokenOutAddr;
        const msg = `no Uniswap V3 liquidity for ${tokenInLabel}↔${tokenOutLabel} at any standard fee tier; try a different DEX or check token symbols`;
        return refusal("INVALID_INPUT", msg, {
          hintTool: "request_capability",
          cause: "no-uniswap-v3-liquidity",
        });
      }

      // Step 11 — D-04 step 4: 0.5% improvement threshold for multi-hop wins.
      // Edge case: when bestSingleHop is null (no single-hop liquidity at any
      // tier) but bestMultiHop is non-null, multi-hop wins unconditionally.
      let useMultiHop = false;
      if (bestMultiHop !== null) {
        if (bestSingleHop === null) {
          useMultiHop = true;
        } else {
          // multi-hop wins only if multiHopOut * 1000n > singleHopOut * 1005n
          // (multi-hop beats single-hop by > 0.5%).
          useMultiHop =
            bestMultiHop.amountOut * 1000n > bestSingleHop.amountOut * 1005n;
        }
      }

      // Step 12 — Compute price impact via Quoter-midpoint method (D-04b).
      // The fair-price reference is the best tiny-amount Quoter output scaled
      // back. If all tiny-amount tiers reverted, fairOut = 0n (degenerate;
      // computePriceImpactBps returns 10000 — conservative).
      let bestTinyOut = 0n;
      for (const r of tinySingleHopResults) {
        if (r !== null && r.amountOut > bestTinyOut) {
          bestTinyOut = r.amountOut;
        }
      }
      const fairOut = bestTinyOut * tinyScaleFactor;
      const actualOut = useMultiHop
        ? bestMultiHop!.amountOut
        : bestSingleHop!.amountOut;

      // Import the spy-affordance object to keep test interception possible.
      const { _uniswapV3PriceImpact } = await import(
        "../signing/uniswap-price-impact.js"
      );
      const priceImpactBps = _uniswapV3PriceImpact.computePriceImpactBps({
        fairOut,
        actualOut,
      });

      // Step 13 — Build the route descriptor.
      const inputTokenEcho = tokenInIsEth ? "ETH" : tokenInAddr;
      const outputTokenEcho = tokenOutIsEth ? "ETH" : tokenOutAddr;

      let routeHops:
        | Array<{ tokenIn: string; fee: 100 | 500 | 3000 | 10000; tokenOut: string }>;
      let strategy: "single-hop" | "multi-hop";
      let feeForEnvelope: 100 | 500 | 3000 | 10000 | undefined;
      if (useMultiHop) {
        strategy = "multi-hop";
        routeHops = bestMultiHop!.path.map((h) => ({
          tokenIn: h.tokenIn,
          fee: h.fee,
          tokenOut: h.tokenOut,
        }));
        feeForEnvelope = undefined;
      } else {
        strategy = "single-hop";
        feeForEnvelope = bestSingleHop!.fee;
        routeHops = [
          {
            tokenIn: tokenInAddr,
            fee: bestSingleHop!.fee,
            tokenOut: tokenOutAddr,
          },
        ];
      }

      // Step 14 — Build the text response.
      const inAmountHuman = formatUnits(amountIn, decimals);
      // outDecimals = 18 for the ETH-out sentinel; for any other token we'd
      // need a second decimals readContract — but the agent boundary returns
      // raw bigint strings, so we only format what we already know.
      const outDecimalsHint = tokenOutIsEth ? 18 : null;
      const outAmountHuman =
        outDecimalsHint !== null
          ? formatUnits(actualOut, outDecimalsHint)
          : actualOut.toString();

      const lines: string[] = [
        "UNISWAP V3 QUOTE (Ethereum mainnet)",
        `  inputToken:     ${inputTokenEcho}${tokenInIsEth ? " (resolved to WETH for Quoter call)" : ""}`,
        `  outputToken:    ${outputTokenEcho}${tokenOutIsEth ? " (resolved to WETH for Quoter call)" : ""}`,
        `  inAmount:       ${amountIn.toString()} (${inAmountHuman} ${tokenInIsEth ? "ETH" : "raw, scaled per input token decimals"})`,
        `  outAmount:      ${actualOut.toString()} (${outAmountHuman}${tokenOutIsEth ? " ETH" : " — raw, scaled per output token decimals"})`,
      ];
      if (strategy === "single-hop") {
        lines.push(
          `  fee:            ${feeForEnvelope} (${((feeForEnvelope ?? 0) / 10000).toFixed(2)}%)`,
        );
        lines.push(
          `  route:          ${routeHops[0]!.tokenIn} → ${feeForEnvelope} → ${routeHops[0]!.tokenOut}`,
        );
      } else {
        const routeText = routeHops
          .map((h, i) => (i === 0 ? `${h.tokenIn} → ${h.fee} → ${h.tokenOut}` : `→ ${h.fee} → ${h.tokenOut}`))
          .join(" ");
        lines.push(`  strategy:       multi-hop`);
        lines.push(`  route:          ${routeText}`);
      }
      lines.push(
        `  priceImpactBps: ${priceImpactBps} (${(priceImpactBps / 100).toFixed(2)}%)`,
        `  slippageBps:    ${slippageBps}`,
        `  source:         ${QUOTE_SOURCE}`,
        "",
      );

      // Step 15 — D-08 sandwich-MEV WARNING (NOT refusal — that lives at
      // prepare time in Plan 32-03).
      if (priceImpactBps > SANDWICH_MEV_WARNING_THRESHOLD_BPS) {
        lines.push(
          `⚠ Price impact (${(priceImpactBps / 100).toFixed(2)}%) exceeds 2% sandwich-MEV threshold. ` +
            "Pass slippageBps explicitly to prepare_uniswap_swap to acknowledge.",
        );
      } else {
        lines.push("Price impact is within normal range (<= 2%).");
      }

      // Step 16 — Build the structured-content envelope. Decimal strings at
      // the agent boundary per CLAUDE.md decimal-aware-at-boundary rule.
      const structuredContent: Record<string, unknown> = {
        inputToken: inputTokenEcho,
        outputToken: outputTokenEcho,
        inAmount: amountIn.toString(),
        outAmount: actualOut.toString(),
        route: { hops: routeHops, strategy },
        priceImpactBps,
        slippageBps,
        source: QUOTE_SOURCE,
        chain: "ethereum",
        chainId: 1,
      };
      if (feeForEnvelope !== undefined) {
        structuredContent.fee = feeForEnvelope;
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return refusal("INTERNAL_ERROR", `get_uniswap_quote failed: ${message}`);
    }
  },
);
