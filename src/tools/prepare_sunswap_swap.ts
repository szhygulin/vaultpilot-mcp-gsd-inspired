// MCP tool: prepare_sunswap_swap({ inputToken, outputToken, amount, slippageBps?, from? })
//
// Phase 20 — Plan 20-01 (TRON-W-09). Produces an unsigned TriggerSmartContract
// transaction for SunSwap V2 `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)`.
//
// D-03b: Sandwich-MEV gate at PREPARE time. When `priceImpactBps > 200` AND the
//   agent did NOT explicitly supply `slippageBps`, the tool refuses with
//   `INVALID_INPUT + hintTool: "get_sunswap_quote"`. Detection is via pre-Zod raw
//   args presence check (Zod's `.default(50)` would mask the distinction).
//
// D-03c: Gate passes when `slippageBps` IS explicitly supplied (ANY value),
//   regardless of impact magnitude. The gate is "did the user supply slippage
//   explicitly", NOT "is the slippage low enough". Phase 14 Jupiter precedent.
//
// D-10: Path computation SERVER-SIDE (NEVER agent-supplied). The server computes
//   `path = [inputToken, outputToken]` for direct WTRX pairs or
//   `path = [inputToken, WTRX, outputToken]` for non-WTRX pairs (via quote.route).
//
// amountOutMin: `(quote.outAmount * BigInt(10000 - slippageBps)) / 10000n`
//   NEVER zero (slippageBps = 10000 refused with INVALID_INPUT).
//
// deadline: `Math.floor(Date.now() / 1000) + 600` (10 min unix seconds).
//
// Fixture Tron-20-A cross-link: the consumer re-anchor test in
//   `test/prepare-sunswap-swap.test.ts` asserts the fingerprint matches the
//   hardcoded literal from `test/signing-fingerprint-tron-20.test.ts`.
//
// T-CONFIG-LITERAL-MIGRATION-1: NEVER inline the SunSwap V2 router address.
//   Consume via `SUNSWAP_V2_ROUTER_TRON_ADDRESS` from canonical-dispatch-tron.ts.

import { utils as tronUtils } from "tronweb";

import { _sunswapClient } from "../clients/sunswap.js";
import { _tronRegistry } from "../chains/tron/registry.js";
import { isDemoMode } from "../config/env.js";
import { getActiveTronPersona } from "../demo/state.js";
import { _sunSwapTron } from "../protocols/sunswap-tron.js";
import {
  SUNSWAP_V2_ROUTER_TRON_ADDRESS,
  _canonicalDispatchTron,
} from "../security/canonical-dispatch-tron.js";
import {
  InvalidAmountError,
  parseTronAmountStrict,
} from "../signing/amount-tron.js";
import {
  PREPARE_RECEIPT_TRON_SUNSWAP_TEMPLATE,
  SANDWICH_MEV_REFUSAL_TRON_TEMPLATE,
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
  hintTool?: string,
): Record<string, unknown> {
  const base = makeStructuredError(code, message, cause) as unknown as Record<
    string,
    unknown
  > &
    StructuredError;
  if (hintTool !== undefined) {
    return { ...base, hintTool };
  }
  return base;
}

// ============================================================================
// Description + Input Schema
// ============================================================================

const DESCRIPTION = [
  "Prepare an unsigned SunSwap V2 swap transaction (TriggerSmartContract with swapExactTokensForTokens ABI) from the paired TRON Ledger account.",
  "Uses SunSwap V2 router — V3 and Smart Router paths are out of scope for v2.1.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to swap TRC-20 tokens on TRON via SunSwap V2.",
  "ensure inputToken approval exists; use prepare_tron_token_approve first if needed.",
  "`inputToken` and `outputToken` MUST be valid TRON base58check addresses (T-prefixed, 34 chars).",
  "`amount` is a DECIMAL STRING in human units (e.g. '100.5' for 100.5 USDT).",
  "When omitted, `slippageBps` defaults to 50 (0.5%). When price impact exceeds 2% and slippageBps is NOT explicitly supplied, the tool refuses with INVALID_INPUT (sandwich-MEV defense — call get_sunswap_quote first, then pass slippageBps explicitly to confirm acceptance).",
  "Path computation is server-side (NEVER agent-supplied) — direct pair for WTRX swaps, hop-through-WTRX for all other pairs.",
  "Returns { handle, chain: 'tron', inputToken, outputToken, inAmount, outAmount, amountOutMin, priceImpactBps, slippageBps, path, deadline, payloadFingerprint, prepareReceipt, instructionSummary }.",
  "Failure modes: WALLET_NOT_PAIRED / WRONG_MODE / INVALID_INPUT (addresses malformed, amount malformed, price impact > 2% without explicit slippage, or token not in tron-top-25 registry) / DISPATCH_TARGET_REFUSED (router not in smartcontract allowlist — internal integrity gate) / INTERNAL_ERROR (RPC or encode failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    inputToken: {
      type: "string",
      description:
        "Input TRC-20 token contract address (TRON base58check T-prefixed, 34 chars). Example: \"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t\" (USDT-TRC20).",
    },
    outputToken: {
      type: "string",
      description:
        "Output TRC-20 token contract address (TRON base58check T-prefixed, 34 chars). Example: \"TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR\" (WTRX).",
    },
    amount: {
      type: "string",
      description:
        "Input amount in HUMAN UNITS as a decimal string (e.g. \"1\" for 1 USDT; server resolves decimals via tron-top-25 registry).",
    },
    slippageBps: {
      type: "number",
      description:
        "Slippage tolerance in basis points (integer, 0–10000). Default: 50 (0.5%). When price impact > 200 bps (2%), this MUST be supplied explicitly — omitting it triggers the sandwich-MEV defense refusal.",
    },
    from: {
      type: "string",
      description:
        "Override sender address (TRON base58check). Optional — omit to use the active TRON account or demo persona.",
    },
  },
  required: ["inputToken", "outputToken", "amount"],
  additionalProperties: false,
};

// ============================================================================
// Tool registration
// ============================================================================

registerTool(
  "prepare_sunswap_swap",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // -----------------------------------------------------------------------
      // CRITICAL — Pre-Zod explicit-slippage detection (D-03b / D-03c / Test 9).
      // Must happen BEFORE any default resolution. Zod's `.default(50)` would
      // mask the distinction between agent-supplied and default. We check the
      // RAW input object for `slippageBps` key presence.
      // -----------------------------------------------------------------------
      const rawArgs = args as Record<string, unknown>;
      const slippageWasExplicit: boolean =
        "slippageBps" in rawArgs && rawArgs.slippageBps !== undefined;

      const rawInputToken =
        typeof args.inputToken === "string" ? args.inputToken : "";
      const rawOutputToken =
        typeof args.outputToken === "string" ? args.outputToken : "";
      const rawAmount =
        typeof args.amount === "string" ? args.amount : "";
      const slippageBps: number =
        typeof args.slippageBps === "number" ? args.slippageBps : 50;

      // -----------------------------------------------------------------------
      // Step 1: Address validation.
      // -----------------------------------------------------------------------
      if (!tronUtils.address.isAddress(rawInputToken)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'inputToken': expected a valid TRON base58check address (T-prefixed, 34 chars), got "${rawInputToken}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'inputToken': "${rawInputToken}" is not a valid TRON base58check address`,
            "inputToken",
          ),
        };
      }

      if (!tronUtils.address.isAddress(rawOutputToken)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'outputToken': expected a valid TRON base58check address (T-prefixed, 34 chars), got "${rawOutputToken}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'outputToken': "${rawOutputToken}" is not a valid TRON base58check address`,
            "outputToken",
          ),
        };
      }

      // Validate slippageBps range
      if (
        !Number.isInteger(slippageBps) ||
        slippageBps < 0 ||
        slippageBps > 10000
      ) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'slippageBps': expected an integer in [0, 10000], got ${slippageBps}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'slippageBps': ${slippageBps} is not an integer in [0, 10000]`,
            "slippageBps",
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 2: Demo/real-mode resolution.
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
                  "Call set_demo_wallet with a TRON persona slug (e.g. \"tron-whale\") before preparing demo-mode TRON swaps.",
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
                  "error: no paired TRON account. Pair your Ledger TRON app via `pair_tron_ledger` before preparing TRON swaps.",
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

      // Handle optional `from` override.
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
      // Step 3: Token metadata lookup for input token (decimals).
      // -----------------------------------------------------------------------
      const inputMetadata = findByAddress(rawInputToken);
      if (!inputMetadata) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: token not found in tron-top-25 registry for inputToken "${rawInputToken}". ` +
                "Phase 20 prepare_sunswap_swap supports tokens in the tron-top-25 registry.",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `token not found in tron-top-25 registry: inputToken "${rawInputToken}"`,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 4: Amount parsing — decimal-aware per CLAUDE.md.
      // -----------------------------------------------------------------------
      let inAmount: bigint;
      try {
        inAmount = parseTronAmountStrict(rawAmount, inputMetadata.decimals, "u256");
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
      // Step 5: Cheap dispatch gate (defense-in-depth — T-SUNSWAP-DISPATCH-DRIFT).
      // Asserts the SunSwap V2 router is in the smartcontract allowlist.
      // This fires BEFORE encoding — catches SOT drift early (byte-identical to
      // KNOWN_SPENDERS_TRON[0].address by Task 1 T-SOT-DRIFT-1 test).
      // -----------------------------------------------------------------------
      const dispatchCheck = _canonicalDispatchTron.checkTronSmartContractDispatchTarget([
        SUNSWAP_V2_ROUTER_TRON_ADDRESS,
      ]);
      if (dispatchCheck.kind === "refused") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: DISPATCH_TARGET_REFUSED — SunSwap V2 router "${SUNSWAP_V2_ROUTER_TRON_ADDRESS}" ` +
                `is not in the TRON smartcontract dispatch allowlist. Offenders: ${dispatchCheck.offenders.join(", ")}`,
            },
          ],
          structuredContent: errEnvelope(
            "DISPATCH_TARGET_REFUSED",
            `TRON smartcontract dispatch refused: "${SUNSWAP_V2_ROUTER_TRON_ADDRESS}" not in allowlist`,
            dispatchCheck.offenders.join(", "),
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 6: Fetch quote (LOAD-BEARING for sandwich-MEV gate).
      // Path computation server-side (direct OR hop-through-WTRX via quote.route).
      // -----------------------------------------------------------------------
      const quote = await _sunswapClient.fetchSunswapQuote({
        inputToken: rawInputToken,
        outputToken: rawOutputToken,
        amount: inAmount,
        slippageBps,
      });

      if (quote === null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: SunSwap quote unavailable — RPC failure or pair not found. " +
                "Check that both tokens have a SunSwap V2 liquidity pool and TronGrid is reachable.",
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            "SunSwap quote unavailable (RPC failure or pair not found)",
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 7: Sandwich-MEV gate (D-03b — LOAD-BEARING).
      // Gate: priceImpactBps > 200 AND slippage was NOT explicitly supplied.
      // Per D-03c: passes when slippage IS explicit (any value, even the default).
      // -----------------------------------------------------------------------
      if (quote.priceImpactBps > 200 && !slippageWasExplicit) {
        const mevRefusalBlock = SANDWICH_MEV_REFUSAL_TRON_TEMPLATE
          .replace("{PRICE_IMPACT_BPS}", String(quote.priceImpactBps))
          .replace(/{THRESHOLD_BPS}/g, "200");

        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: sandwich-MEV defense triggered — price impact ${(quote.priceImpactBps / 100).toFixed(2)}% ` +
                `exceeds the 2% threshold.\n\n${mevRefusalBlock}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `price impact ${(quote.priceImpactBps / 100).toFixed(2)}% exceeds the 2% threshold; pass slippageBps explicitly to confirm acceptance of high price impact (sandwich-MEV defense — mirrors Phase 14 Jupiter + v2.6 MEV-01 EVM)`,
            `priceImpactBps: ${quote.priceImpactBps}`,
            "get_sunswap_quote",
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 8: Compute amountOutMin — NEVER zero (T-AMOUNT-OUT-MIN-ZERO).
      // amountOutMin = (outAmount * (10000 - slippageBps)) / 10000
      // -----------------------------------------------------------------------
      if (slippageBps >= 10000) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: amountOutMin computed zero — slippageBps must be < 10000 (< 100%)",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "amountOutMin computed zero — slippageBps must be < 10000 (< 100%)",
            "slippageBps",
          ),
        };
      }
      const amountOutMin =
        (quote.outAmount * BigInt(10000 - slippageBps)) / 10000n;

      // -----------------------------------------------------------------------
      // Step 9: Compute deadline — 10 min unix seconds per CONTEXT § Specifics.
      // -----------------------------------------------------------------------
      const deadline = Math.floor(Date.now() / 1000) + 600;

      // -----------------------------------------------------------------------
      // Step 10: Encode the TriggerSmartContract tx.
      // -----------------------------------------------------------------------
      const tronWeb = _tronRegistry.getTronWeb();
      let encoded;
      try {
        encoded = await _sunSwapTron.encodeSunswapSwap({
          tronWeb,
          from: fromAddress,
          routerAddress: SUNSWAP_V2_ROUTER_TRON_ADDRESS,
          amountIn: inAmount,
          amountOutMin,
          path: quote.route,
          to: fromAddress, // swap to self (standard pattern)
          deadline,
        });
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to build SunSwap V2 TriggerSmartContract: ${cause}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            "failed to build SunSwap V2 TriggerSmartContract",
            cause,
          ),
        };
      }

      // -----------------------------------------------------------------------
      // Step 11: Compute payloadFingerprint.
      // Fixture Tron-20-A cross-link: known inputs → known fingerprint literal.
      // -----------------------------------------------------------------------
      const payloadFingerprint = _tronFingerprint.computeTronPayloadFingerprint({
        rawDataBytes: encoded.rawDataBytes,
      });

      // -----------------------------------------------------------------------
      // Step 12: Build instructionSummary.
      // -----------------------------------------------------------------------
      const instructionSummary = [
        {
          kind: "sunswap-swap" as const,
          from: fromAddress,
          inputToken: rawInputToken,
          outputToken: rawOutputToken,
          inAmount,
          outAmount: quote.outAmount,
          amountOutMin,
          path: quote.route,
          priceImpactBps: quote.priceImpactBps,
          slippageBps,
          deadline,
        },
      ];

      // -----------------------------------------------------------------------
      // Step 13: Build PreparedTxTron + PrepareArgs.
      // kind: "sunswap-swap" + contractAddress = SunSwap V2 Router.
      // -----------------------------------------------------------------------
      const tx: PreparedTxTron = {
        txType: "tron",
        // EVM-shape sentinel fields per handle-store.ts PreparedTxTron definition.
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
        kind: "sunswap-swap",
        contractAddress: SUNSWAP_V2_ROUTER_TRON_ADDRESS,
        instructionSummary,
      };

      // PrepareArgs: verbatim agent strings for PREPARE RECEIPT re-render at preview.
      const prepareArgs: PrepareArgs = {
        to: rawOutputToken, // swap output token address for arg carry
        valueWei: "0",
        inputToken: rawInputToken,
        outputToken: rawOutputToken,
        amount: rawAmount,
        slippageBps: String(slippageBps),
        refBlockBytes: encoded.refBlockBytes,
        refBlockHash: encoded.refBlockHash,
        expiration: String(encoded.expiration),
      };

      const handle = createHandle({ args: prepareArgs, tx, payloadFingerprint });

      // -----------------------------------------------------------------------
      // Step 14: Render PREPARE RECEIPT from format-fanout-sentinel const.
      // -----------------------------------------------------------------------
      const prepareReceipt = PREPARE_RECEIPT_TRON_SUNSWAP_TEMPLATE
        .replace("{CHAIN}", "TRON mainnet")
        .replace("{INPUT_TOKEN}", rawInputToken)
        .replace("{OUTPUT_TOKEN}", rawOutputToken)
        .replace("{IN_AMOUNT}", rawAmount)
        .replace("{OUT_AMOUNT}", quote.outAmount.toString())
        .replace("{PRICE_IMPACT_BPS}", String(quote.priceImpactBps))
        .replace("{SLIPPAGE_BPS}", String(slippageBps))
        .replace("{PATH}", quote.route.join(" → "))
        .replace("{DEADLINE}", String(deadline))
        .replace("{REF_BLOCK_BYTES}", encoded.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", encoded.refBlockHash)
        .replace("{EXPIRATION}", String(encoded.expiration));

      const responseText =
        `${prepareReceipt}\n\n` +
        `Handle: ${handle}\npayloadFingerprint: ${payloadFingerprint}\n\nNext step: pass this handle to preview_send.`;

      // -----------------------------------------------------------------------
      // Step 15: Return CallToolResult. bigint → string at agent boundary.
      // -----------------------------------------------------------------------
      return {
        content: [{ type: "text", text: responseText }],
        structuredContent: {
          handle,
          chain: "tron" as const,
          inputToken: rawInputToken,
          outputToken: rawOutputToken,
          inAmount: inAmount.toString(),
          outAmount: quote.outAmount.toString(),
          amountOutMin: amountOutMin.toString(),
          priceImpactBps: quote.priceImpactBps,
          slippageBps,
          path: quote.route,
          deadline,
          refBlockBytes: encoded.refBlockBytes,
          refBlockHash: encoded.refBlockHash,
          expiration: encoded.expiration,
          payloadFingerprint,
          prepareReceipt,
          instructionSummary: instructionSummary.map((s) => ({
            ...s,
            inAmount: s.inAmount.toString(),
            outAmount: s.outAmount.toString(),
            amountOutMin: s.amountOutMin.toString(),
          })),
          txType: "tron" as const,
        },
      } satisfies ToolHandlerResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_sunswap_swap failed: ${message}`,
          },
        ],
        structuredContent: (makeStructuredError(
          "INTERNAL_ERROR",
          "prepare_sunswap_swap failed",
          message,
        ) as unknown) as Record<string, unknown>,
      };
    }
  },
);
