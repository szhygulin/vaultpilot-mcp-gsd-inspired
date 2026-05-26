# Phase 35 Discussion Log

**Date:** 2026-05-26
**Mode:** `--auto` (autonomous-execution mode per user memory; CONTEXT.md placeholder anchors already laid out the design — no genuine new design forks to surface)

## Source decisions

The 2026-05-20 CONTEXT.md placeholder already enumerated:
- `acknowledgeNonProtocolTarget: true` gate shape
- `[WARN — NON-PROTOCOL TARGET]` block placement
- Etherscan multi-chain widening
- `read_contract` view-only refusal
- Best-effort decode at preview

No areas required deep-dive — all anchor decisions confirmed; discretion items resolved by reasonable-call.

## Claude's discretion (resolved at discuss time)

1. **WARN block surfaces in `prepare_custom_call` response too** — YES (defense-in-depth; drift between prepare-receipt and preview-block is itself a tamper signal).
2. **Per-session ABI cache** — Derived view over existing `EtherscanResult.ok.abi`. No new storage layer. Researcher to confirm parsing cost.
3. **No 4byte selector fallback when ABI unavailable** — Absence of ABI is meaningful information for the user, not a degraded-mode signal. The blind-sign-only path is intentional.
4. **3-plan structure** — Mirrors ROADMAP: 35-01 (client widening + `get_contract_abi`), 35-02 (`read_contract`), 35-03 (`prepare_custom_call` + bypass + WARN block + Fixture P + v2.4 close-out).
5. **`check_contract_security` widens too** — Free downstream effect in 35-01; the v1.2 FROZEN constraint is what 35-01 lifts.

## Deferred to research

- Whether `prepare_custom_call` should refuse on non-verified targets (defense layer between bypass and blind sign) — researcher decides.
- ABI parsing memoization cost/benefit (parsed `viem.Abi` vs raw JSON in cache).
- Whether the bypass-flag grep-guard test belongs in 35-03 or as a shared invariant test.

## Scope creep redirected

None surfaced — the placeholder boundary is tight.
