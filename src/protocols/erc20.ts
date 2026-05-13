// First occupant of `src/protocols/` — per-protocol ABI encode + decode + selector
// table for ERC-20 lifecycle operations on Ethereum mainnet.
//
// Phase 6 — Plan 06-02. Consumed by:
//   - src/tools/prepare_token_send.ts   (encodeErc20Transfer)
//   - src/tools/prepare_token_approve.ts   (Plan 06-03 — encodeErc20Approve)
//   - src/tools/prepare_revoke_approval.ts (Plan 06-03 — encodeErc20Approve(spender, 0n))
//   - src/tools/prepare_weth_unwrap.ts     (Plan 06-04 — own encoder, reuses MAX_UINT256 detection only)
//   - src/tools/preview_send.ts            (decodeErc20Call — selector-routed)
//
// Format-fanout-sentinel rule (CLAUDE.md): ERC-20 selectors live here exactly
// once. preview_send.ts never inlines `data.slice(0, 10)` magic — it reads
// `ERC20_SELECTORS.{transfer,approve}` from this module.
//
// SDK reality (verified against viem@2.48.11):
//   - viem's `erc20Abi` covers transfer/approve/balanceOf/decimals/symbol/name/
//     totalSupply/allowance/transferFrom (functions + events). Does NOT cover
//     `withdraw(uint256)` — that's the WETH9 interface, parsed inline here as
//     a fragment for the combined-ABI decode in preview_send.
//   - `encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args })`
//     returns the 68-byte calldata: 4-byte selector (0xa9059cbb) +
//     32-byte left-padded address + 32-byte amount.
//   - `decodeFunctionData({ abi, data })` returns `{ functionName, args }`.
//     For transfer/approve: args is `readonly [Address, bigint]`.
//     For WETH9 withdraw: args is `readonly [bigint]`.

import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

/**
 * 4-byte function selectors for the ERC-20 lifecycle operations Phase 6 ships.
 *
 * Verified via `viem.toFunctionSelector("transfer(address,uint256)")` →
 * `0xa9059cbb`, and `"approve(address,uint256)"` → `0x095ea7b3`. These are
 * universal (canonical Solidity function signature hashes) and serve as
 * regression anchors in `test/protocols-erc20.test.ts`.
 */
export const ERC20_SELECTORS = {
  transfer: "0xa9059cbb" as Hex,
  approve: "0x095ea7b3" as Hex,
} as const;

/**
 * PREP-29 unlimited-approval sentinel. Equal to `viem.maxUint256` (verified
 * `viem.maxUint256 === (2n ** 256n - 1n)`); we recompute the constant here to
 * keep the protocol module self-contained.
 *
 * Used by `decodeErc20Call` to flag `approve(spender, MAX_UINT256)` as
 * unlimited approval — Plan 06-03's DECODED ARGS block surfaces a
 * `⚠ UNLIMITED APPROVAL` sub-line when this fires.
 */
export const MAX_UINT256: bigint = (1n << 256n) - 1n;

/**
 * WETH9 `withdraw(uint256)` fragment for the combined-ABI decode in
 * preview_send. Plan 06-04's `prepare_weth_unwrap` re-imports the full WETH9
 * ABI from `src/protocols/weth9.ts`; the fragment here covers DECODE only so
 * preview_send.ts has a single combined-ABI decode path.
 */
const WETH9_DECODE_FRAGMENT = parseAbi(["function withdraw(uint256 amount)"]);

/**
 * Combined ABI for preview-time decode. `decodeErc20Call` dispatches over
 * `decoded.functionName`; never trusts the agent's claim about what the data
 * is — the on-chain function signature hash is the source of truth.
 */
export const ERC20_COMBINED_DECODE_ABI = [
  ...erc20Abi,
  ...WETH9_DECODE_FRAGMENT,
] as const;

/**
 * Encode an ERC-20 `transfer(to, amount)` call. Always returns the canonical
 * viem-encoded 68-byte calldata (4-byte selector + 32-byte address +
 * 32-byte amount). NEVER hand-rolled — abitype-driven encoding is the only
 * shape that round-trips through `decodeFunctionData`.
 */
export function encodeErc20Transfer(to: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
}

/**
 * Encode an ERC-20 `approve(spender, amount)` call. Plan 06-03 consumes this
 * for both `prepare_token_approve` (caller-supplied amount or
 * `MAX_UINT256`) and `prepare_revoke_approval` (amount = `0n`).
 */
export function encodeErc20Approve(spender: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });
}

/**
 * Discriminated-union decode result for selector-routed dispatch in
 * preview_send.ts. Mirror of the `FourbyteResult` shape Plan 04-05 uses.
 *
 * The `unknown` branch fires for:
 *   - Native sends (`data === "0x"`)
 *   - Selectors not in the combined ABI (viem's `decodeFunctionData` throws
 *     `AbiFunctionSignatureNotFoundError` — we catch and surface as unknown)
 *   - Malformed calldata (`data.length < 10`)
 */
export type Erc20Decoded =
  | { kind: "transfer"; to: Address; amount: bigint }
  | { kind: "approve"; spender: Address; amount: bigint; isUnlimited: boolean }
  | { kind: "withdraw"; amount: bigint }
  | { kind: "unknown"; selector: Hex };

/**
 * Selector-routed decode for an unsigned transaction's `data` field.
 *
 * Returns:
 *   - `{ kind: "transfer", to, amount }` for `transfer(address,uint256)` calldata
 *   - `{ kind: "approve", spender, amount, isUnlimited }` for `approve(address,uint256)` —
 *     `isUnlimited` is `true` iff `amount === MAX_UINT256`
 *   - `{ kind: "withdraw", amount }` for WETH9 `withdraw(uint256)` calldata
 *   - `{ kind: "unknown", selector }` for everything else (including native
 *     sends with `data === "0x"`)
 *
 * NEVER throws. viem's `decodeFunctionData` throws
 * `AbiFunctionSignatureNotFoundError` on an unknown selector and
 * `AbiDecodingDataSizeTooSmallError` on truncated data; both are caught and
 * surface as the `unknown` branch so the caller (preview_send) can fall back
 * to the 4byte cross-check block (Plan 04-05) without losing data.
 */
export function decodeErc20Call(data: Hex): Erc20Decoded {
  if (data === "0x" || data.length < 10) {
    return { kind: "unknown", selector: data as Hex };
  }
  const selector = data.slice(0, 10).toLowerCase() as Hex;
  try {
    const decoded = decodeFunctionData({
      abi: ERC20_COMBINED_DECODE_ABI,
      data,
    });
    switch (decoded.functionName) {
      case "transfer": {
        const [to, amount] = decoded.args as readonly [Address, bigint];
        return { kind: "transfer", to, amount };
      }
      case "approve": {
        const [spender, amount] = decoded.args as readonly [Address, bigint];
        return {
          kind: "approve",
          spender,
          amount,
          isUnlimited: amount === MAX_UINT256,
        };
      }
      case "withdraw": {
        const [amount] = decoded.args as readonly [bigint];
        return { kind: "withdraw", amount };
      }
      default:
        return { kind: "unknown", selector };
    }
  } catch {
    return { kind: "unknown", selector };
  }
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention
 * (codified in PR #26). preview_send.ts imports `_protocols` and calls
 * `_protocols.decodeErc20Call(data)` so tests can `vi.spyOn(_protocols, …)`
 * to intercept the decode without monkey-patching the production import path.
 */
export const _protocols = { decodeErc20Call };
