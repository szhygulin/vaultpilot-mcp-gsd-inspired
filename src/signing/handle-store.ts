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
//
// Phase 18 — Plan 18-01 widening: `PreparedTx` literal-union further widens to
// `PreparedTxEvm | PreparedTxSolana | PreparedTxTron`. New `PreparedTxTron`
// interface mirrors `PreparedTxSolana` sentinel-fields pattern with TRON-specific
// cryptographic-binding fields. `txType` literal-union widens from `"evm" | "solana"`
// to `"evm" | "solana" | "tron"` (CONTEXT D-10). The rawDataObject persistence
// rationale is documented in 18-RESEARCH §Topic 7.
// State machine + TTL + handle lifecycle BYTE-IDENTICAL.

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
  /** Phase 12 — SPL mint pubkey, base58 (raw agent string). Populated by `prepare_solana_spl_send` (Plan 12-03). */
  mint?: string;
  /** Phase 12 — native SOL amount as raw lamports decimal string. Populated by `prepare_solana_native_send` (Plan 12-02). */
  lamports?: string;
  /** Phase 12 — pinned recent blockhash, base58 (raw agent string when surfaced; server-derived at prepare time). */
  recentBlockhash?: string;
  /** Phase 18 — native TRX amount as raw sun decimal string. Populated by `prepare_tron_native_send` (Plan 18-02). */
  sun?: string;
  /** Phase 18 — agent-supplied expiration override in seconds (optional; defaults to 900 = 15min in encoder). */
  expiration?: string;
  /** Phase 18 — pinned ref-block fields (server-derived at prepare time; surfaced in PREPARE RECEIPT). */
  refBlockBytes?: string;
  refBlockHash?: string;
}

/**
 * Phase 12 — decoded SPL / native instruction summary surfaced in the
 * DECODED ARGS block by preview_send Solana branch (Plan 12-04). Discriminated
 * union mirrors the EVM `Erc20Decoded` / `AaveV3Decoded` shape — preview_send
 * narrows via `kind`. Prepared by the Solana prepare tools (Plans 12-02 /
 * 12-03) and pinned onto `PreparedTxSolana.instructionSummary`.
 */
export type SolanaInstructionSummary =
  | {
      kind: "native-transfer";
      /** Source pubkey, base58. Server-derived from `feePayer` (always == sender for v1.x scope). */
      from: string;
      /** Destination pubkey, base58. */
      to: string;
      /** Raw lamports. */
      lamports: bigint;
    }
  | {
      kind: "spl-transfer-checked";
      /** SPL mint pubkey, base58. */
      mint: string;
      /** Source token-account address (ATA), base58. */
      sourceAta: string;
      /** Destination token-account address (ATA), base58. */
      destAta: string;
      /** Destination OWNER pubkey (NOT the destAta), base58. */
      destOwner: string;
      /** Raw token amount. */
      amount: bigint;
      /** Mint decimals (TransferChecked encodes decimals in the instruction data). */
      decimals: number;
    };

/**
 * Phase 18 — decoded TRON instruction summary surfaced in the DECODED ARGS
 * block by preview_send TRON branch (Plan 18-04). Discriminated union mirrors
 * the `SolanaInstructionSummary` shape — preview_send narrows via `kind`.
 * Prepared by the TRON prepare tools (Plans 18-02 / 18-03) and pinned onto
 * `PreparedTxTron.instructionSummary`.
 */
export type TronInstructionSummary =
  | {
      kind: "native-transfer";
      /** Sender base58check address. */
      from: string;
      /** Recipient base58check address. */
      to: string;
      /** Raw sun amount (bigint). 1 TRX = 1_000_000 sun. */
      sun: bigint;
    }
  | {
      kind: "trc20-transfer";
      /** Sender base58check address. */
      from: string;
      /** Recipient base58check address. */
      to: string;
      /** TRC-20 contract base58check address. */
      tokenAddress: string;
      /** Raw token amount (bigint), scaled per `decimals`. */
      amount: bigint;
      /** Token decimals (from `get_tron_token_metadata`). */
      decimals: number;
    };

/**
 * Decoded/typed shape of the prepared transaction, plus the preview-time-
 * pinned fields once the handle transitions to `previewed`. The viem-typed
 * fields (`Address`, `bigint`, `Hex`) live here, NOT on `PrepareArgs`.
 *
 * Phase 12 — Plan 12-01 widening: `PreparedTx` becomes a discriminated union
 * of `PreparedTxEvm` (default `txType?: "evm"` for back-compat with every
 * Phase 4-11 handle that omits the field) + `PreparedTxSolana` (required
 * `txType: "solana"`). The discriminator is the ONLY additive change —
 * state machine + TTL + handle lifecycle BYTE-IDENTICAL. Every existing call
 * site that builds an EVM `PreparedTx` stays byte-identical (the `txType?`
 * field is optional with default `"evm"`; downstream consumers narrow via
 * `record.tx.txType ?? "evm"`).
 */
export interface PreparedTxEvm {
  /** Optional discriminator — absent === "evm" (back-compat with every Phase 4-11 handle). */
  txType?: "evm";
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
 * Solana prepared-tx shape. The Solana-specific fields (`messageBytes`,
 * `feePayer`, `recentBlockhash`, `programIds`) carry the cryptographic
 * binding inputs; the EVM-shape fields (`chainId`, `to`, `valueWei`,
 * `data`) are populated with SENTINEL ZEROS so the discriminated union
 * stays accessible without narrowing at every existing EVM call site.
 *
 * [Rule 2 - Auto-fix critical functionality] The plan defines
 * `PreparedTxSolana` with ONLY Solana-specific fields, which would force
 * every EVM-side consumer (preview_send, send_transaction,
 * get_tx_verification — all FROZEN per the success criteria) to add `if
 * (record.tx.txType === "solana")` narrowing or fail typecheck. The
 * plan's own `PreviewPinned` precedent already names the resolution:
 * "Solana branch populates with sentinel zeros for the EVM-specific
 * fields ... type-stability preserved" — the same pattern applies here.
 * Without the sentinels, the FROZEN-area assertion is impossible. With
 * the sentinels, EVM consumers see the union as a strict super-set of
 * `PreparedTxEvm` and stay byte-identical.
 *
 * Sentinel values are chosen to be obviously-not-real (chainId 0, zero
 * address, zero value, "0x" data) so any accidental EVM-side dispatch of
 * a Solana handle fails at the Layer 0.5 dispatch-target check rather
 * than silently degrading to a meaningless EVM call.
 */
export interface PreparedTxSolana {
  /** Required discriminator — Solana shape carries no implicit default. */
  txType: "solana";

  // ---------------------------------------------------------------------
  // EVM-shape sentinel fields (set to zero / empty values for Solana
  // handles). Present to keep the discriminated union accessible by
  // existing EVM-side consumers without forcing narrowing at every site.
  // EVM call paths that reach a Solana handle will hit the Layer 0.5
  // dispatch-target refusal before reading these — the sentinels are
  // defensive, not load-bearing.
  // ---------------------------------------------------------------------
  /** Sentinel — Solana has no `chainId`. Always 0. */
  chainId: number;
  /** Sentinel — Solana addresses are base58, not 0x-prefixed. Always the zero address. */
  to: Address;
  /** Sentinel — Solana uses `lamports`, not `valueWei`. Always 0n. */
  valueWei: bigint;
  /** Sentinel — Solana has no calldata. Always `"0x"`. */
  data: Hex;
  /** Sentinel — Solana has no EVM nonce. Always undefined. */
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;

  // ---------------------------------------------------------------------
  // Solana-specific cryptographic-binding fields. All populated by the
  // Solana prepare tools (Plans 12-02 / 12-03); consumed by the Solana
  // preview_send / send_transaction branches (Plans 12-04 / 12-05).
  // ---------------------------------------------------------------------
  /**
   * `Transaction.serializeMessage()` output — the canonical Solana message
   * bytes that flow into both `computeSolanaPayloadFingerprint` (DF-1
   * binding) AND `computeSolanaPresignHash` (DF-2 device display). Same
   * bytes for both — drift would break the on-device-hash-match trust
   * anchor.
   */
  messageBytes: Uint8Array;
  /** Fee-payer pubkey, base58. account_keys[0] of the serialized message — sender-dependent fingerprint by construction. */
  feePayer: string;
  /** Pinned recent blockhash, base58. Embedded in messageBytes; pinned separately for fast surface in receipts. */
  recentBlockhash: string;
  /** Program IDs touched, base58. Consumed by `canonical-dispatch-solana` (Plan 12-04 Layer 0.5 allowlist refusal). */
  programIds: string[];
  /** Optional decoded instruction summary — populated by Solana prepare tools, consumed by preview_send DECODED ARGS surface. */
  instructionSummary?: SolanaInstructionSummary[];
}

/**
 * TRON prepared-tx shape. Phase 18 — Plan 18-01. Mirrors the `PreparedTxSolana`
 * sentinel-fields pattern — EVM-shape sentinel fields allow existing EVM-side
 * consumers to remain BYTE-IDENTICAL without narrowing at every call site.
 * The discriminator (`txType: "tron"`) + TRON-specific fields carry the
 * cryptographic-binding inputs; the sentinel EVM fields are set to zero/empty
 * values so accidental EVM dispatch hits the Layer 0.5 canonical-dispatch-tron
 * refusal before reaching any meaningful EVM processing.
 *
 * `rawDataObject` is persisted as `unknown` to avoid leaking tronweb SDK types
 * into handle-store (Plan 18-04 send branch rebuilds the broadcast envelope
 * from this object). Rationale in 18-RESEARCH §Topic 7.
 */
export interface PreparedTxTron {
  /** Required discriminator — TRON shape. */
  txType: "tron";

  // -----------------------------------------------------------------------
  // EVM-shape sentinel fields (set to zero / empty values for TRON handles).
  // Present to keep the discriminated union accessible by existing EVM-side
  // consumers without forcing narrowing at every site. EVM call paths that
  // reach a TRON handle will hit the Layer 0.5 dispatch-target refusal
  // before reading these — the sentinels are defensive, not load-bearing.
  // -----------------------------------------------------------------------
  /** Sentinel — TRON has no EVM chainId. Always 0. */
  chainId: number;
  /** Sentinel — TRON addresses are base58check, not 0x-prefixed. Always the zero address. */
  to: Address;
  /** Sentinel — TRON uses sun, not valueWei. Always 0n. */
  valueWei: bigint;
  /** Sentinel — TRON has no EVM calldata. Always `"0x"`. */
  data: Hex;
  /** Sentinel — TRON has no EVM nonce. Always undefined. */
  nonce?: number;
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;

  // -----------------------------------------------------------------------
  // TRON-specific cryptographic-binding fields. Populated by Plan 18-02 /
  // 18-03 prepare tools; consumed by Plan 18-04 preview_send / send branches.
  // -----------------------------------------------------------------------
  /**
   * Canonical Protobuf-serialized raw_data hex (no 0x prefix per tronweb
   * convention). Source of both payloadFingerprint preimage (DF-1) and
   * presignHash computation (DF-2 = SHA-256(raw_data) = transaction.txID).
   */
  rawDataHex: string;
  /**
   * Original tronweb raw_data object (typed as `unknown` to avoid leaking SDK
   * types into handle-store). Plan 18-04 send branch reconstructs the
   * broadcast envelope from this object. Rationale in 18-RESEARCH §Topic 7.
   */
  rawDataObject: unknown;
  /**
   * Pinned ref-block fields from prepare time. Surfaced verbatim in
   * PREPARE RECEIPT (Plans 18-02 + 18-03). Used by Plan 18-04 send branch
   * to validate the transaction has not expired.
   */
  refBlockBytes: string;
  refBlockHash: string;
  /**
   * Transaction expiration timestamp (ms since epoch). Plans 18-02 + 18-03
   * set this to `Date.now() + 900_000` (15 min) via `extendExpiration` per
   * 18-RESEARCH §Topic 5. Plan 18-04 checks `Date.now() < expiration` at
   * send time.
   */
  expiration: number;
  /**
   * TRON-specific discriminator — routes Layer 0.5 + Layer 0.7 dispatch at
   * preview_send TRON branch (Plan 18-04). `"native"` skips canonical-dispatch-
   * tron allowlist and simulation gate; `"trc20"` enforces both.
   */
  kind: "native" | "trc20";
  /**
   * TRC-20 only — base58check token contract address. Consumed by
   * `canonical-dispatch-tron` allowlist (Plan 18-04 Layer 0.5 gate).
   * Undefined for native TRX handles.
   */
  contractAddress?: string;
  /**
   * Decoded instruction summary — populated by Plan 18-02 / 18-03 encoders;
   * consumed by Plan 18-04 DECODED ARGS surface.
   */
  instructionSummary?: TronInstructionSummary[];
}

export type PreparedTx = PreparedTxEvm | PreparedTxSolana | PreparedTxTron;

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
  /**
   * Broadcast result identifier. Widened from `Hex` to `string` in Plan 12-05
   * for cross-chain compatibility: EVM stores `0x`-prefixed 32-byte tx hashes,
   * Solana stores base58-encoded 64-byte Ed25519 signatures (~88 chars; NOT
   * `0x`-prefixed). Both wire-format identifiers consumers receive verbatim;
   * the field name `txHash` is kept for API symmetry with the v1.x EVM surface.
   */
  txHash?: string;
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
export function transitionToSent(handle: string, txHash: string): TransitionResult {
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
