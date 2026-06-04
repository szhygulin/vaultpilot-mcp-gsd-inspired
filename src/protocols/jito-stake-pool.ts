// src/protocols/jito-stake-pool.ts
//
// Jito SPL-stake-pool `DepositSol` instruction hand-encoding (D-01) + tx assembly.
// Phase 15 — Plan 15-03. Sibling of `src/protocols/kamino.ts` (pinned variant tag
// + primitive borsh) with a `_jitoStakePool` ESM-indirection object (CLAUDE.md).
//
// Jito IS the SPL Stake Pool program (`getSplStakePoolProgram()`). The SPL stake
// pool uses a `buffer-layout`-style single-byte instruction-variant ENUM TAG (NOT
// Anchor 8-byte discriminators). `DepositSol` = variant tag 14 — VERIFIED at build
// against the installed `@solana/spl-stake-pool` v1.1.8 low-level
// `StakePoolInstruction.depositSol` builder (the built data's first byte == 14;
// research A1 was [ASSUMED] — now PINNED). `@solana/spl-stake-pool` is a build-time
// layout reference only — NOT a runtime dependency.
//
// DepositSol data layout: [tag: u8 = 14] ‖ [lamports: u64 LE]  (9 bytes).
// Account-meta order reproduced VERBATIM from StakePoolInstruction.depositSol
// (no-deposit-authority path, 10 accounts — the d.ts/JS IS the authoritative
// ordering; wrong order fails at simulation):
//   stakePool[W], withdrawAuthority[ro], reserveStake[W], fundingAccount[WS],
//   destinationPoolAccount[W], managerFeeAccount[W], referralPoolAccount[W],
//   poolMint[W], SystemProgram[ro], TOKEN_PROGRAM[ro]
//
// DEPOSIT-ONLY (15-03 / 15-CONTEXT): unstake is deferred per the upstream
// withdrawal-authority gap; the prepare tool emits an unmissable
// `[NOTICE — Jito stake-pool unstake not yet supported]` block on every prepare.
//
// `assembleJitoTx` builds a legacy `Transaction` and returns
// `{ messageBytes, programIds, instructionSummary }` — messageBytes flow through
// the FROZEN `computeSolanaPayloadFingerprint` UNCHANGED. `programIds` enumerates
// EVERY touched top-level program (Pitfall 5 — SPL Stake Pool + System + Token).

import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { getSplStakePoolProgram } from "../config/contracts.js";

/**
 * The SPL stake pool `DepositSol` instruction-variant tag. VERIFIED at build
 * against `@solana/spl-stake-pool` v1.1.8 `StakePoolInstruction.depositSol` — the
 * built data's first byte equals this. Pinned as the cryptographic-binding
 * constant (mirror Kamino's KAMINO_DISCRIMINATOR pinning); the protocols test
 * asserts the built DepositSol data first byte equals this literal.
 */
export const DEPOSIT_SOL_VARIANT_TAG = 14 as const;

/** Encode a u64 as 8-byte little-endian. */
function u64le(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}

/** Build the DepositSol data = [tag: u8] ‖ [lamports: u64 LE] (9 bytes). */
export function depositSolData(lamports: bigint): Buffer {
  return Buffer.concat([Buffer.from([DEPOSIT_SOL_VARIANT_TAG]), u64le(lamports)]);
}

// Account-meta helpers.
function ro(pubkey: PublicKey): { pubkey: PublicKey; isSigner: false; isWritable: false } {
  return { pubkey, isSigner: false, isWritable: false };
}
function w(pubkey: PublicKey): { pubkey: PublicKey; isSigner: false; isWritable: true } {
  return { pubkey, isSigner: false, isWritable: true };
}
function writableSigner(
  pubkey: PublicKey,
): { pubkey: PublicKey; isSigner: true; isWritable: true } {
  return { pubkey, isSigner: true, isWritable: true };
}

/**
 * Account set for `DepositSol` (no-deposit-authority path, 10 accounts ordered per
 * StakePoolInstruction.depositSol). `fundingAccount` is the user's SOL source
 * (writable signer == feePayer); `destinationPoolAccount` is the user's jitoSOL
 * destination ATA.
 */
export interface JitoDepositSolAccounts {
  stakePool: PublicKey;
  withdrawAuthority: PublicKey;
  reserveStake: PublicKey;
  /** fundingAccount — the user's SOL source (writable signer == feePayer). */
  fundingAccount: PublicKey;
  /** destinationPoolAccount — the user's jitoSOL destination token account (ATA). */
  destinationPoolAccount: PublicKey;
  managerFeeAccount: PublicKey;
  referralPoolAccount: PublicKey;
  poolMint: PublicKey;
}

/**
 * Build the SPL stake pool `DepositSol` instruction (SOL → jitoSOL). programId
 * from `getSplStakePoolProgram()` (SOT, never inlined). The account-meta order is
 * reproduced VERBATIM from the SDK builder (the d.ts/JS is authoritative).
 */
export function buildDepositSolIx(input: {
  accounts: JitoDepositSolAccounts;
  lamports: bigint;
}): TransactionInstruction {
  const a = input.accounts;
  return new TransactionInstruction({
    programId: new PublicKey(getSplStakePoolProgram()),
    data: depositSolData(input.lamports),
    keys: [
      w(a.stakePool),
      ro(a.withdrawAuthority),
      w(a.reserveStake),
      writableSigner(a.fundingAccount),
      w(a.destinationPoolAccount),
      w(a.managerFeeAccount),
      w(a.referralPoolAccount),
      w(a.poolMint),
      ro(SystemProgram.programId),
      ro(TOKEN_PROGRAM_ID),
    ],
  });
}

/**
 * Assemble a single Jito DepositSol instruction into a legacy `Transaction`
 * (feePayer + recentBlockhash) and return the canonical message bytes + program
 * IDs + a generic instruction summary. Mirrors `assembleMarginfiTx`.
 * `programIds` enumerates EVERY touched top-level program (Pitfall 5 — SPL Stake
 * Pool + System + Token, the program accounts the DepositSol ix references).
 */
export function assembleJitoTx(input: {
  instruction: TransactionInstruction;
  feePayer: PublicKey;
  recentBlockhash: string;
  ixName: string;
}): {
  transaction: Transaction;
  messageBytes: Uint8Array;
  programIds: string[];
  instructionSummary: Array<{ kind: "jito-stake-pool"; ixName: string; programId: string }>;
} {
  const tx = new Transaction({
    recentBlockhash: input.recentBlockhash,
    feePayer: input.feePayer,
  });
  tx.add(input.instruction);
  const messageBytes = new Uint8Array(tx.serializeMessage());

  const programIdSet = new Set<string>([
    input.instruction.programId.toBase58(),
    SystemProgram.programId.toBase58(),
    TOKEN_PROGRAM_ID.toBase58(),
  ]);

  return {
    transaction: tx,
    messageBytes,
    programIds: [...programIdSet],
    instructionSummary: [
      {
        kind: "jito-stake-pool",
        ixName: input.ixName,
        programId: input.instruction.programId.toBase58(),
      },
    ],
  };
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. The prepare tool (Task 2)
 * imports `_jitoStakePool` and calls through the indirection so tests can spy on
 * the build side without monkey-patching named exports (ESM bindings are immutable).
 */
export const _jitoStakePool = {
  DEPOSIT_SOL_VARIANT_TAG,
  depositSolData,
  buildDepositSolIx,
  assembleJitoTx,
};
