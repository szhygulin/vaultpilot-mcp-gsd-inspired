// src/tools/prepare_kamino_supply.ts — Phase 13 Plan 13-05 (SOL-W-07).
//
// Prepare an unsigned Kamino `depositReserveLiquidityAndObligationCollateral`
// (supply) tx, hand-encoded from the IDL (D-01), carrying the in-tx refresh
// ceremony (refreshReserve × N + refreshObligation) before the op (Pattern 2).
//
// D-03 hard-refuse gate: when the wallet's Obligation PDA is ABSENT, refuse with
// errorCode INVALID_INPUT + solanaErrorCode VP_S007, NO handle minted — redirect
// to prepare_kamino_obligation_init. Present → handle + receipt + fingerprint
// (Fixture T cross-link) + blind-sign LEDGER NOTICE (no clear-sign CAL).

import { PublicKey, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { _kamino } from "../protocols/kamino.js";
import { registerTool } from "./index.js";
import {
  BASE58_PUBKEY_REGEX,
  errEnvelope,
  finalizeKaminoOp,
  parseAmount,
  prepareKaminoOpContext,
} from "./_kamino_prepare_shared.js";

const DESCRIPTION = [
  "Prepare an unsigned Kamino supply (deposit) transaction on Solana — depositReserveLiquidityAndObligationCollateral, hand-encoded from the IDL, with the in-tx refreshReserve + refreshObligation ceremony.",
  "Use when the user wants to supply/deposit an asset into a Kamino reserve. Do NOT use for borrow/withdraw/repay (separate tools), MarginFi (prepare_marginfi_*), or EVM lending.",
  "REQUIRES an existing Obligation: if the wallet has none, this tool REFUSES (no handle, solanaErrorCode VP_S007) and you must call prepare_kamino_obligation_init first.",
  "`reserve` is the Kamino reserve pubkey for the asset (base58). `amount` is HUMAN UNITS as a decimal string (e.g. \"100.5\") — the server reads the reserve's mint decimals and parses strictly.",
  "BLIND-SIGN: the Ledger Solana app does NOT clear-sign Kamino (Anchor) instructions — your device shows only the message hash. Enable blind-signing; verify the PREPARE RECEIPT args; the on-device hash match is the trust anchor.",
  "Requires a paired Solana Ledger (real mode) or an active Solana persona (demo mode).",
  "Returns { handle, reserve, mint, amount, decimals, obligationPda, recentBlockhash, payloadFingerprint, txType: \"solana\" } + a PREPARE RECEIPT. Pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT (malformed reserve/amount OR Obligation absent → VP_S007), BROADCAST_FAILED (RPC failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    reserve: {
      type: "string",
      description: "Kamino reserve pubkey for the asset (base58, 32-44 chars).",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in HUMAN UNITS (e.g. \"100.5\"). The server resolves the reserve's mint decimals and parses strictly.",
    },
  },
  required: ["reserve", "amount"],
  additionalProperties: false,
};

registerTool("prepare_kamino_supply", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const reserveStr = typeof args.reserve === "string" ? args.reserve : "";
    if (!BASE58_PUBKEY_REGEX.test(reserveStr)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: invalid 'reserve' pubkey: "${reserveStr}"` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'reserve' pubkey: ${reserveStr}`),
      };
    }
    const rawAmount = typeof args.amount === "string" ? args.amount : "";

    const prep = await prepareKaminoOpContext();
    if (!prep.ok) return prep.result;
    const { ctx } = prep;

    const reserve = ctx.reservesByPubkey.get(reserveStr);
    if (!reserve) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: reserve ${reserveStr} is not part of this Obligation (no collateral/debt position). Supply to a reserve already in the obligation, or initialize a position first.`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `reserve ${reserveStr} not part of the obligation`,
        ),
      };
    }

    const amt = parseAmount(rawAmount, reserve.mintDecimals);
    if (!amt.ok) return amt.result;

    const userSourceLiquidity = await getAssociatedTokenAddress(
      new PublicKey(reserve.mint),
      ctx.authority,
    );

    const opIx = _kamino.buildDepositIx({
      amount: amt.amount,
      accounts: {
        owner: ctx.authority,
        obligation: ctx.obligation,
        lendingMarket: ctx.market,
        lendingMarketAuthority: ctx.lendingMarketAuthority,
        reserve: new PublicKey(reserve.reserve),
        reserveLiquidityMint: new PublicKey(reserve.mint),
        reserveLiquiditySupply: new PublicKey(reserve.liquiditySupplyVault),
        reserveCollateralMint: new PublicKey(reserve.collateralMint),
        reserveDestinationDepositCollateral: new PublicKey(reserve.collateralSupplyVault),
        userSourceLiquidity,
        collateralTokenProgram: TOKEN_PROGRAM_ID,
        liquidityTokenProgram: TOKEN_PROGRAM_ID,
      },
    });
    // SystemProgram referenced to keep the import meaningful for future ATA
    // creation; no-op marker so lint does not flag the import unused.
    void SystemProgram.programId;

    return finalizeKaminoOp({
      ctx,
      opIx,
      opName: "depositReserveLiquidityAndObligationCollateral (supply)",
      rawArgs: { reserve: reserveStr, amount: rawAmount },
      receiptLines: [
        "PREPARE RECEIPT (Solana — Kamino supply)",
        `  authority:       ${ctx.authorityBase58}`,
        `  Obligation PDA:  ${ctx.obligation.toBase58()}`,
        `  reserve:         ${reserveStr}`,
        `  mint:            ${reserve.mint}`,
        `  amount:          ${rawAmount} (decimals ${reserve.mintDecimals})`,
        `  recent blockhash:${ctx.recentBlockhash}`,
      ],
      structured: {
        reserve: reserveStr,
        mint: reserve.mint,
        amount: rawAmount,
        decimals: reserve.mintDecimals,
        obligationPda: ctx.obligation.toBase58(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: prepare_kamino_supply failed: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_kamino_supply failed", message),
    };
  }
});
