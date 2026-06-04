// src/tools/prepare_jito_stake_pool_deposit.ts — Phase 15 Plan 15-03 (SOL-W-16).
//
// Prepare an unsigned Jito SPL-stake-pool DepositSol (SOL → jitoSOL). Mirrors the
// prepare_solana_spl_send / prepare_marginfi_supply spine. Hand-encoded DepositSol
// (D-01, Fixture AB — pinned variant tag 14 + u64 lamports).
//
// DEPOSIT-ONLY (15-CONTEXT): the unmissable
// `[NOTICE — Jito stake-pool unstake not yet supported]` block is emitted on EVERY
// successful prepare (informational — the deposit STILL succeeds). Blind-sign
// DEFAULT (research A4) — LEDGER NOTICE + blindSign:true.

import {
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

import { _jitoChain } from "../chains/solana/jito-stake-pool.js";
import { _solanaRegistry } from "../chains/solana/registry.js";
import { isDemoMode } from "../config/env.js";
import { getJitoSolMint } from "../config/contracts.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { _jitoStakePool } from "../protocols/jito-stake-pool.js";
import {
  InvalidAmountError,
  parseSolanaAmountStrict,
} from "../signing/amount-solana.js";
import {
  JITO_UNSTAKE_NOT_SUPPORTED_NOTICE_TEMPLATE,
  LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE,
} from "../signing/blocks-solana.js";
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
  "Prepare an unsigned Jito stake-pool deposit transaction on Solana mainnet-beta — stakes native SOL and mints liquid jitoSOL.",
  "Use when the user wants LIQUID staking via Jito (jitoSOL stays tradeable). For Marinade use prepare_marinade_stake; for native (non-liquid) staking use prepare_solana_delegate.",
  "DEPOSIT-ONLY: Jito stake-pool UNSTAKE (jitoSOL → SOL) is NOT yet supported (deferred per the upstream withdrawal-authority gap). Every prepare emits an unmissable [NOTICE — Jito stake-pool unstake not yet supported] block. To exit jitoSOL today, swap it on a DEX (e.g. Jupiter).",
  "`lamports` is the SOL amount to deposit in RAW LAMPORTS as a decimal string (1 SOL = 1000000000 lamports). Strict integer parse.",
  "If you do not yet hold jitoSOL, the prepared tx ALSO creates your jitoSOL token account (~0.002 SOL rent, paid by you).",
  "BLIND-SIGN: the Ledger Solana app does NOT clear-sign SPL-stake-pool instructions — your device shows only the message hash. Enable blind-signing; verify the PREPARE RECEIPT args; the on-device hash match is the trust anchor.",
  "Requires a paired Solana Ledger (real mode) or an active Solana persona (demo mode).",
  "Returns { handle, lamports, jitoSolMint, jitoSolAta, createJitoSolAta, recentBlockhash, payloadFingerprint, txType: \"solana\", feePayer } + a PREPARE RECEIPT + the unstake-not-supported NOTICE. Pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT (malformed lamports), BROADCAST_FAILED (RPC failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    lamports: {
      type: "string",
      description: "SOL to deposit in RAW LAMPORTS as a decimal string (1 SOL = 1000000000 lamports).",
    },
  },
  required: ["lamports"],
  additionalProperties: false,
};

registerTool("prepare_jito_stake_pool_deposit", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
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
    const jitoSolMint = new PublicKey(getJitoSolMint());

    // Resolve the Jito pool-internal accounts (StakePool read + withdraw PDA) +
    // the user's jitoSOL destination ATA.
    let resolved: Awaited<ReturnType<typeof _jitoChain.resolveJitoAccounts>>;
    let destAta: PublicKey;
    let createJitoSolAta: boolean;
    try {
      resolved = await _jitoChain.resolveJitoAccounts();
      destAta = await getAssociatedTokenAddress(jitoSolMint, feePayer);
      const ataInfo = await _solanaRegistry.getConnection().getAccountInfo(destAta);
      createJitoSolAta = ataInfo === null;
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `error: failed to resolve Jito stake-pool accounts: ${cause}` }],
        structuredContent: errEnvelope("BROADCAST_FAILED", "failed to resolve Jito stake-pool accounts", cause),
      };
    }

    const depositIx = _jitoStakePool.buildDepositSolIx({
      accounts: {
        stakePool: resolved.stakePool,
        withdrawAuthority: resolved.withdrawAuthority,
        reserveStake: resolved.reserveStake,
        fundingAccount: feePayer,
        destinationPoolAccount: destAta,
        managerFeeAccount: resolved.managerFeeAccount,
        // No-referral deposit: referralPoolAccount defaults to the destination ATA
        // (mirror the SDK high-level depositSol referrer default).
        referralPoolAccount: destAta,
        poolMint: resolved.poolMint,
      },
      lamports,
    });

    let messageBytes: Uint8Array;
    let programIds: string[];
    const depositAssembled = _jitoStakePool.assembleJitoTx({ instruction: depositIx, feePayer, recentBlockhash: blockhash, ixName: "DepositSol" });
    if (createJitoSolAta) {
      const createIx = createAssociatedTokenAccountInstruction(feePayer, destAta, feePayer, jitoSolMint);
      const tx = new Transaction({ recentBlockhash: blockhash, feePayer });
      tx.add(createIx);
      tx.add(depositIx);
      messageBytes = new Uint8Array(tx.serializeMessage());
      programIds = [...new Set([createIx.programId.toBase58(), ...depositAssembled.programIds])];
    } else {
      messageBytes = depositAssembled.messageBytes;
      programIds = depositAssembled.programIds;
    }

    const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });

    const handle = createHandle({
      args: { to: getJitoSolMint(), valueWei: "0", amount: rawLamports, recentBlockhash: blockhash },
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
      "Jito stake-pool DepositSol (stake SOL → jitoSOL)",
    );
    const receiptLines = [
      "PREPARE RECEIPT (Solana — Jito stake-pool deposit)",
      "  chain:           solana mainnet-beta",
      `  lamports:        ${rawLamports}`,
      `  jitoSolMint:     ${getJitoSolMint()}`,
      `  jitoSOL ATA:     ${destAta.toBase58()}`,
      `  recentBlockhash: ${blockhash}`,
    ];
    if (createJitoSolAta) {
      receiptLines.push("  NOTICE: you do not yet hold jitoSOL. This tx will also create your jitoSOL token account (rent ~0.002 SOL, paid by you).");
    }
    receiptLines.push(
      "",
      // The unstake-not-supported NOTICE is UNMISSABLE on every successful prepare.
      JITO_UNSTAKE_NOT_SUPPORTED_NOTICE_TEMPLATE,
      "",
      ledgerNotice,
    );

    return {
      content: [{ type: "text", text: receiptLines.join("\n") }],
      structuredContent: {
        handle,
        lamports: rawLamports,
        jitoSolMint: getJitoSolMint(),
        jitoSolAta: destAta.toBase58(),
        createJitoSolAta,
        unstakeSupported: false,
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
      content: [{ type: "text", text: `error: prepare_jito_stake_pool_deposit failed: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_jito_stake_pool_deposit failed", message),
    };
  }
});
