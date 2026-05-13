// In-process state machine for prepare → preview → send | cancelled handles
// (research § Pattern 1 lines 188–331). The four Phase 4 signing-flow tools
// (prepare_native_send / preview_send / send_transaction / get_tx_verification)
// mutate this store via the typed transition API; no persistence by design
// (matches Phase 3's `:memory:` discipline — Pitfall 5 in 03-RESEARCH; Plan
// 04-05's get_tx_verification surfaces "process restart loses handles" to
// the agent through its tool description).
//
// Lazy TTL eviction (research § Q5): a `setInterval` sweep would force
// vitest to babysit a timer and complicates test isolation. We delete the
// record inside `lookup` when `Date.now() > createdAt + HANDLE_TTL_MS`.
//
// Cross-ref: research § Pattern 1 (HandleRecord shape, transitionTo* sketches),
// research § Q1 (transitionToCancelled added for userDecision: "cancel" path),
// research § Q4 (idempotent re-preview semantics — last-write wins).

import type { Address, Hex } from "viem";

import type { ErrorCode } from "./error-codes.js";

export const HANDLE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export type HandleStatus = "prepared" | "previewed" | "sent" | "cancelled";

/**
 * Raw args as the agent passed them — typed as `string` (NOT `Address`,
 * NOT `bigint`) so the type system itself blocks normalization at the
 * storage boundary. PREP-02 surfaces these verbatim in the PREPARE RECEIPT
 * block; a future contributor cannot accidentally checksum-case the address
 * or trim the value because the type wouldn't allow it.
 *
 * Phase 6 — Plan 06-02 additive widening. The ERC-20 prepare tools populate
 * a subset of the optional fields alongside the existing `to` / `valueWei`:
 *
 *   - `prepare_token_send`     → `tokenAddress` + `amount` (plus the existing `to`;
 *                                 `valueWei` set to `"0"`)
 *   - `prepare_token_approve`  → `tokenAddress` + `spender` + `amount` (Plan 06-03;
 *                                 `to` set to empty string, `valueWei` to `"0"`)
 *   - `prepare_revoke_approval`→ `tokenAddress` + `spender` (Plan 06-03;
 *                                 `amount` set to `"0"`)
 *   - `prepare_weth_unwrap`    → `tokenAddress` + `amount` (Plan 06-04;
 *                                 no `to`, no `spender`)
 *
 * Format-fanout-sentinel: every new field is `string` (NOT Address / NOT
 * bigint) so the same normalization-at-storage guard applies. Phase 4
 * native-send callers are unchanged at runtime — all new fields are
 * optional.
 */
export interface PrepareArgs {
  to: string;
  valueWei: string;
  /** Phase 6 — ERC-20 token contract address (raw agent string). */
  tokenAddress?: string;
  /** Phase 6 — decimal-string amount in human units (e.g. `"100.5"`). */
  amount?: string;
  /** Phase 6 — approve/revoke spender address (raw agent string). */
  spender?: string;
}

/**
 * Decoded/typed shape of the prepared transaction, plus the preview-time-
 * pinned fields once the handle transitions to `previewed`. The viem-typed
 * fields (`Address`, `bigint`, `Hex`) live here, NOT on `PrepareArgs`.
 */
export interface PreparedTx {
  chainId: number;
  to: Address;
  valueWei: bigint;
  data: Hex;
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
}

/**
 * Preview-pinned fields, persisted onto the record at `transitionToPreviewed`
 * time. `previewToken` is a fresh crypto.randomUUID() — only the CURRENT
 * record.pinned.previewToken is a valid token (Q4 locked decision —
 * re-preview overwrites, no token history).
 */
export interface PreviewPinned {
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  previewToken: string;
  presignHash: Hex;
  selector: Hex | null; // first 4 bytes of data, or null if data === "0x"
}

export interface HandleRecord {
  handle: string;
  args: PrepareArgs;
  tx: PreparedTx;
  payloadFingerprint: Hex;
  status: HandleStatus;
  createdAt: number;
  pinned?: PreviewPinned;
  sentAt?: number;
  txHash?: Hex;
  cancelledAt?: number;
}

export type LookupResult =
  | { ok: true; record: HandleRecord }
  | { ok: false; errorCode: Extract<ErrorCode, "HANDLE_NOT_FOUND" | "HANDLE_EXPIRED"> };

export type TransitionResult =
  | { ok: true; record: HandleRecord }
  | {
      ok: false;
      errorCode: Extract<
        ErrorCode,
        "HANDLE_NOT_FOUND" | "HANDLE_EXPIRED" | "WRONG_STATUS"
      >;
    };

// Module-scope store. NOT exported — all access goes through the typed API.
// `_resetHandleStoreForTesting` and `_peekHandleForTesting` are escape hatches
// for tests (underscore-prefixed convention from src/wallet/walletconnect-client.ts).
const store = new Map<string, HandleRecord>();

/**
 * Create a fresh handle in `prepared` state. Returns the UUID v4 handle
 * string; the agent passes this on every subsequent preview/send/verify call.
 */
export function createHandle(input: {
  args: PrepareArgs;
  tx: PreparedTx;
  payloadFingerprint: Hex;
}): string {
  const handle = crypto.randomUUID();
  const record: HandleRecord = {
    handle,
    args: input.args,
    tx: input.tx,
    payloadFingerprint: input.payloadFingerprint,
    status: "prepared",
    createdAt: Date.now(),
  };
  store.set(handle, record);
  return handle;
}

/**
 * Look up a handle. Lazy TTL: a record whose `createdAt + HANDLE_TTL_MS` is
 * in the past gets evicted from the store and the call returns
 * `HANDLE_EXPIRED`.
 */
export function lookup(handle: string): LookupResult {
  const record = store.get(handle);
  if (!record) return { ok: false, errorCode: "HANDLE_NOT_FOUND" };
  if (Date.now() > record.createdAt + HANDLE_TTL_MS) {
    store.delete(handle);
    return { ok: false, errorCode: "HANDLE_EXPIRED" };
  }
  return { ok: true, record };
}

/**
 * Transition a handle to `previewed`. Idempotent (Q4): re-previewing an
 * already-previewed handle OVERWRITES `record.pinned` — the new previewToken
 * is the only valid token. Rejects with `WRONG_STATUS` from `sent` or
 * `cancelled`.
 */
export function transitionToPreviewed(handle: string, pinned: PreviewPinned): TransitionResult {
  const result = lookup(handle);
  if (!result.ok) return result;
  const record = result.record;
  if (record.status === "sent" || record.status === "cancelled") {
    return { ok: false, errorCode: "WRONG_STATUS" };
  }
  record.pinned = pinned;
  record.status = "previewed";
  return { ok: true, record };
}

/**
 * Transition a handle to `sent`. Only legal from `previewed`. Stamps
 * `txHash` and `sentAt`. The send is final — `sent → cancelled` is rejected.
 */
export function transitionToSent(handle: string, txHash: Hex): TransitionResult {
  const result = lookup(handle);
  if (!result.ok) return result;
  const record = result.record;
  if (record.status !== "previewed") {
    return { ok: false, errorCode: "WRONG_STATUS" };
  }
  record.status = "sent";
  record.txHash = txHash;
  record.sentAt = Date.now();
  return { ok: true, record };
}

/**
 * Transition a handle to `cancelled`. Legal from `prepared` or `previewed`;
 * `sent` is final and refuses. Record is NOT immediately deleted (Plan
 * 04-04's handler reads `record.status` after the transition); lazy TTL
 * reclaims at the 15-min mark.
 */
export function transitionToCancelled(handle: string): TransitionResult {
  const result = lookup(handle);
  if (!result.ok) return result;
  const record = result.record;
  if (record.status === "sent" || record.status === "cancelled") {
    return { ok: false, errorCode: "WRONG_STATUS" };
  }
  record.status = "cancelled";
  record.cancelledAt = Date.now();
  return { ok: true, record };
}

/**
 * Clear the entire store. Test-only — production code never calls this.
 */
export function _resetHandleStoreForTesting(): void {
  store.clear();
}

/**
 * Read a record by handle WITHOUT going through TTL eviction or any state-
 * machine check. Returns the live mutable record reference so downstream
 * tests (Plan 04-04 PAYLOAD_FINGERPRINT_DRIFT) can intentionally mutate
 * `payloadFingerprint` to simulate state corruption. Test-only.
 */
export function _peekHandleForTesting(handle: string): HandleRecord | undefined {
  return store.get(handle);
}
