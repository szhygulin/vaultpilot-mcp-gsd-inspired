// TRON Vote + Claim-Rewards encoder. Phase 19 — Plan 19-03.
//
// Sibling of `src/protocols/tron-stake.ts` (Plan 19-02) and
// `src/protocols/tron-native.ts` (Plan 18-02). Consumed by:
//   - src/tools/prepare_tron_stake_vote.ts    (encodeVoteWitness via _tronVote)
//   - src/tools/prepare_tron_stake_claim_rewards.ts (encodeWithdrawBalanceContract via _tronVote)
//   - src/tools/preview_send.ts (TRON branch, vote + claim-rewards arms)
//
// **STAKE 2.0 VOTE — VoteWitnessContract**
//   `transactionBuilder.vote(voteInfo, from)` where `voteInfo` is a
//   `{ [srAddress: string]: number }` MAP — NOT an array.
//   Array→map conversion is MANDATORY (T-VOTE-MAP critical invariant).
//   See 19-RESEARCH §Topic 4 Pitfall and 19-PATTERNS Surprise #5.
//
// **CLAIM REWARDS — WithdrawBalanceContract**
//   `transactionBuilder.withdrawBlockRewards(from)` — zero additional args.
//   D-06c: NO intent-vs-reality gate at preview time for claim rewards.
//   `estimatedRewardSun` is advisory only (populated at tool layer via
//   `tronWeb.trx.getReward(from)`, passed through for surface; null if fetch fails).
//
// CRITICAL: `extendExpiration(tx, 900)` is LOAD-BEARING for both encoders.
// Default tronweb expiration is 60s; extends to 900s (15min) per
// 18-RESEARCH §Topic 5. Forgetting this causes "Transaction expired" on device.
//
// ESM spy-affordance per CLAUDE.md convention. `_tronVote` indirection is
// the test seam: `vi.spyOn(_tronVote, "encodeVoteWitness")` intercepts
// correctly across ESM module boundaries. Direct `vi.spyOn` on named exports
// is a silent no-op (ESM bindings are immutable).

import type { TronWeb } from "tronweb";

import type { TronInstructionSummary } from "../signing/handle-store.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A single vote target in the input array.
 * `label` is the advisory SR label from the SR registry (passed through to
 * instructionSummary for surface in DECODED ARGS block).
 */
export interface VoteEntry {
  /** SR base58check address (T-prefixed, 34 chars). Trust anchor for the vote target. */
  srAddress: string;
  /** Vote count (power) to allocate to this SR. */
  count: number;
  /** Advisory SR label — e.g. "(SR: Binance Staking — vote rank 1)" or "(unverified SR — confirm address)". */
  label: string;
}

/**
 * Full encode result returned by `encodeVoteWitness`. Mirrors `TronStakeEncodeResult`.
 */
export interface TronVoteEncodeResult {
  /** The tronweb Transaction object (after extendExpiration). */
  transaction: unknown;
  /** Canonical Protobuf-serialized raw_data hex string (no 0x prefix). Source of payloadFingerprint. */
  rawDataHex: string;
  /** Byte view of rawDataHex — input to `computeTronPayloadFingerprint`. */
  rawDataBytes: Uint8Array;
  /** Original tronweb `raw_data` object (typed as `unknown` to avoid SDK type leak). */
  rawDataObject: unknown;
  /** Pinned ref_block_bytes from prepare time (verbatim from tronweb response). */
  refBlockBytes: string;
  /** Pinned ref_block_hash from prepare time (verbatim from tronweb response). */
  refBlockHash: string;
  /** Extended expiration timestamp (ms). After `extendExpiration(tx, 900)`. */
  expiration: number;
  /** Decoded instruction summary for the DECODED ARGS surface. */
  instructionSummary: TronInstructionSummary[];
}

/**
 * Full encode result returned by `encodeWithdrawBalanceContract`. Mirrors `TronStakeEncodeResult`.
 */
export interface TronClaimRewardsEncodeResult {
  /** The tronweb Transaction object (after extendExpiration). */
  transaction: unknown;
  /** Canonical Protobuf-serialized raw_data hex string (no 0x prefix). Source of payloadFingerprint. */
  rawDataHex: string;
  /** Byte view of rawDataHex — input to `computeTronPayloadFingerprint`. */
  rawDataBytes: Uint8Array;
  /** Original tronweb `raw_data` object (typed as `unknown` to avoid SDK type leak). */
  rawDataObject: unknown;
  /** Pinned ref_block_bytes from prepare time (verbatim from tronweb response). */
  refBlockBytes: string;
  /** Pinned ref_block_hash from prepare time (verbatim from tronweb response). */
  refBlockHash: string;
  /** Extended expiration timestamp (ms). After `extendExpiration(tx, 900)`. */
  expiration: number;
  /** Decoded instruction summary for the DECODED ARGS surface. */
  instructionSummary: TronInstructionSummary[];
}

// ============================================================================
// encodeVoteWitness
// ============================================================================

/**
 * Encode a TRON VoteWitnessContract transaction.
 *
 * Steps:
 *   1. Validate `votes` is non-empty. Throw on empty array.
 *   2. Validate no duplicate `srAddress` in the votes array. Throw on duplicates.
 *   3. Convert `votes` array → `VoteInfo = { [srAddress]: count }` MAP.
 *      CRITICAL (T-VOTE-MAP): `vote()` requires a plain object map, NOT an array.
 *      Passing an array causes incorrect Protobuf encoding.
 *   4. Call `tronWeb.transactionBuilder.vote(voteInfo, from)`.
 *   5. Call `tronWeb.transactionBuilder.extendExpiration(tx, 900)` — LOAD-BEARING.
 *   6. Extract rawDataHex, rawDataBytes, rawDataObject, refBlockBytes,
 *      refBlockHash, expiration.
 *   7. Build `instructionSummary[0]` with kind="stake-vote", from, totalCount,
 *      and the original votes array (preserved for DECODED ARGS surface).
 */
export async function encodeVoteWitness(input: {
  tronWeb: TronWeb;
  from: string;
  votes: VoteEntry[];
}): Promise<TronVoteEncodeResult> {
  const { tronWeb, from, votes } = input;

  // Step 1 — Validate non-empty.
  if (votes.length === 0) {
    throw new Error("encodeVoteWitness: votes array must contain at least one entry");
  }

  // Step 2 — Validate no duplicates.
  const seenAddresses = new Set<string>();
  for (const vote of votes) {
    if (seenAddresses.has(vote.srAddress)) {
      throw new Error(
        `encodeVoteWitness: duplicate srAddress detected: "${vote.srAddress}". Each SR address must appear at most once in votes array.`,
      );
    }
    seenAddresses.add(vote.srAddress);
  }

  // Step 3 — Array → VoteInfo map conversion (T-VOTE-MAP CRITICAL).
  // tronweb.transactionBuilder.vote() requires { [srAddress: string]: number }
  // NOT an array of { srAddress, count }.
  const voteInfo: Record<string, number> = {};
  for (const vote of votes) {
    voteInfo[vote.srAddress] = vote.count;
  }

  // Step 4 — Build the unsigned VoteWitnessContract tx via tronweb.
  let tx = await tronWeb.transactionBuilder.vote(voteInfo, from);

  // Step 5 — Extend expiration. CRITICAL per 18-RESEARCH §Topic 5.
  tx = await tronWeb.transactionBuilder.extendExpiration(tx, 900);

  // Step 6 — Extract fields.
  const rawDataHex = tx.raw_data_hex as string;
  const rawDataBytes = new Uint8Array(Buffer.from(rawDataHex, "hex"));
  const rawDataObject = tx.raw_data;
  const refBlockBytes = (tx.raw_data as Record<string, unknown>).ref_block_bytes as string;
  const refBlockHash = (tx.raw_data as Record<string, unknown>).ref_block_hash as string;
  const expiration = (tx.raw_data as Record<string, unknown>).expiration as number;

  // Step 7 — Build instruction summary.
  const totalCount = votes.reduce((acc, v) => acc + v.count, 0);
  const instructionSummary: TronInstructionSummary[] = [
    {
      kind: "stake-vote",
      from,
      totalCount,
      votes: votes.map((v) => ({
        srAddress: v.srAddress,
        count: v.count,
        label: v.label,
      })),
    },
  ];

  return {
    transaction: tx,
    rawDataHex,
    rawDataBytes,
    rawDataObject,
    refBlockBytes,
    refBlockHash,
    expiration,
    instructionSummary,
  };
}

// ============================================================================
// encodeWithdrawBalanceContract
// ============================================================================

/**
 * Encode a TRON WithdrawBalanceContract transaction (claim staking rewards).
 *
 * Steps:
 *   1. Call `tronWeb.transactionBuilder.withdrawBlockRewards(from)` — zero additional args.
 *   2. Call `tronWeb.transactionBuilder.extendExpiration(tx, 900)` — LOAD-BEARING.
 *   3. Extract rawDataHex, rawDataBytes, rawDataObject, refBlockBytes, refBlockHash, expiration.
 *   4. Build `instructionSummary[0]` with kind="stake-claim-rewards", from,
 *      estimatedRewardSun: null (advisory only; caller populates at tool layer
 *      if they wish to surface it — D-06c: no gate on claim).
 *
 * D-06c: NO intent-vs-reality gate on claim rewards. The calldata is zero-arg;
 * `estimatedRewardSun` is advisory — null is valid and expected from this encoder.
 * The tool layer may populate it from `tronWeb.trx.getReward(from)` independently.
 */
export async function encodeWithdrawBalanceContract(input: {
  tronWeb: TronWeb;
  from: string;
}): Promise<TronClaimRewardsEncodeResult> {
  const { tronWeb, from } = input;

  // Step 1 — Build the unsigned WithdrawBalanceContract tx via tronweb.
  let tx = await tronWeb.transactionBuilder.withdrawBlockRewards(from);

  // Step 2 — Extend expiration. CRITICAL per 18-RESEARCH §Topic 5.
  tx = await tronWeb.transactionBuilder.extendExpiration(tx, 900);

  // Step 3 — Extract fields.
  const rawDataHex = tx.raw_data_hex as string;
  const rawDataBytes = new Uint8Array(Buffer.from(rawDataHex, "hex"));
  const rawDataObject = tx.raw_data;
  const refBlockBytes = (tx.raw_data as Record<string, unknown>).ref_block_bytes as string;
  const refBlockHash = (tx.raw_data as Record<string, unknown>).ref_block_hash as string;
  const expiration = (tx.raw_data as Record<string, unknown>).expiration as number;

  // Step 4 — Build instruction summary.
  const instructionSummary: TronInstructionSummary[] = [
    {
      kind: "stake-claim-rewards",
      from,
      estimatedRewardSun: null,
    },
  ];

  return {
    transaction: tx,
    rawDataHex,
    rawDataBytes,
    rawDataObject,
    refBlockBytes,
    refBlockHash,
    expiration,
    instructionSummary,
  };
}

// ============================================================================
// ESM spy-affordance (CLAUDE.md convention)
// ============================================================================

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * Tools and tests import `_tronVote` and call through the indirection so
 * `vi.spyOn(_tronVote, "encodeVoteWitness")` intercepts correctly.
 * Direct `vi.spyOn` on named exports is a silent no-op for ESM (immutable bindings).
 */
export const _tronVote = {
  encodeVoteWitness,
  encodeWithdrawBalanceContract,
};
