import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { getEthereumClient, isPublicNodeFallback } from "../chains/ethereum.js";
import {
  formatTokenBalance,
  scanErc20Balances,
  type TokenBalance,
} from "../chains/erc20-scanner.js";
import { getWethAddress } from "../config/contracts.js";
import { getPrices, type PriceQuote } from "../pricing/defillama.js";
import { registerTool } from "./index.js";

/**
 * Canonical WETH contract on Ethereum mainnet — used as the pricing proxy
 * for native ETH (DefiLlama prices ERC-20 contracts; native ETH has no
 * contract address). WETH is hard-pegged 1:1 to ETH by deposit/withdraw.
 *
 * Plan 06-04 (CONFIG-LITERAL-MIGRATION-1): sourced from src/config/contracts.ts
 * SOT. The literal lives ONLY in src/config/contracts.ts; this consumer
 * imports getWethAddress so a future contributor cannot accidentally drift
 * the two copies. Regression-tested at module load (getAddress re-checksums).
 */
const WETH_ADDRESS: Address = getWethAddress(1);

const NATIVE_DECIMALS = 18;
const DEFAULT_DUST_THRESHOLD_USD = 0.01;

const DESCRIPTION = [
  "Read a complete Ethereum portfolio for one wallet — native ETH balance plus the wallet's holdings across the top-50 ERC-20 tokens by trading volume — and aggregate USD values via DefiLlama pricing.",
  "Use this when the user asks for an overview of their on-chain wealth (\"what do I hold\", \"show me my portfolio\", \"how much is my wallet worth\") on Ethereum mainnet — NOT for single-token reads (use `get_token_balance` for that) and NOT for transaction history (no tool yet).",
  "Returns a `nativeBalance` row, an `erc20Balances` array (one row per non-dust holding), `totalUsd` summed over rows with known prices, and an optional `rpcDegraded` flag when the public RPC fallback is in use.",
  "Rows whose price DefiLlama doesn't track surface as `priceUnknown: true` and are listed but contribute 0 to `totalUsd` — they're never silently dropped because zero is the wrong claim for an unpriced asset.",
  "Dust filter defaults to $0.01 USD; pass `dustThreshold: 0` to see every non-zero row. `priceUnknown` rows are NEVER dust-filtered (we can't measure their value, so we can't say they're below threshold).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description: "Wallet address to query (0x-prefixed, 40 hex chars). Mixed case accepted; checksum is normalized.",
      pattern: "^0x[0-9a-fA-F]{40}$",
    },
    dustThreshold: {
      type: "number",
      description: "Minimum USD value per row to include in the response. Default 0.01. Pass 0 to disable. priceUnknown rows are always included regardless of threshold.",
      minimum: 0,
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

interface NativeBalanceRow {
  balance: string;
  balanceUsd?: string;
  priceUnknown?: true;
}

interface Erc20BalanceRow {
  tokenAddress: Address;
  symbol: string;
  decimals: number;
  balance: string;
  balanceUsd?: string;
  priceUnknown?: true;
  error?: string;
}

interface PortfolioSummaryResult {
  chain: "ethereum";
  nativeBalance: NativeBalanceRow;
  erc20Balances: Erc20BalanceRow[];
  totalUsd: string;
  rpcDegraded?: boolean;
}

registerTool("get_portfolio_summary", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
    return {
      content: [{ type: "text", text: "error: `wallet` must be a valid 0x-prefixed Ethereum address" }],
      isError: true,
    };
  }

  const dustThresholdRaw = args.dustThreshold;
  let dustThreshold = DEFAULT_DUST_THRESHOLD_USD;
  if (dustThresholdRaw !== undefined) {
    if (typeof dustThresholdRaw !== "number" || !Number.isFinite(dustThresholdRaw) || dustThresholdRaw < 0) {
      return {
        content: [{ type: "text", text: "error: `dustThreshold` must be a non-negative finite number" }],
        isError: true,
      };
    }
    dustThreshold = dustThresholdRaw;
  }

  const wallet: Address = getAddress(walletRaw);
  const client = getEthereumClient();

  // Fan out the two on-chain reads concurrently. Pricing waits on the address
  // set assembled from these results (top-50 registry is static; we could
  // fetch prices in parallel with balances, but the registry's symbols are
  // independent of the user's holdings and triggering a price fetch only
  // after we know which tokens to include keeps the cache hit rate higher).
  let nativeBalanceRaw: bigint;
  let erc20Balances: TokenBalance[];
  try {
    [nativeBalanceRaw, erc20Balances] = await Promise.all([
      client.getBalance({ address: wallet }),
      scanErc20Balances(wallet),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `error: failed to read on-chain balances for ${wallet}: ${message}`,
        },
      ],
      isError: true,
    };
  }

  // Build the address list for pricing: WETH proxy for native ETH + every
  // token that has a non-zero balance (no point pricing a row we'll drop).
  const erc20WithBalance = erc20Balances.filter(
    (row) => row.balance > 0n && row.error === undefined,
  );
  const priceAddresses: Address[] = [
    WETH_ADDRESS,
    ...erc20WithBalance.map((row) => row.token.address),
  ];
  const prices = await getPrices(priceAddresses);

  // Native row.
  const nativeBalance = formatUnits(nativeBalanceRaw, NATIVE_DECIMALS);
  const ethQuote = prices.get(WETH_ADDRESS);
  const nativeRow = buildRow(nativeBalanceRaw, NATIVE_DECIMALS, nativeBalance, ethQuote);
  const nativeOut: NativeBalanceRow = { balance: nativeRow.balance };
  if (nativeRow.balanceUsd !== undefined) nativeOut.balanceUsd = nativeRow.balanceUsd;
  if (nativeRow.priceUnknown) nativeOut.priceUnknown = true;

  // ERC-20 rows.
  const erc20Out: Erc20BalanceRow[] = [];
  let totalUsd = 0;
  if (nativeRow.usdValue !== undefined) totalUsd += nativeRow.usdValue;

  for (const row of erc20Balances) {
    // Always preserve error rows — caller needs to see RPC failures.
    if (row.error !== undefined) {
      erc20Out.push({
        tokenAddress: row.token.address,
        symbol: row.token.symbol,
        decimals: row.token.decimals,
        balance: formatTokenBalance(row.balance, row.token.decimals),
        error: row.error,
      });
      continue;
    }
    if (row.balance === 0n) continue; // Always drop true zeros.

    const balanceStr = formatTokenBalance(row.balance, row.token.decimals);
    const quote = prices.get(row.token.address);
    const built = buildRow(row.balance, row.token.decimals, balanceStr, quote);

    // Dust filter: positive threshold + known price + below threshold = drop.
    // priceUnknown rows are NEVER dust-filtered — we can't measure their value
    // so we can't claim they're below threshold.
    if (
      dustThreshold > 0 &&
      built.usdValue !== undefined &&
      built.usdValue < dustThreshold
    ) {
      continue;
    }

    const out: Erc20BalanceRow = {
      tokenAddress: row.token.address,
      symbol: row.token.symbol,
      decimals: row.token.decimals,
      balance: built.balance,
    };
    if (built.balanceUsd !== undefined) out.balanceUsd = built.balanceUsd;
    if (built.priceUnknown) out.priceUnknown = true;
    erc20Out.push(out);

    if (built.usdValue !== undefined) totalUsd += built.usdValue;
  }

  // Native row inclusion in the dust filter: applied symmetrically with
  // ERC-20s. A wallet holding 0.000001 ETH is dust by USD just as it would
  // be for an ERC-20. priceUnknown native (unlikely — ETH always has a
  // price on DefiLlama) is preserved for the same reason ERC-20s are.
  const includeNative =
    nativeBalanceRaw > 0n &&
    !(
      dustThreshold > 0 &&
      nativeRow.usdValue !== undefined &&
      nativeRow.usdValue < dustThreshold
    );

  const finalNative: NativeBalanceRow = includeNative ? nativeOut : { balance: nativeBalance };
  // When the native row is dust-filtered, also drop its USD contribution.
  // (Already added above; subtract back out for symmetry with erc20 path.)
  let adjustedTotal = totalUsd;
  if (!includeNative && nativeRow.usdValue !== undefined) {
    adjustedTotal -= nativeRow.usdValue;
  }

  const result: PortfolioSummaryResult = {
    chain: "ethereum",
    nativeBalance: finalNative,
    erc20Balances: erc20Out,
    totalUsd: formatUsd(adjustedTotal),
  };
  if (isPublicNodeFallback()) result.rpcDegraded = true;

  const erc20Count = erc20Out.length;
  const summary = `wallet ${wallet}: ${nativeBalance} ETH + ${erc20Count} ERC-20 row${erc20Count === 1 ? "" : "s"} = ~$${result.totalUsd} USD${result.rpcDegraded ? " (rpcDegraded)" : ""}`;

  return {
    content: [{ type: "text", text: summary }],
    structuredContent: { ...result },
  };
});

/**
 * Builds a per-row balance + USD computation from a raw bigint balance and an
 * optional price quote. Centralised so native + ERC-20 paths agree on shape.
 */
interface BuiltRow {
  balance: string;
  balanceUsd?: string;
  priceUnknown?: true;
  /** Numeric USD value used for dust-filtering and summing. Undefined when priceUnknown. */
  usdValue?: number;
}

function buildRow(
  rawBalance: bigint,
  decimals: number,
  formattedBalance: string,
  quote: PriceQuote | undefined,
): BuiltRow {
  if (!quote || quote.priceUnknown) {
    return { balance: formattedBalance, priceUnknown: true };
  }
  if (typeof quote.priceUsd !== "number") {
    return { balance: formattedBalance, priceUnknown: true };
  }
  // Compute via Number(formatUnits(...)) for presentation arithmetic. This is
  // intentionally lossy at the cent level — USD is a UI string, not an
  // invariant. The on-chain bigint balance remains authoritative; the
  // formatted decimal balance is what crosses the API boundary.
  const balanceFloat = Number(formatUnits(rawBalance, decimals));
  const usdValue = balanceFloat * quote.priceUsd;
  return {
    balance: formattedBalance,
    balanceUsd: formatUsd(usdValue),
    usdValue,
  };
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "0.00";
  // Two decimals — cents. Sub-cent precision is presentation noise.
  return value.toFixed(2);
}
