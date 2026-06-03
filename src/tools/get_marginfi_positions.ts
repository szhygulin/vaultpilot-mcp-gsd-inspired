// src/tools/get_marginfi_positions.ts — Phase 13 Plan 13-02 (SOL-W-03).
//
// Read tool (NO handle, NO signing surface): returns the bank-keyed supplied /
// borrowed positions + a health-factor-equivalent for a MarginFi account.
// Mirrors `get_solana_balance.ts` shape — base58-validated wallet → decode via
// `_marginfiChain` (D-02) → `computeMarginfiHealth` (D-07) → decimal-string
// boundary at the response edge.
//
// Demo-mode-aware: in demo mode, reads the active Solana persona's address.
//
// Pricing caveat (surfaced verbatim — T-13-03 information-disclosure mitigation):
// the decoder yields per-bank SHARE counts (asset_shares / liability_shares).
// Resolving the exact oracle-priced value requires per-bank reads
// (asset_share_value + oracle price + maintenance weights) — a verify-phase
// enrichment. v2.0 surfaces the share-derived health-equivalent (ratio of
// supplied to borrowed share value) + the positions, and flags that the figure
// is share-based, not oracle-priced. The reader never asserts liquidation
// safety on an unpriced/stale figure.

import {
  _marginfiChain,
  type DecodedMarginfiAccount,
} from "../chains/solana/marginfi.js";
import { SolanaRpcError } from "../chains/solana/sol-rpc-client.js";
import { isDemoMode } from "../config/env.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import {
  classifyMarginfiRisk,
  computeMarginfiHealth,
  type MarginfiHealthInput,
} from "../signing/marginfi-health.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { registerTool } from "./index.js";

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

const BASE58_PUBKEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const DESCRIPTION = [
  "Returns MarginFi (Solana lending) positions for a wallet: per-bank supplied + borrowed + a health-factor-equivalent + liquidation-risk band.",
  "Read-only — no handle, no signing surface. Use when the user asks about their MarginFi lending positions or borrow health on Solana.",
  "Do NOT use for Kamino positions — that's `get_kamino_positions` (Phase 13 Kamino batch). Do NOT use for Aave/Compound EVM lending — those are the EVM `get_lending_positions` family.",
  "`wallet` is REQUIRED — base58, 32-44 chars. The server derives the MarginfiAccount PDA and decodes it; if the wallet has no MarginfiAccount yet, returns hasAccount:false (the user must call prepare_marginfi_account_init before supplying).",
  "Amounts cross the boundary as decimal strings (share counts), never numbers — preserves the u64/i128 range.",
  "PRICING CAVEAT: the health-factor-equivalent is share-based (supplied vs borrowed share value), not oracle-priced — full oracle-priced health requires per-bank reads (a future enrichment). The response flags this in `pricingNote`. Never treat the figure as a liquidation guarantee, especially when `oracleStale` is true.",
  "In demo mode, reports the active Solana persona's MarginFi positions (set via set_demo_wallet).",
  "Failure modes: WALLET_NOT_PAIRED if no Solana account paired (real mode), WRONG_MODE if demo mode is on but no Solana persona is set, INVALID_INPUT if wallet malformed, BROADCAST_FAILED if the Solana RPC account read fails.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description:
        "Solana wallet base58 address (32-44 chars). Case-sensitive base58 (1-9A-HJ-NP-Za-km-z).",
      pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$",
    },
  },
  required: ["wallet"],
  additionalProperties: false,
};

/**
 * Build the (share-based) health input from the decoded positions. Each balance
 * contributes its supplied shares as an asset (unit price, full weight,
 * Collateral tier) and its borrowed shares as a liability (unit price, full
 * weight). This yields a supplied-vs-borrowed share-value ratio — a
 * health-equivalent, NOT an oracle-priced figure (flagged in `pricingNote`).
 */
function shareBasedHealthInput(
  account: DecodedMarginfiAccount,
): MarginfiHealthInput {
  const UNIT = 1n << 48n; // I80F48 1.0 — unit price + full weight (share-basis).
  return {
    assets: account.balances
      .filter((b) => b.supplied > 0n)
      .map((b) => ({
        bank: b.bank,
        quantity: b.supplied,
        oraclePrice: UNIT,
        assetWeightMaint: UNIT,
        riskTier: "Collateral" as const,
        oracleStale: false,
      })),
    liabilities: account.balances
      .filter((b) => b.borrowed > 0n)
      .map((b) => ({
        bank: b.bank,
        quantity: b.borrowed,
        oraclePrice: UNIT,
        liabilityWeightMaint: UNIT,
        oracleStale: false,
      })),
  };
}

registerTool("get_marginfi_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    const wallet = typeof args.wallet === "string" ? args.wallet : "";
    if (!BASE58_PUBKEY_REGEX.test(wallet)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'wallet' address: expected base58 pubkey (32-44 chars), got "${wallet}"`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'wallet' address: ${wallet}`,
        ),
      };
    }

    // Demo-mode FIRST refusal — read the Solana persona registry. In real
    // mode, the explicit `wallet` arg is authoritative; we still require a
    // paired Solana account to be present (the wallet need not match — reads
    // are not custody-gated).
    const demoActive = isDemoMode();
    let target = wallet;
    if (demoActive) {
      const persona = getActiveSolanaPersona();
      if (!persona) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: demo mode is on but no Solana persona is set. " +
                "Call set_demo_wallet with a Solana persona slug (e.g. \"solana-whale\") first.",
            },
          ],
          structuredContent: errEnvelope(
            "WRONG_MODE",
            "demo mode is on but no Solana persona is set; call set_demo_wallet first",
          ),
        };
      }
      // In demo mode, surface the active persona's positions.
      target = persona.solanaAddress;
    } else {
      const accounts = listAccounts({ chainFilter: "solana" });
      if (accounts.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: no paired Solana account. Call pair_solana_ledger first.",
            },
          ],
          structuredContent: errEnvelope(
            "WALLET_NOT_PAIRED",
            "no paired Solana account; call pair_solana_ledger first",
          ),
        };
      }
    }

    // Decode via the chain indirection (RPC boundary spied in tests).
    let info: Awaited<ReturnType<typeof _marginfiChain.getMarginfiAccountInfo>>;
    try {
      info = await _marginfiChain.getMarginfiAccountInfo(target);
    } catch (err) {
      const cause =
        err instanceof SolanaRpcError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: failed to read MarginFi account from Solana RPC: ${cause}`,
          },
        ],
        structuredContent: errEnvelope(
          "BROADCAST_FAILED",
          "failed to read MarginFi account",
          cause,
        ),
      };
    }

    if (!info.present || info.account === null) {
      return {
        content: [
          {
            type: "text",
            text: `MarginFi: no account for ${target} (PDA ${info.pda} absent). Call prepare_marginfi_account_init before supplying.`,
          },
        ],
        structuredContent: {
          wallet: target,
          marginfiAccountPda: info.pda,
          hasAccount: false,
          positions: [],
        },
      };
    }

    const account = info.account;
    const health = computeMarginfiHealth(shareBasedHealthInput(account));
    const riskBand = classifyMarginfiRisk(health.healthRatioScaled, health.noDebt);

    const positions = account.balances.map((b) => ({
      bank: b.bank,
      supplied: b.supplied.toString(),
      borrowed: b.borrowed.toString(),
    }));

    const positionLines = positions.length
      ? positions
          .map(
            (p) =>
              `  bank ${p.bank}: supplied ${p.supplied} / borrowed ${p.borrowed} (shares)`,
          )
          .join("\n")
      : "  (no active balances)";

    const text = [
      `MarginFi positions — wallet ${target}`,
      `  MarginfiAccount PDA: ${info.pda}`,
      positionLines,
      `  health-equivalent: ${
        health.noDebt ? "no debt" : `${health.healthRatioScaled} (scaled 1e18)`
      } — risk: ${riskBand}`,
      `  NOTE: share-based ratio, NOT oracle-priced. Full oracle-priced health requires per-bank reads.`,
    ].join("\n");

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        wallet: target,
        marginfiAccountPda: info.pda,
        hasAccount: true,
        positions,
        healthRatioScaled:
          health.healthRatioScaled === null
            ? null
            : health.healthRatioScaled.toString(),
        noDebt: health.noDebt,
        riskBand,
        oracleStale: health.oracleStale,
        pricingNote:
          "Health-factor-equivalent is share-based (supplied vs borrowed share value), NOT oracle-priced. Full oracle-priced health requires per-bank reads (verify-phase enrichment).",
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: get_marginfi_positions failed: ${message}`,
        },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "get_marginfi_positions failed",
        message,
      ),
    };
  }
});
