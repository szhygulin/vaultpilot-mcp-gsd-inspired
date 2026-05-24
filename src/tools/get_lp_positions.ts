// src/tools/get_lp_positions.ts
//
// MCP tool: get_lp_positions({ wallet, chain }) — UNI-04 (Phase 33 Plan 33-01).
//
// Reader for Uniswap V3 LP positions held by `wallet` on Ethereum mainnet.
// Returns per-NFT envelope with token0/token1 + fee tier + tick range +
// inRange flag + accrued fees + IL estimate (with confidence tier).
//
// Chain narrowing: Ethereum-only (per CONTEXT.md D-03). Multi-chain LP
// (Polygon / Arbitrum / Base / Optimism) deferred to v2.4.x — same pattern
// as Phase 32 swap multi-chain deferral.
//
// [ESTIMATE] prefix discipline per D-02: IL fields are ALWAYS prefixed
// "[ESTIMATE]" in human-readable surfaces — the agent must not present these
// as precise PnL. The ilEstimateConfidence: "high" | "low" flag carries the
// tier (high = in-range exact reconstruction; low = out-of-range geometric
// midpoint fallback OR extreme asymmetric range refusal).
//
// rpcDegraded surface (READ-05 invariant): mirrors Lido / EigenLayer /
// Rocket Pool — fires `rpcDegraded: true` when isPublicNodeFallback(chainId)
// returns true so the agent can warn the user about RPC instability.

import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { _uniswapV3LpReader } from "../chains/uniswap-v3-lp.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { chainIdFromName, type ChainName } from "../config/contracts.js";
import { tickToPrice } from "../signing/uniswap-tick.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";

// ---------------------------------------------------------------------------
// Description + Input Schema
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  "Read Uniswap V3 concentrated-liquidity LP positions for a wallet on Ethereum mainnet.",
  "Supported chains: 'ethereum' only — Phase 33 ships Ethereum-only; multi-chain LP (Polygon/Arbitrum/Base/Optimism) deferred to v2.4.x.",
  "WARNING: ilEstimate fields are APPROXIMATE values prefixed [ESTIMATE] in the response. The ilEstimateConfidence flag is 'high' (in-range entry-price reconstruction) or 'low' (out-of-range geometric midpoint fallback OR extreme-asymmetric range refusal). Do not present these as precise PnL.",
  "Use when the user asks about their Uniswap V3 LP positions, accrued fees, or in-range/out-of-range status. Each position is one NFT held by the user at the NonfungiblePositionManager.",
  "Do NOT use for Uniswap V2 LP positions (different contract surface). Do NOT use for chains other than ethereum.",
  "Returns structuredContent with: chain, chainId, wallet, positions[] (each with tokenId, token0/token1, feeTier, tickLower/tickUpper, currentTick, inRange, priceLowerHuman/priceUpperHuman/currentPriceHuman, liquidity, accruedFees{amount0,amount1}, ilEstimate{raw, netOfFees, confidence}), rpcDegraded?.",
  "Failure modes: INVALID_INPUT (unsupported chain or malformed wallet address), INTERNAL_ERROR (RPC unreachable).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier. Supported at Phase 33: ethereum. Other chains refuse with INVALID_INPUT — multi-chain LP deferred to v2.4.x.",
    },
    wallet: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "EVM wallet address (EIP-55 not required; case-insensitive).",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Supported chain guard — Phase 33 Ethereum-only per CONTEXT.md D-03.
// Multi-chain LP deferred to v2.4.x.
// ---------------------------------------------------------------------------

const LP_SUPPORTED_CHAINS: ReadonlySet<string> = new Set(["ethereum"]);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

registerTool("get_lp_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // (a) Validate chain — Phase 33 ships Ethereum-only.
  const chainRaw = typeof args.chain === "string" ? args.chain : "ethereum";
  if (!LP_SUPPORTED_CHAINS.has(chainRaw)) {
    const errMsg =
      "Phase 33 ships Ethereum-only — multi-chain Uniswap V3 LP deferred to v2.4.x";
    return {
      content: [{ type: "text", text: `error: ${errMsg}` }],
      isError: true,
      structuredContent: {
        ...makeStructuredError("INVALID_INPUT", errMsg),
      },
    };
  }
  const chainName = chainRaw as ChainName;

  // (b) Validate wallet address.
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
    return {
      content: [
        {
          type: "text",
          text: "error: `wallet` must be a valid 0x-prefixed EVM address",
        },
      ],
      isError: true,
      structuredContent: {
        ...makeStructuredError(
          "INVALID_INPUT",
          "`wallet` must be a valid 0x-prefixed EVM address",
        ),
      },
    };
  }
  const wallet: Address = getAddress(walletRaw);

  // (c) Resolve chainId + client.
  const chainId = chainIdFromName(chainName);
  const client = getChainClient(chainId);

  try {
    const positions = await _uniswapV3LpReader.readUserPositions(client, wallet, chainId);

    const summaryLines: string[] = [];
    summaryLines.push("CHECKS PERFORMED:");
    summaryLines.push(
      "  [ESTIMATE] ilRaw + ilNetOfFees are APPROXIMATE values — see ilEstimateConfidence ('high'/'low') for tier.",
    );
    summaryLines.push(
      "  [ESTIMATE] confidence='low' fires for out-of-range positions OR extreme-asymmetric ranges (sqrtUpper/sqrtLower > 10).",
    );
    summaryLines.push("");
    summaryLines.push(`Uniswap V3 LP positions for ${wallet} on ${chainName}:`);
    if (positions.length === 0) {
      summaryLines.push("  (no positions found)");
    } else {
      summaryLines.push(`  ${positions.length} position(s):`);
      for (const p of positions) {
        summaryLines.push(
          `    #${p.tokenId.toString()} — token0=${p.token0} token1=${p.token1} fee=${p.fee} tick=[${p.tickLower}, ${p.tickUpper}] currentTick=${p.currentTick} inRange=${p.inRange}`,
        );
        summaryLines.push(
          `      accruedFees: amount0=${formatUnits(p.accruedFees.amount0, p.decimals0)} amount1=${formatUnits(p.accruedFees.amount1, p.decimals1)}`,
        );
        summaryLines.push(
          `      ilEstimate (confidence=${p.ilEstimate.ilEstimateConfidence}): [ESTIMATE] raw=${p.ilEstimate.ilRaw} netOfFees=${p.ilEstimate.ilNetOfFees}`,
        );
      }
    }

    const positionsOut = positions.map((p) => {
      const priceLowerHuman = tickToPrice(p.tickLower, p.decimals0, p.decimals1);
      const priceUpperHuman = tickToPrice(p.tickUpper, p.decimals0, p.decimals1);
      const currentPriceHuman = tickToPrice(p.currentTick, p.decimals0, p.decimals1);
      return {
        tokenId: p.tokenId.toString(),
        token0: p.token0,
        token1: p.token1,
        feeTier: p.fee,
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        currentTick: p.currentTick,
        inRange: p.inRange,
        priceLowerHuman,
        priceUpperHuman,
        currentPriceHuman,
        liquidity: p.liquidity.toString(),
        poolAddress: p.poolAddress,
        accruedFees: {
          amount0: p.accruedFees.amount0.toString(),
          amount1: p.accruedFees.amount1.toString(),
          amount0Human: formatUnits(p.accruedFees.amount0, p.decimals0),
          amount1Human: formatUnits(p.accruedFees.amount1, p.decimals1),
        },
        ilEstimate: {
          // [ESTIMATE] tier flag per CONTEXT.md D-02; the raw + netOfFees
          // strings are formatted-decimal (may be empty for extreme-
          // asymmetric range refusal).
          raw: p.ilEstimate.ilRaw,
          netOfFees: p.ilEstimate.ilNetOfFees,
          confidence: p.ilEstimate.ilEstimateConfidence,
        },
      };
    });

    const structuredContent: Record<string, unknown> = {
      chain: chainName,
      chainId,
      wallet,
      positions: positionsOut,
      // D-02 load-bearing: approx: true is ALWAYS present alongside IL
      // surfaces — mirrors Lido pattern.
      approx: true,
    };
    if (isPublicNodeFallback(chainId)) {
      structuredContent.rpcDegraded = true;
    }

    return {
      content: [{ type: "text", text: summaryLines.join("\n") }],
      structuredContent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `error: failed to read Uniswap V3 LP positions for ${wallet} on ${chainName}: ${message}`,
        },
      ],
      isError: true,
      structuredContent: {
        ...makeStructuredError(
          "INTERNAL_ERROR",
          `failed to read Uniswap V3 LP positions for ${wallet} on ${chainName}`,
          message,
        ),
      },
    };
  }
});
