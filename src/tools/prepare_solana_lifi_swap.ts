// MCP tool: prepare_solana_lifi_swap({fromChain,fromToken,toChain,toToken,amount,toAddress})
//
// Phase 16 — SOL-W-21. A SINGLE LiFi bridge tool with an INTERNAL direction
// split (uniform with prepare_btc_lifi_swap / prepare_tron_lifi_swap):
//
//   OUTBOUND (Solana→EVM, fromChainId === LiFi Solana chain id) — Plan 16-02:
//     LiFi returns an EVM calldata tx. We bind it via the EXISTING EVM signing /
//     fingerprint path (computePayloadFingerprint + createHandle) and store the
//     user-supplied toAddress in PreparedTxEvm.bridgeParams so preview_send
//     Layer 0.6 decodes the finalRecipient FROM the EVM bridge calldata (Inv #6b)
//     and refuses DECODED_RECIPIENT_DRIFT on mismatch. The recipient is NEVER
//     asserted against quote.action.toAddress here — only against the bytes the
//     device signs (decoded at preview).
//
//   INBOUND (EVM→Solana, toChainId === LiFi Solana chain id) — Plan 16-03:
//     LiFi returns a base64 Solana tx (likely v0). Delegated to the typed
//     dispatch point `_solanaLifi.prepareInbound` — a STUB in 16-02 that returns
//     a "not-yet-shipped via 16-03" marker. 16-03 fills the body (v0-guard →
//     legacy decode + Inv #6b, OR typed v0 refusal). The split EXISTS so 16-03
//     only adds the inbound body, never restructures.
//
// Blind-sign LEDGER NOTICE: outbound dispatches EVM bridge calldata the device
// cannot fully clear-sign — the response carries the notice. No key material /
// no signing happens in this file (handle minting only).

import { type Address, type Hex, getAddress } from "viem";

import { fetchLifiQuote, type LifiQuote } from "../clients/lifi.js";
import { isDemoMode } from "../config/env.js";
import { LIFI_SOLANA_CHAIN_ID } from "../config/contracts.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  type PrepareArgs,
  type PreparedTxEvm,
  createHandle,
} from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import {
  LifiV0TransactionError,
  _lifiSolana,
} from "../protocols/lifi-solana.js";
import { registerTool, type ToolHandlerResult } from "./index.js";

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

function errResult(code: ErrorCode, message: string): ToolHandlerResult {
  return {
    isError: true,
    content: [{ type: "text", text: `error: ${message}` }],
    structuredContent: errEnvelope(code, message),
  };
}

// ─── Blind-sign LEDGER NOTICE (outbound bridge tool) ────────────────────────────
const LEDGER_NOTICE_BLIND_SIGN = [
  "LEDGER NOTICE (Solana LiFi bridge):",
  "This is a cross-chain bridge transaction. The Ledger device may BLIND-SIGN the",
  "outbound EVM bridge calldata — the on-device screen cannot fully decode the LiFi",
  "Diamond call. VaultPilot decodes the final recipient FROM the signed calldata at",
  "preview time (Inv #6b) and refuses if it differs from your toAddress. Verify the",
  "PREPARE RECEIPT below matches your intent before approving on-device.",
].join("\n");

// ─── Inbound dispatch point (16-02 STUB; 16-03 fills the body) ───────────────────
// Routed through the `_solanaLifi` indirection so 16-03 replaces ONLY this
// function (and a test can spy it). The split is the contract: 16-03 adds the
// inbound body, never restructures the tool.
async function prepareInbound(ctx: {
  quote: LifiQuote;
  toAddress: string;
  toChain: string;
  toToken: string;
  amount: string;
}): Promise<ToolHandlerResult> {
  // Plan 16-03 — BRANCH (b) CONSERVATIVE REFUSE (resolved at execute-time).
  //
  // The execute-time live /v1/quote capture for EVM→Solana returned a v0/
  // VersionedTransaction (byte-0 0xd3 >= 0x80). The FROZEN Solana binding accepts
  // ONLY legacy serializeMessage() bytes, so we run the v0-guard over the LiFi-
  // returned base64 tx. v0 → LifiV0TransactionError → typed refusal (NO handle,
  // NO decode, the Solana dispatch arm stays inactive). v0 is NEVER silently
  // accepted; the FROZEN binding is NEVER touched. (If LiFi ever returns a legacy
  // tx, deserializeLifiSolanaTx returns its serializeMessage() bytes — a future
  // follow-up then ships the recipient decode + Inv #6b + Fixture AD. Today that
  // path is unreachable, so we refuse honestly rather than ship a stub claim.)
  const b64 = ctx.quote.transactionRequest.data;
  try {
    _lifiSolana.deserializeLifiSolanaTx(b64);
  } catch (err) {
    if (err instanceof LifiV0TransactionError) {
      return errResult("INTERNAL_ERROR", err.message);
    }
    return errResult(
      "INTERNAL_ERROR",
      `LiFi inbound Solana tx could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Legacy tx parsed (not expected under the current branch-b reality): the
  // recipient decode + Inv #6b + canonical-dispatch activation are not shipped
  // in this build (no legacy upstream path was found at execute-time). Refuse
  // rather than mint a handle without the Inv #6b recipient assertion.
  return errResult(
    "INTERNAL_ERROR",
    "LiFi returned a legacy Solana tx, but the EVM→Solana inbound recipient decode (Inv #6b) " +
      "is not shipped in this build (LiFi returns v0 transactions for this route; see SECURITY.md). " +
      "Refusing to mint a handle without the final-recipient assertion.",
  );
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. The tool handler calls
 * `_solanaLifi.prepareInbound(...)` so 16-03 fills the inbound body via this
 * indirection and tests can `vi.spyOn(_solanaLifi, "prepareInbound")`.
 */
export const _solanaLifi = { prepareInbound };

// ─── Tool description (agent-routing prompt) ────────────────────────────────────
const DESCRIPTION = [
  "Prepare an unsigned LiFi bridge swap between Solana and an EVM chain from the paired Ledger.",
  "OUTBOUND (Solana→EVM): bridges SOL/SPL to an EVM chain via the LiFi Diamond; the unsigned EVM calldata tx is bound + a handle returned.",
  "INBOUND (EVM→Solana): bridges from an EVM chain to Solana (delivered by a later build; refuses cleanly until then).",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "`fromChain`/`toChain` are chain symbols (\"SOL\", \"ETH\", \"ARB\", \"POL\", etc.).",
  "`fromToken`/`toToken` are token addresses or symbols on their respective chains.",
  "`amount` is a decimal string in the source token's units.",
  "`toAddress` is the destination address on the target chain (EVM 0x… or Solana base58).",
  "Inv #6b: the final recipient is decoded from the SIGNED calldata at preview_send (NOT from the LiFi-relayed toAddress); a mismatch refuses with DECODED_RECIPIENT_DRIFT.",
  "Failure modes: DEMO_MODE_REFUSED, INVALID_INPUT, WALLET_NOT_PAIRED, LIFI_NO_ROUTE, INTERNAL_ERROR.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    fromChain: { type: "string", description: "Source chain symbol (\"SOL\", \"ETH\", \"ARB\", …)." },
    fromToken: { type: "string", description: "Source token address or symbol." },
    toChain: { type: "string", description: "Destination chain symbol." },
    toToken: { type: "string", description: "Destination token address or symbol." },
    amount: { type: "string", description: "Amount as a decimal string in the source token's units." },
    toAddress: { type: "string", description: "Destination address on the target chain (EVM 0x… or Solana base58)." },
  },
  required: ["fromChain", "fromToken", "toChain", "toToken", "amount", "toAddress"],
  additionalProperties: false,
};

registerTool("prepare_solana_lifi_swap", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const params = args as {
    fromChain: string;
    fromToken: string;
    toChain: string;
    toToken: string;
    amount: string;
    toAddress: string;
  };

  // ── 1. Demo-mode gate FIRST (refuse before any network call) ─────────────
  if (isDemoMode()) {
    return errResult(
      "DEMO_MODE_REFUSED",
      "prepare_solana_lifi_swap is not available in demo mode — LiFi bridging requires a real paired Ledger and live funds.",
    );
  }

  // ── 2. Input validation ───────────────────────────────────────────────────
  for (const [k, v] of Object.entries(params)) {
    if (typeof v !== "string" || v.trim().length === 0) {
      return errResult("INVALID_INPUT", `Invalid ${k}: must be a non-empty string.`);
    }
  }
  const amountStr = params.amount.trim();
  // Decimal-string amount (CLAUDE.md decimal-aware): allow integer or decimal.
  if (!/^\d+(\.\d+)?$/.test(amountStr) || Number(amountStr) <= 0) {
    return errResult(
      "INVALID_INPUT",
      `Invalid amount: "${params.amount}" — must be a positive decimal string in the source token's units.`,
    );
  }

  // ── 3. Resolve the paired wallet (source side) ────────────────────────────
  // Source-side address for the LiFi quote. For OUTBOUND (Solana→EVM) this is
  // the paired Solana account; for INBOUND (EVM→Solana) it is the active EVM
  // account. 16-02 ships outbound; the inbound resolution + dispatch is 16-03.
  // We resolve lazily inside each direction arm below to avoid forcing a
  // pairing that the chosen direction does not need.
  // (Resolution + fetch are deferred to the direction split for outbound; the
  //  fromAddress for the LiFi quote is the source-chain account.)

  // ── 4. Fetch LiFi quote ───────────────────────────────────────────────────
  // The fromAddress is the source-side account. For outbound (Solana→EVM) we
  // pass the paired Solana account; LiFi returns an EVM calldata tx. We resolve
  // the paired Solana account here (outbound is the 16-02 scope).
  const { listAccounts } = await import("../wallet/non-evm-account-store.js");
  const solAccounts = listAccounts({ chainFilter: "solana" });
  // The source account: Solana for outbound. (Inbound 16-03 resolves the EVM
  // active account inside _solanaLifi.prepareInbound.)
  const fromAddress = solAccounts[0]?.address ?? "";

  const quoteResult = await fetchLifiQuote({
    fromChain: params.fromChain,
    fromToken: params.fromToken,
    fromAddress: fromAddress.length > 0 ? fromAddress : params.toAddress,
    fromAmount: amountStr,
    toChain: params.toChain,
    toToken: params.toToken,
    toAddress: params.toAddress,
  });

  if (quoteResult.kind === "not-found") {
    return errResult(
      "LIFI_NO_ROUTE",
      `No LiFi route for ${params.fromChain} → ${params.toChain} ${params.toToken}. Try a different chain or token.`,
    );
  }
  if (quoteResult.kind === "rate-limited") {
    return errResult("INTERNAL_ERROR", `LiFi API rate limit reached: ${quoteResult.message}. Retry shortly.`);
  }
  if (quoteResult.kind === "error") {
    return errResult("INTERNAL_ERROR", `LiFi API error: ${quoteResult.message}`);
  }
  const { quote } = quoteResult;

  // ── 5. Direction split (source-chain check) ───────────────────────────────
  const isInbound = quote.toChainId === LIFI_SOLANA_CHAIN_ID;
  const isOutbound = quote.fromChainId === LIFI_SOLANA_CHAIN_ID;

  if (isInbound) {
    // EVM→Solana — delegated to the 16-03 dispatch point.
    return _solanaLifi.prepareInbound({
      quote,
      toAddress: params.toAddress,
      toChain: params.toChain,
      toToken: params.toToken,
      amount: params.amount,
    });
  }

  if (!isOutbound) {
    return errResult(
      "INVALID_INPUT",
      `Unsupported LiFi direction: neither source (${quote.fromChainId}) nor target (${quote.toChainId}) is the LiFi Solana chain. prepare_solana_lifi_swap bridges to/from Solana only.`,
    );
  }

  // ── 6. OUTBOUND (Solana→EVM): bind the EVM calldata tx via the EVM path ───
  // The LiFi tx is EVM calldata → use the existing EVM signing/fingerprint path.
  // Store the user-supplied toAddress in bridgeParams so preview_send Layer 0.6
  // decodes the finalRecipient FROM the calldata (Inv #6b) and refuses
  // DECODED_RECIPIENT_DRIFT on mismatch. We do NOT assert against
  // quote.action.toAddress here — only the signed bytes are trusted.
  const tr = quote.transactionRequest;
  let toAddr: Address;
  let data: Hex;
  let valueWei: bigint;
  try {
    toAddr = getAddress(tr.to); // EIP-55 — rejects a non-EVM dispatch target
    data = (tr.data.startsWith("0x") ? tr.data : `0x${tr.data}`) as Hex;
    valueWei = BigInt(tr.value);
  } catch (err) {
    return errResult(
      "INTERNAL_ERROR",
      `LiFi outbound tx has a malformed EVM transactionRequest: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // chainId = LiFi-returned target chain id (the EVM chain the tx executes on).
  const chainId = quote.toChainId;

  const tx: PreparedTxEvm = {
    txType: "evm",
    chainId,
    to: toAddr,
    valueWei,
    data,
    bridgeParams: { toAddress: params.toAddress },
  };

  const payloadFingerprint = computePayloadFingerprint({
    chainId,
    to: toAddr,
    valueWei,
    data,
  });

  const prepareArgs: PrepareArgs = {
    to: params.toAddress,
    valueWei: params.amount,
  };

  const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

  // ── 7. PREPARE RECEIPT (verbatim agent args) + response ───────────────────
  const prepareReceipt = [
    "PREPARE RECEIPT (prepare_solana_lifi_swap — OUTBOUND Solana→EVM):",
    `  fromChain:  ${params.fromChain}`,
    `  fromToken:  ${params.fromToken}`,
    `  toChain:    ${params.toChain}`,
    `  toToken:    ${params.toToken}`,
    `  amount:     ${params.amount}`,
    `  toAddress:  ${params.toAddress}`,
    "",
    `Dispatch target (EVM): ${toAddr}  (chainId ${chainId})`,
    `payloadFingerprint:    ${payloadFingerprint}`,
    "",
    LEDGER_NOTICE_BLIND_SIGN,
    "",
    "Next: call preview_send with this handle. Inv #6b decodes the final recipient",
    "FROM the signed calldata and refuses DECODED_RECIPIENT_DRIFT on mismatch.",
  ].join("\n");

  return {
    content: [{ type: "text", text: prepareReceipt }],
    structuredContent: {
      handle,
      direction: "outbound",
      fromChain: params.fromChain,
      fromToken: params.fromToken,
      toChain: params.toChain,
      toToken: params.toToken,
      amount: params.amount,
      toAddress: params.toAddress,
      chainId,
      dispatchTarget: toAddr,
      payloadFingerprint,
    },
  };
});
