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

import { erc20Abi, formatUnits, getAddress, isAddress, type Address, type Hex } from "viem";

import { _aaveChains } from "../chains/aave-v3.js";
import { _compoundChains, type CometStateDecoded } from "../chains/compound-v3.js";
import { _morphoChains } from "../chains/morpho-blue.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import {
  chainIdFromName,
  getMorphoBlueAddress,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import {
  classifyLiquidationRisk,
  computeHealthFactor,
  HF_SCALE,
  type CollateralPosition,
  type DebtPosition,
  type LiquidationRisk,
} from "../signing/aave-health.js";
import {
  computeCompoundCollateralization,
  RATIO_SCALE,
  type CompoundCollateralPosition,
} from "../signing/compound-collateralization.js";
import morphoRegistryRaw from "../tokens/morpho-markets-ethereum.json" with { type: "json" };
import { loadTokenRegistry } from "../tokens/registry.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Read DeFi lending positions on a supported EVM chain for a wallet address (Aave V3 across all 5 chains; on Ethereum mainnet, also Compound V3 across the 6 canonical Comets).",
  "Returns per-position rows with a discriminator `protocol: \"aave-v3\" | \"compound-v3\"`, aggregate per-protocol summaries under `sources.{aave, compound}`, and protocol-native health metrics (Aave health factor; Compound `isBorrowCollateralized` + `isLiquidatable` booleans + derived collateralization ratio).",
  "Use when the user asks about their Aave or Compound positions, lending balances, borrow position, or health factor.",
  "Do NOT use for non-lending wallet balances — call `get_portfolio_summary` for wallet-level holdings.",
  "`chain` is REQUIRED — pass one of ethereum, arbitrum, polygon, base, optimism. Aave V3 reserves differ per chain; the server resolves the per-chain UiPoolDataProvider via the typed SOT.",
  "On Ethereum mainnet (chainId=1), the response ALSO returns Compound V3 positions across the 6 canonical Comets (cUSDCv3 / cUSDTv3 / cWETHv3 / cUSDSv3 / cwstETHv3 / cWBTCv3). Each position row carries a protocol discriminator (\"aave-v3\" | \"compound-v3\"); top-level `sources.{aave, compound}` summary surfaces both protocol arms with zero-value anchors (Compound arm zero-anchored on non-mainnet chains).",
  "Returns `{ chain, chainId, wallet, positions: [...], totalCollateralUsd, totalDebtUsd, healthFactor, noDebt, liquidationRisk, userEModeCategoryId, sources: { aave: {...}, compound: { perComet: [...] } }, rpcDegraded? }`. `totalCollateralUsd` / `totalDebtUsd` / `healthFactor` / `noDebt` / `liquidationRisk` describe the AAVE arm (Compound carries its own per-Comet metrics under `sources.compound.perComet`).",
  "`healthFactor` is `null` when the Aave user has no debt (`noDebt: true`); the agent checks `noDebt` BEFORE comparing `healthFactor` numerically.",
  "`liquidationRisk` is one of `\"safe\"` (HF >= 1.50), `\"warning\"` (1.10 <= HF < 1.50), `\"danger\"` (HF < 1.10), or `\"noDebt\"`.",
  "Each Aave position row carries `{ protocol: \"aave-v3\", asset, symbol, decimals, suppliedHuman, suppliedUsd, borrowedHuman, borrowedUsd, liquidityRate, variableBorrowRate, liquidationThresholdBps, isFrozen, isActive, usageAsCollateralEnabledOnUser, aTokenAddress, variableDebtTokenAddress, priceInMarketReferenceCurrency }`.",
  "Each Compound position row carries `{ protocol: \"compound-v3\", comet, baseToken, baseSymbol, suppliedHuman, borrowedHuman, isBorrowCollateralized, isLiquidatable, liquidationCollateralRatio, liquidationRisk, collateral: [...] }`.",
  "Frozen / inactive Aave reserves are surfaced verbatim — never silently omitted; the agent decides whether to route around them.",
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

interface AaveLendingPositionRow {
  protocol: "aave-v3";
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

interface CompoundCollateralRowSurface {
  asset: Address;
  balance: string;
  balanceHuman: string;
  priceUsd: string;
  borrowCollateralFactor: string;
  liquidateCollateralFactor: string;
}

interface CompoundLendingPositionRow {
  protocol: "compound-v3";
  comet: Address;
  baseToken: Address;
  baseSymbol: string;
  baseDecimals: number;
  suppliedScaled: string;
  suppliedHuman: string;
  borrowedScaled: string;
  borrowedHuman: string;
  isBorrowCollateralized: boolean;
  isLiquidatable: boolean;
  liquidationCollateralRatio: string | null;
  liquidationRisk: LiquidationRisk;
  collateral: CompoundCollateralRowSurface[];
}

/**
 * Phase 29 Plan 29-03 — Morpho Blue row shape. Mirror of `MorphoPositionRow`
 * from `get_morpho_positions.ts` + `protocol: "morpho-blue"` discriminator.
 * No on-chain health-factor surface — Morpho's per-market isolation makes
 * the cross-market HF concept inapplicable.
 */
interface MorphoLendingPositionRow {
  protocol: "morpho-blue";
  marketId: Hex;
  marketLabel: string | null;
  loanToken: { address: Address; symbol: string; decimals: number };
  collateralToken: { address: Address; symbol: string; decimals: number };
  lltv: string;
  supplyShares: string;
  supplyAssetsExpected: string;
  borrowShares: string;
  borrowAssetsExpected: string;
  collateral: string;
  isUnlabeled: boolean;
  // Phase 29 Plan 29-03 — Stale-market annotation (WR-01 parity with
  // get_morpho_positions.ts:157). The supplyAssetsExpected /
  // borrowAssetsExpected fields are off-chain SharesMathLib simulations
  // against the stale market state; on-chain accrueInterest at tx time
  // produces a slightly different figure.
  displayValue: string;
}

type LendingPositionRow =
  | AaveLendingPositionRow
  | CompoundLendingPositionRow
  | MorphoLendingPositionRow;

interface CompoundCometSummary {
  comet: Address;
  ratioScaled: string | null;
  isBorrowCollateralized: boolean;
  isLiquidatable: boolean;
  noDebt: boolean;
}

interface MorphoSourceSummary {
  marketsTouched: number;
  marketsActive: number;
}

interface SourcesSummary {
  aave: {
    totalCollateralUsd: string;
    totalDebtUsd: string;
    healthFactor: string | null;
    liquidationRisk: LiquidationRisk;
    noDebt: boolean;
  };
  compound: {
    perComet: CompoundCometSummary[];
  };
  morpho: MorphoSourceSummary;
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
  sources: SourcesSummary;
  rpcDegraded?: boolean;
}

/**
 * Pure extraction of the Aave V3 read path. Plan 28-04 EXTENDS this tool with
 * a Compound V3 branch via `Promise.all([readAavePositions, getAllCometStates])`.
 *
 * Byte-identity invariant: the Aave row shape is BYTE-IDENTICAL to pre-28-04
 * — the only added field is the `protocol: "aave-v3"` discriminator. Test
 * suite `test/get-lending-positions.test.ts` re-asserts this against a pinned
 * fixture.
 */
async function readAavePositions(
  client: import("viem").PublicClient,
  chainId: ChainId,
  wallet: Address,
): Promise<{
  positions: AaveLendingPositionRow[];
  totalCollateralBase: bigint;
  totalDebtBase: bigint;
  collateralPositions: CollateralPosition[];
  debtPositions: DebtPosition[];
  baseUnit: bigint;
  userEModeCategoryId: number;
}> {
  const [reservesData, userReservesData] = await Promise.all([
    _aaveChains.getReservesData(client, chainId),
    _aaveChains.getUserReservesData(client, chainId, wallet),
  ]);

  const reserveByAsset = new Map(
    reservesData.reserves.map((r) => [getAddress(r.underlyingAsset), r] as const),
  );

  const baseUnit = reservesData.baseCurrency.marketReferenceCurrencyUnit;

  const positions: AaveLendingPositionRow[] = [];
  const collateralPositions: CollateralPosition[] = [];
  const debtPositions: DebtPosition[] = [];

  let totalCollateralBase = 0n;
  let totalDebtBase = 0n;

  for (const ur of userReservesData.userReserves) {
    const underlying = getAddress(ur.underlyingAsset);
    const reserve = reserveByAsset.get(underlying);
    if (!reserve) continue;

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

  return {
    positions,
    totalCollateralBase,
    totalDebtBase,
    collateralPositions,
    debtPositions,
    baseUnit,
    userEModeCategoryId: userReservesData.userEModeCategoryId,
  };
}

/**
 * Build a Compound V3 lending position row + the per-Comet summary block from
 * a `CometStateDecoded` + an optional resolved base-token decimals/symbol.
 * Returns `null` when the wallet has zero base + zero collateral on this Comet
 * (the row is filtered out — mirror Aave skip-zero-reserves discipline). The
 * per-Comet summary IS always emitted (zero-anchor — patterns § 2 T-LENDING-
 * MULTIPROTOCOL-1).
 */
function buildCompoundRow(
  state: CometStateDecoded,
  baseTokenInfo: { symbol: string; decimals: number },
): { row: CompoundLendingPositionRow | null; summary: CompoundCometSummary } {
  // Build the pure-bigint collateral-math input.
  const collateral: CompoundCollateralPosition[] = state.collateral.map((c) => ({
    balance: c.balance,
    priceUsd: c.priceUsd,
    decimals: c.decimals,
    borrowCollateralFactor: c.borrowCollateralFactor,
    liquidateCollateralFactor: c.liquidateCollateralFactor,
  }));

  const collateralization = computeCompoundCollateralization({
    collateral,
    base: {
      baseBorrowed: state.baseBorrowed,
      basePriceUsd: state.baseTokenPriceUsd,
      baseDecimals: baseTokenInfo.decimals,
    },
  });

  const ratioScaled = collateralization.ratioScaled;
  const liquidationCollateralRatio =
    ratioScaled === null ? null : formatUnits(ratioScaled, 18);

  const summary: CompoundCometSummary = {
    comet: state.comet,
    ratioScaled: ratioScaled === null ? null : ratioScaled.toString(),
    isBorrowCollateralized: state.isBorrowCollateralized,
    isLiquidatable: state.isLiquidatable,
    noDebt: state.baseBorrowed === 0n,
  };

  const hasNonzeroCollateral = state.collateral.some((c) => c.balance > 0n);
  if (state.baseSupplied === 0n && state.baseBorrowed === 0n && !hasNonzeroCollateral) {
    return { row: null, summary };
  }

  const collateralSurface: CompoundCollateralRowSurface[] = state.collateral.map((c) => ({
    asset: c.asset,
    balance: c.balance.toString(),
    balanceHuman: formatUnits(c.balance, c.decimals),
    priceUsd: formatUnits(c.priceUsd, 8),
    borrowCollateralFactor: formatUnits(c.borrowCollateralFactor, 18),
    liquidateCollateralFactor: formatUnits(c.liquidateCollateralFactor, 18),
  }));

  const row: CompoundLendingPositionRow = {
    protocol: "compound-v3",
    comet: state.comet,
    baseToken: state.baseToken,
    baseSymbol: baseTokenInfo.symbol,
    baseDecimals: baseTokenInfo.decimals,
    suppliedScaled: state.baseSupplied.toString(),
    suppliedHuman: formatUnits(state.baseSupplied, baseTokenInfo.decimals),
    borrowedScaled: state.baseBorrowed.toString(),
    borrowedHuman: formatUnits(state.baseBorrowed, baseTokenInfo.decimals),
    isBorrowCollateralized: state.isBorrowCollateralized,
    isLiquidatable: state.isLiquidatable,
    liquidationCollateralRatio,
    liquidationRisk: collateralization.liquidationRisk,
    collateral: collateralSurface,
  };
  return { row, summary };
}

/**
 * Resolve `{ symbol, decimals }` for a Compound base token. Registry-first;
 * RPC fallback. Best-effort — on RPC failure, returns sentinel `{ symbol:
 * "?", decimals: 18 }`. Compound mainnet base tokens (USDC / USDT / WETH /
 * USDS / wstETH / WBTC) are all in the top-50 registry for chainId=1.
 */
async function resolveBaseToken(
  client: import("viem").PublicClient,
  chainId: ChainId,
  token: Address,
): Promise<{ symbol: string; decimals: number }> {
  const registry = loadTokenRegistry(chainId);
  const hit = registry.find((entry) => entry.address === token);
  if (hit) return { symbol: hit.symbol, decimals: hit.decimals };
  try {
    const [decimals, symbol] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    ]);
    return { symbol: String(symbol), decimals: Number(decimals) };
  } catch {
    return { symbol: "?", decimals: 18 };
  }
}

/**
 * Phase 29 Plan 29-03 — Morpho registry shape (mirror of
 * `get_morpho_positions.ts` REGISTRY consumer). Lookup keyed by lowercased
 * marketId.
 */
interface MorphoMarketRegistryEntry {
  marketId: Hex;
  loanToken: { address: Address; symbol: string; decimals: number };
  collateralToken: { address: Address; symbol: string; decimals: number };
  oracle: Address;
  irm: Address;
  lltv: string;
  label: string;
}

const MORPHO_REGISTRY: ReadonlyMap<string, MorphoMarketRegistryEntry> = (() => {
  const m = new Map<string, MorphoMarketRegistryEntry>();
  for (const raw of morphoRegistryRaw as readonly MorphoMarketRegistryEntry[]) {
    m.set(raw.marketId.toLowerCase(), raw);
  }
  return m;
})();

/**
 * Morpho Blue read path — concurrent fan-out across every market the wallet
 * has touched (Supply / Borrow / SupplyCollateral event scan). Mirror of the
 * read path in `get_morpho_positions.ts` but inlined here to keep
 * `get_lending_positions.ts` self-contained at the Phase 29 trust boundary.
 *
 * Returns the rows + a summary `{ marketsTouched, marketsActive }`. On RPC
 * failure (either the event scan or any per-market read), returns
 * `{ rows: [], summary: { marketsTouched: 0, marketsActive: 0 } }` and lets
 * the caller surface rpcDegraded via the public-node fallback path.
 */
async function readMorphoPositionsForWallet(
  client: import("viem").PublicClient,
  chainId: ChainId,
  wallet: Address,
): Promise<{ rows: MorphoLendingPositionRow[]; summary: MorphoSourceSummary }> {
  // Phase 29 ships chainId 1 only; non-mainnet → empty.
  if (chainId !== 1) {
    return { rows: [], summary: { marketsTouched: 0, marketsActive: 0 } };
  }
  const morpho = getMorphoBlueAddress(1);
  if (!morpho) {
    return { rows: [], summary: { marketsTouched: 0, marketsActive: 0 } };
  }

  let touchedMarketIds: Set<Hex>;
  try {
    touchedMarketIds = await _morphoChains.scanTouchedMarkets(client, wallet, { morpho });
  } catch {
    // Event-log scan failure — caller surfaces rpcDegraded via the
    // public-node fallback path. Don't throw; return empty.
    return { rows: [], summary: { marketsTouched: 0, marketsActive: 0 } };
  }

  if (touchedMarketIds.size === 0) {
    return { rows: [], summary: { marketsTouched: 0, marketsActive: 0 } };
  }

  const marketIdList = Array.from(touchedMarketIds);
  const marketResults = await Promise.all(
    marketIdList.map(async (id) => {
      try {
        const [pos, mkt, params] = await Promise.all([
          _morphoChains.readPosition(client, morpho, id, wallet),
          _morphoChains.readMarket(client, morpho, id),
          _morphoChains.readMarketParams(client, morpho, id),
        ]);
        if (pos.supplyShares === 0n && pos.borrowShares === 0n && pos.collateral === 0n) {
          return null;
        }
        const registryEntry = MORPHO_REGISTRY.get(id.toLowerCase());
        const isUnlabeled = !registryEntry;
        let loanToken: { address: Address; symbol: string; decimals: number };
        let collateralToken: { address: Address; symbol: string; decimals: number };
        if (registryEntry) {
          loanToken = {
            address: getAddress(registryEntry.loanToken.address),
            symbol: registryEntry.loanToken.symbol,
            decimals: registryEntry.loanToken.decimals,
          };
          collateralToken = {
            address: getAddress(registryEntry.collateralToken.address),
            symbol: registryEntry.collateralToken.symbol,
            decimals: registryEntry.collateralToken.decimals,
          };
        } else {
          const [loanInfo, collateralInfo] = await Promise.all([
            resolveBaseToken(client, chainId, params.loanToken),
            resolveBaseToken(client, chainId, params.collateralToken),
          ]);
          loanToken = {
            address: getAddress(params.loanToken),
            symbol: loanInfo.symbol,
            decimals: loanInfo.decimals,
          };
          collateralToken = {
            address: getAddress(params.collateralToken),
            symbol: collateralInfo.symbol,
            decimals: collateralInfo.decimals,
          };
        }
        const supplyAssetsExpected = _morphoChains.computeExpectedSupplyAssets(pos, mkt);
        const borrowAssetsExpected = _morphoChains.computeExpectedBorrowAssets(pos, mkt);
        const row: MorphoLendingPositionRow = {
          protocol: "morpho-blue",
          marketId: id,
          marketLabel: registryEntry?.label ?? null,
          loanToken,
          collateralToken,
          lltv: params.lltv.toString(),
          supplyShares: pos.supplyShares.toString(),
          supplyAssetsExpected: supplyAssetsExpected.toString(),
          borrowShares: pos.borrowShares.toString(),
          borrowAssetsExpected: borrowAssetsExpected.toString(),
          collateral: pos.collateral.toString(),
          isUnlabeled,
          displayValue:
            "approx (stale market state; on-chain accrueInterest happens at tx time)",
        };
        return row;
      } catch {
        // Per-market read failure — skip; the per-market degraded surface
        // lives in get_morpho_positions; here we collapse to zero contribution.
        return null;
      }
    }),
  );

  const rows = marketResults.filter((r): r is MorphoLendingPositionRow => r !== null);
  return {
    rows,
    summary: {
      marketsTouched: touchedMarketIds.size,
      marketsActive: rows.length,
    },
  };
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

  // Phase 28 / 29 — three-protocol concurrent fan-out: Aave V3 + Compound V3 +
  // Morpho Blue. Compound + Morpho are mainnet-only in v2.3; non-mainnet
  // chains short-circuit to empty arrays. Aave runs on all 5 chains.
  let aaveLeg: Awaited<ReturnType<typeof readAavePositions>>;
  let compoundLeg: CometStateDecoded[];
  let morphoLeg: { rows: MorphoLendingPositionRow[]; summary: MorphoSourceSummary };
  try {
    [aaveLeg, compoundLeg, morphoLeg] = await Promise.all([
      readAavePositions(client, chainId, wallet),
      chainId === 1
        ? _compoundChains.getAllCometStates(client, chainId, wallet)
        : Promise.resolve<CometStateDecoded[]>([]),
      readMorphoPositionsForWallet(client, chainId, wallet),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `error: failed to read lending positions for ${wallet}: ${message}`,
        },
      ],
      isError: true,
    };
  }

  const aaveHf = computeHealthFactor({
    collateralPositions: aaveLeg.collateralPositions,
    debtPositions: aaveLeg.debtPositions,
  });
  const aaveLiquidationRisk = classifyLiquidationRisk(aaveHf.healthFactorScaled, aaveHf.noDebt);
  const aaveHealthFactor =
    aaveHf.healthFactorScaled === null ? null : formatUnits(aaveHf.healthFactorScaled, 18);

  const baseDecimals = countBaseDecimals(aaveLeg.baseUnit);
  const totalCollateralUsd = formatUsdFromBase(aaveLeg.totalCollateralBase, baseDecimals);
  const totalDebtUsd = formatUsdFromBase(aaveLeg.totalDebtBase, baseDecimals);

  // Build Compound rows + per-Comet summaries. Resolve base-token metadata in
  // parallel (one resolve per Comet — the registry hit is synchronous; RPC
  // fallback fires only for unmapped tokens).
  const baseTokenInfos = await Promise.all(
    compoundLeg.map((state) => resolveBaseToken(client, chainId, state.baseToken)),
  );

  const compoundRows: CompoundLendingPositionRow[] = [];
  const compoundSummaries: CompoundCometSummary[] = [];
  compoundLeg.forEach((state, i) => {
    const baseTokenInfo = baseTokenInfos[i]!;
    const { row, summary } = buildCompoundRow(state, baseTokenInfo);
    compoundSummaries.push(summary);
    if (row !== null) compoundRows.push(row);
  });

  // Merge Aave + Compound + Morpho rows. Order is deterministic: Aave first
  // (preserving pre-28-04 ordering for byte-identity), then Compound, then
  // Morpho (added in Plan 29-03 — purely additive).
  const aaveRows: AaveLendingPositionRow[] = aaveLeg.positions;
  const morphoRows: MorphoLendingPositionRow[] = morphoLeg.rows;
  const positions: LendingPositionRow[] = [...aaveRows, ...compoundRows, ...morphoRows];

  const result: LendingPositionsResult = {
    chain: chainName,
    chainId,
    wallet,
    positions,
    totalCollateralUsd,
    totalDebtUsd,
    healthFactor: aaveHealthFactor,
    noDebt: aaveHf.noDebt,
    liquidationRisk: aaveLiquidationRisk,
    userEModeCategoryId: aaveLeg.userEModeCategoryId,
    sources: {
      aave: {
        totalCollateralUsd,
        totalDebtUsd,
        healthFactor: aaveHealthFactor,
        liquidationRisk: aaveLiquidationRisk,
        noDebt: aaveHf.noDebt,
      },
      compound: { perComet: compoundSummaries },
      morpho: morphoLeg.summary,
    },
  };
  if (isPublicNodeFallback(chainId)) result.rpcDegraded = true;

  const summaryLines: string[] = [];
  summaryLines.push(`Aave V3 positions for ${wallet}:`);
  if (aaveRows.length === 0) {
    summaryLines.push("  (no supplied or borrowed positions)");
  } else {
    for (const p of aaveRows) {
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
    aaveHf.noDebt
      ? "noDebt"
      : aaveHealthFactor === null
        ? "noDebt"
        : `${Number(aaveHealthFactor).toFixed(4)} (${aaveLiquidationRisk})`;
  summaryLines.push(
    `  collateral $${totalCollateralUsd} / debt $${totalDebtUsd} / HF ${hfText}${
      result.rpcDegraded ? " (rpcDegraded)" : ""
    }`,
  );
  if (aaveLeg.userEModeCategoryId !== 0) {
    summaryLines.push(
      `  eMode category ${aaveLeg.userEModeCategoryId} (v1.1 uses per-asset LT — see tool description for v2.3 caveat)`,
    );
  }

  if (chainId === 1) {
    summaryLines.push("");
    summaryLines.push(`Compound V3 positions for ${wallet}:`);
    if (compoundRows.length === 0) {
      summaryLines.push("  (no supplied / borrowed / collateral positions across 6 Comets)");
    } else {
      for (const r of compoundRows) {
        const parts: string[] = [];
        if (r.suppliedScaled !== "0") parts.push(`supplied ${r.suppliedHuman} ${r.baseSymbol}`);
        if (r.borrowedScaled !== "0") parts.push(`borrowed ${r.borrowedHuman} ${r.baseSymbol}`);
        if (r.collateral.length > 0) {
          const collateralParts = r.collateral.map((c) => `${c.balanceHuman} @ ${c.asset.slice(0, 8)}`);
          parts.push(`collateral [${collateralParts.join(", ")}]`);
        }
        const riskText =
          r.liquidationCollateralRatio === null
            ? "noDebt"
            : `ratio ${Number(r.liquidationCollateralRatio).toFixed(4)} (${r.liquidationRisk})`;
        summaryLines.push(
          `  ${r.comet}: ${parts.join(" + ")} — isBorrowCollateralized=${r.isBorrowCollateralized}, isLiquidatable=${r.isLiquidatable}, ${riskText}`,
        );
      }
    }

    summaryLines.push("");
    summaryLines.push(`Morpho Blue positions for ${wallet}:`);
    if (morphoRows.length === 0) {
      summaryLines.push(
        `  (no positions across ${morphoLeg.summary.marketsTouched} touched markets)`,
      );
    } else {
      for (const r of morphoRows) {
        const label = r.marketLabel ?? `[UNKNOWN MARKET — verify oracle + IRM externally]`;
        const parts: string[] = [];
        if (r.supplyShares !== "0") {
          parts.push(
            `supplied ${formatUnits(BigInt(r.supplyAssetsExpected), r.loanToken.decimals)} ${r.loanToken.symbol}`,
          );
        }
        if (r.borrowShares !== "0") {
          parts.push(
            `borrowed ${formatUnits(BigInt(r.borrowAssetsExpected), r.loanToken.decimals)} ${r.loanToken.symbol}`,
          );
        }
        if (r.collateral !== "0") {
          parts.push(
            `collateral ${formatUnits(BigInt(r.collateral), r.collateralToken.decimals)} ${r.collateralToken.symbol}`,
          );
        }
        summaryLines.push(`  ${label}: ${parts.join(" + ")}`);
      }
    }
  }

  // Suppress unused-import warning for the RATIO_SCALE re-export (used by
  // downstream consumers + cross-tests; kept on the import path so a single
  // edit doesn't cascade through the type chain).
  void RATIO_SCALE;

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
): AaveLendingPositionRow {
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

  // Phase 28 Plan 28-04: `protocol: "aave-v3"` discriminator added — the
  // ONLY change to the Aave row shape. All other fields BYTE-IDENTICAL to
  // pre-28-04.
  return {
    protocol: "aave-v3",
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
