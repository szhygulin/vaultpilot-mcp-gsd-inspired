// MCP tool: prepare_solana_native_send({ to, lamports })
//
// First step of the Phase 12 Solana trust pipeline (SOL-W-01 / SOL-PREP-01
// consumer / SOL-PREP-02 scaffolding). Solana sibling of
// `src/tools/prepare_native_send.ts` (Phase 4 / Plan 04-02 — EVM native send).
//
// Composes Plan 12-01's signing primitives + Plan 12-02's encoder + Phase 11's
// non-EVM account store:
//
//   demo-mode FIRST refusal (Plan 11-06 Solana persona — `getActiveSolanaPersona`)
//     → input validation (`to` base58 regex + `lamports` strict-decimal parse)
//     → pairing check (`listAccounts({ chainFilter: "solana" })` non-empty in real mode)
//     → recent-blockhash resolution via `Connection.getLatestBlockhash`
//     → build System Program Transfer tx → compute messageBytes
//     → compute `payloadFingerprint` via `computeSolanaPayloadFingerprint`
//     → `createHandle` with RAW agent strings on `args` + Solana-typed on `tx`
//     → return `{ handle, to, lamports, recentBlockhash, payloadFingerprint, txType: "solana" }`
//       plus a `PREPARE RECEIPT (Solana — native transfer)` text block.
//
// Three load-bearing invariants asserted by `test/prepare-solana-native-send.test.ts`:
//
//   1. **Demo-mode check FIRES FIRST** (mirror of `prepare_native_send.ts:201-208`).
//      In demo mode: use `getActiveSolanaPersona().solanaAddress` as `feePayer`;
//      refuse with `WRONG_MODE` if no Solana persona is set. `listAccounts` is
//      NEVER called in demo mode — defense against accidental store reads when
//      no pairing is needed. The Solana persona registry is DISTINCT from the
//      EVM `getActivePersona()` — Plan 11-06's `getActiveSolanaPersona()` is
//      the source.
//
//   2. **PREPARE RECEIPT is VERBATIM** (PREP-02 + T-PREP-RCPT-1 mirror) — the
//      block reads from `args.to` + `args.lamports` (RAW agent strings).
//      Base58-normalization via `new PublicKey(...)` happens ONLY for the
//      server-internal `tx.messageBytes` (consumed by
//      `computeSolanaPayloadFingerprint`) and is NEVER surfaced in the text
//      response. A future contributor cannot accidentally normalize the
//      address because `args` is typed `string` (not `PublicKey`).
//
//   3. **`payloadFingerprint` computed AT PREPARE TIME** (SOL-PREP-01) via
//      Plan 12-01's `computeSolanaPayloadFingerprint`. Stored on the handle
//      record; Plan 12-05 re-checks at send time as the drift gate. Fixture
//      K inputs (solana-whale persona + canonical recipient + 1 SOL +
//      fixed-blockhash sentinel) → `0x7c3d1fbc...` (cross-link from
//      `test/signing-fingerprint-solana.test.ts`). The Solana fingerprint IS
//      sender-dependent by construction (contrast with EVM where `from` is
//      not in the EIP-1559 preimage) — `feePayer` is account_keys[0] of the
//      serialized message bytes.
//
// `lamports` is RAW LAMPORTS as a decimal string (NOT decimal SOL). Off-by-
// decimal is the most common user-facing bug class per project CLAUDE.md
// "Decimal-aware arithmetic" — the tool description re-states this explicitly
// to prevent agent confusion. Plan 12-03 adds decimal-aware parsing for SPL
// `prepare_solana_spl_send` via `getMintDecimals`.

import { PublicKey } from "@solana/web3.js";

import { _solanaRegistry } from "../chains/solana/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { InvalidAmountError, parseSolanaAmountStrict } from "../signing/amount-solana.js";
import { PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE } from "../signing/blocks-solana.js";
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
// `1-9A-HJ-NP-Za-km-z` alphabet (no 0, O, I, l). Mirrors the validation in
// `src/tools/get_solana_balance.ts:30` from Phase 11. Pre-validated by Zod-
// like JSON-schema at the dispatch boundary; re-asserted at handler-top as
// defense-in-depth so the structured error has the locked envelope shape
// even if a future schema change loosens the regex.
const BASE58_PUBKEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const DESCRIPTION = [
  "Prepare an unsigned native SOL transfer on Solana mainnet-beta.",
  "Returns a handle the agent then passes to preview_send before send_transaction.",
  "Use when the user wants to send native SOL from their paired Ledger.",
  "Do NOT use for SPL tokens (USDC, USDT, etc.) — that's `prepare_solana_spl_send` (Plan 12-03).",
  "Do NOT use for Ethereum native transfers — that's `prepare_native_send`.",
  "`lamports` is the amount in RAW LAMPORTS as a decimal string (10^9 lamports = 1 SOL).",
  "Do NOT pass decimal SOL — off-by-decimal is the most common user-facing bug class.",
  "`to` is the recipient address as a base58 Solana pubkey (32-44 chars, base58 alphabet).",
  "Requires a paired Solana Ledger (call pair_solana_ledger first if get_solana_status shows paired: false).",
  "Returns `{ handle, to, lamports, recentBlockhash, payloadFingerprint, txType: \"solana\" }` plus a PREPARE RECEIPT text block surfacing verbatim args.",
  "The agent MUST pass the handle to preview_send next — without preview + the resulting previewToken, send_transaction refuses.",
  "In demo mode, succeeds against the active Solana persona's address (set via set_demo_wallet); send_transaction returns a simulation envelope instead of broadcasting.",
  "Failure modes: WALLET_NOT_PAIRED if no Solana account paired (real mode), WRONG_MODE if demo mode is on but no Solana persona is set, INVALID_INPUT if to/lamports malformed, BROADCAST_FAILED if the RPC `getLatestBlockhash` call fails.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    to: {
      type: "string",
      description:
        "Recipient Solana address as a base58 pubkey (32-44 chars). Example: \"AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9\".",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
    lamports: {
      type: "string",
      description:
        "Amount in RAW LAMPORTS as a decimal string (10^9 lamports = 1 SOL). Example: \"1000000000\" for 1 SOL. Do NOT pass decimal SOL — off-by-decimal is the most common user-facing bug class.",
    },
  },
  required: ["to", "lamports"],
  additionalProperties: false,
};

registerTool(
  "prepare_solana_native_send",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // T-ADDR-1 sibling: validate `to` shape BEFORE any state read. Refuses
      // with INVALID_INPUT and names the offending value in the text
      // response so the agent can self-correct. NO handle is created. The
      // JSON-schema pattern above also rejects, but defense-in-depth: a
      // future schema loosening must not bypass the structured-error path.
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

      const rawLamports = typeof args.lamports === "string" ? args.lamports : "";

      // Demo-mode FIRST refusal — read the Solana persona registry (NOT the
      // EVM persona). Plan 11-06 ships `getActiveSolanaPersona()`; demo mode
      // with no Solana persona set is WRONG_MODE.
      //
      // Real-mode pairing read happens AFTER the demo branch so the
      // `listAccounts` call site is not reached when demo mode short-
      // circuits — defense against accidentally consulting the persistent
      // store in a demo session.
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
                  "Call set_demo_wallet with a Solana persona slug (e.g. \"solana-whale\") before preparing demo-mode Solana sends.",
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
        // Real mode — consult the persistent non-EVM account store.
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
        // Single-account scope per v1.x; multi-account dispatch deferred to
        // v2.x. Picks the first record — same shape as
        // `accounts[0]` access in `prepare_native_send.ts:209`. Safe via
        // length-check above.
        const account = accounts[0];
        if (!account) {
          // Unreachable defense-in-depth: the length-check above guarantees
          // accounts[0] exists. Belt-and-braces for the TS strict narrowing.
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

      // Amount parse — `lamports` is RAW LAMPORTS (decimals=0). Reject
      // decimal SOL like "1.5" at this step via fractional-overflow against
      // decimals=0. Throws `InvalidAmountError` → wrap into `INVALID_INPUT`.
      let lamports: bigint;
      try {
        lamports = parseSolanaAmountStrict(rawLamports, 0);
      } catch (err) {
        if (err instanceof InvalidAmountError) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: invalid 'lamports': ${err.message}`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid 'lamports': ${err.message}`,
              err.kind,
            ),
          };
        }
        // Defense: unexpected error class. Re-throw to the outer catch-all.
        throw err;
      }

      // Recent-blockhash resolution. RPC failure → BROADCAST_FAILED (reuse
      // per RESEARCH OQ-3 — generic enough that the agent retries the same
      // way). Pin onto the handle so preview MUST NOT re-fetch (Plan 12-04
      // contract — messageBytes are byte-stable from prepare → preview →
      // send).
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

      // Build the tx + compute the fingerprint. Goes through `_solanaSystem`
      // indirection so tests can spy on the build-side. PublicKey constructors
      // throw on malformed base58 — pre-validated by the regex above but
      // defense-in-depth applies (a future regex widening must not allow
      // through invalid pubkeys silently).
      let feePayer: PublicKey;
      let toPubkey: PublicKey;
      try {
        feePayer = new PublicKey(feePayerBase58);
        toPubkey = new PublicKey(to);
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

      const { messageBytes, programIds, instructionSummary } =
        _solanaSystem.buildSolanaTransferTx({
          from: feePayer,
          to: toPubkey,
          lamports,
          recentBlockhash: blockhash,
        });

      // SOL-PREP-01: compute the binding fingerprint at prepare time. Plan
      // 12-05's send handler re-runs `computeSolanaPayloadFingerprint` on
      // `record.tx.messageBytes` and asserts equality with this stored value
      // (drift gate). Fixture K cross-link: known inputs → known fingerprint
      // literal (`test/signing-fingerprint-solana.test.ts`).
      const payloadFingerprint = computeSolanaPayloadFingerprint({
        messageBytes,
      });

      // PREP-02 + T-PREP-RCPT-1: `args` carries the RAW agent strings; `tx`
      // carries the typed values. The receipt block below reads EXCLUSIVELY
      // from `args` so a future contributor cannot accidentally surface a
      // normalized/checksummed form. The `PrepareArgs` type (`string`, NOT
      // `PublicKey` / `bigint`) blocks normalization at the storage boundary.
      const handle = createHandle({
        args: {
          // EVM-shape fields populated with empty / zero defaults — the
          // discriminator on `tx.txType` is the routing key, but
          // `PrepareArgs.to` + `.valueWei` are required (Phase 4 shape).
          // Solana surfaces `to` as the agent's raw string and `valueWei`
          // as `"0"` sentinel; `lamports` carries the real amount.
          to,
          valueWei: "0",
          lamports: rawLamports,
          recentBlockhash: blockhash,
        },
        tx: {
          txType: "solana",
          // Sentinel zeros — rationale lives in `handle-store.ts` next to
          // the `PreparedTxSolana` definition. EVM call paths that reach a
          // Solana handle will hit Layer 0.5 dispatch-target refusal before
          // reading these.
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
      // The test imports the SAME `PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE`
      // and substitutes identically, asserting byte-identity. Re-declaring
      // the multi-line string in this file (or in the test) would violate
      // the format-fanout-regex-sync invariant.
      const receipt = PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE
        .replace("{TO}", to)
        .replace("{LAMPORTS}", rawLamports)
        .replace("{RECENT_BLOCKHASH}", blockhash);

      return {
        content: [{ type: "text", text: receipt }],
        structuredContent: {
          handle,
          to,
          lamports: rawLamports,
          recentBlockhash: blockhash,
          payloadFingerprint,
          txType: "solana" as const,
          feePayer: feePayer.toBase58(),
        },
      };
    } catch (err) {
      // Defensive catch-all — the explicit refusal paths above should cover
      // all expected failures. INTERNAL_ERROR is the unstructured fallback.
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_solana_native_send failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_solana_native_send failed",
          message,
        ),
      };
    }
  },
);
