// MCP tool: prepare_aave_supply({ asset, amount })
//
// Phase 7 — Plan 07-03 (PREP-23 supply leg). First Aave V3 prepare tool; the
// fourth contract-call shape over the Phase 4 trust pipeline. Mechanical clone
// of prepare_weth_unwrap.ts (Plan 06-04) with bounded deviations:
//
//   (a) input schema is `{ asset, amount }` — asset is the underlying ERC-20
//       (USDC, DAI, etc.); amount is the human-units decimal string. `to` /
//       `onBehalfOf` are NOT agent inputs (server hardcodes onBehalfOf to
//       sender per research § Topic 5 reasonable-call lock; relayer pattern
//       is v2.x scope).
//   (b) Decimal resolution: registry-cache-first via loadEthereumTokenRegistry
//       (mirror of prepare_token_send.ts:99-114::resolveDecimals); live RPC
//       fallback for long-tail Aave reserves.
//   (c) Encoder = encodeAaveSupply(asset, amountWei, fromAddress, 0).
//       `referralCode = 0` (Aave V3 deprecates referrals; documented no-op).
//   (d) tx.to = getAaveV3PoolAddress(1) — Plan 07-01 typed-slot SOT. Format-
//       fanout-sentinel: NEVER inlined here. T-AAVE-POOL-ADDR-INLINE-1
//       mitigation; grep-zero asserted in success criteria.
//   (e) tx.valueWei = 0n. The supply call doesn't transfer native ETH.
//   (f) PREPARE RECEIPT uses AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE.
//
// `amount: "max"` is NOT accepted (no max-balance sentinel here; parseAmountStrict
// rejects via the strict regex with kind: "format").
//
// preview_send extension (Plan 07-03) does NOT emit a LEDGER NOTICE block for
// Aave supply — research § Topic 6 verified clear-sign coverage in the
// LedgerHQ ERC-7730 registry. Devices display human-readable args; the user
// approves on-device. The agent-side LEDGER BLIND-SIGN HASH block stays the
// cryptographic anchor in the (rare) case the device falls back to blind-sign.
//
// Approval prerequisite: Aave V3 Pool needs the user to have an approved
// allowance on `asset`. The agent prepares an approval FIRST via
// prepare_token_approve; if the user's allowance is insufficient at preview
// time, the SIMULATION block (Plan 06-02 DF-1) surfaces the revert reason.
// This tool does NOT chain prepare_token_approve internally — that's the
// agent's routing decision.

import { type Address, type Hex, erc20Abi, getAddress } from "viem";

import { getEthereumClient } from "../chains/ethereum.js";
import { getAaveV3PoolAddress } from "../config/contracts.js";
import { isDemoMode } from "../config/env.js";
import { getActivePersona } from "../demo/state.js";
import { encodeAaveSupply } from "../protocols/aave-v3.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
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
  "Prepare an unsigned Aave V3 supply(asset, amount) call on Ethereum mainnet — deposits the user's ERC-20 into Aave to earn interest and earn collateral capacity.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to deposit an ERC-20 into Aave V3 on Ethereum mainnet (e.g. supply USDC / DAI / WETH for yield and as borrow collateral).",
  "Do NOT use for borrow / repay — those are v2.3+ scope (no prepare_aave_borrow yet).",
  "Do NOT use for non-Aave lending — Compound / Morpho / etc. are v2.3+ scope.",
  "Do NOT use for other chains — v1.x is Ethereum mainnet only.",
  "`asset` is the underlying ERC-20 contract address (e.g. USDC `0xA0b8…`). `amount` is a DECIMAL STRING in human units (e.g. \"100.5\" for 100.5 USDC). The server resolves the asset's decimals via the registry (top-50 tokens cached) or live RPC `decimals()` for long-tail reserves.",
  "`onBehalfOf` is hardcoded to the sender (deposit-for-self only in v1.1; the v2.x relayer-supply pattern would widen this).",
  "If preview-time simulation reveals an allowance shortfall (`SIMULATION status: revert` with an `ERC20: insufficient allowance` reason), call `prepare_token_approve({ tokenAddress: asset, spender: <aave-pool-address from get_vaultpilot_config_status>, amount: 'max' })` first, sign the approve on device, then retry this prepare.",
  "Aave V3 supply is clear-signed on Ledger devices (covered by Ledger's ERC-7730 calldata registry); the device displays the asset symbol + amount, no blind-sign required.",
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
        "ERC-20 asset address — the token being supplied (e.g. USDC `0xA0b8…`). 0x-prefixed 20-byte hex.",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in human units (e.g. \"100.5\"). The server resolves the asset's decimals via the registry / live RPC. The literal \"max\" is NOT accepted — pass a concrete decimal.",
    },
  },
  required: ["asset", "amount"],
  additionalProperties: false,
};

/**
 * Resolve asset decimals (registry-cache-first; live RPC on miss). Returns
 * decimals + symbol for the receipt + DECODED ARGS surface. Throws on RPC
 * failure for off-list assets; the handler converts to the structured envelope.
 */
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

registerTool("prepare_aave_supply", DESCRIPTION, INPUT_SCHEMA, async (args) => {
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

    // SENDER resolution (Plan 05-02 / Q-CONTRADICTION-PREP Option B):
    // demo branch SKIPS getStatus() so the spy observes zero calls in the
    // demo arm. T-DEMO-1 + T-NULL-PERSONA-1 mitigation parity with
    // prepare_weth_unwrap / prepare_token_send.
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

    // Checksum the asset address (server-internal correctness). The receipt
    // surfaces the RAW agent string (T-PREP-RCPT-1 — no normalization).
    const assetAddr = getAddress(rawAsset) as Address;

    // Resolve decimals. Registry-cache-first; live RPC on miss.
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

    // Parse amount strictly. T-PARSE-AMOUNT-1 + T-PARSE-EMPTY-1 mitigations
    // — refuses empty/format/fractional-overflow. "max" rejects via the
    // strict regex (kind: "format") — no max-balance sentinel here.
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

    // tx.to comes from the SOT — getAaveV3PoolAddress(1) — NEVER inlined.
    // T-AAVE-POOL-ADDR-INLINE-1 mitigation; grep-zero asserted in success
    // criteria.
    const aavePool: Address = getAaveV3PoolAddress(1);
    const data: Hex = encodeAaveSupply(assetAddr, amountWei, fromAddress, 0);

    const tx = {
      chainId: 1,
      to: aavePool,
      valueWei: 0n,
      data,
    };

    // PREP-03 + T-BIND-1: compute the binding fingerprint at prepare time.
    const payloadFingerprint = computePayloadFingerprint(tx);

    // PREP-02: args carries the RAW agent strings. tokenAddress field
    // re-purposed for the asset (the existing Phase 6 widening); to/spender
    // unused.
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

    const receipt = AAVE_SUPPLY_PREPARE_RECEIPT_TEMPLATE
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
        { type: "text", text: `error: prepare_aave_supply failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_aave_supply failed", message),
    };
  }
});
