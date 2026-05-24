// MCP tool: prepare_uniswap_v3_increase_liquidity({
//   chain, tokenId, amount0, amount1, slippageBps?, deadlineSeconds?, from?
// })
//
// Phase 33 — Plan 33-02 (UNI-06 increase leg). Mechanical clone of
// prepare_uniswap_v3_mint.ts (Plan 33-02 Task 2) with these deviations:
//
//   (a) tokenId-keyed — agent supplies an existing NFT position ID; the tool
//       reads positions(tokenId) to derive token0/token1 (which it needs for
//       the approval pre-flight).
//   (b) No tick snap (the position's range is fixed at mint time).
//   (c) Approval pre-flight on BOTH token0 AND token1 — same shape as mint
//       per RESEARCH § Topic 8 (increaseLiquidity ALSO performs internal
//       TransferHelper.safeTransferFrom on BOTH tokens).
//   (d) LEDGER NOTICE emitted UNCONDITIONALLY.
//   (e) valueWei = 0n — refuses ETH-in (Phase 33 LP surface refuses native
//       ETH; user pre-wraps).

import {
  type Address,
  type Hex,
  erc20Abi,
  isAddress,
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
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import {
  LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE,
  UNISWAP_V3_LP_INCREASE_PREPARE_RECEIPT_TEMPLATE,
} from "../signing/blocks.js";
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
  return makeStructuredError(code, message, cause) as unknown as Record<
    string,
    unknown
  > &
    StructuredError;
}

const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_DEADLINE_SECONDS = 1800;

const DESCRIPTION = [
  "Prepare an unsigned Uniswap V3 NonfungiblePositionManager `increaseLiquidity` call on Ethereum mainnet — adds liquidity to an existing position.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Server reads positions(tokenId) to derive token0/token1 + does an approval pre-flight on BOTH token0 AND token1 against NPM (per RESEARCH Topic 8 — increaseLiquidity performs internal TransferHelper.safeTransferFrom).",
  "Insufficient approval → INVALID_INPUT + hintTool: 'prepare_token_approve' naming the under-approved token + NPM as the spender.",
  "LEDGER NOTICE emitted UNCONDITIONALLY (NPM not in Ledger ERC-7730 registry).",
  "`chain` is REQUIRED and locked to 'ethereum'. `amount0`/`amount1` are DECIMAL STRINGS in human units.",
  "`slippageBps` defaults to 50; `deadlineSeconds` defaults to 1800.",
  "Returns { handle, chainId, from, to, valueWei, data, payloadFingerprint, tokenId, token0, token1, amount0Min, amount1Min, deadline } plus PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE.",
  "Failure modes: INVALID_INPUT (non-ethereum chain / malformed tokenId / amount parse error / token-approval insufficient / unknown tokenId); WALLET_NOT_PAIRED; WRONG_MODE; INTERNAL_ERROR.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum"] },
    tokenId: {
      type: "string",
      description: "NFT position ID as decimal string (bigint).",
    },
    amount0: { type: "string" },
    amount1: { type: "string" },
    slippageBps: { type: "number" },
    deadlineSeconds: { type: "number" },
    from: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
  },
  required: ["chain", "tokenId", "amount0", "amount1"],
  additionalProperties: false,
};

registerTool(
  "prepare_uniswap_v3_increase_liquidity",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawArgs = args as Record<string, unknown>;
      const slippageWasExplicit =
        "slippageBps" in rawArgs && rawArgs.slippageBps !== undefined;

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

      const rawFrom = typeof args.from === "string" ? args.from : undefined;
      const fromResolution = await resolveFrom({ rawFrom, chainId });
      if (fromResolution.kind === "error") return fromResolution.result;
      const fromAddress: Address = fromResolution.fromAddress;
      const fromCallerSupplied = fromResolution.callerSupplied;

      // Resolve position → token0/token1 via NPM.positions(tokenId).
      const client = getChainClient(chainId);
      const npmAddress: Address =
        getUniswapV3NonfungiblePositionManagerAddress(chainId)!;
      let token0: Address;
      let token1: Address;
      try {
        const pos = (await client.readContract({
          address: npmAddress,
          abi: NPM_READ_ABI,
          functionName: "positions",
          args: [tokenId],
        })) as readonly [
          bigint,
          Address,
          Address,
          Address,
          number,
          number,
          number,
          bigint,
          bigint,
          bigint,
          bigint,
          bigint,
        ];
        token0 = pos[2];
        token1 = pos[3];
        if (!isAddress(token0) || !isAddress(token1)) {
          throw new Error(
            `positions(${tokenId}) returned malformed token addresses`,
          );
        }
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
            `failed to read position ${tokenId}: ${message}`,
          ),
        };
      }

      // Resolve decimals for amount parsing.
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

      // Parse amounts.
      const rawAmount0 = typeof args.amount0 === "string" ? args.amount0 : "";
      const rawAmount1 = typeof args.amount1 === "string" ? args.amount1 : "";
      let amount0Desired: bigint;
      let amount1Desired: bigint;
      try {
        amount0Desired = parseAmountStrict(rawAmount0, decimals0);
        amount1Desired = parseAmountStrict(rawAmount1, decimals1);
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
              text: `error: invalid 'amount0'/'amount1': ${message}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid amount: ${message}`,
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

      const slipMul = 10000n - BigInt(slippageBps);
      const amount0Min = (amount0Desired * slipMul) / 10000n;
      const amount1Min = (amount1Desired * slipMul) / 10000n;

      // Approval pre-flight (BOTH tokens).
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
              amount: rawAmount0,
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
              amount: rawAmount1,
            },
          },
        };
      }

      const deadline =
        BigInt(Math.floor(Date.now() / 1000)) + BigInt(deadlineSeconds);
      const data: Hex = _uniswapV3LpProtocol.encodeIncreaseLiquidity({
        tokenId,
        amount0Desired,
        amount1Desired,
        amount0Min,
        amount1Min,
        deadline,
      });

      const tx = { chainId, to: npmAddress, valueWei: 0n, data };
      const payloadFingerprint = computePayloadFingerprint(tx);
      const handle = createHandle({
        args: {
          to: npmAddress,
          valueWei: "0",
          tokenAddress: token0,
          amount: rawAmount0,
        },
        tx,
        payloadFingerprint,
      });

      const deadlineIso = new Date(Number(deadline) * 1000).toISOString();
      const baseReceipt =
        UNISWAP_V3_LP_INCREASE_PREPARE_RECEIPT_TEMPLATE
          .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
          .replace("{NPM}", npmAddress)
          .replace("{TOKEN_ID}", tokenId.toString())
          .replace(
            "{AMOUNT0_DESIRED}",
            `${amount0Desired.toString()} (= ${rawAmount0}, decimals=${decimals0})`,
          )
          .replace(
            "{AMOUNT1_DESIRED}",
            `${amount1Desired.toString()} (= ${rawAmount1}, decimals=${decimals1})`,
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

      const checksPerformed = [
        "CHECKS PERFORMED",
        `  position.token0:    ${token0}`,
        `  position.token1:    ${token1}`,
        `  amount0Min:         ${amount0Min.toString()} (= amount0Desired × (10000 − ${slippageBps}) / 10000)`,
        `  amount1Min:         ${amount1Min.toString()} (= amount1Desired × (10000 − ${slippageBps}) / 10000)`,
        `  token0Allowance:    ${allow0.toString()} (≥ ${amount0Desired.toString()})`,
        `  token1Allowance:    ${allow1.toString()} (≥ ${amount1Desired.toString()})`,
      ].join("\n");

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
          amount0Desired: amount0Desired.toString(),
          amount1Desired: amount1Desired.toString(),
          amount0Min: amount0Min.toString(),
          amount1Min: amount1Min.toString(),
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
            text: `error: prepare_uniswap_v3_increase_liquidity failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_uniswap_v3_increase_liquidity failed",
          message,
        ),
      };
    }
  },
);
