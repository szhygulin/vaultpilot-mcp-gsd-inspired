// MCP tool: read_contract({ chain, address, functionName, args }) — Phase 35 Plan 35-02 (CUSTOM-03).
//
// ABI-driven `eth_call` for view/pure functions on any verified contract on
// the 5 supported chains. Composes:
//   1. `fetchEtherscanAbi` (Plan 35-01) for the ABI (per-session cache wins on
//      second call against the same `${chainId}:${address}` key).
//   2. Runtime stateMutability gate — refuses any function whose ABI entry is
//      NOT `view` or `pure`. State-mutating intent routes to `prepare_custom_call`.
//   3. `viem.encodeFunctionData` → low-level `publicClient.call({ to, data })`
//      → `viem.decodeFunctionResult`. Low-level call (NOT `viem.readContract`)
//      is explicit per 35-CONTEXT for fine-grained error-arm control: ABI
//      errors, RPC errors, decode errors all surface distinctly.
//
// Routing intent: "Read any verified-contract view/pure function across all
// 5 chains; use BEFORE `prepare_custom_call` if you need ABI-driven decode
// at preview time (per-session ABI cache is shared across read_contract,
// get_contract_abi, prepare_custom_call within a session)."
//
// NO blind-call fallback when ABI is unavailable — surface the verbatim
// refusal (35-CONTEXT lock: "absence of ABI is itself meaningful information
// for the user, not a degraded-mode signal"). NO 4byte selector fallback.
//
// `NON_VIEW_FUNCTION` (this plan) refuses state-mutating intent; the agent
// is directed to `prepare_custom_call` (which BYPASSES canonical-dispatch and
// requires the load-bearing `acknowledgeNonProtocolTarget: true` flag).
//
// `ABI_NOT_AVAILABLE` (Plan 35-01) covers the "verified contract is missing
// the requested function from its ABI" case and the not-verified arm.

import {
  type Address,
  type Hex,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddress,
} from "viem";

import { getChainClient } from "../chains/registry.js";
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
  "Read any view/pure function on a verified contract across the 5 supported chains (ethereum, arbitrum, polygon, base, optimism). ABI-driven encode + low-level `eth_call` + decode — refuses state-mutating functions at runtime.",
  "Call BEFORE `prepare_custom_call` when the agent needs ABI-driven decode at preview time. The per-session ABI cache populated by this call survives across `get_contract_abi` and `prepare_custom_call` within a session (resets at MCP server restart).",
  "`chain` + `address` + `functionName` are required; `args` is an array (default []). Returns `{ chain, chainId, address, functionName, decoded, sourceCodeUrl }`. The `decoded` value is the raw viem decode result — bigint values are serialized to strings in the content text for renderability.",
  "Refusals: `NON_VIEW_FUNCTION` if the function's stateMutability is `nonpayable` or `payable` — the refusal directs the agent to `prepare_custom_call` for state-mutating intent. `ABI_NOT_AVAILABLE` if the function is not present in the ABI, or the contract is not verified on Etherscan. `INTERNAL_ERROR` (with `cause`) on Etherscan rate-limit / network failure, RPC failure, or missing ETHERSCAN_API_KEY.",
  "Requires `ETHERSCAN_API_KEY` env var (https://etherscan.io/apis; free tier; 5 req/sec, 100k req/day; one key works across all chains). Etherscan per-session rate limit: 5 calls per agent session SHARED with `check_contract_security` + `get_contract_abi`.",
  "Uses low-level `publicClient.call({ to, data })` (NOT the high-level viem contract-read action) for fine-grained error-arm control. NO blind-call fallback when ABI is unavailable: absence of ABI is itself meaningful information for the user.",
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
    functionName: {
      type: "string",
      description: "Name of the view/pure function on the contract.",
    },
    args: {
      type: "array",
      items: {},
      default: [],
      description:
        "Function args (default []). Element types must match the ABI parameter types — viem encodes strictly.",
    },
  },
  required: ["chain", "address", "functionName"],
  additionalProperties: false,
};

interface ReadContractOk {
  chain: ChainName;
  chainId: ChainId;
  address: Address;
  functionName: string;
  decoded: unknown;
  sourceCodeUrl: string;
}

/**
 * Serialize bigints (and other non-JSON-native values) to strings for the
 * MCP `content.text` rendering. `decoded` in `structuredContent` keeps the
 * raw value — only the human-renderable text needs the conversion.
 */
function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "bigint") return v.toString();
    return v;
  });
}

interface AbiFunctionEntry {
  type: "function";
  name?: string;
  inputs?: unknown[];
  outputs?: unknown[];
  stateMutability?: string;
}

registerTool(
  "read_contract",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (rawArgs) => {
    try {
      const chainName = rawArgs.chain as ChainName;
      const chainId = chainIdFromName(chainName);

      const addressRaw = rawArgs.address;
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

      const functionNameRaw = rawArgs.functionName;
      if (typeof functionNameRaw !== "string" || functionNameRaw.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'functionName': expected non-empty string, got "${String(functionNameRaw)}"`,
            },
          ],
          structuredContent: {
            ...makeStructuredError(
              "INVALID_INPUT",
              `functionName must be a non-empty string; got "${String(functionNameRaw)}"`,
            ),
          },
        };
      }
      const functionName: string = functionNameRaw;

      const callArgsRaw = rawArgs.args;
      const callArgs: unknown[] = Array.isArray(callArgsRaw) ? callArgsRaw : [];

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

      // Step 1 — ABI fetch (per-session cache wins on second call).
      const abiResult = await fetchEtherscanAbi(chainId, address, apiKey);

      if (abiResult.kind === "rate-limited") {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${abiResult.message}` }],
          structuredContent: {
            ...makeStructuredError("INTERNAL_ERROR", abiResult.message, "rate-limit"),
          },
        };
      }

      if (abiResult.kind === "error") {
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${abiResult.message}` }],
          structuredContent: {
            ...makeStructuredError(
              "INTERNAL_ERROR",
              abiResult.message,
              "etherscan-unreachable",
            ),
          },
        };
      }

      if (abiResult.kind === "not-verified") {
        // NO blind-call fallback — surface the verbatim refusal.
        const msg = "Contract source code not verified";
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: {
            ...makeStructuredError("INTERNAL_ERROR", msg, "abi-not-verified"),
          },
        };
      }

      // kind === "ok"
      const abi = abiResult.abi;

      // Step 2 — locate ABI entry + state-mutability gate.
      const entry = (abi as unknown as AbiFunctionEntry[]).find(
        (e) => e.type === "function" && e.name === functionName,
      );

      if (entry === undefined) {
        const msg = `function not found in ABI: ${functionName}`;
        return {
          isError: true,
          content: [{ type: "text", text: `error: ${msg}` }],
          structuredContent: {
            ...makeStructuredError("ABI_NOT_AVAILABLE", msg),
          },
        };
      }

      const mutability = entry.stateMutability;
      if (mutability !== "view" && mutability !== "pure") {
        const text = `error: read_contract refuses non-view function "${functionName}" (stateMutability: ${String(mutability)}). Use prepare_custom_call for state-mutating calls.`;
        return {
          isError: true,
          content: [{ type: "text", text }],
          structuredContent: {
            ...makeStructuredError(
              "NON_VIEW_FUNCTION",
              `function ${functionName} is ${String(mutability)}; not callable via read_contract`,
              "use prepare_custom_call for state-mutating calls",
            ),
          },
        };
      }

      // Step 3 — encode + low-level call + decode.
      // viem.encodeFunctionData throws on type-mismatched args / unknown
      // functionName / wrong-arity. wrap in try/catch — surface verbatim.
      let data: Hex;
      try {
        data = encodeFunctionData({
          abi,
          functionName,
          args: callArgs,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to encode call to ${functionName}: ${message}`,
            },
          ],
          structuredContent: {
            ...makeStructuredError(
              "INVALID_INPUT",
              `failed to encode call to ${functionName}`,
              message,
            ),
          },
        };
      }

      const client = getChainClient(chainId);

      let returnData: Hex | undefined;
      try {
        const callResult = await client.call({ to: address, data });
        returnData = callResult.data;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: eth_call to ${address}.${functionName}() failed: ${message}`,
            },
          ],
          structuredContent: {
            ...makeStructuredError(
              "INTERNAL_ERROR",
              `eth_call to ${address}.${functionName}() failed`,
              message,
            ),
          },
        };
      }

      let decoded: unknown;
      try {
        decoded = decodeFunctionResult({
          abi,
          functionName,
          data: returnData ?? "0x",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: failed to decode result of ${functionName}: ${message}`,
            },
          ],
          structuredContent: {
            ...makeStructuredError(
              "INTERNAL_ERROR",
              `failed to decode result of ${functionName}`,
              message,
            ),
          },
        };
      }

      const sc: ReadContractOk = {
        chain: chainName,
        chainId,
        address,
        functionName,
        decoded,
        sourceCodeUrl: abiResult.sourceCodeUrl,
      };
      return {
        content: [
          {
            type: "text",
            text: `${address}.${functionName}() → ${safeStringify(decoded)}`,
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
            text: `error: read_contract failed: ${message}`,
          },
        ],
        structuredContent: {
          ...makeStructuredError("INTERNAL_ERROR", "read_contract failed", message),
        },
      };
    }
  },
);
