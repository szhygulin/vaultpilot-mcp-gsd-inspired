// src/tools/prepare_marinade_stake.ts — Phase 15 Plan 15-02 (SOL-W-14).
//
// Prepare an unsigned Marinade deposit (SOL → mSOL). Mirrors the
// prepare_solana_spl_send / prepare_marginfi_supply spine. Hand-encoded
// deposit(lamports) ix (D-01, Fixture I) over the vendored IDL. The mSOL
// destination ATA is resolved via @solana/spl-token; createATA is prepended when
// absent (NOTICE line). Blind-sign DEFAULT (research A4) — LEDGER NOTICE +
// blindSign:true.

import {
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

import { _marinadeChain } from "../chains/solana/marinade.js";
import { _solanaRegistry } from "../chains/solana/registry.js";
import { isDemoMode } from "../config/env.js";
import { getMsolMint } from "../config/contracts.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { _marinade } from "../protocols/marinade.js";
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
  "Prepare an unsigned Marinade stake (deposit) transaction on Solana mainnet-beta — stakes native SOL and mints liquid mSOL.",
  "Use when the user wants LIQUID staking via Marinade (mSOL stays tradeable). For native (non-liquid) staking use prepare_solana_delegate; for Jito use prepare_jito_stake_pool_deposit.",
  "`lamports` is the SOL amount to stake in RAW LAMPORTS as a decimal string (1 SOL = 1000000000 lamports). Strict integer parse.",
  "If you do not yet hold mSOL, the prepared tx ALSO creates your mSOL token account (~0.002 SOL rent, paid by you). The PREPARE RECEIPT discloses this with a NOTICE line when applicable.",
  "BLIND-SIGN: the Ledger Solana app does NOT clear-sign Marinade (Anchor) instructions — your device shows only the message hash. Enable blind-signing; verify the PREPARE RECEIPT args; the on-device hash match is the trust anchor.",
  "Requires a paired Solana Ledger (real mode) or an active Solana persona (demo mode).",
  "Returns { handle, lamports, msolMint, msolAta, createMsolAta, recentBlockhash, payloadFingerprint, txType: \"solana\", feePayer } + a PREPARE RECEIPT. Pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT (malformed lamports), BROADCAST_FAILED (RPC failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    lamports: {
      type: "string",
      description: "SOL to stake in RAW LAMPORTS as a decimal string (1 SOL = 1000000000 lamports).",
    },
  },
  required: ["lamports"],
  additionalProperties: false,
};

registerTool("prepare_marinade_stake", DESCRIPTION, INPUT_SCHEMA, async (args) => {
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
    const msolMint = new PublicKey(getMsolMint());

    // Resolve the Marinade account set (State read + PDAs) + the user's mSOL ATA.
    let resolved: Awaited<ReturnType<typeof _marinadeChain.resolveMarinadeAccounts>>;
    let mintToAta: PublicKey;
    let createMsolAta: boolean;
    try {
      resolved = await _marinadeChain.resolveMarinadeAccounts();
      mintToAta = await getAssociatedTokenAddress(msolMint, feePayer);
      const ataInfo = await _solanaRegistry.getConnection().getAccountInfo(mintToAta);
      createMsolAta = ataInfo === null;
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `error: failed to resolve Marinade accounts: ${cause}` }],
        structuredContent: errEnvelope("BROADCAST_FAILED", "failed to resolve Marinade accounts", cause),
      };
    }

    const depositIx = _marinade.buildDepositIx({
      accounts: {
        state: resolved.state,
        msolMint,
        liqPoolSolLegPda: resolved.liqPoolSolLegPda,
        liqPoolMsolLeg: resolved.liqPoolMsolLeg,
        liqPoolMsolLegAuthority: resolved.liqPoolMsolLegAuthority,
        reservePda: resolved.reservePda,
        transferFrom: feePayer,
        mintTo: mintToAta,
        msolMintAuthority: resolved.msolMintAuthority,
      },
      lamports,
    });

    let messageBytes: Uint8Array;
    let programIds: string[];
    // The single-ix deposit programIds (Marinade + System + Token) — always part
    // of the touched set (Pitfall 5).
    const depositAssembled = _marinade.assembleMarinadeTx({ instruction: depositIx, feePayer, recentBlockhash: blockhash, ixName: "deposit" });
    if (createMsolAta) {
      // Prepend createATA (paid by feePayer) — multi-ix assembly. The Associated
      // Token Program is added to the touched set.
      const createIx = createAssociatedTokenAccountInstruction(feePayer, mintToAta, feePayer, msolMint);
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
      args: { to: getMsolMint(), valueWei: "0", amount: rawLamports, recentBlockhash: blockhash },
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
      "Marinade deposit (stake SOL → mSOL)",
    );
    const receiptLines = [
      "PREPARE RECEIPT (Solana — Marinade stake)",
      "  chain:           solana mainnet-beta",
      `  lamports:        ${rawLamports}`,
      `  msolMint:        ${getMsolMint()}`,
      `  mSOL ATA:        ${mintToAta.toBase58()}`,
      `  recentBlockhash: ${blockhash}`,
    ];
    if (createMsolAta) {
      receiptLines.push("  NOTICE: you do not yet hold mSOL. This tx will also create your mSOL token account (rent ~0.002 SOL, paid by you).");
    }
    receiptLines.push("", ledgerNotice);

    return {
      content: [{ type: "text", text: receiptLines.join("\n") }],
      structuredContent: {
        handle,
        lamports: rawLamports,
        msolMint: getMsolMint(),
        msolAta: mintToAta.toBase58(),
        createMsolAta,
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
      content: [{ type: "text", text: `error: prepare_marinade_stake failed: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_marinade_stake failed", message),
    };
  }
});
