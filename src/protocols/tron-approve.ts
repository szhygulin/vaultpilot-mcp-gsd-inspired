// TRON TRC-20 approve encoder + decoder. Phase 19 — Plan 19-01.
//
// TRC-20 approve calldata is ABI-identical to ERC-20 approve:
//   selector:  0x095ea7b3  (approve(address,uint256) — 4 bytes)
//   arg[0]:    32-byte left-padded spender address
//   arg[1]:    32-byte big-endian raw token amount (uint256)
//   total:     68 bytes = 136 hex chars
//
// The ENCODER never inlines selector + arg encoding manually — tronweb's
// `transactionBuilder.triggerSmartContract` handles ABI encoding internally
// given `[{ type: "address", value: spender }, { type: "uint256", value:
// amount.toString() }]`. The DECODER DOES manually slice the data hex.
//
// D-01 byte-identity invariant: `prepare_tron_revoke_approval({T,S})` and
// `prepare_tron_token_approve({T,S,amount:"0"})` produce byte-identical
// `rawDataHex` and `payloadFingerprint` by construction — both call
// `encodeTronTrc20Approve` with `amount=0n` via `prepareTronApproveInternal`.
//
// D-02a: `isUnlimited = (amount === U256_MAX)` strict-equality per the
// `prepare_token_approve.ts` EVM analog.
//
// ESM spy-affordance per CLAUDE.md convention: `_tronApprove` wraps the
// two exports so `vi.spyOn(_tronApprove, "encodeTronTrc20Approve")` intercepts
// the call at the prepare-tool boundary. Direct `vi.spyOn(module, "...")` is a
// silent no-op for cross-export internal calls (ESM named-export bindings are
// immutable).
//
// Sibling of `src/protocols/tron-trc20.ts` (Plan 18-03 — transfer encoder).
// Plan carve:
//   - encodeTronTrc20Approve  → consumed by prepare_tron_token_approve.ts (Plan 19-01)
//   - decodeTronTrc20ApproveCall → consumed by preview_send.ts TRON branch (Plan 19-01)
//   - _tronApprove            → ESM spy-affordance; test seam per CLAUDE.md convention

import type { TronWeb } from "tronweb";

import { formatTronAddress } from "../chains/tron/address.js";
import { U256_MAX } from "../signing/amount-tron.js";
import type { TronInstructionSummary } from "../signing/handle-store.js";

// ────────────────────────────────────────────────────────────────────────────
// Selector constant
// ────────────────────────────────────────────────────────────────────────────

/**
 * ABI selector for `approve(address,uint256)`. 4 bytes = 8 hex chars.
 * tronweb convention: NO 0x prefix in the selector string.
 * This is the first 4 bytes of keccak256("approve(address,uint256)").
 */
export const TRON_APPROVE_SELECTOR = "095ea7b3";

// ────────────────────────────────────────────────────────────────────────────
// Encoder result type
// ────────────────────────────────────────────────────────────────────────────

/**
 * Full encode result returned by `encodeTronTrc20Approve`. Carries all fields
 * needed by `prepare_tron_token_approve` to build the `PreparedTxTron` shape +
 * PREPARE RECEIPT block + structured response. Mirrors `TronTrc20EncodeResult`
 * from `tron-trc20.ts` (Plan 18-03).
 */
export interface TronApproveEncodeResult {
  /** The tronweb `Transaction<TriggerSmartContract>` object (after extendExpiration). */
  transaction: unknown;
  /** Canonical Protobuf-serialized raw_data hex string (no 0x prefix). Source of payloadFingerprint. */
  rawDataHex: string;
  /** Byte view of rawDataHex — input to `computeTronPayloadFingerprint`. */
  rawDataBytes: Uint8Array;
  /** Original tronweb `raw_data` object (typed as `unknown` to avoid SDK type leak). Plan 18-04 broadcast reconstruction. */
  rawDataObject: unknown;
  /** Pinned ref_block_bytes from prepare time (verbatim from tronweb response). */
  refBlockBytes: string;
  /** Pinned ref_block_hash from prepare time (verbatim from tronweb response). */
  refBlockHash: string;
  /** Extended expiration timestamp (ms). After `extendExpiration(tx, 900)`, this is `block_timestamp + 900_000ms`. */
  expiration: number;
  /** Base58check token contract address — verbatim from input. */
  contractAddress: string;
  /** Decoded instruction summary — NOT populated here; caller builds it based on rawAmount. */
  instructionSummary: TronInstructionSummary[];
}

// ────────────────────────────────────────────────────────────────────────────
// Encoder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Encode a TRON TRC-20 approve (TriggerSmartContract with `approve(address,uint256)` ABI).
 *
 * Steps:
 *   1. Call `transactionBuilder.triggerSmartContract(tokenAddress, "approve(address,uint256)",
 *      { feeLimit: 100_000_000, callValue: 0 }, [{ type: "address", value: spender },
 *      { type: "uint256", value: amount.toString() }], from)`.
 *      - `feeLimit: 100_000_000` = 100 TRX hardcoded cap per RESEARCH §Topic 3 +
 *        CONTEXT D-11. Approve energy ≈ comparable to transfer — 100 TRX is a
 *        generous cap for Phase 19's 4-stablecoin TRON set.
 *      - `callValue: 0` = no TRX value attached (TRC-20 approve is non-payable).
 *      - `amount.toString()` is LOAD-BEARING: tronweb's ABI encoder accepts uint256
 *        as a decimal string. Passing a native bigint directly would be silently
 *        coerced to Number, losing precision above Number.MAX_SAFE_INTEGER.
 *   2. Verify `result.result?.result === true` AND `result.transaction !== undefined`.
 *      Non-true result → throw `Error(...)`. Caller catches → `INTERNAL_ERROR` envelope.
 *   3. Call `transactionBuilder.extendExpiration(tx, 900)` — LOAD-BEARING per
 *      RESEARCH §Topic 5: default expiration is 60s; without extension any handle
 *      older than ~60s broadcasts an expired tx. Mirrors Plan 18-02/03's pattern.
 *   4. Extract `rawDataHex`, `rawDataBytes`, `rawDataObject`, `refBlockBytes`,
 *      `refBlockHash`, `expiration`.
 *   5. Returns encode result WITHOUT `instructionSummary` populated — the caller
 *      (`prepareTronApproveInternal`) builds the summary based on `rawAmount === "0"`
 *      discriminator to keep D-01 byte-identity: calldata is identical for both
 *      approve({S, 0n}) and revoke({S}) paths; the summary `kind` differs only at
 *      the surface layer.
 *
 * NEVER throws on normal RPC success. Propagates tronweb RPC errors and the
 * `result.result.result !== true` check as `Error` instances (catch in
 * `prepare_tron_token_approve` → `INTERNAL_ERROR` envelope).
 */
export async function encodeTronTrc20Approve(input: {
  tronWeb: TronWeb;
  from: string;
  tokenAddress: string;
  spender: string;
  amount: bigint;
}): Promise<Omit<TronApproveEncodeResult, "instructionSummary">> {
  // Step 1 — Build unsigned TriggerSmartContract tx via tronweb.
  // `amount.toString()` is CRITICAL: tronweb's ABI encoder accepts uint256 as a
  // decimal string. Passing a native bigint would be silently coerced to a Number,
  // losing precision for amounts > Number.MAX_SAFE_INTEGER (e.g. U256_MAX).
  const rawResult = await input.tronWeb.transactionBuilder.triggerSmartContract(
    input.tokenAddress,
    "approve(address,uint256)",
    { feeLimit: 100_000_000, callValue: 0 },
    [
      { type: "address", value: input.spender },
      { type: "uint256", value: input.amount.toString() },
    ],
    input.from,
  );
  const result = rawResult as unknown as {
    result: { result: boolean; message?: string };
    transaction?: unknown;
  };

  // Step 2 — Verify the build succeeded.
  // tronweb 6.x TransactionWrapper: `result.result.result === true` (nested boolean).
  if (!result.result?.result || !result.transaction) {
    throw new Error(
      "triggerSmartContract build failed: " + JSON.stringify(result.result),
    );
  }

  // Step 3 — Extend expiration. CRITICAL per RESEARCH §Topic 5.
  // `extendExpiration(tx, 900)` sets expiration to `block_timestamp + 900_000ms`
  // (900 seconds = 15 minutes), matching HANDLE_TTL_MS in handle-store.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let txUnknown = result.transaction as any;
  txUnknown = await input.tronWeb.transactionBuilder.extendExpiration(txUnknown, 900);

  const tx = txUnknown as {
    raw_data_hex: string;
    raw_data: {
      contract: Array<{
        type: string;
        parameter: {
          value: {
            owner_address: string;
            contract_address: string;
            data: string;
            call_value?: number;
          };
        };
      }>;
      ref_block_bytes: string;
      ref_block_hash: string;
      expiration: number;
      timestamp?: number;
    };
  };

  // Step 4 — Extract fields from the tronweb tx.
  const rawDataHex = tx.raw_data_hex;
  const rawDataBytes = new Uint8Array(Buffer.from(rawDataHex, "hex"));
  const rawDataObject = tx.raw_data;
  const refBlockBytes = tx.raw_data.ref_block_bytes;
  const refBlockHash = tx.raw_data.ref_block_hash;
  const expiration = tx.raw_data.expiration;

  return {
    transaction: tx,
    rawDataHex,
    rawDataBytes,
    rawDataObject,
    refBlockBytes,
    refBlockHash,
    expiration,
    contractAddress: input.tokenAddress,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Decoder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Discriminated-union decode result for `decodeTronTrc20ApproveCall`.
 * Mirrors `TronTrc20Decoded` shape from `src/protocols/tron-trc20.ts`.
 *
 * The `unknown` branch fires for:
 *   - Missing or malformed `raw_data.contract[0]`.
 *   - `type !== "TriggerSmartContract"`.
 *   - Data field shorter than 136 hex chars.
 *   - Selector !== `0x095ea7b3`.
 */
export type TronTrc20ApproveDecoded =
  | {
      kind: "approve";
      from: string;
      tokenAddress: string;
      spender: string;
      amount: bigint;
      /** D-02a strict-equality: `amount === U256_MAX`. */
      isUnlimited: boolean;
      selector: "0x095ea7b3";
    }
  | { kind: "unknown" };

/**
 * Decode the first contract of a TRON `TriggerSmartContract` approve transaction.
 * Returns a typed `{ kind: "approve", from, tokenAddress, spender, amount, isUnlimited, selector }` shape
 * for `approve(address,uint256)` calls; returns `{ kind: "unknown" }` for anything else.
 *
 * ABI layout (RESEARCH §Topic 8 — same as transfer, different selector):
 *   data[0..8]    — selector `"095ea7b3"` (4 bytes, no 0x prefix per tronweb convention)
 *   data[8..72]   — 32-byte left-padded spender address (last 40 hex chars are the actual address)
 *   data[72..136] — 32-byte big-endian uint256 amount
 *
 * NEVER throws — malformed input returns `{ kind: "unknown" }`.
 */
export function decodeTronTrc20ApproveCall(transaction: {
  raw_data: {
    contract: Array<{
      type: string;
      parameter: {
        value: {
          owner_address: string;
          contract_address: string;
          data: string;
          call_value?: number;
        };
      };
    }>;
  };
}): TronTrc20ApproveDecoded {
  try {
    if (
      !transaction ||
      !transaction.raw_data ||
      !Array.isArray(transaction.raw_data.contract) ||
      transaction.raw_data.contract.length === 0
    ) {
      return { kind: "unknown" };
    }

    const contract = transaction.raw_data.contract[0];
    if (!contract) return { kind: "unknown" };

    if (contract.type !== "TriggerSmartContract") {
      return { kind: "unknown" };
    }

    const value = contract.parameter?.value;
    if (!value || typeof value !== "object") return { kind: "unknown" };

    const { owner_address, contract_address, data } = value;

    if (
      typeof owner_address !== "string" ||
      typeof contract_address !== "string" ||
      typeof data !== "string"
    ) {
      return { kind: "unknown" };
    }

    // Verify data length: 4-byte selector + 32-byte spender + 32-byte amount = 68 bytes = 136 hex chars.
    if (data.length < 136) {
      return { kind: "unknown" };
    }

    // Extract and verify selector. tronweb convention: data hex has NO 0x prefix.
    const selectorHex = data.slice(0, 8);
    if (selectorHex !== TRON_APPROVE_SELECTOR) {
      return { kind: "unknown" };
    }
    const selector = "0x095ea7b3" as const;

    // Extract spender address from data[8..72]:
    //   data[8..8+64] is the 32-byte ABI-padded address.
    //   ABI left-pads with zeros so the address is in the LAST 40 hex chars.
    const spender20byteHex = data.slice(8 + 24, 8 + 64); // 40 hex chars = 20 bytes
    // Prepend TRON's 0x41 network prefix to form the 21-byte hex address.
    const spenderTronHex = "41" + spender20byteHex;
    const spenderBase58 = formatTronAddress(spenderTronHex);

    // Extract amount from data[72..136]: 32-byte big-endian uint256 = 64 hex chars.
    const amountHex = data.slice(8 + 64, 8 + 128);
    const amount = BigInt("0x" + amountHex);

    // Convert owner_address + contract_address from 0x41-prefixed hex → base58check.
    const fromBase58 = formatTronAddress(owner_address);
    const tokenAddressBase58 = formatTronAddress(contract_address);

    return {
      kind: "approve",
      from: fromBase58,
      tokenAddress: tokenAddressBase58,
      spender: spenderBase58,
      amount,
      isUnlimited: amount === U256_MAX,
      selector,
    };
  } catch {
    return { kind: "unknown" };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ESM spy-affordance
// ────────────────────────────────────────────────────────────────────────────

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * `prepare_tron_token_approve.ts` (Plan 19-01) and `prepare_tron_revoke_approval.ts`
 * (Plan 19-01) import `_tronApprove` and call through the indirection so tests
 * can `vi.spyOn(_tronApprove, "encodeTronTrc20Approve")` to intercept without
 * monkey-patching the production import path. Direct `vi.spyOn(module, "...")`
 * is a silent no-op for cross-export internal calls — ESM named-export bindings
 * are immutable (CLAUDE.md convention non-negotiable).
 */
export const _tronApprove = {
  encodeTronTrc20Approve,
  decodeTronTrc20ApproveCall,
};
