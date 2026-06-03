// src/tools/get_bittensor_balance.ts — Phase 46 Plan 46-03 (TAO-R-01).
//
// Free + staked TAO balance read for a Bittensor coldkey. Mirrors
// get_solana_balance.ts — SS58-validated wallet input → decoded
// runtime-API reads → decimal-string boundary at the response edge
// (CLAUDE.md "Decimal-aware arithmetic").
//
// UNIT DISCIPLINE (Pitfall 2 — the off-by-unit footgun):
//   - free balance is in RAO (1 TAO = 1e9 RAO) → free TAO decimal string.
//   - staked positions are denominated in ALPHA (a per-subnet token, NOT
//     TAO). The "staked TAO-equivalent" total is a DERIVED display value:
//     each row's alpha is converted to TAO via the per-netuid chain price
//     (currentAlphaPrice, 1e9-scaled). The alpha figures are the source of
//     truth (surfaced per-position by get_bittensor_stake); this tool sums
//     them into a single TAO-equivalent for a balance-at-a-glance view, and
//     LABELS it as an equivalent/estimate.
//
// Decimal strings cross the boundary, never numbers — RAO is u128; Number
// precision loss (above 2^53) cannot leak in (bigint-only math).
//
// Locked errorCode set:
//   - INVALID_INPUT          — wallet failed the SS58 checksum gate
//                              (assertSs58Address throws BEFORE any RPC)
//   - BITTENSOR_RPC_FAILED   — BittensorRpcError rethrown by tao-rpc-client
//   - INTERNAL_ERROR         — defensive catch-all

import {
  BittensorRpcError,
  alphaToTaoEquivRao,
  getAlphaPriceForNetuid,
  getFreeBalance,
  getStakeInfo,
  _taoRpcInternals,
} from "../chains/bittensor/tao-rpc-client.js";
import { assertSs58Address } from "../chains/bittensor/types.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns free + staked TAO balance for a Bittensor coldkey (SS58 prefix-42 address). Free balance comes from system.account.data.free (RAO, 9 decimals); staked is the per-position alpha summed into a TAO-equivalent via the per-subnet chain price.",
  "Uses the configured subtensor RPC (BITTENSOR_RPC_URL override, else the public Finney fallback).",
  "Use this when the user asks about a TAO balance specifically. Use get_bittensor_stake for the per-(hotkey,netuid) alpha breakdown (the source-of-truth positions). Staked here is a TAO-EQUIVALENT estimate — alpha priced to TAO via the subnet AMM, subject to slippage.",
  "`wallet` is REQUIRED — SS58 \"5…\" prefix-42 address. Rejected via the full blake2-256 checksum gate (assertSs58Address) BEFORE any RPC round-trip.",
  "Decimal strings cross the boundary, never numbers — RAO as STRING preserves the u128 range; TAO as DECIMAL STRING preserves precision through any downstream math.",
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

interface BittensorBalanceResult {
  wallet: string;
  /** u128 free RAO as a decimal string. 1 TAO = 1_000_000_000 RAO. */
  freeRao: string;
  /** Free balance as a decimal-string TAO amount. */
  freeTao: string;
  /** TAO-EQUIVALENT of summed per-position alpha (derived via chain price). */
  stakedTaoEquiv: string;
  decimals: 9;
  symbol: "TAO";
}

registerTool(
  "get_bittensor_balance",
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

    // V5 Input Validation: full prefix-42 checksum gate BEFORE any RPC. A
    // wrong-checksum / look-alike address throws here; no getApi() call.
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
      const { freeRao, freeTao } = await getFreeBalance(
        wallet as Parameters<typeof getFreeBalance>[0],
      );
      const rows = await getStakeInfo(
        wallet as Parameters<typeof getStakeInfo>[0],
      );

      // Sum each position's alpha → TAO-equiv via the per-netuid price. We
      // memoize the price per netuid so multiple positions on the same
      // subnet incur one price round-trip.
      const priceByNetuid = new Map<number, bigint>();
      let stakedTaoEquivRao = 0n;
      for (const row of rows) {
        let price = priceByNetuid.get(row.netuid);
        if (price === undefined) {
          price = await getAlphaPriceForNetuid(row.netuid);
          priceByNetuid.set(row.netuid, price);
        }
        stakedTaoEquivRao += alphaToTaoEquivRao(row.alphaRao, price);
      }

      const stakedTaoEquiv = _taoRpcInternals.formatRaoToTao(stakedTaoEquivRao);

      const result: BittensorBalanceResult = {
        wallet,
        freeRao: freeRao.toString(),
        freeTao,
        stakedTaoEquiv,
        decimals: 9,
        symbol: "TAO",
      };

      return {
        content: [
          {
            type: "text",
            text: `${wallet} holds ${freeTao} TAO free (${freeRao.toString()} RAO) + ~${stakedTaoEquiv} TAO-equivalent staked (alpha priced to TAO across ${rows.length} position${rows.length === 1 ? "" : "s"}; see get_bittensor_stake for the per-position alpha breakdown)`,
          },
        ],
        structuredContent: { ...result },
      };
    } catch (err) {
      if (err instanceof BittensorRpcError) {
        return {
          content: [
            {
              type: "text",
              text: `error: failed to read TAO balance for ${wallet}: ${err.message}`,
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
            text: `error: failed to read TAO balance for ${wallet}: ${message}`,
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
