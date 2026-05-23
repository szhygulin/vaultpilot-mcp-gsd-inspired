// MCP tool: prepare_uniswap_swap({ chain, tokenIn, tokenOut, amount, slippageBps?, from? })
//
// Phase 32 — Plan 32-03 (UNI-02 + UNI-03). Produces an unsigned SwapRouter02
// transaction wrapped in `multicall(uint256 deadline, bytes[] data)` per D-10
// (defense-in-depth against pending-tx replay). Closes the v2.4 swap surface.
//
// Structural analogs (cloned with bounded deviations):
//   - prepare_sunswap_swap.ts (Phase 20):    sandwich-MEV gate flow + pre-Zod
//                                            `slippageWasExplicit` detection
//   - prepare_lido_wrap.ts    (Phase 30):    token-approval pre-flight
//   - prepare_eigenlayer_deposit.ts (Phase 31): 3-block response shape
//
// Calldata composition — 4 distinct paths per D-05:
//   (a) Single-hop non-ETH:  multicall(deadline, [exactInputSingle(...)])
//                            tx.value = 0n
//   (b) Multi-hop non-ETH:   multicall(deadline, [exactInput(packed-path, ...)])
//                            tx.value = 0n
//   (c) ETH-in:              multicall(deadline, [exactInputSingle(tokenIn=WETH, ...)])
//                            tx.value = amountIn (router wraps via WETH9.deposit)
//   (d) ETH-out:             composeMulticallWithUnwrap({
//                              deadline,
//                              exactInputSingleParamsWithRouterRecipient: {
//                                ..., recipient = SwapRouter02 (Pitfall 3 / D-15)
//                              },
//                              finalAmountOutMin, finalRecipient = user
//                            })  → multicall(deadline, [exactInputSingle, unwrapWETH9])
//                            tx.value = 0n
//
// D-08 sandwich-MEV gate: when priceImpactBps > 200 AND slippageBps not
// explicitly supplied (raw-input detection, NOT Zod-defaulted), refuses with
// INVALID_INPUT + SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE block + hintTool
// "get_uniswap_quote". The quote is RE-FETCHED at prepare time (NOT cached
// from agent's prior get_uniswap_quote call) — drift detection per anti-
// pattern 7: NEVER re-fetch quote inside send_transaction; only at prepare.
//
// D-07 token-approval pre-flight: for non-ETH tokenIn, server reads
// ERC20.allowance(from, SwapRouter02); insufficient allowance refuses with
// INVALID_INPUT + hintTool "prepare_token_approve" + hintArgs covering the
// canonical spender.
//
// D-11 LEDGER NOTICE: emitted UNCONDITIONALLY for every swap (multicall outer
// selector 0x5ae401dc is NOT in the Ledger ERC-7730 clear-sign registry —
// every Phase 32 swap blind-signs at the device).
//
// D-12 payloadFingerprint covers the FULL multicall calldata (outer wrapper).
// Re-checked at send_transaction time per FROZEN Phase 4 trust pipeline.
//
// Fixture UNI-A/B/C cross-link: test/prepare-uniswap-swap.test.ts re-anchors
// fingerprint byte-identity against the Plan 32-01 hardcoded literals.

import {
  type Address,
  type Hex,
  erc20Abi,
  formatUnits,
  getAddress,
  isAddress,
} from "viem";

import { getChainClient } from "../chains/registry.js";
import {
  _uniswapV3Chain,
  type MultiHopQuoteResult,
  type SingleHopQuoteResult,
} from "../chains/uniswap-v3.js";
import { getUniswapV3SwapRouter02Address } from "../config/contracts.js";
import {
  _uniswapV3Protocol,
} from "../protocols/uniswap-v3.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import {
  LEDGER_NOTICE_UNISWAP_V3_TEMPLATE,
  SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE,
  UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE,
} from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import { _uniswapV3Path } from "../signing/uniswap-path.js";
import { _uniswapV3PriceImpact } from "../signing/uniswap-price-impact.js";
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

// ---------------------------------------------------------------------------
// Ethereum-only canonical token references — Phase 32 is Ethereum-mainnet-only
// per D-03. WETH address is the ETH sentinel resolution target.
// ---------------------------------------------------------------------------

const WETH_ETHEREUM: Address = getAddress(
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
);

const DEFAULT_SLIPPAGE_BPS = 50;
const SANDWICH_MEV_THRESHOLD_BPS = 200;
const DEADLINE_BUFFER_SECS = 600n; // 10 minutes — D-10

// ---------------------------------------------------------------------------
// Tool description + schema
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  "Prepare an unsigned Uniswap V3 SwapRouter02 transaction on Ethereum mainnet.",
  "Calldata is the multicall(uint256 deadline, bytes[] data) outer wrapper (D-10 defense-in-depth against pending-tx replay).",
  "Use when the user wants to swap ERC-20 tokens or native ETH via Uniswap V3 after reviewing a get_uniswap_quote.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Auto-selects the best fee tier (single-hop 0.01% / 0.05% / 0.30% / 1.00% or multi-hop via WETH/USDC anchor) by RE-FETCHING the quote at prepare time (drift detection — NOT cached from agent's prior quote call).",
  "Native ETH supported via tokenIn or tokenOut = 'ETH' sentinel; server resolves to WETH internally. ETH-in: tx.value carries the ETH; the router wraps via WETH9.deposit internally. ETH-out: composeMulticallWithUnwrap helper — inner exactInputSingle.recipient = SwapRouter02 (router holds WETH between sub-calls); unwrapWETH9 sends native ETH to user atomically.",
  "Sandwich-MEV defense (D-08): when priceImpactBps > 200 (2%) AND slippageBps NOT explicitly supplied, refuses with INVALID_INPUT + hintTool: 'get_uniswap_quote'. Pass slippageBps explicitly to acknowledge high impact.",
  "Token-approval pre-flight (D-07): for non-ETH tokenIn, server reads ERC20.allowance(from, SwapRouter02). Insufficient allowance refuses with INVALID_INPUT + hintTool: 'prepare_token_approve' + hintArgs naming SwapRouter02 as spender.",
  "LEDGER NOTICE (D-11): emitted UNCONDITIONALLY — the outer multicall selector 0x5ae401dc is NOT in the Ledger ERC-7730 clear-sign plugin registry. Every Phase 32 swap blind-signs at the device. Compare the predicted hash against the device display character-for-character after send_transaction fires.",
  "`chain` is REQUIRED and locked to 'ethereum'. `tokenIn`/`tokenOut` are EIP-55 addresses or 'ETH' sentinel. `amount` is a DECIMAL STRING in tokenIn units (server resolves decimals via ERC20.decimals readContract).",
  "`slippageBps` is OPTIONAL (default 50 = 0.5%, bounds 1..10000). When omitted AND priceImpactBps > 200, the sandwich-MEV gate fires.",
  "Returns { handle, chainId, from, to, valueWei, data, payloadFingerprint, route, priceImpactBps, slippageBps, quotedAmountOut, amountOutMinimum, deadline } plus PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE text blocks.",
  "Failure modes: INVALID_INPUT (sandwich-MEV refusal / insufficient allowance / same-token / malformed amount / out-of-bounds slippageBps / no Uniswap V3 liquidity); WALLET_NOT_PAIRED (no live session); WRONG_MODE (demo mode mismatch); INTERNAL_ERROR (RPC failure).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum"],
      description:
        "Chain identifier (required). ONLY 'ethereum' is supported — Phase 32 is Ethereum-mainnet-only per D-03.",
    },
    tokenIn: {
      type: "string",
      description:
        "Input token contract address (EIP-55 0x-prefixed 20-byte hex) OR the sentinel 'ETH' for native ETH. ETH resolves to WETH internally for calldata; tx.value carries the ETH and the router wraps via WETH9.deposit.",
    },
    tokenOut: {
      type: "string",
      description:
        "Output token contract address (EIP-55) OR 'ETH' sentinel. ETH-out path uses composeMulticallWithUnwrap (inner exactInputSingle.recipient = SwapRouter02; unwrapWETH9 sends native ETH to user atomically).",
    },
    amount: {
      type: "string",
      description:
        "Amount of tokenIn in DECIMAL STRING form (e.g. '100' for 100 USDC). Server resolves decimals via ERC20.decimals (or 18 for ETH/WETH).",
    },
    slippageBps: {
      type: "number",
      description:
        "Slippage tolerance in basis points (integer, 1..10000). Default: 50 (0.5%). When omitted AND priceImpactBps > 200, the sandwich-MEV gate refuses. Supply explicitly to acknowledge high impact.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender address — must be one of the per-chain approved accounts in get_ledger_status.accountsByChain[1]. Omit to use the active account. In demo mode, must match the active persona's address.",
    },
  },
  required: ["chain", "tokenIn", "tokenOut", "amount"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

registerTool("prepare_uniswap_swap", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // -----------------------------------------------------------------------
    // Step 1 — Pre-Zod slippageWasExplicit detection (LOAD-BEARING per D-08).
    // MUST happen BEFORE default resolution. Zod's `.default(50)` would mask
    // the agent-supplied vs default distinction. Check raw input for key
    // presence + non-undefined value. Cloned verbatim from Phase 20 SunSwap
    // (prepare_sunswap_swap.ts lines 143-152).
    // -----------------------------------------------------------------------
    const rawArgs = args as Record<string, unknown>;
    const slippageWasExplicit: boolean =
      "slippageBps" in rawArgs && rawArgs.slippageBps !== undefined;

    // Step 2 — Chain gate (cheap; defense-in-depth — schema enum gates upstream).
    const chainName = typeof args.chain === "string" ? args.chain : "";
    if (chainName !== "ethereum") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'chain': Uniswap V3 swap supports only 'ethereum' at Phase 32, got "${chainName}"`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'chain': Uniswap V3 swap supports only 'ethereum' at Phase 32, got "${chainName}"`,
        ),
      };
    }
    const chainId = 1;

    // Step 3 — Token sentinel handling + EIP-55 validation.
    const tokenInRaw =
      typeof args.tokenIn === "string" ? args.tokenIn : "";
    const tokenOutRaw =
      typeof args.tokenOut === "string" ? args.tokenOut : "";

    const tokenInIsEth = tokenInRaw === "ETH";
    const tokenOutIsEth = tokenOutRaw === "ETH";

    if (!tokenInIsEth && !isAddress(tokenInRaw)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'tokenIn': expected EIP-55 address or 'ETH', got "${tokenInRaw}"`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'tokenIn': "${tokenInRaw}"`,
        ),
      };
    }
    if (!tokenOutIsEth && !isAddress(tokenOutRaw)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'tokenOut': expected EIP-55 address or 'ETH', got "${tokenOutRaw}"`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'tokenOut': "${tokenOutRaw}"`,
        ),
      };
    }

    const tokenInAddr: Address = tokenInIsEth
      ? WETH_ETHEREUM
      : getAddress(tokenInRaw);
    const tokenOutAddr: Address = tokenOutIsEth
      ? WETH_ETHEREUM
      : getAddress(tokenOutRaw);

    // Step 4 — Same-token-swap refusal (after sentinel resolution per D-05).
    // ETH↔ETH, ETH↔WETH, and address-equivalence all collapse to the same
    // gate. Also catches the ETH-in-AND-ETH-out simultaneous case.
    if (tokenInAddr === tokenOutAddr) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: same-token-swap refused: tokenIn and tokenOut resolve to the same address (ETH/WETH or address equivalence).",
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          "same-token-swap refused: tokenIn and tokenOut resolve to the same address",
          "same-token-swap-refused",
        ),
      };
    }

    // Step 5 — slippageBps bounds (1..10000); default 50 when omitted.
    let slippageBps: number;
    if (!slippageWasExplicit) {
      slippageBps = DEFAULT_SLIPPAGE_BPS;
    } else {
      const slipRaw = rawArgs.slippageBps;
      if (
        typeof slipRaw !== "number" ||
        !Number.isInteger(slipRaw) ||
        slipRaw < 1 ||
        slipRaw > 10000
      ) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'slippageBps': expected integer in [1, 10000], got ${slipRaw}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'slippageBps': expected integer in [1, 10000], got ${slipRaw}`,
          ),
        };
      }
      slippageBps = slipRaw;
    }

    // Step 6 — Resolve `from` (Issue #62 — delegated shared helper).
    const rawFrom = typeof args.from === "string" ? args.from : undefined;
    const fromResolution = await resolveFrom({ rawFrom, chainId });
    if (fromResolution.kind === "error") {
      return fromResolution.result;
    }
    const fromAddress: Address = fromResolution.fromAddress;

    // Step 7 — Resolve tokenIn decimals (18 for ETH/WETH; else readContract).
    const client = getChainClient(chainId);
    let tokenInDecimals: number;
    if (tokenInIsEth) {
      tokenInDecimals = 18;
    } else {
      try {
        const d = (await client.readContract({
          address: tokenInAddr,
          abi: erc20Abi,
          functionName: "decimals",
        })) as number;
        tokenInDecimals = Number(d);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to resolve tokenIn decimals: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            `failed to resolve tokenIn decimals: ${message}`,
          ),
        };
      }
    }

    // Step 8 — Parse amount strictly (decimal-aware per D-16).
    const rawAmount = typeof args.amount === "string" ? args.amount : "";
    let amountIn: bigint;
    try {
      amountIn = parseAmountStrict(rawAmount, tokenInDecimals);
    } catch (err) {
      if (err instanceof InvalidAmountError) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'amount': ${err.message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'amount': ${err.message}`,
            err.kind,
          ),
        };
      }
      throw err;
    }
    if (amountIn <= 0n) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'amount': must be > 0, got "${rawAmount}"`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'amount': must be > 0, got "${rawAmount}"`,
        ),
      };
    }

    // Step 9 — RE-FETCH quote at PREPARE time (NOT cached — drift detection
    // per D-08 + anti-pattern 7). 3-way parallel:
    //   - singleHopResults: all 4 fee tiers
    //   - multiHopResults:  0..2 anchor-path candidates
    //   - tinySingleHop:    fair-price reference for price-impact
    let tinyAmount = amountIn / 10000n;
    let tinyScaleFactor = 10000n;
    if (tinyAmount === 0n) {
      tinyAmount = amountIn;
      tinyScaleFactor = 1n;
    }

    const [singleHopResults, multiHopResults, tinySingleHopResults] =
      await Promise.all([
        _uniswapV3Chain.quoteAllSingleHopFeeTiers(client, {
          tokenIn: tokenInAddr,
          tokenOut: tokenOutAddr,
          amountIn,
        }),
        _uniswapV3Chain.quoteMultiHopCandidates(client, {
          tokenIn: tokenInAddr,
          tokenOut: tokenOutAddr,
          amountIn,
        }),
        _uniswapV3Chain.quoteAllSingleHopFeeTiers(client, {
          tokenIn: tokenInAddr,
          tokenOut: tokenOutAddr,
          amountIn: tinyAmount,
        }),
      ]);

    // Step 10 — Select best single-hop + best multi-hop.
    let bestSingleHop: SingleHopQuoteResult | null = null;
    for (const r of singleHopResults) {
      if (
        r !== null &&
        (bestSingleHop === null || r.amountOut > bestSingleHop.amountOut)
      ) {
        bestSingleHop = r;
      }
    }
    let bestMultiHop: MultiHopQuoteResult | null = null;
    for (const r of multiHopResults) {
      if (
        r !== null &&
        (bestMultiHop === null || r.amountOut > bestMultiHop.amountOut)
      ) {
        bestMultiHop = r;
      }
    }

    // Step 11 — D-04a no-liquidity refusal: ALL single-hop tiers AND multi-hop
    // candidates reverted. INVALID_INPUT + hintTool "request_capability".
    if (bestSingleHop === null && bestMultiHop === null) {
      const tokenInLabel = tokenInIsEth ? "ETH" : tokenInAddr;
      const tokenOutLabel = tokenOutIsEth ? "ETH" : tokenOutAddr;
      const msg = `no Uniswap V3 liquidity for ${tokenInLabel}↔${tokenOutLabel} at any standard fee tier`;
      return {
        isError: true,
        content: [{ type: "text", text: `error: ${msg}` }],
        structuredContent: {
          ...errEnvelope("INVALID_INPUT", msg, "no-uniswap-v3-liquidity"),
          hintTool: "request_capability",
          hintArgs: {
            feature: `Uniswap V3 swap support for ${tokenInLabel}↔${tokenOutLabel}`,
          },
        },
      };
    }

    // Step 12 — D-04 step 4: 0.5% improvement threshold for multi-hop wins.
    let useMultiHop = false;
    if (bestMultiHop !== null) {
      if (bestSingleHop === null) {
        useMultiHop = true;
      } else {
        useMultiHop =
          bestMultiHop.amountOut * 1000n > bestSingleHop.amountOut * 1005n;
      }
    }

    const quotedAmountOut: bigint = useMultiHop
      ? bestMultiHop!.amountOut
      : bestSingleHop!.amountOut;

    // Step 13 — Compute price impact via Quoter-midpoint method (D-04b).
    let bestTinyOut = 0n;
    for (const r of tinySingleHopResults) {
      if (r !== null && r.amountOut > bestTinyOut) {
        bestTinyOut = r.amountOut;
      }
    }
    const fairOut = bestTinyOut * tinyScaleFactor;
    const priceImpactBps = _uniswapV3PriceImpact.computePriceImpactBps({
      fairOut,
      actualOut: quotedAmountOut,
    });

    // Step 14 — SANDWICH-MEV GATE (D-08 LOAD-BEARING).
    // Refuse when priceImpactBps > 200 AND slippage was NOT explicitly
    // supplied. The check uses the FRESH priceImpactBps (re-fetched quote),
    // not whatever the agent saw at quote time — drift detection.
    if (
      priceImpactBps > SANDWICH_MEV_THRESHOLD_BPS &&
      !slippageWasExplicit
    ) {
      const mevRefusalBlock = SANDWICH_MEV_REFUSAL_ETHEREUM_TEMPLATE
        .replace(/\{PRICE_IMPACT_BPS\}/g, String(priceImpactBps))
        .replace(/\{THRESHOLD_BPS\}/g, String(SANDWICH_MEV_THRESHOLD_BPS));

      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              `error: sandwich-MEV defense triggered — price impact ${(priceImpactBps / 100).toFixed(2)}% ` +
              `exceeds the 2% threshold.\n\n${mevRefusalBlock}`,
          },
        ],
        structuredContent: {
          ...errEnvelope(
            "INVALID_INPUT",
            `price impact ${(priceImpactBps / 100).toFixed(2)}% exceeds the 2% threshold; pass slippageBps explicitly to confirm acceptance of high price impact (D-08 sandwich-MEV defense)`,
            `priceImpactBps: ${priceImpactBps}`,
          ),
          hintTool: "get_uniswap_quote",
        },
      };
    }

    // Step 15 — TOKEN-APPROVAL PRE-FLIGHT (D-07; non-ETH tokenIn only).
    // Read ERC20.allowance(from, SwapRouter02); insufficient → refuse with
    // hintTool "prepare_token_approve" + hintArgs naming SwapRouter02 as
    // spender. ETH-in skips this gate (no ERC-20 transfer; user's ETH flows
    // via msg.value).
    const swapRouter02Addr: Address = getUniswapV3SwapRouter02Address(chainId)!;
    if (!tokenInIsEth) {
      let allowance: bigint;
      try {
        allowance = (await client.readContract({
          address: tokenInAddr,
          abi: erc20Abi,
          functionName: "allowance",
          args: [fromAddress, swapRouter02Addr],
        })) as bigint;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to read ERC20.allowance: ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            `failed to read ERC20.allowance: ${message}`,
          ),
        };
      }
      if (allowance < amountIn) {
        const approvedHuman = formatUnits(allowance, tokenInDecimals);
        const insufficientMessage =
          `insufficient tokenIn allowance for Uniswap V3 SwapRouter02: ` +
          `approved ${approvedHuman}, need ${rawAmount}. ` +
          `Call prepare_token_approve with SwapRouter02 (${swapRouter02Addr}) as spender.`;
        return {
          isError: true,
          content: [
            { type: "text", text: `error: ${insufficientMessage}` },
          ],
          structuredContent: {
            ...errEnvelope("INVALID_INPUT", insufficientMessage),
            hintTool: "prepare_token_approve",
            hintArgs: {
              tokenAddress: tokenInAddr,
              spender: swapRouter02Addr,
              amount: rawAmount,
            },
          },
        };
      }
    }

    // Step 16 — Compute amountOutMinimum per D-06 (pure bigint formula).
    const amountOutMinimum: bigint =
      (quotedAmountOut * (10000n - BigInt(slippageBps))) / 10000n;

    // Step 17 — Compute deadline per D-10 (block.timestamp + 600s).
    // RPC failure falls back to wall-clock with stderr-logged warning.
    let deadline: bigint;
    try {
      const block = await client.getBlock({ blockTag: "latest" });
      deadline = block.timestamp + DEADLINE_BUFFER_SECS;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[prepare_uniswap_swap] warning: getBlock RPC failed (${message}); falling back to wall-clock deadline\n`,
      );
      deadline =
        BigInt(Math.floor(Date.now() / 1000)) + DEADLINE_BUFFER_SECS;
    }

    // Step 18 — CALLDATA COMPOSITION (4 paths per D-05).
    let data: Hex;
    let routeStrategy: "single-hop" | "multi-hop";
    let routeHops: Array<{ tokenIn: Address; fee: 100 | 500 | 3000 | 10000; tokenOut: Address }>;
    let routeFee: 100 | 500 | 3000 | 10000 | undefined;
    let valueWei: bigint;

    if (tokenOutIsEth) {
      // Path (d): ETH-out via composeMulticallWithUnwrap.
      // Inner exactInputSingle.recipient = SwapRouter02 (Pitfall 3 / D-15).
      // ETH-out + multi-hop is rare; the inner sub-call shape would differ
      // (exactInput instead of exactInputSingle). When useMultiHop is true
      // AND tokenOut=ETH, we degrade to single-hop (router-held WETH then
      // unwrap) — this matches the canonical Uniswap pattern.
      if (useMultiHop && bestSingleHop === null) {
        // Multi-hop ETH-out: build inner calls manually.
        // First inner: exactInput with router-as-recipient + path → WETH.
        const path = _uniswapV3Path.encodeV3Path(bestMultiHop!.path);
        const inner1: Hex = _uniswapV3Protocol.encodeExactInput({
          path,
          recipient: swapRouter02Addr,
          amountIn,
          amountOutMinimum,
        });
        const inner2: Hex = _uniswapV3Protocol.encodeUnwrapWeth9(
          amountOutMinimum,
          fromAddress,
        );
        data = _uniswapV3Protocol.encodeMulticallWithDeadline(deadline, [
          inner1,
          inner2,
        ]);
        routeStrategy = "multi-hop";
        routeHops = bestMultiHop!.path.map((h) => ({
          tokenIn: h.tokenIn,
          fee: h.fee,
          tokenOut: h.tokenOut,
        }));
        routeFee = undefined;
      } else {
        // Single-hop ETH-out via composeMulticallWithUnwrap helper.
        // Prefer single-hop when present; fall back to multi-hop only if
        // single-hop is absent and useMultiHop was set in step 12.
        const useSingleHop = bestSingleHop !== null && !useMultiHop;
        if (useSingleHop || bestSingleHop !== null) {
          const sh = bestSingleHop!;
          data = _uniswapV3Protocol.composeMulticallWithUnwrap({
            deadline,
            exactInputSingleParamsWithRouterRecipient: {
              tokenIn: tokenInAddr,
              tokenOut: tokenOutAddr, // WETH
              fee: sh.fee,
              recipient: swapRouter02Addr, // D-15 — router holds WETH
              amountIn,
              amountOutMinimum,
              sqrtPriceLimitX96: 0n,
            },
            finalAmountOutMin: amountOutMinimum,
            finalRecipient: fromAddress,
          });
          routeStrategy = "single-hop";
          routeHops = [
            { tokenIn: tokenInAddr, fee: sh.fee, tokenOut: tokenOutAddr },
          ];
          routeFee = sh.fee;
        } else {
          // Defensive: multi-hop-only winner that didn't trip the explicit
          // ETH-out multi-hop branch above. Shouldn't reach here in normal
          // flow but guards against unreachable cases.
          throw new Error(
            "ETH-out path: no usable single-hop or multi-hop quote",
          );
        }
      }
      valueWei = 0n;
    } else if (useMultiHop) {
      // Path (b): Multi-hop non-ETH (ERC-20 → ERC-20 via packed-bytes path).
      const path = _uniswapV3Path.encodeV3Path(bestMultiHop!.path);
      const inner: Hex = _uniswapV3Protocol.encodeExactInput({
        path,
        recipient: fromAddress,
        amountIn,
        amountOutMinimum,
      });
      data = _uniswapV3Protocol.encodeMulticallWithDeadline(deadline, [inner]);
      routeStrategy = "multi-hop";
      routeHops = bestMultiHop!.path.map((h) => ({
        tokenIn: h.tokenIn,
        fee: h.fee,
        tokenOut: h.tokenOut,
      }));
      routeFee = undefined;
      valueWei = 0n;
    } else {
      // Paths (a) + (c): single-hop, ETH-in or non-ETH.
      const sh = bestSingleHop!;
      const inner: Hex = _uniswapV3Protocol.encodeExactInputSingle({
        tokenIn: tokenInAddr, // WETH if ETH-in
        tokenOut: tokenOutAddr,
        fee: sh.fee,
        recipient: fromAddress,
        amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      });
      data = _uniswapV3Protocol.encodeMulticallWithDeadline(deadline, [inner]);
      routeStrategy = "single-hop";
      routeHops = [
        { tokenIn: tokenInAddr, fee: sh.fee, tokenOut: tokenOutAddr },
      ];
      routeFee = sh.fee;
      valueWei = tokenInIsEth ? amountIn : 0n;
    }

    // Step 19 — Build tx envelope + payloadFingerprint + handle.
    const tx = {
      chainId,
      to: swapRouter02Addr,
      valueWei,
      data,
    };
    const payloadFingerprint = computePayloadFingerprint(tx);

    const handle = createHandle({
      args: {
        to: swapRouter02Addr,
        valueWei: valueWei.toString(),
        tokenAddress: tokenInIsEth ? "ETH" : tokenInAddr,
        amount: rawAmount,
      },
      tx,
      payloadFingerprint,
    });

    // Step 20 — Build PREPARE RECEIPT text via D-09 template.
    const tokenInDisplay = tokenInIsEth
      ? `ETH (resolved to WETH ${WETH_ETHEREUM})`
      : tokenInAddr;
    const tokenOutDisplay = tokenOutIsEth
      ? `ETH (resolved to WETH ${WETH_ETHEREUM})`
      : tokenOutAddr;
    const amountInHuman = formatUnits(amountIn, tokenInDecimals);
    const slippagePct = (slippageBps / 100).toFixed(2);
    const amountOutMinHuman = tokenOutIsEth
      ? formatUnits(amountOutMinimum, 18)
      : amountOutMinimum.toString();
    const quotedHuman = tokenOutIsEth
      ? formatUnits(quotedAmountOut, 18)
      : quotedAmountOut.toString();
    const feeTierOrPath: string =
      routeStrategy === "single-hop" && routeFee !== undefined
        ? `${(routeFee / 10000).toFixed(2)}% (single-hop, fee=${routeFee})`
        : routeHops
            .map((h, i) =>
              i === 0
                ? `${h.tokenIn} → ${(h.fee / 10000).toFixed(2)}% → ${h.tokenOut}`
                : `→ ${(h.fee / 10000).toFixed(2)}% → ${h.tokenOut}`,
            )
            .join(" ");
    const deadlineIso = new Date(Number(deadline) * 1000).toISOString();
    const slippageSlot = slippageWasExplicit
      ? `${slippageBps} (caller-supplied)`
      : `${slippageBps} (default)`;

    const receipt = UNISWAP_SWAP_PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `ethereum (chainId ${chainId})`)
      .replace("{SWAP_ROUTER}", swapRouter02Addr)
      .replace("{TOKEN_IN}", tokenInDisplay)
      .replace("{TOKEN_OUT}", tokenOutDisplay)
      .replace(
        "{AMOUNT_IN}",
        `${rawAmount} (${amountIn.toString()} wei; decimals=${tokenInDecimals})`,
      )
      .replace(
        "{AMOUNT_OUT_MIN}",
        `${amountOutMinHuman} (= quoted ${quotedHuman} − ${slippagePct}% slippage)`,
      )
      .replace("{FEE_TIER_OR_PATH}", feeTierOrPath)
      .replace(
        "{PRICE_IMPACT_BPS}",
        `${priceImpactBps} (${(priceImpactBps / 100).toFixed(2)}%)`,
      )
      .replace("{SLIPPAGE_BPS}", slippageSlot)
      .replace("{DEADLINE}", `${deadlineIso} (block.timestamp + ${DEADLINE_BUFFER_SECS}s)`);

    // Step 21 — Build CHECKS PERFORMED text per D-09.
    const checksPerformed = [
      "CHECKS PERFORMED",
      `  Path:               ${feeTierOrPath}`,
      `  amountIn:           ${rawAmount} (${amountIn.toString()} wei)`,
      `  amountOutMinimum:   ${amountOutMinHuman} (= quoted ${quotedHuman} − ${slippagePct}% slippage)`,
      `  priceImpactBps:     ${priceImpactBps} (${(priceImpactBps / 100).toFixed(2)}%)`,
      `  deadline:           ${deadlineIso}`,
    ].join("\n");

    // Step 22 — Return 3-block response (PREPARE RECEIPT + CHECKS PERFORMED +
    // LEDGER NOTICE per D-11 UNCONDITIONAL).
    return {
      content: [
        { type: "text", text: receipt },
        { type: "text", text: checksPerformed },
        { type: "text", text: LEDGER_NOTICE_UNISWAP_V3_TEMPLATE },
      ],
      structuredContent: {
        handle,
        chainId,
        from: fromAddress,
        to: swapRouter02Addr,
        valueWei: valueWei.toString(),
        data,
        payloadFingerprint,
        route: { hops: routeHops, strategy: routeStrategy, fee: routeFee },
        priceImpactBps,
        slippageBps,
        quotedAmountOut: quotedAmountOut.toString(),
        amountOutMinimum: amountOutMinimum.toString(),
        deadline: deadline.toString(),
        chain: "ethereum",
        prepareReceipt: receipt,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: prepare_uniswap_swap failed: ${message}`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "prepare_uniswap_swap failed",
        message,
      ),
    };
  }
});
