// src/tools/get_bittensor_stake.ts — Phase 46 Plan 46-03 (TAO-R-02).
//
// Per-(hotkey, netuid) dTAO stake positions for a Bittensor coldkey. Each
// position's `.stake` is ALPHA (a per-subnet token, NOT TAO — Pitfall 2,
// the off-by-unit footgun CLAUDE.md warns of). EVERY amount carries its
// token label:
//   - `alpha`         — the source-of-truth position size, in ALPHA.
//   - `taoEquivalent` — a DERIVED display column: the alpha priced to TAO
//                       via the per-netuid chain price (currentAlphaPrice,
//                       1e9-scaled). Labeled TAO, flagged as an equivalent.
//
// The text response AND structuredContent both make the alpha-vs-TAO
// distinction explicit so the agent never relays "X TAO staked" when the
// on-chain unit is alpha.
//
// Decimal strings cross the boundary, never numbers — alpha + TAO are both
// 9-decimal RAO-scaled u128; bigint-only math (no Number precision loss).
//
// Locked errorCode set (mirror get_bittensor_balance):
//   - INVALID_INPUT          — wallet failed the SS58 checksum gate
//   - BITTENSOR_RPC_FAILED   — BittensorRpcError rethrown by tao-rpc-client
//   - INTERNAL_ERROR         — defensive catch-all

import {
  BittensorRpcError,
  alphaToTaoEquivRao,
  getAlphaPriceForNetuid,
  getStakeInfo,
  _taoRpcInternals,
} from "../chains/bittensor/tao-rpc-client.js";
import { assertSs58Address } from "../chains/bittensor/types.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns per-(hotkey, netuid) dTAO stake positions for a Bittensor coldkey (SS58 prefix-42 address) via the decoded stakeInfoRuntimeApi.getStakeInfoForColdkey runtime API.",
  "CRITICAL UNIT LABELING: each position's stake is denominated in ALPHA (a per-subnet token), NOT TAO. Every row carries both `alpha` (the source-of-truth amount, labeled ALPHA) and `taoEquivalent` (a derived display column — the alpha priced to TAO via the per-subnet AMM, labeled TAO and subject to slippage). Never relay alpha as \"TAO staked\".",
  "Use this for the per-position breakdown. Use get_bittensor_balance for the free + summed-TAO-equivalent at-a-glance view.",
  "`wallet` is REQUIRED — SS58 \"5…\" prefix-42 address. Rejected via the full blake2-256 checksum gate BEFORE any RPC.",
  "Decimal strings cross the boundary, never numbers — alpha + TAO both preserve the u128 range as strings.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description:
        "Bittensor coldkey SS58 address (prefix 42, \"5…\" shape, 47-48 chars). Full checksum validated server-side before any RPC.",
      pattern: "^5[1-9A-HJ-NP-Za-km-z]{46,47}$",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

interface BittensorStakePosition {
  hotkey: string;
  netuid: number;
  /** Source-of-truth position size, ALPHA, decimal string. */
  alpha: string;
  /** Unit label for `alpha` — always "ALPHA". Makes the unit explicit on the wire. */
  alphaUnit: "ALPHA";
  /** Derived display: alpha priced to TAO via currentAlphaPrice, decimal string. */
  taoEquivalent: string;
  /** Unit label for `taoEquivalent` — always "TAO". */
  taoEquivalentUnit: "TAO";
  isRegistered: boolean;
}

registerTool(
  "get_bittensor_stake",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    const walletRaw = args.wallet;
    if (typeof walletRaw !== "string" || walletRaw.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "error: `wallet` must be a non-empty SS58 Bittensor coldkey address",
          },
        ],
        isError: true,
        structuredContent: {
          errorCode: "INVALID_INPUT",
          message: "`wallet` must be a non-empty SS58 Bittensor coldkey address",
        },
      };
    }

    let wallet: string;
    try {
      wallet = assertSs58Address(walletRaw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `error: invalid Bittensor SS58 address (failed checksum): ${walletRaw}`,
          },
        ],
        isError: true,
        structuredContent: {
          errorCode: "INVALID_INPUT",
          message: `invalid SS58 address: ${message}`,
        },
      };
    }

    try {
      const rows = await getStakeInfo(
        wallet as Parameters<typeof getStakeInfo>[0],
      );

      const priceByNetuid = new Map<number, bigint>();
      const positions: BittensorStakePosition[] = [];
      for (const row of rows) {
        let price = priceByNetuid.get(row.netuid);
        if (price === undefined) {
          price = await getAlphaPriceForNetuid(row.netuid);
          priceByNetuid.set(row.netuid, price);
        }
        const taoEquivRao = alphaToTaoEquivRao(row.alphaRao, price);
        positions.push({
          hotkey: row.hotkey,
          netuid: row.netuid,
          alpha: row.alpha,
          alphaUnit: "ALPHA",
          taoEquivalent: _taoRpcInternals.formatRaoToTao(taoEquivRao),
          taoEquivalentUnit: "TAO",
          isRegistered: row.isRegistered,
        });
      }

      const lines: string[] = [];
      if (positions.length === 0) {
        lines.push(`${wallet} has no active stake positions.`);
      } else {
        lines.push(
          `${wallet} — ${positions.length} stake position${positions.length === 1 ? "" : "s"} (amounts in ALPHA; TAO-equivalent is a derived estimate via the per-subnet price):`,
        );
        for (const p of positions) {
          lines.push(
            `  netuid ${p.netuid} · hotkey ${p.hotkey} · ${p.alpha} ALPHA (~${p.taoEquivalent} TAO-equiv)${p.isRegistered ? "" : " [unregistered]"}`,
          );
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: {
          wallet,
          positions,
          positionCount: positions.length,
          note:
            "alpha is the source-of-truth per-subnet token; taoEquivalent is a derived display column priced via the subnet AMM (subject to slippage).",
        },
      };
    } catch (err) {
      if (err instanceof BittensorRpcError) {
        return {
          content: [
            {
              type: "text",
              text: `error: failed to read stake positions for ${wallet}: ${err.message}`,
            },
          ],
          isError: true,
          structuredContent: {
            errorCode: err.errorCode,
            message: err.message,
          },
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `error: failed to read stake positions for ${wallet}: ${message}`,
          },
        ],
        isError: true,
        structuredContent: {
          errorCode: "INTERNAL_ERROR",
          message,
        },
      };
    }
  },
);
