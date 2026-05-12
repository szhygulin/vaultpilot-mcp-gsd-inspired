// MCP tool: prepare_native_send({ to, valueWei })
//
// First step of the Phase 4 trust pipeline (PREP-01 / PREP-02 / PREP-03).
// Composes Plan 04-01's signing primitives + Phase 3's session-manager:
//
//   demo-mode short-circuit
//     → input validation (`to` regex + `valueWei` BigInt parse + non-negative)
//     → pairing check (`getStatus()` non-null)
//     → compute `payloadFingerprint` over the viem-typed tx
//     → `createHandle` with RAW agent strings on `args` + viem-typed on `tx`
//     → return `{ handle, chainId: 1, to, valueWei, payloadFingerprint, prepareReceipt }`
//       plus a `PREPARE RECEIPT` text block surfacing verbatim agent args.
//
// Three load-bearing invariants asserted by `test/prepare-native-send.test.ts`:
//
//   1. **Demo-mode check FIRES FIRST** (T-DEMO-1) — BEFORE `getStatus` or
//      `createHandle`. Both spies must observe zero calls in demo mode. A
//      future contributor that reorders the demo check below the pairing
//      check would silently leak real-RPC behavior into a simulation
//      context. Matches Phase 3 03-02's `pair_ledger_live` precedent.
//
//   2. **PREPARE RECEIPT is VERBATIM** (PREP-02 + T-PREP-RCPT-1) — the
//      block reads from `args.to` + `args.valueWei` (RAW agent strings).
//      Address checksumming via `getAddress` happens ONLY for the
//      server-internal `tx.to` (consumed by `computePayloadFingerprint`)
//      and is NEVER surfaced in the text response. Test 4 asserts byte-
//      identity for a lowercase-hex input.
//
//   3. **`payloadFingerprint` computed AT PREPARE TIME** (PREP-03 + T-BIND-1)
//      via Plan 04-01's `computePayloadFingerprint`. Stored on the handle
//      record; Plan 04-04 re-checks at send time as the drift gate.
//      Fixture A inputs → `0x7e1867b2...` (Test 6).
//
// `chainId: 1` hard-coded per Q3 locked decision (research § Open Questions).
// Phase 8 PREP-40 generalizes every `prepare_*` with a mandatory `chain`
// parameter in a single coordinated pass; exposing it optionally here would
// force Phase 8 to revisit this contract twice.
//
// `valueWei` is WEI as a decimal string (NOT decimal ETH). Phase 6 adds
// decimal-aware parsing for ERC-20 `prepare_token_send` via
// `get_token_metadata`. The tool description re-states this explicitly to
// prevent agent off-by-decimal confusion (most common user-facing bug class
// per project CLAUDE.md "Decimal-aware arithmetic").

import { type Address, type Hex, getAddress } from "viem";

import { isDemoMode } from "../config/env.js";
import { PREPARE_RECEIPT_TEMPLATE } from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { getStatus } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";

// The shared `ToolHandlerResult.structuredContent` type is
// `Record<string, unknown>`; Plan 04-01's `StructuredError` is an explicit
// interface without an index signature. Cast at the boundary so the
// `makeStructuredError(...)` calls below remain the canonical envelope
// constructor (Plan 04-01 single source of truth) without modifying
// Phase 1's tool-handler contract OR Plan 04-01's error-codes module.
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}

const DESCRIPTION = [
  "Prepare an unsigned native ETH transfer on Ethereum mainnet.",
  "Returns a handle the agent then passes to preview_send before send_transaction.",
  "Use when the user wants to send native ETH from their paired Ledger on Ethereum mainnet.",
  "Do NOT use for ERC-20 token transfers — those land in Phase 6 (prepare_token_send).",
  "Do NOT use for contract calls / approve / swap / withdraw — each gets its own dedicated prepare_* tool.",
  "Do NOT use for other chains — v1.0 is Ethereum mainnet only; multi-chain is Phase 8.",
  "`valueWei` is the amount in WEI (10^18 wei = 1 ETH), passed as a decimal string (e.g. \"1000000000000000000\" for 1 ETH).",
  "Do NOT pass human-readable ETH amounts — off-by-decimal is the most common user-facing bug class.",
  "`to` is the recipient address as a 0x-prefixed 20-byte hex string.",
  "Requires a paired Ledger (call pair_ledger_live first if get_ledger_status shows paired: false).",
  "Returns `{ handle, chainId: 1, to, valueWei, payloadFingerprint, prepareReceipt }` plus a PREPARE RECEIPT text block surfacing the verbatim args.",
  "The agent MUST pass the handle to preview_send next — without preview + the resulting previewToken, send_transaction refuses.",
  "Failure modes: WALLET_NOT_PAIRED if no live session, INVALID_INPUT if to/valueWei malformed, DEMO_MODE_REFUSED if VAULTPILOT_DEMO=true.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    to: {
      type: "string",
      description:
        "Recipient address as 0x-prefixed 20-byte hex (e.g. \"0x70997970C51812dc3A010C7d01b50e0d17dc79C8\").",
      pattern: "^0x[0-9a-fA-F]{40}$",
    },
    valueWei: {
      type: "string",
      description:
        "Amount in WEI as a decimal string (10^18 wei = 1 ETH). Example: \"1000000000000000000\" for 1 ETH. Do NOT pass decimal ETH — Phase 6 adds decimal-aware ERC-20 sends.",
    },
  },
  required: ["to", "valueWei"],
  additionalProperties: false,
};

registerTool("prepare_native_send", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // T-DEMO-1 mitigation: demo-mode check FIRST — before session-manager,
    // before handle-store. Both spies must observe ZERO calls in this
    // branch (asserted by `toHaveBeenCalledTimes(0)` in the test suite).
    // `DEMO_MODE_REFUSED` is in the 13-code ErrorCode union (Plan 04-01's
    // single source of truth); there is NO `INTERNAL_ERROR + cause`
    // fallback shape.
    if (isDemoMode()) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: demo mode is active; signing tools refuse in demo mode. Use `set_demo_wallet` to select a curated persona for read-only flows. (Phase 5 lifts this for send_transaction to a simulation envelope; prepare_native_send remains refused.)",
          },
        ],
        structuredContent: errEnvelope(
          "DEMO_MODE_REFUSED",
          "demo mode is active; signing tools are disabled",
        ),
      };
    }

    // T-ADDR-1: validate `to` shape BEFORE any state read. Refuses with
    // INVALID_INPUT and names the offending value in the text response so
    // the agent can self-correct. NO handle is created.
    const to = typeof args.to === "string" ? args.to : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'to' address: expected 0x-prefixed 20-byte hex, got "${to}"`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `invalid 'to' address: ${to}`,
        ),
      };
    }

    // T-VALUE-1: parse `valueWei` via BigInt. `"1.5"` throws (BigInt
    // rejects decimals — this is the off-by-decimal guard). `"-1"` parses
    // successfully but fails the non-negative check below.
    const rawValueWei = typeof args.valueWei === "string" ? args.valueWei : "";
    let valueWei: bigint;
    try {
      valueWei = BigInt(rawValueWei);
    } catch {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: invalid 'valueWei': must be a decimal string in wei (10^18 wei = 1 ETH), got "${rawValueWei}"`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          "valueWei must parse as bigint",
        ),
      };
    }
    if (valueWei < 0n) {
      return {
        isError: true,
        content: [
          { type: "text", text: "error: invalid 'valueWei': cannot be negative" },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          "valueWei must be non-negative",
        ),
      };
    }

    // T-PAIR-1: confirm pairing. `getStatus()` returns `LedgerStatus | null`;
    // null means no live session. NO handle is created on the unpaired
    // branch (defense against state-pollution attacks — `createHandle` spy
    // observes zero calls in Test 2).
    const status = await getStatus();
    if (status === null) {
      return {
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
      };
    }

    // chainId hard-coded to 1 (Ethereum mainnet) — v1.0 is mainnet-only.
    // Phase 8 (PREP-40) generalizes every prepare_* with a mandatory `chain`
    // parameter in a single coordinated pass; adding it optionally here
    // invites Phase 8 to revisit this contract twice. See
    // .planning/phases/04-native-eth-send-the-trust-pipeline/04-RESEARCH.md
    // § Open Questions Q3.
    const tx = {
      chainId: 1,
      // Checksummed for server-internal correctness — NEVER surfaced in
      // the receipt text. T-PREP-RCPT-1 mitigation: the receipt reads from
      // `args.to` (raw string), not `tx.to`.
      to: getAddress(to) as Address,
      valueWei,
      // Native send has no calldata.
      data: "0x" as Hex,
    };

    // PREP-03 + T-BIND-1: compute the binding fingerprint at prepare time.
    // Plan 04-04's send handler re-runs `computePayloadFingerprint` on
    // `record.tx` and asserts equality with this stored value (drift gate).
    const payloadFingerprint = computePayloadFingerprint(tx);

    // PREP-02 + T-PREP-RCPT-1: `args` carries the RAW agent strings;
    // `tx` carries the viem-typed values. The receipt block below reads
    // EXCLUSIVELY from `args` so a future contributor cannot accidentally
    // surface a checksummed/normalized form. The PrepareArgs type
    // (`string`, NOT `Address` / `bigint`) blocks normalization at the
    // storage boundary.
    const handle = createHandle({
      args: { to, valueWei: rawValueWei },
      tx,
      payloadFingerprint,
    });

    // PREPARE RECEIPT — substituted from the format-fanout-sentinel const.
    // The test imports the SAME `PREPARE_RECEIPT_TEMPLATE` and substitutes
    // the same way, asserting byte-identity. Re-declaring the multi-line
    // string in this file (or in the test) would violate the format-fanout-
    // regex-sync invariant — a future edit to the const would silently
    // leave a duplicate behind.
    const receipt = PREPARE_RECEIPT_TEMPLATE
      .replace("{TO}", to)
      .replace("{VALUE_WEI}", rawValueWei);

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        chainId: 1,
        to,
        valueWei: rawValueWei,
        payloadFingerprint,
      },
    };
  } catch (err) {
    // Defensive catch-all — the four explicit refusal paths above should
    // cover all expected failures. INTERNAL_ERROR is the unstructured
    // fallback (matches Phase 3 03-02 precedent — NOT a demo-mode
    // fallback; that path is fully covered by the locked DEMO_MODE_REFUSED
    // code in Plan 04-01's ErrorCode union).
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: prepare_native_send failed: ${message}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "prepare_native_send failed",
        message,
      ),
    };
  }
});
