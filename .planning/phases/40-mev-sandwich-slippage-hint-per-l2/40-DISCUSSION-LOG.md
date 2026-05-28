# Phase 40: Sandwich-MEV slippage hint per-L2 thresholds - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-28
**Phase:** 40-mev-sandwich-slippage-hint-per-l2
**Mode:** autonomous + 2 AskUserQuestion forks (codebase grounding surfaced two genuine scope decisions MEV-01/CONTEXT did not resolve).

---

## Curve scope

| Option | Description | Selected |
|--------|-------------|----------|
| Parametrize Uniswap only | Per-chain SOT + errorcode wired into Uniswap's EXISTING gate; Curve stays gate-free (explicit-slippage model, Phase 34 deliberate omission) | ✓ |
| Also add a gate to Curve | Build a new price-impact sandwich gate for Curve too; reverses Phase 34's intentional asymmetry | |

**Choice:** Parametrize Uniswap only.
**Notes:** prepare_curve_swap deliberately has no sandwich gate (Phase 34: "No sandwich-MEV refusal — asymmetric treatment vs Phase 32 UniV3, documented in CHECKS PERFORMED"). MEV-01 names Curve, but it has no gate to parametrize and adding one needs a Curve price-impact reference. User chose the smallest correct scope respecting the prior decision. Curve's CHECKS-PERFORMED note gets a one-line update referencing the per-L2 SOT being Uniswap-scoped.

---

## Errorcode reach

| Option | Description | Selected |
|--------|-------------|----------|
| EVM tools (Uniswap) | Add SANDWICH_MEV_REFUSED; migrate only the EVM (Uniswap) refusal; leave TRON SunSwap on INVALID_INPUT | |
| EVM + TRON (project-wide) | Migrate both Uniswap (EVM) and SunSwap (TRON) sandwich refusals to SANDWICH_MEV_REFUSED for one consistent contract | ✓ |

**Choice:** EVM + TRON (project-wide).
**Notes:** No SANDWICH_MEV_REFUSED errorcode exists today — both Uniswap and SunSwap refuse via INVALID_INPUT + a refusal template + hintTool. User chose one consistent refusal contract across all chains. Behavior change: tests asserting INVALID_INPUT on the sandwich path migrate to SANDWICH_MEV_REFUSED. TRON's threshold/template stay TRON-specific; only its errorcode field changes (TRON is not in the EVM per-chain SOT).

## Claude's Discretion

- Final per-chain threshold VALUES (researcher's data-driven calibration).
- Chain coverage (default: all 5 configured EVM chains).
- Whether get_uniswap_quote's fixed 200bps warning threshold tracks the SOT (confirm in research).
- SECURITY.md per-L2 MEV wording + v2.6 close-out shape.

## Deferred Ideas

- Curve sandwich gate (explicitly not done).
- MEV-resistant tx submission (Flashbots/MEV Blocker) — v3+ backlog.
- Per-tool MEV tuning; dynamic threshold adjustment — out of scope.
