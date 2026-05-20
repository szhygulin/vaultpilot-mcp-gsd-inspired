import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import {
  formatTokenBalance,
  scanErc20Balances,
  type TokenBalance,
} from "../chains/erc20-scanner.js";
import {
  getNativeBalance as getSolanaNativeBalance,
  getMintDecimals as getSolanaMintDecimals,
  getSplTokenAccounts,
} from "../chains/solana/sol-rpc-client.js";
import {
  getNativeBalance as getTronNativeBalance,
  getTrc20Balance,
} from "../chains/tron/tron-rpc-client.js";
import { isDemoMode } from "../config/env.js";
import {
  getActiveSolanaPersona,
  getActiveTronPersona,
} from "../demo/state.js";
import {
  chainIdFromName,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import {
  getPrices,
  getSolanaPrices,
  getTronPrices,
  type PriceCoin,
  type PriceQuote,
} from "../pricing/defillama.js";
import { findByMint as findSolanaTokenByMint } from "../tokens/solana-top-50.js";
import { listTronTokens } from "../tokens/tron-top-25.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

/**
 * Phase 11 Plan 11-05 — discriminated-union widening (research § Topic 9).
 *
 * `PortfolioChainName` is the widened domain for cross-chain rows: the
 * 5-EVM `ChainName` union + `"solana"`. The narrower `ChainName` stays the
 * SOT for EVM-only call sites (per-chain client factory, registry, contracts
 * SOT); the wider type lives here as a tool-local widening so we don't
 * pollute `src/config/contracts.ts` with non-EVM rows.
 *
 * Solana rows carry `chain: "solana"` + base58 `tokenAddress` (mint).
 * EVM rows continue carrying `chain: ChainName` + hex `tokenAddress`. The
 * `chain` discriminator is load-bearing for the agent's flatten-and-aggregate
 * (Phase 8 retro).
 */
export type PortfolioChainName = ChainName | "solana" | "tron";

/**
 * Wrapped SOL mint — DefiLlama's canonical native-SOL pricing proxy. Prices
 * identically to native SOL on the DefiLlama API (research § Topic 7). The
 * `NATIVE_PRICING_PROXY` table below maps `"solana" → WRAPPED_SOL_MINT`
 * for symmetry with the WETH-per-chain entries.
 */
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Wrapped TRX (WTRX) — DefiLlama's canonical native-TRX pricing proxy.
 * Prices identically to native TRX on the DefiLlama API (research § Topic 6
 * + § Topic 7). The `NATIVE_PRICING_PROXY` table below maps
 * `"tron" → WRAPPED_TRX_CONTRACT` for symmetry with WETH-per-chain + wSOL
 * entries. WTRX itself is 6 decimals (NOT 9 like wSOL; NOT 18 like WETH) —
 * TRX uses 6 decimals protocol-wide.
 */
const WRAPPED_TRX_CONTRACT = "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR";

/** TRX has 6 decimals (sun-per-TRX = 1_000_000), distinct from EVM's 18. */
const TRX_NATIVE_DECIMALS = 6;

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
const NATIVE_PRICING_PROXY: Record<PortfolioChainName, string> = {
  ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH9
  arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH on Arbitrum
  polygon: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", // WMATIC (native MATIC proxy)
  base: "0x4200000000000000000000000000000000000006", // OP-Stack WETH predeploy
  optimism: "0x4200000000000000000000000000000000000006", // OP-Stack WETH predeploy
  solana: WRAPPED_SOL_MINT, // wSOL — DefiLlama prices identically to native SOL (research § Topic 7)
  tron: WRAPPED_TRX_CONTRACT, // WTRX — DefiLlama prices identically to native TRX (research § Topic 6 + § Topic 7)
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
    includeSolana: {
      type: "boolean",
      description: "OPTIONAL. Phase 11 — Solana leg in the cross-chain fan-out. Default `true` when a Solana address is resolvable (paired record from `pair_solana_ledger`, OR active Solana demo persona). Set `false` to request EVM-only fan-out (back-compat). The Solana leg uses the resolved base58 address, NOT the agent's EVM `wallet` arg.",
    },
    includeTron: {
      type: "boolean",
      description: "OPTIONAL. Phase 17 — TRON leg in the cross-chain fan-out. Default `true` when a TRON address is resolvable (paired record from `pair_tron_ledger`, OR active TRON demo persona). Set `false` to request EVM+Solana-only fan-out (back-compat). The TRON leg uses the resolved base58check address, NOT the agent's EVM `wallet` arg.",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

interface NativeBalanceRow {
  chain: PortfolioChainName;
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

/**
 * Phase 11 Plan 11-05 — discriminated-union row shape (research § Topic 9).
 *
 * Replaces the EVM-locked `Erc20BalanceRow` for cross-chain consumers:
 *
 *   - `chain: ChainName` — `tokenAddress` is a 0x-prefixed `Address`
 *     (EVM ERC-20 contract).
 *   - `chain: "solana"` — `tokenAddress` is a base58 SPL mint string.
 *     `symbolUnknown: true` surfaces for mints outside the curated top-50
 *     SPL registry.
 *
 * EVM `ChainPortfolio` rows emit BOTH `erc20Balances` (deprecated alias,
 * byte-identical to v1.x shape) AND `fungibleBalances` (new wider field) for
 * one phase — agent consumers that flatten cross-chain rows migrate to the
 * wider field; v1.x agent consumers continue working unchanged. Phase 13's
 * verify-phase deletes the deprecated alias.
 *
 * Solana `ChainPortfolio` rows emit ONLY `fungibleBalances` (no
 * `erc20Balances` — the name would mislead on a non-EVM chain).
 */
interface FungibleBalanceRow {
  chain: PortfolioChainName;
  /** EVM: 0x-prefixed hex Address. Solana: base58 SPL mint string. */
  tokenAddress: string;
  symbol: string;
  decimals: number;
  balance: string;
  balanceUsd?: string;
  priceUnknown?: true;
  /** Solana mints outside the curated top-50 registry. */
  symbolUnknown?: true;
  error?: string;
}

interface ChainPortfolio {
  chain: ChainName;
  nativeBalance: NativeBalanceRow;
  /** DEPRECATED: kept for v1.x agent back-compat (Phase 13 verify-phase deletes). Use `fungibleBalances`. */
  erc20Balances: Erc20BalanceRow[];
  /** Cross-chain row shape (Phase 11). Byte-identical content to `erc20Balances` on EVM chains. */
  fungibleBalances: FungibleBalanceRow[];
  totalUsd: string;
  rpcDegraded?: boolean;
}

interface SolanaChainPortfolio {
  chain: "solana";
  nativeBalance: NativeBalanceRow;
  fungibleBalances: FungibleBalanceRow[];
  totalUsd: string;
  rpcDegraded?: boolean;
}

/**
 * Phase 17 Plan 17-04 — TRON portfolio shape. Parallel to
 * {@link SolanaChainPortfolio} (no `erc20Balances` deprecated alias — the
 * name would mislead on a non-EVM chain). Native is TRX (6 decimals);
 * fungible rows are TRC-20 contracts from `tron-top-25` registry.
 *
 * The `rpcDegraded` flag is reserved here for parity with the EVM /
 * Solana shapes; Phase 17 doesn't expose a TronGrid fallback yet, so the
 * field is always undefined for now. v2.1.x may wire a TronGrid /
 * NowNodes / TronStack failover and surface the degraded flag here.
 */
interface TronChainPortfolio {
  chain: "tron";
  nativeBalance: NativeBalanceRow;
  fungibleBalances: FungibleBalanceRow[];
  totalUsd: string;
  rpcDegraded?: boolean;
}

type AnyChainPortfolio =
  | ChainPortfolio
  | SolanaChainPortfolio
  | TronChainPortfolio;

interface CrossChainPortfolioResult {
  perChain: Partial<Record<PortfolioChainName, AnyChainPortfolio>>;
  chainErrors: Array<{ chain: PortfolioChainName; reason: string }>;
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

  // includeSolana validation — defense in depth for non-MCP-dispatch callers.
  const includeSolanaRaw = args.includeSolana;
  let includeSolana = true;
  if (includeSolanaRaw !== undefined) {
    if (typeof includeSolanaRaw !== "boolean") {
      return {
        content: [{ type: "text", text: "error: `includeSolana` must be a boolean" }],
        isError: true,
      };
    }
    includeSolana = includeSolanaRaw;
  }

  // includeTron validation — defense in depth for non-MCP-dispatch callers.
  const includeTronRaw = args.includeTron;
  let includeTron = true;
  if (includeTronRaw !== undefined) {
    if (typeof includeTronRaw !== "boolean") {
      return {
        content: [{ type: "text", text: "error: `includeTron` must be a boolean" }],
        isError: true,
      };
    }
    includeTron = includeTronRaw;
  }

  // CROSS-CHAIN branch: chain OMITTED. Fan out across all 5 EVM chains via
  // Promise.allSettled — each leg succeeds or fails independently; one
  // chain's RPC flake never poisons the whole response. The per-chain 10s
  // timeout (A9 mitigation) bounds total response latency to ~10s + the
  // parallel-execution overhead.
  //
  // Phase 11 Plan 11-05: + Solana leg, gated on `includeSolana` arg AND
  // `resolveSolanaWalletForFanOut()` returning non-null (paired record
  // first; demo persona second per 11-PLAN-CHECK § FLAG-3). Silent skip
  // when no Solana address resolves — matches "no chain configured" EVM
  // behavior; does NOT surface in `chainErrors`.
  const solanaWallet = includeSolana ? resolveSolanaWalletForFanOut() : null;
  const tronWallet = includeTron ? resolveTronWalletForFanOut() : null;

  const evmResults = await Promise.allSettled(
    ALL_CHAINS.map((c) => readChainPortfolioWithTimeout(c, wallet, dustThreshold)),
  );
  const solanaResult = solanaWallet
    ? await Promise.allSettled([readSolanaPortfolioWithTimeout(solanaWallet, dustThreshold)])
    : null;
  const tronResult = tronWallet
    ? await Promise.allSettled([readTronPortfolioWithTimeout(tronWallet, dustThreshold)])
    : null;

  const perChain: Partial<Record<PortfolioChainName, AnyChainPortfolio>> = {};
  const chainErrors: Array<{ chain: PortfolioChainName; reason: string }> = [];
  let totalUsdNum = 0;

  for (let i = 0; i < evmResults.length; i++) {
    const chain = ALL_CHAINS[i]!;
    const r = evmResults[i]!;
    if (r.status === "fulfilled") {
      perChain[chain] = r.value;
      const legUsd = parseFloat(r.value.totalUsd);
      if (Number.isFinite(legUsd)) totalUsdNum += legUsd;
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      chainErrors.push({ chain, reason });
    }
  }

  if (solanaResult) {
    const r = solanaResult[0]!;
    if (r.status === "fulfilled") {
      perChain.solana = r.value;
      const legUsd = parseFloat(r.value.totalUsd);
      if (Number.isFinite(legUsd)) totalUsdNum += legUsd;
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      chainErrors.push({ chain: "solana", reason });
    }
  }

  if (tronResult) {
    const r = tronResult[0]!;
    if (r.status === "fulfilled") {
      perChain.tron = r.value;
      const legUsd = parseFloat(r.value.totalUsd);
      if (Number.isFinite(legUsd)) totalUsdNum += legUsd;
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      chainErrors.push({ chain: "tron", reason });
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
  const nativeProxy: Address = NATIVE_PRICING_PROXY[chain] as Address;

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

  // Phase 11 — discriminated-union widening. EVM rows emit BOTH
  // `erc20Balances` (DEPRECATED alias, byte-identical content) AND
  // `fungibleBalances` (new wider field). Byte-identical means: same
  // tokenAddress, symbol, decimals, balance, balanceUsd, priceUnknown,
  // error — only the type widens from `Erc20BalanceRow` → `FungibleBalanceRow`.
  // Phase 13 verify-phase deletes the deprecated alias.
  const fungibleOut: FungibleBalanceRow[] = erc20Out.map((row) => {
    const r: FungibleBalanceRow = {
      chain: row.chain,
      tokenAddress: row.tokenAddress,
      symbol: row.symbol,
      decimals: row.decimals,
      balance: row.balance,
    };
    if (row.balanceUsd !== undefined) r.balanceUsd = row.balanceUsd;
    if (row.priceUnknown) r.priceUnknown = true;
    if (row.error !== undefined) r.error = row.error;
    return r;
  });

  const result: ChainPortfolio = {
    chain,
    nativeBalance: finalNative,
    erc20Balances: erc20Out,
    fungibleBalances: fungibleOut,
    totalUsd: formatUsd(adjustedTotal),
  };
  if (isPublicNodeFallback(chainId)) result.rpcDegraded = true;
  return result;
}

/**
 * Phase 11 Plan 11-05 — Solana fan-out address resolver (per 11-PLAN-CHECK
 * § FLAG-3). Two-source resolution:
 *
 *   (1) REAL-MODE FIRST — paired Solana record from Plan 11-01's account
 *       store (`listAccounts({ chainFilter: "solana" })[0]`). When the user
 *       has paired a Ledger Solana account via `pair_solana_ledger`, the
 *       fan-out targets that address.
 *   (2) DEMO-MODE FALLBACK — `getActiveSolanaPersona()?.solanaAddress`
 *       from Plan 11-06's persona registry. Only consulted when no paired
 *       record exists AND `isDemoMode() === true`. Demo mode never has a
 *       paired record (Plan 11-04's `pair_solana_ledger` refuses with
 *       `DEMO_MODE_REFUSED`); without this fallback, the Solana leg would
 *       silently skip in demo, breaking Phase 11 Plan 11-06's "demo-mode
 *       Solana reads against real RPC" claim (CONTEXT.md `<decisions>`).
 *
 * Returns the resolved base58 address, or `null` if neither source applies
 * (real mode + no pair → silent skip, matching the "no chain configured"
 * EVM behavior).
 *
 * The resolver does NOT take the agent's `wallet` arg as input — the EVM
 * `wallet` is 0x-prefixed hex, which is not a Solana address. The Solana
 * leg fans out against a SEPARATE address sourced from the account store
 * or persona registry.
 */
function resolveSolanaWalletForFanOut(): string | null {
  // Real-mode first: paired record from Plan 11-01's store.
  const paired = listAccounts({ chainFilter: "solana" });
  if (paired.length > 0 && paired[0]) return paired[0].address;
  // Demo-mode fallback: active Solana persona from Plan 11-06.
  if (isDemoMode()) {
    const persona = getActiveSolanaPersona();
    if (persona) return persona.solanaAddress;
  }
  return null;
}

/**
 * Phase 11 Plan 11-05 — Solana per-chain portfolio reader. Mirrors the
 * EVM `readChainPortfolio` shape: native balance + fungible-token discovery +
 * DefiLlama pricing + dust filter + row aggregation.
 *
 * **D-7 LOAD-BEARING (research § Topic 5):** SPL discovery via
 * `getSplTokenAccounts` (UNPARSED `getTokenAccountsByOwner` under the hood
 * — the parsed RPC method is rejected by `api.mainnet-beta.solana.com`).
 *
 * Symbol resolution: curated top-50 registry first; on-demand
 * `getMintDecimals` fallback for off-list mints (symbol stays
 * `symbolUnknown: true`).
 *
 * Pricing: `getSolanaPrices([mint, mint, ...])` — batched DefiLlama lookup
 * via `solana:<mint>` keying. Native SOL prices via the wSOL proxy
 * (`So111...1112`) — DefiLlama prices it identically to native SOL.
 */
async function readSolanaPortfolio(
  solanaWallet: string,
  dustThreshold: number,
): Promise<SolanaChainPortfolio> {
  // Native + SPL discovery in parallel.
  const [nativeRes, accounts] = await Promise.all([
    getSolanaNativeBalance(solanaWallet),
    getSplTokenAccounts(solanaWallet),
  ]);

  // Filter to non-zero SPL accounts. Zero-balance accounts (closed but
  // un-burned) are dropped to match the EVM `row.balance === 0n` filter.
  const nonZero = accounts.filter((row) => row.amount > 0n);

  // Resolve decimals + symbols per mint. Registry hits are free; off-list
  // mints get an on-demand `getMintDecimals` call (parallelized).
  type ResolvedRow = {
    mint: string;
    amount: bigint;
    decimals: number;
    symbol: string;
    symbolUnknown: boolean;
  };
  const resolved: ResolvedRow[] = await Promise.all(
    nonZero.map(async (row) => {
      const entry = findSolanaTokenByMint(row.mint);
      if (entry) {
        return {
          mint: row.mint,
          amount: row.amount,
          decimals: entry.decimals,
          symbol: entry.symbol,
          symbolUnknown: false,
        };
      }
      // Off-list mint — on-demand decimals lookup. Symbol stays unknown
      // (Metaplex Token Metadata is Phase 13+).
      const decimals = await getSolanaMintDecimals(row.mint);
      return {
        mint: row.mint,
        amount: row.amount,
        decimals,
        symbol: `${row.mint.slice(0, 4)}...${row.mint.slice(-4)}`,
        symbolUnknown: true,
      };
    }),
  );

  // Batched price lookup — wSOL (native proxy) + every non-zero mint.
  const allMints = [WRAPPED_SOL_MINT, ...resolved.map((r) => r.mint)];
  const prices = await getSolanaPrices(allMints);

  // Native row.
  const solBalance = nativeRes.sol;
  const wsolQuote = prices.get(WRAPPED_SOL_MINT);
  const nativeRow = buildRow(nativeRes.lamports, 9, solBalance, wsolQuote);
  const nativeOut: NativeBalanceRow = { chain: "solana", balance: nativeRow.balance };
  if (nativeRow.balanceUsd !== undefined) nativeOut.balanceUsd = nativeRow.balanceUsd;
  if (nativeRow.priceUnknown) nativeOut.priceUnknown = true;

  // SPL rows.
  const fungibleOut: FungibleBalanceRow[] = [];
  let totalUsd = 0;
  if (nativeRow.usdValue !== undefined) totalUsd += nativeRow.usdValue;

  for (const row of resolved) {
    const balanceStr = formatUnits(row.amount, row.decimals);
    const quote = prices.get(row.mint);
    const built = buildRow(row.amount, row.decimals, balanceStr, quote);

    if (
      dustThreshold > 0 &&
      built.usdValue !== undefined &&
      built.usdValue < dustThreshold
    ) {
      continue;
    }

    const out: FungibleBalanceRow = {
      chain: "solana",
      tokenAddress: row.mint,
      symbol: row.symbol,
      decimals: row.decimals,
      balance: built.balance,
    };
    if (built.balanceUsd !== undefined) out.balanceUsd = built.balanceUsd;
    if (built.priceUnknown) out.priceUnknown = true;
    if (row.symbolUnknown) out.symbolUnknown = true;
    fungibleOut.push(out);

    if (built.usdValue !== undefined) totalUsd += built.usdValue;
  }

  // Native dust-filter — same symmetry as EVM path.
  const includeNative =
    nativeRes.lamports > 0n &&
    !(
      dustThreshold > 0 &&
      nativeRow.usdValue !== undefined &&
      nativeRow.usdValue < dustThreshold
    );
  const finalNative: NativeBalanceRow = includeNative
    ? nativeOut
    : { chain: "solana", balance: solBalance };
  let adjustedTotal = totalUsd;
  if (!includeNative && nativeRow.usdValue !== undefined) {
    adjustedTotal -= nativeRow.usdValue;
  }

  return {
    chain: "solana",
    nativeBalance: finalNative,
    fungibleBalances: fungibleOut,
    totalUsd: formatUsd(adjustedTotal),
  };
}

/**
 * Solana-leg timeout wrapper. Mirrors {@link readChainPortfolioWithTimeout}
 * — same 10s `PER_CHAIN_TIMEOUT_MS` AbortController + `Promise.race` shape.
 */
async function readSolanaPortfolioWithTimeout(
  solanaWallet: string,
  dustThreshold: number,
): Promise<SolanaChainPortfolio> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PER_CHAIN_TIMEOUT_MS);
  try {
    return await Promise.race<SolanaChainPortfolio>([
      readSolanaPortfolio(solanaWallet, dustThreshold),
      new Promise<SolanaChainPortfolio>((_, reject) => {
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
 * Phase 17 Plan 17-04 — TRON fan-out address resolver. Mirror of
 * {@link resolveSolanaWalletForFanOut}. Two-source resolution:
 *
 *   (1) REAL-MODE FIRST — paired TRON record from Plan 17-01's non-EVM
 *       account store (`listAccounts({ chainFilter: "tron" })[0]`). When
 *       the user has paired a Ledger TRON account via `pair_tron_ledger`,
 *       the fan-out targets that address.
 *   (2) DEMO-MODE FALLBACK — `getActiveTronPersona()?.tronAddress` from
 *       Plan 17-05's persona registry. Only consulted when no paired
 *       record exists AND `isDemoMode() === true`. Mirror of the Solana
 *       FLAG-3 fallback.
 *
 * Returns the resolved base58check address, or `null` if neither source
 * applies (real mode + no pair → silent skip, matching the "no chain
 * configured" EVM behavior; does NOT surface in `chainErrors`).
 *
 * The resolver does NOT take the agent's `wallet` arg as input — the EVM
 * `wallet` is 0x-prefixed hex, which is not a TRON address. The TRON leg
 * fans out against a SEPARATE address sourced from the account store or
 * persona registry.
 */
function resolveTronWalletForFanOut(): string | null {
  // Real-mode first: paired record from Plan 17-01's account store.
  const paired = listAccounts({ chainFilter: "tron" });
  if (paired.length > 0 && paired[0]) return paired[0].address;
  // Demo-mode fallback: active TRON persona (Plan 17-04 carve in state.ts;
  // Plan 17-05 lands the full registry + setter wiring via set_demo_wallet).
  if (isDemoMode()) {
    const persona = getActiveTronPersona();
    if (persona) return persona.tronAddress;
  }
  return null;
}

/**
 * Phase 17 Plan 17-04 — TRON per-chain portfolio reader. Mirror of
 * {@link readSolanaPortfolio} shape: native balance + curated TRC-20
 * registry scan + DefiLlama pricing + dust filter + row aggregation.
 *
 * **NOT a per-token discovery scan** — TRON has no `getTokenAccountsByOwner`
 * RPC analog (each TRC-20 contract is independent; balance is read by
 * calling `balanceOf(wallet)` on each contract). We iterate the curated
 * `tron-top-25` registry and call `balanceOf` per entry, then filter
 * zero-balance rows. Off-list TRC-20 holdings are NOT surfaced in the
 * portfolio leg — agent can call `get_tron_token_balance` directly with
 * a known contract address for off-registry tokens.
 *
 * Per-token RPC failures don't abort the leg — the failing row carries
 * an `error` field, exactly like the EVM `erc20-scanner.ts` shape. The
 * `Promise.allSettled` outside this function catches whole-leg failures
 * (e.g. RPC outage) and surfaces them as `chainErrors`.
 *
 * Pricing: `getTronPrices([WTRX, ...contract_addrs])` — batched DefiLlama
 * lookup via `tron:<base58check>` keying. Native TRX prices via the WTRX
 * proxy — DefiLlama prices it identically to native TRX.
 */
async function readTronPortfolio(
  tronWallet: string,
  dustThreshold: number,
): Promise<TronChainPortfolio> {
  // Native TRX balance + per-token TRC-20 reads in parallel. The TRC-20
  // reads are issued in parallel via `Promise.allSettled` so a single
  // contract's RPC failure (e.g. ABI mismatch) doesn't poison the leg.
  const registryEntries = listTronTokens();

  const [nativeRes, trc20Results] = await Promise.all([
    getTronNativeBalance(tronWallet),
    Promise.allSettled(
      registryEntries.map((e) =>
        getTrc20Balance(tronWallet, e.contractAddress),
      ),
    ),
  ]);

  // Build the resolved rows: registry entry + balance (or per-row error).
  type ResolvedRow = {
    contractAddress: string;
    symbol: string;
    decimals: number;
    amount: bigint;
    error?: string;
  };
  const resolved: ResolvedRow[] = trc20Results.map((r, i) => {
    const entry = registryEntries[i]!;
    if (r.status === "fulfilled") {
      return {
        contractAddress: entry.contractAddress,
        symbol: entry.symbol,
        decimals: entry.decimals,
        amount: r.value,
      };
    }
    return {
      contractAddress: entry.contractAddress,
      symbol: entry.symbol,
      decimals: entry.decimals,
      amount: 0n,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
    };
  });

  // Batched price lookup — WTRX (native proxy) + every curated contract.
  const allAddrs = [
    WRAPPED_TRX_CONTRACT,
    ...registryEntries.map((e) => e.contractAddress),
  ];
  const prices = await getTronPrices(allAddrs);

  // Native TRX row. WTRX serves as the pricing proxy (DefiLlama prices it
  // identically to native TRX).
  const wtrxQuote = prices.get(WRAPPED_TRX_CONTRACT);
  const nativeRow = buildRow(
    nativeRes.sun,
    TRX_NATIVE_DECIMALS,
    nativeRes.trx,
    wtrxQuote,
  );
  const nativeOut: NativeBalanceRow = {
    chain: "tron",
    balance: nativeRow.balance,
  };
  if (nativeRow.balanceUsd !== undefined) nativeOut.balanceUsd = nativeRow.balanceUsd;
  if (nativeRow.priceUnknown) nativeOut.priceUnknown = true;

  // TRC-20 rows.
  const fungibleOut: FungibleBalanceRow[] = [];
  let totalUsd = 0;
  if (nativeRow.usdValue !== undefined) totalUsd += nativeRow.usdValue;

  for (const row of resolved) {
    // Always preserve error rows — caller needs to see per-token RPC failures.
    if (row.error !== undefined) {
      fungibleOut.push({
        chain: "tron",
        tokenAddress: row.contractAddress,
        symbol: row.symbol,
        decimals: row.decimals,
        balance: formatTokenBalance(row.amount, row.decimals),
        error: row.error,
      });
      continue;
    }
    if (row.amount === 0n) continue; // Always drop true zeros.

    const balanceStr = formatTokenBalance(row.amount, row.decimals);
    const quote = prices.get(row.contractAddress);
    const built = buildRow(row.amount, row.decimals, balanceStr, quote);

    if (
      dustThreshold > 0 &&
      built.usdValue !== undefined &&
      built.usdValue < dustThreshold
    ) {
      continue;
    }

    const out: FungibleBalanceRow = {
      chain: "tron",
      tokenAddress: row.contractAddress,
      symbol: row.symbol,
      decimals: row.decimals,
      balance: built.balance,
    };
    if (built.balanceUsd !== undefined) out.balanceUsd = built.balanceUsd;
    if (built.priceUnknown) out.priceUnknown = true;
    fungibleOut.push(out);

    if (built.usdValue !== undefined) totalUsd += built.usdValue;
  }

  // Native dust-filter — same symmetry as EVM / Solana path.
  const includeNative =
    nativeRes.sun > 0n &&
    !(
      dustThreshold > 0 &&
      nativeRow.usdValue !== undefined &&
      nativeRow.usdValue < dustThreshold
    );
  const finalNative: NativeBalanceRow = includeNative
    ? nativeOut
    : { chain: "tron", balance: nativeRes.trx };
  let adjustedTotal = totalUsd;
  if (!includeNative && nativeRow.usdValue !== undefined) {
    adjustedTotal -= nativeRow.usdValue;
  }

  return {
    chain: "tron",
    nativeBalance: finalNative,
    fungibleBalances: fungibleOut,
    totalUsd: formatUsd(adjustedTotal),
  };
}

/**
 * TRON-leg timeout wrapper. Mirrors {@link readChainPortfolioWithTimeout}
 * and {@link readSolanaPortfolioWithTimeout} — same 10s
 * `PER_CHAIN_TIMEOUT_MS` AbortController + `Promise.race` shape.
 */
async function readTronPortfolioWithTimeout(
  tronWallet: string,
  dustThreshold: number,
): Promise<TronChainPortfolio> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PER_CHAIN_TIMEOUT_MS);
  try {
    return await Promise.race<TronChainPortfolio>([
      readTronPortfolio(tronWallet, dustThreshold),
      new Promise<TronChainPortfolio>((_, reject) => {
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
  const succeeded = Object.keys(result.perChain);
  lines.push(
    `wallet ${wallet} across 5 chains: ~$${result.totalUsd} USD total (${succeeded.length} chain${succeeded.length === 1 ? "" : "s"} succeeded, ${result.chainErrors.length} failed)`,
  );
  for (const chain of ALL_CHAINS) {
    const portfolio = result.perChain[chain] as ChainPortfolio | undefined;
    if (!portfolio) continue;
    const count = portfolio.erc20Balances.length;
    const degraded = portfolio.rpcDegraded ? " (rpcDegraded)" : "";
    lines.push(
      `  ${chain}: ${portfolio.nativeBalance.balance} (native) + ${count} ERC-20 row${count === 1 ? "" : "s"} = ~$${portfolio.totalUsd}${degraded}`,
    );
  }
  // Solana row — uses `fungibleBalances` count instead of `erc20Balances`.
  const solPortfolio = result.perChain.solana as SolanaChainPortfolio | undefined;
  if (solPortfolio) {
    const count = solPortfolio.fungibleBalances.length;
    const degraded = solPortfolio.rpcDegraded ? " (rpcDegraded)" : "";
    lines.push(
      `  solana: ${solPortfolio.nativeBalance.balance} (native) + ${count} SPL row${count === 1 ? "" : "s"} = ~$${solPortfolio.totalUsd}${degraded}`,
    );
  }
  // TRON row — same shape as Solana (no erc20Balances on non-EVM chains).
  const tronPortfolio = result.perChain.tron as TronChainPortfolio | undefined;
  if (tronPortfolio) {
    const count = tronPortfolio.fungibleBalances.length;
    const degraded = tronPortfolio.rpcDegraded ? " (rpcDegraded)" : "";
    lines.push(
      `  tron: ${tronPortfolio.nativeBalance.balance} (native) + ${count} TRC-20 row${count === 1 ? "" : "s"} = ~$${tronPortfolio.totalUsd}${degraded}`,
    );
  }
  for (const { chain, reason } of result.chainErrors) {
    lines.push(`  ${chain}: FAILED — ${reason}`);
  }
  return lines.join("\n");
}
