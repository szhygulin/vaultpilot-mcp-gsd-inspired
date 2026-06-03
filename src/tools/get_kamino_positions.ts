// src/tools/get_kamino_positions.ts — Phase 13 Plan 13-04 (SOL-W-06).
//
// Read tool (NO handle, NO signing surface): returns the Kamino-vault(reserve)-
// keyed supplied / borrowed positions + per-vault health for a wallet's
// Obligation. Mirrors `get_marginfi_positions.ts` shape — base58-validated
// wallet → decode via `_kaminoChain` (D-02, behind the kit→shape adapter) →
// `computeKaminoHealth` (D-07) → decimal-string boundary at the response edge.
//
// Demo-mode-aware: in demo mode, reads the active Solana persona's address.
//
// Pricing caveat (surfaced verbatim — T-13-09 mitigation): the decoder yields
// raw deposited/borrowed amounts; the scope-priced value resolution + per-reserve
// LTV health is computed from the decoded reserve config. `oracleStale` +
// `elevationGroup` are surfaced verbatim — the reader never asserts liquidation
// safety on a stale price nor substitutes a group-specific LTV (A5).

import {
  _kaminoChain,
  type DecodedKaminoObligation,
  type DecodedKaminoReserve,
} from "../chains/solana/kamino.js";
import { SolanaRpcError } from "../chains/solana/sol-rpc-client.js";
import { isDemoMode } from "../config/env.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import {
  classifyKaminoRisk,
  computeKaminoHealth,
  type KaminoHealthInput,
} from "../signing/kamino-health.js";
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
  "Returns Kamino (Solana lending) positions for a wallet: per-reserve supplied + borrowed + a per-reserve-LTV health factor + liquidation-risk band + elevation-group id.",
  "Read-only — no handle, no signing surface. Use when the user asks about their Kamino lending positions or borrow health on Solana.",
  "Do NOT use for MarginFi positions — that's `get_marginfi_positions`. Do NOT use for Aave/Compound EVM lending — those are the EVM `get_lending_positions` family.",
  "`wallet` is REQUIRED — base58, 32-44 chars. The server derives the Obligation PDA and decodes it; if the wallet has no Obligation yet, returns hasObligation:false (call prepare_kamino_obligation_init before supplying/borrowing).",
  "Amounts cross the boundary as decimal strings, never numbers — preserves the u64 range.",
  "Health is per-reserve LTV / liquidation-threshold (Solend-lineage). The response flags `oracleStale` and surfaces `elevationGroup` verbatim — never treat the figure as a liquidation guarantee when oracleStale is true.",
  "In demo mode, reports the active Solana persona's Kamino positions (set via set_demo_wallet).",
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
 * Build the per-reserve-LTV health input from the decoded obligation +
 * resolved reserves. Each deposit contributes its amount as priced
 * `depositValue` weighted by the reserve's LTV / liquidation threshold; each
 * borrow contributes its amount as `borrowedValue`. Reserves missing from the
 * resolved set are skipped (defensive — a vanished reserve account).
 */
function healthInput(
  obligation: DecodedKaminoObligation,
  reserves: DecodedKaminoReserve[],
): KaminoHealthInput {
  const byReserve = new Map(reserves.map((r) => [r.reserve, r]));
  return {
    deposits: obligation.deposits.flatMap((d) => {
      const r = byReserve.get(d.reserve);
      if (!r) return [];
      return [
        {
          reserve: d.reserve,
          depositValue: d.depositedAmount,
          loanToValueBps: r.loanToValueBps,
          liquidationThresholdBps: r.liquidationThresholdBps,
        },
      ];
    }),
    borrows: obligation.borrows.map((b) => ({
      reserve: b.reserve,
      borrowedValue: b.borrowedAmount,
    })),
    elevationGroup: obligation.elevationGroup,
    oracleStale: obligation.stale,
  };
}

registerTool("get_kamino_positions", DESCRIPTION, INPUT_SCHEMA, async (args) => {
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

    // Demo-mode FIRST refusal — read the Solana persona registry. In real mode,
    // the explicit `wallet` arg is authoritative; a paired Solana account must
    // exist (reads are not custody-gated — the wallet need not match).
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
                "Call set_demo_wallet with a Solana persona slug first.",
            },
          ],
          structuredContent: errEnvelope(
            "WRONG_MODE",
            "demo mode is on but no Solana persona is set; call set_demo_wallet first",
          ),
        };
      }
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
    let info: Awaited<ReturnType<typeof _kaminoChain.getKaminoObligationInfo>>;
    try {
      info = await _kaminoChain.getKaminoObligationInfo(target);
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
            text: `error: failed to read Kamino obligation from Solana RPC: ${cause}`,
          },
        ],
        structuredContent: errEnvelope(
          "BROADCAST_FAILED",
          "failed to read Kamino obligation",
          cause,
        ),
      };
    }

    if (!info.present || info.obligation === null) {
      return {
        content: [
          {
            type: "text",
            text: `Kamino: no Obligation for ${target} (PDA ${info.pda} absent). Call prepare_kamino_obligation_init before supplying or borrowing.`,
          },
        ],
        structuredContent: {
          wallet: target,
          obligationPda: info.pda,
          hasObligation: false,
          positions: [],
        },
      };
    }

    const obligation = info.obligation;
    const health = computeKaminoHealth(healthInput(obligation, info.reserves));
    const riskBand = classifyKaminoRisk(health.healthFactorScaled, health.noDebt);

    const supplied = obligation.deposits.map((d) => ({
      reserve: d.reserve,
      amount: d.depositedAmount.toString(),
    }));
    const borrowed = obligation.borrows.map((b) => ({
      reserve: b.reserve,
      amount: b.borrowedAmount.toString(),
    }));

    const lines: string[] = [`Kamino positions — wallet ${target}`, `  Obligation PDA: ${info.pda}`];
    if (supplied.length) {
      for (const s of supplied) lines.push(`  supplied reserve ${s.reserve}: ${s.amount}`);
    }
    if (borrowed.length) {
      for (const b of borrowed) lines.push(`  borrowed reserve ${b.reserve}: ${b.amount}`);
    }
    if (!supplied.length && !borrowed.length) lines.push("  (no active positions)");
    lines.push(
      `  health factor: ${
        health.noDebt ? "no debt" : `${health.healthFactorScaled} (scaled 1e18)`
      } — risk: ${riskBand}`,
    );
    lines.push(`  elevation group: ${health.elevationGroup}${health.oracleStale ? " (ORACLE STALE — do not trust safety)" : ""}`);

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        wallet: target,
        obligationPda: info.pda,
        hasObligation: true,
        supplied,
        borrowed,
        healthFactorScaled:
          health.healthFactorScaled === null
            ? null
            : health.healthFactorScaled.toString(),
        borrowPowerScaled: health.borrowPowerScaled.toString(),
        liquidationLineScaled: health.liquidationLineScaled.toString(),
        borrowedValueScaled: health.borrowedValueScaled.toString(),
        noDebt: health.noDebt,
        riskBand,
        elevationGroup: health.elevationGroup,
        oracleStale: health.oracleStale,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: get_kamino_positions failed: ${message}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "get_kamino_positions failed",
        message,
      ),
    };
  }
});
