# Phase 36: Safe positions + Tx Service API integration + `get_safe_positions` — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 36`)

<domain>
## Phase Boundary

User can list their Safe addresses (where they're an owner), read per-Safe owner-set + threshold + pending transactions + module list. Safe Tx Service API integration is the read-side foundation for the three-step signing flow in Phase 37. Multi-chain (Ethereum + Arbitrum + Polygon + Base + Optimism).

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 36`. Anchor candidates:

- **Safe Tx Service per-chain endpoints**: each chain has its own Safe Tx Service endpoint (e.g. `https://safe-transaction-mainnet.safe.global` / `https://safe-transaction-arbitrum.safe.global`); Phase 36's `src/clients/safe-tx-service.ts` mirrors `etherscan.ts` 5-arm shape per-chain.
- **Safe Singleton address per-chain**: most chains share the same Singleton address (the deterministic deployment); some chains have alternate addresses. Phase 36 sources from `src/config/contracts.ts` per-chain Safe sub-table.
- **Safe-finding strategy**: query Safe Tx Service `/v1/owners/{address}/safes/` to enumerate Safes; cross-reference against on-chain state for verification. Defends against Tx Service returning stale or fabricated Safes.
- **Canonical dispatch allowlist Safe arm**: Singleton is the dispatch target for all Safe operations (`execTransaction` lives on Singleton). Phase 36 wires the allowlist arm; Phase 37 + 38 reuse it.

### Claude's Discretion

- Internal helper names (`SafeTxServiceClient`, `SafeReader`, etc.)
- Whether `get_safe_positions` aggregates across all configured chains by default or requires explicit `chain` param

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — `src/clients/etherscan.ts` shape conventions; `src/config/contracts.ts` SOT
- `.planning/REQUIREMENTS.md` §SAFE-01..04 — exact Phase 36 surface
- `.planning/ROADMAP.md` Phase 36
- `src/clients/etherscan.ts` (Plan 07-04) — never-throws + 5-arm union pattern
- Safe Tx Service API docs — https://docs.safe.global/safe-core-protocol/safe-transaction-service

</canonical_refs>

<specifics>
## Specific Ideas

- Per-chain Tx Service endpoint discovery is hardcoded — the safe-global.com domain pattern is stable (`safe-transaction-{chain}.safe.global`).
- `get_safe_positions` cross-references Tx Service results with on-chain Singleton reads (owners, threshold, nonce) so the agent + user see the canonical state even if Tx Service is stale or compromised.
- Module list per-Safe is critical for downstream Phase 38 — enabled modules can spend without owner-approval, so the user MUST see them at read time.

</specifics>

<deferred>
## Deferred Ideas

- Safe three-step signing flow — Phase 37
- `enableModule` + `delegateCall` hard-trigger — Phase 38
- Safe Tx Service signature-submission — Phase 37 (this phase is read-only)
- Safe creation (deploying a new Safe via ProxyFactory) — out of scope for v2.5; users create Safes via the Safe UI

</deferred>

---

*Phase: 36-safe-positions-tx-service*
*Context placeholder: 2026-05-20*
