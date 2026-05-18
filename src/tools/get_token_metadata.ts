// get_token_metadata — agent-facing decimals + symbol + name lookup.
//
// Phase 6 — Plan 06-01. Cache-first against the in-tree top-50 Ethereum
// registry (src/tokens/registry.ts); live RPC fallback via viem
// `erc20Abi.decimals/symbol/name` on cache miss. Agent calls this BEFORE
// prepare_token_send / prepare_token_approve / prepare_weth_unwrap (06-02 /
// 03 / 04) to resolve decimals so decimal-string amounts can be parsed
// strictly via parseAmountStrict.
//
// Trust boundary (threat model § T-METADATA-DRIFT-1): the cache hits ONLY on
// canonical checksummed addresses. An off-list malicious clone falls through
// to live RPC and returns the attacker-controlled symbol() / name(). This is
// a labeling concern, not a signing concern — the cryptographic-binding
// pipeline pins the address byte-for-byte via payloadFingerprint, and the
// user sees the address in PREPARE RECEIPT on Ledger. Documented residual in
// SECURITY.md; companion preflight skill (v1.3) cross-checks token metadata
// against a curated source.

import { type Address, erc20Abi, getAddress, isAddress } from "viem";

import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { chainIdFromName, type ChainName } from "../config/contracts.js";
import { loadTokenRegistry } from "../tokens/registry.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Read ERC-20 metadata (`decimals`, `symbol`, `name`) for a token contract on a supported EVM chain.",
  "Call BEFORE prepare_token_send / prepare_token_approve / prepare_weth_unwrap (Phase 6) so the agent has the authoritative `decimals` needed to convert a decimal-string amount (e.g. \"100.5\") to the bigint atomic value the signing flow expects — off-by-decimal is the most common user-facing bug class.",
  "Do NOT call this for a token whose decimals you already have cached from a prior call in the same session — the registry path is free but the live-RPC fallback is not.",
  "`chain` is REQUIRED — pass one of ethereum, arbitrum, polygon, base, optimism. Phase 6 shipped `chain: \"ethereum\"`; Phase 8 widened the enum to the canonical 5-chain set.",
  "Returns `{ decimals, symbol, name, rpcDegraded? }`. The Ethereum top-50 registry (USDC, WETH, etc.) hits the cache without an RPC call; off-list tokens (and ALL tokens on non-Ethereum chains in v1.2-Plan-08-02 ship state) fall through to a live `decimals()`/`symbol()`/`name()` read in parallel. Plan 08-03 lands per-chain top-50 JSON files.",
  "Failure modes: INVALID_INPUT for a malformed address, INTERNAL_ERROR with `rpcDegraded: true` when the live RPC reads throw (off-list token + PublicNode flake).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description:
        "Chain identifier (required). Supported: ethereum, arbitrum, polygon, base, optimism.",
    },
    address: {
      type: "string",
      description:
        "ERC-20 token contract address (0x-prefixed, 40 hex chars). Mixed case accepted; checksum is normalized.",
      pattern: "^0x[0-9a-fA-F]{40}$",
    },
  },
  required: ["chain", "address"],
  additionalProperties: false,
};

interface TokenMetadataResult {
  decimals: number;
  symbol: string;
  name: string;
  rpcDegraded?: true;
}

registerTool("get_token_metadata", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // Phase 8 — Plan 08-02: chainId from the agent's `chain` enum (JSON-schema
  // gate rejects invalid values at the dispatch boundary; the in-handler
  // re-validation in Phase 6 is no longer load-bearing post-widening).
  const chainName = args.chain as ChainName;
  const chainId = chainIdFromName(chainName);

  const addressRaw = args.address;
  if (typeof addressRaw !== "string" || !isAddress(addressRaw, { strict: false })) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: invalid 'address': expected 0x-prefixed 20-byte hex, got "${String(addressRaw)}"`,
        },
      ],
      structuredContent: {
        errorCode: "INVALID_INPUT",
        message: `address must be a valid 0x-prefixed Ethereum address; got "${String(addressRaw)}"`,
      },
    };
  }

  const address: Address = getAddress(addressRaw);

  // Cache-first path: per-chain top-50 registry. Checksum-strict equality —
  // case mismatch (already normalized by getAddress above) and off-list
  // addresses both miss. Phase 8 — Plan 08-02: only chainId=1 has a populated
  // registry in v1.2-Plan-08-02 ship state; non-Ethereum chains return [] from
  // loadTokenRegistry and fall through to the live-RPC reads below.
  const registry = loadTokenRegistry(chainId);
  const cached = registry.find((entry) => entry.address === address);
  if (cached) {
    const result: TokenMetadataResult = {
      decimals: cached.decimals,
      symbol: cached.symbol,
      name: cached.name,
    };
    if (isPublicNodeFallback(chainId)) result.rpcDegraded = true;
    return {
      content: [
        {
          type: "text",
          text: `${address}: ${cached.name} (${cached.symbol}, decimals=${cached.decimals})`,
        },
      ],
      structuredContent: { ...result },
    };
  }

  // Cache miss: parallel live RPC reads. T-RPC-METADATA-FAIL-1 mitigation —
  // graceful degradation on PublicNode flake (rpcDegraded surfaced so the
  // agent / user knows to set the chain-specific RPC URL).
  const client = getChainClient(chainId);
  try {
    const [decimals, symbol, name] = await Promise.all([
      client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address, abi: erc20Abi, functionName: "name" }),
    ]);
    const result: TokenMetadataResult = { decimals, symbol, name };
    if (isPublicNodeFallback(chainId)) result.rpcDegraded = true;
    return {
      content: [
        {
          type: "text",
          text: `${address}: ${name} (${symbol}, decimals=${decimals})`,
        },
      ],
      structuredContent: { ...result },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: failed to read ERC-20 metadata for ${address}: ${message}`,
        },
      ],
      structuredContent: {
        errorCode: "INTERNAL_ERROR",
        message: `failed to read ERC-20 metadata for ${address}`,
        cause: message,
        rpcDegraded: true,
      },
    };
  }
});
