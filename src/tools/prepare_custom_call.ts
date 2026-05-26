// MCP tool: prepare_custom_call({ chain, to, data, value?, acknowledgeNonProtocolTarget: true, from? })
//
// Phase 35 Plan 35-03 (CUSTOM-01) — the v2.4 milestone close-out tool.
//
// The escape hatch. Prepares an unsigned EVM transaction for ANY verified or
// unverified contract by INTENTIONALLY bypassing the canonical-dispatch
// allowlist. Power-user feature for niche protocols and arbitrary verified
// contracts the agent has the user's explicit confirmation to call.
//
// Three coordinated load-bearing defenses (T-35-03-B mitigation):
//
//   1. **`acknowledgeNonProtocolTarget: true` SCHEMA GATE** — JSON-Schema
//      literal `{ const: true, type: "boolean" }` at the dispatch boundary.
//      Defeats `acknowledgeNonProtocolTarget: false` at the JSON-Schema
//      validator BEFORE the handler runs. Defense-in-depth in-handler check
//      below catches the `undefined` / missing case (and the test path that
//      direct-invokes the handler bypassing the schema layer).
//
//   2. **Canonical-alternative suggestion in refusal** — when the agent
//      relays calldata whose first 4 bytes match a protocol-aware prepare_*
//      tool (via `lookupCanonicalAlternative`), the refusal text names the
//      canonical tool the user should call instead. Steers away from the
//      bypass before the user has to make a decision.
//
//   3. **`[WARN — NON-PROTOCOL TARGET]` block at PREPARE TIME** — emitted
//      ABOVE the PREPARE RECEIPT so the agent surfaces the bypass-warning
//      verbatim to the user before relaying the handle to preview_send. The
//      preview-side response (Plan 35-03 Task 3) re-emits the SAME template
//      with the SAME substitutions. Drift between the two = tamper signal
//      asserted by integration test byte-identity (T-35-03-G).
//
// FROZEN cryptographic-binding chain UNTOUCHED:
//   - `computePayloadFingerprint` consumes the standard PREP-03 envelope
//     (chainId || to || valueWei || data) verbatim. The bypass flag is a
//     SEPARATE record annotation — NOT a fingerprint dimension. Fixture P
//     (test/signing-fingerprint.test.ts) anchors the escape-hatch fingerprint
//     as a hardcoded literal proving from-independence + standard envelope.
//   - `presignHash` / `send_transaction` three gates UNCHANGED. The Layer 3
//     fingerprint-drift gate fires for prepare_custom_call handles unchanged
//     (integration test Test 8).
//
// Grep-guard test surface (T-35-03-C mitigation): the line
// `acknowledgeNonProtocolTarget: true` must appear in EXACTLY TWO source
// files: this file AND src/signing/handle-store.ts (HandleRecord type defn
// + createHandle conditional spread). Adding a third site = test failure.

import { type Address, type Hex, getAddress } from "viem";

import { chainIdFromName, type ChainName } from "../config/contracts.js";
import {
  CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE,
  NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE,
  WARN_NON_PROTOCOL_TARGET_TEMPLATE,
} from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { createHandle } from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import { resolveFrom } from "../signing/resolve-from.js";
import { lookupCanonicalAlternative } from "../security/canonical-alternatives.js";
import { registerTool } from "./index.js";

// Mirror of `prepare_native_send.ts:75-81` — uniform envelope shape across
// all prepare_* tools.
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

const DESCRIPTION = [
  "Prepare an unsigned EVM transaction with agent-supplied raw calldata to a non-protocol target — the escape hatch for niche protocols and arbitrary verified contracts.",
  "BYPASSES the canonical-dispatch allowlist by design. Use ONLY when no canonical prepare_* tool covers the call AND the user has explicitly confirmed they want to call this address. For Aave / Compound / Morpho / Lido / EigenLayer / RocketPool / Uniswap V3 / Curve, use the dedicated prepare_* tool — those route through canonical-dispatch and surface protocol-aware DECODED ARGS.",
  "Returns a handle the agent passes to preview_send before send_transaction. The preview surfaces a [WARN — NON-PROTOCOL TARGET] block above all standard blocks; the device blind-signs the calldata (clear-sign UNAVAILABLE for non-protocol targets by definition).",
  "`acknowledgeNonProtocolTarget: true` is REQUIRED. The JSON-Schema literal-true gate defeats `false` at the dispatch boundary; missing/false returns a structured refusal naming the canonical alternative when the selector matches a known protocol.",
  "`chain` is REQUIRED — pass one of ethereum, arbitrum, polygon, base, optimism. No default-pick.",
  "`to` is the recipient contract address as a 0x-prefixed 20-byte hex string.",
  "`data` is the raw calldata as a 0x-prefixed hex string. The 4-byte selector (first 4 bytes) is shown on-device when the per-session ABI cache does not have the target address; call get_contract_abi first for a best-effort decode at preview.",
  "`value` is the WEI amount as a decimal string (default \"0\"). Use only when the called function is `payable`.",
  "Pass `from` when the user wants to act from a non-default approved account; otherwise omit and the active account is used.",
  "Requires a paired Ledger (call pair_ledger_live first if get_ledger_status shows paired: false).",
  "Returns `{ handle, chain, chainId, from, to, value, data, payloadFingerprint, acknowledgeNonProtocolTarget }` plus the [WARN — NON-PROTOCOL TARGET] + PREPARE RECEIPT text blocks.",
  "Failure modes: NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED (missing/false ack flag — refusal names canonical alternative when selector matches), INVALID_INPUT (malformed chain/to/data/value/from), WALLET_NOT_PAIRED (no live session in real mode), WRONG_MODE (demo mode but no persona).",
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
      pattern: "^0x[0-9a-fA-F]{40}$",
      description: "Target contract address (0x-prefixed 20-byte hex).",
    },
    data: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]*$",
      description:
        "Raw calldata as 0x-prefixed hex (e.g. \"0xa9059cbb...\"). First 4 bytes are the function selector shown on-device when no ABI is cached.",
    },
    value: {
      type: "string",
      description:
        "Amount in WEI as a decimal string (default \"0\"). Use only when the called function is payable.",
    },
    // LOAD-BEARING — JSON-Schema literal-true gate. `{ const: true, type: "boolean" }`
    // is the dispatch-boundary security gate; `false` is rejected by the
    // schema validator BEFORE the handler runs (T-35-03-B mitigation).
    acknowledgeNonProtocolTarget: {
      const: true,
      type: "boolean",
      description:
        "REQUIRED literal `true`. The user acknowledged they are calling a non-protocol target that bypasses the canonical-dispatch allowlist.",
    },
    from: {
      type: "string",
      pattern: "^0x[0-9a-fA-F]{40}$",
      description:
        "Optional sender — must be one of the per-chain approved accounts in get_ledger_status.accountsByChain[chainId].",
    },
  },
  required: ["chain", "to", "data", "acknowledgeNonProtocolTarget"],
  additionalProperties: false,
};

registerTool(
  "prepare_custom_call",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      const chainName = args.chain as ChainName;
      const chainId = chainIdFromName(chainName);

      // T-INPUT-1: shape-validate `to` and `data` defense-in-depth (schema
      // gate catches malformed upstream; this branch is reachable via direct
      // handler invocation in tests).
      const rawTo = typeof args.to === "string" ? args.to : "";
      if (!/^0x[0-9a-fA-F]{40}$/.test(rawTo)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'to' address: expected 0x-prefixed 20-byte hex, got "${rawTo}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'to' address: ${rawTo}`,
          ),
        };
      }

      const rawData = typeof args.data === "string" ? args.data : "";
      if (!/^0x[0-9a-fA-F]*$/.test(rawData)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'data': expected 0x-prefixed hex, got "${rawData}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `invalid 'data': ${rawData}`,
          ),
        };
      }

      // Defense-in-depth in-handler ack-flag refusal. The JSON-Schema
      // literal-true gate catches `false` upstream; this branch covers the
      // `undefined` / missing case (and the direct-invocation test path).
      if (args.acknowledgeNonProtocolTarget !== true) {
        // Selector is the first 4 bytes of `data` (10 chars including "0x").
        // For empty calldata, slice yields "0x" and lookup returns null —
        // refusal text falls through to the category-list fallback.
        const selectorHex = (rawData.length >= 10
          ? rawData.slice(0, 10)
          : "0x") as Hex;
        const alternative = lookupCanonicalAlternative(selectorHex);
        const suggestion = alternative
          ? `Use ${alternative.tool} instead (canonical-dispatch routed; ${alternative.reason}).`
          : "No canonical alternative recognized for this selector. If the user has explicitly confirmed they want to call this non-protocol contract, re-call with acknowledgeNonProtocolTarget: true.";
        const refusalText = NON_PROTOCOL_TARGET_REFUSAL_TEMPLATE
          .replace("{TO}", rawTo)
          .replace("{SELECTOR}", selectorHex)
          .replace("{SUGGESTION}", suggestion);
        return {
          isError: true,
          content: [{ type: "text", text: refusalText }],
          structuredContent: errEnvelope(
            "NON_PROTOCOL_TARGET_NOT_ACKNOWLEDGED",
            refusalText,
          ),
        };
      }

      // Parse `value` — defaults to "0". BigInt rejects decimals (off-by-decimal
      // guard).
      const rawValue =
        typeof args.value === "string" ? args.value : "0";
      let valueWei: bigint;
      try {
        valueWei = BigInt(rawValue);
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `error: invalid 'value': must be a decimal WEI string, got "${rawValue}"`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "value must parse as bigint",
          ),
        };
      }
      if (valueWei < 0n) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "error: invalid 'value': cannot be negative",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "value must be non-negative",
          ),
        };
      }

      // SENDER resolution — shared helper (mirror of prepare_native_send).
      const rawFrom =
        typeof args.from === "string" ? args.from : undefined;
      const fromResolution = await resolveFrom({ rawFrom, chainId });
      if (fromResolution.kind === "error") {
        return fromResolution.result;
      }
      const fromAddress: Address = fromResolution.fromAddress;

      // Build the PreparedTxEvm shape. Standard PREP-03 envelope — no
      // escape-hatch carve-out.
      const tx = {
        chainId,
        to: getAddress(rawTo) as Address,
        valueWei,
        data: rawData as Hex,
      };

      // FROZEN — Fixture P anchors this value as a hardcoded literal in
      // test/signing-fingerprint.test.ts. Drift in the preimage assembly for
      // escape-hatch calldata breaks Fixture P at PR-review time.
      const payloadFingerprint = computePayloadFingerprint(tx);

      // Mint the handle with the escape-hatch annotations. The two new
      // optional fields (`acknowledgeNonProtocolTarget`, `preparedBy`) flow
      // through `createHandle` to the record — preview_send reads them at
      // the EVM dispatch site to short-circuit the canonical-dispatch refusal
      // and at the DECODED ARGS arm to render the custom-call decode block.
      const handle = createHandle({
        args: {
          to: rawTo,
          valueWei: rawValue,
          data: rawData,
        },
        tx,
        payloadFingerprint,
        // GREP-GUARD: this assignment is one of EXACTLY TWO occurrences in
        // src/ (the other lives in src/signing/handle-store.ts conditional
        // spread). Integration test Test 6 fails the build if a third site
        // appears.
        acknowledgeNonProtocolTarget: true,
        preparedBy: "prepare_custom_call",
      });

      // Compose the response. WARN block ABOVE the PREPARE RECEIPT — the
      // user reads the bypass warning first. The {DECODED} slot at PREPARE
      // TIME deterministically substitutes "(see preview for ABI decode if
      // available)" so the byte-identity assertion in the integration test
      // compares apples to apples: preview-time uses the cache state to
      // pick between "(see DECODED ARGS below)" and "(no ABI cached — call
      // get_contract_abi first)". Both layers MUST use the same template
      // body — the substitution differs only in what's known at each layer.
      // Cross-link with Task 3's preview-side substitution.
      const warnBlock = WARN_NON_PROTOCOL_TARGET_TEMPLATE.replace(
        "{CHAIN}",
        `${chainName} (chainId ${chainId})`,
      )
        .replace("{TO}", rawTo)
        .replace(
          "{DECODED}",
          "(see preview for ABI decode if available)",
        );

      const receipt = CUSTOM_CALL_PREPARE_RECEIPT_TEMPLATE.replace(
        "{CHAIN}",
        `${chainName} (chainId ${chainId})`,
      )
        .replace("{TO}", rawTo)
        .replace("{VALUE}", rawValue)
        .replace("{DATA}", rawData);

      const text = [warnBlock, receipt].join("\n\n");

      return {
        content: [{ type: "text", text }],
        structuredContent: {
          handle,
          chain: chainName,
          chainId,
          from: fromAddress,
          to: rawTo,
          value: rawValue,
          data: rawData,
          payloadFingerprint,
          // Surface the ack flag in structuredContent so downstream tooling
          // (audit / dashboards / receipts) can detect escape-hatch handles
          // without re-reading the handle store.
          acknowledgeNonProtocolTarget: true,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: prepare_custom_call failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "prepare_custom_call failed",
          message,
        ),
      };
    }
  },
);
