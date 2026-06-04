// src/tools/prepare_solana_delegate.ts — Phase 15 Plan 15-01 (SOL-W-17).
//
// Prepare an unsigned native SOL delegate tx. Mirrors the prepare_solana_spl_send
// / prepare_marginfi_supply spine: demo-FIRST refusal → input validation →
// real-mode pairing check → recent-blockhash → build ix vector via _solanaStake →
// assembleStakeTx → computeSolanaPayloadFingerprint [FROZEN] → createHandle →
// return { handle, …raw args, … } + PREPARE RECEIPT + LEDGER NOTICE (blind-sign).
//
// Two paths:
//   - stakeAccount SUPPLIED → existing-account delegate (Fixture E).
//   - stakeAccount ABSENT   → delegate-with-create BUNDLE via createAccountWithSeed
//     (Fixture F) — a DETERMINISTIC, user-authority-controlled stake address (NO
//     ephemeral keypair, Pitfall 3 / A3). The derived address is surfaced in the
//     response + PREPARE RECEIPT NOTICE.
//
// Open Q2 (vote-account UX): a NOTICE block surfaces the vote account and, when
// resolvable, the validator commission % (read via Connection.getVoteAccounts —
// mocked at the Connection boundary in tests). NOT a hard refuse.
//
// Blind-sign DEFAULT (research A4 / SC #6): Stake Program ix are not documented
// clear-signed; every native-stake tool emits LEDGER NOTICE + blindSign:true.

import { PublicKey } from "@solana/web3.js";

import { _solanaRegistry } from "../chains/solana/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { _solanaStake, STAKE_SEED } from "../protocols/solana-stake.js";
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

// The rent-exempt minimum for a stake account. The on-chain rent floor for a
// StakeProgram account (StakeProgram.space = 200 bytes) is ~0.00228288 SOL; we
// pin a stable canonical literal so the create-bundle fixture (F) is
// deterministic. The live value rarely changes; production re-funds to at least
// this floor. (2_282_880 lamports = the documented rent-exempt minimum for a
// 200-byte stake account.)
const STAKE_RENT_EXEMPT_LAMPORTS = 2_282_880n;

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
  "Prepare an unsigned native SOL stake delegation on Solana mainnet-beta — delegates a stake account to a validator vote account.",
  "Use when the user wants to STAKE native SOL with a specific validator (not liquid staking — for mSOL use prepare_marinade_stake, for jitoSOL use prepare_jito_stake_pool_deposit).",
  "`voteAccount` is the validator's VOTE account base58 pubkey (32-44 chars). `lamports` is the stake amount in RAW LAMPORTS as a decimal string (1 SOL = 1000000000 lamports).",
  "`stakeAccount` (optional) is an existing stake account base58 pubkey. If omitted, this tool CREATES a deterministic stake account via createAccountWithSeed (controlled by your wallet — no second signer) and delegates it in one atomic tx; the derived address is surfaced in the PREPARE RECEIPT.",
  "BLIND-SIGN: the Ledger Solana app does NOT clear-sign Stake Program instructions — your device shows only the message hash. Enable blind-signing; verify the PREPARE RECEIPT args; the on-device hash match is the trust anchor.",
  "Requires a paired Solana Ledger (real mode) or an active Solana persona (demo mode).",
  "Returns { handle, voteAccount, lamports, stakeAccount, createdStakeAccount, recentBlockhash, payloadFingerprint, txType: \"solana\", feePayer } + a PREPARE RECEIPT. Pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT (malformed voteAccount/stakeAccount/lamports), BROADCAST_FAILED (RPC failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    voteAccount: {
      type: "string",
      description: "Validator VOTE account base58 pubkey (32-44 chars).",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    lamports: {
      type: "string",
      description:
        "Stake amount in RAW LAMPORTS as a decimal string (1 SOL = 1000000000 lamports). Strict integer parse.",
    },
    stakeAccount: {
      type: "string",
      description:
        "Optional existing stake account base58 pubkey. If omitted, a deterministic stake account is created via createAccountWithSeed and delegated atomically.",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
  },
  required: ["voteAccount", "lamports"],
  additionalProperties: false,
};

/**
 * Best-effort validator commission read (Open Q2). Returns null on any failure —
 * the NOTICE degrades gracefully (commission omitted), never hard-refuses.
 * Mocked at the Connection boundary in tests.
 */
async function readValidatorCommission(voteAccount: string): Promise<number | null> {
  try {
    const connection = _solanaRegistry.getConnection();
    const res = await connection.getVoteAccounts();
    const all = [...(res.current ?? []), ...(res.delinquent ?? [])];
    const match = all.find((v) => v.votePubkey === voteAccount);
    return match ? match.commission : null;
  } catch {
    return null;
  }
}

registerTool("prepare_solana_delegate", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const voteAccount = typeof args.voteAccount === "string" ? args.voteAccount : "";
    if (!BASE58_PUBKEY_REGEX.test(voteAccount)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: invalid 'voteAccount' pubkey: "${voteAccount}"` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'voteAccount' pubkey: ${voteAccount}`),
      };
    }

    const stakeAccountArg =
      typeof args.stakeAccount === "string" && args.stakeAccount.length > 0
        ? args.stakeAccount
        : undefined;
    if (stakeAccountArg !== undefined && !BASE58_PUBKEY_REGEX.test(stakeAccountArg)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: invalid 'stakeAccount' pubkey: "${stakeAccountArg}"` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'stakeAccount' pubkey: ${stakeAccountArg}`),
      };
    }

    const rawLamports = typeof args.lamports === "string" ? args.lamports : "";

    // Demo-mode FIRST refusal + feePayer (authority) resolution.
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

    // Parse stake amount (RAW LAMPORTS, decimals=0 → strict integer).
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

    // Recent blockhash.
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
    const votePubkey = new PublicKey(voteAccount);

    // Build the delegate ix vector — existing-account (Fixture E) or
    // delegate-with-create bundle (Fixture F).
    let instructions;
    let ixNames: string[];
    let stakeAccountBase58: string;
    let createdStakeAccount: boolean;
    if (stakeAccountArg !== undefined) {
      const stakeAccount = new PublicKey(stakeAccountArg);
      instructions = _solanaStake.buildDelegateIxs({
        stakeAccount,
        authorizedPubkey: feePayer,
        votePubkey,
      });
      ixNames = ["StakeProgram.delegate"];
      stakeAccountBase58 = stakeAccount.toBase58();
      createdStakeAccount = false;
    } else {
      const built = _solanaStake.buildDelegateWithCreateIxs({
        feePayer,
        stakeSeed: STAKE_SEED,
        votePubkey,
        lamports,
        rentExemptLamports: STAKE_RENT_EXEMPT_LAMPORTS,
      });
      instructions = built.instructions;
      ixNames = ["StakeProgram.createAccountWithSeed", "StakeProgram.delegate"];
      stakeAccountBase58 = built.stakeAccount.toBase58();
      createdStakeAccount = true;
    }

    const { messageBytes, programIds } = _solanaStake.assembleStakeTx({
      instructions,
      ixNames,
      feePayer,
      recentBlockhash: blockhash,
    });

    const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });

    const handle = createHandle({
      args: {
        to: voteAccount,
        valueWei: "0",
        amount: rawLamports,
        recentBlockhash: blockhash,
      },
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

    // Open Q2 — best-effort commission read for the NOTICE (mocked in tests).
    const commission = await readValidatorCommission(voteAccount);

    const ledgerNotice = LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE.replace(
      "{INSTRUCTION_NAME}",
      "native Stake Program delegate",
    );

    const receiptLines = [
      "PREPARE RECEIPT (Solana — native stake delegate)",
      "  chain:           solana mainnet-beta",
      `  voteAccount:     ${voteAccount}`,
      `  lamports:        ${rawLamports}`,
      `  stakeAccount:    ${stakeAccountBase58}`,
      `  recentBlockhash: ${blockhash}`,
    ];
    if (createdStakeAccount) {
      receiptLines.push(
        `  NOTICE: no stake account supplied — this tx creates a deterministic stake account at ${stakeAccountBase58} via createAccountWithSeed (controlled by your wallet; no second signer).`,
      );
    }
    receiptLines.push(
      commission !== null
        ? `  NOTICE: validator vote account ${voteAccount} has commission ${commission}% (affects yield).`
        : `  NOTICE: delegating to validator vote account ${voteAccount} (commission unavailable; verify the validator before delegating).`,
    );
    receiptLines.push("", ledgerNotice);

    return {
      content: [{ type: "text", text: receiptLines.join("\n") }],
      structuredContent: {
        handle,
        voteAccount,
        lamports: rawLamports,
        stakeAccount: stakeAccountBase58,
        createdStakeAccount,
        validatorCommission: commission,
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
      content: [{ type: "text", text: `error: prepare_solana_delegate failed: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_solana_delegate failed", message),
    };
  }
});
