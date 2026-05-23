// MCP tool: prepare_lido_wrap({ chain, stethAmount, from? })
//
// Phase 30 — Plan 30-03 (LIDO-05). Wrap stETH → wstETH via WstETH.wrap(stethAmount).
// Mechanical clone of prepare_weth_unwrap.ts with bounded deviations:
//
//   (a) input schema is `{ chain: ["ethereum"], stethAmount, from? }`.
//       chain narrowed to single-value enum ["ethereum"] per D-03 — Lido writes
//       are Ethereum mainnet ONLY. Non-ethereum chains refuse with CHAIN_ID_MISMATCH
//       errorCode 15.
//   (b) `stethAmount` is a DECIMAL STRING in stETH units (decimals=18, STETH_DECIMALS).
//       parseAmountStrict resolves wei.
//   (c) tx.to = getLidoWstethAddress(1) — the wstETH contract. SOT-only (NEVER inlined).
//   (d) tx.valueWei = 0n. Wrap is NOT payable; stETH is consumed as an ERC-20.
//   (e) tx.data = encodeWstethWrap(amountWei) — 36-byte calldata (selector 0xea598cb0 + amount).
//   (f) D-05: stETH allowance pre-flight reads stETH.allowance(from, wstethAddr) at
//       prepare time; insufficient allowance refuses with INVALID_INPUT +
//       hintTool: "prepare_token_approve" + hintArgs pointing to the correct
//       spender (wstETH contract, NOT the WithdrawalQueue).
//   (g) PREPARE RECEIPT uses LIDO_WRAP_PREPARE_RECEIPT_TEMPLATE — slots: {CHAIN}, {WSTETH_CONTRACT}, {AMOUNT}.
//
// D-12: ERC-7730 clear-sign coverage confirmed for WstETH.wrap on Ethereum mainnet.
// No notice block emitted (matches Phase 7 Aave precedent).
//
// Fixture X cross-link: test/prepare-lido-wrap.test.ts re-anchors the
// payloadFingerprint byte-identity via `0x0f08b774...` literal from
// test/signing-fingerprint.test.ts. Fixture X is from-INDEPENDENT
// (stETH amount flows in calldata; owner address does NOT).

import { type Address, type Hex, erc20Abi, formatUnits } from "viem";

import {
  LIDO_WRAP_PREPARE_RECEIPT_TEMPLATE,
} from "../signing/blocks.js";
import {
  getLidoStethAddress,
  getLidoWstethAddress,
  STETH_DECIMALS,
  encodeWstethWrap,
} from "../protocols/lido.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import { getChainClient } from "../chains/registry.js";
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
  "Prepare an unsigned WstETH.wrap(stethAmount) call on Ethereum mainnet — wraps rebase-bearing stETH into yield-bearing wstETH.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to wrap stETH into wstETH (e.g. for DeFi protocols that prefer the non-rebasing wstETH share token).",
  "Do NOT use for ETH → stETH staking — use prepare_lido_stake instead. Do NOT use for wstETH → stETH conversion — use prepare_lido_unwrap instead.",
  "REQUIRES stETH approval: the user MUST have approved the wstETH contract to spend stETH before calling this tool. If insufficient allowance is detected, refuses with INVALID_INPUT + hintTool: prepare_token_approve with the correct spender address (wstETH contract).",
  "`chain` is REQUIRED and locked to 'ethereum'. Non-ethereum chains refuse with CHAIN_ID_MISMATCH (errorCode 15).",
  "`stethAmount` is a DECIMAL STRING in stETH units (e.g. '1.0' wraps 1 stETH). Decimals=18.",
  "On-device clear-sign is confirmed for WstETH.wrap (ERC-7730 registry coverage confirmed).",
  "Returns { handle, chainId, to, valueWei, payloadFingerprint, prepareReceipt } plus a PREPARE RECEIPT text block.",
  "Failure modes: CHAIN_ID_MISMATCH if chain != ethereum, INVALID_INPUT (insufficient stETH allowance with hintTool / malformed amount), WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode active but no persona set or from mismatch.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier (required). ONLY 'ethereum' is supported — Lido write operations are Ethereum mainnet only. Non-ethereum refuses with CHAIN_ID_MISMATCH.",
    },
    stethAmount: {
      type: "string",
      description:
        "Amount of stETH to wrap, as a decimal string in stETH units (e.g. '1.0'). Decimals=18. The wstETH contract must be approved as spender first.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts in get_ledger_status.accountsByChain[chainId]. Omit to use the active account. In demo mode, must match the active persona's address.",
    },
  },
  required: ["chain", "stethAmount"],
  additionalProperties: false,
};

registerTool("prepare_lido_wrap", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // D-03: Ethereum-write-only gate (cheap gate BEFORE any RPC reads).
    const chainName = typeof args.chain === "string" ? args.chain : "";
    if (chainName !== "ethereum") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'chain': Lido write operations support only 'ethereum', got "${chainName}"`,
          },
        ],
        structuredContent: errEnvelope(
          "CHAIN_ID_MISMATCH",
          `invalid 'chain': Lido write operations support only 'ethereum', got "${chainName}"`,
        ),
      };
    }
    const chainId = 1;

    const rawAmount = typeof args.stethAmount === "string" ? args.stethAmount : "";

    // SENDER resolution (Plan 05-02 + Issue #62): delegated to shared resolveFrom.
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    // Parse amount strictly. parseAmountStrict refuses empty/format/fractional-overflow.
    let amountWei: bigint;
    try {
      amountWei = parseAmountStrict(rawAmount, STETH_DECIMALS);
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
          { type: "text", text: `error: invalid 'stethAmount': ${message}` },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'stethAmount': ${message}`),
      };
    }

    // Resolve contract addresses from SOT — NEVER inlined.
    const stethAddr: Address = getLidoStethAddress(chainId)!;
    const wstethAddr: Address = getLidoWstethAddress(chainId)!;

    // D-05: stETH allowance pre-flight for wstETH contract as spender.
    const client = getChainClient(chainId);
    const allowance: bigint = await client.readContract({
      address: stethAddr,
      abi: erc20Abi,
      functionName: "allowance",
      args: [fromAddress, wstethAddr],
    });

    if (allowance < amountWei) {
      const insufficientMessage =
        `insufficient stETH allowance for WstETH wrap: ` +
        `approved ${formatUnits(allowance, 18)} stETH, need ${rawAmount} stETH. ` +
        `Call prepare_token_approve with the wstETH contract address as spender.`;
      return {
        isError: true,
        content: [
          { type: "text", text: `error: ${insufficientMessage}` },
        ],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", insufficientMessage),
          hintTool: "prepare_token_approve",
          hintArgs: {
            tokenAddress: stethAddr,
            spender: wstethAddr,
            amount: formatUnits(amountWei, 18),
          },
        },
      };
    }

    // tx.to from SOT — NEVER inlined.
    // tx.valueWei = 0n. Wrap is NOT payable; stETH is consumed as an ERC-20.
    const data: Hex = encodeWstethWrap(amountWei);

    const tx = {
      chainId,
      to: wstethAddr,
      valueWei: 0n,
      data,
    };

    // PREP-03 + T-BIND-1: compute the binding fingerprint at prepare time.
    // Fixture X: fingerprint is from-INDEPENDENT (stETH amount in calldata; no owner slot).
    const payloadFingerprint = computePayloadFingerprint(tx);

    const handle = createHandle({
      args: {
        to: "",          // no separate recipient for wrap (mints wstETH to msg.sender)
        valueWei: "0",
        tokenAddress: stethAddr,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    // Phase 8: PREPARE RECEIPT with verbatim agent args (no normalization).
    // Issue #62: append `from:` line ONLY when caller-supplied.
    const baseReceipt = LIDO_WRAP_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `ethereum (chainId 1)`)
      .replace("{WSTETH_CONTRACT}", wstethAddr)
      .replace("{AMOUNT}", rawAmount);
    const receipt = fromCallerSupplied
      ? `${baseReceipt}\n  from:         ${rawFrom}`
      : baseReceipt;

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        chainId,
        from: fromAddress,
        to: wstethAddr,
        valueWei: "0",
        data: tx.data,
        payloadFingerprint,
        prepareReceipt: receipt,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_lido_wrap failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_lido_wrap failed", message),
    };
  }
});
