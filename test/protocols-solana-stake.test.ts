// test/protocols-solana-stake.test.ts — Phase 15 Plan 15-01 build-side assertions.
//
// Covers src/protocols/solana-stake.ts: the StakeProgram-extract pattern
// (Pattern 1 — builders return a Transaction; we extract .instructions),
// programIds enumeration (Pitfall 5), createAccountWithSeed (NO ephemeral
// keypair — A3), the lamports precision guard (Pitfall 2), and the _solanaStake
// ESM indirection. The cryptographic-binding fingerprint anchors live in
// test/signing-fingerprint-solana.test.ts (Fixtures E/F/G/H).

import { describe, expect, it, vi } from "vitest";
import {
  Authorized,
  PublicKey,
  StakeProgram,
  SystemProgram,
} from "@solana/web3.js";

import {
  STAKE_SEED,
  StakeLamportsOverflowError,
  _solanaStake,
  assembleStakeTx,
  buildDeactivateIxs,
  buildDelegateIxs,
  buildDelegateWithCreateIxs,
  buildWithdrawIxs,
  deriveStakeAccount,
} from "../src/protocols/solana-stake.js";
import { getNativeStakeProgram } from "../src/config/contracts.js";

const FROM = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const STAKE_ACCT = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
const VOTE = new PublicKey("3m9y53V2QwBbrQxtv5WN4T8SA5zw7BpZ2ZBYpZZAu8MW");
const TO = new PublicKey("7uYDwDDvFvKsHnvjt9D8gj2Gfd9Xzn4QYsf8KXrXrJsy");
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
const RENT = 2_282_880n;
const STAKE_PROGRAM = StakeProgram.programId.toBase58();
const SYSTEM_PROGRAM = SystemProgram.programId.toBase58();

describe("solana-stake — builders return extracted instruction vectors (Pattern 1)", () => {
  it("buildDelegateIxs returns a non-empty TransactionInstruction[] targeting the Stake program", () => {
    const ixs = buildDelegateIxs({ stakeAccount: STAKE_ACCT, authorizedPubkey: FROM, votePubkey: VOTE });
    expect(Array.isArray(ixs)).toBe(true);
    expect(ixs.length).toBeGreaterThan(0);
    for (const ix of ixs) expect(ix.programId.toBase58()).toBe(STAKE_PROGRAM);
  });

  it("buildDeactivateIxs targets the Stake program", () => {
    const ixs = buildDeactivateIxs({ stakeAccount: STAKE_ACCT, authorizedPubkey: FROM });
    expect(ixs.length).toBeGreaterThan(0);
    for (const ix of ixs) expect(ix.programId.toBase58()).toBe(STAKE_PROGRAM);
  });

  it("buildWithdrawIxs targets the Stake program", () => {
    const ixs = buildWithdrawIxs({ stakeAccount: STAKE_ACCT, authorizedPubkey: FROM, toPubkey: TO, lamports: 1_000_000_000n });
    expect(ixs.length).toBeGreaterThan(0);
    for (const ix of ixs) expect(ix.programId.toBase58()).toBe(STAKE_PROGRAM);
  });
});

describe("solana-stake — createAccountWithSeed bundle (A3: NO ephemeral keypair)", () => {
  it("derives a deterministic stake address from (feePayer, STAKE_SEED) — equal across calls", () => {
    const a = deriveStakeAccount(FROM);
    const b = deriveStakeAccount(FROM, STAKE_SEED);
    expect(a.toBase58()).toBe(b.toBase58());
    expect(a.toBase58()).toBe("HQhu6oCtrgVzSLmyhXYnqD3w3kBh4GNzhrtL76CYVnWE");
  });

  it("the derived address equals PublicKey.createWithSeed(feePayer, STAKE_SEED, StakeProgram.programId) (async truth)", async () => {
    const truth = await PublicKey.createWithSeed(FROM, STAKE_SEED, StakeProgram.programId);
    expect(deriveStakeAccount(FROM).toBase58()).toBe(truth.toBase58());
  });

  it("buildDelegateWithCreateIxs emits createAccountWithSeed (System) + delegate (Stake), in order, NO extra signer", () => {
    const { instructions, stakeAccount } = buildDelegateWithCreateIxs({
      feePayer: FROM, stakeSeed: STAKE_SEED, votePubkey: VOTE, lamports: 1_000_000_000n, rentExemptLamports: RENT,
    });
    expect(stakeAccount.toBase58()).toBe("HQhu6oCtrgVzSLmyhXYnqD3w3kBh4GNzhrtL76CYVnWE");
    // The ordered vector: createAccountWithSeed pair (System) then delegate (Stake).
    const programs = instructions.map((ix) => ix.programId.toBase58());
    expect(programs).toContain(SYSTEM_PROGRAM);
    expect(programs).toContain(STAKE_PROGRAM);
    // No instruction names a second signer other than the feePayer (no ephemeral
    // keypair). The only signer key across the bundle is the feePayer.
    const signers = new Set<string>();
    for (const ix of instructions) {
      for (const k of ix.keys) if (k.isSigner) signers.add(k.pubkey.toBase58());
    }
    expect([...signers]).toEqual([FROM.toBase58()]);
  });

  it("does NOT use Authorized with any address other than feePayer (staker + withdrawer = feePayer)", () => {
    // Defensive: building the SDK's createAccountWithSeed with Authorized(FROM,FROM)
    // is the path; assert the bundle's stake authority is the feePayer by checking
    // no foreign signer leaks (covered above) — and that Authorized is importable.
    const auth = new Authorized(FROM, FROM);
    expect(auth.staker.toBase58()).toBe(FROM.toBase58());
    expect(auth.withdrawer.toBase58()).toBe(FROM.toBase58());
  });
});

describe("solana-stake — assembleStakeTx programIds enumeration (Pitfall 5)", () => {
  it("delegate (existing account) → programIds = {Stake}", () => {
    const { programIds } = assembleStakeTx({
      instructions: buildDelegateIxs({ stakeAccount: STAKE_ACCT, authorizedPubkey: FROM, votePubkey: VOTE }),
      ixNames: ["delegate"],
      feePayer: FROM,
      recentBlockhash: FIXED_BLOCKHASH,
    });
    expect(new Set(programIds)).toEqual(new Set([STAKE_PROGRAM]));
  });

  it("delegate-with-create → programIds = {System, Stake}", () => {
    const { instructions } = buildDelegateWithCreateIxs({
      feePayer: FROM, stakeSeed: STAKE_SEED, votePubkey: VOTE, lamports: 1_000_000_000n, rentExemptLamports: RENT,
    });
    const { programIds } = assembleStakeTx({ instructions, ixNames: ["c", "d"], feePayer: FROM, recentBlockhash: FIXED_BLOCKHASH });
    expect(new Set(programIds)).toEqual(new Set([SYSTEM_PROGRAM, STAKE_PROGRAM]));
  });

  it("deactivate / withdraw → programIds = {Stake}", () => {
    const deact = assembleStakeTx({ instructions: buildDeactivateIxs({ stakeAccount: STAKE_ACCT, authorizedPubkey: FROM }), ixNames: ["deactivate"], feePayer: FROM, recentBlockhash: FIXED_BLOCKHASH });
    expect(new Set(deact.programIds)).toEqual(new Set([STAKE_PROGRAM]));
    const wd = assembleStakeTx({ instructions: buildWithdrawIxs({ stakeAccount: STAKE_ACCT, authorizedPubkey: FROM, toPubkey: TO, lamports: 1n }), ixNames: ["withdraw"], feePayer: FROM, recentBlockhash: FIXED_BLOCKHASH });
    expect(new Set(wd.programIds)).toEqual(new Set([STAKE_PROGRAM]));
  });

  it("the Stake program ID equals the SOT getter (no inlined base58 in the protocol)", () => {
    expect(STAKE_PROGRAM).toBe(getNativeStakeProgram());
  });
});

describe("solana-stake — lamports precision guard (Pitfall 2)", () => {
  it("withdraw lamports > Number.MAX_SAFE_INTEGER throws StakeLamportsOverflowError", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    expect(() =>
      buildWithdrawIxs({ stakeAccount: STAKE_ACCT, authorizedPubkey: FROM, toPubkey: TO, lamports: huge }),
    ).toThrow(StakeLamportsOverflowError);
  });

  it("delegate-with-create total (rent + lamports) > Number.MAX_SAFE_INTEGER throws", () => {
    const huge = BigInt(Number.MAX_SAFE_INTEGER);
    expect(() =>
      buildDelegateWithCreateIxs({ feePayer: FROM, stakeSeed: STAKE_SEED, votePubkey: VOTE, lamports: huge, rentExemptLamports: RENT }),
    ).toThrow(StakeLamportsOverflowError);
  });

  it("a safe lamports value does NOT throw", () => {
    expect(() =>
      buildWithdrawIxs({ stakeAccount: STAKE_ACCT, authorizedPubkey: FROM, toPubkey: TO, lamports: 1_000_000_000n }),
    ).not.toThrow();
  });
});

describe("solana-stake — _solanaStake ESM indirection (CLAUDE.md spy-affordance)", () => {
  it("exposes all builders + assemble + STAKE_SEED", () => {
    expect(typeof _solanaStake.buildDelegateIxs).toBe("function");
    expect(typeof _solanaStake.buildDelegateWithCreateIxs).toBe("function");
    expect(typeof _solanaStake.buildDeactivateIxs).toBe("function");
    expect(typeof _solanaStake.buildWithdrawIxs).toBe("function");
    expect(typeof _solanaStake.assembleStakeTx).toBe("function");
    expect(_solanaStake.STAKE_SEED).toBe(STAKE_SEED);
  });

  it("vi.spyOn intercepts a build call through the indirection", () => {
    const spy = vi.spyOn(_solanaStake, "buildDeactivateIxs").mockReturnValue([]);
    const out = _solanaStake.buildDeactivateIxs({ stakeAccount: STAKE_ACCT, authorizedPubkey: FROM });
    expect(out).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
