// MCP tool: prepare_curve_add_liquidity({ chain, poolAddress, amounts, slippageBps, from? })
//
// Phase 34 — Plan 34-03 Task 3 (CRV-03). Produces an unsigned Curve `add_liquidity`
// transaction for stable_ng plain pools only.
//
// Key invariants:
//   - Legacy pools REFUSED with INVALID_INPUT "deferred to v2.4.x" (LOAD-BEARING refusal)
//   - amounts.length MUST equal pool.coins.length (Pitfall 5 anchor)
//   - Per-element parseAmountStrict with index identified in error message
//   - On-chain calc_token_amount quote re-fetched at prepare time (NEVER cached)
//   - bigint min_mint_amount: (quoted * (10000n - BigInt(slippageBps))) / 10000n
//   - slippageBps REQUIRED, range [1, 5000]
//   - add_liquidity is non-payable (even for coins containing ETH sentinel) — valueWei = 0n
//   - Per-coin ERC-20 approval pre-flight for each non-zero amount (surfaces hints, NOT refusal)
//   - No sandwich-MEV gate (documented in CHECKS PERFORMED)
//
// Selector: 0xb72df5de — add_liquidity(uint256[],uint256) [stable_ng]
//
// Analog: src/tools/prepare_curve_swap.ts (Phase 34-03 Task 2)
// Pattern map: PATTERNS.md §prepare_curve_add_liquidity.ts

import {
  type Address,
  type Hex,
  erc20Abi,
  formatUnits,
  getAddress,
  isAddress,
} from "viem";

import { getChainClient } from "../chains/registry.js";
import { _curveChain } from "../chains/curve.js";
import { getCurvePoolByAddress } from "../config/contracts.js";
import { _curveProtocol } from "../protocols/curve.js";
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

// ---------------------------------------------------------------------------
// Error envelope helper (mirrors prepare_curve_swap.ts pattern)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Tool description + schema
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  "Prepare an unsigned Curve Finance `add_liquidity` transaction on Ethereum mainnet.",
  "Supported pools: stable_ng plain pools only (see get_curve_positions for positions).",
  "REFUSED for: legacy pools (deferred to v2.4.x — use prepare_curve_swap to swap instead); non-curated pools (INVALID_INPUT).",
  "NOT for: Uniswap LP (use prepare_uniswap_mint_position), swaps (use prepare_curve_swap).",
  "amounts[] must contain one decimal string per pool coin, in coin order (same as pool.coins[]).",
  "On-chain calc_token_amount quote re-fetched at prepare time (NOT cached from agent prior call).",
  "bigint slippage math: min_mint_amount = (quotedLp * (10000 - slippageBps)) / 10000.",
  "slippageBps is REQUIRED (range [1, 5000]; >5000 refused as footgun — no default).",
  "ERC-20 approval pre-flight: reads ERC20.allowance(from, poolAddress) for each non-zero coin. Insufficient allowance surfaces as hint in CHECKS PERFORMED (NOT a refusal).",
  "NO sandwich-MEV gate (asymmetric vs Phase 32 UniV3 — documented in CHECKS PERFORMED).",
  "Returns PREPARE RECEIPT + CHECKS PERFORMED text blocks + structuredContent with handle/payloadFingerprint.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description: "Chain identifier (required). ONLY 'ethereum' is supported at Phase 34.",
    },
    poolAddress: {
      type: "string",
      description:
        "Curve pool contract address (0x-prefixed EIP-55). Must be in the curated Curve registry — non-registry addresses are refused.",
    },
    amounts: {
      type: "array",
      items: { type: "string" },
      description:
        "Deposit amounts in DECIMAL STRING form, one per pool coin in coin order (e.g. ['100', '100'] for a 2-coin pool). Server resolves decimals via per-pool coinDecimals registry.",
    },
    slippageBps: {
      type: "number",
      description:
        "Slippage tolerance in basis points (integer, required, range [1, 5000]). No default — must be explicit. 5000 = 50% cap.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address. Omit to use the active WalletConnect account.",
    },
  },
  required: ["chain", "poolAddress", "amounts", "slippageBps"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

registerTool("prepare_curve_add_liquidity", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // -----------------------------------------------------------------------
    // Step 1: Chain gate — Curve add_liquidity is Ethereum-only at Phase 34
    // -----------------------------------------------------------------------
    const chainName = typeof args.chain === "string" ? args.chain : "";
    if (chainName !== "ethereum") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_curve_add_liquidity requires chain="ethereum"; got "${chainName}"`,
          },
        ],
        structuredContent: errEnvelope(
          "CHAIN_ID_MISMATCH",
          `prepare_curve_add_liquidity requires chain="ethereum"; got "${chainName}"`,
        ),
      };
    }
    const chainId = 1;

    // -----------------------------------------------------------------------
    // Step 2: Pool registry lookup
    // -----------------------------------------------------------------------
    const poolAddrRaw = typeof args.poolAddress === "string" ? args.poolAddress : "";
    if (!isAddress(poolAddrRaw, { strict: false })) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: poolAddress is not a valid EVM address` }],
        structuredContent: errEnvelope("INVALID_INPUT", "poolAddress is not a valid EVM address"),
      };
    }
    const poolAddress: Address = getAddress(poolAddrRaw);
    const pool = getCurvePoolByAddress(chainId, poolAddress);
    if (!pool) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: poolAddress ${poolAddress} not in curated Curve registry`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `poolAddress ${poolAddress} not in curated Curve registry`,
          "pool-not-in-registry",
        ),
      };
    }

    // -----------------------------------------------------------------------
    // Step 3: Legacy refusal (LOAD-BEARING — add_liquidity ABI differs between versions)
    // Legacy pools use add_liquidity(uint256[N],uint256) with fixed N — deferred to v2.4.x.
    // This check MUST run BEFORE amounts validation.
    // -----------------------------------------------------------------------
    if (pool.abiVersion === "legacy") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_curve_add_liquidity does not support legacy pools; deferred to v2.4.x. Use prepare_curve_swap to swap on the legacy stETH/ETH pool instead.`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `prepare_curve_add_liquidity does not support legacy pools; deferred to v2.4.x. Use prepare_curve_swap to swap on the legacy stETH/ETH pool instead.`,
          "legacy-add-liquidity-refused",
        ),
      };
    }

    // -----------------------------------------------------------------------
    // Step 4: amounts.length validation (Pitfall 5 anchor)
    // -----------------------------------------------------------------------
    const amountsRaw = Array.isArray(args.amounts) ? (args.amounts as string[]) : [];
    const expectedLen = pool.coins.length;
    if (amountsRaw.length !== expectedLen) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: amounts.length=${amountsRaw.length} does not match pool coins.length=${expectedLen}`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `amounts.length=${amountsRaw.length} does not match pool coins.length=${expectedLen}`,
          "amounts-length-mismatch",
        ),
      };
    }

    // -----------------------------------------------------------------------
    // Step 5: slippageBps validation [1, 5000]
    // -----------------------------------------------------------------------
    const slippageBps = typeof args.slippageBps === "number" ? args.slippageBps : -1;
    if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: slippageBps must be an integer in [1, 5000]; got ${args.slippageBps}`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `slippageBps must be an integer in [1, 5000]; got ${args.slippageBps}`,
          "slippage-out-of-range",
        ),
      };
    }

    // -----------------------------------------------------------------------
    // Step 6: Per-element parseAmountStrict with index in error message
    // -----------------------------------------------------------------------
    const parsedAmounts: bigint[] = [];
    for (let idx = 0; idx < amountsRaw.length; idx++) {
      const decimals = pool.coinDecimals[idx]!;
      const raw = typeof amountsRaw[idx] === "string" ? amountsRaw[idx]! : "";
      try {
        parsedAmounts.push(parseAmountStrict(raw, decimals));
      } catch (err) {
        const msg = err instanceof InvalidAmountError
          ? err.message
          : "invalid amount string";
        return {
          isError: true,
          content: [
            { type: "text", text: `error: amounts[${idx}] parse failed: ${msg}` },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `amounts[${idx}] parse failed: ${msg}`,
            "invalid-amount",
          ),
        };
      }
    }

    // -----------------------------------------------------------------------
    // Step 7: resolveFrom — signer address (WC-paired or demo persona)
    // -----------------------------------------------------------------------
    const fromResult = await resolveFrom({
      rawFrom: typeof args.from === "string" ? args.from : undefined,
      chainId,
    });
    if (fromResult.kind === "error") {
      return fromResult.result;
    }
    const fromAddress: Address = fromResult.fromAddress;

    // -----------------------------------------------------------------------
    // Step 8: On-chain calc_token_amount quote (re-fetched at prepare time — NEVER cached)
    // stable_ng: calc_token_amount(amounts[], is_deposit=true)
    // -----------------------------------------------------------------------
    const client = getChainClient(chainId);
    const quotedLp = await _curveChain.getCurveCalcTokenAmount(
      client,
      pool.address,
      parsedAmounts,
    );

    // -----------------------------------------------------------------------
    // Step 9: bigint min_mint_amount derivation (no float arithmetic — CLAUDE.md invariant)
    // -----------------------------------------------------------------------
    const minMintAmount = (quotedLp * (10000n - BigInt(slippageBps))) / 10000n;

    // -----------------------------------------------------------------------
    // Step 10: Encode calldata — stable_ng add_liquidity(uint256[], uint256)
    // valueWei = 0n always (add_liquidity is non-payable even for pools with ETH sentinel)
    // -----------------------------------------------------------------------
    const data: Hex = _curveProtocol.encodeAddLiquidityStableNg({
      amounts: parsedAmounts,
      minMintAmount,
    });
    const valueWei = 0n;

    // -----------------------------------------------------------------------
    // Step 11: Per-coin ERC-20 approval pre-flight
    // For each coin with non-zero parsed amount, check ERC20.allowance(from, poolAddress).
    // Surfaces shortfall as hints in CHECKS PERFORMED (NOT a refusal).
    // -----------------------------------------------------------------------
    const approvalHints: string[] = [];
    for (let idx = 0; idx < parsedAmounts.length; idx++) {
      const coinAmount = parsedAmounts[idx]!;
      if (coinAmount === 0n) continue; // skip zero-amount deposits
      const coinAddr: Address = getAddress(pool.coins[idx]!);
      const coinDecimals = pool.coinDecimals[idx]!;
      try {
        const allowance = await client.readContract({
          address: coinAddr,
          abi: erc20Abi,
          functionName: "allowance",
          args: [fromAddress, pool.address],
        });
        const currentAllowance = allowance as bigint;
        if (currentAllowance < coinAmount) {
          const amountStr = amountsRaw[idx]!;
          approvalHints.push(
            `Approval required: call prepare_token_approve({ tokenAddress: "${coinAddr.toLowerCase()}", spender: "${pool.address}", amount: "${amountStr}" }) before signing this add_liquidity.`,
          );
        } else {
          approvalHints.push(
            `Token allowance coins[${idx}] (${coinAddr.slice(0, 8)}…): sufficient (${formatUnits(currentAllowance, coinDecimals)} approved to pool).`,
          );
        }
      } catch {
        approvalHints.push(
          `Token allowance coins[${idx}] (${coinAddr.slice(0, 8)}…): could not read (RPC error — verify allowance before signing).`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // Step 12: Handle + payloadFingerprint
    // -----------------------------------------------------------------------
    const tx = { chainId, to: pool.address, valueWei, data };
    const payloadFingerprint = computePayloadFingerprint(tx);
    const handle = createHandle({
      args: {
        to: pool.address,
        valueWei: valueWei.toString(),
        amount: amountsRaw.join(","),
        slippageBps: String(slippageBps),
      },
      tx,
      payloadFingerprint,
    });

    // -----------------------------------------------------------------------
    // Step 13: Response — PREPARE RECEIPT + CHECKS PERFORMED text blocks
    // -----------------------------------------------------------------------
    const parsedAmountsForDisplay = parsedAmounts
      .map((a, idx) => `${formatUnits(a, pool.coinDecimals[idx]!)} (${a} wei)`)
      .join(", ");

    const receipt = [
      `PREPARE RECEIPT — prepare_curve_add_liquidity`,
      `Pool:            ${pool.displayName} (${poolAddress})`,
      `abiVersion:      ${pool.abiVersion}`,
      `Amounts:         [${amountsRaw.join(", ")}] → parsed: [${parsedAmountsForDisplay}]`,
      `Slippage:        ${slippageBps} bps (${(slippageBps / 100).toFixed(2)}%)`,
      `Quoted LP:       ${quotedLp} wei`,
      `minMintAmount:   ${minMintAmount} wei`,
      `Chain:           ethereum (chainId=${chainId})`,
      `From:            ${fromAddress}`,
      `Handle:          ${handle}`,
    ].join("\n");

    const checksPerformed = [
      `CHECKS PERFORMED — prepare_curve_add_liquidity`,
      `Pool:               ${pool.displayName}`,
      `abiVersion:         ${pool.abiVersion}`,
      `Legacy refusal:     not triggered (stable_ng pool)`,
      `amounts.length:     ${parsedAmounts.length} (matches pool coins.length)`,
      `Quoted LP:          ${quotedLp} wei`,
      `min_mint_amount:    ${minMintAmount} wei`,
      `Slippage applied:   ${slippageBps} bps`,
      `tx.value (valueWei): 0 (add_liquidity is non-payable)`,
      ...approvalHints,
      `Sandwich-MEV gate: not applied to Curve (low MEV exposure on stable pools)`,
      `payloadFingerprint: ${payloadFingerprint}`,
    ].join("\n");

    return {
      content: [
        { type: "text", text: receipt },
        { type: "text", text: checksPerformed },
      ],
      structuredContent: {
        handle,
        chainId,
        from: fromAddress,
        to: pool.address,
        valueWei: valueWei.toString(),
        data,
        payloadFingerprint,
        abiVersion: pool.abiVersion,
        parsedAmounts: parsedAmounts.map(String),
        quotedLp: quotedLp.toString(),
        minMintAmount: minMintAmount.toString(),
        slippageBps,
        poolDisplayName: pool.displayName,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_curve_add_liquidity failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_curve_add_liquidity failed", message),
    };
  }
});
