// src/chains/solana/jito-stake-pool.ts
//
// Jito stake-pool account resolver (Phase 15 — Plan 15-03). Reads the on-chain
// Jito StakePool account + derives the withdraw-authority PDA so
// prepare_jito_stake_pool_deposit can build a valid DepositSol ix without an
// ephemeral keypair (fundingAccount == feePayer; Ledger-signable).
//
// `@solana/spl-stake-pool` is NOT a runtime dependency — the StakePool account is
// decoded via FIXED byte offsets reproduced from the SDK's `StakePoolLayout`
// (VERIFIED at build): reserveStake @130, poolMint @162, managerFeeAccount @194
// (each a 32-byte pubkey). The withdraw-authority PDA seed
// (`[stakePool, "withdraw"]`) is reproduced from the SDK's
// `findWithdrawAuthorityProgramAddress` (VERIFIED at build).
//
// `_solanaRegistry.getConnection()` is the test seam — the StakePool account read
// is mocked at the Connection boundary in tests (NO live RPC).

import { PublicKey } from "@solana/web3.js";

import { getJitoStakePool, getSplStakePoolProgram } from "../../config/contracts.js";
import { _solanaRegistry } from "./registry.js";

// Fixed byte offsets into the SPL StakePool account data (reproduced from
// @solana/spl-stake-pool StakePoolLayout — VERIFIED at build).
const OFFSET_RESERVE_STAKE = 130;
const OFFSET_POOL_MINT = 162;
const OFFSET_MANAGER_FEE_ACCOUNT = 194;

/** The fields decoded from the Jito StakePool account needed for DepositSol. */
export interface JitoStakePoolFields {
  reserveStake: PublicKey;
  poolMint: PublicKey;
  managerFeeAccount: PublicKey;
}

/** Read a 32-byte pubkey at `offset` from the StakePool account data. */
function pubkeyAt(data: Buffer, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

/** Decode the DepositSol-relevant fields from raw Jito StakePool account data. */
export function decodeJitoStakePoolFields(data: Buffer): JitoStakePoolFields {
  return {
    reserveStake: pubkeyAt(data, OFFSET_RESERVE_STAKE),
    poolMint: pubkeyAt(data, OFFSET_POOL_MINT),
    managerFeeAccount: pubkeyAt(data, OFFSET_MANAGER_FEE_ACCOUNT),
  };
}

/**
 * Derive the Jito stake-pool withdraw-authority PDA:
 * findProgramAddress([stakePool, "withdraw"], splStakePoolProgram). VERIFIED
 * against the SDK's findWithdrawAuthorityProgramAddress.
 */
export function deriveWithdrawAuthority(): PublicKey {
  const program = new PublicKey(getSplStakePoolProgram());
  const pool = new PublicKey(getJitoStakePool());
  const [pda] = PublicKey.findProgramAddressSync(
    [pool.toBuffer(), Buffer.from("withdraw")],
    program,
  );
  return pda;
}

/** The fully-resolved Jito DepositSol pool-internal account set. */
export interface ResolvedJitoAccounts {
  stakePool: PublicKey;
  withdrawAuthority: PublicKey;
  reserveStake: PublicKey;
  managerFeeAccount: PublicKey;
  poolMint: PublicKey;
}

/**
 * Resolve the Jito DepositSol pool-internal accounts from on-chain StakePool data
 * + the deterministic withdraw-authority PDA. Reads the StakePool account ONCE
 * (mocked at the Connection boundary in tests).
 */
export async function resolveJitoAccounts(): Promise<ResolvedJitoAccounts> {
  const connection = _solanaRegistry.getConnection();
  const poolAddr = new PublicKey(getJitoStakePool());
  const acct = await connection.getAccountInfo(poolAddr);
  if (!acct) {
    throw new Error(`Jito stake-pool account ${poolAddr.toBase58()} not found on-chain`);
  }
  const fields = decodeJitoStakePoolFields(Buffer.from(acct.data));
  return {
    stakePool: poolAddr,
    withdrawAuthority: deriveWithdrawAuthority(),
    reserveStake: fields.reserveStake,
    managerFeeAccount: fields.managerFeeAccount,
    poolMint: fields.poolMint,
  };
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. The prepare tool imports
 * `_jitoChain` and calls through the indirection so tests can spy on the resolve
 * without monkey-patching the named export (ESM bindings are immutable).
 */
export const _jitoChain = {
  decodeJitoStakePoolFields,
  deriveWithdrawAuthority,
  resolveJitoAccounts,
};
