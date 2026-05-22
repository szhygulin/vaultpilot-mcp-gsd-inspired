// BIP-137 compact message signing via the Ledger LTC app. Phase 26 — Plan 26-02.
//
// **LTC-W-02 — Direct sign tool (NO prepare/preview/send pipeline)**
//
// `sign_message_ltc` is NOT a transaction tool. It does NOT create a handle,
// does NOT go through `preview_send`, and does NOT call `send_transaction`.
// It is a direct read-then-sign tool that calls `app.signMessage` APDU once
// and returns the BIP-137 compact signature immediately.
//
// Purpose: produce a BIP-137 compact signature proving control of an LTC segwit
// address — the canonical wallet-ownership-proof shape used for off-chain
// attestation and service authentication.
//
// Flow:
//   1. Input validation: `wallet` is a valid ltc1q segwit address;
//      `message` is a non-empty string ≤ MESSAGE_MAX_LEN chars.
//   2. Demo-mode check: refuse with `DEMO_MODE_REFUSED` — no device in demo.
//   3. Pairing check: `listAccounts({ chainFilter: "litecoin" })` — find the
//      account matching `wallet`. No match → refuse.
//   4. Compute LTC BIP-137 message hash server-side (for LEDGER BLIND-SIGN HASH
//      block): double-SHA256(varint(25) ‖ "Litecoin Signed Message:\n" ‖
//      varint(len(message)) ‖ message).
//      KEY DISTINCTION from BTC: varint 0x19 (25 bytes) vs BTC 0x18 (24 bytes).
//      Fixture Z anchor: hash("Hello VaultPilot") =
//      "0xa36092f90d13deb6c7c45317bfdefd101325fc919e40d46cf0532f7e99e4b676"
//      (pinned in test/signing-bip137-ltc.test.ts — cross-linked from
//      test/tools-sign-message-ltc.test.ts).
//   5. Call `_ltcLedgerTransport.signLtcMessage(path, messageHex)` where
//      `messageHex = Buffer.from(message, "utf8").toString("hex")`.
//      The Ledger LTC app applies the magic prefix INTERNALLY — passing the
//      pre-prefixed message would double-prefix (RESEARCH Pitfall 3 mirror).
//   6. Assemble BIP-137 compact signature: header = v + 39 (P2WPKH bech32),
//      sig65 = [header][32-byte r][32-byte s], signatureBase64 = base64.
//      (Header-byte convention identical to BTC — both use P2WPKH bech32 base 39.)
//   7. Return `{ address, message, signatureBase64, messageHash }` + LEDGER
//      BLIND-SIGN HASH block containing message text and hash.
//
// **No private key material crosses any boundary.** The device signs via APDU;
// the server only assembles the compact signature from the returned `{ v, r, s }`.
//
// Cross-chain tamper-detection (T-26-05 signing variant):
//   LTC magic = "Litecoin Signed Message:\n" (25 bytes, varint 0x19)
//   BTC magic = "Bitcoin Signed Message:\n"  (24 bytes, varint 0x18)
// An LTC signature cannot be replayed as a BTC signature or vice versa.

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

import "../chains/litecoin/types.js"; // side-effect: ensures LTC_NETWORK is loadable
import { assertLtcSegwitAddress } from "../chains/litecoin/types.js";
import { isDemoMode } from "../config/env.js";
import {
  LEDGER_BLIND_SIGN_HASH_MSG_LTC_TEMPLATE,
} from "../signing/blocks-btc.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import {
  _ltcLedgerTransport,
  LedgerLtcAppNotOpenError,
  LedgerDeviceNotConnectedError,
} from "../wallet/ledger-btc-transport.js";
import { registerTool } from "./index.js";

// ─── Error envelope boundary cast ─────────────────────────────────────────────

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

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum message length in UTF-8 bytes accepted by `sign_message_ltc`.
 * 256 bytes covers all common use cases (KYC nonces, login challenges, etc.)
 * while keeping the device display manageable.
 */
const MESSAGE_MAX_BYTES = 256;

/**
 * LTC BIP-137 magic bytes as hex — exported for Fixture Z anchor in
 * test/signing-bip137-ltc.test.ts.
 *
 * Breakdown:
 *   "19" = varint(25) — length of "Litecoin Signed Message:\n"
 *   "4c697465636f696e205369676e6564204d6573736167653a0a" = UTF-8 magic string
 *
 * PINNED FOREVER per CLAUDE.md convention. Changing this is a wire-shape break.
 */
export const LTC_MAGIC_BYTES_HEX =
  "194c697465636f696e205369676e6564204d6573736167653a0a";

// ─── BIP-137 hash helpers ──────────────────────────────────────────────────────

/**
 * Bitcoin/Litecoin compact integer (varint) encoding.
 * Values < 0xfd: single byte.
 * Values 0xfd–0xffff: 3 bytes (0xfd prefix + LE uint16).
 */
function encodeVarint(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) {
    const buf = new Uint8Array(3);
    buf[0] = 0xfd;
    new DataView(buf.buffer).setUint16(1, n, true); // little-endian
    return buf;
  }
  throw new Error("varint: value too large for BIP-137 message");
}

/**
 * Compute the LTC BIP-137 double-SHA256 message hash.
 *
 * Preimage: varint(25) ‖ "Litecoin Signed Message:\n" ‖ varint(len(message)) ‖ message
 * Hash: SHA-256(SHA-256(preimage))
 *
 * KEY DISTINCTION from BTC: magic is 25 bytes (varint 0x19), not 24 bytes (0x18).
 * This makes LTC message signatures cross-chain distinct from BTC signatures.
 *
 * Fixture Z anchor: computeLtcBip137MessageHash("Hello VaultPilot")
 * === "0xa36092f90d13deb6c7c45317bfdefd101325fc919e40d46cf0532f7e99e4b676"
 * (pinned in test/signing-bip137-ltc.test.ts — cross-linked from
 * test/tools-sign-message-ltc.test.ts).
 *
 * NOTE: this is a double-SHA256 hash, NOT a keccak256 payloadFingerprint.
 */
function computeLtcBip137MessageHash(message: string): string {
  const MAGIC = "Litecoin Signed Message:\n"; // exactly 25 UTF-8 bytes (varint 0x19)
  const magicBuf = Buffer.from(MAGIC, "utf8");
  const msgBuf = Buffer.from(message, "utf8");
  const preimage = Buffer.concat([
    encodeVarint(magicBuf.length), // 0x19 = 25
    magicBuf,
    encodeVarint(msgBuf.length),
    msgBuf,
  ]);
  const h1 = sha256(preimage);
  const h2 = sha256(h1);
  return `0x${bytesToHex(h2)}`;
}

/**
 * Assemble a BIP-137 65-byte compact signature from the Ledger SDK `{ v, r, s }`.
 *
 * P2WPKH bech32 (ltc1q…) header byte per BIP-137: base 39 + v.
 *   v=0 → header=39, v=1 → header=40.
 * (Identical to BTC — the header-byte convention is address-type-dependent, not
 * chain-dependent; ltc1q and bc1q are both P2WPKH bech32.)
 *
 * @returns base64-encoded 65-byte compact signature (88 chars).
 */
function assembleBip137CompactSig(v: number, r: string, s: string): string {
  const header = v + 39; // P2WPKH bech32: base 39 + recovery_id
  const sig65 = Buffer.concat([
    Buffer.from([header]),
    Buffer.from(r, "hex"), // 32 bytes
    Buffer.from(s, "hex"), // 32 bytes
  ]);
  return sig65.toString("base64"); // 88-char base64 string
}

// ─── Tool description ─────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Sign a message with the paired Ledger LTC key to produce a BIP-137 compact signature (base64, 65 bytes) over the ltc1q segwit address.",
  "Use when the user wants to prove ownership of an LTC address for off-chain attestation or service authentication — NOT for sending LTC.",
  "This is a DIRECT SIGN tool — there is no prepare/preview/send pipeline. The signature is returned immediately.",
  "The Ledger LTC app applies the 'Litecoin Signed Message:\\n' magic prefix internally before hashing; do NOT pre-apply it.",
  "`wallet` must be the bech32 segwit address (ltc1q…) of a paired LTC account.",
  "`message` is the plaintext message to sign (non-empty, ≤ 256 bytes UTF-8). The device displays it on-screen for approval.",
  "Returns `{ address, message, signatureBase64, messageHash }` plus a LEDGER BLIND-SIGN HASH block for on-device comparison.",
  "Requires a paired LTC Ledger in real mode (call `pair_litecoin_ledger` first if needed). Refuses in demo mode (DEMO_MODE_REFUSED).",
  "Failure modes: DEMO_MODE_REFUSED (demo mode — no device), WALLET_NOT_PAIRED (no paired LTC account), INVALID_INPUT (bad address or empty/too-long message), INTERNAL_ERROR (device error).",
].join(" ");

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description:
        "Bech32 segwit LTC address of the paired account (ltc1q… format, P2WPKH). Must match a paired LTC account. Example: \"ltc1q7d9ytnst0kwsj5u6pf4qxm3a02mcmtqsrpqhx0\".",
    },
    message: {
      type: "string",
      description: [
        "Plaintext message to sign (non-empty, ≤ 256 bytes UTF-8).",
        "The Ledger device displays this text on-screen; compare character-for-character before approving.",
        "Example: \"I confirm ownership of this address for service verification: ref-12345\".",
      ].join(" "),
    },
  },
  required: ["wallet", "message"],
  additionalProperties: false,
};

// ─── Tool handler ─────────────────────────────────────────────────────────────

registerTool(
  "sign_message_ltc",
  DESCRIPTION,
  INPUT_SCHEMA,
  async (args) => {
    try {
      // ── Step 1: Input validation FIRST ─────────────────────────────────────
      const rawWallet = args["wallet"];
      const rawMessage = args["message"];

      if (typeof rawWallet !== "string" || rawWallet.trim() === "") {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "error: sign_message_ltc: `wallet` is required (bech32 segwit address, ltc1q…)",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "`wallet` is required — provide a bech32 segwit LTC address (ltc1q…)",
          ),
        };
      }

      if (typeof rawMessage !== "string" || rawMessage.trim() === "") {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "error: sign_message_ltc: `message` is required and must be non-empty",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "`message` is required and must be non-empty",
          ),
        };
      }

      const wallet = rawWallet.trim();
      const message = rawMessage;

      // Validate ltc1q segwit address — throws on invalid format.
      try {
        assertLtcSegwitAddress(wallet);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `error: sign_message_ltc: invalid ltc1q segwit address: ${reason}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `\`wallet\` is not a valid ltc1q segwit address: ${reason}`,
          ),
        };
      }

      // Message length check (UTF-8 byte count, not char count).
      const msgByteLen = Buffer.byteLength(message, "utf8");
      if (msgByteLen > MESSAGE_MAX_BYTES) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `error: sign_message_ltc: message too long (${msgByteLen} bytes; max ${MESSAGE_MAX_BYTES} bytes UTF-8)`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `\`message\` exceeds the maximum length of ${MESSAGE_MAX_BYTES} UTF-8 bytes (got ${msgByteLen})`,
          ),
        };
      }

      // ── Step 2: Demo-mode check ─────────────────────────────────────────────
      // Direct-sign tools refuse in demo mode — there is no persona fallback
      // for message signing. The error is DEMO_MODE_REFUSED.
      if (isDemoMode()) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "error: sign_message_ltc is not available in demo mode (no Ledger device). To sign messages, connect a real Ledger LTC device and exit demo mode.",
            },
          ],
          structuredContent: errEnvelope(
            "DEMO_MODE_REFUSED",
            "sign_message_ltc requires a real Ledger device; not available in demo mode",
          ),
        };
      }

      // ── Step 3: Pairing check ───────────────────────────────────────────────
      const accounts = listAccounts({ chainFilter: "litecoin" });
      if (accounts.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "error: sign_message_ltc: no paired LTC account found. Call `pair_litecoin_ledger` first.",
            },
          ],
          structuredContent: errEnvelope(
            "WALLET_NOT_PAIRED",
            "no paired LTC account; call `pair_litecoin_ledger` first",
          ),
        };
      }

      // Find the account matching the requested wallet address.
      // Only segwit (ltc1q…) addresses are supported for BIP-137 signing.
      const matchedAccount = accounts.find((a) => a.address === wallet);
      if (!matchedAccount) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `error: sign_message_ltc: wallet ${wallet} is not a paired LTC account. Call \`get_litecoin_balance\` to see paired addresses.`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `wallet ${wallet} is not paired; use a paired ltc1q address or call \`pair_litecoin_ledger\` first`,
          ),
        };
      }

      const derivationPath = matchedAccount.derivationPath;

      // ── Step 4: Compute LTC BIP-137 message hash server-side ───────────────
      // The server computes this independently for the LEDGER BLIND-SIGN HASH
      // block so the user can verify the device is signing the correct hash.
      // The device computes the same hash from the same preimage when the raw
      // message bytes arrive via APDU.
      const messageHash = computeLtcBip137MessageHash(message);

      // ── Step 5: Call Ledger LTC app signMessage APDU ────────────────────────
      // Pass ONLY raw message bytes (hex-encoded). The Ledger LTC app applies
      // the "Litecoin Signed Message:\n" magic prefix internally (Pitfall 3 mirror).
      const messageHex = Buffer.from(message, "utf8").toString("hex");
      const { v, r, s } = await _ltcLedgerTransport.signLtcMessage(
        derivationPath,
        messageHex,
      );

      // ── Step 6: Assemble BIP-137 compact signature ──────────────────────────
      // v from BtcNew = raw recovery_id (0 or 1), already stripped of 27+4.
      // P2WPKH bech32 (ltc1q…) header base = 39 (BIP-137 §Header Byte Values).
      const signatureBase64 = assembleBip137CompactSig(v, r, s);

      // ── Step 7: Build LEDGER BLIND-SIGN HASH block ──────────────────────────
      const blindSignBlock = LEDGER_BLIND_SIGN_HASH_MSG_LTC_TEMPLATE
        .replace("{MESSAGE_TEXT}", message)
        .replace("{MESSAGE_HASH}", messageHash);

      const responseText = [
        `BIP-137 LTC message signature produced.`,
        ``,
        blindSignBlock,
        ``,
        `Signature (base64): ${signatureBase64}`,
      ].join("\n");

      return {
        content: [{ type: "text" as const, text: responseText }],
        structuredContent: {
          address: wallet,
          message,
          signatureBase64,
          messageHash,
        },
      };
    } catch (err) {
      // Structured refusals for known device errors.
      if (err instanceof LedgerLtcAppNotOpenError) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "error: sign_message_ltc: Ledger LTC app is not open. Open the Litecoin app on the device and try again.",
            },
          ],
          structuredContent: errEnvelope(
            "LITECOIN_APP_NOT_OPEN",
            "Ledger LTC app is not open; open the Litecoin app on the device",
          ),
        };
      }
      if (err instanceof LedgerDeviceNotConnectedError) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "error: sign_message_ltc: Ledger device not connected. Connect the device via USB and try again.",
            },
          ],
          structuredContent: errEnvelope(
            "LEDGER_NOT_CONNECTED",
            "Ledger device not connected; connect via USB",
          ),
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `error: sign_message_ltc failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "sign_message_ltc failed",
          message,
        ),
      };
    }
  },
);
