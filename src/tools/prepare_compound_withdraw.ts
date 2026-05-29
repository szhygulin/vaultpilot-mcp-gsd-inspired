// MCP tool: prepare_compound_withdraw({ chain, comet, asset, amount, from? })
//
// Phase 28 — Plan 28-02 (CMP-04 withdraw leg). Mechanical clone of
// `prepare_compound_supply.ts` with bounded deviations:
//
//   (a) Encoder = `encodeCompoundWithdraw(asset, amountWei)` from Plan 28-01.
//   (b) Intent-gate prologue uses `selector: "withdraw"`. Discriminates
//       withdraw-collateral vs borrow. If real intent === `"borrow"`
//       (asset === baseToken AND balanceOf === 0), REFUSE with INVALID_INPUT
//       + `structuredContent.hintTool: "prepare_compound_borrow"`.
//   (c) `amount: "max"` IS accepted — Compound's `withdraw(base, MAX_UINT256)`
//       is the protocol-level "withdraw entire supply" sentinel (research
//       § Topic 4). Strict-equality `args.amount === "max"` ONLY (lowercase;
//       T-MAX-SPELLING-1 from Plan 06-03 prepare_token_approve discipline).
//       `"MAX"` / `"unlimited"` / `"infinite"` flow to parseAmountStrict and
//       reject as INVALID_INPUT kind `"format"`.
//   (d) PREPARE RECEIPT uses `COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE` —
//       4-slot (chain + comet + asset + amount). The `{AMOUNT}` slot
//       renders the VERBATIM agent string (`"max"` shows as `amount: max`).
//
// Compound's `withdraw` contract internally clamps the transfer to the
// caller's actual base supply when MAX_UINT256 is passed — the protocol
// guarantees no overflow / overdraw. The DECODED ARGS block at preview
// time (Plan 28-04) surfaces `⚠ FULL POSITION WITHDRAW (MAX_UINT256 sentinel)`
// when the encoded amount equals MAX_UINT256.

import { type Address, type Hex, erc20Abi, getAddress } from "viem";

import { _compoundChains } from "../chains/compound-v3.js";
import { getChainClient } from "../chains/registry.js";
import {
  chainIdFromName,
  getAllCompoundCometsForChain,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { encodeCompoundWithdraw } from "../protocols/compound-v3.js";
import { MAX_UINT256 } from "../protocols/erc20.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
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
): Record<string, unknown> & StructuredError {
  return makeStructuredError(code, message, cause) as Record<string, unknown> &
    StructuredError;
}

const DESCRIPTION = [
  "Prepare an unsigned Compound V3 withdraw(asset, amount) call on the specified chain — withdraws the agent-supplied asset from a specified Compound V3 Comet back to the user's wallet. Supported chains: ethereum, arbitrum, polygon, base, optimism.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to withdraw an asset they previously supplied to a Compound V3 Comet. Supports BOTH base-asset withdraw (unwinding a lender position — must have a supplied base balance) AND collateral withdraw (releasing a configured collateral asset like wstETH / WBTC).",
  "REFUSES with INVALID_INPUT + structuredContent.hintTool: \"prepare_compound_borrow\" when the asset is the Comet's base asset AND the wallet has NO supplied base position. Compound V3's `withdraw` against zero base supply IS the borrow operation (the protocol mints debt to satisfy the transfer, collateralized by other supplied assets). Call prepare_compound_borrow with the same args.",
  "Do NOT use for borrow / supply / repay — call prepare_compound_borrow / prepare_compound_supply / prepare_compound_repay respectively.",
  "Do NOT use for non-Compound lending — Aave V3 is `prepare_aave_withdraw`; Morpho / Spark / etc. are v2.4+ scope.",
  "`chain` is REQUIRED — one of: ethereum, arbitrum, polygon, base, optimism. No default-pick.",
  "`comet` is REQUIRED — the explicit Comet contract address for the target chain. The server validates against the per-chain canonical Comet allowlist BEFORE any RPC read.",
  "`asset` is the underlying ERC-20 contract address. `amount` is a DECIMAL STRING in human units OR the literal lowercase `\"max\"` to withdraw the entire supplied base position (MAX_UINT256 sentinel — Compound's protocol clamps the actual transfer to the supplied balance). Strict-equality on `\"max\"` ONLY: `\"MAX\"` / `\"unlimited\"` / `\"infinite\"` are rejected as INVALID_INPUT kind `\"format\"` (T-MAX-SPELLING-1 discipline).",
  "Compound V3 calldata is NOT covered by the Ledger ERC-7730 clear-sign registry — the device will BLIND-SIGN (display a raw hash). preview_send emits a LEDGER NOTICE block at preview time explaining the blind-sign expectation; the cryptographic anchor is the on-device hash match against the PREDICTED hash this tool produces.",
  "Pass `from` when the user wants to act from a non-default approved account (visible in `get_ledger_status.accountsByChain[chainId]`); otherwise omit and the active account is used. The withdraw recipient is implicitly msg.sender — passing `from` redirects both the sender and the recipient to that account.",
  "Requires a paired Ledger (real mode) or active persona (demo mode).",
  "Returns `{ handle, chain, chainId, comet, from, asset, amount, amountWei, intent, payloadFingerprint }` plus a PREPARE RECEIPT text block surfacing the verbatim args.",
  "Failure modes: WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode is on but no persona set OR `from` doesn't match the active persona, INVALID_INPUT if chain/comet/asset/amount/from malformed (including non-canonical Comet, intent-mismatch borrow routing with hintTool, T-MAX-SPELLING-1 strict-equality, fractional-overflow vs token decimals), INVALID_ACCOUNT if `from` is not in the per-chain approved set, INTERNAL_ERROR if RPC fails resolving asset decimals OR the intent-gate baseToken / balanceOf reads.",
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
    comet: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "The Compound V3 Comet contract address (required). MUST be a canonical Comet for the specified chain. Refused (INVALID_INPUT) if not in the per-chain canonical allowlist.",
    },
    asset: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "ERC-20 asset address — the token being withdrawn. 0x-prefixed 20-byte hex.",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in human units (e.g. \"100.5\") OR the literal lowercase \"max\" to withdraw the entire base-asset balance (MAX_UINT256 sentinel; protocol clamps to actual balance). T-MAX-SPELLING-1 — strict-equality on \"max\" only.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts in `get_ledger_status.accountsByChain[chainId]`. Omit to use the active account.",
    },
  },
  required: ["chain", "comet", "asset", "amount"],
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

registerTool("prepare_compound_withdraw", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const chainName = args.chain as ChainName;
    const chainId = chainIdFromName(chainName);

    const rawComet = typeof args.comet === "string" ? args.comet : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawComet)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'comet': expected 0x-prefixed 20-byte hex, got "${rawComet}"`,
          },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'comet': ${rawComet}`),
      };
    }

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

    // CHEAP GATE — Comet allowlist validation BEFORE any RPC read.
    const cometAddr = getAddress(rawComet);
    const canonicalComets = getAllCompoundCometsForChain(chainId);
    if (!canonicalComets.includes(cometAddr)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `error: 'comet' address ${rawComet} is not in the canonical Compound V3 mainnet allowlist ` +
              "(6 Comets: cUSDCv3 / cUSDTv3 / cWETHv3 / cUSDSv3 / cwstETHv3 / cWBTCv3). " +
              "Pass one of the canonical Comet addresses from src/config/contracts.ts.",
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `'comet' address not in canonical Compound V3 mainnet allowlist (6 Comets: cUSDCv3 / cUSDTv3 / cWETHv3 / cUSDSv3 / cwstETHv3 / cWBTCv3): ${rawComet}`,
        ),
      };
    }

    // SENDER resolution.
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    const assetAddr = getAddress(rawAsset) as Address;

    // Intent-gate prologue — runs BEFORE the encoder. Discriminates
    // withdraw-collateral vs borrow via `_compoundChains.deriveIntent
    // ("withdraw", ...)`. Short-circuits with structured refusal +
    // hintTool when the real intent is borrow.
    const client = getChainClient(chainId);
    let intent: Awaited<ReturnType<typeof _compoundChains.deriveIntent>>;
    try {
      intent = await _compoundChains.deriveIntent(
        client,
        cometAddr,
        fromAddress,
        "withdraw",
        assetAddr,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: failed to derive Compound intent for ${cometAddr}: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `failed to derive Compound intent for ${cometAddr}`,
          message,
        ),
      };
    }

    if (intent === "borrow") {
      const refusalMessage =
        `prepare_compound_withdraw received the Comet's base asset (${rawAsset}) but the wallet has no supplied base position on ${cometAddr}. ` +
        "Compound V3 withdraw against zero base supply IS a borrow operation (the protocol mints debt to satisfy the transfer, collateralized by other supplied assets). " +
        "Call prepare_compound_borrow with the same args.";
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${refusalMessage}` }],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", refusalMessage),
          hintTool: "prepare_compound_borrow",
        },
      };
    }

    // Resolve decimals. Registry-cache-first; live RPC on miss. Skipped on
    // the "max" path because MAX_UINT256 doesn't need a decimals lookup — but
    // we still resolve for the structuredContent surface (so the agent can
    // round-trip the literal). Implementation: always resolve; cost is
    // identical to the supply tool.
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

    // "max" handling — T-MAX-SPELLING-1 strict-equality (lowercase only).
    // Any other spelling flows to parseAmountStrict and rejects.
    let amountWei: bigint;
    if (rawAmount === "max") {
      amountWei = MAX_UINT256;
    } else {
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
    }

    const data: Hex = encodeCompoundWithdraw(assetAddr, amountWei);

    const tx = {
      chainId,
      to: cometAddr,
      valueWei: 0n,
      data,
    };

    const payloadFingerprint = computePayloadFingerprint(tx);

    const handle = createHandle({
      args: {
        to: rawComet,
        valueWei: "0",
        tokenAddress: rawAsset,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    // RECEIPT surfaces the VERBATIM `rawAmount` (e.g. "max" stays "max" — not
    // the resolved MAX_UINT256 hex). The DECODED ARGS block at preview time
    // (Plan 28-04) surfaces the resolved hex for cross-check.
    const baseReceipt = COMPOUND_WITHDRAW_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
      .replace("{COMET}", rawComet)
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
        comet: rawComet,
        from: fromAddress,
        asset: rawAsset,
        amount: rawAmount,
        amountWei: amountWei.toString(),
        intent,
        payloadFingerprint,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_compound_withdraw failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_compound_withdraw failed", message),
    };
  }
});
