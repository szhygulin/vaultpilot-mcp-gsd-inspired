// MCP tool: get_ledger_device_info({}) — Plan 05-03 / DIAG-02.
//
// Returns an INFERRED-STATE envelope for the connected Ledger. NOT a real
// probe. Q-DIAG-02 lock (research § A9): WalletConnect v2.x has NO canonical
// method to probe the device for `firmware` / `appOpen` / `deviceConnected`
// state. Surfacing fake probe results would be tamper (T-DEVICE-INFO-CLAIM-1
// — high severity). Instead, those three fields are ALWAYS the literal
// string `"unknown"` (or, for `appOpen`, inferred from the CAIP-2 namespace
// on the active session).
//
// The tool description names this limitation EXPLICITLY so the routing agent
// teaches the user "for authoritative device state, check Ledger Live →
// Settings → Connected Apps." The user's eyes on Ledger Live are the source
// of truth.
//
// Session-topic safety (T-CONFIG-LEAK-1 generalized): the full WC session
// topic is NEVER surfaced — only the last-8 suffix, mirroring `get_ledger_
// status`'s PAIR-02 contract.

import { getStatus } from "../wallet/session-manager.js";
import { registerTool } from "./index.js";

const DESCRIPTION = [
  "Returns an INFERRED-STATE envelope for the connected Ledger — paired status, address, chainId, WC session-topic suffix (last 8 chars), and an actionable hint.",
  "This tool does NOT probe the device for firmware / open app / connection state. WalletConnect v2.x has no method for that. The fields `deviceConnected`, `appOpen`, `firmware` are ALWAYS `\"unknown\"` (or, for `appOpen`, inferred from the CAIP-2 namespace on the active session). For authoritative device state, check Ledger Live → Settings → Connected Apps.",
  "Use this when debugging pairing — 'is the Ledger paired?', 'what address am I paired to?', 'is the session topic still alive?'.",
  "Do NOT use this as a substitute for visual Ledger Live inspection. The user's eyes on Ledger Live are the source of truth for device state.",
  "Secret-safety: session topic returned as last-8-chars only. Full topic is NEVER returned (matches `get_ledger_status` PAIR-02 contract).",
].join(" ");

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

// Q-DIAG-02 lock: these literal strings are the response contract. Tests in
// `test/get-ledger-device-info.test.ts` enumerate the forbidden values for
// `deviceConnected` / `firmware` to prevent a future "helpful" expansion
// that surfaces fake probe results.
const APP_OPEN_INFERRED = "Ethereum (inferred from CAIP-2 namespace)" as const;
const UNKNOWN = "unknown" as const;

registerTool("get_ledger_device_info", DESCRIPTION, INPUT_SCHEMA, async () => {
  const status = await getStatus();

  if (status === null) {
    const envelope = {
      paired: false,
      address: null,
      chainId: null,
      sessionTopicSuffix: null,
      deviceConnected: UNKNOWN,
      appOpen: UNKNOWN,
      firmware: UNKNOWN,
      hint: "Ledger is not paired. Call pair_ledger_live to initiate a WalletConnect pairing.",
    } as const;
    return {
      content: [
        {
          type: "text",
          text: [
            "paired: false (no Ledger session active)",
            `  deviceConnected:    ${envelope.deviceConnected}`,
            `  appOpen:            ${envelope.appOpen}`,
            `  firmware:           ${envelope.firmware}`,
            `  hint:               ${envelope.hint}`,
          ].join("\n"),
        },
      ],
      structuredContent: { ...envelope },
    };
  }

  const envelope = {
    paired: true as const,
    address: status.address,
    chainId: status.chainId,
    sessionTopicSuffix: status.sessionTopicLast8,
    deviceConnected: UNKNOWN,
    appOpen: APP_OPEN_INFERRED,
    firmware: UNKNOWN,
    hint:
      "Session topic is alive. If signing flows fail, check Ledger Live → Settings → Connected Apps to confirm the session is active on the device side.",
  };
  return {
    content: [
      {
        type: "text",
        text: [
          `paired: true, address: ${envelope.address}, chainId: ${envelope.chainId}, sessionTopicSuffix: ${envelope.sessionTopicSuffix}`,
          `  deviceConnected:    ${envelope.deviceConnected}`,
          `  appOpen:            ${envelope.appOpen}`,
          `  firmware:           ${envelope.firmware}`,
          `  hint:               ${envelope.hint}`,
        ].join("\n"),
      },
    ],
    structuredContent: { ...envelope },
  };
});
