// MCP tool: prepare_aave_withdraw({ asset, amount })
//
// Phase 7 — Plan 07-03 (PREP-23 withdraw leg). Mechanical clone of
// prepare_aave_supply.ts with bounded deviations:
//
//   (a) Encoder = encodeAaveWithdraw(asset, amountWei, fromAddress). `to`
//       hardcoded to sender (explicit-self-recipient lock per research § Topic
//       5 — a v2.x dedicated tool can widen this).
//   (b) PREPARE RECEIPT uses AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE.
//   (c) NO "max" sentinel in v1.1 (research § Topic 5 lock). Aave V3 supports
//       MAX_UINT256 as "withdraw entire balance" at the protocol level, but
//       v1.1 surface requires a concrete decimal — parseAmountStrict's regex
//       naturally rejects "max" as INVALID_INPUT kind: "format".
//   (d) Everything else (SENDER resolution, decimal resolution, tx.to from
//       SOT, valueWei = 0n, structuredContent shape) is byte-identical to
//       prepare_aave_supply.
//
// Aave V3 withdraw is clear-signed on Ledger devices (research § Topic 6
// verified ERC-7730 registry coverage); the preview_send extension does NOT
// emit a LEDGER NOTICE for withdraw.

import { type Address, type Hex, erc20Abi, getAddress } from "viem";

import { getChainClient } from "../chains/registry.js";
import {
  chainIdFromName,
  getAaveV3PoolAddress,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { encodeAaveWithdraw } from "../protocols/aave-v3.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import { loadTokenRegistry } from "../tokens/registry.js";
import { registerTool } from "./index.js";

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> &
    StructuredError;
}

const DESCRIPTION = [
  "Prepare an unsigned Aave V3 withdraw(asset, amount) call on the specified EVM chain — withdraws the user's supplied ERC-20 back to their wallet.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to withdraw an ERC-20 they previously supplied to Aave V3 on a supported chain (e.g. withdraw USDC / DAI / WETH from yield-earning position).",
  "Do NOT use to withdraw to a DIFFERENT recipient — the recipient is hardcoded to the sender in v1.1 (explicit-self-recipient lock; a future dedicated tool can widen this).",
  "Do NOT use for borrow / repay — those are v2.3+ scope.",
  "Do NOT use for non-Aave lending — Compound / Morpho / etc. are v2.3+ scope.",
  "`chain` is REQUIRED — pass one of ethereum, arbitrum, polygon, base, optimism. The server resolves the per-chain Aave V3 Pool address via the typed SOT.",
  "`asset` is the underlying ERC-20 contract address (e.g. USDC `0xA0b8…`). `amount` is a DECIMAL STRING in human units (e.g. \"100.5\" for 100.5 USDC).",
  "`amount: \"max\"` is NOT accepted — pass a concrete decimal. Aave V3 supports MAX_UINT256 as a protocol-level \"withdraw entire balance\" sentinel, but v1.1's prepare surface requires an explicit amount. Call `get_lending_positions` first to read the supplied balance, then pass it as the amount.",
  "The recipient (`to`) is hardcoded to the sender (explicit-self-recipient). Withdrawals always go to the calling wallet in v1.1.",
  "If preview-time simulation reveals an insufficient-supplied-balance revert, surface the balance from `get_lending_positions` to the user before retrying.",
  "Aave V3 withdraw is clear-signed on Ledger devices (covered by Ledger's ERC-7730 calldata registry on chainId=1); the device displays the asset symbol + amount, no blind-sign required.",
  "Pass `from` when the user wants to act from a non-default approved account (visible in `get_ledger_status.accountsByChain[chainId]`); otherwise omit and the active account is used. The recipient (`to` in the calldata) is hardcoded to the sender — passing `from` redirects both the sender and the recipient to that account. PREPARE RECEIPT surfaces `From:` only when caller-supplied.",
  "Requires a paired Ledger (real mode) or active persona (demo mode).",
  "Returns `{ handle, chain, chainId, from, asset, amount, amountWei, payloadFingerprint }` plus a PREPARE RECEIPT text block surfacing the verbatim args.",
  "Failure modes: WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode is on but no persona set OR if `from` doesn't match the active persona, INVALID_INPUT if chain/asset/amount/from malformed (including \"max\" and fractional-overflow vs token decimals), INVALID_ACCOUNT if `from` is not in the per-chain approved set, INTERNAL_ERROR if RPC fails resolving an off-list asset's decimals.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description:
        "Chain identifier (required). Supported: ethereum, arbitrum, polygon, base, optimism.",
    },
    asset: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "ERC-20 asset address — the token being withdrawn (e.g. USDC `0xA0b8…`). 0x-prefixed 20-byte hex.",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in human units (e.g. \"100.5\"). The literal \"max\" is NOT accepted; pass a concrete decimal. Call `get_lending_positions` to read the supplied balance first.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts in `get_ledger_status.accountsByChain[chainId]`. Omit to use the active account. In demo mode, must match the active persona's address. The withdraw recipient is hardcoded to the sender, so passing `from` redirects both.",
    },
  },
  required: ["chain", "asset", "amount"],
  additionalProperties: false,
};

async function resolveDecimals(
  assetAddress: Address,
  chainId: ChainId,
): Promise<{ decimals: number; symbol: string }> {
  const registry = loadTokenRegistry(chainId);
  const cached = registry.find((entry) => entry.address === assetAddress);
  if (cached) {
    return { decimals: cached.decimals, symbol: cached.symbol };
  }
  const client = getChainClient(chainId);
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: assetAddress, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: assetAddress, abi: erc20Abi, functionName: "symbol" }),
  ]);
  return { decimals, symbol };
}

registerTool("prepare_aave_withdraw", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // Phase 8 — Plan 08-02: chainId from the agent's `chain` enum.
    const chainName = args.chain as ChainName;
    const chainId = chainIdFromName(chainName);

    const rawAsset = typeof args.asset === "string" ? args.asset : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawAsset)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'asset': expected 0x-prefixed 20-byte hex, got "${rawAsset}"`,
          },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'asset': ${rawAsset}`),
      };
    }

    const rawAmount = typeof args.amount === "string" ? args.amount : "";

    // SENDER resolution (Plan 05-02 + Issue #62): delegated to shared
    // resolveFrom helper. See prepare_native_send.ts for the full routing.
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    const assetAddr = getAddress(rawAsset) as Address;

    let decimals: number;
    try {
      const meta = await resolveDecimals(assetAddr, chainId);
      decimals = meta.decimals;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: failed to resolve asset decimals for ${assetAddr}: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `failed to resolve asset decimals for ${assetAddr}`,
          message,
        ),
      };
    }

    // parseAmountStrict's strict regex rejects "max" / "MAX" / "unlimited" /
    // "infinite" as kind: "format" — the v1.1 lock (research § Topic 5).
    let amountWei: bigint;
    try {
      amountWei = parseAmountStrict(rawAmount, decimals);
    } catch (err) {
      const message =
        err instanceof InvalidAmountError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        isError: true,
        content: [
          { type: "text", text: `error: invalid 'amount': ${message}` },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'amount': ${message}`),
      };
    }

    // Phase 8 — Plan 08-02: per-chain Pool address via the typed SOT.
    const aavePool: Address = getAaveV3PoolAddress(chainId);
    // `to` hardcoded to fromAddress — explicit-self-recipient lock (research
    // § Topic 5). Agent CANNOT redirect the withdraw to a different recipient.
    const data: Hex = encodeAaveWithdraw(assetAddr, amountWei, fromAddress);

    const tx = {
      chainId,
      to: aavePool,
      valueWei: 0n,
      data,
    };

    const payloadFingerprint = computePayloadFingerprint(tx);

    const handle = createHandle({
      args: {
        to: "",
        valueWei: "0",
        tokenAddress: rawAsset,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    // Phase 8 — Plan 08-02: `{CHAIN}` slot widening.
    // Issue #62: append `from:` line ONLY when caller-supplied.
    const baseReceipt = AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
      .replace("{ASSET}", rawAsset)
      .replace("{AMOUNT}", rawAmount);
    const receipt = fromCallerSupplied
      ? `${baseReceipt}\n  from:         ${rawFrom}`
      : baseReceipt;

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        chain: chainName,
        chainId,
        from: fromAddress,
        asset: rawAsset,
        amount: rawAmount,
        amountWei: amountWei.toString(),
        payloadFingerprint,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_aave_withdraw failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_aave_withdraw failed", message),
    };
  }
});
