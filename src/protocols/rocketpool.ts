// Rocket Pool protocol primitives — Phase 31 Plan 31-03 (RP-01 + RP-02).
//
// Single-file decoder covering the Rocket Pool write surface VaultPilot ships
// in v2.3:
//   - RocketDepositPool.deposit() payable        — ETH → rETH stake entry
//   - rETH.burn(uint256)                          — rETH → ETH unstake entry
//   - RocketDAOProtocolSettingsDeposit.getMinimumDeposit() [read, ABI only]
//
// Structural analog: src/protocols/lido.ts (Phase 30) for the multi-method
// shape + src/protocols/weth9.ts (Phase 6) for the value-bearing-no-arg
// `deposit()` encoder pattern.
//
// Per CONTEXT.md D-01 + D-02: SEPARATE file for Rocket Pool (sibling to
// src/protocols/lido.ts AND src/protocols/eigenlayer.ts), NOT a widening of
// an existing decoder. Rocket Pool ships two write contracts (RocketDepositPool
// + rETH) plus the settings-deposit read — its own decoder surface.
//
// Per D-07: selectors are HARDCODED VERIFIED LITERALS (not computed at
// runtime). Drift in any selector cascades through the cryptographic-binding
// chain (Fixtures AA-RP + AB-RP in test/signing-fingerprint.test.ts fail at a
// specific line). The byte-identity regression in test/protocols-rocketpool.test.ts
// MUST catch any drift before the selector reaches a payloadFingerprint.
//
// Function selectors VERIFIED via viem.toFunctionSelector at research time
// (31-RESEARCH § Topic 1, 2026-05-23):
//   RocketDepositPool.deposit():                          0xd0e30db0
//   rETH.burn(uint256):                                   0x42966c68
//   RocketDAOProtocolSettingsDeposit.getMinimumDeposit(): 0x035cf142
//   RocketDepositPool.getBalance():                       0x12065fe0
//   rETH.getExchangeRate():                               0xe6aa216c
//   rETH.getEthValue(uint256):                            0x8b32fa23
//
// SELECTOR COLLISION WARNINGS:
//
//   - Pitfall 1 — `0xd0e30db0` ALSO matches WETH9.deposit().
//     RocketDepositPool.deposit() and WETH9.deposit() share the SAME
//     4-byte selector. A selector-blind dispatch in preview_send would
//     route both to the same DECODED ARGS arm. The mitigation lives in
//     src/tools/preview_send.ts: routing dispatches on the (tx.to, selector)
//     TUPLE — tx.to === getRocketPoolDepositPoolAddress(1) routes to the
//     Rocket Pool arm; tx.to === getWethAddress(1) routes to the WETH9 arm.
//     The canonical-dispatch allowlist Set (Plan 31-01) remains
//     selector-blind by design — both addresses are independently allowlisted.
//
//   - Pitfall 2 — `0x42966c68` is the GENERIC ERC-20 Burnable extension
//     selector (OpenZeppelin's ERC20Burnable.burn(uint256)). Any ERC-20
//     contract using the OZ Burnable mixin exposes this selector. The
//     mitigation again lives in preview_send: tx.to === getRocketPoolRethAddress(1)
//     routes to the Rocket Pool unstake arm; other contracts fall through
//     to selector-blind handling without the Rocket Pool LEDGER NOTICE.
//
// ESM spy-affordance: `_rocketPoolProtocol` wraps the encoders so tests can
// `vi.spyOn(_rocketPoolProtocol, "encodeRocketPoolDeposit")` without
// monkey-patching named exports (ESM bindings are immutable; direct spies
// are no-ops for internal calls). Per CLAUDE.md § Conventions.
//
// Consumed by:
//   - src/tools/prepare_rocketpool_stake.ts    (Plan 31-03 — encodeRocketPoolDeposit)
//   - src/tools/prepare_rocketpool_unstake.ts  (Plan 31-03 — encodeRocketPoolBurn)
//   - src/chains/rocketpool.ts                 (Plan 31-03 — ABI fragments)
//   - src/tools/preview_send.ts                (Plan 31-03 — (to, selector) tuple dispatch)
//   - test/protocols-rocketpool.test.ts        (byte-identity regressions)
//   - test/signing-fingerprint.test.ts         (Fixtures AA-RP + AB-RP)

import { type Address, type Hex, encodeFunctionData, parseAbi } from "viem";

import {
  getRocketPoolDepositPoolAddress,
  getRocketPoolRethAddress,
  getRocketPoolDepositSettingsAddress,
  ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI,
  type ChainId,
} from "../config/contracts.js";

// Re-export SOT getters + the D-07 fallback constant — callers inside
// `src/protocols/`, `src/chains/`, and `src/tools/` can import from a single
// locality if they're already consuming Rocket Pool primitives. The SOT
// remains `src/config/contracts.ts`; these are delegation wrappers.
export {
  getRocketPoolDepositPoolAddress,
  getRocketPoolRethAddress,
  getRocketPoolDepositSettingsAddress,
  ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI,
};
export type { ChainId };

// ---------------------------------------------------------------------------
// Token decimal constants
// ---------------------------------------------------------------------------

/** rETH decimals — always 18 (ERC-20 standard; RocketTokenRETH contract). */
export const RETH_DECIMALS = 18;

// ---------------------------------------------------------------------------
// ABI fragments (parseAbi-typed)
// ---------------------------------------------------------------------------

/**
 * RocketDepositPool ABI fragments — stake entry + pool liquidity read.
 * - `deposit()` payable — ETH amount flows in msg.value; mints rETH to caller.
 * - `getBalance() view` — current ETH liquidity sitting in the deposit pool
 *   (consumed by Plan 31-03 D-08 pool-liquidity pre-flight for unstake).
 */
export const ROCKET_DEPOSIT_POOL_ABI = parseAbi([
  "function deposit() payable",
  "function getBalance() view returns (uint256)",
]);

/**
 * rETH (RocketTokenRETH) ABI fragments — the LST contract surface.
 * - `burn(uint256 _rethAmount)` — unstake entry; burns rETH for ETH at the
 *   current exchange rate; subject to deposit-pool liquidity availability.
 * - `balanceOf(address)` — standard ERC-20 read.
 * - `getExchangeRate()` — canonical 1e18-scaled rETH→ETH rate (used by
 *   `get_rocketpool_positions` to surface accrued staking value).
 * - `getEthValue(uint256)` — convenience read returning the ETH equivalent
 *   of a rETH amount (consumed by Plan 31-03's D-08 pool-liquidity pre-flight).
 */
export const RETH_ABI = parseAbi([
  "function burn(uint256 _rethAmount)",
  "function balanceOf(address account) view returns (uint256)",
  "function getExchangeRate() view returns (uint256)",
  "function getEthValue(uint256 _rethAmount) view returns (uint256)",
]);

/**
 * RocketDAOProtocolSettingsDeposit ABI — D-07 minimum-deposit pre-flight.
 * `getMinimumDeposit()` returns the minimum deposit amount in wei. Plan 31-03
 * reads this at prepare time and falls back to
 * `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI` (= 0.01 ETH) on RPC failure.
 */
export const ROCKET_SETTINGS_DEPOSIT_ABI = parseAbi([
  "function getMinimumDeposit() view returns (uint256)",
]);

// ---------------------------------------------------------------------------
// Selector table (HARDCODED VERIFIED LITERALS — D-07)
// ---------------------------------------------------------------------------

/**
 * 4-byte function selectors for the 2 Rocket Pool write functions VaultPilot
 * encodes. Empirically verified via `viem.toFunctionSelector` at research
 * time (31-RESEARCH § Topic 1, 2026-05-23). Drift in any selector cascades
 * through the cryptographic-binding chain (Fixtures AA-RP + AB-RP in
 * test/signing-fingerprint.test.ts fail at a specific line).
 *
 * COLLISION WARNINGS (preview_send tuple-dispatches on (tx.to, selector)):
 *
 *   - `deposit === "0xd0e30db0"` COLLIDES with `WETH9_SELECTORS.deposit`.
 *     Both contracts use the SAME 4-byte selector for their value-bearing
 *     no-arg deposit method. Preview-send routes on (tx.to, selector) — the
 *     allowlist Set is selector-blind; both addresses live independently in
 *     CANONICAL_DISPATCH_TARGETS[1] (Plan 31-01).
 *
 *   - `burn === "0x42966c68"` is the GENERIC OpenZeppelin ERC20Burnable
 *     `burn(uint256)` selector. Any ERC-20 with the OZ Burnable mixin exposes
 *     this. Preview-send routes on (tx.to === rETH-address, selector) for the
 *     Rocket Pool arm; other contracts fall through to selector-blind handling.
 */
export const ROCKETPOOL_SELECTORS = {
  /**
   * RocketDepositPool.deposit() — payable, no args. ETH amount in msg.value.
   * COLLISION: equals WETH9_SELECTORS.deposit (Pitfall 1).
   */
  deposit: "0xd0e30db0" as Hex,
  /**
   * rETH.burn(uint256) — single-arg unstake. NOT payable; rETH consumed by burn.
   * COLLISION: generic ERC20Burnable.burn(uint256) (Pitfall 2).
   */
  burn: "0x42966c68" as Hex,
} as const;

// ---------------------------------------------------------------------------
// Encoder functions
// ---------------------------------------------------------------------------

/**
 * Encode `RocketDepositPool.deposit()` calldata. Returns the 4-byte selector-
 * only calldata `"0xd0e30db0"` (10 chars). The caller MUST set
 * `tx.valueWei = amountWei` — deposit is PAYABLE; the ETH amount flows in
 * msg.value, NOT calldata.
 *
 * NOTE — Pitfall 1: selector `0xd0e30db0` COLLIDES with WETH9.deposit(). The
 * payloadFingerprint preimage includes `tx.to`, so the fingerprint is distinct
 * between Rocket Pool and WETH9. Preview-send must route on (tx.to, selector)
 * to render the correct DECODED ARGS arm + emit the Rocket Pool LEDGER NOTICE
 * only for the RocketDepositPool target.
 *
 * Fixture AA-RP anchor: see test/signing-fingerprint.test.ts.
 */
export function encodeRocketPoolDeposit(): Hex {
  return encodeFunctionData({
    abi: ROCKET_DEPOSIT_POOL_ABI,
    functionName: "deposit",
    args: [],
  });
}

/**
 * Encode `rETH.burn(rethAmount)` calldata. Returns 36-byte calldata
 * (4-byte selector + 32-byte amount; 74 chars total). The caller MUST set
 * `tx.valueWei = 0n` — burn is NOT payable; rETH is consumed via burn at
 * the contract, ETH is returned to msg.sender as a side effect.
 *
 * NOTE — Pitfall 2: selector `0x42966c68` is the generic OpenZeppelin
 * ERC20Burnable selector. Other tokens with the OZ Burnable mixin expose the
 * same selector. Preview-send routes on (tx.to === rETH-address, selector)
 * for the Rocket Pool arm.
 *
 * Fixture AB-RP anchor: see test/signing-fingerprint.test.ts.
 */
export function encodeRocketPoolBurn(rethAmount: bigint): Hex {
  return encodeFunctionData({
    abi: RETH_ABI,
    functionName: "burn",
    args: [rethAmount],
  });
}

// Convenience re-export so consumers don't need a second import from
// src/config/contracts.ts. Mirrors src/protocols/eigenlayer.ts pattern.
export type { Address };

// ---------------------------------------------------------------------------
// ESM spy-affordance indirection (CLAUDE.md § Conventions)
// ---------------------------------------------------------------------------

/**
 * Mutable indirection object for ESM spy-affordance. Production callers that
 * route through this object can be intercepted by
 * `vi.spyOn(_rocketPoolProtocol, "encodeRocketPoolDeposit")` in tests —
 * named-export bindings are immutable in ESM; a direct `vi.spyOn` on the
 * export is a no-op for module-internal calls.
 *
 * Mirror of `_eigenLayerProtocol` in src/protocols/eigenlayer.ts and
 * `_lidoProtocol` in src/protocols/lido.ts.
 */
export const _rocketPoolProtocol = {
  encodeRocketPoolDeposit,
  encodeRocketPoolBurn,
};
