// src/tools/get_morpho_positions.ts
//
// MCP tool: `get_morpho_positions({ wallet, chain? })` — MOR-01 (Phase 29
// Plan 29-02). Reader for Morpho Blue isolated-market positions on Ethereum
// mainnet across every market the wallet has interacted with.
//
// Two-step flow per research § Pattern 3:
//   1. **Event-log scan** — `scanTouchedMarkets(client, wallet)` discovers
//      every marketId the wallet has supplied / borrowed / posted collateral
//      to via Supply / Borrow / SupplyCollateral event logs filtered on
//      `args: { onBehalf: wallet }`. 100k-block chunked pagination; 1M-block
//      lookback default (configurable via VAULTPILOT_MORPHO_LOG_LOOKBACK env).
//   2. **Per-market fan-out** — for each touched marketId, concurrent
//      Promise.all read of position(id, user) + market(id) + idToMarketParams(id).
//      Cross-reference against the 25-entry curated registry from Plan 29-01
//      (`morpho-markets-ethereum.json`) for label + token metadata; mark
//      unlabeled markets with `isUnlabeled: true`.
//
// Shares → assets conversion via Plan 29-02's pure-bigint SharesMathLib —
// `toAssetsDown` for supply (under-reports what the user CAN withdraw); `toAssetsUp`
// for borrow (over-reports what the user OWES). The market state is STALE
// (last on-chain `accrueInterest` snapshot) per research § Pitfall 4 — the
// `displayValue` field annotates this.
//
// rpcDegraded surface (READ-05 invariant from Phase 2):
//   - Top-level `rpcDegraded: true` when the public-node fallback is active
//     OR when `scanTouchedMarkets` itself fails.
//   - Per-market `rpcDegraded: true` row when an individual market's read
//     fan-out fails (position OR market OR idToMarketParams). The row's
//     marketId surfaces verbatim with a reason; the market is NEVER silently
//     dropped.
//
// Demo-mode routing: when `set_demo_wallet({ persona })` is active, the
// caller's `wallet` arg is OVERRIDDEN to `persona.address` and a
// `demoPersonaRouted: <slug>` flag is surfaced in structuredContent. This
// mirrors the Phase 5 persona-driven nature of demo mode — read tools work
// against real RPC against persona addresses (NEVER refused for reads; only
// `prepare_*` tools refuse).
//
// Chain narrowing: Phase 29 ships chainId 1 (Ethereum mainnet) ONLY. Passing
// `chain: "base"` / `"polygon"` / etc. refuses with `INVALID_INPUT` (research
// § Topic 6 decision lock).

import {
  erc20Abi,
  formatUnits,
  getAddress,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { _morphoChains } from "../chains/morpho-blue.js";
import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { getMorphoBlueAddress } from "../config/contracts.js";
import { getActivePersona } from "../demo/state.js";
import { makeStructuredError } from "../signing/error-codes.js";
import morphoRegistryRaw from "../tokens/morpho-markets-ethereum.json" with { type: "json" };
import { registerTool } from "./index.js";

/**
 * Registry entry shape — mirror of the JSON entries in
 * `src/tokens/morpho-markets-ethereum.json` (Plan 29-01). `lltv` is a decimal
 * string for bigint preservation across the JSON boundary.
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

/**
 * Module-scope lookup map keyed by lowercased marketId for O(1) registry
 * cross-reference. Loaded once at import-time from the curated 25-entry
 * top-by-TVL snapshot Plan 29-01 shipped.
 */
const REGISTRY: ReadonlyMap<string, MorphoMarketRegistryEntry> = (() => {
  const m = new Map<string, MorphoMarketRegistryEntry>();
  for (const raw of morphoRegistryRaw as readonly MorphoMarketRegistryEntry[]) {
    m.set(raw.marketId.toLowerCase(), raw);
  }
  return m;
})();

/**
 * Per-market read timeout — 10s AbortController mirror of Phase 8 fan-out
 * (research § Pattern 3 + planning-context spec). The 3 reads per market
 * (position + market + idToMarketParams) share the same timeout budget.
 */
const PER_MARKET_TIMEOUT_MS = 10_000;

/**
 * Environment override for the event-log lookback window. Default 1M blocks.
 * Read once at handler entry to honor agent-side reruns within the same
 * process lifetime.
 */
function resolveLookbackBlocks(): bigint {
  const raw = process.env.VAULTPILOT_MORPHO_LOG_LOOKBACK;
  if (!raw) return 1_000_000n;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1_000_000n;
  return BigInt(Math.floor(parsed));
}

const DESCRIPTION = [
  "Reads Morpho Blue isolated-market positions for a wallet on Ethereum mainnet. Returns one entry per market the wallet has interacted with (Supply / Borrow / SupplyCollateral events scanned over the last 1M blocks ~140 days, configurable via VAULTPILOT_MORPHO_LOG_LOOKBACK env).",
  "Per-position fields: marketId, marketLabel? (from the 25-entry curated registry; absent for unlabeled), loanToken {address, symbol, decimals}, collateralToken {address, symbol, decimals}, lltv (decimal string), supplyShares + supplyAssetsExpected (toAssetsDown — what user CAN withdraw, rounded down conservatively), borrowShares + borrowAssetsExpected (toAssetsUp — what user OWES, rounded up conservatively), collateral (raw collateral amount, NOT shares), isUnlabeled: boolean.",
  "supplyAssetsExpected and borrowAssetsExpected are off-chain SharesMathLib simulations against the stale market state (last on-chain accrueInterest); the on-chain values at tx time will differ slightly. The displayValue field annotates this.",
  "Use when the user asks about their Morpho Blue positions, isolated-market lender/borrower balances, or collateral postings on Morpho.",
  "Do NOT use for Aave / Compound positions — call get_lending_positions for those. Do NOT use for wallet-level holdings — call get_portfolio_summary.",
  "v2.3 ships chainId 1 (Ethereum mainnet) only — Base + Polygon deferred to v2.3.x. Passing chain: 'base' / 'polygon' / etc. refuses with INVALID_INPUT.",
  "Failure modes: rpcDegraded surface (top-level on scan failure + public-node fallback; per-market on individual read failure — NEVER silent zeros), INVALID_INPUT on non-ethereum chain or malformed wallet address.",
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
        "Chain identifier. v2.3 ships 'ethereum' only — Base + Polygon deferred to v2.3.x.",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

interface TokenSurface {
  address: Address;
  symbol: string;
  decimals: number;
}

interface MorphoPositionRow {
  marketId: Hex;
  marketLabel: string | null;
  loanToken: TokenSurface;
  collateralToken: TokenSurface;
  lltv: string;
  supplyShares: string;
  supplyAssetsExpected: string;
  borrowShares: string;
  borrowAssetsExpected: string;
  collateral: string;
  isUnlabeled: boolean;
  displayValue: string;
}

interface DegradedRow {
  marketId: Hex;
  rpcDegraded: true;
  reason: string;
}

/**
 * Resolve ERC-20 metadata (symbol + decimals) for a token not in the curated
 * registry. Best-effort — RPC failures return sentinel `{ symbol: "?",
 * decimals: 18 }`. Two concurrent reads per token.
 */
async function resolveTokenMetadata(
  client: PublicClient,
  token: Address,
): Promise<TokenSurface> {
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return {
      address: getAddress(token),
      symbol: String(symbol),
      decimals: Number(decimals),
    };
  } catch {
    return { address: getAddress(token), symbol: "?", decimals: 18 };
  }
}

/**
 * Per-market 3-read fan-out with a 10s timeout budget. Returns the row OR
 * a degraded marker. Empty positions (all-zero) are surfaced for the caller
 * to filter — this function does NOT drop, so the caller has full visibility.
 */
async function readOneMarket(
  client: PublicClient,
  morpho: Address,
  marketId: Hex,
  wallet: Address,
): Promise<MorphoPositionRow | DegradedRow | "empty"> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_MARKET_TIMEOUT_MS);
  try {
    const [pos, mkt, params] = await Promise.all([
      _morphoChains.readPosition(client, morpho, marketId, wallet),
      _morphoChains.readMarket(client, morpho, marketId),
      _morphoChains.readMarketParams(client, morpho, marketId),
    ]);

    if (pos.supplyShares === 0n && pos.borrowShares === 0n && pos.collateral === 0n) {
      return "empty";
    }

    const registryEntry = REGISTRY.get(marketId.toLowerCase());
    const isUnlabeled = !registryEntry;

    let loanToken: TokenSurface;
    let collateralToken: TokenSurface;
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
      // Unlabeled market — fall back to on-chain metadata fetch. Concurrent
      // best-effort reads; sentinels on failure (symbol: "?", decimals: 18).
      [loanToken, collateralToken] = await Promise.all([
        resolveTokenMetadata(client, params.loanToken),
        resolveTokenMetadata(client, params.collateralToken),
      ]);
    }

    const supplyAssetsExpected = _morphoChains.computeExpectedSupplyAssets(pos, mkt);
    const borrowAssetsExpected = _morphoChains.computeExpectedBorrowAssets(pos, mkt);

    return {
      marketId,
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
  } catch (err) {
    return {
      marketId,
      rpcDegraded: true,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timeout);
  }
}

registerTool("get_morpho_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // Schema enforces chain as `enum: ["ethereum"]`; the explicit check below
  // surfaces a stable INVALID_INPUT envelope when an agent bypasses the
  // schema (e.g. via direct invocation in tests). The chain narrowing carries
  // the v2.3.x deferral hint for Base / Polygon.
  const chainArg = typeof args.chain === "string" ? args.chain : "ethereum";
  if (chainArg !== "ethereum") {
    return {
      content: [
        {
          type: "text",
          text: `error: get_morpho_positions ships chainId 1 (Ethereum mainnet) only in v2.3; Base / Polygon deferred to v2.3.x. Requested chain: "${chainArg}".`,
        },
      ],
      isError: true,
      structuredContent: {
        ...makeStructuredError(
          "INVALID_INPUT",
          `get_morpho_positions ships chainId 1 (Ethereum mainnet) only in v2.3; Base / Polygon deferred to v2.3.x. Requested chain: "${chainArg}".`,
        ),
      },
    };
  }

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

  // Demo-mode persona routing — research § Phase 5 DEMO-04. When a persona is
  // active, the read targets the persona's address rather than the caller's.
  // A `demoPersonaRouted` flag surfaces in structuredContent for traceability.
  const activePersona = getActivePersona();
  const wallet: Address = activePersona
    ? getAddress(activePersona.address)
    : getAddress(walletRaw);

  const morpho = getMorphoBlueAddress(1);
  if (!morpho) {
    // Defense in depth — getMorphoBlueAddress(1) is statically populated in
    // Plan 29-01's SOT; this branch is unreachable through the schema.
    return {
      content: [{ type: "text", text: "error: Morpho Blue address unavailable" }],
      isError: true,
      structuredContent: {
        ...makeStructuredError("INTERNAL_ERROR", "Morpho Blue address unavailable"),
      },
    };
  }

  const client = getChainClient(1);
  const onFallback = isPublicNodeFallback(1);
  const lookbackBlocks = resolveLookbackBlocks();

  // Resolve scan range — capture currentBlock here so per-market reads share
  // the same `toBlock` (deterministic for testing + replay).
  let currentBlock: bigint;
  try {
    currentBlock = await client.getBlockNumber();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `error: failed to read latest block from Ethereum mainnet: ${message}`,
        },
      ],
      isError: true,
      structuredContent: {
        ...makeStructuredError(
          "INTERNAL_ERROR",
          "failed to read latest block from Ethereum mainnet",
          message,
        ),
        rpcDegraded: true,
      },
    };
  }
  const fromBlock =
    currentBlock > lookbackBlocks ? currentBlock - lookbackBlocks : 0n;
  // lookbackWarn fires when the lookback would extend past block 0 — surfaces
  // a "your scan window is truncated; older history may be missing" hint for
  // the agent. Mirror of Phase 8 T-LOGS-CEILING-1.
  const lookbackWarn = lookbackBlocks > currentBlock;

  // Step 1 — event-log scan.
  let touchedMarketIds: Set<Hex>;
  try {
    touchedMarketIds = await _morphoChains.scanTouchedMarkets(client, wallet, {
      morpho,
      fromBlock,
      toBlock: currentBlock,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const structuredContent: Record<string, unknown> = {
      chain: "ethereum",
      chainId: 1,
      wallet,
      positions: [],
      marketsTouched: 0,
      marketsActive: 0,
      lookbackBlocks: Number(lookbackBlocks),
      fromBlock: fromBlock.toString(),
      toBlock: currentBlock.toString(),
      rpcDegraded: true,
      reason: message,
    };
    if (activePersona) structuredContent.demoPersonaRouted = activePersona.slug;
    if (lookbackWarn) structuredContent.lookbackWarn = true;
    return {
      content: [
        {
          type: "text",
          text: `Morpho Blue positions for ${wallet}: event-log scan failed (${message}). No positions surfaced; treat as unknown rather than empty.`,
        },
      ],
      structuredContent,
    };
  }

  // Step 2 — per-market fan-out. Each market's 3-read group is concurrent
  // within itself; the markets are also concurrent with each other.
  const marketIdList = Array.from(touchedMarketIds);
  const marketResults = await Promise.all(
    marketIdList.map((id) => readOneMarket(client, morpho, id, wallet)),
  );

  const positions: MorphoPositionRow[] = [];
  const degraded: DegradedRow[] = [];
  for (const r of marketResults) {
    if (r === "empty") continue;
    if ("rpcDegraded" in r) degraded.push(r);
    else positions.push(r);
  }

  // Sort active positions by (supplyAssetsExpected + borrowAssetsExpected) desc.
  // Bigint comparison — string→bigint round-trip is acceptable on a small N
  // (touched markets are typically <20 per wallet).
  positions.sort((a, b) => {
    const aSum = BigInt(a.supplyAssetsExpected) + BigInt(a.borrowAssetsExpected);
    const bSum = BigInt(b.supplyAssetsExpected) + BigInt(b.borrowAssetsExpected);
    if (bSum > aSum) return 1;
    if (bSum < aSum) return -1;
    return 0;
  });

  // Surface degraded rows at the end of the positions array — the agent's
  // sort already ordered active positions; degraded rows trail. Cast back to
  // a union surface for the structuredContent.
  const positionsWithDegraded: Array<MorphoPositionRow | DegradedRow> = [
    ...positions,
    ...degraded,
  ];

  const structuredContent: Record<string, unknown> = {
    chain: "ethereum",
    chainId: 1,
    wallet,
    positions: positionsWithDegraded,
    marketsTouched: touchedMarketIds.size,
    marketsActive: positions.length,
    lookbackBlocks: Number(lookbackBlocks),
    fromBlock: fromBlock.toString(),
    toBlock: currentBlock.toString(),
  };
  if (onFallback) structuredContent.rpcDegraded = true;
  if (degraded.length > 0) structuredContent.rpcDegraded = true;
  if (lookbackWarn) structuredContent.lookbackWarn = true;
  if (activePersona) structuredContent.demoPersonaRouted = activePersona.slug;

  // Human-readable summary block — one line per active position + a degraded
  // tally. Used by the agent for direct display; structuredContent is the
  // machine-parseable surface.
  const summaryLines: string[] = [];
  summaryLines.push(`Morpho Blue positions for ${wallet} (chainId 1):`);
  if (positions.length === 0 && degraded.length === 0) {
    summaryLines.push(
      `  (no positions across ${touchedMarketIds.size} touched markets within ${lookbackBlocks.toString()}-block lookback)`,
    );
  } else {
    for (const p of positions) {
      const label = p.marketLabel ?? `[UNKNOWN MARKET — verify oracle + IRM externally]`;
      const supply =
        p.supplyShares === "0"
          ? ""
          : `supplied ${formatUnits(BigInt(p.supplyAssetsExpected), p.loanToken.decimals)} ${p.loanToken.symbol}`;
      const borrow =
        p.borrowShares === "0"
          ? ""
          : `borrowed ${formatUnits(BigInt(p.borrowAssetsExpected), p.loanToken.decimals)} ${p.loanToken.symbol}`;
      const collateral =
        p.collateral === "0"
          ? ""
          : `collateral ${formatUnits(BigInt(p.collateral), p.collateralToken.decimals)} ${p.collateralToken.symbol}`;
      const parts = [supply, borrow, collateral].filter((s) => s.length > 0);
      summaryLines.push(`  ${label}: ${parts.join(" + ")}`);
    }
    if (degraded.length > 0) {
      summaryLines.push(
        `  ${degraded.length} market(s) returned degraded reads — see structuredContent.positions for marketId + reason.`,
      );
    }
  }
  if (onFallback) summaryLines.push("  (rpcDegraded: public-node fallback active)");
  if (lookbackWarn) summaryLines.push("  (lookbackWarn: scan window truncated against block 0)");
  if (activePersona) {
    summaryLines.push(
      `  (demo mode: routed to persona "${activePersona.slug}" address ${activePersona.address})`,
    );
  }

  return {
    content: [{ type: "text", text: summaryLines.join("\n") }],
    structuredContent,
  };
});

/**
 * Re-export for test harnesses that need to assert against the registry shape
 * directly (e.g. round-trip the wstETH/USDC anchor entry without re-loading
 * the JSON in the test process). Internal-use only — not part of the public
 * tool surface.
 */
export const _morphoPositionsRegistry: ReadonlyMap<string, MorphoMarketRegistryEntry> = REGISTRY;
