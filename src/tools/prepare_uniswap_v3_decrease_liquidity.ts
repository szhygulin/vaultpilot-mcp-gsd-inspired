// MCP tool: prepare_uniswap_v3_decrease_liquidity({
//   chain, tokenId, liquidityPercent?, liquidityDelta?, slippageBps?, deadlineSeconds?, from?
// })
//
// Phase 33 — Plan 33-02 (UNI-06 decrease leg). Mechanical clone of
// prepare_uniswap_v3_increase_liquidity.ts shape with these deviations:
//
//   (a) NO approval pre-flight — decrease uses NFT-ownership authorization
//       (not ERC-20 spender). The tx will revert on-chain if the user isn't
//       the position owner; the agent surfaces that on-chain reason.
//   (b) Two parameter shapes:
//        - liquidityPercent (1..100) → liquidityDelta = position.liquidity × pct / 100
//        - liquidityDelta (raw bigint as decimal string) → exact amount
//       Exactly one must be supplied; both → INVALID_INPUT.
//   (c) Verbatim "does NOT transfer — call collect" notice in the PREPARE
//       RECEIPT template (T-DECREASE-DOES-NOT-TRANSFER mitigation).
//   (d) LEDGER NOTICE emitted UNCONDITIONALLY.
//   (e) amount0Min/amount1Min default to 0 (no slippage floor at the prepare
//       layer for decrease — the user is removing already-deposited
//       liquidity; the proportional amounts are deterministic from current
//       pool state and the slippage floor matters only as drift protection
//       across blocks).

import {
  type Address,
  type Hex,
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
  UNISWAP_V3_LP_DECREASE_PREPARE_RECEIPT_TEMPLATE,
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
  "Prepare an unsigned Uniswap V3 NonfungiblePositionManager `decreaseLiquidity` call on Ethereum mainnet — removes liquidity from a position.",
  "Note: decreaseLiquidity does NOT transfer tokens to your wallet. It accounts the withdrawn liquidity to tokensOwed on the position; call prepare_uniswap_v3_collect to harvest.",
  "Returns a handle the agent passes to preview_send before send_transaction.",
  "Two parameter modes (exactly one):",
  "  - liquidityPercent (integer 1..100): server reads positions(tokenId).liquidity and computes the delta proportionally.",
  "  - liquidityDelta (decimal string): exact bigint liquidity units to remove (advanced).",
  "NO approval pre-flight (uses NFT-ownership authorization). LEDGER NOTICE emitted UNCONDITIONALLY.",
  "`chain` is REQUIRED and locked to 'ethereum'.",
  "`slippageBps` defaults to 50 (informational — amount0Min/amount1Min currently default to 0 since current-pool-state derivation is deferred to v2.4.x).",
  "Returns { handle, chainId, from, to, valueWei, data, payloadFingerprint, tokenId, liquidityDelta, deadline } plus PREPARE RECEIPT + CHECKS PERFORMED + LEDGER NOTICE.",
  "Failure modes: INVALID_INPUT (non-ethereum chain / malformed tokenId / missing or conflicting liquidityPercent vs liquidityDelta / liquidityPercent out of bounds); WALLET_NOT_PAIRED; WRONG_MODE; INTERNAL_ERROR.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: { type: "string", enum: ["ethereum"] },
    tokenId: { type: "string" },
    liquidityPercent: {
      type: "number",
      description: "Integer 1..100. Exactly one of this OR liquidityDelta.",
    },
    liquidityDelta: {
      type: "string",
      description: "Bigint as decimal string. Exactly one of this OR liquidityPercent.",
    },
    slippageBps: { type: "number" },
    deadlineSeconds: { type: "number" },
    from: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
  },
  required: ["chain", "tokenId"],
  additionalProperties: false,
};

registerTool(
  "prepare_uniswap_v3_decrease_liquidity",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const rawArgs = args as Record<string, unknown>;
      const slippageWasExplicit =
        "slippageBps" in rawArgs && rawArgs.slippageBps !== undefined;
      const hasPercent =
        "liquidityPercent" in rawArgs && rawArgs.liquidityPercent !== undefined;
      const hasDelta =
        "liquidityDelta" in rawArgs && rawArgs.liquidityDelta !== undefined;

      if (hasPercent === hasDelta) {
        const msg = `invalid input: supply exactly one of 'liquidityPercent' or 'liquidityDelta' (both${hasPercent ? " supplied" : " missing"})`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: errEnvelope("INVALID_INPUT", msg),
        };
      }

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

      const client = getChainClient(chainId);
      const npmAddress: Address =
        getUniswapV3NonfungiblePositionManagerAddress(chainId)!;

      // Resolve liquidityDelta.
      let liquidityDelta: bigint;
      if (hasPercent) {
        const pct = rawArgs.liquidityPercent;
        if (
          typeof pct !== "number" ||
          !Number.isInteger(pct) ||
          pct < 1 ||
          pct > 100
        ) {
          const msg = `invalid 'liquidityPercent': expected integer in [1, 100], got ${String(pct)}`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope("INVALID_INPUT", msg),
          };
        }
        // Read positions(tokenId).liquidity.
        let positionLiquidity: bigint;
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
          positionLiquidity = pos[7];
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
        if (positionLiquidity === 0n) {
          const msg = `position ${tokenId} has zero liquidity — nothing to decrease`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope("INVALID_INPUT", msg),
          };
        }
        liquidityDelta = (positionLiquidity * BigInt(pct)) / 100n;
        if (liquidityDelta === 0n) liquidityDelta = 1n; // float pct → at least 1
      } else {
        const v = rawArgs.liquidityDelta;
        if (typeof v !== "string" || !/^[0-9]+$/.test(v)) {
          const msg = `invalid 'liquidityDelta': expected non-negative decimal-string bigint, got "${String(v)}"`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope("INVALID_INPUT", msg),
          };
        }
        liquidityDelta = BigInt(v);
        if (liquidityDelta === 0n) {
          const msg = `invalid 'liquidityDelta': must be > 0`;
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${msg}` }],
            structuredContent: errEnvelope("INVALID_INPUT", msg),
          };
        }
      }

      // amount0Min/amount1Min default to 0 — Plan 33-02 keeps the slippage
      // floor disabled at the prepare layer pending current-pool-state
      // derivation (deferred to v2.4.x). slippageBps remains in the response
      // for downstream consumers + the CHECKS PERFORMED block.
      const amount0Min = 0n;
      const amount1Min = 0n;

      const deadline =
        BigInt(Math.floor(Date.now() / 1000)) + BigInt(deadlineSeconds);
      const data: Hex = _uniswapV3LpProtocol.encodeDecreaseLiquidity({
        tokenId,
        liquidity: liquidityDelta,
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
          tokenAddress: "",
          amount: liquidityDelta.toString(),
        },
        tx,
        payloadFingerprint,
      });

      const deadlineIso = new Date(Number(deadline) * 1000).toISOString();
      const baseReceipt =
        UNISWAP_V3_LP_DECREASE_PREPARE_RECEIPT_TEMPLATE
          .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
          .replace("{NPM}", npmAddress)
          .replace("{TOKEN_ID}", tokenId.toString())
          .replace("{LIQUIDITY_DELTA}", liquidityDelta.toString())
          .replace("{AMOUNT0_MIN}", amount0Min.toString())
          .replace("{AMOUNT1_MIN}", amount1Min.toString())
          .replace(
            "{SLIPPAGE_BPS}",
            slippageWasExplicit
              ? `${slippageBps} (caller-supplied)`
              : `${slippageBps} (default; floor not yet enforced — see CHECKS PERFORMED)`,
          )
          .replace("{DEADLINE}", deadlineIso);
      const receipt = fromCallerSupplied
        ? `${baseReceipt}\n  from:               ${rawFrom}`
        : baseReceipt;

      const checksPerformed = [
        "CHECKS PERFORMED",
        `  tokenId:            ${tokenId.toString()}`,
        `  liquidityDelta:     ${liquidityDelta.toString()}${hasPercent ? ` (= position.liquidity × ${String(rawArgs.liquidityPercent)} / 100)` : " (caller-supplied)"}`,
        `  amount0Min/1Min:    0 / 0 (slippage floor enforcement deferred to v2.4.x; current-pool-state derivation not implemented)`,
        `  authorization:      NFT-ownership (on-chain check at execution; the tool does NOT pre-flight ownership)`,
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
          liquidityDelta: liquidityDelta.toString(),
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
            text: `error: prepare_uniswap_v3_decrease_liquidity failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_uniswap_v3_decrease_liquidity failed",
          message,
        ),
      };
    }
  },
);
