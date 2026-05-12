# ADR-0001: v1.0 is a vertical slice, not breadth-first

**Status:** Accepted (2026-05-12)
**Context:** Initial project scaffolding

## Context

The upstream `vaultpilot-mcp` ships ~80 tools across 9 chains and 6+ DeFi protocols. Its first milestone (v1.0) shipped the full breadth at once. Building a from-scratch clone with the same milestone shape would defer end-to-end signing-pipeline validation until very late in the project — by which point the same trust-pipeline bugs would surface against a much larger blast radius (more tools touching the same broken primitives).

GSD's planning model is built around **per-milestone verify-phase steps** that exercise complete user flows. A breadth-first v1.0 would either skip those checks entirely (eroding the GSD discipline) or balloon into a multi-month "v1.0 ready" gate before any user can even pair a Ledger.

## Decision

v1.0 ships exactly one vertical slice end-to-end:

- One chain: Ethereum mainnet
- One signing flow: native ETH send via WalletConnect → Ledger Live → Ledger device
- Full security skeleton: `payloadFingerprint`, `LEDGER BLIND-SIGN HASH`, `PREPARE RECEIPT`, `previewToken` + `userDecision` gate, WC session-topic cross-check, `CHECKS PERFORMED` agent-task block
- Demo mode (auto-enters on fresh install) so users without hardware can exercise the read flow
- Diagnostics surface (`get_vaultpilot_config_status`, `get_ledger_device_info`)

Subsequent milestones add breadth on top of a proven pipeline:

- v1.1: Aave V3 + ERC-20 transfers (smallest DeFi surface, exercises contract-call decode path)
- v1.2: multi-EVM-chain (Arbitrum, Polygon, Base, Optimism)
- v1.3: hardening (companion skill, second-LLM, dispatch-target allowlist)
- v1.4: distribution (bundled binaries, install scripts, setup wizard)
- v2.0+: Solana / TRON / Bitcoin / Litecoin / additional protocols (each its own milestone)

## Consequences

**Positive:**

- v1.0's verify-phase walks a real end-to-end signing flow against mainnet. Trust-pipeline bugs surface at the cheapest possible milestone.
- Each subsequent milestone has a stable foundation to build on. Phase 8's "add chain parameter to every tool" is mechanical, not architectural, because the trust pipeline doesn't change.
- The companion skill (v1.3) and second-LLM verification (v1.3) get added to a working pipeline, not designed around an in-flight one.
- A user can install v1.0 today and use it for native sends. Validation of the product-market-fit hypothesis is decoupled from breadth delivery.

**Negative:**

- Calendar time to feature parity with upstream is longer.
- Users who arrive expecting Solana / TRON / Aave / Compound on day one will find a much smaller surface.
- More milestones means more `verify-phase` overhead; if the discipline slips on later milestones the cost compounds.

**Neutral:**

- Phase ordering means no DeFi protocols ship until v1.1. The native-send path is intentionally less compelling as a demo than "supply USDC to Aave"; demo mode (Phase 5) compensates.

## Alternatives considered

1. **Breadth-first matching upstream**: rejected because verify-phase becomes a multi-week marathon at the end of a multi-month build, not a per-milestone discipline.
2. **Read-only-first**: ship all chains' read tools first, then signing later. Rejected because the load-bearing complexity is the signing pipeline; deferring it leaves the hardest validation for last and shapes early-phase code around assumptions the signing flow may invalidate.
3. **Two parallel tracks (read breadth + signing depth)**: rejected because GSD's per-phase context-window discipline assumes a single linear ordering. Branching tracks defeat the planning model.

## Revisit triggers

- If v1.0 verify-phase finds zero pipeline bugs → the slice was too small; expand v1.1's scope.
- If v1.0 verify-phase finds many pipeline bugs → the slice was right-sized; keep v1.1 narrow too.
- If user demand for a specific non-EVM chain materially outweighs hardening priorities → consider reordering v2.x milestones (but never insert chains before v1.3 hardening; the trust pipeline must be production-ready first).
