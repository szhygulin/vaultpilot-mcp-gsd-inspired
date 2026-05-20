// src/chains/compound-v3.ts
//
// Sibling-shelf helper for Compound V3 Comet reads — Phase 28 Plan 28-02
// (PARTIAL surface; the full `getCometState` + `getAllCometStates` multicall
// fan-out lands in Plan 28-04). Structural mirror of `src/chains/aave-v3.ts`:
// helper-per-read + `_compoundChains` ESM spy indirection.
//
// Plan 28-02 ships the MINIMUM surface the 4 prepare tools need for their
// intent-vs-reality gates:
//   - `readBaseToken(client, comet)`                — Comet.baseToken()
//   - `readBorrowBalance(client, comet, user)`      — Comet.borrowBalanceOf(user)
//   - `readBaseBalance(client, comet, user)`        — Comet.balanceOf(user)
//   - `deriveIntent(client, comet, user, sel, ast)` — 4-arm intent label
//
// The 4-arm intent label is the central abstraction (research § Topic 3):
// Compound V3's 2 calldata selectors (supply / withdraw) cover 4 agent
// intents (supply-collateral / repay-debt / withdraw-collateral / borrow).
// The discriminator is `(asset === baseToken, user-position-shape)`; this
// helper IS that discriminator.
//
// Cryptographic-binding chain is FROZEN — this module reads RPC, computes
// nothing the device signs. The prepare tools that consume `deriveIntent`
// branch on its return value BEFORE encoding calldata, so an intent mismatch
// short-circuits the prepare envelope (no handle created).

import { type Address, type PublicClient, getAddress } from "viem";

import { COMPOUND_V3_COMET_ABI } from "../protocols/compound-v3.js";

/**
 * Read `Comet.baseToken()` — the canonical base asset of a Compound V3 Comet
 * (the ONLY borrowable asset in that market; all other configured assets are
 * collateral-only). Single RPC round-trip.
 *
 * The Comet ABI fragment lives in `src/protocols/compound-v3.ts` (Plan 28-01).
 * Cross-import sentinel: any future second consumer that needs the same read
 * MUST import this helper, NOT inline `client.readContract({ functionName:
 * "baseToken" })` — the format-fanout-sentinel discipline.
 */
export async function readBaseToken(
  client: PublicClient,
  comet: Address,
): Promise<Address> {
  const result = await client.readContract({
    address: comet,
    abi: COMPOUND_V3_COMET_ABI,
    functionName: "baseToken",
  });
  return result as Address;
}

/**
 * Read `Comet.borrowBalanceOf(user)` — the user's outstanding base-asset debt
 * on a Compound V3 Comet. Returns `0n` when the user has no debt. Single RPC
 * round-trip.
 *
 * The intent-vs-reality gate for `prepare_compound_supply` consumes this:
 * agent passes the base asset AND `borrowBalanceOf > 0n` → the real intent is
 * repay, not supply (refusal with hint pointing at prepare_compound_repay).
 */
export async function readBorrowBalance(
  client: PublicClient,
  comet: Address,
  user: Address,
): Promise<bigint> {
  const result = await client.readContract({
    address: comet,
    abi: COMPOUND_V3_COMET_ABI,
    functionName: "borrowBalanceOf",
    args: [user],
  });
  return result as bigint;
}

/**
 * Read `Comet.balanceOf(user)` — the user's supplied BASE-asset balance on a
 * Compound V3 Comet. NOTE: Compound V3's `balanceOf` is the lender position
 * in the base asset, NOT a generic ERC-20 balance; collateral positions live
 * in `collateralBalanceOf(user, asset)` (Plan 28-04 surface). Single RPC
 * round-trip.
 *
 * The intent-vs-reality gate for `prepare_compound_withdraw` consumes this:
 * agent passes the base asset AND `balanceOf === 0n` → the real intent is
 * borrow, not withdraw (refusal with hint pointing at prepare_compound_borrow).
 */
export async function readBaseBalance(
  client: PublicClient,
  comet: Address,
  user: Address,
): Promise<bigint> {
  const result = await client.readContract({
    address: comet,
    abi: COMPOUND_V3_COMET_ABI,
    functionName: "balanceOf",
    args: [user],
  });
  return result as bigint;
}

/**
 * 4-arm intent label returned by `deriveIntent`. Compound V3's 2 calldata
 * selectors (`supply`, `withdraw`) cover all 4 agent intents:
 *
 *   - `supply-collateral`   — supply selector + (asset !== baseToken OR
 *                             asset === baseToken + zero debt). Both the
 *                             collateral-supply path AND the lender-position
 *                             base-asset supply collapse to this label
 *                             because the calldata + on-chain behavior are
 *                             identical (Compound treats the deposit as a
 *                             pure ADD with no repay component when debt = 0).
 *   - `repay-debt`          — supply selector + asset === baseToken +
 *                             borrowBalance > 0. The protocol applies the
 *                             deposit against the debt first, then any
 *                             remainder lands in the lender position.
 *   - `withdraw-collateral` — withdraw selector + (asset !== baseToken OR
 *                             asset === baseToken + supply > 0). Both the
 *                             collateral-withdraw path AND the base-asset
 *                             unwind collapse here.
 *   - `borrow`              — withdraw selector + asset === baseToken +
 *                             supply === 0. Withdrawing the base asset
 *                             AGAINST zero supply IS the borrow operation
 *                             at the protocol level — the protocol mints
 *                             debt to satisfy the transfer (collateralized
 *                             by other assets the wallet has supplied).
 *
 * The prepare-tool gates branch on this label: `supply` tool refuses on
 * `repay-debt` (hint: prepare_compound_repay); `withdraw` tool refuses on
 * `borrow` (hint: prepare_compound_borrow); the reverse-direction tools
 * (`borrow` / `repay`, Plan 28-03) refuse on the complementary mismatches.
 */
export type CompoundIntent =
  | "supply-collateral"
  | "repay-debt"
  | "withdraw-collateral"
  | "borrow";

/**
 * Derive the real agent intent given the selector the prepare tool is about
 * to encode + the asset arg. Makes 1-2 RPC reads:
 *
 *   - Always: `readBaseToken(client, comet)` to check `asset === baseToken`.
 *   - Conditionally: `readBorrowBalance(client, comet, user)` for the supply
 *     selector when `asset === baseToken`; `readBaseBalance(client, comet,
 *     user)` for the withdraw selector when `asset === baseToken`.
 *
 * When `asset !== baseToken`, only the 1 baseToken read fires — the
 * collateral-shape arms don't need user-position lookups. Cost discipline:
 * the cheap path stays cheap; the expensive path runs only when the gate
 * needs to discriminate repay-vs-supply or borrow-vs-withdraw.
 *
 * All address comparisons go through `viem.getAddress` to normalize EIP-55
 * checksums — caller may pass mixed-case input.
 *
 * NEVER throws on a well-formed RPC; the bubbling-up `Error` from the
 * underlying `readContract` is the caller's signal to surface
 * `INTERNAL_ERROR`. The 4 prepare tools wrap `deriveIntent` in their own
 * try/catch per their existing scaffold pattern.
 */
export async function deriveIntent(
  client: PublicClient,
  comet: Address,
  user: Address,
  selector: "supply" | "withdraw",
  asset: Address,
): Promise<CompoundIntent> {
  const baseToken = await _compoundChains.readBaseToken(client, comet);
  const isBase = getAddress(asset) === getAddress(baseToken);
  if (selector === "supply") {
    if (!isBase) return "supply-collateral";
    const debt = await _compoundChains.readBorrowBalance(client, comet, user);
    return debt > 0n ? "repay-debt" : "supply-collateral";
  }
  // selector === "withdraw"
  if (!isBase) return "withdraw-collateral";
  const supplied = await _compoundChains.readBaseBalance(client, comet, user);
  return supplied > 0n ? "withdraw-collateral" : "borrow";
}

/**
 * ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection" convention.
 * Both `prepare_compound_supply` + `prepare_compound_withdraw` (this plan) AND
 * `prepare_compound_borrow` + `prepare_compound_repay` (Plan 28-03) import
 * `_compoundChains` and route their intent-derivation through
 * `_compoundChains.deriveIntent(...)`. Tests `vi.spyOn(_compoundChains, ...)`
 * to intercept RPC reads without monkey-patching the production import path.
 *
 * Plan 28-04 EXTENDS this object with `getCometState` + `getAllCometStates`
 * for the read-tool branch (`get_compound_market_info` + `get_lending_positions`
 * Compound arm). All consumers go through `_compoundChains.<fn>`, not the
 * named exports — ESM named-export bindings are immutable; direct spies are
 * no-ops for internal cross-export calls.
 */
export const _compoundChains = {
  readBaseToken,
  readBorrowBalance,
  readBaseBalance,
  deriveIntent,
};
