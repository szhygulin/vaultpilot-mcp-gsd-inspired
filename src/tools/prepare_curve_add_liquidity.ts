// MCP tool: prepare_curve_add_liquidity({ chain, poolAddress, amounts, slippageBps, from? })
//
// Phase 34 — Plan 34-03 Task 3 (CRV-03). Phase 43 — legacy dispatch arm added.
// Produces an unsigned Curve `add_liquidity` transaction for stable_ng plain
// pools AND the legacy stETH/ETH fixed-array pool.
//
// Key invariants:
//   - Per-abiVersion dispatch (legacy fixed uint256[2] vs stable_ng dynamic uint256[])
//   - amounts.length MUST equal pool.coins.length (Pitfall 5 anchor)
//   - Per-element parseAmountStrict with index identified in error message
//   - On-chain calc_token_amount quote re-fetched at prepare time (NEVER cached);
//     legacy uses getCurveLegacyCalcTokenAmount (fixed uint256[2]), stable_ng uses
//     getCurveCalcTokenAmount (dynamic uint256[])
//   - bigint min_mint_amount: (quoted * (10000n - BigInt(slippageBps))) / 10000n
//   - slippageBps REQUIRED, range [1, 5000]
//   - stable_ng add_liquidity is non-payable → valueWei = 0n
//   - legacy add_liquidity is @payable: ETH-in (coin0 sentinel, amounts[0]>0) →
//     valueWei = amounts[0]; approval pre-flight skips the ETH-sentinel coin
//   - Per-coin ERC-20 approval pre-flight for each non-zero amount (surfaces hints, NOT refusal)
//   - No sandwich-MEV gate (documented in CHECKS PERFORMED)
//
// Selectors: 0xb72df5de add_liquidity(uint256[],uint256) [stable_ng];
//            0x0b4c7e4d add_liquidity(uint256[2],uint256) [legacy]
//
// Analog: src/tools/prepare_curve_swap.ts (Phase 34-03 Task 2 — abiVersion dispatch)
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
// ETH sentinel (legacy stETH/ETH pool coin 0) — copied from prepare_curve_swap.ts.
const ETH_SENTINEL: Address = getAddress(
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
);
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
  "Supported pools: stable_ng plain pools + the legacy stETH/ETH fixed-array pool (see get_curve_positions for positions).",
  "Per-abiVersion dispatch: stable_ng uses add_liquidity(uint256[],uint256); legacy stETH/ETH uses add_liquidity(uint256[2],uint256) @payable. Legacy ETH-in (amounts[0]>0 on coin0 ETH sentinel): tx.value carries the ETH. All stable_ng paths: tx.value=0.",
  "REFUSED for: non-curated pools (INVALID_INPUT).",
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
    // Step 3 (Phase 43): legacy refusal DELETED — both abiVersions proceed.
    // The legacy/stable_ng split happens at the QUOTE + ENCODE steps below.
    // -----------------------------------------------------------------------

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
    // abiVersion-dispatched: legacy uses the fixed uint256[2] reader, stable_ng
    // uses the dynamic uint256[] reader (Pitfall 1 — wrong reader mis-encodes).
    // -----------------------------------------------------------------------
    const client = getChainClient(chainId);
    const isLegacy = pool.abiVersion === "legacy";
    const quotedLp = isLegacy
      ? await _curveChain.getCurveLegacyCalcTokenAmount(
          client,
          pool.address,
          [parsedAmounts[0]!, parsedAmounts[1]!],
        )
      : await _curveChain.getCurveCalcTokenAmount(
          client,
          pool.address,
          parsedAmounts,
        );

    // -----------------------------------------------------------------------
    // Step 9: bigint min_mint_amount derivation (no float arithmetic — CLAUDE.md invariant)
    // -----------------------------------------------------------------------
    const minMintAmount = (quotedLp * (10000n - BigInt(slippageBps))) / 10000n;

    // -----------------------------------------------------------------------
    // Step 10: abiVersion dispatch — calldata + valueWei (mirror prepare_curve_swap).
    // legacy add_liquidity is @payable: ETH-in (coin0 sentinel, amounts[0]>0) →
    // valueWei = amounts[0]; the amount still rides in the calldata array too.
    // stable_ng add_liquidity is non-payable → valueWei = 0n (BYTE-IDENTICAL to
    // the pre-Phase-43 path — Fixture CRV-C anchors this).
    // -----------------------------------------------------------------------
    const isEthIn =
      isLegacy &&
      parsedAmounts[0]! > 0n &&
      getAddress(pool.coins[0]!) === ETH_SENTINEL;

    let data: Hex;
    let valueWei: bigint;
    if (isLegacy) {
      data = _curveProtocol.encodeAddLiquidityLegacy({
        amounts: [parsedAmounts[0]!, parsedAmounts[1]!],
        minMintAmount,
      });
      valueWei = isEthIn ? parsedAmounts[0]! : 0n;
    } else {
      data = _curveProtocol.encodeAddLiquidityStableNg({
        amounts: parsedAmounts,
        minMintAmount,
      });
      valueWei = 0n;
    }

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
      // Phase 43 (Pitfall 8 / D-03): the ETH sentinel is NOT an ERC-20 — never
      // read ERC20.allowance on it. The ETH leg rides as tx.value (@payable).
      if (coinAddr === ETH_SENTINEL) {
        approvalHints.push(
          `Coin[${idx}] is native ETH (sentinel) — no ERC-20 approval needed; tx.value carries the ETH.`,
        );
        continue;
      }
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
      `amounts.length:     ${parsedAmounts.length} (matches pool coins.length)`,
      `Quoted LP:          ${quotedLp} wei`,
      `min_mint_amount:    ${minMintAmount} wei`,
      `Slippage applied:   ${slippageBps} bps`,
      `ETH-in path:        ${isEthIn}`,
      `tx.value (valueWei): ${valueWei}${isEthIn ? " (legacy @payable ETH-in)" : ""}`,
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
        isEthIn,
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
