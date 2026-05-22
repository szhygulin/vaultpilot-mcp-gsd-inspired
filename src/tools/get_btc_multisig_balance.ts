// MCP tool: get_btc_multisig_balance({ walletName })
// Phase 25 Plan 25-01 Task 3 — BTC-PSBT-04.
//
// Returns the aggregate confirmed + unconfirmed BTC balance across all
// derived P2WSH addresses for a registered multisig wallet. Uses the same
// gap-limit scan pattern as `xpub-scan.ts` (concurrency cap 5, stop after
// 20 consecutive unused addresses).
//
// Steps:
//   1. validate walletName non-empty → INVALID_INPUT
//   2. loadMultisigWallet(walletName) — undefined → MULTISIG_WALLET_NOT_FOUND
//   3. derive P2WSH addresses via deriveMultisigAddress, gap-limit scan
//   4. fan out Esplora fetchAddressInfo per address (concurrency cap 5)
//   5. aggregate confirmed + unconfirmed balances across all active addresses
//
// T-25-04 note: Esplora balance data is used for display only — no signing
// decision is made from this data in this plan. Read-only path.
//
// CLAUDE.md compliance: stderr for diagnostics only. Amounts serialized as
// bigint decimal strings at the boundary.

import { fetchAddressInfo } from "../chains/bitcoin/esplora-client.js";
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
  "Returns the aggregate confirmed + unconfirmed BTC balance across all derived P2WSH addresses for a registered multisig wallet.",
  "Performs a BIP-44 gap-limit scan (stop after 20 consecutive unused addresses) with concurrency cap 5 against Esplora.",
  "The wallet must be registered via register_btc_multisig_wallet first.",
  "Returns MULTISIG_WALLET_NOT_FOUND if the walletName is not in the registry.",
  "Amounts are serialized as decimal strings (bigint serialization).",
  "This is a read-only tool — no signing or transaction preparation occurs here.",
  "Use get_btc_multisig_utxos for the raw UTXO list needed for PSBT construction.",
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
  "get_btc_multisig_balance",
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

    // Step 4+5: gap-limit scan over derived P2WSH addresses
    // Algorithm mirrors xpub-scan.ts: batch by SCAN_CONCURRENCY, stop after
    // BIP44_GAP_LIMIT consecutive unused addresses.
    let totalConfirmedSats = 0n;
    let totalUnconfirmedSats = 0n;
    const activeAddresses: Array<{
      index: number;
      address: string;
      confirmedSats: bigint;
      unconfirmedSats: bigint;
    }> = [];

    let consecutiveEmpty = 0;
    let nextIndex = 0;
    let addressesScanned = 0;

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

      // Fire batch in parallel
      const responses = await Promise.all(
        batchAddresses.map((addr) => fetchAddressInfo(addr)),
      );

      for (let k = 0; k < responses.length; k++) {
        const idx = batchIndices[k]!;
        const addr = batchAddresses[k]!;
        const resp = responses[k];
        addressesScanned += 1;

        if (
          resp !== undefined &&
          resp.kind === "ok" &&
          resp.txCount > 0
        ) {
          consecutiveEmpty = 0;
          totalConfirmedSats += resp.confirmedBalanceSats;
          totalUnconfirmedSats += resp.unconfirmedBalanceSats;
          activeAddresses.push({
            index: idx,
            address: addr,
            confirmedSats: resp.confirmedBalanceSats,
            unconfirmedSats: resp.unconfirmedBalanceSats,
          });
        } else {
          consecutiveEmpty += 1;
          if (consecutiveEmpty >= BIP44_GAP_LIMIT) {
            break outer;
          }
        }
      }
    }

    const summaryText = [
      `Multisig wallet "${walletName}" (${record.threshold}-of-${record.totalSigners}):`,
      `  confirmed balance:   ${totalConfirmedSats.toString()} sats`,
      `  unconfirmed balance: ${totalUnconfirmedSats.toString()} sats`,
      `  active addresses:    ${activeAddresses.length}`,
      `  addresses scanned:   ${addressesScanned}`,
    ].join("\n");

    return {
      content: [{ type: "text", text: summaryText }],
      structuredContent: {
        walletName,
        threshold: record.threshold,
        totalSigners: record.totalSigners,
        totalConfirmedSats: totalConfirmedSats.toString(),
        totalUnconfirmedSats: totalUnconfirmedSats.toString(),
        addressesScanned,
        activeAddresses: activeAddresses.map((a) => ({
          index: a.index,
          address: a.address,
          confirmedSats: a.confirmedSats.toString(),
          unconfirmedSats: a.unconfirmedSats.toString(),
        })),
      },
    };
  },
);
