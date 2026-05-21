// Curated BTC demo persona registry (Plan 22-04 / BTC read-only demo).
//
// Sibling to `src/demo/personas.ts` (EVM), `src/demo/solana-persona.ts`,
// and `src/demo/tron-persona.ts` — the EVM `Persona.slug` literal-union
// stays narrow to its 4 EVM slugs, Solana stays at 1 slug, TRON stays at
// 1 slug. BTC carves its own `BtcPersonaSlug` here. `set_demo_wallet`
// routes BTC slugs to this registry, TRON slugs to TRON, Solana slugs to
// Solana, EVM slugs to EVM.
//
// BTC persona VERIFICATION RITUAL (perform at plan-author time + at every
// persona addition):
//
//   1. Confirm via mempool.space UI that BOTH addresses (segwit + taproot)
//      are not labeled as sanctioned entities or hacked exchanges.
//      https://mempool.space/address/<ADDR>
//   2. Confirm against the OFAC SDN list via the 0xB10C registry:
//      https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses
//   3. Confirm BOTH addresses have non-trivial balance + activity history.
//   4. Note the verification date in a comment beside each entry.
//
// Plan 22-04 picks a CROSS-ENTITY pair (acceptable per PATTERNS §Plan
// 22-04 because the persona is a demo-only artifact and finding a single
// entity with both a public segwit AND taproot cold wallet that is
// composition-stable + OFAC-clean is not reliable):
//   - btcSegwitAddress: a Binance segwit cold wallet (public,
//     composition-stable since the 2018 cold-wallet rotation; explicitly
//     surfaced as a research candidate in 22-RESEARCH.md §Plan 22-04 #3).
//   - btcTaprootAddress: the BIP-86 specification's canonical test
//     vector. BIP-86 is the published BIP for taproot (P2TR)
//     deterministic single-key derivation; the test vector is public,
//     immutable, and OFAC-clean by construction (it's a public
//     specification artifact, not an entity-controlled address).
// The cross-entity disclosure is documented inline; this is acceptable
// for a read-only demo persona — the persona shape is structurally
// "give me realistic mainnet addresses to exercise read tools", and the
// two slots do not need to belong to the same entity.
//
// DOA validation: every `btcSegwitAddress` AND `btcTaprootAddress` in
// `BTC_PERSONAS` is validated via `bitcoinjs-lib.address.toOutputScript(addr,
// networks.bitcoin)` at module-load. Full bech32/bech32m checksum gate
// throws at import time on any malformed entry — fail-fast (mirrors the
// EVM `getAddress("0x...")` EIP-55 throw in `personas.ts`, the Solana
// `new PublicKey(addr)` throw in `solana-persona.ts`, and the TRON
// `tronUtils.address.isAddress` throw in `tron-persona.ts`).

import { address as btcAddress, networks } from "bitcoinjs-lib";

// Side-effect import: `src/chains/bitcoin/types.ts` calls
// `initEccLib(tinySecp256k1)` at module scope (idempotent), which
// bitcoinjs-lib requires before `address.toOutputScript` will accept
// taproot (P2TR) addresses. Without this, the DUAL DOA validation loop
// below throws "No ECC Library provided" on the first `bc1p…` entry.
// Mirror of `src/chains/bitcoin/xpub-scan.ts:55`.
import "../chains/bitcoin/types.js";
import type { BtcPersona as BtcPersonaState } from "./state.js";

/**
 * BTC persona slug literal-union. v2.2 ships exactly one curated persona;
 * multi-persona expansion may follow in v2.2.x. Additive widening — new
 * slugs join the union without breaking existing callers.
 */
export type BtcPersonaSlug = "btc-whale";

/**
 * Sibling shape to the EVM `Persona` interface, the Solana
 * `SolanaPersona` interface, and the TRON `TronPersona` interface. The
 * `slug` literal-union is independent of `Persona["slug"]` /
 * `SolanaPersonaSlug` / `TronPersonaSlug` (per PATTERN-MAPPER
 * META-DECISION §2).
 *
 * Structurally compatible with the minimal `BtcPersona` carve in
 * `src/demo/state.ts` (added by Plan 22-04) — narrower `slug` type, plus
 * required `description` + `rehearsableFlows` + `simulationEnvelopeShape`.
 *
 * The `simulationEnvelopeShape` field is a Phase 23 anchor — BTC
 * demo-mode signing wires PSBT-mempool-replay (Esplora's `/tx/{txid}/raw`
 * + mempool acceptance check) in Phase 23. Plan 22-04 ships ONLY the
 * read-side persona registry; the field is typed but not consumed.
 */
export interface BtcPersona {
  readonly slug: BtcPersonaSlug;
  readonly chain: "bitcoin";
  /** bech32-encoded segwit (P2WPKH) address. Validated at module load. */
  readonly btcSegwitAddress: string;
  /** bech32m-encoded taproot (P2TR) address. Validated at module load. */
  readonly btcTaprootAddress: string;
  readonly description: string;
  readonly rehearsableFlows: readonly string[];
  /** Phase 23 anchor — typed, not consumed in Phase 22. */
  readonly simulationEnvelopeShape: "psbt-mempool-replay";
}

/**
 * Locked BTC persona table.
 *
 * `btc-whale` — cross-entity demo persona.
 *
 * Verification ritual at commit time (2026-05-21):
 *   - `bitcoinjs-lib.address.toOutputScript(addr, networks.bitcoin)`
 *     returned non-error for BOTH addresses (full bech32 + bech32m
 *     checksum + correct script-program length all pass).
 *   - Cross-checked against the OFAC SDN list via the 0xB10C registry
 *     (https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses)
 *     — NEITHER address listed.
 *   - Segwit: `bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h` — Binance
 *     segwit cold wallet, public + composition-stable, mempool.space
 *     unlabeled-sanctioned-clean (verified via mempool.space UI).
 *   - Taproot: `bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0`
 *     — BIP-86 published taproot test vector (immutable public
 *     specification artifact;
 *     https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki).
 *     OFAC-clean by construction (no entity controls a public spec test
 *     vector).
 *   - Cross-entity disclosure: the segwit slot is a Binance cold wallet
 *     and the taproot slot is the BIP-86 spec test vector. The demo
 *     persona surfaces realistic mainnet bech32 + bech32m shapes for
 *     read-tool exercise; cross-entity is acceptable per PATTERNS §Plan
 *     22-04 because no single-entity public dual segwit + taproot pair
 *     was reliable to identify (Binance has public segwit cold wallets
 *     but no publicly-disclosed taproot equivalent at the same date).
 */
export const BTC_PERSONAS: readonly BtcPersona[] = [
  {
    slug: "btc-whale",
    chain: "bitcoin",
    btcSegwitAddress: "bc1qm34lsc65zpw79lxes69zkqmk6ee3ewf0j77s3h",
    btcTaprootAddress:
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
    description:
      "Cross-entity BTC demo persona: Binance segwit cold wallet (P2WPKH) + BIP-86 spec taproot test vector (P2TR). Read-only demo — surfaces realistic bech32 + bech32m shapes for BTC read tools and portfolio aggregation.",
    rehearsableFlows: [
      "get_btc_balance against a real mainnet segwit address",
      "get_btc_balances exercising both script types in parallel",
      "get_btc_fee_estimates returning live sat/vB estimates",
      "get_btc_tx_history paging through the segwit-cold-wallet history",
    ],
    simulationEnvelopeShape: "psbt-mempool-replay",
  },
] as const;

// DOA validation at module load — DUAL address per persona.
// `address.toOutputScript` runs the full bech32 (segwit) / bech32m
// (taproot) checksum gate; corrupted last-char or wrong-encoding throws
// here at import time rather than at the first tool call.
//
// REGRESSION ANCHOR: if anyone copy-pastes a corrupted bech32 / bech32m
// string into the persona table, this throws at module import time.
// NEVER hand-roll a regex — bech32 and bech32m use DIFFERENT checksum
// constants (BIP-173 vs BIP-350); regex misses cross-encoding (a
// bech32m-checksummed string in a bech32-shaped slot still passes the
// regex; only `toOutputScript` distinguishes).
for (const p of BTC_PERSONAS) {
  try {
    btcAddress.toOutputScript(p.btcSegwitAddress, networks.bitcoin);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `BTC persona "${p.slug}" has invalid btcSegwitAddress: ${p.btcSegwitAddress}. ` +
        `Address must pass bitcoinjs-lib.address.toOutputScript on networks.bitcoin (full bech32 P2WPKH checksum). ` +
        `Cause: ${cause}`,
    );
  }
  try {
    btcAddress.toOutputScript(p.btcTaprootAddress, networks.bitcoin);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `BTC persona "${p.slug}" has invalid btcTaprootAddress: ${p.btcTaprootAddress}. ` +
        `Address must pass bitcoinjs-lib.address.toOutputScript on networks.bitcoin (full bech32m P2TR checksum). ` +
        `Cause: ${cause}`,
    );
  }
}

const bySlug = new Map(BTC_PERSONAS.map((p) => [p.slug, p]));

/**
 * Lookup a BTC persona by slug. Returns `undefined` for unknown slugs
 * (mirrors the EVM `PERSONAS.find` / Solana `findSolanaPersona` / TRON
 * `findTronPersona` shapes).
 */
export function findBtcPersona(slug: string): BtcPersona | undefined {
  return bySlug.get(slug as BtcPersonaSlug);
}

/**
 * List the curated BTC persona registry. Surfaced by `get_demo_wallet`.
 */
export function listBtcPersonas(): readonly BtcPersona[] {
  return BTC_PERSONAS;
}

/**
 * Type-witness: every `BtcPersona` from this registry is assignable to
 * the minimal `BtcPersonaState` shape that `setActiveBtcPersona` accepts.
 * Surfaces a compile-time break if the state-side shape drifts.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _stateShapeWitness: BtcPersonaState = BTC_PERSONAS[0]!;
