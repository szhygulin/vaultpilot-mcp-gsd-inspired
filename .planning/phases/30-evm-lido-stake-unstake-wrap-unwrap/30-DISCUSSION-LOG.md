# Phase 30: Lido — stake / unstake / wrap / unwrap (stETH↔wstETH) — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-23
**Phase:** 30-evm-lido-stake-unstake-wrap-unwrap
**Mode:** `--auto` (per `autonomous-phase-execution` memory — user wants GSD phases driven end-to-end without stop-for-confirmation; ask only undefined design decisions)
**Areas discussed:** NFT receipt surfacing, rebase-reward accounting, protocol-module bundling, unstake amount shape, approval-prerequisite gating, contract SOT structure, fixture letter assignment, Ethereum-write-only enforcement, withdrawal-claim flow scope, NFT-receipt tokenId discovery

Auto-mode picks the **recommended option** for each area (first / explicitly marked). All selections grounded in established prior-phase patterns (Phases 06/07/28/29) — no novel decisions; no unresolved design forks.

---

## NFT receipt surfacing for `prepare_lido_unstake`

| Option | Description | Selected |
|--------|-------------|----------|
| Separate `[NFT RECEIPT EXPECTED]` block | Standalone block alongside LEDGER NOTICE / [AGENT TASK] / CHECKS PERFORMED; explicit prominence for novel post-tx artifact | ✓ |
| Inline in CHECKS PERFORMED | Fold into existing CHECKS block as documented expectation | |
| Skip surfacing; tool-description only | No block emit; rely on tool description | |

**Selection rationale:** Matches Phase 6 LEDGER NOTICE precedent — standalone blocks reserved for novel artifacts the user must understand BEFORE signing.

---

## `accruedRebaseRewards` accounting in `get_lido_positions`

| Option | Description | Selected |
|--------|-------------|----------|
| Shares-based via `getSharesByPooledEth` / `getPooledEthByShares` | Canonical Lido pattern; pure-bigint math in `src/signing/lido-rebase.ts` | ✓ |
| Transfer-event scan delta | Compute from first stETH-receipt block to current; event-log scan | |
| Skip accrual field entirely | Surface only current balance + conversion rate | |

**Selection rationale:** Lido's documented pattern; pure-bigint discipline matches Aave/Compound HF math; explicit `approx: true` flag signals load-bearing-ness.

---

## Protocol-module bundling

| Option | Description | Selected |
|--------|-------------|----------|
| Single `src/protocols/lido.ts` for all 4 contracts | One file: stETH submit + WithdrawalQueue + WstETH wrap/unwrap | ✓ |
| `src/protocols/lido-steth.ts` + `src/protocols/lido-wsteth.ts` | Split by contract family | |
| `src/protocols/lido.ts` + `src/protocols/wsteth.ts` (mirroring WETH9) | Half-and-half split | |

**Selection rationale:** Lido is ONE protocol with bound contracts. Matches Phase 28/29 single-file protocol-decoder bundling. Splitting creates churn without information gain.

---

## `prepare_lido_unstake` amount input shape

| Option | Description | Selected |
|--------|-------------|----------|
| Single `stethAmount` param (server encodes `[amount]`) | One withdrawal per call; matches LIDO-03 singular language | ✓ |
| `uint256[] amounts` array exposed at agent boundary | Allow multi-amount batch | |

**Selection rationale:** LIDO-03 requirement language is singular; "curation over padding" per CLAUDE.md; multi-amount batch deferred.

---

## Approval-prerequisite gating for `wrap` + `requestWithdrawals`

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-flight `stETH.allowance(owner, spender)` read + `INVALID_INPUT + hintTool → prepare_token_approve` | Phase 28 intent-vs-reality pattern; keeps 21-code errorCode union FROZEN | ✓ |
| Auto-bundle approve+wrap as multi-tx | Out of scope (no batched-tx surface in v2.x) | |
| Document in tool description only; agent handles | No server-side gate | |

**Selection rationale:** Phase 28 precedent; load-bearing approval-class surfacing aligns with v1.1 ERC-20-lifecycle invariant.

---

## Lido contract SOT structure in `src/config/contracts.ts`

| Option | Description | Selected |
|--------|-------------|----------|
| Per-chain `LidoContracts` interface + flat getters | Mirrors `getAaveV3PoolAddress` + `CompoundCometsByChain` shape | ✓ |
| Top-level flat `LIDO_CONTRACTS` table by chainId | Three flat getters without interface wrapping | |
| Inline per-chain in existing `ContractsForChain` | Add 3 typed slots directly | |

**Selection rationale:** Established SOT shape from Phase 7 + 28; T-LIDO-SPENDER-DRIFT-1 cross-view byte-identity assertion lands naturally with the interface shape.

---

## Fixture letter assignment

| Option | Description | Selected |
|--------|-------------|----------|
| Alphabetic V/W/X/Y following Phase 28 R/S/T/U | Continuation; standard discipline | ✓ |

**Selection rationale:** Single sensible answer. Researcher to cross-check Phase 29 (Morpho) fixture letters at planning time to avoid collision; if Morpho used V or higher, Lido shifts accordingly.

---

## Ethereum-write-only enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Hard refusal at prepare with `CHAIN_ID_MISMATCH` errorCode 15 (Phase 8 surface) | Reuse existing error code; reads remain multi-chain | ✓ |
| New `WRITE_NOT_SUPPORTED_ON_CHAIN` errorCode | Widen the 21-code union | |
| Silent fallback to Ethereum chainId | Avoid refusal; redirect implicitly | |

**Selection rationale:** Keeps the 21-code errorCode union FROZEN; CHAIN_ID_MISMATCH already covers chain-targeting mismatches.

---

## Withdrawal-claim flow (`prepare_lido_claim_withdrawal`)

| Option | Description | Selected |
|--------|-------------|----------|
| DEFERRED to v2.3.x verify-phase or follow-up | Mirrors v2.3.x multi-chain Compound deferral pattern | ✓ |
| Ship in Phase 30 | Adds 1 tool + 1 prepare flow scope | |

**Selection rationale:** LIDO-01..05 requirement language doesn't mandate claim flow; "curation over padding"; claim is async (1-5 days after request) so verify-phase is the natural check-in moment.

---

## NFT-receipt tokenId discovery

| Option | Description | Selected |
|--------|-------------|----------|
| Server reads `WithdrawalQueue.getLastRequestId(owner) + 1` at prepare time | Deterministic; eliminates post-tx round-trip | ✓ |
| Agent reads tokenId from receipt logs post-broadcast | Standard event-decode flow | |
| Skip tokenId surfacing entirely | Just say "NFT will be minted" | |

**Selection rationale:** Determinism at prepare time is a UX multiplier; surfaces in `[NFT RECEIPT EXPECTED]` block (D-04) without extra calls.

---

## Claude's Discretion (deferred to researcher/planner judgment)

- Internal helper names (`LidoReader`, `parseLidoConversion`, `formatRebaseRewards`)
- Whether `src/signing/lido-rebase.ts` ships standalone or folds into `src/protocols/lido.ts` (default: standalone, mirrors Aave/Compound HF separation)
- Whether `get_lido_positions` Arbitrum read uses bridged-contract storage or proxies through L1 (researcher to assess at planning time)
- Whether `Lido.submit` referral param is exposed as optional or hardcoded `address(0)` (default: hardcoded)

## Deferred Ideas (captured for future phases)

- `prepare_lido_claim_withdrawal` (NFT-claim flow) → v2.3.x verify-phase or follow-up
- Array-of-amounts in `prepare_lido_unstake` → future ergonomics
- Lido referral payouts → conditional v3.x ergonomics
- Cross-chain stETH bridging → v2.6 BRIDGE-T1
- stMATIC / other Lido LSTs → out of scope
- Lido validator-set + node-operator surfacing → out of scope
- Exact rebase-reward accounting (full transfer history) → v3.x `get_pnl_summary` extension
- v2.3 close-out SECURITY.md section → bundled with Phase 31 (final v2.3 phase)
