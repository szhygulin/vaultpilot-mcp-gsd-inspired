// Solana SPL Token Program encoder + ATA derivation + decoder. Sibling of
// `src/protocols/erc20.ts` (Phase 6 / Plan 06-02) and `src/protocols/solana-system.ts`
// (Plan 12-02). Phase 12 — Plan 12-03.
//
// Consumed by:
//   - src/tools/prepare_solana_spl_send.ts          (encodeSplTransferChecked + buildSplTransferTx)
//   - src/tools/preview_send.ts (Solana branch)     (decodeSplCall — Plan 12-04)
//
// Format-fanout-sentinel rule (CLAUDE.md): SPL TransferChecked instruction
// shape + ATA derivation + the conditional create-ATA prepend live HERE
// exactly once. Tools NEVER inline `createTransferCheckedInstruction(...)`
// calls — they go through `_solanaSpl.buildSplTransferTx(...)` so the test
// seam stays uniform.
//
// SDK reality (verified against @solana/spl-token@0.4.14):
//   - `createTransferCheckedInstruction(source, mint, destination, owner, amount, decimals, multiSigners?, programId?)`
//     returns a `TransactionInstruction` with `programId === TOKEN_PROGRAM_ID`
//     and 4 account keys (source-writable, mint-readonly, destination-writable,
//     owner-signer). Data layout: 1-byte TokenInstruction discriminant
//     (TransferChecked = 12) + 8-byte LE u64 amount + 1-byte decimals = 10 bytes total.
//   - `getAssociatedTokenAddress(mint, owner)` returns the deterministic PDA
//     for `[owner_bytes, TOKEN_PROGRAM_ID_bytes, mint_bytes]` seeds under
//     `ASSOCIATED_TOKEN_PROGRAM_ID`. NEVER hand-rolled per RESEARCH § Topic 6
//     "DON'T HAND-ROLL" rule — the seed order is easy to get wrong.
//   - `createAssociatedTokenAccountInstruction(payer, associatedToken, owner, mint)`
//     returns a `TransactionInstruction` with `programId === ASSOCIATED_TOKEN_PROGRAM_ID`.
//     Pays rent (~0.002 SOL) from `payer` to create the recipient's ATA.
//
// **TransferChecked vs Transfer (RESEARCH § Topic 6 LOCK):** uses
// `createTransferCheckedInstruction` (NOT the deprecated
// `createTransferInstruction`). TransferChecked passes mint + decimals AS
// instruction args, so the on-chain SPL program verifies decimals against
// the mint AND verifies the source ATA holds the named mint. Defense-in-
// depth — drift between agent-claimed mint and actual source-ATA mint →
// tx fails at simulation (consumed by Plan 12-04 DF-4 gate).
//
// Anti-pattern guard — NEVER manually compute the ATA via
// `findProgramAddressSync(seeds, programId)`. Always use
// `getAssociatedTokenAddress(mint, owner)`. The seed order is
// `[owner_bytes, TOKEN_PROGRAM_ID_bytes, mint_bytes]` which is easy to
// get wrong.

import {
  PublicKey,
  Transaction,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";

import type { SolanaInstructionSummary } from "../signing/handle-store.js";

/**
 * SPL Token Program `TransferChecked` instruction discriminant. 1-byte u8
 * prefix at the start of `instruction.data`. Pinned here as a regression
 * anchor — drift in the upstream `TokenInstruction` enum ordering would
 * surface at decode time (the discriminant check below fails) rather than
 * as a silent miscategorization. Value verified against
 * @solana/spl-token@0.4.14 `TokenInstruction.TransferChecked === 12`.
 */
export const SPL_TRANSFER_CHECKED_DISCRIMINANT = 12;

/**
 * Derive the Associated Token Account (ATA) for `(mint, owner)`.
 *
 * Wraps `getAssociatedTokenAddress(mint, owner)` from @solana/spl-token —
 * NEVER hand-rolled. The ATA is deterministic per `[owner_bytes,
 * TOKEN_PROGRAM_ID_bytes, mint_bytes]` PDA seeds (RESEARCH § Topic 6
 * DON'T HAND-ROLL rule). Same mint + same owner → same ATA across every
 * call.
 *
 * Sender-dependent by construction: swapping `owner` changes the derived
 * ATA, which is why SPL transfer fingerprints differ across personas
 * (Plan 12-05 integration test asserts this property end-to-end).
 */
export async function deriveAtaForOwner(
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, owner);
}

/**
 * Pre-flight: check whether the destination ATA already exists on-chain.
 * When `null`, the recipient does not yet hold this token — the prepare
 * tool MUST prepend a `createAssociatedTokenAccountInstruction` (paid by
 * the sender as `feePayer`, ~0.002 SOL rent).
 *
 * Defensive — wraps the `getAccountInfo` call so RPC failure surfaces as
 * `BROADCAST_FAILED` upstream (the tool handler catches at the
 * `buildSplTransferTx` call site). Never throws past the tool handler.
 *
 * Returns `{ instructions, created }`:
 *   - `created: false` when the ATA exists → `instructions: []` (no
 *     prepend needed; the transferChecked goes alone).
 *   - `created: true` when the ATA is absent → `instructions: [<createATA ix>]`
 *     (gets prepended before the transferChecked at the call site).
 */
export async function maybeAppendCreateAtaInstruction(input: {
  connection: Connection;
  payer: PublicKey;
  destinationAta: PublicKey;
  recipientOwner: PublicKey;
  mint: PublicKey;
}): Promise<{ instructions: TransactionInstruction[]; created: boolean }> {
  const accountInfo = await input.connection.getAccountInfo(
    input.destinationAta,
  );
  if (accountInfo === null) {
    return {
      instructions: [
        createAssociatedTokenAccountInstruction(
          input.payer,
          input.destinationAta,
          input.recipientOwner,
          input.mint,
        ),
      ],
      created: true,
    };
  }
  return { instructions: [], created: false };
}

/**
 * Encode a single SPL `TransferChecked` instruction.
 *
 * Wraps `createTransferCheckedInstruction(...)` — NEVER hand-rolled.
 * TransferChecked (NOT the deprecated `Transfer`) is the load-bearing
 * defense-in-depth choice per RESEARCH § Topic 6: the on-chain SPL
 * program verifies decimals against the mint AND verifies the source ATA
 * holds the named mint. Drift between agent-claimed mint and actual
 * source-ATA mint → tx fails at simulation (Plan 12-04 DF-4 gate).
 */
export function encodeSplTransferChecked(input: {
  source: PublicKey;
  mint: PublicKey;
  destination: PublicKey;
  owner: PublicKey;
  amount: bigint;
  decimals: number;
}): TransactionInstruction {
  return createTransferCheckedInstruction(
    input.source,
    input.mint,
    input.destination,
    input.owner,
    input.amount,
    input.decimals,
  );
}

/**
 * Build a legacy `Transaction` carrying an SPL `TransferChecked` instruction.
 * Optionally prepends a `createAssociatedTokenAccountInstruction` when the
 * destination ATA does not yet exist on-chain.
 *
 * Returns the transaction + canonical message bytes (the EXACT preimage
 * `computeSolanaPayloadFingerprint` hashes) + program IDs touched +
 * decoded instruction summary + ATA-creation flag + both derived ATAs.
 *
 * Byte-stability: same inputs (same from/toWallet/mint/amount/decimals/
 * recentBlockhash + same on-chain destAta state) produce byte-identical
 * `messageBytes` across two calls. The legacy `Transaction` shape includes
 * `feePayer` as `account_keys[0]` of the serialized message — sender-
 * dependent fingerprint by construction.
 *
 * Per RESEARCH § Topic 6 Pitfall 4 (conditional ATA-creation): the
 * create-ATA instruction (when present) goes FIRST (instruction[0]); the
 * transferChecked goes second. The SPL Token Program requires the
 * destination ATA to exist before it can be written to.
 */
export async function buildSplTransferTx(input: {
  connection: Connection;
  from: PublicKey;
  toWallet: PublicKey;
  mint: PublicKey;
  amount: bigint;
  decimals: number;
  recentBlockhash: string;
}): Promise<{
  transaction: Transaction;
  messageBytes: Uint8Array;
  programIds: string[];
  instructionSummary: SolanaInstructionSummary[];
  createDestAta: boolean;
  sourceAta: string;
  destAta: string;
}> {
  // ATA derivation — NEVER hand-rolled. `deriveAtaForOwner` routes through
  // `getAssociatedTokenAddress(mint, owner)` so the seed order
  // `[owner_bytes, TOKEN_PROGRAM_ID_bytes, mint_bytes]` cannot drift.
  const sourceAta = await deriveAtaForOwner(input.from, input.mint);
  const destAta = await deriveAtaForOwner(input.toWallet, input.mint);

  // Pre-flight: does the destination ATA already exist? If not, the SPL
  // Token Program would reject the transfer at execution — we prepend a
  // create-ATA instruction (paid by `feePayer`, ~0.002 SOL rent).
  const { instructions: maybeCreate, created } =
    await maybeAppendCreateAtaInstruction({
      connection: input.connection,
      payer: input.from,
      destinationAta: destAta,
      recipientOwner: input.toWallet,
      mint: input.mint,
    });

  const transferIx = encodeSplTransferChecked({
    source: sourceAta,
    mint: input.mint,
    destination: destAta,
    owner: input.from,
    amount: input.amount,
    decimals: input.decimals,
  });

  const tx = new Transaction({
    recentBlockhash: input.recentBlockhash,
    feePayer: input.from,
  });
  // create-ATA goes FIRST when needed (Pitfall 4); transferChecked second.
  // The SPL Token Program requires the destination ATA to exist before it
  // can be written to.
  tx.add(...maybeCreate, transferIx);

  // `Transaction.serializeMessage()` returns a Node `Buffer`. Convert to a
  // plain `Uint8Array` for the handle-store contract (cross-environment-
  // stable shape).
  const messageBytes = new Uint8Array(tx.serializeMessage());

  // Program IDs touched: always TOKEN_PROGRAM_ID; also ASSOCIATED_TOKEN_PROGRAM_ID
  // when create-ATA was prepended. Consumed by `canonical-dispatch-solana`
  // (Plan 12-04 Layer 0.5 allowlist refusal).
  const programIds = [
    TOKEN_PROGRAM_ID.toBase58(),
    ...(created ? [ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()] : []),
  ];

  const instructionSummary: SolanaInstructionSummary[] = [
    {
      kind: "spl-transfer-checked",
      mint: input.mint.toBase58(),
      sourceAta: sourceAta.toBase58(),
      destAta: destAta.toBase58(),
      destOwner: input.toWallet.toBase58(),
      amount: input.amount,
      decimals: input.decimals,
    },
  ];

  return {
    transaction: tx,
    messageBytes,
    programIds,
    instructionSummary,
    createDestAta: created,
    sourceAta: sourceAta.toBase58(),
    destAta: destAta.toBase58(),
  };
}

/**
 * Discriminated-union decode result for selector-routed dispatch in
 * `preview_send.ts` Solana branch (Plan 12-04). Two recognized shapes:
 *
 *   - `transfer-checked`  → SPL Token Program TransferChecked instruction
 *   - `create-ata`        → Associated Token Program createAssociatedTokenAccount
 *
 * Anything else returns `{ kind: "unknown" }`. The `unknown` branch fires
 * for:
 *   - `programId !== TOKEN_PROGRAM_ID && programId !== ASSOCIATED_TOKEN_PROGRAM_ID`.
 *   - SPL Token Program instruction with discriminant != TransferChecked.
 *   - Truncated data (less than 10 bytes for TransferChecked).
 */
export type SolanaSplDecoded =
  | {
      kind: "transfer-checked";
      source: string;
      mint: string;
      destination: string;
      owner: string;
      amount: bigint;
      decimals: number;
    }
  | {
      kind: "create-ata";
      payer: string;
      destinationAta: string;
      owner: string;
      mint: string;
    }
  | { kind: "unknown" };

/**
 * Decode a single `TransactionInstruction` to its discriminated-union
 * shape. NEVER throws. Caller (preview_send Solana branch) falls back to
 * a generic "unrecognized instruction" surface on the unknown branch.
 *
 * SPL TransferChecked instruction data layout (1+8+1 = 10 bytes):
 *   byte [0]      : TokenInstruction discriminant (== 12 for TransferChecked)
 *   bytes [1..9]  : 8-byte little-endian u64 amount
 *   byte [9]      : 1-byte decimals
 *
 * createAssociatedTokenAccount account ordering (keys[0..6]):
 *   keys[0] = payer (signer + writable)
 *   keys[1] = associatedToken (writable)
 *   keys[2] = owner (the recipient — readonly)
 *   keys[3] = mint (readonly)
 *   keys[4] = systemProgram (readonly)
 *   keys[5] = tokenProgram (readonly)
 */
export function decodeSplCall(
  instruction: TransactionInstruction,
): SolanaSplDecoded {
  // SPL Token Program — TransferChecked branch.
  if (instruction.programId.equals(TOKEN_PROGRAM_ID)) {
    if (instruction.data.length < 10) return { kind: "unknown" };
    const buf = Buffer.isBuffer(instruction.data)
      ? instruction.data
      : Buffer.from(instruction.data);
    const discriminant = buf.readUInt8(0);
    if (discriminant !== SPL_TRANSFER_CHECKED_DISCRIMINANT) {
      return { kind: "unknown" };
    }
    const amount = buf.readBigUInt64LE(1);
    const decimals = buf.readUInt8(9);
    // Account-key ordering for createTransferCheckedInstruction:
    //   keys[0] = source (writable)
    //   keys[1] = mint   (readonly)
    //   keys[2] = destination (writable)
    //   keys[3] = owner  (signer)
    if (instruction.keys.length < 4) return { kind: "unknown" };
    const source = instruction.keys[0]?.pubkey;
    const mint = instruction.keys[1]?.pubkey;
    const destination = instruction.keys[2]?.pubkey;
    const owner = instruction.keys[3]?.pubkey;
    if (
      !(source instanceof PublicKey) ||
      !(mint instanceof PublicKey) ||
      !(destination instanceof PublicKey) ||
      !(owner instanceof PublicKey)
    ) {
      return { kind: "unknown" };
    }
    return {
      kind: "transfer-checked",
      source: source.toBase58(),
      mint: mint.toBase58(),
      destination: destination.toBase58(),
      owner: owner.toBase58(),
      amount,
      decimals,
    };
  }

  // Associated Token Program — createAssociatedTokenAccount branch.
  if (instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
    // createAssociatedTokenAccount has no instruction data (or a single
    // 0-byte discriminant for the idempotent variant); the meaningful
    // info is in `keys`.
    if (instruction.keys.length < 4) return { kind: "unknown" };
    const payer = instruction.keys[0]?.pubkey;
    const associatedToken = instruction.keys[1]?.pubkey;
    const owner = instruction.keys[2]?.pubkey;
    const mint = instruction.keys[3]?.pubkey;
    if (
      !(payer instanceof PublicKey) ||
      !(associatedToken instanceof PublicKey) ||
      !(owner instanceof PublicKey) ||
      !(mint instanceof PublicKey)
    ) {
      return { kind: "unknown" };
    }
    return {
      kind: "create-ata",
      payer: payer.toBase58(),
      destinationAta: associatedToken.toBase58(),
      owner: owner.toBase58(),
      mint: mint.toBase58(),
    };
  }

  return { kind: "unknown" };
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * Consumers (`prepare_solana_spl_send.ts` Plan 12-03; `preview_send.ts`
 * Solana branch Plan 12-04) import `_solanaSpl` and call through the
 * indirection so tests can `vi.spyOn(_solanaSpl, "buildSplTransferTx")`
 * to intercept without monkey-patching the production import path. Direct
 * `vi.spyOn(module, "buildSplTransferTx")` is a silent no-op for cross-
 * export internal calls — ESM named-export bindings are immutable.
 */
export const _solanaSpl = {
  deriveAtaForOwner,
  maybeAppendCreateAtaInstruction,
  encodeSplTransferChecked,
  buildSplTransferTx,
  decodeSplCall,
};
