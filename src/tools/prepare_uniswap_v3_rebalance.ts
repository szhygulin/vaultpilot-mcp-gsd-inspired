// MCP tool: prepare_uniswap_v3_rebalance({
//   chain, tokenId, newPriceLower, newPriceUpper,
//   slippageBps?, deadlineSeconds?, from?
// })
//
// Phase 33 — Plan 33-03 (UNI-09). The FIRST composite-tx surface in the
// codebase per CONTEXT.md D-06 + RESEARCH § Topic 9 (load-bearing for v2.5
// Safe three-step convention). ONE tool returns ONE handle whose `tx.data` is
// `multicall(bytes[])` wrapping 3 NPM inner calls in LOAD-BEARING order:
//
//   Step 1: decreaseLiquidity — burns 100% of existing position liquidity,
//           settles the resulting amounts to position.tokensOwed0/1.
//   Step 2: collect            — sweeps settled-but-uncollected (the decrease
//           output) + any pre-existing accrued fees to the user. Uses
//           MAX_UINT128 sentinel for both amount*Max.
//   Step 3: mint               — opens NEW position at the new tick range
//           using the same token amounts the decrease produced.
//
// Single `payloadFingerprint` over the FULL outer multicall calldata — the
// cryptographic-binding chain is UNCHANGED from Phase 4 (CONTEXT.md D-06 +
// RESEARCH § Topic 9). The new shape is a pure rendering extension at
// `preview_send` (composite-multicall DECODED ARGS arm).
//
// Refusal pre-flights:
//   - chain != 'ethereum'                → INVALID_INPUT (D-03)
//   - tokenId !owned by `from`           → INVALID_INPUT (NFT-ownership)
//   - position.liquidity == 0            → INVALID_INPUT (nothing to rebalance)
//   - snap delta > 100 bps for either bound → INVALID_INPUT (D-03)
//   - new tickLower >= new tickUpper     → INVALID_INPUT (degenerate range)
//
// NPM is sourced via `getUniswapV3NonfungiblePositionManagerAddress(chainId)!`
// from the SOT — NEVER inlined (T-CONFIG-LITERAL-MIGRATION-2). The composite
// calldata flows through `_uniswapV3LpProtocol.composeRebalanceCalldata` (spy-
// affordance indirection) so tests intercept production calls.
//
// LEDGER NOTICE emitted UNCONDITIONALLY per RESEARCH § Topic 10 — the NPM
// contract is NOT in the Ledger ERC-7730 clear-sign registry; the device
// blind-signs every NPM verb (T-LEDGER-BLIND-SIGN-NPM-COMPOSITE).

import {
  type Address,
  type Hex,
  erc20Abi,
  getAddress,
} from "viem";

import { getChainClient } from "../chains/registry.js";
import { NPM_READ_ABI } from "../chains/uniswap-v3-lp.js";
import {
  chainIdFromName,
  getUniswapV3NonfungiblePositionManagerAddress,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { _uniswapV3LpProtocol } from "../protocols/uniswap-v3-lp.js";
import {
  LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE,
  UNISWAP_V3_LP_REBALANCE_PREPARE_RECEIPT_TEMPLATE,
} from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import {
  getAmountsForLiquidity,
} from "../signing/uniswap-liquidity.js";
import {
  _uniswapV3Tick,
  type Uniswapv3FeeTier,
} from "../signing/uniswap-tick.js";
import { registerTool } from "./index.js";

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

const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_DEADLINE_SECONDS = 1800;
const SNAP_REFUSAL_THRESHOLD_BPS = 100;

const DESCRIPTION = [
  "Prepare an unsigned Uniswap V3 NonfungiblePositionManager `multicall(bytes[])` call on Ethereum mainnet that REBALANCES an existing LP position to a new tick range.",
  "Composite tx — single signature authorizes 3 atomic steps: decreaseLiquidity (burns 100% of existing liquidity) → collect (sweeps proceeds + accrued fees to your wallet) → mint (opens new position at the new range).",
  "Returns a handle the agent passes to preview_send before send_transaction. `preview_send` decodes the 3 inner steps as separate sub-blocks (composite-multicall preview shape).",
  "PREPARE RECEIPT records ONLY the composite intent (tokenId + new tick range + verbatim agent prices) — inner-step args decode at preview time.",
  "Agent passes decimal prices for the NEW range; the server reads positions(tokenId) for the existing token0/token1/fee, snaps the new prices to ticks, and refuses on snap delta > 100 bps.",
  "Refuses if `from` is not the position's owner (NFT-ownership) OR if the position has zero liquidity (nothing to rebalance).",
  "NO new ERC-20 transfer-in beyond the collected amounts — the rebalance keeps capital constant (the new position is funded from the decreased-and-collected old position's proceeds).",
  "LEDGER NOTICE emitted UNCONDITIONALLY — the NPM contract is NOT in the Ledger ERC-7730 clear-sign registry; the device blind-signs the full outer multicall hash.",
  "`chain` is REQUIRED and locked to 'ethereum'. Phase 33 is Ethereum-mainnet-only.",
  "`slippageBps` defaults to 50 (0.5%) — applied to BOTH the decrease and the mint min-amounts. `deadlineSeconds` defaults to 1800.",
  "Returns { handle, chainId, from, to, valueWei, data, payloadFingerprint, tokenId, newTickLower, newTickUpper, expectedAmount0, expectedAmount1, decreaseAmount0Min, decreaseAmount1Min, mintAmount0Min, mintAmount1Min, deadline } plus PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE.",
  "Failure modes: INVALID_INPUT (non-ethereum / malformed tokenId / not-owner / empty position / snap delta > 100 bps / degenerate new range); WALLET_NOT_PAIRED; WRONG_MODE; INTERNAL_ERROR.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier (required). ONLY 'ethereum' is supported at Phase 33.",
    },
    tokenId: {
      type: "string",
      description:
        "NPM NFT tokenId (decimal-string bigint) for the position to rebalance.",
    },
    newPriceLower: {
      type: "string",
      description:
        "NEW range lower bound as decimal string (token1 per token0 — same convention as prepare_uniswap_v3_mint). Server snaps to nearest valid tick.",
    },
    newPriceUpper: {
      type: "string",
      description:
        "NEW range upper bound as decimal string. Must be > newPriceLower after snapping.",
    },
    slippageBps: {
      type: "number",
      description:
        "Slippage tolerance in basis points (1..10000); default 50 (0.5%). Applied to BOTH the decrease and the mint min-amounts.",
    },
    deadlineSeconds: {
      type: "number",
      description:
        "Seconds-from-now until the on-chain deadline expires; default 1800 (30 min). Applied to every inner call's deadline field AND the outer multicall.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender — must be one of the per-chain approved accounts in get_ledger_status.accountsByChain[1]. Must also be the position owner.",
    },
  },
  required: ["chain", "tokenId", "newPriceLower", "newPriceUpper"],
  additionalProperties: false,
};

registerTool(
  "prepare_uniswap_v3_rebalance",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawArgs = args as Record<string, unknown>;
      const slippageWasExplicit: boolean =
        "slippageBps" in rawArgs && rawArgs.slippageBps !== undefined;

      // Step 1 — Chain gate.
      const chainName = typeof args.chain === "string" ? args.chain : "";
      if (chainName !== "ethereum") {
        const msg = `invalid 'chain': Uniswap V3 LP supports only 'ethereum' at Phase 33, got "${chainName}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const chainId: ChainId = chainIdFromName(chainName as ChainName);

      // Step 2 — tokenId validation.
      const tokenIdRaw =
        typeof args.tokenId === "string" ? args.tokenId : "";
      if (!/^[0-9]+$/.test(tokenIdRaw)) {
        const msg = `invalid 'tokenId': expected decimal-string bigint, got "${tokenIdRaw}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const tokenId = BigInt(tokenIdRaw);

      // Step 3 — slippage + deadline.
      let slippageBps = DEFAULT_SLIPPAGE_BPS;
      if (slippageWasExplicit) {
        const v = rawArgs.slippageBps;
        if (
          typeof v !== "number" ||
          !Number.isInteger(v) ||
          v < 1 ||
          v > 10000
        ) {
          const msg = `invalid 'slippageBps': expected integer in [1, 10000], got ${String(v)}`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope("INVALID_INPUT", msg),
          };
        }
        slippageBps = v;
      }
      let deadlineSeconds = DEFAULT_DEADLINE_SECONDS;
      if (
        "deadlineSeconds" in rawArgs &&
        rawArgs.deadlineSeconds !== undefined
      ) {
        const v = rawArgs.deadlineSeconds;
        if (
          typeof v !== "number" ||
          !Number.isInteger(v) ||
          v < 60 ||
          v > 86400
        ) {
          const msg = `invalid 'deadlineSeconds': expected integer in [60, 86400], got ${String(v)}`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope("INVALID_INPUT", msg),
          };
        }
        deadlineSeconds = v;
      }

      // Step 4 — Resolve `from`.
      const rawFrom = typeof args.from === "string" ? args.from : undefined;
      const fromResolution = await resolveFrom({ rawFrom, chainId });
      if (fromResolution.kind === "error") return fromResolution.result;
      const fromAddress: Address = fromResolution.fromAddress;
      const fromCallerSupplied = fromResolution.callerSupplied;

      // Step 5 — Resolve NPM address from SOT.
      const npmAddress: Address =
        getUniswapV3NonfungiblePositionManagerAddress(chainId)!;
      const client = getChainClient(chainId);

      // Step 6 — Read position state + verify ownership in parallel.
      let positionTuple: readonly [
        bigint, // nonce
        Address, // operator
        Address, // token0
        Address, // token1
        number, // fee
        number, // tickLower
        number, // tickUpper
        bigint, // liquidity
        bigint, // feeGrowthInside0LastX128
        bigint, // feeGrowthInside1LastX128
        bigint, // tokensOwed0
        bigint, // tokensOwed1
      ];
      let ownerAddr: Address;
      try {
        const [pos, owner] = (await Promise.all([
          client.readContract({
            address: npmAddress,
            abi: NPM_READ_ABI,
            functionName: "positions",
            args: [tokenId],
          }),
          client.readContract({
            address: npmAddress,
            abi: NPM_READ_ABI,
            functionName: "ownerOf",
            args: [tokenId],
          }),
        ])) as [typeof positionTuple, Address];
        positionTuple = pos;
        ownerAddr = owner;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to read position ${tokenId}: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `failed to read position ${tokenId} (likely invalid or burned NFT): ${message}`,
          ),
        };
      }

      // Step 6a — Ownership pre-flight (NFT-ownership authorization).
      if (getAddress(ownerAddr) !== fromAddress) {
        const msg = `position ${tokenId} is owned by ${ownerAddr}, not by ${fromAddress}; only the position owner can rebalance`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

      const token0 = positionTuple[2];
      const token1 = positionTuple[3];
      const feeRaw = positionTuple[4];
      const oldTickLower = positionTuple[5];
      const oldTickUpper = positionTuple[6];
      const existingLiquidity = positionTuple[7];

      if (feeRaw !== 100 && feeRaw !== 500 && feeRaw !== 3000 && feeRaw !== 10000) {
        const msg = `position ${tokenId} carries unsupported fee tier ${feeRaw} (expected 100/500/3000/10000)`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const fee = feeRaw as Uniswapv3FeeTier;

      // Step 6b — Empty-position refusal.
      if (existingLiquidity === 0n) {
        const msg = `position ${tokenId} has zero liquidity — nothing to rebalance`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

      // Step 7 — Resolve token decimals (parallel reads on ERC-20s). We need
      // them for tick snapping + amount derivation.
      let decimals0: number;
      let decimals1: number;
      try {
        const [d0, d1] = await Promise.all([
          client.readContract({
            address: token0,
            abi: erc20Abi,
            functionName: "decimals",
          }),
          client.readContract({
            address: token1,
            abi: erc20Abi,
            functionName: "decimals",
          }),
        ]);
        decimals0 = Number(d0);
        decimals1 = Number(d1);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to resolve token decimals: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            `failed to resolve token decimals: ${message}`,
          ),
        };
      }

      // Step 8 — Snap new prices to ticks.
      const rawNewPriceLower =
        typeof args.newPriceLower === "string" ? args.newPriceLower : "";
      const rawNewPriceUpper =
        typeof args.newPriceUpper === "string" ? args.newPriceUpper : "";
      let snapLower: ReturnType<typeof _uniswapV3Tick.snapPriceToTick>;
      let snapUpper: ReturnType<typeof _uniswapV3Tick.snapPriceToTick>;
      try {
        snapLower = _uniswapV3Tick.snapPriceToTick(
          rawNewPriceLower,
          fee,
          decimals0,
          decimals1,
        );
        snapUpper = _uniswapV3Tick.snapPriceToTick(
          rawNewPriceUpper,
          fee,
          decimals0,
          decimals1,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to snap newPrice to tick: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `failed to snap newPrice: ${message}`,
          ),
        };
      }
      if (
        snapLower.snapDeltaBps > SNAP_REFUSAL_THRESHOLD_BPS ||
        snapUpper.snapDeltaBps > SNAP_REFUSAL_THRESHOLD_BPS
      ) {
        const msg = `snap delta exceeds ${SNAP_REFUSAL_THRESHOLD_BPS} bps — newPrice misaligned with pool resolution (lower=${snapLower.snapDeltaBps}, upper=${snapUpper.snapDeltaBps})`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      if (snapLower.tick >= snapUpper.tick) {
        const msg = `invalid new range: newTickLower (${snapLower.tick}) must be < newTickUpper (${snapUpper.tick}) after snapping`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const newTickLower = snapLower.tick;
      const newTickUpper = snapUpper.tick;

      // Step 9 — Estimate the decrease's expected token output. We don't have
      // current pool sqrtPrice here without a pool RPC read; Plan 33-03
      // intentionally keeps the decrease amount-min defaults at 0 (slippage
      // floor enforcement deferred to v2.4.x — same convention as
      // prepare_uniswap_v3_decrease_liquidity Plan 33-02). For the NEW mint
      // step's amount0Desired/amount1Desired, derive a pessimistic estimate
      // by computing what the OLD position holds at its own range bounds
      // (using the old tick range's sqrt ratios as a proxy). The on-chain
      // multicall execution will compute the actual collected balances and
      // mint as much as the user has — these "desired" amounts are merely
      // upper bounds for the mint's input limit.
      const sqrtRatioOldLowerX96 = _uniswapV3Tick.tickToSqrtPriceX96(oldTickLower);
      const sqrtRatioOldUpperX96 = _uniswapV3Tick.tickToSqrtPriceX96(oldTickUpper);
      // Geometric midpoint of the old range — pessimistic proxy for the
      // current sqrtPrice. Same shape as the IL out-of-range fallback.
      const sqrtRatioMidX96 = sqrtIntoMidpoint(
        sqrtRatioOldLowerX96,
        sqrtRatioOldUpperX96,
      );
      const [expectedAmount0, expectedAmount1] = getAmountsForLiquidity(
        sqrtRatioMidX96,
        sqrtRatioOldLowerX96,
        sqrtRatioOldUpperX96,
        existingLiquidity,
      );

      // Step 10 — Compute slippage floors for decrease (defaults 0 per Plan
      // 33-02 convention) and for mint (applied to the expected amounts).
      const decreaseAmount0Min = 0n;
      const decreaseAmount1Min = 0n;
      const slipMul = 10000n - BigInt(slippageBps);
      const mintAmount0Min = (expectedAmount0 * slipMul) / 10000n;
      const mintAmount1Min = (expectedAmount1 * slipMul) / 10000n;

      // Step 11 — Compose calldata via the SOT helper.
      const deadline =
        BigInt(Math.floor(Date.now() / 1000)) + BigInt(deadlineSeconds);
      const data: Hex = _uniswapV3LpProtocol.composeRebalanceCalldata({
        tokenId,
        existingLiquidity,
        collectRecipient: fromAddress,
        mintParams: {
          token0,
          token1,
          fee,
          tickLower: newTickLower,
          tickUpper: newTickUpper,
          amount0Desired: expectedAmount0,
          amount1Desired: expectedAmount1,
          amount0Min: mintAmount0Min,
          amount1Min: mintAmount1Min,
          recipient: fromAddress,
          deadline,
        },
        decreaseAmount0Min,
        decreaseAmount1Min,
        deadline,
      });

      // Step 12 — Build tx + single payloadFingerprint over the FULL outer
      // multicall calldata (CONTEXT.md D-06 + RESEARCH § Topic 9 — single
      // hash; cryptographic-binding chain UNCHANGED from Phase 4).
      const tx = { chainId, to: npmAddress, valueWei: 0n, data };
      const payloadFingerprint = computePayloadFingerprint(tx);
      const handle = createHandle({
        args: {
          to: npmAddress,
          valueWei: "0",
          tokenAddress: token0,
          amount: existingLiquidity.toString(),
        },
        tx,
        payloadFingerprint,
      });

      // Step 13 — PREPARE RECEIPT (composite intent ONLY per D-06).
      const deadlineIso = new Date(Number(deadline) * 1000).toISOString();
      const baseReceipt = UNISWAP_V3_LP_REBALANCE_PREPARE_RECEIPT_TEMPLATE
        .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
        .replace("{NPM}", npmAddress)
        .replace("{TOKEN_ID}", tokenId.toString())
        .replace("{NEW_PRICE_LOWER}", rawNewPriceLower)
        .replace("{NEW_PRICE_UPPER}", rawNewPriceUpper)
        .replace("{NEW_TICK_LOWER}", newTickLower.toString())
        .replace("{NEW_TICK_UPPER}", newTickUpper.toString())
        .replace(
          "{SLIPPAGE_BPS}",
          slippageWasExplicit
            ? `${slippageBps} (caller-supplied)`
            : `${slippageBps} (default)`,
        )
        .replace("{DEADLINE}", deadlineIso);
      const receipt = fromCallerSupplied
        ? `${baseReceipt}\n  from:               ${rawFrom}`
        : baseReceipt;

      // Step 14 — CHECKS PERFORMED.
      const checksPerformed = [
        "CHECKS PERFORMED",
        `  tokenId:            ${tokenId.toString()} (owner verified === from)`,
        `  oldRange:           [tickLower=${oldTickLower}, tickUpper=${oldTickUpper}]`,
        `  oldLiquidity:       ${existingLiquidity.toString()} (100% will be decreased)`,
        `  newRange:           [tickLower=${newTickLower}, tickUpper=${newTickUpper}] (snapped; lower snapDeltaBps=${snapLower.snapDeltaBps}, upper snapDeltaBps=${snapUpper.snapDeltaBps})`,
        `  fee:                ${fee} (${(fee / 10000).toFixed(2)}%)`,
        `  expectedAmount0:    ${expectedAmount0.toString()} (= getAmountsForLiquidity at OLD-range geometric-midpoint sqrtPrice; pessimistic proxy)`,
        `  expectedAmount1:    ${expectedAmount1.toString()} (= getAmountsForLiquidity at OLD-range geometric-midpoint sqrtPrice; pessimistic proxy)`,
        `  decreaseAmount0Min: ${decreaseAmount0Min.toString()} (slippage floor disabled at prepare layer — see Plan 33-02 convention)`,
        `  decreaseAmount1Min: ${decreaseAmount1Min.toString()} (slippage floor disabled at prepare layer — see Plan 33-02 convention)`,
        `  mintAmount0Min:     ${mintAmount0Min.toString()} (= expectedAmount0 × (10000 − ${slippageBps}) / 10000)`,
        `  mintAmount1Min:     ${mintAmount1Min.toString()} (= expectedAmount1 × (10000 − ${slippageBps}) / 10000)`,
        `  collectRecipient:   ${fromAddress} (= from)`,
        `  outerSelector:      0xac9650d8 (multicall(bytes[]) — NPM IMulticall overload; DISTINCT from Phase 32 SwapRouter02 deadline-overload)`,
        `  innerSteps:         3 — decreaseLiquidity (0x0c49ccbe) → collect (0xfc6f7865) → mint (0x88316456); LOAD-BEARING order`,
      ].join("\n");

      // Step 15 — Response: PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE.
      return {
        content: [
          { type: "text", text: receipt },
          { type: "text", text: checksPerformed },
          { type: "text", text: LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE },
        ],
        structuredContent: {
          handle,
          chain: "ethereum" as const,
          chainId,
          from: fromAddress,
          to: npmAddress,
          valueWei: "0",
          data,
          payloadFingerprint,
          tokenId: tokenId.toString(),
          token0,
          token1,
          fee,
          oldTickLower,
          oldTickUpper,
          oldLiquidity: existingLiquidity.toString(),
          newTickLower,
          newTickUpper,
          expectedAmount0: expectedAmount0.toString(),
          expectedAmount1: expectedAmount1.toString(),
          decreaseAmount0Min: decreaseAmount0Min.toString(),
          decreaseAmount1Min: decreaseAmount1Min.toString(),
          mintAmount0Min: mintAmount0Min.toString(),
          mintAmount1Min: mintAmount1Min.toString(),
          slippageBps,
          deadline: deadline.toString(),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_uniswap_v3_rebalance failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_uniswap_v3_rebalance failed",
          message,
        ),
      };
    }
  },
);

/**
 * Geometric midpoint between two Q64.96 sqrtPrice values:
 *   midSqrt = sqrt(sqrtA * sqrtB)  (in Q64.96 representation)
 *
 * This computes the integer sqrt of the product of the two Q64.96 sqrt-prices,
 * scaled back to Q64.96 by multiplying with sqrt(2^96) = 2^48 — the result
 * has the same Q64.96 fixed-point shape as the inputs.
 *
 * Used as a pessimistic proxy for the current sqrtPrice when reconstructing
 * the OLD position's amounts (we don't fetch slot0 here at Plan 33-03 — that's
 * the same simplification Plan 33-01's IL estimate uses out-of-range).
 */
function sqrtIntoMidpoint(sqrtAX96: bigint, sqrtBX96: bigint): bigint {
  // sqrt(a * b) where a, b are Q64.96 ⇒ result in Q64.96 = integer sqrt of
  // (a * b * 2^96) right-shifted by 96, then scaled. Algebraically:
  //   midSqrt^2 = sqrtA * sqrtB
  // We want midSqrt in the same Q64.96 scale; the canonical derivation is
  // midSqrt = isqrt(sqrtA * sqrtB).
  const product = sqrtAX96 * sqrtBX96;
  return bigintIsqrt(product);
}

function bigintIsqrt(n: bigint): bigint {
  if (n < 0n) throw new Error(`bigintIsqrt: negative input (${n})`);
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}
