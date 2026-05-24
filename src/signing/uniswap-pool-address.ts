// src/signing/uniswap-pool-address.ts
//
// Uniswap V3 deterministic pool-address derivation — Phase 33 Plan 33-01.
//
// Pure-bigint CREATE2 keccak256 derivation per v3-periphery PoolAddress.sol
// lines 22-55. Avoids the per-position factory.getPool() RPC roundtrip in
// src/chains/uniswap-v3-lp.ts (saves 1 eth_call per LP position).
//
// Factory address + POOL_INIT_CODE_HASH have been canonical since 2021
// Factory deployment; the factory has never been upgraded. Drift in either
// constant or in the keccak preimage encoding silently produces wrong pool
// addresses — mitigated by the module-load self-check at the bottom of this
// file (RESEARCH § Topic 6 + Pitfall 6).
//
// NO side effects beyond the one-time module-load self-check below. NO RPC
// reads. The self-check is deterministic + pure-bigint — it throws at module
// load if drift is detected.
//
// Threat anchor:
//   - T-POOL-ADDRESS-COMPUTE-DRIFT: factory address OR POOL_INIT_CODE_HASH
//     OR keccak preimage encoding drift produces wrong pool addresses.
//     Mitigation: module-load self-check against the canonical USDC/WETH
//     0.05% pool (Etherscan-VERIFIED).
//
// Cross-link: consumed by src/chains/uniswap-v3-lp.ts (per-position pool
// derivation in the readUserPositions fan-out).

import {
  type Address,
  type Hex,
  encodeAbiParameters,
  encodePacked,
  getAddress,
  keccak256,
} from "viem";

import type { Uniswapv3FeeTier } from "./uniswap-tick.js";

// ---------------------------------------------------------------------------
// Constants (canonical since 2021 Factory deployment)
// ---------------------------------------------------------------------------

/**
 * Uniswap V3 Factory on Ethereum mainnet. Same address on all 5 supported
 * EVM chains per Uniswap docs (CREATE2 deployment via singleton deployer).
 * RESEARCH § Topic 6 (cross-checked vs docs.uniswap.org).
 */
export const UNISWAP_V3_FACTORY: Address = getAddress(
  "0x1F98431c8aD98523631AE4a59f267346ea31F984",
);

/**
 * Canonical PoolDeployer init-code-hash (v3-periphery PoolAddress.sol line 6).
 * Used as the salt mixer in the CREATE2 preimage; pinned at deployment time
 * and unchanged since Q2 2021.
 */
export const POOL_INIT_CODE_HASH: Hex =
  "0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54";

// ---------------------------------------------------------------------------
// computePoolAddress — CREATE2 derivation
// ---------------------------------------------------------------------------

/**
 * Deterministically derive the Uniswap V3 pool address for `(token0, token1, fee)`.
 *
 * Canonical algorithm (v3-periphery PoolAddress.sol#computeAddress):
 *   pool = keccak256(
 *            0xff
 *          ‖ factory                                              (20 bytes)
 *          ‖ keccak256(abi.encode(token0, token1, fee))            (32 bytes)
 *          ‖ POOL_INIT_CODE_HASH                                   (32 bytes)
 *          )[12:32]                                                (last 20 bytes)
 *
 * Token-order discipline: the function ENFORCES `token0 < token1` by sorting
 * the input pair (matching the Solidity `getPoolKey` helper at lines 22-27).
 * Callers may pass tokens in either order.
 */
export function computePoolAddress(
  tokenA: Address,
  tokenB: Address,
  fee: Uniswapv3FeeTier,
): Address {
  // Canonical token0/token1 sort — compare lowercase hex byte-strings.
  const a = getAddress(tokenA);
  const b = getAddress(tokenB);
  const [token0, token1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];

  // Inner keccak: keccak256(abi.encode(token0, token1, fee)) where the
  // encoding is the standard 32-byte-padded ABI form (NOT packed).
  const salt = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }],
      [token0, token1, fee],
    ),
  );

  // Outer keccak preimage: 0xff ‖ factory ‖ salt ‖ POOL_INIT_CODE_HASH.
  // Use packed (not ABI-padded) encoding per CREATE2 standard.
  const preimage = encodePacked(
    ["bytes1", "address", "bytes32", "bytes32"],
    ["0xff", UNISWAP_V3_FACTORY, salt, POOL_INIT_CODE_HASH],
  );
  const hash = keccak256(preimage);

  // Take the last 20 bytes (hash is 32 bytes / 64 hex; we want bytes 12..31
  // → hex chars 24..63 → with "0x" prefix → chars 26..66 of the 0x-prefixed
  // string).
  return getAddress(("0x" + hash.slice(26)) as Address);
}

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection
// ---------------------------------------------------------------------------

export const _uniswapV3PoolAddress = { computePoolAddress };

// ---------------------------------------------------------------------------
// Module-load self-check — anchors factory + init-code-hash correctness.
// ---------------------------------------------------------------------------
//
// USDC / WETH 0.05% pool: 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640 (Etherscan
// VERIFIED). Drift in either constant or the keccak preimage encoding
// silently produces wrong addresses for downstream LP reads — this check
// throws at module load time, surfacing the bug before any RPC fan-out runs.
const _USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const _WETH = getAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
const _USDC_WETH_500 = getAddress("0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640");
if (computePoolAddress(_USDC, _WETH, 500) !== _USDC_WETH_500) {
  throw new Error(
    "uniswap-pool-address.ts module load self-check FAILED — factory address OR POOL_INIT_CODE_HASH OR computeAddress impl drifted",
  );
}
