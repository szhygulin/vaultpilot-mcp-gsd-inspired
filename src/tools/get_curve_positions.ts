// src/tools/get_curve_positions.ts — Phase 34 Plan 34-02 (CRV-01)
//
// MCP tool: get_curve_positions({ wallet, chain? }) — READ-ONLY Curve LP balance reader.
//
// Fan-out: per-pool LP-token balanceOf(wallet) across all registered Curve pools
// on Ethereum mainnet via Promise.allSettled. Reads pool.lpToken (NOT pool.address)
// per Pitfall 3 — for the legacy stETH/ETH pool these are different contracts.
//
// Zero-filter: pools with lpBalance === 0n are excluded from the response
// (consistent with get_aave_v3_positions / get_eigenlayer_positions precedent).
//
// rpcDegraded: set when any pool read rejects (Promise.allSettled rejection arm)
// OR when isPublicNodeFallback returns true.
//
// READ-ONLY-by-construction invariant: NEVER brings in handle creation, handle-store
// access, or payload-fingerprint computation. Asserted by module-source grep guard in
// test/get-curve-positions.test.ts (T-34-02-A mitigate).
//
// Chain scope: Ethereum mainnet only (D-03 lock — Curve registry is chainId=1
// at Phase 34 scope). Non-ethereum chains refuse with CHAIN_ID_MISMATCH.
//
// Closest analogs:
//   - get_eigenlayer_positions.ts (chain gate + wallet validation + rpcDegraded)
//   - simulate_position_change.ts (READ-ONLY-by-construction invariant pattern)

import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { _curveChain } from "../chains/curve.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { getAllCurvePoolsForChain, type CurvePoolEntry } from "../config/contracts.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";

// ---------------------------------------------------------------------------
// Tool description + input schema
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  "Read Curve Finance LP positions for a wallet on Ethereum mainnet.",
  "Returns per-pool LP-token balances + underlying-coin composition across the curated Curve pool registry (1 legacy stETH/ETH pool + 10 stable_ng plain pools).",
  "Zero-balance pools are filtered — only pools where the wallet holds LP tokens appear in the response.",
  "READ-ONLY: no transaction is prepared. Use prepare_curve_swap or prepare_curve_add_liquidity to interact with pools.",
  "Ethereum mainnet ONLY: Curve pool registry is Ethereum-only at Phase 34 scope. Non-ethereum chains refuse with CHAIN_ID_MISMATCH (errorCode 15).",
  "LP USD pricing is out of scope at v2.4 (deferred to v3.x) — all entries carry priceUnknown: true.",
  "Use when the user asks about their Curve LP positions, stETH/ETH Curve balance, or which Curve pools they have liquidity in.",
  "Do NOT use for Uniswap V3 LP (use get_lp_positions), EigenLayer restaking (use get_eigenlayer_positions), Aave lending (use get_lending_positions), or Lido stETH/wstETH positions (use get_lido_positions).",
  "Returns structuredContent with: chain, chainId, wallet, positions[] (per-pool: poolAddress, displayName, abiVersion, lpBalance, lpDecimals, coins[{address, decimals}]), rpcDegraded? (set on partial RPC failure or PublicNode fallback).",
  "Failure modes: CHAIN_ID_MISMATCH (chain != ethereum), INVALID_INPUT (malformed wallet), INTERNAL_ERROR (RPC unreachable).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description: "0x-prefixed EVM address (EIP-55 not required; case-insensitive).",
    },
    chain: {
      type: "string",
      description:
        '"ethereum" (default — Phase 34 is Ethereum-only). Non-ethereum chains refuse with CHAIN_ID_MISMATCH.',
      default: "ethereum",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PositionEntry {
  pool: CurvePoolEntry;
  lpBalance: bigint;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

registerTool("get_curve_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // (a) Chain gate — default to "ethereum" when omitted; refuse anything else.
  // Layer-2 defense-in-depth: schema default catches the common path; hand-crafted
  // calls bypass the schema and hit this gate. T-34-02-C mitigate.
  const chainRaw = args.chain;
  const chainName = typeof chainRaw === "string" ? chainRaw : "ethereum";
  if (chainName !== "ethereum") {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: \`chain\` must be "ethereum" — Curve pools are Ethereum-mainnet-only at Phase 34 scope (got "${chainName}")`,
        },
      ],
      structuredContent: {
        ...makeStructuredError(
          "CHAIN_ID_MISMATCH",
          `\`chain\` must be "ethereum"; got "${chainName}"`,
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
        ...makeStructuredError("INVALID_INPUT", "`wallet` must be a valid 0x-prefixed EVM address"),
      },
    };
  }
  const wallet: Address = getAddress(walletRaw);

  // (c) Multicall fan-out via Promise.allSettled across all registered Curve pools.
  //
  // CRITICAL (Pitfall 3): pass pool.lpToken to getCurveLpBalance, NOT pool.address.
  // For the legacy stETH/ETH pool, lpToken (0x06325440...) !== pool.address
  // (0xDC24316b...). Using pool.address silently returns zero for that pool.
  // For stable_ng pools, lpToken === pool.address by construction.
  // T-34-02-B mitigate.
  const chainId = 1;
  const client = getChainClient(chainId);
  const pools = getAllCurvePoolsForChain(chainId);

  const balances = await Promise.allSettled(
    pools.map((pool) => _curveChain.getCurveLpBalance(client, pool.lpToken, wallet)),
  );

  // (d) Zero-filter + rpcDegraded surface.
  const positions: PositionEntry[] = [];
  let rpcDegraded = false;

  for (let i = 0; i < pools.length; i++) {
    const result = balances[i];
    if (!result || result.status === "rejected") {
      rpcDegraded = true;
      continue;
    }
    if (result.value === 0n) continue; // zero-filter
    positions.push({ pool: pools[i]!, lpBalance: result.value });
  }

  // (e) Build structuredContent.
  const structuredContent: Record<string, unknown> = {
    chain: "ethereum",
    chainId,
    wallet,
    positions: positions.map((p) => ({
      poolAddress: p.pool.address,
      displayName: p.pool.displayName,
      abiVersion: p.pool.abiVersion,
      lpBalance: p.lpBalance.toString(),
      lpDecimals: 18, // All Curve LP tokens are 18 decimals (stable_ng + legacy).
      coins: p.pool.coins.map((addr, idx) => ({
        address: addr,
        decimals: p.pool.coinDecimals[idx],
      })),
      priceUnknown: true, // LP USD pricing deferred to v3.x.
    })),
  };

  if (rpcDegraded || isPublicNodeFallback(chainId)) {
    structuredContent.rpcDegraded = true;
  }

  // (f) Build human-readable content text.
  const count = positions.length;
  let summaryText: string;
  if (count === 0) {
    summaryText = `No Curve LP positions found for ${wallet} on Ethereum mainnet.`;
  } else {
    const poolSummaries = positions.map((p) => {
      const human = formatUnits(p.lpBalance, 18);
      return `  ${p.pool.displayName}: ${human} LP tokens`;
    });
    summaryText = `Found ${count} Curve LP position${count === 1 ? "" : "s"} for ${wallet} on Ethereum mainnet:\n${poolSummaries.join("\n")}`;
  }

  if (structuredContent.rpcDegraded) {
    summaryText +=
      "\nNote: some pool reads degraded — results may be incomplete (rpcDegraded: true).";
  }

  return {
    content: [{ type: "text", text: summaryText }],
    structuredContent,
  };
});
