// src/tools/get_safe_transaction.ts
//
// Phase 36 Plan 36-02 (SAFE-02) — MCP tool:
// get_safe_transaction({ chain, safeAddress, safeTxHash }).
//
// Read full Safe Tx detail by safeTxHash + best-effort calldata decode via
// Phase 35's process-local ABI cache (`getCachedEtherscanAbi`). The decode
// path is CACHE-ONLY — zero network I/O from inside this tool. Cache MISS
// (or non-ok arm) surfaces `decodedOperation: null` per CONTEXT lock; the
// agent can populate the cache by calling `get_contract_abi` before this
// tool to get a richer decoded surface.
//
// Operation discriminator (CONTEXT lock + Phase 38 hard-trigger contract):
// `operation: "call" | "delegatecall"` as a semantic STRING — NOT the raw
// 0/1 numeric. Phase 38's enableModule + delegateCall hard-trigger reads
// this field; downstream consumers must not need to know the numeric encoding.
//
// Pitfall 6 anchor: `tx.confirmations` is OPTIONAL on the wire. Defensive
// `tx.confirmations ?? []` at every access site (one `.length` access, one
// `.map(...)` access). Pitfall 3 anchor: every numeric-string field (`value`,
// `safeTxGas`, `baseGas`, `gasPrice`, `nonce`) is preserved as a STRING — no
// bigint coercion in the response shape.

import {
  decodeFunctionData,
  isAddress,
  isHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import * as safeTxService from "../clients/safe-tx-service.js";
import { getCachedEtherscanAbi } from "../clients/etherscan.js";
import {
  chainIdFromName,
  type ChainId,
  type ChainName,
} from "../config/contracts.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Read the full Safe multisig transaction detail by safeTxHash on a supported EVM chain.",
  "Use this AFTER `get_safe_positions` surfaces a `pendingTransactions[].safeTxHash` and the user (or agent) wants to inspect the full payload — to + value + data + operation + confirmations + decodedOperation.",
  "Do NOT use for proposing or signing — that arrives in Phase 37 (`prepare_safe_tx_approve` / `prepare_safe_tx_execute`). This is a READ tool only.",
  "Returns `{ chain, chainId, safe, safeTxHash, to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce, collectedSignatures, requiredSignatures, isExecutable, confirmations, decodedOperation }`.",
  "`operation` is a SEMANTIC STRING (`\"call\" | \"delegatecall\"`) — NOT the raw 0/1 numeric. Phase 38's enableModule + delegateCall hard-trigger reads this field.",
  "`decodedOperation` is best-effort: returns `\"<functionName>(<arg1>, <arg2>, ...)\"` when the Phase 35 per-session ABI cache has a verified ABI for the `to` address; returns `null` on cache MISS (no blocking Etherscan probe — call `get_contract_abi` first to populate the cache for a richer decode).",
  "Numeric fields (`value`, `safeTxGas`, `baseGas`, `gasPrice`, `nonce`) are preserved as DECIMAL STRINGS over the wire — Safe Tx Service uses string encoding for uint256 precision.",
  "All three arguments REQUIRED: `chain` (one of ethereum/arbitrum/polygon/base/optimism), `safeAddress` (0x-prefixed 20-byte EVM address), `safeTxHash` (0x-prefixed 32-byte hex).",
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
    safeAddress: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "Safe Singleton proxy address (0x-prefixed, 20 bytes).",
    },
    safeTxHash: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{64}$",
      description: "Safe transaction hash (0x-prefixed, 32 bytes).",
    },
  },
  required: ["chain", "safeAddress", "safeTxHash"],
  additionalProperties: false,
};

interface ConfirmationSurface {
  owner: Address;
  signature: string;
  signatureType: string;
}

interface SafeTransactionResult {
  chain: ChainName;
  chainId: number;
  safe: Address;
  safeTxHash: string;
  to: Address;
  value: string;
  data: Hex;
  operation: "call" | "delegatecall";
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: Address;
  refundReceiver: Address;
  nonce: string;
  collectedSignatures: number;
  requiredSignatures: number;
  isExecutable: boolean;
  confirmations: ConfirmationSurface[];
  decodedOperation: string | null;
}

/**
 * Best-effort calldata decode via Phase 35's CACHE-ONLY ABI lookup.
 *
 * CACHE-ONLY discipline (RESEARCH § A5 + CONTEXT lock + T-36-14 threat
 * mitigation): no network I/O from inside this tool. The Phase 35 cache is
 * process-local, populated only by explicit `get_contract_abi` calls. Cache
 * MISS → null surface (agent can populate by calling `get_contract_abi`
 * first). Non-ok cached arms (not-verified / rate-limited / error) also
 * surface null — the consumer doesn't care WHY decode failed, only that it
 * did. `viem.decodeFunctionData` may throw if the selector is not in the
 * cached ABI; the try/catch returns null in that case.
 */
function decodeSafeTxOperation(
  chainId: ChainId,
  to: Address,
  data: Hex,
): string | null {
  // Short-circuit before cache lookup — calldata too short to carry a selector
  // (4-byte selector = 10 hex chars including 0x prefix).
  if (data === "0x" || data.length < 10) return null;
  const cached = getCachedEtherscanAbi(chainId, to);
  if (!cached || cached.kind !== "ok") return null;
  try {
    const decoded = decodeFunctionData({ abi: cached.abi as Abi, data });
    const argsArr = decoded.args ?? [];
    const args = (argsArr as readonly unknown[]).map((a) => String(a)).join(", ");
    return `${decoded.functionName}(${args})`;
  } catch {
    return null;
  }
}

registerTool("get_safe_transaction", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // Defensive validation — INPUT_SCHEMA regex catches most cases at the
  // dispatch layer, but non-MCP-dispatch callers may bypass that gate.
  const chainArgRaw = args.chain;
  if (
    typeof chainArgRaw !== "string" ||
    !["ethereum", "arbitrum", "polygon", "base", "optimism"].includes(chainArgRaw)
  ) {
    return {
      content: [
        {
          type: "text",
          text: "error: `chain` must be one of ethereum, arbitrum, polygon, base, optimism",
        },
      ],
      isError: true,
    };
  }
  const chainName = chainArgRaw as ChainName;

  const safeAddressRaw = args.safeAddress;
  if (
    typeof safeAddressRaw !== "string" ||
    !isAddress(safeAddressRaw, { strict: false })
  ) {
    return {
      content: [
        {
          type: "text",
          text: "error: `safeAddress` must be a valid 0x-prefixed EVM address",
        },
      ],
      isError: true,
    };
  }

  const safeTxHashRaw = args.safeTxHash;
  if (
    typeof safeTxHashRaw !== "string" ||
    !isHex(safeTxHashRaw) ||
    safeTxHashRaw.length !== 66
  ) {
    return {
      content: [
        {
          type: "text",
          text: "error: `safeTxHash` must be a 0x-prefixed 32-byte hex string",
        },
      ],
      isError: true,
    };
  }
  const safeTxHash = safeTxHashRaw as Hex;

  const chainId = chainIdFromName(chainName);

  const txResult = await safeTxService.getMultisigTransaction(chainId, safeTxHash);

  if (txResult.kind === "unsupported-chain") {
    return {
      content: [
        {
          type: "text",
          text: `error: Safe Tx Service has no endpoint for chain ${chainName}`,
        },
      ],
      isError: true,
    };
  }
  if (txResult.kind === "not-found") {
    return {
      content: [
        {
          type: "text",
          text: `error: SafeTx hash ${safeTxHash} not registered in Tx Service`,
        },
      ],
      isError: true,
    };
  }
  if (txResult.kind === "rate-limited") {
    return {
      content: [
        {
          type: "text",
          text: `error: ${txResult.message}`,
        },
      ],
      isError: true,
    };
  }
  if (txResult.kind === "error") {
    return {
      content: [
        {
          type: "text",
          text: `error: ${txResult.message}`,
        },
      ],
      isError: true,
    };
  }

  const tx = txResult.tx;

  // Pitfall 6 — `confirmations` is OPTIONAL; defensive `?? []` at every site.
  const confirmationsRaw = tx.confirmations ?? [];
  const collectedSignatures = confirmationsRaw.length;
  const requiredSignatures = tx.confirmationsRequired;
  const isExecutable = collectedSignatures >= requiredSignatures;

  // Operation discriminator — CONTEXT lock. NOT raw 0/1 in the response.
  const operation: "call" | "delegatecall" =
    tx.operation === 1 ? "delegatecall" : "call";

  // Pitfall 3 — all numeric-string fields preserved verbatim.
  const data = ((tx.data ?? "0x") as Hex);
  const decodedOperation = decodeSafeTxOperation(
    chainId,
    tx.to as Address,
    data,
  );

  const result: SafeTransactionResult = {
    chain: chainName,
    chainId,
    safe: tx.safe as Address,
    safeTxHash: tx.safeTxHash,
    to: tx.to as Address,
    value: tx.value,
    data,
    operation,
    safeTxGas: tx.safeTxGas,
    baseGas: tx.baseGas,
    gasPrice: tx.gasPrice,
    gasToken: tx.gasToken as Address,
    refundReceiver:
      (tx.refundReceiver ?? "0x0000000000000000000000000000000000000000") as Address,
    nonce: tx.nonce,
    collectedSignatures,
    requiredSignatures,
    isExecutable,
    confirmations: confirmationsRaw.map((c) => ({
      owner: c.owner as Address,
      signature: c.signature,
      signatureType: c.signatureType,
    })),
    decodedOperation,
  };

  const summary = `Safe ${result.safe} tx ${result.safeTxHash} (${operation}, nonce=${result.nonce}) — ${collectedSignatures}/${requiredSignatures} signatures${isExecutable ? " [executable]" : ""}${decodedOperation ? ` — ${decodedOperation}` : ""}`;

  return {
    content: [{ type: "text", text: summary }],
    structuredContent: { ...result },
  };
});
