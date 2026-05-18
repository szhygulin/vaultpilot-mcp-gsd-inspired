import {
  type Hash,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  isHex,
} from "viem";

import { getChainClient, isPublicNodeFallback } from "../chains/registry.js";
import { chainIdFromName, type ChainName } from "../config/contracts.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Poll a supported EVM chain for the status of a transaction by hash, returning `{ status: \"pending\" | \"success\" | \"reverted\", blockNumber?, gasUsed? }`.",
  "Use this after the user asks \"did my tx land?\" or to check whether a previously submitted transaction has confirmed, succeeded, or reverted.",
  "`chain` is REQUIRED — pass one of ethereum, arbitrum, polygon, base, optimism. Tx hashes are not chain-portable; you must know which chain the tx was sent on.",
  "Pending detection uses a two-step lookup: `getTransactionReceipt` first, then `getTransaction` if the receipt isn't yet available — this distinguishes a tx still in the mempool (`pending`) from a hash the network has never seen (returns an error).",
  "`blockNumber` and `gasUsed` are only present once the receipt is available (success or reverted). Block number is a decimal string; gasUsed is a decimal string (wei units, not ETH).",
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
    txHash: {
      type: "string",
      description: "Ethereum-style transaction hash (0x-prefixed, 64 hex chars).",
      pattern: "^0x[0-9a-fA-F]{64}$",
    },
  },
  required: ["chain", "txHash"],
  additionalProperties: false,
};

interface TxStatusResult {
  status: "pending" | "success" | "reverted";
  blockNumber?: string;
  gasUsed?: string;
  rpcDegraded?: boolean;
}

function isReceiptNotFound(err: unknown): boolean {
  if (err instanceof TransactionReceiptNotFoundError) return true;
  // viem's BaseError chain may wrap the cause; tolerate either shape.
  const name = (err as { name?: unknown } | null)?.name;
  return name === "TransactionReceiptNotFoundError";
}

function isTxNotFound(err: unknown): boolean {
  if (err instanceof TransactionNotFoundError) return true;
  const name = (err as { name?: unknown } | null)?.name;
  return name === "TransactionNotFoundError";
}

registerTool("get_transaction_status", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // Phase 8 — Plan 08-02: chainId from the agent's `chain` enum.
  const chainName = args.chain as ChainName;
  const chainId = chainIdFromName(chainName);

  const raw = args.txHash;
  if (typeof raw !== "string" || !isHex(raw) || raw.length !== 66) {
    return {
      content: [
        { type: "text", text: "error: `txHash` must be a 0x-prefixed 32-byte hex string" },
      ],
      isError: true,
    };
  }
  const txHash = raw as Hash;

  const client = getChainClient(chainId);
  const degraded = isPublicNodeFallback(chainId);

  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    const result: TxStatusResult = {
      status: receipt.status, // viem maps 0x0/0x1 to "reverted" / "success"
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
    };
    if (degraded) result.rpcDegraded = true;
    return {
      content: [
        {
          type: "text",
          text: `tx ${txHash} ${result.status} in block ${result.blockNumber} (gasUsed=${result.gasUsed})`,
        },
      ],
      structuredContent: { ...result },
    };
  } catch (err) {
    if (!isReceiptNotFound(err)) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          { type: "text", text: `error: failed to read receipt for ${txHash}: ${message}` },
        ],
        isError: true,
      };
    }
  }

  // Receipt missing → distinguish mempool-pending from unknown-tx.
  try {
    await client.getTransaction({ hash: txHash });
    const result: TxStatusResult = { status: "pending" };
    if (degraded) result.rpcDegraded = true;
    return {
      content: [{ type: "text", text: `tx ${txHash} pending (in mempool, no receipt yet)` }],
      structuredContent: { ...result },
    };
  } catch (err) {
    if (isTxNotFound(err)) {
      return {
        content: [
          {
            type: "text",
            text: `error: tx ${txHash} not found — the network has no record of this hash (never submitted, dropped from mempool, or wrong chain)`,
          },
        ],
        isError: true,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        { type: "text", text: `error: failed to look up ${txHash}: ${message}` },
      ],
      isError: true,
    };
  }
});
