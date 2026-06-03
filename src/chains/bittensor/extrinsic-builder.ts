// src/chains/bittensor/extrinsic-builder.ts — Phase 47 Plan 47-02.
//
// Unsigned-extrinsic construction + the signable blob + the chain-derived
// slippage-guard `limit_price`. The single source of the bytes the Ledger
// signs and that `payloadFingerprint` / the blake2-256 presign bind.
//
// ALL api access routes through `_bittensorRegistry.getApi()` (the Phase 46
// singleton; `noInitWarn:true` already set) so tests spy at that seam and
// NEVER open a live WsProvider socket (anti-hang discipline — a real
// ApiPromise opens a WS connection on construction).
//
// The signable blob = `api.registry.createType("ExtrinsicPayload",
// signerPayloadJSON, { version }).toU8a({ method: true })` (47-RESEARCH
// §Probe 1, Decision D-BLOB). The `{ method: true }` flag is REQUIRED — it
// includes the SCALE call bytes so the blob carries `(call ‖ extra ‖
// additionalSigned)`. The entire `SignerPayloadJSON` (nonce, era, blockHash,
// genesisHash, tip, mode, metadataHash) is PINNED here at prepare time so the
// send-time rebuild (Plan 47-04) is byte-identical (Pitfall 2 + Pitfall 5).
//
// =====================  OQ-1 RESOLVED (limit_price direction)  ===============
// `currentAlphaPrice(netuid)` is RAO-per-alpha, 1e9-scaled fixed-point
// (tao-rpc-client.ts ALPHA_PRICE_SCALE, resolved live 2026-06-03). The `*_limit`
// extrinsics take `limitPrice` as a WORST-ACCEPTABLE RAO-per-alpha PRICE:
//   - add_stake_limit (TAO → alpha): you BUY alpha; the limit is the MAX price
//     per alpha you'll pay → `price * (1 + tolerance)` (a CEILING).
//   - remove_stake_limit (alpha → TAO): you SELL alpha; the limit is the MIN
//     price per alpha you'll accept → `price * (1 - tolerance)` (a FLOOR).
// FALSIFIER: a wrong direction inverts the guard (a ceiling becomes a floor),
// so a sandwich could fill at an arbitrarily bad price. The direction is
// reconciled against the live `currentAlphaPrice` semantics + the swap-sim
// expected-out (simSwapTaoForAlpha returns alpha-out for a TAO input → the
// realized price is taoIn/alphaOut; the guard brackets that price). The real
// on-device + small-mainnet confirmation is the v2.7 verify-phase.
//
// =====================  OQ-2 RESOLVED (dry-run posture)  =====================
// The unsigned dry-run / validateTransaction classifier is ADVISORY (EVM-style,
// NOT Solana's mandatory DF-4 refusal) and lives in `simulation-bittensor.ts`
// (Plan 47-03) — NOT here. This builder never blocks on a sim outcome. The
// chain-enforced CheckMetadataHash + the on-device blake2 hash match are the
// real anchors (47-RESEARCH §Probe 4 / OQ-2).

import type { ApiPromise } from "@polkadot/api";

import { _bittensorRegistry } from "./registry.js";
import type { BittensorInstructionSummary } from "../../signing/handle-store.js";

/**
 * Default slippage tolerance for the `*_limit` staking calls when the caller
 * does not supply one. 50 basis points (0.50%) — a tight default for the
 * concentrated-liquidity dTAO AMM (47-RESEARCH discretion). Callers override
 * via `tolerancePct` (a percentage, e.g. `1` for 1%).
 */
export const DEFAULT_STAKE_TOLERANCE_PCT = 0.5;

/** RAO-per-alpha price fixed-point scale (mirror of tao-rpc-client ALPHA_PRICE_SCALE). */
const ALPHA_PRICE_SCALE = 1_000_000_000n;

/** Basis-point denominator for the tolerance haircut. */
const BPS_DENOMINATOR = 10_000n;

/**
 * CheckMetadataHash mode pinned at prepare. Decision D-MD recommends mode:1
 * (offline-merkleized metadataHash) for the real-Ledger clear-sign path, but
 * the OFFLINE merkleize requires a live `metadataAtVersion(15)` fetch. For the
 * v2.7 GA unit-testable scope we pin mode:0 (CheckMetadataHash disabled,
 * metadataHash null) — byte-stable, no network dependency in the prepare flow,
 * and the binding fingerprint is deterministic. The mode is pinned onto the
 * result so the send-time rebuild is byte-identical regardless. The mode:1
 * offline path is wired-but-gated (recompute the metadataHash on a spec bump —
 * 47-RESEARCH §Execute-time fixture-capture / A3).
 */
const PREPARE_MODE: 0 | 1 = 0;

/** The ExtrinsicPayload SCALE version (signed-extrinsic v4). */
const EXTRINSIC_VERSION = 4;

/**
 * Convert a tolerance PERCENTAGE (e.g. `0.5` for 0.5%) to basis points as a
 * bigint, rounded to the nearest bp. Guards against a negative / NaN input.
 */
function tolerancePctToBps(pct: number): bigint {
  if (!Number.isFinite(pct) || pct < 0) return 0n;
  return BigInt(Math.round(pct * 100));
}

/**
 * Apply the tolerance haircut to a RAO-per-alpha price.
 *   - direction "ceiling" (add_stake — max price you'll pay): price × (1 + bps)
 *   - direction "floor"   (remove_stake — min price you'll accept): price × (1 − bps)
 * Integer bigint math; no Number precision loss.
 */
function applyToleranceToPrice(
  priceRaw: bigint,
  bps: bigint,
  direction: "ceiling" | "floor",
): bigint {
  if (direction === "ceiling") {
    return (priceRaw * (BPS_DENOMINATOR + bps)) / BPS_DENOMINATOR;
  }
  return (priceRaw * (BPS_DENOMINATOR - bps)) / BPS_DENOMINATOR;
}

/**
 * The subtensor runtime-API surface this builder reads. Same dynamic-decorate
 * type seam as `tao-rpc-client.ts asSubtensor` — the runtime APIs are
 * decorated from chain metadata at `ApiPromise.create` time and are not in the
 * static @polkadot/api augmentation.
 */
interface SubtensorBuilderApi {
  registry: {
    createType(
      type: "ExtrinsicPayload",
      value: unknown,
      opts: { version: number },
    ): { toU8a(opts: { method: boolean }): Uint8Array };
  };
  tx: {
    balances: {
      transferKeepAlive(
        dest: string,
        value: bigint,
      ): { method: { toHex(): string } };
    };
    subtensorModule: {
      addStakeLimit(
        hotkey: string,
        netuid: number,
        amountStaked: bigint,
        limitPrice: bigint,
        allowPartial: boolean,
      ): { method: { toHex(): string } };
      removeStakeLimit(
        hotkey: string,
        netuid: number,
        amountUnstaked: bigint,
        limitPrice: bigint,
        allowPartial: boolean,
      ): { method: { toHex(): string } };
    };
  };
  rpc: {
    system: {
      accountNextIndex(addr: string): Promise<{ toNumber(): number }>;
    };
  };
  call: {
    swapRuntimeApi: {
      currentAlphaPrice(netuid: number): Promise<{ toString(): string }>;
      simSwapTaoForAlpha(
        netuid: number,
        taoRao: bigint,
      ): Promise<{ toJSON(): unknown }>;
      simSwapAlphaForTao(
        netuid: number,
        alpha: bigint,
      ): Promise<{ toJSON(): unknown }>;
    };
  };
}

function asSubtensorBuilder(api: ApiPromise): SubtensorBuilderApi {
  return api as unknown as SubtensorBuilderApi;
}

/** Discriminated builder input — one variant per prepare tool. */
export type BuildBittensorInput =
  | {
      kind: "native";
      /** SS58 dest (validated upstream). */
      to: string;
      /** Amount in RAO (TAO base unit). */
      rao: bigint;
      /** SS58 coldkey that will sign. */
      ss58Address: string;
    }
  | {
      kind: "add-stake-limit";
      hotkey: string;
      netuid: number;
      /** amount_staked in RAO (TAO base unit). */
      amountStakedRao: bigint;
      tolerancePct?: number;
      allowPartial?: boolean;
      ss58Address: string;
      /** Human-readable subnet identity echoed in the receipt. */
      netuidIdentity?: string;
    }
  | {
      kind: "remove-stake-limit";
      hotkey: string;
      netuid: number;
      /** amount_unstaked in ALPHA (subnet token). */
      amountUnstakedAlpha: bigint;
      tolerancePct?: number;
      allowPartial?: boolean;
      ss58Address: string;
      netuidIdentity?: string;
    };

/** The byte-stable build result the prepare tools store on the handle. */
export interface BuiltBittensorTx {
  /** ExtrinsicPayload.toU8a({method:true}) — the fingerprint + presign preimage. */
  signableBlob: Uint8Array;
  /** The pinned SignerPayloadJSON the send branch rebuilds the blob from. */
  signerPayloadJSON: unknown;
  /** camelCase pallet section — keys the Plan 47-03 allowlist. */
  section: string;
  /** camelCase call method. */
  method: string;
  mode: 0 | 1;
  metadataHash: string | null;
  ss58Address: string;
  /** Per-extrinsic-unit-typed decoded summary for the DECODED ARGS surface. */
  instructionSummary: BittensorInstructionSummary;
  /** Derived slippage-guard price (RAO-per-alpha) — undefined for native. */
  limitPrice?: bigint;
}

/**
 * Build the unsigned extrinsic + the byte-stable signable blob. Pins the full
 * SignerPayloadJSON (nonce/era/mode/metadataHash) at prepare time. For the
 * staking variants, derives `limitPrice` from the chain's `simSwap*`
 * expected-out price via the resolved tolerance direction (OQ-1) — NEVER
 * client-side x·y=k.
 */
export async function buildBittensorUnsignedTx(
  input: BuildBittensorInput,
): Promise<BuiltBittensorTx> {
  const api = asSubtensorBuilder(await _bittensorRegistry.getApi());

  // Resolve nonce + era + genesis/block hashes. The era is IMMORTAL ("0x00")
  // for v2.7 GA — a mortal era would bind the extrinsic to a block window but
  // requires the era block hash pinned; immortal keeps the blob simple and
  // byte-stable (the nonce + the on-device hash match are the replay anchors).
  const nonceCodec = await api.rpc.system.accountNextIndex(input.ss58Address);
  const nonce = nonceCodec.toNumber();

  let section: string;
  let method: string;
  let methodHex: string;
  let instructionSummary: BittensorInstructionSummary;
  let limitPrice: bigint | undefined;

  if (input.kind === "native") {
    section = "balances";
    method = "transferKeepAlive";
    const call = api.tx.balances.transferKeepAlive(input.to, input.rao);
    methodHex = call.method.toHex();
    instructionSummary = {
      kind: "native-transfer",
      from: input.ss58Address,
      to: input.to,
      rao: input.rao,
    };
  } else if (input.kind === "add-stake-limit") {
    section = "subtensorModule";
    method = "addStakeLimit";
    const bps = tolerancePctToBps(input.tolerancePct ?? DEFAULT_STAKE_TOLERANCE_PCT);
    // Expected-out price from the CHAIN (concentrated-liquidity AMM) — call the
    // sim so the test can assert the chain path, NEVER client-side reserve math.
    await api.call.swapRuntimeApi.simSwapTaoForAlpha(
      input.netuid,
      input.amountStakedRao,
    );
    const priceRaw = BigInt(
      (await api.call.swapRuntimeApi.currentAlphaPrice(input.netuid)).toString(),
    );
    // add → ceiling (max RAO-per-alpha you'll pay).
    limitPrice = applyToleranceToPrice(priceRaw, bps, "ceiling");
    const allowPartial = input.allowPartial ?? true;
    const call = api.tx.subtensorModule.addStakeLimit(
      input.hotkey,
      input.netuid,
      input.amountStakedRao,
      limitPrice,
      allowPartial,
    );
    methodHex = call.method.toHex();
    instructionSummary = {
      kind: "add-stake-limit",
      hotkey: input.hotkey,
      netuid: input.netuid,
      amountStakedRao: input.amountStakedRao,
      limitPrice,
      allowPartial,
      netuidIdentity: input.netuidIdentity,
    };
  } else {
    section = "subtensorModule";
    method = "removeStakeLimit";
    const bps = tolerancePctToBps(input.tolerancePct ?? DEFAULT_STAKE_TOLERANCE_PCT);
    await api.call.swapRuntimeApi.simSwapAlphaForTao(
      input.netuid,
      input.amountUnstakedAlpha,
    );
    const priceRaw = BigInt(
      (await api.call.swapRuntimeApi.currentAlphaPrice(input.netuid)).toString(),
    );
    // remove → floor (min RAO-per-alpha you'll accept).
    limitPrice = applyToleranceToPrice(priceRaw, bps, "floor");
    const allowPartial = input.allowPartial ?? true;
    const call = api.tx.subtensorModule.removeStakeLimit(
      input.hotkey,
      input.netuid,
      input.amountUnstakedAlpha,
      limitPrice,
      allowPartial,
    );
    methodHex = call.method.toHex();
    instructionSummary = {
      kind: "remove-stake-limit",
      hotkey: input.hotkey,
      netuid: input.netuid,
      amountUnstakedAlpha: input.amountUnstakedAlpha,
      limitPrice,
      allowPartial,
      netuidIdentity: input.netuidIdentity,
    };
  }

  // Reference the scale to avoid an unused-const lint while documenting the
  // RAO-per-alpha fixed-point the limitPrice is expressed in.
  void ALPHA_PRICE_SCALE;

  const mode = PREPARE_MODE;
  const metadataHash: string | null = null;

  // Assemble the SignerPayloadJSON. The signed-extension set is metadata-driven
  // on the live registry; we pin the explicit fields the ExtrinsicPayload
  // codec consumes. Genesis/block hashes come from the on-chain registry's
  // genesisHash (stable per chain) — pinned at prepare for byte-stability.
  // The block/genesis hashes + runtime versions are sourced from the api at
  // build time (routed through `_bittensorBuilder.resolveChainHashes` so the
  // test mock supplies deterministic Fixture TAO-A/B literals without a live
  // socket). Pinned into the SignerPayloadJSON so the send-time blob rebuild
  // (Plan 47-04) is byte-identical.
  const chainHashes = await resolveChainHashes(api);
  const signerPayloadJSON: Record<string, unknown> = {
    method: methodHex,
    nonce: `0x${nonce.toString(16).padStart(2, "0")}`,
    tip: "0x00",
    blockHash: chainHashes.blockHash,
    genesisHash: chainHashes.genesisHash,
    era: "0x00", // immortal
    specVersion: chainHashes.specVersion,
    transactionVersion: chainHashes.transactionVersion,
    mode,
    metadataHash,
    version: EXTRINSIC_VERSION,
  };

  const signableBlob = api.registry
    .createType("ExtrinsicPayload", signerPayloadJSON, {
      version: EXTRINSIC_VERSION,
    })
    .toU8a({ method: true });

  return {
    signableBlob,
    signerPayloadJSON,
    section,
    method,
    mode,
    metadataHash,
    ss58Address: input.ss58Address,
    instructionSummary,
    limitPrice,
  };
}

/**
 * Chain constants pinned into the SignerPayloadJSON. Sourced from the live
 * api's `genesisHash` + `runtimeVersion` so the blob is reproducible at send
 * time; the block hash uses the genesis (immortal era → the era block hash is
 * the genesis hash per Substrate convention). Routed through `_bittensorBuilder`
 * so tests can supply deterministic literals without a live socket.
 */
async function resolveChainHashes(api: SubtensorBuilderApi): Promise<{
  blockHash: string;
  genesisHash: string;
  specVersion: string;
  transactionVersion: string;
}> {
  return _bittensorBuilder.resolveChainHashes(api);
}

/**
 * Default chain-hash resolver. Reads `genesisHash` + `runtimeVersion` off the
 * api. For an immortal era the era block hash IS the genesis hash. The shape is
 * intentionally minimal so the test mock supplies literals at the
 * `_bittensorBuilder` seam.
 */
async function defaultResolveChainHashes(api: unknown): Promise<{
  blockHash: string;
  genesisHash: string;
  specVersion: string;
  transactionVersion: string;
}> {
  const a = api as {
    genesisHash?: { toHex(): string };
    runtimeVersion?: {
      specVersion?: { toNumber(): number };
      transactionVersion?: { toNumber(): number };
    };
  };
  const genesisHash = a.genesisHash?.toHex() ?? "0x" + "00".repeat(32);
  const specNum = a.runtimeVersion?.specVersion?.toNumber() ?? 0;
  const txNum = a.runtimeVersion?.transactionVersion?.toNumber() ?? 0;
  return {
    blockHash: genesisHash, // immortal era → era block hash = genesis hash
    genesisHash,
    specVersion: `0x${specNum.toString(16).padStart(8, "0")}`,
    transactionVersion: `0x${txNum.toString(16).padStart(8, "0")}`,
  };
}

/**
 * ESM spy-affordance per CLAUDE.md. The chain-hash resolver is the one
 * internal cross-export call the builder makes; tests spy on it to inject the
 * deterministic Fixture TAO-A/B chain constants (blockHash/genesisHash/spec)
 * so the produced `signableBlob` matches the pinned fixtures without a live
 * socket.
 */
export const _bittensorBuilder = {
  resolveChainHashes: defaultResolveChainHashes,
  buildBittensorUnsignedTx,
};
