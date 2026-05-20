// Solana System Program encoder + decoder. Sibling of `src/protocols/erc20.ts`
// (Phase 6 / Plan 06-02). Phase 12 — Plan 12-02.
//
// Consumed by:
//   - src/tools/prepare_solana_native_send.ts   (encodeSolanaTransfer + buildSolanaTransferTx)
//   - src/tools/preview_send.ts (Solana branch)  (decodeSolanaSystemCall — Plan 12-04)
//
// Format-fanout-sentinel rule (CLAUDE.md): System Program instruction
// discriminants + the message-bytes serialization MUST live here exactly
// once. Tools NEVER inline `SystemProgram.transfer(...)` calls — they go
// through `_solanaSystem.buildSolanaTransferTx(...)` so the test seam
// stays uniform.
//
// SDK reality (verified against @solana/web3.js@1.98.4):
//   - `SystemProgram.transfer({ fromPubkey, toPubkey, lamports })` returns
//     a `TransactionInstruction` with `programId === SystemProgram.programId`
//     and `data` shaped as 4-byte little-endian instruction discriminant +
//     8-byte little-endian u64 lamports = 12 bytes total.
//   - System Program `Transfer` instruction discriminant is `2` per the
//     Solana program's `SystemInstruction` enum (see
//     `programs/system/src/system_instruction.rs` upstream).
//   - `new Transaction({ recentBlockhash, feePayer }).add(ix).serializeMessage()`
//     returns the EXACT bytes the network signs over — same input feeding
//     `computeSolanaPayloadFingerprint` (Plan 12-01) and
//     `computeSolanaPresignHash` (Plan 12-01). Byte-stability across two
//     calls with the same inputs is the load-bearing property the trust
//     pipeline depends on.
//   - LEGACY `Transaction` shape (NOT `VersionedTransaction` / v0 messages)
//     per Phase 12 RESEARCH OQ-1 lock. v0 + Address Lookup Tables deferred
//     to v2.0.x.
//
// Anti-pattern guard — NEVER hand-roll account_keys / compact-u16 length
// prefixes / instruction-data byte layout. Always go through
// `SystemProgram.transfer(...)` and `Transaction.serializeMessage()` so an
// SDK version bump (e.g. account-ordering change in v2.x) propagates
// uniformly without silent fingerprint drift.

import {
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import type { SolanaInstructionSummary } from "../signing/handle-store.js";

/**
 * System Program `Transfer` instruction discriminant. 4-byte little-endian
 * u32 prefix at the start of `instruction.data`. Pinned here as a regression
 * anchor — drift in the upstream `SystemInstruction` enum ordering would
 * surface at decode time (the discriminant check below fails) rather than as
 * a silent miscategorization.
 */
export const SYSTEM_TRANSFER_DISCRIMINANT = 2;

/**
 * Encode a System Program `Transfer` instruction.
 *
 * Wraps `SystemProgram.transfer(...)` — never hand-rolled. SDK accepts
 * `bigint` lamports per @solana/web3.js@1.98.4 (verified against the
 * installed `.d.ts`).
 */
export function encodeSolanaTransfer(input: {
  from: PublicKey;
  to: PublicKey;
  lamports: bigint;
}): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: input.from,
    toPubkey: input.to,
    lamports: input.lamports,
  });
}

/**
 * Build a legacy `Transaction` carrying a single System Program `Transfer`
 * instruction. Returns the transaction object + the canonical message bytes
 * (the EXACT preimage `computeSolanaPayloadFingerprint` hashes) + the program
 * IDs touched + a decoded instruction summary for the DECODED ARGS surface
 * (Plan 12-04 preview_send branch).
 *
 * Byte-stability: same inputs (same from/to/lamports/recentBlockhash) produce
 * byte-identical `messageBytes` across two calls. The legacy `Transaction`
 * shape includes `feePayer` as `account_keys[0]` of the serialized message —
 * the Solana fingerprint IS sender-dependent by construction (contrast with
 * EVM where `from` is not in the EIP-1559 preimage).
 */
export function buildSolanaTransferTx(input: {
  from: PublicKey;
  to: PublicKey;
  lamports: bigint;
  recentBlockhash: string;
}): {
  transaction: Transaction;
  messageBytes: Uint8Array;
  programIds: string[];
  instructionSummary: SolanaInstructionSummary[];
} {
  const tx = new Transaction({
    recentBlockhash: input.recentBlockhash,
    feePayer: input.from,
  });
  tx.add(
    encodeSolanaTransfer({
      from: input.from,
      to: input.to,
      lamports: input.lamports,
    }),
  );
  // `Transaction.serializeMessage()` returns a Node `Buffer`. Convert to a
  // plain `Uint8Array` for the handle-store contract (CLAUDE.md decimal-string-
  // at-the-boundary discipline — `Buffer` is a Node-ism, `Uint8Array` is the
  // cross-environment-stable shape).
  const messageBytes = new Uint8Array(tx.serializeMessage());
  const programIds = [SystemProgram.programId.toBase58()];
  const instructionSummary: SolanaInstructionSummary[] = [
    {
      kind: "native-transfer",
      from: input.from.toBase58(),
      to: input.to.toBase58(),
      lamports: input.lamports,
    },
  ];
  return { transaction: tx, messageBytes, programIds, instructionSummary };
}

/**
 * Discriminated-union decode result for selector-routed dispatch in
 * `preview_send.ts` Solana branch (Plan 12-04). Mirror of `Erc20Decoded`
 * (Phase 6 / Plan 06-02 — `src/protocols/erc20.ts`).
 *
 * The `unknown` branch fires for:
 *   - Empty instruction list (no instructions in the message).
 *   - First instruction's `programId` is not `SystemProgram.programId`.
 *   - First instruction's data doesn't match the `Transfer` discriminant
 *     (instruction 2 in little-endian u32).
 *   - Truncated data (less than 12 bytes — 4-byte discriminant + 8-byte u64).
 */
export type SolanaSystemDecoded =
  | { kind: "transfer"; from: string; to: string; lamports: bigint }
  | { kind: "unknown" };

/**
 * Decode the first instruction of a legacy `Transaction`. Returns a typed
 * `{ kind: "transfer", from, to, lamports }` shape for System Program
 * `Transfer` instructions; returns `{ kind: "unknown" }` for anything else.
 *
 * NEVER throws. Caller (preview_send Solana branch) falls back to a generic
 * "unrecognized instruction" surface on the unknown branch.
 *
 * Why decode the message-level instruction list directly rather than
 * inspecting the `Transaction.instructions` array: the latter is the
 * builder-side representation (rich PublicKey references); the former is
 * the post-serialization shape that the on-device display would actually
 * show. They agree for legacy single-instruction `Transfer` transactions,
 * but the message-level shape is the cryptographic ground truth.
 */
export function decodeSolanaSystemCall(
  transaction: Transaction,
): SolanaSystemDecoded {
  if (transaction.instructions.length === 0) return { kind: "unknown" };
  const ix = transaction.instructions[0];
  if (ix === undefined) return { kind: "unknown" };

  // Refuse anything not addressed to System Program.
  if (!ix.programId.equals(SystemProgram.programId)) {
    return { kind: "unknown" };
  }

  // System Program `Transfer` instruction data layout:
  //   bytes [0..4]  : 4-byte little-endian u32 instruction discriminant (== 2 for Transfer)
  //   bytes [4..12] : 8-byte little-endian u64 lamports
  // Total = 12 bytes. Anything shorter is malformed.
  if (ix.data.length < 12) return { kind: "unknown" };
  // Read the 4-byte LE discriminant. `Buffer.readUInt32LE` is the canonical
  // path — works on both Node `Buffer` and any wrapping that goes through
  // `Buffer.from(ix.data)`.
  const buf = Buffer.isBuffer(ix.data) ? ix.data : Buffer.from(ix.data);
  const discriminant = buf.readUInt32LE(0);
  if (discriminant !== SYSTEM_TRANSFER_DISCRIMINANT) return { kind: "unknown" };

  // Read the 8-byte LE u64 lamports. Use the bigint variant — `readUInt32LE`
  // would truncate. Node 18.17+ supports `readBigUInt64LE`.
  const lamports = buf.readBigUInt64LE(4);

  // Account-key ordering for `SystemProgram.transfer`:
  //   keys[0] = from (signer + writable)
  //   keys[1] = to   (writable)
  if (ix.keys.length < 2) return { kind: "unknown" };
  const fromKey = ix.keys[0]?.pubkey;
  const toKey = ix.keys[1]?.pubkey;
  if (!(fromKey instanceof PublicKey) || !(toKey instanceof PublicKey)) {
    return { kind: "unknown" };
  }

  return {
    kind: "transfer",
    from: fromKey.toBase58(),
    to: toKey.toBase58(),
    lamports,
  };
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * Consumers (`prepare_solana_native_send.ts` Plan 12-02; `preview_send.ts`
 * Solana branch Plan 12-04) import `_solanaSystem` and call through the
 * indirection so tests can `vi.spyOn(_solanaSystem, "buildSolanaTransferTx")`
 * to intercept without monkey-patching the production import path. Direct
 * `vi.spyOn(module, "buildSolanaTransferTx")` is a silent no-op for cross-
 * export internal calls — ESM named-export bindings are immutable.
 */
export const _solanaSystem = {
  encodeSolanaTransfer,
  buildSolanaTransferTx,
  decodeSolanaSystemCall,
};
