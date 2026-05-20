// Shared `from`-resolution helper for the 7 `prepare_*` tools.
//
// Issue #62 — accept optional `from: Address` on every `prepare_*` tool so the
// agent can name a non-default approved account without a round-trip through
// `set_active_account`. The lookup logic lives in ONE place (this file) and is
// imported by every prepare handler; duplicating the validation N times would
// drift the refusal envelopes apart at the first edit.
//
// Modes:
//   1. **Real mode + `from` omitted** — current behavior. Returns
//      `status.activeAccount`; byte-identical to today (back-compat for the
//      Phase 4/5/6 fixture tests).
//   2. **Real mode + `from` supplied** — validate against
//      `status.accountsByChain[chainId]` (per-chain approved set, the same
//      contract `set_active_account` enforces today). Refuse with
//      `INVALID_ACCOUNT` + in-session list when absent. Refuse with
//      `INVALID_INPUT` when malformed (defense-in-depth; the schema gate at
//      the protocol boundary catches the same shape upstream).
//   3. **Demo mode + `from` omitted** — current behavior. Returns the active
//      persona's address; `WRONG_MODE` when no persona is set.
//   4. **Demo mode + `from` supplied** — validate against the active persona's
//      address. Demo has no multi-account surface (one persona = one
//      address); a `from` that doesn't match returns `WRONG_MODE` naming the
//      persona-driven nature of demo. (Choice documented in the PR body.)
//
// `from`-independence in the cryptographic preimage is preserved by callers
// (PREP-03 `chainId || to || valueWei || data` — `from` is NOT in the
// fingerprint). Fixtures A/B/C/D/E/F/G/H in `test/signing-fingerprint.test.ts`
// stay byte-identical; the integration test's persona-cycle re-anchors that
// invariant end-to-end.

import { type Address, getAddress } from "viem";

import { type ChainId } from "../config/contracts.js";
import { isDemoMode } from "../config/env.js";
import { getActivePersona } from "../demo/state.js";
import { getStatus } from "../wallet/session-manager.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "./error-codes.js";

/**
 * The result the resolver returns to the caller. Either an `ok` envelope with
 * the resolved sender + a flag indicating whether the caller supplied `from`
 * (so the prepare receipt can conditionally surface a `From: 0x…` line), or
 * an `error` envelope the tool returns verbatim.
 */
export type ResolveFromResult =
  | {
      kind: "ok";
      /** Resolved sender address — the persona address in demo, the per-chain
       * active account in real mode (or the caller-supplied `from`). */
      fromAddress: Address;
      /** True when the caller passed `args.from`; false when the resolver
       * fell through to `status.activeAccount` / persona.address. Drives
       * whether the PREPARE RECEIPT emits a `From: 0x…` line. */
      callerSupplied: boolean;
    }
  | {
      kind: "error";
      /** Tool-result envelope, ready to return from the handler. */
      result: {
        isError: true;
        content: Array<{ type: "text"; text: string }>;
        structuredContent: Record<string, unknown> & StructuredError;
      };
    };

function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> & StructuredError {
  return makeStructuredError(code, message, cause) as Record<string, unknown> &
    StructuredError;
}

/**
 * Resolve the sender address for a `prepare_*` call.
 *
 * `args.from` (optional) is the caller-supplied address — when present, it's
 * validated against the per-chain approved set (real mode) or the active
 * persona address (demo mode). When absent, behavior is byte-identical to
 * pre-issue-#62 (`status.activeAccount` / persona.address fallback).
 *
 * Address-shape regex check is defense-in-depth — the JSON-schema gate at the
 * protocol boundary rejects malformed `from` upstream, but direct handler
 * invocation (test path) skips that gate.
 */
export async function resolveFrom(input: {
  /** Caller-supplied `args.from`. `undefined` = omitted; string = supplied. */
  rawFrom: string | undefined;
  /** Chain context for the per-chain `accountsByChain[chainId]` lookup. */
  chainId: ChainId;
}): Promise<ResolveFromResult> {
  const { rawFrom, chainId } = input;

  // Schema-shape regex (defense-in-depth). The dispatch-boundary JSON-schema
  // pattern catches this upstream; this branch is reachable via direct
  // handler invocation (test path).
  if (rawFrom !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(rawFrom)) {
    return {
      kind: "error",
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'from' address: expected 0x-prefixed 20-byte hex, got "${rawFrom}"`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'from' address: ${rawFrom}`,
        ),
      },
    };
  }

  if (isDemoMode()) {
    const persona = getActivePersona();
    if (persona === null) {
      return {
        kind: "error",
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "error: demo mode is active but no persona set. Call `set_demo_wallet({ persona: \"whale\" | \"defi-degen\" | \"stable-saver\" | \"staking-maxi\" })` first.",
            },
          ],
          structuredContent: errEnvelope(
            "WRONG_MODE",
            "demo mode active but no persona set; call set_demo_wallet first",
          ),
        },
      };
    }

    if (rawFrom !== undefined) {
      // Demo has no multi-account surface — one persona = one address. A
      // caller-supplied `from` that doesn't match the active persona refuses
      // with WRONG_MODE (the conceptual mismatch is "you asked for a
      // multi-account selector that doesn't exist in this mode"), naming the
      // persona-driven nature of demo.
      const normalizedSupplied = getAddress(rawFrom);
      const personaChecksummed = getAddress(persona.address);
      if (normalizedSupplied !== personaChecksummed) {
        return {
          kind: "error",
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  `error: in demo mode, 'from' must match the active persona's address. ` +
                  `Requested: ${rawFrom}. Active persona address: ${persona.address}. ` +
                  `Switch personas via \`set_demo_wallet({ persona })\` instead of passing \`from\`.`,
              },
            ],
            structuredContent: errEnvelope(
              "WRONG_MODE",
              `'from' (${rawFrom}) does not match active persona address (${persona.address}); demo mode has no multi-account surface`,
            ),
          },
        };
      }
      return { kind: "ok", fromAddress: persona.address, callerSupplied: true };
    }

    return { kind: "ok", fromAddress: persona.address, callerSupplied: false };
  }

  // Real mode.
  const status = await getStatus();
  if (status === null) {
    return {
      kind: "error",
      result: {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: no live Ledger session. Call `pair_ledger_live` to pair a Ledger via WalletConnect, then retry.",
          },
        ],
        structuredContent: errEnvelope(
          "WALLET_NOT_PAIRED",
          "no live Ledger session",
        ),
      },
    };
  }

  if (rawFrom !== undefined) {
    // Per-chain validation — same contract `set_active_account({ chain })`
    // enforces today. The chain scope is the agent's `chain` arg (already
    // validated at the schema boundary as one of the 5 supported chains).
    const chainAccounts = status.accountsByChain[chainId] ?? [];
    let normalized: Address;
    try {
      normalized = getAddress(rawFrom);
    } catch {
      // viem.getAddress throws on malformed hex; surface as INVALID_INPUT
      // (the regex above caught this for direct test paths, but a borderline
      // hex case could still fall through — defense-in-depth).
      return {
        kind: "error",
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'from' address: expected 0x-prefixed 20-byte hex, got "${rawFrom}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'from' address: ${rawFrom}`,
          ),
        },
      };
    }
    const match = chainAccounts.find((a) => getAddress(a) === normalized);
    if (!match) {
      return {
        kind: "error",
        result: {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `error: 'from' address ${rawFrom} is not in the current Ledger session for chainId ${chainId}. ` +
                `Approved accounts on this chain: ${chainAccounts.length > 0 ? chainAccounts.join(", ") : "(none — chain not covered by current session)"}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_ACCOUNT",
            `'from' address not in session for chainId ${chainId}; chain accounts: ${chainAccounts.join(",")}`,
          ),
        },
      };
    }
    return { kind: "ok", fromAddress: normalized, callerSupplied: true };
  }

  return {
    kind: "ok",
    fromAddress: status.activeAccount,
    callerSupplied: false,
  };
}
