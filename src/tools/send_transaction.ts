// MCP tool: send_transaction({ handle, previewToken, userDecision })
//
// Third and final step of the Phase 4 trust pipeline (PREP-07 / PREP-08 /
// PREP-09). The handler enforces three gates in order:
//
//   1. SCHEMA gate (PREP-07 / T-GATE-1) — `userDecision` is constrained to
//      `["send", "cancel"]` via the inputSchema enum. The MCP boundary
//      (src/server.ts, Plan 04-04 addition) compiles + runs the schema via
//      ajv BEFORE this handler is invoked. Anything other than the two
//      legal values rejects at the protocol boundary with InvalidParams
//      (-32602); the handler is never entered.
//
//   2. STATE-MACHINE gate (T-STATE-4 / T-PREVIEW-CONSUMED-1) — the handle
//      must be in `previewed` status. `prepared` → PREVIEW_REQUIRED,
//      `sent` / `cancelled` → WRONG_STATUS. The `previewToken` value must
//      match `record.pinned.previewToken` (T-GATE-2 — single-use per pin).
//
//   3. PAYLOAD-FINGERPRINT DRIFT gate (PREP-08 / T-DRIFT-1) — load-bearing
//      defense against in-process state corruption between prepare and
//      send. Recompute the fingerprint over `record.tx`; if the recomputed
//      value differs from `record.payloadFingerprint` (stored at prepare
//      time), refuse with PAYLOAD_FINGERPRINT_DRIFT. The STORED value is
//      the trust anchor — Test 4 mutates the stored value directly to
//      prove the re-check fires when stored state is corrupted, NOT by
//      substituting `computePayloadFingerprint` (which would prove the
//      wrong thing).
//
// After all three gates pass, the handler resolves the SignClient + the
// active session topic, constructs `eth_sendTransaction` params ENTIRELY
// from `record.tx` + `record.pinned` (NEVER from agent-supplied args at
// send time — re-fetching would change the bytes the user verified against
// the LEDGER BLIND-SIGN HASH at preview), and forwards via
// `signClient.request<Hex>({ topic, chainId: "eip155:1", request: {...} })`.
// Ledger Live signs AND broadcasts internally, returning the broadcasted
// txHash (research § A3 — we do NOT call `viem.sendRawTransaction`).
//
// Cancel path (T-CANCEL-1 / Q1 locked): `userDecision: "cancel"` →
// `transitionToCancelled` → return `{ userCancelled: true }` non-error.
// No broadcast. The handle is NOT immediately evicted; lazy TTL reclaims
// it at the 15-min mark.
//
// Demo mode (DEMO-05 — Plan 05-02 wired): `userDecision: "send"` in demo
// mode passes the active persona's address as `account` to viem.call so
// the simulation has a meaningful msg.sender. NOTHING is signed; NOTHING
// is broadcast. The simulation envelope shape is locked HERE (Phase 4
// 04-04); Plan 05-02 only added the `account` field to the viem.call and
// the persona-null defense (refuses with WRONG_MODE if isDemoMode is true
// but getActivePersona() is null — the explicit-demo-without-set_demo_wallet
// path). Q-CONTRADICTION-PREP Option B: under this plan, `prepare_native_send`
// + `preview_send` ALSO succeed in demo (against persona address); the demo
// pipeline is rehearsable end-to-end through the actual tool surface.

import { type Hex, toHex } from "viem";
import { call } from "viem/actions";

import { getEthereumClient } from "../chains/ethereum.js";
import { isDemoMode } from "../config/env.js";
import { getActivePersona } from "../demo/state.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import {
  lookup,
  transitionToCancelled,
  transitionToSent,
} from "../signing/handle-store.js";
import { computePayloadFingerprint } from "../signing/payload-fingerprint.js";
import {
  getActiveSessionTopic,
  getStatus,
} from "../wallet/session-manager.js";
import { getWalletConnectClient } from "../wallet/walletconnect-client.js";
import { isUserRejectedError } from "../wallet/wc-errors.js";
import {
  type ToolHandler,
  type ToolHandlerResult,
  type ToolInputSchema,
  registerTool,
} from "./index.js";

// The shared `ToolHandlerResult.structuredContent` is typed as
// `Record<string, unknown>`; Plan 04-01's `StructuredError` is an explicit
// interface without an index signature. Wrap at the boundary so
// `makeStructuredError(...)` stays the canonical envelope constructor —
// same shape as Plans 04-02 + 04-03 use.
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}

/**
 * Build the SIMULATION text block emitted by demo-mode `userDecision: "send"`.
 * Verbatim shape locked here so Phase 5's persona-aware evolution doesn't
 * reshape the block.
 */
function buildSimulationText(
  toAddr: string,
  valueWei: bigint,
  simulationResult: Hex | null,
  simulationError: string | null,
): string {
  const lines = [
    "SIMULATION (demo mode)",
    `  to: ${toAddr}`,
    `  value: ${valueWei.toString()} wei`,
    simulationError !== null
      ? `  result: REVERT — ${simulationError}`
      : `  result: ${simulationResult ?? "0x"} (no broadcast performed)`,
  ];
  return lines.join("\n");
}

const DESCRIPTION = [
  "Forward a previewed transaction to Ledger Live via WalletConnect for on-device signing and broadcast. Returns `{ txHash, broadcastedAt }` on success.",
  "Use ONLY after preview_send has minted a previewToken AND the user has read the LEDGER BLIND-SIGN HASH block + the agent's CHECKS PERFORMED block AND confirmed they want to send.",
  "Three required fields — `handle`, `previewToken`, `userDecision`. `userDecision` MUST be exactly \"send\" to broadcast or \"cancel\" for a clean exit. ANY other value (including \"yes\", \"approve\", \"confirm\") is rejected at the MCP boundary — this is a schema-level gate, NOT a soft check.",
  "`userDecision: \"cancel\"` returns `userCancelled: true` and transitions the handle to terminal cancelled. No broadcast occurs.",
  "Ledger Live signs AND broadcasts internally — this MCP does NOT call sendRawTransaction. Successful response is the broadcasted txHash, NOT signed bytes.",
  "The handler re-checks payloadFingerprint against the prepare-time value. Drift (in-process state corruption between prepare and send) refuses with PAYLOAD_FINGERPRINT_DRIFT.",
  "Failure modes: PREVIEW_REQUIRED / PREVIEW_TOKEN_MISMATCH / WRONG_STATUS / WALLET_NOT_PAIRED / PAYLOAD_FINGERPRINT_DRIFT / LEDGER_REJECTED / BROADCAST_FAILED. In demo mode, returns a simulation envelope (DEMO-05) instead of broadcasting.",
].join(" ");

const INPUT_SCHEMA: ToolInputSchema = {
  type: "object",
  properties: {
    handle: {
      type: "string",
      description: "Handle returned by prepare_native_send (or any other prepare_* tool).",
    },
    previewToken: {
      type: "string",
      description: "previewToken returned by preview_send; single-use per pin.",
    },
    userDecision: {
      type: "string",
      enum: ["send", "cancel"],
      description:
        "Must be exactly \"send\" to broadcast, or \"cancel\" for a clean exit (handle transitions to terminal cancelled state).",
    },
  },
  required: ["handle", "previewToken", "userDecision"],
  additionalProperties: false,
};

/**
 * Re-export for `test/send-transaction.test.ts` Test 1b (standalone ajv
 * re-validation — regression anchor on schema-as-written). Production
 * code should NOT import this — it imports through the registry instead.
 */
export const INPUT_SCHEMA_FOR_TESTING = INPUT_SCHEMA;

/**
 * Narrowed input shape. Once the schema gate has run, every field is
 * present and typed. Re-exported so Test 1c (TypeScript narrowing
 * assertion — compile-time defense) can pin the literal-union shape of
 * `userDecision`; widening the schema to `type: "string"` without `enum`
 * would force `userDecision: string` here and break the type assertion.
 */
export interface SendTransactionArgs {
  handle: string;
  previewToken: string;
  userDecision: "send" | "cancel";
}

export const sendTransactionHandler: ToolHandler = async (args): Promise<ToolHandlerResult> => {
  try {
    // Type-narrowing is defense in depth — the schema gate at src/server.ts
    // already rejected anything that doesn't match the shape above. We
    // re-read defensively so the handler doesn't crash if invoked directly
    // (test-only path; production goes through the SDK gate).
    const handleArg = typeof args.handle === "string" ? args.handle : "";
    const previewTokenArg = typeof args.previewToken === "string" ? args.previewToken : "";
    const userDecision = args.userDecision === "cancel" ? "cancel" : "send";

    // Lookup the handle. HANDLE_NOT_FOUND / HANDLE_EXPIRED (15-min TTL).
    const lookupResult = lookup(handleArg);
    if (!lookupResult.ok) {
      const text =
        lookupResult.errorCode === "HANDLE_NOT_FOUND"
          ? "error: handle not found; call prepare_native_send + preview_send first"
          : "error: handle expired (>15min from prepare); call prepare_native_send to mint a fresh handle";
      return {
        isError: true,
        content: [{ type: "text", text }],
        structuredContent: errEnvelope(lookupResult.errorCode, text.replace(/^error: /, "")),
      };
    }
    const record = lookupResult.record;

    // STATE-MACHINE gate (T-STATE-4 / T-PREVIEW-CONSUMED-1). Terminal
    // states refuse with WRONG_STATUS; `prepared` refuses with
    // PREVIEW_REQUIRED to give a more actionable error than
    // "wrong status".
    if (record.status === "prepared") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: handle has not been previewed; call preview_send before send_transaction",
          },
        ],
        structuredContent: errEnvelope(
          "PREVIEW_REQUIRED",
          "call preview_send before send_transaction",
        ),
      };
    }
    if (record.status === "sent" || record.status === "cancelled") {
      const text = `error: handle is in terminal state: ${record.status}`;
      return {
        isError: true,
        content: [{ type: "text", text }],
        structuredContent: errEnvelope("WRONG_STATUS", text.replace(/^error: /, "")),
      };
    }
    // record.status === "previewed" — narrow `record.pinned` from optional.
    if (!record.pinned) {
      return {
        isError: true,
        content: [
          { type: "text", text: "error: previewed handle missing pinned state" },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "previewed handle missing pinned state",
        ),
      };
    }
    const pinned = record.pinned;

    // T-CANCEL-1 / Q1 locked. The cancel branch fires BEFORE previewToken
    // matching or fingerprint re-check — cancel is a flow exit (no
    // verification needed) and the agent may legitimately invoke it with
    // any token value.
    if (userDecision === "cancel") {
      const trans = transitionToCancelled(handleArg);
      if (!trans.ok) {
        return {
          isError: true,
          content: [
            { type: "text", text: `error: state transition failed: ${trans.errorCode}` },
          ],
          structuredContent: errEnvelope(trans.errorCode, `cancel failed: ${trans.errorCode}`),
        };
      }
      const cancelledAt = new Date().toISOString();
      return {
        content: [
          {
            type: "text",
            text: `cancelled (handle ${handleArg.slice(0, 8)}…); no broadcast occurred`,
          },
        ],
        structuredContent: {
          userCancelled: true,
          handle: handleArg,
          chainId: record.tx.chainId,
          cancelledAt,
        },
      };
    }

    // T-GATE-2: previewToken match. Wrong token → PREVIEW_TOKEN_MISMATCH;
    // signClient.request NEVER called (asserted by Test 2).
    if (previewTokenArg !== pinned.previewToken) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: previewToken does not match the one minted by preview_send. Did preview_send run again? Re-call preview_send to get the current token.",
          },
        ],
        structuredContent: errEnvelope(
          "PREVIEW_TOKEN_MISMATCH",
          "previewToken mismatch — preview_send may have re-pinned",
        ),
      };
    }

    // PREP-08 / T-DRIFT-1: recompute payloadFingerprint over the STORED
    // tx; compare with the STORED fingerprint. The stored value is the
    // trust anchor (computed once at prepare time). Any drift indicates
    // in-process state corruption between prepare and send — the
    // recompute fires the refusal. Test 4 mutates the STORED value
    // directly to prove this gate works against the actual attack model.
    const recomputed = computePayloadFingerprint({
      chainId: record.tx.chainId,
      to: record.tx.to,
      valueWei: record.tx.valueWei,
      data: record.tx.data,
    });
    if (recomputed !== record.payloadFingerprint) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: payloadFingerprint drift detected between prepare and send; abort and re-run prepare_native_send",
          },
        ],
        structuredContent: errEnvelope(
          "PAYLOAD_FINGERPRINT_DRIFT",
          "payloadFingerprint drift — handle state corrupted; re-run prepare_native_send",
        ),
      };
    }

    // DEMO-05 (Plan 05-02 wired): demo-mode `userDecision: "send"` runs the
    // unsigned tx through eth_call for revert detection. NOTHING signed;
    // NOTHING broadcast. The simulation envelope shape is locked here
    // (Phase 4 — T-DEMO-1 mitigation; `signClient.request` spy observes
    // ZERO calls in this branch). Plan 05-02 added `account: persona.address`
    // so the simulation has a meaningful msg.sender (defense against reverts
    // that depend on caller — common for token approval / staking flows).
    if (isDemoMode()) {
      // T-NULL-PERSONA-1: explicit `VAULTPILOT_DEMO=true` without prior
      // `set_demo_wallet` → `getActivePersona()` is null. viem accepts
      // `account: undefined` (msg.sender defaults to 0x0) but the
      // simulation result becomes meaningless for caller-dependent reverts.
      // Refuse explicitly so the agent sees a clear signal to call
      // `set_demo_wallet` first.
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
      const client = getEthereumClient();
      let simulationResult: Hex | null = null;
      let simulationError: string | null = null;
      try {
        const callResult = await call(client, {
          account: persona.address,
          to: record.tx.to,
          value: record.tx.valueWei,
          data: record.tx.data,
        });
        simulationResult = callResult.data ?? ("0x" as Hex);
      } catch (err) {
        simulationError = err instanceof Error ? err.message : String(err);
      }
      const simulatedAt = new Date().toISOString();
      return {
        content: [
          {
            type: "text",
            text: buildSimulationText(
              record.tx.to,
              record.tx.valueWei,
              simulationResult,
              simulationError,
            ),
          },
        ],
        structuredContent: {
          simulated: true,
          simulationResult,
          simulationError,
          simulatedAt,
          handle: handleArg,
          chainId: record.tx.chainId,
          nonce: pinned.nonce,
          gas: pinned.gas.toString(),
          maxFeePerGas: pinned.maxFeePerGas.toString(),
          maxPriorityFeePerGas: pinned.maxPriorityFeePerGas.toString(),
        },
      };
    }

    // T-PAIR-1: confirm pairing. `getStatus()` returns null if no live
    // session; `getActiveSessionTopic()` returns null if the WC client
    // hasn't been initialized OR no session in the store. Both → refuse
    // with WALLET_NOT_PAIRED.
    const status = await getStatus();
    if (status === null) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: no live Ledger session. Call `pair_ledger_live` to re-pair via WalletConnect, then retry.",
          },
        ],
        structuredContent: errEnvelope(
          "WALLET_NOT_PAIRED",
          "no live Ledger session at send time",
        ),
      };
    }
    const topic = getActiveSessionTopic();
    if (!topic) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: WalletConnect session topic gone; call `pair_ledger_live` to re-pair.",
          },
        ],
        structuredContent: errEnvelope(
          "WALLET_NOT_PAIRED",
          "WC session topic missing — session may have dropped between preview and send",
        ),
      };
    }

    // T-WC-FWD-1: txParams built ENTIRELY from `record.tx` + `record.pinned`
    // (server state). Agent args (`handle`, `previewToken`, `userDecision`)
    // were consumed above; they NEVER influence the tx envelope. All numeric
    // fields are 0x-prefixed hex strings per JSON-RPC convention — bigints
    // are not JSON-safe.
    const txParams = [
      {
        from: status.activeAccount,
        to: record.tx.to,
        value: toHex(record.tx.valueWei),
        gas: toHex(pinned.gas),
        maxFeePerGas: toHex(pinned.maxFeePerGas),
        maxPriorityFeePerGas: toHex(pinned.maxPriorityFeePerGas),
        nonce: toHex(pinned.nonce),
        data: record.tx.data,
      },
    ];

    const signClient = await getWalletConnectClient();
    let txHash: Hex;
    try {
      txHash = await signClient.request<Hex>({
        topic,
        chainId: `eip155:${record.tx.chainId}`,
        request: {
          method: "eth_sendTransaction",
          params: txParams,
        },
      });
    } catch (err) {
      // The WC SDK throws plain `{ code, message }` objects (matches
      // SDK_ERRORS shape from `@walletconnect/utils`), NOT Error
      // instances. `instanceof Error` returns false for those, so we
      // duck-type the `.message` field as a fallback before falling
      // back to `String(err)`.
      let cause: string;
      if (err instanceof Error) {
        cause = err.message;
      } else if (
        err !== null &&
        typeof err === "object" &&
        typeof (err as { message?: unknown }).message === "string"
      ) {
        cause = (err as { message: string }).message;
      } else {
        cause = String(err);
      }
      if (isUserRejectedError(err)) {
        return {
          isError: true,
          content: [
            { type: "text", text: `error: user rejected on Ledger device: ${cause}` },
          ],
          structuredContent: errEnvelope(
            "LEDGER_REJECTED",
            "user rejected on Ledger device",
            cause,
          ),
        };
      }
      return {
        isError: true,
        content: [{ type: "text", text: `error: broadcast failed: ${cause}` }],
        structuredContent: errEnvelope("BROADCAST_FAILED", "broadcast failed", cause),
      };
    }

    // Successful broadcast — transition handle to `sent` (T-PREVIEW-
    // CONSUMED-1: second send_transaction on the same handle now refuses
    // with WRONG_STATUS).
    const trans = transitionToSent(handleArg, txHash);
    if (!trans.ok) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: state transition failed after broadcast: ${trans.errorCode}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          `state transition failed after broadcast: ${trans.errorCode}`,
        ),
      };
    }
    const broadcastedAt = new Date().toISOString();
    return {
      content: [
        {
          type: "text",
          text: `broadcast OK\n  txHash: ${txHash}\n  broadcastedAt: ${broadcastedAt}`,
        },
      ],
      structuredContent: {
        txHash,
        broadcastedAt,
        handle: handleArg,
        chainId: record.tx.chainId,
      },
    };
  } catch (err) {
    // Defensive catch-all — the explicit refusal paths above cover all
    // expected failures. INTERNAL_ERROR is the unstructured fallback
    // (matches Plan 04-02 + 04-03 precedent).
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: send_transaction failed: ${message}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "send_transaction failed",
        message,
      ),
    };
  }
};

registerTool("send_transaction", DESCRIPTION, INPUT_SCHEMA, sendTransactionHandler);
