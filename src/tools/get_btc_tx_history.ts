// src/tools/get_btc_tx_history.ts — Phase 22 Plan 22-03 Task 2 (BTC-READ-04).
//
// MCP tool — paginated tx history for a BTC address. Wraps Esplora
// `/address/{addr}/txs[/chain/<cursor>]`. Stripped-down per-row shape
// `{ txid, blockHeight?, confirmedAt?, fee }` — full vin/vout deferred
// to Phase 24 per RESEARCH § Plan 22-03 #5.
//
// Pagination is Esplora-specific: pass the txid of the previous page's
// last row as the `cursor` arg; the tool appends it to the URL as the
// `/chain/<txid>` suffix. `nextCursor` surfaced when the page returns
// ≥ `limit` rows (signals more pages exist); absent on the last page.
//
// `valueDelta` is documented in the plan but requires either /tx/<txid>
// detail fetch OR vin/vout reconstruction — defer to Phase 24 (a per-
// row `valueDelta` would otherwise add N+1 Esplora calls). Phase 22
// surfaces fee (already in the address/txs response) and confirmation
// metadata; agents wanting net-flow per tx can chain `get_btc_balance`
// + `get_btc_tx_history`.
//
// Locked errorCode set:
//   - INVALID_INPUT — defensive (schema regex catches most cases).
//   - ESPLORA_RATE_LIMITED / ESPLORA_ERROR.

import { fetchAddressTxs } from "../chains/bitcoin/esplora-client.js";
import { registerTool } from "./index.js";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const DESCRIPTION = [
  "Returns recent transactions for a single BTC address via Esplora's `/address/{addr}/txs` endpoint.",
  "Use this for transaction history exploration.",
  "Stripped-down per-row shape `{ txid, blockHeight?, confirmedAt?, fee }` — full vin/vout deferred to Phase 24's tx-detail tool.",
  "Pagination via `cursor` (Esplora `:last_seen_txid`); default limit 25; max limit 100 per call. `nextCursor` returned when more pages exist.",
  "Decimal-string fee crosses the boundary (bigint per CLAUDE.md).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description: "BTC mainnet address — bech32 (bc1q…) or bech32m (bc1p…).",
      pattern: "^bc1(q[02-9ac-hj-np-z]{38}|p[02-9ac-hj-np-z]{58})$",
    },
    limit: {
      type: "number",
      description: `Page size. Default ${DEFAULT_LIMIT}; max ${MAX_LIMIT}.`,
      minimum: 1,
      maximum: MAX_LIMIT,
    },
    cursor: {
      type: "string",
      description:
        "Esplora pagination cursor (the txid of the previous page's last row). Pass `nextCursor` from a prior call.",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

registerTool("get_btc_tx_history", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || walletRaw.length === 0) {
    return {
      isError: true,
      content: [{ type: "text", text: "error: `wallet` must be a non-empty BTC address" }],
      structuredContent: {
        errorCode: "INVALID_INPUT",
        message: "`wallet` must be a non-empty BTC address",
      },
    };
  }

  const limitRaw = args.limit;
  const limit =
    typeof limitRaw === "number" && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const cursor = typeof args.cursor === "string" ? args.cursor : undefined;

  const txsResult = await fetchAddressTxs(walletRaw, cursor ? { afterTxid: cursor } : undefined);

  if (txsResult.kind === "not-found") {
    return {
      content: [
        { type: "text", text: `${walletRaw}: not-found (address never seen on-chain)` },
      ],
      structuredContent: { kind: "not-found", address: walletRaw, transactions: [] },
    };
  }

  if (txsResult.kind === "rate-limited") {
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${txsResult.message}` }],
      structuredContent: {
        errorCode: "ESPLORA_RATE_LIMITED",
        message: txsResult.message,
      },
    };
  }

  if (txsResult.kind === "error" || txsResult.kind === "not-applicable") {
    const message =
      txsResult.kind === "error" ? txsResult.message : "Esplora returned not-applicable";
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: { errorCode: "ESPLORA_ERROR", message },
    };
  }

  // txsResult.kind === "ok"
  const all = txsResult.txs;
  const sliced = all.slice(0, limit);
  const transactions = sliced.map((tx) => ({
    txid: tx.txid,
    fee: tx.fee.toString(),
    ...(tx.blockHeight !== undefined ? { blockHeight: tx.blockHeight } : {}),
    ...(tx.confirmedAt !== undefined ? { confirmedAt: tx.confirmedAt } : {}),
  }));

  // nextCursor present iff page returned full limit-count (more pages
  // likely exist). Use the LAST row's txid as the cursor for the next
  // page (Esplora `:last_seen_txid` semantics).
  const lastRow = sliced[sliced.length - 1];
  const nextCursor = sliced.length >= limit && lastRow ? lastRow.txid : undefined;

  return {
    content: [
      {
        type: "text",
        text: `${walletRaw}: ${transactions.length} transaction(s)${
          nextCursor ? ` (more pages available via cursor=${nextCursor})` : ""
        }`,
      },
    ],
    structuredContent: {
      address: walletRaw,
      transactions,
      ...(nextCursor ? { nextCursor } : {}),
    },
  };
});
