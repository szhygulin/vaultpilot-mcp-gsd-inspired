// MCP tool: prepare_tron_token_approve({ tokenAddress, spender, amount, from? })
//
// Phase 19 — Plan 19-01 (TRON-PREP-05). Produces an unsigned TRC-20
// TriggerSmartContract transaction with `approve(spender, amount)` calldata.
// TRON sibling of `src/tools/prepare_token_approve.ts` (Phase 6 EVM analog).
//
// D-01 byte-identity invariant: the shared `prepareTronApproveInternal` helper
// is ALSO exported and imported by `prepare_tron_revoke_approval.ts` (Plan
// 19-01 sibling). Both tools call the SAME encode path — drift is impossible by
// construction. T-TRON-REVOKE-DRIFT-1 asserts this in the test suite.
//
// D-02b: `"max"` (strict lowercase equality only) → U256_MAX encoding.
//   `"MAX"` / `"unlimited"` / `"infinite"` rejected by parseTronAmountStrict.
//
// D-02c: PREPARE RECEIPT surfaces the agent's verbatim raw `amount` string
//   (e.g. `"max"` NOT the expanded MAX_UINT256 decimal).
//
// instructionSummary kind discrimination:
//   rawAmount === "0" → kind: "trc20-revoke" (no `amount` field on summary)
//   else             → kind: "trc20-approve" (with `amount`, `amountIsMax`)
// This preserves D-01 byte-identity at the calldata level while giving the
// surface layer the correct discriminator for preview_send.
//
// Token decimals: resolved via `findByAddress` from tron-top-25 registry.
// Per canonical-dispatch note: approve succeeds for ANY token with a registry
// entry. The preview_send approve arm does NOT enforce the 4-stablecoin allowlist
// (Layer 0.5) — that allowlist guards TRC-20 transfer counterparties, not approve
// token contracts.
//
// Fixture Tron-19-A cross-link: the consumer re-anchor test in
// `test/prepare-tron-token-approve.test.ts` asserts the fingerprint matches the
// hardcoded literal from `test/signing-fingerprint-tron-19.test.ts`.

import { utils as tronUtils } from "tronweb";

import { _tronRegistry } from "../chains/tron/registry.js";
import { isDemoMode } from "../config/env.js";
import { _contractsTron } from "../config/contracts.js";
import { getActiveTronPersona } from "../demo/state.js";
import { _tronApprove } from "../protocols/tron-approve.js";
import {
  InvalidAmountError,
  U256_MAX,
  parseTronAmountStrict,
} from "../signing/amount-tron.js";
import {
  KNOWN_SPENDER_LABEL_TRON_TEMPLATE,
  PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE,
} from "../signing/blocks-tron.js";
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
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { type ToolHandlerResult, registerTool } from "./index.js";

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

// ============================================================================
// Description + Input Schema
// ============================================================================

const DESCRIPTION = [
  "Prepare an unsigned TRC-20 approve transaction (TriggerSmartContract with `approve(spender, amount)` ABI) from the paired TRON Ledger account.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to authorize a spender (a DEX router like SunSwap, a bridge like LiFi, etc.) to move TRC-20 tokens on their behalf.",
  "Do NOT use to REVOKE an existing approval — call prepare_tron_revoke_approval instead.",
  "Do NOT use for TRC-20 transfers — that is prepare_tron_trc20_send.",
  "`tokenAddress` and `spender` MUST be valid TRON base58check addresses (T-prefixed, 34 chars).",
  "`amount` is a DECIMAL STRING in human units (e.g. \"100.5\") OR the literal string \"max\" for MAX_UINT256 (= 2^256-1). \"max\" is the ONLY accepted unlimited spelling — \"MAX\" / \"unlimited\" / \"infinite\" refuse with INVALID_INPUT.",
  "In demo mode, succeeds against the active TRON persona address.",
  "Returns { handle, chain: \"tron\", tokenAddress, spender, spenderLabel, amount, amountResolved, amountIsMax, payloadFingerprint, prepareReceipt, instructionSummary }.",
  "Failure modes: WALLET_NOT_PAIRED / WRONG_MODE / INVALID_INPUT (addresses malformed, amount malformed, or token not in tron-top-25 registry) / INTERNAL_ERROR (RPC or encode failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    tokenAddress: {
      type: "string",
      description:
        "TRC-20 token contract address (TRON base58check T-prefixed, 34 chars). Example: \"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t\" (USDT-TRC20).",
    },
    spender: {
      type: "string",
      description:
        "Contract address being approved to spend tokens (TRON base58check T-prefixed, 34 chars). Example: \"TKzxdSv2FZKQrEqkKVgp5DcwEXBEKMg2Ax\" (SunSwap V2 Router).",
    },
    amount: {
      type: "string",
      description:
        "Amount in HUMAN UNITS as a decimal string (e.g. \"100.5\" for 100.5 USDT), OR the literal string \"max\" for MAX_UINT256. \"max\" is the only accepted unlimited spelling.",
    },
    from: {
      type: "string",
      description:
        "Override sender address (TRON base58check). Optional — omit to use the active TRON account or demo persona.",
    },
  },
  required: ["tokenAddress", "spender", "amount"],
  additionalProperties: false,
};

// ============================================================================
// prepareTronApproveInternal — shared byte-identity enforcement point (D-01)
// ============================================================================

/**
 * Shared internal helper for `prepare_tron_token_approve` AND
 * `prepare_tron_revoke_approval`. Both tools call this with the same encode
 * path — byte-identity is enforced BY CONSTRUCTION per D-01.
 *
 * instructionSummary kind discrimination:
 *   - `rawAmount === "0"` → `{ kind: "trc20-revoke", from, tokenAddress, spender, spenderLabel }`
 *   - else               → `{ kind: "trc20-approve", from, tokenAddress, spender, amount: amountWei, amountIsMax, spenderLabel }`
 *
 * Calldata is byte-identical for both paths when `amountWei === 0n`; the
 * surface-layer distinction lives in `instructionSummary`, not the calldata.
 *
 * Exported for import by `prepare_tron_revoke_approval.ts` (D-01c).
 */
export async function prepareTronApproveInternal(input: {
  rawTokenAddress: string;
  rawSpender: string;
  /** Verbatim agent-supplied amount string — D-02c. Stored in PrepareArgs and PREPARE RECEIPT. */
  rawAmount: string;
  /** Resolved bigint amount for calldata encoding. */
  amountWei: bigint;
  /** True iff rawAmount === "max" (D-02b strict equality) OR amountWei === U256_MAX. */
  amountIsMax: boolean;
  /** Resolved sender address (from demo persona or paired account). */
  fromAddress: string;
  /** Token decimals (from tron-top-25 registry). */
  tokenDecimals: number;
}): Promise<ToolHandlerResult> {
  const {
    rawTokenAddress,
    rawSpender,
    rawAmount,
    amountWei,
    amountIsMax,
    fromAddress,
    tokenDecimals: _tokenDecimals, // consumed by findByAddress; not used in encode
  } = input;

  // Step 5: Get TronWeb instance via the ESM spy seam.
  const tronWeb = _tronRegistry.getTronWeb();

  // Step 6: Encode the TriggerSmartContract tx via the protocol layer.
  // `encodeTronTrc20Approve` calls triggerSmartContract + extendExpiration(tx, 900).
  // amount.toString() is LOAD-BEARING inside the encoder (tronweb ABI boundary).
  let encoded;
  try {
    encoded = await _tronApprove.encodeTronTrc20Approve({
      tronWeb,
      from: fromAddress,
      tokenAddress: rawTokenAddress,
      spender: rawSpender,
      amount: amountWei,
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: failed to build TRON approve TriggerSmartContract: ${cause}`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "failed to build TRON approve TriggerSmartContract",
        cause,
      ),
    };
  }

  // Step 7: Compute the binding payloadFingerprint at prepare time.
  // preview_send re-runs this at send time; drift → PAYLOAD_FINGERPRINT_DRIFT.
  // Fixture Tron-19-A cross-link: known inputs → known fingerprint literal
  // (`test/signing-fingerprint-tron-19.test.ts:Fixture Tron-19-A`).
  const payloadFingerprint = _tronFingerprint.computeTronPayloadFingerprint({
    rawDataBytes: encoded.rawDataBytes,
  });

  // Step 8: Resolve spender label from KNOWN_SPENDERS_TRON.
  const spenderRow = _contractsTron.lookupTronSpender(rawSpender);
  const spenderLabel =
    spenderRow?.label ?? "(unknown spender — no prior interaction recorded)";

  // Step 9: Build instructionSummary kind discrimination (D-01 surface distinction).
  // rawAmount === "0" identifies revoke at the SURFACE layer; calldata bytes are
  // identical for approve(spender, 0n) and revoke(spender). This is the contract.
  const instructionSummary =
    rawAmount === "0"
      ? ([
          {
            kind: "trc20-revoke" as const,
            from: fromAddress,
            tokenAddress: rawTokenAddress,
            spender: rawSpender,
            spenderLabel,
          },
        ])
      : ([
          {
            kind: "trc20-approve" as const,
            from: fromAddress,
            tokenAddress: rawTokenAddress,
            spender: rawSpender,
            amount: amountWei,
            amountIsMax,
            spenderLabel,
          },
        ]);

  // Step 10: Build PreparedTxTron + PrepareArgs shapes.
  // kind: "trc20" + contractAddress (approve is a TriggerSmartContract dispatch).
  const tx: PreparedTxTron = {
    txType: "tron",
    // EVM-shape sentinel fields — rationale in handle-store.ts PreparedTxTron definition.
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
    instructionSummary,
  };

  // PrepareArgs: verbatim agent strings. `amount` slot = rawAmount (D-02c).
  // The handle's args MUST include tokenAddress + spender + amount so the
  // preview_send arm can re-render PREPARE RECEIPT identically.
  const prepareArgs: PrepareArgs = {
    to: rawSpender, // approve has no separate "to" recipient; using spender for arg carry
    valueWei: "0",
    tokenAddress: rawTokenAddress,
    spender: rawSpender,
    amount: rawAmount, // verbatim (D-02c)
    refBlockBytes: encoded.refBlockBytes,
    refBlockHash: encoded.refBlockHash,
    expiration: String(encoded.expiration),
  };

  const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

  // Step 11: Build PREPARE RECEIPT from format-fanout-sentinel const.
  // {AMOUNT} slot = rawAmount (verbatim per D-02c — surfaces "max" for unlimited).
  const prepareReceipt = PREPARE_RECEIPT_TRON_APPROVE_TEMPLATE
    .replace("{CHAIN}", "TRON mainnet")
    .replace("{TOKEN}", rawTokenAddress)
    .replace("{SPENDER}", rawSpender)
    .replace("{AMOUNT}", rawAmount)
    .replace("{REF_BLOCK_BYTES}", encoded.refBlockBytes)
    .replace("{REF_BLOCK_HASH}", encoded.refBlockHash)
    .replace("{EXPIRATION}", String(encoded.expiration));

  // Step 12: Build KNOWN_SPENDER_LABEL_TRON_TEMPLATE block.
  const spenderLabelBlock = KNOWN_SPENDER_LABEL_TRON_TEMPLATE
    .replace("{SPENDER}", rawSpender)
    .replace("{LABEL}", spenderLabel)
    .replace("{SOURCE}", spenderRow?.source ?? "KNOWN_SPENDERS_TRON sub-table (src/config/contracts.ts)");

  const responseText =
    `${prepareReceipt}\n\n${spenderLabelBlock}\n\n` +
    `Handle: ${handle}\npayloadFingerprint: ${payloadFingerprint}\n\nNext step: pass this handle to preview_send.`;

  return {
    content: [{ type: "text", text: responseText }],
    structuredContent: {
      handle,
      chain: "tron" as const,
      tokenAddress: rawTokenAddress,
      spender: rawSpender,
      spenderLabel,
      amount: rawAmount,
      amountResolved: amountWei.toString(),
      amountIsMax,
      refBlockBytes: encoded.refBlockBytes,
      refBlockHash: encoded.refBlockHash,
      expiration: encoded.expiration,
      payloadFingerprint,
      prepareReceipt,
      instructionSummary,
      txType: "tron" as const,
    },
  };
}

// ============================================================================
// Tool registration
// ============================================================================

registerTool(
  "prepare_tron_token_approve",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawTokenAddress =
        typeof args.tokenAddress === "string" ? args.tokenAddress : "";
      const rawSpender =
        typeof args.spender === "string" ? args.spender : "";
      const rawAmount = typeof args.amount === "string" ? args.amount : "";

      // -----------------------------------------------------------------------
      // Step 1: Input validation — FIRES FIRST (before any state read).
      // -----------------------------------------------------------------------

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
            "tokenAddress",
          ),
        };
      }

      if (!tronUtils.address.isAddress(rawSpender)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'spender': expected a valid TRON base58check address (T-prefixed, 34 chars), got "${rawSpender}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'spender': "${rawSpender}" is not a valid TRON base58check address`,
            "spender",
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 2: Token metadata lookup — registry-first, no ABI fallback.
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
                "Phase 19 approve supports tokens in the tron-top-25 registry: USDT-TRC20, USDC-TRC20, USDD, TUSD, and others.",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `token not found in tron-top-25 registry: "${rawTokenAddress}"`,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 3: D-02b "max" sentinel + parseTronAmountStrict for everything else.
      // Strict lowercase equality: only "max" → U256_MAX.
      // "MAX" / "unlimited" / "infinite" → parseTronAmountStrict → INVALID_INPUT.
      // -----------------------------------------------------------------------
      let amountWei: bigint;
      let amountIsMax: boolean;

      if (rawAmount === "max") {
        // D-02b: strict lowercase sentinel.
        amountWei = U256_MAX;
        amountIsMax = true;
      } else {
        try {
          amountWei = parseTronAmountStrict(rawAmount, metadata.decimals, "u256");
          amountIsMax = amountWei === U256_MAX;
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
      }

      // -----------------------------------------------------------------------
      // Step 4: Demo/real-mode resolution — mirrors prepare_tron_trc20_send.ts.
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
                  "Call set_demo_wallet with a TRON persona slug (e.g. \"tron-whale\") before preparing demo-mode TRON approvals.",
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
        const accounts = listAccounts({ chainFilter: "tron" });
        if (accounts.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  "error: no paired TRON account. Pair your Ledger TRON app via `pair_tron_ledger` before preparing TRC-20 approvals.",
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

      // Handle optional `from` override (demo persona override).
      const rawFrom = typeof args.from === "string" ? args.from : undefined;
      if (rawFrom !== undefined) {
        if (!tronUtils.address.isAddress(rawFrom)) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `error: invalid 'from': expected a valid TRON base58check address (T-prefixed, 34 chars), got "${rawFrom}"`,
              },
            ],
            structuredContent: errEnvelope(
              "INVALID_INPUT",
              `invalid 'from': "${rawFrom}" is not a valid TRON base58check address`,
              "from",
            ),
          };
        }
        fromAddress = rawFrom;
      }

      // -----------------------------------------------------------------------
      // Steps 5-12: Delegate to shared byte-identity helper.
      // -----------------------------------------------------------------------
      return await prepareTronApproveInternal({
        rawTokenAddress,
        rawSpender,
        rawAmount,
        amountWei,
        amountIsMax,
        fromAddress,
        tokenDecimals: metadata.decimals,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_tron_token_approve failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_tron_token_approve failed",
          message,
        ),
      };
    }
  },
);
