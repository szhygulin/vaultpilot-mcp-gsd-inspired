// TRON preview-time simulation helper. DF-3 LOCKED — research § Topic 3
// (mandatory TRC-20 simulation gate; native TRX advisory). Sibling of
// `src/signing/simulation-solana.ts` (Solana — FROZEN).
//
// Classifier-vs-consumer split. The consumer (preview_send.ts TRON branch —
// Plan 18-04) enforces the asymmetric posture: TRC-20 path PROMOTES
// `status !== "ok"` to `SIMULATION_REFUSED`; native TRX path uses
// `emitNoSimulationAvailable()` sentinel + emits `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE`
// block (advisory, NOT refusal). Asymmetry documented in SECURITY.md TRON
// sub-section (5).
//
// CRITICAL DISTINCTION from the EVM analog: the EVM helper's TRUST-BOUNDARY
// INVARIANT documents simulation as a USABILITY signal — preview_send emits
// the SIMULATION block but DOES NOT refuse on revert for EVM. The TRON
// helper classifies TRC-20 calls as MANDATORY (same posture as Solana);
// native TRX has NO simulation API at all, so `emitNoSimulationAvailable()`
// returns a typed `not-applicable` sentinel.
//
// The NEVER-THROWS contract (mirrors simulation-solana.ts) means RPC failures
// demote to `status: "error"` — the consumer still refuses preview at the
// DF-3 gate. The helper NEVER throws; classification is the consumer's job.
//
// Cross-ref: research § Topic 3 (TronGrid triggerconstantcontract envelope
// shape + revert-reason extraction via `Error(string)` ABI selector) +
// research § Topic 1 (DF-1 + DF-2 — binding layer sits above this gate).

import type { TronWeb } from "tronweb";

/**
 * Classification of a TRON simulation result.
 *
 *   - `ok`               — `result.result === true` (call would succeed).
 *                          Consumer (TRC-20 path) proceeds to preview emit.
 *   - `revert`           — `result.code === "REVERT"` — Solidity `revert()` /
 *                          `require(false, reason)`. Consumer refuses with
 *                          SIMULATION_REFUSED (TRC-20) or surfaces advisory
 *                          (if native arm ever uses this — not in v1.x).
 *   - `energy-required`  — `result.result === false` with non-REVERT code
 *                          (e.g. `OUT_OF_ENERGY`, `OUT_OF_BANDWIDTH`).
 *                          Consumer refuses with SIMULATION_REFUSED for
 *                          TRC-20. Distinct from `revert` so the consumer
 *                          can emit a more specific cause string.
 *   - `error`            — RPC failure (network down, timeout, unreachable).
 *                          Consumer treats this as a simulation refusal AT
 *                          THE SAME GATE as a revert per DF-3 — the user
 *                          MUST NOT be asked to blind-sign a TRC-20 tx whose
 *                          outcome we could not classify. NEVER thrown —
 *                          the wrapper demotes to this envelope.
 *   - `not-applicable`   — Returned by `emitNoSimulationAvailable()` for
 *                          native TRX (`TransferContract`). TronGrid's
 *                          `triggerconstantcontract` endpoint is for smart-
 *                          contract view/pure calls only; native TRX has no
 *                          simulation API. Consumer emits the
 *                          `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE` advisory.
 */
export type TronSimulationStatus =
  | "ok"
  | "revert"
  | "energy-required"
  | "error"
  | "not-applicable";

export interface TronSimulationResult {
  /** Classified status — consumer (preview_send TRON branch) enforces. */
  status: TronSimulationStatus;
  /** Decoded Solidity revert reason on `status: "revert"`; `null` otherwise. */
  revertReason: string | null;
  /** Estimated energy consumed (`bigint`) on ok/revert; `null` on error/not-applicable. */
  energyUsed: bigint | null;
  /** Forwarded verbatim from `constant_result`; empty array on error/not-applicable. */
  constantResult: string[];
  /** Populated only on `status: "error"` — the RPC-layer error message. */
  rpcError?: string;
}

/**
 * Attempt to decode a Solidity `Error(string)` revert reason from
 * `constant_result[0]`. The encoding is:
 *   selector (4 bytes) = 0x08c379a0  ("Error(string)" keccak selector)
 *   offset   (32 bytes) = 0x0000...0020
 *   length   (32 bytes) = <string byte length>
 *   data     (padded)   = <utf-8 string bytes>
 *
 * Returns the decoded reason string, or `null` if the data is absent /
 * malformed / uses a custom error ABI (which is not decodable without the ABI).
 */
function decodeRevertReason(constantResult: string[]): string | null {
  if (!constantResult || constantResult.length === 0) return null;
  const hexData = constantResult[0];
  if (!hexData) return null;
  // Normalize: strip leading 0x if present
  const data = hexData.startsWith("0x") ? hexData.slice(2) : hexData;
  // Minimum length for a non-empty Error(string):
  //   4 (selector) + 32 (offset) + 32 (length) + 32 (1 word of data) = 100 bytes = 200 hex chars
  if (data.length < 136) return null;
  // Check selector: 08c379a0
  if (data.slice(0, 8).toLowerCase() !== "08c379a0") return null;
  try {
    // Skip selector (4 bytes = 8 hex chars) + offset (32 bytes = 64 hex chars)
    const lengthHex = data.slice(8 + 64, 8 + 64 + 64);
    const strByteLen = parseInt(lengthHex, 16);
    if (isNaN(strByteLen) || strByteLen <= 0) return null;
    const strHexStart = 8 + 64 + 64;
    const strHex = data.slice(strHexStart, strHexStart + strByteLen * 2);
    const reason = Buffer.from(strHex, "hex").toString("utf8");
    return reason;
  } catch {
    return null;
  }
}

/**
 * Run a preview-time `triggerConstantContract` call against TronGrid (or the
 * configured `TRON_RPC_URL` override) for the prepared TRC-20 transaction.
 * NEVER throws — every input shape returns a `TronSimulationResult`.
 *
 * The consumer (Plan 18-04 `preview_send` TRON branch) enforces DF-3:
 * `status !== "ok"` for TRC-20 → `SIMULATION_REFUSED` refusal envelope.
 * This helper stays a pure classifier; the consumer owns the policy.
 *
 * @param input.tronWeb      — Initialized TronWeb instance (from TRON RPC client).
 * @param input.contractAddress — Base58check token contract address.
 * @param input.functionSelector — ABI function selector string, e.g. `"transfer(address,uint256)"`.
 * @param input.parameters   — ABI-typed parameter array, e.g. `[{ type: "address", value: "T..." }, ...]`.
 * @param input.ownerAddress — Base58check sender address (the `owner_address` field).
 */
export async function runTronPreviewSimulation(input: {
  tronWeb: TronWeb;
  contractAddress: string;
  functionSelector: string;
  parameters: Array<{ type: string; value: unknown }>;
  ownerAddress: string;
}): Promise<TronSimulationResult> {
  try {
    const result = await input.tronWeb.transactionBuilder.triggerConstantContract(
      input.contractAddress,
      input.functionSelector,
      { feeLimit: 100_000_000 },
      input.parameters,
      input.ownerAddress,
    );

    // Edge case: contract doesn't exist on TronGrid returns undefined result
    if (!result || result.result === undefined) {
      return {
        status: "error",
        revertReason: null,
        energyUsed: null,
        constantResult: [],
        rpcError: "contract-not-found",
      };
    }

    // tronweb's .d.ts narrows `result.result` to `{ result: boolean; message?:
    // string }` but the runtime envelope includes `code` (e.g. `REVERT`,
    // `OUT_OF_ENERGY`) — widen the local view to match what TronGrid returns.
    const simResult = result.result as {
      result: boolean;
      code?: string;
      message?: string;
    };
    const energyUsed: bigint = BigInt(result.energy_used ?? 0);
    const constantResult: string[] = result.constant_result ?? [];

    if (simResult.result === true) {
      return {
        status: "ok",
        revertReason: null,
        energyUsed,
        constantResult,
      };
    }

    if (simResult.code === "REVERT") {
      const revertReason = decodeRevertReason(constantResult);
      return {
        status: "revert",
        revertReason,
        energyUsed,
        constantResult,
      };
    }

    // Any other non-true result code (OUT_OF_ENERGY, OUT_OF_BANDWIDTH, etc.)
    return {
      status: "energy-required",
      revertReason: null,
      energyUsed,
      constantResult,
    };
  } catch (err) {
    // NEVER-THROWS contract (mirrors `simulation-solana.ts` TRUST-BOUNDARY
    // INVARIANT — the wrapper is best-effort; classification is the
    // consumer's job). RPC failures demote to `status: "error"`; the
    // consumer still refuses TRC-20 preview at the DF-3 gate.
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      revertReason: null,
      energyUsed: null,
      constantResult: [],
      rpcError: message,
    };
  }
}

/**
 * Return the constant `not-applicable` sentinel for native TRX
 * (`TransferContract`). TronGrid's `triggerconstantcontract` endpoint is
 * for smart-contract view/pure calls only; `TransferContract` has no
 * on-chain simulation API.
 *
 * The consumer (Plan 18-04 `preview_send` native TRX path) emits
 * `NO_SIMULATION_AVAILABLE_TRON_TEMPLATE` advisory instead of refusing.
 * The defense for native TRX relies entirely on PREPARE RECEIPT (Inv #2) +
 * LEDGER BLIND-SIGN HASH (Inv #5). This is intentional asymmetry with TRC-20.
 *
 * Returns a uniform `TronSimulationResult` shape so the preview_send TRON
 * branch can handle both paths without type narrowing.
 */
export function emitNoSimulationAvailable(): TronSimulationResult {
  return {
    status: "not-applicable",
    revertReason: null,
    energyUsed: null,
    constantResult: [],
  };
}

/**
 * ESM spy-affordance per CLAUDE.md convention. Plan 18-04's `preview_send`
 * TRON branch imports `_simulationTron` and calls through this object so
 * tests can spy on `runTronPreviewSimulation` + `emitNoSimulationAvailable`
 * without monkey-patching the production import path.
 */
export const _simulationTron = { runTronPreviewSimulation, emitNoSimulationAvailable };
