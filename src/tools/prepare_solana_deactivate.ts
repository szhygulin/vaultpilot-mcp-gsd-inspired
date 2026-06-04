// src/tools/prepare_solana_deactivate.ts — Phase 15 Plan 15-01 (SOL-W-18).
//
// Prepare an unsigned native SOL deactivate tx. Mirrors the prepare_solana_spl_send
// spine. Deactivate begins the ~2-day cooldown after which native withdraw
// succeeds. Blind-sign DEFAULT (research A4) — LEDGER NOTICE + blindSign:true.
// Fixture G anchor.

import { PublicKey } from "@solana/web3.js";

import { _solanaRegistry } from "../chains/solana/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { _solanaStake } from "../protocols/solana-stake.js";
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

const BASE58_PUBKEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
  "Prepare an unsigned native SOL stake DEACTIVATION on Solana mainnet-beta — begins the cooldown for an existing delegated stake account.",
  "Use when the user wants to UNSTAKE native SOL: deactivate first, then (after the ~2-day cooldown completes) call prepare_solana_withdraw.",
  "`stakeAccount` is the existing stake account base58 pubkey (32-44 chars) to deactivate.",
  "BLIND-SIGN: the Ledger Solana app does NOT clear-sign Stake Program instructions — your device shows only the message hash. Enable blind-signing; verify the PREPARE RECEIPT args; the on-device hash match is the trust anchor.",
  "Requires a paired Solana Ledger (real mode) or an active Solana persona (demo mode).",
  "Returns { handle, stakeAccount, recentBlockhash, payloadFingerprint, txType: \"solana\", feePayer } + a PREPARE RECEIPT. Pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT (malformed stakeAccount), BROADCAST_FAILED (RPC failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    stakeAccount: {
      type: "string",
      description: "Existing stake account base58 pubkey (32-44 chars) to deactivate.",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
  },
  required: ["stakeAccount"],
  additionalProperties: false,
};

registerTool("prepare_solana_deactivate", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const stakeAccountArg = typeof args.stakeAccount === "string" ? args.stakeAccount : "";
    if (!BASE58_PUBKEY_REGEX.test(stakeAccountArg)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: invalid 'stakeAccount' pubkey: "${stakeAccountArg}"` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'stakeAccount' pubkey: ${stakeAccountArg}`),
      };
    }

    const demoActive = isDemoMode();
    let feePayerBase58: string;
    if (demoActive) {
      const persona = getActiveSolanaPersona();
      if (!persona) {
        return {
          isError: true,
          content: [{ type: "text", text: "error: demo mode is on but no Solana persona is set. Call set_demo_wallet first." }],
          structuredContent: errEnvelope("WRONG_MODE", "demo mode is on but no Solana persona is set; call set_demo_wallet first"),
        };
      }
      feePayerBase58 = persona.solanaAddress;
    } else {
      const accounts = listAccounts({ chainFilter: "solana" });
      if (accounts.length === 0 || !accounts[0]) {
        return {
          isError: true,
          content: [{ type: "text", text: "error: no paired Solana account. Call pair_solana_ledger first." }],
          structuredContent: errEnvelope("WALLET_NOT_PAIRED", "no paired Solana account; call pair_solana_ledger first"),
        };
      }
      feePayerBase58 = accounts[0].address;
    }

    let blockhash: string;
    try {
      const { blockhash: bh } = await _solanaRegistry.getConnection().getLatestBlockhash();
      blockhash = bh;
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `error: failed to fetch recent blockhash: ${cause}` }],
        structuredContent: errEnvelope("BROADCAST_FAILED", "failed to fetch recent blockhash", cause),
      };
    }

    const feePayer = new PublicKey(feePayerBase58);
    const stakeAccount = new PublicKey(stakeAccountArg);

    const instructions = _solanaStake.buildDeactivateIxs({
      stakeAccount,
      authorizedPubkey: feePayer,
    });
    const { messageBytes, programIds } = _solanaStake.assembleStakeTx({
      instructions,
      ixNames: ["StakeProgram.deactivate"],
      feePayer,
      recentBlockhash: blockhash,
    });

    const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });

    const handle = createHandle({
      args: { to: stakeAccountArg, valueWei: "0", amount: "0", recentBlockhash: blockhash },
      tx: {
        txType: "solana",
        chainId: 0,
        to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        valueWei: 0n,
        data: "0x" as `0x${string}`,
        messageBytes,
        feePayer: feePayer.toBase58(),
        recentBlockhash: blockhash,
        programIds,
      },
      payloadFingerprint,
    });

    const ledgerNotice = LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE.replace(
      "{INSTRUCTION_NAME}",
      "native Stake Program deactivate",
    );
    const receipt = [
      "PREPARE RECEIPT (Solana — native stake deactivate)",
      "  chain:           solana mainnet-beta",
      `  stakeAccount:    ${stakeAccountArg}`,
      `  recentBlockhash: ${blockhash}`,
      "  NOTICE: deactivation begins a ~2-day cooldown; native withdraw succeeds on-chain only after it completes (the simulation gate is the backstop).",
      "",
      ledgerNotice,
    ].join("\n");

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        stakeAccount: stakeAccountArg,
        recentBlockhash: blockhash,
        payloadFingerprint,
        txType: "solana" as const,
        feePayer: feePayer.toBase58(),
        blindSign: true,
        clearSign: false,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: prepare_solana_deactivate failed: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_solana_deactivate failed", message),
    };
  }
});
