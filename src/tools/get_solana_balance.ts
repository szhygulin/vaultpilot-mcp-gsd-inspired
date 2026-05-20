// src/tools/get_solana_balance.ts — Phase 11 Plan 11-05 (SOL-03).
//
// Native SOL balance read. Mirrors `get_token_balance.ts:48-117` (Phase 2
// analog) — base58-validated wallet input → Plan 11-02's
// `getNativeBalance()` call → decimal-string boundary at the response
// edge (CLAUDE.md "Decimal-aware arithmetic").
//
// Locked errorCode set:
//   - SOLANA_RPC_FAILED — `SolanaRpcError` rethrown by `sol-rpc-client`.
//   - (JSON-schema gate rejects malformed base58 wallet pre-handler).

import { getNativeBalance, SolanaRpcError } from "../chains/solana/sol-rpc-client.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns native SOL balance for a Solana wallet (base58 address). Lamports + decimal-string formatted SOL (1 SOL = 1_000_000_000 lamports, 9 decimals).",
  "Uses the configured Solana RPC (SOLANA_RPC_URL env override, else public mainnet-beta fallback). Single RPC round-trip — `Connection.getBalance`.",
  "Use this when the user asks about a SOL balance specifically. Use `get_solana_token_balance` for SPL tokens (USDC/USDT/etc. on Solana). Use `get_portfolio_summary` for the full cross-chain picture (Solana leg fans out automatically when a Solana account is paired or a demo persona is active).",
  "`wallet` is REQUIRED — base58, 32-44 chars. Schema-level rejection on malformed input.",
  "Decimal strings cross the boundary, never numbers — lamports as STRING preserves the u64 range; sol as DECIMAL STRING preserves precision through any downstream math.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description:
        "Solana wallet base58 address (32-44 characters). Base58 alphabet — `1-9A-HJ-NP-Za-km-z`. Case-sensitive (unlike EVM hex).",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

interface SolanaBalanceResult {
  wallet: string;
  /** u64 lamports as a decimal string. SOL has 9 decimals; 1 SOL = 1_000_000_000 lamports. */
  lamports: string;
  /** Decimal-string SOL amount, e.g. `"2.5"` for 2_500_000_000 lamports. */
  sol: string;
  decimals: 9;
  symbol: "SOL";
}

registerTool("get_solana_balance", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
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

  try {
    const { lamports, sol } = await getNativeBalance(walletRaw);
    const result: SolanaBalanceResult = {
      wallet: walletRaw,
      lamports: lamports.toString(),
      sol,
      decimals: 9,
      symbol: "SOL",
    };
    return {
      content: [
        {
          type: "text",
          text: `${walletRaw} holds ${sol} SOL (${lamports.toString()} lamports)`,
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
            text: `error: failed to read SOL balance for ${walletRaw}: ${err.message}`,
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
        { type: "text", text: `error: failed to read SOL balance for ${walletRaw}: ${message}` },
      ],
      isError: true,
      structuredContent: {
        errorCode: "INTERNAL_ERROR",
        message,
      },
    };
  }
});
