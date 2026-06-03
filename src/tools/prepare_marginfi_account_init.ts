// src/tools/prepare_marginfi_account_init.ts — Phase 13 Plan 13-03 (SOL-W-05).
//
// Creates the per-wallet MarginfiAccount PDA via the Ledger-safe
// `marginfi_account_initialize_pda` ix (authority-only signer — NOT the
// Keypair-signer `marginfi_account_initialize` variant, which is
// Ledger-incompatible: Pitfall 3 / T-13-07 / V3/V4). This is the DISTINCT-intent
// setup tool the supply/withdraw/borrow/repay tools redirect to (D-03) when the
// PDA is absent — one device screen = one intent (create account; then supply).
//
// Does NOT gate on PDA-presence (it CREATES the PDA). Clone of
// `prepare_solana_spl_send.ts` shape: demo-persona FIRST refusal → pairing
// check → resolve group/PDA from the 13-01 SOT → build the ix via `_marginfi`
// (D-01 hand-encode) → assemble Transaction → messageBytes →
// computeSolanaPayloadFingerprint (FROZEN) → createHandle (RAW args on `args`,
// solana-typed on `tx`) → return handle + PREPARE RECEIPT + blind-sign LEDGER
// NOTICE (no clear-sign CAL for MarginFi ix — V11/SC-7).

import { PublicKey } from "@solana/web3.js";

import { isDemoMode } from "../config/env.js";
import {
  getMarginfiGroup,
  deriveMarginfiAccountPda,
} from "../config/contracts.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { _marginfi } from "../protocols/marginfi.js";
import { _solanaRegistry } from "../chains/solana/registry.js";
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
  "Prepare an unsigned MarginFi account-initialization transaction (creates the per-wallet MarginfiAccount PDA on Solana).",
  "Use this FIRST, before prepare_marginfi_supply/_withdraw/_borrow/_repay — those tools REFUSE (no handle) when the MarginfiAccount PDA does not exist yet and redirect here. One device screen = one intent (create account; then supply).",
  "Uses the Ledger-SAFE marginfi_account_initialize_pda instruction (authority-only signer). Returns a handle the agent passes to preview_send before send_transaction.",
  "BLIND-SIGN: the Ledger Solana app does NOT clear-sign MarginFi (Anchor) instructions — your device will display only the message hash, not decoded args. Enable blind-signing in the Solana app settings. Verify the PREPARE RECEIPT args against what you intended; the on-device hash match is the trust anchor.",
  "Requires a paired Solana Ledger (call pair_solana_ledger first if get_solana_status shows paired: false). In demo mode, succeeds against the active Solana persona's address (set via set_demo_wallet).",
  "Failure modes: WALLET_NOT_PAIRED if no Solana account paired (real mode), WRONG_MODE if demo mode is on but no Solana persona is set, BROADCAST_FAILED if the RPC getLatestBlockhash call fails.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  required: [],
  additionalProperties: false,
};

registerTool(
  "prepare_marginfi_account_init",
  DESCRIPTION,
  INPUT_SCHEMA,
  async () => {
    try {
      // Demo-mode FIRST refusal.
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
                text:
                  "error: demo mode is on but no Solana persona is set. " +
                  "Call set_demo_wallet with a Solana persona slug first.",
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
              {
                type: "text",
                text: "error: no paired Solana account. Call pair_solana_ledger first.",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired Solana account; call pair_solana_ledger first",
            ),
          };
        }
        authorityBase58 = accounts[0].address;
      }

      // Recent-blockhash resolution. RPC failure → BROADCAST_FAILED.
      let blockhash: string;
      try {
        const connection = _solanaRegistry.getConnection();
        const { blockhash: bh } = await connection.getLatestBlockhash();
        blockhash = bh;
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to fetch recent blockhash from Solana RPC: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "BROADCAST_FAILED",
            "failed to fetch recent blockhash",
            cause,
          ),
        };
      }

      const authority = new PublicKey(authorityBase58);
      const group = getMarginfiGroup();
      // accountIndex 0 — the default single account per authority.
      const accountIndex = 0;
      const marginfiAccountPda = deriveMarginfiAccountPda(authorityBase58, accountIndex);

      // Build the Ledger-safe init_pda ix (D-01 hand-encode) + assemble.
      const ix = _marginfi.buildAccountInitPdaIx({
        accounts: {
          marginfiGroup: new PublicKey(group),
          marginfiAccount: new PublicKey(marginfiAccountPda),
          authority,
          feePayer: authority,
        },
        accountIndex,
      });
      const { messageBytes, programIds } = _marginfi.assembleMarginfiTx({
        instruction: ix,
        feePayer: authority,
        recentBlockhash: blockhash,
        ixName: "marginfi_account_initialize_pda",
      });

      // FROZEN fingerprint — Fixture S anchor cross-link in
      // test/signing-fingerprint-solana.test.ts.
      const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });

      const handle = createHandle({
        args: {
          to: marginfiAccountPda,
          valueWei: "0",
          recentBlockhash: blockhash,
        },
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
        "MarginFi account_initialize_pda",
      );
      const receipt = [
        "PREPARE RECEIPT (Solana — MarginFi account init)",
        `  authority:           ${authorityBase58}`,
        `  MarginfiAccount PDA: ${marginfiAccountPda}`,
        `  group:               ${group}`,
        `  account_index:       ${accountIndex}`,
        `  recent blockhash:    ${blockhash}`,
        "",
        ledgerNotice,
      ].join("\n");

      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          handle,
          authority: authorityBase58,
          marginfiAccountPda,
          group,
          accountIndex,
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
        content: [
          {
            type: "text",
            text: `error: prepare_marginfi_account_init failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_marginfi_account_init failed",
          message,
        ),
      };
    }
  },
);
