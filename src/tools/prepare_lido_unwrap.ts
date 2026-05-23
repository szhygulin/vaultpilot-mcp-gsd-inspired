// MCP tool: prepare_lido_unwrap({ chain, wstethAmount, from? })
//
// Phase 30 — Plan 30-03 (LIDO-04). Unwrap wstETH → stETH via WstETH.unwrap.
// Mechanical clone of prepare_weth_unwrap.ts with bounded deviations:
//
//   (a) input schema is `{ chain: ["ethereum"], wstethAmount, from? }`.
//       chain narrowed to single-value enum ["ethereum"] per D-03 — Lido writes
//       are Ethereum mainnet ONLY. Non-ethereum chains refuse with CHAIN_ID_MISMATCH
//       errorCode 15.
//   (b) `wstethAmount` is a DECIMAL STRING in wstETH units (decimals=18, WSTETH_DECIMALS).
//       parseAmountStrict resolves wei.
//   (c) tx.to = getLidoWstethAddress(1) — the wstETH contract. SOT-only (NEVER inlined).
//   (d) tx.valueWei = 0n. Unwrap is NOT payable; wstETH is burned as an ERC-20.
//   (e) tx.data = encodeWstethUnwrap(amountWei) — 36-byte calldata (selector 0xde0e9a3e + amount).
//   (f) PREPARE RECEIPT uses LIDO_UNWRAP_PREPARE_RECEIPT_TEMPLATE — slots: {CHAIN}, {WSTETH_CONTRACT}, {AMOUNT}.
//
// NO allowance pre-flight — wstETH is the user's own token burned directly
// by the WstETH contract; no ERC-20 approval is needed for the unwrap.
// This mirrors the WETH9.withdraw shape (no approval for your own token).
//
// D-12: ERC-7730 clear-sign coverage confirmed for WstETH.unwrap on Ethereum mainnet.
// No notice block needed (matches Phase 7 Aave precedent).
//
// Fixture Y cross-link: test/prepare-lido-unwrap.test.ts re-anchors the
// payloadFingerprint byte-identity via `0x6d0dff10...` literal from
// test/signing-fingerprint.test.ts.

import { type Address, type Hex } from "viem";

import {
  LIDO_UNWRAP_PREPARE_RECEIPT_TEMPLATE,
} from "../signing/blocks.js";
import {
  getLidoWstethAddress,
  WSTETH_DECIMALS,
  encodeWstethUnwrap,
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
  "Prepare an unsigned WstETH.unwrap(wstethAmount) call on Ethereum mainnet — unwraps wstETH back to stETH.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to convert their wstETH balance back to rebase-bearing stETH (e.g. to receive staking rewards directly, or to queue a withdrawal via prepare_lido_unstake).",
  "Do NOT use for ETH → stETH staking — use prepare_lido_stake instead. Do NOT use for stETH → wstETH wrapping — use prepare_lido_wrap instead.",
  "NO ERC-20 approval needed — wstETH is burned directly by the WstETH contract (mirrors WETH9.withdraw shape: no approval for your own token).",
  "`chain` is REQUIRED and locked to 'ethereum'. Non-ethereum chains refuse with CHAIN_ID_MISMATCH (errorCode 15).",
  "`wstethAmount` is a DECIMAL STRING in wstETH units (e.g. '1.0' unwraps 1 wstETH). Decimals=18.",
  "On-device clear-sign is confirmed for WstETH.unwrap (ERC-7730 registry coverage confirmed).",
  "Returns { handle, chainId, to, valueWei, payloadFingerprint, prepareReceipt } plus a PREPARE RECEIPT text block.",
  "Failure modes: CHAIN_ID_MISMATCH if chain != ethereum, INVALID_INPUT if wstethAmount is malformed, WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode active but no persona set or from mismatch.",
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
    wstethAmount: {
      type: "string",
      description:
        "Amount of wstETH to unwrap, as a decimal string in wstETH units (e.g. '1.0'). Decimals=18.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts in get_ledger_status.accountsByChain[chainId]. Omit to use the active account. In demo mode, must match the active persona's address.",
    },
  },
  required: ["chain", "wstethAmount"],
  additionalProperties: false,
};

registerTool("prepare_lido_unwrap", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // D-03: Ethereum-write-only gate.
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

    const rawAmount = typeof args.wstethAmount === "string" ? args.wstethAmount : "";

    // SENDER resolution (Plan 05-02 + Issue #62).
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    // Parse amount strictly.
    let amountWei: bigint;
    try {
      amountWei = parseAmountStrict(rawAmount, WSTETH_DECIMALS);
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
          { type: "text", text: `error: invalid 'wstethAmount': ${message}` },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'wstethAmount': ${message}`),
      };
    }

    // tx.to from SOT — NEVER inlined.
    const wstethAddr: Address = getLidoWstethAddress(chainId)!;

    // tx.valueWei = 0n. Unwrap is NOT payable.
    const data: Hex = encodeWstethUnwrap(amountWei);

    const tx = {
      chainId,
      to: wstethAddr,
      valueWei: 0n,
      data,
    };

    // PREP-03 + T-BIND-1: compute the binding fingerprint at prepare time.
    const payloadFingerprint = computePayloadFingerprint(tx);

    const handle = createHandle({
      args: {
        to: "",          // no separate recipient for unwrap (burns wstETH at the contract)
        valueWei: "0",
        tokenAddress: wstethAddr,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    const baseReceipt = LIDO_UNWRAP_PREPARE_RECEIPT_TEMPLATE
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
        { type: "text", text: `error: prepare_lido_unwrap failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_lido_unwrap failed", message),
    };
  }
});
