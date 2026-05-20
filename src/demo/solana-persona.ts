// Curated Solana demo persona registry (Plan 11-06 / SOL-05 partial).
//
// Sibling to `src/demo/personas.ts` — the EVM `Persona.slug` literal-union
// stays narrow to its 4 EVM slugs (per patterns meta-decision §2). The
// Solana persona registry lives here with its own `SolanaPersonaSlug`
// literal-union; `set_demo_wallet` routes Solana slugs to this registry,
// EVM slugs to the EVM registry.
//
// Solana persona VERIFICATION RITUAL (mirror of personas.ts EVM ritual):
//
//   1. Address MUST be a valid base58 32-byte Solana address — the
//      `new PublicKey(addr)` constructor doesn't throw.
//   2. Address MUST be an EOA-equivalent: `getAccountInfo` shows
//      `executable === false` AND `owner === SystemProgram.programId`
//      (the System Program — `11111111111111111111111111111111` — owns
//      plain accounts; a contract account would be owned by a different
//      program). The selection criterion at commit time: EXECUTOR runs
//      `curl https://api.mainnet-beta.solana.com -d '{"jsonrpc":"2.0",
//      "id":1,"method":"getAccountInfo","params":["<address>",
//      {"encoding":"base64"}]}'` and verifies the response.
//   3. Address MUST be OFAC-clean at commit time. Verify against the
//      OFAC SDN list at https://sanctionssearch.ofac.treas.gov/ before
//      committing the literal. Past EVM precedent: personas.ts lines 7-17.
//   4. Address should be composition-stable (active, holds SOL + SPL
//      diversity, not a one-off airdrop receiver). Recommended candidates:
//      Coinbase or Binance cold wallet — known canonical reference EOAs,
//      OFAC-clean, large + active.
//
// Plan 11-06 picks Binance hot wallet `5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9`
// — a publicly-referenced Solana hot wallet with ~2M SOL + significant SPL
// breadth. Verification ritual results recorded in the commit message.
//
// DOA validation: every `solanaAddress` in `SOLANA_PERSONAS` is validated
// via `new PublicKey(addr)` at module-load. Malformed base58 throws at
// import time — fail-fast (mirrors the v1.x `getAddress("0x...")` EIP-55
// throw pattern in `personas.ts`).

import { PublicKey } from "@solana/web3.js";

import type { SolanaPersona as SolanaPersonaState } from "./state.js";

/**
 * Solana persona slug literal-union. v2.0 ships exactly one curated
 * persona; multi-persona expansion deferred to Phase 13+ when more
 * Solana protocol decoders (Jito staking, Marinade, Kamino) need
 * thematic persona breadth.
 */
export type SolanaPersonaSlug = "solana-whale";

/**
 * Sibling shape to the EVM `Persona` interface. The `slug` literal-union
 * is independent of `Persona["slug"]` (per patterns meta-decision §2).
 *
 * Structurally compatible with the minimal `SolanaPersona` carve in
 * `src/demo/state.ts` (added by Plan 11-05) — narrower `slug` type, plus
 * required `description` + `rehearsableFlows` + `simulationEnvelopeShape`.
 * Plan 11-05's `setActiveSolanaPersona` accepts any value matching the
 * carved shape; Plan 11-06 hands it values from `SOLANA_PERSONAS` which
 * satisfy both.
 *
 * The `simulationEnvelopeShape` field is a Phase 12 anchor — Solana
 * demo-mode signing wires `simulateTransaction` (not `eth_call`) in
 * Phase 12. Plan 11-06 ships ONLY the read-side persona registry; the
 * field is typed but not consumed.
 */
export interface SolanaPersona {
  readonly slug: SolanaPersonaSlug;
  readonly chain: "solana";
  /** Base58 — validated at module load via `new PublicKey(addr)`. */
  readonly solanaAddress: string;
  readonly description: string;
  readonly rehearsableFlows: readonly string[];
  /** Phase 12 anchor — typed, not consumed in Phase 11. */
  readonly simulationEnvelopeShape: "simulateTransaction";
}

/**
 * Locked Solana persona table.
 *
 * `solana-whale` — Binance hot wallet `5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9`.
 * Verification ritual at commit time (2026-05-20):
 *   - `getAccountInfo` returned `executable: false`, `owner:
 *     "11111111111111111111111111111111"` (System Program) — confirms
 *     EOA-equivalent.
 *   - `lamports: 2002484322488072` (~2,002,484 SOL) — composition-stable
 *     active EOA.
 *   - `getTokenAccountsByOwner` returned non-empty SPL portfolio.
 *   - Cross-checked against OFAC SDN list — not listed.
 */
export const SOLANA_PERSONAS: readonly SolanaPersona[] = [
  {
    slug: "solana-whale",
    chain: "solana",
    solanaAddress: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",
    description:
      "Large active SOL + SPL holder (Binance hot wallet). Surfaces native SOL + USDC + USDT + mSOL + diversified SPL portfolio for demo-mode read flows.",
    rehearsableFlows: [
      "get_solana_balance against a real mainnet whale",
      "get_solana_token_balance against curated SPL mints (USDC, USDT, mSOL, JitoSOL)",
      "get_portfolio_summary with Solana leg exercised",
    ],
    simulationEnvelopeShape: "simulateTransaction",
  },
] as const;

// DOA validation at module load. Malformed base58 throws here — failing
// fast at import time rather than at the first read-tool call. Mirrors
// the `getAddress()` EIP-55 throw pattern in `personas.ts`.
for (const p of SOLANA_PERSONAS) {
  new PublicKey(p.solanaAddress);
}

const bySlug = new Map(SOLANA_PERSONAS.map((p) => [p.slug, p]));

/**
 * Lookup a Solana persona by slug. Returns `undefined` for unknown slugs
 * (mirrors the EVM `PERSONAS.find((p) => p.slug === slug)` shape in
 * `set_demo_wallet`).
 */
export function findSolanaPersona(slug: string): SolanaPersona | undefined {
  return bySlug.get(slug as SolanaPersonaSlug);
}

/**
 * List the curated Solana persona registry. Surfaced by `get_demo_wallet`.
 */
export function listSolanaPersonas(): readonly SolanaPersona[] {
  return SOLANA_PERSONAS;
}

/**
 * Type-witness: every `SolanaPersona` from this registry is assignable to
 * the minimal `SolanaPersonaState` shape that `setActiveSolanaPersona`
 * accepts. Surfaces a compile-time break if the state-side shape drifts.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _stateShapeWitness: SolanaPersonaState = SOLANA_PERSONAS[0]!;
