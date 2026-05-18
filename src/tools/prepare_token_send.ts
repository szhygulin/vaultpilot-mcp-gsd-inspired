// MCP tool: prepare_token_send({ to, tokenAddress, amount })
//
// First contract-call shape over the Phase 4 trust pipeline. Mechanical clone
// of prepare_native_send.ts with bounded deviations:
//
//   (a) input schema adds `tokenAddress` (Address) + `amount` (decimal string);
//       drops native-send's `valueWei` (always `0n` for ERC-20 transfer).
//   (b) calldata = viem.encodeFunctionData({ abi: erc20Abi, functionName: "transfer",
//                                           args: [getAddress(to), amountWei] })
//   (c) tx.to = getAddress(tokenAddress) — THE TOKEN CONTRACT, NOT the recipient.
//       The recipient lives INSIDE `data` — never confused with `tx.to`
//       (T-TX-TO-CONFUSION-1 mitigation).
//   (d) tx.valueWei = 0n (no native value transfer).
//   (e) PREPARE RECEIPT uses ERC20_PREPARE_RECEIPT_TEMPLATE (parallel template
//       per 06-PATTERNS.md line 97).
//   (f) Decimal resolution: registry-cache-first via loadEthereumTokenRegistry
//       (top-50 hits cache), live RPC `decimals()` + `symbol()` on miss.
//   (g) Amount parsing: parseAmountStrict from Plan 06-01 — INVALID_INPUT on
//       any rejected shape (empty / format / fractional-overflow).
//
// Everything else — demo-mode-first branching, pairing check, createHandle,
// payloadFingerprint compute, structuredContent envelope shape, defensive
// catch-all — is byte-identical to prepare_native_send.ts.
//
// `amount: "max"` is NOT a valid input here. ERC-20 `transfer` doesn't take
// the unlimited sentinel — that's `approve`'s territory (Plan 06-03). Schema
// rejects all non-decimal-shape inputs at parseAmountStrict; a `"max"` literal
// hits the format branch with `kind: "format"` and surfaces INVALID_INPUT.

import { type Address, type Hex, erc20Abi, getAddress } from "viem";

import { getChainClient } from "../chains/registry.js";
import { chainIdFromName, type ChainId, type ChainName } from "../config/contracts.js";
import { isDemoMode } from "../config/env.js";
import { getActivePersona } from "../demo/state.js";
import { encodeErc20Transfer } from "../protocols/erc20.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { ERC20_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { loadTokenRegistry } from "../tokens/registry.js";
import { getStatus } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}

const DESCRIPTION = [
  "Prepare an unsigned ERC-20 transfer on the specified EVM chain.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to send any ERC-20 token from their paired Ledger.",
  "Do NOT use for native ETH — that's prepare_native_send.",
  "Do NOT use for approve / revoke / WETH-unwrap — each has a dedicated prepare_* tool.",
  "`chain` is REQUIRED — pass one of ethereum, arbitrum, polygon, base, optimism. No default-pick; omitting refuses at the dispatch boundary.",
  "`amount` is a DECIMAL STRING in human units (e.g. \"100.5\" for 100.5 USDC, NOT \"100500000\"). The server resolves the token's decimals via the on-chain decimals() call (or the cached registry for top-50 tokens) and parses amount strictly — off-by-decimal errors refuse at prepare time, never silently round.",
  "`to` is the RECIPIENT address (0x-prefixed 20-byte hex). `tokenAddress` is the ERC-20 contract address — NOT a wallet address.",
  "Requires a paired Ledger (call pair_ledger_live first if get_ledger_status shows paired: false). In demo mode, succeeds against the active persona's address as `from`; send_transaction returns a simulation envelope instead of broadcasting.",
  "Returns `{ handle, chain, chainId, from, to, tokenAddress, amount, amountWei, payloadFingerprint }` plus a PREPARE RECEIPT text block surfacing the verbatim args.",
  "Failure modes: WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode is on but no persona set, INVALID_INPUT if chain/to/tokenAddress/amount malformed (including fractional-overflow vs token decimals).",
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
    to: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "Recipient address (0x-prefixed 20-byte hex).",
    },
    tokenAddress: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "ERC-20 contract address (0x-prefixed 20-byte hex). NOT a wallet address.",
    },
    amount: {
      type: "string",
      description: "Decimal string in human units (e.g. \"100.5\"). The server resolves decimals via the token contract. Do NOT pass wei.",
    },
  },
  required: ["chain", "to", "tokenAddress", "amount"],
  additionalProperties: false,
};

/**
 * Resolve token decimals (registry-cache-first; live RPC on miss). Returns
 * decimals + symbol for the receipt + DECODED ARGS surface. Throws an
 * INTERNAL_ERROR-shaped Error on RPC failure for off-list tokens; the
 * handler converts to the structured envelope.
 */
async function resolveDecimals(
  tokenAddress: Address,
  chainId: ChainId,
): Promise<{ decimals: number; symbol: string }> {
  const registry = loadTokenRegistry(chainId);
  const cached = registry.find((entry) => entry.address === tokenAddress);
  if (cached) {
    return { decimals: cached.decimals, symbol: cached.symbol };
  }
  // Cache miss — live RPC reads in parallel.
  const client = getChainClient(chainId);
  const [decimals, symbol] = await Promise.all([
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol" }),
  ]);
  return { decimals, symbol };
}

registerTool("prepare_token_send", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // Phase 8 — Plan 08-02: chainId from the agent's `chain` arg. JSON-schema
    // enum is the dispatch-boundary gate; per-handler re-validation unreachable.
    const chainName = args.chain as ChainName;
    const chainId = chainIdFromName(chainName);

    // Validate `to` shape (agent recipient) — defense BEFORE any state read.
    const rawTo = typeof args.to === "string" ? args.to : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(rawTo)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'to' address: expected 0x-prefixed 20-byte hex, got "${rawTo}"`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'to' address: ${rawTo}`,
        ),
      };
    }

    // Validate `tokenAddress` shape.
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
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'tokenAddress': ${rawTokenAddress}`,
        ),
      };
    }

    // Validate `amount` is a string at the schema boundary; parseAmountStrict
    // does the deep validation.
    const rawAmount = typeof args.amount === "string" ? args.amount : "";

    // SENDER resolution (Plan 05-02 / Q-CONTRADICTION-PREP Option B):
    // In demo mode, the active persona's address is `from`; in real mode,
    // the paired Ledger's active account is `from`. The demo branch SKIPS
    // `getStatus()` (no WC pairing exists in demo) so the spy observes zero
    // calls in the demo arm — same invariant as prepare_native_send.
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
          structuredContent: errEnvelope(
            "WALLET_NOT_PAIRED",
            "no live Ledger session",
          ),
        };
      }
      fromAddress = status.activeAccount;
    }

    // Checksum the addresses for server-internal correctness. NEVER surfaced
    // in the receipt (PREP-02 / T-PREP-RCPT-1) — receipt reads from `rawTo`
    // and `rawTokenAddress`.
    const tokenAddress = getAddress(rawTokenAddress) as Address;
    const toAddress = getAddress(rawTo) as Address;

    // Resolve decimals + symbol. Registry-cache-first; live RPC on miss.
    let decimals: number;
    try {
      const meta = await resolveDecimals(tokenAddress, chainId);
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

    // Parse amount strictly. T-PARSE-AMOUNT-1 + T-PARSE-EMPTY-1 mitigations
    // — refuses empty/format/fractional-overflow. Plan 06-01 SOT.
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
          {
            type: "text",
            text: `error: invalid 'amount': ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'amount': ${message}`,
        ),
      };
    }

    // Encode the calldata via the canonical viem path. NEVER hand-rolled.
    const data: Hex = encodeErc20Transfer(toAddress, amountWei);

    // tx.to is the TOKEN CONTRACT, not the recipient (T-TX-TO-CONFUSION-1).
    // tx.valueWei is 0n — ERC-20 transfer never moves native value.
    // Phase 8 — Plan 08-02: chainId from `args.chain` enum.
    const tx = {
      chainId,
      to: tokenAddress,
      valueWei: 0n,
      data,
    };

    // PREP-03 / T-BIND-1: compute the binding fingerprint at prepare time.
    // Plan 04-04's send handler re-runs this on `record.tx` as the drift gate.
    const payloadFingerprint = computePayloadFingerprint(tx);

    // PREP-02: `args` carries the RAW agent strings. The receipt + structured
    // surface read from args so a future contributor cannot accidentally
    // surface a checksummed / normalized form. PrepareArgs field types are
    // `string` so the type system blocks normalization at the storage boundary.
    const handle = createHandle({
      args: {
        to: rawTo,
        valueWei: "0",
        tokenAddress: rawTokenAddress,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    // Phase 8 — Plan 08-02: `{CHAIN}` slot widening in PREPARE RECEIPT body.
    const receipt = ERC20_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
      .replace("{TOKEN_ADDRESS}", rawTokenAddress)
      .replace("{TO}", rawTo)
      .replace("{AMOUNT}", rawAmount);

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        chain: chainName,
        chainId,
        from: fromAddress,
        to: rawTo,
        tokenAddress: rawTokenAddress,
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
        { type: "text", text: `error: prepare_token_send failed: ${message}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "prepare_token_send failed",
        message,
      ),
    };
  }
});
