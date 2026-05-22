// MCP tool: prepare_btc_lifi_swap({ fromToken, toChain, toToken, amount, toAddress })
//
// Phase 26 Plan 26-03 (BTC-LIFI-01). BTC→EVM/Solana LiFi bridge tool.
//
// Handler flow (per RESEARCH Pattern 4 + 5):
//   1. Demo-mode check FIRST (shared pattern — refuse before any network call).
//   2. Input validation — INVALID_INPUT envelope first.
//   3. Resolve paired BTC address via listAccounts({ chainFilter: "bitcoin" }).
//   4. fetchBtcLifiQuote(...) — NEVER throws; pattern-match on kind.
//   5. Inv#6b: assert quote.action.toAddress === params.toAddress (T-26-10).
//   6. decodeLifiPsbt(transactionRequest.data) for display only — DO NOT reconstruct.
//   7. computeBtcLifiPayloadFingerprint(psbtBytes) for the payloadFingerprint.
//   8. createHandle(...) with PreparedTxBtcLifi tx and fingerprint.
//   9. Return { handle, psbtHex, vaultAddress, amountSats, toAddress, toChain, toToken, prepareReceipt }.
//
// PSBT verbatim passthrough guarantee:
//   The PSBT from LiFi (transactionRequest.data) is stored byte-for-byte
//   in the handle. Output order is LOAD-BEARING (Chainflip bridge — RESEARCH Pitfall 6).
//   decodeLifiPsbt is called for display only; psbtHex in the handle equals
//   transactionRequest.data verbatim.
//
// Error codes used:
//   DEMO_MODE_REFUSED   — demo mode active (same as all prepare_* tools)
//   INVALID_INPUT       — amount is not a valid positive integer satoshi string
//   WALLET_NOT_PAIRED   — no paired BTC account (real mode)
//   LIFI_NO_ROUTE       — LiFi 404 — no route for BTC→toChain/toToken
//   RECIPIENT_MISMATCH  — Inv#6b: quote.action.toAddress !== params.toAddress (T-26-10)
//   INTERNAL_ERROR      — LiFi API error / rate-limited / unexpected failure

import { toBytes } from "viem";

import { fetchBtcLifiQuote } from "../clients/lifi.js";
import { isDemoMode } from "../config/env.js";
import {
  PREPARE_RECEIPT_BTC_LIFI_TEMPLATE,
} from "../signing/blocks-btc.js";
import {
  _btcLifiFingerprint,
  computeBtcLifiPayloadFingerprint,
} from "../signing/btc-lifi-fingerprint.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  type PrepareArgs,
  type PreparedTxBtcLifi,
  createHandle,
} from "../signing/handle-store.js";
import { decodeLifiPsbt } from "../protocols/bridge-decoders/lifi-btc.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

// ─── Error envelope boundary cast ─────────────────────────────────────────────

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<
    string,
    unknown
  > &
    StructuredError;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Zero address for EVM-shape sentinel fields on PreparedTxBtcLifi. */
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

/** Max PSBT hex preview length in PREPARE RECEIPT (80 chars + "...[full PSBT]"). */
const PSBT_HEX_PREVIEW_LEN = 80;

// ─── Tool description ─────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Prepare an unsigned BTC→EVM/Solana LiFi bridge swap from the paired Ledger Bitcoin account.",
  "Fetches a live LiFi quote for BTC as the source chain and returns a handle for the PSBT-based bridge deposit.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to bridge BTC to an EVM chain (Ethereum, Arbitrum, Polygon) or Solana.",
  "`fromToken` must be \"BTC\".",
  "`toChain` is the destination chain symbol: \"ETH\", \"ARB\", \"POL\", \"SOL\", etc.",
  "`toToken` is the destination token address or symbol (e.g. \"WETH\" or \"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2\").",
  "`amount` is the satoshi amount as a decimal string (1 BTC = 100_000_000 sats).",
  "`toAddress` is the destination address on the target chain — EVM 0x address or Solana base58 address.",
  "Requires a paired BTC Ledger (call `pair_btc_ledger` first if `get_btc_status` shows `paired: false`).",
  "The Inv#6b server-side assertion compares the LiFi-returned `quote.action.toAddress` against your `toAddress` — a mismatch refuses the swap with RECIPIENT_MISMATCH.",
  "The LiFi PSBT is passed through verbatim — never reconstructed. Output order is load-bearing for Chainflip bridge routing.",
  "Failure modes: DEMO_MODE_REFUSED (demo mode), WALLET_NOT_PAIRED (no paired BTC account), INVALID_INPUT (amount not a positive integer), LIFI_NO_ROUTE (no LiFi route available), RECIPIENT_MISMATCH (Inv#6b: LiFi toAddress differs from yours), INTERNAL_ERROR (LiFi API error).",
].join(" ");

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    fromToken: {
      type: "string",
      enum: ["BTC"],
      description: "Source token — must be \"BTC\".",
    },
    toChain: {
      type: "string",
      description: "Destination chain symbol: \"ETH\", \"ARB\", \"POL\", \"SOL\", etc.",
    },
    toToken: {
      type: "string",
      description:
        "Destination token address or symbol. Example: \"WETH\" or \"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2\".",
    },
    amount: {
      type: "string",
      description:
        "Amount in satoshis as a decimal string. Example: \"100000\" for 0.001 BTC. Never pass decimal BTC.",
    },
    toAddress: {
      type: "string",
      description:
        "Destination address on the target chain. EVM 0x… address or Solana base58 address.",
    },
  },
  required: ["fromToken", "toChain", "toToken", "amount", "toAddress"],
  additionalProperties: false,
};

// ─── Handler ──────────────────────────────────────────────────────────────────

registerTool("prepare_btc_lifi_swap", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const params = args as {
    fromToken: string;
    toChain: string;
    toToken: string;
    amount: string;
    toAddress: string;
  };

  // ── 1. Demo-mode check FIRST (before any network call) ───────────────────
  if (isDemoMode()) {
    const message = "prepare_btc_lifi_swap is not available in demo mode — LiFi bridge requires a real paired Ledger and live BTC UTXOs.";
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: errEnvelope("DEMO_MODE_REFUSED", message),
    };
  }

  // ── 2. Input validation ───────────────────────────────────────────────────
  // Validate amount: must be a non-negative integer string (satoshi).
  // Empty string, floats, negatives, and non-numeric strings are rejected.
  const amountStr = params.amount.trim();
  if (!/^\d+$/.test(amountStr)) {
    const message = `Invalid amount: "${params.amount}" — must be a positive integer number of satoshis (e.g. "100000" for 0.001 BTC). Do not pass decimal BTC.`;
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: errEnvelope("INVALID_INPUT", message),
    };
  }
  const amountSatoshi = BigInt(amountStr);
  if (amountSatoshi <= 0n) {
    const message = `Invalid amount: "${params.amount}" — must be > 0 satoshis.`;
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: errEnvelope("INVALID_INPUT", message),
    };
  }

  if (!params.toAddress || params.toAddress.trim().length === 0) {
    const message = "Invalid toAddress: must not be empty.";
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: errEnvelope("INVALID_INPUT", message),
    };
  }

  if (!params.toChain || params.toChain.trim().length === 0) {
    const message = "Invalid toChain: must not be empty.";
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: errEnvelope("INVALID_INPUT", message),
    };
  }

  if (!params.toToken || params.toToken.trim().length === 0) {
    const message = "Invalid toToken: must not be empty.";
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: errEnvelope("INVALID_INPUT", message),
    };
  }

  // ── 3. Resolve paired BTC address ────────────────────────────────────────
  const btcAccounts = listAccounts({ chainFilter: "bitcoin" });
  if (btcAccounts.length === 0) {
    const message =
      "No paired BTC account. Call `pair_btc_ledger` first to pair your Bitcoin Ledger account, then retry.";
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: errEnvelope("WALLET_NOT_PAIRED", message),
    };
  }
  // Prefer the segwit (bc1q) account for LiFi — it's the native segwit address LiFi expects.
  const segwitAccount = btcAccounts.find((a) => a.address.startsWith("bc1q")) ?? btcAccounts[0]!;
  const btcAddress = segwitAccount.address;

  // ── 4. Fetch LiFi quote ───────────────────────────────────────────────────
  const quoteResult = await fetchBtcLifiQuote({
    btcAddress,
    amountSatoshi,
    toChain: params.toChain,
    toToken: params.toToken,
    toAddress: params.toAddress,
  });

  if (quoteResult.kind === "not-found") {
    const message = `No LiFi route available for BTC → ${params.toChain} ${params.toToken}. Try a different destination chain or token.`;
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: errEnvelope("LIFI_NO_ROUTE", message),
    };
  }

  if (quoteResult.kind === "rate-limited") {
    const message = `LiFi API rate limit reached: ${quoteResult.message}. Wait a moment and retry.`;
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", message),
    };
  }

  if (quoteResult.kind === "error") {
    const message = `LiFi API error: ${quoteResult.message}`;
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", message),
    };
  }

  const { quote } = quoteResult;

  // ── 5. Inv#6b — assert final recipient matches user-supplied toAddress ───
  // RESEARCH Pattern 5: the OP_RETURN in the PSBT is a binary tracking memo,
  // NOT a human-readable address. The final recipient is in quote.action.toAddress.
  // This is the load-bearing T-26-10 mitigation: a tampered or malicious LiFi route
  // that redirects funds to a different recipient is caught here, BEFORE handle creation.
  if (quote.action.toAddress?.toLowerCase() !== params.toAddress.toLowerCase()) {
    const message = `RECIPIENT_MISMATCH: LiFi returned toAddress=${quote.action.toAddress} but you supplied toAddress=${params.toAddress}. Refusing to create handle — the bridge quote would send funds to a different address.`;
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: errEnvelope("RECIPIENT_MISMATCH", message),
    };
  }
  const decodedFinalRecipient = quote.action.toAddress;

  // ── 6. Decode PSBT for display only (DO NOT reconstruct) ─────────────────
  const psbtHex = quote.transactionRequest.data;
  let psbtSummary;
  try {
    psbtSummary = decodeLifiPsbt(psbtHex);
  } catch (decodeErr) {
    const message = `Failed to decode LiFi PSBT: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`;
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", message),
    };
  }

  // ── 7. Compute payloadFingerprint over whole-PSBT bytes ──────────────────
  // preimage = keccak256("VaultPilot-btclifi-v1:" ‖ psbtBytes)
  // Whole-PSBT bytes commits to the exact byte sequence the Ledger device signs.
  const psbtBytes = toBytes(psbtHex);
  const payloadFingerprint = _btcLifiFingerprint.computeBtcLifiPayloadFingerprint(psbtBytes);

  // ── 8. Create handle ─────────────────────────────────────────────────────
  const prepareArgs: PrepareArgs = {
    to: params.toAddress,
    valueWei: params.amount, // satoshi amount as string — maps to the valueWei PrepareArgs field
  };

  const tx: PreparedTxBtcLifi = {
    txType: "btc-lifi",
    // EVM-shape sentinel fields (zero / empty values — Layer 0.5 dispatch-target refuses before EVM processing)
    chainId: 0,
    to: ZERO_EVM_ADDRESS,
    valueWei: 0n,
    data: "0x",
    // BTC LiFi-specific fields
    psbtHex, // VERBATIM from LiFi — output order is load-bearing (Pitfall 6)
    vaultAddress: psbtSummary.vaultAddress,
    amountSats: psbtSummary.amountSats,
    toAddress: decodedFinalRecipient,
    toChain: params.toChain,
    toToken: params.toToken,
    payloadFingerprint,
  };

  const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

  // ── 9. Build PREPARE RECEIPT and return ──────────────────────────────────
  const psbtHexPreview = psbtHex.length > PSBT_HEX_PREVIEW_LEN
    ? `${psbtHex.slice(0, PSBT_HEX_PREVIEW_LEN)}...[full PSBT]`
    : psbtHex;

  const prepareReceipt = PREPARE_RECEIPT_BTC_LIFI_TEMPLATE
    .replace("{FROM_TOKEN}", params.fromToken)
    .replace("{TO_CHAIN}", params.toChain)
    .replace("{TO_TOKEN}", params.toToken)
    .replace("{AMOUNT}", params.amount)
    .replace("{TO_ADDRESS}", params.toAddress)
    .replace("{VAULT_ADDRESS}", psbtSummary.vaultAddress)
    .replace("{AMOUNT_SATS}", psbtSummary.amountSats.toString())
    .replace("{OUTPUT_COUNT}", String(psbtSummary.outputCount))
    .replace("{HAS_OP_RETURN}", String(psbtSummary.hasOpReturn))
    .replace("{DECODED_RECIPIENT}", decodedFinalRecipient)
    .replace("{PSBT_HEX_PREVIEW}", psbtHexPreview);

  return {
    content: [{ type: "text", text: prepareReceipt }],
    structuredContent: {
      handle,
      txType: "btc-lifi" as const,
      psbtHex, // verbatim PSBT hex (full)
      vaultAddress: psbtSummary.vaultAddress,
      amountSats: psbtSummary.amountSats.toString(),
      toAddress: decodedFinalRecipient,
      toChain: params.toChain,
      toToken: params.toToken,
      outputCount: psbtSummary.outputCount,
      hasOpReturn: psbtSummary.hasOpReturn,
      payloadFingerprint,
      prepareReceipt,
    },
  };
});
