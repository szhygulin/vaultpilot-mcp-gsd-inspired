// src/tools/get_compound_market_info.ts
//
// MCP tool: get_compound_market_info({ chain, cometAddress }) — CMP-02
// (Phase 28 Plan 28-04). Per-Comet metadata read; no wallet arg.
//
// Surface: supply APR + borrow APR + utilization + total supply + total borrow
// + per-collateral metadata (borrowCollateralFactor + liquidateCollateralFactor
// + liquidationFactor + supplyCap + currentSupply + priceUsd).
//
// Phase 28 scope: Ethereum mainnet (chainId === 1). The 6 canonical Comets are
// the only valid cometAddress inputs; out-of-set surfaces INVALID_INPUT. v2.3.x
// widens to Polygon / Arbitrum / Base / Optimism.
//
// APR math (research § Topic 7 — Pitfall #4): per-second rates × 31_536_000
// seconds-per-year × 100% / 1e18. The `/ 10n ** 18n` divides LAST in bigint to
// preserve every digit (dividing first truncates to zero for any rate < 1e18).

import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { _compoundChains } from "../chains/compound-v3.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import {
  chainIdFromName,
  getAllCompoundCometsForChain,
  type ChainName,
} from "../config/contracts.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { registerTool } from "./index.js";

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> &
    StructuredError;
}

const SECONDS_PER_YEAR: bigint = 31_536_000n;

const DESCRIPTION = [
  "Read Compound V3 market metadata for a specified Comet (Ethereum mainnet — 6 canonical Comets: cUSDCv3 / cUSDTv3 / cWETHv3 / cUSDSv3 / cwstETHv3 / cWBTCv3).",
  "Returns per-Comet supply APR, borrow APR, utilization, total supply, total borrow, and per-collateral metadata (borrowCollateralFactor, liquidateCollateralFactor, liquidationFactor, supplyCap, currentSupply, priceUsd).",
  "Use BEFORE prepare_compound_supply / _borrow to surface APRs and collateral capacity (helps the agent communicate yield + capacity to the user before the prepare-tool call).",
  "Does NOT return per-wallet positions — call `get_lending_positions` with `chain: \"ethereum\"` for that (returns positions for both Aave V3 and Compound V3).",
  "Returns `{ chain, chainId, cometAddress, baseToken, utilizationPercent, supplyAprPercent, borrowAprPercent, totalSupply, totalBorrow, baseTokenPriceUsd, collateralAssets: [...], rpcDegraded? }`.",
  "Failure modes: INTERNAL_ERROR (RPC unreachable; the public-node fallback path has already been tried); INVALID_INPUT (cometAddress not in the canonical mainnet allowlist).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"] as const,
      description: "Chain identifier. Phase 28: Ethereum mainnet only; v2.3.x widens.",
    },
    cometAddress: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Comet contract address (EIP-55 not required). Must be one of the 6 canonical mainnet Comets.",
    },
  },
  required: ["chain", "cometAddress"],
  additionalProperties: false,
};

interface CollateralAssetSurface {
  asset: Address;
  priceFeed: Address;
  priceUsd: string;
  borrowCollateralFactor: string;
  liquidateCollateralFactor: string;
  liquidationFactor: string;
  supplyCap: string;
  currentSupply: string;
}

interface CompoundMarketInfoResult {
  chain: ChainName;
  chainId: number;
  cometAddress: Address;
  baseToken: Address;
  utilizationPercent: string;
  supplyAprPercent: string;
  borrowAprPercent: string;
  totalSupply: string;
  totalBorrow: string;
  baseTokenPriceFeed: Address;
  baseTokenPriceUsd: string;
  collateralAssets: CollateralAssetSurface[];
  rpcDegraded?: boolean;
}

registerTool(
  "get_compound_market_info",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    const chainName = args.chain as ChainName;
    const chainId = chainIdFromName(chainName);

    const cometRaw = args.cometAddress;
    if (typeof cometRaw !== "string" || !isAddress(cometRaw, { strict: false })) {
      return {
        isError: true,
        content: [
          { type: "text", text: "error: `cometAddress` must be a valid 0x-prefixed EVM address" },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          "cometAddress must be a valid 0x-prefixed EVM address",
        ),
      };
    }
    const cometAddress = getAddress(cometRaw);

    // Canonical-allowlist membership (SOT getter, no inline literals).
    const allowlist = getAllCompoundCometsForChain(chainId);
    if (!allowlist.includes(cometAddress)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: cometAddress ${cometAddress} is not in the canonical Compound V3 mainnet allowlist (${allowlist.length} entries)`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `cometAddress ${cometAddress} not in canonical Compound V3 allowlist for ${chainName}`,
        ),
      };
    }

    const client = getChainClient(chainId);

    let info: Awaited<ReturnType<typeof _compoundChains.getCometMarketInfo>>;
    try {
      info = await _compoundChains.getCometMarketInfo(client, cometAddress);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: failed to read Compound V3 market info for ${cometAddress}: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `failed to read Compound V3 market info for ${cometAddress}`,
          message,
        ),
      };
    }

    // APR computation per research § Topic 7. The per-second rate is uint64
    // 18-decimal scaled (e.g. cUSDCv3 supplyRate ≈ 1.3e9 wei/sec; × 31_536_000 s
    // = ~4.1e16 → ~4.1% APR). Pitfall #4 protection: divide by 1e18 LAST in
    // bigint — dividing earlier truncates to zero for any sub-1e18 rate.
    //
    // Surface as a percent string: `rate × SECONDS_PER_YEAR × 100 / 1e18`.
    // formatUnits handles the trailing-decimal trim.
    const supplyAprScaled = info.supplyRate * SECONDS_PER_YEAR * 100n;
    const borrowAprScaled = info.borrowRate * SECONDS_PER_YEAR * 100n;
    const supplyAprPercent = formatUnits(supplyAprScaled, 18);
    const borrowAprPercent = formatUnits(borrowAprScaled, 18);

    // Utilization is already 18-decimal scaled (research § Topic 7 line 245).
    // Convert to a percent: `utilization × 100 / 1e18`.
    const utilizationPercent = formatUnits(info.utilization * 100n, 18);

    const collateralAssets: CollateralAssetSurface[] = info.collateralAssets.map((c) => ({
      asset: c.asset,
      priceFeed: c.priceFeed,
      // Chainlink PRICE_FEED_SCALE = 1e8 (research § Topic 5).
      priceUsd: formatUnits(c.priceUsd, 8),
      // Collateral factors are 18-decimal scaled; surface as decimal (e.g. 0.83).
      borrowCollateralFactor: formatUnits(c.borrowCollateralFactor, 18),
      liquidateCollateralFactor: formatUnits(c.liquidateCollateralFactor, 18),
      liquidationFactor: formatUnits(c.liquidationFactor, 18),
      supplyCap: c.supplyCap.toString(),
      currentSupply: c.currentSupply.toString(),
    }));

    const result: CompoundMarketInfoResult = {
      chain: chainName,
      chainId,
      cometAddress,
      baseToken: info.baseToken,
      utilizationPercent,
      supplyAprPercent,
      borrowAprPercent,
      totalSupply: info.totalSupply.toString(),
      totalBorrow: info.totalBorrow.toString(),
      baseTokenPriceFeed: info.baseTokenPriceFeed,
      baseTokenPriceUsd: formatUnits(info.baseTokenPriceUsd, 8),
      collateralAssets,
    };
    if (isPublicNodeFallback(chainId)) result.rpcDegraded = true;

    const lines: string[] = [];
    lines.push(`Compound V3 market info — ${cometAddress} (chain ${chainName}):`);
    lines.push(`  base token:    ${info.baseToken} @ $${result.baseTokenPriceUsd}`);
    lines.push(`  utilization:   ${Number(utilizationPercent).toFixed(2)}%`);
    lines.push(
      `  supply APR:    ${Number(supplyAprPercent).toFixed(2)}% / borrow APR: ${Number(borrowAprPercent).toFixed(2)}%`,
    );
    lines.push(`  total supply:  ${info.totalSupply.toString()}`);
    lines.push(`  total borrow:  ${info.totalBorrow.toString()}`);
    lines.push(`  collateral assets: ${collateralAssets.length}`);
    for (const c of collateralAssets) {
      lines.push(
        `    ${c.asset}: bCF ${Number(c.borrowCollateralFactor).toFixed(2)} / lCF ${Number(c.liquidateCollateralFactor).toFixed(2)} / lF ${Number(c.liquidationFactor).toFixed(2)} / supplyCap ${c.supplyCap} / currentSupply ${c.currentSupply}`,
      );
    }
    if (result.rpcDegraded) lines.push("  (rpcDegraded — public-node fallback active)");

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: { ...result },
    };
  },
);
