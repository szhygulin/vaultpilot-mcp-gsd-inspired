# Phase 19: TRC-20 approve + Stake 2.0 (freeze/unfreeze/withdraw-expire-unfreeze/vote/claim) — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 19`)

<domain>
## Phase Boundary

User can approve TRC-20 spenders (with the `⚠ UNLIMITED APPROVAL` surfacing pattern from Phase 6 ERC-20) and run the full TRON Stake 2.0 lifecycle — freeze TRX for resources (Energy or Bandwidth), unfreeze, withdraw-expire-unfreeze after the 14-day waiting period, vote for super representatives, and claim accumulated voting rewards. Distinct from legacy Stake 1.0 (`FreezeBalanceContract`) — Stake 2.0 uses `FreezeBalanceV2Contract`.

No DEX yet — Phase 20 lands SunSwap + LiFi bridging. No diagnostics — Phase 21.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 19`. Anchor candidates:

- **TRC-20 approve byte-identity invariant**: `prepare_tron_revoke_approval({T,S})` produces the same `payloadFingerprint`+`tx.raw_data` as `prepare_tron_token_approve({T,S, amount: "0"})`. Shared `prepareTronApproveInternal` helper enforces by construction (mirrors v1.1 Phase 6 `prepareApproveInternal` pattern + byte-identity invariant T-REVOKE-DRIFT-1).
- **Unlimited-approval surfacing**: `amount == 2^256 - 1` strict equality → `⚠ UNLIMITED APPROVAL` label at preview (mirrors v1.1 PREP-29 exact shape).
- **Stake 2.0 ONLY (no legacy Stake 1.0)**: `FreezeBalanceV2Contract` is the Stake 2.0 contract; `FreezeBalanceContract` (Stake 1.0) is deprecated by TRON network. Phase 19 ships ONLY Stake 2.0. Legacy support out of scope.
- **Resource enum**: `"ENERGY" | "BANDWIDTH"` — Phase 19 surfaces both. TRON splits resource markets per-type; users freeze for whichever resource they need.
- **14-day waiting period**: surfaced in CHECKS PERFORMED with explicit text "Unfreeze becomes withdrawable after 14 days"; no enforcement (the user can choose to wait).
- **Super-representative validation**: best-effort registry lookup (TRON `listwitnesses` API call at prepare-time) labels each SR candidate. Unknown SR → `(unverified SR — confirm address)` label.
- **Spender labels table extension**: `src/config/contracts.ts` TRON sub-table extension — SunSwap V2 router + LiFi TRON facet + canonical TRC-20 stablecoin contracts. Mirrors v1.1 PREP-30 known-spender pattern.

### Claude's Discretion

- Internal helper names (`prepareTronApproveInternal`, `prepareTronStakeInternal`, etc.)
- Fixture M (TRC-20 approve) + Fixture N (FreezeBalanceV2) literal anchor values — researcher computes at execute time via `node -e`
- Whether lifecycle integration test ships in this phase or splits to Phase 21 close-out

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `CLAUDE.md` — `prepareApproveInternal` shared-helper convention; strict-equality `MAX_UINT256` for unlimited-approval label
- `.planning/REQUIREMENTS.md` §TRON-PREP-05 + §TRON-W-03..08 — exact Phase 19 surface
- `.planning/ROADMAP.md` Phase 19 — Goal / Success Criteria / Plans

### Pattern references (v1.1 precedents to mirror)
- `src/tools/prepare_token_approve.ts` + `src/tools/prepare_revoke_approval.ts` (Plan 06-03) — shared helper + byte-identity invariant pattern Phase 19 clones for TRC-20
- `src/config/contracts.ts` KNOWN_SPENDERS_* (Plan 06-03) — known-spender table extension pattern; Phase 19 extends with TRON sub-table
- `src/signing/blocks.ts` `⚠ UNLIMITED APPROVAL` template (Plan 06-03) — strict-equality surfacing shape

### External
- TRON Stake 2.0 — https://tronprotocol.github.io/documentation-en/mechanism-algorithm/stake2.0/
- TRON Super Representative list — https://api.trongrid.io/wallet/listwitnesses
- TRC-20 standard — https://github.com/tronprotocol/tips/blob/master/tip-20.md

</canonical_refs>

<specifics>
## Specific Ideas

- Phase 6's `prepareApproveInternal` shared helper enforced byte-identity (revoke == approve(0) at the byte level). Phase 19 mirrors this for TRC-20 — shared `prepareTronApproveInternal` helper, distinct tool registrations for `prepare_tron_token_approve` and `prepare_tron_revoke_approval`, byte-identity asserted in test.
- The 14-day unfreeze waiting-period is informational only — Phase 19 doesn't block re-submission; users can submit a withdraw-expire-unfreeze tx that simulates-fails (via `triggerconstantcontract`) and the simulation envelope surfaces "not yet withdrawable" verbatim. Cheaper than building a server-side time-tracker.
- Lifecycle integration test (freeze → unfreeze → withdraw multi-tx flow) at the wave close-out anchors all three contracts at the byte level. Vitest's `vi.setSystemTime` mocks the 14-day waiting period for the test.
- TRON's "Energy" vs "Bandwidth" distinction matters for users: Energy is consumed by TRC-20 transfers and contract calls; Bandwidth is consumed by transaction broadcast (signature). Freezing for Energy reduces TRC-20 transfer costs; freezing for Bandwidth reduces native send costs.

</specifics>

<deferred>
## Deferred Ideas

- SunSwap V2 swap + LiFi TRON bridging — Phase 20
- TRON multi-chain portfolio extension + setup diagnostic — Phase 21
- Legacy Stake 1.0 support — out of scope (deprecated by TRON network)
- Stake 2.0 delegate-to-other-account flow (delegating Energy/Bandwidth to another address) — defer; surface as future work in REQUIREMENTS.md
- TRC-721 / TRC-1155 approve — out of scope (NFT support is v3.1)

</deferred>

---

*Phase: 19-tron-approve-stake2*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 19` time)*
