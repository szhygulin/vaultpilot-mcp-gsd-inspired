// MCP tool: prepare_weth_unwrap({ amount })
//
// Phase 6 — Plan 06-04 (PREP-28). Third contract-call shape over the Phase 4
// trust pipeline. Mechanical clone of prepare_token_send.ts (Plan 06-02) with
// bounded deviations:
//
//   (a) input schema is `{ amount }` ONLY — no `to` (withdraw has no
//       recipient; the burn returns native ETH to the caller) and no
//       `tokenAddress` (only ONE WETH9 per chain; the server reads it from
//       src/config/contracts.ts via getWethAddress(1) — agent tampering at the
//       boundary CANNOT redirect the call to a malicious clone contract).
//   (b) decimal resolution: hard-coded to 18 (WETH9_DECIMALS). The canonical
//       WETH9 contract on Ethereum mainnet is immutable; the registry has it
//       too but the constant is self-contained and avoids the registry
//       dependency for this tool.
//   (c) encoder = `encodeWethWithdraw(amountWei)` from src/protocols/weth9.ts.
//   (d) tx.to = getWethAddress(1) — the WETH9 contract. Format-fanout-
//       sentinel: NEVER inlined here; the regression test grep'ing for the
//       literal across src/ asserts it lives only in src/config/contracts.ts.
//   (e) tx.valueWei = 0n. The withdraw burns WETH for ETH at the contract
//       level — no native value is transferred IN the call (the contract
//       returns ETH via .transfer to msg.sender as a side effect).
//   (f) PREPARE RECEIPT uses WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE (parallel
//       template per 06-PATTERNS.md — two slots: tokenAddress + amount; no
//       `to`, no `spender`).
//
// `amount: "max"` is NOT a valid input — there's no "max WETH balance"
// sentinel; the user must specify a concrete decimal-string amount. The
// schema rejects "max" via parseAmountStrict's strict regex (kind: "format").
//
// preview_send (Plan 06-04 extension) emits a LEDGER NOTICE block ABOVE the
// LEDGER BLIND-SIGN HASH for the withdraw selector. Research § Topic 5 (A2
// mitigation): WETH9.withdraw is NOT covered by Ledger's ERC-20 clear-sign
// plugin; devices ship with blind-sign disabled and the user hits a confusing
// refusal. The NOTICE block surfaces the exact navigation path
// (Settings → Blind signing → Enabled) BEFORE the user attempts to sign.

import { type Address, type Hex } from "viem";

import { isDemoMode } from "../config/env.js";
import { getWethAddress } from "../config/contracts.js";
import { getActivePersona } from "../demo/state.js";
import { WETH9_DECIMALS, encodeWethWithdraw } from "../protocols/weth9.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import { WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { getStatus } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> &
    StructuredError;
}

const DESCRIPTION = [
  "Prepare an unsigned WETH9.withdraw(amount) call on Ethereum mainnet — unwraps WETH back to native ETH.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to convert their WETH balance back to ETH (e.g. for gas, or to receive native ETH after a swap that produced WETH).",
  "Do NOT use to wrap ETH into WETH — wrap is v2+ scope (no prepare_weth_wrap yet).",
  "Do NOT use for arbitrary ERC-20 operations — each has a dedicated prepare_* tool (prepare_token_send / prepare_token_approve / prepare_revoke_approval).",
  "`amount` is a DECIMAL STRING in WETH units (= ETH units; decimals=18). Example: \"1.0\" unwraps 1 WETH to 1 ETH.",
  "`amount: \"max\"` is NOT accepted — there is no max-balance sentinel here; pass a concrete decimal amount. \"max\" rejects with INVALID_INPUT.",
  "The server uses the canonical WETH9 contract address from src/config/contracts.ts; the agent does NOT pass a contract address (only one WETH9 per chain on mainnet).",
  "preview_send emits a LEDGER NOTICE block above the LEDGER BLIND-SIGN HASH — WETH unwrap requires 'Blind signing' enabled in the Ledger Ethereum app settings (most devices ship with blind-sign disabled).",
  "preview-time eth_call simulation catches insufficient-WETH-balance reverts BEFORE the user is asked to blind-sign.",
  "Requires a paired Ledger (real mode) or active persona (demo mode).",
  "Returns `{ handle, chainId: 1, from, tokenAddress, amount, amountWei, payloadFingerprint }` plus a PREPARE RECEIPT text block surfacing the verbatim args.",
  "Failure modes: WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode is on but no persona set, INVALID_INPUT if amount malformed (including fractional-overflow vs decimals=18 — rare in practice since 18 decimals is generous).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    amount: {
      type: "string",
      description:
        "Decimal string in WETH units (decimals=18; e.g. \"1.0\" = 1 WETH). The literal \"max\" is NOT accepted — pass a concrete decimal.",
    },
  },
  required: ["amount"],
  additionalProperties: false,
};

registerTool("prepare_weth_unwrap", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // Validate `amount` is a string at the schema boundary; parseAmountStrict
    // does the deep validation (format / fractional-overflow).
    const rawAmount = typeof args.amount === "string" ? args.amount : "";

    // SENDER resolution (Plan 05-02 / Q-CONTRADICTION-PREP Option B):
    // demo branch SKIPS getStatus() so the spy observes zero calls in the
    // demo arm. T-DEMO-1 + T-NULL-PERSONA-1 mitigation parity with
    // prepare_token_send / prepare_token_approve.
    let fromAddress: Address;
    if (isDemoMode()) {
      const persona = getActivePersona();
      if (persona === null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: demo mode is active but no persona set. Call `set_demo_wallet({ persona: \"whale\" | \"defi-degen\" | \"stable-saver\" | \"staking-maxi\" })` first.",
            },
          ],
          structuredContent: errEnvelope(
            "WRONG_MODE",
            "demo mode active but no persona set; call set_demo_wallet first",
          ),
        };
      }
      fromAddress = persona.address;
    } else {
      const status = await getStatus();
      if (status === null) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: no live Ledger session. Call `pair_ledger_live` to pair a Ledger via WalletConnect, then retry.",
            },
          ],
          structuredContent: errEnvelope("WALLET_NOT_PAIRED", "no live Ledger session"),
        };
      }
      fromAddress = status.activeAccount;
    }

    // Parse amount strictly. T-PARSE-AMOUNT-1 + T-PARSE-EMPTY-1 mitigations —
    // refuses empty/format/fractional-overflow. WETH9_DECIMALS=18 is hard-
    // coded (the contract is immutable on mainnet).
    let amountWei: bigint;
    try {
      amountWei = parseAmountStrict(rawAmount, WETH9_DECIMALS);
    } catch (err) {
      const message =
        err instanceof InvalidAmountError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        isError: true,
        content: [
          { type: "text", text: `error: invalid 'amount': ${message}` },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'amount': ${message}`),
      };
    }

    // tx.to comes from the SOT — getWethAddress(1) — NEVER inlined.
    // T-WETH-ADDR-INLINE-1 mitigation: agent tampering at the boundary cannot
    // redirect the call to a malicious clone contract because the agent has
    // no `tokenAddress` input slot here.
    const wethAddress: Address = getWethAddress(1);
    const data: Hex = encodeWethWithdraw(amountWei);

    // tx.valueWei = 0n. Withdraw burns WETH for ETH at the contract level;
    // no native value is transferred IN the call.
    const tx = {
      chainId: 1,
      to: wethAddress,
      valueWei: 0n,
      data,
    };

    // PREP-03 + T-BIND-1: compute the binding fingerprint at prepare time.
    // Plan 04-04's send handler re-runs this on record.tx as the drift gate.
    const payloadFingerprint = computePayloadFingerprint(tx);

    // PREP-02: args carries the RAW agent strings. `to: ""` because withdraw
    // has no recipient. `tokenAddress` is the WETH9 address as a string —
    // the server-resolved canonical SOT value (still surfaced in the receipt
    // verbatim so the user can cross-check on-device).
    const handle = createHandle({
      args: {
        to: "",
        valueWei: "0",
        tokenAddress: wethAddress,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    const receipt = WETH_UNWRAP_PREPARE_RECEIPT_TEMPLATE
      .replace("{TOKEN_ADDRESS}", wethAddress)
      .replace("{AMOUNT}", rawAmount);

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        chainId: 1,
        from: fromAddress,
        tokenAddress: wethAddress,
        amount: rawAmount,
        amountWei: amountWei.toString(),
        payloadFingerprint,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_weth_unwrap failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_weth_unwrap failed", message),
    };
  }
});
