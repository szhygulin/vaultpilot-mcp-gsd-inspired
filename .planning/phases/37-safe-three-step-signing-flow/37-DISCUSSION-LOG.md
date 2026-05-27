# Phase 37 Discussion Log

**Mode:** `--auto` (autonomous selection — Phase boundary fully locked by ROADMAP §SAFE-05..08, no AskUserQuestion prompts)
**Date:** 2026-05-27
**Phase:** 37 — Safe three-step signing flow (`prepare_safe_tx_propose` + `_approve` + `_execute` + `submit_safe_tx_signature`)

## Auto-resolved gray areas

`--auto` mode selected the recommended option (first / safest / consistent-with-prior-phase / preserves FROZEN-area zero-diff invariant) for each gray area without invoking AskUserQuestion. Each selection logged here for audit.

### Area 1: Typed-data signing vs on-chain tx shape — handle discriminant

**Question:** Reuse `PreparedTxEvm` for `prepare_safe_tx_propose` / `_approve`, or introduce a new `PreparedTxSafeTypedData` variant in the handle-store union?

**Options considered:**
- New `PreparedTxSafeTypedData` discriminant in `src/signing/handle-store.ts` (recommended — typed-data signing has no broadcast / nonce / gas; reusing `PreparedTxEvm` invites mis-routing into `send_transaction`).
- Reuse `PreparedTxEvm`; `send_transaction` becomes a polymorphic dispatch with a typed-data branch.
- Standalone handle store for Safe (separate module).

**[auto] Selected:** New `PreparedTxSafeTypedData` discriminant. `send_transaction` STRUCTURED-REFUSAL when handle is `PreparedTxSafeTypedData`; `submit_safe_tx_signature` STRUCTURED-REFUSAL when handle is `PreparedTxEvm`. Mis-routing impossible by type.

**Rationale (audit):** Discriminated unions are the existing pattern (EVM / Solana / TRON / BTC / LTC / BTC-LIFI variants). Adding a sibling matches the established architecture. Reusing `PreparedTxEvm` would either pollute `send_transaction` with typed-data dispatch (FROZEN-area diff — violates the Test 18-equivalent zero-diff acceptance gate) or require runtime kind detection in every consumer.

---

### Area 2: `payloadFingerprint` domain tag for SafeTx typed-data

**Question:** Reuse `VaultPilot-txverify-v1:` for SafeTx typed-data, or introduce a new sibling tag?

**Options considered:**
- New `VaultPilot-safetx-v1:` tag (recommended — matches sibling-tag pattern for `soltx-v1` / `trontx-v1` / `btctx-v1`).
- Reuse `VaultPilot-txverify-v1:` (EVM general-purpose tag).
- Per-Safe-version tags (`safetx-v1.3.0`, `safetx-v1.4.1`).

**[auto] Selected:** New `VaultPilot-safetx-v1:` tag. Sibling to existing chain-family tags.

**Rationale (audit):** SafeTx typed-data digests are NOT EVM transactions — different binding shape (no `from` address, includes `safeAddress` + `safeVersion` + `nonce` + `operation` in preimage). Sibling tag isolates the binding domain so a SafeTx fingerprint cannot collide with an EVM-tx fingerprint, and `safetx-v1` namespace leaves room for Safe v1.4.1 / v1.5.x evolution without forking the tag (version sentinel goes in the preimage, not the tag).

---

### Area 3: `submit_safe_tx_signature` signer-recovery posture

**Question:** Post the raw signature to Tx Service verbatim, or ECDSA-recover the signer locally + verify against paired WC wallet + Safe owners before posting?

**Options considered:**
- ECDSA-recover + cross-check paired wallet + Safe owners (recommended — defense in depth).
- Post verbatim; let Tx Service / on-chain `checkSignatures` reject invalid signatures.
- ECDSA-recover only; skip owner cross-check.

**[auto] Selected:** ECDSA-recover + paired-WC cross-check + Safe-owner cross-check. Refuses BEFORE posting if recovery fails or recovered signer is not a Safe owner.

**Rationale (audit):** The agent could theoretically post a syntactically-valid-but-semantically-wrong signature (e.g. signed against a different SafeTx hash, or signed by a non-owner wallet). Tx Service stores invalid signatures silently — only on-chain `execTransaction` would reject. Surfacing the refusal at the MCP boundary is cheaper and gives the agent an immediate diagnostic instead of a confusing Tx Service state. Mirrors Phase 36's `txServiceDrift` defensive posture: never trust off-chain state — always cross-check.

---

### Area 4: `prepare_safe_tx_execute` — share `PreparedTxEvm` or separate variant

**Question:** Use the existing EVM tx pipeline (`PreparedTxEvm` + `preview_send` + `send_transaction`) for `execTransaction(...)`, or a Safe-specific exec variant?

**Options considered:**
- Reuse `PreparedTxEvm` + existing pipeline (recommended — execTransaction IS a normal EVM tx by construction; the encapsulated SafeTx is preview-decoded via Phase 33 composite-tx pattern).
- New `PreparedTxSafeExec` variant for symmetry with propose/approve.
- Sentinel-field flag on `PreparedTxEvm` to mark Safe-exec for special preview handling.

**[auto] Selected:** Reuse `PreparedTxEvm`. Composite-tx preview shape from Phase 33 (`prepare_uniswap_v3_rebalance`) surfaces the encapsulated operation cleanly.

**Rationale (audit):** `execTransaction(...)` calldata to the Safe Singleton is a textbook EVM tx — has nonce, gas, broadcast, on-chain receipt. Forking the pipeline for it would create FROZEN-area diff in `send_transaction.ts` + `preview_send.ts` (violates Phase 37's zero-diff invariant for Plans 37-01/37-02 and would even pollute Plan 37-03). The composite-tx preview pattern is exactly the right tool — `prepare_safe_tx_execute` builds the `execTransaction` outer call + surfaces the encapsulated `(to, value, data, operation)` inner call in the preview.

---

### Area 5: WalletConnect namespace — add `eth_signTypedData_v4`

**Question:** Extend the WC session namespace methods at pairing time, or attempt typed-data signing via a method not in the namespace?

**Options considered:**
- Extend `methods` in `src/wallet/session-manager.ts` proposal builder to include `eth_signTypedData_v4` (recommended — WC v2 requires methods declared at pairing).
- Use a generic `wallet_sendCustomRequest` shape.
- Fall back to `personal_sign` with the SafeTx hash as the message.

**[auto] Selected:** Extend `methods` array. Existing paired sessions surface `INVALID_INPUT + hint = "Re-pair Ledger Live: pair_ledger_live({ force: true })"` on first SafeTx typed-data call. New pairings post-Phase 37 register the method automatically.

**Rationale (audit):** `personal_sign` of the SafeTx hash would PRODUCE a different signature than the EIP-712 path (different sig prefix → EIP-712 produces raw ECDSA over the digest; `personal_sign` wraps the digest with `"\x19Ethereum Signed Message:\n32"` first). The Safe contract's `checkSignatures` distinguishes by signature mode byte — `personal_sign` signatures need `v += 4` per Safe convention. Using the proper `eth_signTypedData_v4` path matches the canonical Safe SDK behavior, lets Ledger CAL clear-sign field-by-field when coverage exists, and preserves the on-device hash display when CAL is absent.

---

### Area 6: Fixture set for cryptographic-binding regression

**Question:** Pin 1 fixture (v1.3.0 SafeTx + payloadFingerprint), or expand to cover both Safe versions + delegatecall discriminant?

**Options considered:**
- Pin SAFE-A only (v1.3.0 call, plus payloadFingerprint).
- Pin SAFE-A (v1.3.0 call) + SAFE-B (v1.4.1 call) + SAFE-C (v1.3.0 delegatecall) + SAFE-D (payloadFingerprint) — recommended.
- Defer fixture expansion to Phase 38 (which owns delegatecall hard-trigger).

**[auto] Selected:** Pin all four. SAFE-A / B / C anchor `computeSafeTxHash` per Safe version + operation discriminant; SAFE-D anchors the new `VaultPilot-safetx-v1:` preimage shape.

**Rationale (audit):** CLAUDE.md mandates a hardcoded `0x…` literal for every new shape of `payloadFingerprint` / `presignHash` input. The delegatecall fixture (SAFE-C) is load-bearing for Phase 38 — pinning it at Phase 37 anchors the byte-identity baseline so Phase 38's hard-trigger detection cannot accidentally drift the digest shape. SAFE-B covers v1.4.1 because Phase 36 captures `version` per Safe and Phase 37 routes by it — both versions must be regression-anchored.

---

### Area 7: Plan structure — 3 plans matching ROADMAP

**Question:** Sequential 3 plans (37-01 propose, 37-02 approve+submit, 37-03 execute+integration) or a different decomposition?

**Options considered:**
- 3 plans matching ROADMAP estimate (recommended).
- 2 plans (combine 37-02 + 37-03).
- 4 plans (split safe-tx-hash module + handle-store discriminant into a separate foundation plan).

**[auto] Selected:** 3 sequential plans matching ROADMAP exactly.

**Rationale (audit):** ROADMAP estimate is grounded in the same artifact-dependency analysis: typed-data foundation (37-01) → approve+submit reuses the foundation (37-02) → execute+integration test needs both prior plans (37-03). The 4-plan split would create a thin "foundation-only" plan with no user-facing tool (anti-pattern: plans should ship a vertical slice). The 2-plan combine would create a plan with too many distinct concerns (approve + submit + execute) that's hard to review and increases blast radius on revert.

---

## Deferred ideas captured

All deferred ideas from `<deferred>` in 37-CONTEXT.md — Phase 38's `enableModule` + delegatecall hard-trigger items are the most load-bearing carry-forward.

## Canonical refs accumulator

All refs in `<canonical_refs>` of 37-CONTEXT.md are sourced from ROADMAP.md, REQUIREMENTS.md, Phase 36's CONTEXT/PLANs, Phase 33's composite-tx preview pattern, Phase 35's `prepare_custom_call` extension pattern, the live Safe Smart Account spec, and viem's `hashTypedData` reference. No user-supplied refs (this was auto-mode).
