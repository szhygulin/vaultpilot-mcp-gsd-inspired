// src/tools/get_litecoin_tx_history.ts — Phase 26 Plan 26-01 (LTC-READ-02).
//
// MCP tool — paginated tx history for a LTC address. Wraps Esplora
// `/address/{addr}/txs[/chain/<cursor>]`. Stripped-down per-row shape
// `{ txid, blockHeight?, confirmedAt?, fee }` — full vin/vout deferred.
//
// Pagination is Esplora-specific: pass the txid of the previous page's
// last row as the `cursor` arg; the tool appends it to the URL as the
// `/chain/<txid>` suffix. `nextCursor` surfaced when the page returns
// ≥ `limit` rows (signals more pages exist); absent on the last page.
//
// Locked errorCode set:
//   - INVALID_INPUT — defensive (schema regex catches most cases).
//   - ESPLORA_RATE_LIMITED / ESPLORA_ERROR.

import { fetchAddressTxs } from "../chains/litecoin/esplora-client.js";
import { registerTool } from "./index.js";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const DESCRIPTION = [
  "Returns recent transactions for a single LTC address via litecoinspace.org Esplora's `/address/{addr}/txs` endpoint.",
  "Use this for transaction history exploration.",
  "Stripped-down per-row shape `{ txid, blockHeight?, confirmedAt?, fee }` — full vin/vout deferred.",
  "Pagination via `cursor` (Esplora `:last_seen_txid`); default limit 25; max limit 100 per call. `nextCursor` returned when more pages exist.",
  "Decimal-string fee crosses the boundary (bigint per CLAUDE.md).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description: "LTC mainnet address — legacy L-prefix or bech32 segwit ltc1q….",
      pattern: "^(ltc1q[02-9ac-hj-np-z]{38}|L[1-9A-HJ-NP-Za-km-z]{26,33})$",
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

registerTool("get_litecoin_tx_history", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || walletRaw.length === 0) {
    return {
      isError: true,
      content: [{ type: "text", text: "error: `wallet` must be a non-empty LTC address" }],
      structuredContent: {
        errorCode: "INVALID_INPUT",
        message: "`wallet` must be a non-empty LTC address",
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
