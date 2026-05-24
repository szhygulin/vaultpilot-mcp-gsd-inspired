// MCP tool: prepare_uniswap_v3_burn({ chain, tokenId, from? })
//
// Phase 33 — Plan 33-02 (UNI-08). Closes a fully-empty position by calling
// NPM.burn(tokenId). The on-chain implementation REVERTS unless
// liquidity == 0 AND tokensOwed0 == 0 AND tokensOwed1 == 0; this tool
// pre-flights via `positions(tokenId)` and refuses with `INVALID_INPUT +
// hintTool` BEFORE the tx hits chain (T-BURN-PRECONDITION mitigation).
//
// Refusal routing:
//   - liquidity > 0  → hintTool: 'prepare_uniswap_v3_decrease_liquidity'
//   - tokensOwed > 0 → hintTool: 'prepare_uniswap_v3_collect'
//
// LEDGER NOTICE emitted UNCONDITIONALLY.
//
// Selector 0x42966c68 COLLIDES with Phase 31 rETH.burn — preview_send
// (tx.to, selector) tuple-dispatches; Plan 33-02 Task 3 wires the resolution.

import { type Address, type Hex } from "viem";

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
  UNISWAP_V3_LP_BURN_PREPARE_RECEIPT_TEMPLATE,
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
  "Prepare an unsigned Uniswap V3 NonfungiblePositionManager `burn` call on Ethereum mainnet — closes a fully-empty position.",
  "Pre-flight refusal: server reads positions(tokenId) and refuses with INVALID_INPUT + hintTool if liquidity > 0 (hint: prepare_uniswap_v3_decrease_liquidity) OR tokensOwed > 0 (hint: prepare_uniswap_v3_collect). Defense-in-depth against the on-chain revert.",
  "LEDGER NOTICE emitted UNCONDITIONALLY (NPM not in Ledger ERC-7730 registry).",
  "Selector 0x42966c68 collides with Phase 31 rETH.burn + ERC-20 Burnable; preview_send (tx.to, selector) tuple-dispatches.",
  "`chain` is REQUIRED and locked to 'ethereum'.",
  "Returns { handle, chainId, from, to, valueWei, data, payloadFingerprint, tokenId } plus PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE.",
  "Failure modes: INVALID_INPUT (non-ethereum chain / malformed tokenId / non-empty position with hintTool routing); WALLET_NOT_PAIRED; WRONG_MODE; INTERNAL_ERROR.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum"] },
    tokenId: { type: "string" },
    from: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
  },
  required: ["chain", "tokenId"],
  additionalProperties: false,
};

registerTool(
  "prepare_uniswap_v3_burn",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
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

      const client = getChainClient(chainId);
      const npmAddress: Address =
        getUniswapV3NonfungiblePositionManagerAddress(chainId)!;

      // Pre-flight: positions(tokenId) → refuse non-empty positions.
      let liquidity: bigint;
      let tokensOwed0: bigint;
      let tokensOwed1: bigint;
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
        liquidity = pos[7];
        tokensOwed0 = pos[10];
        tokensOwed1 = pos[11];
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

      if (liquidity > 0n) {
        const msg = `position ${tokenId} has outstanding liquidity (${liquidity.toString()}); burn would revert on-chain. Call prepare_uniswap_v3_decrease_liquidity first to remove liquidity.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: {
            ...errEnvelope("INVALID_INPUT", msg),
            hintTool: "prepare_uniswap_v3_decrease_liquidity",
            hintArgs: {
              chain: "ethereum",
              tokenId: tokenId.toString(),
              liquidityPercent: 100,
            },
          },
        };
      }
      if (tokensOwed0 > 0n || tokensOwed1 > 0n) {
        const msg = `position ${tokenId} has outstanding tokensOwed (token0=${tokensOwed0.toString()}, token1=${tokensOwed1.toString()}); burn would revert on-chain. Call prepare_uniswap_v3_collect first to harvest.`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: {
            ...errEnvelope("INVALID_INPUT", msg),
            hintTool: "prepare_uniswap_v3_collect",
            hintArgs: {
              chain: "ethereum",
              tokenId: tokenId.toString(),
            },
          },
        };
      }

      const data: Hex = _uniswapV3LpProtocol.encodeBurn(tokenId);
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

      const baseReceipt = UNISWAP_V3_LP_BURN_PREPARE_RECEIPT_TEMPLATE
        .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
        .replace("{NPM}", npmAddress)
        .replace("{TOKEN_ID}", tokenId.toString());
      const receipt = fromCallerSupplied
        ? `${baseReceipt}\n  from:               ${rawFrom}`
        : baseReceipt;

      const checksPerformed = [
        "CHECKS PERFORMED",
        `  tokenId:            ${tokenId.toString()}`,
        `  position.liquidity: 0 (pre-flight verified — burn would revert otherwise)`,
        `  position.tokensOwed: 0 / 0`,
        `  authorization:      NFT-ownership (on-chain check at execution)`,
        `  selectorCollision:  NPM.burn (0x42966c68) collides with Phase 31 rETH.burn — preview_send tuple-dispatches via tx.to`,
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
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_uniswap_v3_burn failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_uniswap_v3_burn failed",
          message,
        ),
      };
    }
  },
);
