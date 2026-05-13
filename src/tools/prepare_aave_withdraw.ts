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

import { getEthereumClient } from "../chains/ethereum.js";
import { getAaveV3PoolAddress } from "../config/contracts.js";
import { isDemoMode } from "../config/env.js";
import { getActivePersona } from "../demo/state.js";
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
import { loadEthereumTokenRegistry } from "../tokens/registry.js";
import { getStatus } from "../wallet/session-manager.js";
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
  "Prepare an unsigned Aave V3 withdraw(asset, amount) call on Ethereum mainnet — withdraws the user's supplied ERC-20 back to their wallet.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to withdraw an ERC-20 they previously supplied to Aave V3 on Ethereum mainnet (e.g. withdraw USDC / DAI / WETH from yield-earning position).",
  "Do NOT use to withdraw to a DIFFERENT recipient — the recipient is hardcoded to the sender in v1.1 (explicit-self-recipient lock; a future dedicated tool can widen this).",
  "Do NOT use for borrow / repay — those are v2.3+ scope.",
  "Do NOT use for non-Aave lending or other chains — v1.x is Ethereum mainnet only.",
  "`asset` is the underlying ERC-20 contract address (e.g. USDC `0xA0b8…`). `amount` is a DECIMAL STRING in human units (e.g. \"100.5\" for 100.5 USDC).",
  "`amount: \"max\"` is NOT accepted — pass a concrete decimal. Aave V3 supports MAX_UINT256 as a protocol-level \"withdraw entire balance\" sentinel, but v1.1's prepare surface requires an explicit amount. Call `get_lending_positions` first to read the supplied balance, then pass it as the amount.",
  "The recipient (`to`) is hardcoded to the sender (explicit-self-recipient). Withdrawals always go to the calling wallet in v1.1.",
  "If preview-time simulation reveals an insufficient-supplied-balance revert, surface the balance from `get_lending_positions` to the user before retrying.",
  "Aave V3 withdraw is clear-signed on Ledger devices (covered by Ledger's ERC-7730 calldata registry); the device displays the asset symbol + amount, no blind-sign required.",
  "Requires a paired Ledger (real mode) or active persona (demo mode).",
  "Returns `{ handle, chainId: 1, from, asset, amount, amountWei, payloadFingerprint }` plus a PREPARE RECEIPT text block surfacing the verbatim args.",
  "Failure modes: WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode is on but no persona set, INVALID_INPUT if asset/amount malformed (including \"max\" and fractional-overflow vs token decimals), INTERNAL_ERROR if RPC fails resolving an off-list asset's decimals.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
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
  },
  required: ["asset", "amount"],
  additionalProperties: false,
};

async function resolveDecimals(
  assetAddress: Address,
): Promise<{ decimals: number; symbol: string }> {
  const registry = loadEthereumTokenRegistry();
  const cached = registry.find((entry) => entry.address === assetAddress);
  if (cached) {
    return { decimals: cached.decimals, symbol: cached.symbol };
  }
  const client = getEthereumClient();
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: assetAddress, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: assetAddress, abi: erc20Abi, functionName: "symbol" }),
  ]);
  return { decimals, symbol };
}

registerTool("prepare_aave_withdraw", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
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

    let fromAddress: Address;
    if (isDemoMode()) {
      const persona = getActivePersona();
      if (persona === null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: demo mode is active but no persona set. Call `set_demo_wallet({ persona: \"whale\" | \"defi-degen\" | \"stable-saver\" | \"staking-maxi\" })` first.",
            },
          ],
          structuredContent: errEnvelope(
            "WRONG_MODE",
            "demo mode active but no persona set; call set_demo_wallet first",
          ),
        };
      }
      fromAddress = persona.address;
    } else {
      const status = await getStatus();
      if (status === null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: no live Ledger session. Call `pair_ledger_live` to pair a Ledger via WalletConnect, then retry.",
            },
          ],
          structuredContent: errEnvelope("WALLET_NOT_PAIRED", "no live Ledger session"),
        };
      }
      fromAddress = status.activeAccount;
    }

    const assetAddr = getAddress(rawAsset) as Address;

    let decimals: number;
    try {
      const meta = await resolveDecimals(assetAddr);
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

    const aavePool: Address = getAaveV3PoolAddress(1);
    // `to` hardcoded to fromAddress — explicit-self-recipient lock (research
    // § Topic 5). Agent CANNOT redirect the withdraw to a different recipient.
    const data: Hex = encodeAaveWithdraw(assetAddr, amountWei, fromAddress);

    const tx = {
      chainId: 1,
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

    const receipt = AAVE_WITHDRAW_PREPARE_RECEIPT_TEMPLATE
      .replace("{ASSET}", rawAsset)
      .replace("{AMOUNT}", rawAmount);

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        chainId: 1,
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
