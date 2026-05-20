// TRON native transfer encoder + decoder. Phase 18 — Plan 18-02.
//
// Sibling of `src/protocols/solana-system.ts` (Phase 12 / Plan 12-02).
// Consumed by:
//   - src/tools/prepare_tron_native_send.ts   (encodeTronTransfer via _tronNative)
//   - src/tools/preview_send.ts (TRON branch)  (decodeTronNativeCall — Plan 18-04)
//
// Format-fanout-sentinel rule (CLAUDE.md): TRON TransferContract wrapping is
// done ONLY here via `_tronNative.encodeTronTransfer`. Tools NEVER call
// tronweb's `transactionBuilder.sendTrx` directly — they route through this
// indirection so the test seam stays uniform.
//
// SDK reality (verified against tronweb@6.3.0 installed .d.ts):
//   - `transactionBuilder.sendTrx(to, amount, from)` accepts `number` for
//     amount (NOT bigint). Overflow guard fires before conversion:
//     sun > Number.MAX_SAFE_INTEGER → RangeError (TRON max balance ≈ 9e15 sun).
//   - `transactionBuilder.extendExpiration(tx, 900)` MUST be called after
//     `sendTrx` returns — extends the default 60s expiration to 900s (15min =
//     HANDLE_TTL_MS). RESEARCH §Topic 5 LOAD-BEARING finding.
//   - `transaction.raw_data_hex` is the canonical Protobuf preimage.
//     `Buffer.from(raw_data_hex, "hex")` produces the bytes input to
//     `_tronFingerprint.computeTronPayloadFingerprint({ rawDataBytes })`.
//   - `transaction.raw_data.contract[0].parameter.value` carries `owner_address`
//     + `to_address` (0x41-prefixed hex) + `amount` (number). Decoder uses
//     `formatTronAddress(hex)` to round-trip back to base58check.
//
// ESM spy-affordance per CLAUDE.md convention. `_tronNative` indirection is
// the test seam: `vi.spyOn(_tronNative, "encodeTronTransfer")` intercepts
// correctly across ESM module boundaries. Direct `vi.spyOn` on named exports
// is a silent no-op (ESM bindings are immutable).
//
// Anti-pattern guard — NEVER bare-import `getTronWeb` from
// `../chains/tron/registry.js`. Always go through
// `_tronRegistry.getTronWeb()` so the test spy seam is preserved.

import type { TronWeb } from "tronweb";

import { formatTronAddress } from "../chains/tron/address.js";
import { _tronRegistry } from "../chains/tron/registry.js";
import type { TronInstructionSummary } from "../signing/handle-store.js";

// Re-export the registry indirection so callers that need address validation
// can import `_tronNative` as a single import point. Not the primary use case
// but avoids a second import in `prepare_tron_native_send.ts`.
export { _tronRegistry };

/**
 * Full encode result returned by `encodeTronTransfer`. Carries all fields
 * needed by `prepare_tron_native_send` to build the `PreparedTxTron` shape +
 * PREPARE RECEIPT block + structured response.
 */
export interface TronNativeEncodeResult {
  /** The tronweb `Transaction<TransferContract>` object (after extendExpiration). */
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
  /** Extended expiration timestamp (ms). After `extendExpiration(tx, 900)`, this is `block_timestamp + 960_000ms` (≈ 15+ min). */
  expiration: number;
  /** Decoded instruction summary for the DECODED ARGS surface (Plan 18-04). */
  instructionSummary: TronInstructionSummary[];
}

/**
 * Encode a TRON native TRX transfer (TransferContract).
 *
 * Steps:
 *   1. Overflow-guard sun > Number.MAX_SAFE_INTEGER (Pitfall 1 — tronweb
 *      `sendTrx` takes `number`, not bigint; silent truncation if not guarded).
 *   2. Call `transactionBuilder.sendTrx(to, Number(sun), from)`.
 *   3. Call `transactionBuilder.extendExpiration(tx, 900)` — LOAD-BEARING per
 *      RESEARCH §Topic 5: default expiration is 60s; without extension, any
 *      handle older than ~60s produces `BROADCAST_FAILED: TRANSACTION_EXPIRATION_ERROR`.
 *   4. Extract `rawDataHex`, `rawDataBytes`, `rawDataObject`, `refBlockBytes`,
 *      `refBlockHash`, `expiration`.
 *   5. Build `instructionSummary[0]`.
 *
 * NEVER throws on normal RPC success. Throws `RangeError` for overflow or
 * propagates tronweb RPC errors unchanged (catch in `prepare_tron_native_send`
 * → `INTERNAL_ERROR` envelope).
 */
export async function encodeTronTransfer(input: {
  tronWeb: TronWeb;
  from: string;
  to: string;
  sun: bigint;
}): Promise<TronNativeEncodeResult> {
  // Step 1 — Overflow guard (Pitfall 1 from Phase 17 RESEARCH).
  // tronweb@6.3.0 `sendTrx` type is `amount?: number` — passing a bigint that
  // exceeds Number.MAX_SAFE_INTEGER would silently truncate the amount when
  // converted via Number(). TRON max supply is ~9e15 sun ≈ 9 billion TRX;
  // MAX_SAFE_INTEGER is ~9e15 so real-world balances are bounded, but an
  // adversarial input of 2^64 would silently become ~1.8e19 → truncated.
  if (input.sun > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      `sun overflows MAX_SAFE_INTEGER — TRON max balance is ~9e15 sun ≈ 9 billion TRX; reject before tronweb truncates. Got: ${input.sun.toString()}`,
    );
  }

  // Step 2 — Build the unsigned TransferContract tx via tronweb.
  let tx = await input.tronWeb.transactionBuilder.sendTrx(
    input.to,
    Number(input.sun),
    input.from,
  );

  // Step 3 — Extend expiration. CRITICAL per RESEARCH §Topic 5.
  // `extendExpiration(tx, 900)` sets expiration to `block_timestamp + 900_000ms`
  // (900 seconds = 15 minutes), matching HANDLE_TTL_MS in handle-store.ts.
  // Without this, tronweb's default is 60s — any user who pauses 60s+ between
  // prepare and send broadcasts an expired tx.
  tx = await input.tronWeb.transactionBuilder.extendExpiration(tx, 900);

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
      kind: "native-transfer",
      from: input.from,
      to: input.to,
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
 * Discriminated-union decode result for `decodeTronNativeCall`.
 * Mirror of `SolanaSystemDecoded` (`src/protocols/solana-system.ts`).
 *
 * The `unknown` branch fires for:
 *   - Missing or malformed `raw_data.contract[0]`.
 *   - `type !== "TransferContract"`.
 *   - Missing `parameter.value` fields.
 */
export type TronNativeDecoded =
  | { kind: "transfer"; from: string; to: string; sun: bigint }
  | { kind: "unknown" };

/**
 * Decode the first contract of a TRON `Transaction` object. Returns a typed
 * `{ kind: "transfer", from, to, sun }` shape for TransferContract instructions;
 * returns `{ kind: "unknown" }` for anything else.
 *
 * NEVER throws — malformed input (missing fields, wrong type, string-encoded
 * parameter.value) returns `{ kind: "unknown" }`. The deviation rule (Plan 18-02
 * §deviation 3) notes that some tronweb versions JSON-stringify the value; this
 * decoder handles that gracefully via the `|| { kind: "unknown" }` fallback.
 *
 * Caller (`preview_send` TRON branch Plan 18-04) falls back to a generic
 * "unrecognized instruction" surface on the unknown branch.
 */
export function decodeTronNativeCall(transaction: {
  raw_data: {
    contract: Array<{
      type: string;
      parameter: {
        value: { owner_address: string; to_address: string; amount: number };
      };
    }>;
  };
}): TronNativeDecoded {
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

    // Only decode TransferContract — other types (FreezeBalanceV2Contract,
    // TriggerSmartContract, etc.) route through their own decoders.
    if (contract.type !== "TransferContract") {
      return { kind: "unknown" };
    }

    // Defensive: handle the deviation-rule-3 case where parameter.value may be
    // a JSON string rather than an object (some tronweb versions serialize it).
    let value = contract.parameter?.value;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value) as typeof value;
      } catch {
        return { kind: "unknown" };
      }
    }

    if (!value || typeof value !== "object") return { kind: "unknown" };

    const { owner_address, to_address, amount } = value;

    if (
      typeof owner_address !== "string" ||
      typeof to_address !== "string" ||
      typeof amount !== "number"
    ) {
      return { kind: "unknown" };
    }

    // Convert 0x41-prefixed hex addresses back to base58check via Phase 17
    // helper (round-trip property proven in address.ts tests).
    const fromBase58 = formatTronAddress(owner_address);
    const toBase58 = formatTronAddress(to_address);

    return {
      kind: "transfer",
      from: fromBase58,
      to: toBase58,
      sun: BigInt(amount),
    };
  } catch {
    // Defense: any unexpected error (e.g. formatTronAddress throws on malformed
    // hex) returns { kind: "unknown" } rather than propagating.
    return { kind: "unknown" };
  }
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * `prepare_tron_native_send.ts` (Plan 18-02) and `preview_send.ts` TRON branch
 * (Plan 18-04) import `_tronNative` and call through the indirection so tests
 * can `vi.spyOn(_tronNative, "encodeTronTransfer")` to intercept without
 * monkey-patching the production import path. Direct `vi.spyOn(module, "...")` is
 * a silent no-op for cross-export internal calls — ESM named-export bindings are
 * immutable (CLAUDE.md convention non-negotiable).
 */
export const _tronNative = {
  encodeTronTransfer,
  decodeTronNativeCall,
};
