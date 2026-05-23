// MCP tool: prepare_rocketpool_stake({ chain, amount, from? })
//
// Phase 31 — Plan 31-03 (RP-02 stake). Value-bearing stake call:
// RocketDepositPool.deposit() — ETH amount flows in msg.value, mints rETH
// to msg.sender at the current exchange rate. Selector `0xd0e30db0` COLLIDES
// with WETH9.deposit() (Pitfall 1) — preview_send dispatches on (tx.to,
// selector) tuple to disambiguate.
//
// Bounded deviations from the prepare_lido_stake.ts analog:
//
//   (a) input schema is `{ chain: ["ethereum"], amount, from? }`. Chain
//       narrowed to single-value enum ["ethereum"] (D-03 — Rocket Pool is
//       Ethereum-mainnet-only at v2.3). Non-ethereum refuses with
//       CHAIN_ID_MISMATCH errorCode 15.
//   (b) `amount` is a DECIMAL STRING in ETH units (decimals=18).
//       parseAmountStrict resolves wei; zero refuses with INVALID_INPUT.
//   (c) D-07 MINIMUM-DEPOSIT PRE-FLIGHT: read
//       `RocketDAOProtocolSettingsDeposit.getMinimumDeposit()`. On RPC
//       failure, fall back to `ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI` =
//       0.01 ETH (1e16 wei) hardcoded constant. Refuse `amountWei < min`
//       with INVALID_INPUT + hintTool: "request_capability" + verbatim
//       error text naming both the minimum and the input.
//   (d) tx.to = getRocketPoolDepositPoolAddress(1). SOT-only (NEVER inlined).
//   (e) tx.valueWei = amountWei. PAYABLE; ETH amount in msg.value, NOT
//       calldata.
//   (f) tx.data = encodeRocketPoolDeposit() = "0xd0e30db0" (selector only).
//   (g) D-13 LEDGER NOTICE: Rocket Pool deposit is NOT in the Ledger
//       Ethereum app's ERC-7730 clear-sign registry; emits the verbatim
//       LEDGER_NOTICE_ROCKETPOOL_TEMPLATE block as a separate content[] item.
//       SHARED template with prepare_rocketpool_unstake — symmetric
//       blind-sign UX.
//   (h) PREPARE RECEIPT uses ROCKETPOOL_STAKE_PREPARE_RECEIPT_TEMPLATE —
//       slots: {CHAIN}, {DEPOSIT_POOL}, {AMOUNT}.
//
// Fixture AA-RP cross-link: test/prepare-rocketpool-stake.test.ts re-anchors
// the payloadFingerprint byte-identity via `0x615683fb...` literal from
// test/signing-fingerprint.test.ts. Fixture AA-RP is from-INDEPENDENT
// (deposit() carries no calldata args; only `tx.to` + `tx.valueWei` flow
// into the fingerprint preimage alongside the selector).
//
// Pitfall 1 awareness (selector collision with WETH9.deposit): the
// distinguishing field is `tx.to`. Preview-send must route on (tx.to,
// selector) — the allowlist Set is selector-blind by design. This tool's
// `tx.to` is unambiguously the SOT-resolved RocketDepositPool address.

import { type Address, type Hex, formatEther } from "viem";

import {
  LEDGER_NOTICE_ROCKETPOOL_TEMPLATE,
  ROCKETPOOL_STAKE_PREPARE_RECEIPT_TEMPLATE,
} from "../signing/blocks.js";
import {
  encodeRocketPoolDeposit,
  ROCKET_SETTINGS_DEPOSIT_ABI,
  getRocketPoolDepositPoolAddress,
  getRocketPoolDepositSettingsAddress,
  ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI,
} from "../protocols/rocketpool.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import { getChainClient } from "../chains/registry.js";
import { registerTool } from "./index.js";

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
  hintTool?: string,
  hintArgs?: Record<string, unknown>,
): Record<string, unknown> {
  const base = makeStructuredError(code, message, cause) as unknown as Record<string, unknown> &
    StructuredError;
  if (hintTool) base.hintTool = hintTool;
  if (hintArgs) base.hintArgs = hintArgs;
  return base;
}

// 18 decimals — ETH AND rETH; canonical ERC-20.
const ETH_DECIMALS = 18;

const DESCRIPTION = [
  "Prepare an unsigned RocketDepositPool.deposit() call on Ethereum mainnet — stakes ETH and mints rETH at the current exchange rate.",
  "This is a PAYABLE call: the ETH amount flows into msg.value (not calldata). No ERC-20 approval needed.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to stake ETH for liquid rETH via the Rocket Pool protocol. rETH is a non-rebasing receipt token whose ETH-equivalent value grows as the exchange rate increases (vs Lido stETH which rebases the balance directly).",
  "Do NOT use for Lido (call prepare_lido_stake), EigenLayer LST deposits (call prepare_eigenlayer_deposit), or Rocket Pool node-operator minipool deposits (out of scope at v2.3).",
  "`chain` is REQUIRED and locked to 'ethereum' — non-ethereum refuses with CHAIN_ID_MISMATCH (errorCode 15).",
  "`amount` is a DECIMAL STRING in ETH units (e.g. '1.5' stakes 1.5 ETH). Do NOT pass wei directly. Zero or below the Rocket Pool minimum (0.01 ETH at the time of writing; read live on every call) refuses with INVALID_INPUT.",
  "D-07 minimum-deposit pre-flight: reads RocketDAOProtocolSettingsDeposit.getMinimumDeposit() live. Falls back to a hardcoded 0.01 ETH if the RPC read fails; refuses sub-minimum amounts.",
  "Selector 0xd0e30db0 COLLIDES with WETH9.deposit() — the distinguishing field is the destination contract (RocketDepositPool vs WETH9). preview_send dispatches on the (tx.to, selector) tuple.",
  "Emits a LEDGER NOTICE block — Rocket Pool deposit is NOT covered by the Ledger Ethereum app's ERC-7730 clear-sign plugins (the device will blind-sign; ensure 'Blind signing' is enabled in the Ethereum app settings).",
  "Pass `from` when the user wants to act from a non-default approved account. Requires a paired Ledger (real mode) or active persona (demo mode).",
  "Returns { handle, chainId, to, valueWei, payloadFingerprint, prepareReceipt } plus a 3-block text payload (PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE).",
  "Failure modes: CHAIN_ID_MISMATCH if chain != ethereum, INVALID_INPUT if amount is zero / below minimum / malformed, WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode active but no persona set or from mismatch.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier (required). ONLY 'ethereum' is supported — Rocket Pool is Ethereum-mainnet-only at v2.3.",
    },
    amount: {
      type: "string",
      description:
        "Amount of ETH to stake, as a decimal string in ETH units (e.g. '1.5'). Must be >= the Rocket Pool minimum deposit (read live from RocketDAOProtocolSettingsDeposit.getMinimumDeposit; falls back to 0.01 ETH).",
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

registerTool("prepare_rocketpool_stake", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // D-03: Ethereum-write-only gate.
    const chainName = typeof args.chain === "string" ? args.chain : "";
    if (chainName !== "ethereum") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'chain': Rocket Pool write operations support only 'ethereum', got "${chainName}"`,
          },
        ],
        structuredContent: errEnvelope(
          "CHAIN_ID_MISMATCH",
          `invalid 'chain': Rocket Pool write operations support only 'ethereum', got "${chainName}"`,
        ),
      };
    }
    const chainId = 1;

    const rawAmount = typeof args.amount === "string" ? args.amount : "";

    // SENDER resolution.
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    // Parse amount strictly.
    let amountWei: bigint;
    try {
      amountWei = parseAmountStrict(rawAmount, ETH_DECIMALS);
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

    // Zero-value guard.
    if (amountWei === 0n) {
      return {
        isError: true,
        content: [
          { type: "text", text: "error: stake amount must be > 0 (staking 0 ETH yields 0 rETH)" },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          "stake amount must be > 0 (staking 0 ETH yields 0 rETH)",
        ),
      };
    }

    // tx.to from SOT.
    const depositPoolAddr: Address = getRocketPoolDepositPoolAddress(chainId)!;
    const settingsDepositAddr: Address = getRocketPoolDepositSettingsAddress(chainId)!;

    // D-07 MINIMUM-DEPOSIT PRE-FLIGHT.
    // Live read; fall back to hardcoded constant on RPC failure. Refuse
    // sub-minimum with INVALID_INPUT + hintTool: "request_capability".
    const client = getChainClient(chainId);
    let minimumDeposit: bigint;
    let minSource: "rpc" | "fallback";
    try {
      minimumDeposit = (await client.readContract({
        address: settingsDepositAddr,
        abi: ROCKET_SETTINGS_DEPOSIT_ABI,
        functionName: "getMinimumDeposit",
      })) as bigint;
      minSource = "rpc";
    } catch {
      // RPC failure — fall back to hardcoded 0.01 ETH per D-07.
      minimumDeposit = ROCKET_POOL_MINIMUM_DEPOSIT_FALLBACK_WEI;
      minSource = "fallback";
    }

    if (amountWei < minimumDeposit) {
      const msg = `Rocket Pool minimum deposit is ${formatEther(minimumDeposit)} ETH, got ${rawAmount} ETH (min source: ${minSource === "rpc" ? "RocketDAOProtocolSettingsDeposit.getMinimumDeposit on-chain" : "hardcoded fallback (RPC failed)"})`;
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${msg}` }],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          msg,
          undefined,
          "request_capability",
          { feature: "Rocket Pool minimum deposit context" },
        ),
      };
    }

    // Encode + handle.
    const data: Hex = encodeRocketPoolDeposit();

    const tx = {
      chainId,
      to: depositPoolAddr,
      valueWei: amountWei,
      data,
    };

    const payloadFingerprint = computePayloadFingerprint(tx);

    const handle = createHandle({
      args: {
        to: "",
        valueWei: amountWei.toString(),
        tokenAddress: depositPoolAddr,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    // PREPARE RECEIPT (verbatim agent args).
    const baseReceipt = ROCKETPOOL_STAKE_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `ethereum (chainId 1)`)
      .replace("{DEPOSIT_POOL}", depositPoolAddr)
      .replace("{AMOUNT}", rawAmount);
    const receipt = fromCallerSupplied
      ? `${baseReceipt}\n  from:         ${rawFrom}`
      : baseReceipt;

    // CHECKS PERFORMED (D-07 outcome + decimal-strict amount + Pitfall 1
    // selector-collision awareness).
    const checksLines: string[] = [
      "CHECKS PERFORMED",
      `  minimum-deposit (D-07): ${formatEther(amountWei)} ETH >= ${formatEther(minimumDeposit)} ETH (min source: ${minSource === "rpc" ? "on-chain RocketDAOProtocolSettingsDeposit.getMinimumDeposit" : "hardcoded fallback — RPC read failed"})`,
      `  decimal-strict amount parse: OK (${rawAmount} ETH → ${amountWei} wei; 18 decimals)`,
      `  selector collision awareness (Pitfall 1): 0xd0e30db0 ALSO matches WETH9.deposit. Disambiguating tx.to is ${depositPoolAddr} (RocketDepositPool — preview_send routes (tx.to, selector) tuple).`,
    ];
    const checks = checksLines.join("\n");

    return {
      content: [
        { type: "text", text: receipt },
        { type: "text", text: checks },
        { type: "text", text: LEDGER_NOTICE_ROCKETPOOL_TEMPLATE },
      ],
      structuredContent: {
        handle,
        chainId,
        from: fromAddress,
        to: depositPoolAddr,
        valueWei: amountWei.toString(),
        data: tx.data,
        payloadFingerprint,
        prepareReceipt: receipt,
        checksPerformed: checks,
        ledgerNotice: LEDGER_NOTICE_ROCKETPOOL_TEMPLATE,
        minimumDeposit: minimumDeposit.toString(),
        minimumDepositSource: minSource,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_rocketpool_stake failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_rocketpool_stake failed", message),
    };
  }
});
