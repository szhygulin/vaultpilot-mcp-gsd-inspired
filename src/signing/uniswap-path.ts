// src/signing/uniswap-path.ts
//
// Uniswap V3 packed-path encoder — Phase 32 Plan 32-01.
//
// Pure-bytes encoder for the Uniswap V3 multi-hop path format:
//   tokenIn(20 bytes) ‖ fee1(uint24=3 bytes) ‖ tokenMid(20) ‖ fee2(3) ‖ tokenOut(20)
//
// Locked on src/signing/ to keep the trust-pipeline shelf coherent — mirrors
// the pure-math separation pattern of src/signing/eigenlayer-shares.ts +
// src/signing/rocketpool-rate.ts + src/signing/lido-rebase.ts.
//
// NO side effects. NO RPC reads. NO module-load state.
//
// Pitfall 2 / anti-pattern 1 (RESEARCH § Topic 3): `encodePacked` is
// LOAD-BEARING. The standard ABI-parameter encoder produces 32-byte
// word-padded output (160 bytes for a 2-hop path), which silently routes the
// swap through the wrong calldata shape. The repo regression check at
// test/signing-uniswap-path.test.ts pins canonical hex literals; the
// acceptance criterion in 32-01-PLAN.md additionally `grep`s that the
// word-padded encoder name does NOT appear in this file (anti-pattern guard).
//
// Threat anchors:
//   - T-32-PATH-ENCODING-DRIFT: drift between encodePacked vs the word-padded
//     encoder OR drift in the [address, uint24, address, ...] types-array
//     shape silently produces wrong-path calldata. Mitigation: hardcoded
//     byte-length + hex-literal fixtures in test/signing-uniswap-path.test.ts.
//
// Reference fixtures for cross-checking — see test/signing-uniswap-path.test.ts.
// Cross-link: consumed by src/protocols/uniswap-v3.ts (encodeExactInput) via
// the _uniswapV3Path indirection.

import { type Address, type Hex, encodePacked } from "viem";

// ---------------------------------------------------------------------------
// PathHop interface
// ---------------------------------------------------------------------------

/**
 * A single hop in a Uniswap V3 multi-hop swap path.
 *
 * Fee tiers (`fee`) are the 4 canonical Uniswap V3 pool fee tiers:
 *   - 100   = 0.01% (stablecoin-pair tier)
 *   - 500   = 0.05%
 *   - 3000  = 0.30%
 *   - 10000 = 1.00%
 *
 * At the on-chain encoding layer, `fee` is a `uint24` (3 bytes). The
 * literal-union typing enforces the canonical 4 tiers at compile time —
 * passing `200` or `2500` is a TypeScript error before runtime.
 *
 * `tokenIn` and `tokenOut` are EIP-55-checksummed `Address` values; callers
 * MUST pre-checksum via viem's `getAddress` before passing.
 */
export interface PathHop {
  readonly tokenIn: Address;
  readonly fee: 100 | 500 | 3000 | 10000;
  readonly tokenOut: Address;
}

// ---------------------------------------------------------------------------
// encodeV3Path
// ---------------------------------------------------------------------------

/**
 * Encode a Uniswap V3 packed-bytes path.
 *
 * For N hops, produces `(20 + 3 + ... + 20)` bytes where the tail of each hop
 * is the head of the next:
 *   N=1:  tokenIn ‖ fee ‖ tokenOut                                       = 43 bytes
 *   N=2:  tokenIn ‖ fee1 ‖ tokenMid ‖ fee2 ‖ tokenOut                    = 66 bytes
 *   N=3:  tokenIn ‖ fee1 ‖ tokenMid1 ‖ fee2 ‖ tokenMid2 ‖ fee3 ‖ tokenOut = 89 bytes
 *
 * Uses viem `encodePacked` — Pitfall 2 anti-pattern 1; the standard
 * ABI-parameter encoder would word-pad the values, silently producing
 * 160-byte output for N=2 and routing the swap through the wrong calldata
 * shape.
 *
 * Throws:
 *   - on empty hops:                `encodeV3Path: empty hops`
 *   - on intermediate-token mismatch: `encodeV3Path: hop ${i} tokenIn does not
 *                                    match hop ${i - 1} tokenOut`
 *
 * Reference fixtures (test/signing-uniswap-path.test.ts):
 *   - single-hop USDC→WETH 0.05%:
 *     `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb480001f4c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`
 *   - 2-hop USDC→WETH→WBTC 0.30%: byte length 66, contains `000bb8` twice.
 */
export function encodeV3Path(hops: readonly PathHop[]): Hex {
  const first = hops[0];
  if (first === undefined) {
    throw new Error("encodeV3Path: empty hops");
  }
  for (let i = 1; i < hops.length; i++) {
    const cur = hops[i]!;
    const prev = hops[i - 1]!;
    if (cur.tokenIn !== prev.tokenOut) {
      throw new Error(
        `encodeV3Path: hop ${i} tokenIn does not match hop ${i - 1} tokenOut`,
      );
    }
  }
  const types: ("address" | "uint24")[] = ["address"];
  const values: (Address | number)[] = [first.tokenIn];
  for (const hop of hops) {
    types.push("uint24", "address");
    values.push(hop.fee, hop.tokenOut);
  }
  return encodePacked(types, values);
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Tests can
 * `vi.spyOn(_uniswapV3Path, "encodeV3Path")` to intercept without
 * monkey-patching named exports (ESM bindings are immutable; direct spies are
 * no-ops for module-internal calls). Mirror of `_eigenLayerShares` in
 * src/signing/eigenlayer-shares.ts and `_rocketPoolRate` in
 * src/signing/rocketpool-rate.ts.
 */
export const _uniswapV3Path = { encodeV3Path };
