// test/protocols-marinade.test.ts — Phase 15 Plan 15-02 build-side assertions.
//
// Covers src/protocols/marinade.ts (BorshInstructionCoder hand-encode over the
// vendored IDL) + src/chains/solana/marinade.ts (the pure unstakeNowFeeBp
// interpolation reproduction). The cryptographic-binding fingerprint anchors live
// in test/signing-fingerprint-solana.test.ts (Fixtures I + AA). The on-chain
// fee READ (readImmediateUnstakeFee) is mocked at the Connection boundary in the
// prepare-tool test; here we exercise the PURE formula directly.

import { describe, expect, it, vi } from "vitest";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

import {
  _marinade,
  buildDepositIx,
  buildLiquidUnstakeIx,
  assembleMarinadeTx,
} from "../src/protocols/marinade.js";
import {
  computeUnstakeNowFeeBp,
  deriveSolLegPda,
  _marinadeChain,
} from "../src/chains/solana/marinade.js";
import { getMarinadeProgram } from "../src/config/contracts.js";

const FROM = new PublicKey("5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const STATE = new PublicKey("8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC");
const MSOL_MINT = new PublicKey("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So");
const A = new PublicKey("AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9");
const FIXED_BLOCKHASH = "11111111111111111111111111111111";
const MARINADE_PROGRAM = getMarinadeProgram();
const SYSTEM = SystemProgram.programId.toBase58();
const TOKEN = TOKEN_PROGRAM_ID.toBase58();

const depositAccounts = {
  state: STATE, msolMint: MSOL_MINT, liqPoolSolLegPda: A, liqPoolMsolLeg: A,
  liqPoolMsolLegAuthority: A, reservePda: A, transferFrom: FROM, mintTo: A, msolMintAuthority: A,
};
const luAccounts = {
  state: STATE, msolMint: MSOL_MINT, liqPoolSolLegPda: A, liqPoolMsolLeg: A,
  treasuryMsolAccount: A, getMsolFrom: A, getMsolFromAuthority: FROM, transferSolTo: FROM,
};

describe("marinade — hand-encode (D-01) discriminator + account vector", () => {
  it("buildDepositIx targets the Marinade program (SOT) with the deposit discriminator", () => {
    const ix = buildDepositIx({ accounts: depositAccounts, lamports: 1_000_000_000n });
    expect(ix.programId.toBase58()).toBe(MARINADE_PROGRAM);
    expect([...ix.data.slice(0, 8)]).toEqual([242, 35, 198, 137, 82, 225, 242, 182]);
    // 11 accounts ordered per the IDL (9 named + System + Token).
    expect(ix.keys.length).toBe(11);
    // transferFrom (index 6) is the writable signer == feePayer.
    expect(ix.keys[6]!.isSigner).toBe(true);
    expect(ix.keys[6]!.isWritable).toBe(true);
    expect(ix.keys[6]!.pubkey.toBase58()).toBe(FROM.toBase58());
    expect(ix.keys[9]!.pubkey.toBase58()).toBe(SYSTEM);
    expect(ix.keys[10]!.pubkey.toBase58()).toBe(TOKEN);
  });

  it("buildLiquidUnstakeIx targets the Marinade program with the liquidUnstake discriminator", () => {
    const ix = buildLiquidUnstakeIx({ accounts: luAccounts, msolAmount: 500_000_000n });
    expect(ix.programId.toBase58()).toBe(MARINADE_PROGRAM);
    expect([...ix.data.slice(0, 8)]).toEqual([30, 30, 119, 240, 191, 227, 12, 16]);
    // 10 accounts.
    expect(ix.keys.length).toBe(10);
    // getMsolFromAuthority (index 6) is the signer == feePayer.
    expect(ix.keys[6]!.isSigner).toBe(true);
    expect(ix.keys[6]!.pubkey.toBase58()).toBe(FROM.toBase58());
  });

  it("encodes the u64 amount LE after the discriminator (deposit)", () => {
    const ix = buildDepositIx({ accounts: depositAccounts, lamports: 1_000n });
    // 1000 = 0x03e8 → LE bytes e8 03 00 00 00 00 00 00 after the 8-byte disc.
    expect([...ix.data.slice(8, 16)]).toEqual([0xe8, 0x03, 0, 0, 0, 0, 0, 0]);
  });
});

describe("marinade — assembleMarinadeTx programIds enumeration (Pitfall 5)", () => {
  it("deposit → programIds = {Marinade, System, Token}", () => {
    const { programIds } = assembleMarinadeTx({
      instruction: buildDepositIx({ accounts: depositAccounts, lamports: 1n }),
      feePayer: FROM, recentBlockhash: FIXED_BLOCKHASH, ixName: "deposit",
    });
    expect(new Set(programIds)).toEqual(new Set([MARINADE_PROGRAM, SYSTEM, TOKEN]));
  });

  it("liquidUnstake → programIds = {Marinade, System, Token}", () => {
    const { programIds } = assembleMarinadeTx({
      instruction: buildLiquidUnstakeIx({ accounts: luAccounts, msolAmount: 1n }),
      feePayer: FROM, recentBlockhash: FIXED_BLOCKHASH, ixName: "liquidUnstake",
    });
    expect(new Set(programIds)).toEqual(new Set([MARINADE_PROGRAM, SYSTEM, TOKEN]));
  });

  it("the Marinade program ID equals the SOT getter (no inlined base58 in the protocol)", () => {
    const ix = buildDepositIx({ accounts: depositAccounts, lamports: 1n });
    expect(ix.programId.toBase58()).toBe(getMarinadeProgram());
  });
});

describe("marinade — variable fee interpolation (SOL-W-15, reproduces SDK unstakeNowFeeBp)", () => {
  // SDK formula: max fee when fully draining; min fee when post-balance >= target;
  // linear interpolation between, DECREASING from max toward min as the leg
  // recovers toward the target.
  const lpMinFeeBp = 30; // 0.30%
  const lpMaxFeeBp = 300; // 3.00%
  const lpLiquidityTarget = 10_000_000_000n; // 10 SOL

  it("returns lpMaxFeeBp when the unstake drains the entire available leg", () => {
    expect(computeUnstakeNowFeeBp({
      lpMinFeeBp, lpMaxFeeBp, lpLiquidityTarget,
      lamportsAvailable: 5_000_000_000n, lamportsToObtain: 5_000_000_000n,
    })).toBe(lpMaxFeeBp);
  });

  it("returns lpMinFeeBp when the post-unstake balance stays at/above the target", () => {
    expect(computeUnstakeNowFeeBp({
      lpMinFeeBp, lpMaxFeeBp, lpLiquidityTarget,
      lamportsAvailable: 20_000_000_000n, lamportsToObtain: 1_000_000_000n, // after = 19 SOL >= 10 SOL target
    })).toBe(lpMinFeeBp);
  });

  it("interpolates between min and max in the partial-drain region", () => {
    // available 10 SOL, obtain 5 SOL → after = 5 SOL; target 10 SOL.
    // delta = 270; proportional = 270 * 5/10 = 135; fee = 300 - 135 = 165.
    const fee = computeUnstakeNowFeeBp({
      lpMinFeeBp, lpMaxFeeBp, lpLiquidityTarget,
      lamportsAvailable: 10_000_000_000n, lamportsToObtain: 5_000_000_000n,
    });
    expect(fee).toBe(165);
    expect(fee).toBeGreaterThan(lpMinFeeBp);
    expect(fee).toBeLessThan(lpMaxFeeBp);
  });

  it("handles lpLiquidityTarget == 0 (proportional returns delta → fee == min)", () => {
    const fee = computeUnstakeNowFeeBp({
      lpMinFeeBp, lpMaxFeeBp, lpLiquidityTarget: 0n,
      lamportsAvailable: 10_000_000_000n, lamportsToObtain: 5_000_000_000n,
    });
    // after (5 SOL) >= target (0) → min fee (the >= target branch fires first).
    expect(fee).toBe(lpMinFeeBp);
  });

  it("deriveSolLegPda is deterministic and on-curve-shaped base58", () => {
    const a = deriveSolLegPda();
    const b = deriveSolLegPda();
    expect(a.toBase58()).toBe(b.toBase58());
    expect(a.toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});

describe("marinade — _marinade + _marinadeChain ESM indirection (spy-affordance)", () => {
  it("_marinade exposes the builders + assemble", () => {
    expect(typeof _marinade.buildDepositIx).toBe("function");
    expect(typeof _marinade.buildLiquidUnstakeIx).toBe("function");
    expect(typeof _marinade.assembleMarinadeTx).toBe("function");
  });

  it("_marinadeChain exposes the fee helpers; vi.spyOn intercepts readImmediateUnstakeFee", async () => {
    expect(typeof _marinadeChain.computeUnstakeNowFeeBp).toBe("function");
    expect(typeof _marinadeChain.readImmediateUnstakeFee).toBe("function");
    const spy = vi.spyOn(_marinadeChain, "readImmediateUnstakeFee").mockResolvedValue({
      feeBp: 99, feeLamports: 1n, lpMinFeeBp: 30, lpMaxFeeBp: 300, lpLiquidityTarget: 0n, lamportsAvailable: 0n,
    });
    const out = await _marinadeChain.readImmediateUnstakeFee(1n);
    expect(out.feeBp).toBe(99);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
