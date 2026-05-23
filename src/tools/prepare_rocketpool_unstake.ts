// MCP tool: prepare_rocketpool_unstake({ chain, rethAmount, from? })
//
// Phase 31 — Plan 31-03 (RP-02 unstake). Single-arg burn call:
// rETH.burn(rethAmount) — rETH is consumed at the contract, ETH is returned
// to msg.sender as a side effect at the current exchange rate, subject to
// deposit-pool liquidity availability. Selector `0x42966c68` is the GENERIC
// OpenZeppelin ERC20Burnable selector (Pitfall 2) — preview_send dispatches
// on (tx.to, selector) tuple to route the Rocket Pool arm.
//
// Bounded deviations from the prepare_weth_unwrap.ts analog (the only
// existing tool that emits a LEDGER NOTICE block):
//
//   (a) input schema is `{ chain: ["ethereum"], rethAmount, from? }`. Chain
//       narrowed to single-value enum ["ethereum"] (D-03). The amount
//       parameter is EXPLICITLY named `rethAmount` (not `amount`) to make
//       the unit clear to the agent — burning rETH, not ETH.
//   (b) `rethAmount` is a DECIMAL STRING in rETH units (decimals=18).
//       parseAmountStrict resolves wei; zero refuses with INVALID_INPUT.
//   (c) D-08 DEPOSIT-POOL LIQUIDITY PRE-FLIGHT: Promise.all reads
//       `RocketDepositPool.getBalance()` (current ETH liquidity in the pool)
//       AND `rETH.getEthValue(rethAmount)` (the ETH equivalent the burn
//       would return at the current rate). Refuse if pool < ethEquivalent
//       with INVALID_INPUT + hintTool: "request_capability" + verbatim D-08
//       error message naming the DEX-swap fallback.
//   (d) tx.to = getRocketPoolRethAddress(1). SOT-only (NEVER inlined).
//   (e) tx.valueWei = 0n. burn is NOT payable; rETH is consumed via burn
//       at the contract.
//   (f) tx.data = encodeRocketPoolBurn(rethAmountWei) — 36-byte calldata
//       (4-byte selector + 32-byte amount).
//   (g) D-13 LEDGER NOTICE: rETH.burn is NOT in the Ledger Ethereum app's
//       ERC-7730 clear-sign registry; emits the verbatim
//       LEDGER_NOTICE_ROCKETPOOL_TEMPLATE block as a separate content[] item.
//       SHARED template with prepare_rocketpool_stake — symmetric
//       blind-sign UX.
//   (h) PREPARE RECEIPT uses ROCKETPOOL_UNSTAKE_PREPARE_RECEIPT_TEMPLATE —
//       slots: {CHAIN}, {RETH_CONTRACT}, {AMOUNT}.
//
// Pitfall 5 residual: deposit-pool liquidity at prepare time may DECREASE
// before send (concurrent burns drain the pool). CHECKS PERFORMED surfaces
// this explicitly; the on-chain `require(ethBalance >= ethAmount)` is the
// backstop revert.
//
// Fixture AB-RP cross-link: test/prepare-rocketpool-unstake.test.ts re-anchors
// the payloadFingerprint byte-identity via `0xd1214423...` literal from
// test/signing-fingerprint.test.ts. Fixture AB-RP is from-INDEPENDENT (burn
// calldata carries only the rethAmount; no owner / from slot).

import { type Address, type Hex, formatEther, formatUnits } from "viem";

import {
  LEDGER_NOTICE_ROCKETPOOL_TEMPLATE,
  ROCKETPOOL_UNSTAKE_PREPARE_RECEIPT_TEMPLATE,
} from "../signing/blocks.js";
import {
  encodeRocketPoolBurn,
  ROCKET_DEPOSIT_POOL_ABI,
  RETH_ABI,
  RETH_DECIMALS,
  getRocketPoolRethAddress,
  getRocketPoolDepositPoolAddress,
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

const DESCRIPTION = [
  "Prepare an unsigned rETH.burn(uint256) call on Ethereum mainnet — burns rETH and returns ETH to msg.sender at the current exchange rate.",
  "Subject to deposit-pool liquidity availability: if the RocketDepositPool ETH balance is below the burn's ETH equivalent, the contract reverts. This tool performs a D-08 pre-flight pool-liquidity check at prepare time.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Use when the user wants to unstake from Rocket Pool by burning rETH for ETH at the protocol-canonical rate (vs swapping rETH on a DEX, which is a separate v2.4 surface).",
  "Do NOT use for rETH→ETH DEX swaps (deferred to v2.4 Uniswap), Lido withdrawal (call prepare_lido_unstake), or rETH bridge transfers (v2.6 BRIDGE-T1).",
  "`chain` is REQUIRED and locked to 'ethereum' — non-ethereum refuses with CHAIN_ID_MISMATCH (errorCode 15).",
  "`rethAmount` is a DECIMAL STRING in rETH units (e.g. '1.0' burns 1 rETH). Do NOT pass wei. Zero refuses with INVALID_INPUT.",
  "D-08 pre-flight: if the deposit pool's current ETH balance is below the burn's ETH equivalent (read via rETH.getEthValue(rethAmount)), refuses with INVALID_INPUT and recommends swapping rETH on a DEX (Uniswap V3, Curve) instead.",
  "Selector 0x42966c68 is the GENERIC OpenZeppelin ERC20Burnable.burn(uint256) selector — preview_send dispatches on the (tx.to, selector) tuple to route the Rocket Pool unstake arm specifically.",
  "Emits a LEDGER NOTICE block — Rocket Pool burn is NOT covered by the Ledger Ethereum app's ERC-7730 clear-sign plugins (the device will blind-sign; ensure 'Blind signing' is enabled).",
  "Pass `from` when the user wants to act from a non-default approved account. Requires a paired Ledger (real mode) or active persona (demo mode).",
  "Returns { handle, chainId, to, valueWei: '0', payloadFingerprint, prepareReceipt } plus a 3-block text payload (PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE).",
  "Failure modes: CHAIN_ID_MISMATCH if chain != ethereum, INVALID_INPUT if rethAmount is zero / malformed / exceeds pool liquidity, WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode mismatch.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description: "Chain identifier (required). ONLY 'ethereum' at v2.3.",
    },
    rethAmount: {
      type: "string",
      description:
        "Amount of rETH to burn, as a decimal string in rETH units (e.g. '1.5'). Must be > 0 and the ETH equivalent must not exceed the deposit pool's current liquidity.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts in get_ledger_status.accountsByChain[chainId]. Omit to use the active account. In demo mode, must match the active persona's address.",
    },
  },
  required: ["chain", "rethAmount"],
  additionalProperties: false,
};

registerTool("prepare_rocketpool_unstake", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // D-03 chain gate.
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

    const rawRethAmount = typeof args.rethAmount === "string" ? args.rethAmount : "";

    // SENDER resolution.
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;
    const fromCallerSupplied = fromResolution.callerSupplied;

    // Parse rethAmount strictly. RETH_DECIMALS is a bigint; parseAmountStrict
    // accepts number; convert.
    let rethAmountWei: bigint;
    try {
      rethAmountWei = parseAmountStrict(rawRethAmount, Number(RETH_DECIMALS));
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
          { type: "text", text: `error: invalid 'rethAmount': ${message}` },
        ],
        structuredContent: errEnvelope("INVALID_INPUT", `invalid 'rethAmount': ${message}`),
      };
    }

    if (rethAmountWei === 0n) {
      return {
        isError: true,
        content: [
          { type: "text", text: "error: rethAmount must be > 0 (burning 0 rETH yields 0 ETH)" },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          "rethAmount must be > 0 (burning 0 rETH yields 0 ETH)",
        ),
      };
    }

    // tx.to from SOT.
    const rethAddr: Address = getRocketPoolRethAddress(chainId)!;
    const depositPoolAddr: Address = getRocketPoolDepositPoolAddress(chainId)!;

    // D-08 DEPOSIT-POOL LIQUIDITY PRE-FLIGHT.
    const client = getChainClient(chainId);
    let poolBalance: bigint;
    let ethEquivalent: bigint;
    try {
      const [pool, eth] = await Promise.all([
        client.readContract({
          address: depositPoolAddr,
          abi: ROCKET_DEPOSIT_POOL_ABI,
          functionName: "getBalance",
        }) as Promise<bigint>,
        client.readContract({
          address: rethAddr,
          abi: RETH_ABI,
          functionName: "getEthValue",
          args: [rethAmountWei],
        }) as Promise<bigint>,
      ]);
      poolBalance = pool;
      ethEquivalent = eth;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: D-08 pre-flight failed (could not read deposit pool balance or rETH ETH-equivalent): ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "D-08 pre-flight read failed (RocketDepositPool.getBalance / rETH.getEthValue)",
          message,
        ),
      };
    }

    if (poolBalance < ethEquivalent) {
      const msg =
        `Rocket Pool deposit pool empty (${formatEther(poolBalance)} ETH liquidity, ` +
        `need ${formatEther(ethEquivalent)} ETH for burn). ` +
        `Swap rETH on a DEX (Uniswap V3, Curve) instead, or wait for more deposits to refill the pool.`;
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${msg}` }],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          msg,
          undefined,
          "request_capability",
          { feature: "Rocket Pool rETH/ETH DEX swap" },
        ),
      };
    }

    // Encode + handle.
    const data: Hex = encodeRocketPoolBurn(rethAmountWei);

    const tx = {
      chainId,
      to: rethAddr,
      valueWei: 0n,
      data,
    };

    const payloadFingerprint = computePayloadFingerprint(tx);

    const handle = createHandle({
      args: {
        to: "",
        valueWei: "0",
        tokenAddress: rethAddr,
        amount: rawRethAmount,
      },
      tx,
      payloadFingerprint,
    });

    // PREPARE RECEIPT.
    const baseReceipt = ROCKETPOOL_UNSTAKE_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `ethereum (chainId 1)`)
      .replace("{RETH_CONTRACT}", rethAddr)
      .replace("{AMOUNT}", rawRethAmount);
    const receipt = fromCallerSupplied
      ? `${baseReceipt}\n  from:         ${rawFrom}`
      : baseReceipt;

    // CHECKS PERFORMED (D-08 outcome + Pitfall 2 + Pitfall 5 residual).
    const checksLines: string[] = [
      "CHECKS PERFORMED",
      `  decimal-strict rethAmount parse: OK (${rawRethAmount} rETH → ${rethAmountWei} wei; 18 decimals)`,
      `  deposit-pool liquidity (D-08): pool ${formatEther(poolBalance)} ETH >= burn ETH-equivalent ${formatEther(ethEquivalent)} ETH (read at prepare time; on-chain require(ethBalance >= ethAmount) is the backstop revert if it drifts before send)`,
      `  Pitfall 5 residual: deposit pool liquidity checked at prepare time; may decrease before send — on-chain revert is the backstop`,
      `  selector collision awareness (Pitfall 2): 0x42966c68 is the GENERIC OpenZeppelin ERC20Burnable selector. Disambiguating tx.to is ${rethAddr} (rETH — preview_send routes (tx.to, selector) tuple).`,
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
        to: rethAddr,
        valueWei: "0",
        data: tx.data,
        rethAmount: rawRethAmount,
        rethAmountWei: rethAmountWei.toString(),
        ethEquivalentWei: ethEquivalent.toString(),
        ethEquivalentHuman: formatUnits(ethEquivalent, 18),
        poolBalanceWei: poolBalance.toString(),
        payloadFingerprint,
        prepareReceipt: receipt,
        checksPerformed: checks,
        ledgerNotice: LEDGER_NOTICE_ROCKETPOOL_TEMPLATE,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_rocketpool_unstake failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_rocketpool_unstake failed", message),
    };
  }
});
