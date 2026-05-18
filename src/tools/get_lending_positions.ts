// src/tools/get_lending_positions.ts
//
// MCP tool: get_lending_positions({ wallet }) — READ-20 (Plan 07-02).
//
// Reader for Aave V3 positions on Ethereum mainnet. Mirror of
// `get_portfolio_summary.ts` (Phase 2) for the trust-pipeline shape:
//   (a) Wallet validation at boundary (schema regex + isAddress runtime check)
//   (b) Parallel concurrent reads via Promise.all (getReservesData + getUserReservesData)
//   (c) Per-position row builder (private module helper — mirror of
//       `get_portfolio_summary.ts::buildRow` shape)
//   (d) Aggregate HF + liquidationRisk via `aave-health.ts` pure-fn math
//   (e) `rpcDegraded` surfacing via `isPublicNodeFallback()` (Phase 2 pattern
//       verbatim — `get_portfolio_summary.ts:219`)
//
// Pricing: UiPoolDataProviderV3 returns `priceInMarketReferenceCurrency` per
// reserve. `baseCurrency.marketReferenceCurrencyUnit` is 1e8 for Aave V3
// mainnet (USD with 8 decimals); USD conversion is a fixed-scale division.
// NO DefiLlama call needed — the protocol-native oracle is the SOT.
//
// Token symbol resolution: the protocol-returned `reserve.symbol` is the
// primary surface; defensive fallback (long-tail / malformed reserves where
// the protocol returns an empty string) consults the registry by
// `underlyingAsset`. The registry can't cover every Aave reserve (its scope
// is the top-50 ERC-20s); rare misses surface as the literal underlying
// address.

import { formatUnits, getAddress, isAddress, type Address } from "viem";

import { _aaveChains } from "../chains/aave-v3.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { chainIdFromName, type ChainId, type ChainName } from "../config/contracts.js";
import {
  classifyLiquidationRisk,
  computeHealthFactor,
  HF_SCALE,
  type CollateralPosition,
  type DebtPosition,
  type LiquidationRisk,
} from "../signing/aave-health.js";
import { loadTokenRegistry } from "../tokens/registry.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Read Aave V3 lending positions on a supported EVM chain for a wallet address.",
  "Returns supplied + borrowed positions per asset, aggregate health factor, and liquidation-risk flag.",
  "Use when the user asks about their Aave positions, lending balances, borrow position, or health factor.",
  "Do NOT use for non-Aave lending — Compound / Morpho / etc. are v2.3+ scope.",
  "Do NOT use for non-lending wallet balances — call `get_portfolio_summary` for wallet-level holdings.",
  "`chain` is REQUIRED — pass one of ethereum, arbitrum, polygon, base, optimism. Aave V3 reserves differ per chain; the server resolves the per-chain UiPoolDataProvider via the typed SOT.",
  "Returns `{ chain, wallet, positions: [...], totalCollateralUsd, totalDebtUsd, healthFactor, noDebt, liquidationRisk, userEModeCategoryId, rpcDegraded? }`.",
  "`healthFactor` is `null` when the user has no debt (`noDebt: true`); the agent checks `noDebt` BEFORE comparing `healthFactor` numerically.",
  "`liquidationRisk` is one of `\"safe\"` (HF >= 1.50), `\"warning\"` (1.10 <= HF < 1.50), `\"danger\"` (HF < 1.10), or `\"noDebt\"`.",
  "Each position row carries `{ asset, symbol, decimals, suppliedHuman, suppliedUsd, borrowedHuman, borrowedUsd, liquidityRate, variableBorrowRate, liquidationThresholdBps, isFrozen, isActive, usageAsCollateralEnabledOnUser, aTokenAddress, variableDebtTokenAddress, priceInMarketReferenceCurrency }`.",
  "Frozen / inactive reserves are surfaced verbatim — never silently omitted; the agent decides whether to route around them.",
  "eMode users see `userEModeCategoryId !== 0` surfaced verbatim. v1.1 health-factor math uses the per-asset liquidation threshold; v2.3 widens to per-category override (research § Topic 3 A3 caveat).",
  "Failure modes: INVALID_INPUT (malformed wallet address), INTERNAL_ERROR (RPC unreachable; the public-node fallback path has already been tried).",
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
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "EVM wallet address (EIP-55 not required; case-insensitive).",
    },
  },
  required: ["chain", "wallet"],
  additionalProperties: false,
};

interface LendingPositionRow {
  asset: Address;
  symbol: string;
  decimals: number;
  suppliedScaled: string;
  suppliedHuman: string;
  suppliedUsd: string;
  borrowedScaled: string;
  borrowedHuman: string;
  borrowedUsd: string;
  liquidityRate: string;
  variableBorrowRate: string;
  liquidationThresholdBps: number;
  isFrozen: boolean;
  isActive: boolean;
  usageAsCollateralEnabledOnUser: boolean;
  aTokenAddress: Address;
  variableDebtTokenAddress: Address;
  priceInMarketReferenceCurrency: string;
}

interface LendingPositionsResult {
  chain: ChainName;
  chainId: number;
  wallet: Address;
  positions: LendingPositionRow[];
  totalCollateralUsd: string;
  totalDebtUsd: string;
  healthFactor: string | null;
  noDebt: boolean;
  liquidationRisk: LiquidationRisk;
  userEModeCategoryId: number;
  rpcDegraded?: boolean;
}

registerTool("get_lending_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // Phase 8 — Plan 08-02: chainId from the agent's `chain` enum. The
  // ETHEREUM_CHAIN_ID constant retired in this migration — Aave V3 reserve
  // sets differ per chain, so the chainId now flows through every read.
  const chainName = args.chain as ChainName;
  const chainId = chainIdFromName(chainName);

  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || !isAddress(walletRaw, { strict: false })) {
    return {
      content: [{ type: "text", text: "error: `wallet` must be a valid 0x-prefixed EVM address" }],
      isError: true,
    };
  }
  const wallet: Address = getAddress(walletRaw);

  const client = getChainClient(chainId);

  let reservesData: Awaited<ReturnType<typeof _aaveChains.getReservesData>>;
  let userReservesData: Awaited<ReturnType<typeof _aaveChains.getUserReservesData>>;
  try {
    [reservesData, userReservesData] = await Promise.all([
      _aaveChains.getReservesData(client, chainId),
      _aaveChains.getUserReservesData(client, chainId, wallet),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `error: failed to read Aave V3 positions for ${wallet}: ${message}`,
        },
      ],
      isError: true,
    };
  }

  // Index reserves by underlyingAsset for O(1) join with user reserves.
  const reserveByAsset = new Map(
    reservesData.reserves.map((r) => [getAddress(r.underlyingAsset), r] as const),
  );

  const baseUnit = reservesData.baseCurrency.marketReferenceCurrencyUnit;

  const positions: LendingPositionRow[] = [];
  const collateralPositions: CollateralPosition[] = [];
  const debtPositions: DebtPosition[] = [];

  let totalCollateralBase = 0n;
  let totalDebtBase = 0n;

  for (const ur of userReservesData.userReserves) {
    const underlying = getAddress(ur.underlyingAsset);
    const reserve = reserveByAsset.get(underlying);
    if (!reserve) {
      // Defensive: getUserReservesData returns every reserve the user has
      // touched; getReservesData returns every active reserve. A user-only
      // entry without a matching reserve row would imply a stale read across
      // the two calls — surface the row with sentinel values rather than
      // silently dropping it.
      continue;
    }

    // Skip rows where the user has neither supplied nor borrowed. The
    // protocol returns one userReserve entry per system reserve; the vast
    // majority are zero/zero for any given user.
    if (ur.scaledATokenBalance === 0n && ur.scaledVariableDebt === 0n) continue;

    const row = buildPositionRow(ur, reserve, baseUnit, chainId);
    positions.push(row);

    const decimals = Number(reserve.decimals);
    if (ur.scaledATokenBalance > 0n) {
      collateralPositions.push({
        scaledBalance: ur.scaledATokenBalance,
        index: reserve.liquidityIndex,
        price: reserve.priceInMarketReferenceCurrency,
        decimals,
        liquidationThresholdBps: reserve.reserveLiquidationThreshold,
      });
      const suppliedWei = (ur.scaledATokenBalance * reserve.liquidityIndex) / 10n ** 27n;
      const suppliedBase =
        (suppliedWei * reserve.priceInMarketReferenceCurrency) / 10n ** BigInt(decimals);
      totalCollateralBase += suppliedBase;
    }
    if (ur.scaledVariableDebt > 0n) {
      debtPositions.push({
        scaledDebt: ur.scaledVariableDebt,
        index: reserve.variableBorrowIndex,
        price: reserve.priceInMarketReferenceCurrency,
        decimals,
      });
      const debtWei = (ur.scaledVariableDebt * reserve.variableBorrowIndex) / 10n ** 27n;
      const debtBase = (debtWei * reserve.priceInMarketReferenceCurrency) / 10n ** BigInt(decimals);
      totalDebtBase += debtBase;
    }
  }

  const hf = computeHealthFactor({ collateralPositions, debtPositions });
  const liquidationRisk = classifyLiquidationRisk(hf.healthFactorScaled, hf.noDebt);

  const healthFactor =
    hf.healthFactorScaled === null ? null : formatUnits(hf.healthFactorScaled, 18);

  // baseCurrency.marketReferenceCurrencyUnit is 1e8 on mainnet (USD with 8
  // decimals); formatUnits(base, 8) yields the dollar value.
  const baseDecimals = countBaseDecimals(baseUnit);
  const totalCollateralUsd = formatUsdFromBase(totalCollateralBase, baseDecimals);
  const totalDebtUsd = formatUsdFromBase(totalDebtBase, baseDecimals);

  const result: LendingPositionsResult = {
    chain: chainName,
    chainId,
    wallet,
    positions,
    totalCollateralUsd,
    totalDebtUsd,
    healthFactor,
    noDebt: hf.noDebt,
    liquidationRisk,
    userEModeCategoryId: userReservesData.userEModeCategoryId,
  };
  if (isPublicNodeFallback(chainId)) result.rpcDegraded = true;

  const summaryLines: string[] = [];
  summaryLines.push(`Aave V3 positions for ${wallet}:`);
  if (positions.length === 0) {
    summaryLines.push("  (no supplied or borrowed positions)");
  } else {
    for (const p of positions) {
      const parts: string[] = [];
      if (p.suppliedScaled !== "0") parts.push(`supplied ${p.suppliedHuman} ${p.symbol}`);
      if (p.borrowedScaled !== "0") parts.push(`borrowed ${p.borrowedHuman} ${p.symbol}`);
      const flags: string[] = [];
      if (p.isFrozen) flags.push("frozen");
      if (!p.isActive) flags.push("inactive");
      const flagSuffix = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      summaryLines.push(`  ${parts.join(" + ")}${flagSuffix}`);
    }
  }
  const hfText =
    hf.noDebt
      ? "noDebt"
      : healthFactor === null
        ? "noDebt"
        : `${Number(healthFactor).toFixed(4)} (${liquidationRisk})`;
  summaryLines.push(
    `  collateral $${totalCollateralUsd} / debt $${totalDebtUsd} / HF ${hfText}${
      result.rpcDegraded ? " (rpcDegraded)" : ""
    }`,
  );
  if (userReservesData.userEModeCategoryId !== 0) {
    summaryLines.push(
      `  eMode category ${userReservesData.userEModeCategoryId} (v1.1 uses per-asset LT — see tool description for v2.3 caveat)`,
    );
  }

  return {
    content: [{ type: "text", text: summaryLines.join("\n") }],
    structuredContent: { ...result },
  };
});

/**
 * Compose a single position row from a (userReserve, reserve) pair. Mirror of
 * `get_portfolio_summary.ts::buildRow` shape — centralised so the per-row
 * fields agree across consumers (and the threat-model anchor for
 * T-AAVE-FROZEN-RESERVE-SILENT-OMIT-1 is at this seam: no `.filter` here).
 *
 * @param baseUnit  `marketReferenceCurrencyUnit` from `BaseCurrencyInfo` (e.g.
 *                  1e8 on mainnet). USD conversion divides by this unit.
 */
function buildPositionRow(
  ur: { scaledATokenBalance: bigint; scaledVariableDebt: bigint; usageAsCollateralEnabledOnUser: boolean; underlyingAsset: Address },
  reserve: {
    underlyingAsset: Address;
    symbol: string;
    decimals: bigint;
    liquidityIndex: bigint;
    variableBorrowIndex: bigint;
    liquidityRate: bigint;
    variableBorrowRate: bigint;
    priceInMarketReferenceCurrency: bigint;
    reserveLiquidationThreshold: bigint;
    isActive: boolean;
    isFrozen: boolean;
    aTokenAddress: Address;
    variableDebtTokenAddress: Address;
  },
  baseUnit: bigint,
  chainId: ChainId,
): LendingPositionRow {
  const decimals = Number(reserve.decimals);
  const baseDecimals = countBaseDecimals(baseUnit);

  const suppliedWei = (ur.scaledATokenBalance * reserve.liquidityIndex) / 10n ** 27n;
  const borrowedWei = (ur.scaledVariableDebt * reserve.variableBorrowIndex) / 10n ** 27n;
  const suppliedBase =
    (suppliedWei * reserve.priceInMarketReferenceCurrency) / 10n ** BigInt(decimals);
  const borrowedBase =
    (borrowedWei * reserve.priceInMarketReferenceCurrency) / 10n ** BigInt(decimals);

  // Phase 8 — Plan 08-02: per-chain registry dispatch (only chainId=1 has a
  // populated registry until Plan 08-03 lands the L2 JSON files). On L2s, the
  // fallback path returns the literal address.
  const symbol = reserve.symbol.length > 0 ? reserve.symbol : resolveSymbolFallback(reserve.underlyingAsset, chainId);

  return {
    asset: getAddress(reserve.underlyingAsset),
    symbol,
    decimals,
    suppliedScaled: ur.scaledATokenBalance.toString(),
    suppliedHuman: formatUnits(suppliedWei, decimals),
    suppliedUsd: formatUsdFromBase(suppliedBase, baseDecimals),
    borrowedScaled: ur.scaledVariableDebt.toString(),
    borrowedHuman: formatUnits(borrowedWei, decimals),
    borrowedUsd: formatUsdFromBase(borrowedBase, baseDecimals),
    liquidityRate: reserve.liquidityRate.toString(),
    variableBorrowRate: reserve.variableBorrowRate.toString(),
    liquidationThresholdBps: Number(reserve.reserveLiquidationThreshold),
    isFrozen: reserve.isFrozen,
    isActive: reserve.isActive,
    usageAsCollateralEnabledOnUser: ur.usageAsCollateralEnabledOnUser,
    aTokenAddress: getAddress(reserve.aTokenAddress),
    variableDebtTokenAddress: getAddress(reserve.variableDebtTokenAddress),
    priceInMarketReferenceCurrency: reserve.priceInMarketReferenceCurrency.toString(),
  };
}

/**
 * Defensive symbol fallback for malformed reserve config. The protocol-returned
 * `symbol` is the primary surface; the registry can only cover the top-50
 * ERC-20s, so rare misses surface as the literal underlying address rather
 * than synthesising an opaque label.
 *
 * Phase 8 — Plan 08-02: per-chain registry dispatch. v1.2-Plan-08-02 ship
 * state: only chainId=1 has a populated registry; L2 chains return [] and
 * the fallback path surfaces the literal underlying address.
 */
function resolveSymbolFallback(underlying: Address, chainId: ChainId): string {
  const registry = loadTokenRegistry(chainId);
  const checksummed = getAddress(underlying);
  const hit = registry.find((t: { address: Address }) => t.address === checksummed);
  return hit?.symbol ?? checksummed;
}

/**
 * Count trailing zeros in a power-of-ten `baseUnit` — yields the number of
 * decimal places used to convert baseCurrency-denominated values to USD.
 * For Aave V3 Ethereum mainnet: `1e8` → 8. Pure bigint; no `Math.log10`.
 */
function countBaseDecimals(baseUnit: bigint): number {
  if (baseUnit <= 0n) return 0;
  let n = baseUnit;
  let decimals = 0;
  while (n > 1n) {
    if (n % 10n !== 0n) break;
    n /= 10n;
    decimals += 1;
  }
  return decimals;
}

/**
 * Convert a baseCurrency-denominated value (e.g. `1000e8` = $1000 on mainnet)
 * to a USD string with 2-decimal precision. Uses `formatUnits` to recover the
 * full-precision decimal, then trims to cents.
 */
function formatUsdFromBase(valueBase: bigint, baseDecimals: number): string {
  if (valueBase === 0n) return "0.00";
  const full = formatUnits(valueBase, baseDecimals);
  const asNumber = Number(full);
  if (!Number.isFinite(asNumber)) return "0.00";
  return asNumber.toFixed(2);
}
