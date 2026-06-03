// src/protocols/marginfi.ts — IDL hand-encode (D-01) builder shape tests.
// Phase 13 — Plan 13-03 Task 1.
//
// Each builder returns a native web3.js-v1 TransactionInstruction with the
// correct programId (from the SOT getter — NEVER inlined), ordered keys with
// correct [W]/[S]/[PDA] flags, and BorshInstructionCoder-encoded data (snake_case
// arg fields — VERIFIED at build time). NO live RPC — the builders are pure
// given inputs; the assemble-into-Transaction path is tested with a pinned
// blockhash. The fingerprint anchors live in test/signing-fingerprint-solana.ts
// (Fixtures O–S); this file covers the instruction structure.

import { describe, expect, it } from "vitest";
import { PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  _marginfi,
  buildDepositIx,
  buildWithdrawIx,
  buildBorrowIx,
  buildRepayIx,
  buildAccountInitPdaIx,
  assembleMarginfiTx,
} from "../src/protocols/marginfi.js";
import { getMarginfiProgramId } from "../src/config/contracts.js";

const GROUP = new PublicKey("4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8");
const AUTH = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const MF_ACCOUNT = new PublicKey("3m9y53V2QwBbrQxtv5WN4T8SA5zw7BpZ2ZBYpZZAu8MW");
const BANK = new PublicKey("CCKtUs6Cgwo4aaQUmBPmyoApH2gUDErxNZCAntD6LYGh");
const TOKEN_ACCT = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
const LIQ_VAULT = new PublicKey("7uYDwDDvFvKsHnvjt9D8gj2Gfd9Xzn4QYsf8KXrXrJsy");
const VAULT_AUTH = new PublicKey("D9z5pxYZ7tqkQ6oFwvQyZ4QyhRjuw6JtVefdT4U6kx2y");
const PROGRAM = getMarginfiProgramId();
const FIXED_BLOCKHASH = "11111111111111111111111111111111";

const singleAccts = {
  group: GROUP,
  marginfiAccount: MF_ACCOUNT,
  authority: AUTH,
  bank: BANK,
  signerTokenAccount: TOKEN_ACCT,
  liquidityVault: LIQ_VAULT,
};
const vaultAuthAccts = {
  group: GROUP,
  marginfiAccount: MF_ACCOUNT,
  authority: AUTH,
  bank: BANK,
  destinationTokenAccount: TOKEN_ACCT,
  bankLiquidityVaultAuthority: VAULT_AUTH,
  liquidityVault: LIQ_VAULT,
};

describe("buildDepositIx — lending_account_deposit (single-ix shape)", () => {
  const ix = buildDepositIx({ accounts: singleAccts, amount: 100_000_000n });

  it("programId resolves from the SOT getter (never inlined)", () => {
    expect(ix.programId.toBase58()).toBe(PROGRAM);
  });

  it("ordered keys: group[ro], marginfiAccount[W], authority[S], bank[W], signerTokenAccount[W], liquidityVault[W], tokenProgram[ro]", () => {
    const k = ix.keys;
    expect(k).toHaveLength(7);
    expect(k[0]!.pubkey.toBase58()).toBe(GROUP.toBase58());
    expect(k[0]!.isWritable).toBe(false);
    expect(k[1]!.pubkey.toBase58()).toBe(MF_ACCOUNT.toBase58());
    expect(k[1]!.isWritable).toBe(true);
    expect(k[2]!.pubkey.toBase58()).toBe(AUTH.toBase58());
    expect(k[2]!.isSigner).toBe(true);
    expect(k[3]!.pubkey.toBase58()).toBe(BANK.toBase58());
    expect(k[3]!.isWritable).toBe(true);
    expect(k[4]!.pubkey.toBase58()).toBe(TOKEN_ACCT.toBase58());
    expect(k[4]!.isWritable).toBe(true);
    expect(k[5]!.pubkey.toBase58()).toBe(LIQ_VAULT.toBase58());
    expect(k[5]!.isWritable).toBe(true);
    expect(k[6]!.pubkey.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58());
    expect(k[6]!.isWritable).toBe(false);
  });

  it("encoded data: 8-byte discriminator + u64 amount LE + option<bool> None (17 bytes)", () => {
    expect([...ix.data.slice(0, 8)]).toEqual([171, 94, 235, 103, 82, 64, 212, 140]);
    // amount = 100_000_000 = 0x05F5E100 little-endian.
    const amountLE = Buffer.from(ix.data.slice(8, 16));
    expect(amountLE.readBigUInt64LE(0)).toBe(100_000_000n);
    // deposit_up_to_limit: None → trailing 0x00 (total 17 bytes).
    expect(ix.data.length).toBe(17);
    expect(ix.data[16]).toBe(0);
  });
});

describe("buildRepayIx — lending_account_repay (single-ix shape)", () => {
  const ix = buildRepayIx({ accounts: singleAccts, amount: 75_000_000n });

  it("programId + 7 keys (same shape as deposit) + repay discriminator", () => {
    expect(ix.programId.toBase58()).toBe(PROGRAM);
    expect(ix.keys).toHaveLength(7);
    expect([...ix.data.slice(0, 8)]).toEqual([79, 209, 172, 177, 222, 51, 173, 151]);
  });
});

describe("buildWithdrawIx — lending_account_withdraw (vault-authority shape)", () => {
  const ix = buildWithdrawIx({ accounts: vaultAuthAccts, amount: 50_000_000n });

  it("carries bank_liquidity_vault_authority[PDA] at index 5 (readonly)", () => {
    expect(ix.keys).toHaveLength(8);
    expect(ix.keys[5]!.pubkey.toBase58()).toBe(VAULT_AUTH.toBase58());
    expect(ix.keys[5]!.isWritable).toBe(false);
    expect(ix.keys[5]!.isSigner).toBe(false);
    // destination_token_account at index 4; liquidity_vault at index 6.
    expect(ix.keys[4]!.pubkey.toBase58()).toBe(TOKEN_ACCT.toBase58());
    expect(ix.keys[6]!.pubkey.toBase58()).toBe(LIQ_VAULT.toBase58());
  });

  it("withdraw discriminator + u64 amount + option<bool> withdraw_all None", () => {
    expect([...ix.data.slice(0, 8)]).toEqual([36, 72, 74, 19, 210, 210, 192, 192]);
    expect(ix.data.length).toBe(17);
  });
});

describe("buildBorrowIx — lending_account_borrow (vault-authority shape)", () => {
  const ix = buildBorrowIx({ accounts: vaultAuthAccts, amount: 25_000_000n });

  it("carries bank_liquidity_vault_authority[PDA] at index 5; borrow has NO option arg (16 bytes)", () => {
    expect(ix.keys).toHaveLength(8);
    expect(ix.keys[5]!.pubkey.toBase58()).toBe(VAULT_AUTH.toBase58());
    expect([...ix.data.slice(0, 8)]).toEqual([4, 126, 116, 53, 48, 5, 212, 31]);
    // discriminator(8) + u64 amount(8) = 16, no option arg.
    expect(ix.data.length).toBe(16);
  });
});

describe("buildAccountInitPdaIx — marginfi_account_initialize_pda (Ledger-safe, Pitfall 3)", () => {
  const ix = buildAccountInitPdaIx({
    accounts: {
      marginfiGroup: GROUP,
      marginfiAccount: MF_ACCOUNT,
      authority: AUTH,
      feePayer: AUTH,
    },
    accountIndex: 0,
  });

  it("uses the _pda discriminator (NOT the Keypair-signer variant)", () => {
    expect([...ix.data.slice(0, 8)]).toEqual([87, 177, 91, 80, 218, 119, 245, 31]);
  });

  it("ordered keys: group[ro], marginfiAccount[W], authority[S], feePayer[W,S], instructionsSysvar[ro], systemProgram[ro]", () => {
    const k = ix.keys;
    expect(k).toHaveLength(6);
    expect(k[0]!.pubkey.toBase58()).toBe(GROUP.toBase58());
    expect(k[1]!.pubkey.toBase58()).toBe(MF_ACCOUNT.toBase58());
    expect(k[1]!.isWritable).toBe(true);
    expect(k[2]!.pubkey.toBase58()).toBe(AUTH.toBase58());
    expect(k[2]!.isSigner).toBe(true);
    // fee_payer is BOTH writable and signer.
    expect(k[3]!.isWritable).toBe(true);
    expect(k[3]!.isSigner).toBe(true);
    expect(k[4]!.pubkey.toBase58()).toBe(SYSVAR_INSTRUCTIONS_PUBKEY.toBase58());
    expect(k[5]!.pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
  });

  it("account_index + option<u16> third_party_id: idx0 → ...05 00 00 (u16 LE 0 + None)", () => {
    // discriminator(8) + account_index u16 LE(2) + option<u16> None(1) = 11 bytes.
    expect(ix.data.length).toBe(11);
    const idx = Buffer.from(ix.data.slice(8, 10)).readUInt16LE(0);
    expect(idx).toBe(0);
    expect(ix.data[10]).toBe(0); // third_party_id: None
  });
});

describe("assembleMarginfiTx — legacy Transaction + message bytes (no RPC)", () => {
  it("returns messageBytes + programIds(marginfi) + instructionSummary for a pinned blockhash", () => {
    const ix = buildDepositIx({ accounts: singleAccts, amount: 100_000_000n });
    const result = assembleMarginfiTx({
      instruction: ix,
      feePayer: AUTH,
      recentBlockhash: FIXED_BLOCKHASH,
      ixName: "lending_account_deposit",
    });
    expect(result.messageBytes).toBeInstanceOf(Uint8Array);
    expect(result.messageBytes.length).toBeGreaterThan(0);
    expect(result.programIds).toEqual([PROGRAM]);
    expect(result.instructionSummary[0]!.kind).toBe("marginfi");
    expect(result.instructionSummary[0]!.ixName).toBe("lending_account_deposit");
    expect(result.instructionSummary[0]!.programId).toBe(PROGRAM);
  });
});

describe("_marginfi ESM spy-affordance indirection", () => {
  it("exposes all five builders + the assemble helper through the indirection", () => {
    expect(typeof _marginfi.buildDepositIx).toBe("function");
    expect(typeof _marginfi.buildWithdrawIx).toBe("function");
    expect(typeof _marginfi.buildBorrowIx).toBe("function");
    expect(typeof _marginfi.buildRepayIx).toBe("function");
    expect(typeof _marginfi.buildAccountInitPdaIx).toBe("function");
    expect(typeof _marginfi.assembleMarginfiTx).toBe("function");
  });
});
