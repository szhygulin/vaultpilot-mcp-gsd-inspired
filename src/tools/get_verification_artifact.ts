// MCP tool: get_verification_artifact({ handle })
//
// SEC-34 (Phase 9 Plan 09-03) — sparse JSON structuredContent + verbatim
// `pasteableBlock` text payload for SECOND-LLM out-of-band verification.
//
// Audience: a FRESH chat session with no shared context — a second LLM acts
// as independent decoder. The MCP provides the bytes; the second LLM tells
// the user what they mean. Defense-in-depth against fully-coordinated agent
// compromise (where the original agent's args AND narrative are both
// tampered with — every existing MCP-side layer can be bypassed because
// the bytes look right + the agent's claims look right).
//
// DISTINCT from `get_tx_verification` (Plan 04-05): that tool re-emits the
// FULL Phase 4 ritual (PREPARE RECEIPT + LEDGER BLIND-SIGN HASH + AGENT
// TASK + 4byte + VERIFY BEFORE SIGNING + sent/cancelled status blocks) for
// USER-facing context-evicted recovery. THIS tool emits ONLY the
// pasteableBlock + sparse JSON for SECOND-LLM consumption. Two complementary
// audiences (NOT overlapping), same handle store.
//
// NO 4byte fetch in this tool. The second LLM is the decoder, not the MCP.
// Coupling the MCP to a decode output would defeat the out-of-band property.
//
// 15-min TTL inheritance via existing `HANDLE_TTL_MS` in `handle-store.ts`
// — Plan 09-03 introduces NO new TTL and NO new error codes. Demo-mode
// refusal mirrors `get_tx_verification.ts:76-88`.
//
// **NOT REGISTERED in `register-all.ts` by this plan** — Plan 09-05 owns
// the import line (carved to avoid Plan 09-03 ∥ 09-05 rebase conflict per
// PATTERNS.md § 3). Until Plan 09-05 lands the import, this tool is
// reachable from test code via `getRegisteredTool("get_verification_artifact")`
// after explicit `import` (the `registerTool` side-effect fires at module
// load), but the production MCP server's dispatch table will not route to
// it.

import { isDemoMode } from "../config/env.js";
import { lookup } from "../signing/handle-store.js";
import {
  PASTEABLE_BLOCK_TEMPLATE,
  PASTEABLE_BLOCK_TEMPLATE_SAFE,
} from "../signing/blocks.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Emit a sparse JSON + paste-able block for SECOND-LLM out-of-band verification of a prepared transaction.",
  "Use AFTER preview_send and BEFORE send_transaction when the user wants an independent decode from a second LLM (catches coordinated-agent compromise where this agent's narrative cannot be trusted).",
  "Returns `{ to, valueWei, data, chainId, payloadFingerprint, presignHash, selector }` as structuredContent + a `pasteableBlock` text payload bounded by explicit `>>>>` / `<<<<` copy markers. Instruct the user: copy everything between the markers into a fresh Claude/GPT/Gemini session, then compare that LLM's decode against this conversation's narrative. Disagreement → DO NOT SIGN.",
  "Do NOT use as the only verification — the LEDGER BLIND-SIGN HASH on-device match is the trust anchor; this is defense-in-depth against a fully-coordinated agent compromise.",
  "Distinct from get_tx_verification (which re-emits the FULL Phase 4 verification ritual for context-evicted agent recovery — user-facing visual surface). This tool emits ONLY the pasteableBlock + sparse JSON for second-LLM consumption.",
  "15-min TTL from the original prepare time (NOT from this call). Past TTL → HANDLE_EXPIRED; re-run prepare.",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    handle: {
      type: "string",
      description: "Handle UUID returned by prepare_native_send / prepare_token_send / prepare_aave_supply / etc.",
    },
  },
  required: ["handle"],
  additionalProperties: false,
};

registerTool("get_verification_artifact", DESCRIPTION, INPUT_SCHEMA, async (args) => {
  // 1. Demo-mode refusal FIRST — mirror of get_tx_verification.ts:76-88.
  //    In demo mode no real handles exist (Plans 04-02 / 04-03 / 04-04 refuse
  //    to create / preview / send); defensive layering anyway.
  if (isDemoMode()) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            "error: demo mode is active; get_verification_artifact refuses — the second-LLM ritual is for real signing flows only",
        },
      ],
      structuredContent: {
        errorCode: "DEMO_MODE_REFUSED",
        message:
          "get_verification_artifact refuses in demo mode — second-LLM out-of-band ritual is for real signing flows only",
      },
    };
  }

  // 2. Handle lookup — mirror of get_tx_verification.ts:90-102.
  const handleArg = typeof args.handle === "string" ? args.handle : "";
  const lookupResult = lookup(handleArg);
  if (!lookupResult.ok) {
    const message =
      lookupResult.errorCode === "HANDLE_NOT_FOUND"
        ? "error: handle not found; the handle may have been issued by a different process or never existed"
        : "error: handle expired (>15min from prepare); call the appropriate prepare_* tool to mint a fresh handle";
    return {
      isError: true,
      content: [{ type: "text", text: message }],
      structuredContent: { errorCode: lookupResult.errorCode, message },
    };
  }

  const { record } = lookupResult;
  const pinned = record.pinned;

  // 3. Compose sparse JSON + pasteableBlock.
  //    `record.tx.to`        — viem Address (checksum-cased) — verbatim
  //    `record.tx.valueWei`  — bigint        — serialize to decimal string
  //    `record.tx.data`      — viem Hex      — verbatim
  //    `record.tx.chainId`   — number        — serialize to string for the slot
  //    `record.payloadFingerprint` — viem Hex — verbatim
  //    `pinned?.presignHash` — viem Hex | undefined — null on `prepared`
  //
  //    `presignHash` text-slot uses the literal "(not yet previewed)" on the
  //    prepared status; the JSON field is `null` (JSON-safe sentinel) on
  //    that branch.
  const presignHashJson = pinned?.presignHash ?? null;
  const presignHashText = pinned?.presignHash ?? "(not yet previewed)";

  // Phase 38 Plan 38-01 (A1 resolution) — txType dispatch. For
  // `PreparedTxSafeTypedData` handles, the EVM-shape sentinel fields
  // (`record.tx.to` / `valueWei` / `data`) are zero / empty by construction
  // (handle-store.ts:996-1001); the REAL Safe-side fields live in
  // `safeAddress` / `safeTxTo` / `safeTxValue` / `safeTxData` / `operation`
  // / `safeTxHash`. Substitute the PASTEABLE_BLOCK_TEMPLATE_SAFE so the
  // second-LLM receives operationally meaningful bytes — the EVM template
  // with sentinel zeros would be useless for Safe handles.
  //
  // The execute-path handle is `PreparedTxEvm` (NOT safe-typed-data) — its
  // `record.tx.{to,valueWei,data}` are REAL (the outer execTransaction
  // calldata). It correctly falls through to the EVM-shape branch below;
  // the second-LLM decodes execTransaction(...) and recursively decodes
  // the encapsulated SafeTx.
  if (record.tx.txType === "safe-typed-data") {
    const safeTx = record.tx;
    const block = PASTEABLE_BLOCK_TEMPLATE_SAFE
      .replace("{CHAIN_ID}", String(safeTx.chain))
      .replace("{SAFE_ADDRESS}", safeTx.safeAddress)
      .replace("{SAFE_TX_TO}", safeTx.safeTxTo)
      .replace("{SAFE_TX_VALUE}", safeTx.safeTxValue.toString())
      .replace("{SAFE_TX_DATA}", safeTx.safeTxData)
      .replace("{OPERATION}", safeTx.operation)
      .replace("{SAFE_TX_HASH}", safeTx.safeTxHash)
      .replace("{PAYLOAD_FINGERPRINT}", record.payloadFingerprint);

    const safeSelector =
      safeTx.safeTxData === "0x"
        ? null
        : (safeTx.safeTxData.slice(0, 10) as `0x${string}`);

    return {
      content: [{ type: "text", text: block }],
      structuredContent: {
        safeAddress: safeTx.safeAddress,
        safeTxTo: safeTx.safeTxTo,
        safeTxValue: safeTx.safeTxValue.toString(),
        safeTxData: safeTx.safeTxData,
        operation: safeTx.operation,
        safeTxHash: safeTx.safeTxHash,
        chainId: safeTx.chain,
        payloadFingerprint: record.payloadFingerprint,
        selector: safeSelector,
      },
    };
  }

  const block = PASTEABLE_BLOCK_TEMPLATE
    .replace("{CHAIN_ID}", String(record.tx.chainId))
    .replace("{TO}", record.tx.to)
    .replace("{VALUE_WEI}", record.tx.valueWei.toString())
    .replace("{DATA}", record.tx.data)
    .replace("{PAYLOAD_FINGERPRINT}", record.payloadFingerprint)
    .replace("{PRESIGN_HASH}", presignHashText);

  const selector =
    record.tx.data === "0x" ? null : (record.tx.data.slice(0, 10) as `0x${string}`);

  return {
    content: [{ type: "text", text: block }],
    structuredContent: {
      to: record.tx.to,
      valueWei: record.tx.valueWei.toString(),
      data: record.tx.data,
      chainId: record.tx.chainId,
      payloadFingerprint: record.payloadFingerprint,
      presignHash: presignHashJson,
      selector,
    },
  };
});
