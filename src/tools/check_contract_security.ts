// MCP tool: check_contract_security({ address }) — Plan 07-04 / READ-21.
//
// Defensive read tool: surfaces Etherscan-backed verification status +
// deployment age + privileged-role enumeration + proxy state BEFORE the
// user signs `prepare_*` against an unfamiliar contract.
//
// Routing intent (tool description): "Call BEFORE prepare_aave_supply /
// prepare_token_approve / prepare_token_send for an unfamiliar contract."
// The companion `vaultpilot-preflight` skill (v1.3 / Phase 9) will route
// the agent through this tool as part of its Step 0 self-check.
//
// Best-effort surfacing — Etherscan API failures return INTERNAL_ERROR
// (NOT `verified: false`). The agent sees the failure mode, not a fake
// "unverified" answer. T-ETHERSCAN-MASK-1 mitigation.
//
// Q-CONFIG-LEAK extension: missing API key → INTERNAL_ERROR envelope
// with cause naming the env var + signup URL; the key value is never
// echoed. Per-session rate limit (5 calls/session) returns
// INTERNAL_ERROR with cause "rate-limit".

import { type Address, getAddress, isAddress } from "viem";

import {
  checkContractSecurity as etherscanCheckContractSecurity,
} from "../clients/etherscan.js";
import { getEtherscanApiKey } from "../config/env.js";
import { makeStructuredError } from "../signing/error-codes.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Read contract security signals for an Ethereum mainnet address — verification status, deployment age, privileged-role enumeration, proxy state.",
  "Call BEFORE prepare_aave_supply / prepare_token_approve / prepare_token_send for an unfamiliar contract; surfaces red flags (unverified source, recent deployment, owner-only mint / pause functions, AccessControl admin role).",
  "Returns `{ chain: \"ethereum\", address, verified, proxy?, implementation?, contractName?, compilerVersion?, creatorAddress?, creationTxHash?, ageDays?, privilegedFunctions?, accessControlMarkers? }`. Unverified contracts return `{ verified: false }` with no further detail.",
  "Best-effort surfacing — Etherscan API failures return an INTERNAL_ERROR envelope (NOT a fake `verified: false`); the agent sees the failure mode.",
  "Proxy contracts: `proxy: true` + `implementation` address surfaced as separate fields. Aave V3 Pool itself is a proxy — chain-check the implementation separately if uncertain.",
  "Privileged-role enumeration: scans the verified ABI for owner-only / admin-only functions (`upgradeTo`, `setAdmin`, `transferOwnership`, `pause`, `mint`, etc.) and AccessControl markers (`hasRole`, `DEFAULT_ADMIN_ROLE`, `grantRole`, etc.). Surfaced as TWO arrays — `privilegedFunctions` for name-pattern matches, `accessControlMarkers` for interface markers.",
  "Per-session rate limit: 5 calls per agent session. Beyond that, returns INTERNAL_ERROR with cause `rate-limit`; resets at MCP server restart. Etherscan free tier allows 100k/day across all chains; raise via paid plan if needed.",
  "Requires `ETHERSCAN_API_KEY` env var. Missing → INTERNAL_ERROR envelope naming the env var + https://etherscan.io/apis signup URL (free tier; 5 req/sec, 100k req/day; one key works across all chains).",
  "Failure modes: INVALID_INPUT (malformed address), INTERNAL_ERROR (missing API key OR Etherscan API failure OR rate-limit exceeded — `cause` field carries the specific reason).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    address: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Ethereum mainnet contract address (0x-prefixed, 40 hex chars). Mixed case accepted; checksum is normalized.",
    },
  },
  required: ["address"],
  additionalProperties: false,
};

interface CheckContractSecurityOk {
  chain: "ethereum";
  address: Address;
  verified: true;
  proxy: boolean;
  implementation?: Address;
  contractName: string;
  compilerVersion: string;
  creatorAddress: Address;
  creationTxHash: string;
  ageDays: number | "unknown";
  privilegedFunctions: string[];
  accessControlMarkers: string[];
}

interface CheckContractSecurityNotVerified {
  chain: "ethereum";
  address: Address;
  verified: false;
}

registerTool(
  "check_contract_security",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
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

      const result = await etherscanCheckContractSecurity(address, apiKey);

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
        const sc: CheckContractSecurityNotVerified = {
          chain: "ethereum",
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

      if (result.kind === "not-applicable") {
        // Defensive — checkContractSecurity returns this only for null
        // address, and we passed a validated non-null address above.
        const sc: CheckContractSecurityNotVerified = {
          chain: "ethereum",
          address,
          verified: false,
        };
        return {
          content: [{ type: "text", text: `${address}: not-applicable.` }],
          structuredContent: { ...sc },
        };
      }

      // kind === "ok" — verified contract; surface all fields.
      const sc: CheckContractSecurityOk = {
        chain: "ethereum",
        address,
        verified: true,
        proxy: result.proxy,
        implementation: result.implementation,
        contractName: result.contractName,
        compilerVersion: result.compilerVersion,
        creatorAddress: result.creatorAddress,
        creationTxHash: result.creationTxHash,
        ageDays: result.ageDays,
        privilegedFunctions: result.privilegedFunctions,
        accessControlMarkers: result.accessControlMarkers,
      };

      const lines: string[] = [];
      const ageSuffix =
        result.ageDays === "unknown" ? "age unknown" : `age ${result.ageDays} days`;
      lines.push(
        `${address}: verified${result.proxy ? " (proxy)" : ""}; ${result.contractName}; compiler ${result.compilerVersion}; ${ageSuffix}`,
      );
      if (result.proxy && result.implementation) {
        lines.push(`  implementation: ${result.implementation}`);
      }
      if (result.privilegedFunctions.length > 0) {
        lines.push(`  privileged: ${result.privilegedFunctions.join(", ")}`);
      }
      if (result.accessControlMarkers.length > 0) {
        lines.push(`  accessControl: ${result.accessControlMarkers.join(", ")}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { ...sc },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: check_contract_security failed: ${message}`,
          },
        ],
        structuredContent: {
          ...makeStructuredError(
            "INTERNAL_ERROR",
            "check_contract_security failed",
            message,
          ),
        },
      };
    }
  },
);
