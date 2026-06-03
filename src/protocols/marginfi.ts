// src/protocols/marginfi.ts
//
// MarginFi instruction hand-encoding (D-01) + tx assembly. Phase 13 — Plan 13-03.
// Sibling of `src/protocols/solana-spl.ts` shape with a `_marginfi` ESM-
// indirection object (CLAUDE.md — internal cross-export calls route through it
// so tests can spy; added at write time, not retroactively).
//
// D-01 HAND-ENCODE (NOT the SDK make*Ix builders — those want an Anchor
// Program/provider we don't have by invariant): each `lending_account_*` /
// `marginfi_account_initialize_pda` instruction's data is built via
// `@coral-xyz/anchor`'s `BorshInstructionCoder.encode(<ixName>, args)` from the
// vendored MarginFi 0.1.8 IDL (the encoding SOT). The coder reads the IDL
// snake_case instruction names + snake_case arg field names (VERIFIED at build
// time: `deposit_up_to_limit` / `withdraw_all` / `repay_all` / `account_index` /
// `third_party_id`; a camelCase field is silently dropped → wrong bytes). The
// 8-byte discriminator the coder emits is byte-identical to the IDL-pinned
// `discriminator` array (asserted in the fixtures).
//
// The output is a native web3.js-v1 `TransactionInstruction` (programId from the
// contracts SOT — never inlined) with ordered account metas per the IDL account
// list ([W]=writable [S]=signer [PDA]). The assemble helper builds a legacy
// `Transaction` (feePayer + recentBlockhash) and returns
// `{ messageBytes, programIds, instructionSummary }` exactly like
// `solana-spl.ts buildSplTransferTx` — the messageBytes flow through the FROZEN
// `computeSolanaPayloadFingerprint` binding UNCHANGED (no binding edit).
//
// account-init uses `marginfi_account_initialize_pda` (authority-only signer,
// Ledger-safe) — NEVER `marginfi_account_initialize` (ephemeral Keypair signer,
// Ledger-incompatible — Pitfall 3 / V3/V4).

import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import BN from "bn.js";
// Vendored IDL is the encoding SOT (D-01). Copied verbatim from the installed
// `@mrgnlabs/marginfi-client-v2/dist/idl/marginfi_0.1.8.json` at 13-01 install
// time — the 0.1.8 IDL carries `marginfi_account_initialize_pda` (Q2). Vendored
// (not a deep node_modules subpath import) so the encoding SOT is stable in-repo
// and not subject to the package's subpath-export surface.
import marginfiIdl from "../config/idl/marginfi_0.1.8.json" with { type: "json" };

import { getMarginfiProgramId } from "../config/contracts.js";

/**
 * The Anchor instruction coder built from the vendored MarginFi 0.1.8 IDL.
 * Module-level (immutable after load). Hand-encode path (D-01) — NO signer,
 * NO provider.
 */
const coder = new BorshInstructionCoder(marginfiIdl as never);

/** IDL snake_case instruction names — the coder rejects camelCase variants. */
const IX = {
  deposit: "lending_account_deposit",
  withdraw: "lending_account_withdraw",
  borrow: "lending_account_borrow",
  repay: "lending_account_repay",
  initPda: "marginfi_account_initialize_pda",
} as const;

// Account-meta helpers (ordered per the IDL account list).
function ro(pubkey: PublicKey): { pubkey: PublicKey; isSigner: false; isWritable: false } {
  return { pubkey, isSigner: false, isWritable: false };
}
function w(pubkey: PublicKey): { pubkey: PublicKey; isSigner: false; isWritable: true } {
  return { pubkey, isSigner: false, isWritable: true };
}
function signer(pubkey: PublicKey): { pubkey: PublicKey; isSigner: true; isWritable: false } {
  return { pubkey, isSigner: true, isWritable: false };
}
function writableSigner(
  pubkey: PublicKey,
): { pubkey: PublicKey; isSigner: true; isWritable: true } {
  return { pubkey, isSigner: true, isWritable: true };
}

/** Common account set for the single-ix lending writes (deposit / repay). */
export interface MarginfiSingleIxAccounts {
  group: PublicKey;
  marginfiAccount: PublicKey;
  authority: PublicKey;
  bank: PublicKey;
  /** The authority's token account for the bank's mint (signer_token_account). */
  signerTokenAccount: PublicKey;
  liquidityVault: PublicKey;
}

/** Account set for withdraw / borrow (adds the bank_liquidity_vault_authority PDA + destination token account). */
export interface MarginfiVaultAuthorityIxAccounts {
  group: PublicKey;
  marginfiAccount: PublicKey;
  authority: PublicKey;
  bank: PublicKey;
  /** Where withdrawn / borrowed tokens land (destination_token_account). */
  destinationTokenAccount: PublicKey;
  /** bank_liquidity_vault_authority — the PDA owning the liquidity vault. */
  bankLiquidityVaultAuthority: PublicKey;
  liquidityVault: PublicKey;
}

/** Account set for marginfi_account_initialize_pda. */
export interface MarginfiAccountInitAccounts {
  marginfiGroup: PublicKey;
  /** The MarginfiAccount PDA being created. */
  marginfiAccount: PublicKey;
  authority: PublicKey;
  feePayer: PublicKey;
}

/**
 * Build the `lending_account_deposit` (supply) instruction. Hand-encoded data
 * (D-01): discriminator [171,94,235,103,82,64,212,140] + u64 amount + option<bool>
 * deposit_up_to_limit (None → 1 trailing 0x00 byte).
 */
export function buildDepositIx(input: {
  accounts: MarginfiSingleIxAccounts;
  amount: bigint;
}): TransactionInstruction {
  const data = coder.encode(IX.deposit, {
    amount: new BN(input.amount.toString()),
    deposit_up_to_limit: null,
  });
  const a = input.accounts;
  return new TransactionInstruction({
    programId: new PublicKey(getMarginfiProgramId()),
    data,
    keys: [
      ro(a.group),
      w(a.marginfiAccount),
      signer(a.authority),
      w(a.bank),
      w(a.signerTokenAccount),
      w(a.liquidityVault),
      ro(TOKEN_PROGRAM_ID),
    ],
  });
}

/**
 * Build the `lending_account_repay` instruction. Same account shape as deposit;
 * discriminator [79,209,172,177,222,51,173,151] + u64 amount + option<bool>
 * repay_all.
 */
export function buildRepayIx(input: {
  accounts: MarginfiSingleIxAccounts;
  amount: bigint;
}): TransactionInstruction {
  const data = coder.encode(IX.repay, {
    amount: new BN(input.amount.toString()),
    repay_all: null,
  });
  const a = input.accounts;
  return new TransactionInstruction({
    programId: new PublicKey(getMarginfiProgramId()),
    data,
    keys: [
      ro(a.group),
      w(a.marginfiAccount),
      signer(a.authority),
      w(a.bank),
      w(a.signerTokenAccount),
      w(a.liquidityVault),
      ro(TOKEN_PROGRAM_ID),
    ],
  });
}

/**
 * Build the `lending_account_withdraw` instruction. Carries the
 * bank_liquidity_vault_authority[PDA]; discriminator
 * [36,72,74,19,210,210,192,192] + u64 amount + option<bool> withdraw_all.
 */
export function buildWithdrawIx(input: {
  accounts: MarginfiVaultAuthorityIxAccounts;
  amount: bigint;
}): TransactionInstruction {
  const data = coder.encode(IX.withdraw, {
    amount: new BN(input.amount.toString()),
    withdraw_all: null,
  });
  const a = input.accounts;
  return new TransactionInstruction({
    programId: new PublicKey(getMarginfiProgramId()),
    data,
    keys: [
      ro(a.group),
      w(a.marginfiAccount),
      signer(a.authority),
      w(a.bank),
      w(a.destinationTokenAccount),
      ro(a.bankLiquidityVaultAuthority),
      w(a.liquidityVault),
      ro(TOKEN_PROGRAM_ID),
    ],
  });
}

/**
 * Build the `lending_account_borrow` instruction. Carries the
 * bank_liquidity_vault_authority[PDA]; discriminator [4,126,116,53,48,5,212,31]
 * + u64 amount (no option arg).
 */
export function buildBorrowIx(input: {
  accounts: MarginfiVaultAuthorityIxAccounts;
  amount: bigint;
}): TransactionInstruction {
  const data = coder.encode(IX.borrow, {
    amount: new BN(input.amount.toString()),
  });
  const a = input.accounts;
  return new TransactionInstruction({
    programId: new PublicKey(getMarginfiProgramId()),
    data,
    keys: [
      ro(a.group),
      w(a.marginfiAccount),
      signer(a.authority),
      w(a.bank),
      w(a.destinationTokenAccount),
      ro(a.bankLiquidityVaultAuthority),
      w(a.liquidityVault),
      ro(TOKEN_PROGRAM_ID),
    ],
  });
}

/**
 * Build the `marginfi_account_initialize_pda` instruction (Ledger-safe — NOT
 * the Keypair-signer variant, Pitfall 3). discriminator
 * [87,177,91,80,218,119,245,31] + u16 account_index + option<u16> third_party_id.
 */
export function buildAccountInitPdaIx(input: {
  accounts: MarginfiAccountInitAccounts;
  accountIndex: number;
}): TransactionInstruction {
  const data = coder.encode(IX.initPda, {
    account_index: input.accountIndex,
    third_party_id: null,
  });
  const a = input.accounts;
  return new TransactionInstruction({
    programId: new PublicKey(getMarginfiProgramId()),
    data,
    keys: [
      ro(a.marginfiGroup),
      w(a.marginfiAccount),
      signer(a.authority),
      writableSigner(a.feePayer),
      ro(SYSVAR_INSTRUCTIONS_PUBKEY),
      ro(SystemProgram.programId),
    ],
  });
}

/**
 * Assemble a single MarginFi instruction into a legacy `Transaction`
 * (feePayer + recentBlockhash) and return the canonical message bytes + program
 * IDs + a generic instruction summary. Mirrors `solana-spl.ts buildSplTransferTx`
 * — the `messageBytes` are the EXACT preimage `computeSolanaPayloadFingerprint`
 * hashes (FROZEN binding, unchanged).
 */
export function assembleMarginfiTx(input: {
  instruction: TransactionInstruction;
  feePayer: PublicKey;
  recentBlockhash: string;
  /** Human-readable ix name for the summary (e.g. "lending_account_deposit"). */
  ixName: string;
}): {
  transaction: Transaction;
  messageBytes: Uint8Array;
  programIds: string[];
  instructionSummary: Array<{ kind: "marginfi"; ixName: string; programId: string }>;
} {
  const tx = new Transaction({
    recentBlockhash: input.recentBlockhash,
    feePayer: input.feePayer,
  });
  tx.add(input.instruction);
  const messageBytes = new Uint8Array(tx.serializeMessage());
  const programIds = [input.instruction.programId.toBase58()];
  return {
    transaction: tx,
    messageBytes,
    programIds,
    instructionSummary: [
      {
        kind: "marginfi",
        ixName: input.ixName,
        programId: input.instruction.programId.toBase58(),
      },
    ],
  };
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. The prepare tools (Task 2/3)
 * import `_marginfi` and call through the indirection so tests can spy on the
 * build side without monkey-patching named exports (ESM bindings are
 * immutable).
 */
export const _marginfi = {
  buildDepositIx,
  buildRepayIx,
  buildWithdrawIx,
  buildBorrowIx,
  buildAccountInitPdaIx,
  assembleMarginfiTx,
};
