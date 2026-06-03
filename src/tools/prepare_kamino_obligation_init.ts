// src/tools/prepare_kamino_obligation_init.ts — Phase 13 Plan 13-06 (SOL-W-08).
//
// Prepare the unsigned Kamino 2-step obligation setup — initUserMetadata THEN
// initObligation (V9: initObligation requires userMetadata to exist first) — in
// ONE tx (one device approval = "set me up on Kamino"; the one-intent-per-screen
// precedent of prepare_revoke_approval). Hand-encoded from the IDL (D-01),
// seed-tagged Obligation PDA + UserMetadata PDA derived via the 13-01 SOT helpers
// (NEVER hand-rolled).
//
// This tool does NOT gate on Obligation-presence — it CREATES the obligation;
// D-03's VP_S007 refuse applies to the OP tools (supply/withdraw/borrow/repay),
// which redirect here. Returns handle + PREPARE RECEIPT + blind-sign LEDGER
// NOTICE (no clear-sign CAL — V11/SC-7). Flows through the FROZEN binding.

import { PublicKey } from "@solana/web3.js";

import { _solanaRegistry } from "../chains/solana/registry.js";
import { isDemoMode } from "../config/env.js";
import {
  deriveKaminoObligationPda,
  deriveKaminoUserMetadataPda,
  getKaminoMainMarket,
} from "../config/contracts.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { _kamino } from "../protocols/kamino.js";
import { LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE } from "../signing/blocks-solana.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computeSolanaPayloadFingerprint } from "../signing/payload-fingerprint-solana.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

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

const DESCRIPTION = [
  "Prepare the unsigned Kamino obligation-setup transaction on Solana — the 2-step initUserMetadata + initObligation pair in ONE tx, hand-encoded from the IDL.",
  "This is the \"set me up on Kamino\" tool. Call it BEFORE any Kamino supply/withdraw/borrow/repay: those op tools REFUSE with solanaErrorCode VP_S007 when the wallet has no Obligation and redirect here.",
  "Does NOT gate on obligation-presence (it CREATES the obligation). Takes NO asset/amount args — it only initializes the per-wallet UserMetadata PDA + Obligation PDA.",
  "BLIND-SIGN: the Ledger Solana app does NOT clear-sign Kamino (Anchor) instructions — your device shows only the message hash. Enable blind-signing; verify the PREPARE RECEIPT; the on-device hash match is the trust anchor.",
  "Requires a paired Solana Ledger (real mode) or an active Solana persona (demo mode).",
  "Returns { handle, owner, obligationPda, userMetadataPda, recentBlockhash, payloadFingerprint, txType: \"solana\" } + a PREPARE RECEIPT. Pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, BROADCAST_FAILED (RPC failure fetching the blockhash).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  required: [],
  additionalProperties: false,
};

registerTool("prepare_kamino_obligation_init", DESCRIPTION, INPUT_SCHEMA, async () => {
  try {
    // Demo-mode FIRST refusal + authority resolution.
    let authorityBase58: string;
    if (isDemoMode()) {
      const persona = getActiveSolanaPersona();
      if (!persona) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: demo mode is on but no Solana persona is set. Call set_demo_wallet first.",
            },
          ],
          structuredContent: errEnvelope(
            "WRONG_MODE",
            "demo mode is on but no Solana persona is set; call set_demo_wallet first",
          ),
        };
      }
      authorityBase58 = persona.solanaAddress;
    } else {
      const accounts = listAccounts({ chainFilter: "solana" });
      if (accounts.length === 0 || !accounts[0]) {
        return {
          isError: true,
          content: [
            { type: "text", text: "error: no paired Solana account. Call pair_solana_ledger first." },
          ],
          structuredContent: errEnvelope(
            "WALLET_NOT_PAIRED",
            "no paired Solana account; call pair_solana_ledger first",
          ),
        };
      }
      authorityBase58 = accounts[0].address;
    }

    const market = getKaminoMainMarket();
    const obligationPda = deriveKaminoObligationPda(market, authorityBase58);
    const userMetadataPda = deriveKaminoUserMetadataPda(authorityBase58);
    const authority = new PublicKey(authorityBase58);

    // Recent blockhash.
    let recentBlockhash: string;
    try {
      const { blockhash } = await _solanaRegistry.getConnection().getLatestBlockhash();
      recentBlockhash = blockhash;
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `error: failed to fetch recent blockhash: ${cause}` }],
        structuredContent: errEnvelope("BROADCAST_FAILED", "failed to fetch recent blockhash", cause),
      };
    }

    // Build the ordered 2-ix pair (initUserMetadata FIRST — V9).
    const initUserMetaIx = _kamino.buildInitUserMetadataIx({
      owner: authority,
      feePayer: authority,
      userMetadata: new PublicKey(userMetadataPda),
    });
    const initObligationIx = _kamino.buildInitObligationIx({
      obligationOwner: authority,
      feePayer: authority,
      obligation: new PublicKey(obligationPda),
      lendingMarket: new PublicKey(market),
      ownerUserMetadata: new PublicKey(userMetadataPda),
    });

    const assembled = _kamino.assembleKaminoTx({
      instructions: [initUserMetaIx, initObligationIx],
      ixNames: ["initUserMetadata", "initObligation"],
      oracleProgramIds: [],
      feePayer: authority,
      recentBlockhash,
    });

    const payloadFingerprint = computeSolanaPayloadFingerprint({
      messageBytes: assembled.messageBytes,
    });

    const handle = createHandle({
      args: { to: obligationPda, valueWei: "0", recentBlockhash },
      tx: {
        txType: "solana",
        chainId: 0,
        to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        valueWei: 0n,
        data: "0x" as `0x${string}`,
        messageBytes: assembled.messageBytes,
        feePayer: authority.toBase58(),
        recentBlockhash,
        programIds: assembled.programIds,
      },
      payloadFingerprint,
    });

    const ledgerNotice = LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE.replace(
      "{INSTRUCTION_NAME}",
      "Kamino initUserMetadata + initObligation (obligation setup)",
    );
    const receipt = [
      "PREPARE RECEIPT (Solana — Kamino obligation init)",
      `  authority:        ${authorityBase58}`,
      `  Obligation PDA:   ${obligationPda}`,
      `  UserMetadata PDA: ${userMetadataPda}`,
      `  steps:            initUserMetadata, then initObligation (one tx)`,
      `  recent blockhash: ${recentBlockhash}`,
      "",
      ledgerNotice,
    ].join("\n");

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        owner: authorityBase58,
        obligationPda,
        userMetadataPda,
        recentBlockhash,
        payloadFingerprint,
        txType: "solana" as const,
        feePayer: authority.toBase58(),
        programIds: assembled.programIds,
        blindSign: true,
        clearSign: false,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_kamino_obligation_init failed: ${message}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "prepare_kamino_obligation_init failed",
        message,
      ),
    };
  }
});
