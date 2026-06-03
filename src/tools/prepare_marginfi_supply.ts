// src/tools/prepare_marginfi_supply.ts — Phase 13 Plan 13-03 (SOL-W-04).
//
// Prepare an unsigned MarginFi `lending_account_deposit` (supply) tx, hand-encoded
// from the IDL (D-01). Single-ix shape (no bank_liquidity_vault_authority PDA).
//
// D-03 hard-refuse gate: when the wallet's MarginfiAccount PDA is ABSENT, refuse
// with errorCode INVALID_INPUT + solanaErrorCode VP_S006, NO handle minted —
// redirect to prepare_marginfi_account_init. PDA present → handle + receipt +
// fingerprint (Fixture O anchor) + blind-sign LEDGER NOTICE (no clear-sign CAL —
// V11/SC-7).

import { PublicKey } from "@solana/web3.js";

import {
  _marginfiChain,
} from "../chains/solana/marginfi.js";
import { SolanaRpcError } from "../chains/solana/sol-rpc-client.js";
import { _solanaRegistry } from "../chains/solana/registry.js";
import { isDemoMode } from "../config/env.js";
import { getMarginfiGroup } from "../config/contracts.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { _marginfi } from "../protocols/marginfi.js";
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

// Local solanaErrorCode constant (Phase 44 pattern — NOT a central registry, D-04).
// VP_S005 was the last used (nonce-close authority gate); MarginFi-account-absent
// takes VP_S006.
const SOLANA_MARGINFI_ACCOUNT_ABSENT = "VP_S006" as const;

const BASE58_PUBKEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
  solanaErrorCode?: string,
): Record<string, unknown> {
  const base = makeStructuredError(code, message, cause) as unknown as Record<
    string,
    unknown
  > &
    StructuredError;
  if (solanaErrorCode) base.solanaErrorCode = solanaErrorCode;
  return base;
}

const DESCRIPTION = [
  "Prepare an unsigned MarginFi supply (deposit) transaction on Solana — lending_account_deposit, hand-encoded from the IDL.",
  "Use when the user wants to supply/deposit an asset into a MarginFi bank. Do NOT use for borrow/withdraw/repay (separate tools), Kamino (get/prepare_kamino_*), or EVM lending.",
  "REQUIRES an existing MarginfiAccount: if the wallet has none, this tool REFUSES (no handle, solanaErrorCode VP_S006) and you must call prepare_marginfi_account_init first.",
  "`bank` is the MarginFi bank pubkey for the asset (base58). `amount` is HUMAN UNITS as a decimal string (e.g. \"100.5\") — the server reads the bank's mint decimals and parses strictly.",
  "BLIND-SIGN: the Ledger Solana app does NOT clear-sign MarginFi (Anchor) instructions — your device shows only the message hash. Enable blind-signing; verify the PREPARE RECEIPT args; the on-device hash match is the trust anchor.",
  "Requires a paired Solana Ledger (real mode) or an active Solana persona (demo mode).",
  "Returns { handle, bank, mint, amount, decimals, marginfiAccountPda, recentBlockhash, payloadFingerprint, txType: \"solana\" } + a PREPARE RECEIPT. Pass the handle to preview_send next.",
  "Failure modes: WALLET_NOT_PAIRED, WRONG_MODE, INVALID_INPUT (malformed bank/amount OR MarginfiAccount absent → VP_S006), BROADCAST_FAILED (RPC failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    bank: {
      type: "string",
      description: "MarginFi bank pubkey for the asset (base58, 32-44 chars).",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in HUMAN UNITS (e.g. \"100.5\"). The server resolves the bank's mint decimals and parses strictly.",
    },
  },
  required: ["bank", "amount"],
  additionalProperties: false,
};

registerTool("prepare_marginfi_supply", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const bank = typeof args.bank === "string" ? args.bank : "";
    if (!BASE58_PUBKEY_REGEX.test(bank)) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: invalid 'bank' pubkey: "${bank}"` }],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'bank' pubkey: ${bank}`),
      };
    }
    const rawAmount = typeof args.amount === "string" ? args.amount : "";

    // Demo-mode FIRST refusal + authority resolution.
    const demoActive = isDemoMode();
    let authorityBase58: string;
    if (demoActive) {
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

    // ---- D-03 PDA-presence GATE — NO handle minted on refusal. ----
    let acctInfo: Awaited<ReturnType<typeof _marginfiChain.getMarginfiAccountInfo>>;
    try {
      acctInfo = await _marginfiChain.getMarginfiAccountInfo(authorityBase58);
    } catch (err) {
      const cause = err instanceof SolanaRpcError ? err.message : err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `error: failed to read MarginfiAccount PDA: ${cause}` }],
        structuredContent: errEnvelope("BROADCAST_FAILED", "failed to read MarginfiAccount PDA", cause),
      };
    }
    if (!acctInfo.present) {
      // D-03: refuse, NO handle, redirect to init.
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "error: no MarginfiAccount for this wallet — call prepare_marginfi_account_init first.",
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          "no MarginfiAccount for this wallet — call prepare_marginfi_account_init first",
          undefined,
          SOLANA_MARGINFI_ACCOUNT_ABSENT,
        ),
      };
    }

    // Read the bank for mint/decimals/vault.
    let bankInfo: Awaited<ReturnType<typeof _marginfiChain.getBankInfo>>;
    try {
      bankInfo = await _marginfiChain.getBankInfo(bank);
    } catch (err) {
      const cause = err instanceof SolanaRpcError ? err.message : err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `error: failed to read MarginFi bank: ${cause}` }],
        structuredContent: errEnvelope("BROADCAST_FAILED", "failed to read MarginFi bank", cause),
      };
    }
    if (bankInfo === null) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: MarginFi bank ${bank} not found on-chain.` }],
        structuredContent: errEnvelope("INVALID_INPUT", `MarginFi bank ${bank} not found on-chain`),
      };
    }

    // Parse amount against the bank's mint decimals.
    let amount: bigint;
    try {
      amount = parseSolanaAmountStrict(rawAmount, bankInfo.mintDecimals);
    } catch (err) {
      if (err instanceof InvalidAmountError) {
        return {
          isError: true,
          content: [{ type: "text", text: `error: invalid 'amount': ${err.message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", `invalid 'amount': ${err.message}`, err.kind),
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

    const authority = new PublicKey(authorityBase58);
    const signerTokenAccount = await _marginfiChain.deriveTokenAccount(authorityBase58, bankInfo.mint);

    // Build the deposit ix (D-01) + assemble.
    const ix = _marginfi.buildDepositIx({
      accounts: {
        group: new PublicKey(getMarginfiGroup()),
        marginfiAccount: new PublicKey(acctInfo.pda),
        authority,
        bank: new PublicKey(bank),
        signerTokenAccount: new PublicKey(signerTokenAccount),
        liquidityVault: new PublicKey(bankInfo.liquidityVault),
      },
      amount,
    });
    const { messageBytes, programIds } = _marginfi.assembleMarginfiTx({
      instruction: ix,
      feePayer: authority,
      recentBlockhash: blockhash,
      ixName: "lending_account_deposit",
    });

    const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });

    const handle = createHandle({
      args: { to: bank, valueWei: "0", amount: rawAmount, recentBlockhash: blockhash },
      tx: {
        txType: "solana",
        chainId: 0,
        to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        valueWei: 0n,
        data: "0x" as `0x${string}`,
        messageBytes,
        feePayer: authority.toBase58(),
        recentBlockhash: blockhash,
        programIds,
      },
      payloadFingerprint,
    });

    const ledgerNotice = LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE.replace(
      "{INSTRUCTION_NAME}",
      "MarginFi lending_account_deposit (supply)",
    );
    const receipt = [
      "PREPARE RECEIPT (Solana — MarginFi supply)",
      `  authority:           ${authorityBase58}`,
      `  MarginfiAccount PDA: ${acctInfo.pda}`,
      `  bank:                ${bank}`,
      `  mint:                ${bankInfo.mint}`,
      `  amount:              ${rawAmount} (decimals ${bankInfo.mintDecimals})`,
      `  recent blockhash:    ${blockhash}`,
      "",
      ledgerNotice,
    ].join("\n");

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        bank,
        mint: bankInfo.mint,
        amount: rawAmount,
        decimals: bankInfo.mintDecimals,
        marginfiAccountPda: acctInfo.pda,
        recentBlockhash: blockhash,
        payloadFingerprint,
        txType: "solana" as const,
        feePayer: authority.toBase58(),
        blindSign: true,
        clearSign: false,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `error: prepare_marginfi_supply failed: ${message}` }],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_marginfi_supply failed", message),
    };
  }
});
