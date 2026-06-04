// src/protocols/jupiter.ts
//
// Phase 14 Plan 14-02 (SOL-W-12). Deserialize a Jupiter-returned LEGACY swap
// transaction + enumerate its TOP-LEVEL program set for the Layer-0.5 dispatch
// gate. Sibling of `src/protocols/marginfi.ts` (the legacy-tx → FROZEN binding
// template) with a `_jupiter` ESM-indirection object (CLAUDE.md — internal
// cross-export calls route through it so tests can spy).
//
// THE MAKE-OR-BREAK OF THE PHASE: the message bytes here are constructed by a
// THIRD PARTY (Jupiter's hosted Metis router), not hand-assembled. We bind them
// through the UNCHANGED Phase-12 trust pipeline:
//
//   Transaction.from(Buffer.from(b64,"base64"))      ← LEGACY web3.js v1 class
//   messageBytes = new Uint8Array(tx.serializeMessage())  ← FROZEN preimage
//   programIds = de-duped tx.instructions.map(ix.programId.toBase58())  ← TOP-LEVEL
//
// ANTI-PATTERNS (RESEARCH § Anti-Patterns) — guarded here:
//   - NEVER VersionedTransaction.deserialize(): a v0 tx's message bytes do NOT
//     match the FROZEN binding. We FORCE legacy on /quote + /swap; if Jupiter
//     still returns v0 (the b64 deserializes as a MessageV0 shape), we REFUSE
//     with a typed error — NEVER silently produce v0 message bytes.
//   - NEVER mutate the returned tx (re-set blockhash/feePayer, reorder ix): any
//     mutation changes serializeMessage() → fingerprint no longer reflects what
//     Jupiter built. The tx is treated as immutable; feePayer + recentBlockhash
//     come from Jupiter.
//   - NEVER take tx.serialize() (signed-envelope) bytes — serializeMessage() ONLY.

import { Transaction, VersionedTransaction } from "@solana/web3.js";

/**
 * Typed refusal for the v0/VersionedTransaction anti-pattern guard. The caller
 * (prepare_jupiter_swap) catches this and emits a structured refusal — NEVER a
 * silent v0 fallback (Pitfall 1 / T-14-09).
 */
export class JupiterV0TransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JupiterV0TransactionError";
  }
}

/** Minimal per-ix summary for the handle (program enumeration + ix index). */
export interface JupiterInstructionSummary {
  kind: "jupiter";
  ixName: string;
  programId: string;
}

export interface JupiterSwapDecode {
  messageBytes: Uint8Array;
  /** De-duped TOP-LEVEL program set (inner CPI DEX hops are invisible / NOT enumerated). */
  programIds: string[];
  instructionSummary: JupiterInstructionSummary[];
}

/**
 * The byte-0 message-header bit that flags a v0 (versioned) message in the
 * Solana wire format: when the high bit of the first byte is set, the message is
 * versioned (MessageV0), NOT legacy. A legacy message's first byte is
 * `numRequiredSignatures` (< 128). We use this to detect a v0 message INSIDE a
 * VersionedTransaction envelope (where `Transaction.from` would mis-parse).
 */
const VERSIONED_MESSAGE_FLAG = 0x80;

/**
 * Deserialize a Jupiter-returned LEGACY swap transaction. Returns the FROZEN-
 * binding preimage bytes (serializeMessage()) + the de-duped TOP-LEVEL program
 * set + a minimal instruction summary.
 *
 * @throws JupiterV0TransactionError if the base64 is a v0/VersionedTransaction
 *         (anti-pattern guard — the FROZEN binding accepts only legacy bytes).
 * @throws Error if the base64 is malformed / not a parseable transaction.
 */
export function deserializeJupiterSwapTx(swapB64: string): JupiterSwapDecode {
  let raw: Buffer;
  try {
    raw = Buffer.from(swapB64, "base64");
  } catch (err) {
    throw new Error(`Jupiter swap tx: invalid base64: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (raw.length === 0) {
    throw new Error("Jupiter swap tx: empty payload");
  }

  // ---- v0 anti-pattern guard (BEFORE the legacy parse) ----
  // A serialized transaction starts with a compact-u16 signature count, then the
  // message. For a VersionedTransaction the message's first byte has the high bit
  // set (0x80 | version). `VersionedTransaction.deserialize` succeeds on a v0 tx;
  // `Transaction.from` on the same bytes mis-parses. We detect the versioned
  // shape and REFUSE — never fall through to v0 message bytes.
  if (isVersionedTransaction(raw)) {
    throw new JupiterV0TransactionError(
      "Jupiter returned a v0/VersionedTransaction — the FROZEN Solana binding accepts only legacy message bytes. " +
        "asLegacyTransaction:true must be set on BOTH /quote and /swap (re-prepare).",
    );
  }

  // ---- LEGACY deserialize (web3.js v1 Transaction class) ----
  let tx: Transaction;
  try {
    tx = Transaction.from(raw);
  } catch (err) {
    throw new Error(`Jupiter swap tx: not a parseable legacy transaction: ${err instanceof Error ? err.message : String(err)}`);
  }

  // serializeMessage() — the EXACT preimage the FROZEN binding hashes. Do NOT
  // mutate `tx` first (no re-set blockhash/feePayer, no reorder).
  const messageBytes = new Uint8Array(tx.serializeMessage());

  // De-duped TOP-LEVEL program set ONLY. Inner CPI DEX hops are invisible at the
  // top level and MUST NOT be enumerated (the allowlist is over the top-level set).
  const programIds = [...new Set(tx.instructions.map((ix) => ix.programId.toBase58()))];

  const instructionSummary: JupiterInstructionSummary[] = tx.instructions.map((ix, i) => ({
    kind: "jupiter",
    ixName: `ix-${i}`,
    programId: ix.programId.toBase58(),
  }));

  return { messageBytes, programIds, instructionSummary };
}

/**
 * Detect a v0/VersionedTransaction from its serialized bytes. Skips the
 * compact-u16 signature count + the signature blobs, then checks the message's
 * first byte for the versioned-message high-bit flag. Belt-and-suspenders: also
 * attempts `VersionedTransaction.deserialize` and inspects `message.version`.
 */
function isVersionedTransaction(raw: Buffer): boolean {
  try {
    // compact-u16 (shortvec) decode of the signature count.
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
    // Each signature is 64 bytes.
    const messageStart = offset + sigCount * 64;
    if (messageStart >= raw.length) return false;
    const firstMessageByte = raw[messageStart]!;
    if ((firstMessageByte & VERSIONED_MESSAGE_FLAG) !== 0) {
      return true;
    }
  } catch {
    // Fall through to the SDK probe below.
  }

  // Belt-and-suspenders: if VersionedTransaction.deserialize succeeds AND reports
  // a non-legacy message version, it is versioned.
  try {
    const vtx = VersionedTransaction.deserialize(new Uint8Array(raw));
    // message.version === "legacy" for a legacy message; a number (0) for v0.
    return vtx.message.version !== "legacy";
  } catch {
    return false;
  }
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. prepare_jupiter_swap imports
 * `_jupiter` and calls through the indirection so tests can spy on the decode
 * without monkey-patching the named export (ESM bindings are immutable).
 */
export const _jupiter = { deserializeJupiterSwapTx };
