// TRON TRC-20 contract dispatch allowlist — Phase 18 / Plan 18-01.
//
// Layer 0.5 (TRON arm) of the preview pipeline. Sibling of
// `src/security/canonical-dispatch-solana.ts` (Solana — FROZEN) and
// `src/security/canonical-dispatch.ts` (EVM — FROZEN). Fires inside the
// TRON branch of `preview_send.ts` (Plan 18-04) AFTER handle lookup +
// BEFORE the mandatory simulation gate (Layer 0.7 — TRC-20 only). The
// check is over `record.tx.contractAddress` — the TRC-20 token contract
// address must appear in this allowlist or preview refuses with
// `DISPATCH_TARGET_REFUSED`.
//
// **TRON ASYMMETRY**: native TRX transfers (`record.tx.kind === "native"`)
// SKIP this check entirely. `checkTronDispatchTarget` is only called in the
// TRC-20 branch; the caller (Plan 18-04 preview_send) discriminates via
// `record.tx.txType === "tron" && record.tx.kind === "trc20"` before
// dispatching. Empty `contractAddresses` array returns `allowed` by
// construction.
//
// **v1.x SCOPE — 4 TRC-20 stablecoin contracts ONLY** (USDT, USDC, USDD, TUSD).
// These match the TRX-app bundled clear-sign registry entries, so the user
// gets decoded-args display on-device. Adding a contract here without the
// corresponding TRX-app registry analysis defeats the Layer 0.5 defense.
// Future phases widen:
//
//   - Phase 19 — SunSwap / JustLend lending contract addresses.
//   - Phase 20 — LiFi + Across bridging contract addresses.
//   - Phase 21 — TRON Stake 2.0 + TRC-20 approve / revoke approve.
//
// **SOURCE OF TRUTH**: addresses loaded from `src/tokens/tron-top-25.json`
// (Phase 17 curated list) filtered by symbol. This avoids hardcoding literals
// in this file; any Phase 17 address correction flows here automatically.
//
// [Rule 1 - Bug] The plan's execution_context listed USDD address as
// "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR" but that address is WTRX in
// `tron-top-25.json`. The correct USDD address from the JSON SOT is
// "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn". This file uses the JSON SOT
// (filter by symbol "USDD") per the plan's own instruction: "Pull these
// literal addresses from `src/tokens/tron-top-25.json` rather than
// hardcoding — single source of truth."
//
// Anti-pattern guard — NEVER add a "passthrough" or "any-contract" branch.
// The allowlist is exhaustive by design; the only way a TRC-20 TRON tx
// reaches the simulation gate is by passing this check.
//
// ESM spy-affordance per CLAUDE.md "ESM spy-affordance indirection"
// convention. `_canonicalDispatchTron` is the mutable indirection object
// production callers (Plan 18-04 `preview_send.ts` TRON branch) route
// through so tests can `vi.spyOn(_canonicalDispatchTron,
// "checkTronDispatchTarget")` to short-circuit the allowlist gate without
// monkey-patching the named export (ESM bindings are immutable; direct
// spies on named exports are no-ops for cross-export internal calls).

import tronTop25 from "../tokens/tron-top-25.json" with { type: "json" };

/** The four Phase-18-scope TRC-20 stablecoin symbols to include in the allowlist. */
const ALLOWED_SYMBOLS: ReadonlySet<string> = new Set(["USDT", "USDC", "USDD", "TUSD"]);

/**
 * Build the allowlist by filtering `tron-top-25.json` to the four Phase-18
 * stablecoin TRC-20 contracts. Evaluated ONCE at module load; subsequent
 * `checkTronDispatchTarget` calls are constant-time Set lookups.
 *
 * Using the JSON SOT means a Phase 17 address correction flows here
 * automatically and the allowlist is always consistent with the token
 * metadata store.
 */
function getTrc20StablecoinSet(): ReadonlySet<string> {
  const addresses = (tronTop25 as Array<{ contractAddress: string; symbol: string }>)
    .filter((token) => ALLOWED_SYMBOLS.has(token.symbol))
    .map((token) => token.contractAddress);
  return new Set(addresses);
}

/**
 * TRON TRC-20 dispatch allowlist for Phase 18 v1.x scope.
 *
 * Four entries (filtered from `src/tokens/tron-top-25.json`):
 *   1. USDT-TRC20 (TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t) — 6 decimals.
 *   2. USDC-TRC20 (TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8) — 6 decimals.
 *   3. USDD      (TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn)  — 18 decimals.
 *   4. TUSD      (TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4)  — 18 decimals.
 *
 * Evaluated ONCE at module load. Subsequent `checkTronDispatchTarget` calls
 * are constant-time Set lookups against the frozen entries.
 *
 * Format-fanout-sentinel: the per-contract base58check strings live in
 * `src/tokens/tron-top-25.json` (Phase 17 SOT) and are loaded here exactly
 * once. No tool or test should inline these literals; consume via
 * `TRON_TRC20_DISPATCH_ALLOWLIST.has(contractAddress)` or
 * `checkTronDispatchTarget`.
 */
export const TRON_TRC20_DISPATCH_ALLOWLIST: ReadonlySet<string> = getTrc20StablecoinSet();

/**
 * Discriminated-union result of `checkTronDispatchTarget`.
 *
 *   - `allowed` — every contract address in the input array is in the allowlist.
 *   - `refused` — at least one contract address is NOT in the allowlist. The
 *                 response carries the verbatim `offenders` list + the full
 *                 `allowlist` so the refusal envelope can name what the server
 *                 expected.
 */
export type TronDispatchCheckResult =
  | { kind: "allowed" }
  | { kind: "refused"; offenders: string[]; allowlist: string[] };

/**
 * Layer 0.5 (TRON arm) dispatch check. Returns `allowed` only when EVERY
 * contract address in the input array is in `TRON_TRC20_DISPATCH_ALLOWLIST`.
 * Mixed inputs (some allowed, some not) refuse — the allowed entries do NOT
 * rescue the refusal.
 *
 * Empty `contractAddresses` is `allowed` (no offenders by construction).
 * Called from `src/tools/preview_send.ts` TRON branch (Plan 18-04) for
 * TRC-20 handles AFTER handle lookup + BEFORE the Layer 0.7 simulation gate.
 * Native TRX handles (`record.tx.kind === "native"`) skip this check entirely.
 */
export function checkTronDispatchTarget(
  contractAddresses: string[],
): TronDispatchCheckResult {
  const offenders = contractAddresses.filter(
    (addr) => !TRON_TRC20_DISPATCH_ALLOWLIST.has(addr),
  );
  if (offenders.length === 0) return { kind: "allowed" };
  return {
    kind: "refused",
    offenders,
    allowlist: [...TRON_TRC20_DISPATCH_ALLOWLIST],
  };
}

/**
 * ESM spy-affordance per CLAUDE.md § Conventions. The indirection object is
 * the only seam for `vi.spyOn(_canonicalDispatchTron,
 * "checkTronDispatchTarget")` — direct spies on the named export are silent
 * no-ops for cross-export internal calls (ESM bindings are immutable).
 * Production callers (`src/tools/preview_send.ts` TRON branch — Plan 18-04)
 * call through this object so the spy applies to them.
 */
export const _canonicalDispatchTron = { checkTronDispatchTarget };
