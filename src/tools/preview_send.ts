// MCP tool: preview_send({ handle })
//
// Second step of the Phase 4 trust pipeline (PREP-04 / PREP-05 / PREP-06).
// Reads a prepared handle, resolves and pins nonce / gas / EIP-1559 fees AT
// PREVIEW TIME (research § Anti-Patterns line 416 — pinning at prepare time
// would widen the staleness window the user is asked to approve), recomputes
// the EIP-1559 pre-sign hash via Plan 04-01's pure `computePresignHash`,
// mints a fresh UUID `previewToken`, calls Plan 04-05's `lookupSelector` for
// the 4byte cross-check, and emits four plain-text blocks:
//
//   LEDGER BLIND-SIGN HASH   — full hex + chunked hex (A1 mitigation)
//   [AGENT TASK — ...]       — the four local checks the agent runs (PREP-05)
//   4BYTE CROSS-CHECK        — verbatim selector decode (PREP-06)
//   VERIFY BEFORE SIGNING    — user-facing pre-confirm summary
//
// Three non-negotiable invariants asserted by `test/preview-send.test.ts`:
//
//   1. **SENDER address from `getStatus().address`** (T-PIN-1, T-FROM-1) —
//      `getTransactionCount` reads the SENDER's nonce, NOT `tx.to`'s nonce.
//      Research § Code Example 3 line 666 names this explicitly as the
//      anti-foot-gun. Test 1 asserts the mock spy is called with the
//      paired address from `getStatus()`.
//
//   2. **`presignHash` matches Fixture C byte-for-byte** (T-PRESIGN-1) — for
//      the documented inputs (chainId 1, nonce 7, gas 21000, maxFeePerGas
//      30 gwei, maxPriorityFeePerGas 1.5 gwei, value 1 ETH, data "0x",
//      to 0x70997970…), the keccak is
//      `0xb28e48247c132650294459b31a5ad7e4e9ad187abb0f984388629b2c29e27e85`.
//      Test 2 asserts byte-identity. If the device displays a different
//      hash the user's verification ritual is meaningless — this is the
//      load-bearing anchor.
//
//   3. **Idempotent re-preview (Q4 locked decision)** — a second call on
//      an already-`previewed` handle re-resolves fresh nonce/gas/fees,
//      re-pins via `transitionToPreviewed` (which OVERWRITES per Plan
//      04-01), and mints a FRESH `previewToken`. The PRIOR token is no
//      longer valid; only `record.pinned.previewToken` matches at send
//      time (Plan 04-04's send-time check). Rationale: gas/nonce/fees go
//      stale over minutes; re-prepare would change the
//      `payloadFingerprint` and break the trust binding, but re-preview
//      keeps the binding while freshening the pin.
//
// The 4byte block is rendered via `build4byteBlock` imported from
// `src/signing/blocks.ts` (Plan 04-05) — NOT inlined here. Format-fanout-
// sentinel: one helper, one home.

import { type Hex } from "viem";
import { estimateFeesPerGas, estimateGas, getTransactionCount } from "viem/actions";

import { getEthereumClient } from "../chains/ethereum.js";
import { lookupSelector } from "../clients/fourbyte.js";
import { isDemoMode } from "../config/env.js";
import {
  AGENT_TASK_TEMPLATE,
  LEDGER_BLIND_SIGN_HASH_TEMPLATE,
  VERIFY_BEFORE_SIGNING_TEMPLATE,
  build4byteBlock,
  chunkHex,
} from "../signing/blocks.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { lookup, transitionToPreviewed } from "../signing/handle-store.js";
import { computePresignHash } from "../signing/presign-hash.js";
import { getStatus } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";

// `ToolHandlerResult.structuredContent` is typed as
// `Record<string, unknown>`; Plan 04-01's `StructuredError` is an explicit
// interface without an index signature. Cast at the boundary so
// `makeStructuredError(...)` stays the canonical envelope constructor
// without modifying Phase 1's tool-handler contract OR Plan 04-01's error-
// codes module. Same wrapper shape Plan 04-02's `prepare_native_send` uses.
function errEnvelope(
  code: ErrorCode,
  message: string,
  cause?: string,
): Record<string, unknown> {
  return makeStructuredError(code, message, cause) as unknown as Record<string, unknown> & StructuredError;
}

const DESCRIPTION = [
  "Resolve and pin nonce + gas + EIP-1559 fees onto a prepared handle; recompute the EIP-1559 pre-sign hash; emit the LEDGER BLIND-SIGN HASH + AGENT TASK + 4byte cross-check blocks.",
  "Use AFTER prepare_native_send (or any other prepare_* tool) and BEFORE send_transaction. The handle returned by prepare_* must be passed here verbatim.",
  "Read the LEDGER BLIND-SIGN HASH block to the user; perform the four checks in the AGENT TASK block; emit your results in a `CHECKS PERFORMED` block before asking the user to confirm send.",
  "Do NOT skip preview_send and call send_transaction directly — send_transaction's schema-level gate refuses without a valid previewToken (which only this tool mints).",
  "Returns `{ previewToken, presignHash, chainId, nonce, gas, maxFeePerGas, maxPriorityFeePerGas, selector, fourbyte }` plus the three-block text payload (LEDGER BLIND-SIGN HASH, AGENT TASK, 4BYTE CROSS-CHECK) and a VERIFY BEFORE SIGNING summary.",
  "Idempotent re-preview (Q4): calling preview_send twice on the same handle re-pins fresh nonce/gas/fees and INVALIDATES the prior previewToken. Only the most recent token matches at send time — call again after a long pause to freshen the pin.",
  "Failure modes: HANDLE_NOT_FOUND if the handle is unknown, HANDLE_EXPIRED past 15-min TTL, WRONG_STATUS on already-sent or cancelled handles, WALLET_NOT_PAIRED if the WalletConnect session has dropped, DEMO_MODE_REFUSED if VAULTPILOT_DEMO=true.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    handle: {
      type: "string",
      description: "Handle returned by prepare_native_send (or any other prepare_* tool).",
    },
  },
  required: ["handle"],
  additionalProperties: false,
};

registerTool("preview_send", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  try {
    // T-DEMO-1 mitigation: demo-mode check FIRST — before handle-store
    // lookup, before viem reads, before 4byte. All downstream spies must
    // observe ZERO calls in this branch (Test 10). Matches Plan 04-02
    // precedent.
    if (isDemoMode()) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: demo mode is active; preview_send refuses in demo mode. Use `set_demo_wallet` to select a curated persona for read-only flows. (Phase 5 evolves demo mode for send_transaction simulation; preview_send remains refused.)",
          },
        ],
        structuredContent: errEnvelope(
          "DEMO_MODE_REFUSED",
          "demo mode is active; signing tools are disabled",
        ),
      };
    }

    const handleArg = typeof args.handle === "string" ? args.handle : "";

    // Lookup the handle. `HANDLE_NOT_FOUND` and `HANDLE_EXPIRED` (15-min
    // TTL via lazy eviction) are the two failure modes — surface both
    // unchanged from Plan 04-01's typed return.
    const lookupResult = lookup(handleArg);
    if (!lookupResult.ok) {
      const message =
        lookupResult.errorCode === "HANDLE_NOT_FOUND"
          ? "error: handle not found; call prepare_native_send first to mint a handle"
          : "error: handle expired (>15min from prepare); call prepare_native_send to mint a fresh handle";
      return {
        isError: true,
        content: [{ type: "text", text: message }],
        structuredContent: errEnvelope(lookupResult.errorCode, message.replace(/^error: /, "")),
      };
    }
    const record = lookupResult.record;

    // T-STATE-3: refuse re-preview on a `sent` or `cancelled` handle.
    // `transitionToPreviewed` would return `WRONG_STATUS` for these states
    // anyway, but checking here short-circuits the viem reads (cheaper +
    // gives a clearer error).
    if (record.status === "sent" || record.status === "cancelled") {
      const text = `error: handle is in status "${record.status}"; preview_send only legal from "prepared" or "previewed"`;
      return {
        isError: true,
        content: [{ type: "text", text }],
        structuredContent: errEnvelope(
          "WRONG_STATUS",
          `handle in status ${record.status}; cannot re-preview`,
        ),
      };
    }

    // T-PAIR-1 defense-in-depth: confirm pairing AT PREVIEW TIME. The
    // session may have dropped between prepare and preview (Ledger app
    // closed, Live disconnected, WC relay timeout). Surface as
    // WALLET_NOT_PAIRED — the user re-pairs and re-calls preview_send.
    const status = await getStatus();
    if (status === null) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: no live Ledger session. Call `pair_ledger_live` to re-pair via WalletConnect, then retry preview_send.",
          },
        ],
        structuredContent: errEnvelope(
          "WALLET_NOT_PAIRED",
          "no live Ledger session at preview time",
        ),
      };
    }
    // T-PIN-1 / T-FROM-1: SENDER is `status.address` (from `getStatus()`),
    // NOT `record.tx.to`. Research § Code Example 3 line 666 explicit
    // anti-foot-gun: a contributor who reads `tx.to` would compute the
    // recipient's nonce, not the sender's — leading to a transaction the
    // network would reject (or in a weird collision case, re-spend a
    // recipient's nonce on the sender). Test 1 asserts the address passed
    // to `getTransactionCount` matches `status.address`.
    const senderAddress = status.address;

    // Resolve nonce / fees / gas concurrently. Pin AT PREVIEW TIME
    // (research § Anti-Patterns line 416). RPC errors here are
    // operational — surface as `INTERNAL_ERROR` with the underlying
    // message; the user retries.
    const client = getEthereumClient();
    let pendingNonce: number;
    let fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
    let gasEstimate: bigint;
    try {
      [pendingNonce, fees, gasEstimate] = await Promise.all([
        getTransactionCount(client, { address: senderAddress, blockTag: "pending" }),
        // `chain: null` defers to the client's configured chain (mainnet
        // per src/chains/ethereum.ts). viem 2.48's `PublicClient` generic
        // is `chain extends Chain | undefined`, which forces an explicit
        // `chain` param when the function-level chain inference can't
        // narrow — passing null is the canonical "use client's chain"
        // signal (research § Code Example 3 line 666).
        estimateFeesPerGas(client, { type: "eip1559", chain: null }),
        estimateGas(client, {
          account: senderAddress,
          to: record.tx.to,
          value: record.tx.valueWei,
          data: record.tx.data,
        }),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          { type: "text", text: `error: RPC pin failed: ${message}` },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "RPC pin (nonce/fees/gas) failed",
          message,
        ),
      };
    }

    // Selector = first 4 bytes of data (8 hex chars + "0x" prefix).
    // Native sends have `data === "0x"` → `selector === null`, and the
    // 4byte block shows "not-applicable" verbatim.
    const selector: Hex | null =
      record.tx.data === "0x" ? null : (record.tx.data.slice(0, 10) as Hex);

    // Idempotent re-preview per locked decision Q4 (research § Open Questions).
    // Rationale: gas/nonce/fees go stale over time. If the user pauses 10 min
    // after reading the LEDGER BLIND-SIGN HASH, the agent can call preview_send
    // again to freshen the pin without forcing a re-prepare (which would
    // change the payloadFingerprint and break the trust binding).
    // Caveat: a fresh previewToken INVALIDATES the prior one. The handle's
    // pinned state is the SOT — only the most-recently-minted token matches
    // at send time (Plan 04-04's PREVIEW_TOKEN_MISMATCH gate).
    const previewToken = crypto.randomUUID();

    const { presignHash } = computePresignHash({
      chainId: record.tx.chainId,
      nonce: pendingNonce,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      maxFeePerGas: fees.maxFeePerGas,
      gas: gasEstimate,
      to: record.tx.to,
      value: record.tx.valueWei,
      data: record.tx.data,
    });

    // Pin onto handle. `transitionToPreviewed` overwrites `record.pinned`
    // on re-preview (Plan 04-01 invariant — last-write wins). `WRONG_STATUS`
    // here is theoretically reachable as a race (handle TTL'd or was
    // transitioned to sent between our lookup and our transition); surface
    // as the underlying errorCode.
    const trans = transitionToPreviewed(handleArg, {
      nonce: pendingNonce,
      gas: gasEstimate,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      previewToken,
      presignHash,
      selector,
    });
    if (!trans.ok) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: handle state changed during preview (${trans.errorCode})`,
          },
        ],
        structuredContent: errEnvelope(
          trans.errorCode,
          `handle transition failed: ${trans.errorCode}`,
        ),
      };
    }

    // PREP-06: best-effort 4byte cross-check. NEVER throws (Plan 04-05's
    // contract — errors return as `{ kind: "error", message: <verbatim> }`).
    // Verbatim upstream error message ships through to the cross-check
    // block; the user sees the failure mode, not a fake "no match".
    const fourbyte = await lookupSelector(selector);

    // PREP-04 + A1 mitigation: LEDGER block carries BOTH the unbroken
    // 0x-prefixed hex AND the 16-group chunked form. The device may
    // chunk/truncate the display; the user can match either way.
    const ledgerBlock = LEDGER_BLIND_SIGN_HASH_TEMPLATE
      .replace("{HASH_FULL}", presignHash)
      .replace("{HASH_CHUNKED}", chunkHex(presignHash));

    // PREP-05: agent-task block carries VERBATIM agent strings (from
    // `record.args` — not re-typed from `record.tx`). The prepare-time
    // PrepareArgs field types are `string` (not Address/bigint) so the
    // type system itself blocks normalization at the storage boundary.
    const agentBlock = AGENT_TASK_TEMPLATE
      .replace("{TO}", record.args.to)
      .replace("{VALUE_WEI}", record.args.valueWei)
      .replace("{PRESIGN_HASH}", presignHash);

    // PREP-06: 4byte block — verbatim upstream surface, no masking
    // (T-4BYTE-MASK-1). Helper lives in src/signing/blocks.ts (Plan 04-05)
    // so a single SOT covers both this tool AND get_tx_verification's
    // re-emit.
    const fourbyteBlock = build4byteBlock(selector, fourbyte);

    const text = [
      ledgerBlock,
      "",
      agentBlock,
      "",
      fourbyteBlock,
      "",
      VERIFY_BEFORE_SIGNING_TEMPLATE,
    ].join("\n");

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        previewToken,
        presignHash,
        chainId: record.tx.chainId,
        nonce: pendingNonce,
        // bigint → string for JSON safety. Same convention as
        // get_tx_verification's structured re-emit.
        gas: gasEstimate.toString(),
        maxFeePerGas: fees.maxFeePerGas.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
        selector,
        fourbyte,
      },
    };
  } catch (err) {
    // Defensive catch-all — the explicit refusal paths above should cover
    // all expected failures. INTERNAL_ERROR is the unstructured fallback
    // (matches Plan 04-02 precedent).
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: `error: preview_send failed: ${message}` },
      ],
      structuredContent: errEnvelope(
        "INTERNAL_ERROR",
        "preview_send failed",
        message,
      ),
    };
  }
});
