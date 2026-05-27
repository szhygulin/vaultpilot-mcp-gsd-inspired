# Phase 38: `enableModule` + `delegateCall: true` hard-trigger second-LLM check (Inv #12.5) — Context

**Gathered:** 2026-05-27
**Status:** Decisions locked (auto-mode) — ready for `/gsd-plan-phase 38`

<domain>
## Phase Boundary

Promote two pre-staged informational warnings (Phase 37 `delegatecall: YES` lines + Phase 36 `enabledModules[]` surfacing) into **hard-trigger blocks** that gate user confirmation on a second-LLM cross-check (`get_verification_artifact` from Plan 09-03). Two specific high-blast-radius operations are in scope:

1. **`enableModule(address)` calldata pattern** — selector `0x610b5925`. The SafeTx's INNER `data` field (not the outer `execTransaction` calldata) is inspected. A Safe enabling a module on itself produces a SafeTx with `to === safeAddress`, `value === 0`, `data` starting with `0x610b5925`. Enabling a malicious module is equivalent to draining the Safe — modules call `execTransactionFromModule` and bypass owner-approval entirely.

2. **`operation === "delegatecall"` discriminator** — the SafeTx-level operation field (semantic string per `PreparedTxSafeTypedData.operation` and `get_safe_transaction.operation`). `delegatecall` executes target code in the Safe's storage context, equivalent to a contract upgrade. Used legitimately by `multiSend` (non-CallOnly) for batched ops; also a common upgrade-attack vector.

The hard-trigger block is **NOT a structured refusal** — both operations are legitimate. It is a `[HARD-TRIGGER — MODULE ENABLE]` / `[HARD-TRIGGER — DELEGATECALL]` block emitted in the response that instructs the agent to run `get_verification_artifact({ handle })`, surface the result to the user, and obtain confirmation before requesting `userDecision`. Agent compliance is opt-in on the MCP side; the sister `vaultpilot-preflight` skill encodes **Inv #12.5** as a HALT condition that enforces the check on the skill side.

**v2.5 milestone close-out** — Phase 38 finalizes the Safe-specific section in SECURITY.md (Inv #12.5 codification + blast-radius rationale + Ledger typed-data CAL coverage gap accepted-residual notes from Phase 37).

**Out of scope at Phase 38 (deferred):**
- `disableModule(address,address)` detection (selector `0xe009cfde`) — contraction, not expansion; can be added in v2.5.x if usage data justifies.
- `changeMasterCopy` proxy-upgrade detection — `delegatecall` discriminator already covers the operation class.
- Per-module risk-scoring (curated allowlist of known-safe modules) — v2.5.x; the hard-trigger is module-agnostic by design.
- Safe Account Abstraction (4337) signatures — v3.x.

</domain>

<decisions>
## Implementation Decisions

### Detection — where the hard-trigger fires

- **`enableModule` selector match at prepare time** — both `prepare_safe_tx_propose` (D-01a) AND `prepare_safe_tx_approve` (D-01b) inspect the SafeTx `data` field. If `data[0:4] === "0x610b5925"`, emit `[HARD-TRIGGER — MODULE ENABLE]`. The propose-side check covers user-initiated module enables; the approve-side check covers co-signing on a malicious peer-proposed module enable.
- **`operation === "delegatecall"` discriminator match at prepare time** — both `prepare_safe_tx_propose` AND `prepare_safe_tx_approve` check `operation` (semantic string from `PreparedTxSafeTypedData.operation`). If `operation === "delegatecall"`, emit `[HARD-TRIGGER — DELEGATECALL]`.
- **Defense-in-depth re-emission at `preview_send` for `prepare_safe_tx_execute`** — when the EVM `preview_send` flow processes a `PreparedTxEvm` with `isSafeExecTransaction === true` (Phase 37's sentinel) and the inner-decoded `(to, value, data, operation)` matches either trigger condition, emit the corresponding hard-trigger block. This catches the scenario where the agent skipped propose/approve and went straight to execute via Tx Service state (cross-signer scenario). The check runs against the inner decoded fields surfaced by Phase 37's composite-tx preview block.
- **Composite scenario (both triggers fire)** — emit BOTH blocks in document order: MODULE ENABLE block first (selector-based; narrower), then DELEGATECALL block (operation-based; broader). Never combine into a single block — the skill's Inv #12.5 enforcement keys on the block titles independently.

### Hard-trigger block format — APPEND-ONLY templates in `src/signing/blocks.ts`

```
[HARD-TRIGGER — MODULE ENABLE]
This SafeTx calls enableModule({MODULE_ADDRESS}) on the Safe at {SAFE_ADDRESS}.

Enabling a module grants it the ability to execute transactions from the Safe
WITHOUT collecting owner signatures. A malicious module can drain the Safe.

Required defense-in-depth (Inv #12.5):
  1. Run get_verification_artifact({ handle: "{HANDLE}" }) and surface the
     output to the user verbatim.
  2. Ask the user to cross-check the module address against a second LLM
     (open a fresh chat with a different model; paste the verification
     artifact; ask "Is this module address legitimate? Any known abuse?").
  3. Only after the user confirms the second-LLM check passes, request
     userDecision: "send" via submit_safe_tx_signature.
```

```
[HARD-TRIGGER — DELEGATECALL]
This SafeTx uses operation=1 (delegatecall). The target contract's code will
execute IN THE SAFE'S STORAGE CONTEXT — equivalent to a contract upgrade.

Legitimate uses: MultiSend batched-tx contracts (multiSendCallOnly is the
safer variant; non-CallOnly multiSend uses operation=1).
Attack vector: a malicious target can rewrite the Safe's owner set, threshold,
or implementation.

Required defense-in-depth (Inv #12.5):
  1. Run get_verification_artifact({ handle: "{HANDLE}" }) and surface the
     output to the user verbatim.
  2. Ask the user to cross-check the target contract code against a second LLM.
  3. Only after the user confirms the second-LLM check passes, request
     userDecision: "send" via submit_safe_tx_signature.
```

- `{MODULE_ADDRESS}`, `{SAFE_ADDRESS}`, `{HANDLE}` substituted from the prepare-side state. For DELEGATECALL block, no module-address substitution.
- Both templates added APPEND-ONLY to `src/signing/blocks.ts` as exported constants `HARD_TRIGGER_MODULE_ENABLE_TEMPLATE` and `HARD_TRIGGER_DELEGATECALL_TEMPLATE`. Substitution happens at emission site.
- The blocks are surfaced in the MCP tool response's text payload (alongside `PREPARE RECEIPT` + `CHECKS PERFORMED` + `LEDGER DISPLAY` blocks), NOT as structured `errorCode` refusals.

### `enableModule` calldata parsing

- The `data` field is read as a `Hex` string. Match on `data.slice(0, 10).toLowerCase() === "0x610b5925"` (4-byte selector with `0x` prefix → 10 chars).
- Decode the single `address` argument (32-byte padded). Use `viem.decodeFunctionData` with the canonical Safe ABI `function enableModule(address module)` to extract `module: Address`. If decoding fails (truncated calldata), surface as `INVALID_INPUT + hint = "SafeTx data starts with enableModule selector but argument decode failed; bytes may be malformed."` Structured refusal because the calldata is broken, not because of the operation.
- The selector constant lives in `src/protocols/safe.ts` (new file mirrors `src/protocols/erc20.ts` / `src/protocols/aave-v3.ts` per-protocol convention) as `ENABLE_MODULE_SELECTOR = "0x610b5925" as const`. The decoder function `decodeEnableModuleCalldata(data: Hex): { module: Address }` lives in the same file.

### `operation` discriminator parsing

- Already a semantic string `"call" | "delegatecall"` on both the prepare-side handle (`PreparedTxSafeTypedData.operation`) AND the inner decoded SafeTx surfaced at execute-time (`safe-exec-decode.ts` returns numeric `0 | 1`; consumer must map to string at the trigger site).
- No new decoding needed at propose/approve. At execute, map numeric to string at the trigger emission site (consistent with `prepare_safe_tx_execute.ts:293`).

### Fixture SAFE-G — calldata anchor for `enableModule` detection

- **Fixture SAFE-G**: hardcoded `0x610b5925` + zero-padded address literal (e.g. `0x610b5925000000000000000000000000{40-hex-module-addr}`) in `test/protocols-safe.test.ts` (new test file). Anchors:
  - Selector-prefix match (exact `0x610b5925`)
  - Argument decode (extracted `module` address matches the embedded literal)
  - Negative case: random non-enableModule calldata (e.g. `0x12345678…`) does NOT match.
- No new `payloadFingerprint` fixture — the trigger fires on detection, not on a new cryptographic-binding shape. Existing Fixtures SAFE-A..D cover propose/approve/execute fingerprints from Phase 37.

### `prepare_safe_tx_execute` hard-trigger emission via `preview_send`

- Phase 37's `prepare_safe_tx_execute.ts` already decodes the inner `(to, value, data, operation)` via `safe-exec-decode.ts` and surfaces it in the composite-tx preview block. Phase 38 extends `preview_send.ts` to inspect the same inner-decoded fields when `isSafeExecTransaction === true` and emit the hard-trigger block(s) at preview time.
- The emission site in `preview_send.ts` is adjacent to the existing Phase 37 Safe-execute branch (search anchor: `isSafeExecTransaction`). APPEND-ONLY block emission — no existing block format changes.
- Defense rationale: a paired Ledger user could co-sign a propose+approve flow with hard-triggers emitted, then a downstream agent could try to execute via a different MCP session that lacks the propose-side state. Re-emitting at execute closes that gap.

### Inv #12.5 codification — SECURITY.md

- New numbered invariant `Inv #12.5` in SECURITY.md §6 (the Safe section finalized in v2.5). Format mirrors Inv #6b (decoded-recipient assertion at preview):
  - **Inv #12.5: High-blast-radius Safe operations require second-LLM cross-check before signing.**
  - Lists the two trigger conditions (enableModule selector, delegatecall operation).
  - References the hard-trigger block templates by name.
  - States the skill-side enforcement (Inv #12.5 in vaultpilot-preflight encodes a HALT condition: agent MUST run `get_verification_artifact` and surface output before `userDecision: "send"`).
  - Documents accepted residual: a non-skill-using agent can ignore the block. The MCP cannot enforce — the hard-trigger is an instruction to the agent, not a server-side gate. The skill-side enforcement is the load-bearing defense; the MCP-side block is the trigger signal.
- The v2.5 milestone close-out summary in SECURITY.md §6 references Phase 37 (three-step signing) + Phase 38 (Inv #12.5) as the v2.5 trust-pipeline completion.

### Sister-repo skill bump — Plan 38-02 (vaultpilot-preflight v1.4)

- Mirrors Phase 9's 09-01 → 09-02 sister-repo coordination pattern. Plan 38-02 ships ONLY to the sister `szhygulin/vaultpilot-preflight-skill` repo.
- **Version bump: v1.4 minor** (NOT v1.3.x patch). Rationale: Inv #12.5 adds a new HALT condition to the skill — that is a behavioral change for users on v1.3.x and warrants a minor bump per semver. v1.4 release tag is the coordinated bump point.
- Inv #12.5 in `SKILL.md`:
  - Step (after existing Step 0 self-check, before existing Step 1 dispatch validation): "Detect hard-trigger blocks in MCP responses. If `[HARD-TRIGGER — MODULE ENABLE]` or `[HARD-TRIGGER — DELEGATECALL]` appears in the response, HALT and require: (a) the agent has called `get_verification_artifact({ handle })` for the current handle, AND (b) the agent has surfaced the verification artifact to the user, AND (c) the user has confirmed the second-LLM cross-check passes. Until all three conditions are met, REFUSE to assist with `submit_safe_tx_signature({ userDecision: "send" })` or `send_transaction` against this handle."
- **MCP-side coordination:** Plan 38-01 extends the pinned SHA-256 list in `src/security/skill-integrity.ts` to include v1.4. Phase 9's pattern: the integrity probe accepts either v1.3.x or v1.4 SHA (additive list, not replacement). The pinned SHA is captured at sister-repo `git tag v1.4` time and committed in Plan 38-01 (NOT 38-02). Plan 38-02 cuts the release tag.
- Sister repo CI workflow (`.github/workflows/ci.yml`) still deferred (Plan 09-01 W-1 carries forward; gh OAuth lacks `workflow` scope — same constraint at Plan 38-02).

### Cross-plan ordering — 38-01 BEFORE 38-02 (strict-sequential)

- **Wave 1: Plan 38-01** — main repo. Adds `src/protocols/safe.ts` + selector detection + hard-trigger block templates + `prepare_safe_tx_propose` / `_approve` emission + `preview_send` re-emission + SECURITY.md Inv #12.5 + skill-integrity v1.4 SHA pin.
- **Wave 2: Plan 38-02** — sister repo. Cuts vaultpilot-preflight v1.4 release tag with Inv #12.5 SKILL.md update. After tag is live, the pinned SHA in Plan 38-01 becomes load-bearing.
- **Ordering rationale:** Plan 38-01 cannot ship without the pinned SHA, BUT the SHA can be computed from local sister-repo content (no remote tag required at plan-01 commit time — same as Plan 09-02). The remote tag is the user-facing release; SHA pin tracks the content. Plan 38-02 tags the release as the final v2.5 close-out step.

### FROZEN-area zero-diff discipline

- **FROZEN at Phase 38** (must not be touched):
  - `src/signing/payload-fingerprint.ts` (no new domain tag — Phase 38 doesn't change cryptographic binding).
  - `src/signing/handle-store.ts` state machine.
  - `src/tools/send_transaction.ts` three gates.
  - Phase 37 cryptographic-binding fixtures (SAFE-A / B / C / D in `test/signing-fingerprint.test.ts` + `test/signing-safe-tx-hash.test.ts`).
- Phase 38's emission sites in `prepare_safe_tx_propose.ts` / `_approve.ts` / `preview_send.ts` are APPEND-ONLY block additions — the existing PREPARE RECEIPT / CHECKS PERFORMED / LEDGER DISPLAY blocks are not modified.

### Claude's Discretion

- Internal helper names: `decodeEnableModuleCalldata`, `isEnableModuleCalldata`, `shouldEmitModuleEnableHardTrigger`, `shouldEmitDelegateCallHardTrigger`. Names follow Phase 37's `decodeSingleSafeExecTransaction` convention.
- Exact wording inside the hard-trigger block templates (the templates above are a sketch; final wording can be tightened during execute).
- Test file split: `test/protocols-safe.test.ts` (selector + decoder) + `test/hard-trigger-emission.test.ts` (block emission across propose/approve/execute) — or merged into one. Executor decides during plan-phase based on test count.
- Whether the `preview_send` re-emission also covers `submit_safe_tx_signature` (which already has access to the SafeTx from Tx Service). Default: NO — submit is a signature post, not a user-confirmation gate. The propose/approve emission already covered user confirmation; execute re-emission is the second gate. Submit between them is signature transport.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 38 scope anchors
- `.planning/ROADMAP.md` §Phase 38 — goal, depends on Phase 37, requirements SAFE-09, 5 success criteria, 2-plan structure.
- `.planning/REQUIREMENTS.md` §SAFE-09 — exact Phase 38 surface; references "Inv #12.5" naming.
- `.planning/phases/38-safe-enable-module-delegate-call-second-llm/38-CONTEXT.md` — this file.

### Phase 37 (load-bearing prerequisite — Phase 38 extends Phase 37 emission sites)
- `.planning/phases/37-safe-three-step-signing-flow/37-CONTEXT.md` — Phase 37 decisions; `isSafeExecTransaction` sentinel + composite-tx preview shape.
- `src/tools/prepare_safe_tx_propose.ts` — Phase 38 adds enableModule + delegatecall detection BEFORE existing PREPARE RECEIPT emission (search anchor: line 538 informational `delegatecall: YES`).
- `src/tools/prepare_safe_tx_approve.ts` — Phase 38 adds same detection (search anchor: line 411 informational `delegatecall: YES`).
- `src/tools/prepare_safe_tx_execute.ts` — informational delegatecall line at 540; Phase 38 re-emits at preview via `isSafeExecTransaction` branch.
- `src/tools/preview_send.ts` — Phase 38 adds preview-side re-emission for execute path; search anchor: `isSafeExecTransaction`.
- `src/signing/handle-store.ts` — `PreparedTxSafeTypedData.operation: "call" | "delegatecall"` (line 1025-1026); Phase 38 hard-trigger keys on this.
- `src/signing/safe-exec-decode.ts` — inner-decoded `(to, value, data, operation)` from execTransaction calldata; Phase 38 consumes at preview re-emission.
- `src/tools/get_safe_transaction.ts` — Phase 38 contract reference (operation semantic string lines 47, 91, 249-250).

### Phase 36 (load-bearing prerequisite — Safe contract addresses + version detection)
- `src/config/contracts.ts` lines 1055-1080 — Phase 36 Safe contract registry; references Phase 38 module hard-trigger (lines 1064, 1068, 1170).
- `src/chains/safe.ts` line 10 — comment "Phase 38 with `enableModule` write trigger".
- `src/tools/get_safe_positions.ts` — `enabledModules[]` sentinel-filtered surfacing (lines 109-111, 321-365); Phase 38 detects ADDITIONS to this list at proposal time.

### Phase 9 (load-bearing prerequisite — second-LLM tool + sister-repo coordination pattern)
- `src/tools/get_verification_artifact.ts` — second-LLM verification tool the hard-trigger blocks instruct the agent to invoke.
- `src/security/skill-integrity.ts` — sister-repo SHA pinning pattern; Phase 38 Plan 38-01 extends the pinned list to include v1.4.
- `src/signing/blocks.ts` — APPEND-ONLY block template surface; Phase 38 adds `HARD_TRIGGER_MODULE_ENABLE_TEMPLATE` + `HARD_TRIGGER_DELEGATECALL_TEMPLATE`.

### Cross-project documentation
- `SECURITY.md` §6 (Safe section) — Phase 38 finalizes Inv #12.5 codification + v2.5 milestone close-out summary.
- `CLAUDE.md` §Conventions — defense-in-depth conventions; APPEND-ONLY block templates; fixture pinning discipline.
- `docs/adr/` — load-bearing decisions index; Phase 38 may add an ADR for Inv #12.5 (defer to plan-phase to decide).
- Sister repo `szhygulin/vaultpilot-preflight-skill` `SKILL.md` — Plan 38-02 extends with Inv #12.5 HALT condition.

### External references
- Safe Smart Account v1.3.0 / v1.4.1 ABI — `enableModule(address)` selector `0x610b5925`; `disableModule(address,address)` selector `0xe009cfde` (deferred).
- Safe module documentation — https://docs.safe.global/safe-core-protocol/safe-modules.
- Safe `multiSend` vs `multiSendCallOnly` — https://github.com/safe-global/safe-smart-account/tree/main/contracts/libraries (operation=1 surface).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`get_verification_artifact` tool** (Plan 09-03): hard-trigger blocks instruct the agent to invoke this; no new tool needed.
- **`isSafeExecTransaction` sentinel** (Phase 37): identifies Safe-execute path in `preview_send`; Phase 38 keys hard-trigger re-emission on this flag.
- **`safe-exec-decode.ts`** (Phase 37): inner-decoded `(to, value, data, operation)` already available at preview time; Phase 38 consumes for selector + operation detection.
- **`PreparedTxSafeTypedData.operation`** (Phase 37): semantic string field already exists; Phase 38 reads directly.
- **`src/signing/blocks.ts`** (Phase 9 + earlier): APPEND-ONLY block template surface; mirror the `VAULTPILOT_NOTICE_TEMPLATE_MISSING` pattern.
- **`src/security/skill-integrity.ts`** (Plan 09-02): sister-repo SHA pinning + additive version-list pattern; Phase 38 Plan 38-01 extends.

### Established Patterns
- **APPEND-ONLY block templates** — Phase 6+ convention; new templates added as new exported constants in `blocks.ts`; substitution at emission site.
- **Per-protocol module under `src/protocols/`** — `erc20.ts`, `aave-v3.ts`, `weth9.ts`, `uniswap-v3.ts`, `bridge-decoders/*` (Phase 39 will add more); Phase 38 adds `safe.ts` for enableModule selector + decoder.
- **Semantic-string discriminator at trigger site** — Phase 37's `operation === "delegatecall"` pattern; Phase 38 keys hard-trigger on this string, NOT numeric 0/1.
- **Cryptographic-binding fixtures pinned as hardcoded `0x…` literals** — CLAUDE.md convention; Phase 38 Fixture SAFE-G anchors selector match (NOT a fingerprint shape, so simpler literal).
- **Sister-repo SHA-pin additive lists** — Phase 9 pattern; Plan 38-01 commits v1.4 SHA before Plan 38-02 tags the release.

### Integration Points
- **`prepare_safe_tx_propose.ts:538`** — current informational `delegatecall: YES` line. Phase 38 promotes to hard-trigger block emission (line replaced or block appended adjacent).
- **`prepare_safe_tx_approve.ts:411`** — mirror site.
- **`preview_send.ts` (search: `isSafeExecTransaction`)** — Phase 38 adds re-emission branch.
- **`SECURITY.md §6`** — Inv #12.5 codification + v2.5 close-out.

</code_context>

<specifics>
## Specific Ideas

- Hard-trigger blocks read as INSTRUCTIONS to the agent in the same voice as Plan 04-03's `[AGENT TASK — RUN THESE CHECKS NOW]` block. The skill-side Inv #12.5 enforcement is the load-bearing defense; the MCP block is the trigger signal that the skill-side check needs to fire.
- The composite (enableModule + delegatecall in one SafeTx) is realistic: a malicious actor could craft a delegatecall to a contract whose code calls back into `enableModule`. Emitting BOTH blocks surfaces both risks; the user sees two distinct verification asks.
- v2.5 ships "code-complete" per 2026-05-16 directive — Phase 38 verify-phase requires a real Safe + co-signer + small mainnet balance, bundled with v1.x/v2.x verify items.

</specifics>

<deferred>
## Deferred Ideas

- `disableModule(address,address)` detection (selector `0xe009cfde`) — module contraction is rarely a blast-radius operation; defer to v2.5.x as the second hard-trigger pattern if usage data shows users want it.
- `changeMasterCopy` proxy-upgrade detection — `delegatecall` discriminator already covers; explicit selector detection only adds value if Ledger CAL coverage improves enough to clear-sign such ops (defer to v2.6+).
- Per-module risk-scoring (curated allowlist) — v2.5.x; would extend `KNOWN_SPENDERS_*` pattern to `KNOWN_SAFE_MODULES_*`.
- Safe Account Abstraction (4337) — v3.x.
- Other high-blast-radius op detection (e.g. `MultiSend` non-CallOnly with operation=1) — captured by `delegatecall` discriminator at Phase 38; explicit `multiSend` selector detection deferred unless skill-side enforcement needs the finer-grained signal.

</deferred>

---

*Phase: 38-safe-enable-module-delegate-call-second-llm*
*Context gathered: 2026-05-27*
