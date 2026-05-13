// MCP tool: prepare_token_approve({ tokenAddress, spender, amount })
//
// Phase 6 — Plan 06-03 (PREP-26). Sibling to prepare_token_send (Plan 06-02)
// with bounded deviations:
//
//   (a) input schema is `{ tokenAddress, spender, amount }` — no recipient.
//   (b) encoder = `encodeErc20Approve(getAddress(spender), amountWei)`.
//   (c) `amount === "max"` is the ONLY accepted unlimited sentinel — it
//       sets `amountWei = MAX_UINT256` and SKIPS parseAmountStrict.
//       T-MAX-SPELLING-1 mitigation: `"MAX"` / `"unlimited"` / `"infinite"`
//       are rejected as INVALID_INPUT (strict-mode parity with
//       userDecision: "send"'s enum lock).
//   (d) tx.to is the TOKEN CONTRACT (same as prepare_token_send); tx.valueWei
//       is 0n.
//   (e) PREPARE RECEIPT uses APPROVE_PREPARE_RECEIPT_TEMPLATE (parallel
//       template with a `spender:` slot instead of `to:`).
//
// This file ALSO exports `prepareApproveInternal` — the shared helper that
// prepare_revoke_approval imports. The two top-level tools differ ONLY in
// input schema + description; the handle / fingerprint / receipt /
// structuredContent shape is identical. Byte-identity invariant
// (T-REVOKE-DRIFT-1 mitigation) is asserted in
// test/prepare-revoke-approval.test.ts: revoke({T, S}) and
// approve({T, S, amount: "0"}) produce identical payloadFingerprint AND
// identical tx.data.

import { type Address, type Hex, erc20Abi, getAddress } from "viem";

import { getEthereumClient } from "../chains/ethereum.js";
import { isDemoMode } from "../config/env.js";
import { getActivePersona } from "../demo/state.js";
import { MAX_UINT256, encodeErc20Approve } from "../protocols/erc20.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { APPROVE_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { loadEthereumTokenRegistry } from "../tokens/registry.js";
import { getStatus } from "../wallet/session-manager.js";
import { type ToolHandlerResult, registerTool } from "./index.js";

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> &
    StructuredError;
}

const DESCRIPTION = [
  "Prepare an unsigned ERC-20 approval on Ethereum mainnet. Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to authorize a spender (a DEX router, a lending pool, a bridge, etc.) to move tokens on their behalf.",
  "Do NOT use to REVOKE an existing approval — call prepare_revoke_approval (distinct tool name; routes by user intent).",
  "Do NOT use for ERC-20 transfers — that's prepare_token_send.",
  "Do NOT use for native ETH / WETH unwrap / contract calls — each has a dedicated prepare_* tool.",
  "Do NOT use for other chains — v1.0 is Ethereum mainnet only.",
  "`tokenAddress` is the ERC-20 contract address (0x-prefixed 20-byte hex). `spender` is the contract that will be authorized to move tokens — NOT a wallet address.",
  "`amount` is a DECIMAL STRING in human units (e.g. \"100.5\") OR the literal string \"max\" for unlimited (= 2^256-1). \"max\" is the ONLY accepted unlimited spelling — \"MAX\" / \"unlimited\" / \"infinite\" all refuse with INVALID_INPUT (strict-mode parity with userDecision: \"send\"'s enum lock).",
  "preview_send labels the approval `⚠ UNLIMITED APPROVAL` when amount === 2^256-1 (strict equality, not threshold-based) and surfaces a one-line revoke-path hint pointing at prepare_revoke_approval.",
  "Requires a paired Ledger (call pair_ledger_live first if get_ledger_status shows paired: false). In demo mode, succeeds against the active persona's address as `from`; send_transaction returns a simulation envelope instead of broadcasting.",
  "Returns `{ handle, chainId: 1, from, spender, tokenAddress, amount, amountWei, payloadFingerprint }` plus a PREPARE RECEIPT text block surfacing the verbatim agent args.",
  "Failure modes: WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode is on but no persona set, INVALID_INPUT if tokenAddress/spender/amount malformed (including non-canonical \"max\" spellings and fractional-overflow vs token decimals).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    tokenAddress: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "ERC-20 contract address (0x-prefixed 20-byte hex). NOT a wallet address.",
    },
    spender: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "Contract address that will be authorized to move tokens (0x-prefixed 20-byte hex). NOT a wallet address.",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in human units (e.g. \"100.5\") OR the literal string \"max\" for 2^256-1. \"max\" is the only accepted unlimited spelling.",
    },
  },
  required: ["tokenAddress", "spender", "amount"],
  additionalProperties: false,
};

/**
 * Resolve token decimals (registry-cache-first; live RPC on miss). Returns
 * decimals + symbol. Throws on RPC failure for off-list tokens; the caller
 * converts to the structured envelope at the tool boundary.
 *
 * Mirror of prepare_token_send's resolveDecimals — kept local to this module
 * so the cross-tool import surface stays minimal (the only export consumed
 * by prepare_revoke_approval is `prepareApproveInternal`).
 */
async function resolveDecimals(
  tokenAddress: Address,
): Promise<{ decimals: number; symbol: string }> {
  const registry = loadEthereumTokenRegistry();
  const cached = registry.find((entry) => entry.address === tokenAddress);
  if (cached) {
    return { decimals: cached.decimals, symbol: cached.symbol };
  }
  const client = getEthereumClient();
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol" }),
  ]);
  return { decimals, symbol };
}

/**
 * Shared internal helper for prepare_token_approve and
 * prepare_revoke_approval. Both top-level handlers do their own input shape
 * validation + amount resolution (decimal-string → bigint via
 * parseAmountStrict OR the MAX_UINT256 sentinel for "max"), then call this
 * helper with the pre-parsed `amountWei`.
 *
 * Byte-identity invariant (T-REVOKE-DRIFT-1 mitigation; asserted by
 * test/prepare-revoke-approval.test.ts):
 *
 *   prepare_token_approve({ tokenAddress: T, spender: S, amount: "0" })
 *     .structuredContent.payloadFingerprint
 *   ===
 *   prepare_revoke_approval({ tokenAddress: T, spender: S })
 *     .structuredContent.payloadFingerprint
 *
 * If the helper drifts (different tx construction order, different
 * normalization, etc.) the byte-identity test breaks at PR review — drift
 * surfaces before merge.
 */
export async function prepareApproveInternal(input: {
  rawTokenAddress: string;
  rawSpender: string;
  rawAmount: string;
  amountWei: bigint;
}): Promise<ToolHandlerResult> {
  const { rawTokenAddress, rawSpender, rawAmount, amountWei } = input;

  // SENDER resolution (Plan 05-02 Option B): demo branch SKIPS getStatus()
  // so the spy observes zero calls in the demo arm. T-DEMO-1 + T-NULL-
  // PERSONA-1 mitigation parity with prepare_token_send.
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

  // Checksum server-internal addresses. NEVER surfaced in the receipt
  // (PREP-02 / T-PREP-RCPT-1 — the receipt reads from rawTokenAddress /
  // rawSpender / rawAmount).
  const tokenAddress = getAddress(rawTokenAddress) as Address;
  const spenderAddress = getAddress(rawSpender) as Address;

  // Encode calldata via the canonical viem path. NEVER hand-rolled.
  const data: Hex = encodeErc20Approve(spenderAddress, amountWei);

  // tx.to is the TOKEN CONTRACT (T-TX-TO-CONFUSION-1 mitigation parity).
  // tx.valueWei is 0n — approve never moves native value.
  const tx = {
    chainId: 1,
    to: tokenAddress,
    valueWei: 0n,
    data,
  };

  // PREP-03 / T-BIND-1: compute the binding fingerprint at prepare time.
  // send_transaction (Plan 04-04) re-runs this on record.tx as the drift
  // gate.
  const payloadFingerprint = computePayloadFingerprint(tx);

  // PREP-02: args carries the RAW agent strings. The receipt + structured
  // surface read from args so a future contributor cannot accidentally
  // surface a checksummed / normalized form. `to: ""` because approve has
  // no recipient — only a spender. PrepareArgs.to is `string` (not
  // optional), so empty string is type-legal here.
  const handle = createHandle({
    args: {
      to: "",
      valueWei: "0",
      tokenAddress: rawTokenAddress,
      spender: rawSpender,
      amount: rawAmount,
    },
    tx,
    payloadFingerprint,
  });

  const receipt = APPROVE_PREPARE_RECEIPT_TEMPLATE
    .replace("{TOKEN_ADDRESS}", rawTokenAddress)
    .replace("{SPENDER}", rawSpender)
    .replace("{AMOUNT}", rawAmount);

  return {
    content: [{ type: "text", text: receipt }],
    structuredContent: {
      handle,
      chainId: 1,
      from: fromAddress,
      spender: rawSpender,
      tokenAddress: rawTokenAddress,
      amount: rawAmount,
      amountWei: amountWei.toString(),
      payloadFingerprint,
    },
  };
}

registerTool("prepare_token_approve", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // Validate tokenAddress shape — defense BEFORE any state read.
    const rawTokenAddress = typeof args.tokenAddress === "string" ? args.tokenAddress : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawTokenAddress)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'tokenAddress': expected 0x-prefixed 20-byte hex, got "${rawTokenAddress}"`,
          },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'tokenAddress': ${rawTokenAddress}`),
      };
    }

    // Validate spender shape.
    const rawSpender = typeof args.spender === "string" ? args.spender : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawSpender)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'spender': expected 0x-prefixed 20-byte hex, got "${rawSpender}"`,
          },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'spender': ${rawSpender}`),
      };
    }

    const rawAmount = typeof args.amount === "string" ? args.amount : "";

    // T-MAX-SPELLING-1: strict equality on the lowercase "max" sentinel.
    // ANY other case (`"MAX"`, `"unlimited"`, `"infinite"`) flows through
    // parseAmountStrict's regex and hits INVALID_INPUT (kind: "format" or
    // "empty"). Strict-mode parity with userDecision: "send"'s enum lock.
    let amountWei: bigint;
    if (rawAmount === "max") {
      amountWei = MAX_UINT256;
    } else {
      // Resolve token decimals (registry-cache-first; live RPC on miss).
      // Used ONLY for the parseAmountStrict fractional-overflow check —
      // approve's calldata math doesn't depend on decimals.
      const tokenAddress = getAddress(rawTokenAddress) as Address;
      let decimals: number;
      try {
        const meta = await resolveDecimals(tokenAddress);
        decimals = meta.decimals;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to resolve token decimals for ${tokenAddress}: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            `failed to resolve token decimals for ${tokenAddress}`,
            message,
          ),
        };
      }

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

    return await prepareApproveInternal({
      rawTokenAddress,
      rawSpender,
      rawAmount,
      amountWei,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_token_approve failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_token_approve failed", message),
    };
  }
});
