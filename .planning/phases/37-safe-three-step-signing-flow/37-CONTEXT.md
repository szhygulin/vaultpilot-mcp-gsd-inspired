# Phase 37: Safe three-step signing flow — `prepare_safe_tx_propose` + `_approve` + `_execute` + `submit_safe_tx_signature` — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 37`)

<domain>
## Phase Boundary

User can propose a Safe transaction (off-chain — signs a SafeTx hash, submits to Tx Service for co-signer collection), approve a pending transaction (signs the SafeTx hash they didn't propose), execute a fully-signed transaction (on-chain), and submit individual signatures to the Tx Service.

Three-step flow surfaces explicitly in agent-facing tool descriptions:
- **propose**: typed-data sign + submit to Tx Service
- **approve**: typed-data sign + submit-signature to Tx Service
- **execute**: on-chain tx broadcast (only after enough signatures collected)

Each step is a distinct named tool the agent can route by intent.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 37`. Anchor candidates:

- **EIP-712 typed-data signing dependency**: Safe propose/approve requires the Ledger ETH app to clear-sign EIP-712 typed-data structures. As of Phase 37 planning, Ledger ETH app's clear-sign-typed-data coverage is partial — some Safe-typed-data may fall back to blind-sign mode. Researcher to verify per-chain Safe typed-data CAL coverage at execute time; documented residual otherwise.
- **SafeTx hash computation**: `src/signing/safe-tx-hash.ts` implements EIP-712 typed-data digest per Safe v1.3.0+ shape. Regression-tested with fixture Safe transactions (known SafeTx hashes from Safe docs).
- **Three-step flow naming**: tool descriptions explicitly name the lifecycle stage (`propose` / `approve` / `execute` / `submit_safe_tx_signature`). Agent routes by intent; cannot accidentally skip steps because each tool is gated on the prior step's artifacts (e.g. `_approve` requires a `safeTxHash` from a prior `_propose`).
- **Signature assembly at execute**: `prepare_safe_tx_execute` fetches all collected signatures from Tx Service, sorts them by signer address (Safe's `execTransaction` requires sorted), and assembles the signature blob. Refuses if signatures-collected < threshold.
- **Composite-tx preview shape**: `prepare_safe_tx_execute` previews the underlying operation (the encapsulated to/value/data/operation) decoded — the Safe execution wraps the real call. Pattern matches Phase 33's `prepare_uniswap_v3_rebalance` composite-tx preview.

### Claude's Discretion

- Internal helper names (`SafeTxHashCalculator`, `assembleSafeSignatures`, etc.)
- Whether `prepare_safe_tx_propose` returns the EIP-712 typed-data structure inline or stores it in the Tx Service immediately
- Fixture Safe transactions for regression testing

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — composite-tx preview pattern from Phase 33
- `.planning/REQUIREMENTS.md` §SAFE-05..08 — exact Phase 37 surface
- `.planning/ROADMAP.md` Phase 37
- `src/clients/safe-tx-service.ts` (Plan 36-01) — Tx Service client foundation
- Safe Smart Account Spec — https://docs.safe.global/safe-core-protocol/safe-account

</canonical_refs>

<specifics>
## Specific Ideas

- The three-step flow's existence is itself a defense — proposers + approvers + executors can be different agents/users, each verifying the SafeTx independently. The MCP surfaces decoded args in CHECKS PERFORMED at each step.
- EIP-712 typed-data signing flow on Ledger: the device displays the typed-data structure field-by-field if CAL coverage is available; otherwise displays the digest only. Phase 37's `LEDGER BLIND-SIGN HASH` block surfaces the typed-data digest the device will display.
- `submit_safe_tx_signature` is the only Phase 37 tool that doesn't go through prepare → preview → send (no on-chain tx). It's a Tx Service API call — separate flow.

</specifics>

<deferred>
## Deferred Ideas

- `enableModule` + `delegateCall` hard-trigger second-LLM check — Phase 38
- Safe module-management tools (`prepare_safe_enable_module` / `_disable_module`) — Phase 38
- Safe owner-management (add owner / remove owner / change threshold) — defer to v2.5.x
- Safe Account Abstraction (4337) integration — defer to v3.x

</deferred>

---

*Phase: 37-safe-three-step-signing-flow*
*Context placeholder: 2026-05-20*
