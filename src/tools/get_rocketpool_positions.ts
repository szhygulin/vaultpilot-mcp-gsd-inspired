// src/tools/get_rocketpool_positions.ts
//
// MCP tool: get_rocketpool_positions({ wallet, chain? }) — RP-01 (Phase 31 Plan 31-03).
//
// Reader for Rocket Pool rETH positions on Ethereum mainnet ONLY.
//
// Response shape (per CONTEXT.md D-11):
//   {
//     chain: "ethereum",
//     chainId: 1,
//     wallet,
//     rethBalance, rethBalanceHuman,
//     exchangeRate, exchangeRateHuman,
//     ethEquivalent, ethEquivalentHuman,
//     rpcDegraded?,
//   }
//
// Chain narrowing: ONLY "ethereum" at v2.3 (D-03). Other chains refuse with
// CHAIN_ID_MISMATCH (errorCode 15). v2.6 cross-chain rETH bridging is a
// separate milestone (BRIDGE-T1).
//
// Contrast with `get_lido_positions`:
//   - Lido is 2-chain (ethereum + arbitrum); Rocket Pool is 1-chain.
//   - Lido surfaces `approx: true` (rebase model). Rocket Pool does NOT
//     surface `approx` — rETH exchange rate is canonical at the read block.
//
// `rpcDegraded` surface (READ-05 invariant): `isPublicNodeFallback(chainId)`
// mirrors every other read tool in the codebase.

import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { _rocketPoolChains } from "../chains/rocketpool.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";

// ---------------------------------------------------------------------------
// Description + Input Schema
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  "Read Rocket Pool rETH positions for a wallet on Ethereum mainnet.",
  "Use when the user asks about Rocket Pool rETH positions, holdings, or accrued staking value (rETH is a non-rebasing receipt token; the ETH-equivalent value grows as the exchange rate increases).",
  "Do NOT use for Lido (call get_lido_positions), EigenLayer restaking (call get_eigenlayer_positions), or rETH balances on L2s (deferred to v2.6 BRIDGE-T1).",
  "Supported chains: 'ethereum' only — non-ethereum refuses with CHAIN_ID_MISMATCH (errorCode 15). v2.6 cross-chain rETH bridging is a separate milestone surface.",
  "Returns structuredContent with: chain ('ethereum'), chainId (1), wallet, rethBalance / rethBalanceHuman, exchangeRate / exchangeRateHuman (1e18-scaled rETH→ETH rate), ethEquivalent / ethEquivalentHuman (computed = rethBalance × exchangeRate ÷ 1e18; EXACT at the read block — rETH is non-rebasing), rpcDegraded?.",
  "Failure modes: CHAIN_ID_MISMATCH (non-ethereum chain), INVALID_INPUT (malformed wallet address), INTERNAL_ERROR (RPC unreachable).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "EVM wallet address (EIP-55 not required; case-insensitive).",
    },
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier. Only 'ethereum' is supported at v2.3 (Rocket Pool is Ethereum-mainnet-only). Defaults to 'ethereum' when omitted.",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

registerTool("get_rocketpool_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // (a) Validate chain — defaults to "ethereum"; refuses any other value with
  // CHAIN_ID_MISMATCH (defense-in-depth alongside the JSON-schema enum).
  const chainRaw = typeof args.chain === "string" ? args.chain : "ethereum";
  if (chainRaw !== "ethereum") {
    return {
      content: [
        {
          type: "text",
          text: `error: invalid 'chain': Rocket Pool reads support only 'ethereum' at v2.3, got "${chainRaw}"`,
        },
      ],
      isError: true,
      structuredContent: {
        ...makeStructuredError(
          "CHAIN_ID_MISMATCH",
          `invalid 'chain': Rocket Pool reads support only 'ethereum' at v2.3, got "${chainRaw}"`,
        ),
      },
    };
  }

  // (b) Validate wallet address.
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
    return {
      content: [
        {
          type: "text",
          text: "error: `wallet` must be a valid 0x-prefixed EVM address",
        },
      ],
      isError: true,
      structuredContent: {
        ...makeStructuredError(
          "INVALID_INPUT",
          "`wallet` must be a valid 0x-prefixed EVM address",
        ),
      },
    };
  }
  const wallet: Address = getAddress(walletRaw);

  // (c) Resolve client + read.
  const client = getChainClient(1);

  try {
    const result = await _rocketPoolChains.readEthereumPositions(client, wallet);

    const rethBalanceBig = BigInt(result.rethBalance);
    const exchangeRateBig = BigInt(result.exchangeRate);
    const ethEquivalentBig = BigInt(result.ethEquivalent);

    const summaryLines: string[] = [];
    if (rethBalanceBig === 0n) {
      summaryLines.push(`No Rocket Pool positions found for ${wallet}.`);
    } else {
      summaryLines.push(`Rocket Pool positions for ${wallet}:`);
      summaryLines.push(`  rETH balance:           ${formatUnits(rethBalanceBig, 18)} rETH`);
      summaryLines.push(
        `  Current exchange rate:  ${formatUnits(exchangeRateBig, 18)} ETH per rETH`,
      );
      summaryLines.push(
        `  ETH-equivalent value:   ${formatUnits(ethEquivalentBig, 18)} ETH (rETH × rate ÷ 1e18)`,
      );
    }

    const structuredContent: Record<string, unknown> = {
      chain: "ethereum",
      chainId: 1,
      wallet,
      rethBalance: result.rethBalance,
      rethBalanceHuman: formatUnits(rethBalanceBig, 18),
      exchangeRate: result.exchangeRate,
      exchangeRateHuman: formatUnits(exchangeRateBig, 18),
      ethEquivalent: result.ethEquivalent,
      ethEquivalentHuman: formatUnits(ethEquivalentBig, 18),
    };
    if (isPublicNodeFallback(1)) structuredContent.rpcDegraded = true;

    return {
      content: [{ type: "text", text: summaryLines.join("\n") }],
      structuredContent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `error: failed to read Rocket Pool positions for ${wallet} on ethereum: ${message}`,
        },
      ],
      isError: true,
      structuredContent: {
        ...makeStructuredError(
          "INTERNAL_ERROR",
          `failed to read Rocket Pool positions for ${wallet} on ethereum`,
          message,
        ),
      },
    };
  }
});
