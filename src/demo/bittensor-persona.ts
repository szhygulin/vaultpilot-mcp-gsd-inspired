// Curated Bittensor demo persona registry — Phase 46 Plan 46-01 (TAO-R-04).
//
// Sibling to `src/demo/solana-persona.ts`. The EVM `Persona.slug` and the
// `SolanaPersonaSlug` / `TronPersonaSlug` literal-unions each stay narrow
// to their own chain; the SS58 literal-union can't merge into the viem
// `Address`-branded EVM type (same reason Solana got its own registry).
// `set_demo_wallet` routes Bittensor slugs to this registry.
//
// Bittensor persona VERIFICATION RITUAL (mirror of the Solana ritual):
//
//   1. Address MUST be a valid prefix-42 SS58 coldkey — `decodeAddress(addr)`
//      doesn't throw (full blake2-256 checksum gate; a single-byte flip
//      throws). Validated at module load (the DOA loop below).
//   2. Address SHOULD be composition-stable: a real, active TAO-ecosystem
//      coldkey holding free TAO + diversified per-subnet alpha stake (so
//      `get_bittensor_balance` / `get_bittensor_stake` surface meaningful
//      read data). Selection criterion at commit time: EXECUTOR probes
//      `system.account(addr).data.free` + `stakeInfoRuntimeApi
//      .getStakeInfoForColdkey(addr)` against the live Finney chain.
//   3. Address MUST be OFAC-clean at commit time. Verify against the OFAC
//      SDN list at https://sanctionssearch.ofac.treas.gov/ before
//      committing the literal. (The SDN list's crypto entries are
//      BTC/ETH/XMR/etc. addresses — no bare-SS58 Substrate addresses are
//      listed; this generic validator coldkey has no exchange/mixer
//      association.)
//
// Phase 46 picks `bittensor-whale` = 5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9.
// Verification ritual at commit time (2026-06-03, live node-subtensor spec
// 413):
//   - `decodeAddress` ok; prefix-42 re-encode round-trip identical (pubkey
//     0xd4b3efa00c7f20e8e94f39d1bed97ce0cacceb122a09a9ca24dfda401710391b).
//   - `system.account.data.free` ≈ 1 TAO free.
//   - `getStakeInfoForColdkey` returned 74 active per-subnet alpha stake
//     positions — composition-stable, diversified ecosystem coldkey (the
//     coldkey behind a netuid-1 validator hotkey).
//   - Cross-checked against the OFAC SDN list — not listed.
//
// DOA validation: every `ss58Address` in `BITTENSOR_PERSONAS` is validated
// via `decodeAddress(addr)` at module-load. A malformed / wrong-checksum
// address throws here — failing fast at import time rather than at the
// first read-tool call (mirror of the Solana `new PublicKey(addr)` throw).
// Amounts are labeled TAO (the chain's native token), distinct from the
// per-subnet alpha token (the off-by-unit rule).

import { decodeAddress } from "@polkadot/util-crypto";

import type { BittensorPersona as BittensorPersonaState } from "./state.js";

/**
 * Bittensor persona slug literal-union. v2.7 ships exactly one curated
 * persona; multi-persona expansion is deferred to a later phase when more
 * subnet/staking flows need thematic breadth.
 */
export type BittensorPersonaSlug = "bittensor-whale";

/**
 * Sibling shape to the EVM / Solana `Persona` interfaces. The `slug`
 * literal-union is independent of the other chains' slug types.
 *
 * Structurally compatible with the minimal `BittensorPersona` carve in
 * `src/demo/state.ts` — narrower `slug` type, plus required `description`
 * + `rehearsableFlows`.
 */
export interface BittensorPersona {
  readonly slug: BittensorPersonaSlug;
  readonly chain: "bittensor";
  /** Prefix-42 SS58 coldkey — validated at module load via decodeAddress. */
  readonly ss58Address: string;
  readonly description: string;
  readonly rehearsableFlows: readonly string[];
}

/**
 * Locked Bittensor persona table.
 *
 * `bittensor-whale` — 5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9.
 * A real, active TAO-ecosystem coldkey: ~1 TAO free + 74 per-subnet alpha
 * stake positions (verification ritual recorded above + in the commit
 * message). Surfaces native free TAO + diversified dTAO alpha stake for
 * demo-mode read flows.
 */
export const BITTENSOR_PERSONAS: readonly BittensorPersona[] = [
  {
    slug: "bittensor-whale",
    chain: "bittensor",
    ss58Address: "5GsbTgfvgCH4xdqSkiPb7EaBBFLHjWH5vfEALhJaewSFpZX9",
    description:
      "Active TAO-ecosystem coldkey holding free TAO + diversified per-subnet alpha stake (74 positions). Surfaces native TAO balance + dTAO alpha stake (labeled distinct from TAO) for demo-mode read flows.",
    rehearsableFlows: [
      "get_bittensor_balance against a real mainnet coldkey (free + staked TAO-equiv)",
      "get_bittensor_stake across subnets (per-(hotkey,netuid) alpha + TAO-equivalent)",
      "get_bittensor_subnets + get_bittensor_validators enumeration",
    ],
  },
] as const;

// DOA validation at module load. A malformed / wrong-checksum SS58 throws
// here — failing fast at import time rather than at the first read-tool
// call. Mirrors the `new PublicKey()` Solana / `getAddress()` EVM patterns.
for (const p of BITTENSOR_PERSONAS) {
  decodeAddress(p.ss58Address);
}

const bySlug = new Map(BITTENSOR_PERSONAS.map((p) => [p.slug, p]));

/**
 * Lookup a Bittensor persona by slug. Returns `undefined` for unknown
 * slugs (mirrors the Solana `findSolanaPersona` shape).
 */
export function findBittensorPersona(
  slug: string,
): BittensorPersona | undefined {
  return bySlug.get(slug as BittensorPersonaSlug);
}

/**
 * List the curated Bittensor persona registry. Surfaced by
 * `get_demo_wallet`.
 */
export function listBittensorPersonas(): readonly BittensorPersona[] {
  return BITTENSOR_PERSONAS;
}

/**
 * Type-witness: every `BittensorPersona` from this registry is assignable
 * to the minimal `BittensorPersonaState` shape that
 * `setActiveBittensorPersona` accepts. Surfaces a compile-time break if
 * the state-side shape drifts.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _stateShapeWitness: BittensorPersonaState = BITTENSOR_PERSONAS[0]!;
