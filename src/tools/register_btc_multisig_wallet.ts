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
// This plan stores records WITHOUT walletHmac (HMAC-less). Device on-chain
// registration that writes walletHmac lands in Plan 25-03. The `force` flag
// is accepted and reserved for the Plan 25-03 deliberate-HMAC-less path.
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
import {
  deriveMultisigAddress,
  extractXpubFromKeyExpr,
  parseWshSortedMulti,
  saveMultisigWallet,
} from "../wallet/btc-multisig-store.js";
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

// ─── VERIFY-ON-DEVICE template ────────────────────────────────────────────────

/**
 * VERIFY-ON-DEVICE block for BTC multisig wallet registration.
 *
 * Surfaces the first 5 derived P2WSH receive addresses so the user can
 * cross-check them against their co-signers' view before using the wallet
 * for signing (T-25-02 mitigation — Wrong multisig address shown to user).
 *
 * Tests import this const and run the same substitution to assert byte-identity.
 * Do NOT duplicate the string into test files.
 */
export const VERIFY_ON_DEVICE_MULTISIG_TEMPLATE: string = [
  "VERIFY ON DEVICE (BTC — multisig wallet registration)",
  "────────────────────────────────────────────────────",
  "walletName:  {WALLET_NAME}",
  "threshold:   {THRESHOLD}-of-{TOTAL_SIGNERS}",
  "",
  "First 5 derived P2WSH receive addresses — verify against your co-signers:",
  "{ADDRESS_ROWS}",
  "",
  "If these addresses match your co-signers' view, registration is correct.",
  "If any address differs — STOP. Do not use this wallet for signing.",
].join("\n");

// ─── Tool description ─────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Register a known M-of-N multisig wallet by parsing and validating a wsh(sortedmulti(M,...)) BIP-380/381 descriptor string.",
  "Derives the first 5 P2WSH receive addresses for cross-checking with co-signers, then persists the record to the local registry (~/.vaultpilot-mcp/btc-multisig.json).",
  "The descriptor MUST use /** key expression suffixes (account-level xpubs); /* and /0/* forms are refused.",
  "Persists the record WITHOUT a Ledger walletHmac at this stage — signing requires re-registering with the device connected (Plan 25-03).",
  "Do NOT use in demo mode — refuses with DEMO_MODE_REFUSED.",
  "walletName must be ≤ 16 ASCII characters (Ledger APDU limit).",
  "threshold must equal the M value in the descriptor.",
  "The force flag is accepted and reserved; for future deliberate HMAC-less re-registration.",
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
        "Reserved for Plan 25-03 deliberate-HMAC-less re-registration. Accepted but ignored in this plan.",
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

    // Step 8: persist the record WITHOUT walletHmac (device on-chain registration
    // is Plan 25-03 — this plan stores HMAC-less per the locked walletHmac-timing
    // decision in RESEARCH.md Fork 2).
    const registeredAt = new Date().toISOString();
    saveMultisigWallet({
      name: nameArg,
      descriptor: descriptorArg, // verbatim, never elided — per CLAUDE.md
      threshold: parsed.m,
      totalSigners: parsed.keys.length,
      keyFingerprints,
      firstAddresses,
      registeredAt,
      // walletHmac: absent — populated by Plan 25-03 on device registration
    });

    // Build the response text — descriptor surfaced verbatim per CLAUDE.md
    const responseText = [
      verifyBlock,
      "",
      "Registration complete (HMAC-less — signing requires device connection).",
      "",
      "PREPARE RECEIPT (BTC — multisig wallet registration)",
      `  walletName:    ${nameArg}`,
      `  descriptor:    ${descriptorArg}`,
      `  threshold:     ${parsed.m}-of-${parsed.keys.length}`,
      `  registeredAt:  ${registeredAt}`,
      `  walletHmac:    absent (re-register with device connected to enable signing)`,
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
        walletHmac: null,
        verifyBlock,
      },
    };
  },
);
