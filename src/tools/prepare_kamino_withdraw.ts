// src/tools/prepare_kamino_withdraw.ts — Phase 13 Plan 13-05 (SOL-W-07).
//
// Prepare an unsigned Kamino
// `withdrawObligationCollateralAndRedeemReserveCollateral` tx, hand-encoded from
// the IDL (D-01), carrying the MULTI-RESERVE refresh ceremony (refreshReserve
// for EACH distinct collateral+debt reserve + refreshObligation) before the op
// (Pattern 2 — withdraw reads collateral value across reserves).
//
// D-03 hard-refuse gate: Obligation PDA absent → VP_S007, NO handle. Present →
// handle + receipt + fingerprint (Fixture U cross-link) + blind-sign LEDGER
// NOTICE.

import { PublicKey } from "@solana/web3.js";
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
  "Prepare an unsigned Kamino withdraw transaction on Solana — withdrawObligationCollateralAndRedeemReserveCollateral, hand-encoded from the IDL, with the in-tx MULTI-RESERVE refreshReserve + refreshObligation ceremony (every collateral + debt reserve is refreshed before the withdraw).",
  "Use when the user wants to withdraw supplied collateral from a Kamino reserve. Do NOT use for supply/borrow/repay (separate tools), MarginFi, or EVM lending.",
  "REQUIRES an existing Obligation: if the wallet has none, this tool REFUSES (no handle, solanaErrorCode VP_S007) and you must call prepare_kamino_obligation_init first.",
  "`reserve` is the Kamino reserve pubkey for the collateral asset (base58). `amount` is HUMAN UNITS as a decimal string — the server reads the reserve's mint decimals and parses strictly.",
  "BLIND-SIGN: the Ledger Solana app does NOT clear-sign Kamino (Anchor) instructions — your device shows only the message hash. Enable blind-signing; verify the PREPARE RECEIPT args.",
  "Requires a paired Solana Ledger (real mode) or an active Solana persona (demo mode).",
  "Returns { handle, reserve, mint, amount, decimals, obligationPda, recentBlockhash, payloadFingerprint, txType: \"solana\" } + a PREPARE RECEIPT.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT (malformed reserve/amount OR Obligation absent → VP_S007), BROADCAST_FAILED.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    reserve: {
      type: "string",
      description: "Kamino reserve pubkey for the collateral asset (base58, 32-44 chars).",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    amount: {
      type: "string",
      description: "Decimal string in HUMAN UNITS. The server resolves the reserve's mint decimals.",
    },
  },
  required: ["reserve", "amount"],
  additionalProperties: false,
};

registerTool("prepare_kamino_withdraw", DESCRIPTION, INPUT_SCHEMA, async (args) => {
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
            text: `error: reserve ${reserveStr} is not part of this Obligation (no collateral position to withdraw).`,
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

    const userDestinationLiquidity = await getAssociatedTokenAddress(
      new PublicKey(reserve.mint),
      ctx.authority,
    );

    const opIx = _kamino.buildWithdrawIx({
      amount: amt.amount,
      accounts: {
        owner: ctx.authority,
        obligation: ctx.obligation,
        lendingMarket: ctx.market,
        lendingMarketAuthority: ctx.lendingMarketAuthority,
        withdrawReserve: new PublicKey(reserve.reserve),
        reserveLiquidityMint: new PublicKey(reserve.mint),
        reserveSourceCollateral: new PublicKey(reserve.collateralSupplyVault),
        reserveCollateralMint: new PublicKey(reserve.collateralMint),
        reserveLiquiditySupply: new PublicKey(reserve.liquiditySupplyVault),
        userDestinationLiquidity,
        collateralTokenProgram: TOKEN_PROGRAM_ID,
        liquidityTokenProgram: TOKEN_PROGRAM_ID,
      },
    });

    return finalizeKaminoOp({
      ctx,
      opIx,
      opName: "withdrawObligationCollateralAndRedeemReserveCollateral (withdraw)",
      rawArgs: { reserve: reserveStr, amount: rawAmount },
      receiptLines: [
        "PREPARE RECEIPT (Solana — Kamino withdraw)",
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
      content: [{ type: "text", text: `error: prepare_kamino_withdraw failed: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_kamino_withdraw failed", message),
    };
  }
});
