// src/tools/get_solana_token_balance.ts — Phase 11 Plan 11-05 (SOL-04).
//
// Single-mint SPL balance read. Mirrors `get_token_balance.ts` (the
// Phase 2 EVM analog) — base58-validated `(wallet, mint)` input →
// UNPARSED `getTokenAccountsByOwner` filtered to the mint → decimal-string
// formatted balance via curated registry or on-demand `getMintDecimals`
// fallback → DefiLlama price via `solana:<mint>` keying.
//
// **D-7 LOAD-BEARING (research § Topic 5):** SPL discovery MUST go through
// Plan 11-02's `getSplTokenAccounts(walletBase58)`, which uses the UNPARSED
// path under the hood. The public RPC (`api.mainnet-beta.solana.com`)
// REJECTS `getParsedTokenAccountsByOwner` with `-32601 Method not found`.
// Calling the parsed method directly here would silent-fail against the
// default RPC for every demo / zero-config install.
//
// Locked errorCode set:
//   - SOLANA_RPC_FAILED — `SolanaRpcError` rethrown by `sol-rpc-client`.
//   - INVALID_INPUT — schema gate catches most cases; defensive arm here
//     for non-schema callers.

import { formatUnits } from "viem";

import {
  getMintDecimals,
  getSplTokenAccounts,
  SolanaRpcError,
} from "../chains/solana/sol-rpc-client.js";
import { getSolanaPrices } from "../pricing/defillama.js";
import { findByMint } from "../tokens/solana-top-50.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns SPL token balance for a (wallet, mint) pair on Solana. Decimal-string `balance` + `decimals` + `symbol`.",
  "`symbol` comes from the curated top-50 SPL registry (USDC, USDT, JUP, BONK, JitoSOL, etc.); for unknown mints, surfaces `symbolUnknown: true` with a `<prefix>...<suffix>` placeholder (Metaplex Token Metadata lookup is a Phase 13+ concern).",
  "USD valuation via DefiLlama's `solana:<mint>` keying. Missing-price rows surface `priceUnknown: true` and omit `balanceUsd` — never zero (zero is the wrong claim for an unpriced asset).",
  "Use this for SPL tokens specifically (USDC on Solana, etc.). Use `get_solana_balance` for native SOL. Use `get_portfolio_summary` for the full multi-chain picture.",
  "SPL discovery uses the UNPARSED `getTokenAccountsByOwner` + client-side `AccountLayout.decode` path — the parsed variant is rejected by the default public RPC.",
  "`wallet` + `mint` BOTH base58, 32-44 chars. Schema-level rejection on malformed input.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description:
        "Solana wallet base58 address (32-44 characters). Base58 alphabet — `1-9A-HJ-NP-Za-km-z`. Case-sensitive.",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    mint: {
      type: "string",
      description:
        "SPL mint base58 address (32-44 characters). E.g. USDC = `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
  },
  required: ["wallet", "mint"],
  additionalProperties: false,
};

interface SolanaTokenBalanceResult {
  wallet: string;
  mint: string;
  balance: string;
  decimals: number;
  symbol: string;
  symbolUnknown?: true;
  balanceUsd?: string;
  priceUnknown?: true;
}

function shortMint(mint: string): string {
  if (mint.length <= 9) return mint;
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

registerTool("get_solana_token_balance", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
  const mintRaw = args.mint;
  if (typeof walletRaw !== "string" || walletRaw.length === 0) {
    return {
      content: [{ type: "text", text: "error: `wallet` must be a non-empty base58 Solana address" }],
      isError: true,
      structuredContent: {
        errorCode: "INVALID_INPUT",
        message: "`wallet` must be a non-empty base58 Solana address",
      },
    };
  }
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

  try {
    // UNPARSED PATH — D-7 LOAD-BEARING. `getSplTokenAccounts` routes through
    // `getTokenAccountsByOwner({ programId: TOKEN_PROGRAM_ID })` and decodes
    // the binary `AccountLayout` client-side. The parsed RPC method is
    // rejected by the public mainnet-beta endpoint.
    const accounts = await getSplTokenAccounts(walletRaw);
    const matching = accounts.find((row) => row.mint === mintRaw);

    // Registry hit (free, no RPC) → use those decimals + symbol.
    const registryEntry = findByMint(mintRaw);
    let decimals: number;
    let symbol: string;
    let symbolUnknown = false;
    if (registryEntry) {
      decimals = registryEntry.decimals;
      symbol = registryEntry.symbol;
    } else {
      // On-demand mint decimals — single extra RPC round-trip. Symbol stays
      // unknown (Metaplex Token Metadata PDA is Phase 13+).
      decimals = await getMintDecimals(mintRaw);
      symbol = shortMint(mintRaw);
      symbolUnknown = true;
    }

    const rawAmount: bigint = matching ? matching.amount : 0n;
    const balance = formatUnits(rawAmount, decimals);

    // DefiLlama price lookup. Native-SOL pricing uses the wSOL mint as the
    // proxy (`So111...1112`); we DON'T need a special case here — the
    // caller passes whatever mint they queried, including wSOL.
    const priceMap = await getSolanaPrices([mintRaw]);
    const quote = priceMap.get(mintRaw);

    const result: SolanaTokenBalanceResult = {
      wallet: walletRaw,
      mint: mintRaw,
      balance,
      decimals,
      symbol,
    };
    if (symbolUnknown) result.symbolUnknown = true;

    if (quote && typeof quote.priceUsd === "number" && Number.isFinite(quote.priceUsd)) {
      const balanceFloat = Number(balance);
      if (Number.isFinite(balanceFloat)) {
        const usd = balanceFloat * quote.priceUsd;
        result.balanceUsd = usd.toFixed(2);
      } else {
        result.priceUnknown = true;
      }
    } else {
      result.priceUnknown = true;
    }

    const usdText = result.balanceUsd ? ` (~$${result.balanceUsd} USD)` : "";
    return {
      content: [
        {
          type: "text",
          text: `${walletRaw} holds ${balance} ${symbol} (mint ${mintRaw}, decimals=${decimals})${usdText}`,
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
            text: `error: failed to read SPL balance for ${walletRaw} @ ${mintRaw}: ${err.message}`,
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
        {
          type: "text",
          text: `error: failed to read SPL balance for ${walletRaw} @ ${mintRaw}: ${message}`,
        },
      ],
      isError: true,
      structuredContent: {
        errorCode: "INTERNAL_ERROR",
        message,
      },
    };
  }
});
