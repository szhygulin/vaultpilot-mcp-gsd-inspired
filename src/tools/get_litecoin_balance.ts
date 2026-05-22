// src/tools/get_litecoin_balance.ts — Phase 26 Plan 26-01 (LTC-READ-01).
//
// MCP tool — single-address LTC BalanceReport. Pattern-matches on the
// 5-arm Esplora client union (NEVER try/catch — the client never
// throws). Two Esplora calls: `/address/{addr}` for chain stats +
// `/address/{addr}/utxo` for the UTXO array.
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
// Decimal-aware boundary: bigint litoshi amounts serialize as decimal
// STRING via `.toString()` per CLAUDE.md convention.

import {
  fetchAddressInfo,
  fetchAddressUtxos,
} from "../chains/litecoin/esplora-client.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns the LTC balance + UTXOs for a single LTC address (legacy L-prefix or bech32 segwit ltc1q…).",
  "Confirmed + unconfirmed litoshi amounts via litecoinspace.org Esplora; UTXOs surfaced for future coin-selection.",
  "Use this when the user provides a single LTC address.",
  "`wallet` is REQUIRED — L-prefix legacy or ltc1q segwit, mainnet.",
  "Decimal-string litoshi amounts cross the boundary (bigint serialized as string per CLAUDE.md). 1 LTC = 100_000_000 litoshis (8 decimals).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description:
        "LTC mainnet address — legacy L-prefix (P2PKH) OR bech32 segwit ltc1q… (P2WPKH).",
      pattern: "^(ltc1q[02-9ac-hj-np-z]{38}|L[1-9A-HJ-NP-Za-km-z]{26,33})$",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

registerTool("get_litecoin_balance", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const walletRaw = args.wallet;
  if (typeof walletRaw !== "string" || walletRaw.length === 0) {
    return {
      content: [
        { type: "text", text: "error: `wallet` must be a non-empty LTC address" },
      ],
      isError: true,
      structuredContent: {
        errorCode: "INVALID_INPUT",
        message: "`wallet` must be a non-empty LTC address (L… or ltc1q…)",
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
  // the balance; UTXOs are a read-ahead for future coin selection.)
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
        text: `${walletRaw} holds ${info.confirmedBalanceSats.toString()} litoshis confirmed (${utxos.length} UTXOs)`,
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
