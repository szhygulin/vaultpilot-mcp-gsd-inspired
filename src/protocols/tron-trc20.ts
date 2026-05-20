// TRON TRC-20 transfer encoder + decoder. Phase 18 — Plan 18-03.
//
// TRC-20 calldata is ABI-identical to ERC-20 (RESEARCH §Topic 8):
//   selector:  0xa9059cbb  (transfer(address,uint256) — 4 bytes)
//   arg[0]:    32-byte left-padded recipient address
//   arg[1]:    32-byte big-endian raw token amount (uint256)
//   total:     68 bytes = 136 hex chars
//
// The ENCODER never inlines selector + arg encoding manually — tronweb's
// `transactionBuilder.triggerSmartContract` handles ABI encoding internally
// given `[{ type: "address", value: toBase58 }, { type: "uint256", value:
// amount.toString() }]`. The DECODER DOES manually slice the data hex (no
// external decoder dep for the TriggerSmartContract envelope's `data` field).
//
// This is structurally simpler than Solana SPL (`src/protocols/solana-spl.ts`,
// 407 LOC): TRC-20 transfers use a single contract address per token; balances
// and allowances are in the token contract's mapping — NO ATA derivation,
// no TransferChecked double-check discriminator.
//
// Plan carve:
//   - encodeTronTrc20Transfer → consumed by prepare_tron_trc20_send.ts (Plan 18-03)
//   - decodeTronTrc20Call    → consumed by preview_send.ts TRON branch (Plan 18-04)
//   - _tronTrc20             → ESM spy-affordance; test seam per CLAUDE.md convention
//
// Sibling of `src/protocols/tron-native.ts` (Plan 18-02 — TransferContract).
// ESM spy-affordance per CLAUDE.md convention.

import type { TronWeb } from "tronweb";

import { formatTronAddress } from "../chains/tron/address.js";
import type { TronInstructionSummary } from "../signing/handle-store.js";

// ────────────────────────────────────────────────────────────────────────────
// Encoder result type
// ────────────────────────────────────────────────────────────────────────────

/**
 * Full encode result returned by `encodeTronTrc20Transfer`. Carries all fields
 * needed by `prepare_tron_trc20_send` to build the `PreparedTxTron` shape +
 * PREPARE RECEIPT block + structured response.
 */
export interface TronTrc20EncodeResult {
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
  /** Base58check token contract address — verbatim from input. Consumed by Plan 18-04 Layer 0.5 canonical-dispatch-tron allowlist. */
  contractAddress: string;
  /** Decoded instruction summary for the DECODED ARGS surface (Plan 18-04). */
  instructionSummary: TronInstructionSummary[];
}

// ────────────────────────────────────────────────────────────────────────────
// Encoder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Encode a TRON TRC-20 transfer (TriggerSmartContract with `transfer(address,uint256)` ABI).
 *
 * Steps:
 *   1. Call `transactionBuilder.triggerSmartContract(tokenAddress, "transfer(address,uint256)",
 *      { feeLimit: 100_000_000, callValue: 0 }, [{ type: "address", value: to },
 *      { type: "uint256", value: amount.toString() }], from)`.
 *      - `feeLimit: 100_000_000` = 100 TRX hardcoded cap per RESEARCH §Topic 3 +
 *        CONTEXT D-11. USDT-TRC20 transfer ≈ 31,895 energy at ~420 sun/energy ≈ 13.4 TRX
 *        — 100 TRX is a generous cap sufficient for Phase 18's USDT/USDC/USDD/TUSD set.
 *      - `callValue: 0` = no TRX value attached (TRC-20 transfer is non-payable).
 *      - `amount.toString()` — tronweb's parameter encoding accepts uint256 as a decimal
 *        string; passing `bigint` directly would be silently truncated to `Number` on the
 *        SDK boundary per RESEARCH §Topic 1 boundary-discipline.
 *   2. Verify `result.result?.result === true` AND `result.transaction !== undefined`.
 *      Non-true result → throw `Error(...)`. Caller catches → `INTERNAL_ERROR` envelope.
 *   3. Call `transactionBuilder.extendExpiration(tx, 900)` — LOAD-BEARING per
 *      RESEARCH §Topic 5: default expiration is 60s; without extension any handle
 *      older than ~60s broadcasts an expired tx. Mirrors Plan 18-02's pattern exactly.
 *   4. Extract `rawDataHex`, `rawDataBytes`, `rawDataObject`, `refBlockBytes`,
 *      `refBlockHash`, `expiration`.
 *   5. Build `instructionSummary[0]` with kind: "trc20-transfer".
 *
 * NEVER throws on normal RPC success. Propagates tronweb RPC errors and the
 * `result.result.result !== true` check as `Error` instances (catch in
 * `prepare_tron_trc20_send` → `INTERNAL_ERROR` envelope).
 */
export async function encodeTronTrc20Transfer(input: {
  tronWeb: TronWeb;
  from: string;
  to: string;
  tokenAddress: string;
  amount: bigint;
  decimals: number;
}): Promise<TronTrc20EncodeResult> {
  // Step 1 — Build unsigned TriggerSmartContract tx via tronweb.
  // `amount.toString()` is critical: tronweb's ABI encoder accepts uint256 as a
  // decimal string. Passing a native bigint would be silently coerced to a Number,
  // losing precision for amounts > Number.MAX_SAFE_INTEGER.
  // `unknown` cast used for result to avoid SDK-internal type coupling.
  const rawResult = await input.tronWeb.transactionBuilder.triggerSmartContract(
    input.tokenAddress,
    "transfer(address,uint256)",
    { feeLimit: 100_000_000, callValue: 0 },
    [
      { type: "address", value: input.to },
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
  // Use `unknown` cast at the boundary: extendExpiration<T>(t: T) => T, but our
  // narrowed shape is not assignable to tronweb's Transaction<ContractParamter>.
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

  // Step 5 — Build instruction summary.
  const instructionSummary: TronInstructionSummary[] = [
    {
      kind: "trc20-transfer",
      from: input.from,
      to: input.to,
      tokenAddress: input.tokenAddress,
      amount: input.amount,
      decimals: input.decimals,
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
    contractAddress: input.tokenAddress,
    instructionSummary,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Decoder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Discriminated-union decode result for `decodeTronTrc20Call`.
 * Mirrors `TronNativeDecoded` shape from `src/protocols/tron-native.ts`.
 *
 * The `unknown` branch fires for:
 *   - Missing or malformed `raw_data.contract[0]`.
 *   - `type !== "TriggerSmartContract"`.
 *   - Data field shorter than 136 hex chars (4-byte selector + 32-byte to + 32-byte amount).
 *   - Selector !== `0xa9059cbb`.
 */
export type TronTrc20Decoded =
  | {
      kind: "transfer";
      from: string;
      to: string;
      tokenAddress: string;
      amount: bigint;
      selector: "0xa9059cbb";
    }
  | { kind: "unknown" };

/**
 * Decode the first contract of a TRON `TriggerSmartContract` transaction.
 * Returns a typed `{ kind: "transfer", from, to, tokenAddress, amount, selector }` shape
 * for `transfer(address,uint256)` calls; returns `{ kind: "unknown" }` for anything else.
 *
 * ABI layout (RESEARCH §Topic 8):
 *   data[0..8]    — selector `"a9059cbb"` (4 bytes, no 0x prefix per tronweb convention)
 *   data[8..72]   — 32-byte left-padded address (last 20 bytes = 40 hex chars are the actual address)
 *   data[72..136] — 32-byte big-endian uint256 amount
 *
 * NEVER throws — malformed input returns `{ kind: "unknown" }`.
 */
export function decodeTronTrc20Call(transaction: {
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
}): TronTrc20Decoded {
  try {
    // Defensive: guard against undefined/null raw_data or empty contract array.
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

    // Only decode TriggerSmartContract — TransferContract, FreezeBalanceV2Contract,
    // etc. route through their own decoders.
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

    // Verify data length: 4-byte selector + 32-byte address + 32-byte amount = 68 bytes = 136 hex chars.
    if (data.length < 136) {
      return { kind: "unknown" };
    }

    // Extract and verify selector. tronweb convention: data hex has NO 0x prefix.
    const selectorHex = data.slice(0, 8);
    if (selectorHex !== "a9059cbb") {
      return { kind: "unknown" };
    }
    const selector = "0xa9059cbb" as const;

    // Extract recipient address from data[8..72]:
    //   data[8..8+64] is the 32-byte ABI-padded address.
    //   ABI left-pads with zeros so the address is in the LAST 40 hex chars of that slot.
    //   i.e., data[8+24..8+64] = the 20-byte address = 40 hex chars.
    const to20byteHex = data.slice(8 + 24, 8 + 64); // 40 hex chars = 20 bytes
    // Prepend TRON's 0x41 network prefix to form the 21-byte hex address.
    const toTronHex = "41" + to20byteHex;
    const toBase58 = formatTronAddress(toTronHex);

    // Extract amount from data[72..136]: 32-byte big-endian uint256 = 64 hex chars.
    const amountHex = data.slice(8 + 64, 8 + 128);
    const amount = BigInt("0x" + amountHex);

    // Convert owner_address + contract_address from 0x41-prefixed hex → base58check.
    // tronweb returns these as 0x41-prefixed hex strings in the decoded parameter.value.
    const fromBase58 = formatTronAddress(owner_address);
    const tokenAddressBase58 = formatTronAddress(contract_address);

    return {
      kind: "transfer",
      from: fromBase58,
      to: toBase58,
      tokenAddress: tokenAddressBase58,
      amount,
      selector,
    };
  } catch {
    // Defense: any unexpected error (e.g. formatTronAddress throws on malformed hex)
    // returns { kind: "unknown" } rather than propagating.
    return { kind: "unknown" };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ESM spy-affordance
// ────────────────────────────────────────────────────────────────────────────

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * `prepare_tron_trc20_send.ts` (Plan 18-03) and `preview_send.ts` TRON branch
 * (Plan 18-04) import `_tronTrc20` and call through the indirection so tests
 * can `vi.spyOn(_tronTrc20, "encodeTronTrc20Transfer")` to intercept without
 * monkey-patching the production import path. Direct `vi.spyOn(module, "...")`
 * is a silent no-op for cross-export internal calls — ESM named-export bindings
 * are immutable (CLAUDE.md convention non-negotiable).
 */
export const _tronTrc20 = {
  encodeTronTrc20Transfer,
  decodeTronTrc20Call,
};
