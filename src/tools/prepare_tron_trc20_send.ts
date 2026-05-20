// MCP tool: prepare_tron_trc20_send({ to, tokenAddress, amount })
//
// Second step of the Phase 18 TRON trust pipeline (TRON-W-02 / TRON-PREP-02
// consumer). Produces an unsigned TRC-20 TriggerSmartContract transaction with
// `transfer(to, amount)` calldata. TRON sibling of
// `src/tools/prepare_solana_spl_send.ts` (Phase 12 / Plan 12-03 — Solana SPL)
// and `src/tools/prepare_token_send.ts` (Phase 6 / v1.1 EVM ERC-20).
//
// Composes Plan 18-01's signing primitives + Plan 18-03's encoder:
//
//   input-validation (`to` + `tokenAddress` TRON base58check)
//     → token metadata lookup via `findByAddress` (tron-top-25 registry SOT)
//     → amount parse via `parseTronAmountStrict(amount, decimals, "u256")`
//     → demo-mode FIRST refusal (Plan 17-05 TRON persona)
//     → pairing check (`listAccounts({ chainFilter: "tron" })` non-empty in real mode)
//     → get `tronWeb` via `_tronRegistry.getTronWeb()` (ESM spy seam)
//     → call `_tronTrc20.encodeTronTrc20Transfer(...)` (wraps triggerSmartContract +
//       extendExpiration(tx, 900))
//     → compute `payloadFingerprint` via `_tronFingerprint.computeTronPayloadFingerprint`
//     → `createHandle` with RAW agent strings on `args` + TRON-typed on `tx`
//       (kind: "trc20", contractAddress: args.tokenAddress)
//     → return PREPARE RECEIPT via `PREPARE_RECEIPT_TRON_TRC20_TEMPLATE` substitution
//       plus `{ handle, chain: "tron", to, tokenAddress, amount, decimals, symbol,
//               refBlockBytes, refBlockHash, expiration, payloadFingerprint, prepareReceipt }`.
//
// Four load-bearing invariants asserted by `test/prepare-tron-trc20-send.test.ts`:
//
//   1. **Fixture N consumer re-anchor** — the canonical Fixture N inputs
//      (TRON-whale persona sender + canonical recipient + 100 USDT + pinned
//      ref-block) produce the hardcoded literal
//      `0xffa617dd3396eb038869b98e7385aa302e4ff69ed4d7cabe4904370c5015b520`
//      pinned in `test/signing-fingerprint-tron.test.ts`. Drift in preimage
//      assembly fails at BOTH sites — load-bearing redundancy per CLAUDE.md
//      fixture discipline + CONTEXT D-08d.
//
//   2. **INVALID_INPUT FIRST** — `to` + `tokenAddress` validated via
//      `tronweb.utils.address.isAddress` before any state read; `amount` via
//      `parseTronAmountStrict(amount, decimals, "u256")`.
//
//   3. **PREPARE RECEIPT verbatim** (PREP-02) — receipt reads from raw agent
//      strings (no normalization). `amount` is the human-units decimal string
//      the agent passed.
//
//   4. **Persona-cycle sender-dependence** — fingerprint differs across TRON
//      personas because `owner_address` is a Protobuf field in TriggerSmartContract.
//      Distinct from the calldata `to` field which is invariant across personas.
//
// `amount` is HUMAN UNITS decimal string (e.g. "100.5" for 100.5 USDT).
// Server resolves decimals via the tron-top-25 registry (`findByAddress`).
// `parseTronAmountStrict(amount, decimals, "u256")` rejects fractional overflow,
// format errors, and u256 overflow.
//
// Canonical-dispatch note (D-11a): Plan 18-03 prepare succeeds for ANY token
// in tron-top-25.json. Plan 18-04 preview_send fires the Layer 0.5
// canonical-dispatch-tron allowlist against the 4-entry stablecoin set
// (USDT/USDC/USDD/TUSD). Defense-in-depth: prepare is friction-reducing UX;
// preview refuses non-allowlist tokens at the security gate.
//
// Token registry helper (`findByAddress`) is imported directly from
// `../tokens/tron-top-25.js` — per CLAUDE.md no-server-self-call discipline,
// we consume the exported helper function rather than going through the MCP
// tool surface. No ABI fallback in this tool — registry miss → INVALID_INPUT
// envelope naming the supported Phase 18 stablecoin set.

import { utils as tronUtils } from "tronweb";

import { _tronRegistry } from "../chains/tron/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActiveTronPersona } from "../demo/state.js";
import {
  InvalidAmountError,
  parseTronAmountStrict,
} from "../signing/amount-tron.js";
import { PREPARE_RECEIPT_TRON_TRC20_TEMPLATE } from "../signing/blocks-tron.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  type PrepareArgs,
  type PreparedTxTron,
  createHandle,
} from "../signing/handle-store.js";
import { _tronFingerprint } from "../signing/payload-fingerprint-tron.js";
import { findByAddress } from "../tokens/tron-top-25.js";
import { _tronTrc20 } from "../protocols/tron-trc20.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

// The shared `ToolHandlerResult.structuredContent` type is
// `Record<string, unknown>`; `StructuredError` is an explicit interface
// without an index signature. Cast at the boundary.
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
  "Prepare an unsigned TRC-20 transfer (TriggerSmartContract with `transfer(to, amount)` ABI) from the paired TRON Ledger account.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to send a TRC-20 token (USDT-TRC20 / USDC-TRC20 / USDD / TUSD in v2.1 scope).",
  "Do NOT use for native TRX — that is `prepare_tron_native_send`.",
  "Do NOT use for TRC-20 approve / revoke — those are Phase 19.",
  "`amount` is decimal in HUMAN UNITS (e.g. `\"100.5\"` for 100.5 USDT) — server resolves decimals via the tron-top-25 registry.",
  "`tokenAddress` MUST be a base58check TRON address; non-allowlist tokens refuse at `preview_send` Layer 0.5.",
  "Returns `{ handle, chain: \"tron\", to, tokenAddress, amount, decimals, symbol, refBlockBytes, refBlockHash, expiration, payloadFingerprint, prepareReceipt }`.",
  "In demo mode, succeeds against the active TRON persona address.",
  "Failure modes: WALLET_NOT_PAIRED / WRONG_MODE / INVALID_INPUT (to / tokenAddress / amount malformed, or token not in registry) / INTERNAL_ERROR (RPC or metadata-lookup failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    to: {
      type: "string",
      description:
        "Recipient TRON address (base58check T-prefixed, 34 chars). Example: \"TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8\".",
    },
    tokenAddress: {
      type: "string",
      description:
        "TRC-20 token contract address (base58check T-prefixed, 34 chars). Phase 18 MUST be one of: USDT-TRC20 (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t), USDC-TRC20 (TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8), USDD (TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn), TUSD (TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4). preview_send refuses non-allowlist tokens at Layer 0.5 canonical-dispatch.",
    },
    amount: {
      type: "string",
      description:
        "Amount in HUMAN UNITS as a decimal string. e.g. \"100.5\" for 100.5 USDT (server resolves decimals via get_tron_token_metadata registry).",
      pattern: "^[0-9]+(\\.[0-9]+)?$",
    },
  },
  required: ["to", "tokenAddress", "amount"],
  additionalProperties: false,
};

registerTool(
  "prepare_tron_trc20_send",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawTo = typeof args.to === "string" ? args.to : "";
      const rawTokenAddress =
        typeof args.tokenAddress === "string" ? args.tokenAddress : "";
      const rawAmount = typeof args.amount === "string" ? args.amount : "";

      // -----------------------------------------------------------------------
      // Step 1: Input validation — FIRES FIRST (before any state read).
      // -----------------------------------------------------------------------

      // Validate `to` address via `tronweb.utils.address.isAddress`.
      if (!tronUtils.address.isAddress(rawTo)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'to' address: expected a valid TRON base58check address (T-prefixed, 34 chars), got "${rawTo}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'to' address: "${rawTo}" is not a valid TRON base58check address`,
          ),
        };
      }

      // Validate `tokenAddress` via `tronweb.utils.address.isAddress`.
      if (!tronUtils.address.isAddress(rawTokenAddress)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'tokenAddress': expected a valid TRON base58check address (T-prefixed, 34 chars), got "${rawTokenAddress}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'tokenAddress': "${rawTokenAddress}" is not a valid TRON base58check address`,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 2: Token metadata lookup — registry-first, no ABI fallback.
      // `findByAddress` is the internal helper exported from tron-top-25.ts.
      // Per CLAUDE.md no-server-self-call discipline: we import directly, no MCP round-trip.
      // -----------------------------------------------------------------------
      const metadata = findByAddress(rawTokenAddress);
      if (!metadata) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: token not found in tron-top-25 registry for address "${rawTokenAddress}". ` +
                "Phase 18 supports: USDT-TRC20 (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t), " +
                "USDC-TRC20 (TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8), " +
                "USDD (TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn), " +
                "TUSD (TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4).",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `token not found in tron-top-25 registry: "${rawTokenAddress}". Phase 18 supports USDT/USDC/USDD/TUSD on TRON.`,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 3: Validate + parse `amount` via parseTronAmountStrict("u256").
      // TRC-20 amounts are ABI uint256. `decimals` resolved from the registry.
      // -----------------------------------------------------------------------
      let parsedAmount: bigint;
      try {
        parsedAmount = parseTronAmountStrict(rawAmount, metadata.decimals, "u256");
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

      // -----------------------------------------------------------------------
      // Step 4: Demo-mode FIRST refusal — read TRON persona registry.
      // Real-mode pairing check happens AFTER the demo branch so `listAccounts`
      // is NEVER called in demo mode.
      // -----------------------------------------------------------------------
      const demoActive = isDemoMode();
      const tronPersona = getActiveTronPersona();

      let fromAddress: string;
      if (demoActive) {
        if (!tronPersona) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: demo mode is on but no TRON persona is set. " +
                  "Call set_demo_wallet with a TRON persona slug (e.g. \"tron-whale\") before preparing demo-mode TRON sends.",
              },
            ],
            structuredContent: errEnvelope(
              "WRONG_MODE",
              "demo mode is on but no TRON persona is set; call set_demo_wallet first",
            ),
          };
        }
        fromAddress = tronPersona.tronAddress;
      } else {
        // Real mode — consult the persistent non-EVM account store.
        const accounts = listAccounts({ chainFilter: "tron" });
        if (accounts.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: no paired TRON account. Pair your Ledger TRON app via `pair_tron_ledger` before preparing TRC-20 transfers.",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired TRON account; call pair_tron_ledger first",
            ),
          };
        }
        const account = accounts[0];
        if (!account) {
          // Unreachable defense-in-depth: length-check above guarantees accounts[0].
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "error: no paired TRON account (unreachable narrowing).",
              },
            ],
            structuredContent: errEnvelope(
              "WALLET_NOT_PAIRED",
              "no paired TRON account (unreachable narrowing)",
            ),
          };
        }
        fromAddress = account.address;
      }

      // -----------------------------------------------------------------------
      // Step 5: Get TronWeb instance via the ESM spy seam.
      // -----------------------------------------------------------------------
      const tronWeb = _tronRegistry.getTronWeb();

      // -----------------------------------------------------------------------
      // Step 6: Encode the TriggerSmartContract tx via the protocol layer.
      // `encodeTronTrc20Transfer` calls triggerSmartContract + extendExpiration(tx, 900).
      // -----------------------------------------------------------------------
      let encoded;
      try {
        encoded = await _tronTrc20.encodeTronTrc20Transfer({
          tronWeb,
          from: fromAddress,
          to: rawTo,
          tokenAddress: rawTokenAddress,
          amount: parsedAmount,
          decimals: metadata.decimals,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to build TRON TriggerSmartContract: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            "failed to build TRON TriggerSmartContract",
            cause,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 7: Compute the binding payloadFingerprint at prepare time.
      // Plan 18-04 re-runs this at send time; drift → PAYLOAD_FINGERPRINT_DRIFT.
      // Fixture N cross-link: known inputs → known fingerprint literal
      // (`test/signing-fingerprint-tron.test.ts:Fixture N`).
      // -----------------------------------------------------------------------
      const payloadFingerprint = _tronFingerprint.computeTronPayloadFingerprint(
        { rawDataBytes: encoded.rawDataBytes },
      );

      // -----------------------------------------------------------------------
      // Step 8: Build PreparedTxTron + PrepareArgs shapes.
      // kind: "trc20" + contractAddress differentiate from Plan 18-02's "native".
      // -----------------------------------------------------------------------
      const tx: PreparedTxTron = {
        txType: "tron",
        // EVM-shape sentinel fields — rationale in handle-store.ts next to
        // PreparedTxTron definition.
        chainId: 0,
        to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        valueWei: 0n,
        data: "0x" as `0x${string}`,
        // TRON-specific cryptographic-binding fields.
        rawDataHex: encoded.rawDataHex,
        rawDataObject: encoded.rawDataObject,
        refBlockBytes: encoded.refBlockBytes,
        refBlockHash: encoded.refBlockHash,
        expiration: encoded.expiration,
        kind: "trc20",
        contractAddress: rawTokenAddress,
        instructionSummary: encoded.instructionSummary,
      };

      const prepareArgs: PrepareArgs = {
        to: rawTo, // verbatim agent string
        valueWei: "0", // sentinel for non-EVM
        tokenAddress: rawTokenAddress, // verbatim agent string
        amount: rawAmount, // verbatim agent string (human units)
        refBlockBytes: encoded.refBlockBytes,
        refBlockHash: encoded.refBlockHash,
        expiration: String(encoded.expiration),
      };

      const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

      // -----------------------------------------------------------------------
      // Step 9: Build PREPARE RECEIPT from format-fanout-sentinel const.
      // The test imports the SAME `PREPARE_RECEIPT_TRON_TRC20_TEMPLATE` and
      // substitutes identically, asserting byte-identity.
      // -----------------------------------------------------------------------
      const prepareReceipt = PREPARE_RECEIPT_TRON_TRC20_TEMPLATE
        .replace("{TO}", rawTo)
        .replace("{TOKEN_ADDRESS}", rawTokenAddress)
        .replace("{AMOUNT}", rawAmount)
        .replace("{REF_BLOCK_BYTES}", encoded.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", encoded.refBlockHash)
        .replace("{EXPIRATION}", String(encoded.expiration));

      const responseText =
        `${prepareReceipt}\n\nToken: ${metadata.symbol} (decimals=${metadata.decimals})\n` +
        `Handle: ${handle}\npayloadFingerprint: ${payloadFingerprint}\n\nNext step: pass this handle to preview_send.`;

      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: {
          handle,
          chain: "tron" as const,
          to: rawTo,
          tokenAddress: rawTokenAddress,
          amount: rawAmount,
          decimals: metadata.decimals,
          symbol: metadata.symbol,
          refBlockBytes: encoded.refBlockBytes,
          refBlockHash: encoded.refBlockHash,
          expiration: encoded.expiration,
          payloadFingerprint,
          prepareReceipt,
          txType: "tron" as const,
        },
      };
    } catch (err) {
      // Defensive catch-all — explicit refusal paths above cover all expected
      // failures. INTERNAL_ERROR is the unstructured fallback.
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_tron_trc20_send failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_tron_trc20_send failed",
          message,
        ),
      };
    }
  },
);
