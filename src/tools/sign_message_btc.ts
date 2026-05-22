// BIP-137 compact message signing via the Ledger BTC app. Phase 24 — Plan 24-02.
//
// **BTC-W-03 — Direct sign tool (NO prepare/preview/send pipeline)**
//
// `sign_message_btc` is NOT a transaction tool. It does NOT create a handle,
// does NOT go through `preview_send`, and does NOT call `send_transaction`.
// It is a direct read-then-sign tool that calls `app.signMessage` APDU once
// and returns the BIP-137 compact signature immediately.
//
// Purpose: produce a BIP-137 compact signature proving control of a BTC segwit
// address — the canonical wallet-ownership-proof shape used for exchange KYC,
// off-chain attestation, and dApp login.
//
// Flow:
//   1. Input validation: `wallet` is a valid bech32 segwit address;
//      `message` is a non-empty string ≤ MESSAGE_MAX_LEN chars.
//   2. Demo-mode check: refuse with `DEMO_MODE_REFUSED` — no device in demo.
//   3. Pairing check: `listAccounts({ chainFilter: "bitcoin" })` — find the
//      account matching `wallet`. No match → refuse.
//   4. Compute BIP-137 message hash server-side (for LEDGER BLIND-SIGN HASH
//      block): double-SHA256(varint(24) ‖ "Bitcoin Signed Message:\n" ‖
//      varint(len(message)) ‖ message).
//   5. Call `_btcLedgerTransport.signBtcMessage(path, messageHex)` where
//      `messageHex = Buffer.from(message, "utf8").toString("hex")`.
//      The Ledger BTC app applies the magic prefix INTERNALLY — passing the
//      pre-prefixed message would double-prefix (RESEARCH Pitfall 3).
//   6. Assemble BIP-137 compact signature: header = v + 39 (P2WPKH bech32),
//      sig65 = [header][32-byte r][32-byte s], signatureBase64 = base64.
//   7. Return `{ address, message, signatureBase64, messageHash }` + LEDGER
//      BLIND-SIGN HASH block containing message text and hash.
//
// BIP-322 taproot message signing is OUT OF SCOPE (CONTEXT `<deferred>`).
//
// **No private key material crosses any boundary.** The device signs via APDU;
// the server only assembles the compact signature from the returned `{ v, r, s }`.

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

import "../chains/bitcoin/types.js"; // initEccLib side-effect (secp256k1 lib init)
import { assertBtcSegwitAddress } from "../chains/bitcoin/types.js";
import { isDemoMode } from "../config/env.js";
import {
  LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE,
} from "../signing/blocks-btc.js";
import {
  type ErrorCode,
  type StructuredError,
  makeStructuredError,
} from "../signing/error-codes.js";
import { listAccounts } from "../wallet/non-evm-account-store.js";
import { _btcLedgerTransport, LedgerBtcAppNotOpenError, LedgerDeviceNotConnectedError } from "../wallet/ledger-btc-transport.js";
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
 * Maximum message length in UTF-8 bytes accepted by `sign_message_btc`.
 * BIP-137 message preimage uses a varint for the message length; values up
 * to 0xffff are supported by the varint encoding. However, Ledger device
 * display and agent payload constraints make a practical cap sensible.
 * 256 bytes covers all common use cases (KYC nonces, login challenges, etc.)
 * while keeping the device display manageable.
 */
const MESSAGE_MAX_BYTES = 256;

// ─── BIP-137 hash helpers ──────────────────────────────────────────────────────

/**
 * Bitcoin compact integer (varint) encoding.
 * Values < 0xfd: single byte.
 * Values 0xfd–0xffff: 3 bytes (0xfd prefix + LE uint16).
 * Values > 0xffff: not supported (BIP-137 messages are capped well below this).
 *
 * The BIP-137 preimage uses varint for the magic prefix length (24 = 0x18)
 * and the message length.
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
 * Compute the BIP-137 double-SHA256 message hash.
 *
 * Preimage: varint(24) ‖ "Bitcoin Signed Message:\n" ‖ varint(len(message)) ‖ message
 * Hash: SHA-256(SHA-256(preimage))
 *
 * This is the SAME hash the Ledger device computes internally before signing —
 * the server computes it independently for the LEDGER BLIND-SIGN HASH block
 * so the user can verify the device is signing what the agent claims.
 *
 * Fixture W anchor: computeBip137MessageHash("Hello VaultPilot")
 * === "0xca329bc5829e0752932695bd827ca11f3dbe9efd7f94f75fedc42574cb86667e"
 * (pinned in test/signing-bip137.test.ts — cross-linked from
 * test/tools-sign-message-btc.test.ts).
 *
 * NOTE: this is a double-SHA256 hash, NOT a keccak256 payloadFingerprint.
 */
function computeBip137MessageHash(message: string): string {
  const MAGIC = "Bitcoin Signed Message:\n"; // exactly 24 UTF-8 bytes
  const magicBuf = Buffer.from(MAGIC, "utf8");
  const msgBuf = Buffer.from(message, "utf8");
  const preimage = Buffer.concat([
    encodeVarint(magicBuf.length), // 0x18 = 24
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
 * The Ledger BTC app (via BtcNew.js) returns `v` as the raw recovery_id (0 or 1)
 * after stripping the device-side `27+4` offset (BtcNew.js line 294:
 * `const v = buf.readUInt8() - 27 - 4`).
 *
 * P2WPKH bech32 (native segwit, `bc1q…`) header byte per BIP-137: base 39 + v.
 *   v=0 → header=39, v=1 → header=40.
 *
 * @returns base64-encoded 65-byte compact signature (88 chars).
 */
function assembleBip137CompactSig(v: number, r: string, s: string): string {
  const header = v + 39; // P2WPKH bech32: base 39 + recovery_id (T-24-10)
  const sig65 = Buffer.concat([
    Buffer.from([header]),
    Buffer.from(r, "hex"), // 32 bytes
    Buffer.from(s, "hex"), // 32 bytes
  ]);
  return sig65.toString("base64"); // 88-char base64 string
}

// ─── Tool description ─────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Sign a message with the paired Ledger BTC key to produce a BIP-137 compact signature (base64, 65 bytes) over the segwit address.",
  "Use when the user wants to prove ownership of a BTC address for KYC, off-chain attestation, or dApp login — NOT for sending BTC.",
  "This is a DIRECT SIGN tool — there is no prepare/preview/send pipeline. The signature is returned immediately.",
  "The Ledger BTC app applies the 'Bitcoin Signed Message:\\n' magic prefix internally before hashing; do NOT pre-apply it.",
  "`wallet` must be the bech32 segwit address (bc1q…) of a paired BTC account.",
  "`message` is the plaintext message to sign (non-empty, ≤ 256 bytes UTF-8). The device displays it on-screen for approval.",
  "Returns `{ address, message, signatureBase64, messageHash }` plus a LEDGER BLIND-SIGN HASH block for on-device comparison.",
  "Requires a paired BTC Ledger in real mode (call `pair_btc_ledger` first if needed). Refuses in demo mode (DEMO_MODE_REFUSED).",
  "BIP-322 taproot message signing (bc1p… addresses) is deferred — use this tool for bc1q… segwit addresses only.",
  "Failure modes: DEMO_MODE_REFUSED (demo mode — no device), WALLET_NOT_PAIRED (no paired BTC account), INVALID_INPUT (bad address or empty/too-long message), INTERNAL_ERROR (device error).",
].join(" ");

// ─── Input schema ─────────────────────────────────────────────────────────────

const INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    wallet: {
      type: "string",
      description:
        "Bech32 segwit BTC address of the paired account (bc1q… format, P2WPKH). Must match a paired BTC account. Example: \"bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq\".",
    },
    message: {
      type: "string",
      description: [
        "Plaintext message to sign (non-empty, ≤ 256 bytes UTF-8).",
        "The Ledger device displays this text on-screen; compare character-for-character before approving.",
        "Example: \"I confirm ownership of this address for KYC verification: ref-12345\".",
      ].join(" "),
    },
  },
  required: ["wallet", "message"],
  additionalProperties: false,
};

// ─── Tool handler ─────────────────────────────────────────────────────────────

registerTool(
  "sign_message_btc",
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
              text: "error: sign_message_btc: `wallet` is required (bech32 segwit address, bc1q…)",
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            "`wallet` is required — provide a bech32 segwit BTC address (bc1q…)",
          ),
        };
      }

      if (typeof rawMessage !== "string" || rawMessage.trim() === "") {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "error: sign_message_btc: `message` is required and must be non-empty",
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

      // Validate bech32 segwit address — throws on invalid format.
      try {
        assertBtcSegwitAddress(wallet);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `error: sign_message_btc: invalid segwit address: ${reason}`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `\`wallet\` is not a valid bech32 segwit address: ${reason}`,
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
              text: `error: sign_message_btc: message too long (${msgByteLen} bytes; max ${MESSAGE_MAX_BYTES} bytes UTF-8)`,
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
      // for message signing (unlike prepare_btc_send which uses a persona
      // address for PSBT simulation). The error is DEMO_MODE_REFUSED (not
      // WRONG_MODE — this tool has no mode concept; it simply requires a device).
      if (isDemoMode()) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "error: sign_message_btc is not available in demo mode (no Ledger device). To sign messages, connect a real Ledger BTC device and exit demo mode.",
            },
          ],
          structuredContent: errEnvelope(
            "DEMO_MODE_REFUSED",
            "sign_message_btc requires a real Ledger device; not available in demo mode",
          ),
        };
      }

      // ── Step 3: Pairing check ───────────────────────────────────────────────
      const accounts = listAccounts({ chainFilter: "bitcoin" });
      if (accounts.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "error: sign_message_btc: no paired BTC account found. Call `pair_btc_ledger` first.",
            },
          ],
          structuredContent: errEnvelope(
            "WALLET_NOT_PAIRED",
            "no paired BTC account; call `pair_btc_ledger` first",
          ),
        };
      }

      // Find the account matching the requested wallet address.
      // The tool signs with the paired account's key — an agent-supplied wallet
      // address not matching any paired account is refused (T-24-11 mitigation:
      // the device signs with the paired account's key, not an agent-chosen path).
      // Refusing non-matching wallets uses INVALID_INPUT (the `wallet` arg is
      // invalid for THIS server's paired accounts; it may be a valid BTC address
      // but it's not one we have a key for).
      const matchedAccount = accounts.find((a) => a.address === wallet);
      if (!matchedAccount) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `error: sign_message_btc: wallet ${wallet} is not a paired BTC account. Call \`get_btc_status\` to see paired addresses.`,
            },
          ],
          structuredContent: errEnvelope(
            "INVALID_INPUT",
            `wallet ${wallet} is not paired; use a paired segwit address or call \`pair_btc_ledger\` first`,
          ),
        };
      }

      const derivationPath = matchedAccount.derivationPath;

      // ── Step 4: Compute BIP-137 message hash server-side ───────────────────
      // The server computes this independently for the LEDGER BLIND-SIGN HASH
      // block so the user can verify the device is signing the correct hash
      // (T-24-09 mitigation). The device computes the same hash from the same
      // preimage when the raw message bytes arrive via APDU.
      const messageHash = computeBip137MessageHash(message);

      // ── Step 5: Call Ledger BTC app signMessage APDU ────────────────────────
      // Pass ONLY raw message bytes (hex-encoded). The Ledger BTC app v2.1+
      // applies the magic prefix internally (RESEARCH §BIP-137 Verified Details).
      // Passing a pre-prefixed message would double-prefix → invalid BIP-137 sig.
      const messageHex = Buffer.from(message, "utf8").toString("hex");
      const { v, r, s } = await _btcLedgerTransport.signBtcMessage(
        derivationPath,
        messageHex,
      );

      // ── Step 6: Assemble BIP-137 compact signature ──────────────────────────
      // v from BtcNew = raw recovery_id (0 or 1), already stripped of 27+4.
      // P2WPKH bech32 header base = 39 (BIP-137 §Header Byte Values).
      const signatureBase64 = assembleBip137CompactSig(v, r, s);

      // ── Step 7: Build LEDGER BLIND-SIGN HASH block ──────────────────────────
      const blindSignBlock = LEDGER_BLIND_SIGN_HASH_MSG_BTC_TEMPLATE
        .replace("{MESSAGE_TEXT}", message)
        .replace("{MESSAGE_HASH}", messageHash);

      const responseText = [
        `BIP-137 message signature produced.`,
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
      if (err instanceof LedgerBtcAppNotOpenError) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "error: sign_message_btc: Ledger BTC app is not open. Open the Bitcoin app on the device and try again.",
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            "Ledger BTC app is not open; open the Bitcoin app on the device",
            "LedgerBtcAppNotOpenError",
          ),
        };
      }
      if (err instanceof LedgerDeviceNotConnectedError) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "error: sign_message_btc: Ledger device not connected. Connect the device via USB and try again.",
            },
          ],
          structuredContent: errEnvelope(
            "INTERNAL_ERROR",
            "Ledger device not connected; connect via USB",
            "LedgerDeviceNotConnectedError",
          ),
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `error: sign_message_btc failed: ${message}`,
          },
        ],
        structuredContent: errEnvelope(
          "INTERNAL_ERROR",
          "sign_message_btc failed",
          message,
        ),
      };
    }
  },
);
