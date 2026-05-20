// Fourth occupant of `src/protocols/` — Compound V3 Comet primitives for
// Phase 28 (Plans 28-01 / 28-02 / 28-03 / 28-04). Structural mirror of
// `src/protocols/aave-v3.ts`: single-file ABI fragment + selector table +
// encoder-per-supported-function + decode discriminated union +
// `_compoundProtocols` ESM spy indirection.
//
// SDK reality (verified against viem@2.48.11 + research § Topic 2):
//   - `@compound-finance/compound-js` REJECTED — ethers-v5-locked,
//     17-month stale, returns broadcast tx envelopes (not unsigned-tx-author
//     friendly).
//   - `parseAbi(...)` is the canonical pattern for "I need these 8 methods,
//     not the whole CometMainInterface."
//   - Selectors verified at execute time via `viem.toFunctionSelector` in
//     `test/protocols-compound-v3.test.ts`:
//       supply(address,uint256)   → 0xf2b9fdb8
//       withdraw(address,uint256) → 0xf3fef3a3
//
// Compound V3 vs Aave V3 calldata-shape deltas (patterns § 2):
//   - Compound `supply` is 2-arg (asset, amount). Aave V3 `supply` is 4-arg
//     (asset, amount, onBehalfOf, referralCode). Compound implicitly supplies
//     to `msg.sender`; no on-behalf-of recipient.
//   - Compound `withdraw` is 2-arg (asset, amount). Aave V3 `withdraw` is
//     3-arg (asset, amount, to). Compound implicitly transfers to
//     `msg.sender`; no `to` arg.
//   - The 2 selectors above cover 4 agent intents — `supply` covers
//     supply-collateral AND repay-debt; `withdraw` covers withdraw-collateral
//     AND borrow. The intent-vs-reality discrimination lives in the
//     prepare-tool gates (Plans 28-02 / 28-03) + preview-time re-derivation
//     (Plan 28-04). Phase 28 Plan 28-01 ships ONLY the 2 calldata shapes.
//
// Consumed by:
//   - src/tools/prepare_compound_supply.ts    (Plan 28-02 — encodeCompoundSupply)
//   - src/tools/prepare_compound_withdraw.ts  (Plan 28-02 — encodeCompoundWithdraw)
//   - src/tools/prepare_compound_borrow.ts    (Plan 28-03 — encodeCompoundWithdraw, borrow intent)
//   - src/tools/prepare_compound_repay.ts     (Plan 28-03 — encodeCompoundSupply, repay intent + MAX_UINT256)
//   - src/tools/preview_send.ts               (Plan 28-04 — decodeCompoundV3Call via _compoundProtocols indirection)
//
// Format-fanout-sentinel: the ONLY place in `src/` that imports a Compound V3
// ABI fragment for encoding or decoding. Both `prepare_compound_*` and
// `preview_send` consume through the exported functions; NEVER inline
// parseAbi or selectors. Canonical Solidity interface:
// [CometMainInterface.sol](https://github.com/compound-finance/comet/blob/main/contracts/CometMainInterface.sol).
//
// ABI fragment scope: Plan 28-01 locks to the 8 functions Phase 28 uses
// across all 4 plans (supply / withdraw / baseToken / balanceOf /
// borrowBalanceOf / collateralBalanceOf / isBorrowCollateralized /
// isLiquidatable). Rate / market-info functions (getSupplyRate / getBorrowRate
// / getUtilization / getAssetInfoByAddress / getPrice / totalsCollateral /
// totalSupply / totalBorrow / numAssets) are added to the parseAbi in Plan
// 28-04 (`get_compound_market_info` reader). Keeping the Plan 28-01 ABI tight
// minimizes the Wave 1 surface.

import {
  decodeFunctionData,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

import { MAX_UINT256 } from "./erc20.js";

/**
 * Compound V3 Comet ABI fragment. Eight functions used across Phase 28:
 *   - `supply(address asset, uint256 amount)` — selector 0xf2b9fdb8 (Plans 28-02 / 28-03)
 *   - `withdraw(address asset, uint256 amount)` — selector 0xf3fef3a3 (Plans 28-02 / 28-03)
 *   - `baseToken() view returns (address)` — intent-gate prologue (Plan 28-02)
 *   - `balanceOf(address account) view returns (uint256)` — supply balance for intent gating (Plan 28-02)
 *   - `borrowBalanceOf(address account) view returns (uint256)` — borrow position for intent gating (Plan 28-02 / 28-03)
 *   - `collateralBalanceOf(address account, address asset) view returns (uint128)` — collateral position (Plan 28-04 read tool)
 *   - `isBorrowCollateralized(address account) view returns (bool)` — health gate (Plan 28-03 borrow)
 *   - `isLiquidatable(address account) view returns (bool)` — health gate (Plan 28-04 read tool)
 */
export const COMPOUND_V3_COMET_ABI = parseAbi([
  "function supply(address asset, uint256 amount)",
  "function withdraw(address asset, uint256 amount)",
  "function baseToken() view returns (address)",
  "function balanceOf(address account) view returns (uint256)",
  "function borrowBalanceOf(address account) view returns (uint256)",
  "function collateralBalanceOf(address account, address asset) view returns (uint128)",
  "function isBorrowCollateralized(address account) view returns (bool)",
  "function isLiquidatable(address account) view returns (bool)",
]);

/**
 * 4-byte function selectors for the 2 calldata shapes Phase 28 emits.
 * Empirically verified via `viem.toFunctionSelector` in research § Topic 1
 * AND at execute-time in `test/protocols-compound-v3.test.ts` (A2 LOCK).
 * Drift in either fails at PR-review time — these are the bytes the Ledger
 * device will display under "Operation type" / blind-sign hash.
 */
export const COMPOUND_V3_SELECTORS = {
  supply: "0xf2b9fdb8" as Hex,
  withdraw: "0xf3fef3a3" as Hex,
} as const;

/**
 * Encode `Comet.supply(asset, amount)` calldata. The caller MUST set `tx.to`
 * to the canonical Compound V3 Comet address via `getCompoundCometAddress(
 * chainId, base)` — NEVER inline a literal here.
 *
 * Compound V3's `supply` covers BOTH supply-collateral AND repay-debt agent
 * intents. The discriminator is "is `asset` equal to the Comet's
 * `baseToken()` AND does the wallet have a borrow position?":
 *   - asset === baseToken && borrowBalance > 0 → repay
 *   - else                                     → supply collateral
 * That logic lives in the prepare-tool gates (Plans 28-02 / 28-03); the
 * encoder here is intent-agnostic.
 *
 * MAX_UINT256 sentinel: Compound V3 honors `supply(base, MAX_UINT256)` as
 * "close the entire borrow position" — the protocol caps the actual transfer
 * at the current debt. Mirrors Phase 6 `prepare_token_approve({ amount: "max" })`
 * precedent. The decoder's `isMax: boolean` arm surfaces this for the
 * preview_send DECODED ARGS template.
 */
export function encodeCompoundSupply(asset: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: COMPOUND_V3_COMET_ABI,
    functionName: "supply",
    args: [asset, amount],
  });
}

/**
 * Encode `Comet.withdraw(asset, amount)` calldata. The caller MUST set `tx.to`
 * to the canonical Compound V3 Comet address.
 *
 * Compound V3's `withdraw` covers BOTH withdraw-collateral AND borrow agent
 * intents. The discriminator is the same shape as supply/repay (asset ?=
 * baseToken) — when `asset === baseToken` AND the wallet has zero borrow
 * AND attempts to withdraw MORE than `balanceOf(wallet)`, the call IS a
 * borrow. That logic lives in the prepare-tool gates (Plans 28-02 / 28-03);
 * the encoder is intent-agnostic.
 *
 * MAX_UINT256 sentinel: Compound V3 honors `withdraw(base, MAX_UINT256)` as
 * "withdraw the entire supply balance". The decoder's `isMax: boolean` arm
 * surfaces this for preview_send.
 */
export function encodeCompoundWithdraw(asset: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: COMPOUND_V3_COMET_ABI,
    functionName: "withdraw",
    args: [asset, amount],
  });
}

/**
 * Discriminated-union decode result for selector-routed dispatch in
 * preview_send.ts. 3-arm (NOT 4 — selector dispatch is binary at the
 * calldata layer; the 4 intents are an agent-layer concern resolved by the
 * prepare-tool gates + the Plan 28-04 intent-vs-reality re-derivation).
 *
 * The `unknown` arm is the caller's signal to fall through to the next
 * decoder (preview_send tries ERC-20 first, then Aave, then Compound).
 *
 * `isMax` on both arms is `true` iff `amount === MAX_UINT256` — Compound's
 * protocol-level "full position close" sentinel (mirrors Aave V3 `withdraw`
 * isMax discipline). Plan 28-04 preview_send surfaces this as
 * `⚠ FULL POSITION` annotation in the DECODED ARGS template.
 */
export type CompoundV3Decoded =
  | { kind: "compound-supply"; asset: Address; amount: bigint; isMax: boolean }
  | { kind: "compound-withdraw"; asset: Address; amount: bigint; isMax: boolean }
  | { kind: "unknown"; selector: Hex };

/**
 * Selector-routed decoder for Compound V3 Comet calldata. Returns a
 * discriminated union; the `unknown` arm is the fall-through caller's signal
 * to try the next decoder.
 *
 * NEVER throws. Malformed calldata for a known selector falls through to
 * `unknown` (try/catch around `decodeFunctionData`). Empty (`"0x"`) or too-
 * short data short-circuits to `unknown` without touching viem.
 */
export function decodeCompoundV3Call(data: Hex): CompoundV3Decoded {
  if (data === "0x" || data.length < 10) {
    return { kind: "unknown", selector: data as Hex };
  }
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  try {
    if (selector === COMPOUND_V3_SELECTORS.supply) {
      const decoded = decodeFunctionData({ abi: COMPOUND_V3_COMET_ABI, data });
      if (decoded.functionName === "supply") {
        const [asset, amount] = decoded.args as readonly [Address, bigint];
        return {
          kind: "compound-supply",
          asset,
          amount,
          isMax: amount === MAX_UINT256,
        };
      }
    }
    if (selector === COMPOUND_V3_SELECTORS.withdraw) {
      const decoded = decodeFunctionData({ abi: COMPOUND_V3_COMET_ABI, data });
      if (decoded.functionName === "withdraw") {
        const [asset, amount] = decoded.args as readonly [Address, bigint];
        return {
          kind: "compound-withdraw",
          asset,
          amount,
          isMax: amount === MAX_UINT256,
        };
      }
    }
  } catch {
    // Malformed calldata for a known selector — fall through to unknown.
  }
  return { kind: "unknown", selector };
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * `preview_send.ts` (Plan 28-04) imports `_compoundProtocols` and calls
 * `_compoundProtocols.decodeCompoundV3Call(data)` so tests can
 * `vi.spyOn(_compoundProtocols, "decodeCompoundV3Call")` without monkey-
 * patching the production import path. Same shape as `_aaveProtocols` in
 * `aave-v3.ts` and `_protocols` in `erc20.ts`.
 */
export const _compoundProtocols = { decodeCompoundV3Call };
