# Phase 38: `enableModule` + `delegateCall: true` hard-trigger second-LLM check (Inv #12.5) — Context

**Gathered:** 2026-05-20
**Status:** Placeholder — context-gathering pending (run `/gsd-discuss-phase 38`)

<domain>
## Phase Boundary

When a Safe transaction calls `enableModule(...)` or uses `operation: 1` (delegateCall), the prepare flow hard-triggers the second-LLM verification check (v1.3 SEC-34 `get_verification_artifact` is opt-in; here it becomes mandatory for these high-blast-radius operations). Inv #12.5 codifies this defense layer.

`enableModule` enables a module on the Safe — modules can spend without owner-approval, so enabling a malicious module is equivalent to draining the Safe.

`delegateCall` (operation: 1) executes arbitrary code in the Safe's storage context — equivalent to a contract upgrade. Both are legitimate but extremely high-blast-radius.

v2.5 milestone close-out.

</domain>

<decisions>
## Implementation Decisions

Pending — to be gathered during `/gsd-discuss-phase 38`. Anchor candidates:

- **Calldata pattern detection**: `enableModule(address)` has selector `0x610b5925`; `disableModule(address,address)` has selector `0xe009cfde`. Phase 38 detects these in calldata at preview time + emits the hard-trigger block.
- **`operation: 1` detection**: SafeTx `operation` field in the typed-data structure — Phase 38 detects this at SafeTx-construction time + emits the hard-trigger block.
- **Hard-trigger block format**: `[HARD-TRIGGER — MODULE ENABLE]` / `[HARD-TRIGGER — DELEGATECALL]`. NOT structured refusals (legitimate operations). Block contains explicit instruction to the agent: "Before requesting user confirmation, run `get_verification_artifact({ handle })`, surface the output to the user, and verify against a second LLM." The agent SHOULD follow this; the skill's Inv #12.5 enforces it on the skill side.
- **Inv #12.5 skill-side encoding**: sister `vaultpilot-preflight` repo gets a coordinated bump adding Inv #12.5. Skill version increment: v1.3.x or v1.4 (coordinator decides at execute time).
- **SECURITY.md update**: Phase 38 finalizes the Safe-specific section in SECURITY.md — Inv #12.5 codification + Safe module/delegatecall blast-radius rationale + accepted-residual notes (e.g. if Ledger typed-data CAL coverage gap was documented at Phase 37).

### Claude's Discretion

- Internal helper names (`detectEnableModuleSelector`, `detectDelegateCall`, etc.)
- Whether the hard-trigger block is emitted at `prepare_*` time OR `preview_send` time (defense-in-depth: both)
- Skill v1.3.x vs v1.4 bump — coordinated with sister-repo maintainer (likely the same user)

</decisions>

<canonical_refs>
## Canonical References

- `CLAUDE.md` — defense-in-depth conventions; canonical-dispatch + verification-tool layering
- `.planning/REQUIREMENTS.md` §SAFE-09 — exact Phase 38 surface
- `.planning/ROADMAP.md` Phase 38
- `src/security/skill-integrity.ts` (Plan 09-02) — sister-repo coordination pattern; Phase 38 mirrors for skill bump
- `src/tools/get_verification_artifact.ts` (Plan 09-03) — second-LLM verification tool; Phase 38 makes it mandatory for high-blast-radius operations
- Safe module documentation — https://docs.safe.global/safe-core-protocol/safe-modules

</canonical_refs>

<specifics>
## Specific Ideas

- `enableModule` blast-radius rationale: modules bypass owner-approval — a malicious module address can `execTransactionFromModule` to drain the Safe. The hard-trigger block names this in plain text so users + agents see the risk.
- `delegateCall` blast-radius rationale: `delegatecall` executes target code in the Safe's storage context — equivalent to swapping the Safe's logic. Often used legitimately for batched-tx multicall contracts; also a common upgrade-attack vector.
- Inv #12.5 is the first invariant that REQUIRES the second-LLM verification flow vs SUGGESTING it. The skill encodes it as a HALT condition: `IF (selector == enableModule OR operation == 1) AND second_LLM_verification_not_completed THEN HALT WITH "Run get_verification_artifact + second-LLM cross-check first"`.
- Sister-repo coordination: Phase 38 mirrors Phase 9's 09-01 → 09-02 pattern. The MCP-side hard-trigger block emission lands in main repo (Phase 38 Plan 38-01); the skill-side enforcement lands in `vaultpilot-preflight` (Phase 38 Plan 38-02 coordinated bump).

</specifics>

<deferred>
## Deferred Ideas

- Safe Account Abstraction (4337) signatures — v3.x
- Other high-blast-radius operations (`changeMasterCopy` proxy upgrade, etc.) — v2.5.x as discovered
- Per-module risk-scoring (curated allowlist of known-safe modules vs unknown) — defer; the hard-trigger is module-agnostic; future could add allowlist as Inv #12.5.b

</deferred>

---

*Phase: 38-safe-enable-module-delegate-call-second-llm*
*Context placeholder: 2026-05-20*
