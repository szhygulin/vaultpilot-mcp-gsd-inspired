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

import { type ChainId } from "../config/contracts.js";
import { isDemoMode } from "../config/env.js";
import { lookupSelector } from "../clients/fourbyte.js";
import { _canonicalDispatch } from "../security/canonical-dispatch.js";
import { _canonicalDispatchTron } from "../security/canonical-dispatch-tron.js";
import {
  lookup,
  type HandleRecord,
  type PreparedTxSolana,
  type PreparedTxTron,
} from "../signing/handle-store.js";
import {
  AGENT_TASK_TEMPLATE,
  LEDGER_BLIND_SIGN_HASH_TEMPLATE,
  PREPARE_RECEIPT_TEMPLATE,
  VERIFY_BEFORE_SIGNING_TEMPLATE,
  build4byteBlock,
  chunkHex,
} from "../signing/blocks.js";
import {
  LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE,
  PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE,
  PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE,
  VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE,
} from "../signing/blocks-solana.js";
import {
  LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE,
  PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE,
  PREPARE_RECEIPT_TRON_TRC20_TEMPLATE,
  VERIFY_BEFORE_SIGNING_TRON_TEMPLATE,
} from "../signing/blocks-tron.js";
import { getStatus } from "../wallet/session-manager.js";
import { registerTool, type ToolHandlerResult } from "./index.js";

const DESCRIPTION = [
  "Re-emit the verification artifacts (PREPARE RECEIPT, LEDGER BLIND-SIGN HASH, AGENT TASK, 4byte cross-check, broadcast confirmation if sent) for a previously-prepared handle, within 15 minutes of the original prepare.",
  "Use ONLY when the agent has been context-evicted and the original prepare_native_send / preview_send response is no longer in context, AND the user is mid-flow.",
  "Do NOT use as a fresh source of truth — if the original response is still in context, read it from there. Do NOT use to re-validate a sent tx — call get_transaction_status for that. Do NOT use as a retry mechanism — handles are one-time-use; re-running prepare_native_send is the right path for a fresh sign.",
  "Single arg `handle` — the UUID returned by prepare_native_send.",
  "15-min TTL from the ORIGINAL prepare time (NOT from this call). Past 15min → HANDLE_EXPIRED — the user re-runs prepare_native_send. Process restarts wipe handles by design (no-persistence security model).",
  "Returns re-emitted text blocks + structuredContent mirroring whatever the handle's most-advanced state was (prepared / previewed / sent / cancelled).",
  "v1.3 additions (Plan 09-05): structuredContent now carries `txJson` (full unsigned tx JSON with bigints as decimal strings — chainId/to/valueWei/data/nonce/gas/maxFeePerGas/maxPriorityFeePerGas), `sessionTopicLast8` (WC session topic for cross-check against Ledger Live → Settings → Connected Apps; null in demo mode or when unpaired), and `dispatchCheckResult` (re-runs Plan 09-04 Layer 0.5 canonical-dispatch allowlist check on the stored handle so a re-emit shows the same verdict preview_send returned). Native sends report `dispatchCheckResult: { kind: \"not-applicable\" }`.",
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

  // Phase 12 — Plan 12-05 — Solana branch dispatch. EVM body (below) byte-
  // untouched. Solana handles route to the extracted branch at the bottom
  // of this file which re-emits the Solana-shape blocks (PREPARE RECEIPT
  // Solana + LEDGER BLIND-SIGN HASH (Solana) + txJson with messageBytesHex).
  const txType = record.tx.txType ?? "evm";
  if (txType === "solana") {
    return getTxVerificationSolanaBranch(record, handleArg);
  }
  if (txType === "tron") {
    return getTxVerificationTronBranch(record as HandleRecord & { tx: PreparedTxTron }, handleArg);
  }
  // ===== EVM branch (UNCHANGED — Plan 09-05 v1.3 txJson re-emit) =====

  // PREPARE RECEIPT is always present (every handle was created via
  // prepare_native_send → has args.to + args.valueWei).
  const prepareReceiptBlock = PREPARE_RECEIPT_TEMPLATE
    .replace("{TO}", record.args.to)
    .replace("{VALUE_WEI}", record.args.valueWei);

  // v1.3 additions (Plan 09-05 — SEC-36 + SEC-38). Computed ONCE here and
  // surfaced on every successful re-emit path (prepared / previewed / sent
  // / cancelled). Demo-mode is impossible at this point (the demo-mode
  // refusal fires first at the top of the handler).
  //   - sessionTopicLast8: WC session topic for user cross-check against
  //     Ledger Live → Settings → Connected Apps. `null` when no live WC
  //     session exists (handle outlived the pairing; informational).
  //   - dispatchCheckResult: re-runs Plan 09-04 Layer 0.5 canonical-dispatch
  //     allowlist check on the stored handle. Native sends (data === "0x")
  //     short-circuit with `{ kind: "not-applicable" }` — consistent with
  //     preview_send's Layer 0.5 bypass for native sends.
  const ledgerStatus = await getStatus();
  const sessionTopicLast8 = ledgerStatus?.sessionTopicLast8 ?? null;
  const dispatchCheckResult =
    record.tx.data === "0x"
      ? ({ kind: "not-applicable" as const })
      : _canonicalDispatch.checkDispatchTarget(
          record.tx.chainId as ChainId,
          record.tx.to,
        );

  if (record.status === "prepared") {
    const text = [
      prepareReceiptBlock,
      "",
      "(preview has not run yet; call preview_send to get the LEDGER BLIND-SIGN HASH)",
    ].join("\n");
    // `txJson` on `prepared` carries the partially-pinned tx (no nonce /
    // gas / fees yet — those land at preview time). Bigints serialize via
    // `.toString()` decimal-string discipline (consistent with the
    // already-existing `gas: pinned.gas.toString()` pattern below).
    const txJsonPrepared = {
      chainId: record.tx.chainId,
      to: record.tx.to,
      valueWei: record.tx.valueWei.toString(),
      data: record.tx.data,
      nonce: record.tx.nonce ?? null,
      gas: record.tx.gas?.toString() ?? null,
      maxFeePerGas: record.tx.maxFeePerGas?.toString() ?? null,
      maxPriorityFeePerGas: record.tx.maxPriorityFeePerGas?.toString() ?? null,
    };
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        status: "prepared",
        handle: handleArg,
        chainId: record.tx.chainId,
        to: record.args.to,
        valueWei: record.args.valueWei,
        payloadFingerprint: record.payloadFingerprint,
        // Plan 09-05 v1.3 additions
        txJson: txJsonPrepared,
        sessionTopicLast8,
        dispatchCheckResult,
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

  // Plan 09-05 v1.3 — full unsigned tx as JSON, byte-equivalent to what
  // preview_send would compute. Bigints serialize via `.toString()` decimal
  // — consistent with the existing `gas: pinned.gas.toString()` discipline
  // above. JSON-safe; round-trips through `JSON.parse(JSON.stringify(...))`.
  const txJson = {
    chainId: record.tx.chainId,
    to: record.tx.to,
    valueWei: record.tx.valueWei.toString(),
    data: record.tx.data,
    nonce: pinned.nonce,
    gas: pinned.gas.toString(),
    maxFeePerGas: pinned.maxFeePerGas.toString(),
    maxPriorityFeePerGas: pinned.maxPriorityFeePerGas.toString(),
  };

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
      // Plan 09-05 v1.3 additions
      txJson,
      sessionTopicLast8,
      dispatchCheckResult,
      ...(record.status === "sent" && record.txHash !== undefined
        ? { txHash: record.txHash, broadcastedAt: broadcastedAtIso }
        : {}),
      ...(record.status === "cancelled" ? { cancelledAt: cancelledAtIso } : {}),
    },
  };
});

// ===========================================================================
// Phase 12 — Plan 12-05 — Solana re-emit branch (additive). EVM body above
// stays byte-untouched. Solana handles re-emit the Solana-shape PREPARE
// RECEIPT (dispatcher on `instructionSummary[0].kind`) + LEDGER BLIND-SIGN
// HASH (Solana) + status-aware footer + `txJson` carrying messageBytesHex +
// feePayer + recentBlockhash + programIds + instructionSummary (decimal
// strings per Phase 8/9 convention).
//
// Demo-mode refusal fired earlier at the top of the handler (NEVER reaches
// this branch in demo). The Solana branch ALSO has no `dispatchCheckResult`
// concept — Solana's Layer 0.5 is the program-IDs allowlist at preview-time;
// re-emit surfaces it as informational text in the receipt rather than as a
// structured `dispatchCheckResult` field (mirror of EVM 's `not-applicable`
// for native sends).
// ===========================================================================

/**
 * Build the PREPARE RECEIPT block for a Solana handle. Dispatcher on
 * `instructionSummary[0].kind` (mirrors the preview_send Solana branch
 * shape — Plan 12-04). Reads verbatim agent strings from `record.args`
 * per PREP-02 (NEVER the base58-normalized form).
 */
function buildSolanaPrepareReceiptBlock(record: HandleRecord): string {
  const args = record.args;
  const solTx = record.tx as PreparedTxSolana;
  const instructionSummary = solTx.instructionSummary;
  const first = instructionSummary && instructionSummary[0];
  if (first && first.kind === "spl-transfer-checked") {
    return PREPARE_RECEIPT_SOLANA_SPL_TEMPLATE
      .replace("{TO}", args.to)
      .replace("{MINT}", args.mint ?? first.mint)
      .replace("{AMOUNT}", args.amount ?? "")
      .replace("{RECENT_BLOCKHASH}", args.recentBlockhash ?? "")
      .replace("{ATA_NOTICE}", "");
  }
  // Default — native SOL transfer.
  return PREPARE_RECEIPT_SOLANA_NATIVE_TEMPLATE
    .replace("{TO}", args.to)
    .replace("{LAMPORTS}", args.lamports ?? "")
    .replace("{RECENT_BLOCKHASH}", args.recentBlockhash ?? "");
}

/**
 * Chunk a SHA-256 64-hex digest into 16 groups of 4 hex chars (mirror of
 * preview_send Solana branch's `chunkSolanaHash`). Stays inline here to
 * preserve `blocks-solana.ts` byte-frozen status.
 */
function chunkSolanaHash(hashFull64Hex: string): string {
  const raw = hashFull64Hex.startsWith("0x") ? hashFull64Hex.slice(2) : hashFull64Hex;
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += 4) {
    groups.push(raw.slice(i, i + 4));
  }
  return groups.join(" ");
}

/**
 * Serialize the Solana `instructionSummary` for `txJson`. Bigints (lamports
 * + amount) emit as decimal strings per Phase 8/9 convention; primitives
 * stay primitive.
 */
function serializeSolanaInstructionSummary(
  instructionSummary: PreparedTxSolana["instructionSummary"],
): Array<Record<string, unknown>> {
  if (!instructionSummary || instructionSummary.length === 0) return [];
  return instructionSummary.map((s) => {
    if (s.kind === "native-transfer") {
      return {
        kind: "native-transfer",
        from: s.from,
        to: s.to,
        lamports: s.lamports.toString(),
      };
    }
    return {
      kind: "spl-transfer-checked",
      mint: s.mint,
      sourceAta: s.sourceAta,
      destAta: s.destAta,
      destOwner: s.destOwner,
      amount: s.amount.toString(),
      decimals: s.decimals,
    };
  });
}

/**
 * Re-emit the verification artifacts for a Solana-typed handle. Status-aware
 * — `prepared` emits PREPARE RECEIPT only; `previewed` adds the LEDGER
 * BLIND-SIGN HASH (Solana) block; `sent` appends BROADCAST CONFIRMATION;
 * `cancelled` appends CANCELLED. Surfaces both `txHash` AND `txSignature`
 * (Solana-canonical name) in structuredContent on `sent` handles.
 */
function getTxVerificationSolanaBranch(
  record: HandleRecord,
  handleArg: string,
): ToolHandlerResult {
  const solTx = record.tx as PreparedTxSolana;
  const prepareReceiptBlock = buildSolanaPrepareReceiptBlock(record);
  const messageBytesHex = "0x" + Buffer.from(solTx.messageBytes).toString("hex");

  // Build txJson — decimal-string discipline for any bigints (lamports +
  // amount on instructionSummary). All Solana-specific fields surface
  // verbatim.
  const txJson = {
    txType: "solana" as const,
    feePayer: solTx.feePayer,
    recentBlockhash: solTx.recentBlockhash,
    programIds: solTx.programIds,
    messageBytesHex,
    instructionSummary: serializeSolanaInstructionSummary(solTx.instructionSummary),
  };

  if (record.status === "prepared") {
    const text = [
      prepareReceiptBlock,
      "",
      "(preview has not run yet; call preview_send to get the LEDGER BLIND-SIGN HASH (Solana))",
    ].join("\n");
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: {
        status: "prepared" as const,
        handle: handleArg,
        txType: "solana" as const,
        feePayer: solTx.feePayer,
        recentBlockhash: solTx.recentBlockhash,
        payloadFingerprint: record.payloadFingerprint,
        txJson,
      },
    };
  }

  if (!record.pinned) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `error: handle in status ${record.status} but pinned is missing (state corruption)`,
        },
      ],
      structuredContent: { errorCode: "INTERNAL_ERROR" as const },
    };
  }

  const pinned = record.pinned;
  const presignHash = pinned.presignHash;
  const ledgerBlock = LEDGER_BLIND_SIGN_HASH_SOLANA_TEMPLATE
    .replace("{HASH_FULL_64HEX}", presignHash)
    .replace("{HASH_CHUNKED_4_CHAR_GROUPS}", chunkSolanaHash(presignHash));

  const sections: string[] = [
    prepareReceiptBlock,
    "",
    ledgerBlock,
    "",
    VERIFY_BEFORE_SIGNING_SOLANA_TEMPLATE,
  ];

  let broadcastedAtIso: string | undefined;
  let cancelledAtIso: string | undefined;

  if (record.status === "sent") {
    const sentAt = record.sentAt ?? Date.now();
    const txSignature = record.txHash ?? "";
    broadcastedAtIso = new Date(sentAt).toISOString();
    sections.push(
      "",
      "BROADCAST CONFIRMATION",
      `  txSignature:   ${txSignature}`,
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
    content: [{ type: "text" as const, text }],
    structuredContent: {
      status: record.status,
      handle: handleArg,
      txType: "solana" as const,
      feePayer: solTx.feePayer,
      recentBlockhash: solTx.recentBlockhash,
      payloadFingerprint: record.payloadFingerprint,
      previewToken: pinned.previewToken,
      presignHash: pinned.presignHash,
      txJson,
      ...(record.status === "sent" && record.txHash !== undefined
        ? {
            // API symmetry — `txHash` for existing agent prompts + tests.
            txHash: record.txHash,
            // Canonical Solana naming — SAME base58 value under both keys.
            txSignature: record.txHash,
            broadcastedAt: broadcastedAtIso,
          }
        : {}),
      ...(record.status === "cancelled" ? { cancelledAt: cancelledAtIso } : {}),
    },
  };
}

// ===========================================================================
// Phase 18 — Plan 18-04 — TRON re-emit branch (additive). EVM + Solana bodies
// above stay byte-untouched. TRON handles re-emit the TRON-shape PREPARE
// RECEIPT (dispatcher on `kind`) + LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE + status-
// aware footer + `blockHeader` + `rawDataHex` + `dispatchCheckResult`.
// ===========================================================================

/**
 * Chunk a SHA-256 64-hex digest into 4-char groups (mirror of preview_send
 * TRON branch's `chunkTronHash`). Stays inline here to preserve
 * `blocks-tron.ts` byte-frozen status.
 */
function chunkTronHashVerify(hashFull64Hex: string): string {
  const raw = hashFull64Hex.startsWith("0x") ? hashFull64Hex.slice(2) : hashFull64Hex;
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += 4) {
    groups.push(raw.slice(i, i + 4));
  }
  return groups.join(" ");
}

/**
 * Re-emit the verification artifacts for a TRON-typed handle. Status-aware —
 * `prepared` emits PREPARE RECEIPT only; `previewed` adds the LEDGER
 * BLIND-SIGN HASH (TRON) block; `sent` appends BROADCAST CONFIRMATION;
 * `cancelled` appends CANCELLED. Surfaces `blockHeader`, `rawDataHex`,
 * and `dispatchCheckResult` in structuredContent.
 */
function getTxVerificationTronBranch(
  record: HandleRecord & { tx: PreparedTxTron },
  handleArg: string,
): ToolHandlerResult {
  const tronTx = record.tx;

  // Build prepare receipt based on kind
  const prepareReceiptBlock = tronTx.kind === "native"
    ? PREPARE_RECEIPT_TRON_NATIVE_TEMPLATE
        .replace("{TO}", record.args.to)
        .replace("{SUN}", record.args.sun ?? "")
        .replace("{REF_BLOCK_BYTES}", tronTx.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", tronTx.refBlockHash)
        .replace("{EXPIRATION}", String(tronTx.expiration))
    : PREPARE_RECEIPT_TRON_TRC20_TEMPLATE
        .replace("{TO}", record.args.to)
        .replace("{TOKEN_ADDRESS}", record.args.tokenAddress ?? "")
        .replace("{AMOUNT}", record.args.amount ?? "")
        .replace("{REF_BLOCK_BYTES}", tronTx.refBlockBytes)
        .replace("{REF_BLOCK_HASH}", tronTx.refBlockHash)
        .replace("{EXPIRATION}", String(tronTx.expiration));

  // dispatchCheckResult per kind (native = not-applicable; TRC-20 = re-run allowlist)
  const dispatchCheckResult = tronTx.kind === "trc20"
    ? _canonicalDispatchTron.checkTronDispatchTarget([tronTx.contractAddress!])
    : ({ kind: "not-applicable" as const });

  if (record.status === "prepared") {
    const text = [
      prepareReceiptBlock,
      "",
      "(preview has not run yet; call preview_send to get the TRON blind-sign hash block)",
    ].join("\n");
    return {
      content: [{ type: "text" as const, text }],
      structuredContent: {
        status: "prepared" as const,
        handle: handleArg,
        txType: "tron" as const,
        kind: tronTx.kind,
        payloadFingerprint: record.payloadFingerprint,
        blockHeader: {
          refBlockBytes: tronTx.refBlockBytes,
          refBlockHash: tronTx.refBlockHash,
          expiration: tronTx.expiration,
        },
        rawDataHex: tronTx.rawDataHex,
        dispatchCheckResult,
        txJson: null, // TRON uses rawDataHex, not EVM txJson
      },
    };
  }

  if (!record.pinned) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `error: handle in status ${record.status} but pinned is missing (state corruption)`,
        },
      ],
      structuredContent: { errorCode: "INTERNAL_ERROR" as const },
    };
  }

  const pinned = record.pinned;
  const presignHash = pinned.presignHash;
  const ledgerBlock = LEDGER_BLIND_SIGN_HASH_TRON_TEMPLATE
    .replace("{HASH_FULL_64HEX}", presignHash)
    .replace("{HASH_CHUNKED_4_CHAR_GROUPS}", chunkTronHashVerify(presignHash));

  const sections: string[] = [
    prepareReceiptBlock,
    "",
    ledgerBlock,
    "",
    VERIFY_BEFORE_SIGNING_TRON_TEMPLATE,
  ];

  let broadcastedAtIso: string | undefined;
  let cancelledAtIso: string | undefined;

  if (record.status === "sent") {
    const sentAt = record.sentAt ?? Date.now();
    const txHash = record.txHash ?? "";
    broadcastedAtIso = new Date(sentAt).toISOString();
    sections.push(
      "",
      "BROADCAST CONFIRMATION",
      `  txID:          ${txHash}`,
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
    content: [{ type: "text" as const, text }],
    structuredContent: {
      status: record.status,
      handle: handleArg,
      txType: "tron" as const,
      kind: tronTx.kind,
      payloadFingerprint: record.payloadFingerprint,
      previewToken: pinned.previewToken,
      presignHash: pinned.presignHash,
      blockHeader: {
        refBlockBytes: tronTx.refBlockBytes,
        refBlockHash: tronTx.refBlockHash,
        expiration: tronTx.expiration,
      },
      rawDataHex: tronTx.rawDataHex,
      dispatchCheckResult,
      txJson: null, // TRON uses rawDataHex, not EVM txJson
      ...(record.status === "sent" && record.txHash !== undefined
        ? { txHash: record.txHash, txID: record.txHash, broadcastedAt: broadcastedAtIso }
        : {}),
      ...(record.status === "cancelled" ? { cancelledAt: cancelledAtIso } : {}),
    },
  };
}
