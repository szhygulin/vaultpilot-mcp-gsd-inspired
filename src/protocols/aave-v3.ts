// Third occupant of `src/protocols/` — Aave V3 Pool primitives for Phase 7
// (Plan 07-03). Mirror of `src/protocols/weth9.ts` (Plan 06-04) shape verbatim:
// single-file ABI fragment + selector table + encoder-per-supported-function +
// decode discriminated union + `_aaveProtocols` ESM spy indirection.
//
// SDK reality (verified against viem@2.48.11 + research § Topic 1):
//   - `parseAbi(...)` is the canonical pattern for "I need these two methods,
//     not the whole Pool interface."
//   - Selectors verified at execute time via `viem.toFunctionSelector` in
//     `test/protocols-aave-v3.test.ts`:
//       supply(address,uint256,address,uint16)  → 0x617ba037
//       withdraw(address,uint256,address)       → 0x69328dec
//
// Consumed by:
//   - src/tools/prepare_aave_supply.ts    (encodeAaveSupply)
//   - src/tools/prepare_aave_withdraw.ts  (encodeAaveWithdraw)
//   - src/tools/preview_send.ts           (decodeAaveV3Call via _aaveProtocols indirection)
//   - src/signing/blocks.ts               (DECODED ARGS templates for supply + withdraw)
//
// Format-fanout-sentinel: the ONLY place in `src/` that imports an Aave V3 ABI
// fragment for encoding or decoding. Both `prepare_aave_*` and `preview_send`
// consume through the exported functions; NEVER inline parseAbi or selectors.
//
// borrow / repay / setUserUseReserveAsCollateral selectors NOT shipped in
// v1.1 (research § Topic 5 — v2.3 scope). The ABI fragment may grow when v2.3
// lands; the decoder's discriminated union widens at that point.

import {
  decodeFunctionData,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

import { MAX_UINT256 } from "./erc20.js";

/**
 * Aave V3 Pool ABI fragment. Two methods used in Phase 7 / v1.1:
 *   - `supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)`
 *   - `withdraw(address asset, uint256 amount, address to) returns (uint256)`
 */
export const AAVE_V3_POOL_ABI = parseAbi([
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
]);

/**
 * 4-byte function selectors. Empirically verified via
 * `viem.toFunctionSelector` in research § Topic 1 + at execute-time in
 * `test/protocols-aave-v3.test.ts`. Drift in either breaks ALL Aave
 * prepare/preview/send flows; the byte-identity assertions in the test fail
 * at PR review.
 */
export const AAVE_V3_SELECTORS = {
  supply: "0x617ba037" as Hex,
  withdraw: "0x69328dec" as Hex,
} as const;

/**
 * Encode `Pool.supply(asset, amount, onBehalfOf, referralCode)` calldata. The
 * caller MUST set `tx.to` to the canonical Aave V3 Pool address via Plan
 * 07-01's `getAaveV3PoolAddress(chainId)` — NEVER inline a literal here.
 *
 * `referralCode = 0` is the documented default (Aave V3 deprecates referrals;
 * 0 is the canonical no-op value). The optional default keeps the call sites
 * (prepare_aave_supply.ts) terse.
 */
export function encodeAaveSupply(
  asset: Address,
  amount: bigint,
  onBehalfOf: Address,
  referralCode = 0,
): Hex {
  return encodeFunctionData({
    abi: AAVE_V3_POOL_ABI,
    functionName: "supply",
    args: [asset, amount, onBehalfOf, referralCode],
  });
}

/**
 * Encode `Pool.withdraw(asset, amount, to)` calldata. The caller MUST set
 * `tx.to` to the canonical Aave V3 Pool address.
 *
 * `to` is the recipient of the withdrawn underlying asset. In Phase 7 / v1.1
 * the prepare tool hardcodes `to = sender` (explicit-self-recipient lock per
 * research § Topic 5) — a v2.x dedicated tool can widen this.
 */
export function encodeAaveWithdraw(asset: Address, amount: bigint, to: Address): Hex {
  return encodeFunctionData({
    abi: AAVE_V3_POOL_ABI,
    functionName: "withdraw",
    args: [asset, amount, to],
  });
}

/**
 * Discriminated-union decode result for selector-routed dispatch in
 * preview_send.ts. Mirror of `Erc20Decoded` in `src/protocols/erc20.ts`.
 *
 * The `unknown` branch is the caller's signal to fall through to the next
 * decoder (preview_send tries ERC-20 first, then Aave).
 *
 * `isMax` on withdraw is true when amount equals MAX_UINT256 — Aave V3's
 * protocol-level "withdraw entire balance" sentinel. v1.1 input is concrete
 * decimal (research § Topic 5 lock — withdraw does NOT accept "max" from the
 * agent), but the decoder still detects the MAX_UINT256 case for forward-
 * compat (a future tool that supports the sentinel) AND for any third-party
 * calldata routed through preview_send.
 */
export type AaveV3Decoded =
  | {
      kind: "aave-supply";
      asset: Address;
      amount: bigint;
      onBehalfOf: Address;
      referralCode: number;
    }
  | {
      kind: "aave-withdraw";
      asset: Address;
      amount: bigint;
      to: Address;
      isMax: boolean;
    }
  | { kind: "unknown"; selector: Hex };

/**
 * Selector-routed decoder. Returns a discriminated union; the `unknown` arm
 * is the fall-through caller's signal to try the next decoder (preview_send
 * chains ERC-20 first, then Aave).
 *
 * NEVER throws. Malformed calldata for a known selector falls through to
 * `unknown` (try/catch around `decodeFunctionData`).
 */
export function decodeAaveV3Call(data: Hex): AaveV3Decoded {
  if (data === "0x" || data.length < 10) {
    return { kind: "unknown", selector: data as Hex };
  }
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  try {
    if (selector === AAVE_V3_SELECTORS.supply) {
      const decoded = decodeFunctionData({ abi: AAVE_V3_POOL_ABI, data });
      if (decoded.functionName === "supply") {
        const [asset, amount, onBehalfOf, referralCode] = decoded.args as readonly [
          Address,
          bigint,
          Address,
          number,
        ];
        return {
          kind: "aave-supply",
          asset,
          amount,
          onBehalfOf,
          referralCode: Number(referralCode),
        };
      }
    }
    if (selector === AAVE_V3_SELECTORS.withdraw) {
      const decoded = decodeFunctionData({ abi: AAVE_V3_POOL_ABI, data });
      if (decoded.functionName === "withdraw") {
        const [asset, amount, to] = decoded.args as readonly [Address, bigint, Address];
        return {
          kind: "aave-withdraw",
          asset,
          amount,
          to,
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
 * `preview_send.ts` imports `_aaveProtocols` and calls
 * `_aaveProtocols.decodeAaveV3Call(data)` so tests can
 * `vi.spyOn(_aaveProtocols, "decodeAaveV3Call")` without monkey-patching the
 * production import path. Same shape as `_protocols` in `erc20.ts`.
 */
export const _aaveProtocols = { decodeAaveV3Call };
