// src/tools/get_btc_balance.ts — Phase 22 Plan 22-03 Task 2 (BTC-READ-01).
//
// MCP tool — single-address BTC BalanceReport. Pattern-matches on the
// 5-arm Esplora client union (NEVER try/catch — the client never
// throws). Two Esplora calls: `/address/{addr}` for chain stats +
// `/address/{addr}/utxo` for the UTXO array (load-bearing for Phase 23
// coin-selection inheritance).
//
// Locked errorCode set:
//   - INVALID_INPUT — empty/missing wallet (defensive; schema regex
//     catches most cases pre-handler).
//   - ESPLORA_RATE_LIMITED — Esplora 429.
//   - ESPLORA_ERROR — Esplora 5xx / timeout / parse failure.
//
// `not-found` is NOT an error — it's a valid normal arm (address never
// seen on-chain). Surfaced as `{ kind: "not-found" }` envelope in
// structuredContent.
//
// Decimal-aware boundary: bigint sat amounts serialize as decimal
// STRING via `.toString()` per CLAUDE.md convention.

import {
  fetchAddressInfo,
  fetchAddressUtxos,
} from "../chains/bitcoin/esplora-client.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns the BTC balance + UTXOs for a single BTC address (bech32 segwit `bc1q…` or bech32m taproot `bc1p…`).",
  "Confirmed + unconfirmed sat amounts via Esplora; UTXOs surfaced for Phase 23 coin-selection consumption.",
  "Use this when the user provides a single BTC address. For paired-wallet BOTH script types use `get_btc_balances`. For xpub-level aggregation use `get_btc_account_balance`.",
  "`wallet` is REQUIRED — bech32 or bech32m, mainnet.",
  "Decimal-string sat amounts cross the boundary (bigint serialized as string per CLAUDE.md). 1 BTC = 100_000_000 sats (8 decimals).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description:
        "BTC mainnet address — bech32 (bc1q…, segwit P2WPKH) OR bech32m (bc1p…, taproot P2TR).",
      pattern: "^bc1(q[02-9ac-hj-np-z]{38}|p[02-9ac-hj-np-z]{58})$",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

registerTool("get_btc_balance", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || walletRaw.length === 0) {
    return {
      content: [
        { type: "text", text: "error: `wallet` must be a non-empty BTC address" },
      ],
      isError: true,
      structuredContent: {
        errorCode: "INVALID_INPUT",
        message: "`wallet` must be a non-empty BTC address (bc1q… or bc1p…)",
      },
    };
  }

  const info = await fetchAddressInfo(walletRaw);

  if (info.kind === "not-found") {
    return {
      content: [
        {
          type: "text",
          text: `${walletRaw}: not-found (address never seen on-chain)`,
        },
      ],
      structuredContent: { kind: "not-found", address: walletRaw },
    };
  }

  if (info.kind === "rate-limited") {
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${info.message}` }],
      structuredContent: {
        errorCode: "ESPLORA_RATE_LIMITED",
        message: info.message,
      },
    };
  }

  if (info.kind === "error" || info.kind === "not-applicable") {
    const message = info.kind === "error" ? info.message : "Esplora returned not-applicable";
    return {
      isError: true,
      content: [{ type: "text", text: `error: ${message}` }],
      structuredContent: { errorCode: "ESPLORA_ERROR", message },
    };
  }

  // info.kind === "ok" → fetch UTXOs.
  const utxosResult = await fetchAddressUtxos(walletRaw);

  // UTXO fetch failures don't tank the call — fall back to empty array
  // and continue to return the balance. (The /address response carries
  // the balance; UTXOs are a Phase 23 read-ahead.) Only a rate-limit
  // or error response collapses to empty utxos here.
  const utxos = utxosResult.kind === "ok" ? utxosResult.utxos : [];

  const sUtxos = utxos.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    valueSats: u.valueSats.toString(),
    confirmed: u.confirmed,
    address: u.address,
    ...(u.blockHeight !== undefined ? { blockHeight: u.blockHeight } : {}),
  }));

  return {
    content: [
      {
        type: "text",
        text: `${walletRaw} holds ${info.confirmedBalanceSats.toString()} sats confirmed (${utxos.length} UTXOs)`,
      },
    ],
    structuredContent: {
      kind: "ok",
      address: walletRaw,
      confirmedBalanceSats: info.confirmedBalanceSats.toString(),
      unconfirmedBalanceSats: info.unconfirmedBalanceSats.toString(),
      txCount: info.txCount,
      utxos: sUtxos,
    },
  };
});
