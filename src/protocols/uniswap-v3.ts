// Uniswap V3 protocol primitives — Phase 32 Plan 32-01 (UNI-01 + UNI-02 + UNI-03).
//
// Multi-method decoder covering the Uniswap V3 swap surface VaultPilot ships
// in v2.4:
//   - SwapRouter02.exactInputSingle(ExactInputSingleParams)  — single-hop swap
//   - SwapRouter02.exactInput(ExactInputParams)              — multi-hop swap (packed path)
//   - SwapRouter02.unwrapWETH9(uint256, address)             — ETH-out tail wrap
//   - SwapRouter02 multicall(uint256, bytes[])               — outer deadline wrapper
//   - Quoter V2.quoteExactInputSingle(QuoteExactInputSingleParams) — single-hop quote
//   - Quoter V2.quoteExactInput(bytes, uint256)              — multi-hop quote
//
// Structural analog: src/protocols/rocketpool.ts (Phase 31) for the multi-method
// shape + selector-collision-warning idiom + src/protocols/eigenlayer.ts for
// the 5-selector hardcoded table pattern.
//
// Per CONTEXT.md D-02: SEPARATE file for Uniswap V3 (sibling to
// src/protocols/lido.ts / eigenlayer.ts / rocketpool.ts). SwapRouter02 + Quoter
// V2 are ONE protocol despite the contract split.
//
// Per CONTEXT.md D-10: every Phase 32 swap is wrapped in
// multicall(uint256 deadline, bytes[] data) — the deadline overload. The
// outer multicall selector (0x5ae401dc) is presented to Ledger, which
// blind-signs (NOT in ERC-7730 registry per RESEARCH § Topic 7). See
// LEDGER_NOTICE_UNISWAP_V3_TEMPLATE in src/signing/blocks.ts.
//
// Function selectors VERIFIED via viem.toFunctionSelector at research time
// (32-RESEARCH § Topic 2, 2026-05-23):
//   SwapRouter02.exactInputSingle(...):                      0x04e45aaf
//   SwapRouter02.exactInput(...):                            0xb858183f
//   SwapRouter02.multicall(uint256,bytes[]):                 0x5ae401dc  (LOAD-BEARING — D-10)
//   SwapRouter02.unwrapWETH9(uint256,address):               0x49404b7c
//   Quoter V2.quoteExactInputSingle(...):                    0xc6a5026a
//   Quoter V2.quoteExactInput(bytes,uint256):                0xcdca1753
//
// SELECTOR COLLISION + STRUCT-FIELD-ORDER WARNINGS:
//
//   - Pitfall 1 (RESEARCH § Topic 1) — Quoter V2 ExactInputSingleParams struct
//     field order DIFFERS from SwapRouter02 ExactInputSingleParams:
//       SwapRouter02.ExactInputSingleParams: (tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96)
//       Quoter V2  .QuoteExactInputSingleParams: (tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96)
//     amountIn comes BEFORE fee in Quoter V2; no recipient; no amountOutMinimum.
//     Drift between the two encodings is a SILENT BUG CLASS — the parseAbi
//     fragments below preserve each struct's canonical field order; do NOT
//     "harmonize" them.
//
//   - Pitfall 4 (RESEARCH § Topic 4) — Uniswap V3 ships TWO multicall overloads:
//       multicall(bytes[])                          — bytes-only selector
//       multicall(uint256 deadline, bytes[] data)   — selector 0x5ae401dc
//     Phase 32 uses ONLY the deadline overload (D-10). MULTICALL_DEADLINE_ABI
//     is a SEPARATE parseAbi fragment to pin the deadline-overload selector
//     explicitly. The bytes-only selector MUST NOT appear anywhere
//     in this module (acceptance criterion; see test/protocols-uniswap-v3.test.ts
//     for the runtime cross-assertion against viem.toFunctionSelector).
//
//   - Pitfall 3 (RESEARCH § Topic 6) — For ETH-out swaps, the inner
//     exactInputSingle's `recipient` field MUST be the SwapRouter02 address
//     (the router itself), NOT the user. The router holds WETH between
//     sub-calls; unwrapWETH9 unwraps the router's WETH balance and sends
//     ETH to the user. See composeMulticallWithUnwrap doc.
//
// ESM spy-affordance: `_uniswapV3Protocol` wraps all 5 encoders so tests can
// `vi.spyOn(_uniswapV3Protocol, "encodeExactInputSingle")` without monkey-
// patching named exports (ESM bindings are immutable; direct spies are
// no-ops for internal calls). Per CLAUDE.md § Conventions.
//
// Consumed by:
//   - src/chains/uniswap-v3.ts           (Quoter V2 chain client — Plan 32-02)
//   - src/tools/get_uniswap_quote.ts     (Plan 32-02 — read-only quote)
//   - src/tools/prepare_uniswap_swap.ts  (Plan 32-03 — calldata composition)
//   - src/tools/preview_send.ts          (Plan 32-03 — (to, selector) tuple dispatch)
//   - test/protocols-uniswap-v3.test.ts  (byte-identity selector + encoder regressions)
//   - test/signing-fingerprint.test.ts   (Fixtures UNI-A + UNI-B + UNI-C)

import {
  type Address,
  type Hex,
  encodeFunctionData,
  parseAbi,
} from "viem";

import {
  getUniswapV3QuoterV2Address,
  getUniswapV3SwapRouter02Address,
  type ChainId,
} from "../config/contracts.js";

// Re-export SOT getters — callers inside src/protocols/, src/chains/, and
// src/tools/ can import from a single locality if they're already consuming
// Uniswap V3 primitives. The SOT remains src/config/contracts.ts; these are
// delegation wrappers. Mirror of rocketpool.ts lines 79-86 pattern.
export {
  getUniswapV3QuoterV2Address,
  getUniswapV3SwapRouter02Address,
};
export type { ChainId };

// ---------------------------------------------------------------------------
// ABI fragments (parseAbi-typed)
// ---------------------------------------------------------------------------

/**
 * SwapRouter02 ABI fragments — the Uniswap V3 write surface.
 *
 * Field order in `ExactInputSingleParams` is LOAD-BEARING — drift produces
 * calldata that the router decodes into wrong tokenIn/tokenOut/etc. The
 * canonical order (per Uniswap docs + on-chain SwapRouter02 source):
 *   (tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96)
 *
 * `unwrapWETH9` consumes the router's WETH balance and sends native ETH to
 * `recipient`. Used in the ETH-out multicall composition (D-05).
 */
export const SWAP_ROUTER_02_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) external payable",
]);

/**
 * Quoter V2 ABI fragments — the Uniswap V3 read surface.
 *
 * Field order in `QuoteExactInputSingleParams` is INTENTIONALLY DIFFERENT
 * from SwapRouter02's `ExactInputSingleParams` (Pitfall 1):
 *   (tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96)
 * amountIn comes BEFORE fee; no recipient; no amountOutMinimum.
 *
 * Do NOT "harmonize" with the SwapRouter02 fragment — drift between the two
 * is a SILENT BUG CLASS (the chain client calls Quoter V2; the prepare tool
 * calls SwapRouter02; fixtures catch drift on either side).
 *
 * Quoter V2 is `nonpayable` (NOT `view`) but viem's `readContract` handles
 * the revert-with-return-value pattern correctly (RESEARCH § Topic 1).
 */
export const QUOTER_V2_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

/**
 * `multicall(uint256 deadline, bytes[] data)` overload — kept as a SEPARATE
 * fragment to pin the deadline-overload selector explicitly (Pitfall 4
 * mitigation). The OTHER overload `multicall(bytes[])` carries a different
 * 4-byte selector and must NOT appear anywhere in Phase 32 code.
 *
 * D-10: every Phase 32 swap is wrapped in this overload — `block.timestamp +
 * 600` deadline restored as anti-replay defense (SwapRouter02 itself drops
 * the deadline param for gas efficiency).
 */
export const MULTICALL_DEADLINE_ABI = parseAbi([
  "function multicall(uint256 deadline, bytes[] data) external payable returns (bytes[])",
]);

// ---------------------------------------------------------------------------
// Selector table (HARDCODED VERIFIED LITERALS — D-02 + Pitfall 4 + Pitfall 1)
// ---------------------------------------------------------------------------

/**
 * 4-byte function selectors for the 6 Uniswap V3 functions VaultPilot encodes
 * or reads at Phase 32. Empirically verified via `viem.toFunctionSelector` at
 * research time (32-RESEARCH § Topic 2, 2026-05-23). Drift in any selector
 * cascades through the cryptographic-binding chain (Fixtures UNI-A + UNI-B +
 * UNI-C in test/signing-fingerprint.test.ts fail at a specific line).
 *
 * The 6 canonical signatures each selector pins:
 *   exactInputSingle:        function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
 *   exactInput:              function exactInput((bytes,address,uint256,uint256))
 *   multicallWithDeadline:   function multicall(uint256,bytes[])
 *   unwrapWETH9:             function unwrapWETH9(uint256,address)
 *   quoteExactInputSingle:   function quoteExactInputSingle((address,address,uint256,uint24,uint160))
 *   quoteExactInput:         function quoteExactInput(bytes,uint256)
 *
 * COLLISION + DRIFT WARNINGS:
 *   - `multicallWithDeadline === "0x5ae401dc"` is the DEADLINE overload. The
 *     bytes-only overload `multicall(bytes[])` carries a different selector
 *     — Phase 32 never uses this; acceptance criterion enforces grep returns 0.
 *   - `quoteExactInputSingle === "0xc6a5026a"` decodes against the Quoter V2
 *     struct order (Pitfall 1); harmonizing field order with SwapRouter02 would
 *     change the selector.
 */
export const UNISWAP_V3_SELECTORS = {
  /** SwapRouter02.exactInputSingle — single-hop swap; Fixture UNI-A anchor. */
  exactInputSingle: "0x04e45aaf" as Hex,
  /** SwapRouter02.exactInput — multi-hop swap with packed path; Fixture UNI-C anchor. */
  exactInput: "0xb858183f" as Hex,
  /** SwapRouter02.multicall(uint256,bytes[]) — D-10 outer deadline wrapper. */
  multicallWithDeadline: "0x5ae401dc" as Hex,
  /** SwapRouter02.unwrapWETH9 — ETH-out tail in multicall composition; Fixture UNI-B anchor. */
  unwrapWETH9: "0x49404b7c" as Hex,
  /** Quoter V2.quoteExactInputSingle — single-hop quote (Pitfall 1 struct order). */
  quoteExactInputSingle: "0xc6a5026a" as Hex,
  /** Quoter V2.quoteExactInput — multi-hop quote against packed path. */
  quoteExactInput: "0xcdca1753" as Hex,
} as const;

// ---------------------------------------------------------------------------
// Encoder parameter types
// ---------------------------------------------------------------------------

export interface ExactInputSingleParams {
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  recipient: Address;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96: bigint;
}

export interface ExactInputParams {
  /** Packed-bytes path from `src/signing/uniswap-path.ts` `encodeV3Path`. */
  path: Hex;
  recipient: Address;
  amountIn: bigint;
  amountOutMinimum: bigint;
}

// ---------------------------------------------------------------------------
// Encoder functions
// ---------------------------------------------------------------------------

/**
 * Encode `SwapRouter02.exactInputSingle(params)` calldata. The struct fields
 * are passed in the CANONICAL ORDER (tokenIn, tokenOut, fee, recipient,
 * amountIn, amountOutMinimum, sqrtPriceLimitX96) — viem `encodeFunctionData`
 * resolves the tuple order from the parseAbi fragment.
 *
 * `fee` is `uint24` on-chain (0..16777215); the 4 canonical Uniswap V3 tiers
 * are 100 / 500 / 3000 / 10000. Out-of-range values throw at the viem encoder
 * boundary (numeric overflow).
 *
 * `sqrtPriceLimitX96 = 0n` is the recommended default — disables the
 * per-pool price-limit check; users rely on `amountOutMinimum` for slippage
 * protection (D-05 anchor).
 *
 * Fixture UNI-A anchor: see test/signing-fingerprint.test.ts.
 */
export function encodeExactInputSingle(params: ExactInputSingleParams): Hex {
  return encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: "exactInputSingle",
    args: [params],
  });
}

/**
 * Encode `SwapRouter02.exactInput(params)` calldata. The `path` field is the
 * packed-bytes V3 path produced by `src/signing/uniswap-path.ts`
 * `encodeV3Path([{tokenIn, fee, tokenOut}, ...])` — pure-bytes via viem
 * `encodePacked` (Pitfall 2).
 *
 * Fixture UNI-C anchor: see test/signing-fingerprint.test.ts.
 */
export function encodeExactInput(params: ExactInputParams): Hex {
  return encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: "exactInput",
    args: [params],
  });
}

/**
 * Encode `SwapRouter02.unwrapWETH9(amountMinimum, recipient)` calldata.
 * Consumes the router's WETH balance (whatever sits there after the inner
 * swap) and sends native ETH to `recipient`. Used in the ETH-out multicall
 * composition (D-05 + Pitfall 3) — see `composeMulticallWithUnwrap`.
 *
 * Returns 68-byte payload (4-byte selector + 2 × 32-byte ABI-encoded args)
 * → 138-char hex string total. The byte-length is asserted by
 * test/protocols-uniswap-v3.test.ts.
 *
 * Fixture UNI-B anchor: see test/signing-fingerprint.test.ts.
 */
export function encodeUnwrapWeth9(amountMinimum: bigint, recipient: Address): Hex {
  return encodeFunctionData({
    abi: SWAP_ROUTER_02_ABI,
    functionName: "unwrapWETH9",
    args: [amountMinimum, recipient],
  });
}

/**
 * Encode `SwapRouter02.multicall(uint256 deadline, bytes[] data)` calldata —
 * the DEADLINE overload (selector 0x5ae401dc), NOT the bytes-only overload
 * (which carries a different 4-byte selector — Pitfall 4).
 *
 * Wraps the inner sub-calls (`exactInputSingle` / `exactInput` /
 * `unwrapWETH9` etc.) so the deadline is enforced on the outer wrapper —
 * defense-in-depth against pending-tx replay if the user signs but doesn't
 * broadcast immediately (D-10).
 *
 * All Phase 32 swaps are wrapped via this encoder; the Ledger device sees the
 * outer selector and blind-signs (LEDGER_NOTICE_UNISWAP_V3_TEMPLATE in
 * src/signing/blocks.ts).
 */
export function encodeMulticallWithDeadline(
  deadline: bigint,
  calls: readonly Hex[],
): Hex {
  return encodeFunctionData({
    abi: MULTICALL_DEADLINE_ABI,
    functionName: "multicall",
    args: [deadline, [...calls]],
  });
}

// ---------------------------------------------------------------------------
// composeMulticallWithUnwrap — ETH-out helper
// ---------------------------------------------------------------------------

export interface ComposeMulticallWithUnwrapInput {
  /** `block.timestamp + 600` (or equivalent) — outer deadline. */
  deadline: bigint;
  /**
   * Inner exactInputSingle params. The `recipient` field MUST be the
   * SwapRouter02 address (the router itself), NOT the user — Pitfall 3 / D-15
   * fixture UNI-B correction. The router holds WETH between sub-calls;
   * `unwrapWETH9` unwraps that balance to native ETH and sends it to
   * `finalRecipient` atomically. If `recipient` is set to the user instead,
   * the router never holds the WETH to unwrap and the swap fails inside the
   * multicall.
   */
  exactInputSingleParamsWithRouterRecipient: ExactInputSingleParams;
  /** Slippage floor for the final WETH→ETH unwrap (typically the swap's amountOutMinimum). */
  finalAmountOutMin: bigint;
  /** The user's address — the final destination of the native ETH. */
  finalRecipient: Address;
}

/**
 * Centralize the ETH-out multicall composition. Builds:
 *   multicall(deadline, [
 *     exactInputSingle({ ..., recipient = router-address }),
 *     unwrapWETH9(amountOutMin, user)
 *   ])
 *
 * Pitfall 3 mitigation: documentation comment + helper-name encode the
 * load-bearing recipient discipline. The helper does NOT mutate
 * `exactInputSingleParamsWithRouterRecipient` — the caller is responsible
 * for passing `recipient = SwapRouter02 address`. The helper name carries
 * the discipline so a reviewer cannot miss it.
 *
 * Fixture UNI-B (ETH-out) anchor: see test/signing-fingerprint.test.ts.
 */
export function composeMulticallWithUnwrap(
  input: ComposeMulticallWithUnwrapInput,
): Hex {
  const inner1 = encodeExactInputSingle(input.exactInputSingleParamsWithRouterRecipient);
  const inner2 = encodeUnwrapWeth9(input.finalAmountOutMin, input.finalRecipient);
  return encodeMulticallWithDeadline(input.deadline, [inner1, inner2]);
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Production callers that
 * route through this object can be intercepted by
 * `vi.spyOn(_uniswapV3Protocol, "encodeExactInputSingle")` in tests —
 * named-export bindings are immutable in ESM; a direct `vi.spyOn` on the
 * export is a no-op for module-internal calls.
 *
 * Mirror of `_rocketPoolProtocol` in src/protocols/rocketpool.ts and
 * `_eigenLayerProtocol` in src/protocols/eigenlayer.ts.
 *
 * Companion symbol: `UNISWAP_V3_SELECTORS` (the hardcoded 6-selector table
 * above). Selector lookup-by-name is the only PUBLIC consumption of
 * `UNISWAP_V3_SELECTORS` inside `src/` — callers in `src/tools/preview_send.ts`
 * (Plan 32-03 (to, selector) tuple dispatch) and `test/` reach for it.
 */
export const _uniswapV3Protocol = {
  encodeExactInputSingle,
  encodeExactInput,
  encodeUnwrapWeth9,
  encodeMulticallWithDeadline,
  composeMulticallWithUnwrap,
};
