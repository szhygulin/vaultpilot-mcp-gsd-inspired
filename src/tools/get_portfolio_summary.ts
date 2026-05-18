import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import {
  formatTokenBalance,
  scanErc20Balances,
  type TokenBalance,
} from "../chains/erc20-scanner.js";
import {
  chainIdFromName,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { getPrices, type PriceCoin, type PriceQuote } from "../pricing/defillama.js";
import { registerTool } from "./index.js";

const NATIVE_DECIMALS = 18;
const DEFAULT_DUST_THRESHOLD_USD = 0.01;
const PER_CHAIN_TIMEOUT_MS = 10_000; // A9 mitigation (research § Topic 4) — viem default may exceed MCP response budget

const ALL_CHAINS: readonly ChainName[] = [
  "ethereum",
  "arbitrum",
  "polygon",
  "base",
  "optimism",
] as const;

const CHAIN_ENUM: readonly string[] = [...ALL_CHAINS];

/**
 * Per-chain native-asset pricing proxy. DefiLlama prices ERC-20 contracts;
 * native gas tokens have no contract address but the canonical wrapper is a
 * 1:1 proxy that DefiLlama prices identically.
 *
 *  - ethereum / arbitrum / base / optimism: native ETH → WETH wrapper
 *    (`getWethAddress(chainId)` is the SOT, mainnet WETH9 + the chain
 *    bridge variants).
 *  - polygon: native MATIC → WMATIC wrapper at `0x0d50…1270` (the WETH
 *    typed slot for Polygon in `src/config/contracts.ts` is the BRIDGED WETH
 *    address, which is the wrong pricing proxy for MATIC).
 */
const NATIVE_PRICING_PROXY: Record<ChainName, Address> = {
  ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH9
  arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH on Arbitrum
  polygon: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC (native MATIC proxy)
  base: "0x4200000000000000000000000000000000000006", // OP-Stack WETH predeploy
  optimism: "0x4200000000000000000000000000000000000006", // OP-Stack WETH predeploy
};

const DESCRIPTION = [
  "Read a complete EVM portfolio for one wallet — native balance plus the wallet's holdings across the top-50 ERC-20 tokens by trading volume — and aggregate USD values via DefiLlama pricing.",
  "When `chain` is omitted, fans out across all 5 supported chains (ethereum, arbitrum, polygon, base, optimism) via `Promise.allSettled` with a per-chain 10s timeout — a slow chain never blocks the whole response, and failed chains surface in `chainErrors` rather than poisoning the result.",
  "When `chain` is provided, returns ONLY that chain's portfolio in the single-chain shape (back-compat with single-chain callers).",
  "Use this when the user asks for an overview of their on-chain wealth (\"what do I hold\", \"show me my portfolio\", \"how much is my wallet worth\") — NOT for single-token reads (use `get_token_balance` for that) and NOT for transaction history (no tool yet).",
  "Single-chain result: a `nativeBalance` row, an `erc20Balances` array (one row per non-dust holding) tagged with the chain, `totalUsd` summed over rows with known prices, and an optional `rpcDegraded` flag when the public RPC fallback is in use.",
  "Cross-chain result: `perChain: { ethereum?, arbitrum?, polygon?, base?, optimism? }` keyed by chain name (each entry is the single-chain shape); `chainErrors: Array<{chain, reason}>` for any chain whose RPC failed or timed out; `totalUsd` summed across SUCCESSFUL legs only (failed legs do NOT contribute zero — they're absent from the sum, named in `chainErrors`).",
  "Every balance row carries an explicit `chain` field so the agent can safely flatten cross-chain rows without losing per-chain context — never attribute a balance by symbol alone.",
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
    chain: {
      type: "string",
      enum: CHAIN_ENUM,
      description: "OPTIONAL. EVM chain to query. Omit to fan out across all 5 chains via Promise.allSettled (per-chain 10s timeout; partial-result aware). Pass one of ethereum/arbitrum/polygon/base/optimism for a single-chain query.",
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
  chain: ChainName;
  balance: string;
  balanceUsd?: string;
  priceUnknown?: true;
}

interface Erc20BalanceRow {
  chain: ChainName;
  tokenAddress: Address;
  symbol: string;
  decimals: number;
  balance: string;
  balanceUsd?: string;
  priceUnknown?: true;
  error?: string;
}

interface ChainPortfolio {
  chain: ChainName;
  nativeBalance: NativeBalanceRow;
  erc20Balances: Erc20BalanceRow[];
  totalUsd: string;
  rpcDegraded?: boolean;
}

interface CrossChainPortfolioResult {
  perChain: Partial<Record<ChainName, ChainPortfolio>>;
  chainErrors: Array<{ chain: ChainName; reason: string }>;
  totalUsd: string;
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

  // Chain arg validation: when present, MUST be a ChainName. The JSON-schema
  // enum at the dispatch boundary catches invalid values; this is defense in
  // depth for handlers invoked outside MCP dispatch (e.g. integration tests).
  const chainArgRaw = args.chain;
  let chainArg: ChainName | undefined;
  if (chainArgRaw !== undefined) {
    if (typeof chainArgRaw !== "string" || !ALL_CHAINS.includes(chainArgRaw as ChainName)) {
      return {
        content: [{ type: "text", text: `error: \`chain\` must be one of ${ALL_CHAINS.join(", ")}` }],
        isError: true,
      };
    }
    chainArg = chainArgRaw as ChainName;
  }

  const wallet: Address = getAddress(walletRaw);

  // SINGLE-CHAIN branch: caller specified `chain`. Existing per-chain logic
  // wrapped in the per-chain 10s timeout for response-budget safety.
  if (chainArg !== undefined) {
    try {
      const portfolio = await readChainPortfolioWithTimeout(chainArg, wallet, dustThreshold);
      const erc20Count = portfolio.erc20Balances.length;
      const summary = `wallet ${wallet} on ${chainArg}: ${portfolio.nativeBalance.balance} (native) + ${erc20Count} ERC-20 row${erc20Count === 1 ? "" : "s"} = ~$${portfolio.totalUsd} USD${portfolio.rpcDegraded ? " (rpcDegraded)" : ""}`;
      return {
        content: [{ type: "text", text: summary }],
        structuredContent: { ...portfolio },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `error: failed to read ${chainArg} portfolio for ${wallet}: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }

  // CROSS-CHAIN branch: chain OMITTED. Fan out across all 5 chains via
  // Promise.allSettled — each leg succeeds or fails independently; one
  // chain's RPC flake never poisons the whole response. The per-chain 10s
  // timeout (A9 mitigation) bounds total response latency to ~10s + the
  // parallel-execution overhead.
  const results = await Promise.allSettled(
    ALL_CHAINS.map((c) => readChainPortfolioWithTimeout(c, wallet, dustThreshold)),
  );

  const perChain: Partial<Record<ChainName, ChainPortfolio>> = {};
  const chainErrors: Array<{ chain: ChainName; reason: string }> = [];
  let totalUsdNum = 0;

  for (let i = 0; i < results.length; i++) {
    const chain = ALL_CHAINS[i]!;
    const r = results[i]!;
    if (r.status === "fulfilled") {
      perChain[chain] = r.value;
      const legUsd = parseFloat(r.value.totalUsd);
      if (Number.isFinite(legUsd)) totalUsdNum += legUsd;
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      chainErrors.push({ chain, reason });
    }
  }

  const result: CrossChainPortfolioResult = {
    perChain,
    chainErrors,
    totalUsd: formatUsd(totalUsdNum),
  };

  const summary = renderCrossChainSummary(wallet, result);
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: { ...result },
  };
});

/**
 * Wraps {@link readChainPortfolio} in a `Promise.race` against an
 * `AbortController` 10s timeout. A chain whose RPC hangs beyond
 * `PER_CHAIN_TIMEOUT_MS` rejects with `Error("timeout after 10000ms")` — the
 * caller's `Promise.allSettled` surfaces this as a `chainErrors` row rather
 * than blocking the whole cross-chain response.
 *
 * Implementation note: the `AbortController` is intentionally not threaded
 * into the underlying viem RPC calls — viem doesn't accept abort signals on
 * `getBalance`/`multicall` (yet). The leg's promise will continue running in
 * the background after the race rejects; we accept the wasted RPC call as
 * the price of bounded response latency. The next call's cache hits and the
 * memoised PublicClient avoid leaking accumulated state.
 */
async function readChainPortfolioWithTimeout(
  chain: ChainName,
  wallet: Address,
  dustThreshold: number,
): Promise<ChainPortfolio> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PER_CHAIN_TIMEOUT_MS);
  try {
    return await Promise.race<ChainPortfolio>([
      readChainPortfolio(chain, wallet, dustThreshold),
      new Promise<ChainPortfolio>((_, reject) => {
        abort.signal.addEventListener("abort", () => {
          reject(new Error(`timeout after ${PER_CHAIN_TIMEOUT_MS}ms`));
        });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Single-chain portfolio read. Mirrors the Phase 2 logic, now per-chain
 * (Plan 08-03): chainIdFromName(chain) drives client + WETH-pricing-proxy +
 * registry resolution. PriceCoin[] is passed directly to getPrices (no
 * back-compat Address[] adapter on this code path — per-chain pricing is the
 * load-bearing widening).
 */
async function readChainPortfolio(
  chain: ChainName,
  wallet: Address,
  dustThreshold: number,
): Promise<ChainPortfolio> {
  const chainId: ChainId = chainIdFromName(chain);
  const client = getChainClient(chainId);
  const nativeProxy: Address = NATIVE_PRICING_PROXY[chain];

  const [nativeBalanceRaw, erc20Balances] = await Promise.all([
    client.getBalance({ address: wallet }),
    scanErc20Balances(wallet, undefined, chainId),
  ]);

  // Pricing list: per-chain native pricing proxy (NATIVE_PRICING_PROXY table
  // above — WETH wrapper for ETH-pegged chains, WMATIC for Polygon) + every
  // ERC-20 with a non-zero balance. PriceCoin shape uses chain+address so
  // DefiLlama queries the right per-chain price set.
  const erc20WithBalance = erc20Balances.filter(
    (row) => row.balance > 0n && row.error === undefined,
  );
  const priceCoins: PriceCoin[] = [
    { chain, address: nativeProxy },
    ...erc20WithBalance.map((row) => ({ chain, address: row.token.address })),
  ];
  const prices = await getPrices(priceCoins);

  // Native row.
  const nativeBalance = formatUnits(nativeBalanceRaw, NATIVE_DECIMALS);
  const ethQuote = prices.get(nativeProxy);
  const nativeRow = buildRow(nativeBalanceRaw, NATIVE_DECIMALS, nativeBalance, ethQuote);
  const nativeOut: NativeBalanceRow = { chain, balance: nativeRow.balance };
  if (nativeRow.balanceUsd !== undefined) nativeOut.balanceUsd = nativeRow.balanceUsd;
  if (nativeRow.priceUnknown) nativeOut.priceUnknown = true;

  // ERC-20 rows.
  const erc20Out: Erc20BalanceRow[] = [];
  let totalUsd = 0;
  if (nativeRow.usdValue !== undefined) totalUsd += nativeRow.usdValue;

  for (const row of erc20Balances) {
    // Always preserve error rows — caller needs to see per-token RPC failures.
    if (row.error !== undefined) {
      erc20Out.push({
        chain,
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

    if (
      dustThreshold > 0 &&
      built.usdValue !== undefined &&
      built.usdValue < dustThreshold
    ) {
      continue;
    }

    const out: Erc20BalanceRow = {
      chain,
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

  // Native dust-filter — same symmetry as the ERC-20 path. priceUnknown
  // native (rare on ETH-pegged chains) is preserved.
  const includeNative =
    nativeBalanceRaw > 0n &&
    !(
      dustThreshold > 0 &&
      nativeRow.usdValue !== undefined &&
      nativeRow.usdValue < dustThreshold
    );

  const finalNative: NativeBalanceRow = includeNative
    ? nativeOut
    : { chain, balance: nativeBalance };
  let adjustedTotal = totalUsd;
  if (!includeNative && nativeRow.usdValue !== undefined) {
    adjustedTotal -= nativeRow.usdValue;
  }

  const result: ChainPortfolio = {
    chain,
    nativeBalance: finalNative,
    erc20Balances: erc20Out,
    totalUsd: formatUsd(adjustedTotal),
  };
  if (isPublicNodeFallback(chainId)) result.rpcDegraded = true;
  return result;
}

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
  return value.toFixed(2);
}

/**
 * Cross-chain chat-friendly summary text. Lists each succeeded chain's
 * totalUsd + erc20 row count + rpcDegraded flag, then names every failed
 * chain with its reason. Format matches research § Topic 4's chat-render
 * shape — agents render this verbatim or summarize further.
 */
function renderCrossChainSummary(
  wallet: Address,
  result: CrossChainPortfolioResult,
): string {
  const lines: string[] = [];
  const succeeded = Object.keys(result.perChain) as ChainName[];
  lines.push(
    `wallet ${wallet} across 5 chains: ~$${result.totalUsd} USD total (${succeeded.length} chain${succeeded.length === 1 ? "" : "s"} succeeded, ${result.chainErrors.length} failed)`,
  );
  for (const chain of ALL_CHAINS) {
    const portfolio = result.perChain[chain];
    if (!portfolio) continue;
    const count = portfolio.erc20Balances.length;
    const degraded = portfolio.rpcDegraded ? " (rpcDegraded)" : "";
    lines.push(
      `  ${chain}: ${portfolio.nativeBalance.balance} (native) + ${count} ERC-20 row${count === 1 ? "" : "s"} = ~$${portfolio.totalUsd}${degraded}`,
    );
  }
  for (const { chain, reason } of result.chainErrors) {
    lines.push(`  ${chain}: FAILED — ${reason}`);
  }
  return lines.join("\n");
}
