// MCP tool: get_btc_multisig_utxos({ walletName })
// Phase 25 Plan 25-01 Task 3 — BTC-PSBT-04.
//
// Returns the raw UTXO list for a registered multisig wallet, scanning all
// derived P2WSH addresses via Esplora. Uses the same gap-limit scan pattern
// as `get_btc_multisig_balance.ts` (concurrency cap 5, 20-consecutive-unused
// stop) — but fetches UTXOs per address via fetchAddressUtxos instead of
// balance-only.
//
// Steps:
//   1. validate walletName non-empty → INVALID_INPUT
//   2. loadMultisigWallet(walletName) — undefined → MULTISIG_WALLET_NOT_FOUND
//   3. derive P2WSH addresses via deriveMultisigAddress, gap-limit scan
//      (uses fetchAddressInfo to check tx_count, same as balance tool)
//   4. fetchAddressUtxos for each ACTIVE address (addresses with txCount > 0)
//   5. return flat UTXO list: { txid, vout, value (sats as string), address, scriptpubkey }
//
// Note: gap-limit scan uses address INFO (txCount) to decide which addresses
// are active; UTXO fetch is only for active addresses. This avoids unnecessary
// UTXO requests for empty addresses.
//
// T-25-04 note: Esplora UTXO data is used for display and PSBT input
// construction (Plan 25-03/04). Read-only path.

import { fetchAddressInfo, fetchAddressUtxos } from "../chains/bitcoin/esplora-client.js";
import type { UtxoRow } from "../chains/bitcoin/types.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  deriveMultisigAddress,
  extractXpubFromKeyExpr,
  loadMultisigWallet,
  parseWshSortedMulti,
} from "../wallet/btc-multisig-store.js";
import { registerTool } from "./index.js";

// ─── Error envelope helper ────────────────────────────────────────────────────

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<
    string,
    unknown
  > &
    StructuredError;
}

// ─── Gap-limit constants (mirrors xpub-scan.ts) ───────────────────────────────

const BIP44_GAP_LIMIT = 20;
const SCAN_CONCURRENCY = 5;

// ─── Tool description ─────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Returns the raw UTXO list for a registered multisig wallet across all derived P2WSH addresses.",
  "Performs a BIP-44 gap-limit scan (stop after 20 consecutive unused addresses) with concurrency cap 5 against Esplora.",
  "Only fetches UTXOs for addresses with at least one transaction (active addresses).",
  "The wallet must be registered via register_btc_multisig_wallet first.",
  "Returns MULTISIG_WALLET_NOT_FOUND if the walletName is not in the registry.",
  "UTXO value is serialized as a decimal string (bigint serialization).",
  "Use get_btc_multisig_balance for aggregate balance totals.",
  "This is a read-only tool — UTXO data is for display and PSBT input construction.",
].join(" ");

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    walletName: {
      type: "string",
      description: "Name of the registered multisig wallet (as used in register_btc_multisig_wallet).",
      minLength: 1,
    },
  },
  required: ["walletName"],
  additionalProperties: false,
};

// ─── Tool handler ─────────────────────────────────────────────────────────────

registerTool(
  "get_btc_multisig_utxos",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    // Step 1: validate walletName
    const walletName =
      typeof args.walletName === "string" ? args.walletName : "";
    if (walletName.length === 0) {
      return {
        isError: true,
        content: [{ type: "text", text: "error: `walletName` is REQUIRED and must be non-empty." }],
        structuredContent: errEnvelope("INVALID_INPUT", "`walletName` is REQUIRED and must be non-empty"),
      };
    }

    // Step 2: look up registry
    const record = loadMultisigWallet(walletName);
    if (!record) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: multisig wallet "${walletName}" not found in registry. Register it first with register_btc_multisig_wallet.`,
          },
        ],
        structuredContent: errEnvelope(
          "MULTISIG_WALLET_NOT_FOUND",
          `wallet "${walletName}" not registered`,
        ),
      };
    }

    // Step 3: parse descriptor to extract xpubs
    const parsed = parseWshSortedMulti(record.descriptor);
    if (!parsed) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: stored descriptor for wallet "${walletName}" is malformed. Re-register the wallet.`,
          },
        ],
        structuredContent: errEnvelope(
          "MULTISIG_DESCRIPTOR_INVALID",
          `stored descriptor for wallet "${walletName}" failed validation`,
        ),
      };
    }

    const xpubs = parsed.keys.map((key) => extractXpubFromKeyExpr(key).xpub);

    // Step 4: gap-limit scan — collect active address indices
    // Uses fetchAddressInfo (tx_count) to find active addresses,
    // same gap-limit algorithm as get_btc_multisig_balance and xpub-scan.ts.
    const activeAddressEntries: Array<{ index: number; address: string }> = [];

    let consecutiveEmpty = 0;
    let nextIndex = 0;

    outer: while (consecutiveEmpty < BIP44_GAP_LIMIT) {
      const batchSize = Math.min(
        SCAN_CONCURRENCY,
        BIP44_GAP_LIMIT - consecutiveEmpty,
      );

      const batchIndices: number[] = [];
      const batchAddresses: string[] = [];

      for (let k = 0; k < batchSize; k++) {
        const idx = nextIndex + k;
        batchIndices.push(idx);
        batchAddresses.push(deriveMultisigAddress(xpubs, parsed.m, idx));
      }
      nextIndex += batchSize;

      const responses = await Promise.all(
        batchAddresses.map((addr) => fetchAddressInfo(addr)),
      );

      for (let k = 0; k < responses.length; k++) {
        const idx = batchIndices[k]!;
        const addr = batchAddresses[k]!;
        const resp = responses[k];

        if (
          resp !== undefined &&
          resp.kind === "ok" &&
          resp.txCount > 0
        ) {
          consecutiveEmpty = 0;
          activeAddressEntries.push({ index: idx, address: addr });
        } else {
          consecutiveEmpty += 1;
          if (consecutiveEmpty >= BIP44_GAP_LIMIT) {
            break outer;
          }
        }
      }
    }

    // Step 5: fetch UTXOs for each active address
    const allUtxos: Array<{
      txid: string;
      vout: number;
      value: string; // bigint as decimal string
      address: string;
      scriptpubkey: string;
    }> = [];

    if (activeAddressEntries.length > 0) {
      // Fan out UTXO fetches for all active addresses (no extra concurrency cap
      // here since activeAddressEntries is already bounded by gap-limit)
      const utxoResults = await Promise.all(
        activeAddressEntries.map(({ address }) => fetchAddressUtxos(address)),
      );

      for (let i = 0; i < utxoResults.length; i++) {
        const utxoResult = utxoResults[i];
        const { address } = activeAddressEntries[i]!;

        if (utxoResult?.kind === "ok") {
          for (const utxo of utxoResult.utxos) {
            allUtxos.push({
              txid: utxo.txid,
              vout: utxo.vout,
              value: utxo.valueSats.toString(), // bigint decimal string
              address,
              scriptpubkey: "", // Esplora /utxo endpoint does not return scriptpubkey;
              // Plan 25-03 can enrich this via GET /tx/{txid}/hex if needed.
            });
          }
        }
        // Non-ok responses (rate-limited, error, not-found) are silently skipped
        // (same conservative "treat non-ok as empty" pattern as xpub-scan.ts)
      }
    }

    const summaryText = [
      `Multisig wallet "${walletName}" (${record.threshold}-of-${record.totalSigners}):`,
      `  active addresses: ${activeAddressEntries.length}`,
      `  UTXOs found:      ${allUtxos.length}`,
    ].join("\n");

    return {
      content: [{ type: "text", text: summaryText }],
      structuredContent: {
        walletName,
        threshold: record.threshold,
        totalSigners: record.totalSigners,
        activeAddressCount: activeAddressEntries.length,
        utxoCount: allUtxos.length,
        utxos: allUtxos,
      },
    };
  },
);
