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
    subtensorModule: {
      // Phase 48 (TAO-R-05): on-chain validator identity, keyed by COLDKEY
      // AccountId. `IdentitiesV2` is a StorageMap; `.toJSON()` decodes the
      // value struct (name/url/etc.) or `null` when absent. OQ-1: the exact
      // value-struct field names are fixture-at-execute — tolerated null.
      identitiesV2(coldkey: string): Promise<{ toJSON(): unknown }>;
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
    // Phase 48 (TAO-R-05): decoded delegate info (take/commission +
    // per-netuid registrations). `getDelegate(hotkey)` → Option<DelegateInfo>;
    // `.toJSON()` → the DelegateInfo shape or `null` when not a delegate.
    delegateInfoRuntimeApi: {
      getDelegate(hotkey: string): Promise<{ toJSON(): unknown }>;
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
 * Decode an on-chain byte-array field (`subnetName` / `tokenSymbol`) to a
 * UTF-8 string. `.toJSON()` serializes a `Vec<u8>` / `[u8; N]` either as a
 * `0x…` hex string OR as a number array, depending on the codec the runtime
 * declares for the field — both shapes are handled (defensive: the exact
 * codec serialization is a @polkadot/api version + chain-metadata detail).
 * Non-printable / NUL padding bytes are trimmed; an undecodable value
 * yields the empty string rather than throwing (a subnet with a malformed
 * name should still enumerate).
 */
function decodeByteString(raw: unknown): string {
  let bytes: number[];
  if (typeof raw === "string") {
    // Hex string shape (`0x…`). Strip the prefix, pair the nibbles.
    const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
    if (hex.length === 0) return "";
    bytes = [];
    for (let i = 0; i + 1 < hex.length; i += 2) {
      bytes.push(parseInt(hex.slice(i, i + 2), 16));
    }
  } else if (Array.isArray(raw)) {
    bytes = raw.map((b) => Number(b) & 0xff);
  } else {
    return "";
  }
  // Trim trailing NULs (fixed-width name fields are NUL-padded on-chain).
  while (bytes.length > 0 && bytes[bytes.length - 1] === 0) bytes.pop();
  try {
    return Buffer.from(bytes).toString("utf-8");
  } catch {
    return "";
  }
}

/**
 * Coerce a `.toJSON()` numeric/hex/string scalar to bigint without Number
 * precision loss. `.toJSON()` renders a small u128 as a JS number but a
 * large one as a `0x…` hex string — both must widen to bigint safely.
 */
function toBigIntSafe(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") {
    if (v.length === 0) return 0n;
    return BigInt(v); // BigInt() parses both decimal and 0x-hex strings.
  }
  return 0n;
}

/**
 * Decoded subnet row. `subnetName` + `tokenSymbol` are byte arrays
 * on-chain — decoded to UTF-8 strings here.
 */
export interface BittensorSubnetRow {
  netuid: number;
  name: string;
  symbol: string;
  taoInRao: bigint;
  /** TAO-denominated reserve, decimal string. */
  taoIn: string;
  alphaInRao: bigint;
  /** ALPHA-denominated reserve, decimal string. */
  alphaIn: string;
  /** RAO-per-alpha price, 1e9-scaled fixed-point (ALPHA_PRICE_SCALE). */
  alphaPriceRaw: bigint;
}

/**
 * Subnet enumeration via the decoded `subnetInfoRuntimeApi.getAllDynamicInfo`
 * runtime API (RESEARCH §Reads — probed live 2026-06-03, node-subtensor spec
 * 413). One call returns `Vec<DynamicInfo>`; each row carries `netuid`,
 * `subnetName` + `tokenSymbol` (byte arrays → UTF-8 here), and the AMM
 * reserves `taoIn` / `alphaIn` (RAO). The alpha price is derived from the
 * reserves (`taoIn × ALPHA_PRICE_SCALE / alphaIn`) — same 1e9-scaled
 * fixed-point as `currentAlphaPrice` (Open Question 1, resolved in 46-01).
 */
export async function getSubnets(): Promise<BittensorSubnetRow[]> {
  try {
    const api = asSubtensor(await _bittensorRegistry.getApi());
    const raw = await api.call.subnetInfoRuntimeApi.getAllDynamicInfo();
    const rows = raw.toJSON() as Array<{
      netuid: number;
      subnetName: unknown;
      tokenSymbol: unknown;
      taoIn: string | number;
      alphaIn: string | number;
    }>;
    return (rows ?? []).map((r) => {
      const taoInRao = toBigIntSafe(r.taoIn);
      const alphaInRao = toBigIntSafe(r.alphaIn);
      // Derive the alpha price from the reserves: price = taoIn / alphaIn,
      // expressed as a 1e9-scaled fixed-point (ALPHA_PRICE_SCALE) so it is
      // unit-consistent with currentAlphaPrice. Guard the zero-reserve case.
      const alphaPriceRaw =
        alphaInRao === 0n ? 0n : (taoInRao * ALPHA_PRICE_SCALE) / alphaInRao;
      return {
        netuid: r.netuid,
        name: decodeByteString(r.subnetName),
        symbol: decodeByteString(r.tokenSymbol),
        taoInRao,
        taoIn: formatRaoToTao(taoInRao),
        alphaInRao,
        alphaIn: formatRaoToTao(alphaInRao),
        alphaPriceRaw,
      };
    });
  } catch (e) {
    throw new BittensorRpcError(e);
  }
}

/**
 * A single validator row. Phase 48 (TAO-R-05) enriches the minimal Phase-46
 * shape with on-chain delegate `identity` (name) + per-netuid
 * `registeredNetuids`, sourced from `delegateInfoRuntimeApi.getDelegate` +
 * `identitiesV2`. Both enrichment fields tolerate absence (null / empty).
 */
export interface BittensorValidatorRow {
  netuid: number;
  uid: number;
  /** SS58 hotkey. */
  hotkey: string;
  validatorPermit: boolean;
  /**
   * Validator commission as a percentage string (e.g. `"18"` for 18%). The
   * delegate take on-chain is a u16 fraction of `2^16 - 1` (65535); we
   * normalize to a 0-100 percentage rounded to 2 decimals. `null` when no
   * take is resolvable (lite shape omits it AND getDelegate returns None).
   */
  takePercent: string | null;
  /**
   * On-chain delegate identity name (TAO-R-05), decoded from `identitiesV2`
   * keyed by the delegate's owner coldkey. `null` when the hotkey is not a
   * registered delegate OR has no on-chain identity (OQ-1 tolerance —
   * mirrors the shipped null-take tolerance).
   */
  identity: string | null;
  /**
   * Subnet ids this hotkey is registered on (TAO-R-05), from
   * `DelegateInfo.registrations`. Empty `[]` when getDelegate returns None.
   */
  registeredNetuids: number[];
}

/** u16 take denominator — the delegate take is a fraction of 2^16 - 1. */
const TAKE_U16_MAX = 65_535;

/**
 * Normalize an on-chain u16 take to a 0-100 percentage string (2 decimals).
 * `null` in → `null` out (the lite shape may omit it for non-validators).
 */
function normalizeTakePercent(rawTake: unknown): string | null {
  if (rawTake === undefined || rawTake === null) return null;
  const take = Number(toBigIntSafe(rawTake));
  if (!Number.isFinite(take)) return null;
  const pct = (take / TAKE_U16_MAX) * 100;
  // 2-decimal string; trim a trailing ".00" / trailing zero for readability.
  return pct.toFixed(2).replace(/\.?0+$/, "") || "0";
}

/**
 * The decoded `DelegateInfo.toJSON()` shape (Phase 48 — TAO-R-05). polkadot-js
 * `.toJSON()` camelCases the on-chain struct field names (`owner_ss58` →
 * `ownerSs58`). `take` is a Compact<u16> (fraction of 65535); `registrations`
 * is a `Vec<NetUid>`. Fields are optional/tolerant — `getDelegate` may return
 * `null` (not a delegate). `[CITED: 48-RESEARCH §Validator Enrichment Reads]`.
 */
interface DelegateInfoJson {
  take?: unknown;
  ownerSs58?: string;
  registrations?: Array<number | string>;
  validatorPermits?: Array<number | string>;
}

/**
 * Decode an `identitiesV2(coldkey).toJSON()` value to a display name string,
 * or `null` (TAO-R-05, OQ-1 — the value-struct field names are
 * fixture-at-execute). The on-chain `IdentitiesV2` value is a struct; the name
 * field is most likely `name` (a byte-vector) but the exact shape is probed at
 * execute time. Tolerant: handles a `{ name }` byte-vector / string field, a
 * bare string, or `null`/absent → `null`. Never throws (a malformed identity
 * must not break the enumeration — mirrors the shipped null-take tolerance).
 */
function decodeIdentityName(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  // The decoded value is an object with a `name` field (the common case) …
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const nameField = obj.name ?? obj.Name ?? obj.display;
    if (nameField !== undefined && nameField !== null) {
      const decoded = decodeByteString(nameField);
      return decoded.length > 0 ? decoded : null;
    }
    return null;
  }
  // … or a bare hex/byte-array/string value.
  const decoded = decodeByteString(raw);
  return decoded.length > 0 ? decoded : null;
}

/**
 * Validator enumeration via the decoded `neuronInfoRuntimeApi.getNeuronsLite`
 * runtime API (Open Question 2, RESOLVED in 46-01) — ONE call returns all
 * neurons for a netuid with `hotkey` (SS58), `uid`, `validatorPermit` (bool),
 * and the lite delegate `take` (u16). Filters `validatorPermit === true`.
 *
 * Phase 48 (TAO-R-05) ENRICHMENT: each permit-holding row is enriched with
 *   - `takePercent` — from `delegateInfoRuntimeApi.getDelegate(hotkey).take`
 *     via the shipped `normalizeTakePercent` (falls back to the lite take);
 *   - `registeredNetuids` — from `DelegateInfo.registrations`;
 *   - `identity` — from `identitiesV2(ownerSs58)` (coldkey-keyed name).
 * getDelegate returning None → identity null, registeredNetuids []. An empty
 * identitiesV2 → identity null. Neither is an error (OQ-1 tolerance).
 *
 * `netuid` is REQUIRED — `getNeuronsLite` is per-subnet. The tool layer gates
 * a missing netuid before the round-trip. All api access routes through
 * `_bittensorRegistry.getApi()` (the test-spy seam — NEVER a live socket).
 */
export async function getValidators(
  netuid: number,
): Promise<BittensorValidatorRow[]> {
  try {
    const api = asSubtensor(await _bittensorRegistry.getApi());
    const raw = await api.call.neuronInfoRuntimeApi.getNeuronsLite(netuid);
    const neurons = raw.toJSON() as Array<{
      uid: number;
      hotkey: string;
      validatorPermit: boolean;
      take?: unknown;
    }>;
    const permitted = (neurons ?? []).filter((n) => n.validatorPermit === true);

    const rows: BittensorValidatorRow[] = [];
    for (const n of permitted) {
      // Enrich via getDelegate (take/registrations) + identitiesV2 (name).
      // getDelegate returning None → null delegate → identity null + [] nets.
      let delegate: DelegateInfoJson | null = null;
      try {
        const rawDelegate =
          await api.call.delegateInfoRuntimeApi.getDelegate(n.hotkey);
        delegate = (rawDelegate.toJSON() as DelegateInfoJson | null) ?? null;
      } catch {
        delegate = null; // best-effort — a per-hotkey enrich failure is tolerated.
      }

      // take%: prefer the decoded DelegateInfo take, else the lite take.
      const takePercent =
        delegate && delegate.take !== undefined
          ? normalizeTakePercent(delegate.take)
          : normalizeTakePercent(n.take);

      const registeredNetuids = (delegate?.registrations ?? []).map((x) =>
        Number(toBigIntSafe(x)),
      );

      // Identity name keyed by the delegate's owner coldkey (OQ-1 tolerant).
      let identity: string | null = null;
      if (delegate?.ownerSs58) {
        try {
          const rawIdent = await api.query.subtensorModule.identitiesV2(
            delegate.ownerSs58,
          );
          identity = decodeIdentityName(rawIdent.toJSON());
        } catch {
          identity = null; // empty / malformed identity → null (tolerated).
        }
      }

      rows.push({
        netuid,
        uid: n.uid,
        hotkey: n.hotkey,
        validatorPermit: n.validatorPermit,
        takePercent,
        identity,
        registeredNetuids,
      });
    }
    return rows;
  } catch (e) {
    throw new BittensorRpcError(e);
  }
}

/**
 * Per-netuid registration signal (Phase 48 — TAO-R-05, OQ-2 resolved): is
 * `hotkey` registered on `netuid`? Resolved by the hotkey's PRESENCE in
 * `getNeuronsLite(netuid)` — the cheapest per-target-subnet check (one decoded
 * call against the exact subnet the staking call targets). Plan 48-03 consumes
 * this for the preview-time unregistered-hotkey warning. Routes through
 * `_bittensorRegistry.getApi()` (the test-spy seam — NEVER a live socket).
 */
export async function isHotkeyRegisteredOnNetuid(
  hotkey: string,
  netuid: number,
): Promise<boolean> {
  try {
    const api = asSubtensor(await _bittensorRegistry.getApi());
    const raw = await api.call.neuronInfoRuntimeApi.getNeuronsLite(netuid);
    const neurons = raw.toJSON() as Array<{ hotkey: string }>;
    return (neurons ?? []).some((n) => n.hotkey === hotkey);
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
