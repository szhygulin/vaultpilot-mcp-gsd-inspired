// src/chains/bitcoin/types.ts — Phase 22 Plan 22-01.
//
// Branded type aliases for BTC segwit + taproot addresses. Mirror of
// `src/chains/tron/types.ts` shape, but adapted to BTC's bech32 (segwit)
// + bech32m (taproot) encoding:
//
//   - Segwit (BIP-173, BIP-84):   bc1q + 38 base32 chars (total 42; P2WPKH)
//   - Taproot (BIP-350, BIP-86):  bc1p + 58 base32 chars (total 62; P2TR)
//
// Two-gate validation per RESEARCH § Pitfall 1: the regex is a cheap
// synchronous first-line gate; `bitcoinjs-lib.address.toOutputScript(addr,
// networks.bitcoin)` runs the full bech32/bech32m checksum check. NEVER
// regex alone — bech32 and bech32m use different checksum constants
// (BIP-173 vs BIP-350); regex misses cross-encoding (a bech32m-checksummed
// string in a bech32-shaped slot still passes the regex).
//
// Branded `BtcSegwitAddress` + `BtcTaprootAddress` carved as distinct
// types so a P2WPKH cannot be passed where a P2TR is expected and vice
// versa — compile-time rejection. The byte-encoding differs (witness
// version 0 vs 1, bech32 vs bech32m), so the brand split mirrors the
// on-chain script-type split.
//
// `UtxoRow` + `BalanceReport` ship in Plan 22-01 (NOT deferred to 22-03)
// because the Esplora client returns them, AND Phase 23 coin-selection
// inherits the same shape with zero refactor. Load-bearing for the
// UTXO-model read surface — Phase 22 RESEARCH § Plan 22-03 #1.

import { address as btcAddress, initEccLib, networks } from "bitcoinjs-lib";
import * as tinySecp256k1 from "tiny-secp256k1";

// One-time ECC library initialization. Required for taproot (P2TR)
// address validation via `address.toOutputScript` — bitcoinjs-lib@7
// moved BIP-340 / BIP-341 schnorr-pubkey verification behind an
// `initEccLib(...)` gate. Without this call, `address.toOutputScript`
// throws "No ECC Library provided" on the first `bc1p…` input.
//
// `tiny-secp256k1@2.2.4` is the canonical bitcoinjs-supplied ECC
// adapter (junderw is a bitcoinjs-lib + tiny-secp256k1 co-maintainer);
// it implements the `TinySecp256k1Interface` { isXOnlyPoint,
// xOnlyPointAddTweak } that bitcoinjs-lib's internal verifyEcc
// requires. Hand-rolling BIP-341 tweak math via `@noble/curves`
// would be a Don't-Hand-Roll violation per RESEARCH.md.
//
// Idempotent — `initEccLib` no-ops on re-init with the same instance
// (`ecc_lib.cjs` checks `eccLib !== _ECCLIB_CACHE.eccLib`). Safe at
// module scope.
initEccLib(tinySecp256k1);

/**
 * Branded bech32 P2WPKH segwit address (BIP-173 + BIP-84). 42 chars,
 * `bc1q` prefix. Functions that require a validated segwit address accept
 * `BtcSegwitAddress`, not `string` — the brand enforces an
 * `assertBtcSegwitAddress` checkpoint at the type boundary.
 */
export type BtcSegwitAddress = string & {
  readonly __brand: "btc-segwit-address";
};

/**
 * Branded bech32m P2TR taproot address (BIP-350 + BIP-86). 62 chars,
 * `bc1p` prefix. Distinct brand from `BtcSegwitAddress` so a P2WPKH
 * cannot be passed where a taproot key-spend is expected (and vice
 * versa) — compile-time rejection.
 */
export type BtcTaprootAddress = string & {
  readonly __brand: "btc-taproot-address";
};

/**
 * BIP-173 (bech32) shape: leading `bc1q`, then 38 lowercase base32
 * characters (the bech32 alphabet excludes the ambiguous glyphs `1`,
 * `b`, `i`, `o`). 42 chars total. P2WPKH only — P2WSH is 62 chars
 * (witness program 32 bytes); Phase 22 doesn't scope segwit script
 * types beyond P2WPKH.
 *
 * Anchored full-string match — falsy on leading or trailing whitespace;
 * the agent boundary trims at JSON parse so anything reaching this gate
 * with whitespace is a contract violation.
 */
export const BTC_SEGWIT_RE = /^bc1q[02-9ac-hj-np-z]{38}$/;

/**
 * BIP-350 (bech32m) shape: leading `bc1p`, then 58 lowercase base32
 * characters. 62 chars total. P2TR (taproot key-spend).
 *
 * REGRESSION ANCHOR: 58 (NOT 57). The taproot data part is exactly 58
 * base32 chars after the `bc1p` prefix. A `{57}` quantifier would
 * silently reject every legitimate taproot address — Phase 22 planning
 * caught this; the regex anchors the correct shape.
 */
export const BTC_TAPROOT_RE = /^bc1p[02-9ac-hj-np-z]{58}$/;

/**
 * Assert a value is a syntactically-and-semantically valid BTC segwit
 * (P2WPKH bech32) address. Two-gate check (RESEARCH § Pitfall 1
 * REGRESSION ANCHOR):
 *
 *   1. Regex gate — fast-path syntactic shape (bc1q + 38 base32 chars).
 *   2. `bitcoinjs-lib.address.toOutputScript(s, networks.bitcoin)` —
 *      full bech32 checksum check. A corrupted-checksum string of the
 *      correct shape passes the regex; ONLY this gate catches the bad
 *      checksum.
 *
 * Throws `TypeError` on either gate failure; on success the type
 * narrows to `BtcSegwitAddress` so downstream `string` callers can
 * pass through type-safely.
 */
export function assertBtcSegwitAddress(
  s: unknown,
): asserts s is BtcSegwitAddress {
  if (typeof s !== "string" || !BTC_SEGWIT_RE.test(s)) {
    throw new TypeError(
      `Not a valid BTC segwit address: ${typeof s === "string" ? `"${s}"` : String(s)} does not match bc1q + 38-char bech32 shape`,
    );
  }
  try {
    btcAddress.toOutputScript(s, networks.bitcoin);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new TypeError(
      `Not a valid BTC segwit address: "${s}" failed bech32 checksum: ${cause}`,
    );
  }
}

/**
 * Assert a value is a syntactically-and-semantically valid BTC taproot
 * (P2TR bech32m) address. Two-gate check (mirror of
 * `assertBtcSegwitAddress`, but with bech32m checksum semantics):
 *
 *   1. Regex gate — fast-path syntactic shape (bc1p + 58 base32 chars).
 *   2. `bitcoinjs-lib.address.toOutputScript(s, networks.bitcoin)` —
 *      full bech32m checksum check. Distinct from bech32 — BIP-350 uses
 *      a different polynomial constant.
 */
export function assertBtcTaprootAddress(
  s: unknown,
): asserts s is BtcTaprootAddress {
  if (typeof s !== "string" || !BTC_TAPROOT_RE.test(s)) {
    throw new TypeError(
      `Not a valid BTC taproot address: ${typeof s === "string" ? `"${s}"` : String(s)} does not match bc1p + 58-char bech32m shape`,
    );
  }
  try {
    btcAddress.toOutputScript(s, networks.bitcoin);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new TypeError(
      `Not a valid BTC taproot address: "${s}" failed bech32m checksum: ${cause}`,
    );
  }
}

/**
 * A single unspent transaction output (UTXO) row, as surfaced by Esplora's
 * `/address/{addr}/utxo` endpoint. Load-bearing for Phase 23 coin-selection
 * — the BTC `prepare_*` trust pipeline consumes this shape directly to
 * construct PSBT inputs.
 *
 * `valueSats` is bigint at the boundary because whale UTXOs can exceed
 * `Number.MAX_SAFE_INTEGER` (2^53-1 sats ≈ 90M BTC, hypothetical but the
 * type discipline removes a precision-loss class).
 *
 * `address` carries the owning address so Phase 23 coin-selection can
 * infer the script type (segwit vs taproot) from the prefix without
 * re-fetching — important for mixed-script-type wallets.
 *
 * `confirmed: true` iff Esplora reports `status.confirmed === true`.
 * `blockHeight` populated only on confirmed UTXOs.
 */
export interface UtxoRow {
  readonly txid: string;
  readonly vout: number;
  readonly valueSats: bigint;
  readonly confirmed: boolean;
  readonly blockHeight?: number;
  readonly address: string;
}

/**
 * Per-address balance report. Discriminated union — matches the Esplora
 * client's 5-arm shape but at the tool layer (3 arms: ok / not-found /
 * error). The `utxos[]` array is load-bearing for Phase 23 coin-selection
 * inheritance — Phase 23 imports this type directly.
 *
 * `confirmedBalanceSats` is computed server-side as
 * `chain_stats.funded_txo_sum - chain_stats.spent_txo_sum` (NOT the raw
 * funded amount — RESEARCH § Pitfall 3).
 */
export type BalanceReport =
  | {
      readonly kind: "ok";
      readonly address: string;
      readonly confirmedBalanceSats: bigint;
      readonly unconfirmedBalanceSats: bigint;
      readonly utxos: readonly UtxoRow[];
      readonly txCount: number;
    }
  | { readonly kind: "not-found"; readonly address: string }
  | { readonly kind: "error"; readonly address: string; readonly message: string };
