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
  NONCE_ACCOUNT_LENGTH as WEB3_NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import type { SolanaInstructionSummary } from "../signing/handle-store.js";

/**
 * Byte length of a durable-nonce account (Phase 44 — Plan 44-01). Re-exported
 * from `@solana/web3.js` (verified === 80 against the pinned SDK
 * @solana/web3.js@1.98.4). The createAccount `space` arg at nonce-init time
 * MUST be exactly this so the account is rent-exemptly sized for a nonce.
 * Pinned here so consumers (prepare_solana_nonce_init) never inline `80`.
 */
export const NONCE_ACCOUNT_LENGTH = WEB3_NONCE_ACCOUNT_LENGTH;

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

// ---------------------------------------------------------------------------
// Phase 44 — Plan 44-01: durable-nonce-account encoders (DB-3 promoted).
//
// Three thin wrappers over the System Program nonce builders, mirroring
// `encodeSolanaTransfer` (NEVER hand-roll instruction data — see anti-pattern
// guard in the file header). All three pin `programId === SYSTEM_PROGRAM_ID`
// and carry no keypair material — they take pubkeys / lamports only. The
// nonce account's own signature (createAccount requires the new account to
// sign) is supplied by the device/user flow at send time; this codebase only
// assembles the UNSIGNED message bytes (CONTEXT Locked Decision 6).
//
// Authority model (CONTEXT §Design Fork, LOCKED): the nonce authority is
// ALWAYS the paired wallet (`authorizedPubkey === feePayer === persona.address`).
// These encoders accept `authorizedPubkey` as a pubkey, but the ONLY caller
// (prepare_solana_nonce_init / _close) passes the persona address — there is
// no caller-supplied authority param at the tool boundary.
// ---------------------------------------------------------------------------

/**
 * System Program program ID, base58. Pinned re-export of
 * `SystemProgram.programId` for the program-id-swap assertion (a tampered
 * web3.js whose builders emit a different program ID is caught at build time).
 */
export const SYSTEM_PROGRAM_ID = SystemProgram.programId.toBase58();

/**
 * Encode a `SystemProgram.createAccount` instruction that funds + allocates a
 * fresh durable-nonce account. `space` is fixed to `NONCE_ACCOUNT_LENGTH` (80)
 * and `programId` is assigned to the System Program so the runtime treats the
 * account as a nonce account. Asserts the emitted instruction's `programId`
 * matches `SYSTEM_PROGRAM_ID` (program-id-swap guard).
 */
export function buildCreateNonceAccountInstruction(input: {
  from: PublicKey;
  noncePubkey: PublicKey;
  lamports: bigint;
}): TransactionInstruction {
  const ix = SystemProgram.createAccount({
    fromPubkey: input.from,
    newAccountPubkey: input.noncePubkey,
    lamports: Number(input.lamports),
    space: NONCE_ACCOUNT_LENGTH,
    programId: SystemProgram.programId,
  });
  assertSystemProgram(ix, "createAccount");
  return ix;
}

/**
 * Encode a `SystemProgram.nonceInitialize` instruction. The authority is
 * encoded in the instruction DATA (not as a signer) — `authorizedPubkey` is
 * the paired wallet under the locked authority model.
 */
export function buildNonceInitializeInstruction(input: {
  noncePubkey: PublicKey;
  authorizedPubkey: PublicKey;
}): TransactionInstruction {
  const ix = SystemProgram.nonceInitialize({
    noncePubkey: input.noncePubkey,
    authorizedPubkey: input.authorizedPubkey,
  });
  assertSystemProgram(ix, "nonceInitialize");
  return ix;
}

/**
 * Encode a `SystemProgram.nonceWithdraw` instruction. `authorizedPubkey` is a
 * REQUIRED SIGNER (the device-enforced authority guarantee — CONTEXT §Design
 * Fork (b)); `toPubkey` receives the withdrawn lamports. Closing a nonce
 * account = withdrawing its full lamport balance.
 */
export function buildNonceWithdrawInstruction(input: {
  noncePubkey: PublicKey;
  authorizedPubkey: PublicKey;
  toPubkey: PublicKey;
  lamports: bigint;
}): TransactionInstruction {
  const ix = SystemProgram.nonceWithdraw({
    noncePubkey: input.noncePubkey,
    authorizedPubkey: input.authorizedPubkey,
    toPubkey: input.toPubkey,
    lamports: Number(input.lamports),
  });
  assertSystemProgram(ix, "nonceWithdraw");
  return ix;
}

/**
 * Program-id-swap guard. A tampered / substituted web3.js whose System Program
 * builders emit instructions addressed to a different program would be caught
 * here at build time rather than producing a silently-wrong on-chain effect.
 */
function assertSystemProgram(ix: TransactionInstruction, name: string): void {
  if (!ix.programId.equals(SystemProgram.programId)) {
    throw new Error(
      `solana-system: ${name} emitted programId ${ix.programId.toBase58()}, expected ${SYSTEM_PROGRAM_ID}`,
    );
  }
}

/**
 * Build the legacy nonce-INIT transaction: `createAccount` (fund + allocate)
 * followed by `nonceInitialize` (write the durable nonce + set authority).
 * Returns the canonical message bytes (the EXACT preimage
 * `computeSolanaPayloadFingerprint` hashes) + the program IDs touched.
 *
 * `feePayer === from === authority` under the locked authority model — the
 * authority is the paired wallet. The nonce account must sign its own
 * creation; that signature is supplied by the device/user flow at send time
 * (this builds the UNSIGNED message only).
 */
export function buildNonceInitTx(input: {
  from: PublicKey;
  noncePubkey: PublicKey;
  authorizedPubkey: PublicKey;
  lamports: bigint;
  recentBlockhash: string;
}): {
  transaction: Transaction;
  messageBytes: Uint8Array;
  programIds: string[];
} {
  const tx = new Transaction({
    recentBlockhash: input.recentBlockhash,
    feePayer: input.from,
  });
  tx.add(
    buildCreateNonceAccountInstruction({
      from: input.from,
      noncePubkey: input.noncePubkey,
      lamports: input.lamports,
    }),
  );
  tx.add(
    buildNonceInitializeInstruction({
      noncePubkey: input.noncePubkey,
      authorizedPubkey: input.authorizedPubkey,
    }),
  );
  const messageBytes = new Uint8Array(tx.serializeMessage());
  const programIds = [SystemProgram.programId.toBase58()];
  return { transaction: tx, messageBytes, programIds };
}

/**
 * Build the legacy nonce-CLOSE transaction: a single `nonceWithdraw` for the
 * full lamport balance (drops the account below rent-exempt → runtime GC →
 * account closed). `authorizedPubkey === toPubkey === from === persona.address`
 * under the locked authority model (authority signs; rent returns to the
 * wallet). Returns the canonical message bytes + program IDs.
 */
export function buildNonceCloseTx(input: {
  from: PublicKey;
  noncePubkey: PublicKey;
  authorizedPubkey: PublicKey;
  toPubkey: PublicKey;
  lamports: bigint;
  recentBlockhash: string;
}): {
  transaction: Transaction;
  messageBytes: Uint8Array;
  programIds: string[];
} {
  const tx = new Transaction({
    recentBlockhash: input.recentBlockhash,
    feePayer: input.from,
  });
  tx.add(
    buildNonceWithdrawInstruction({
      noncePubkey: input.noncePubkey,
      authorizedPubkey: input.authorizedPubkey,
      toPubkey: input.toPubkey,
      lamports: input.lamports,
    }),
  );
  const messageBytes = new Uint8Array(tx.serializeMessage());
  const programIds = [SystemProgram.programId.toBase58()];
  return { transaction: tx, messageBytes, programIds };
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
  // Phase 44 — Plan 44-01 nonce encoders.
  buildCreateNonceAccountInstruction,
  buildNonceInitializeInstruction,
  buildNonceWithdrawInstruction,
  buildNonceInitTx,
  buildNonceCloseTx,
};
