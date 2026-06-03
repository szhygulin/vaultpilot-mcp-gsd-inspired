// src/tools/_kamino_prepare_shared.ts — Phase 13 Plan 13-05.
//
// Shared flow for the four Kamino op prepare tools (supply / repay / borrow /
// withdraw). Each tool differs only in (a) which op ix it builds and (b) the
// refresh-reserve set. The common skeleton — demo-persona-FIRST refusal →
// base58 + amount validation → pairing check → D-03 Obligation-presence gate
// (VP_S007, refuse-no-handle) → refresh-ceremony assembly → FROZEN
// payloadFingerprint → handle + PREPARE RECEIPT + blind-sign LEDGER NOTICE —
// lives here so the four tools stay thin and the D-03 / refresh / blind-sign
// invariants are stated once.
//
// All Kamino writes flow through the FROZEN `computeSolanaPayloadFingerprint`
// binding UNCHANGED (no binding edit — phase-gate in 13-06).

import { PublicKey } from "@solana/web3.js";

import {
  _kaminoChain,
  type DecodedKaminoReserve,
  type KaminoObligationInfo,
} from "../chains/solana/kamino.js";
import { SolanaRpcError } from "../chains/solana/sol-rpc-client.js";
import { _solanaRegistry } from "../chains/solana/registry.js";
import { isDemoMode } from "../config/env.js";
import {
  deriveKaminoLendingMarketAuthority,
  getKaminoMainMarket,
  getKaminoPythReceiverProgram,
  getKaminoScopeProgram,
  getKaminoSwitchboardProgram,
} from "../config/contracts.js";
import { getActiveSolanaPersona } from "../demo/state.js";
import { _kamino } from "../protocols/kamino.js";
import {
  InvalidAmountError,
  parseSolanaAmountStrict,
} from "../signing/amount-solana.js";
import { LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE } from "../signing/blocks-solana.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computeSolanaPayloadFingerprint } from "../signing/payload-fingerprint-solana.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import type { TransactionInstruction } from "@solana/web3.js";

// Local solanaErrorCode constant (Phase 44 pattern — NOT a central registry,
// D-04). MarginFi (13-03) took VP_S006; Kamino-obligation-absent takes VP_S007.
export const SOLANA_KAMINO_OBLIGATION_ABSENT = "VP_S007" as const;

export const BASE58_PUBKEY_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
};

export function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
  solanaErrorCode?: string,
): Record<string, unknown> {
  const base = makeStructuredError(code, message, cause) as unknown as Record<
    string,
    unknown
  > &
    StructuredError;
  if (solanaErrorCode) base.solanaErrorCode = solanaErrorCode;
  return base;
}

/** Resolve the signing authority (demo persona or paired wallet). */
function resolveAuthority():
  | { ok: true; authority: string }
  | { ok: false; result: ToolResult } {
  if (isDemoMode()) {
    const persona = getActiveSolanaPersona();
    if (!persona) {
      return {
        ok: false,
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: demo mode is on but no Solana persona is set. Call set_demo_wallet first.",
            },
          ],
          structuredContent: errEnvelope(
            "WRONG_MODE",
            "demo mode is on but no Solana persona is set; call set_demo_wallet first",
          ),
        },
      };
    }
    return { ok: true, authority: persona.solanaAddress };
  }
  const accounts = listAccounts({ chainFilter: "solana" });
  if (accounts.length === 0 || !accounts[0]) {
    return {
      ok: false,
      result: {
        isError: true,
        content: [
          { type: "text", text: "error: no paired Solana account. Call pair_solana_ledger first." },
        ],
        structuredContent: errEnvelope(
          "WALLET_NOT_PAIRED",
          "no paired Solana account; call pair_solana_ledger first",
        ),
      },
    };
  }
  return { ok: true, authority: accounts[0].address };
}

/** Build the refreshReserve ix for one reserve from its decoded oracle accounts. */
function refreshIxFor(
  reserve: DecodedKaminoReserve,
  market: PublicKey,
): TransactionInstruction {
  const o = reserve.oracleAccounts;
  return _kamino.buildRefreshReserveIx({
    reserve: new PublicKey(reserve.reserve),
    lendingMarket: market,
    pythOracle: new PublicKey(o.pythOracle),
    switchboardPriceOracle: new PublicKey(o.switchboardPriceOracle),
    switchboardTwapOracle: new PublicKey(o.switchboardTwapOracle),
    scopePrices: new PublicKey(o.scopePrices),
  });
}

/** The union of oracle program IDs the refresh ceremony touches (Pitfall 5). */
function oracleProgramIds(): string[] {
  return [
    getKaminoScopeProgram(),
    getKaminoPythReceiverProgram(),
    getKaminoSwitchboardProgram(),
  ];
}

export interface KaminoOpContext {
  authority: PublicKey;
  authorityBase58: string;
  market: PublicKey;
  lendingMarketAuthority: PublicKey;
  obligation: PublicKey;
  obligationInfo: KaminoObligationInfo;
  /** Ordered refreshReserve ix for the touched reserves. */
  refreshIxs: TransactionInstruction[];
  /** The refreshObligation ix. */
  refreshObligationIx: TransactionInstruction;
  /** Reserves resolved for the obligation (by base58). */
  reservesByPubkey: Map<string, DecodedKaminoReserve>;
  recentBlockhash: string;
}

/**
 * Run the shared preamble: authority resolution, D-03 Obligation-presence gate
 * (VP_S007, refuse-no-handle), reserve resolution, refresh-ceremony assembly,
 * blockhash. Returns either a refusal ToolResult or the op-build context.
 *
 * `refreshReserves` selects which reserves get a `refreshReserve` ix:
 *   - "all"     → every distinct reserve in the obligation (borrow/withdraw).
 *   - a reserve → just that reserve (supply/repay touch a single reserve, but
 *                 the obligation's other reserves are still refreshed if present
 *                 — Pattern 2 refreshes the WHOLE obligation's reserve set).
 */
export async function prepareKaminoOpContext(): Promise<
  { ok: true; ctx: KaminoOpContext } | { ok: false; result: ToolResult }
> {
  const auth = resolveAuthority();
  if (!auth.ok) return { ok: false, result: auth.result };
  const authorityBase58 = auth.authority;

  // ---- D-03 Obligation-presence GATE — NO handle minted on refusal. ----
  let info: KaminoObligationInfo;
  try {
    info = await _kaminoChain.getKaminoObligationInfo(authorityBase58);
  } catch (err) {
    const cause =
      err instanceof SolanaRpcError ? err.message : err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      result: {
        isError: true,
        content: [{ type: "text", text: `error: failed to read Kamino obligation: ${cause}` }],
        structuredContent: errEnvelope("BROADCAST_FAILED", "failed to read Kamino obligation", cause),
      },
    };
  }
  if (!info.present || info.obligation === null) {
    return {
      ok: false,
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: "error: no Obligation for this wallet — call prepare_kamino_obligation_init first.",
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          "no Obligation for this wallet — call prepare_kamino_obligation_init first",
          undefined,
          SOLANA_KAMINO_OBLIGATION_ABSENT,
        ),
      },
    };
  }

  const market = new PublicKey(getKaminoMainMarket());
  const obligation = new PublicKey(info.pda);
  const lendingMarketAuthority = new PublicKey(deriveKaminoLendingMarketAuthority(getKaminoMainMarket()));

  // Refresh ceremony — one refreshReserve per DISTINCT reserve in the obligation
  // (Pattern 2), in a stable order, then refreshObligation.
  const reservesByPubkey = new Map(info.reserves.map((r) => [r.reserve, r]));
  const refreshIxs = info.reserves.map((r) => refreshIxFor(r, market));
  const refreshObligationIx = _kamino.buildRefreshObligationIx({
    lendingMarket: market,
    obligation,
  });

  // Recent blockhash.
  let recentBlockhash: string;
  try {
    const { blockhash } = await _solanaRegistry.getConnection().getLatestBlockhash();
    recentBlockhash = blockhash;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      result: {
        isError: true,
        content: [{ type: "text", text: `error: failed to fetch recent blockhash: ${cause}` }],
        structuredContent: errEnvelope("BROADCAST_FAILED", "failed to fetch recent blockhash", cause),
      },
    };
  }

  return {
    ok: true,
    ctx: {
      authority: new PublicKey(authorityBase58),
      authorityBase58,
      market,
      lendingMarketAuthority,
      obligation,
      obligationInfo: info,
      refreshIxs,
      refreshObligationIx,
      reservesByPubkey,
      recentBlockhash,
    },
  };
}

/** Parse a decimal amount string against a reserve's mint decimals. */
export function parseAmount(
  rawAmount: string,
  decimals: number,
):
  | { ok: true; amount: bigint }
  | { ok: false; result: ToolResult } {
  try {
    return { ok: true, amount: parseSolanaAmountStrict(rawAmount, decimals) };
  } catch (err) {
    if (err instanceof InvalidAmountError) {
      return {
        ok: false,
        result: {
          isError: true,
          content: [{ type: "text", text: `error: invalid 'amount': ${err.message}` }],
          structuredContent: errEnvelope("INVALID_INPUT", `invalid 'amount': ${err.message}`, err.kind),
        },
      };
    }
    throw err;
  }
}

/**
 * Assemble the FULL ordered instruction vector (refresh ceremony + op),
 * compute the FROZEN fingerprint, mint the handle, and return the success
 * ToolResult. `ixNames` mirrors the instruction order for the summary.
 */
export function finalizeKaminoOp(input: {
  ctx: KaminoOpContext;
  opIx: TransactionInstruction;
  opName: string;
  rawArgs: Record<string, unknown>;
  receiptLines: string[];
  structured: Record<string, unknown>;
}): ToolResult {
  const { ctx } = input;
  const instructions = [...ctx.refreshIxs, ctx.refreshObligationIx, input.opIx];
  const ixNames = [
    ...ctx.refreshIxs.map(() => "refreshReserve"),
    "refreshObligation",
    input.opName,
  ];
  const assembled = _kamino.assembleKaminoTx({
    instructions,
    ixNames,
    oracleProgramIds: oracleProgramIds(),
    feePayer: ctx.authority,
    recentBlockhash: ctx.recentBlockhash,
  });

  const payloadFingerprint = computeSolanaPayloadFingerprint({
    messageBytes: assembled.messageBytes,
  });

  const handle = createHandle({
    // `to`/`valueWei` are EVM-shaped PrepareArgs fields the handle store
    // requires; for Solana they carry placeholder values (the real intent is in
    // messageBytes + the Kamino-specific raw args). Mirrors the MarginFi tools.
    args: {
      to: String(input.rawArgs.reserve ?? ""),
      valueWei: "0",
      ...input.rawArgs,
      recentBlockhash: ctx.recentBlockhash,
    },
    tx: {
      txType: "solana",
      chainId: 0,
      to: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      valueWei: 0n,
      data: "0x" as `0x${string}`,
      messageBytes: assembled.messageBytes,
      feePayer: ctx.authority.toBase58(),
      recentBlockhash: ctx.recentBlockhash,
      programIds: assembled.programIds,
    },
    payloadFingerprint,
  });

  const ledgerNotice = LEDGER_NOTICE_SOLANA_BLIND_SIGN_TEMPLATE.replace(
    "{INSTRUCTION_NAME}",
    `Kamino ${input.opName}`,
  );
  const receipt = [...input.receiptLines, "", ledgerNotice].join("\n");

  return {
    content: [{ type: "text", text: receipt }],
    structuredContent: {
      handle,
      ...input.structured,
      recentBlockhash: ctx.recentBlockhash,
      payloadFingerprint,
      txType: "solana" as const,
      feePayer: ctx.authority.toBase58(),
      programIds: assembled.programIds,
      blindSign: true,
      clearSign: false,
    },
  };
}
