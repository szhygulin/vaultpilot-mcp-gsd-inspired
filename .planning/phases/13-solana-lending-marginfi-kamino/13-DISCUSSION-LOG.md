# Phase 13: Solana lending — MarginFi + Kamino - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 13-solana-lending-marginfi-kamino
**Areas discussed:** SDK fallback if signer-only, Account-init UX flow

---

## SDK fallback if signer-only

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-encode from IDL | Build instructions from the Anchor IDL via `@coral-xyz/anchor` `BorshInstructionCoder` (no signer) — same approach as SPL/system encoding in Phases 12/44. Full control, guaranteed unsigned, keeps both protocols in-phase. | ✓ |
| Defer the signer-only protocol | If MarginFi or Kamino is signer-only, defer it to a later phase and ship the other. Smaller phase but leaves SOL-W partially unmet. | |
| Use SDK decoder, hand-encode writes | Hybrid: SDK decoders for reads, hand-encode only writes from IDL. | (partially folded into D-02) |

**User's choice:** Hand-encode from IDL.
**Notes:** Locked as D-01. The hybrid idea (SDK decoders for read-only positions) was folded in as D-02 since decoding has no signing surface — the hand-encode rule applies specifically to the write/tx-building path. This was the single biggest execution risk; resolving it pre-research means the researcher doesn't have to come back and ask if an SDK turns out signer-only.

---

## Account-init UX flow

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-refuse, point to init tool | PDA absent → structured refusal (no handle minted), agent calls `prepare_*_account_init` first. Two separately-approved txs, each Ledger screen one clear intent. | ✓ |
| Auto-bundle init + supply | Prepend account-init to the supply tx (one approval). Multi-instruction Ledger screen, more blind-sign risk. | |
| Auto-bundle but surface both in receipt | One approval but PREPARE RECEIPT enumerates both instructions. Mitigates agent-side opacity, not device-display complexity. | |

**User's choice:** Hard-refuse, point to init tool.
**Notes:** Locked as D-03. Aligns with the project core value ("user trusts what the Ledger screen shows — nothing else") and the distinct-intent-tool pattern (v1.1 `prepare_revoke_approval`). No hidden bundled state changes; each device screen shows exactly one intent.

---

## Claude's Discretion

- **Health-math fidelity** (not selected for discussion → decided by precedent as D-07): full on-chain-accurate re-derivation per protocol, NOT an approximation — a liquidation-risk display is a trust surface. Pure-bigint modules mirror `aave-health.ts`; researcher locks the exact MarginFi (risk-weighted) and Kamino (per-reserve-LTV) formulas at planning gate.
- **Phase split sizing** (not selected → deferred to planner): recorded concern that roadmap plan 13-04 bundles 10 prepare tools; per-protocol split (5-6 plans) preferred for smaller execute units + earlier MarginFi-only verification. Planner decides on conflict-graph + execute-weight basis.
- Internal helper names + per-protocol module internal structure.

## Deferred Ideas

- Other Solana lending protocols (Solend, etc.) — v2.x backlog.
- Cross-protocol position aggregation — v3.x ergonomics (ERG-04 / ERG-06 already track this).
- E-mode / per-asset borrowing-cap surfacing — verify-phase feedback (Aave Phase 7 precedent).
- Multi-persona Solana demo expansion beyond Phase 13's needs.
