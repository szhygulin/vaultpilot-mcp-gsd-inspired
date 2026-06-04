// src/tools/prepare_jupiter_swap.ts — Phase 14 Plan 14-02 (SOL-W-12 + SOL-W-13).
//
// Prepare an unsigned Jupiter v6 swap transaction the user signs via the standard
// Solana trust pipeline. THE MAKE-OR-BREAK of the phase: it binds + gates a
// transaction a THIRD PARTY (Jupiter's hosted Metis router) constructed, routed
// through the UNCHANGED Phase-12 trust pipeline.
//
// Flow (RESEARCH § Architecture Pattern 2 + the prepare-tool spine):
//   1. validate inputs (base58 mints; base-unit amount; slippageBps bounds)
//   2. demo-FIRST refusal → feePayer (Solana persona in demo; first paired Solana
//      account in real mode; WRONG_MODE / WALLET_NOT_PAIRED exactly as the SPL tool)
//   3. re-quote via _jupiterClient.getQuote (asLegacyTransaction:true sent by the client)
//   4. ★ MEV REFUSAL GATE (SOL-W-13): Number(priceImpactPct)*100 > 2.0% AND the
//      caller did NOT explicitly pass slippageBps → SANDWICH_MEV_REFUSED, NO handle.
//   5. POST /swap via getSwapTransaction (VERBATIM quoteResponse — Pitfall 4). On a
//      size-overflow / too-large error → HARD structured refusal, NEVER a v0 fallback.
//   6. deserializeJupiterSwapTx (legacy → serializeMessage bytes + top-level programIds).
//      A v0 tx → JupiterV0TransactionError → structured refusal (anti-pattern guard).
//   7. payloadFingerprint = computeSolanaPayloadFingerprint({messageBytes}) — FROZEN.
//   8. createHandle (RAW agent strings on args; solana-typed tx with programIds).
//   9. PREPARE RECEIPT (verbatim args) + CHECKS PERFORMED (From/To/Price-impact from
//      the QUOTE — NOT the opaque tx) + blind-sign LEDGER NOTICE; blindSign:true.
//
// BLIND-SIGN: the Ledger Solana app does NOT clear-sign an opaque Jupiter swap —
// the device shows only the message hash. The on-device hash match is the trust
// anchor; the MCP-side decode + economics surfacing is defense-in-depth.

import { PublicKey } from "@solana/web3.js";

import { _jupiter as _jupiterClient } from "../clients/jupiter.js";
import { isDemoMode } from "../config/env.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { _jupiter as _jupiterProtocol, JupiterV0TransactionError } from "../protocols/jupiter.js";
import { LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE } from "../signing/blocks-solana.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computeSolanaPayloadFingerprint } from "../signing/payload-fingerprint-solana.js";
import { findByMint } from "../tokens/solana-top-50.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

// Solana single-cluster sandwich-MEV constant — mirror of the EVM ethereum-arm
// { defaultSlippageBps: 50, priceImpactRefusalPct: 2.0 } SOT (NOT the per-chain map).
const SOLANA_DEFAULT_SLIPPAGE_BPS = 50;
const SOLANA_PRICE_IMPACT_REFUSAL_PCT = 2.0;

const BASE58_PUBKEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function errEnvelope(code: ErrorCode, message: string, cause?: string): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}

function refusal(code: ErrorCode, message: string, cause?: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `error: ${message}` }],
    structuredContent: errEnvelope(code, message, cause),
  };
}

/** Human-readable symbol for a mint (curated registry; falls back to base58). */
function symbolOf(mint: string): string {
  return findByMint(mint)?.symbol ?? mint;
}

const DESCRIPTION = [
  "Prepare an unsigned Jupiter v6 aggregator swap transaction on Solana mainnet-beta — returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to swap one SPL token for another (e.g. SOL → USDC) via Jupiter's best-route aggregator. Do NOT use for Ethereum DEX swaps (prepare_uniswap_swap / prepare_curve_swap) or TRON (prepare_sunswap_swap).",
  "First call get_jupiter_quote to read the price impact. When the price impact exceeds 2%, you MUST pass slippageBps explicitly here or this tool REFUSES with SANDWICH_MEV_REFUSED (sandwich-MEV defense, SOL-W-13).",
  "`inputMint` / `outputMint` are SPL mint base58 pubkeys. `amount` is the RAW base-unit amount as a decimal string for the input mint. `slippageBps` is optional (integer 1–10000; default 50 = 0.5%).",
  "BLIND-SIGN: the Ledger Solana app does NOT clear-sign Jupiter swaps — your device shows only the message hash. Enable blind-signing; verify the PREPARE RECEIPT + CHECKS PERFORMED; the on-device hash match is the trust anchor.",
  "The swap is forced to a LEGACY transaction (asLegacyTransaction) for hardware-wallet compatibility. A complex route that overflows the 1232-byte legacy limit is REFUSED (no silent v0 fallback) — retry with a smaller amount or a more-liquid pair.",
  "Requires a paired Solana Ledger (real mode) or an active Solana persona (demo mode).",
  "Returns { handle, inputMint, outputMint, amount, slippageBps, inAmount, outAmount, priceImpactPct, payloadFingerprint, txType: \"solana\", feePayer, blindSign: true } + a PREPARE RECEIPT and CHECKS PERFORMED block. Pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT (malformed mint/amount/slippage OR legacy-tx size overflow), SANDWICH_MEV_REFUSED (price impact > 2% without explicit slippageBps), BROADCAST_FAILED (Jupiter rate-limited / HTTP error).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    inputMint: {
      type: "string",
      description: "Input SPL mint base58 pubkey (e.g. SOL = So11111111111111111111111111111111111111112).",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    outputMint: {
      type: "string",
      description: "Output SPL mint base58 pubkey (e.g. USDC = EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v).",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    amount: {
      type: "string",
      description: "RAW base-unit amount as a decimal string for the input mint (e.g. \"100000000\" for 0.1 SOL at 9 decimals).",
    },
    slippageBps: {
      type: "number",
      description: "Slippage tolerance in basis points (integer, 1–10000). Default: 50. REQUIRED (pass explicitly) when get_jupiter_quote reports price impact > 2%, else this tool REFUSES.",
    },
  },
  required: ["inputMint", "outputMint", "amount"],
  additionalProperties: false,
};

registerTool("prepare_jupiter_swap", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // ---- 1. input validation (defense-in-depth before any state read) ----
    const inputMint = typeof args.inputMint === "string" ? args.inputMint : "";
    if (!BASE58_PUBKEY_REGEX.test(inputMint)) {
      return refusal("INVALID_INPUT", `invalid 'inputMint': expected base58 pubkey, got "${inputMint}"`);
    }
    const outputMint = typeof args.outputMint === "string" ? args.outputMint : "";
    if (!BASE58_PUBKEY_REGEX.test(outputMint)) {
      return refusal("INVALID_INPUT", `invalid 'outputMint': expected base58 pubkey, got "${outputMint}"`);
    }
    if (inputMint === outputMint) {
      return refusal("INVALID_INPUT", "same-token-swap refused: inputMint and outputMint are identical");
    }
    const rawAmount = typeof args.amount === "string" ? args.amount : "";
    if (!/^[0-9]+$/.test(rawAmount) || rawAmount === "0") {
      return refusal("INVALID_INPUT", `invalid 'amount': expected a positive base-unit integer string, got "${rawAmount}"`);
    }

    // Track whether slippageBps was EXPLICITLY supplied (load-bearing for the MEV gate).
    const slippageExplicit = args.slippageBps !== undefined;
    let slippageBps: number;
    if (!slippageExplicit) {
      slippageBps = SOLANA_DEFAULT_SLIPPAGE_BPS;
    } else if (
      typeof args.slippageBps !== "number" ||
      !Number.isInteger(args.slippageBps) ||
      args.slippageBps < 1 ||
      args.slippageBps > 10000
    ) {
      return refusal("INVALID_INPUT", `invalid 'slippageBps': expected integer in [1, 10000], got ${String(args.slippageBps)}`);
    } else {
      slippageBps = args.slippageBps;
    }

    // ---- 2. demo-FIRST refusal → feePayer ----
    const demoActive = isDemoMode();
    let feePayerBase58: string;
    if (demoActive) {
      const persona = getActiveSolanaPersona();
      if (!persona) {
        return refusal(
          "WRONG_MODE",
          "demo mode is on but no Solana persona is set; call set_demo_wallet with a Solana persona slug first",
        );
      }
      feePayerBase58 = persona.solanaAddress;
    } else {
      const accounts = listAccounts({ chainFilter: "solana" });
      if (accounts.length === 0 || !accounts[0]) {
        return refusal("WALLET_NOT_PAIRED", "no paired Solana account; call pair_solana_ledger first");
      }
      feePayerBase58 = accounts[0].address;
    }

    // ---- 3. re-quote (asLegacyTransaction:true sent by the client) ----
    const quoteResult = await _jupiterClient.getQuote({ inputMint, outputMint, amount: rawAmount, slippageBps });
    if (quoteResult.kind === "rate-limited") {
      return refusal("BROADCAST_FAILED", "Jupiter quote API is rate-limited; retry shortly (set JUPITER_API_KEY for higher limits)");
    }
    if (quoteResult.kind === "error") {
      return refusal("BROADCAST_FAILED", "failed to fetch Jupiter quote", quoteResult.message);
    }
    const quote = quoteResult.quote;

    // ---- 4. ★ MEV REFUSAL GATE (SOL-W-13) ----
    // Pitfall 2 — priceImpactPct is a STRING FRACTION; ×100 for percent.
    const impactPct = Number(quote.priceImpactPct) * 100;
    if (impactPct > SOLANA_PRICE_IMPACT_REFUSAL_PCT && !slippageExplicit) {
      return refusal(
        "SANDWICH_MEV_REFUSED",
        `price impact (${impactPct.toFixed(4)}%) exceeds the ${SOLANA_PRICE_IMPACT_REFUSAL_PCT}% sandwich-MEV threshold; ` +
          "pass slippageBps explicitly to acknowledge the high price impact",
      );
    }

    // ---- 5. POST /swap (VERBATIM quoteResponse — Pitfall 4) ----
    const swapResult = await _jupiterClient.getSwapTransaction(quote, feePayerBase58);
    if (swapResult.kind === "rate-limited") {
      return refusal("BROADCAST_FAILED", "Jupiter swap API is rate-limited; retry shortly (set JUPITER_API_KEY for higher limits)");
    }
    if (swapResult.kind === "error") {
      // Pitfall 1 — a legacy-tx size overflow surfaces as a /swap error. HARD
      // structured refusal — NEVER a silent v0 fallback. Surface the cause so the
      // agent can advise a smaller amount / more-liquid pair.
      const tooLarge = /too large|size|1232/i.test(swapResult.message);
      return refusal(
        "INVALID_INPUT",
        tooLarge
          ? "Jupiter route exceeds the 1232-byte legacy-transaction size limit (hardware-wallet compat forces legacy; no v0 fallback). Retry with a smaller amount or a more-liquid pair."
          : "failed to build the Jupiter swap transaction",
        swapResult.message,
      );
    }

    // ---- 6. deserialize the LEGACY tx (v0 → typed refusal) ----
    let decode: ReturnType<typeof _jupiterProtocol.deserializeJupiterSwapTx>;
    try {
      decode = _jupiterProtocol.deserializeJupiterSwapTx(swapResult.swapTransaction);
    } catch (err) {
      if (err instanceof JupiterV0TransactionError) {
        return refusal("INVALID_INPUT", err.message, "jupiter-v0-transaction-refused");
      }
      return refusal("INVALID_INPUT", "failed to deserialize the Jupiter swap transaction", err instanceof Error ? err.message : String(err));
    }
    const { messageBytes, programIds, instructionSummary } = decode;

    // recentBlockhash + feePayer come from the Jupiter-built tx (do NOT mutate);
    // re-derive them from the decoded message for the handle surface.
    const txObj = (await import("@solana/web3.js")).Transaction.from(
      Buffer.from(swapResult.swapTransaction, "base64"),
    );
    const recentBlockhash = txObj.recentBlockhash ?? "";
    const feePayer = txObj.feePayer ? txObj.feePayer.toBase58() : feePayerBase58;
    // Defense-in-depth: the tx feePayer must be the resolved sender.
    if (feePayer !== feePayerBase58) {
      return refusal(
        "INVALID_INPUT",
        "Jupiter swap tx feePayer does not match the paired wallet — refusing (tamper signal)",
        "jupiter-feepayer-mismatch",
      );
    }
    // PublicKey construction (defense-in-depth — throws on malformed base58).
    let feePayerPubkey: PublicKey;
    try {
      feePayerPubkey = new PublicKey(feePayer);
    } catch (err) {
      return refusal("INVALID_INPUT", "invalid feePayer pubkey", err instanceof Error ? err.message : String(err));
    }

    // ---- 7. FROZEN binding — UNCHANGED ----
    const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });

    // ---- 8. createHandle (RAW agent strings on args; solana-typed tx) ----
    // NOTE: instructionSummary is omitted from the handle (the SolanaInstructionSummary
    // union is closed to native/spl; the jupiter summary is internal). The economics
    // surface comes from the QUOTE, not the summary — only programIds is load-bearing
    // for the Layer-0.5 dispatch gate. (Mirror of prepare_marginfi_supply.)
    void instructionSummary;
    const handle = createHandle({
      args: {
        to: outputMint,
        valueWei: "0",
        amount: rawAmount,
        mint: inputMint,
        recentBlockhash,
      },
      tx: {
        txType: "solana",
        chainId: 0,
        to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        valueWei: 0n,
        data: "0x" as `0x${string}`,
        messageBytes,
        feePayer: feePayerPubkey.toBase58(),
        recentBlockhash,
        programIds,
      },
      payloadFingerprint,
    });

    // ---- 9. PREPARE RECEIPT + CHECKS PERFORMED (from the QUOTE) + blind-sign ----
    const inSymbol = symbolOf(inputMint);
    const outSymbol = symbolOf(outputMint);
    const routeLabels = quote.routePlan.map((s) => s.swapInfo.label).join(" → ");
    const ledgerNotice = LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE.replace(
      "{INSTRUCTION_NAME}",
      "Jupiter v6 swap (route)",
    );

    const receipt = [
      "PREPARE RECEIPT (Solana — Jupiter v6 swap)",
      "  chain:           solana mainnet-beta",
      `  inputMint:       ${inputMint}`,
      `  outputMint:      ${outputMint}`,
      `  amount:          ${rawAmount} (raw base units)`,
      `  slippageBps:     ${slippageBps}${slippageExplicit ? " (explicit)" : " (default)"}`,
      `  recentBlockhash: ${recentBlockhash}`,
      "",
      "CHECKS PERFORMED (Jupiter quote economics — sourced from the QUOTE, not the opaque tx)",
      `  From:            ${quote.inAmount} ${inSymbol}`,
      `  To:              ${quote.outAmount} ${outSymbol} (min ${quote.otherAmountThreshold} after slippage)`,
      `  Price impact:    ${impactPct.toFixed(4)}%`,
      `  Route:           ${routeLabels || "(direct)"}`,
      "",
      ledgerNotice,
    ].join("\n");

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        inputMint,
        outputMint,
        amount: rawAmount,
        slippageBps,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        otherAmountThreshold: quote.otherAmountThreshold,
        priceImpactPct: quote.priceImpactPct,
        priceImpactPercent: impactPct,
        recentBlockhash,
        payloadFingerprint,
        txType: "solana" as const,
        feePayer: feePayerPubkey.toBase58(),
        programIds,
        blindSign: true,
        clearSign: false,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return refusal("INTERNAL_ERROR", "prepare_jupiter_swap failed", message);
  }
});
