// src/chains/bittensor/tao-rpc-client.ts — Phase 46 Plan 46-01 (shelf) +
// Plan 46-03 (read-helper bodies).
//
// Thin read wrapper around the subtensor `ApiPromise` singleton. ALL
// reads route through `_bittensorRegistry.getApi()` — NEVER bare-import
// the api (preserves the ESM spy seam for tests, CLAUDE.md convention).
//
// Decoded runtime APIs over raw storage decode (RESEARCH §Anti-Patterns):
// subtensor's `api.call.*` runtime APIs return fully-decoded stake /
// subnet / neuron info in one round-trip and absorb the dTAO storage
// churn. Raw `api.query.subtensorModule.*` SCALE decode is the brittle
// path — used ONLY for a documented validator-permit fallback in 46-03.
//
// UNIT DISCIPLINE (Pitfall 2 — the off-by-unit footgun CLAUDE.md warns of):
//   - free balance + TAO are denominated in RAO (1 TAO = 1e9 RAO).
//   - `getStakeInfoForColdkey().stake` is ALPHA — a per-subnet token, ALSO
//     9-decimal-scaled, but a DIFFERENT unit from TAO. Surfacing alpha as
//     "TAO staked" is the exact mislabel class to avoid. Every amount is
//     labeled with its token; the TAO-equivalent is a DERIVED display
//     column via the per-netuid chain price.

import type { ApiPromise } from "@polkadot/api";

import {
  _bittensorRegistry,
} from "./registry.js";
import {
  type Ss58Address,
} from "./types.js";

/**
 * Subtensor's `system.account` query + its custom `api.call.*` runtime APIs
 * are decorated DYNAMICALLY from chain metadata at `ApiPromise.create` time
 * — they are NOT in `@polkadot/api`'s static type augmentation (which only
 * knows the generic Substrate surface, where `api.query.system` and unknown
 * runtime APIs are typed `possibly undefined`). This narrowing shape pins
 * the exact runtime-decorated subset we read; the runtime calls are
 * identical to the generic surface — this is a type seam over a dynamic
 * API, not a behavior change. Each `.toBigInt()` / `.toJSON()` is the
 * `@polkadot/types` codec accessor on the decoded value.
 */
interface SubtensorRuntimeApi {
  query: {
    system: {
      account(
        addr: string,
      ): Promise<{ data: { free: { toBigInt(): bigint } } }>;
    };
  };
  call: {
    stakeInfoRuntimeApi: {
      getStakeInfoForColdkey(addr: string): Promise<{ toJSON(): unknown }>;
    };
    swapRuntimeApi: {
      currentAlphaPrice(netuid: number): Promise<{ toString(): string }>;
    };
    subnetInfoRuntimeApi: {
      getAllDynamicInfo(): Promise<{ toJSON(): unknown }>;
    };
    neuronInfoRuntimeApi: {
      getNeuronsLite(netuid: number): Promise<{ toJSON(): unknown }>;
    };
  };
}

/**
 * Narrow the generic `ApiPromise` to the runtime-decorated subtensor
 * surface we read. The cast is sound at runtime: `ApiPromise.create`
 * against subtensor decorates exactly these query + runtime-API entries
 * from the chain metadata (probed live 2026-06-03, node-subtensor spec 413).
 */
function asSubtensor(api: ApiPromise): SubtensorRuntimeApi {
  return api as unknown as SubtensorRuntimeApi;
}

/**
 * Bittensor RPC error envelope. Wraps all subtensor-RPC-thrown errors with
 * a stable `errorCode` so the read tools (46-03) can pattern-match for the
 * MCP error envelope without sniffing nested SDK exception types. Mirror
 * of `SolanaRpcError` (errorCode `SOLANA_RPC_FAILED`).
 */
export class BittensorRpcError extends Error {
  readonly errorCode = "BITTENSOR_RPC_FAILED" as const;
  override readonly cause?: unknown;

  constructor(cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`Bittensor RPC call failed: ${causeMsg}`);
    this.name = "BittensorRpcError";
    this.cause = cause;
  }
}

/**
 * RAO → TAO conversion factor. 1 TAO = 1_000_000_000 RAO (9 decimals,
 * locked at the protocol level). Same scale as Solana lamports.
 */
const RAO_PER_TAO = 1_000_000_000n;

/**
 * Alpha-price fixed-point scale. `swapRuntimeApi.currentAlphaPrice(netuid)`
 * returns RAO-per-alpha as a 1e9-scaled fixed-point integer (Open Question
 * 1, RESOLVED at execute time 2026-06-03 against the live Finney chain):
 *
 *   currentAlphaPrice(1) = 9_833_079
 *   netuid-1 reserves    = taoIn 27_864_194_863_896 / alphaIn 2_833_743_079_985_058
 *                        ≈ 0.009833…  ==  9_833_079 / 1e9
 *
 * Cross-checked against `simSwapAlphaForTao(1, 1e9 alpha) → taoAmount
 * 9_828_074` (matches `1e9 RAO × price / 1e9 = 9_833_029 RAO` to within
 * AMM slippage/fee ~0.05%). So the TAO-equivalent of an alpha amount is:
 *
 *   taoEquivRao = alphaRao × priceRaw / ALPHA_PRICE_SCALE
 *
 * The alpha figure is the source of truth; the TAO-equiv is a derived
 * DISPLAY column only (RESEARCH §A3 — mislabel risk on the display column
 * only, never on the alpha source value).
 */
const ALPHA_PRICE_SCALE = 1_000_000_000n;

/**
 * Format `bigint` RAO as a decimal-string TAO amount. Pure — deterministic
 * on every input. Verbatim mirror of `formatLamportsToSol`. RAO is a u128
 * on-chain; the formatter is bigint-only so `Number` precision loss
 * (above 2^53) cannot leak in (CLAUDE.md "Don't Hand-Roll RAO ↔ decimal").
 *
 * Behavior:
 *   - `0n` → `"0"`
 *   - `1_000_000_000n` → `"1"`
 *   - `2_500_000_000n` → `"2.5"`
 *   - `1n` → `"0.000000001"`
 *   - Trailing zeros on the fractional part are trimmed; a fully-zero
 *     fractional part is dropped entirely (no trailing `.`).
 *
 * NOTE: this formats BOTH RAO→TAO and alpha-RAO→alpha (alpha shares the
 * 9-decimal scale). The CALLER labels the unit — this is pure decimal math.
 */
function formatRaoToTao(rao: bigint): string {
  const whole = rao / RAO_PER_TAO;
  const frac = rao % RAO_PER_TAO;
  if (frac === 0n) return whole.toString();
  const fracPadded = frac.toString().padStart(9, "0");
  const fracTrimmed = fracPadded.replace(/0+$/, "");
  return `${whole.toString()}.${fracTrimmed}`;
}

/**
 * Free TAO balance for a coldkey. Single decoded read.
 * `(await api.query.system.account(ss58)).data.free.toBigInt()` → free
 * RAO (u128). The full decode lands in 46-03 — this shelf wires the path.
 */
export async function getFreeBalance(
  ss58: Ss58Address,
): Promise<{ freeRao: bigint; freeTao: string }> {
  try {
    const api = asSubtensor(await _bittensorRegistry.getApi());
    const acct = await api.query.system.account(ss58);
    // `acct.data.free` is a Compact/u128 codec value; `.toBigInt()` widens
    // to bigint without Number precision loss.
    const freeRao = acct.data.free.toBigInt();
    return { freeRao, freeTao: formatRaoToTao(freeRao) };
  } catch (e) {
    throw new BittensorRpcError(e);
  }
}

/**
 * A single per-(hotkey, netuid) stake position. `.stake` is ALPHA (Pitfall
 * 2). Decode bodies land in 46-03; the shape is fixed here.
 */
export interface BittensorStakeRow {
  hotkey: string;
  netuid: number;
  /** ALPHA, base unit (9-decimal RAO-scaled). NOT TAO. */
  alphaRao: bigint;
  /** ALPHA, decimal string. */
  alpha: string;
  isRegistered: boolean;
}

/**
 * Per-(hotkey, netuid) alpha stake positions for a coldkey via the decoded
 * `stakeInfoRuntimeApi.getStakeInfoForColdkey` runtime API (NOT raw
 * `api.query.subtensorModule.*` storage — Anti-Pattern). Full decode in
 * 46-03; this shelf wires the path + the alpha-labeled row shape.
 */
export async function getStakeInfo(
  ss58: Ss58Address,
): Promise<BittensorStakeRow[]> {
  try {
    const api = asSubtensor(await _bittensorRegistry.getApi());
    const raw = await api.call.stakeInfoRuntimeApi.getStakeInfoForColdkey(ss58);
    const rows = raw.toJSON() as Array<{
      hotkey: string;
      netuid: number;
      stake: string | number;
      isRegistered: boolean;
    }>;
    return (rows ?? []).map((r) => {
      const alphaRao = BigInt(r.stake);
      return {
        hotkey: r.hotkey,
        netuid: r.netuid,
        alphaRao,
        alpha: formatRaoToTao(alphaRao),
        isRegistered: r.isRegistered,
      };
    });
  } catch (e) {
    throw new BittensorRpcError(e);
  }
}

/**
 * RAO-per-alpha price for a netuid (1e9-scaled fixed-point). Used to derive
 * the TAO-equivalent DISPLAY column for alpha positions. The TAO-equiv of
 * `alphaRao` is `alphaRao × priceRaw / ALPHA_PRICE_SCALE` (Open Question 1
 * resolved above). Full decode in 46-03.
 */
export async function getAlphaPriceForNetuid(
  netuid: number,
): Promise<bigint> {
  try {
    const api = asSubtensor(await _bittensorRegistry.getApi());
    const raw = await api.call.swapRuntimeApi.currentAlphaPrice(netuid);
    return BigInt(raw.toString());
  } catch (e) {
    throw new BittensorRpcError(e);
  }
}

/**
 * Convert an alpha amount (RAO) to its TAO-equivalent (RAO) via the
 * per-netuid price. Pure bigint — DISPLAY-only derivation; the alpha
 * source value is unaffected (Pitfall 2 / §A3).
 */
export function alphaToTaoEquivRao(alphaRao: bigint, priceRaw: bigint): bigint {
  return (alphaRao * priceRaw) / ALPHA_PRICE_SCALE;
}

/**
 * Decoded subnet row. `subnetName` + `tokenSymbol` are byte arrays
 * on-chain — decoded to strings in 46-03.
 */
export interface BittensorSubnetRow {
  netuid: number;
  name: string;
  symbol: string;
  taoInRao: bigint;
  alphaInRao: bigint;
  alphaPriceRaw: bigint;
}

/**
 * Subnet enumeration via the decoded `subnetInfoRuntimeApi.getAllDynamicInfo`
 * runtime API. Full decode (byte-array name/symbol → UTF-8) lands in 46-03;
 * this shelf wires the path.
 */
export async function getSubnets(): Promise<BittensorSubnetRow[]> {
  try {
    const api = asSubtensor(await _bittensorRegistry.getApi());
    const raw = await api.call.subnetInfoRuntimeApi.getAllDynamicInfo();
    void raw; // full decode in 46-03
    return [];
  } catch (e) {
    throw new BittensorRpcError(e);
  }
}

/**
 * A single validator row (minimal — TAO-R-05 delegate-identity +
 * commission enrichment is Phase 48).
 */
export interface BittensorValidatorRow {
  netuid: number;
  uid: number;
  hotkey: string;
  validatorPermit: boolean;
}

/**
 * Validator enumeration via the decoded `neuronInfoRuntimeApi.getNeuronsLite`
 * runtime API (Open Question 2, RESOLVED at execute time 2026-06-03):
 * ONE call returns all 256 neurons for a netuid with `hotkey` (SS58),
 * `uid`, and `validatorPermit` (bool) — the lowest-round-trip path. The
 * lite shape does NOT carry on-chain identity (Phase-48 enrichment), so
 * the minimal enumeration filters `validatorPermit === true`. Full decode
 * lands in 46-03; this shelf wires the path.
 */
export async function getValidators(
  netuid?: number,
): Promise<BittensorValidatorRow[]> {
  try {
    const api = asSubtensor(await _bittensorRegistry.getApi());
    void netuid;
    void api; // full decode in 46-03
    return [];
  } catch (e) {
    throw new BittensorRpcError(e);
  }
}

// Internal test surface — exposes `formatRaoToTao` + the RAO constant for
// direct regression coverage. NOT a production export; consumers go
// through `getFreeBalance` / `getStakeInfo`.
export const _taoRpcInternals = {
  RAO_PER_TAO,
  ALPHA_PRICE_SCALE,
  formatRaoToTao,
};
