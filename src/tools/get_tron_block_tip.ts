// MCP tool: get_tron_block_tip({}) — Phase 17 Plan 17-03 (TRON-READ-03).
//
// TRON-specific diagnostic — returns the current chain head shape via
// `getBlockTip()` from `tron-rpc-client.ts`. No Solana sibling; the
// equivalent EVM-side tool is `get_transaction_status` (which surfaces tip
// data implicitly as part of confirmation depth math).
//
// Returns `{ number, timestamp, blockHash }`:
//   - `number` is the block height (TRON numbers blocks monotonically from
//     genesis).
//   - `timestamp` is millisecond-precision unix epoch (TRON's block
//     timestamps are ms-precision, unlike Bitcoin/EVM seconds-precision).
//   - `blockHash` is the 64-char hex block ID with leading zeros
//     preserved (no `0x` prefix per tronweb's convention).
//
// Defensive on schema drift: a missing `block_header.raw_data` from the
// SDK surfaces as the zero-tuple `{ number: 0, timestamp: 0, blockHash: "" }`
// rather than throwing — wire-shape stability beats fail-loud for a
// diagnostic-only read. The handler passes the shape through; the user
// sees the zeros and knows to investigate.
//
// Locked errorCode set:
//   - TRON_RPC_FAILED — `TronRpcError` rethrown by `tron-rpc-client`.

import { getBlockTip, TronRpcError } from "../chains/tron/tron-rpc-client.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns the current TRON chain tip: { number, timestamp, blockHash }.",
  "Use when the user wants chain-level diagnostics — current block height, last-block timestamp, block hash for cross-explorer linkage.",
  "Diagnostic/monitoring tool; safe to call anytime. NOT for balance reads — use `get_tron_balance` (native TRX) or `get_tron_token_balance` (TRC-20).",
  "Single RPC round-trip via `tw.trx.getCurrentBlock`. Timestamp is millisecond-precision unix epoch (TRON convention; NOT seconds like Bitcoin/EVM).",
  "BlockHash is 64-char hex without `0x` prefix (tronweb convention).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

interface TronBlockTipResult {
  number: number;
  timestamp: number;
  blockHash: string;
}

registerTool("get_tron_block_tip", DESCRIPTION, INPUT_SCHEMA, async () => {
  try {
    const tip: TronBlockTipResult = await getBlockTip();
    return {
      content: [
        {
          type: "text",
          text: `TRON tip: block ${tip.number} at ${tip.timestamp} ms (hash ${tip.blockHash})`,
        },
      ],
      structuredContent: { ...tip },
    };
  } catch (err) {
    if (err instanceof TronRpcError) {
      return {
        content: [
          {
            type: "text",
            text: `error: failed to read TRON chain tip: ${err.message}`,
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
        { type: "text", text: `error: failed to read TRON chain tip: ${message}` },
      ],
      isError: true,
      structuredContent: {
        errorCode: "INTERNAL_ERROR",
        message,
      },
    };
  }
});
