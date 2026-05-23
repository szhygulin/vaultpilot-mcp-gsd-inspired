// src/tools/get_lido_positions.ts
//
// MCP tool: get_lido_positions({ wallet, chain }) — LIDO-01 (Phase 30 Plan 30-02).
//
// Reader for Lido stETH + wstETH positions on Ethereum mainnet and Arbitrum.
// Returns the D-08 response shape: stethBalance, wstethBalance, stethShares,
// conversionRate, accruedRebaseRewards (with load-bearing approx: true), chain.
//
// Chain narrowing: ONLY "ethereum" and "arbitrum" — narrower than the 5-chain
// lending tool. Other chains (polygon, base, optimism) return INVALID_INPUT.
//
// Ethereum branch — readEthereumPositions:
//   Full 5-field response: stethBalance + stethShares + wstethBalance +
//   conversionRate (stEthPerToken from L1) + accruedRebaseRewards (approx).
//
// Arbitrum branch — readArbitrumPositions:
//   wstETH-only: wstethBalance from Arbitrum + conversionRate from Ethereum L1
//   (Pitfall 5 — bridged Arbitrum wstETH does NOT implement stEthPerToken).
//   stethBalance / stethShares / accruedRebaseRewards are null on Arbitrum.
//
// approx: true is ALWAYS surfaced in structuredContent (D-09 load-bearing):
//   - On Ethereum: alongside the populated accruedRebaseRewards value
//   - On Arbitrum: even when accruedRebaseRewards is null — so the agent
//     knows the field contract regardless of chain
//   The `approx` flag is NOT a boolean — it is the literal `true`. Any
//   change to a `boolean` type in lido-rebase.ts breaks the strict TS compile,
//   surfacing the drift before merge (T-LIDO-REBASE-SNAPSHOT-STALENESS).
//
// rpcDegraded surface (READ-05 invariant): `isPublicNodeFallback(chainId)`
// mirrors every other read tool in the codebase.

import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { _lidoChains } from "../chains/lido.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { chainIdFromName, type ChainName } from "../config/contracts.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";

// ---------------------------------------------------------------------------
// Description + Input Schema
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  "Read Lido stETH + wstETH positions for a wallet on Ethereum mainnet or Arbitrum.",
  "Supported chains: 'ethereum' and 'arbitrum' only — narrower than get_lending_positions (Lido stETH is Ethereum-native; Arbitrum only has bridged wstETH).",
  "WARNING: accruedRebaseRewards is an APPROXIMATE value (shares-based snapshot, not audited PnL). The approx: true flag in structuredContent is load-bearing — do not present this figure as exact profit/loss. For Ethereum, accruedRebaseRewards approximates earned stETH rebase yield (currentStethBalance - shares). For Arbitrum, accruedRebaseRewards is null (no on-chain share tracking on L2).",
  "Use when the user asks about their Lido stETH positions, wstETH holdings, staking rewards, or the stETH/wstETH conversion rate.",
  "Do NOT use for Aave or Compound positions — call get_lending_positions for those. Do NOT use for chains other than ethereum/arbitrum.",
  "Returns structuredContent with: chain, chainId, wallet, stethBalance / stethBalanceHuman (null on Arbitrum), wstethBalance / wstethBalanceHuman, stethShares (null on Arbitrum), conversionRate / conversionRateHuman (always from Ethereum L1 — authoritative), accruedRebaseRewards / accruedRebaseRewardsHuman (null on Arbitrum), approx: true (always), rpcDegraded?.",
  "Failure modes: INVALID_INPUT (unsupported chain or malformed wallet address), INTERNAL_ERROR (RPC unreachable).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum"],
      description:
        "Chain identifier. Supported: ethereum, arbitrum. Other chains refuse with INVALID_INPUT.",
    },
    wallet: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "EVM wallet address (EIP-55 not required; case-insensitive).",
    },
  },
  required: ["chain", "wallet"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Supported chain guard
// ---------------------------------------------------------------------------

const LIDO_SUPPORTED_CHAINS: ReadonlySet<string> = new Set(["ethereum", "arbitrum"]);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

registerTool("get_lido_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // (a) Validate chain — must be in the narrowed Lido-supported enum.
  // The schema enum gates most invalid input; this defense-in-depth check
  // catches hand-crafted calls that bypass schema validation.
  const chainRaw = args.chain;
  if (typeof chainRaw !== "string" || !LIDO_SUPPORTED_CHAINS.has(chainRaw)) {
    return {
      content: [
        {
          type: "text",
          text: `error: \`chain\` must be one of "ethereum" or "arbitrum" for Lido positions`,
        },
      ],
      isError: true,
      structuredContent: {
        ...makeStructuredError(
          "INVALID_INPUT",
          '`chain` must be one of "ethereum" or "arbitrum" for Lido positions',
        ),
      },
    };
  }
  const chainName = chainRaw as ChainName;

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

  // (c) Resolve chainId + client.
  const chainId = chainIdFromName(chainName);
  const client = getChainClient(chainId);

  try {
    if (chainId === 1) {
      // --- Ethereum mainnet branch ---
      const result = await _lidoChains.readEthereumPositions(client, wallet);

      const summaryLines: string[] = [];
      summaryLines.push(`Lido positions for ${wallet} on ethereum:`);
      summaryLines.push(`  stETH balance: ${formatUnits(result.stethBalance, 18)} stETH`);
      summaryLines.push(`  wstETH balance: ${formatUnits(result.wstethBalance, 18)} wstETH`);
      summaryLines.push(`  stETH shares: ${formatUnits(result.stethShares, 18)}`);
      summaryLines.push(
        `  conversionRate: ${formatUnits(result.conversionRate, 18)} stETH/wstETH`,
      );
      summaryLines.push(
        `  accruedRebaseRewards (approx): ${formatUnits(result.accruedRebaseRewards, 18)} stETH`,
      );

      const structuredContent: Record<string, unknown> = {
        chain: "ethereum",
        chainId: 1,
        wallet,
        stethBalance: result.stethBalance.toString(),
        stethBalanceHuman: formatUnits(result.stethBalance, 18),
        wstethBalance: result.wstethBalance.toString(),
        wstethBalanceHuman: formatUnits(result.wstethBalance, 18),
        stethShares: result.stethShares.toString(),
        conversionRate: result.conversionRate.toString(),
        conversionRateHuman: formatUnits(result.conversionRate, 18),
        accruedRebaseRewards: result.accruedRebaseRewards.toString(),
        accruedRebaseRewardsHuman: formatUnits(result.accruedRebaseRewards, 18),
        // D-09 load-bearing: approx: true is ALWAYS present alongside the rewards
        // field — whether the field is populated or null — so the agent knows the
        // contract of the field. T-LIDO-REBASE-SNAPSHOT-STALENESS mitigation.
        approx: true,
      };
      if (isPublicNodeFallback(chainId)) structuredContent.rpcDegraded = true;

      return {
        content: [{ type: "text", text: summaryLines.join("\n") }],
        structuredContent,
      };
    } else {
      // --- Arbitrum branch (chainId === 42161) ---
      // ethClient for L1 stEthPerToken (Pitfall 5 — bridged Arbitrum wstETH
      // does NOT implement stEthPerToken; rate must come from Ethereum L1).
      const ethClient = getChainClient(1);
      const result = await _lidoChains.readArbitrumPositions(client, ethClient, wallet);

      const summaryLines: string[] = [];
      summaryLines.push(`Lido positions for ${wallet} on arbitrum:`);
      summaryLines.push(
        `  wstETH balance (bridged): ${formatUnits(result.wstethBalance, 18)} wstETH`,
      );
      summaryLines.push(
        `  conversionRate (from Ethereum L1): ${formatUnits(result.conversionRate, 18)} stETH/wstETH`,
      );
      summaryLines.push(
        `  stETH balance: null (no bridged stETH on Arbitrum)`,
      );
      summaryLines.push(
        `  accruedRebaseRewards: null (no on-chain share tracking on L2)`,
      );

      const structuredContent: Record<string, unknown> = {
        chain: "arbitrum",
        chainId: 42161,
        wallet,
        stethBalance: null,
        stethBalanceHuman: null,
        wstethBalance: result.wstethBalance.toString(),
        wstethBalanceHuman: formatUnits(result.wstethBalance, 18),
        stethShares: null,
        conversionRate: result.conversionRate.toString(),
        conversionRateHuman: formatUnits(result.conversionRate, 18),
        accruedRebaseRewards: null,
        accruedRebaseRewardsHuman: null,
        // D-09 load-bearing: approx: true is ALWAYS present even when
        // accruedRebaseRewards is null — so the agent knows the field contract
        // regardless of chain. T-LIDO-REBASE-SNAPSHOT-STALENESS mitigation.
        approx: true,
      };
      // Surface rpcDegraded for both Arbitrum and Ethereum (the ethClient L1
      // read also goes through the fallback path).
      if (isPublicNodeFallback(chainId) || isPublicNodeFallback(1)) {
        structuredContent.rpcDegraded = true;
      }

      return {
        content: [{ type: "text", text: summaryLines.join("\n") }],
        structuredContent,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `error: failed to read Lido positions for ${wallet} on ${chainName}: ${message}`,
        },
      ],
      isError: true,
      structuredContent: {
        ...makeStructuredError(
          "INTERNAL_ERROR",
          `failed to read Lido positions for ${wallet} on ${chainName}`,
          message,
        ),
      },
    };
  }
});
