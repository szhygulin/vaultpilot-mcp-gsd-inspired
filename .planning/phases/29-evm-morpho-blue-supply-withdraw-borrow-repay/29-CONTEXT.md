# Phase 29: Morpho Blue — supply / withdraw / borrow / repay — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 29`)

<domain>
## Phase Boundary

User can read Morpho Blue isolated-market positions and supply / withdraw / borrow / repay. Morpho Blue's permissionless market creation means market-id is a per-call parameter (not a Comet-style address). `prepare_morpho_repay({ amount: "max" })` accepted as full-position close.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 29`. Anchor candidates:

- **Market-id shape**: Morpho Blue market-id = `keccak256(abi.encode(loanToken, collateralToken, oracle, IRM, LLTV))`. 32-byte hash. Agent passes the market-id; server resolves the market params from the Morpho contract.
- **Known-market registry**: curated top 20-30 markets by TVL at planning time (researcher to enumerate at execute time). Stored in `src/config/contracts.ts` Morpho sub-table per-chain. Permissionless market creation means the long-tail isn't curated — agent can still call against any market-id but won't get a labeled surface.
- **`amount: "max"` close-position**: server-side resolves to outstanding-debt amount + small buffer (mirrors Compound V3 Phase 28 + standard convention).
- **Per-market decoder**: Morpho contract is universal across markets; per-market state read needs market-id. `get_morpho_positions` aggregates across known markets the wallet has touched (event-log scan via `publicClient.getLogs` — similar to v1.2 `get_token_allowances` pattern).

### Claude's Discretion

- Internal helper names (`MorphoBlueReader`, `parseMorphoMarketParams`, etc.)
- Fixture T + Fixture U literal anchor values
- Whether the known-market registry ships at 20, 25, or 30 entries (curation over padding per CLAUDE.md)

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — `src/config/contracts.ts` SOT + curation conventions
- `.planning/REQUIREMENTS.md` §MOR-01..05 — exact Phase 29 surface
- `.planning/ROADMAP.md` Phase 29
- `src/tools/get_token_allowances.ts` (Plan 08-04) — event-log scan pattern Phase 29 mirrors for market discovery
- `src/protocols/aave-v3.ts` (Phase 7) — protocol-decoder pattern; Phase 29 mirrors for Morpho with market-id-keyed shape
- Morpho Blue docs — https://docs.morpho.org/morpho-blue

</canonical_refs>

<specifics>
## Specific Ideas

- Morpho Blue's permissionless market creation is both a feature and a security concern: any market-id is callable, but only curated markets have known-good oracle/IRM parameters. The known-market registry's purpose is to label markets the agent surfaces to users; long-tail markets surface as `[UNKNOWN MARKET — verify oracle + IRM externally]` blocks.
- Mechanical-clone-of-Aave-shape for supply/withdraw; borrow/repay shapes are new (Aave V3 ships these but Phase 7 didn't include them).
- `get_morpho_positions` scope: event-log scan for `Supply` + `Borrow` events keyed to the user; cross-reference against the known-market registry to label each result; uncurated markets surface as `marketId: "0x..."` with the `[UNKNOWN MARKET]` flag.

</specifics>

<deferred>
## Deferred Ideas

- Morpho Optimizer (legacy Compound/Aave V2 on-top-of optimizer) — out of scope; v2.3 ships Morpho Blue only
- MetaMorpho (curated vault aggregator) — defer to v2.x follow-up if user demand justifies
- Morpho-specific liquidation flow tooling — out of scope; v2.3 is read + supply/withdraw/borrow/repay only

</deferred>

---

*Phase: 29-evm-morpho-blue-supply-withdraw-borrow-repay*
*Context placeholder: 2026-05-20*
