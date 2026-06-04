// test/protocols-jito-stake-pool.test.ts — Phase 15 Plan 15-03 build-side + pinned-tag.
//
// Covers src/protocols/jito-stake-pool.ts: the PINNED DepositSol variant tag (14,
// VERIFIED at build against @solana/spl-stake-pool), the primitive-borsh data
// layout, the authoritative account-meta order, and programIds enumeration
// (Pitfall 5). The fingerprint anchor lives in test/signing-fingerprint-solana
// .test.ts (Fixture AB).

import { describe, expect, it, vi } from "vitest";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  DEPOSIT_SOL_VARIANT_TAG,
  _jitoStakePool,
  assembleJitoTx,
  buildDepositSolIx,
  depositSolData,
} from "../src/protocols/jito-stake-pool.js";
import { getSplStakePoolProgram } from "../src/config/contracts.js";

const FROM = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const POOL = new PublicKey("Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb");
const A = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
const POOLMINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
const SPL_STAKE_POOL = getSplStakePoolProgram();
const SYSTEM = SystemProgram.programId.toBase58();
const TOKEN = TOKEN_PROGRAM_ID.toBase58();

const accounts = {
  stakePool: POOL, withdrawAuthority: A, reserveStake: A, fundingAccount: FROM,
  destinationPoolAccount: A, managerFeeAccount: A, referralPoolAccount: A, poolMint: POOLMINT,
};

describe("jito-stake-pool — PINNED DepositSol variant tag (research A1 — VERIFIED at build)", () => {
  it("DEPOSIT_SOL_VARIANT_TAG is the verified tag 14", () => {
    expect(DEPOSIT_SOL_VARIANT_TAG).toBe(14);
  });

  it("depositSolData = [14] then u64 LE lamports (9 bytes)", () => {
    const data = depositSolData(1_000n);
    expect(data.length).toBe(9);
    expect(data[0]).toBe(14);
    // 1000 = 0x03e8 → LE bytes e8 03 ... after the tag.
    expect([...data.slice(1, 3)]).toEqual([0xe8, 0x03]);
  });

  it("the built DepositSol ix data's first byte equals the pinned variant tag", () => {
    const ix = buildDepositSolIx({ accounts, lamports: 1_000_000_000n });
    expect(ix.data[0]).toBe(DEPOSIT_SOL_VARIANT_TAG);
  });
});

describe("jito-stake-pool — account-meta order + programId (authoritative from the SDK builder)", () => {
  it("targets the SPL Stake Pool program (SOT) with 10 accounts in the no-deposit-authority order", () => {
    const ix = buildDepositSolIx({ accounts, lamports: 1n });
    expect(ix.programId.toBase58()).toBe(SPL_STAKE_POOL);
    expect(ix.keys.length).toBe(10);
    // fundingAccount (index 3) is the writable signer == feePayer.
    expect(ix.keys[3]!.isSigner).toBe(true);
    expect(ix.keys[3]!.isWritable).toBe(true);
    expect(ix.keys[3]!.pubkey.toBase58()).toBe(FROM.toBase58());
    // stakePool (0) writable; withdrawAuthority (1) ro.
    expect(ix.keys[0]!.isWritable).toBe(true);
    expect(ix.keys[1]!.isWritable).toBe(false);
    // last two: System (8) + Token (9), both ro.
    expect(ix.keys[8]!.pubkey.toBase58()).toBe(SYSTEM);
    expect(ix.keys[9]!.pubkey.toBase58()).toBe(TOKEN);
  });

  it("programId equals the SOT getter (no inlined base58 in the protocol)", () => {
    const ix = buildDepositSolIx({ accounts, lamports: 1n });
    expect(ix.programId.toBase58()).toBe(getSplStakePoolProgram());
  });
});

describe("jito-stake-pool — assembleJitoTx programIds enumeration (Pitfall 5)", () => {
  it("DepositSol → programIds = {SPL Stake Pool, System, Token}", () => {
    const { programIds } = assembleJitoTx({
      instruction: buildDepositSolIx({ accounts, lamports: 1n }),
      feePayer: FROM, recentBlockhash: FIXED_BLOCKHASH, ixName: "DepositSol",
    });
    expect(new Set(programIds)).toEqual(new Set([SPL_STAKE_POOL, SYSTEM, TOKEN]));
  });
});

describe("jito-stake-pool — _jitoStakePool ESM indirection (spy-affordance)", () => {
  it("exposes the builders + assemble + the pinned tag", () => {
    expect(typeof _jitoStakePool.buildDepositSolIx).toBe("function");
    expect(typeof _jitoStakePool.depositSolData).toBe("function");
    expect(typeof _jitoStakePool.assembleJitoTx).toBe("function");
    expect(_jitoStakePool.DEPOSIT_SOL_VARIANT_TAG).toBe(14);
  });

  it("vi.spyOn intercepts a build call through the indirection", () => {
    const spy = vi.spyOn(_jitoStakePool, "depositSolData").mockReturnValue(Buffer.from([14]));
    const out = _jitoStakePool.depositSolData(1n);
    expect([...out]).toEqual([14]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
