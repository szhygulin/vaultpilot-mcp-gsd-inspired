// MCP tool: prepare_eigenlayer_deposit({ chain, lst, amount, from? })
//
// Phase 31 — Plan 31-02 (EIG-02). EigenLayer LST → strategy shares via
// StrategyManager.depositIntoStrategy(strategy, lstToken, amount).
// Mechanical clone of prepare_lido_wrap.ts with bounded deviations:
//
//   (a) input schema is `{ chain: ["ethereum"], lst: EigenLayerLst, amount,
//       from? }`. Chain narrowed to single-value enum ["ethereum"] (D-03);
//       non-ethereum refuses with CHAIN_ID_MISMATCH errorCode 15.
//   (b) `lst` is a CURATED 7-LST enum (D-04: stETH / rETH / cbETH / ETHx /
//       wBETH / sfrxETH / mETH). Long-tail LSTs refuse with INVALID_INPUT +
//       hintTool: "request_capability" (Pitfall 3: agent NEVER passes raw
//       strategy / token addresses; server resolves via SOT registry).
//   (c) `amount` is a DECIMAL STRING in LST units (all 7 are 18 decimals).
//       parseAmountStrict resolves wei.
//   (d) tx.to = getEigenLayerStrategyManagerAddress(1) — the StrategyManager
//       proxy. SOT-only (NEVER inlined).
//   (e) tx.valueWei = 0n. Deposit is NOT payable; LST consumed as an ERC-20.
//   (f) tx.data = encodeDepositIntoStrategy(strategy, lstToken, amountWei) —
//       100-byte calldata (selector 0xe7a050aa + strategy + token + amount).
//   (g) D-05: LST.allowance(from, StrategyManager) pre-flight at prepare time;
//       insufficient allowance refuses with INVALID_INPUT + hintTool:
//       "prepare_token_approve" + hintArgs.spender = StrategyManager (NOT the
//       per-strategy proxy — the StrategyManager pulls the ERC-20).
//   (h) D-06: defensive Strategy.maxTotalDeposits + totalShares pre-flight.
//       MAX_UINT256 sentinel check FIRST (Pitfall 6 — some strategies return
//       `2^256-1` as the "unlimited" sentinel; raw `currentTotalShares >= cap`
//       overflows / misbehaves without the sentinel guard). When cap is
//       finite AND currentTotalShares >= maxTotalDeposits, refuses with
//       INVALID_INPUT + hintTool: "request_capability".
//   (i) D-13 LEDGER NOTICE: depositIntoStrategy is NOT in the Ledger
//       Ethereum app's ERC-7730 clear-sign registry; emits the verbatim
//       LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE block in the response.
//   (j) D-10: CHECKS PERFORMED block carries the verbatim slashing-risk
//       informational line (no enforcement gate; surface only).
//   (k) PREPARE RECEIPT uses EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE —
//       slots: {CHAIN}, {STRATEGY_MANAGER}, {STRATEGY}, {LST_SYMBOL},
//       {LST_TOKEN}, {AMOUNT}.
//
// Fixture Z cross-link: test/prepare-eigenlayer-deposit.test.ts re-anchors
// the payloadFingerprint byte-identity via `0x2c36a77f...` literal from
// test/signing-fingerprint.test.ts. Fixture Z is from-INDEPENDENT (strategy
// + token + amount flow in calldata; owner address does NOT).

import { type Address, type Hex, erc20Abi, formatUnits } from "viem";

import {
  LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE,
  EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE,
} from "../signing/blocks.js";
import {
  encodeDepositIntoStrategy,
  STRATEGY_BASE_ABI,
  getEigenLayerStrategyManagerAddress,
  getEigenLayerStrategyAddress,
  getEigenLayerLstTokenAddress,
  type EigenLayerLst,
} from "../protocols/eigenlayer.js";
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
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> &
    StructuredError;
}

// ---------------------------------------------------------------------------
// Curated 7-LST enum (D-04 — locked to RESEARCH § Topic 1 INCLUDE set)
// ---------------------------------------------------------------------------

const CURATED_LSTS: readonly EigenLayerLst[] = [
  "stETH",
  "rETH",
  "cbETH",
  "ETHx",
  "wBETH",
  "sfrxETH",
  "mETH",
] as const;

const CURATED_LSTS_SET: ReadonlySet<EigenLayerLst> = new Set(CURATED_LSTS);

// All 7 curated LSTs are 18 decimals (RESEARCH § Topic 1).
const LST_DECIMALS = 18;

// MAX_UINT256 sentinel — strategies that have NOT set an explicit cap return
// this from `maxTotalDeposits()`. Comparing against this without the sentinel
// guard would silently treat "unlimited" as "at-cap" (Pitfall 6 mitigated).
const MAX_UINT256 = 2n ** 256n - 1n;

// D-10 slashing-risk informational line — VERBATIM per
// .planning/phases/31-evm-eigenlayer-rocket-pool/31-02-PLAN.md <verified_values>.
// Surfaced in CHECKS PERFORMED at prepare time; preview_send re-emits via the
// EigenLayer decoded-args arm.
const SLASHING_RISK_LINE =
  "EigenLayer restaking: deposited LST shares are subject to slashing by AVS operators the user later delegates to. " +
  "Phase 31 ships deposit only — operator delegation is a separate tool (deferred to v2.x). " +
  "Informational; no enforcement gate.";

// ---------------------------------------------------------------------------
// Tool description + schema
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  "Prepare an unsigned StrategyManager.depositIntoStrategy(strategy, lstToken, amount) call on Ethereum mainnet — deposits an LST into an EigenLayer per-LST strategy to earn restaking rewards.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to restake an LST (stETH / rETH / cbETH / ETHx / wBETH / sfrxETH / mETH) into EigenLayer.",
  "Do NOT use for native ETH restaking via EigenPod (deferred to v2.x), operator delegation (deferred), claim flows (deferred), or LSTs outside the curated 7-member set — long-tail LSTs refuse with hintTool: request_capability so the agent can request adding support.",
  "REQUIRES LST approval: the user MUST have approved the StrategyManager to spend the LST before calling this tool. If insufficient allowance is detected, refuses with INVALID_INPUT + hintTool: prepare_token_approve with the correct spender (StrategyManager — NOT the per-strategy proxy).",
  "`chain` is REQUIRED and locked to 'ethereum'. Non-ethereum chains refuse with CHAIN_ID_MISMATCH (errorCode 15).",
  "`lst` is REQUIRED — one of the curated 7-member set. Off-list LSTs refuse with INVALID_INPUT + hintTool: request_capability.",
  "`amount` is a DECIMAL STRING in LST units (all 7 curated LSTs are 18 decimals). Example: '1.0' deposits 1 stETH (when lst=stETH).",
  "LEDGER NOTICE (D-13): EigenLayer.depositIntoStrategy is NOT in the Ledger Ethereum app's clear-sign plugin registry — the device will BLIND-SIGN the transaction. The response includes a LEDGER NOTICE block surfacing the Settings → Blind signing → Enabled navigation path. After send_transaction fires, the user MUST character-match the predicted hash against the device display.",
  "CHECKS PERFORMED block carries a slashing-risk informational line (D-10): deposited shares are subject to slashing by AVS operators the user later delegates to — Phase 31 ships deposit only; delegation is v2.x scope.",
  "Returns { handle, chainId, to, valueWei, payloadFingerprint, prepareReceipt } plus PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE text blocks.",
  "Failure modes: CHAIN_ID_MISMATCH (chain != ethereum), INVALID_INPUT (off-list lst / insufficient allowance / cap-at-limit / malformed amount), WALLET_NOT_PAIRED (no live session), WRONG_MODE (demo mode mismatch).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier (required). ONLY 'ethereum' is supported — EigenLayer is Ethereum-mainnet-only at Phase 31 scope. Non-ethereum refuses with CHAIN_ID_MISMATCH.",
    },
    lst: {
      type: "string",
      enum: ["stETH", "rETH", "cbETH", "ETHx", "wBETH", "sfrxETH", "mETH"],
      description:
        "LST symbol to deposit (required). Curated 7-member set — long-tail LSTs (ankrETH / swETH / lsETH / oETH / osETH / ...) refuse with INVALID_INPUT + hintTool: request_capability.",
    },
    amount: {
      type: "string",
      description:
        "Amount of LST to deposit, as a decimal string in LST units (e.g. '1.0'). Decimals=18 for all 7 curated LSTs. The StrategyManager must be approved as spender first.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts in get_ledger_status.accountsByChain[chainId]. Omit to use the active account. In demo mode, must match the active persona's address.",
    },
  },
  required: ["chain", "lst", "amount"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

registerTool("prepare_eigenlayer_deposit", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // (1) Chain gate (D-03) — cheap gate BEFORE any RPC reads.
    const chainName = typeof args.chain === "string" ? args.chain : "";
    if (chainName !== "ethereum") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'chain': EigenLayer write operations support only 'ethereum', got "${chainName}"`,
          },
        ],
        structuredContent: errEnvelope(
          "CHAIN_ID_MISMATCH",
          `invalid 'chain': EigenLayer write operations support only 'ethereum', got "${chainName}"`,
        ),
      };
    }
    const chainId = 1;

    // (2) LST gate (D-04 + Pitfall 3 — defensive runtime check; schema enum
    //     gates the same shape upstream).
    const lstRaw = args.lst;
    if (typeof lstRaw !== "string" || !CURATED_LSTS_SET.has(lstRaw as EigenLayerLst)) {
      const msg = `invalid 'lst': ${JSON.stringify(lstRaw)} is not in the curated 7-LST set (stETH / rETH / cbETH / ETHx / wBETH / sfrxETH / mETH)`;
      return {
        isError: true,
        content: [
          { type: "text", text: `error: ${msg}` },
        ],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", msg),
          hintTool: "request_capability",
          hintArgs: {
            feature: `EigenLayer ${typeof lstRaw === "string" ? lstRaw : "unknown"} strategy support`,
          },
        },
      };
    }
    const lst = lstRaw as EigenLayerLst;

    // (3) Resolve SOT addresses — non-null assertion safe by Plan 31-01 (chainId=1
    //     populated for both StrategyManager + curated strategy/lstToken rows).
    const strategyManagerAddr: Address = getEigenLayerStrategyManagerAddress(chainId)!;
    const strategyAddr: Address = getEigenLayerStrategyAddress(chainId, lst)!;
    const lstTokenAddr: Address = getEigenLayerLstTokenAddress(chainId, lst)!;

    // (4) Parse amount strictly (CLAUDE.md decimal-aware arithmetic rule).
    const rawAmount = typeof args.amount === "string" ? args.amount : "";
    let amountWei: bigint;
    try {
      amountWei = parseAmountStrict(rawAmount, LST_DECIMALS);
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

    // (5) Resolve `from` (Issue #62 — delegated shared helper).
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    // (6) D-05 + D-06 fused 3-way pre-flight via Promise.all.
    //     The cap pre-flight uses `.catch(() => MAX_UINT256)` on
    //     `maxTotalDeposits` — some strategy proxies may not expose the function
    //     (revert on call); treat as unlimited (defense in depth).
    const client = getChainClient(chainId);
    const [allowance, currentTotalShares, maxTotalDeposits] = await Promise.all([
      client.readContract({
        address: lstTokenAddr,
        abi: erc20Abi,
        functionName: "allowance",
        args: [fromAddress, strategyManagerAddr],
      }) as Promise<bigint>,
      client.readContract({
        address: strategyAddr,
        abi: STRATEGY_BASE_ABI,
        functionName: "totalShares",
      }) as Promise<bigint>,
      (client.readContract({
        address: strategyAddr,
        abi: STRATEGY_BASE_ABI,
        functionName: "maxTotalDeposits",
      }) as Promise<bigint>).catch(() => MAX_UINT256),
    ]);

    // (7) D-05 refusal arm — insufficient allowance.
    if (allowance < amountWei) {
      const recommendedAmount = formatUnits(amountWei, LST_DECIMALS);
      // Pitfall 4 nuance: stETH rebases between approval and deposit; a tight
      // approval can fall short by the rebase delta. Recommend "approve max"
      // for stETH only — other curated LSTs are non-rebasing so a tight
      // approval is safe.
      const stETHNote =
        lst === "stETH"
          ? " Note: stETH rebases; consider approving a buffer above the deposit amount, or call prepare_token_approve with amount: 'max' (unlimited) to avoid drift between approval and deposit blocks."
          : "";
      const insufficientMessage =
        `insufficient ${lst} allowance for EigenLayer StrategyManager: ` +
        `approved ${formatUnits(allowance, LST_DECIMALS)} ${lst}, need ${rawAmount} ${lst}. ` +
        `Call prepare_token_approve with the StrategyManager contract address as spender.${stETHNote}`;
      return {
        isError: true,
        content: [
          { type: "text", text: `error: ${insufficientMessage}` },
        ],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", insufficientMessage),
          hintTool: "prepare_token_approve",
          hintArgs: {
            tokenAddress: lstTokenAddr,
            spender: strategyManagerAddr,
            amount: recommendedAmount,
          },
        },
      };
    }

    // (8) D-06 refusal arm — strategy at cap. Pitfall 6 sentinel guard
    //     CRITICAL: check the MAX_UINT256 sentinel BEFORE the arithmetic
    //     comparison; some strategies return 2^256-1 to signal "unlimited"
    //     and naively comparing `currentTotalShares >= cap` would treat
    //     unlimited as "at cap".
    if (maxTotalDeposits !== MAX_UINT256 && currentTotalShares >= maxTotalDeposits) {
      const capMessage =
        `EigenLayer ${lst} strategy is at deposit cap: currentTotalShares=${currentTotalShares.toString()}, maxTotalDeposits=${maxTotalDeposits.toString()}. ` +
        `The strategy may unpause in the future; track via request_capability.`;
      return {
        isError: true,
        content: [
          { type: "text", text: `error: ${capMessage}` },
        ],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", capMessage),
          hintTool: "request_capability",
          hintArgs: {
            feature: `EigenLayer ${lst} strategy unpause`,
          },
        },
      };
    }

    // (9) Encode calldata + tx + payloadFingerprint + handle.
    const data: Hex = encodeDepositIntoStrategy(strategyAddr, lstTokenAddr, amountWei);
    const tx = {
      chainId,
      to: strategyManagerAddr,
      valueWei: 0n, // deposit is NOT payable; LST consumed as ERC-20
      data,
    };
    const payloadFingerprint = computePayloadFingerprint(tx);

    const handle = createHandle({
      args: {
        to: strategyManagerAddr,
        valueWei: "0",
        tokenAddress: lstTokenAddr,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    // (10) Compose response — 3 text blocks: PREPARE RECEIPT + CHECKS PERFORMED
    //      + LEDGER NOTICE. Each block is a separate content[] item so a future
    //      consumer (e.g. a CLI renderer) can style them independently.
    //      Template has {LST_SYMBOL} twice (header + amount row); use /g regex
    //      to replace BOTH occurrences in one pass.
    const baseReceipt = EIGENLAYER_DEPOSIT_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `ethereum (chainId 1)`)
      .replace("{STRATEGY_MANAGER}", strategyManagerAddr)
      .replace("{STRATEGY}", strategyAddr)
      .replace(/\{LST_SYMBOL\}/g, lst)
      .replace("{LST_TOKEN}", lstTokenAddr)
      .replace("{AMOUNT}", rawAmount);
    const receipt = fromCallerSupplied
      ? `${baseReceipt}\n  from:             ${rawFrom}`
      : baseReceipt;

    const checksPerformed = [
      "CHECKS PERFORMED",
      `  decimal-strict amount parse:  OK (${rawAmount} ${lst} = ${amountWei.toString()} wei, decimals=${LST_DECIMALS})`,
      `  D-05 LST allowance pre-flight: OK (approved ${formatUnits(allowance, LST_DECIMALS)} ${lst} ≥ ${rawAmount} ${lst} for StrategyManager spender)`,
      maxTotalDeposits === MAX_UINT256
        ? `  D-06 strategy cap pre-flight:  OK (maxTotalDeposits === MAX_UINT256 sentinel — unlimited cap; Pitfall 6 guard fired)`
        : `  D-06 strategy cap pre-flight:  OK (currentTotalShares=${currentTotalShares.toString()} < maxTotalDeposits=${maxTotalDeposits.toString()})`,
      `  ${SLASHING_RISK_LINE}`,
    ].join("\n");

    return {
      content: [
        { type: "text", text: receipt },
        { type: "text", text: checksPerformed },
        { type: "text", text: LEDGER_NOTICE_EIGENLAYER_DEPOSIT_TEMPLATE },
      ],
      structuredContent: {
        handle,
        chainId,
        from: fromAddress,
        to: strategyManagerAddr,
        valueWei: "0",
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
        { type: "text", text: `error: prepare_eigenlayer_deposit failed: ${message}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "prepare_eigenlayer_deposit failed",
        message,
      ),
    };
  }
});
