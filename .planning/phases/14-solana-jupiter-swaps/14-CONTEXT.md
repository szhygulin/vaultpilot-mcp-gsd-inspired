# Phase 14: Jupiter v6 swaps — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 14`)

<domain>
## Phase Boundary

User can query a Jupiter v6 quote and swap on Solana with slippage-bounded execution. `prepare_jupiter_swap` consumes the Jupiter quote API and serializes the returned transaction; `get_jupiter_quote` is the read-only companion. Default slippage hint = 50 bps; sandwich-MEV defense refuses without explicit `slippageBps` when price impact > 2% (mirrors v2.6 MEV-01 EVM equivalent).

Jupiter v6 program ID added to canonical-dispatch allowlist (Layer 0.5 Solana arm).

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 14`. Anchor candidates:

- **Jupiter API client shape**: `src/clients/jupiter.ts` mirrors `src/clients/fourbyte.ts` / `src/clients/etherscan.ts` shape — never-throws, LRU cache, `_resetJupiter_ForTesting` hook, fetch-stub at network boundary per CLAUDE.md convention.
- **Quote → transaction flow**: Jupiter v6 returns a serialized transaction the user signs unchanged. `prepare_jupiter_swap` wraps the quote → tx serialization + applies the standard Solana trust pipeline (Phase 12 primitives).
- **Sandwich-MEV gate**: refuses without explicit `slippageBps` when quoted price impact > 2%. Below 2% the default 50-bps slippage hint applies. Pattern matches v2.6 MEV-01.
- **Decoded swap args**: `CHECKS PERFORMED` block surfaces `From: X SYMBOL`, `To: Y SYMBOL`, `Price impact: Z%`, `Route: A → B → C` so the agent can relay the swap intent verbatim.
- **Allowlist extension**: Jupiter v6 program ID added to `CANONICAL_DISPATCH_TARGETS_SOLANA` from Phase 13. The Jupiter routing program (not the individual DEX programs) is the canonical dispatch target.
- **Fixture K**: Jupiter swap fingerprint hardcoded literal in `test/signing-fingerprint.test.ts` — new fixture for the Phase 14 shape.

### Claude's Discretion

- Jupiter quote endpoint version (researcher to confirm v6 is current)
- Slippage hint default (50 bps is a reasonable starting point; researcher to validate against Jupiter UI defaults)
- Whether `get_jupiter_quote` ships an `[AGENT TASK]` block instructing the agent to recheck the price impact before asking the user to confirm

</decisions>

<canonical_refs>
## Canonical References

### Project context
- `.planning/REQUIREMENTS.md` §SOL-W-11..13 — exact Phase 14 requirement surface
- `.planning/ROADMAP.md` Phase 14 — Success Criteria + Plans list

### Pattern references
- `src/clients/fourbyte.ts` — never-throws + LRU cache + fetch-stub-at-network-boundary shape
- `src/clients/etherscan.ts` — 5-arm discriminated union + per-session rate-limit (Jupiter likely needs fewer arms — 3 sufficient: ok / rate-limited / error)
- Phase 12 Solana trust pipeline primitives — `prepare_jupiter_swap` is a mechanical clone with bounded diffs

### External
- Jupiter v6 API — https://station.jup.ag/docs/apis/swap-api
- Jupiter program IDs — https://station.jup.ag/docs/apis/program

</canonical_refs>

<specifics>
## Specific Ideas

- The price-impact check is the most user-facing safety surface in this phase — surface the impact percentage in `CHECKS PERFORMED` even on the success path so the agent reads it to the user before signing.
- 50-bps default slippage matches what most Solana wallets use (Phantom, Solflare, Backpack). Researcher to confirm.

</specifics>

<deferred>
## Deferred Ideas

- Limit orders — defer to v3.x ergonomics
- Jupiter DCA / VA (dollar-cost-average / value-average) — defer
- Sandwich-MEV protection beyond slippage refusal (Jupiter ShieldHopper RFQ etc.) — defer; depends on Jupiter API surface
- Per-DEX swap routing override — defer; Jupiter's auto-routing is the load-bearing UX

</deferred>

---

*Phase: 14-solana-jupiter-swaps*
*Context placeholder: 2026-05-20 (full context-gathering at `/gsd-discuss-phase 14` time)*
