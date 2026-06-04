// src/tools/prepare_solana_withdraw.ts — Phase 15 Plan 15-01 (SOL-W-19).
//
// Prepare an unsigned native SOL withdraw tx (deactivated stake → wallet).
// Mirrors the prepare_solana_spl_send spine. Open Q3: a NOTICE warns that native
// withdraw fails on-chain before the ~2-day deactivation window completes — NOT a
// hard refuse (the Layer-0.7 simulation gate is the backstop). Blind-sign DEFAULT
// (research A4). Fixture H anchor.

import { PublicKey } from "@solana/web3.js";

import { _solanaRegistry } from "../chains/solana/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { _solanaStake } from "../protocols/solana-stake.js";
import {
  InvalidAmountError,
  parseSolanaAmountStrict,
} from "../signing/amount-solana.js";
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
  "Prepare an unsigned native SOL stake WITHDRAW on Solana mainnet-beta — moves lamports from a deactivated stake account to a destination wallet.",
  "Use as the FINAL step of native unstaking, AFTER prepare_solana_deactivate and the ~2-day cooldown completes. Withdrawing before the cooldown ends fails on-chain.",
  "`stakeAccount` is the deactivated stake account base58 pubkey. `to` is the destination WALLET base58 pubkey. `lamports` is the amount in RAW LAMPORTS as a decimal string (1 SOL = 1000000000 lamports).",
  "BLIND-SIGN: the Ledger Solana app does NOT clear-sign Stake Program instructions — your device shows only the message hash. Enable blind-signing; verify the PREPARE RECEIPT args; the on-device hash match is the trust anchor.",
  "Requires a paired Solana Ledger (real mode) or an active Solana persona (demo mode).",
  "Returns { handle, stakeAccount, to, lamports, recentBlockhash, payloadFingerprint, txType: \"solana\", feePayer } + a PREPARE RECEIPT. Pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT (malformed stakeAccount/to/lamports), BROADCAST_FAILED (RPC failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    stakeAccount: {
      type: "string",
      description: "Deactivated stake account base58 pubkey (32-44 chars).",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    to: {
      type: "string",
      description: "Destination WALLET base58 pubkey (32-44 chars) to receive the withdrawn lamports.",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    lamports: {
      type: "string",
      description: "Amount in RAW LAMPORTS as a decimal string (1 SOL = 1000000000 lamports). Strict integer parse.",
    },
  },
  required: ["stakeAccount", "to", "lamports"],
  additionalProperties: false,
};

registerTool("prepare_solana_withdraw", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const stakeAccountArg = typeof args.stakeAccount === "string" ? args.stakeAccount : "";
    if (!BASE58_PUBKEY_REGEX.test(stakeAccountArg)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: invalid 'stakeAccount' pubkey: "${stakeAccountArg}"` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'stakeAccount' pubkey: ${stakeAccountArg}`),
      };
    }
    const toArg = typeof args.to === "string" ? args.to : "";
    if (!BASE58_PUBKEY_REGEX.test(toArg)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: invalid 'to' pubkey: "${toArg}"` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'to' pubkey: ${toArg}`),
      };
    }
    const rawLamports = typeof args.lamports === "string" ? args.lamports : "";

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

    let lamports: bigint;
    try {
      lamports = parseSolanaAmountStrict(rawLamports, 0);
    } catch (err) {
      if (err instanceof InvalidAmountError) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: invalid 'lamports': ${err.message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", `invalid 'lamports': ${err.message}`, err.kind),
        };
      }
      throw err;
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
    const toPubkey = new PublicKey(toArg);

    const instructions = _solanaStake.buildWithdrawIxs({
      stakeAccount,
      authorizedPubkey: feePayer,
      toPubkey,
      lamports,
    });
    const { messageBytes, programIds } = _solanaStake.assembleStakeTx({
      instructions,
      ixNames: ["StakeProgram.withdraw"],
      feePayer,
      recentBlockhash: blockhash,
    });

    const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });

    const handle = createHandle({
      args: { to: toArg, valueWei: "0", amount: rawLamports, recentBlockhash: blockhash },
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
      "native Stake Program withdraw",
    );
    const receipt = [
      "PREPARE RECEIPT (Solana — native stake withdraw)",
      "  chain:           solana mainnet-beta",
      `  stakeAccount:    ${stakeAccountArg}`,
      `  to:              ${toArg}`,
      `  lamports:        ${rawLamports}`,
      `  recentBlockhash: ${blockhash}`,
      "  NOTICE: native withdraw fails on-chain if the stake account's ~2-day deactivation window has not completed. The simulation gate at preview is the backstop.",
      "",
      ledgerNotice,
    ].join("\n");

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        stakeAccount: stakeAccountArg,
        to: toArg,
        lamports: rawLamports,
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
      content: [{ type: "text", text: `error: prepare_solana_withdraw failed: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_solana_withdraw failed", message),
    };
  }
});
