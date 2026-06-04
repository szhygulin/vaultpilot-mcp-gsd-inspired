// src/protocols/marinade.ts
//
// Marinade liquid-staking instruction hand-encoding (D-01) + tx assembly.
// Phase 15 — Plan 15-02. Sibling of `src/protocols/marginfi.ts` shape with a
// `_marinade` ESM-indirection object (CLAUDE.md — internal cross-export calls
// route through it so tests can spy).
//
// D-01 HAND-ENCODE via `@coral-xyz/anchor` `BorshInstructionCoder` over the
// VENDORED Marinade IDL (`src/config/idl/marinade_finance_v0.json`). The IDL is a
// build-time encoding SOT — NOT a runtime dependency
// (`@marinade.finance/marinade-ts-sdk` is NEVER added to package.json
// dependencies; the IDL JSON was vendored verbatim from its v5.0.18 IDL and
// converted to the Anchor 0.30 IDL format the project's coder requires, with the
// VERIFIED discriminators pinned).
//
// IDL casing (research § Pitfall 4 / A2): the coder reads the IDL's EXACT
// camelCase instruction + arg names — `deposit(lamports)` / `liquidUnstake(
// msolAmount)`. A snake_case `msol_amount` is silently DROPPED → wrong bytes;
// asserted at build in test/protocols-marinade.test.ts + the casing fixture.
//
// Verified discriminators (from the SDK 0.28 coder, pinned in the vendored IDL):
//   deposit       = [242,35,198,137,82,225,242,182]
//   liquidUnstake = [30,30,119,240,191,227,12,16]
//
// The output is a native web3.js-v1 `TransactionInstruction` (programId from the
// contracts SOT — never inlined) with ordered account metas per the IDL account
// list. `assembleMarinadeTx` builds a legacy `Transaction` and returns
// `{ messageBytes, programIds, instructionSummary }` — the messageBytes flow
// through the FROZEN `computeSolanaPayloadFingerprint` binding UNCHANGED.
// `programIds` enumerates EVERY touched top-level program (Pitfall 5 — Marinade
// deposit/liquidUnstake top-level program is the Marinade program; the System +
// Token CPIs are inner, but the account-meta vector lists System + Token program
// accounts which are enumerated from the built ix).

import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import BN from "bn.js";
// Vendored IDL is the encoding SOT (D-01). Build-time reference only — the
// Marinade SDK is NOT a runtime dependency.
import marinadeIdl from "../config/idl/marinade_finance_v0.json" with { type: "json" };

import { getMarinadeProgram } from "../config/contracts.js";

/**
 * The Anchor instruction coder built from the vendored Marinade IDL. Module-level
 * (immutable after load). Hand-encode path (D-01) — NO signer, NO provider.
 */
const coder = new BorshInstructionCoder(marinadeIdl as never);

/** IDL camelCase instruction names — the coder rejects mis-cased variants. */
const IX = {
  deposit: "deposit",
  liquidUnstake: "liquidUnstake",
} as const;

// Account-meta helpers (ordered per the IDL account list).
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
function signer(pubkey: PublicKey): { pubkey: PublicKey; isSigner: true; isWritable: false } {
  return { pubkey, isSigner: true, isWritable: false };
}

/**
 * Account set for `deposit` (11 accounts, ordered per the IDL deposit accounts
 * list). `transferFrom` is the user's SOL source (writable signer = feePayer);
 * `mintTo` is the user's mSOL destination ATA. Flags reproduce the IDL
 * isMut/isSigner exactly (VERIFIED at build).
 */
export interface MarinadeDepositAccounts {
  state: PublicKey;
  msolMint: PublicKey;
  liqPoolSolLegPda: PublicKey;
  liqPoolMsolLeg: PublicKey;
  liqPoolMsolLegAuthority: PublicKey;
  reservePda: PublicKey;
  /** transferFrom — the user's SOL source (writable signer == feePayer). */
  transferFrom: PublicKey;
  /** mintTo — the user's mSOL destination token account (ATA). */
  mintTo: PublicKey;
  msolMintAuthority: PublicKey;
}

/**
 * Account set for `liquidUnstake` (10 accounts, ordered per the IDL). `getMsolFrom`
 * is the user's mSOL source ATA (writable); `getMsolFromAuthority` is the owner
 * (signer == feePayer); `transferSolTo` is the user's SOL destination (writable).
 */
export interface MarinadeLiquidUnstakeAccounts {
  state: PublicKey;
  msolMint: PublicKey;
  liqPoolSolLegPda: PublicKey;
  liqPoolMsolLeg: PublicKey;
  treasuryMsolAccount: PublicKey;
  /** getMsolFrom — the user's mSOL source token account (ATA). */
  getMsolFrom: PublicKey;
  /** getMsolFromAuthority — the owner of getMsolFrom (signer == feePayer). */
  getMsolFromAuthority: PublicKey;
  /** transferSolTo — the user's SOL destination (writable == feePayer). */
  transferSolTo: PublicKey;
}

/**
 * Build the `deposit` instruction (SOL → mSOL). Hand-encoded data (D-01):
 * discriminator [242,35,198,137,82,225,242,182] + u64 lamports. camelCase arg
 * name `lamports` (A2). 11 accounts ordered per the IDL; the last two
 * (systemProgram, tokenProgram) are appended.
 */
export function buildDepositIx(input: {
  accounts: MarinadeDepositAccounts;
  lamports: bigint;
}): TransactionInstruction {
  const data = coder.encode(IX.deposit, { lamports: new BN(input.lamports.toString()) });
  const a = input.accounts;
  return new TransactionInstruction({
    programId: new PublicKey(getMarinadeProgram()),
    data,
    keys: [
      w(a.state),
      w(a.msolMint),
      w(a.liqPoolSolLegPda),
      w(a.liqPoolMsolLeg),
      ro(a.liqPoolMsolLegAuthority),
      w(a.reservePda),
      writableSigner(a.transferFrom),
      w(a.mintTo),
      ro(a.msolMintAuthority),
      ro(SystemProgram.programId),
      ro(TOKEN_PROGRAM_ID),
    ],
  });
}

/**
 * Build the `liquidUnstake` instruction (mSOL → SOL now, incurs the variable
 * fee). Hand-encoded data (D-01): discriminator [30,30,119,240,191,227,12,16] +
 * u64 msolAmount. camelCase arg name `msolAmount` (A2). 10 accounts ordered per
 * the IDL.
 */
export function buildLiquidUnstakeIx(input: {
  accounts: MarinadeLiquidUnstakeAccounts;
  msolAmount: bigint;
}): TransactionInstruction {
  const data = coder.encode(IX.liquidUnstake, {
    msolAmount: new BN(input.msolAmount.toString()),
  });
  const a = input.accounts;
  return new TransactionInstruction({
    programId: new PublicKey(getMarinadeProgram()),
    data,
    keys: [
      w(a.state),
      w(a.msolMint),
      w(a.liqPoolSolLegPda),
      w(a.liqPoolMsolLeg),
      w(a.treasuryMsolAccount),
      w(a.getMsolFrom),
      signer(a.getMsolFromAuthority),
      w(a.transferSolTo),
      ro(SystemProgram.programId),
      ro(TOKEN_PROGRAM_ID),
    ],
  });
}

/**
 * Assemble a single Marinade instruction into a legacy `Transaction` (feePayer +
 * recentBlockhash) and return the canonical message bytes + program IDs + a
 * generic instruction summary. Mirrors `assembleMarginfiTx`. `programIds`
 * enumerates EVERY touched top-level program from the built ix vector (Pitfall 5)
 * — for Marinade that is the union of the ix `programId` (Marinade) and the
 * appended top-level program accounts (System + Token) the ix references.
 */
export function assembleMarinadeTx(input: {
  instruction: TransactionInstruction;
  feePayer: PublicKey;
  recentBlockhash: string;
  ixName: string;
}): {
  transaction: Transaction;
  messageBytes: Uint8Array;
  programIds: string[];
  instructionSummary: Array<{ kind: "marinade"; ixName: string; programId: string }>;
} {
  const tx = new Transaction({
    recentBlockhash: input.recentBlockhash,
    feePayer: input.feePayer,
  });
  tx.add(input.instruction);
  const messageBytes = new Uint8Array(tx.serializeMessage());

  // Enumerate touched top-level programs: the ix program + System + Token (the
  // CPI targets whose program accounts are listed in the meta vector). Pitfall 5.
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
        kind: "marinade",
        ixName: input.ixName,
        programId: input.instruction.programId.toBase58(),
      },
    ],
  };
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. The prepare tools (Task 2)
 * import `_marinade` and call through the indirection so tests can spy on the
 * build side without monkey-patching named exports (ESM bindings are immutable).
 */
export const _marinade = {
  buildDepositIx,
  buildLiquidUnstakeIx,
  assembleMarinadeTx,
};
