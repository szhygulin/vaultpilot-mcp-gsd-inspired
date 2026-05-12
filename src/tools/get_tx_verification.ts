// MCP tool: get_tx_verification({ handle })
//
// PREP-10: 15-min TTL re-emit of the verification artifacts the agent's
// `prepare_native_send` / `preview_send` originally produced. The agent
// calls this when its conversation context has been evicted and the
// original response is no longer in scope; the user can still anchor
// against the same PREPARE RECEIPT / LEDGER BLIND-SIGN HASH / AGENT
// TASK / 4byte block / VERIFY BEFORE SIGNING summary without re-running
// prepare (which would mint a fresh `nonce` + `payloadFingerprint`).
//
// Two non-negotiables:
//
//   1. Re-emit equality is STRUCTURAL — this handler substitutes the
//      same `src/signing/blocks.ts` templates `prepare_native_send`
//      and `preview_send` use (format-fanout-sentinel rule). The
//      `test/get-tx-verification.test.ts` Test "previewed re-emit
//      equality" imports the SAME constants and asserts byte-
//      identical inclusion (T-REEMIT-1 mitigation).
//
//   2. Demo-mode check fires FIRST. In demo mode no real handles exist
//      anyway (Plans 04-02 / 04-03 / 04-04 refuse to create / preview /
//      send), but this is defensive layering — `isDemoMode()` is the
//      canonical bypass and the mocked `lookupSelector` spy must
//      observe zero calls in the demo path (T-DEMO-1).
//
// Per-status re-emit (research § Q11):
//   - prepared:  PREPARE RECEIPT only + "(preview has not run yet…)" note
//   - previewed: PREPARE RECEIPT + LEDGER BLIND-SIGN HASH + AGENT TASK +
//                4BYTE CROSS-CHECK + VERIFY BEFORE SIGNING
//   - sent:      all previewed blocks + BROADCAST CONFIRMATION
//                (txHash + broadcastedAt ISO)
//   - cancelled: all blocks the handle reached (PREPARE + LEDGER + AGENT +
//                4BYTE if previewed; else just PREPARE) + CANCELLED
//                (cancelledAt ISO)
//
// 15-min TTL is enforced inside `lookup` (Plan 04-01's lazy eviction);
// past TTL → `HANDLE_EXPIRED` envelope, user re-runs `prepare_native_send`.

import { isDemoMode } from "../config/env.js";
import { lookupSelector } from "../clients/fourbyte.js";
import { lookup } from "../signing/handle-store.js";
import {
  AGENT_TASK_TEMPLATE,
  LEDGER_BLIND_SIGN_HASH_TEMPLATE,
  PREPARE_RECEIPT_TEMPLATE,
  VERIFY_BEFORE_SIGNING_TEMPLATE,
  build4byteBlock,
  chunkHex,
} from "../signing/blocks.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Re-emit the verification artifacts (PREPARE RECEIPT, LEDGER BLIND-SIGN HASH, AGENT TASK, 4byte cross-check, broadcast confirmation if sent) for a previously-prepared handle, within 15 minutes of the original prepare.",
  "Use ONLY when the agent has been context-evicted and the original prepare_native_send / preview_send response is no longer in context, AND the user is mid-flow.",
  "Do NOT use as a fresh source of truth — if the original response is still in context, read it from there. Do NOT use to re-validate a sent tx — call get_transaction_status for that. Do NOT use as a retry mechanism — handles are one-time-use; re-running prepare_native_send is the right path for a fresh sign.",
  "Single arg `handle` — the UUID returned by prepare_native_send.",
  "15-min TTL from the ORIGINAL prepare time (NOT from this call). Past 15min → HANDLE_EXPIRED — the user re-runs prepare_native_send. Process restarts wipe handles by design (no-persistence security model).",
  "Returns re-emitted text blocks + structuredContent mirroring whatever the handle's most-advanced state was (prepared / previewed / sent / cancelled).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    handle: {
      type: "string",
      description: "Handle UUID returned by prepare_native_send.",
    },
  },
  required: ["handle"],
  additionalProperties: false,
};

registerTool("get_tx_verification", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // T-DEMO-1: demo-mode check FIRST. No real handles exist in demo mode
  // (Plans 04-02 / 04-03 / 04-04 refuse); defensive layering.
  if (isDemoMode()) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: demo mode is active; use `set_demo_wallet` to select a curated persona instead of querying a real handle",
        },
      ],
      structuredContent: { errorCode: "DEMO_MODE_REFUSED" },
    };
  }

  const handleArg = typeof args.handle === "string" ? args.handle : "";
  const lookupResult = lookup(handleArg);
  if (!lookupResult.ok) {
    const message =
      lookupResult.errorCode === "HANDLE_NOT_FOUND"
        ? "error: handle not found; the handle may have been issued by a different process or never existed"
        : "error: handle expired (>15min from prepare); call prepare_native_send to mint a fresh handle";
    return {
      isError: true,
      content: [{ type: "text", text: message }],
      structuredContent: { errorCode: lookupResult.errorCode },
    };
  }

  const record = lookupResult.record;

  // PREPARE RECEIPT is always present (every handle was created via
  // prepare_native_send → has args.to + args.valueWei).
  const prepareReceiptBlock = PREPARE_RECEIPT_TEMPLATE
    .replace("{TO}", record.args.to)
    .replace("{VALUE_WEI}", record.args.valueWei);

  if (record.status === "prepared") {
    const text = [
      prepareReceiptBlock,
      "",
      "(preview has not run yet; call preview_send to get the LEDGER BLIND-SIGN HASH)",
    ].join("\n");
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        status: "prepared",
        handle: handleArg,
        chainId: record.tx.chainId,
        to: record.args.to,
        valueWei: record.args.valueWei,
        payloadFingerprint: record.payloadFingerprint,
      },
    };
  }

  // For status > prepared, `record.pinned` is set (Plan 04-01 invariant).
  // Defensive type-narrow — should be impossible absent state corruption.
  if (!record.pinned) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `error: handle in status ${record.status} but pinned is missing (state corruption)`,
        },
      ],
      structuredContent: { errorCode: "INTERNAL_ERROR" },
    };
  }

  const pinned = record.pinned;
  const presignHash = pinned.presignHash;

  const ledgerBlock = LEDGER_BLIND_SIGN_HASH_TEMPLATE
    .replace("{HASH_FULL}", presignHash)
    .replace("{HASH_CHUNKED}", chunkHex(presignHash));

  const agentBlock = AGENT_TASK_TEMPLATE
    .replace("{TO}", record.args.to)
    .replace("{VALUE_WEI}", record.args.valueWei)
    .replace("{PRESIGN_HASH}", presignHash);

  // 4byte lookup uses the cached result if available — same selector
  // returns the same FourbyteResult for the rest of the process.
  const fourbyteResult = await lookupSelector(pinned.selector);
  const fourbyteBlock = build4byteBlock(pinned.selector, fourbyteResult);

  const sections: string[] = [
    prepareReceiptBlock,
    "",
    ledgerBlock,
    "",
    agentBlock,
    "",
    fourbyteBlock,
    "",
    VERIFY_BEFORE_SIGNING_TEMPLATE,
  ];

  let broadcastedAtIso: string | undefined;
  let cancelledAtIso: string | undefined;

  if (record.status === "sent") {
    // `sentAt` is set at transitionToSent — guaranteed present when status === "sent".
    const sentAt = record.sentAt ?? Date.now();
    const txHash = record.txHash ?? "0x";
    broadcastedAtIso = new Date(sentAt).toISOString();
    sections.push(
      "",
      "BROADCAST CONFIRMATION",
      `  txHash:        ${txHash}`,
      `  broadcastedAt: ${broadcastedAtIso}`,
    );
  } else if (record.status === "cancelled") {
    const cancelledAt = record.cancelledAt ?? Date.now();
    cancelledAtIso = new Date(cancelledAt).toISOString();
    sections.push(
      "",
      "CANCELLED",
      `  cancelledAt: ${cancelledAtIso}`,
    );
  }

  const text = sections.join("\n");

  return {
    content: [{ type: "text", text }],
    structuredContent: {
      status: record.status,
      handle: handleArg,
      chainId: record.tx.chainId,
      to: record.args.to,
      valueWei: record.args.valueWei,
      payloadFingerprint: record.payloadFingerprint,
      previewToken: pinned.previewToken,
      presignHash: pinned.presignHash,
      selector: pinned.selector,
      nonce: pinned.nonce,
      gas: pinned.gas.toString(),
      maxFeePerGas: pinned.maxFeePerGas.toString(),
      maxPriorityFeePerGas: pinned.maxPriorityFeePerGas.toString(),
      fourbyte: fourbyteResult,
      ...(record.status === "sent" && record.txHash !== undefined
        ? { txHash: record.txHash, broadcastedAt: broadcastedAtIso }
        : {}),
      ...(record.status === "cancelled" ? { cancelledAt: cancelledAtIso } : {}),
    },
  };
});
