# Phase 38: `enableModule` + `delegateCall: true` hard-trigger second-LLM check (Inv #12.5) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-27
**Phase:** 38-safe-enable-module-delegate-call-second-llm
**Mode:** auto (no AskUserQuestion turns — decisions derived from placeholder anchor candidates + ROADMAP success criteria + pre-staged Phase 36/37 hooks)
**Areas discussed:** Detection surface, hard-trigger block format, calldata parsing, fixture shape, SECURITY.md codification, sister-repo skill bump, cross-plan ordering, FROZEN-area discipline

---

## Detection surface

| Option | Description | Selected |
|--------|-------------|----------|
| Detect at `prepare_safe_tx_propose` only | Narrowest emission — user is the originator | |
| Detect at propose + approve | Both user-initiated and peer-proposed module enables | |
| Detect at propose + approve + execute (defense-in-depth re-emission) | Three emission sites; covers cross-MCP-session execute scenario | ✓ |

**Selected:** propose + approve + execute (D-01 sub-decisions a/b/c). Defense-in-depth replaces single-site emission. The execute re-emission catches the scenario where the agent skipped propose/approve and went straight to execute via Tx Service state, which is a realistic cross-signer pattern in v2.5.
**Notes:** Submit (`submit_safe_tx_signature`) is signature transport, not a user-confirmation gate — no emission there. Decision lives in CONTEXT.md `<decisions>` § "Detection — where the hard-trigger fires".

---

## Hard-trigger block format

| Option | Description | Selected |
|--------|-------------|----------|
| Structured refusal (`HIGH_BLAST_RADIUS_REFUSED` errorCode) | Server-side gate; agent cannot bypass | |
| Free-text WARN block (similar to Phase 6 LEDGER NOTICE) | Informational; agent decides whether to relay | |
| Hard-trigger block with explicit second-LLM instructions to the agent | NOT a refusal (operations are legitimate); load-bearing skill-side enforcement | ✓ |

**Selected:** hard-trigger block (NOT structured refusal). SAFE-09 explicitly says these operations are legitimate — server-side refusal would block valid Safe usage. The block instructs the agent to invoke `get_verification_artifact` + surface output; the sister `vaultpilot-preflight` skill encodes Inv #12.5 as a HALT condition that enforces the check.
**Notes:** Template wording sketched in CONTEXT.md; final wording can be tightened during execute (Claude's Discretion). Block titles `[HARD-TRIGGER — MODULE ENABLE]` / `[HARD-TRIGGER — DELEGATECALL]` are load-bearing — the skill-side Inv #12.5 keys on the exact titles.

---

## Calldata parsing — `enableModule` detection mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Selector-only match (`data.slice(0,10) === "0x610b5925"`) | Cheap; argument decode not needed for the block | |
| Selector + `viem.decodeFunctionData` extraction of `module: Address` | Provides {MODULE_ADDRESS} substitution in the block | ✓ |
| Generic ABI scan against full Safe Singleton ABI | Future-proof; over-engineered for one selector | |

**Selected:** selector + decodeFunctionData (D-04 in CONTEXT.md). The block templates substitute `{MODULE_ADDRESS}` so the user/agent sees the specific module being enabled — that's actionable information for the second-LLM check.
**Notes:** Lives in NEW `src/protocols/safe.ts` per established per-protocol convention. Decoder failure (truncated calldata) surfaces as `INVALID_INPUT` structured refusal (broken calldata, not broken operation).

---

## Fixture shape — selector match vs cryptographic fingerprint

| Option | Description | Selected |
|--------|-------------|----------|
| New cryptographic-binding Fixture (extends `signing-fingerprint.test.ts`) | Phase 37 pattern — but Phase 38 doesn't change binding | |
| Calldata-only Fixture SAFE-G in protocol test | Simpler — anchors selector + decoder; existing fingerprint fixtures unchanged | ✓ |

**Selected:** Fixture SAFE-G as calldata-only literal in `test/protocols-safe.test.ts`. Phase 38 doesn't change cryptographic binding — no new `payloadFingerprint` shape, no new domain tag. Existing Fixtures SAFE-A..D cover propose/approve/execute fingerprints.
**Notes:** `payload-fingerprint.ts` is FROZEN at Phase 38 (CONTEXT.md `<decisions>` § "FROZEN-area zero-diff discipline").

---

## SECURITY.md codification location

| Option | Description | Selected |
|--------|-------------|----------|
| New top-level Inv section | Disconnected from Safe section | |
| Append to existing §6 Safe section (mirrors Inv #6b style) | Co-located with related Safe invariants | ✓ |
| New ADR in `docs/adr/` | Standalone decision record | |

**Selected:** Append to SECURITY.md §6 as numbered invariant Inv #12.5. Mirrors Inv #6b (decoded-recipient assertion) style. Phase 38 closes v2.5 → §6 also gets the v2.5 milestone close-out summary referencing Phase 37 + Phase 38.
**Notes:** ADR may be added at plan-phase if researcher finds load-bearing decisions warranting standalone capture (Claude's Discretion).

---

## Sister-repo bump — v1.3.x patch vs v1.4 minor

| Option | Description | Selected |
|--------|-------------|----------|
| v1.3.x patch | Pinned-SHA delta only; minor wording change | |
| v1.4 minor | Behavioral change (new HALT condition) per semver | ✓ |
| v2.0 major | Reserved for compat-breaking changes | |

**Selected:** v1.4 minor bump. Inv #12.5 adds a new HALT condition to the skill — that is a behavioral change for users on v1.3.x and warrants a minor bump per semver. Pinned-SHA list in `src/security/skill-integrity.ts` becomes additive (accepts v1.3.x OR v1.4 — matches Plan 09-02 additive pattern).
**Notes:** Plan 38-02 cuts the v1.4 release tag as final v2.5 close-out step.

---

## Cross-plan ordering — single phase, two-plan strict sequential

| Option | Description | Selected |
|--------|-------------|----------|
| Parallel waves (38-01 ∥ 38-02) | Faster; risks SHA-pin drift if sister-repo content changes pre-tag | |
| Strict-sequential 38-01 → 38-02 | Safe; matches Phase 9 09-01 → 09-02 precedent | ✓ |
| Combined into single plan | Sister-repo work is a distinct deliverable surface | |

**Selected:** Strict-sequential. Plan 38-01 commits the pinned v1.4 SHA (computed from local sister-repo working tree, no remote tag required) + main-repo Inv #12.5 wiring. Plan 38-02 cuts the v1.4 release tag.
**Notes:** Order rationale documented in CONTEXT.md `<decisions>` § "Cross-plan ordering". Matches Phase 9 09-01 → 09-02 sister-repo coordination pattern.

---

## FROZEN-area zero-diff at Phase 38

| Option | Description | Selected |
|--------|-------------|----------|
| All cryptographic-binding files FROZEN | No new fingerprint shape — no need to touch binding | ✓ |
| Allow extension of `payload-fingerprint.ts` for completeness | Not needed; Phase 37 already covers Safe-typed-data binding | |

**Selected:** FROZEN. `payload-fingerprint.ts`, `handle-store.ts` state machine, `send_transaction.ts` three gates, all Phase 37 fingerprint fixtures (SAFE-A/B/C/D) untouched. Phase 38 emission sites are APPEND-ONLY block additions.
**Notes:** Asserted in success criteria for both plans during plan-phase.

---

## Claude's Discretion

- Internal helper names (`decodeEnableModuleCalldata`, `isEnableModuleCalldata`, `shouldEmitModuleEnableHardTrigger`, `shouldEmitDelegateCallHardTrigger`).
- Exact block-template wording — sketch in CONTEXT.md to be tightened during execute.
- Test file split (`test/protocols-safe.test.ts` vs merged into `test/hard-trigger-emission.test.ts`) — executor decides during plan-phase.
- Whether `submit_safe_tx_signature` also gets re-emission. Default NO — submit is signature transport, propose/approve covered user-confirmation, execute re-emission is the second gate.
- ADR file under `docs/adr/` for Inv #12.5 — defer to plan-phase researcher.

## Deferred Ideas

- `disableModule(address,address)` detection (selector `0xe009cfde`) — module contraction is rarely blast-radius; defer to v2.5.x if usage data justifies.
- `changeMasterCopy` proxy-upgrade detection — `delegatecall` discriminator already covers; explicit selector detection only adds value if Ledger CAL clear-sign coverage improves.
- Per-module risk-scoring (curated allowlist `KNOWN_SAFE_MODULES_*`) — v2.5.x.
- Safe Account Abstraction (4337) signatures — v3.x.
- Explicit `MultiSend` non-CallOnly selector detection — covered by `delegatecall` discriminator at Phase 38; finer-grained signal deferred unless skill-side Inv #12.5 needs it.
