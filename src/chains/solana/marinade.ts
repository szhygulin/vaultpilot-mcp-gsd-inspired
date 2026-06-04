// src/chains/solana/marinade.ts
//
// Marinade on-chain fee read (Phase 15 — Plan 15-02, SOL-W-15). The
// immediate-unstake fee is VARIABLE — it depends on how far the unstake drains
// the liquidity-pool SOL leg below `lpLiquidityTarget`. We REPRODUCE the SDK's
// `unstakeNowFeeBp` linear interpolation (research § Don't-Hand-Roll — reproduce,
// don't invent) against the on-chain `LiqPool` state read at quote time.
//
// `@marinade.finance/marinade-ts-sdk` is NOT a runtime dependency — the State
// account is decoded via `@coral-xyz/anchor` `BorshAccountsCoder` over a vendored
// account-decode IDL (`src/config/idl/marinade_state_decode_v0.json`), and the
// interpolation is the pure exported `computeUnstakeNowFeeBp` (unit-tested).
//
// `_solanaRegistry.getConnection()` is the test seam — the State-account read +
// the solLeg-balance read are mocked at the Connection boundary in tests (NO live
// RPC; @solana/web3.js sockets hang ~25min).

import { PublicKey } from "@solana/web3.js";
import { BorshAccountsCoder } from "@coral-xyz/anchor";
import BN from "bn.js";

import marinadeStateIdl from "../../config/idl/marinade_state_decode_v0.json" with { type: "json" };
import { getMarinadeProgram, getMarinadeState } from "../../config/contracts.js";
import { _solanaRegistry } from "./registry.js";

const accountsCoder = new BorshAccountsCoder(marinadeStateIdl as never);

/** The decoded LiqPool fee inputs (basis points + liquidity target). */
export interface LiqPoolFeeInputs {
  /** lpMinFee in basis points (reached when the pool stays at/above target). */
  lpMinFeeBp: number;
  /** lpMaxFee in basis points (reached when the unstake fully drains the leg). */
  lpMaxFeeBp: number;
  /** lpLiquidityTarget in lamports. */
  lpLiquidityTarget: bigint;
}

/** The variable immediate-unstake fee quote surfaced VERBATIM in CHECKS PERFORMED. */
export interface ImmediateUnstakeFeeQuote {
  /** Interpolated fee in basis points (lpMinFeeBp..lpMaxFeeBp). */
  feeBp: number;
  /** Fee in lamports applied to `lamportsToObtain` (= lamports * feeBp / 10000). */
  feeLamports: bigint;
  /** The inputs surfaced verbatim so the agent cannot understate the fee. */
  lpMinFeeBp: number;
  lpMaxFeeBp: number;
  lpLiquidityTarget: bigint;
  /** The available SOL-leg balance (minus rent) the interpolation was over. */
  lamportsAvailable: bigint;
}

/**
 * Pure reproduction of the SDK `StateHelper.unstakeNowFeeBp` linear
 * interpolation (VERIFIED byte-for-byte against
 * `@marinade.finance/marinade-ts-sdk` v5.0.18 `util/state-helpers.js`):
 *
 *   if lamportsToObtain >= lamportsAvailable  → lpMaxFeeBp
 *   lamportsAfter = lamportsAvailable - lamportsToObtain
 *   if lamportsAfter >= lpLiquidityTarget     → lpMinFeeBp
 *   else  delta = lpMaxFeeBp - lpMinFeeBp
 *         return lpMaxFeeBp - proportional(delta, lamportsAfter, lpLiquidityTarget)
 *   where proportional(a, n, d) = (a * n) / d   (integer division; a if d == 0)
 *
 * The fee DECREASES from lpMaxFeeBp toward lpMinFeeBp as the post-unstake leg
 * balance approaches the liquidity target — i.e. a larger drain costs more.
 */
export function computeUnstakeNowFeeBp(input: {
  lpMinFeeBp: number;
  lpMaxFeeBp: number;
  lpLiquidityTarget: bigint;
  lamportsAvailable: bigint;
  lamportsToObtain: bigint;
}): number {
  const { lpMinFeeBp, lpMaxFeeBp, lpLiquidityTarget, lamportsAvailable, lamportsToObtain } = input;
  if (lamportsToObtain >= lamportsAvailable) return lpMaxFeeBp;
  const lamportsAfter = lamportsAvailable - lamportsToObtain;
  if (lamportsAfter >= lpLiquidityTarget) return lpMinFeeBp;
  const delta = lpMaxFeeBp - lpMinFeeBp;
  const proportional = lpLiquidityTarget === 0n
    ? BigInt(delta)
    : (BigInt(delta) * lamportsAfter) / lpLiquidityTarget;
  return lpMaxFeeBp - Number(proportional);
}

/**
 * Derive the Marinade liquidity-pool SOL leg PDA: findProgramAddress(
 * [marinadeState, "liq_sol"], marinadeProgram). VERIFIED against the SDK's
 * `findProgramDerivedAddress("liq_sol")`.
 */
export function deriveSolLegPda(): PublicKey {
  const program = new PublicKey(getMarinadeProgram());
  const state = new PublicKey(getMarinadeState());
  const [pda] = PublicKey.findProgramAddressSync(
    [state.toBuffer(), Buffer.from("liq_sol")],
    program,
  );
  return pda;
}

/** The State-stored Marinade accounts not derivable as PDAs. */
export interface MarinadeStateAccounts {
  /** liqPool.msolMint — the mSOL mint. */
  msolMint: PublicKey;
  /** liqPool.msolLeg — the liquidity-pool mSOL leg token account. */
  liqPoolMsolLeg: PublicKey;
  /** state.treasuryMsolAccount — treasury mSOL fee destination (liquidUnstake). */
  treasuryMsolAccount: PublicKey;
}

type DecodedState = {
  msolMint: PublicKey;
  treasuryMsolAccount: PublicKey;
  liqPool: {
    msolLeg: PublicKey;
    lpLiquidityTarget: BN;
    lpMaxFee: { basisPoints: number };
    lpMinFee: { basisPoints: number };
  };
};

/**
 * Decode the LiqPool fee inputs from the raw Marinade State account data via the
 * vendored account-decode IDL. The State account is the SOT
 * (`getMarinadeState()`).
 */
export function decodeLiqPoolFeeInputs(stateData: Buffer): LiqPoolFeeInputs {
  const decoded = accountsCoder.decode("State", stateData) as DecodedState;
  return {
    lpMinFeeBp: decoded.liqPool.lpMinFee.basisPoints,
    lpMaxFeeBp: decoded.liqPool.lpMaxFee.basisPoints,
    lpLiquidityTarget: BigInt(decoded.liqPool.lpLiquidityTarget.toString()),
  };
}

/** Decode the State-stored Marinade accounts (msolMint / msolLeg / treasury). */
export function decodeStateAccounts(stateData: Buffer): MarinadeStateAccounts {
  const decoded = accountsCoder.decode("State", stateData) as DecodedState;
  return {
    msolMint: new PublicKey(decoded.msolMint),
    liqPoolMsolLeg: new PublicKey(decoded.liqPool.msolLeg),
    treasuryMsolAccount: new PublicKey(decoded.treasuryMsolAccount),
  };
}

/** Derive a Marinade liqPool PDA: findProgramAddress([state, seed], program). */
function marinadePda(seed: string): PublicKey {
  const program = new PublicKey(getMarinadeProgram());
  const state = new PublicKey(getMarinadeState());
  const [pda] = PublicKey.findProgramAddressSync([state.toBuffer(), Buffer.from(seed)], program);
  return pda;
}

/** The fully-resolved Marinade account set for deposit + liquidUnstake. */
export interface ResolvedMarinadeAccounts {
  state: PublicKey;
  msolMint: PublicKey;
  liqPoolSolLegPda: PublicKey;
  liqPoolMsolLeg: PublicKey;
  liqPoolMsolLegAuthority: PublicKey;
  reservePda: PublicKey;
  msolMintAuthority: PublicKey;
  treasuryMsolAccount: PublicKey;
}

/**
 * Resolve the full Marinade account set from on-chain State + deterministic PDAs.
 * Reads the State account ONCE (mocked at the Connection boundary in tests).
 * The deterministic PDAs (liq_sol / liq_st_sol_authority / reserve / st_mint)
 * are reproduced from the SDK seed constants (VERIFIED at build).
 */
export async function resolveMarinadeAccounts(): Promise<ResolvedMarinadeAccounts> {
  const connection = _solanaRegistry.getConnection();
  const stateAddr = new PublicKey(getMarinadeState());
  const acct = await connection.getAccountInfo(stateAddr);
  if (!acct) {
    throw new Error(`Marinade state account ${stateAddr.toBase58()} not found on-chain`);
  }
  const stored = decodeStateAccounts(Buffer.from(acct.data));
  return {
    state: stateAddr,
    msolMint: stored.msolMint,
    liqPoolSolLegPda: marinadePda("liq_sol"),
    liqPoolMsolLeg: stored.liqPoolMsolLeg,
    liqPoolMsolLegAuthority: marinadePda("liq_st_sol_authority"),
    reservePda: marinadePda("reserve"),
    msolMintAuthority: marinadePda("st_mint"),
    treasuryMsolAccount: stored.treasuryMsolAccount,
  };
}

/**
 * Read the VARIABLE immediate-unstake fee from on-chain LiqPool state at quote
 * time (SOL-W-15). Reads the State account (LiqPool fee inputs) + the SOL-leg
 * balance, reproduces the SDK interpolation, and returns the fee + inputs to
 * surface VERBATIM in CHECKS PERFORMED.
 *
 * `lamportsToObtain` is the SOL the user receives for the unstake (the
 * liquidUnstake amount in SOL-equivalent — the caller passes the mSOL amount in
 * lamports; for the fee bound the mSOL amount is used directly as the obtain
 * proxy, mirroring the SDK which interpolates over the requested lamports).
 *
 * Mocked at the Connection boundary in tests (NO live RPC). `rentExemptForTokenAcc`
 * defaults to 0 — the available balance is the raw SOL-leg balance minus the
 * caller-supplied rent reserve.
 */
export async function readImmediateUnstakeFee(
  lamportsToObtain: bigint,
  rentReserveLamports: bigint = 0n,
): Promise<ImmediateUnstakeFeeQuote> {
  const connection = _solanaRegistry.getConnection();
  const stateAddr = new PublicKey(getMarinadeState());
  const acct = await connection.getAccountInfo(stateAddr);
  if (!acct) {
    throw new Error(`Marinade state account ${stateAddr.toBase58()} not found on-chain`);
  }
  const inputs = decodeLiqPoolFeeInputs(Buffer.from(acct.data));

  const solLeg = deriveSolLegPda();
  const solLegBalance = await connection.getBalance(solLeg);
  const lamportsAvailableRaw = BigInt(solLegBalance) - rentReserveLamports;
  const lamportsAvailable = lamportsAvailableRaw > 0n ? lamportsAvailableRaw : 0n;

  const feeBp = computeUnstakeNowFeeBp({
    lpMinFeeBp: inputs.lpMinFeeBp,
    lpMaxFeeBp: inputs.lpMaxFeeBp,
    lpLiquidityTarget: inputs.lpLiquidityTarget,
    lamportsAvailable,
    lamportsToObtain,
  });
  const feeLamports = (lamportsToObtain * BigInt(feeBp)) / 10_000n;

  return {
    feeBp,
    feeLamports,
    lpMinFeeBp: inputs.lpMinFeeBp,
    lpMaxFeeBp: inputs.lpMaxFeeBp,
    lpLiquidityTarget: inputs.lpLiquidityTarget,
    lamportsAvailable,
  };
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. The prepare tool imports
 * `_marinadeChain` and calls through the indirection so tests can spy on the fee
 * read without monkey-patching the named export (ESM bindings are immutable).
 */
export const _marinadeChain = {
  computeUnstakeNowFeeBp,
  deriveSolLegPda,
  decodeLiqPoolFeeInputs,
  decodeStateAccounts,
  resolveMarinadeAccounts,
  readImmediateUnstakeFee,
};
