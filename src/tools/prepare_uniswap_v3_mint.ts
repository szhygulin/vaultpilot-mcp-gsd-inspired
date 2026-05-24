// MCP tool: prepare_uniswap_v3_mint({
//   chain, token0, token1, fee, priceLower, priceUpper,
//   amount0, amount1, slippageBps?, deadlineSeconds?, from?
// })
//
// Phase 33 — Plan 33-02 (UNI-05). Mechanical clone of prepare_aave_supply.ts
// shape (Phase 7 canonical prepare template) with three Phase 33-specific
// extensions:
//
//   (a) Tick snap — agent passes human-decimal `priceLower`/`priceUpper`;
//       server resolves token decimals + calls `snapPriceToTick` per fee tier.
//       Refuses when snapDeltaBps > 100 per CONTEXT.md D-03.
//
//   (b) Approval pre-flight on BOTH token0 AND token1 — NPM is a spender
//       (per RESEARCH § Topic 8: mint performs internal `TransferHelper.
//       safeTransferFrom` on BOTH ERC-20 sides). Insufficient → INVALID_INPUT
//       + hintTool: prepare_token_approve with the under-approved token named.
//
//   (c) LEDGER NOTICE emitted UNCONDITIONALLY — NPM is NOT in the Ledger
//       ERC-7730 clear-sign registry (RESEARCH § Topic 10). Every mint
//       blind-signs at the device.
//
// `tx.to = getUniswapV3NonfungiblePositionManagerAddress(chainId)!` — SOT-
// delegated; T-CONFIG-LITERAL-MIGRATION-2 mitigation; grep-zero asserted.
// `valueWei = 0n` — Phase 33 LP surface refuses ETH-in (CONTEXT.md deferred-
// ideas; user pre-wraps via prepare_weth_wrap).
//
// Calldata flows through `_uniswapV3LpProtocol.encodeMint(...)` (spy-affordance
// indirection from Plan 33-02 Task 1) so tests intercept production calls
// without monkey-patching named exports.
//
// Token sort discipline: Uniswap V3 requires `token0 < token1` (byte-order).
// When the agent supplies them reversed, the tool flips the addresses + the
// prices accordingly and surfaces a CHECKS PERFORMED note documenting the
// swap.

import {
  type Address,
  type Hex,
  erc20Abi,
  getAddress,
  isAddress,
} from "viem";

import { getChainClient } from "../chains/registry.js";
import {
  chainIdFromName,
  getUniswapV3NonfungiblePositionManagerAddress,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { _uniswapV3LpProtocol } from "../protocols/uniswap-v3-lp.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import {
  LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE,
  UNISWAP_V3_LP_MINT_PREPARE_RECEIPT_TEMPLATE,
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
const DEFAULT_DEADLINE_SECONDS = 1800; // 30 min
const SNAP_REFUSAL_THRESHOLD_BPS = 100;
const VALID_FEES: ReadonlySet<number> = new Set([100, 500, 3000, 10000]);

const DESCRIPTION = [
  "Prepare an unsigned Uniswap V3 NonfungiblePositionManager `mint` call on Ethereum mainnet — opens a new concentrated-liquidity position over a price range.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Agent passes decimal prices and decimals; the server snaps to the nearest valid tick per fee tier and refuses if the snap delta exceeds 100 bps.",
  "Approval pre-flight (RESEARCH Topic 8): server reads BOTH token0 AND token1 allowance against NPM. Insufficient → INVALID_INPUT + hintTool: 'prepare_token_approve' naming the under-approved token + NPM as the spender.",
  "LEDGER NOTICE emitted UNCONDITIONALLY — the NPM contract is NOT in the Ledger ERC-7730 clear-sign registry; every operation blind-signs at the device.",
  "Token sort: Uniswap V3 requires token0 < token1 (byte-order). If the agent submits them reversed, the tool flips internally + flips the prices accordingly and notes the swap in CHECKS PERFORMED.",
  "`chain` is REQUIRED and locked to 'ethereum'. Phase 33 ships Ethereum-only; multi-chain LP deferred to v2.4.x.",
  "`fee` is one of 100 (0.01%) / 500 (0.05%) / 3000 (0.30%) / 10000 (1.00%) — the 4 canonical Ethereum tiers.",
  "`amount0`/`amount1` are DECIMAL STRINGS in human units (the server resolves decimals via ERC20.decimals readContract).",
  "`priceLower`/`priceUpper` are DECIMAL STRINGS expressing token1-per-token0 in the canonical sort order.",
  "`slippageBps` defaults to 50 (0.5%); bounds 1..10000. `deadlineSeconds` defaults to 1800 (30 min from prepare time).",
  "Does NOT accept ETH-in — Phase 33 LP surface refuses native ETH; user pre-wraps via prepare_weth_wrap.",
  "Returns { handle, chainId, from, to, valueWei, data, payloadFingerprint, tickLower, tickUpper, amount0Min, amount1Min, deadline } plus PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE text blocks.",
  "Failure modes: INVALID_INPUT (non-ethereum chain / malformed addresses / unsupported fee tier / amount parse error / snap delta > 100 bps / token-approval insufficient / same-token); WALLET_NOT_PAIRED; WRONG_MODE; INTERNAL_ERROR.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier (required). ONLY 'ethereum' is supported — Phase 33 is Ethereum-mainnet-only.",
    },
    token0: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "First ERC-20 token (EIP-55 0x-prefixed 20-byte hex). The tool flips if needed to maintain Uniswap V3 sort invariant (token0 < token1).",
    },
    token1: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Second ERC-20 token (EIP-55). See token0.",
    },
    fee: {
      type: "number",
      enum: [100, 500, 3000, 10000],
      description: "Fee tier (uint24): 100 / 500 / 3000 / 10000.",
    },
    priceLower: {
      type: "string",
      description:
        "Range lower bound as decimal string (token1 per token0). Server snaps to nearest valid tick for the fee tier.",
    },
    priceUpper: {
      type: "string",
      description:
        "Range upper bound as decimal string (token1 per token0). Must be > priceLower.",
    },
    amount0: {
      type: "string",
      description:
        "Desired token0 amount as decimal string (e.g. '100.5'). Server resolves decimals via ERC20.decimals.",
    },
    amount1: {
      type: "string",
      description: "Desired token1 amount as decimal string.",
    },
    slippageBps: {
      type: "number",
      description:
        "Slippage tolerance in basis points (1..10000); default 50 (0.5%).",
    },
    deadlineSeconds: {
      type: "number",
      description:
        "Seconds-from-now until the on-chain deadline expires; default 1800 (30 min).",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts in get_ledger_status.accountsByChain[1].",
    },
  },
  required: [
    "chain",
    "token0",
    "token1",
    "fee",
    "priceLower",
    "priceUpper",
    "amount0",
    "amount1",
  ],
  additionalProperties: false,
};

registerTool(
  "prepare_uniswap_v3_mint",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawArgs = args as Record<string, unknown>;
      const slippageWasExplicit: boolean =
        "slippageBps" in rawArgs && rawArgs.slippageBps !== undefined;

      // Step 1 — Chain gate (defense-in-depth; schema enum upstream).
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

      // Step 2 — Token address validation + sort.
      const tokenARaw = typeof args.token0 === "string" ? args.token0 : "";
      const tokenBRaw = typeof args.token1 === "string" ? args.token1 : "";
      if (!isAddress(tokenARaw)) {
        const msg = `invalid 'token0': expected EIP-55 address, got "${tokenARaw}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      if (!isAddress(tokenBRaw)) {
        const msg = `invalid 'token1': expected EIP-55 address, got "${tokenBRaw}"`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const tokenAAddr = getAddress(tokenARaw);
      const tokenBAddr = getAddress(tokenBRaw);
      if (tokenAAddr === tokenBAddr) {
        const msg = `invalid 'token0'/'token1': must be distinct addresses`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

      // Canonical Uniswap V3 sort (byte-lex on lowercase hex).
      const aLower = tokenAAddr.toLowerCase();
      const bLower = tokenBAddr.toLowerCase();
      const reversed = aLower > bLower;
      const token0: Address = reversed ? tokenBAddr : tokenAAddr;
      const token1: Address = reversed ? tokenAAddr : tokenBAddr;

      // Step 3 — Fee tier validation (defense-in-depth; schema enum upstream).
      const feeRaw = typeof args.fee === "number" ? args.fee : -1;
      if (!VALID_FEES.has(feeRaw)) {
        const msg = `invalid 'fee': expected one of 100/500/3000/10000, got ${feeRaw}`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const fee = feeRaw as Uniswapv3FeeTier;

      // Step 4 — slippageBps + deadlineSeconds (with bounds).
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
        if (typeof v !== "number" || !Number.isInteger(v) || v < 60 || v > 86400) {
          const msg = `invalid 'deadlineSeconds': expected integer in [60, 86400], got ${String(v)}`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope("INVALID_INPUT", msg),
          };
        }
        deadlineSeconds = v;
      }

      // Step 5 — Resolve `from` (shared helper).
      const rawFrom = typeof args.from === "string" ? args.from : undefined;
      const fromResolution = await resolveFrom({ rawFrom, chainId });
      if (fromResolution.kind === "error") return fromResolution.result;
      const fromAddress: Address = fromResolution.fromAddress;
      const fromCallerSupplied = fromResolution.callerSupplied;

      // Step 6 — Read decimals for both tokens (parallel).
      const client = getChainClient(chainId);
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

      // Step 7 — Resolve prices (flip if tokens reversed) + amounts.
      const rawPriceLower =
        typeof args.priceLower === "string" ? args.priceLower : "";
      const rawPriceUpper =
        typeof args.priceUpper === "string" ? args.priceUpper : "";
      const rawAmount0 = typeof args.amount0 === "string" ? args.amount0 : "";
      const rawAmount1 = typeof args.amount1 === "string" ? args.amount1 : "";

      // If we flipped tokens, the agent's `priceLower`/`priceUpper` were
      // expressed in the agent's submitted order (token1_agent/token0_agent).
      // After flip the canonical token0/token1 are reversed, so the canonical
      // prices = 1 / agent prices (inverted), AND the range bounds swap order
      // (the smaller post-flip becomes lower, the larger becomes upper).
      // The same applies to amount0/amount1 — what the agent called amount0
      // is now amount1 and vice versa.
      let effectivePriceLower: string;
      let effectivePriceUpper: string;
      let amount0Desired: bigint;
      let amount1Desired: bigint;
      try {
        if (reversed) {
          // Invert price (1/p) and swap order so lower < upper post-inversion.
          // 1/p_upper_agent becomes the new lower bound; 1/p_lower_agent the new upper.
          effectivePriceLower = invertDecimalPrice(rawPriceUpper);
          effectivePriceUpper = invertDecimalPrice(rawPriceLower);
          amount0Desired = parseAmountStrict(rawAmount1, decimals0);
          amount1Desired = parseAmountStrict(rawAmount0, decimals1);
        } else {
          effectivePriceLower = rawPriceLower;
          effectivePriceUpper = rawPriceUpper;
          amount0Desired = parseAmountStrict(rawAmount0, decimals0);
          amount1Desired = parseAmountStrict(rawAmount1, decimals1);
        }
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
            {
              type: "text",
              text: `error: invalid 'amount0'/'amount1' or 'priceLower'/'priceUpper': ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid amount/price: ${message}`,
          ),
        };
      }

      if (amount0Desired <= 0n || amount1Desired <= 0n) {
        const msg = `invalid 'amount0'/'amount1': both must be > 0`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

      // Step 8 — Snap prices to ticks.
      let snapLower: ReturnType<typeof _uniswapV3Tick.snapPriceToTick>;
      let snapUpper: ReturnType<typeof _uniswapV3Tick.snapPriceToTick>;
      try {
        snapLower = _uniswapV3Tick.snapPriceToTick(
          effectivePriceLower,
          fee,
          decimals0,
          decimals1,
        );
        snapUpper = _uniswapV3Tick.snapPriceToTick(
          effectivePriceUpper,
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
              text: `error: failed to snap price to tick: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `failed to snap price: ${message}`,
          ),
        };
      }
      if (
        snapLower.snapDeltaBps > SNAP_REFUSAL_THRESHOLD_BPS ||
        snapUpper.snapDeltaBps > SNAP_REFUSAL_THRESHOLD_BPS
      ) {
        const msg = `snap delta exceeds ${SNAP_REFUSAL_THRESHOLD_BPS} bps — price misaligned with pool resolution (lower=${snapLower.snapDeltaBps}, upper=${snapUpper.snapDeltaBps})`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      if (snapLower.tick >= snapUpper.tick) {
        const msg = `invalid range: tickLower (${snapLower.tick}) must be < tickUpper (${snapUpper.tick}) after snapping`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }
      const tickLower = snapLower.tick;
      const tickUpper = snapUpper.tick;

      // Step 9 — Compute slippage floors.
      const slipMul = 10000n - BigInt(slippageBps);
      const amount0Min = (amount0Desired * slipMul) / 10000n;
      const amount1Min = (amount1Desired * slipMul) / 10000n;

      // Step 10 — Resolve NPM address from SOT + approval pre-flight (BOTH tokens).
      const npmAddress: Address =
        getUniswapV3NonfungiblePositionManagerAddress(chainId)!;
      let allow0: bigint;
      let allow1: bigint;
      try {
        [allow0, allow1] = (await Promise.all([
          client.readContract({
            address: token0,
            abi: erc20Abi,
            functionName: "allowance",
            args: [fromAddress, npmAddress],
          }),
          client.readContract({
            address: token1,
            abi: erc20Abi,
            functionName: "allowance",
            args: [fromAddress, npmAddress],
          }),
        ])) as [bigint, bigint];
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to read token allowance: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            `failed to read token allowance: ${message}`,
          ),
        };
      }
      if (allow0 < amount0Desired) {
        const msg = `insufficient token0 allowance for Uniswap V3 NPM: approved ${allow0.toString()}, need ${amount0Desired.toString()}. Call prepare_token_approve with NPM (${npmAddress}) as spender.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: {
            ...errEnvelope("INVALID_INPUT", msg),
            hintTool: "prepare_token_approve",
            hintArgs: {
              chain: "ethereum",
              tokenAddress: token0,
              spender: npmAddress,
              amount: reversed ? rawAmount1 : rawAmount0,
            },
          },
        };
      }
      if (allow1 < amount1Desired) {
        const msg = `insufficient token1 allowance for Uniswap V3 NPM: approved ${allow1.toString()}, need ${amount1Desired.toString()}. Call prepare_token_approve with NPM (${npmAddress}) as spender.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: {
            ...errEnvelope("INVALID_INPUT", msg),
            hintTool: "prepare_token_approve",
            hintArgs: {
              chain: "ethereum",
              tokenAddress: token1,
              spender: npmAddress,
              amount: reversed ? rawAmount0 : rawAmount1,
            },
          },
        };
      }

      // Step 11 — Compute deadline + calldata.
      const deadline =
        BigInt(Math.floor(Date.now() / 1000)) + BigInt(deadlineSeconds);
      const data: Hex = _uniswapV3LpProtocol.encodeMint({
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        amount0Desired,
        amount1Desired,
        amount0Min,
        amount1Min,
        recipient: fromAddress,
        deadline,
      });

      // Step 12 — Build tx + payloadFingerprint + handle.
      const tx = { chainId, to: npmAddress, valueWei: 0n, data };
      const payloadFingerprint = computePayloadFingerprint(tx);
      const handle = createHandle({
        args: {
          to: npmAddress,
          valueWei: "0",
          tokenAddress: token0,
          amount: reversed ? rawAmount1 : rawAmount0,
        },
        tx,
        payloadFingerprint,
      });

      // Step 13 — PREPARE RECEIPT.
      const deadlineIso = new Date(Number(deadline) * 1000).toISOString();
      const baseReceipt = UNISWAP_V3_LP_MINT_PREPARE_RECEIPT_TEMPLATE
        .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
        .replace("{NPM}", npmAddress)
        .replace("{TOKEN0}", token0)
        .replace("{TOKEN1}", token1)
        .replace("{FEE}", `${fee} (${(fee / 10000).toFixed(2)}%)`)
        .replace("{PRICE_LOWER}", reversed ? rawPriceUpper : rawPriceLower)
        .replace("{PRICE_UPPER}", reversed ? rawPriceLower : rawPriceUpper)
        .replace("{TICK_LOWER}", tickLower.toString())
        .replace("{TICK_UPPER}", tickUpper.toString())
        .replace(
          "{AMOUNT0_DESIRED}",
          `${amount0Desired.toString()} (= ${reversed ? rawAmount1 : rawAmount0}, decimals=${decimals0})`,
        )
        .replace(
          "{AMOUNT1_DESIRED}",
          `${amount1Desired.toString()} (= ${reversed ? rawAmount0 : rawAmount1}, decimals=${decimals1})`,
        )
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
      const checksLines = [
        "CHECKS PERFORMED",
        `  tickLower:          ${tickLower} (snapped from agent priceLower; snapDeltaBps=${snapLower.snapDeltaBps})`,
        `  tickUpper:          ${tickUpper} (snapped from agent priceUpper; snapDeltaBps=${snapUpper.snapDeltaBps})`,
        `  amount0Min:         ${amount0Min.toString()} (= amount0Desired × (10000 − ${slippageBps}) / 10000)`,
        `  amount1Min:         ${amount1Min.toString()} (= amount1Desired × (10000 − ${slippageBps}) / 10000)`,
        `  token0Allowance:    ${allow0.toString()} (≥ amount0Desired ${amount0Desired.toString()})`,
        `  token1Allowance:    ${allow1.toString()} (≥ amount1Desired ${amount1Desired.toString()})`,
      ];
      if (reversed) {
        checksLines.push(
          `  tokenSortFlip:      agent submitted token0/token1 in reversed byte-order; the tool flipped to canonical sort (token0=${token0}, token1=${token1}) and inverted prices accordingly`,
        );
      }
      const checksPerformed = checksLines.join("\n");

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
          token0,
          token1,
          fee,
          tickLower,
          tickUpper,
          amount0Desired: amount0Desired.toString(),
          amount1Desired: amount1Desired.toString(),
          amount0Min: amount0Min.toString(),
          amount1Min: amount1Min.toString(),
          slippageBps,
          deadline: deadline.toString(),
          tokenSortFlipped: reversed,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_uniswap_v3_mint failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_uniswap_v3_mint failed",
          message,
        ),
      };
    }
  },
);

/**
 * Compute 1/p for a decimal-string price using 36-decimal scaled bigint
 * division. Used when the agent submitted tokens in reversed sort order — the
 * canonical price (token1_canonical / token0_canonical) is the inverse of
 * what the agent supplied.
 *
 * Throws on non-positive or malformed input.
 */
function invertDecimalPrice(price: string): string {
  const SCALE = 36;
  const [intPart, fracPart = ""] = price.split(".");
  if (
    intPart === undefined ||
    intPart === null ||
    /[^0-9]/.test(intPart) ||
    /[^0-9]/.test(fracPart)
  ) {
    throw new InvalidAmountError(
      `malformed price for inversion: ${price}`,
      "format",
    );
  }
  const fracPadded = (fracPart + "0".repeat(SCALE)).slice(0, SCALE);
  const scaled = BigInt(intPart + fracPadded);
  if (scaled === 0n) {
    throw new InvalidAmountError(`price must be > 0 for inversion`, "format");
  }
  // inv = 10^(2*SCALE) / scaled  →  represents 10^SCALE × (1/p_real).
  // Then format as decimal string with up to SCALE digits.
  const invScaled = 10n ** BigInt(2 * SCALE) / scaled;
  const base = 10n ** BigInt(SCALE);
  const intOut = invScaled / base;
  const fracOut = invScaled % base;
  if (fracOut === 0n) return intOut.toString();
  const fracStr = fracOut.toString().padStart(SCALE, "0").replace(/0+$/, "");
  return `${intOut.toString()}.${fracStr}`;
}
