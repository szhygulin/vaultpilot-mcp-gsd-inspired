// MCP tool: get_tron_balance({ wallet }) — Phase 17 Plan 17-03 (TRON-READ-01).
//
// Native TRX balance read. Mirror of `get_solana_balance.ts` shape — base58-
// validated wallet input → `getNativeBalance()` from `tron-rpc-client.ts` →
// decimal-string boundary at the response edge (CLAUDE.md "Decimal-aware
// arithmetic").
//
// Native units: TRX has **6 decimals** (1 TRX = 1_000_000 sun), NOT 9 like
// SOL. The `decimals: 6` literal in the response shape is the load-bearing
// regression anchor — defaulting to 9 (SOL-shaped) would silently shift
// every TRX balance display by 1000x.
//
// Locked errorCode set:
//   - TRON_RPC_FAILED — `TronRpcError` rethrown by `tron-rpc-client`.
//   - INVALID_INPUT — schema regex rejects most cases; defensive arm here
//     for non-schema callers (the regex catches EVM-shape `0x...` inputs).

import { getNativeBalance, TronRpcError } from "../chains/tron/tron-rpc-client.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns native TRX balance for a TRON wallet (base58check T-prefixed address). Sun + decimal-string formatted TRX (1 TRX = 1_000_000 sun, 6 decimals — NOT 9 like SOL).",
  "Uses the configured TRON RPC (TRON_RPC_URL env override, else public TronGrid fallback). Single RPC round-trip — `tw.trx.getBalance`.",
  "Use this when the user asks about a TRX balance specifically. Use `get_tron_token_balance` for TRC-20 (USDT/USDC/USDD on TRON). Use `get_tron_block_tip` for chain diagnostics.",
  "`wallet` is REQUIRED — base58check, 34 chars, T-prefixed. Schema-level rejection on malformed input.",
  "Decimal strings cross the boundary, never numbers — sun as STRING preserves the int64 range (research Pitfall 1 — tronweb wire-shape returns number); trx as DECIMAL STRING preserves precision through any downstream math.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description:
        "TRON wallet base58check T-prefixed address (34 characters). Base58 alphabet — `1-9A-HJ-NP-Za-km-z`. Leading `T` is the 0x41 mainnet-prefix marker.",
      pattern: "^T[1-9A-HJ-NP-Za-km-z]{33}$",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

interface TronBalanceResult {
  wallet: string;
  /** int64 sun as a decimal string. TRX has 6 decimals; 1 TRX = 1_000_000 sun. */
  sun: string;
  /** Decimal-string TRX amount, e.g. `"1.5"` for 1_500_000 sun. */
  trx: string;
  decimals: 6;
  symbol: "TRX";
}

registerTool("get_tron_balance", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || walletRaw.length === 0) {
    return {
      content: [{ type: "text", text: "error: `wallet` must be a non-empty base58check TRON address" }],
      isError: true,
      structuredContent: {
        errorCode: "INVALID_INPUT",
        message: "`wallet` must be a non-empty base58check TRON address",
      },
    };
  }

  try {
    const { sun, trx } = await getNativeBalance(walletRaw);
    const result: TronBalanceResult = {
      wallet: walletRaw,
      sun: sun.toString(),
      trx,
      decimals: 6,
      symbol: "TRX",
    };
    return {
      content: [
        {
          type: "text",
          text: `${walletRaw} holds ${trx} TRX (${sun.toString()} sun)`,
        },
      ],
      structuredContent: { ...result },
    };
  } catch (err) {
    if (err instanceof TronRpcError) {
      return {
        content: [
          {
            type: "text",
            text: `error: failed to read TRX balance for ${walletRaw}: ${err.message}`,
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
        { type: "text", text: `error: failed to read TRX balance for ${walletRaw}: ${message}` },
      ],
      isError: true,
      structuredContent: {
        errorCode: "INTERNAL_ERROR",
        message,
      },
    };
  }
});
