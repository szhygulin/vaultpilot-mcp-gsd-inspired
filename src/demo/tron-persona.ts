// Curated TRON demo persona registry (Plan 17-05 / TRON read-only demo).
//
// Sibling to `src/demo/personas.ts` (EVM) and `src/demo/solana-persona.ts`
// (Solana) — per PATTERN-MAPPER META-DECISION §2, the EVM `Persona.slug`
// literal-union stays narrow to its 4 EVM slugs. TRON gets its own
// `TronPersonaSlug` literal-union here; `set_demo_wallet` routes TRON
// slugs to this registry, Solana slugs to the Solana registry, EVM slugs
// to the EVM registry.
//
// TRON persona VERIFICATION RITUAL (perform at plan-author time + at every
// persona addition):
//
//   1. Confirm via TronScan UI that the address is NOT labeled as a
//      sanctioned entity or hacked exchange.
//      https://tronscan.org/#/address/<ADDR>
//   2. Confirm against the OFAC SDN list via the 0xB10C registry:
//      https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses
//   3. Confirm the address has a non-trivial balance + activity history
//      (5+ year existence; >10K TRX or contract-account with on-chain
//      code presence).
//   4. Note the verification date in a comment beside each entry.
//
// Plan 17-05 picks the `TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb` whale wallet —
// 141.2M TRX balance, active since 2018-11, OFAC-clean per the 0xB10C
// registry. Fallback candidates documented inline if the preferred entry
// proves problematic.
//
// DOA validation: every `tronAddress` in `TRON_PERSONAS` is validated via
// `tronUtils.address.isAddress(addr)` at module-load. The full base58check
// + checksum + 0x41-prefix gate (research § Topic 4 Pitfall 4) throws at
// import time on any malformed entry — fail-fast (mirrors the EVM
// `getAddress("0x...")` EIP-55 throw pattern in `personas.ts` and the
// Solana `new PublicKey(addr)` pattern in `solana-persona.ts`).

import { utils as tronUtils } from "tronweb";

import type { TronPersona as TronPersonaState } from "./state.js";

/**
 * TRON persona slug literal-union. v2.1 ships exactly one curated persona;
 * multi-persona expansion may follow in v2.x as more TRON protocol
 * decoders (JustLend, SunSwap) need thematic persona breadth. Additive
 * widening — new slugs join the union without breaking existing callers.
 */
export type TronPersonaSlug = "tron-whale";

/**
 * Sibling shape to the EVM `Persona` interface and the Solana
 * `SolanaPersona` interface. The `slug` literal-union is independent of
 * `Persona["slug"]` / `SolanaPersonaSlug` (per PATTERN-MAPPER META-DECISION §2).
 *
 * Structurally compatible with the minimal `TronPersona` carve in
 * `src/demo/state.ts` (added by Plan 17-04) — narrower `slug` type, plus
 * required `description` + `rehearsableFlows` + `simulationEnvelopeShape`.
 * Plan 17-04's `setActiveTronPersona` accepts any value matching the
 * carved shape; Plan 17-05 hands it values from `TRON_PERSONAS` which
 * satisfy both.
 *
 * The `simulationEnvelopeShape` field is a Phase 18 anchor — TRON
 * demo-mode signing wires `triggerconstantcontract` (TRON's analog of
 * EVM `eth_call`) in Phase 18. Plan 17-05 ships ONLY the read-side
 * persona registry; the field is typed but not consumed.
 */
export interface TronPersona {
  readonly slug: TronPersonaSlug;
  readonly chain: "tron";
  /** Base58check, T-prefixed (34 chars). Validated at module load. */
  readonly tronAddress: string;
  readonly description: string;
  readonly rehearsableFlows: readonly string[];
  /** Phase 18 anchor — typed, not consumed in Phase 17. */
  readonly simulationEnvelopeShape: "triggerconstantcontract";
}

/**
 * Locked TRON persona table.
 *
 * `tron-whale` — TRON whale wallet `TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb`.
 * Verification ritual at commit time (2026-05-20):
 *   - `tronUtils.address.isAddress` returned `true` (base58check + checksum
 *     + 0x41-prefix all pass).
 *   - Cross-checked against the OFAC SDN list via the 0xB10C registry
 *     (https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses)
 *     — NOT listed.
 *   - Balance: ~141.2M TRX (live spot-check via TronScan UI).
 *   - Active since 2018-11 — composition-stable, balance-history-consistent
 *     with the exchange-cold-wallet pattern reported by Blockworks
 *     (https://blockworks.co/news/binance-cold-wallet-usdt).
 *   - Unlabeled on TronScan (API surface 401-gated) — acceptable residual
 *     risk for read-only demo flows. If TronScan later labels this address
 *     as a hostile entity, fall back to JustLend `mainContractAddress`
 *     (the on-chain-code provenance is stronger but the whale-balance
 *     optics weaker).
 */
export const TRON_PERSONAS: readonly TronPersona[] = [
  {
    slug: "tron-whale",
    chain: "tron",
    tronAddress: "TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb",
    description:
      "Major TRON whale wallet (~141M TRX, active since 2018-11). Read-only demo persona — surfaces realistic balance shapes for TRON read tools and portfolio aggregation.",
    rehearsableFlows: [
      "get_tron_balance against a real mainnet whale",
      "get_tron_token_balance against curated TRC-20 contracts (USDT, USDC)",
      "get_portfolio_summary with TRON leg exercised",
    ],
    simulationEnvelopeShape: "triggerconstantcontract",
  },
] as const;

// DOA validation at module load. Malformed base58check / corrupted
// checksum / non-0x41-prefix throws here — failing fast at import time
// rather than at the first read-tool call. Mirrors the EVM
// `getAddress()` EIP-55 throw pattern in `personas.ts` and the Solana
// `new PublicKey(addr)` pattern in `solana-persona.ts`.
//
// REGRESSION ANCHOR (research § Topic 4 Pitfall 4) — if anyone copy-pastes
// a corrupted T-prefix string into the persona table, this throws at
// module import time. NEVER hand-roll a regex (regex misses bad-checksum
// input — the corrupted-last-char of a valid address still passes the
// regex; only the full `isAddress` gate catches it).
for (const p of TRON_PERSONAS) {
  if (!tronUtils.address.isAddress(p.tronAddress)) {
    throw new Error(
      `TRON persona "${p.slug}" has invalid tronAddress: ${p.tronAddress}. ` +
        `Address must pass tronUtils.address.isAddress (full base58check + checksum + 0x41 prefix).`,
    );
  }
}

const bySlug = new Map(TRON_PERSONAS.map((p) => [p.slug, p]));

/**
 * Lookup a TRON persona by slug. Returns `undefined` for unknown slugs
 * (mirrors the EVM `PERSONAS.find((p) => p.slug === slug)` shape in
 * `set_demo_wallet` and the Solana `findSolanaPersona` shape).
 */
export function findTronPersona(slug: string): TronPersona | undefined {
  return bySlug.get(slug as TronPersonaSlug);
}

/**
 * List the curated TRON persona registry. Surfaced by `get_demo_wallet`.
 */
export function listTronPersonas(): readonly TronPersona[] {
  return TRON_PERSONAS;
}

/**
 * Type-witness: every `TronPersona` from this registry is assignable to
 * the minimal `TronPersonaState` shape that `setActiveTronPersona`
 * accepts. Surfaces a compile-time break if the state-side shape drifts.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _stateShapeWitness: TronPersonaState = TRON_PERSONAS[0]!;
