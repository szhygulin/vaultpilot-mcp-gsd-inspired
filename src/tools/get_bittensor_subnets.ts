// src/tools/get_bittensor_subnets.ts — Phase 46 Plan 46-03 (TAO-R-03).
//
// Subnet enumeration via the decoded subnetInfoRuntimeApi.getAllDynamicInfo
// runtime API. One call returns every netuid with its on-chain name +
// token symbol (byte arrays decoded to UTF-8 strings), the AMM reserves
// (taoIn / alphaIn, RAO → decimal-string TAO/alpha), and the derived alpha
// price (1e9-scaled fixed-point).
//
// No required args — enumerates all subnets.
//
// Locked errorCode set:
//   - BITTENSOR_RPC_FAILED — BittensorRpcError rethrown by tao-rpc-client
//   - INTERNAL_ERROR       — defensive catch-all

import {
  BittensorRpcError,
  getSubnets,
} from "../chains/bittensor/tao-rpc-client.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Enumerates all Bittensor subnets via the decoded subnetInfoRuntimeApi.getAllDynamicInfo runtime API. Each subnet row carries netuid, the on-chain name + token symbol (byte arrays decoded to UTF-8), the AMM reserves (taoIn in TAO, alphaIn in ALPHA — both decimal strings), and the derived alpha price.",
  "Uses the configured subtensor RPC (BITTENSOR_RPC_URL override, else the public Finney fallback). Single decoded round-trip.",
  "Use this when the user wants the subnet list (which netuids exist, their names/symbols, their liquidity). Use get_bittensor_validators for the validator hotkeys within a specific subnet.",
  "No arguments — enumerates every subnet.",
  "Reserve amounts are decimal strings labeled with their token (TAO vs the per-subnet ALPHA); the alpha price is a 1e9-scaled fixed-point RAO-per-alpha value.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

registerTool(
  "get_bittensor_subnets",
  DESCRIPTION,
  INPUT_SCHEMA,
  async () => {
    try {
      const subnets = await getSubnets();

      const lines: string[] = [];
      if (subnets.length === 0) {
        lines.push("No subnets returned by the subtensor runtime.");
      } else {
        lines.push(`${subnets.length} Bittensor subnet${subnets.length === 1 ? "" : "s"}:`);
        for (const s of subnets) {
          const name = s.name || "(unnamed)";
          const symbol = s.symbol || "?";
          lines.push(
            `  netuid ${s.netuid} · ${name} [${symbol}] · reserves ${s.taoIn} TAO / ${s.alphaIn} ${symbol}`,
          );
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: {
          subnetCount: subnets.length,
          subnets: subnets.map((s) => ({
            netuid: s.netuid,
            name: s.name,
            symbol: s.symbol,
            taoIn: s.taoIn,
            taoInUnit: "TAO",
            alphaIn: s.alphaIn,
            alphaInUnit: "ALPHA",
            // 1e9-scaled fixed-point RAO-per-alpha; string to preserve u128.
            alphaPriceRaw: s.alphaPriceRaw.toString(),
          })),
        },
      };
    } catch (err) {
      if (err instanceof BittensorRpcError) {
        return {
          content: [
            {
              type: "text",
              text: `error: failed to enumerate Bittensor subnets: ${err.message}`,
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
            text: `error: failed to enumerate Bittensor subnets: ${message}`,
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
