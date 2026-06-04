// src/protocols/lifi-solana.ts
//
// Phase 16 Plan 16-03 (SOL-W-21 inbound EVM→Solana). Deserialize a LiFi-returned
// Solana bridge transaction with the v0-guard, binding ONLY legacy
// serializeMessage() bytes through the UNCHANGED FROZEN trust pipeline
// (computeSolanaPayloadFingerprint). Sibling of `src/protocols/jupiter.ts` — the
// v0-guard + serializeMessage()-only preimage pattern is cloned VERBATIM.
//
// ★ THE FLAGGED DECISION — resolved at execute-time (Task -1 auto-determination):
//   A live GET https://li.quest/v1/quote?...&toChain=SOL capture SUCCEEDED
//   (HTTP 200) but returned a base64 Solana tx with byte-0 = 0xd3 (>= 0x80 →
//   v0 / VersionedTransaction). Per the spec → BRANCH (b) CONSERVATIVE REFUSE:
//     - inbound returns the typed LifiV0TransactionError (NEVER silently accepted),
//     - NO legacy decode (decodeLifiSolanaRecipient) is shipped,
//     - NO Fixture AD anchored,
//     - the Solana canonical-dispatch arm stays INACTIVE (SOT sentinel),
//     - the residual is documented in SECURITY.md (v0-inbound un-shippable under
//       the FROZEN legacy-only binding until upstream exposes a legacy path or a
//       future binding-unfreeze + re-anchor phase).
//   The FROZEN binding is NEVER edited; v0 message bytes are NEVER produced.
//
// ANTI-PATTERNS (mirror jupiter.ts) — guarded here:
//   - NEVER VersionedTransaction.deserialize() into the binding: a v0 tx's
//     message bytes do NOT match the FROZEN legacy binding. v0 → typed refusal.
//   - NEVER tx.serialize() (signed-envelope) bytes — serializeMessage() ONLY.
//   - NEVER mutate the returned tx (re-set blockhash/feePayer, reorder ix).

import { Transaction, VersionedTransaction } from "@solana/web3.js";

/**
 * Typed refusal for the v0/VersionedTransaction anti-pattern guard. The caller
 * (prepare_solana_lifi_swap inbound dispatch) catches this and emits a
 * structured refusal — NEVER a silent v0 fallback (T-16-10 / T-16-15).
 *
 * Clone of `JupiterV0TransactionError` (src/protocols/jupiter.ts).
 */
export class LifiV0TransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifiV0TransactionError";
  }
}

export interface LifiSolanaTxDecode {
  /** The FROZEN-binding preimage bytes (serializeMessage()) for a LEGACY tx only. */
  messageBytes: Uint8Array;
  /** De-duped TOP-LEVEL program set (for a future canonical-dispatch arm). */
  programIds: string[];
}

/**
 * The byte-0 message-header bit that flags a v0 (versioned) message in the
 * Solana wire format: when the high bit of the first byte is set, the message is
 * versioned (MessageV0), NOT legacy. A legacy message's first byte is
 * `numRequiredSignatures` (< 128). Same constant + rationale as jupiter.ts.
 */
const VERSIONED_MESSAGE_FLAG = 0x80;

/**
 * Deserialize a LiFi-returned LEGACY Solana transaction. Returns the FROZEN-
 * binding preimage bytes (serializeMessage()) + the de-duped TOP-LEVEL program
 * set.
 *
 * @throws LifiV0TransactionError if the base64 is a v0/VersionedTransaction
 *         (the FROZEN binding accepts only legacy bytes). Under the execute-time
 *         branch (b) decision, EVERY current LiFi inbound tx hits this guard —
 *         that is the conservative refusal, by design.
 * @throws Error if the base64 is malformed / not a parseable transaction.
 */
export function deserializeLifiSolanaTx(b64: string): LifiSolanaTxDecode {
  let raw: Buffer;
  try {
    raw = Buffer.from(b64, "base64");
  } catch (err) {
    throw new Error(
      `LiFi Solana tx: invalid base64: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (raw.length === 0) {
    throw new Error("LiFi Solana tx: empty payload");
  }

  // ---- v0 anti-pattern guard (BEFORE the legacy parse) ----
  if (isVersionedTransaction(raw)) {
    throw new LifiV0TransactionError(
      "LiFi returned a v0/VersionedTransaction — the FROZEN Solana binding accepts only legacy " +
        "message bytes. EVM→Solana inbound bridging is conservatively refused until LiFi exposes a " +
        "legacy transaction path (see SECURITY.md v2.0 Solana close-out, v0-inbound residual).",
    );
  }

  // ---- LEGACY deserialize (web3.js v1 Transaction class) ----
  let tx: Transaction;
  try {
    tx = Transaction.from(raw);
  } catch (err) {
    throw new Error(
      `LiFi Solana tx: not a parseable legacy transaction: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // serializeMessage() — the EXACT preimage the FROZEN binding hashes. Do NOT
  // mutate `tx` first (no re-set blockhash/feePayer, no reorder).
  const messageBytes = new Uint8Array(tx.serializeMessage());
  const programIds = [...new Set(tx.instructions.map((ix) => ix.programId.toBase58()))];

  return { messageBytes, programIds };
}

/**
 * Detect a v0/VersionedTransaction from its serialized bytes. Skips the
 * compact-u16 signature count + the signature blobs, then checks the message's
 * first byte for the versioned-message high-bit flag. Belt-and-suspenders: also
 * attempts `VersionedTransaction.deserialize`. Clone of jupiter.ts.
 */
function isVersionedTransaction(raw: Buffer): boolean {
  try {
    let offset = 0;
    let sigCount = 0;
    let shift = 0;
    for (;;) {
      if (offset >= raw.length) return false;
      const byte = raw[offset]!;
      offset += 1;
      sigCount |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    const messageStart = offset + sigCount * 64;
    if (messageStart >= raw.length) return false;
    const firstMessageByte = raw[messageStart]!;
    if ((firstMessageByte & VERSIONED_MESSAGE_FLAG) !== 0) {
      return true;
    }
  } catch {
    // fall through to the SDK probe.
  }

  try {
    const vtx = VersionedTransaction.deserialize(new Uint8Array(raw));
    return vtx.message.version !== "legacy";
  } catch {
    return false;
  }
}

// BRANCH (b) — decodeLifiSolanaRecipient is INTENTIONALLY NOT shipped.
//
// Per the execute-time auto-determination (live capture returned a v0 tx,
// byte-0 0xd3), no legacy inbound tx exists to decode. Shipping a
// decodeLifiSolanaRecipient now would be defense-in-name-only (16-CONTEXT
// forbids it) — it could never run against a real LiFi inbound tx under the
// FROZEN legacy-only binding. When LiFi exposes a legacy path (or a future
// binding-unfreeze + re-anchor phase lands), a follow-up adds
// decodeLifiSolanaRecipient + Fixture AD + activates the Solana dispatch arm.

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. The inbound dispatch point in
 * prepare_solana_lifi_swap calls through this indirection so tests can spy on
 * the deserialize without monkey-patching the named export (ESM bindings are
 * immutable).
 */
export const _lifiSolana = { deserializeLifiSolanaTx };
