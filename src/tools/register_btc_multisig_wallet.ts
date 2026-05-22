// MCP tool: register_btc_multisig_wallet({ name, descriptor, threshold, force? })
// Phase 25 Plan 25-01 — BTC-PSBT-03.
//
// Registers a known M-of-N multisig wallet by parsing and validating a
// wsh(sortedmulti(M, ...)) BIP-380/381 descriptor string. Derives the first 5
// P2WSH receive addresses (BIP-67 key sort) and persists the record to
// `~/.vaultpilot-mcp/btc-multisig.json` (0o600).
//
// Security per threat model T-25-01 / T-25-02 / T-25-03:
//   - Descriptor is parsed by parseWshSortedMulti before ANY persistence
//     (T-25-01 mitigation).
//   - First 5 derived P2WSH addresses surfaced in VERIFY-ON-DEVICE block
//     for user cross-check against co-signers (T-25-02 mitigation).
//   - Atomic write at 0o600 via btc-multisig-store (T-25-03 mitigation).
//
// Plan 25-03 extends this tool: attempts on-device wallet-policy registration
// via @ledgerhq/ledger-bitcoin AppClient.registerWallet when a Ledger is connected
// (BTC app v2.1+ required). On success, walletHmac is stored in the registry.
// If no device is connected or force=true, stores HMAC-less (signing disabled).
//
// Demo mode: refused with DEMO_MODE_REFUSED (same as pair_btc_ledger).
// Name limit: ≤ 16 ASCII bytes (Ledger APDU limit — BTC app wallet policy name).
// Per CLAUDE.md: the parsed descriptor is surfaced verbatim in the response;
// it is NEVER elided.

import { isDemoMode } from "../config/env.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { VERIFY_ON_DEVICE_MULTISIG_TEMPLATE } from "../signing/blocks-btc.js";
import {
  deriveMultisigAddress,
  extractXpubFromKeyExpr,
  parseWshSortedMulti,
  saveMultisigWallet,
} from "../wallet/btc-multisig-store.js";
import {
  LedgerBtcAppVersionTooOldError,
  LedgerDeviceNotConnectedError,
  _btcLedgerTransport,
} from "../wallet/ledger-btc-transport.js";
import { registerTool } from "./index.js";

// ─── Error envelope helper ────────────────────────────────────────────────────

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

// Re-export so tests importing from this module continue to work.
export { VERIFY_ON_DEVICE_MULTISIG_TEMPLATE };

// ─── Tool description ─────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Register a known M-of-N multisig wallet by parsing and validating a wsh(sortedmulti(M,...)) BIP-380/381 descriptor string.",
  "Derives the first 5 P2WSH receive addresses for cross-checking with co-signers, then persists the record to the local registry (~/.vaultpilot-mcp/btc-multisig.json).",
  "The descriptor MUST use /** key expression suffixes (account-level xpubs); /* and /0/* forms are refused.",
  "Attempts on-device wallet-policy registration via @ledgerhq/ledger-bitcoin AppClient.registerWallet when a Ledger is connected (BTC app v2.1+ required).",
  "On success, the 32-byte walletHmac is stored in the registry — required for sign_btc_multisig_psbt.",
  "If no device is connected or force=true, stores the record HMAC-less; signing will require re-running this tool with device connected.",
  "If BTC app < 2.1, returns LEDGER_BTC_APP_VERSION_TOO_OLD.",
  "Do NOT use in demo mode — refuses with DEMO_MODE_REFUSED.",
  "walletName must be ≤ 16 ASCII characters (Ledger APDU limit).",
  "threshold must equal the M value in the descriptor.",
].join(" ");

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    name: {
      type: "string",
      description:
        "User-assigned wallet name, max 16 ASCII characters (Ledger wallet policy name limit).",
      minLength: 1,
      maxLength: 16,
    },
    descriptor: {
      type: "string",
      description:
        "Full wsh(sortedmulti(M, [fp/path]xpub/**,...)) BIP-380/381 descriptor string. ALL key expressions must end with /**.",
      minLength: 1,
    },
    threshold: {
      type: "number",
      description:
        "The M value (signing threshold). Must equal the M in the descriptor. 1 ≤ threshold ≤ total signers.",
      minimum: 1,
    },
    force: {
      type: "boolean",
      description:
        "When true, skip device registration and store HMAC-less even if a Ledger is connected. Use for balance-only registration without signing intent.",
    },
  },
  required: ["name", "descriptor", "threshold"],
  additionalProperties: false,
};

// ─── Tool handler ─────────────────────────────────────────────────────────────

registerTool(
  "register_btc_multisig_wallet",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    // Step 1: demo-mode refusal — FIRST check, before any other work
    if (isDemoMode()) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "error: register_btc_multisig_wallet is not available in demo mode. Set VAULTPILOT_DEMO=false to use a real Ledger device.",
          },
        ],
        structuredContent: errEnvelope(
          "DEMO_MODE_REFUSED",
          "register_btc_multisig_wallet unavailable in demo mode",
        ),
      };
    }

    // Step 2: validate name
    const nameArg = typeof args.name === "string" ? args.name : "";
    if (nameArg.length === 0) {
      return {
        isError: true,
        content: [{ type: "text", text: "error: `name` is REQUIRED and must be non-empty." }],
        structuredContent: errEnvelope("INVALID_INPUT", "`name` is REQUIRED and must be non-empty"),
      };
    }

    // Ledger APDU limit: wallet policy names must be ≤ 16 ASCII bytes.
    // Check byte length (not character count) for ASCII safety.
    const nameBytes = Buffer.byteLength(nameArg, "utf-8");
    if (nameBytes > 16) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: wallet name "${nameArg}" exceeds the 16-byte Ledger APDU limit (got ${nameBytes} bytes). Use a shorter name.`,
          },
        ],
        structuredContent: errEnvelope(
          "INVALID_INPUT",
          `wallet name must be ≤ 16 ASCII bytes; got ${nameBytes} bytes`,
        ),
      };
    }

    // Step 3: validate descriptor arg
    const descriptorArg = typeof args.descriptor === "string" ? args.descriptor : "";
    if (descriptorArg.length === 0) {
      return {
        isError: true,
        content: [{ type: "text", text: "error: `descriptor` is REQUIRED." }],
        structuredContent: errEnvelope("INVALID_INPUT", "`descriptor` is REQUIRED"),
      };
    }

    // Step 3 continued: parse the descriptor
    const parsed = parseWshSortedMulti(descriptorArg);
    if (!parsed) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: [
              `error: invalid descriptor. Expected wsh(sortedmulti(M, [fp/path]xpub/**,...)) form.`,
              `All key expressions must end with /** (not /* or /0/*).`,
              `M must satisfy 1 ≤ M ≤ N (number of keys).`,
              `Received: ${descriptorArg}`,
            ].join(" "),
          },
        ],
        structuredContent: errEnvelope(
          "MULTISIG_DESCRIPTOR_INVALID",
          "descriptor must be wsh(sortedmulti(M, key...)) with /** key expression suffixes and 1 ≤ M ≤ N",
        ),
      };
    }

    // Step 4: verify threshold arg equals parsed M, and M is in valid range
    const thresholdArg =
      typeof args.threshold === "number" ? args.threshold : undefined;
    if (thresholdArg === undefined) {
      return {
        isError: true,
        content: [{ type: "text", text: "error: `threshold` is REQUIRED." }],
        structuredContent: errEnvelope("INVALID_INPUT", "`threshold` is REQUIRED"),
      };
    }

    if (thresholdArg !== parsed.m) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: threshold mismatch. The descriptor specifies M=${parsed.m} but threshold=${thresholdArg} was passed. Set threshold to ${parsed.m}.`,
          },
        ],
        structuredContent: errEnvelope(
          "MULTISIG_DESCRIPTOR_INVALID",
          `threshold arg (${thresholdArg}) must equal the M value in the descriptor (${parsed.m})`,
        ),
      };
    }

    // Step 5: extract xpubs and fingerprints from key expressions
    let xpubs: string[];
    let keyFingerprints: (string | null)[];
    try {
      const extracted = parsed.keys.map((key) => extractXpubFromKeyExpr(key));
      xpubs = extracted.map((e) => e.xpub);
      keyFingerprints = extracted.map((e) => e.masterFingerprint);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: failed to parse key expressions in descriptor: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "MULTISIG_DESCRIPTOR_INVALID",
          `key expression parse error: ${message}`,
        ),
      };
    }

    // Step 6: derive first 5 P2WSH addresses (change=0, index 0..4)
    let firstAddresses: string[];
    try {
      firstAddresses = [];
      for (let i = 0; i < 5; i++) {
        firstAddresses.push(deriveMultisigAddress(xpubs, parsed.m, i));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `error: failed to derive multisig addresses from descriptor: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "MULTISIG_DESCRIPTOR_INVALID",
          `address derivation error: ${message}`,
        ),
      };
    }

    // Step 7: build VERIFY-ON-DEVICE block
    const addressRows = firstAddresses
      .map((addr, idx) => `  [${idx}] ${addr}`)
      .join("\n");
    const verifyBlock = VERIFY_ON_DEVICE_MULTISIG_TEMPLATE
      .replace("{WALLET_NAME}", nameArg)
      .replace("{THRESHOLD}", String(parsed.m))
      .replace("{TOTAL_SIGNERS}", String(parsed.keys.length))
      .replace("{ADDRESS_ROWS}", addressRows);

    // Step 8: attempt on-device wallet-policy registration (Plan 25-03 Fork 2).
    // If force=true, skip device registration and store HMAC-less regardless.
    const forceArg = args.force === true;
    const registeredAt = new Date().toISOString();

    let walletHmacHex: string | null = null;
    let registrationNote = "Device registration status unknown.";

    if (!forceArg) {
      // Build the descriptor template for @ledgerhq/ledger-bitcoin:
      // e.g. "wsh(sortedmulti(2,@0/**,@1/**,@2/**))"
      const descriptorTemplate = `wsh(sortedmulti(${parsed.m},${parsed.keys.map((_, i) => `@${i}/**`).join(",")}))`;

      try {
        const result = await _btcLedgerTransport.registerBtcMultisigWallet(
          nameArg,
          descriptorTemplate,
          parsed.keys,
        );
        walletHmacHex = result.walletHmacHex;
        registrationNote = "On-device registration complete. walletHmac stored — signing enabled.";
      } catch (err) {
        if (err instanceof LedgerBtcAppVersionTooOldError) {
          return {
            isError: true,
            content: [{ type: "text", text: `error: ${err.message}` }],
            structuredContent: errEnvelope(
              "LEDGER_BTC_APP_VERSION_TOO_OLD",
              err.message,
            ),
          };
        }
        if (err instanceof LedgerDeviceNotConnectedError) {
          // Device absent — store HMAC-less (locked fallback from RESEARCH Fork 2)
          registrationNote =
            "No Ledger device connected — stored HMAC-less. Re-run register_btc_multisig_wallet " +
            "with device connected and Bitcoin app open to enable signing.";
        } else {
          // Other device error — store HMAC-less with the error message
          const cause = err instanceof Error ? err.message : String(err);
          registrationNote =
            `Device registration failed (${cause}) — stored HMAC-less. ` +
            "Re-run register_btc_multisig_wallet with device connected to enable signing.";
        }
      }
    } else {
      registrationNote =
        "force=true — HMAC-less registration (balance-only, signing disabled). " +
        "Re-run without force=true and with device connected to enable signing.";
    }

    // Step 9: persist the record (with or without walletHmac)
    saveMultisigWallet({
      name: nameArg,
      descriptor: descriptorArg, // verbatim, never elided — per CLAUDE.md
      threshold: parsed.m,
      totalSigners: parsed.keys.length,
      keyFingerprints,
      firstAddresses,
      registeredAt,
      ...(walletHmacHex !== null ? { walletHmac: walletHmacHex } : {}),
    });

    // Build the response text — descriptor surfaced verbatim per CLAUDE.md
    const responseText = [
      verifyBlock,
      "",
      registrationNote,
      "",
      "PREPARE RECEIPT (BTC — multisig wallet registration)",
      `  walletName:    ${nameArg}`,
      `  descriptor:    ${descriptorArg}`,
      `  threshold:     ${parsed.m}-of-${parsed.keys.length}`,
      `  registeredAt:  ${registeredAt}`,
      `  walletHmac:    ${walletHmacHex !== null ? `${walletHmacHex.slice(0, 8)}… (stored)` : "absent (re-register with device connected to enable signing)"}`,
    ].join("\n");

    return {
      content: [{ type: "text", text: responseText }],
      structuredContent: {
        walletName: nameArg,
        descriptor: descriptorArg, // verbatim — per CLAUDE.md
        threshold: parsed.m,
        totalSigners: parsed.keys.length,
        keyFingerprints,
        firstAddresses,
        registeredAt,
        walletHmac: walletHmacHex,
        registrationNote,
        verifyBlock,
      },
    };
  },
);
