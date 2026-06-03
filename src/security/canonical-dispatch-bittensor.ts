// Bittensor (subtensor) (section, method) dispatch allowlist — Phase 47 / Plan
// 47-03 (TAO-W-04). Layer 0.5 of the preview pipeline (Bittensor arm).
//
// NON-EVM sibling-arm pattern — mirrors `canonical-dispatch-tron.ts`'s
// `{ kind: "allowed" } | { kind: "refused" }` discriminated result, NOT the EVM
// `checkDispatchTarget`. Fires inside the Bittensor branch of `preview_send.ts`
// (Plan 47-03) after handle lookup. The check is over the extrinsic's
// `(section, method)` — only the eight milestone-locked calls reach preview
// (the 3 shipped Phase-47 + the 5 Phase-48 deferred staking shapes);
// `sudo`, `swapColdkey`, or anything else refuses with DISPATCH_TARGET_REFUSED.
//
// KEYING (47-RESEARCH correction #2): keyed in CAMELCASE
// (`subtensorModule.addStakeLimit`) matching what `record.tx.section/method`
// carries (the `api.tx.<section>.<method>` form). The on-chain snake_case
// (`add_stake_limit`) is echoed ONLY in the user-facing receipt — NEVER used
// as an allowlist key. A snake_case key would silently NOT match (pinned in the
// test).
//
// SCOPE (47-RESEARCH §Locked Decisions): `(pallet, call)`-ONLY. Arg-level
// allowlisting (hotkey / netuid value checks) is explicitly DEFERRED to a
// later phase.
//
// Anti-pattern guard — NEVER add a "passthrough" or "any-call" branch. The
// allowlist is exhaustive by design; the only way a Bittensor extrinsic reaches
// the device is by passing this check.
//
// ESM spy-affordance per CLAUDE.md — `_canonicalDispatchBittensor` is the
// indirection the preview arm routes through so tests can `vi.spyOn` it.

/**
 * Bittensor dispatch allowlist — the eight milestone-locked `(section, method)`
 * pairs, keyed CAMELCASE (`"section.method"`).
 *
 *   1. subtensorModule.addStakeLimit    — slippage-guarded stake (DEFAULT entry)
 *   2. subtensorModule.removeStakeLimit — slippage-guarded unstake (DEFAULT exit)
 *   3. balances.transferKeepAlive       — native TAO send
 *   4. subtensorModule.addStake         — PLAIN add_stake (Phase 48, TAO-W-06)
 *   5. subtensorModule.removeStake      — PLAIN remove_stake (Phase 48, TAO-W-06)
 *   6. subtensorModule.moveStake        — same-owner reallocation (Phase 48, TAO-W-07)
 *   7. subtensorModule.swapStake        — same-owner subnet swap (Phase 48, TAO-W-07)
 *   8. subtensorModule.transferStake    — CUSTODY CHANGE (Phase 48, TAO-W-08)
 *
 * Evaluated ONCE at module load; subsequent `checkBittensorDispatch` calls are
 * constant-time Set lookups. Format-fanout-sentinel: no tool/test inlines these
 * keys — consume via `BITTENSOR_DISPATCH_ALLOWLIST.has(...)` or
 * `checkBittensorDispatch`. The on-chain snake_case form (`add_stake`) is
 * receipt-only and would NOT match (camelCase keying — pinned in the test).
 */
export const BITTENSOR_DISPATCH_ALLOWLIST: ReadonlySet<string> = new Set([
  "subtensorModule.addStakeLimit",
  "subtensorModule.removeStakeLimit",
  "balances.transferKeepAlive",
  "subtensorModule.addStake", // NEW — TAO-W-06 (PLAIN add_stake)
  "subtensorModule.removeStake", // NEW — TAO-W-06 (PLAIN remove_stake)
  "subtensorModule.moveStake", // NEW — TAO-W-07 (same-owner reallocation)
  "subtensorModule.swapStake", // NEW — TAO-W-07 (same-owner subnet swap)
  "subtensorModule.transferStake", // NEW — TAO-W-08 (CUSTODY CHANGE)
]);

/**
 * Discriminated-union result of `checkBittensorDispatch`.
 *
 *   - `allowed` — the `(section, method)` pair is in the allowlist.
 *   - `refused` — the pair is NOT in the allowlist. Carries the verbatim
 *                 `offender` ("section.method") + the full `allowlist` so the
 *                 refusal envelope can name what the server expected.
 */
export type BittensorDispatchCheckResult =
  | { kind: "allowed" }
  | { kind: "refused"; offender: string; allowlist: string[] };

/**
 * Layer 0.5 (Bittensor arm) dispatch check. Returns `allowed` only when the
 * `(section, method)` pair is in `BITTENSOR_DISPATCH_ALLOWLIST`. The key is
 * built CAMELCASE (`${section}.${method}`) — matching `record.tx.section` +
 * `record.tx.method` (the `api.tx.<section>.<method>` form). Called from the
 * Bittensor branch of `preview_send.ts` (Plan 47-03) after handle lookup.
 */
export function checkBittensorDispatch(
  section: string,
  method: string,
): BittensorDispatchCheckResult {
  const key = `${section}.${method}`;
  if (BITTENSOR_DISPATCH_ALLOWLIST.has(key)) return { kind: "allowed" };
  return {
    kind: "refused",
    offender: key,
    allowlist: [...BITTENSOR_DISPATCH_ALLOWLIST],
  };
}

/**
 * ESM spy-affordance per CLAUDE.md. The preview arm calls through this object
 * so `vi.spyOn(_canonicalDispatchBittensor, "checkBittensorDispatch")` applies
 * (direct spies on the named export are silent no-ops for cross-export calls).
 */
export const _canonicalDispatchBittensor = { checkBittensorDispatch };
