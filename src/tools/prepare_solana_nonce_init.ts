// MCP tool: prepare_solana_nonce_init({ fromPersona, noncePubkey })
//
// Phase 44 — Plan 44-01 (R-SOL-09). Builds an UNSIGNED Solana transaction that
// creates a per-wallet durable-nonce account (SystemProgram.createAccount,
// funded to the rent-exempt minimum for an 80-byte account) and initializes it
// (SystemProgram.nonceInitialize) with the PAIRED WALLET as authority.
//
// Mirrors `src/tools/prepare_solana_native_send.ts` (Plan 12-02) shape exactly:
// opaque handle, verbatim PREPARE RECEIPT, payloadFingerprint via the FROZEN
// `computeSolanaPayloadFingerprint` (UNCHANGED — nonce shapes flow through the
// same serialize→keccak path). The FROZEN cryptographic-binding chain is NOT
// modified.
//
// Authority model (CONTEXT §Design Fork, LOCKED): the nonce authority is ALWAYS
// the paired wallet (`authorizedPubkey === feePayer === persona.address`). There
// is NO caller-supplied authority param — a foreign authority cannot be
// requested, which prevents an agent from installing an authority the user does
// not control (a self-custody break).
//
// noncePubkey input-vs-derived decision (RESEARCH §Account creation, PR-time
// fork RESOLVED): `noncePubkey` is a TOOL INPUT (Model 1, base58). The nonce
// account is a fresh keypair distinct from the wallet; it must sign its own
// creation. This codebase only assembles the UNSIGNED message — the nonce
// account's signature is supplied by the device/user flow at send time
// (consistent with "no keypair in this codebase"). If "server-derived nonce
// key" is later preferred, it is a one-arg simplification — the message bytes
// and fingerprint are identical either way. The choice is surfaced explicitly
// in the PREPARE RECEIPT (`noncePubkey` echoed verbatim).
//
// `noncePubkey` MUST NOT equal the persona address (a wallet cannot be its own
// nonce account — createAccount would collide with the existing system account).
// Refused with INVALID_INPUT before any state mutation.

import { PublicKey } from "@solana/web3.js";

import { _solanaRegistry } from "../chains/solana/registry.js";
import {
  SolanaRpcError,
  getMinimumBalanceForRentExemption,
} from "../chains/solana/sol-rpc-client.js";
import { isDemoMode } from "../config/env.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { PREPARE_RECEIPT_SOLANA_NONCE_INIT_TEMPLATE } from "../signing/blocks-solana.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computeSolanaPayloadFingerprint } from "../signing/payload-fingerprint-solana.js";
import {
  NONCE_ACCOUNT_LENGTH,
  _solanaSystem,
} from "../protocols/solana-system.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

// The shared `ToolHandlerResult.structuredContent` type is
// `Record<string, unknown>`; `StructuredError` is an explicit interface
// without an index signature. Cast at the boundary so `makeStructuredError(...)`
// stays the canonical envelope constructor.
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

// Base58 pubkey regex — Solana addresses are 32-44 base58 characters in the
// `1-9A-HJ-NP-Za-km-z` alphabet. Mirrors `prepare_solana_native_send.ts`.
const BASE58_PUBKEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const DESCRIPTION = [
  "Prepare an unsigned transaction that creates and initializes a durable-nonce account on Solana mainnet-beta.",
  "Use BEFORE a long-window signing flow where the standard ~150-slot recent-blockhash window may expire before the user approves on their Ledger.",
  "Non-obvious: sets the nonce AUTHORITY to your paired wallet (only that wallet can later advance or close the account) and funds the account to the rent-exempt minimum (resolved live, ~0.00145 SOL), paid by your wallet.",
  "Do NOT use for sending SOL or SPL tokens — that's prepare_solana_native_send / prepare_solana_spl_send. This only sets up a nonce account; it does not transfer value to anyone else.",
  "Do NOT use to close a nonce account — that's prepare_solana_nonce_close.",
  "`fromPersona` selects the paired Solana wallet (the fee payer AND the nonce authority).",
  "`noncePubkey` is the base58 pubkey of the NEW nonce account (a fresh keypair you control). It must NOT equal your wallet address. The account signs its own creation on-device at send time.",
  "Returns `{ handle, fromPersona, noncePubkey, authority, rentLamports, recentBlockhash, payloadFingerprint, txType: \"solana\" }` plus a PREPARE RECEIPT text block surfacing verbatim args.",
  "The agent MUST pass the handle to preview_send next — without preview + the resulting previewToken, send_transaction refuses.",
  "In demo mode, succeeds against the active Solana persona's address (set via set_demo_wallet) as both fee payer and authority.",
  "Failure modes: WALLET_NOT_PAIRED if no Solana account paired (real mode), WRONG_MODE if demo mode is on but no Solana persona is set, INVALID_INPUT if noncePubkey is malformed or equals the wallet address, BROADCAST_FAILED if the RPC rent / blockhash call fails.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    fromPersona: {
      type: "string",
      description:
        "The paired Solana wallet slug (also the nonce authority). In demo mode this is the active persona; in real mode the paired account is used and this is advisory.",
    },
    noncePubkey: {
      type: "string",
      description:
        "Base58 pubkey of the NEW durable-nonce account (a fresh keypair you control, 32-44 chars). Must NOT equal your wallet address.",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
  },
  required: ["fromPersona", "noncePubkey"],
  additionalProperties: false,
};

registerTool(
  "prepare_solana_nonce_init",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // Validate noncePubkey shape BEFORE any state read (T-ADDR-1 sibling).
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

      // Demo-mode FIRST refusal — read the Solana persona registry (NOT the EVM
      // persona). `listAccounts` is NEVER consulted in the demo branch.
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
                  'Call set_demo_wallet with a Solana persona slug (e.g. "solana-whale") before preparing demo-mode nonce setup.',
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

      // A wallet cannot be its own nonce account — createAccount would collide
      // with the existing system account. Refuse before any RPC / mutation.
      if (noncePubkey === authorityBase58) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: 'noncePubkey' must NOT equal your wallet address — the nonce account is a separate keypair.",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "noncePubkey must not equal the wallet address",
          ),
        };
      }

      // Rent-exempt minimum for an 80-byte nonce account — resolved LIVE (rent
      // params are a cluster setting; never hardcoded). RPC failure →
      // BROADCAST_FAILED (reuse per Solana RESEARCH OQ-3 convention).
      let rentLamports: number;
      try {
        rentLamports = await getMinimumBalanceForRentExemption(
          NONCE_ACCOUNT_LENGTH,
        );
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
              text: `error: failed to fetch rent-exempt minimum from Solana RPC: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "BROADCAST_FAILED",
            "failed to fetch rent-exempt minimum",
            cause,
          ),
        };
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

      // PublicKey construction — defense-in-depth against future regex widening.
      let authority: PublicKey;
      let noncePk: PublicKey;
      try {
        authority = new PublicKey(authorityBase58);
        noncePk = new PublicKey(noncePubkey);
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            { type: "text", text: `error: invalid pubkey: ${cause}` },
          ],
          structuredContent: errEnvelope("INVALID_INPUT", "invalid pubkey", cause),
        };
      }

      // Build the nonce-init tx (createAccount + nonceInitialize). Authority is
      // ALWAYS the persona address — NEVER a caller param. Routes through
      // `_solanaSystem` so tests can spy on the build-side.
      const { messageBytes, programIds } = _solanaSystem.buildNonceInitTx({
        from: authority,
        noncePubkey: noncePk,
        authorizedPubkey: authority,
        lamports: BigInt(rentLamports),
        recentBlockhash: blockhash,
      });

      // FROZEN fingerprint — UNCHANGED path (nonce shapes flow through the same
      // serialize→keccak function as native/SPL). Fixture M cross-link in
      // test/signing-fingerprint-solana.test.ts.
      const payloadFingerprint = computeSolanaPayloadFingerprint({ messageBytes });

      // PREP-02: `args` carries RAW agent strings; the receipt reads ONLY from
      // them (+ server-derived authority/rent/blockhash). `PrepareArgs` typed
      // `string` blocks normalization at the storage boundary.
      const handle = createHandle({
        args: {
          to: noncePubkey,
          valueWei: "0",
          recentBlockhash: blockhash,
        },
        tx: {
          txType: "solana",
          // Sentinel zeros — Solana handles never flow through EVM dispatch.
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

      const receipt = PREPARE_RECEIPT_SOLANA_NONCE_INIT_TEMPLATE.replace(
        "{FROM_PERSONA}",
        fromPersona,
      )
        .replace("{NONCE_PUBKEY}", noncePubkey)
        .replace("{AUTHORITY}", authority.toBase58())
        .replace("{RENT_LAMPORTS}", String(rentLamports))
        .replace("{RECENT_BLOCKHASH}", blockhash);

      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          handle,
          fromPersona,
          noncePubkey,
          // Authority is the paired wallet — surfaced so the agent can confirm
          // who controls the new nonce account. NEVER a caller param.
          authority: authority.toBase58(),
          rentLamports,
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
            text: `error: prepare_solana_nonce_init failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_solana_nonce_init failed",
          message,
        ),
      };
    }
  },
);
