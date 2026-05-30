// MCP tool: prepare_solana_nonce_close({ fromPersona, noncePubkey })
//
// Phase 44 — Plan 44-01 (R-SOL-10). Builds an UNSIGNED Solana transaction that
// withdraws the FULL lamport balance from a durable-nonce account
// (SystemProgram.nonceWithdraw), which closes it. Authority-GATED: proves
// withdrawal authority by reading the on-chain account and asserting the stored
// authority equals the paired wallet.
//
// Mirrors `src/tools/prepare_solana_spl_send.ts` (Plan 12-03) shape: opaque
// handle, verbatim PREPARE RECEIPT, payloadFingerprint via the FROZEN
// `computeSolanaPayloadFingerprint` (UNCHANGED). The FROZEN cryptographic-
// binding chain is NOT modified.
//
// Authority gate (CONTEXT §Design Fork (b), LOCKED — VP_S005):
//   getAccountInfo(noncePubkey); parse with NonceAccount.fromAccountData.
//   Refuse (VP_S005, NO handle minted) if ANY of:
//     - account is null (absent),
//     - owner !== System Program (not a nonce account / wrong owner),
//     - parsed authorizedPubkey !== persona.address (cross-persona close).
//   The off-chain check is a fail-fast UX guard. The SECURITY GUARANTEE is the
//   on-chain signer requirement: nonceWithdraw lists `authorizedPubkey` as a
//   required SIGNER, so the Ledger must sign as the authority — which it can
//   only do for its own paired key.
//
// Withdraw amount = FULL on-chain balance (read from getAccountInfo.lamports),
// never a caller param. A partial withdraw would leave a dust account below
// rent-exempt that the runtime cannot cleanly GC (RESEARCH §Pitfalls). The
// destination (toPubkey) is the paired wallet — rent returns home.
//
// noncePubkey is a TOOL INPUT (base58, Model 1) — same decision as nonce_init,
// surfaced verbatim in the PREPARE RECEIPT.

import { NonceAccount, PublicKey, SystemProgram } from "@solana/web3.js";

import { _solanaRegistry } from "../chains/solana/registry.js";
import { SolanaRpcError } from "../chains/solana/sol-rpc-client.js";
import { isDemoMode } from "../config/env.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { PREPARE_RECEIPT_SOLANA_NONCE_CLOSE_TEMPLATE } from "../signing/blocks-solana.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computeSolanaPayloadFingerprint } from "../signing/payload-fingerprint-solana.js";
import { _solanaSystem } from "../protocols/solana-system.js";
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

// Solana-specific structured refusal code for a nonce-authority gate failure.
//
// Plan 44-01 task 44-01-3 specified adding `SOLANA_NONCE_AUTHORITY_MISMATCH:
// "VP_S005"` to a `SOLANA_ERROR_CODES` registry in error-codes.ts. That
// registry does NOT exist in this codebase — the existing Solana preview/send
// branches surface refusals via the EVM `ErrorCode` union (e.g.
// DISPATCH_TARGET_REFUSED, SIMULATION_REFUSED) with a descriptive message, NOT
// a separate VP_S code table. [Rule 3 — reconcile to ground truth.] The
// distinct structured code the plan wanted is preserved here as a local
// constant surfaced in `solanaErrorCode`, while `errorCode` carries
// INVALID_INPUT for envelope uniformity with the rest of the tool surface.
const SOLANA_NONCE_AUTHORITY_MISMATCH = "VP_S005" as const;

// Authority-mismatch / wrong-owner / absent-account refusal. Carries the
// Solana-specific VP_S005 code in `solanaErrorCode` + INVALID_INPUT in
// `errorCode` for envelope-uniformity. NO handle is minted.
function nonceAuthorityRefusal(
  text: string,
  message: string,
): {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} {
  return {
    isError: true,
    content: [{ type: "text" as const, text }],
    structuredContent: {
      errorCode: "INVALID_INPUT" satisfies ErrorCode,
      solanaErrorCode: SOLANA_NONCE_AUTHORITY_MISMATCH,
      message,
    },
  };
}

const BASE58_PUBKEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const DESCRIPTION = [
  "Prepare an unsigned transaction that closes a durable-nonce account on Solana mainnet-beta by withdrawing its full lamport balance.",
  "Use when you no longer need a nonce account (created via prepare_solana_nonce_init) and want to reclaim the rent.",
  "Non-obvious: withdraws the FULL on-chain balance (closing the account) to your paired wallet, and is AUTHORITY-GATED — the server reads the on-chain nonce authority and refuses (VP_S005) unless it matches your paired wallet. You cannot close another wallet's nonce account.",
  "Do NOT use to create a nonce account — that's prepare_solana_nonce_init. Do NOT use for SOL / SPL transfers.",
  "`fromPersona` selects the paired Solana wallet (must be the nonce authority and the rent destination).",
  "`noncePubkey` is the base58 pubkey of the EXISTING nonce account to close.",
  "Returns `{ handle, fromPersona, noncePubkey, destination, withdrawLamports, recentBlockhash, payloadFingerprint, txType: \"solana\" }` plus a PREPARE RECEIPT text block.",
  "The agent MUST pass the handle to preview_send next — without preview + the resulting previewToken, send_transaction refuses.",
  "In demo mode, the active Solana persona's address is used as authority + destination (set via set_demo_wallet).",
  "Failure modes: WALLET_NOT_PAIRED if no Solana account paired (real mode), WRONG_MODE if demo mode is on but no Solana persona is set, INVALID_INPUT (solanaErrorCode VP_S005) if the nonce account is absent / not a nonce account / owned by a different authority, BROADCAST_FAILED if the RPC account-info or blockhash call fails.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    fromPersona: {
      type: "string",
      description:
        "The paired Solana wallet slug (must be the on-chain nonce authority; also the rent destination).",
    },
    noncePubkey: {
      type: "string",
      description:
        "Base58 pubkey of the EXISTING durable-nonce account to close (32-44 chars).",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
  },
  required: ["fromPersona", "noncePubkey"],
  additionalProperties: false,
};

registerTool(
  "prepare_solana_nonce_close",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const noncePubkey =
        typeof args.noncePubkey === "string" ? args.noncePubkey : "";
      if (!BASE58_PUBKEY_REGEX.test(noncePubkey)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'noncePubkey': expected base58 pubkey (32-44 chars), got "${noncePubkey}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'noncePubkey': ${noncePubkey}`,
          ),
        };
      }

      const fromPersona =
        typeof args.fromPersona === "string" ? args.fromPersona : "";

      // Demo-mode FIRST refusal — read the Solana persona registry.
      const solPersona = getActiveSolanaPersona();
      const demoActive = isDemoMode();

      let authorityBase58: string;
      if (demoActive) {
        if (!solPersona) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: demo mode is on but no Solana persona is set. " +
                  'Call set_demo_wallet with a Solana persona slug (e.g. "solana-whale") before preparing demo-mode nonce close.',
              },
            ],
            structuredContent: errEnvelope(
              "WRONG_MODE",
              "demo mode is on but no Solana persona is set; call set_demo_wallet first",
            ),
          };
        }
        authorityBase58 = solPersona.solanaAddress;
      } else {
        const accounts = listAccounts({ chainFilter: "solana" });
        if (accounts.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: no paired Solana account. Call pair_solana_ledger first to pair your Solana Ledger account.",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired Solana account; call pair_solana_ledger first",
            ),
          };
        }
        const account = accounts[0];
        if (!account) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "error: no paired Solana account (unreachable narrowing).",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired Solana account (unreachable narrowing)",
            ),
          };
        }
        authorityBase58 = account.address;
      }

      // PublicKey construction (defense-in-depth against future regex widening).
      let authority: PublicKey;
      let noncePk: PublicKey;
      try {
        authority = new PublicKey(authorityBase58);
        noncePk = new PublicKey(noncePubkey);
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: `error: invalid pubkey: ${cause}` }],
          structuredContent: errEnvelope("INVALID_INPUT", "invalid pubkey", cause),
        };
      }

      // Fetch on-chain account info via the read-only connection (same pattern
      // as `solana-spl.ts::maybeAppendCreateAtaInstruction` — direct
      // `connection.getAccountInfo`, so the SDK's own return type flows through
      // and `AccountInfo<Buffer>` generic variance never surfaces). RPC failure
      // → BROADCAST_FAILED. A null return (account absent) is the AUTHORITY-GATE
      // refusal, NOT an RPC error.
      const connection = _solanaRegistry.getConnection();
      let accountInfo: Awaited<
        ReturnType<typeof connection.getAccountInfo>
      > = null;
      try {
        accountInfo = await connection.getAccountInfo(noncePk);
      } catch (err) {
        const cause =
          err instanceof SolanaRpcError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to fetch nonce account info from Solana RPC: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "BROADCAST_FAILED",
            "failed to fetch nonce account info",
            cause,
          ),
        };
      }

      // ---- AUTHORITY GATE (VP_S005) — NO handle minted on any refusal. ----

      // (1) Account absent.
      if (accountInfo === null) {
        return nonceAuthorityRefusal(
          `error: nonce account ${noncePubkey} does not exist on-chain (cannot close).`,
          `nonce account ${noncePubkey} does not exist`,
        );
      }

      // (2) Wrong owner — a nonce account is owned by the System Program. An
      // account owned by anything else is not a nonce account.
      if (!accountInfo.owner.equals(SystemProgram.programId)) {
        return nonceAuthorityRefusal(
          `error: account ${noncePubkey} is not owned by the System Program (not a nonce account; owner ${accountInfo.owner.toBase58()}).`,
          `account ${noncePubkey} is not a System Program account`,
        );
      }

      // (3) Parse the nonce account + assert the stored authority matches the
      // paired wallet. NonceAccount.fromAccountData throws on a non-nonce
      // System account (e.g. a plain wallet) — treat that as the refusal too.
      let parsed: NonceAccount;
      try {
        parsed = NonceAccount.fromAccountData(accountInfo.data);
      } catch {
        return nonceAuthorityRefusal(
          `error: account ${noncePubkey} is owned by the System Program but is not a valid nonce account.`,
          `account ${noncePubkey} is not a valid nonce account`,
        );
      }

      if (parsed.authorizedPubkey.toBase58() !== authorityBase58) {
        return nonceAuthorityRefusal(
          `error: nonce account ${noncePubkey} authority (${parsed.authorizedPubkey.toBase58()}) does not match your paired wallet (${authorityBase58}). You cannot close another wallet's nonce account.`,
          `nonce authority mismatch: on-chain ${parsed.authorizedPubkey.toBase58()} != wallet ${authorityBase58}`,
        );
      }

      // ---- Authorized path. Withdraw the FULL on-chain balance. ----
      const withdrawLamports = BigInt(accountInfo.lamports);

      // Recent-blockhash resolution. RPC failure → BROADCAST_FAILED.
      let blockhash: string;
      try {
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

      // Build the nonce-close tx (single nonceWithdraw, full balance). Authority
      // + destination are BOTH the persona address — NEVER caller params.
      const { messageBytes, programIds } = _solanaSystem.buildNonceCloseTx({
        from: authority,
        noncePubkey: noncePk,
        authorizedPubkey: authority,
        toPubkey: authority,
        lamports: withdrawLamports,
        recentBlockhash: blockhash,
      });

      // FROZEN fingerprint — UNCHANGED path. Fixture N cross-link in
      // test/signing-fingerprint-solana.test.ts.
      const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });

      const handle = createHandle({
        args: {
          to: noncePubkey,
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

      const receipt = PREPARE_RECEIPT_SOLANA_NONCE_CLOSE_TEMPLATE.replace(
        "{FROM_PERSONA}",
        fromPersona,
      )
        .replace("{NONCE_PUBKEY}", noncePubkey)
        .replace("{DESTINATION}", authority.toBase58())
        .replace("{WITHDRAW_LAMPORTS}", withdrawLamports.toString())
        .replace("{RECENT_BLOCKHASH}", blockhash);

      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          handle,
          fromPersona,
          noncePubkey,
          // Destination is the paired wallet — rent returns home. NEVER a param.
          destination: authority.toBase58(),
          withdrawLamports: withdrawLamports.toString(),
          recentBlockhash: blockhash,
          payloadFingerprint,
          txType: "solana" as const,
          feePayer: authority.toBase58(),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_solana_nonce_close failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_solana_nonce_close failed",
          message,
        ),
      };
    }
  },
);
