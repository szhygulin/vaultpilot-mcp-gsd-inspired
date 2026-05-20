// src/tools/get_solana_token_metadata.ts — Phase 11 Plan 11-05 (SOL-04).
//
// SPL token metadata read. Mirrors `get_token_metadata.ts` shape:
// registry-hit-first, on-demand RPC fallback for unknown mints.
//
// Trust boundary (mirrors v1.x `get_token_metadata`): the curated top-50
// registry is the SOT for known mints. Off-list mints fall through to a
// `getMint()` RPC read which yields decimals but NOT symbol — symbol lives
// on the Metaplex Token Metadata PDA, a Phase 13+ concern.
//
// Locked errorCode set:
//   - SOLANA_RPC_FAILED — `SolanaRpcError` from on-chain decimals lookup.
//   - INVALID_INPUT — schema gate catches most cases; defensive arm here.

import {
  getMintDecimals,
  SolanaRpcError,
} from "../chains/solana/sol-rpc-client.js";
import { findByMint } from "../tokens/solana-top-50.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns SPL token metadata (`symbol`, `decimals`, `displayName`) for a mint.",
  "Hits the curated top-50 registry first (USDC, USDT, JUP, BONK, JitoSOL, mSOL, etc.) — free, no RPC. Falls back to on-chain `getMint()` for unknown mints (decimals only — symbol stays `symbolUnknown: true` because the Metaplex Token Metadata Program lookup is a Phase 13+ concern).",
  "Call BEFORE Solana signing flows (Phase 12+) so decimal-string amounts can be parsed strictly — off-by-decimal is the most common user-facing bug class.",
  "`mint` is REQUIRED — base58, 32-44 chars.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    mint: {
      type: "string",
      description:
        "SPL mint base58 address (32-44 characters). E.g. USDC = `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
  },
  required: ["mint"],
  additionalProperties: false,
};

interface SolanaTokenMetadataResult {
  mint: string;
  symbol: string;
  decimals: number;
  displayName: string | null;
  symbolUnknown?: true;
}

function shortMint(mint: string): string {
  if (mint.length <= 9) return mint;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

registerTool("get_solana_token_metadata", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const mintRaw = args.mint;
  if (typeof mintRaw !== "string" || mintRaw.length === 0) {
    return {
      content: [{ type: "text", text: "error: `mint` must be a non-empty base58 Solana mint address" }],
      isError: true,
      structuredContent: {
        errorCode: "INVALID_INPUT",
        message: "`mint` must be a non-empty base58 Solana mint address",
      },
    };
  }

  // Cache-first: curated top-50 registry. Free, no RPC.
  const registryEntry = findByMint(mintRaw);
  if (registryEntry) {
    const result: SolanaTokenMetadataResult = {
      mint: mintRaw,
      symbol: registryEntry.symbol,
      decimals: registryEntry.decimals,
      displayName: registryEntry.displayName,
    };
    return {
      content: [
        {
          type: "text",
          text: `${mintRaw}: ${registryEntry.displayName} (${registryEntry.symbol}, decimals=${registryEntry.decimals})`,
        },
      ],
      structuredContent: { ...result },
    };
  }

  // Cache miss: on-demand decimals. Symbol stays unknown.
  try {
    const decimals = await getMintDecimals(mintRaw);
    const result: SolanaTokenMetadataResult = {
      mint: mintRaw,
      symbol: shortMint(mintRaw),
      decimals,
      displayName: null,
      symbolUnknown: true,
    };
    return {
      content: [
        {
          type: "text",
          text: `${mintRaw}: <unknown symbol> (decimals=${decimals})`,
        },
      ],
      structuredContent: { ...result },
    };
  } catch (err) {
    if (err instanceof SolanaRpcError) {
      return {
        content: [
          {
            type: "text",
            text: `error: failed to read mint decimals for ${mintRaw}: ${err.message}`,
          },
        ],
        isError: true,
        structuredContent: {
          errorCode: err.errorCode,
          message: err.message,
        },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        { type: "text", text: `error: failed to read mint decimals for ${mintRaw}: ${message}` },
      ],
      isError: true,
      structuredContent: {
        errorCode: "INTERNAL_ERROR",
        message,
      },
    };
  }
});
