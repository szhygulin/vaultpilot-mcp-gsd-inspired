import { formatUnits, parseAbi, type Address } from "viem";

import type { ChainId } from "../config/contracts.js";
import { loadTokenRegistry, type Token } from "../tokens/registry.js";
import { getChainClient } from "./registry.js";

/**
 * Result row for one token in a balance scan.
 *
 * `balance` is the raw on-chain `bigint` (no decimal scaling). Cross the API
 * boundary via {@link formatTokenBalance} to get a decimal string — never
 * convert to `number` (precision loss).
 *
 * `error` is set when the per-token multicall leg failed (e.g. contract
 * reverted, RPC dropped one leg). `balance` is `0n` in that case; downstream
 * callers should check `error` before treating the row as authoritative.
 */
export interface TokenBalance {
  token: Token;
  balance: bigint;
  error?: string;
}

const ERC20_BALANCE_OF_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

/**
 * Scans ERC-20 balances for a wallet via a single multicall round-trip.
 *
 * Defaults to the static top-50 token registry for the given chain (Phase 8
 * Plan 08-02 widening — chainId defaults to `1` for back-compat with Phase 4-7
 * single-chain callers). Pass an explicit `tokens` array to scan a custom set
 * (used by 02-04's single-token-balance tool + Phase 8's user-supplied lists).
 *
 * One RPC round-trip per call regardless of token count — viem's `multicall`
 * batches all `balanceOf` reads through the canonical multicall3 contract.
 * `allowFailure: true` means a single bad token does not fail the whole scan;
 * the failed leg surfaces as `{ error: "..." }` on the corresponding row.
 */
export async function scanErc20Balances(
  wallet: Address,
  tokens?: readonly Token[],
  chainId: ChainId = 1,
): Promise<TokenBalance[]> {
  const list = tokens ?? loadTokenRegistry(chainId);
  if (list.length === 0) return [];

  const client = getChainClient(chainId);
  const contracts = list.map((token) => ({
    address: token.address,
    abi: ERC20_BALANCE_OF_ABI,
    functionName: "balanceOf" as const,
    args: [wallet] as const,
  }));

  const results = await client.multicall({
    contracts,
    allowFailure: true,
    // viem's multicall splits calls across multiple eth_call requests when the
    // encoded payload exceeds `batchSize` bytes (default 1024). We want exactly
    // one round-trip per scan — top-50 fits comfortably in a single multicall3
    // call (~2.5 KB call data, well under the canonical 100KB JSON-RPC limit).
    batchSize: 0,
  });

  return list.map((token, idx) => {
    const result = results[idx];
    if (result === undefined) {
      // Defensive: viem returns one result per contract; this branch should be unreachable.
      return { token, balance: 0n, error: "missing multicall result" };
    }
    if (result.status === "success") {
      return { token, balance: result.result };
    }
    return {
      token,
      balance: 0n,
      error: result.error.message,
    };
  });
}

/**
 * Formats a raw `bigint` balance to a decimal string at the API boundary.
 *
 * Wraps `viem.formatUnits`. Use this — never `Number(balance)` or
 * `balance.toString()` followed by manual decimal placement — because token
 * decimals vary (USDC=6, GUSD=2, most=18) and off-by-decimal is the most
 * common user-facing bug class in this codebase (per CLAUDE.md conventions).
 */
export function formatTokenBalance(balance: bigint, decimals: number): string {
  return formatUnits(balance, decimals);
}

/**
 * Filters out rows whose balance is below `dustThreshold` (raw bigint compare).
 *
 * Phase 02-02 has no USD context — this is a pure balance threshold, useful
 * for dropping `0n` rows before rendering. Phase 02-03 will add USD-aware
 * dust filtering on top of the same scan output (typical default: $0.01),
 * so filtering is intentionally separated from the scanner.
 *
 * Pass `0n` to disable (the default). Rows with `error` set are preserved
 * regardless of threshold — callers need to see RPC failures.
 */
export function filterDust(
  balances: readonly TokenBalance[],
  dustThreshold: bigint = 0n,
): TokenBalance[] {
  if (dustThreshold <= 0n) {
    return balances.filter((row) => row.error !== undefined || row.balance > 0n);
  }
  return balances.filter(
    (row) => row.error !== undefined || row.balance >= dustThreshold,
  );
}
