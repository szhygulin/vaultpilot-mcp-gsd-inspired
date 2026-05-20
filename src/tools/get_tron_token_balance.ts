// MCP tool: get_tron_token_balance({ wallet, contractAddress }) — Phase 17
// Plan 17-03 (TRON-READ-02).
//
// Single-contract TRC-20 balance read. Mirror of
// `get_solana_token_balance.ts` shape — base58check-validated
// `(wallet, contractAddress)` input → registry-first decimals lookup → on-
// demand `decimals()` ABI call fallback → `balanceOf(address)` raw balance
// → decimal-string formatting at the response edge.
//
// **REGRESSION ANCHOR per research § Pitfall 5:** TRC-20 decimals are
// PER-ENTRY. USDT-TRC20 / USDC-TRC20 = 6 decimals; **USDD = 18 decimals**.
// Hardcoding `decimals = 6` anywhere in this file silently corrupts USDD
// balances by 1e12 — defaulting to 6 is forbidden. The on-demand fallback
// (`tw.contract(...).methods.decimals().call()`) reads the contract value;
// the unregistered-contract test branch asserts this path returns the
// actual chain-side decimals, not a default.
//
// **Pricing surface (Plan 17-04 territory):** Plan 17-03 ships the tool
// without DefiLlama price plumbing. Plan 17-04 lands `getTronPrices` +
// curated `tron-top-25.json` entries; at that point this tool will be
// re-wired to surface `priceUsd` + `valueUsd` (or `priceUnknown: true`).
// Until 17-04 lands, every response surfaces `priceUnknown: true` so the
// agent surface is consistent with the post-17-04 envelope shape (the
// flag stays present; only the values change).
//
// Locked errorCode set:
//   - TRON_RPC_FAILED — `TronRpcError` rethrown by `tron-rpc-client`.
//   - INVALID_INPUT — schema regex rejects most cases; defensive arm here
//     for non-schema callers.

import {
  _tronRegistry,
} from "../chains/tron/registry.js";
import {
  getTrc20Balance,
  TronRpcError,
} from "../chains/tron/tron-rpc-client.js";
import { findByAddress } from "../tokens/tron-top-25.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns TRC-20 token balance for a (wallet, contractAddress) pair on TRON. Decimal-string `balance` + `decimals` + `symbol`.",
  "`symbol` + `decimals` come from the curated top-25 TRC-20 registry (USDT-TRC20=6, USDC-TRC20=6, USDD=18); for unregistered contracts, on-demand ABI `decimals()` + `symbol()` calls fetch the chain-side values — NEVER defaults to 6 (USDD is 18-decimal; defaulting silently corrupts the display by 1e12).",
  "USD valuation via DefiLlama's `tron:<contractAddress>` keying — Plan 17-04 ships the integration. Until then, every response surfaces `priceUnknown: true`.",
  "Use this for TRC-20 specifically (USDT/USDC/USDD on TRON). Use `get_tron_balance` for native TRX.",
  "`wallet` + `contractAddress` BOTH base58check T-prefixed, 34 chars. Schema-level rejection on malformed input.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description:
        "TRON wallet base58check T-prefixed address (34 characters). Base58 alphabet — `1-9A-HJ-NP-Za-km-z`.",
      pattern: "^T[1-9A-HJ-NP-Za-km-z]{33}$",
    },
    contractAddress: {
      type: "string",
      description:
        "TRC-20 contract base58check T-prefixed address (34 characters). E.g. USDT-TRC20 = `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`.",
      pattern: "^T[1-9A-HJ-NP-Za-km-z]{33}$",
    },
  },
  required: ["wallet", "contractAddress"],
  additionalProperties: false,
};

interface TronTokenBalanceResult {
  wallet: string;
  contractAddress: string;
  /** uint256 raw balance as a decimal string. */
  raw: string;
  /** Decimal-string token amount, e.g. `"1.5"` for 1_500_000 raw + 6 decimals. */
  amount: string;
  /** Per-entry decimals — NEVER defaults; chain-side ABI read for unregistered contracts. */
  decimals: number;
  symbol: string;
  /** True when decimals could NOT be resolved (neither registry nor on-demand ABI). */
  decimalsUnknown?: true;
  /** True when symbol could NOT be resolved (off-registry + ABI symbol() failed). */
  symbolUnknown?: true;
  /** Always true in Plan 17-03 — 17-04 lands real pricing. */
  priceUnknown?: true;
}

function shortAddr(addr: string): string {
  if (addr.length <= 9) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

/**
 * Format `bigint raw` as a decimal-string token amount at `decimals` precision.
 * Pure — deterministic on every input. Mirror of `formatSunToTrx` shape in
 * `tron-rpc-client.ts` (parameterized over decimals rather than hardcoded 6).
 *
 * Behavior at decimals=6:
 *   - `0n` → `"0"`
 *   - `1_000_000n` → `"1"`
 *   - `1_500_000n` → `"1.5"`
 *
 * Behavior at decimals=18 (USDD shape):
 *   - `1_000_000_000_000_000_000n` → `"1"`
 *   - `1_500_000_000_000_000_000n` → `"1.5"`
 */
function formatBalance(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  if (frac === 0n) return whole.toString();
  const fracPadded = frac.toString().padStart(decimals, "0");
  const fracTrimmed = fracPadded.replace(/0+$/, "");
  return `${whole.toString()}.${fracTrimmed}`;
}

/**
 * Minimal TRC-20 ABI for on-demand `decimals()` + `symbol()` lookups.
 * tronweb's `tw.contract(abi, addr)` accepts this human-readable shape.
 */
const TRC20_METADATA_ABI = [
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
];

registerTool(
  "get_tron_token_balance",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    const walletRaw = args.wallet;
    const contractRaw = args.contractAddress;
    if (typeof walletRaw !== "string" || walletRaw.length === 0) {
      return {
        content: [
          { type: "text", text: "error: `wallet` must be a non-empty base58check TRON address" },
        ],
        isError: true,
        structuredContent: {
          errorCode: "INVALID_INPUT",
          message: "`wallet` must be a non-empty base58check TRON address",
        },
      };
    }
    if (typeof contractRaw !== "string" || contractRaw.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "error: `contractAddress` must be a non-empty base58check TRC-20 address",
          },
        ],
        isError: true,
        structuredContent: {
          errorCode: "INVALID_INPUT",
          message: "`contractAddress` must be a non-empty base58check TRC-20 address",
        },
      };
    }

    try {
      // Registry lookup first — free, no RPC. Against the empty 17-01 stub
      // `findByAddress` returns `undefined` for every input; Plan 17-04
      // lands curated entries that flip this to positive lookups for
      // USDT-TRC20 / USDC-TRC20 / USDD / etc.
      const registered = findByAddress(contractRaw);

      let decimals: number | undefined;
      let symbol: string | undefined;
      let decimalsUnknown = false;
      let symbolUnknown = false;
      if (registered) {
        decimals = registered.decimals;
        symbol = registered.symbol;
      } else {
        // On-demand ABI fallback — single extra RPC round-trip per metadata
        // field. NEVER default to 6 (research Pitfall 5 REGRESSION ANCHOR).
        // If either ABI call fails (e.g. the contract isn't TRC-20-shaped),
        // surface the `*Unknown` flag rather than fabricating a value.
        const tw = _tronRegistry.getTronWeb();
        let contract;
        try {
          contract = await tw.contract(TRC20_METADATA_ABI, contractRaw);
        } catch (e) {
          throw new TronRpcError(e);
        }
        try {
          const decResult = await contract.methods.decimals().call();
          decimals = Number(decResult.toString());
        } catch {
          decimalsUnknown = true;
        }
        try {
          const symResult = await contract.methods.symbol().call();
          symbol = String(symResult);
        } catch {
          symbolUnknown = true;
        }
      }

      const rawBalance = await getTrc20Balance(walletRaw, contractRaw);

      // If decimals could not be resolved (neither registry nor ABI), skip
      // decimals-aware formatting; surface the raw value only. Plan 17-04
      // will fill the registry and this branch becomes vestigial for the
      // curated set (but stays in place for off-registry queries).
      let amount: string;
      if (decimals === undefined) {
        amount = rawBalance.toString();
      } else {
        amount = formatBalance(rawBalance, decimals);
      }

      const result: TronTokenBalanceResult = {
        wallet: walletRaw,
        contractAddress: contractRaw,
        raw: rawBalance.toString(),
        amount,
        decimals: decimals ?? 0,
        symbol: symbol ?? shortAddr(contractRaw),
        // Plan 17-04 lands DefiLlama `tron:<addr>` keying. Until then,
        // every response surfaces priceUnknown so the agent surface is
        // consistent with the post-17-04 envelope shape.
        priceUnknown: true,
      };
      if (decimalsUnknown) result.decimalsUnknown = true;
      if (symbolUnknown || !symbol) result.symbolUnknown = true;

      const decimalsText = decimalsUnknown ? "?" : String(result.decimals);
      const symbolText = result.symbol;
      return {
        content: [
          {
            type: "text",
            text: `${walletRaw} holds ${amount} ${symbolText} (contract ${contractRaw}, decimals=${decimalsText})`,
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
              text: `error: failed to read TRC-20 balance for ${walletRaw} @ ${contractRaw}: ${err.message}`,
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
            text: `error: failed to read TRC-20 balance for ${walletRaw} @ ${contractRaw}: ${message}`,
          },
        ],
        isError: true,
        structuredContent: {
          errorCode: "INTERNAL_ERROR",
          message,
        },
      };
    }
  },
);
