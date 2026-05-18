// MCP tool: prepare_native_send({ chain, to, valueWei })
//
// First step of the Phase 4 trust pipeline (PREP-01 / PREP-02 / PREP-03).
// Composes Plan 04-01's signing primitives + Phase 3's session-manager:
//
//   demo-mode short-circuit
//     → input validation (`to` regex + `valueWei` BigInt parse + non-negative)
//     → pairing check (`getStatus()` non-null)
//     → compute `payloadFingerprint` over the viem-typed tx
//     → `createHandle` with RAW agent strings on `args` + viem-typed on `tx`
//     → return `{ handle, chain, chainId, to, valueWei, payloadFingerprint, prepareReceipt }`
//       plus a `PREPARE RECEIPT` text block surfacing verbatim agent args.
//
// Phase 8 — Plan 08-02 (PREP-40 + PREP-41): `chain` arg threaded through;
// REQUIRED enum (`ethereum | arbitrum | polygon | base | optimism`). The
// JSON-schema enum is the dispatch-boundary gate; per-handler re-validation
// is unreachable on enum violation.
//
// Three load-bearing invariants asserted by `test/prepare-native-send.test.ts`:
//
//   1. **Demo-mode check FIRES FIRST** (T-DEMO-1, T-NULL-PERSONA-1) — BEFORE
//      `getStatus`. In demo mode (Plan 05-02 / Q-CONTRADICTION-PREP Option B):
//      use `getActivePersona().address` as `from`; refuse with `WRONG_MODE` if
//      persona is null. `getStatus` is NEVER called in demo mode — defense
//      against accidental WC-session reads when no pairing is needed.
//      `createHandle` IS called in demo mode (Phase 5 — Q-CONTRADICTION-PREP
//      Option B); the handle flows through preview + send like real mode.
//      `signClient.request` is NEVER called in demo mode (the gate is in
//      `send_transaction`).
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
//      Fixture A inputs → `0x7e1867b2...` (Test 6). PREP-03's preimage is
//      `chainId || to || valueWei || data` — `from` is NOT in the preimage,
//      so Fixture A holds REGARDLESS of whether `from` is the paired Ledger
//      address (real mode) or the persona address (Plan 05-02 demo mode).
//
// Phase 8 — Plan 08-02 (PREP-40 + PREP-41): chainId derives from the agent's
// `chain` enum arg via `chainIdFromName(args.chain as ChainName)`.
//
// `valueWei` is WEI as a decimal string (NOT decimal ETH). Phase 6 adds
// decimal-aware parsing for ERC-20 `prepare_token_send` via
// `get_token_metadata`. The tool description re-states this explicitly to
// prevent agent off-by-decimal confusion (most common user-facing bug class
// per project CLAUDE.md "Decimal-aware arithmetic").

import { type Address, type Hex, getAddress } from "viem";

import { chainIdFromName, type ChainName } from "../config/contracts.js";
import { isDemoMode } from "../config/env.js";
import { getActivePersona } from "../demo/state.js";
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
  "Prepare an unsigned native gas-token transfer on the specified EVM chain.",
  "Returns a handle the agent then passes to preview_send before send_transaction.",
  "Use when the user wants to send native ETH / MATIC / etc. from their paired Ledger on one of: ethereum, arbitrum, polygon, base, optimism.",
  "Do NOT use for ERC-20 token transfers — those land in Phase 6 (prepare_token_send).",
  "Do NOT use for contract calls / approve / swap / withdraw — each gets its own dedicated prepare_* tool.",
  "`chain` is REQUIRED — pass one of ethereum, arbitrum, polygon, base, optimism. No default-pick; omitting the arg refuses at the dispatch boundary.",
  "`valueWei` is the amount in WEI (10^18 wei = 1 ETH), passed as a decimal string (e.g. \"1000000000000000000\" for 1 ETH).",
  "Do NOT pass human-readable ETH amounts — off-by-decimal is the most common user-facing bug class.",
  "`to` is the recipient address as a 0x-prefixed 20-byte hex string.",
  "Requires a paired Ledger (call pair_ledger_live first if get_ledger_status shows paired: false).",
  "Returns `{ handle, chain, chainId, to, valueWei, payloadFingerprint, prepareReceipt }` plus a PREPARE RECEIPT text block surfacing the verbatim args.",
  "The agent MUST pass the handle to preview_send next — without preview + the resulting previewToken, send_transaction refuses.",
  "In demo mode, succeeds against the active persona's address (set via set_demo_wallet); send_transaction returns a simulation envelope instead of broadcasting.",
  "Failure modes: WALLET_NOT_PAIRED if no live session (real mode), WRONG_MODE if demo mode is on but no persona is set, INVALID_INPUT if chain/to/valueWei malformed.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    chain: {
      type: "string",
      enum: ["ethereum", "arbitrum", "polygon", "base", "optimism"],
      description:
        "Chain identifier (required). Supported: ethereum, arbitrum, polygon, base, optimism.",
    },
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
  required: ["chain", "to", "valueWei"],
  additionalProperties: false,
};

registerTool("prepare_native_send", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // Phase 8 — Plan 08-02: chainId from the agent's `chain` arg. JSON-schema
    // enum is the dispatch-boundary gate; per-handler re-validation is
    // unreachable on enum violation.
    const chainName = args.chain as ChainName;
    const chainId = chainIdFromName(chainName);

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

    // SENDER resolution (Plan 05-02 / Q-CONTRADICTION-PREP Option B):
    // In demo mode, the active persona's address is `from`; in real mode,
    // the paired Ledger's address is `from`. T-DEMO-1 + T-NULL-PERSONA-1
    // mitigation: demo branch SKIPS `getStatus()` (no WC pairing exists in
    // demo), so the `getStatus` spy observes zero calls in the demo arm.
    // The `WRONG_MODE` refusal here is defense-in-depth — auto-demo seeds
    // `whale` so `getActivePersona()` is non-null in practice; the explicit
    // `VAULTPILOT_DEMO=true` arm without a prior `set_demo_wallet` call is
    // the only way to reach the null branch.
    //
    // T-DEMO-FROM-LEAK-1 mitigation: persona address surfaces in the
    // receipt + structuredContent as `from`; the simulation banner in
    // `send_transaction` (Plan 04-04 — locked here) AND the auto-demo
    // NOTICE (Plan 05-03) make clear the user is NOT signing — they have
    // no key for this address.
    let fromAddress: Address;
    if (isDemoMode()) {
      const persona = getActivePersona();
      if (persona === null) {
        return {
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
        };
      }
      fromAddress = persona.address;
    } else {
      // T-PAIR-1: confirm pairing. `getStatus()` returns `LedgerStatus | null`;
      // null means no live session. NO handle is created on the unpaired
      // branch (defense against state-pollution attacks).
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
      fromAddress = status.activeAccount;
    }

    // Phase 8 — Plan 08-02: chainId from `args.chain` enum (above).
    const tx = {
      chainId,
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
    //
    // Phase 8 — Plan 08-02: `{CHAIN}` slot widening surfaces the chain name +
    // chainId verbatim in the receipt body (the on-device clear-sign display
    // shows the same chain — the receipt is the cross-check anchor).
    const receipt = PREPARE_RECEIPT_TEMPLATE
      .replace("{CHAIN}", `${chainName} (chainId ${chainId})`)
      .replace("{TO}", to)
      .replace("{VALUE_WEI}", rawValueWei);

    return {
      content: [{ type: "text", text: receipt }],
      structuredContent: {
        handle,
        // Phase 8 — Plan 08-02: chain name + chainId surfaced verbatim.
        chain: chainName,
        chainId,
        // `from` surfaces the resolved sender (persona address in demo,
        // paired Ledger address in real mode). Plan 05-02 addition. The
        // PREPARE_RECEIPT_TEMPLATE text block is unchanged (PREP-02
        // invariant — receipt is shared with get_tx_verification re-emit
        // and stays bound to args.to + args.valueWei verbatim).
        from: fromAddress,
        to,
        valueWei: rawValueWei,
        payloadFingerprint,
      },
    };
  } catch (err) {
    // Defensive catch-all — the explicit refusal paths above should cover
    // all expected failures. INTERNAL_ERROR is the unstructured fallback
    // (matches Phase 3 03-02 precedent — NOT a demo-mode fallback; the
    // explicit demo paths above are WRONG_MODE for null-persona (Plan
    // 05-02) and the persona-aware success branch).
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
