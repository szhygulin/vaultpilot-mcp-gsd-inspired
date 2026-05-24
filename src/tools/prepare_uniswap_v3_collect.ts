// MCP tool: prepare_uniswap_v3_collect({
//   chain, tokenId, amount0Max?, amount1Max?, recipient?, from?
// })
//
// Phase 33 — Plan 33-02 (UNI-07). Harvest accrued fees + settled-but-
// uncollected liquidity from a position. Defaults to MAX_UINT128 sentinel for
// amount0Max/amount1Max — "collect everything" per RESEARCH § Topic 2
// (T-MAX-UINT128-SENTINEL mitigation).
//
// NO approval pre-flight (NFT-ownership authorization).
// LEDGER NOTICE emitted UNCONDITIONALLY.

import {
  type Address,
  type Hex,
  getAddress,
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
import {
  MAX_UINT128,
  _uniswapV3LpProtocol,
} from "../protocols/uniswap-v3-lp.js";
import { InvalidAmountError, parseAmountStrict } from "../signing/amount.js";
import {
  LEDGER_NOTICE_UNISWAP_V3_LP_TEMPLATE,
  UNISWAP_V3_LP_COLLECT_PREPARE_RECEIPT_TEMPLATE,
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

const DESCRIPTION = [
  "Prepare an unsigned Uniswap V3 NonfungiblePositionManager `collect` call on Ethereum mainnet — harvests accrued fees + settled-but-uncollected liquidity from a position.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "`amount0Max`/`amount1Max` default to MAX_UINT128 (= 340282366920938463463374607431768211455, i.e. type(uint128).max) — 'collect everything'. CHECKS PERFORMED notes the sentinel use.",
  "`recipient` defaults to the sender address.",
  "NO approval pre-flight (uses NFT-ownership authorization). LEDGER NOTICE emitted UNCONDITIONALLY (NPM not in Ledger ERC-7730 registry).",
  "`chain` is REQUIRED and locked to 'ethereum'.",
  "Returns { handle, chainId, from, to, valueWei, data, payloadFingerprint, tokenId, recipient, amount0Max, amount1Max } plus PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE.",
  "Failure modes: INVALID_INPUT (non-ethereum chain / malformed tokenId / amount parse error / unknown tokenId for sentinel-override path); WALLET_NOT_PAIRED; WRONG_MODE; INTERNAL_ERROR.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum"] },
    tokenId: { type: "string" },
    amount0Max: {
      type: "string",
      description:
        "Optional max token0 collection as decimal string. Defaults to MAX_UINT128 sentinel ('collect everything').",
    },
    amount1Max: {
      type: "string",
      description:
        "Optional max token1 collection as decimal string. Defaults to MAX_UINT128 sentinel.",
    },
    recipient: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "Optional collect recipient; defaults to sender.",
    },
    from: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
  },
  required: ["chain", "tokenId"],
  additionalProperties: false,
};

registerTool(
  "prepare_uniswap_v3_collect",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawArgs = args as Record<string, unknown>;

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

      const rawFrom = typeof args.from === "string" ? args.from : undefined;
      const fromResolution = await resolveFrom({ rawFrom, chainId });
      if (fromResolution.kind === "error") return fromResolution.result;
      const fromAddress: Address = fromResolution.fromAddress;
      const fromCallerSupplied = fromResolution.callerSupplied;

      // Recipient defaults to sender.
      let recipient: Address = fromAddress;
      let recipientCallerSupplied = false;
      if ("recipient" in rawArgs && rawArgs.recipient !== undefined) {
        const r = rawArgs.recipient;
        if (typeof r !== "string" || !isAddress(r)) {
          const msg = `invalid 'recipient': expected EIP-55 address, got "${String(r)}"`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope("INVALID_INPUT", msg),
          };
        }
        recipient = getAddress(r);
        recipientCallerSupplied = true;
      }

      // amount0Max / amount1Max — sentinel default + decimal-string override.
      // When the agent overrides, we need decimals (token0/1) to parse — read
      // positions(tokenId) to derive. When using the sentinel, skip the RPC.
      const has0Override =
        "amount0Max" in rawArgs && rawArgs.amount0Max !== undefined;
      const has1Override =
        "amount1Max" in rawArgs && rawArgs.amount1Max !== undefined;

      let amount0Max = MAX_UINT128;
      let amount1Max = MAX_UINT128;
      let raw0Override: string | null = null;
      let raw1Override: string | null = null;

      if (has0Override || has1Override) {
        // Need token decimals.
        const client = getChainClient(chainId);
        const npmAddressForRead: Address =
          getUniswapV3NonfungiblePositionManagerAddress(chainId)!;
        let token0Addr: Address;
        let token1Addr: Address;
        try {
          const pos = (await client.readContract({
            address: npmAddressForRead,
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
          token0Addr = pos[2];
          token1Addr = pos[3];
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
        const { erc20Abi } = await import("viem");
        const [d0, d1] = (await Promise.all([
          client.readContract({
            address: token0Addr,
            abi: erc20Abi,
            functionName: "decimals",
          }),
          client.readContract({
            address: token1Addr,
            abi: erc20Abi,
            functionName: "decimals",
          }),
        ])) as [number, number];
        if (has0Override) {
          raw0Override =
            typeof rawArgs.amount0Max === "string"
              ? (rawArgs.amount0Max as string)
              : "";
          try {
            amount0Max = parseAmountStrict(raw0Override, Number(d0));
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
                  text: `error: invalid 'amount0Max': ${message}`,
                },
              ],
              structuredContent: errEnvelope(
                "INVALID_INPUT",
                `invalid 'amount0Max': ${message}`,
              ),
            };
          }
        }
        if (has1Override) {
          raw1Override =
            typeof rawArgs.amount1Max === "string"
              ? (rawArgs.amount1Max as string)
              : "";
          try {
            amount1Max = parseAmountStrict(raw1Override, Number(d1));
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
                  text: `error: invalid 'amount1Max': ${message}`,
                },
              ],
              structuredContent: errEnvelope(
                "INVALID_INPUT",
                `invalid 'amount1Max': ${message}`,
              ),
            };
          }
        }
      }

      // Both amounts must fit uint128.
      if (amount0Max > MAX_UINT128 || amount1Max > MAX_UINT128) {
        const msg = `invalid 'amount0Max'/'amount1Max': must fit in uint128`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

      const npmAddress: Address =
        getUniswapV3NonfungiblePositionManagerAddress(chainId)!;
      const data: Hex = _uniswapV3LpProtocol.encodeCollect({
        tokenId,
        recipient,
        amount0Max,
        amount1Max,
      });

      const tx = { chainId, to: npmAddress, valueWei: 0n, data };
      const payloadFingerprint = computePayloadFingerprint(tx);
      const handle = createHandle({
        args: {
          to: npmAddress,
          valueWei: "0",
          tokenAddress: "",
          amount: tokenId.toString(),
        },
        tx,
        payloadFingerprint,
      });

      const renderMax = (v: bigint, override: string | null): string =>
        v === MAX_UINT128
          ? "MAX_UINT128 (collect everything)"
          : `${v.toString()}${override !== null ? ` (= ${override})` : ""}`;
      const baseReceipt = UNISWAP_V3_LP_COLLECT_PREPARE_RECEIPT_TEMPLATE
        .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
        .replace("{NPM}", npmAddress)
        .replace("{TOKEN_ID}", tokenId.toString())
        .replace(
          "{RECIPIENT}",
          recipientCallerSupplied
            ? `${recipient} (caller-supplied)`
            : `${recipient} (default = sender)`,
        )
        .replace("{AMOUNT0_MAX}", renderMax(amount0Max, raw0Override))
        .replace("{AMOUNT1_MAX}", renderMax(amount1Max, raw1Override));
      const receipt = fromCallerSupplied
        ? `${baseReceipt}\n  from:               ${rawFrom}`
        : baseReceipt;

      const checksLines = ["CHECKS PERFORMED"];
      if (amount0Max === MAX_UINT128 && amount1Max === MAX_UINT128) {
        checksLines.push(
          "  collectMode:        MAX_UINT128 sentinel — collect everything (T-MAX-UINT128-SENTINEL: default applied because amount0Max + amount1Max omitted)",
        );
      } else {
        if (amount0Max === MAX_UINT128) {
          checksLines.push(
            "  amount0Max:         MAX_UINT128 sentinel — collect everything",
          );
        }
        if (amount1Max === MAX_UINT128) {
          checksLines.push(
            "  amount1Max:         MAX_UINT128 sentinel — collect everything",
          );
        }
      }
      checksLines.push(
        `  recipient:          ${recipient}${recipientCallerSupplied ? " (caller-supplied)" : " (default = sender)"}`,
      );
      checksLines.push(
        "  authorization:      NFT-ownership (on-chain check at execution)",
      );
      const checksPerformed = checksLines.join("\n");

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
          recipient,
          amount0Max: amount0Max.toString(),
          amount1Max: amount1Max.toString(),
          amount0MaxIsSentinel: amount0Max === MAX_UINT128,
          amount1MaxIsSentinel: amount1Max === MAX_UINT128,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_uniswap_v3_collect failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_uniswap_v3_collect failed",
          message,
        ),
      };
    }
  },
);
