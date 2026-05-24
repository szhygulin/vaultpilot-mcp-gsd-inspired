// src/chains/uniswap-v3-lp.ts
//
// Sibling-shelf helper for Uniswap V3 NonfungiblePositionManager (NPM)
// position reads. Mirror of src/chains/aave-v3.ts shape — exports the helpers
// `get_lp_positions` (Plan 33-01) imports. Enumerate user NFTs via ERC-721
// Enumerable, decode each position via positions(tokenId), derive pool
// address deterministically (avoids per-position factory RPC), and read
// slot0() + ticks(...) + feeGrowthGlobal*() to compute accrued fees + IL.
//
// Per RESEARCH § Topic 11 + Pitfall: ALL per-position RPC fan-out uses
// Promise.allSettled — one broken position (burned NFT race condition,
// archived position, corrupted state) MUST NOT poison the entire batch.
// Per-position rejections are logged to stderr (CLAUDE.md stderr-for-
// diagnostics rule) and silently filtered out of the returned list.
//
// FROZEN-area zero-diff invariant: this module does NOT touch
// src/signing/payload-fingerprint.ts / presign-hash.ts / handle-store.ts /
// send_transaction.ts / etherscan.ts / fourbyte.ts.

import { type Address, type PublicClient, formatUnits, parseAbi } from "viem";

import {
  getUniswapV3NonfungiblePositionManagerAddress,
  type ChainId,
} from "../config/contracts.js";
import { computeAccruedFees } from "../signing/uniswap-fees.js";
import { computeIlEstimate } from "../signing/uniswap-il.js";
import { computePoolAddress } from "../signing/uniswap-pool-address.js";
import {
  sqrtPriceX96ToTick,
  tickToPrice,
  type Uniswapv3FeeTier,
} from "../signing/uniswap-tick.js";

// ---------------------------------------------------------------------------
// ABI declarations
// ---------------------------------------------------------------------------

/**
 * NonfungiblePositionManager read surface (verbatim from RESEARCH § Topic 2).
 * Field order in `positions(tokenId)` is LOAD-BEARING — viem decodes as a
 * 12-tuple matching the contract layout. Drift breaks downstream decode.
 */
export const NPM_READ_ABI = parseAbi([
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  // ERC-721 — used at Plan 33-03 by prepare_uniswap_v3_rebalance for
  // pre-flight ownership refusal (INVALID_INPUT when ownerOf(tokenId) !== from).
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

/**
 * IUniswapV3Pool read surface (RESEARCH § Topic 2 + Topic 4). slot0 returns
 * the canonical 7-tuple including sqrtPriceX96 + tick. ticks(tick) returns
 * 8 fields per the on-chain TickInfo struct; we consume feeGrowthOutside0/1.
 * feeGrowthGlobal0/1X128 are Q128.128 accumulators.
 */
export const POOL_READ_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
  "function ticks(int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)",
]);

// ---------------------------------------------------------------------------
// Decoded shapes
// ---------------------------------------------------------------------------

/**
 * Decoded LP position data — per-NFT envelope returned from `readUserPositions`.
 * Token amounts are raw bigint; the tool layer formats with token decimals.
 */
export interface PositionData {
  tokenId: bigint;
  token0: Address;
  token1: Address;
  fee: Uniswapv3FeeTier;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  currentTick: number;
  inRange: boolean;
  poolAddress: Address;
  /** Combined settled + unsettled accrued fees per token (raw amounts). */
  accruedFees: { amount0: bigint; amount1: bigint };
  /** IL estimate per CONTEXT.md D-02 — raw + net-of-fees + confidence flag. */
  ilEstimate: {
    ilRaw: string;
    ilNetOfFees: string;
    ilEstimateConfidence: "high" | "low";
  };
  /** Decimals — defaults to 18 for both because the tool layer's caller is
   *  responsible for upgrading these via `get_token_metadata` if the agent
   *  passes them. The IL estimate is computed at the reader using best-effort
   *  defaults; the tool layer recomputes with accurate decimals when needed. */
  decimals0: number;
  decimals1: number;
}

// ---------------------------------------------------------------------------
// readUserPositions — main read surface
// ---------------------------------------------------------------------------

/**
 * Enumerate all Uniswap V3 LP positions held by `wallet` on `chainId` (currently
 * Ethereum-only per CONTEXT.md D-03). Returns a possibly-empty array of
 * `PositionData`. Per-position read failures are logged to stderr and
 * silently filtered (T-PROMISE-ALL-POISON-LP mitigation per RESEARCH §
 * Topic 11).
 */
export async function readUserPositions(
  client: PublicClient,
  wallet: Address,
  chainId: ChainId,
): Promise<PositionData[]> {
  const npmAddress = getUniswapV3NonfungiblePositionManagerAddress(chainId);
  if (npmAddress === null) {
    // Non-Ethereum chains have no SOT slot at Phase 33 — return empty
    // gracefully so the tool layer surfaces an empty position list.
    return [];
  }

  // Step 1: ERC-721 Enumerable balanceOf.
  const balance = (await client.readContract({
    address: npmAddress,
    abi: NPM_READ_ABI,
    functionName: "balanceOf",
    args: [wallet],
  })) as bigint;
  if (balance === 0n) return [];

  // Step 2: enumerate token IDs via tokenOfOwnerByIndex fan-out.
  const indices = Array.from({ length: Number(balance) }, (_, i) => BigInt(i));
  const tokenIdSettled = await Promise.allSettled(
    indices.map((i) =>
      client.readContract({
        address: npmAddress,
        abi: NPM_READ_ABI,
        functionName: "tokenOfOwnerByIndex",
        args: [wallet, i],
      }) as Promise<bigint>,
    ),
  );
  const tokenIds: bigint[] = [];
  for (const s of tokenIdSettled) {
    if (s.status === "fulfilled") tokenIds.push(s.value);
    else
      console.error(
        `uniswap-v3-lp: tokenOfOwnerByIndex rejected for wallet ${wallet} — ${s.reason}`,
      );
  }

  // Step 3: per-position decode fan-out with Promise.allSettled.
  const settled = await Promise.allSettled(
    tokenIds.map(async (tokenId): Promise<PositionData> => {
      // (3a) positions(tokenId) — 12-tuple.
      const pos = (await client.readContract({
        address: npmAddress,
        abi: NPM_READ_ABI,
        functionName: "positions",
        args: [tokenId],
      })) as readonly [
        bigint, // nonce
        Address, // operator
        Address, // token0
        Address, // token1
        number, // fee (uint24)
        number, // tickLower (int24)
        number, // tickUpper (int24)
        bigint, // liquidity (uint128)
        bigint, // feeGrowthInside0LastX128
        bigint, // feeGrowthInside1LastX128
        bigint, // tokensOwed0 (uint128)
        bigint, // tokensOwed1 (uint128)
      ];
      const [
        ,
        ,
        token0,
        token1,
        feeRaw,
        tickLower,
        tickUpper,
        liquidity,
        feeGrowthInside0LastX128,
        feeGrowthInside1LastX128,
        tokensOwed0,
        tokensOwed1,
      ] = pos;
      // Validate fee tier — only the 4 canonical Ethereum tiers per D-03.
      if (feeRaw !== 100 && feeRaw !== 500 && feeRaw !== 3000 && feeRaw !== 10000) {
        throw new Error(
          `uniswap-v3-lp: position ${tokenId} carries unsupported fee tier ${feeRaw}`,
        );
      }
      const fee = feeRaw as Uniswapv3FeeTier;

      // (3b) derive pool address deterministically (no RPC).
      const poolAddress = computePoolAddress(token0, token1, fee);

      // (3c) pool fan-out — slot0 + global fee accumulators + ticks(lower/upper).
      const [slot0, fg0, fg1, tickLowerInfo, tickUpperInfo] = await Promise.all([
        client.readContract({
          address: poolAddress,
          abi: POOL_READ_ABI,
          functionName: "slot0",
        }) as Promise<readonly [bigint, number, number, number, number, number, boolean]>,
        client.readContract({
          address: poolAddress,
          abi: POOL_READ_ABI,
          functionName: "feeGrowthGlobal0X128",
        }) as Promise<bigint>,
        client.readContract({
          address: poolAddress,
          abi: POOL_READ_ABI,
          functionName: "feeGrowthGlobal1X128",
        }) as Promise<bigint>,
        client.readContract({
          address: poolAddress,
          abi: POOL_READ_ABI,
          functionName: "ticks",
          args: [tickLower],
        }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint, number, boolean]>,
        client.readContract({
          address: poolAddress,
          abi: POOL_READ_ABI,
          functionName: "ticks",
          args: [tickUpper],
        }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint, number, boolean]>,
      ]);
      const sqrtPriceX96 = slot0[0];
      const currentTick = sqrtPriceX96ToTick(sqrtPriceX96);
      const inRange = currentTick >= tickLower && currentTick < tickUpper;

      // tick info tuple: [liquidityGross, liquidityNet, feeGrowthOutside0X128,
      //                   feeGrowthOutside1X128, tickCumulativeOutside,
      //                   secondsPerLiquidityOutsideX128, secondsOutside, initialized]
      const feeGrowthOutsideLower0X128 = tickLowerInfo[2];
      const feeGrowthOutsideLower1X128 = tickLowerInfo[3];
      const feeGrowthOutsideUpper0X128 = tickUpperInfo[2];
      const feeGrowthOutsideUpper1X128 = tickUpperInfo[3];

      // (3d) accrued fees.
      const accruedFees = computeAccruedFees({
        liquidity,
        tickLower,
        tickUpper,
        currentTick,
        feeGrowthGlobal0X128: fg0,
        feeGrowthGlobal1X128: fg1,
        feeGrowthOutsideLower0X128,
        feeGrowthOutsideLower1X128,
        feeGrowthOutsideUpper0X128,
        feeGrowthOutsideUpper1X128,
        feeGrowthInside0LastX128,
        feeGrowthInside1LastX128,
        tokensOwed0,
        tokensOwed1,
      });

      // (3e) IL estimate — reader defaults decimals to 18; the tool layer
      // can re-compute with token-specific decimals via get_token_metadata.
      // For initial Plan 33-01 ergonomics, we surface the 18-decimal default
      // (sufficient for ETH-pair positions; stable-pair refinement deferred
      // to v2.4.x once get_token_metadata integration lands here).
      const decimals0 = 18;
      const decimals1 = 18;
      const ilEstimate = computeIlEstimate({
        liquidity,
        tickLower,
        tickUpper,
        currentSqrtPriceX96: sqrtPriceX96,
        accruedFees,
        decimals0,
        decimals1,
      });

      return {
        tokenId,
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        liquidity,
        currentTick,
        inRange,
        poolAddress,
        accruedFees,
        ilEstimate,
        decimals0,
        decimals1,
      };
    }),
  );

  const positions: PositionData[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled") {
      positions.push(s.value);
    } else {
      console.error(
        `uniswap-v3-lp: per-position read rejected (T-PROMISE-ALL-POISON-LP mitigation) — ${s.reason}`,
      );
    }
  }
  return positions;
}

// Re-export utilities downstream consumers (e.g. test files) may want.
export { formatUnits, tickToPrice };

// ---------------------------------------------------------------------------
// ESM spy-affordance per CLAUDE.md § Conventions.
// ---------------------------------------------------------------------------

export const _uniswapV3LpReader = { readUserPositions };
