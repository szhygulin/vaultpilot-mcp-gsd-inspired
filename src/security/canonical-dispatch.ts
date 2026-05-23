// Per-chain canonical dispatch-target allowlist — Phase 9 / Plan 09-04 (SEC-35).
//
// Layer 0.5 of the preview pipeline: server-side refusal at `preview_send`
// when `record.tx.to` is not on the per-chain canonical-contract allowlist.
// Fires AFTER handle lookup (needs `record.tx.chainId` + `record.tx.to`) and
// BEFORE the Phase 8 Layer 2 chain-name mismatch refusal (lines 173-191 of
// `preview_send.ts`). Native sends (`record.tx.data === "0x"`) bypass entirely
// per RESEARCH § Topic 6 lines 539-541 lock — any `to` is valid for a value
// transfer.
//
// DF-2 LOCKED (RESEARCH § DF-2 Option A): `CANONICAL_DISPATCH_TARGETS` is a
// PARALLEL table — NOT a widening of `KNOWN_SPENDERS_ETHEREUM`. Rationale:
// spender-labels is a UI concern (DECODED ARGS approve template); dispatch-
// allowlist is a SECURITY concern (Layer 0.5 refusal gate). Two tables, two
// purposes, two evolution cadences.
//
// LOCKED option (b) PARTIAL (per Plan 09-04 `<implementation_guidance>`):
// CANONICAL_DISPATCH_TARGETS additionally consumes BRIDGED_VARIANTS (Plan
// 08-04 SOT) for per-chain token-contract coverage. Without this, Phase 6
// ERC-20 lifecycle (`prepare_token_send` / `prepare_token_approve` /
// `prepare_revoke_approval`) would refuse at Layer 0.5 because token
// contracts are NOT in the 4-entry canonical set. With this, the per-chain
// Set covers Aave Pool + WETH9 + 1inch V6 + LiFi Diamond + curated
// BRIDGED_VARIANTS token contracts (USDC / USDT / DAI / WBTC / etc.). The
// Set absorbs duplicates (e.g. WETH9 on Base/Optimism shares the
// `0x4200…0006` predeploy address with the BRIDGED_VARIANTS WETH row).
//
// Per-chain entries:
//   - Aave V3 Pool — sourced via `getAaveV3PoolAddress(chainId)` (Phase 7 SOT).
//   - WETH9 — sourced via `getWethAddress(chainId)` (Phase 6 + 8 SOT).
//   - 1inch V6 Router — cross-chain canonical at the same address on all 5
//     chains (Ethereum / Arbitrum / Polygon / Base / Optimism).
//   - LiFi Diamond — cross-chain canonical at the same address on all 5 chains.
//   - BRIDGED_VARIANTS token contracts — per-chain filter from the Plan
//     08-04 curated table.
//
// Cross-chain canonical address verification (execute-time, 2026-05-18):
//   - 1inch V6 Router `0x111111125421cA6dc452d289314280a0f8842A65` (EIP-55
//     canonical checksum) — verified against `KNOWN_SPENDERS_ETHEREUM` row 3
//     (Plan 06-03) + portal.1inch.dev. RESEARCH § A3 documents the
//     cross-chain reuse pattern (single deployer governance + CREATE2
//     deterministic addressing).
//   - LiFi Diamond `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` — verified
//     against `KNOWN_SPENDERS_ETHEREUM` row 2 (Plan 06-03) + docs.li.fi
//     deployments page. Same address across the 5 supported chains.
//
// Format-fanout-sentinel: every inline address is `getAddress()`-wrapped at
// the literal site so a corrupted snapshot — single hex digit flipped at
// rest — throws EIP-55 at module load. Aave + WETH entries inherit the
// existing `src/config/contracts.ts` integrity guard.
//
// ESM spy-affordance per CLAUDE.md § Conventions: `_canonicalDispatch` is the
// mutable indirection object production callers route through so tests can
// `vi.spyOn(_canonicalDispatch, "checkDispatchTarget")` to short-circuit the
// allowlist gate without monkey-patching the named export (ESM bindings are
// immutable; direct spies on named exports are no-ops for internal calls).

import { getAddress, type Address } from "viem";

import {
  getAaveV3PoolAddress,
  getAllCompoundCometsForChain,
  getAllEigenLayerStrategiesForChain,
  getEigenLayerStrategyManagerAddress,
  getLidoStethAddress,
  getLidoWithdrawalQueueAddress,
  getLidoWstethAddress,
  getMorphoBlueAddress,
  getRocketPoolDepositPoolAddress,
  getRocketPoolRethAddress,
  getWethAddress,
  type ChainId,
} from "../config/contracts.js";
import { BRIDGED_VARIANTS } from "../tokens/bridged-variants.js";

/**
 * 1inch Aggregation Router V6 — same canonical address on Ethereum /
 * Arbitrum / Polygon / Base / Optimism per RESEARCH § A3 + portal.1inch.dev
 * deployments. Cross-checked against `KNOWN_SPENDERS_ETHEREUM` row 3 in
 * `src/config/contracts.ts` (Plan 06-03) — same byte-identical address.
 */
const ONEINCH_V6_ROUTER_ALL_CHAINS: Address = getAddress(
  "0x111111125421cA6dc452d289314280a0f8842A65",
);

/**
 * LiFi Diamond — same canonical address on Ethereum / Arbitrum / Polygon /
 * Base / Optimism per RESEARCH § A3 + docs.li.fi. Cross-checked against
 * `KNOWN_SPENDERS_ETHEREUM` row 2 in `src/config/contracts.ts` (Plan 06-03)
 * — same byte-identical address.
 */
const LIFI_DIAMOND_ALL_CHAINS: Address = getAddress(
  "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
);

/**
 * Build the per-chain `ReadonlySet<Address>` allowlist. Composes:
 *
 *   1. Aave V3 Pool via `getAaveV3PoolAddress(chainId)` SOT getter.
 *   2. WETH9 via `getWethAddress(chainId)` SOT getter.
 *   3. 1inch V6 Router cross-chain canonical.
 *   4. LiFi Diamond cross-chain canonical.
 *   5. Per-chain BRIDGED_VARIANTS token contracts (Plan 08-04 SOT).
 *
 * The Set absorbs duplicates — e.g. WETH9 on Base/Optimism shares the
 * `0x4200…0006` OP-Stack predeploy address with the BRIDGED_VARIANTS row
 * for WETH on that chain. The dedup is benign: one canonical address, one
 * Set entry, one membership check.
 *
 * Evaluated ONCE at module load (`CANONICAL_DISPATCH_TARGETS` is a module-
 * scope const). Subsequent `checkDispatchTarget` calls are constant-time
 * Set lookups.
 */
function buildPerChainAllowlist(chainId: ChainId): ReadonlySet<Address> {
  const tokenContracts = BRIDGED_VARIANTS
    .filter((v) => v.chainId === chainId)
    .map((v) => v.address);
  // Phase 28 — Plan 28-04. Compound V3 Comets via the SOT getter (`get
  // AllCompoundCometsForChain` — Plan 28-01). NO inline literals here. Phase
  // 28 ships ONLY the Ethereum arm (chainId === 1 → 6 Comets); other chains
  // return `[]` per the SOT contract. v2.3.x adds Polygon / Arbitrum / Base /
  // Optimism Comets, at which point the SOT getter widens and this builder
  // picks them up automatically — zero code change here.
  const compoundComets = getAllCompoundCometsForChain(chainId);
  // Phase 29 — Plan 29-03. Morpho Blue is a SINGLE singleton contract per
  // chain (one set entry, not a 6-entry expansion like Compound). Sourced via
  // `getMorphoBlueAddress(chainId)` SOT getter (Plan 29-01) — NO inline
  // literals. Phase 29 ships ONLY the Ethereum arm (chainId === 1); other
  // chains return null per the SOT contract and the null is filtered out.
  // v2.3.x adds Base / Polygon Morpho deployments at the SOT layer, and this
  // builder picks them up automatically.
  const morphoBlue = getMorphoBlueAddress(chainId);
  const morphoEntries: Address[] = morphoBlue ? [morphoBlue] : [];
  // Phase 30 — Plan 30-01. Lido write-side allowlist (Ethereum arm only).
  // Three contracts: stETH proxy (prepare_lido_stake + approval target label),
  // wstETH (prepare_lido_wrap + prepare_lido_unwrap),
  // WithdrawalQueueERC721 (prepare_lido_unstake).
  // Arbitrum wstETH has a non-zero slot but zero steth/withdrawalQueue —
  // the address(0) sentinels are filtered by the non-zero check below so
  // Arbitrum gets NO Lido write targets in the allowlist (writes refuse pre-
  // dispatch via D-03 CHAIN_ID_MISMATCH). v2.3.x Arbitrum reads are READ-ONLY.
  const lidoSteth = getLidoStethAddress(chainId);
  const lidoWsteth = getLidoWstethAddress(chainId);
  const lidoWq = getLidoWithdrawalQueueAddress(chainId);
  const lidoEntries: Address[] = [lidoSteth, lidoWsteth, lidoWq].filter(
    (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000",
  );
  // Phase 31 — Plan 31-01. EigenLayer write-side allowlist (Ethereum arm only).
  // StrategyManager + 7 curated per-strategy proxies (D-04). Each strategy is a
  // DISTINCT dispatch target because the user-supplied `strategy` arg to
  // `StrategyManager.depositIntoStrategy(strategy, token, amount)` is itself an
  // address — a future bug routing a deposit to a non-allowlisted strategy
  // triggers DISPATCH_TARGET_REFUSED (T-DISPATCH-COLLISION-31). Non-Ethereum
  // chains return null / [] per D-03 → filter removes them → zero non-Ethereum
  // EigenLayer entries by construction.
  const eigenStrategyManager = getEigenLayerStrategyManagerAddress(chainId);
  const eigenStrategies = getAllEigenLayerStrategiesForChain(chainId).map((s) => s.strategy);
  const eigenEntries: Address[] = [eigenStrategyManager, ...eigenStrategies].filter(
    (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000",
  );
  // Phase 31 — Plan 31-01. Rocket Pool write-side allowlist (Ethereum arm only).
  // RocketDepositPool is the value-bearing stake target; rETH is the burn target
  // for unstake. RocketDAOProtocolSettingsDeposit is read-only (no dispatch
  // entry). Non-Ethereum chains return null per D-03 → filter removes them.
  // Selector collision note: RocketDepositPool.deposit() shares selector
  // 0xd0e30db0 with WETH9.deposit() — the allowlist is selector-blind by design;
  // (to, selector) tuple dispatch lives at the preview_send DECODED ARGS layer
  // (Plans 31-02 + 31-03).
  const rocketDepositPool = getRocketPoolDepositPoolAddress(chainId);
  const rocketReth = getRocketPoolRethAddress(chainId);
  const rocketEntries: Address[] = [rocketDepositPool, rocketReth].filter(
    (a): a is Address => !!a && a !== "0x0000000000000000000000000000000000000000",
  );
  return new Set<Address>([
    getAaveV3PoolAddress(chainId),
    getWethAddress(chainId),
    ONEINCH_V6_ROUTER_ALL_CHAINS,
    LIFI_DIAMOND_ALL_CHAINS,
    ...tokenContracts,
    ...compoundComets,
    ...morphoEntries,
    ...lidoEntries,
    ...eigenEntries,
    ...rocketEntries,
  ]);
}

/**
 * Per-chain canonical dispatch-target allowlist. Format-fanout-sentinel: the
 * per-chain Sets ARE the SOT for the allowlist gate. A future plan adding a
 * new chain extends this Record alongside the `ChainId` union in
 * `src/config/contracts.ts`.
 *
 * Membership counts per chain (execute-time, 2026-05-23 — Phase 30 Plan 30-01
 * Ethereum-arm extended by 3 Lido contracts; wstETH de-duped via BRIDGED_VARIANTS):
 *   - Ethereum (1):  29 entries (27 pre-Phase-30 + stETH proxy + WithdrawalQueue;
 *                    wstETH 0x7f39C581… already in BRIDGED_VARIANTS → Set de-dupe → net +2)
 *   - Arbitrum (42161): 22 entries (4 + 18 — 1 WETH overlap; Lido wstETH bridged + Compound + Morpho v2.3.x)
 *   - Polygon (137):    22 entries (4 + 19 — 1 WETH overlap; Compound + Morpho v2.3.x)
 *   - Base (8453):       8 entries (4 + 5 — 1 WETH overlap; Compound + Morpho v2.3.x)
 *   - Optimism (10):    17 entries (4 + 14 — 1 WETH overlap; Compound + Morpho v2.3.x)
 */
export const CANONICAL_DISPATCH_TARGETS: Readonly<
  Record<ChainId, ReadonlySet<Address>>
> = {
  1: buildPerChainAllowlist(1),
  42161: buildPerChainAllowlist(42161),
  137: buildPerChainAllowlist(137),
  8453: buildPerChainAllowlist(8453),
  10: buildPerChainAllowlist(10),
};

/**
 * Discriminated-union result of `checkDispatchTarget`.
 *
 *   - `ok`      — `to` is in the per-chain canonical allowlist.
 *   - `refused` — `to` is NOT in the per-chain canonical allowlist. The
 *                 response carries the per-chain `allowlist` (verbatim
 *                 entries) for the refusal text — the user sees what the
 *                 server expected so the agent can self-correct or the user
 *                 can decide whether to halt.
 */
export type DispatchCheckResult =
  | { kind: "ok" }
  | { kind: "refused"; chain: ChainId; to: Address; allowlist: Address[] };

/**
 * Layer 0.5 dispatch-target check. Applies `getAddress` for EIP-55
 * normalization BEFORE the Set membership check so a lowercase / mixed-case
 * input matches a checksummed allowlist entry (T-SPENDER-CASE-1 analog —
 * defense against silent case-mismatch refusals).
 *
 * Called from `src/tools/preview_send.ts` at the Layer 0.5 region (lines
 * 144-156 region, between handle lookup and Phase 8 Layer 2 chain-name
 * refusal at lines 173-191). Fires ONLY when `record.tx.data !== "0x"` —
 * native sends bypass per RESEARCH § Topic 6 lock.
 */
export function checkDispatchTarget(
  chainId: ChainId,
  to: Address,
): DispatchCheckResult {
  const checksummed = getAddress(to);
  const allowlist = CANONICAL_DISPATCH_TARGETS[chainId];
  if (allowlist.has(checksummed)) return { kind: "ok" };
  return {
    kind: "refused",
    chain: chainId,
    to: checksummed,
    allowlist: [...allowlist],
  };
}

/**
 * ESM spy-affordance — wrap the internal-call surface in a mutable object so
 * `vi.spyOn(_canonicalDispatch, "checkDispatchTarget")` can intercept. Per
 * CLAUDE.md § Conventions: ESM named-export bindings are immutable; a direct
 * `vi.spyOn` on the named export is a no-op for internal calls. Indirection
 * here keeps the test seam open without retroactive refactoring.
 *
 * Production callers (`src/tools/preview_send.ts` Layer 0.5 wiring) call
 * through this object so the spy applies to them.
 */
export const _canonicalDispatch = { checkDispatchTarget };
