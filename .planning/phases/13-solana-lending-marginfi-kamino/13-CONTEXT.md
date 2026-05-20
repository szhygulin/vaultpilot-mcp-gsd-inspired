# Phase 13: Solana lending — MarginFi + Kamino — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 13`)

<domain>
## Phase Boundary

User can read MarginFi + Kamino lending positions and supply/withdraw/borrow/repay assets on both protocols. Per-wallet lending-account PDA setup tools (MarginFi `MarginfiAccount`, Kamino `Obligation`) ship here. Canonical dispatch allowlist extends to Solana programs (mirrors v1.3 SEC-35 EVM dispatch-target enforcement). MarginFi + Kamino program addresses sourced from a new `src/config/contracts.ts` Solana sub-table.

No swaps yet — Phase 14 lands Jupiter. No staking yet — Phase 15 lands Marinade / Jito / native SOL.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 13`. Anchor candidates:

- **MarginFi SDK adoption (DF)**: `@mrgnlabs/marginfi-client-v2` exposes typed account decoders + instruction builders. Researcher to scope-probe at execute time per the `rnd` skill discipline — check whether the SDK exposes UNSIGNED instruction output (Ledger-compatible) or only internally-signing helpers.
- **Kamino SDK adoption (DF)**: Kamino Lend SDK (npm package name TBD by researcher) — same scope-probe discipline.
- **Contracts SOT extension**: `src/config/contracts.ts` adds a Solana sub-table — `Record<"solana", SolanaContracts>` mirroring the v1.2 EVM `Record<ChainId, ContractsForChain>` shape. New typed slots: `marginfiProgram`, `kaminoLendProgram`, plus per-protocol PDA derivation helpers.
- **Canonical dispatch allowlist**: `src/security/canonical-dispatch.ts` adds a Solana arm — `CANONICAL_DISPATCH_TARGETS_SOLANA` with MarginFi + Kamino program IDs. Layer 0.5 refusal at preview time matches the EVM pattern.
- **PDA setup as distinct tools**: `prepare_marginfi_account_init` + `prepare_kamino_obligation_init` are distinct intent-routed tools (pattern from v1.1 `prepare_revoke_approval`). Each is the prerequisite for the corresponding supply/withdraw/borrow/repay flow.
- **Mechanical clone pattern**: each `prepare_*` is a mechanical clone of Phase 12's `prepare_solana_spl_send` with bounded diffs (schema, encoder, program ID, PDA accounts). Pattern-mapper at planning gate should name the canonical clone source per Phase 7's discipline.
- **Conditional LEDGER NOTICE**: emitted when CAL coverage absent for the specific instruction (mirrors Phase 6 WETH9.withdraw pattern). Researcher to check Ledger SOL app + ERC-7730-equivalent registry for MarginFi / Kamino coverage at planning gate.

### Claude's Discretion

- Health-factor math equivalent (MarginFi and Kamino have different risk-engine surfaces; researcher to lock per-protocol math at planning gate)
- Internal helper names

</decisions>

<canonical_refs>
## Canonical References

### Project context
- `.planning/REQUIREMENTS.md` §SOL-W-03..10 — exact Phase 13 requirement surface
- `.planning/ROADMAP.md` Phase 13 — Success Criteria + Plans list
- `.planning/phases/12-…/12-CONTEXT.md` — upstream Solana trust pipeline already wired

### Pattern references
- `src/config/contracts.ts` — EVM contracts SOT (Phase 13 adds Solana sub-table; structure mirrors)
- `src/security/canonical-dispatch.ts` — EVM dispatch allowlist (Phase 13 adds Solana arm)
- `src/protocols/aave-v3.ts` (Phase 7) — protocol-decode shape (Solana variant follows same shape)
- `src/chains/aave-v3.ts` (Phase 7) — read-tool shelf shape (Solana lending readers follow same shape)
- `src/signing/aave-health.ts` (Phase 7) — pure-bigint health math (Solana variants follow same shape per protocol)

### External
- MarginFi docs — https://docs.marginfi.com/
- `@mrgnlabs/marginfi-client-v2` — https://github.com/mrgnlabs/marginfi-client-v2
- Kamino docs — https://docs.kamino.finance/
- Kamino lending program — https://github.com/Kamino-Finance/klend
- Ledger SOL app CAL / ERC-7730-equivalent registry — researcher to surface at planning gate

</canonical_refs>

<specifics>
## Specific Ideas

- The PDA-init tools are distinct from the supply/withdraw tools because the user-facing intent differs ("set me up to use MarginFi" vs "supply 100 USDC"). Pattern from v1.1 `prepare_revoke_approval` as a distinct intent-routed tool.
- Each protocol's program ID lives in the Solana SOT — never inlined in tool code (CLAUDE.md convention).
- Health-factor math for MarginFi and Kamino differs from Aave's — Solana lending protocols use their own risk engines. Per-protocol math modules under `src/signing/marginfi-health.ts` and `src/signing/kamino-health.ts` mirror `src/signing/aave-health.ts`.

</specifics>

<deferred>
## Deferred Ideas

- Other Solana lending protocols (Solend, MarginFi Klend, etc.) — defer to v2.x backlog as usage data justifies
- Cross-protocol position aggregation — defer to v3.x ergonomics
- E-mode / per-asset borrowing caps surfacing — defer to verify-phase feedback per the Aave Phase 7 precedent

</deferred>

---

*Phase: 13-solana-lending-marginfi-kamino*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 13` time)*
