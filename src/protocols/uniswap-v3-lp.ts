// Uniswap V3 NonfungiblePositionManager (NPM) protocol primitives —
// Phase 33 Plans 33-02 (UNI-05..08 single-step) + 33-03 (UNI-09 composite
// rebalance via multicall(bytes[])).
//
// Per CONTEXT.md D-02 / RESEARCH § Architectural Responsibility Map: SEPARATE
// file from Phase 32's `src/protocols/uniswap-v3.ts` (SwapRouter02 + Quoter V2).
// The two modules MUST NOT cross-import. Phase 33 ships its own NPM ABI
// fragments + selector dispatch table for the 5 single-step LP verbs PLUS
// the multicall(bytes[]) composer used by `prepare_uniswap_v3_rebalance`.
//
// Structural analog: src/protocols/uniswap-v3.ts (Phase 32) for the multi-method
// shape + parseAbi tuple-struct declaration idiom + selector-table layout +
// `_uniswapV3Protocol` spy-affordance pattern.
//
// Function selectors VERIFIED via viem.toFunctionSelector at research time
// (33-RESEARCH § Topic 2, 2026-05-24):
//   NPM.mint((address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)):
//                                                          0x88316456
//   NPM.increaseLiquidity((uint256,uint256,uint256,uint256,uint256,uint256)):
//                                                          0x219f5d17
//   NPM.decreaseLiquidity((uint256,uint128,uint256,uint256,uint256)):
//                                                          0x0c49ccbe
//   NPM.collect((uint256,address,uint128,uint128)):        0xfc6f7865
//   NPM.burn(uint256):                                     0x42966c68
//   NPM.multicall(bytes[]):                                0xac9650d8  (Plan 33-03)
//
// SELECTOR-COLLISION WARNINGS:
//
//   - Pitfall: `0x42966c68` (NPM.burn) COLLIDES with Phase 31 `rETH.burn`
//     (Rocket Pool unstake) AND the generic ERC-20 Burnable mixin. The
//     `preview_send` dispatcher resolves this via `(tx.to, selector)` tuple
//     dispatch — when `to === getUniswapV3NonfungiblePositionManagerAddress(1)`,
//     render as NPM burn (with NFT tokenId decode); when `to === rETH`,
//     render as Rocket Pool burn (with WEI decode). Selector-only routing
//     would mis-route.
//
//   - Anti-pattern: the Phase 32 deadline-overload selector for
//     `multicall(uint256,bytes[])` (4 bytes starting `0x5ae4`) MUST NOT
//     appear in this module. NPM's own multicall overload is
//     `multicall(bytes[])` (selector `0xac9650d8`) because each NPM
//     mint/increase/decrease struct carries a per-call `deadline` field —
//     the outer wrapper needs no deadline. Plan 33-03 ships the
//     `multicall(bytes[])` selector + encoder + `composeRebalanceCalldata`
//     composition helper in this module. The anti-pattern test in
//     test/protocols-uniswap-v3-lp.test.ts greps the source for the full
//     10-char Phase 32 literal to enforce — the two multicall overloads
//     live on DIFFERENT contracts (NPM inherits IMulticall vs SwapRouter02
//     inherits IMulticallExtended) and MUST stay distinct.
//
// ESM spy-affordance: `_uniswapV3LpProtocol` wraps all 5 encoders PLUS the
// new Plan 33-03 `encodeMulticallBytes` + `composeRebalanceCalldata` entries
// so tests can `vi.spyOn(_uniswapV3LpProtocol, "composeRebalanceCalldata")`
// without monkey-patching named exports (ESM bindings are immutable; direct
// spies are no-ops for module-internal calls). Per CLAUDE.md § Conventions.
//
// Consumed by:
//   - src/tools/prepare_uniswap_v3_mint.ts               (Plan 33-02 UNI-05)
//   - src/tools/prepare_uniswap_v3_increase_liquidity.ts (Plan 33-02 UNI-06)
//   - src/tools/prepare_uniswap_v3_decrease_liquidity.ts (Plan 33-02 UNI-06)
//   - src/tools/prepare_uniswap_v3_collect.ts            (Plan 33-02 UNI-07)
//   - src/tools/prepare_uniswap_v3_burn.ts               (Plan 33-02 UNI-08)
//   - src/tools/prepare_uniswap_v3_rebalance.ts          (Plan 33-03 UNI-09 — composite multicall)
//   - src/tools/preview_send.ts                          (Plans 33-02 + 33-03 — (to, selector) tuple dispatch + composite arm)
//   - test/protocols-uniswap-v3-lp.test.ts               (byte-identity selector + encoder regressions)
//   - test/signing-fingerprint.test.ts                   (Fixtures UNI-LP-A..F)

import {
  type Address,
  type Hex,
  encodeFunctionData,
  parseAbi,
} from "viem";

import type { Uniswapv3FeeTier } from "../signing/uniswap-tick.js";

// ---------------------------------------------------------------------------
// ABI fragments (parseAbi-typed)
// ---------------------------------------------------------------------------

/**
 * NonfungiblePositionManager write surface — 5 verb fragments.
 *
 * Struct field order is LOAD-BEARING per RESEARCH § Topic 2. `MintParams` is
 * 11 fields — `recipient` at position 10 (NOT position 4 like SwapRouter02's
 * ExactInputSingleParams). Do NOT "harmonize" field order across the two
 * modules; drift produces calldata that the contract decodes into wrong slots.
 *
 * All 5 functions are `external payable` on-chain (NPM accepts ETH for
 * WETH-pair convenience entry points). Phase 33 refuses ETH-in per CONTEXT.md
 * deferred-ideas; `tx.value === 0n` for every prepare tool.
 */
export const NPM_WRITE_ABI = parseAbi([
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)",
  "function burn(uint256 tokenId) external payable",
]);

/**
 * NPM `multicall(bytes[])` overload — Phase 33 Plan 33-03. DISTINCT from
 * Phase 32's `MULTICALL_DEADLINE_ABI` in `src/protocols/uniswap-v3.ts` (the
 * deadline-overload `multicall(uint256,bytes[])` — selector prefix
 * `0x5ae4...`). NPM's per-call structs carry their own deadline fields so
 * the outer multicall doesn't need one.
 *
 * Inherited by `NonfungiblePositionManager` from
 * `@uniswap/v3-periphery/contracts/interfaces/IMulticall.sol` — see
 * 33-RESEARCH § Topic 2 (selector `0xac9650d8` VERIFIED via
 * viem.toFunctionSelector at research time).
 */
export const MULTICALL_BYTES_ABI = parseAbi([
  "function multicall(bytes[] data) external payable returns (bytes[])",
]);

// ---------------------------------------------------------------------------
// Selector table (HARDCODED VERIFIED LITERALS — Pitfall: burn collision)
// ---------------------------------------------------------------------------

/**
 * 4-byte function selectors for the 5 NPM verbs VaultPilot encodes at Phase 33
 * Plan 33-02, plus the composite `multicall(bytes[])` outer wrapper Plan 33-03
 * uses for `prepare_uniswap_v3_rebalance`. Empirically verified via
 * `viem.toFunctionSelector` at research time (33-RESEARCH § Topic 2,
 * 2026-05-24) and re-asserted at runtime in
 * `test/protocols-uniswap-v3-lp.test.ts`.
 *
 * COLLISION + DRIFT WARNINGS:
 *   - `burn === "0x42966c68"` COLLIDES with Phase 31 `rETH.burn` + generic
 *     ERC-20 Burnable mixin. `preview_send` resolves via `(tx.to, selector)`
 *     tuple dispatch — when `to === NPM SOT`, route to NPM burn decoder.
 *   - `multicallBytes === "0xac9650d8"` is the bytes-only NPM overload —
 *     NEVER conflate with the Phase 32 deadline-overload selector (prefix
 *     `0x5ae4...` on the SwapRouter02 `MULTICALL_DEADLINE_ABI`). They are
 *     different overloads on different contracts (NPM inherits IMulticall,
 *     SwapRouter02 inherits IMulticallExtended).
 */
export const UNISWAP_V3_LP_SELECTORS = {
  /** NPM.mint(MintParams) — creates new LP position; Fixture UNI-LP-A anchor. */
  mint: "0x88316456" as Hex,
  /** NPM.increaseLiquidity(IncreaseLiquidityParams) — Fixture UNI-LP-B anchor. */
  increaseLiquidity: "0x219f5d17" as Hex,
  /** NPM.decreaseLiquidity(DecreaseLiquidityParams) — Fixture UNI-LP-C anchor. */
  decreaseLiquidity: "0x0c49ccbe" as Hex,
  /** NPM.collect(CollectParams) — harvests accrued fees; Fixture UNI-LP-D anchor. */
  collect: "0xfc6f7865" as Hex,
  /** NPM.burn(tokenId) — closes empty position; Fixture UNI-LP-E anchor; COLLIDES with rETH.burn (Phase 31). */
  burn: "0x42966c68" as Hex,
  /**
   * NPM.multicall(bytes[]) — composite outer wrapper for Plan 33-03 rebalance;
   * Fixture UNI-LP-F anchor. DISTINCT from Phase 32's deadline-overload
   * (prefix `0x5ae4...`). The two live on DIFFERENT contracts and the wrong
   * fragment produces an ABI decode that silently shifts every slot.
   */
  multicallBytes: "0xac9650d8" as Hex,
} as const;

/**
 * `type(uint128).max` sentinel for `collect.amount0Max` / `amount1Max` —
 * per RESEARCH § Topic 2, passing this value collects ALL accrued fees +
 * settled-but-uncollected liquidity. `prepare_uniswap_v3_collect` defaults to
 * this when the agent omits the override; CHECKS PERFORMED notes the sentinel
 * usage (T-MAX-UINT128-SENTINEL mitigation).
 */
export const MAX_UINT128: bigint = (1n << 128n) - 1n;

// ---------------------------------------------------------------------------
// Encoder parameter types
// ---------------------------------------------------------------------------

export interface MintParams {
  token0: Address;
  token1: Address;
  fee: Uniswapv3FeeTier;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: Address;
  deadline: bigint;
}

export interface IncreaseLiquidityParams {
  tokenId: bigint;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  deadline: bigint;
}

export interface DecreaseLiquidityParams {
  tokenId: bigint;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  deadline: bigint;
}

export interface CollectParams {
  tokenId: bigint;
  recipient: Address;
  amount0Max: bigint;
  amount1Max: bigint;
}

// ---------------------------------------------------------------------------
// Encoder functions
// ---------------------------------------------------------------------------

function assertSelector(data: Hex, expected: Hex, verb: string): void {
  const actual = data.slice(0, 10).toLowerCase();
  if (actual !== expected) {
    throw new Error(
      `encode${verb} selector drift: expected ${expected} got ${actual}`,
    );
  }
}

/**
 * Encode `NPM.mint(MintParams)` calldata. 11-field tuple in canonical order
 * per RESEARCH § Topic 2 (load-bearing — drift produces calldata the NPM
 * decodes into wrong slots).
 *
 * Fixture UNI-LP-A anchor: see test/signing-fingerprint.test.ts.
 */
export function encodeMint(params: MintParams): Hex {
  const data = encodeFunctionData({
    abi: NPM_WRITE_ABI,
    functionName: "mint",
    args: [
      {
        token0: params.token0,
        token1: params.token1,
        fee: params.fee,
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
        amount0Desired: params.amount0Desired,
        amount1Desired: params.amount1Desired,
        amount0Min: params.amount0Min,
        amount1Min: params.amount1Min,
        recipient: params.recipient,
        deadline: params.deadline,
      },
    ],
  });
  assertSelector(data, UNISWAP_V3_LP_SELECTORS.mint, "Mint");
  return data;
}

/**
 * Encode `NPM.increaseLiquidity(IncreaseLiquidityParams)` calldata.
 *
 * Fixture UNI-LP-B anchor: see test/signing-fingerprint.test.ts.
 */
export function encodeIncreaseLiquidity(params: IncreaseLiquidityParams): Hex {
  const data = encodeFunctionData({
    abi: NPM_WRITE_ABI,
    functionName: "increaseLiquidity",
    args: [
      {
        tokenId: params.tokenId,
        amount0Desired: params.amount0Desired,
        amount1Desired: params.amount1Desired,
        amount0Min: params.amount0Min,
        amount1Min: params.amount1Min,
        deadline: params.deadline,
      },
    ],
  });
  assertSelector(
    data,
    UNISWAP_V3_LP_SELECTORS.increaseLiquidity,
    "IncreaseLiquidity",
  );
  return data;
}

/**
 * Encode `NPM.decreaseLiquidity(DecreaseLiquidityParams)` calldata.
 *
 * CRITICAL: decreaseLiquidity does NOT transfer tokens to the user. It
 * accounts withdrawn liquidity to `tokensOwed0`/`tokensOwed1` on the position;
 * the user must call `collect(...)` to receive tokens. The PREPARE RECEIPT
 * template for this verb bakes in the verbatim notice (T-DECREASE-DOES-NOT-
 * TRANSFER mitigation).
 *
 * Fixture UNI-LP-C anchor: see test/signing-fingerprint.test.ts.
 */
export function encodeDecreaseLiquidity(params: DecreaseLiquidityParams): Hex {
  const data = encodeFunctionData({
    abi: NPM_WRITE_ABI,
    functionName: "decreaseLiquidity",
    args: [
      {
        tokenId: params.tokenId,
        liquidity: params.liquidity,
        amount0Min: params.amount0Min,
        amount1Min: params.amount1Min,
        deadline: params.deadline,
      },
    ],
  });
  assertSelector(
    data,
    UNISWAP_V3_LP_SELECTORS.decreaseLiquidity,
    "DecreaseLiquidity",
  );
  return data;
}

/**
 * Encode `NPM.collect(CollectParams)` calldata. The default sentinel for
 * `amount0Max`/`amount1Max` is `MAX_UINT128` — collects everything.
 *
 * Fixture UNI-LP-D anchor: see test/signing-fingerprint.test.ts.
 */
export function encodeCollect(params: CollectParams): Hex {
  const data = encodeFunctionData({
    abi: NPM_WRITE_ABI,
    functionName: "collect",
    args: [
      {
        tokenId: params.tokenId,
        recipient: params.recipient,
        amount0Max: params.amount0Max,
        amount1Max: params.amount1Max,
      },
    ],
  });
  assertSelector(data, UNISWAP_V3_LP_SELECTORS.collect, "Collect");
  return data;
}

/**
 * Encode `NPM.burn(uint256 tokenId)` calldata. Refuses on-chain (revert) if
 * the position has any liquidity OR any tokensOwed; `prepare_uniswap_v3_burn`
 * pre-flights via `positions(tokenId)` to refuse non-empty positions BEFORE
 * the tx hits chain (T-BURN-PRECONDITION mitigation).
 *
 * Selector `0x42966c68` COLLIDES with Phase 31 `rETH.burn` + ERC-20 Burnable —
 * `preview_send` `(tx.to, selector)` tuple-dispatches.
 *
 * Fixture UNI-LP-E anchor: see test/signing-fingerprint.test.ts.
 */
export function encodeBurn(tokenId: bigint): Hex {
  const data = encodeFunctionData({
    abi: NPM_WRITE_ABI,
    functionName: "burn",
    args: [tokenId],
  });
  assertSelector(data, UNISWAP_V3_LP_SELECTORS.burn, "Burn");
  return data;
}

// ---------------------------------------------------------------------------
// Plan 33-03 — composite multicall encoder + rebalance composition helper
// ---------------------------------------------------------------------------

/**
 * Encode `NPM.multicall(bytes[])` calldata wrapping `innerCalls` — Plan 33-03.
 * Each inner call is a pre-encoded NPM verb calldata blob (produced by
 * `encodeDecreaseLiquidity` / `encodeCollect` / `encodeMint` etc.).
 *
 * Selector `0xac9650d8` — NEVER conflate with the Phase 32 deadline-overload
 * (prefix `0x5ae4...`); the two live on different contracts. The internal
 * `assertSelector` guard catches drift at encode time.
 *
 * Fixture UNI-LP-F anchor: see test/signing-fingerprint.test.ts.
 */
export function encodeMulticallBytes(innerCalls: readonly Hex[]): Hex {
  const data = encodeFunctionData({
    abi: MULTICALL_BYTES_ABI,
    functionName: "multicall",
    args: [innerCalls as Hex[]],
  });
  assertSelector(data, UNISWAP_V3_LP_SELECTORS.multicallBytes, "MulticallBytes");
  return data;
}

/**
 * Composition helper for `prepare_uniswap_v3_rebalance` — composes 3 NPM
 * inner calls in LOAD-BEARING order and wraps them in `multicall(bytes[])`:
 *
 *   1. `decreaseLiquidity` — burns 100% of `existingLiquidity` from the
 *       position; settles the resulting token amounts to `tokensOwed0/1`
 *       on the position state (per 33-RESEARCH § Topic 2: decreaseLiquidity
 *       does NOT transfer tokens — they must be collected).
 *   2. `collect` — sweeps the settled-but-uncollected amounts (plus any
 *       pre-existing accrued fees) using the `MAX_UINT128` sentinel for
 *       both `amount*Max` fields, sending to `collectRecipient`.
 *   3. `mint` — opens a NEW position at the new tick range with the
 *       supplied `mintParams`.
 *
 * The order is LOAD-BEARING (33-RESEARCH § Topic 2 + 33-CONTEXT.md D-06):
 *   - decrease BEFORE collect: decreaseLiquidity is what populates
 *     `tokensOwed0/1` for collect to harvest.
 *   - collect BEFORE mint: the new mint pulls token balances from the user's
 *     wallet via `TransferHelper.safeTransferFrom`; the collected tokens
 *     must already be present in the wallet at the time mint executes. The
 *     multicall executes atomically — collect's transfer-out to
 *     `collectRecipient` (= user) lands BEFORE mint's transferFrom pulls.
 *
 * Swapping any step's position would either (a) collect nothing (mint before
 * collect would still receive its tokens but the decreased liquidity stays
 * stranded in `tokensOwed`) or (b) leak the collected tokens into the user's
 * wallet without re-deploying them as the new position. Both are user-visible
 * value losses.
 */
export function composeRebalanceCalldata(args: {
  tokenId: bigint;
  existingLiquidity: bigint;
  collectRecipient: Address;
  mintParams: MintParams;
  decreaseAmount0Min: bigint;
  decreaseAmount1Min: bigint;
  deadline: bigint;
}): Hex {
  const decreaseInner = encodeDecreaseLiquidity({
    tokenId: args.tokenId,
    liquidity: args.existingLiquidity,
    amount0Min: args.decreaseAmount0Min,
    amount1Min: args.decreaseAmount1Min,
    deadline: args.deadline,
  });
  const collectInner = encodeCollect({
    tokenId: args.tokenId,
    recipient: args.collectRecipient,
    amount0Max: MAX_UINT128,
    amount1Max: MAX_UINT128,
  });
  const mintInner = encodeMint(args.mintParams);
  return encodeMulticallBytes([decreaseInner, collectInner, mintInner]);
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Production callers in
 * `src/tools/prepare_uniswap_v3_*.ts` route through this object so tests can
 * `vi.spyOn(_uniswapV3LpProtocol, "encodeMint")` to intercept without
 * monkey-patching named exports.
 *
 * Mirror of `_uniswapV3Protocol` in src/protocols/uniswap-v3.ts (Phase 32).
 * Plan 33-03 widens with `encodeMulticallBytes` + `composeRebalanceCalldata`.
 */
export const _uniswapV3LpProtocol = {
  encodeMint,
  encodeIncreaseLiquidity,
  encodeDecreaseLiquidity,
  encodeCollect,
  encodeBurn,
  encodeMulticallBytes,
  composeRebalanceCalldata,
};
