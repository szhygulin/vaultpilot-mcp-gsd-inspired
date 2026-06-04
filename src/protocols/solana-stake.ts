// src/protocols/solana-stake.ts
//
// Native SOL Stake Program lifecycle bundling helpers (Phase 15 — Plan 15-01).
// Sibling of `src/protocols/marginfi.ts` / `src/protocols/kamino.ts` shape with a
// `_solanaStake` ESM-indirection object (CLAUDE.md — internal cross-export calls
// route through it so tests can spy; added at write time, not retroactively).
//
// ZERO new dependency: native staking uses the BUILT-IN `@solana/web3.js`
// `StakeProgram` class (already installed). Pattern 1 (research § Pitfall 1):
// `StakeProgram.delegate / .deactivate / .withdraw / .createAccountWithSeed`
// return a MULTI-INSTRUCTION `Transaction`, NOT a bare `TransactionInstruction`.
// Each builder extracts `.instructions` and re-bundles through `assembleStakeTx`
// so `serializeMessage()` produces the FROZEN-binding preimage UNCHANGED (no edit
// to payload-fingerprint-solana.ts).
//
// LEDGER-SAFE stake-account creation (research § Pitfall 3 / A3 / Open Q1): the
// create-on-absent path uses `StakeProgram.createAccountWithSeed`
// (base = feePayer, seed = STAKE_SEED, programId = StakeProgram.programId) which
// yields a DETERMINISTIC address the user's wallet authority controls — NO
// ephemeral `Keypair.generate()` (an ephemeral keypair would require a second
// signer the server has no key for, and must never). Mirrors MarginFi's
// `initialize_pda` (NOT `initialize`) choice in Phase 13.
//
// `programIds` is enumerated from the ACTUAL built instruction vector (Pitfall 5):
//   delegate (existing account) → {Stake}
//   delegate-with-create        → {System, Stake}
//   deactivate / withdraw       → {Stake}

import {
  Authorized,
  Lockup,
  PublicKey,
  StakeProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

/**
 * Documented fixed stake-account seed (resolves research Open Q1). The derived
 * stake address is `PublicKey.createWithSeed(feePayer, STAKE_SEED,
 * StakeProgram.programId)` — deterministic and controlled by the feePayer's
 * wallet authority (no second signer needed; Ledger-safe). A caller may override
 * the stake account explicitly via the `stakeAccount` arg; the create path is
 * taken only when no stake account is supplied. Pinned in Fixture F.
 *
 * The seed is intentionally short + stable: the per-wallet stake address is the
 * `createWithSeed` of (feePayer, this seed). One canonical stake account per
 * wallet under this scheme; future split-stake / multi-validator work (deferred
 * to v3.x) would extend the seed scheme.
 */
export const STAKE_SEED = "vaultpilot:stake" as const;

/**
 * Lamports precision guard (research § Pitfall 2). `StakeProgram` builders take
 * `lamports: number` (JS-number, web3.js v1 predates bigint adoption). A
 * decimal-string SOL amount parsed to a bigint must be down-converted; this
 * guard throws BEFORE a silent `Number()` precision loss. 9.007 billion SOL is
 * the 2^53 ceiling — never reached in practice, but asserted.
 */
export class StakeLamportsOverflowError extends Error {
  readonly lamports: bigint;
  constructor(lamports: bigint) {
    super(
      `stake lamports ${lamports.toString()} exceeds Number.MAX_SAFE_INTEGER ` +
        `(${Number.MAX_SAFE_INTEGER}); refusing to risk silent precision loss`,
    );
    this.name = "StakeLamportsOverflowError";
    this.lamports = lamports;
  }
}

/** Down-convert a lamports bigint to a JS number with a 2^53 ceiling guard. */
function toSafeNumber(lamports: bigint): number {
  if (lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new StakeLamportsOverflowError(lamports);
  }
  return Number(lamports);
}

/**
 * Derive the deterministic stake account address for `feePayer` under the
 * canonical `STAKE_SEED`. Synchronous reproduction of `PublicKey.createWithSeed`
 * (which is async in web3.js v1 but a pure hash internally):
 * `sha256(base ‖ utf8(seed) ‖ StakeProgram.programId)`. VERIFIED byte-identical
 * to the async `PublicKey.createWithSeed(...)` at build. Pinned in Fixture F.
 */
export function deriveStakeAccount(feePayer: PublicKey, seed: string = STAKE_SEED): PublicKey {
  const preimage = Buffer.concat([
    feePayer.toBuffer(),
    Buffer.from(seed, "utf8"),
    StakeProgram.programId.toBuffer(),
  ]);
  return new PublicKey(sha256(preimage));
}

/**
 * Build the native delegate instruction vector for an EXISTING stake account
 * (Fixture E). `StakeProgram.delegate` returns a `Transaction`; we extract its
 * `.instructions` (Pattern 1).
 */
export function buildDelegateIxs(input: {
  stakeAccount: PublicKey;
  authorizedPubkey: PublicKey;
  votePubkey: PublicKey;
}): TransactionInstruction[] {
  const tx = StakeProgram.delegate({
    stakePubkey: input.stakeAccount,
    authorizedPubkey: input.authorizedPubkey,
    votePubkey: input.votePubkey,
  });
  return tx.instructions;
}

/**
 * Build the native delegate-with-create BUNDLE (Fixture F) when no stake account
 * exists: `createAccountWithSeed` (System createAccountWithSeed + Stake
 * initialize pair) followed by `delegate` — in order. NO ephemeral Keypair
 * (Pitfall 3 / A3). Returns the ORDERED instruction vector + the derived stake
 * address (so the tool can surface it).
 *
 * `rentExemptLamports` funds rent exemption; `lamports` is the stake amount; the
 * account is funded to `rentExemptLamports + lamports`.
 */
export function buildDelegateWithCreateIxs(input: {
  feePayer: PublicKey;
  stakeSeed: string;
  votePubkey: PublicKey;
  lamports: bigint;
  rentExemptLamports: bigint;
}): { instructions: TransactionInstruction[]; stakeAccount: PublicKey } {
  const stakeAccount = deriveStakeAccount(input.feePayer, input.stakeSeed);
  const totalLamports = toSafeNumber(input.rentExemptLamports + input.lamports);
  const createTx = StakeProgram.createAccountWithSeed({
    fromPubkey: input.feePayer,
    stakePubkey: stakeAccount,
    basePubkey: input.feePayer,
    seed: input.stakeSeed,
    authorized: new Authorized(input.feePayer, input.feePayer),
    lockup: Lockup.default,
    lamports: totalLamports,
  });
  const delegateTx = StakeProgram.delegate({
    stakePubkey: stakeAccount,
    authorizedPubkey: input.feePayer,
    votePubkey: input.votePubkey,
  });
  return {
    instructions: [...createTx.instructions, ...delegateTx.instructions],
    stakeAccount,
  };
}

/** Build the native deactivate instruction vector (Fixture G). */
export function buildDeactivateIxs(input: {
  stakeAccount: PublicKey;
  authorizedPubkey: PublicKey;
}): TransactionInstruction[] {
  const tx = StakeProgram.deactivate({
    stakePubkey: input.stakeAccount,
    authorizedPubkey: input.authorizedPubkey,
  });
  return tx.instructions;
}

/**
 * Build the native withdraw instruction vector (Fixture H). `lamports` is a
 * bigint at the API boundary; the `> Number.MAX_SAFE_INTEGER` guard runs before
 * the `Number()` cast the StakeProgram `number` param requires (Pitfall 2).
 */
export function buildWithdrawIxs(input: {
  stakeAccount: PublicKey;
  authorizedPubkey: PublicKey;
  toPubkey: PublicKey;
  lamports: bigint;
}): TransactionInstruction[] {
  const tx = StakeProgram.withdraw({
    stakePubkey: input.stakeAccount,
    authorizedPubkey: input.authorizedPubkey,
    toPubkey: input.toPubkey,
    lamports: toSafeNumber(input.lamports),
  });
  return tx.instructions;
}

/**
 * Assemble an ordered native-stake instruction vector into a legacy
 * `Transaction` (feePayer + recentBlockhash) and return the canonical message
 * bytes + program IDs + a generic instruction summary. Mirrors
 * `assembleMarginfiTx` / `assembleKaminoTx` — `messageBytes` are the EXACT
 * preimage `computeSolanaPayloadFingerprint` hashes (FROZEN binding, unchanged).
 *
 * `programIds` enumerates EVERY touched top-level program from the actual built
 * ix vector (Pitfall 5): delegate → {Stake}; delegate-with-create → {System,
 * Stake}; deactivate/withdraw → {Stake}.
 */
export function assembleStakeTx(input: {
  instructions: TransactionInstruction[];
  ixNames: string[];
  feePayer: PublicKey;
  recentBlockhash: string;
}): {
  transaction: Transaction;
  messageBytes: Uint8Array;
  programIds: string[];
  instructionSummary: Array<{ kind: "solana-stake"; ixName: string; programId: string }>;
} {
  const tx = new Transaction({
    recentBlockhash: input.recentBlockhash,
    feePayer: input.feePayer,
  });
  for (const ix of input.instructions) tx.add(ix);
  const messageBytes = new Uint8Array(tx.serializeMessage());

  const programIdSet = new Set<string>();
  for (const ix of input.instructions) programIdSet.add(ix.programId.toBase58());

  return {
    transaction: tx,
    messageBytes,
    programIds: [...programIdSet],
    instructionSummary: input.instructions.map((ix, i) => ({
      kind: "solana-stake" as const,
      ixName: input.ixNames[i] ?? "unknown",
      programId: ix.programId.toBase58(),
    })),
  };
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. The prepare tools (Task 2)
 * import `_solanaStake` and call through the indirection so tests can spy on the
 * build side without monkey-patching named exports (ESM bindings are immutable).
 */
export const _solanaStake = {
  STAKE_SEED,
  deriveStakeAccount,
  buildDelegateIxs,
  buildDelegateWithCreateIxs,
  buildDeactivateIxs,
  buildWithdrawIxs,
  assembleStakeTx,
};
