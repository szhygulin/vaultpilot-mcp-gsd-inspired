// TRON SunSwap V2 swap encoder + decoder. Phase 20 — Plan 20-01 (TRON-W-09).
//
// SunSwap V2 swap calldata layout (swapExactTokensForTokens):
//   selector:  0x38ed1739  (swapExactTokensForTokens(uint256,uint256,address[],address,uint256) — 4 bytes)
//   arg[0]:    32-byte big-endian uint256 amountIn
//   arg[1]:    32-byte big-endian uint256 amountOutMin
//   arg[2]:    32-byte offset for path (address[] dynamic array)
//   arg[3]:    32-byte left-padded `to` address
//   arg[4]:    32-byte big-endian uint256 deadline
//   path data: 32-byte length + 32 bytes per address (20-byte EVM address, left-padded)
//
// ENCODER uses tronweb.transactionBuilder.triggerSmartContract with the full
// function ABI signature as the selector string — tronweb handles ABI encoding
// for address[] internally. Note: tronweb converts base58check path addresses to
// 41-prefixed 21-byte hex internally; the resulting calldata uses 20-byte EVM
// address encoding in the ABI output (tronweb's internal ABI encoder normalizes
// to 20-byte EVM format per the swapExactTokensForTokens ABI). Executor verified
// this is correct for the SunSwap V2 router via TronGrid.
//
// DECODER uses viem.decodeFunctionData per RESEARCH § Topic 6 (cleaner than
// manual hex slice for a 5-arg tuple with a dynamic address[] arg). The decoded
// 20-byte EVM addresses are converted back to TRON base58check for display.
//
// D-feeLimit: `feeLimit: 200_000_000` = 200 TRX (swaps consume more energy than
//   approve which uses 100 TRX; 200 TRX is a generous cap for v2.1).
//
// D-extendExpiration: `extendExpiration(tx, 900)` — LOAD-BEARING per Phase 18/19
//   precedent. Default expiration is 60s; without extension any handle older than
//   ~60s broadcasts an expired tx. 900s = 15 min matches HANDLE_TTL_MS.
//
// ESM spy-affordance per CLAUDE.md convention: `_sunSwapTron` wraps the two
// exports so `vi.spyOn(_sunSwapTron, "encodeSunswapSwap")` intercepts at the
// prepare-tool boundary. Direct `vi.spyOn(module, "...")` is a silent no-op for
// cross-export internal calls (ESM named-export bindings are immutable).
//
// Sibling of `src/protocols/tron-approve.ts` (Plan 19-01 — approve encoder).
// Plan carve:
//   - encodeSunswapSwap   → consumed by prepare_sunswap_swap.ts (Plan 20-01)
//   - decodeSunswapSwapCall → consumed by preview_send.ts TRON branch (Plan 20-01)
//   - _sunSwapTron         → ESM spy-affordance; test seam per CLAUDE.md convention

import { decodeFunctionData } from "viem";
import type { TronWeb } from "tronweb";

import { formatTronAddress } from "../chains/tron/address.js";
import type { TronInstructionSummary } from "../signing/handle-store.js";

// ────────────────────────────────────────────────────────────────────────────
// Selector constant
// ────────────────────────────────────────────────────────────────────────────

/**
 * ABI selector for `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)`.
 * 4 bytes = 8 hex chars. tronweb convention: NO 0x prefix in the selector string.
 * First 4 bytes of keccak256("swapExactTokensForTokens(uint256,uint256,address[],address,uint256)").
 */
export const SUNSWAP_SWAP_SELECTOR = "38ed1739";

// ────────────────────────────────────────────────────────────────────────────
// SunSwap V2 Router ABI (minimal — only swapExactTokensForTokens for decoder)
// ────────────────────────────────────────────────────────────────────────────

const SUNSWAP_V2_ROUTER_ABI = [
  {
    type: "function" as const,
    name: "swapExactTokensForTokens",
    inputs: [
      { name: "amountIn", type: "uint256" as const },
      { name: "amountOutMin", type: "uint256" as const },
      { name: "path", type: "address[]" as const },
      { name: "to", type: "address" as const },
      { name: "deadline", type: "uint256" as const },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" as const }],
    stateMutability: "nonpayable" as const,
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Encoder result type
// ────────────────────────────────────────────────────────────────────────────

/**
 * Full encode result returned by `encodeSunswapSwap`. Carries all fields
 * needed by `prepare_sunswap_swap` to build the `PreparedTxTron` shape +
 * PREPARE RECEIPT block + structured response. Mirrors `TronApproveEncodeResult`
 * from `tron-approve.ts` (Plan 19-01).
 */
export interface TronSunswapSwapEncodeResult {
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
  /** SunSwap V2 Router base58check contract address — verbatim from input. */
  contractAddress: string;
  /** Decoded instruction summary — NOT populated here; caller builds it. */
  instructionSummary: TronInstructionSummary[];
}

// ────────────────────────────────────────────────────────────────────────────
// Encoder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Encode a TRON SunSwap V2 swap (TriggerSmartContract with
 * `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)` ABI).
 *
 * Steps:
 *   1. Call `transactionBuilder.triggerSmartContract(routerAddress,
 *      "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
 *      { feeLimit: 200_000_000, callValue: 0 },
 *      [amountIn, amountOutMin, path (address[]), to, deadline], from)`.
 *      - `feeLimit: 200_000_000` = 200 TRX per D-feeLimit above.
 *      - `callValue: 0` = no TRX value attached (swap is non-payable for TRC-20 pairs).
 *      - `amountIn.toString()` + `amountOutMin.toString()` are LOAD-BEARING:
 *        tronweb's ABI encoder accepts uint256 as decimal strings.
 *      - `path` is passed as `address[]` — each element is the TRON base58check
 *        address; tronweb converts internally.
 *      - `deadline.toString()` is the unix-seconds integer as a decimal string.
 *   2. Verify `result.result?.result === true` AND `result.transaction !== undefined`.
 *   3. Call `transactionBuilder.extendExpiration(tx, 900)` — LOAD-BEARING per D-extendExpiration.
 *   4. Extract `rawDataHex`, `rawDataBytes`, `rawDataObject`, `refBlockBytes`, `refBlockHash`, `expiration`.
 *   5. Returns encode result WITHOUT `instructionSummary` populated — caller builds it.
 *
 * NEVER throws on normal RPC success. Propagates tronweb RPC errors and the
 * `result.result.result !== true` check as `Error` instances (catch in
 * `prepare_sunswap_swap` → `INTERNAL_ERROR` envelope).
 */
export async function encodeSunswapSwap(input: {
  tronWeb: TronWeb;
  from: string;
  routerAddress: string;
  amountIn: bigint;
  amountOutMin: bigint;
  path: string[];
  to: string;
  deadline: number;
}): Promise<Omit<TronSunswapSwapEncodeResult, "instructionSummary">> {
  // Step 1 — Build unsigned TriggerSmartContract tx via tronweb.
  // `amountIn.toString()` + `amountOutMin.toString()` CRITICAL: tronweb's ABI
  // encoder accepts uint256 as decimal string. Passing a bigint directly would
  // be silently coerced to Number, losing precision above MAX_SAFE_INTEGER.
  const rawResult = await input.tronWeb.transactionBuilder.triggerSmartContract(
    input.routerAddress,
    "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
    { feeLimit: 200_000_000, callValue: 0 },
    [
      { type: "uint256", value: input.amountIn.toString() },
      { type: "uint256", value: input.amountOutMin.toString() },
      { type: "address[]", value: input.path },
      { type: "address", value: input.to },
      { type: "uint256", value: input.deadline.toString() },
    ],
    input.from,
  );
  const result = rawResult as unknown as {
    result: { result: boolean; message?: string };
    transaction?: unknown;
  };

  // Step 2 — Verify the build succeeded.
  if (!result.result?.result || !result.transaction) {
    throw new Error(
      "triggerSmartContract build failed: " + JSON.stringify(result.result),
    );
  }

  // Step 3 — Extend expiration. CRITICAL per D-extendExpiration.
  // `extendExpiration(tx, 900)` sets expiration to `block_timestamp + 900_000ms`.
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
    contractAddress: input.routerAddress,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Decoder
// ────────────────────────────────────────────────────────────────────────────

/**
 * Discriminated-union decode result for `decodeSunswapSwapCall`.
 *
 * The `unknown` branch fires for:
 *   - Missing or malformed `raw_data.contract[0]`.
 *   - `type !== "TriggerSmartContract"`.
 *   - Data field shorter than 8 + 4*64 = 264 hex chars (4-byte selector + 4 uint256 head + dynamic data).
 *   - Selector !== `0x38ed1739`.
 *   - viem decode failure.
 */
export type TronSunswapSwapDecoded =
  | {
      kind: "swap";
      from: string;
      inputToken: string;
      outputToken: string;
      amountIn: bigint;
      amountOutMin: bigint;
      path: string[];
      to: string;
      deadline: number;
      selector: "0x38ed1739";
    }
  | { kind: "unknown" };

/**
 * Decode the first contract of a TRON `TriggerSmartContract` SunSwap V2 swap transaction.
 * Returns a typed shape for `swapExactTokensForTokens` calls; returns `{ kind: "unknown" }`
 * for anything else.
 *
 * Uses `viem.decodeFunctionData` per RESEARCH § Topic 6 — cleaner than manual hex slice
 * for the 5-arg tuple with a dynamic address[] arg.
 *
 * NEVER throws — malformed input returns `{ kind: "unknown" }`.
 */
export function decodeSunswapSwapCall(transaction: unknown): TronSunswapSwapDecoded {
  try {
    if (
      !transaction ||
      typeof transaction !== "object" ||
      !("raw_data" in transaction) ||
      !(transaction as { raw_data: unknown }).raw_data ||
      typeof (transaction as { raw_data: unknown }).raw_data !== "object"
    ) {
      return { kind: "unknown" };
    }

    const rawData = (transaction as { raw_data: { contract?: unknown[] } }).raw_data;
    if (
      !Array.isArray(rawData.contract) ||
      rawData.contract.length === 0
    ) {
      return { kind: "unknown" };
    }

    const contract = rawData.contract[0] as {
      type?: string;
      parameter?: {
        value?: {
          owner_address?: string;
          contract_address?: string;
          data?: string;
          call_value?: number;
        };
      };
    };

    if (!contract || contract.type !== "TriggerSmartContract") {
      return { kind: "unknown" };
    }

    const value = contract.parameter?.value;
    if (!value || typeof value !== "object") return { kind: "unknown" };

    const { owner_address, data } = value;

    if (
      typeof owner_address !== "string" ||
      typeof data !== "string"
    ) {
      return { kind: "unknown" };
    }

    // Minimum length: 8 hex chars selector + at least 4 * 64 = 256 hex chars for 4 fixed slots
    // (actual min with path of 2 addresses = 8 + 5*64 + 64 + 2*64 = 8 + 512 = 520)
    // Use a conservative min of 8 + 4*64 = 264 to catch obviously malformed data.
    if (data.length < 264) {
      return { kind: "unknown" };
    }

    // Check selector (no 0x prefix per tronweb convention)
    const selectorHex = data.slice(0, 8);
    if (selectorHex !== SUNSWAP_SWAP_SELECTOR) {
      return { kind: "unknown" };
    }

    // Use viem to decode the 5-arg ABI — handles the dynamic address[] cleanly
    const decoded = decodeFunctionData({
      abi: SUNSWAP_V2_ROUTER_ABI,
      data: `0x${data}` as `0x${string}`,
    });

    if (decoded.functionName !== "swapExactTokensForTokens") {
      return { kind: "unknown" };
    }

    const [amountIn, amountOutMin, pathEvmAddresses, to, deadline] = decoded.args as [
      bigint,
      bigint,
      readonly `0x${string}`[],
      `0x${string}`,
      bigint,
    ];

    // Convert EVM 20-byte hex addresses → TRON base58check for display
    // EVM address from viem: "0x" + 40 hex chars (20 bytes). TRON prefix = "41".
    const pathBase58 = (pathEvmAddresses as readonly `0x${string}`[]).map((addr) => {
      const hex20 = addr.slice(2).toLowerCase(); // strip "0x"
      return formatTronAddress("41" + hex20);
    });

    const toBase58 = formatTronAddress("41" + (to as string).slice(2).toLowerCase());
    const fromBase58 = formatTronAddress(owner_address);

    if (pathBase58.length < 2) return { kind: "unknown" };

    return {
      kind: "swap",
      from: fromBase58,
      inputToken: pathBase58[0]!,
      outputToken: pathBase58[pathBase58.length - 1]!,
      amountIn,
      amountOutMin,
      path: pathBase58,
      to: toBase58,
      deadline: Number(deadline),
      selector: "0x38ed1739",
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
 * `prepare_sunswap_swap.ts` (Plan 20-01) and `preview_send.ts` TRON branch
 * import `_sunSwapTron` and call through the indirection so tests can
 * `vi.spyOn(_sunSwapTron, "encodeSunswapSwap")` to intercept without
 * monkey-patching the production import path. Direct `vi.spyOn(module, "...")`
 * is a silent no-op for cross-export internal calls — ESM named-export bindings
 * are immutable (CLAUDE.md convention non-negotiable).
 */
export const _sunSwapTron = {
  encodeSunswapSwap,
  decodeSunswapSwapCall,
};
