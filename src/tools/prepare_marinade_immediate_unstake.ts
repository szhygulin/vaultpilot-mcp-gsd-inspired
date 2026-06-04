// src/tools/prepare_marinade_immediate_unstake.ts — Phase 15 Plan 15-02 (SOL-W-15).
//
// Prepare an unsigned Marinade immediate-unstake (mSOL → SOL now, incurs the
// VARIABLE fee). Mirrors the prepare_marginfi_supply spine. Hand-encoded
// liquidUnstake(msolAmount) ix (D-01, Fixture AA).
//
// LOAD-BEARING (SOL-W-15): the VARIABLE fee is read from on-chain LiqPool state at
// quote time via _marinadeChain.readImmediateUnstakeFee and surfaced VERBATIM in a
// CHECKS PERFORMED block — feeBp + feeLamports + the lpMinFee/lpMaxFee/
// lpLiquidityTarget inputs — so the agent cannot understate it (mirror the Phase-6
// ⚠ UNLIMITED APPROVAL verbatim-surfacing pattern). Blind-sign DEFAULT (A4).

import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

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

// mSOL has 9 decimals (same as SOL). The msolAmount arg is RAW (9-decimal) so we
// parse with decimals=0 (the agent passes raw mSOL lamports as a decimal string,
// mirroring the native lamports convention).
const MSOL_RAW_DECIMALS = 0;

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
  "Prepare an unsigned Marinade IMMEDIATE-unstake transaction on Solana mainnet-beta — swaps mSOL back to SOL NOW (skips the ~2-day delayed-unstake) for a VARIABLE fee.",
  "Use when the user wants SOL liquidity immediately and accepts the liquidity-pool fee. The fee is read from on-chain LiqPool state at quote time and surfaced VERBATIM in CHECKS PERFORMED — never round or omit it.",
  "`msolAmount` is the mSOL to unstake in RAW units (9 decimals; 1 mSOL = 1000000000) as a decimal string. Strict integer parse.",
  "BLIND-SIGN: the Ledger Solana app does NOT clear-sign Marinade (Anchor) instructions — your device shows only the message hash. Enable blind-signing; verify the PREPARE RECEIPT args + the CHECKS PERFORMED fee; the on-device hash match is the trust anchor.",
  "Requires a paired Solana Ledger (real mode) or an active Solana persona (demo mode).",
  "Returns { handle, msolAmount, feeBp, feeLamports, msolMint, recentBlockhash, payloadFingerprint, txType: \"solana\", feePayer } + a PREPARE RECEIPT + a CHECKS PERFORMED block with the verbatim variable fee. Pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT (malformed msolAmount), BROADCAST_FAILED (RPC failure / fee read failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    msolAmount: {
      type: "string",
      description: "mSOL to unstake in RAW units (9 decimals; 1 mSOL = 1000000000) as a decimal string.",
    },
  },
  required: ["msolAmount"],
  additionalProperties: false,
};

registerTool("prepare_marinade_immediate_unstake", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const rawMsol = typeof args.msolAmount === "string" ? args.msolAmount : "";

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

    let msolAmount: bigint;
    try {
      msolAmount = parseSolanaAmountStrict(rawMsol, MSOL_RAW_DECIMALS);
    } catch (err) {
      if (err instanceof InvalidAmountError) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: invalid 'msolAmount': ${err.message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", `invalid 'msolAmount': ${err.message}`, err.kind),
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

    // Resolve accounts + the user's mSOL source ATA + the VARIABLE fee.
    let resolved: Awaited<ReturnType<typeof _marinadeChain.resolveMarinadeAccounts>>;
    let getMsolFromAta: PublicKey;
    let fee: Awaited<ReturnType<typeof _marinadeChain.readImmediateUnstakeFee>>;
    try {
      resolved = await _marinadeChain.resolveMarinadeAccounts();
      getMsolFromAta = await getAssociatedTokenAddress(msolMint, feePayer);
      // The fee interpolation is over the requested unstake amount (SDK uses the
      // requested lamports as lamportsToObtain).
      fee = await _marinadeChain.readImmediateUnstakeFee(msolAmount);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `error: failed to read Marinade immediate-unstake fee: ${cause}` }],
        structuredContent: errEnvelope("BROADCAST_FAILED", "failed to read Marinade immediate-unstake fee", cause),
      };
    }

    const luIx = _marinade.buildLiquidUnstakeIx({
      accounts: {
        state: resolved.state,
        msolMint,
        liqPoolSolLegPda: resolved.liqPoolSolLegPda,
        liqPoolMsolLeg: resolved.liqPoolMsolLeg,
        treasuryMsolAccount: resolved.treasuryMsolAccount,
        getMsolFrom: getMsolFromAta,
        getMsolFromAuthority: feePayer,
        transferSolTo: feePayer,
      },
      msolAmount,
    });

    const { messageBytes, programIds } = _marinade.assembleMarinadeTx({
      instruction: luIx,
      feePayer,
      recentBlockhash: blockhash,
      ixName: "liquidUnstake",
    });

    const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });

    const handle = createHandle({
      args: { to: getMsolMint(), valueWei: "0", amount: rawMsol, recentBlockhash: blockhash },
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
      "Marinade liquidUnstake (immediate unstake)",
    );

    // SOL-W-15: surface the VARIABLE fee VERBATIM in CHECKS PERFORMED — the agent
    // cannot understate it. feeBp + feeLamports + the raw LiqPool inputs.
    const receipt = [
      "PREPARE RECEIPT (Solana — Marinade immediate-unstake)",
      "  chain:           solana mainnet-beta",
      `  msolAmount:      ${rawMsol}`,
      `  msolMint:        ${getMsolMint()}`,
      `  recentBlockhash: ${blockhash}`,
      "",
      "CHECKS PERFORMED (Marinade immediate-unstake fee — VARIABLE, read on-chain at quote time)",
      `  feeBp:               ${fee.feeBp}`,
      `  feeLamports:         ${fee.feeLamports.toString()}`,
      `  lpMinFeeBp:          ${fee.lpMinFeeBp}`,
      `  lpMaxFeeBp:          ${fee.lpMaxFeeBp}`,
      `  lpLiquidityTarget:   ${fee.lpLiquidityTarget.toString()}`,
      `  lamportsAvailable:   ${fee.lamportsAvailable.toString()}`,
      "  This fee is the cost of INSTANT liquidity vs the ~2-day delayed-unstake (which has no fee).",
      "  The fee is interpolated from on-chain LiqPool state — verify it BEFORE approving on the device.",
      "",
      ledgerNotice,
    ].join("\n");

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        msolAmount: rawMsol,
        feeBp: fee.feeBp,
        feeLamports: fee.feeLamports.toString(),
        lpMinFeeBp: fee.lpMinFeeBp,
        lpMaxFeeBp: fee.lpMaxFeeBp,
        lpLiquidityTarget: fee.lpLiquidityTarget.toString(),
        msolMint: getMsolMint(),
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
      content: [{ type: "text", text: `error: prepare_marinade_immediate_unstake failed: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_marinade_immediate_unstake failed", message),
    };
  }
});
