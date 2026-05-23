// MCP tool: prepare_lido_stake({ chain, amount, from? })
//
// Phase 30 — Plan 30-03 (LIDO-02). Value-bearing stake call: Lido.submit(referral=address(0)).
// Mechanical clone of prepare_native_send.ts with bounded deviations:
//
//   (a) input schema is `{ chain: ["ethereum"], amount, from? }`.
//       chain narrowed to single-value enum ["ethereum"] per D-03 — Lido writes
//       are Ethereum mainnet ONLY. Non-ethereum chains refuse with CHAIN_ID_MISMATCH
//       errorCode 15 (same surface as Phase 8 Plan 08-02's chain-mismatch gate).
//   (b) `amount` is a DECIMAL STRING in ETH units (decimals=18, STETH_DECIMALS).
//       parseAmountStrict resolves wei; zero-value refuses with INVALID_INPUT per
//       T-LIDO-ZERO-VALUE-STAKE (staking 0 ETH has no effect on-chain — refuse early).
//   (c) tx.to = getLidoStethAddress(1) — the Lido stETH proxy. SOT-only (NEVER inlined).
//   (d) tx.valueWei = amountWei — ETH amount goes in msg.value. Pitfall 7 mitigated:
//       Lido.submit is PAYABLE; the ETH amount is in tx.value, NOT in calldata.
//   (e) tx.data = encodeLidoSubmit(address(0)) — referral hardcoded to address(0) per D-07.
//   (f) PREPARE RECEIPT uses LIDO_STAKE_PREPARE_RECEIPT_TEMPLATE — slots: {CHAIN}, {STETH_CONTRACT}, {AMOUNT}.
//
// D-12: ERC-7730 clear-sign coverage confirmed for Lido.submit on Ethereum mainnet.
// No notice block needed (matches Phase 7 Aave precedent).
// NO allowance pre-flight — Lido.submit needs no ERC-20 approval; ETH flows
// directly via msg.value.
//
// Fixture V cross-link: test/prepare-lido-stake.test.ts re-anchors the
// payloadFingerprint byte-identity via `0xab550a28...` literal from
// test/signing-fingerprint.test.ts. Drift in either preimage assembly or
// encoder output fails at a specific test line.
//
// T-LIDO-ZERO-VALUE-STAKE: zero-value guard fires AFTER parseAmountStrict
// (which accepts "0" as a valid decimal string) but BEFORE handle creation.
// Rationale: a zero-value submit call would be accepted by the Lido contract
// but yields zero stETH — refuse at prepare time to surface the user error.

import { type Address, type Hex } from "viem";

import {
  LIDO_STAKE_PREPARE_RECEIPT_TEMPLATE,
} from "../signing/blocks.js";
import {
  getLidoStethAddress,
  STETH_DECIMALS,
  encodeLidoSubmit,
} from "../protocols/lido.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
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
  "Prepare an unsigned Lido.submit(referral) call on Ethereum mainnet — stakes ETH and mints stETH.",
  "This is a PAYABLE call: the ETH amount flows into msg.value (not calldata). The stETH contract's referral param is hardcoded to address(0).",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to stake ETH for liquid stETH via the Lido protocol on Ethereum mainnet. Lido stETH accrues rebase rewards automatically.",
  "Do NOT use for wstETH wrapping — use prepare_lido_wrap instead. Do NOT use on non-Ethereum chains — Lido writes are Ethereum mainnet only.",
  "`chain` is REQUIRED and locked to 'ethereum'. Non-ethereum chains refuse with CHAIN_ID_MISMATCH (errorCode 15).",
  "`amount` is a DECIMAL STRING in ETH units (e.g. '1.5' stakes 1.5 ETH). Do NOT pass wei directly. Zero amount refuses with INVALID_INPUT.",
  "No ERC-20 approval needed — ETH flows directly into msg.value; the Lido contract mints stETH to msg.sender.",
  "Requires a paired Ledger (real mode) or active persona (demo mode). On-device clear-sign is confirmed for Lido.submit (ERC-7730 registry coverage confirmed).",
  "Returns { handle, chainId, to, valueWei, payloadFingerprint, prepareReceipt } plus a PREPARE RECEIPT text block with verbatim args.",
  "Failure modes: CHAIN_ID_MISMATCH if chain != ethereum, INVALID_INPUT if amount is zero/malformed, WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode active but no persona set or from mismatch.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier (required). ONLY 'ethereum' is supported — Lido write operations are Ethereum mainnet only. Non-ethereum refuses with CHAIN_ID_MISMATCH.",
    },
    amount: {
      type: "string",
      description:
        "Amount of ETH to stake, as a decimal string in ETH units (e.g. '1.5'). Must be > 0. Do NOT pass wei.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts in get_ledger_status.accountsByChain[chainId]. Omit to use the active account. In demo mode, must match the active persona's address.",
    },
  },
  required: ["chain", "amount"],
  additionalProperties: false,
};

registerTool("prepare_lido_stake", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // D-03: Ethereum-write-only gate. The JSON-schema enum already restricts
    // chain to ["ethereum"], but defense-in-depth at the handler too.
    const chainName = typeof args.chain === "string" ? args.chain : "";
    if (chainName !== "ethereum") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'chain': Lido write operations support only 'ethereum', got "${chainName}"`,
          },
        ],
        structuredContent: errEnvelope(
          "CHAIN_ID_MISMATCH",
          `invalid 'chain': Lido write operations support only 'ethereum', got "${chainName}"`,
        ),
      };
    }
    const chainId = 1;

    const rawAmount = typeof args.amount === "string" ? args.amount : "";

    // SENDER resolution (Plan 05-02 + Issue #62): delegated to shared resolveFrom.
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    // Parse amount strictly. parseAmountStrict refuses empty/format/fractional-overflow.
    let amountWei: bigint;
    try {
      amountWei = parseAmountStrict(rawAmount, STETH_DECIMALS);
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

    // T-LIDO-ZERO-VALUE-STAKE: zero-value guard after amount parse.
    if (amountWei === 0n) {
      return {
        isError: true,
        content: [
          { type: "text", text: "error: stake amount must be > 0 (staking 0 ETH yields 0 stETH)" },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          "stake amount must be > 0 (staking 0 ETH yields 0 stETH)",
        ),
      };
    }

    // tx.to from SOT — NEVER inlined.
    const stethAddr: Address = getLidoStethAddress(chainId)!;

    // Pitfall 7: Lido.submit is PAYABLE — ETH goes in tx.value, NOT calldata.
    // referral = address(0) per D-07 (no third-party referral payouts in scope).
    const data: Hex = encodeLidoSubmit("0x0000000000000000000000000000000000000000" as Address);

    const tx = {
      chainId,
      to: stethAddr,
      valueWei: amountWei,
      data,
    };

    // PREP-03 + T-BIND-1: compute the binding fingerprint at prepare time.
    const payloadFingerprint = computePayloadFingerprint(tx);

    // PREP-02: args carries the RAW agent strings. tokenAddress = stETH proxy;
    // amount = the human-readable ETH amount from the agent; valueWei = derived wei.
    const handle = createHandle({
      args: {
        to: "",            // no separate recipient for a payable mint call
        valueWei: amountWei.toString(),
        tokenAddress: stethAddr,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    // Phase 8: PREPARE RECEIPT with verbatim agent args (no normalization).
    // Issue #62: append `from:` line ONLY when caller-supplied.
    const baseReceipt = LIDO_STAKE_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `ethereum (chainId 1)`)
      .replace("{STETH_CONTRACT}", stethAddr)
      .replace("{AMOUNT}", rawAmount);
    const receipt = fromCallerSupplied
      ? `${baseReceipt}\n  from:         ${rawFrom}`
      : baseReceipt;

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        chainId,
        from: fromAddress,
        to: stethAddr,
        valueWei: amountWei.toString(),
        data: tx.data,
        payloadFingerprint,
        prepareReceipt: receipt,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_lido_stake failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_lido_stake failed", message),
    };
  }
});
