// src/tools/get_btc_balances.ts — Phase 22 Plan 22-03 Task 2 (BTC-READ-02).
//
// MCP tool — parallel segwit + taproot BalanceReports for a paired
// Ledger wallet. `Promise.allSettled` over the 4-call fan-out
// (segwitInfo + segwitUtxos + taprootInfo + taprootUtxos) so one-side
// rate-limit does NOT tank the whole call — RESEARCH § Plan 22-03 #3.
//
// No direct in-tree analog. Closest is `get_portfolio_summary`'s
// per-chain `Promise.allSettled` shape (PATTERNS § Plan 22-03).
//
// Wallet resolution:
//   - Explicit `wallet: { segwit, taproot }` → use as-is.
//   - Omitted → resolve from `listAccounts({ chainFilter: "bitcoin" })`.
//     Multi-record-per-chain: two records under `chain: "bitcoin"`, one
//     segwit (`bc1q…`) + one taproot (`bc1p…`), distinguished by prefix.
//
// Locked errorCode set:
//   - NOT_PAIRED — no wallet arg AND no paired BTC records.
//   - INVALID_INPUT — malformed wallet object (defensive).
//   - ESPLORA_RATE_LIMITED / ESPLORA_ERROR per script-type slot.
//
// Per-script-type slot may surface kind:"rate-limited" / kind:"error"
// while the SIBLING slot returns kind:"ok" — tool-level isError stays
// undefined. The agent presents both slots side-by-side and the user
// retries the failing side individually.

import {
  fetchAddressInfo,
  fetchAddressUtxos,
} from "../chains/bitcoin/esplora-client.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns BOTH segwit + taproot BTC balances for a paired Ledger wallet (the wallet from `pair_btc_ledger`).",
  "Use this when the user wants to see their full Ledger BTC position across both script types.",
  "Surfaces per-script-type BalanceReport; one-side rate-limit does NOT tank the whole call (Promise.allSettled over 4 Esplora fetches).",
  "For a SINGLE address use `get_btc_balance`. For xpub-level aggregation use `get_btc_account_balance`.",
  "Optional `wallet` input as `{ segwit, taproot }` object overrides the paired-wallet default; otherwise resolves from the persisted Ledger pair (`pair_btc_ledger`).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "object",
      description:
        "Optional explicit `{ segwit: bc1q…, taproot: bc1p… }`. Omit to use the paired Ledger wallet.",
      properties: {
        segwit: {
          type: "string",
          pattern: "^bc1q[02-9ac-hj-np-z]{38}$",
        },
        taproot: {
          type: "string",
          pattern: "^bc1p[02-9ac-hj-np-z]{58}$",
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

interface BalanceSlot {
  kind: "ok" | "not-found" | "rate-limited" | "error";
  address?: string;
  confirmedBalanceSats?: string;
  unconfirmedBalanceSats?: string;
  txCount?: number;
  utxos?: Array<Record<string, unknown>>;
  message?: string;
}

function buildSlotFromInfoAndUtxos(
  address: string,
  infoOutcome: PromiseSettledResult<Awaited<ReturnType<typeof fetchAddressInfo>>>,
  utxosOutcome: PromiseSettledResult<Awaited<ReturnType<typeof fetchAddressUtxos>>>,
): BalanceSlot {
  if (infoOutcome.status === "rejected") {
    return { kind: "error", address, message: String(infoOutcome.reason) };
  }
  const info = infoOutcome.value;
  if (info.kind === "not-found") return { kind: "not-found", address };
  if (info.kind === "rate-limited") {
    return { kind: "rate-limited", address, message: info.message };
  }
  if (info.kind === "error" || info.kind === "not-applicable") {
    const message = info.kind === "error" ? info.message : "Esplora returned not-applicable";
    return { kind: "error", address, message };
  }
  // info.kind === "ok"
  const utxos =
    utxosOutcome.status === "fulfilled" && utxosOutcome.value.kind === "ok"
      ? utxosOutcome.value.utxos.map((u) => ({
          txid: u.txid,
          vout: u.vout,
          valueSats: u.valueSats.toString(),
          confirmed: u.confirmed,
          address: u.address,
          ...(u.blockHeight !== undefined ? { blockHeight: u.blockHeight } : {}),
        }))
      : [];
  return {
    kind: "ok",
    address,
    confirmedBalanceSats: info.confirmedBalanceSats.toString(),
    unconfirmedBalanceSats: info.unconfirmedBalanceSats.toString(),
    txCount: info.txCount,
    utxos,
  };
}

function resolveWalletFromArgs(
  args: Record<string, unknown>,
): { segwit: string; taproot: string } | null {
  const walletArg = args.wallet as Record<string, unknown> | undefined;
  if (
    walletArg &&
    typeof walletArg.segwit === "string" &&
    typeof walletArg.taproot === "string"
  ) {
    return { segwit: walletArg.segwit, taproot: walletArg.taproot };
  }

  // Fall back to paired-wallet records.
  const records = listAccounts({ chainFilter: "bitcoin" });
  let segwit: string | undefined;
  let taproot: string | undefined;
  for (const r of records) {
    if (r.address.startsWith("bc1q") && !segwit) segwit = r.address;
    else if (r.address.startsWith("bc1p") && !taproot) taproot = r.address;
  }
  if (segwit && taproot) return { segwit, taproot };
  return null;
}

registerTool("get_btc_balances", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  const wallet = resolveWalletFromArgs(args);
  if (!wallet) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "error: no `wallet` arg and no paired BTC wallet — run `pair_btc_ledger` first or pass `wallet: { segwit, taproot }`",
        },
      ],
      structuredContent: {
        errorCode: "NOT_PAIRED",
        message:
          "no `wallet` arg and no paired BTC wallet — run `pair_btc_ledger` first or pass an explicit `{ segwit, taproot }` object",
      },
    };
  }

  // Parallel fan-out — 4 fetches, Promise.allSettled so one-side
  // failure does NOT collapse the call.
  const [segwitInfo, segwitUtxos, taprootInfo, taprootUtxos] =
    await Promise.allSettled([
      fetchAddressInfo(wallet.segwit),
      fetchAddressUtxos(wallet.segwit),
      fetchAddressInfo(wallet.taproot),
      fetchAddressUtxos(wallet.taproot),
    ]);

  const segwitSlot = buildSlotFromInfoAndUtxos(
    wallet.segwit,
    segwitInfo,
    segwitUtxos,
  );
  const taprootSlot = buildSlotFromInfoAndUtxos(
    wallet.taproot,
    taprootInfo,
    taprootUtxos,
  );

  const summary = [
    `segwit ${wallet.segwit}: ${segwitSlot.kind}`,
    `taproot ${wallet.taproot}: ${taprootSlot.kind}`,
  ].join(" | ");

  return {
    content: [{ type: "text", text: summary }],
    structuredContent: {
      segwit: segwitSlot,
      taproot: taprootSlot,
    },
  };
});
