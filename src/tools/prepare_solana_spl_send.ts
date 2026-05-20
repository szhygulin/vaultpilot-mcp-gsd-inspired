// MCP tool: prepare_solana_spl_send({ to, mint, amount })
//
// Second step of the Phase 12 Solana trust pipeline (SOL-W-02). Solana sibling
// of `src/tools/prepare_token_send.ts` (Phase 6 / Plan 06-02 — EVM ERC-20 send).
//
// Composes Plan 12-01's signing primitives + Plan 12-02's amount parser + Plan
// 12-03's SPL encoder + Phase 11's non-EVM account store + curated SPL token
// registry:
//
//   demo-mode FIRST refusal (Plan 11-06 Solana persona — `getActiveSolanaPersona`)
//     → input validation (`to` + `mint` base58 regex; `amount` string)
//     → pairing check (`listAccounts({ chainFilter: "solana" })` non-empty in real mode)
//     → mint decimals resolution (curated top-50 registry FIRST; on-chain
//       `getMintDecimals` fallback for off-list mints)
//     → amount parse via `parseSolanaAmountStrict(amount, decimals)`
//     → recent-blockhash resolution via `Connection.getLatestBlockhash`
//     → build SPL TransferChecked tx (conditionally prepended createATA when
//       destination ATA absent) → compute messageBytes
//     → compute `payloadFingerprint` via `computeSolanaPayloadFingerprint`
//     → `createHandle` with RAW agent strings on `args` + Solana-typed on `tx`
//     → return `{ handle, to, mint, amount, decimals, recentBlockhash,
//         payloadFingerprint, txType: "solana", sourceAta, destAta, createDestAta }`
//       plus a `PREPARE RECEIPT (Solana — SPL transfer)` text block.
//
// Three load-bearing invariants asserted by `test/prepare-solana-spl-send.test.ts`:
//
//   1. **TransferChecked (NOT Transfer)** — defense-in-depth per RESEARCH § Topic 6.
//      `createTransferCheckedInstruction` passes mint + decimals AS instruction
//      args; the on-chain SPL program verifies decimals against the mint AND
//      verifies the source ATA holds the named mint. Drift between agent-
//      claimed mint and actual source-ATA mint → tx fails at simulation
//      (consumed by Plan 12-04 DF-4 gate). Regression-anchor test asserts the
//      checked variant is used.
//
//   2. **PREPARE RECEIPT is VERBATIM** (PREP-02 + T-PREP-RCPT-1 mirror) — the
//      block reads from `args.to` + `args.mint` + `args.amount` (RAW agent
//      strings). Base58-normalization via `new PublicKey(...)` happens ONLY
//      for the server-internal `tx.messageBytes` (consumed by
//      `computeSolanaPayloadFingerprint`) and is NEVER surfaced in the text
//      response.
//
//   3. **Sender-DEPENDENT `payloadFingerprint`** — UNLIKE EVM (where `from`
//      is not in the EIP-1559 preimage), the Solana SPL fingerprint depends
//      on the sender because the source ATA derives from sender + mint. Two
//      personas → two different source ATAs → two different message-bytes →
//      two different fingerprints. Plan 12-05 integration test asserts this
//      property end-to-end; the unit-level anchor lives in this tool's tests.
//
// `amount` is HUMAN UNITS as a decimal string (e.g. `"100.5"` for 100.5 USDC).
// The server resolves the mint's `decimals` via the curated top-50 registry
// (cache hit — no RPC) OR a live `getMintDecimals` call (off-list mints) and
// parses `amount` strictly via `parseSolanaAmountStrict`. Off-by-decimal is
// the most common user-facing bug class per project CLAUDE.md "Decimal-aware
// arithmetic".

import { PublicKey } from "@solana/web3.js";

import { _solanaRegistry } from "../chains/solana/registry.js";
import {
  SolanaRpcError,
  getMintDecimals,
} from "../chains/solana/sol-rpc-client.js";
import { isDemoMode } from "../config/env.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { _solanaSpl } from "../protocols/solana-spl.js";
import {
  InvalidAmountError,
  parseSolanaAmountStrict,
} from "../signing/amount-solana.js";
import { PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE } from "../signing/blocks-solana.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computeSolanaPayloadFingerprint } from "../signing/payload-fingerprint-solana.js";
import { findByMint } from "../tokens/solana-top-50.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

// The shared `ToolHandlerResult.structuredContent` type is
// `Record<string, unknown>`; `StructuredError` is an explicit interface
// without an index signature. Cast at the boundary so
// `makeStructuredError(...)` stays the canonical envelope constructor
// without modifying the tool-handler contract.
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
// `1-9A-HJ-NP-Za-km-z` alphabet (no 0, O, I, l). Mirrors
// `prepare_solana_native_send.ts` and `get_solana_balance.ts`. Pre-validated
// by the JSON-schema pattern below; re-asserted at handler-top as defense-
// in-depth.
const BASE58_PUBKEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const DESCRIPTION = [
  "Prepare an unsigned SPL token transfer (USDC, USDT, JTO, etc.) on Solana mainnet-beta.",
  "Returns a handle the agent then passes to preview_send before send_transaction.",
  "Use when the user wants to send an SPL token from their paired Solana Ledger.",
  "Do NOT use for native SOL — that's `prepare_solana_native_send`.",
  "Do NOT use for Ethereum ERC-20 transfers — that's `prepare_token_send`.",
  "`amount` is in HUMAN UNITS as a decimal string (e.g. \"100.5\" for 100.5 USDC, NOT \"100500000\"). The server resolves the mint's decimals via the curated top-50 registry (USDC, USDT, JUP, BONK, JitoSOL, mSOL, etc.) or an on-chain `getMint()` call for unknown mints — off-by-decimal is the most common user-facing bug class.",
  "`to` is the recipient's Solana WALLET address (32-44 base58 chars) — NOT their Associated Token Account. The server derives the destination ATA for the named mint.",
  "`mint` is the SPL mint base58 pubkey. Example: USDC = `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.",
  "Uses TransferChecked (NOT the deprecated Transfer) — the on-chain SPL program verifies decimals AND source-ATA mint against the agent's claim. Defense-in-depth beyond the MCP-side decimal parse.",
  "If the recipient does not yet hold this token, the prepared tx will ALSO create their token account (~0.002 SOL rent, paid by sender). The PREPARE RECEIPT discloses this with a NOTICE line when applicable.",
  "Requires a paired Solana Ledger (call pair_solana_ledger first if get_solana_status shows paired: false).",
  "Returns `{ handle, to, mint, amount, decimals, recentBlockhash, payloadFingerprint, txType: \"solana\", sourceAta, destAta, createDestAta }` plus a PREPARE RECEIPT text block surfacing verbatim args.",
  "The agent MUST pass the handle to preview_send next — without preview + the resulting previewToken, send_transaction refuses.",
  "In demo mode, succeeds against the active Solana persona's address as feePayer (set via set_demo_wallet); send_transaction returns a simulation envelope instead of broadcasting.",
  "Failure modes: WALLET_NOT_PAIRED if no Solana account paired (real mode), WRONG_MODE if demo mode is on but no Solana persona is set, INVALID_INPUT if to/mint/amount malformed OR mint not found on-chain, BROADCAST_FAILED if the RPC `getLatestBlockhash` / `getMint` / `getAccountInfo` call fails.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    to: {
      type: "string",
      description:
        "Recipient Solana WALLET address as a base58 pubkey (32-44 chars) — NOT their ATA. The server derives the destination Associated Token Account for the named mint.",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    mint: {
      type: "string",
      description:
        "SPL mint base58 pubkey. Example USDC: \"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\".",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    amount: {
      type: "string",
      description:
        "Decimal string in HUMAN UNITS (e.g. \"100.5\" for 100.5 USDC). The server resolves the mint's decimals and parses strictly — off-by-decimal refuses with INVALID_INPUT.",
    },
  },
  required: ["to", "mint", "amount"],
  additionalProperties: false,
};

/**
 * Resolve mint decimals — registry-cache-first; on-chain `getMintDecimals`
 * fallback for off-list mints. Returns `{ decimals, registryHit }` so the
 * caller knows whether an RPC call was made (the test seam asserts the
 * registry-hit path skips RPC).
 *
 * Throws `SolanaRpcError` on RPC failure (off-list + getMint throws). The
 * handler converts to `INVALID_INPUT` with cause `"mint not found on-chain"`
 * because a non-existent mint pubkey is a user-input class error, not a
 * transient RPC failure. Other RPC failures (network timeout, etc.) bubble
 * up to the outer catch and surface as `BROADCAST_FAILED`.
 */
async function resolveMintDecimals(
  mintBase58: string,
): Promise<{ decimals: number; registryHit: boolean }> {
  const cached = findByMint(mintBase58);
  if (cached) {
    return { decimals: cached.decimals, registryHit: true };
  }
  // Cache miss — live RPC. `getMintDecimals` throws `SolanaRpcError` on
  // any failure (invalid mint, network down, etc.).
  const decimals = await getMintDecimals(mintBase58);
  return { decimals, registryHit: false };
}

registerTool(
  "prepare_solana_spl_send",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // Validate `to` shape (recipient WALLET) — defense BEFORE any state read.
      const to = typeof args.to === "string" ? args.to : "";
      if (!BASE58_PUBKEY_REGEX.test(to)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'to' address: expected base58 pubkey (32-44 chars), got "${to}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'to' address: ${to}`,
          ),
        };
      }

      // Validate `mint` shape.
      const mint = typeof args.mint === "string" ? args.mint : "";
      if (!BASE58_PUBKEY_REGEX.test(mint)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'mint': expected base58 pubkey (32-44 chars), got "${mint}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'mint': ${mint}`,
          ),
        };
      }

      const rawAmount = typeof args.amount === "string" ? args.amount : "";

      // Demo-mode FIRST refusal — read the Solana persona registry.
      // `listAccounts` is NEVER consulted in the demo branch.
      const solPersona = getActiveSolanaPersona();
      const demoActive = isDemoMode();

      let feePayerBase58: string;
      if (demoActive) {
        if (!solPersona) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: demo mode is on but no Solana persona is set. " +
                  "Call set_demo_wallet with a Solana persona slug (e.g. \"solana-whale\") before preparing demo-mode Solana SPL sends.",
              },
            ],
            structuredContent: errEnvelope(
              "WRONG_MODE",
              "demo mode is on but no Solana persona is set; call set_demo_wallet first",
            ),
          };
        }
        feePayerBase58 = solPersona.solanaAddress;
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
          // Unreachable narrowing — length-check above guarantees this.
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
        feePayerBase58 = account.address;
      }

      // Mint decimals resolution — registry hit (free) or live `getMintDecimals`
      // RPC fallback. `SolanaRpcError` from off-list mints that don't exist
      // on-chain surfaces as INVALID_INPUT (user-input class error, not
      // transient).
      let decimals: number;
      try {
        const meta = await resolveMintDecimals(mint);
        decimals = meta.decimals;
      } catch (err) {
        if (err instanceof SolanaRpcError) {
          const cause = err.cause instanceof Error ? err.cause.message : String(err.cause);
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: mint '${mint}' not found on-chain: ${cause}`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `mint '${mint}' not found on-chain`,
              "mint not found on-chain",
            ),
          };
        }
        throw err;
      }

      // Parse amount strictly against resolved decimals. Throws
      // `InvalidAmountError` → wrap into `INVALID_INPUT`.
      let amount: bigint;
      try {
        amount = parseSolanaAmountStrict(rawAmount, decimals);
      } catch (err) {
        if (err instanceof InvalidAmountError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: invalid 'amount': ${err.message}`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid 'amount': ${err.message}`,
              err.kind,
            ),
          };
        }
        throw err;
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

      // PublicKey construction — defense-in-depth against future regex
      // widening. Throws on malformed base58.
      let feePayer: PublicKey;
      let toPubkey: PublicKey;
      let mintPubkey: PublicKey;
      try {
        feePayer = new PublicKey(feePayerBase58);
        toPubkey = new PublicKey(to);
        mintPubkey = new PublicKey(mint);
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid pubkey: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "invalid pubkey",
            cause,
          ),
        };
      }

      // Build the SPL transfer tx + compute the fingerprint. Routes through
      // `_solanaSpl.buildSplTransferTx` so tests can spy on the build-side.
      // Wraps `getAccountInfo` (ATA pre-flight) — RPC failure → BROADCAST_FAILED.
      let buildResult: Awaited<ReturnType<typeof _solanaSpl.buildSplTransferTx>>;
      try {
        buildResult = await _solanaSpl.buildSplTransferTx({
          connection: _solanaRegistry.getConnection(),
          from: feePayer,
          toWallet: toPubkey,
          mint: mintPubkey,
          amount,
          decimals,
          recentBlockhash: blockhash,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to build SPL transfer tx (RPC failure on ATA pre-flight): ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "BROADCAST_FAILED",
            "failed to build SPL transfer tx",
            cause,
          ),
        };
      }

      const {
        messageBytes,
        programIds,
        instructionSummary,
        createDestAta,
        sourceAta,
        destAta,
      } = buildResult;

      // SOL-PREP-01: compute the binding fingerprint at prepare time.
      const payloadFingerprint = computeSolanaPayloadFingerprint({
        messageBytes,
      });

      // PREP-02 + T-PREP-RCPT-1: `args` carries the RAW agent strings; `tx`
      // carries the typed values. Receipt reads EXCLUSIVELY from `args`.
      const handle = createHandle({
        args: {
          // Phase 4 EVM-shape required fields populated with empty / zero
          // defaults. The discriminator `tx.txType` is the routing key.
          to,
          valueWei: "0",
          // Phase 6 ERC-20-shape `amount` field doubles as Solana SPL amount.
          amount: rawAmount,
          // Phase 12 SPL-specific.
          mint,
          recentBlockhash: blockhash,
        },
        tx: {
          txType: "solana",
          // Sentinel zeros — Solana handles never flow through EVM dispatch.
          chainId: 0,
          to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
          valueWei: 0n,
          data: "0x" as `0x${string}`,
          // Solana-specific cryptographic-binding fields.
          messageBytes,
          feePayer: feePayer.toBase58(),
          recentBlockhash: blockhash,
          programIds,
          instructionSummary,
        },
        payloadFingerprint,
      });

      // PREPARE RECEIPT — substitute from the format-fanout-sentinel const.
      // `{ATA_NOTICE}` slot renders a NOTICE line when the recipient ATA must
      // be created in-tx; rendered as empty string when the ATA exists. We
      // filter the trailing empty line so the block stays tight.
      const ataNotice = createDestAta
        ? "  NOTICE: recipient does not yet hold this token. This tx will also create their token account (rent ~0.002 SOL, paid by sender)."
        : "";
      const receiptRaw = PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE
        .replace("{TO}", to)
        .replace("{MINT}", mint)
        .replace("{AMOUNT}", rawAmount)
        .replace("{RECENT_BLOCKHASH}", blockhash)
        .replace("{ATA_NOTICE}", ataNotice);
      // Drop the trailing empty line when the NOTICE slot is empty so the
      // receipt block stays tight.
      const receipt = ataNotice === ""
        ? receiptRaw.replace(/\n$/, "")
        : receiptRaw;

      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          handle,
          to,
          mint,
          amount: rawAmount,
          decimals,
          recentBlockhash: blockhash,
          payloadFingerprint,
          txType: "solana" as const,
          feePayer: feePayer.toBase58(),
          sourceAta,
          destAta,
          createDestAta,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_solana_spl_send failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_solana_spl_send failed",
          message,
        ),
      };
    }
  },
);
