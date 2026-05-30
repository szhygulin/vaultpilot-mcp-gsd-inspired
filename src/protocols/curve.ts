// src/protocols/curve.ts — Phase 34 Plan 34-03 Task 1
//
// Curve Finance protocol primitives — calldata encoders + selector-dispatch
// decoder for preview_send. Mirrors src/protocols/uniswap-v3.ts shape:
//   selector table → encoder parameter interfaces → encoder functions →
//   discriminated-union type → decoder function → ESM spy-affordance.
//
// READS from src/chains/curve.ts (ABIs) — the ABI shelf is the single source
// of truth for ABI fragments. Do NOT duplicate parseAbi calls here.
//
// KEY INVARIANTS:
//   1. Encoder ABIs imported from src/chains/curve.ts (NOT inline parseAbi).
//   2. Selector table verified against viem.toFunctionSelector at test time.
//   3. Decoder uses (pool.abiVersion, selector) TUPLE dispatch — NEVER
//      selector-alone (Vyper StableSwap pools share selectors across versions).
//   4. _curveProtocol ESM spy-affordance added at WRITE TIME per CLAUDE.md.
//
// Consumed by:
//   - src/tools/prepare_curve_swap.ts     (Plan 34-03 — calldata encoding)
//   - src/tools/prepare_curve_add_liquidity.ts (Plan 34-03)
//   - src/tools/preview_send.ts           (Plan 34-03 — (to, selector) dispatch)
//   - test/protocols-curve.test.ts        (selector + encoder + decoder regressions)
//   - test/prepare-curve-swap.test.ts     (Fixture CRV-B cross-link)
//   - test/prepare-curve-add-liquidity.test.ts (Fixture CRV-C cross-link)

import {
  type Address,
  type Hex,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
} from "viem";

import {
  CURVE_LEGACY_EXCHANGE_ABI,
  CURVE_NG_EXCHANGE_ABI,
  CURVE_NG_ADD_LIQUIDITY_ABI,
  CURVE_LEGACY_ADD_LIQUIDITY_ABI,
} from "../chains/curve.js";

// Re-export SOT getters — callers inside src/protocols/, src/chains/, src/tools/
// import from one locality. The SOT remains src/config/contracts.ts; these are
// delegation wrappers. Mirror of uniswap-v3.ts re-export pattern.
export {
  getCurvePoolByAddress,
  getAllCurvePoolsForChain,
} from "../config/contracts.js";
export type {
  ChainId,
  CurvePoolEntry,
  CurvePoolAbiVersion,
} from "../config/contracts.js";

import {
  getCurvePoolByAddress,
  type ChainId,
  type CurvePoolEntry,
} from "../config/contracts.js";

// ---------------------------------------------------------------------------
// Selector table — verified via viem.toFunctionSelector at test time.
// Source: RESEARCH.md § Selector table (2026-05-26)
// ---------------------------------------------------------------------------

/**
 * Curve function selector table (5 entries).
 * LOAD-BEARING: drift between these literals and the actual ABI signatures
 * fails test/protocols-curve.test.ts selector byte-identity assertions.
 * Each entry verified against viem.toFunctionSelector at research + test time.
 */
export const CURVE_SELECTORS = {
  /** Legacy exchange — stETH/ETH pool. selector = 0x3df02124 */
  exchangeLegacy: "0x3df02124" as Hex,
  /** stable_ng exchange with _receiver. selector = 0xddc1f59d */
  exchangeNg: "0xddc1f59d" as Hex,
  /** stable_ng add_liquidity (uint256[], uint256) — 2-param form. selector = 0xb72df5de */
  addLiquidityNg: "0xb72df5de" as Hex,
  /** get_dy — same across legacy and stable_ng. selector = 0x5e0d443f */
  getDy: "0x5e0d443f" as Hex,
  /** calc_token_amount — stable_ng. selector = 0x3db06dd8 */
  calcTokenAmount: "0x3db06dd8" as Hex,
  /** Phase 43 — Legacy add_liquidity(uint256[2],uint256) — stETH/ETH pool.
   *  selector = 0x0b4c7e4d (RESEARCH-VERIFIED Etherscan + viem; distinct from
   *  stable_ng 0xb72df5de). */
  addLiquidityLegacy: "0x0b4c7e4d" as Hex,
} as const;

// ---------------------------------------------------------------------------
// Encoder parameter interfaces
// ---------------------------------------------------------------------------

export interface ExchangeLegacyParams {
  i: number;
  j: number;
  dx: bigint;
  minDy: bigint;
}

export interface ExchangeStableNgParams {
  i: number;
  j: number;
  dx: bigint;
  minDy: bigint;
  receiver: Address;
}

export interface AddLiquidityStableNgParams {
  amounts: bigint[];
  minMintAmount: bigint;
}

/** Phase 43 — legacy fixed-array add_liquidity params (2-coin stETH/ETH pool). */
export interface AddLiquidityLegacyParams {
  amounts: [bigint, bigint];
  minMintAmount: bigint;
}

// ---------------------------------------------------------------------------
// Encoder functions — import ABIs from src/chains/curve.ts (single SOT).
// ---------------------------------------------------------------------------

/**
 * Encode `exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)` calldata
 * for the legacy stETH/ETH pool (CURVE_LEGACY_EXCHANGE_ABI, selector 0x3df02124).
 *
 * Caller note: when i === 0 (ETH-in on legacy pool), set tx.value = dx
 * (Pitfall 2 — @payable exchange checks msg.value == dx when i=0).
 */
export function encodeExchangeLegacy(params: ExchangeLegacyParams): Hex {
  return encodeFunctionData({
    abi: CURVE_LEGACY_EXCHANGE_ABI,
    functionName: "exchange",
    args: [BigInt(params.i), BigInt(params.j), params.dx, params.minDy],
  });
}

/**
 * Encode `exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver)`
 * calldata for stable_ng pools (CURVE_NG_EXCHANGE_ABI, selector 0xddc1f59d).
 *
 * Server ALWAYS passes `_receiver = signer` (fromAddress) — this makes calldata
 * from-DEPENDENT (Fixture CRV-B anchors this invariant). stable_ng exchange
 * is NOT @payable; tx.value = 0n always.
 */
export function encodeExchangeStableNg(params: ExchangeStableNgParams): Hex {
  return encodeFunctionData({
    abi: CURVE_NG_EXCHANGE_ABI,
    functionName: "exchange",
    args: [BigInt(params.i), BigInt(params.j), params.dx, params.minDy, params.receiver],
  });
}

/**
 * Encode `add_liquidity(uint256[] _amounts, uint256 _min_mint_amount)` calldata
 * for stable_ng plain pools (CURVE_NG_ADD_LIQUIDITY_ABI, selector 0xb72df5de).
 *
 * This is the 2-param form (no `_receiver`) per CONTEXT.md locked decision.
 * Legacy add_liquidity is deferred to v2.4.x; this encoder is stable_ng-only.
 * Caller is responsible for refusing on abiVersion === "legacy" upstream.
 */
export function encodeAddLiquidityStableNg(params: AddLiquidityStableNgParams): Hex {
  return encodeFunctionData({
    abi: CURVE_NG_ADD_LIQUIDITY_ABI,
    functionName: "add_liquidity",
    args: [params.amounts, params.minMintAmount],
  });
}

/**
 * Phase 43 — Encode `add_liquidity(uint256[2] amounts, uint256 min_mint_amount)`
 * calldata for the legacy stETH/ETH pool (CURVE_LEGACY_ADD_LIQUIDITY_ABI,
 * selector 0x0b4c7e4d).
 *
 * viem encodes uint256[2] as TWO inline 32-byte words (NO dynamic offset/length
 * prefix) — byte-distinct from the stable_ng dynamic uint256[] form (Pitfall 1).
 * The pool is @payable: when amounts[0] > 0 (ETH leg), the caller sets
 * tx.value = amounts[0] (Pitfall 2). amounts[0] is STILL carried in the calldata
 * array regardless.
 */
export function encodeAddLiquidityLegacy(params: AddLiquidityLegacyParams): Hex {
  return encodeFunctionData({
    abi: CURVE_LEGACY_ADD_LIQUIDITY_ABI,
    functionName: "add_liquidity",
    args: [params.amounts, params.minMintAmount],
  });
}

// ---------------------------------------------------------------------------
// Decoder return type — discriminated union
// ---------------------------------------------------------------------------

export type CurveDecoded =
  | {
      kind: "exchange-legacy";
      pool: CurvePoolEntry;
      i: number;
      j: number;
      dx: bigint;
      minDy: bigint;
      inputCoinAddress: Address;
      outputCoinAddress: Address;
      isEthIn: boolean;
    }
  | {
      kind: "exchange-stable_ng";
      pool: CurvePoolEntry;
      i: number;
      j: number;
      dx: bigint;
      minDy: bigint;
      receiver: Address;
      inputCoinAddress: Address;
      outputCoinAddress: Address;
    }
  | {
      kind: "add_liquidity-stable_ng";
      pool: CurvePoolEntry;
      amounts: bigint[];
      minMintAmount: bigint;
    }
  | {
      // Phase 43 — legacy fixed-array add_liquidity (2-coin stETH/ETH pool).
      kind: "add_liquidity-legacy";
      pool: CurvePoolEntry;
      amounts: [bigint, bigint];
      minMintAmount: bigint;
      isEthIn: boolean; // amounts[0] > 0 && coins[0] === ETH_SENTINEL
    };

// ---------------------------------------------------------------------------
// ETH sentinel constant (used in isEthIn detection)
// ---------------------------------------------------------------------------
const ETH_SENTINEL: Address = getAddress("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");

// ---------------------------------------------------------------------------
// Decoder — (pool.abiVersion, selector) TUPLE dispatch
// ---------------------------------------------------------------------------

/**
 * Decode Curve `exchange` or `add_liquidity` calldata from a known pool.
 *
 * CRITICAL INVARIANT: Every branch guards on BOTH `pool.abiVersion` AND `sel`
 * (tuple dispatch). Selector-alone routing is FORBIDDEN because different Vyper
 * StableSwap generations share 4-byte selectors. The tuple prevents mis-decoding
 * a legacy exchange call as a stable_ng call and vice versa.
 *
 * @param data - Hex calldata (0x-prefixed).
 * @param poolAddress - EVM address of the pool contract (tx.to).
 * @param chainId - Chain ID (Curve is Ethereum-only at Phase 34; chainId=1).
 * @returns CurveDecoded if recognized, null otherwise.
 */
export function decodeCurveCall(
  data: Hex,
  poolAddress: Address,
  chainId: ChainId,
): CurveDecoded | null {
  // Layer 1: Registry gate — pool MUST be in the curated registry.
  const pool = getCurvePoolByAddress(chainId, poolAddress);
  if (!pool) return null;

  // Extract 4-byte selector (10 chars: "0x" + 8 hex).
  const sel = data.slice(0, 10).toLowerCase() as Hex;

  try {
    // TUPLE DISPATCH — branch on (pool.abiVersion, sel).
    // Every branch checks BOTH dimensions; selector-alone is prohibited.

    if (pool.abiVersion === "legacy" && sel === CURVE_SELECTORS.exchangeLegacy) {
      // Legacy exchange(int128 i, int128 j, uint256 dx, uint256 min_dy)
      const { args } = decodeFunctionData({
        abi: CURVE_LEGACY_EXCHANGE_ABI,
        data,
      });
      const [iRaw, jRaw, dx, minDy] = args as [bigint, bigint, bigint, bigint];
      const i = Number(iRaw);
      const j = Number(jRaw);
      const inputCoinAddress = pool.coins[i] as Address;
      const outputCoinAddress = pool.coins[j] as Address;
      // ETH-in only when i=0 AND the pool's coin at index 0 is the ETH sentinel.
      const isEthIn =
        i === 0 && getAddress(pool.coins[0] as Address) === ETH_SENTINEL;
      return {
        kind: "exchange-legacy",
        pool,
        i,
        j,
        dx,
        minDy,
        inputCoinAddress,
        outputCoinAddress,
        isEthIn,
      };
    }

    if (pool.abiVersion === "stable_ng" && sel === CURVE_SELECTORS.exchangeNg) {
      // stable_ng exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver)
      const { args } = decodeFunctionData({
        abi: CURVE_NG_EXCHANGE_ABI,
        data,
      });
      const [iRaw, jRaw, dx, minDy, receiver] = args as [bigint, bigint, bigint, bigint, Address];
      const i = Number(iRaw);
      const j = Number(jRaw);
      const inputCoinAddress = pool.coins[i] as Address;
      const outputCoinAddress = pool.coins[j] as Address;
      return {
        kind: "exchange-stable_ng",
        pool,
        i,
        j,
        dx,
        minDy,
        receiver,
        inputCoinAddress,
        outputCoinAddress,
      };
    }

    if (pool.abiVersion === "stable_ng" && sel === CURVE_SELECTORS.addLiquidityNg) {
      // stable_ng add_liquidity(uint256[] _amounts, uint256 _min_mint_amount)
      // MUST guard on pool.abiVersion === "stable_ng" — if a legacy pool ever
      // had a function colliding with 0xb72df5de, selector-alone dispatch would
      // mis-decode it. The tuple invariant is uniform across ALL three branches.
      const { args } = decodeFunctionData({
        abi: CURVE_NG_ADD_LIQUIDITY_ABI,
        data,
      });
      const [amounts, minMintAmount] = args as [readonly bigint[], bigint];
      return {
        kind: "add_liquidity-stable_ng",
        pool,
        amounts: [...amounts],
        minMintAmount,
      };
    }

    if (pool.abiVersion === "legacy" && sel === CURVE_SELECTORS.addLiquidityLegacy) {
      // Phase 43 — legacy add_liquidity(uint256[2] amounts, uint256 min_mint_amount).
      // Tuple-guarded on (legacy, 0x0b4c7e4d) — selector-alone dispatch is
      // prohibited (a stable_ng pool carrying 0x0b4c7e4d must NOT decode here).
      const { args } = decodeFunctionData({
        abi: CURVE_LEGACY_ADD_LIQUIDITY_ABI,
        data,
      });
      const [amounts, minMintAmount] = args as [readonly [bigint, bigint], bigint];
      const isEthIn =
        amounts[0] > 0n && getAddress(pool.coins[0] as Address) === ETH_SENTINEL;
      return {
        kind: "add_liquidity-legacy",
        pool,
        amounts: [amounts[0], amounts[1]],
        minMintAmount,
        isEthIn,
      };
    }

    // Any other (abiVersion, sel) tuple → unrecognized.
    return null;
  } catch {
    // ABI decode error — return null (unknown selector / malformed calldata).
    return null;
  }
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection — per CLAUDE.md "ESM spy-affordance
// indirection" convention. Added at WRITE TIME. Callers import and call through
// _curveProtocol so vi.spyOn can intercept without monkey-patching named
// exports (ESM bindings are immutable; direct spies on named exports are
// no-ops for internal calls).
// ---------------------------------------------------------------------------

export const _curveProtocol = {
  encodeExchangeLegacy,
  encodeExchangeStableNg,
  encodeAddLiquidityStableNg,
  encodeAddLiquidityLegacy,
  decodeCurveCall,
};
