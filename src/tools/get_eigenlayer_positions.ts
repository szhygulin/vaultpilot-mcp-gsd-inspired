// src/tools/get_eigenlayer_positions.ts
//
// MCP tool: get_eigenlayer_positions({ wallet, chain? }) — EIG-01 (Phase 31 Plan 31-02).
//
// Reader for EigenLayer per-strategy deposits + queued withdrawals on
// Ethereum mainnet (D-03 lock — chain enum narrowed to ["ethereum"]).
//
// Fan-out (src/chains/eigenlayer.ts):
//   1. 7 × StrategyManager.stakerStrategyShares(wallet, strategy) — curated LSTs
//   2. Per-non-zero × StrategyBase.sharesToUnderlyingView(shares)
//   3. 1 × DelegationManager.getQueuedWithdrawals(wallet) → flat row array
//
// approx: true is ALWAYS surfaced in structuredContent (D-11 load-bearing —
// mirrors Phase 30 Lido pattern). The off-chain ETH-equivalence assumption
// (1:1 underlying↔ETH for the curated 7 ETH-pegged LSTs) is the user-facing
// disclaimer; price-oracle integration is a v2.x backlog item.
//
// rpcDegraded surface: per-source partial failures (any of the 7+N fan-out
// reads or the DelegationManager call throwing) set the flag; the response
// still returns whatever data succeeded. Mirrors Phase 7+8 read pattern.
//
// Chain refusal: non-"ethereum" `chain` arg → CHAIN_ID_MISMATCH (errorCode 15).
// Wallet validation: viem.isAddress + EIP-55 normalization via getAddress.
// Invalid wallet → INVALID_INPUT (errorCode 1).

import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { _eigenLayerChains } from "../chains/eigenlayer.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";

// ---------------------------------------------------------------------------
// Description + Input Schema
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  "Read EigenLayer restaking positions for a wallet on Ethereum mainnet — per-strategy deposits + queued withdrawals across the curated 7-LST registry (stETH, rETH, cbETH, ETHx, wBETH, sfrxETH, mETH).",
  "Ethereum mainnet ONLY: EigenLayer's StrategyManager + DelegationManager are deployed at chainId=1 (D-03 lock); non-ethereum chains refuse with CHAIN_ID_MISMATCH (errorCode 15).",
  "WARNING: ethEquivalent values are APPROXIMATE — the curated 7-LST set is assumed ETH-pegged (within slippage). The approx: true flag in structuredContent is load-bearing; do not present these values as audited PnL.",
  "Use when the user asks about EigenLayer restaking positions, queued withdrawals, or restaked LST balances.",
  "Do NOT use for non-EigenLayer LSTs (use get_lido_positions for Lido stETH/wstETH), Compound (get_compound_positions), Aave (get_lending_positions), native ETH restaking via EigenPod (deferred to v2.x), or operator-delegation reads (deferred to v2.x).",
  "Returns structuredContent with: chain, chainId, wallet, deposits[] (one row per non-zero-share strategy: lst, strategy, shares, underlyingAmount, ethEquivalent), pendingWithdrawals[] (one row per queued withdrawal: lst, strategy, shares, withdrawer, startBlock, claimableAfterBlock), totalEthEquivalent, approx: true (always), rpcDegraded? (set on partial RPC failure).",
  "Failure modes: CHAIN_ID_MISMATCH (chain != ethereum), INVALID_INPUT (malformed wallet), INTERNAL_ERROR (RPC unreachable).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier. ONLY 'ethereum' is supported — EigenLayer is Ethereum-mainnet-only at Phase 31 scope. Non-ethereum refuses with CHAIN_ID_MISMATCH.",
    },
    wallet: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "EVM wallet address (EIP-55 not required; case-insensitive).",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

registerTool("get_eigenlayer_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // (a) Chain gate — default to "ethereum" when omitted; refuse anything else.
  // Layer-2 defense-in-depth: schema enum catches the same shape upstream;
  // hand-crafted calls bypass the schema and hit this gate.
  const chainRaw = args.chain;
  const chainName = typeof chainRaw === "string" ? chainRaw : "ethereum";
  if (chainName !== "ethereum") {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: \`chain\` must be "ethereum" — EigenLayer is Ethereum-mainnet-only (got "${chainName}")`,
        },
      ],
      structuredContent: {
        ...makeStructuredError(
          "CHAIN_ID_MISMATCH",
          `\`chain\` must be "ethereum" for EigenLayer positions; got "${chainName}"`,
        ),
      },
    };
  }

  // (b) Validate wallet address.
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "error: `wallet` must be a valid 0x-prefixed EVM address",
        },
      ],
      structuredContent: {
        ...makeStructuredError(
          "INVALID_INPUT",
          "`wallet` must be a valid 0x-prefixed EVM address",
        ),
      },
    };
  }
  const wallet: Address = getAddress(walletRaw);

  // (c) Resolve client + fan out.
  const chainId = 1;
  const client = getChainClient(chainId);

  try {
    const result = await _eigenLayerChains.readEthereumPositions(client, wallet);

    const summaryLines: string[] = [];
    if (result.deposits.length === 0 && result.pendingWithdrawals.length === 0) {
      summaryLines.push(`No EigenLayer positions found for ${wallet}.`);
    } else {
      summaryLines.push(`EigenLayer positions for ${wallet}:`);
      for (const d of result.deposits) {
        const sharesHuman = formatUnits(BigInt(d.shares), 18);
        const underHuman = formatUnits(BigInt(d.underlyingAmount), 18);
        const ethHuman = formatUnits(BigInt(d.ethEquivalent), 18);
        summaryLines.push(
          `  EigenLayer ${d.lst}-Strategy: ${sharesHuman} shares (~${underHuman} ${d.lst}, ~${ethHuman} ETH-equiv)`,
        );
      }
      for (const w of result.pendingWithdrawals) {
        const sharesHuman = formatUnits(BigInt(w.shares), 18);
        summaryLines.push(
          `  Pending withdrawal: ${sharesHuman} shares of ${w.lst}-Strategy, claimable after block ${w.claimableAfterBlock}`,
        );
      }
    }

    const structuredContent: Record<string, unknown> = {
      chain: "ethereum",
      chainId,
      wallet,
      deposits: result.deposits,
      pendingWithdrawals: result.pendingWithdrawals,
      totalEthEquivalent: result.totalEthEquivalent,
      // D-11 load-bearing: approx: true is ALWAYS present, regardless of input.
      // T-EIGENLAYER-SHARES-STALENESS mitigation surface for the agent.
      approx: true,
    };
    if (result.rpcDegraded === true || isPublicNodeFallback(chainId)) {
      structuredContent.rpcDegraded = true;
    }

    return {
      content: [{ type: "text", text: summaryLines.join("\n") }],
      structuredContent,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: failed to read EigenLayer positions for ${wallet}: ${message}`,
        },
      ],
      structuredContent: {
        ...makeStructuredError(
          "INTERNAL_ERROR",
          `failed to read EigenLayer positions for ${wallet}`,
          message,
        ),
      },
    };
  }
});
