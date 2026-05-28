# Phase 39: Tier-1 bridge facet decoders + final-recipient assertion (Inv #6b) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-28
**Phase:** 39-bridge-tier-1-facet-decoders-final-recipient-assertion
**Mode:** autonomous (auto-style) — no open design forks; decisions anchored from the placeholder CONTEXT.md candidates and grounded against the live codebase. No AskUserQuestion required (per high-autonomy directive: only pause for genuinely-undefined design decisions; all anchors were pre-defined).

---

## Decoder module shape

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror `aave-v3.ts` only | Use the generic per-protocol decoder convention | |
| Mirror `bridge-decoders/lifi-btc.ts` | Inherit the in-directory precedent: NEVER-throws DU result, DISPLAY/ASSERT-only, `_`-helpers, selector guard | ✓ |

**Choice:** Mirror `lifi-btc.ts`.
**Notes:** `src/protocols/bridge-decoders/lifi-btc.ts` already exists (Phase 26) and is the only file in the directory — it is the strongest precedent. Its `{ kind: "ok" | "error" }` DU + display/assert-only discipline are reused verbatim.

---

## Inv #6b assertion placement

| Option | Description | Selected |
|--------|-------------|----------|
| Per-prepare-tool wiring | Add the assertion inside each `prepare_*_swap` tool (literal reading of BRIDGE-T1-06) | |
| Centralized at `preview_send` | Single selector-matched assertion in `preview_send`; covers every current + future swap tool | ✓ |

**Choice:** Centralized at `preview_send` (Layer 0.6).
**Notes:** Matches the CONTEXT.md anchor and the canonical-dispatch (Layer 0.5) precedent. Crucially, three tools BRIDGE-T1-06 names (`prepare_swap`, `prepare_solana_lifi_swap`, `prepare_tron_lifi_swap`) do NOT exist (LiFi Solana/TRON deferred). Centralized placement satisfies the requirement for all existing tools and auto-covers the deferred ones when they land — avoids wiring into non-existent tools.

---

## Layer ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Layer 0.6 (after 0.5, before fingerprint) | Sits after canonical-dispatch allowlist, before chain-mismatch/fingerprint | ✓ |

**Choice:** Layer 0.6 on the EVM path. (Layer 0.7 simulateTransaction is Solana-only.)
**Notes:** Plan-checker must assert this ordering invariant.

## Claude's Discretion

- Per-bridge internal helper names and `summary` field sets beyond mandatory `finalRecipient`.
- Test-fixture calldata sourcing (real mainnet bridge txs at research time).
- Test file location (`test/bridge-decoders/<bridge>.test.ts` vs co-located) — match existing layout.
- Selector→decoder dispatch shape in `preview_send` (inline map vs `bridge-decoders/index.ts` registry).

## Deferred Ideas

- Tier-2 facet decoders (deBridge/DLN, Stargate composeMsg, Hop, Symbiosis) — v2.6.x/v2.7.
- Per-L2 sandwich-MEV thresholds — Phase 40.
- Cross-chain reorg-detection / refund-flow tooling — v2.x backlog.
- Dynamic bridge-decoder discovery (Etherscan ABI fetch) — deferred; curated set has higher integrity.
- Inv #6b for `prepare_solana_lifi_swap` / `prepare_tron_lifi_swap` — inherit centralized assertion when those tools land.
