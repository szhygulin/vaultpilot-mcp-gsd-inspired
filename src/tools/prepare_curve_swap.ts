// MCP tool: prepare_curve_swap({ chain, poolAddress, inputToken, outputToken, amount, slippageBps, from? })
//
// Phase 34 — Plan 34-03 Task 2 (CRV-02). Produces an unsigned Curve `exchange`
// transaction for either:
//   (a) Legacy stETH/ETH pool: exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) @payable
//       ETH-in path (i=0): tx.value = amountIn (Pitfall 2 — @payable checks msg.value == dx)
//       stETH-in path (i=1): tx.value = 0n (non-payable)
//   (b) stable_ng plain pools: exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy, address _receiver)
//       Always tx.value = 0n; _receiver = signer (from-dependent calldata — Fixture CRV-B cross-link)
//
// Key invariants:
//   - Per-pool abiVersion dispatch (from registry tag, NOT heuristic probing)
//   - On-chain get_dy quote re-fetched at prepare time (NEVER cached)
//   - bigint min_dy derivation: (quotedDy * (10000n - BigInt(slippageBps))) / 10000n
//   - slippageBps REQUIRED, range [1, 5000] — no MEV gate, but 50% cap is footgun guard
//   - Token amounts via per-pool coinDecimals (NOT get_token_metadata round-trip)
//   - No sandwich-MEV refusal (asymmetric treatment vs Phase 32 UniV3 — documented in CHECKS PERFORMED)
//
// Analog: src/tools/prepare_uniswap_swap.ts (Phase 32)
// Pattern map: PATTERNS.md §prepare_curve_swap.ts

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
// Error envelope helper (mirrors prepare_uniswap_swap.ts pattern)
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
  "Prepare an unsigned Curve Finance `exchange` (swap) transaction on Ethereum mainnet.",
  "Supported pools: stETH/ETH legacy pool + top-10 curated stable_ng plain pools (see get_curve_positions for positions).",
  "NOT for: Uniswap swaps (use prepare_uniswap_swap), non-curated Curve pools (refused with INVALID_INPUT).",
  "Per-abiVersion dispatch: legacy stETH/ETH pool uses 4-param exchange(i,j,dx,min_dy); stable_ng pools use 5-param exchange(i,j,dx,min_dy,_receiver) with _receiver=signer.",
  "Legacy ETH-in path (inputToken=ETH sentinel): tx.value carries ETH (payable exchange). All other paths: tx.value=0n.",
  "On-chain get_dy quote re-fetched at prepare time (NOT cached from agent prior call).",
  "bigint slippage math: min_dy = (quotedDy * (10000 - slippageBps)) / 10000.",
  "slippageBps is REQUIRED (range [1, 5000]; >5000 refused as footgun — no default).",
  "ERC-20 approval pre-flight: for non-ETH input, reads ERC20.allowance(from, poolAddress). Insufficient allowance surfaces as hint in CHECKS PERFORMED (NOT a refusal).",
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
    inputToken: {
      type: "string",
      description:
        "Input token address (EIP-55). Must be one of the pool's coins[]. Use the ETH sentinel 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE for native ETH on the legacy stETH/ETH pool.",
    },
    outputToken: {
      type: "string",
      description:
        "Output token address (EIP-55). Must be one of the pool's coins[] and different from inputToken.",
    },
    amount: {
      type: "string",
      description:
        "Amount of inputToken in DECIMAL STRING form (e.g. '100' for 100 USDC). Server resolves decimals via per-pool coinDecimals registry (NOT get_token_metadata).",
    },
    slippageBps: {
      type: "number",
      description:
        "Slippage tolerance in basis points (integer, required, range [1, 5000]). No default — must be explicit. 5000 = 50% cap even without a MEV gate.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address. Omit to use the active WalletConnect account.",
    },
  },
  required: ["chain", "poolAddress", "inputToken", "outputToken", "amount", "slippageBps"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// ETH sentinel (legacy stETH/ETH pool coin 0)
// ---------------------------------------------------------------------------
const ETH_SENTINEL: Address = getAddress(
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
);

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

registerTool("prepare_curve_swap", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // -----------------------------------------------------------------------
    // Step 1: Chain gate — Curve is Ethereum-only at Phase 34
    // -----------------------------------------------------------------------
    const chainName = typeof args.chain === "string" ? args.chain : "";
    if (chainName !== "ethereum") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_curve_swap requires chain="ethereum"; got "${chainName}"`,
          },
        ],
        structuredContent: errEnvelope(
          "CHAIN_ID_MISMATCH",
          `prepare_curve_swap requires chain="ethereum"; got "${chainName}"`,
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
    // Step 3: inputToken / outputToken index resolution
    // -----------------------------------------------------------------------
    const inputTokenRaw = typeof args.inputToken === "string" ? args.inputToken : "";
    const outputTokenRaw = typeof args.outputToken === "string" ? args.outputToken : "";

    if (!isAddress(inputTokenRaw, { strict: false })) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: inputToken is not a valid EVM address` }],
        structuredContent: errEnvelope("INVALID_INPUT", "inputToken is not a valid EVM address"),
      };
    }
    if (!isAddress(outputTokenRaw, { strict: false })) {
      return {
        isError: true,
        content: [{ type: "text", text: `error: outputToken is not a valid EVM address` }],
        structuredContent: errEnvelope("INVALID_INPUT", "outputToken is not a valid EVM address"),
      };
    }

    const inputToken: Address = getAddress(inputTokenRaw);
    const outputToken: Address = getAddress(outputTokenRaw);

    const i = pool.coins.findIndex(
      (c) => getAddress(c) === inputToken,
    );
    const j = pool.coins.findIndex(
      (c) => getAddress(c) === outputToken,
    );

    if (i === -1) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: inputToken ${inputToken} not in pool coins[]`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `inputToken ${inputToken} not in pool coins[] for pool ${poolAddress}`,
        ),
      };
    }
    if (j === -1) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: outputToken ${outputToken} not in pool coins[]`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `outputToken ${outputToken} not in pool coins[] for pool ${poolAddress}`,
        ),
      };
    }

    // -----------------------------------------------------------------------
    // Step 4: slippageBps validation [1, 5000]
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
    // Step 5: Decimal-string parse via per-pool coinDecimals (NOT get_token_metadata)
    // -----------------------------------------------------------------------
    const tokenInDecimals = pool.coinDecimals[i]!;
    const amountRaw = typeof args.amount === "string" ? args.amount : "";
    let amountIn: bigint;
    try {
      amountIn = parseAmountStrict(amountRaw, tokenInDecimals);
    } catch (err) {
      const msg = err instanceof InvalidAmountError
        ? err.message
        : "invalid amount string";
      return {
        isError: true,
        content: [{ type: "text", text: `error: amount parse failed: ${msg}` }],
        structuredContent: errEnvelope("INVALID_INPUT", `amount parse failed: ${msg}`, "invalid-amount"),
      };
    }

    // -----------------------------------------------------------------------
    // Step 6: resolveFrom — signer address (WC-paired or demo persona)
    // -----------------------------------------------------------------------
    const fromResult = await resolveFrom({
      rawFrom: typeof args.from === "string" ? args.from : undefined,
    });
    if (fromResult.kind === "error") {
      return fromResult.result;
    }
    const fromAddress: Address = fromResult.fromAddress;

    // -----------------------------------------------------------------------
    // Step 7: On-chain get_dy quote (re-fetched at prepare time — NEVER cached)
    // -----------------------------------------------------------------------
    const client = getChainClient(chainId);
    const quotedDy = await _curveChain.getCurveGetDy(
      client,
      pool.address,
      i,
      j,
      amountIn,
    );

    // -----------------------------------------------------------------------
    // Step 8: bigint min_dy derivation (no float arithmetic — CLAUDE.md invariant)
    // -----------------------------------------------------------------------
    const minDy = (quotedDy * (10000n - BigInt(slippageBps))) / 10000n;

    // -----------------------------------------------------------------------
    // Step 9: abiVersion dispatch — calldata + valueWei
    // -----------------------------------------------------------------------
    // ETH-in: only when legacy pool AND i === 0 AND coins[0] === ETH sentinel
    const isEthIn =
      pool.abiVersion === "legacy" &&
      i === 0 &&
      getAddress(pool.coins[0]!) === ETH_SENTINEL;

    let data: Hex;
    let valueWei: bigint;

    if (pool.abiVersion === "legacy") {
      data = _curveProtocol.encodeExchangeLegacy({ i, j, dx: amountIn, minDy });
      valueWei = isEthIn ? amountIn : 0n;
    } else {
      // stable_ng: _receiver = signer (from-dependent calldata — Pitfall 7 + Fixture CRV-B)
      data = _curveProtocol.encodeExchangeStableNg({
        i,
        j,
        dx: amountIn,
        minDy,
        receiver: fromAddress,
      });
      valueWei = 0n;
    }

    // -----------------------------------------------------------------------
    // Step 10: ERC-20 approval pre-flight (skip when isEthIn)
    // -----------------------------------------------------------------------
    let approvalHint = "";
    if (!isEthIn) {
      try {
        const allowance = await client.readContract({
          address: inputToken,
          abi: erc20Abi,
          functionName: "allowance",
          args: [fromAddress, pool.address],
        });
        const currentAllowance = allowance as bigint;
        if (currentAllowance < amountIn) {
          approvalHint = `\nApproval required: call prepare_token_approve({ tokenAddress: "${inputToken}", spender: "${pool.address}", amount: "${amountRaw}" }) before signing this swap.`;
        } else {
          approvalHint = `\nToken allowance: sufficient (${formatUnits(currentAllowance, tokenInDecimals)} ${inputToken.slice(0, 8)}… approved to pool).`;
        }
      } catch {
        approvalHint = "\nToken allowance: could not read (RPC error — verify allowance before signing).";
      }
    } else {
      approvalHint = "\nToken approval: not required (ETH-in path uses native ETH directly).";
    }

    // -----------------------------------------------------------------------
    // Step 11: Handle + payloadFingerprint
    // -----------------------------------------------------------------------
    const tx = { chainId, to: pool.address, valueWei, data };
    const payloadFingerprint = computePayloadFingerprint(tx);
    const handle = createHandle({
      args: {
        chain: chainName,
        poolAddress: pool.address,
        inputToken,
        outputToken,
        amount: amountRaw,
        slippageBps,
      },
      tx,
      payloadFingerprint,
    });

    // -----------------------------------------------------------------------
    // Step 12: Response — PREPARE RECEIPT + CHECKS PERFORMED text blocks
    // -----------------------------------------------------------------------
    const tokenInDecimsForDisplay = tokenInDecimals;
    const tokenOutDecimals = pool.coinDecimals[j]!;

    const receipt = [
      `PREPARE RECEIPT — prepare_curve_swap`,
      `Pool:         ${pool.displayName} (${poolAddress})`,
      `abiVersion:   ${pool.abiVersion}`,
      `Input token:  ${inputToken} (coins[${i}], decimals=${tokenInDecimsForDisplay})`,
      `Output token: ${outputToken} (coins[${j}], decimals=${tokenOutDecimals})`,
      `Amount in:    ${amountRaw} (${amountIn} wei)`,
      `Slippage:     ${slippageBps} bps (${(slippageBps / 100).toFixed(2)}%)`,
      `Chain:        ethereum (chainId=${chainId})`,
      `From:         ${fromAddress}`,
      `Handle:       ${handle}`,
    ].join("\n");

    const checksPerformed = [
      `CHECKS PERFORMED — prepare_curve_swap`,
      `Pool:               ${pool.displayName}`,
      `abiVersion:         ${pool.abiVersion}`,
      `Coin i (input):     ${inputToken}`,
      `Coin j (output):    ${outputToken}`,
      `Amount in:          ${formatUnits(amountIn, tokenInDecimsForDisplay)} (${amountIn} wei)`,
      `Quoted dy:          ${formatUnits(quotedDy, tokenOutDecimals)} (${quotedDy} wei)`,
      `min_dy:             ${formatUnits(minDy, tokenOutDecimals)} (${minDy} wei)`,
      `Slippage applied:   ${slippageBps} bps`,
      `ETH-in path:        ${isEthIn}`,
      `tx.value (valueWei): ${valueWei}`,
      approvalHint.trim(),
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
        i,
        j,
        amountIn: amountIn.toString(),
        quotedDy: quotedDy.toString(),
        minDy: minDy.toString(),
        slippageBps,
        isEthIn,
        poolDisplayName: pool.displayName,
        inputCoinAddress: inputToken,
        outputCoinAddress: outputToken,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_curve_swap failed: ${message}` },
      ],
      structuredContent: errEnvelope("INTERNAL_ERROR", "prepare_curve_swap failed", message),
    };
  }
});
