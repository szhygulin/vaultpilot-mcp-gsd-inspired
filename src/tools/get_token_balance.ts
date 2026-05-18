import { type Address, erc20Abi, formatUnits, getAddress, isAddress } from "viem";

import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { chainIdFromName, type ChainName } from "../config/contracts.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Read a single ERC-20 token balance for one wallet on a supported EVM chain, returning the on-chain `balanceOf` result formatted as a decimal string alongside the token's `decimals` and `symbol`.",
  "Use this when the user asks about a specific token by contract address (e.g. \"what's my USDC balance\" once you have the USDC contract address) — NOT for full-portfolio scans (use `get_portfolio_summary` for that) and NOT when you only know the symbol (resolve the contract address first).",
  "`chain` is REQUIRED — pass one of ethereum, arbitrum, polygon, base, optimism. No default; omitting refuses at the dispatch boundary.",
  "USD valuation is OPTIONAL: `balanceUsd` and `priceUnknown` are populated only once the pricing layer is wired; until then both are absent and the response is balance-only.",
  "Decimal strings cross the boundary, never numbers — preserves precision for downstream signing flows.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description:
        "Chain identifier (required). Supported: ethereum, arbitrum, polygon, base, optimism.",
    },
    wallet: {
      type: "string",
      description: "Wallet address to query (0x-prefixed, 40 hex chars). Mixed case accepted; checksum is normalized.",
      pattern: "^0x[0-9a-fA-F]{40}$",
    },
    tokenAddress: {
      type: "string",
      description: "ERC-20 token contract address (0x-prefixed, 40 hex chars). Mixed case accepted.",
      pattern: "^0x[0-9a-fA-F]{40}$",
    },
  },
  required: ["chain", "wallet", "tokenAddress"],
  additionalProperties: false,
};

interface TokenBalanceResult {
  balance: string;
  decimals: number;
  symbol: string;
  balanceUsd?: string;
  priceUnknown?: boolean;
  rpcDegraded?: boolean;
}

registerTool("get_token_balance", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // Phase 8 — Plan 08-02: chainId from the agent's `chain` enum.
  const chainName = args.chain as ChainName;
  const chainId = chainIdFromName(chainName);

  const walletRaw = args.wallet;
  const tokenRaw = args.tokenAddress;
  if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
    return {
      content: [{ type: "text", text: "error: `wallet` must be a valid 0x-prefixed Ethereum address" }],
      isError: true,
    };
  }
  if (typeof tokenRaw !== "string" || !isAddress(tokenRaw, { strict: false })) {
    return {
      content: [{ type: "text", text: "error: `tokenAddress` must be a valid 0x-prefixed Ethereum address" }],
      isError: true,
    };
  }
  const wallet: Address = getAddress(walletRaw);
  const tokenAddress: Address = getAddress(tokenRaw);

  const client = getChainClient(chainId);

  try {
    const [balanceRaw, decimals, symbol] = await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet],
      }),
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      client.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "symbol",
      }),
    ]);

    const balance = formatUnits(balanceRaw, decimals);
    const result: TokenBalanceResult = { balance, decimals, symbol };
    if (isPublicNodeFallback(chainId)) result.rpcDegraded = true;

    return {
      content: [
        {
          type: "text",
          text: `${wallet} holds ${balance} ${symbol} (token ${tokenAddress}, decimals=${decimals})`,
        },
      ],
      structuredContent: { ...result },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `error: failed to read ERC-20 balance for ${wallet} @ ${tokenAddress}: ${message}`,
        },
      ],
      isError: true,
    };
  }
});
