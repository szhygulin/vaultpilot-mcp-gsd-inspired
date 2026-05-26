// MCP tool: get_contract_abi({ chain, address }) — Phase 35 Plan 35-01 (CUSTOM-02).
//
// Etherscan-sourced verified-ABI fetcher. Thin wrapper over
// `src/clients/etherscan.ts:fetchEtherscanAbi` that surfaces the 4-arm
// discriminated union to the agent: ok | not-verified | rate-limited | error.
//
// Routing intent (tool description): "Call BEFORE read_contract /
// prepare_custom_call when the agent needs ABI-driven decode at preview
// time." The per-session ABI cache populated by this call survives across
// read_contract (Plan 35-02) and prepare_custom_call (Plan 35-03) within
// the same session.
//
// No handle, no `prepareReceipt`, no state mutation. Read-only.
//
// Mirrors check_contract_security's error-arm shapes verbatim — same
// INTERNAL_ERROR envelope shape for rate-limit, etherscan-unreachable,
// and missing API key paths. Verification-status semantics mirror
// check_contract_security: `verified: true` + ABI surfaced, OR
// `verified: false` with no further detail.

import { type Address, getAddress, isAddress } from "viem";

import { fetchEtherscanAbi } from "../clients/etherscan.js";
import {
  chainIdFromName,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { getEtherscanApiKey } from "../config/env.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Fetch the verified ABI for a contract address from Etherscan V2. Multi-chain — works on all 5 supported chains (ethereum, arbitrum, polygon, base, optimism).",
  "Call BEFORE read_contract or prepare_custom_call when the agent needs ABI-driven decode at preview time. The per-session ABI cache populated by this call survives across read_contract and prepare_custom_call within the same session (resets at MCP server restart).",
  "Returns `{ chain, chainId, address, verified, abi?, sourceCodeUrl? }`. On verified contracts, `abi` is a parsed JSON array and `sourceCodeUrl` points to the block explorer's source-code view. On unverified contracts, only `{ chain, chainId, address, verified: false }`.",
  "Per-session rate limit (shared with check_contract_security): 5 calls per agent session across all chains. Beyond that, returns INTERNAL_ERROR with cause `rate-limit`; resets at MCP server restart. Etherscan free tier allows 100k/day across all chains; raise via paid plan if needed.",
  "Requires `ETHERSCAN_API_KEY` env var. Missing → INTERNAL_ERROR envelope naming the env var + https://etherscan.io/apis signup URL (free tier; 5 req/sec, 100k req/day; one key works across all chains).",
  "Failure modes: INVALID_INPUT (malformed chain / address), INTERNAL_ERROR (missing API key OR Etherscan API failure OR rate-limit exceeded — `cause` field carries the specific reason).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description: "Chain identifier (required).",
    },
    address: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Contract address (0x-prefixed, 40 hex chars). Mixed case accepted; checksum is normalized.",
    },
  },
  required: ["chain", "address"],
  additionalProperties: false,
};

interface GetContractAbiVerified {
  chain: ChainName;
  chainId: ChainId;
  address: Address;
  verified: true;
  abi: unknown[]; // parsed viem.Abi — typed as unknown[] in the structured surface
  sourceCodeUrl: string;
}

interface GetContractAbiNotVerified {
  chain: ChainName;
  chainId: ChainId;
  address: Address;
  verified: false;
}

registerTool(
  "get_contract_abi",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const chainName = args.chain as ChainName;
      const chainId = chainIdFromName(chainName);

      const addressRaw = args.address;
      if (
        typeof addressRaw !== "string" ||
        !isAddress(addressRaw, { strict: false })
      ) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'address': expected 0x-prefixed 20-byte hex, got "${String(addressRaw)}"`,
            },
          ],
          structuredContent: {
            ...makeStructuredError(
              "INVALID_INPUT",
              `address must be a 0x-prefixed 40-hex-character Ethereum address; got "${String(addressRaw)}"`,
            ),
          },
        };
      }

      const address: Address = getAddress(addressRaw);

      const apiKey = getEtherscanApiKey();
      if (apiKey === undefined) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: ETHERSCAN_API_KEY not set. Register at https://etherscan.io/apis (free; 5 req/sec, 100k req/day; one key works across all chains).",
            },
          ],
          structuredContent: {
            ...makeStructuredError(
              "INTERNAL_ERROR",
              "ETHERSCAN_API_KEY not set",
              "register at https://etherscan.io/apis (free; 5 req/sec, 100k req/day; one key works across all chains)",
            ),
          },
        };
      }

      const result = await fetchEtherscanAbi(chainId, address, apiKey);

      if (result.kind === "rate-limited") {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${result.message}` }],
          structuredContent: {
            ...makeStructuredError("INTERNAL_ERROR", result.message, "rate-limit"),
          },
        };
      }

      if (result.kind === "error") {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${result.message}` }],
          structuredContent: {
            ...makeStructuredError(
              "INTERNAL_ERROR",
              result.message,
              "etherscan-unreachable",
            ),
          },
        };
      }

      if (result.kind === "not-verified") {
        const sc: GetContractAbiNotVerified = {
          chain: chainName,
          chainId,
          address,
          verified: false,
        };
        return {
          content: [
            {
              type: "text",
              text: `${address}: NOT verified on Etherscan.`,
            },
          ],
          structuredContent: { ...sc },
        };
      }

      // kind === "ok"
      const sc: GetContractAbiVerified = {
        chain: chainName,
        chainId,
        address,
        verified: true,
        abi: result.abi as unknown[],
        sourceCodeUrl: result.sourceCodeUrl,
      };
      return {
        content: [
          {
            type: "text",
            text: `${address}: verified. ABI fetched (${result.abi.length} entries). Source: ${result.sourceCodeUrl}`,
          },
        ],
        structuredContent: { ...sc },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: get_contract_abi failed: ${message}`,
          },
        ],
        structuredContent: {
          ...makeStructuredError("INTERNAL_ERROR", "get_contract_abi failed", message),
        },
      };
    }
  },
);
