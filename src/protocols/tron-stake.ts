// TRON Stake 2.0 encoder. Phase 19 — Plan 19-02.
//
// Sibling of `src/protocols/tron-native.ts` (Plan 18-02) and
// `src/protocols/tron-trc20.ts` (Plan 18-03). Consumed by:
//   - src/tools/prepare_tron_stake_freeze.ts   (encodeFreezeBalanceV2 via _tronStake)
//   - src/tools/prepare_tron_stake_unfreeze.ts  (encodeUnfreezeBalanceV2 via _tronStake)
//   - src/tools/prepare_tron_withdraw_expire_unfreeze.ts (encodeWithdrawExpireUnfreeze via _tronStake)
//   - src/tools/preview_send.ts (TRON branch, stake arms — checkWithdrawableBalance)
//
// **STAKE 2.0 ONLY — `FreezeBalanceV2Contract` / `UnfreezeBalanceV2Contract` /
// `WithdrawExpireUnfreezeContract`**. Legacy Stake 1.0 (`FreezeBalanceContract`
// / `UnfreezeBalanceContract`) is deprecated by TRON network as of
// `tronprotocol/java-tron@4.6.0` and MUST NOT appear anywhere in `src/`.
// Grep regression in `test/protocols-tron-stake.test.ts` enforces this invariant.
//
// CRITICAL: `FreezeBalanceV2Contract.frozen_balance` is typed `number` in the
// Protobuf definition (NOT bigint — verified against tronweb@6.3.0 .d.ts).
// After `parseTronAmountStrict` returns a `bigint`, an explicit `Number()`
// conversion is required. An overflow guard (`if (sun > BigInt(Number.MAX_SAFE_INTEGER))`)
// fires FIRST to prevent silent precision loss on very large amounts.
// This is T-19-02-T-NUMBER-OVERFLOW mitigation (PLAN 19-02 threat register).
//
// `WithdrawExpireUnfreezeContract` takes ZERO args — the protocol auto-withdraws
// all expired-unfreeze records for the owner. The tool wrapper accepts no
// `amount` parameter and no `resource` parameter (RESEARCH §Topic 3 Pitfall).
//
// Format-fanout-sentinel rule (CLAUDE.md): TRON Stake 2.0 encoding is done
// ONLY here via `_tronStake.encodeFreezeBalanceV2` / etc. Tools NEVER call
// tronweb builder methods directly — they route through this indirection so
// the test seam stays uniform.
//
// ESM spy-affordance per CLAUDE.md convention. `_tronStake` indirection is
// the test seam: `vi.spyOn(_tronStake, "encodeFreezeBalanceV2")` intercepts
// correctly across ESM module boundaries. Direct `vi.spyOn` on named exports
// is a silent no-op (ESM bindings are immutable).
//
// Anti-pattern guard — NEVER call `transactionBuilder.freezeBalance` (Stake 1.0)
// or `transactionBuilder.unfreezeBalance` (Stake 1.0). Only `freezeBalanceV2`,
// `unfreezeBalanceV2`, `withdrawExpireUnfreeze` are permitted in this file.

import type { TronWeb } from "tronweb";

import type { TronInstructionSummary } from "../signing/handle-store.js";

/** Resource type for Stake 2.0 — strict equality enum per D-03b. */
export type TronStakeResource = "ENERGY" | "BANDWIDTH";

/**
 * Full encode result returned by the Stake 2.0 encoders. Carries all fields
 * needed by prepare tools to build the `PreparedTxTron` shape + PREPARE
 * RECEIPT block + structured response. Mirrors `TronNativeEncodeResult`.
 */
export interface TronStakeEncodeResult {
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
 * Encode a TRON Stake 2.0 freeze (FreezeBalanceV2Contract).
 *
 * Steps:
 *   1. Overflow guard: `sun > Number.MAX_SAFE_INTEGER` → throw (T-NUMBER-OVERFLOW).
 *      `FreezeBalanceV2Contract.frozen_balance` is typed `number` in Protobuf.
 *   2. Convert bigint sun to JS number via `Number(sun)`.
 *   3. Call `tronWeb.transactionBuilder.freezeBalanceV2(amountNum, resource, from)`.
 *   4. Call `transactionBuilder.extendExpiration(tx, 900)` — LOAD-BEARING per
 *      18-RESEARCH §Topic 5: default expiration is 60s; extends to 900s (15min).
 *   5. Extract rawDataHex, rawDataBytes, rawDataObject, refBlockBytes,
 *      refBlockHash, expiration.
 *   6. Build `instructionSummary[0] = { kind: "stake-freeze-v2", from, resource, sun }`.
 *
 * NEVER use `transactionBuilder.freezeBalance` (Stake 1.0 — rejected by TRON network).
 */
export async function encodeFreezeBalanceV2(input: {
  tronWeb: TronWeb;
  from: string;
  sun: bigint;
  resource: TronStakeResource;
}): Promise<TronStakeEncodeResult> {
  // Step 1 — Overflow guard.
  // FreezeBalanceV2Contract.frozen_balance is a JS `number` (not bigint) per tronweb@6.3.0.
  // Amounts > MAX_SAFE_INTEGER would silently lose precision without this guard.
  // T-19-02-T-NUMBER-OVERFLOW mitigation.
  if (input.sun > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      `freeze amount ${input.sun.toString()} SUN exceeds JavaScript safe integer range (Number.MAX_SAFE_INTEGER = ${Number.MAX_SAFE_INTEGER}); reject before tronweb truncates`,
    );
  }

  // Step 2 — Safe conversion (guarded above).
  const amountNum = Number(input.sun);

  // Step 3 — Build the unsigned FreezeBalanceV2Contract tx via tronweb.
  // ONLY freezeBalanceV2 — NEVER freezeBalance (Stake 1.0 deprecated).
  let tx = await input.tronWeb.transactionBuilder.freezeBalanceV2(
    amountNum,
    input.resource,
    input.from,
  );

  // Step 4 — Extend expiration. CRITICAL per 18-RESEARCH §Topic 5.
  tx = await input.tronWeb.transactionBuilder.extendExpiration(tx, 900);

  // Step 5 — Extract fields.
  const rawDataHex = tx.raw_data_hex;
  const rawDataBytes = new Uint8Array(Buffer.from(rawDataHex, "hex"));
  const rawDataObject = tx.raw_data;
  const refBlockBytes = tx.raw_data.ref_block_bytes;
  const refBlockHash = tx.raw_data.ref_block_hash;
  const expiration = tx.raw_data.expiration;

  // Step 6 — Build instruction summary.
  const instructionSummary: TronInstructionSummary[] = [
    {
      kind: "stake-freeze-v2",
      from: input.from,
      resource: input.resource,
      sun: input.sun,
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

/**
 * Encode a TRON Stake 2.0 unfreeze (UnfreezeBalanceV2Contract).
 *
 * Steps:
 *   1. Overflow guard: `sun > Number.MAX_SAFE_INTEGER` → throw (T-NUMBER-OVERFLOW).
 *      `UnfreezeBalanceV2Contract.unfreeze_balance` is typed `number` in Protobuf.
 *   2. Convert bigint sun to JS number via `Number(sun)`.
 *   3. Call `tronWeb.transactionBuilder.unfreezeBalanceV2(amountNum, resource, from)`.
 *   4. Call `transactionBuilder.extendExpiration(tx, 900)` — LOAD-BEARING.
 *   5. Extract rawDataHex, rawDataBytes, rawDataObject, refBlockBytes, refBlockHash, expiration.
 *   6. Build `instructionSummary[0] = { kind: "stake-unfreeze-v2", from, resource, sun }`.
 *
 * NEVER use `transactionBuilder.unfreezeBalance` (Stake 1.0).
 */
export async function encodeUnfreezeBalanceV2(input: {
  tronWeb: TronWeb;
  from: string;
  sun: bigint;
  resource: TronStakeResource;
}): Promise<TronStakeEncodeResult> {
  // Step 1 — Overflow guard (same requirement as freeze; UnfreezeBalanceV2Contract.unfreeze_balance is number).
  if (input.sun > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      `unfreeze amount ${input.sun.toString()} SUN exceeds JavaScript safe integer range (Number.MAX_SAFE_INTEGER = ${Number.MAX_SAFE_INTEGER}); reject before tronweb truncates`,
    );
  }

  // Step 2 — Safe conversion.
  const amountNum = Number(input.sun);

  // Step 3 — Build via unfreezeBalanceV2 (Stake 2.0).
  // ONLY unfreezeBalanceV2 — NEVER unfreezeBalance (Stake 1.0 deprecated).
  let tx = await input.tronWeb.transactionBuilder.unfreezeBalanceV2(
    amountNum,
    input.resource,
    input.from,
  );

  // Step 4 — Extend expiration.
  tx = await input.tronWeb.transactionBuilder.extendExpiration(tx, 900);

  // Step 5 — Extract fields.
  const rawDataHex = tx.raw_data_hex;
  const rawDataBytes = new Uint8Array(Buffer.from(rawDataHex, "hex"));
  const rawDataObject = tx.raw_data;
  const refBlockBytes = tx.raw_data.ref_block_bytes;
  const refBlockHash = tx.raw_data.ref_block_hash;
  const expiration = tx.raw_data.expiration;

  // Step 6 — Build instruction summary.
  const instructionSummary: TronInstructionSummary[] = [
    {
      kind: "stake-unfreeze-v2",
      from: input.from,
      resource: input.resource,
      sun: input.sun,
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

/**
 * Encode a TRON Stake 2.0 withdraw-expire-unfreeze (WithdrawExpireUnfreezeContract).
 *
 * ZERO-ARG contract — the protocol auto-withdraws all expired-unfreeze records
 * for the owner. The tool wrapper accepts no `amount` and no `resource`.
 * (RESEARCH §Topic 3 Pitfall: second arg to `withdrawExpireUnfreeze` is
 * `options?: TransactionCommonOptions` — NOT an amount. Do NOT pass an amount.)
 *
 * Steps:
 *   1. Call `tronWeb.transactionBuilder.withdrawExpireUnfreeze(from)`.
 *   2. Call `transactionBuilder.extendExpiration(tx, 900)` — LOAD-BEARING.
 *   3. Extract rawDataHex, rawDataBytes, rawDataObject, refBlockBytes, refBlockHash, expiration.
 *   4. Build `instructionSummary[0] = { kind: "stake-withdraw-expire", from }`.
 */
export async function encodeWithdrawExpireUnfreeze(input: {
  tronWeb: TronWeb;
  from: string;
}): Promise<TronStakeEncodeResult> {
  // Step 1 — Build via withdrawExpireUnfreeze (zero-arg contract; second param is options).
  let tx = await input.tronWeb.transactionBuilder.withdrawExpireUnfreeze(input.from);

  // Step 2 — Extend expiration.
  tx = await input.tronWeb.transactionBuilder.extendExpiration(tx, 900);

  // Step 3 — Extract fields.
  const rawDataHex = tx.raw_data_hex;
  const rawDataBytes = new Uint8Array(Buffer.from(rawDataHex, "hex"));
  const rawDataObject = tx.raw_data;
  const refBlockBytes = tx.raw_data.ref_block_bytes;
  const refBlockHash = tx.raw_data.ref_block_hash;
  const expiration = tx.raw_data.expiration;

  // Step 4 — Build instruction summary.
  const instructionSummary: TronInstructionSummary[] = [
    {
      kind: "stake-withdraw-expire",
      from: input.from,
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

/**
 * Check how much expired-unfreeze balance is currently withdrawable for
 * the given address. Used by the Layer 0.7 simulation gate in `preview_send`
 * for `stake-withdraw-expire` handles (D-04b mandatory refusal).
 *
 * Algorithm:
 *   1. Fetch account state via `tronWeb.trx.getAccount(fromAddress)`.
 *   2. Extract `unfrozenV2: UnFreezeV2[]` — records of pending unfreeze.
 *   3. Sum `unfreeze_amount` where `unfreeze_expire_time <= Date.now()`.
 *   4. Find the earliest future `unfreeze_expire_time` (or null if none).
 *   5. Return `{ withdrawable: bigint, expiringAt: number | null }`.
 *
 * DEFENSIVE DEFAULT: any RPC failure → `{ withdrawable: 0n, expiringAt: null }`.
 * The caller (preview_send) treats `withdrawable === 0n` as mandatory refusal.
 * Failing closed (refuse) rather than open (allow) is the correct security
 * default when we can't verify the on-chain state (T-19-02-T-WITHDRAWABLE-RPC).
 */
export async function checkWithdrawableBalance(
  tronWeb: TronWeb,
  fromAddress: string,
): Promise<{ withdrawable: bigint; expiringAt: number | null }> {
  try {
    const account = await tronWeb.trx.getAccount(fromAddress);

    // unfrozenV2 may be absent or empty when no unfreeze has been initiated.
    const unfrozenV2 = account?.unfrozenV2;
    if (!Array.isArray(unfrozenV2) || unfrozenV2.length === 0) {
      return { withdrawable: 0n, expiringAt: null };
    }

    const now = Date.now();
    let withdrawable = 0n;
    let earliestFuture: number | null = null;

    for (const record of unfrozenV2) {
      const expireTime = record.unfreeze_expire_time ?? 0;
      const amount = record.unfreeze_amount ?? 0;

      if (expireTime <= now) {
        // This record's unfreeze has expired → it is withdrawable.
        withdrawable += BigInt(amount);
      } else {
        // Track earliest future expiry for UX hint in refusal message.
        if (earliestFuture === null || expireTime < earliestFuture) {
          earliestFuture = expireTime;
        }
      }
    }

    return { withdrawable, expiringAt: earliestFuture };
  } catch (err) {
    // Defensive default: refuse on RPC failure (T-19-02-T-WITHDRAWABLE-RPC).
    // Log to stderr per CLAUDE.md convention (stdout is reserved for MCP protocol).
    const cause = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[tron-stake] checkWithdrawableBalance RPC failure for ${fromAddress}: ${cause}\n`,
    );
    return { withdrawable: 0n, expiringAt: null };
  }
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * Prepare tools and `preview_send.ts` TRON branch import `_tronStake` and call
 * through the indirection so tests can `vi.spyOn(_tronStake, "encodeFreezeBalanceV2")`
 * to intercept without monkey-patching the production import path. Direct
 * `vi.spyOn(module, "...")` is a silent no-op for cross-export internal calls —
 * ESM named-export bindings are immutable (CLAUDE.md convention non-negotiable).
 */
export const _tronStake = {
  encodeFreezeBalanceV2,
  encodeUnfreezeBalanceV2,
  encodeWithdrawExpireUnfreeze,
  checkWithdrawableBalance,
};
