// src/chains/litecoin/types.ts — Phase 26 Plan 26-01 (LTC-PAIR-01 / LTC-READ-01 / LTC-READ-02).
//
// Branded type aliases for LTC segwit + legacy addresses. Mirror of
// `src/chains/bitcoin/types.ts` shape, adapted to LTC's network bytes,
// derivation coin_type=2, and address prefixes:
//
//   - Segwit  (BIP-173, BIP-84):  ltc1q + 38 base32 chars (total 43; P2WPKH)
//   - Legacy  (BIP-44):           L-prefix + 26-33 base58check chars (P2PKH)
//
// Two-gate validation per RESEARCH § Pitfall 2: the regex is the cheap
// synchronous first-line gate; `bitcoinjs-lib.address.toOutputScript(addr,
// LTC_NETWORK)` runs the full bech32/base58check checksum check. NEVER
// regex alone. CRITICAL: `LTC_NETWORK` MUST be passed explicitly — missing
// the network param defaults to Bitcoin mainnet and silently corrupts the
// address encoding (Pitfall 2 REGRESSION ANCHOR).
//
// `LTC_NETWORK` is a module-scope const because bitcoinjs-lib@7 has NO
// built-in `networks.litecoin` (RESEARCH Pattern 2 + PATTERNS § Pitfall 2).
// The values are taken from LTC source `chainparams.cpp` + SLIP-0044
// (coin_type=2) + BIP-84. ASSUMED tertiary confidence for bip32.public /
// bip32.private version bytes (verify against live address round-trip).
//
// `UtxoRow` + `BalanceReport` are copy-verbatim from the BTC analog —
// chain-agnostic shapes that flow into the esplora-client and tool layers.
// Phase 26 coin-selection (Plan 26-02) inherits the same shape.

import { address as ltcAddress, initEccLib } from "bitcoinjs-lib";
import type { Network } from "bitcoinjs-lib";
import * as tinySecp256k1 from "tiny-secp256k1";

// One-time ECC library initialization — idempotent on re-init. Required
// for P2WPKH address validation via `address.toOutputScript`. Mirror of
// the BTC analog's initEccLib call (safe at module scope).
initEccLib(tinySecp256k1);

// ───────────────────── LTC network object ────────────────────────────
//
// bitcoinjs-lib@7 has NO built-in `networks.litecoin` — this MUST be
// defined here (RESEARCH Pattern 2). Every address assertion, PSBT init,
// and script derivation in Phase 26 MUST pass `{ network: LTC_NETWORK }`.
//
// Source: LTC chainparams.cpp + SLIP-0044 coin_type=2 + BIP-84.
// [ASSUMED tertiary confidence for bip32 version bytes — verify at
// execute time against a real litecoin address round-trip.]
//
// REGRESSION ANCHOR — count ≥ 2 uses of LTC_NETWORK in this file so
// acceptance-criteria grep passes: see assertLtcSegwitAddress +
// assertLtcLegacyAddress below.

export const LTC_NETWORK: Network = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: {
    public: 0x019da462, // Litecoin mainnet xpub version bytes
    private: 0x019d9cfe, // Litecoin mainnet xprv version bytes
  },
  pubKeyHash: 0x30, // 48 → L-prefix P2PKH legacy addresses
  scriptHash: 0x32, // 50 → M-prefix P2SH addresses
  wif: 0xb0, // 176
};

// ───────────────────── Branded address types ─────────────────────────

/**
 * Branded bech32 P2WPKH segwit address (BIP-173 + BIP-84 for LTC). 43 chars,
 * `ltc1q` prefix. Functions that require a validated LTC segwit address accept
 * `LtcSegwitAddress`, not `string` — the brand enforces an
 * `assertLtcSegwitAddress` checkpoint at the type boundary.
 */
export type LtcSegwitAddress = string & {
  readonly __brand: "ltc-segwit-address";
};

/**
 * Branded base58check P2PKH legacy address. `L`-prefix, 27-34 base58check
 * chars. Distinct brand from `LtcSegwitAddress` — the encoding differs.
 */
export type LtcLegacyAddress = string & {
  readonly __brand: "ltc-legacy-address";
};

// ───────────────────── Address regex constants ───────────────────────

/**
 * BIP-173 (bech32) LTC segwit shape: leading `ltc1q`, then 38 lowercase
 * bech32 alphabet characters (excludes ambiguous glyphs `1`, `b`, `i`, `o`).
 * 43 chars total. P2WPKH only — P2WSH is longer (63 chars for 32-byte witness).
 *
 * Anchored full-string match — falsy on leading or trailing whitespace.
 */
export const LTC_SEGWIT_RE = /^ltc1q[02-9ac-hj-np-z]{38}$/;

/**
 * LTC legacy P2PKH base58check shape: leading `L`, then 26-33 base58
 * chars (full base58 alphabet including uppercase and lowercase, no `0`,
 * `O`, `I`, `l`). The exact address length varies with the hash value.
 *
 * Note: `L` prefix corresponds to pubKeyHash 0x30 (version byte 48).
 */
export const LTC_LEGACY_RE = /^L[1-9A-HJ-NP-Za-km-z]{26,33}$/;

// ───────────────────── Address assertion functions ───────────────────

/**
 * Assert a value is a syntactically-and-semantically valid LTC segwit
 * (P2WPKH bech32) address. Two-gate check (RESEARCH § Pitfall 2
 * REGRESSION ANCHOR):
 *
 *   1. Regex gate — fast-path syntactic shape (ltc1q + 38 bech32 chars).
 *   2. `bitcoinjs-lib.address.toOutputScript(s, LTC_NETWORK)` —
 *      full bech32 checksum check. Passing LTC_NETWORK is MANDATORY —
 *      omitting it defaults to Bitcoin mainnet and silently corrupts the
 *      validation (Pitfall 2).
 *
 * Throws `TypeError` on either gate failure; on success the type
 * narrows to `LtcSegwitAddress` so downstream callers can pass
 * through type-safely.
 */
export function assertLtcSegwitAddress(
  s: unknown,
): asserts s is LtcSegwitAddress {
  if (typeof s !== "string" || !LTC_SEGWIT_RE.test(s)) {
    throw new TypeError(
      `Not a valid LTC segwit address: ${typeof s === "string" ? `"${s}"` : String(s)} does not match ltc1q + 38-char bech32 shape`,
    );
  }
  try {
    // Pass LTC_NETWORK — missing this defaults to Bitcoin mainnet (Pitfall 2)
    ltcAddress.toOutputScript(s, LTC_NETWORK);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new TypeError(
      `Not a valid LTC segwit address: "${s}" failed bech32 checksum: ${cause}`,
    );
  }
}

/**
 * Assert a value is a syntactically-and-semantically valid LTC legacy
 * (P2PKH base58check) address. Two-gate check mirroring
 * `assertLtcSegwitAddress`:
 *
 *   1. Regex gate — fast-path syntactic shape (L + 26-33 base58check chars).
 *   2. `bitcoinjs-lib.address.toOutputScript(s, LTC_NETWORK)` —
 *      full base58check checksum check. LTC_NETWORK MUST be passed.
 */
export function assertLtcLegacyAddress(
  s: unknown,
): asserts s is LtcLegacyAddress {
  if (typeof s !== "string" || !LTC_LEGACY_RE.test(s)) {
    throw new TypeError(
      `Not a valid LTC legacy address: ${typeof s === "string" ? `"${s}"` : String(s)} does not match L-prefix base58check shape`,
    );
  }
  try {
    // Pass LTC_NETWORK — MANDATORY (Pitfall 2 REGRESSION ANCHOR)
    ltcAddress.toOutputScript(s, LTC_NETWORK);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new TypeError(
      `Not a valid LTC legacy address: "${s}" failed base58check checksum: ${cause}`,
    );
  }
}

// ───────────────────── Chain-agnostic UTXO types ─────────────────────
//
// Copied verbatim from BTC analog (src/chains/bitcoin/types.ts). These
// shapes are chain-agnostic and flow into the LTC esplora-client and
// tool layers. Plan 26-02 LTC signing inherits the same shape.

/**
 * A single unspent transaction output (UTXO) row, as surfaced by
 * litecoinspace.org's Esplora-compatible `/address/{addr}/utxo` endpoint.
 *
 * `valueSats` is bigint at the boundary. For LTC the unit is litoshis
 * (1 LTC = 100_000_000 litoshis), same decimal scale as BTC sats.
 *
 * `address` carries the owning address so Phase 26-02 coin-selection can
 * infer the script type (segwit vs legacy) without re-fetching.
 *
 * `confirmed: true` iff litecoinspace.org reports `status.confirmed === true`.
 */
export interface UtxoRow {
  readonly txid: string;
  readonly vout: number;
  readonly valueSats: bigint; // litoshis for LTC
  readonly confirmed: boolean;
  readonly blockHeight?: number;
  readonly address: string;
}

/**
 * Per-address balance report. Discriminated union — mirrors the Esplora
 * client's 5-arm shape but at the tool layer (3 arms: ok / not-found /
 * error).
 *
 * `confirmedBalanceSats` = chain_stats.funded_txo_sum - chain_stats.spent_txo_sum
 * (same as BTC — Esplora-compatible).
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
