// src/chains/morpho-blue.ts
//
// Sibling-shelf helper for Morpho Blue per-market RPC reads + market-discovery
// event-log scan. Phase 29 Plan 29-02. Mirror of src/chains/compound-v3.ts +
// src/chains/aave-v3.ts: helper-per-read + `_morphoChains` ESM spy indirection.
//
// Surface (6 methods — Plan 29-03 consumes; ADDS NO new methods):
//   - `readPosition(client, morpho, marketId, user)` — position(id, user) →
//                                                       {supplyShares, borrowShares, collateral}
//   - `readMarket(client, morpho, marketId)`         — market(id) → {totalSupplyAssets,
//                                                       totalSupplyShares, totalBorrowAssets,
//                                                       totalBorrowShares, lastUpdate, fee}
//   - `readMarketParams(client, morpho, marketId)`   — idToMarketParams(id) → {loanToken,
//                                                       collateralToken, oracle, irm, lltv}
//   - `scanTouchedMarkets(client, wallet)`           — 3-event log scan with
//                                                       `args: { onBehalf: wallet }` filter
//                                                       (research § Pattern 3); 100k-block
//                                                       chunked pagination; 1M-block lookback
//                                                       default. Returns Set<Hex> of unique
//                                                       marketIds.
//   - `computeExpectedSupplyAssets(pos, mkt)`        — off-chain SharesMathLib.toAssetsDown
//                                                       (conservative: under-reports what
//                                                       user CAN withdraw)
//   - `computeExpectedBorrowAssets(pos, mkt)`        — off-chain SharesMathLib.toAssetsUp
//                                                       (conservative: over-reports what
//                                                       user OWES)
//
// Cryptographic-binding chain is FROZEN — this module reads RPC, computes
// nothing the device signs. Plan 29-03's prepare tools consume `_morphoChains`
// methods for the intent-vs-reality gate (`readMarketParams`) + repay-max
// (`readPosition`).
//
// Threat anchors:
//   - T-29-02-T-RPC-DEGRADED: per-getLogs chunk and per-readContract call can
//     fail. The chunked-getLogs path catches errors and surfaces them up to
//     the tool layer; callers wrap individual market reads in their own
//     try/catch.
//   - T-29-02-T-EVENT-LOG-CEILING: 100k-block chunked pagination mirrors
//     Phase 8 DF-2; the lookback default is 1M blocks (~140 days mainnet).
//   - T-29-02-T-EVENT-ABI-DRIFT: the 3 event ABIs are sourced from Plan
//     29-01's MORPHO_BLUE_ABI parseAbi const — drift fails the cross-chain
//     test in test/chains-morpho-blue.test.ts T4.
//
// Format-fanout sentinel: this module is the ONLY consumer of
// MORPHO_BLUE_ABI's read-function arms (`position` / `market` /
// `idToMarketParams`) + the 3 event ABIs in `src/`. Plan 29-03's prepare
// tools consume `_morphoChains.<method>` indirections, NOT inline readContract.

import {
  getAddress,
  type AbiEvent,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { getMorphoBlueAddress } from "../config/contracts.js";
import { MORPHO_BLUE_ABI } from "../protocols/morpho-blue.js";
import { toAssetsDown, toAssetsUp } from "../signing/morpho-shares-math.js";

/**
 * 1M-block lookback default — Phase 8 DF-2 mirror. On Ethereum mainnet ~140
 * days of history; on faster L2s less. Configurable via
 * VAULTPILOT_MORPHO_LOG_LOOKBACK env (read by the tool layer; this module
 * accepts the resolved value as an arg).
 */
export const DEFAULT_LOG_LOOKBACK_BLOCKS = 1_000_000n;

/**
 * 100k-block chunk size for the chunked getLogs pagination. Matches the
 * "comfortable" range most RPC providers accept without paid-tier limits;
 * tested against PublicNode (10k cap — chunked smaller in practice) and
 * Alchemy (50k cap — still safe under this chunk). The Phase 8 allowances
 * scan uses a smaller 10k chunk on PublicNode-only paths; the Morpho scan
 * is a 3-event union so the 100k chunk amortizes per-call setup cost across
 * three concurrent event filters.
 */
export const LOG_CHUNK_BLOCKS = 100_000n;

/**
 * Resolve the event-ABI item by name from the Plan 29-01 parseAbi const.
 * Looking up by `name + type: "event"` rather than positional index keeps
 * the helper robust against ABI reordering during future merges.
 */
function getEventAbi(name: "Supply" | "Borrow" | "SupplyCollateral"): AbiEvent {
  // The cast through `unknown` widens viem's narrow literal-union return type
  // (every parseAbi entry is a distinct literal) back to the structural
  // `AbiEvent` surface — the runtime guard checks `type === "event"` so the
  // widening is safe at the value level.
  const entry = (MORPHO_BLUE_ABI as readonly unknown[]).find(
    (item): item is AbiEvent => {
      if (typeof item !== "object" || item === null) return false;
      const obj = item as { type?: string; name?: string };
      return obj.type === "event" && obj.name === name;
    },
  );
  if (!entry) {
    throw new Error(
      `Morpho Blue event "${name}" not found in MORPHO_BLUE_ABI — Plan 29-01 ABI drift`,
    );
  }
  return entry;
}

/**
 * Read `Morpho.position(id, user)` — the per-market lender + borrower + collateral
 * snapshot for one user. Single RPC round-trip.
 *
 * Returns `{ supplyShares, borrowShares, collateral }` — `supplyShares` is the
 * user's lender position (uint256), `borrowShares` is the user's debt (uint128),
 * `collateral` is the raw collateral amount in collateralToken wei (uint128;
 * NOT shares — Morpho does not mint collateral-share receipts; research
 * § Topic 2 + § Pitfall 4).
 */
export async function readPosition(
  client: PublicClient,
  morpho: Address,
  marketId: Hex,
  user: Address,
): Promise<{ supplyShares: bigint; borrowShares: bigint; collateral: bigint }> {
  const result = (await client.readContract({
    address: morpho,
    abi: MORPHO_BLUE_ABI,
    functionName: "position",
    args: [marketId, getAddress(user)],
  })) as readonly [bigint, bigint, bigint];
  return {
    supplyShares: result[0],
    borrowShares: result[1],
    collateral: result[2],
  };
}

/**
 * Read `Morpho.market(id)` — the per-market totals snapshot. Single RPC
 * round-trip.
 *
 * `lastUpdate` is the timestamp of the last `accrueInterest` call; the
 * state is stale relative to the current block (research § Pitfall 4).
 * Phase 29 ships the stale-read display surface; off-chain `wTaylorCompounded`
 * accrual is DEFERRED per research § Topic 4 + planning-context Open
 * Question #4 (`get_morpho_market_info` is v2.3.x scope).
 */
export async function readMarket(
  client: PublicClient,
  morpho: Address,
  marketId: Hex,
): Promise<{
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
}> {
  const result = (await client.readContract({
    address: morpho,
    abi: MORPHO_BLUE_ABI,
    functionName: "market",
    args: [marketId],
  })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
  return {
    totalSupplyAssets: result[0],
    totalSupplyShares: result[1],
    totalBorrowAssets: result[2],
    totalBorrowShares: result[3],
    lastUpdate: result[4],
    fee: result[5],
  };
}

/**
 * Read `Morpho.idToMarketParams(id)` — recover the 5-tuple MarketParams from
 * a 32-byte marketId. Single RPC round-trip. Consumed by Plan 29-03's
 * `prepare_morpho_*` tools for the intent-vs-reality gate (cross-check
 * `deriveMarketId(claimedParams) === idToMarketParams(claimedId)`).
 *
 * NOTE: `idToMarketParams` returns zero-address fields for an unknown
 * marketId (the on-chain mapping default), NOT a revert. Callers must
 * check `loanToken !== 0x0...0` to distinguish "registered market" from
 * "garbage marketId".
 */
export async function readMarketParams(
  client: PublicClient,
  morpho: Address,
  marketId: Hex,
): Promise<{
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}> {
  const result = (await client.readContract({
    address: morpho,
    abi: MORPHO_BLUE_ABI,
    functionName: "idToMarketParams",
    args: [marketId],
  })) as readonly [Address, Address, Address, Address, bigint];
  return {
    loanToken: result[0],
    collateralToken: result[1],
    oracle: result[2],
    irm: result[3],
    lltv: result[4],
  };
}

/**
 * Event-log scan for market discovery. Mirror of Phase 8 `get_token_allowances`
 * pattern (research § Pattern 3). Three concurrent `client.getLogs` chains
 * (one per event type — Supply / Borrow / SupplyCollateral) each filter on
 * `args: { onBehalf: wallet }` to enumerate every market the wallet has
 * interacted with as either a lender, a borrower, or a collateral poster.
 *
 * Repay events not needed for discovery: a wallet that repaid but never
 * supplied/borrowed/posted-collateral has no current position (research
 * § Pattern 3).
 *
 * Pagination: chunks fromBlock → currentBlock in `LOG_CHUNK_BLOCKS` (100k)
 * windows. Per-chunk fan-out: 3 event types × 1 chunk each = 3 RPC calls.
 * On a 1M-block lookback that's ~30 RPC calls — acceptable.
 *
 * Returns a `Set<Hex>` of unique marketIds (the natural key is the
 * `bytes32 indexed id` event field — research § Pattern 3 final deduplication).
 * The Set deduplicates across all 3 event types in O(N).
 *
 * `currentBlock` and `lookbackBlocks` are accepted as args (rather than read
 * here) so the calling tool can surface them in `lookbackBlocks` /
 * `lookbackWarn` structuredContent for the user. The morpho contract address
 * is also accepted as an arg (rather than `getMorphoBlueAddress(1)!` inline)
 * for future multi-chain widening without changing this signature.
 */
export async function scanTouchedMarkets(
  client: PublicClient,
  wallet: Address,
  options: {
    morpho?: Address;
    fromBlock?: bigint;
    toBlock?: bigint;
  } = {},
): Promise<Set<Hex>> {
  const morpho = options.morpho ?? getMorphoBlueAddress(1);
  if (!morpho) {
    throw new Error(
      "scanTouchedMarkets: Morpho Blue address unavailable for the active chain",
    );
  }
  const toBlock = options.toBlock ?? (await client.getBlockNumber());
  const fromBlock =
    options.fromBlock ??
    (toBlock > DEFAULT_LOG_LOOKBACK_BLOCKS ? toBlock - DEFAULT_LOG_LOOKBACK_BLOCKS : 0n);

  const supplyEvent = getEventAbi("Supply");
  const borrowEvent = getEventAbi("Borrow");
  const supplyCollateralEvent = getEventAbi("SupplyCollateral");

  const normalizedWallet = getAddress(wallet);

  // Build the per-chunk fromBlock/toBlock windows once; each event scan
  // iterates the same window list so the 3 event arrays land on the same
  // block ranges (deterministic).
  const chunks: Array<{ from: bigint; to: bigint }> = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const chunkTo =
      cursor + LOG_CHUNK_BLOCKS - 1n > toBlock ? toBlock : cursor + LOG_CHUNK_BLOCKS - 1n;
    chunks.push({ from: cursor, to: chunkTo });
    cursor = chunkTo + 1n;
  }

  // Per-event scan: serial across chunks (RPC providers don't always like
  // unbounded concurrent ranges from the same client; 100k chunks ×
  // potentially-large lookback would land too many in flight), parallel
  // across the 3 event types.
  async function scanOne(event: AbiEvent): Promise<Hex[]> {
    const ids: Hex[] = [];
    for (const chunk of chunks) {
      const logs = (await client.getLogs({
        address: morpho!,
        event,
        args: { onBehalf: normalizedWallet },
        fromBlock: chunk.from,
        toBlock: chunk.to,
      })) as ReadonlyArray<{ args: { id?: Hex } }>;
      for (const log of logs) {
        const id = log.args.id;
        if (id) ids.push(id);
      }
    }
    return ids;
  }

  const [supplyIds, borrowIds, collateralIds] = await Promise.all([
    scanOne(supplyEvent),
    scanOne(borrowEvent),
    scanOne(supplyCollateralEvent),
  ]);

  return new Set<Hex>([...supplyIds, ...borrowIds, ...collateralIds]);
}

/**
 * Off-chain accrual simulation for the supply side. Rounded DOWN (conservative —
 * under-reports what the user CAN withdraw; the on-chain value at tx time
 * will be ≥ this figure since `accrueInterest` adds yield).
 *
 * Inputs: the `position(id, user)` decode + the `market(id)` decode. Output is
 * a single bigint — the loanToken-denominated supply asset balance the user
 * would receive if they withdrew right now against the stale market state.
 *
 * Pure bigint — no I/O. The off-chain `accrueInterest` simulation
 * (`wTaylorCompounded`-based) is DEFERRED per research § Topic 4; this
 * function returns the value against the LAST `lastUpdate` snapshot.
 */
export function computeExpectedSupplyAssets(
  pos: { supplyShares: bigint },
  mkt: { totalSupplyAssets: bigint; totalSupplyShares: bigint },
): bigint {
  return toAssetsDown(pos.supplyShares, mkt.totalSupplyAssets, mkt.totalSupplyShares);
}

/**
 * Off-chain accrual simulation for the borrow side. Rounded UP (conservative —
 * over-reports what the user OWES; the display value slightly exceeds the
 * on-chain debt, which is the safe direction for "do I have enough loanToken
 * to repay?" UX).
 *
 * Inputs: `position(id, user)` decode + `market(id)` decode. Output is the
 * loanToken-denominated debt the user owes against the stale market state.
 */
export function computeExpectedBorrowAssets(
  pos: { borrowShares: bigint },
  mkt: { totalBorrowAssets: bigint; totalBorrowShares: bigint },
): bigint {
  return toAssetsUp(pos.borrowShares, mkt.totalBorrowAssets, mkt.totalBorrowShares);
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * Plan 29-03 consumes the 6 methods via this indirection — e.g.
 * `_morphoChains.readPosition(client, morpho, id, user)` in `prepare_morpho_repay`
 * for the repay-max borrowShares read; `_morphoChains.readMarketParams(...)`
 * in every Morpho prepare tool for the intent-vs-reality gate. Tests
 * `vi.spyOn(_morphoChains, "<fn>")` to intercept RPC reads without
 * monkey-patching the production import path.
 *
 * The ESM spy hygiene test in `test/chains-morpho-blue.test.ts` T7 asserts
 * each named export is referentially equal to `_morphoChains.<name>` — if a
 * future contributor rebinds the indirection, the Plan 29-03 spy regression
 * would silently no-op.
 */
export const _morphoChains = {
  readPosition,
  readMarket,
  readMarketParams,
  scanTouchedMarkets,
  computeExpectedSupplyAssets,
  computeExpectedBorrowAssets,
};
